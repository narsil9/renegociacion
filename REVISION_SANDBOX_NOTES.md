# Revisión del Sandbox `pato_prueba_*` — Notas para el Agente Constructor

> Documento de hallazgos tras una revisión en vivo de las tablas `pato_prueba_clients` y `pato_prueba_automation_jobs` en el sandbox (`fnzdruyojclfannkwyqe.supabase.co`), su conexión con el TypeScript/daemon, y el riesgo de duplicación de datos.
>
> **Resumen ejecutivo:** las tablas están bien creadas y completamente conectadas (worker, sync, dashboard). El sistema funciona de punta a punta. **No hay riesgo de duplicación ni de destrucción de datos** (ver §4, verificado en vivo). Quedan 3 desviaciones de seguridad/datos respecto al plan endurecido y 1 nota operativa, todas detalladas abajo.

---

## Estado verificado (en vivo)

| Tabla | Filas | FK / Constraints | Conexión |
|---|---|---|---|
| `pato_prueba_clients` | 144 | PK `id`, UNIQUE `rut`, UNIQUE `airtable_id` | ✅ worker, sync, dashboard |
| `pato_prueba_automation_jobs` | 1 | PK `id`, FK `client_id → clients(id) ON DELETE CASCADE`, `dry_run DEFAULT true` | ✅ worker, dashboard |

Toggle de modo: `QUEUE_MODE=production` (worker) / tab "Producción" (dashboard) → usa `pato_prueba_*`. Default `sandbox` → tablas `clients`/`automation_jobs` originales (intactas).

---

## A. RLS quedó en acceso PÚBLICO (no `service_role`)  — Severidad: Media

**Qué pasa:** verifiqué que la **anon key puede leer las 144 filas** de clientes reales (nombre, RUT, email, teléfono, dirección).

**Por qué:** el dashboard ([dashboard/src/supabaseClient.ts](dashboard/src/supabaseClient.ts)) es una app de navegador que usa la **anon key** (`VITE_SUPABASE_ANON_KEY`). Una RLS `service_role`-only rompería el dashboard, así que se dejó política pública para que funcione.

**Lo que SÍ está protegido:** la columna `clave_unica_password` **NO existe** en la tabla — las credenciales ClaveÚnica no se guardan; se buscan *just-in-time* desde producción en tiempo de ejecución ([src/worker.ts:134-197](src/worker.ts#L134)). Es decir, **no hay credenciales expuestas.**

**Riesgo residual:** PII de 144 personas reales legible por cualquiera con la anon key (que viaja en el bundle del frontend).

**Acción recomendada (para producción, no bloqueante en pruebas):**
- Opción 1: poner un backend / Edge Function como proxy y usar `service_role` solo del lado servidor; el dashboard deja de usar la anon key para estos datos.
- Opción 2: Supabase Auth con RLS por usuario (cada abogado ve solo lo suyo).
- En fase de prueba con datos reales, decidir conscientemente si se acepta este riesgo.

---

## B. Inconsistencia: el script de creación NO refleja la RLS real  — Severidad: Baja

**Qué pasa:** [src/utils/create_sandbox_tables.ts:85-92](src/utils/create_sandbox_tables.ts#L85) define políticas **`service_role`-only**, pero la base viva tiene políticas **públicas**. El script y la realidad no coinciden.

**Implicación:** si se re-corre el script, *agregaría* la política `service_role` **sin eliminar** la pública existente. Como las políticas RLS se combinan con OR, la anon **seguiría leyendo**. Cambiar el script no cierra el acceso por sí solo.

**Acción recomendada:** decidir cuál es la fuente de verdad y alinear:
- Si se mantiene RLS pública en pruebas → actualizar el script para que refleje eso (y documentar el porqué).
- Si se quiere cerrar → además de la política `service_role`, hay que **`DROP POLICY`** explícitamente la política pública existente, y migrar el dashboard a un backend (ver A).

---

## C. `fecha_nacimiento` sigue usando placeholder  — Severidad: Media (bloqueante para envío real)

**Qué pasa:** la fecha de nacimiento **no existe en la base de producción** (verificado: 0/50 en `bronze_customers_main` y `bronze_customers_sub`). En [src/worker.ts:237](src/worker.ts#L237) persiste el fallback `client.fecha_nacimiento || '01/01/1990'`.

**Por qué no es catastrófico hoy:** `dry_run` está activo por defecto y el dashboard bloquea el envío en vivo cuando los datos están incompletos ([dashboard/src/App.tsx:534](dashboard/src/App.tsx#L534)). Por tanto **no se enviará una solicitud real con fecha falsa** mientras esos dos frenos sigan activos.

**Pregunta abierta (resolver antes de cualquier envío real):**
- ¿El portal Superir **autocompleta** la fecha de nacimiento desde ClaveÚnica al iniciar sesión? → Verificar en el portal.
  - Si **sí** → no enviarla; quitar el placeholder del fill.
  - Si **no** → conseguirla de otra fuente (Registro Civil / documentos del cliente) y tratarla como `missing_field` hasta tenerla.

---

## D. Nota operativa: el pooler `DATABASE_URL` no conecta  — Severidad: Baja

Al intentar conectar por el pooler Postgres (`DATABASE_URL`) para inspección, falló con:
`error: (ENOTFOUND) tenant/user postgres.fnzdruyojclfannkwyqe not found`.

**Implicación:** `create_sandbox_tables.ts` usa `pg.Client` con ese `DATABASE_URL`. Con el valor actual, **re-correr el script fallaría en `client.connect()`**. Las tablas existentes siguen funcionando (se accede por PostgREST), pero el script DDL no es ejecutable hasta corregir el `DATABASE_URL` (probablemente el formato de usuario del pooler: `postgres.<ref>` o el host `aws-0-...pooler.supabase.com`).

**Acción recomendada:** corregir `DATABASE_URL` en `.env` con la cadena de conexión del pooler que entrega el panel de Supabase (Settings → Database → Connection pooling).

---

## 4. Confirmación: NO hay riesgo de duplicación ni destrucción de datos ✅

Verificado en vivo (PostgREST, service role):

| Verificación | Resultado |
|---|---|
| Duplicados actuales por `rut` (sobre 144 filas) | **0** |
| Duplicados actuales por `airtable_id` | **0** |
| Insertar `rut` duplicado | **BLOQUEADO** por `pato_prueba_clients_rut_key` |
| Insertar `airtable_id` duplicado | **BLOQUEADO** por `pato_prueba_clients_airtable_id_key` |
| Re-ejecutar upsert mismo `rut` (`onConflict:'rut'`) | filas antes=144, después=**144** (actualiza en sitio, no agrega) |

**Conclusiones:**
1. **Imposible duplicar filas:** hay `UNIQUE` tanto en `rut` como en `airtable_id`. La base no permite dos registros del mismo cliente.
2. **El sync es idempotente:** [src/utils/sync_prod_data.ts:336-338](src/utils/sync_prod_data.ts#L336) hace `upsert(..., { onConflict: 'rut' })`. Re-correrlo **actualiza** los 144 registros en sitio; no crea 288. No se "destruye" ni se infla la base.
3. **Producción nunca se escribe:** el sync solo escribe en el cliente del sandbox (`localSupabase`); a producción solo le lee. No hay forma de que este flujo dañe la base del abogado.

**Único caso borde a tener presente (no es duplicación, es un fallo seguro):**
El upsert resuelve conflictos solo por `rut`, pero también existe `UNIQUE(airtable_id)`. Si en una sincronización futura llega una fila con un `rut` **nuevo** pero un `airtable_id` que **ya existe** (o un `rut` existente reasignado a otro `airtable_id`), el upsert chocará con la constraint de `airtable_id` y **el lote completo fallará con error** — **no** creará duplicados ni borrará nada. Es un comportamiento *fail-safe*.

**Recomendación opcional (robustez):** decidir una sola clave de conflicto estable. Si `airtable_id` es el identificador maestro del caso, considerar `onConflict: 'airtable_id'`, o limpiar/validar el lote antes del upsert para detectar choques `rut`↔`airtable_id` y reportarlos en vez de abortar.

---

## Checklist sugerido para el constructor
- [ ] Decidir postura de RLS (A) y alinear el script (B).
- [ ] Resolver la pregunta de `fecha_nacimiento` en el portal (C) antes de habilitar envíos en vivo.
- [ ] Corregir `DATABASE_URL` del pooler para que `create_sandbox_tables.ts` sea re-ejecutable (D).
- [ ] (Opcional) Revisar la clave de conflicto del upsert para el caso borde `rut`↔`airtable_id` (§4).
