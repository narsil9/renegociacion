# Conectar tu dashboard a la automatización

Cómo tu UI/dashboard dispara y sigue una corrida. El acoplamiento es **solo la base de datos
Supabase**: tu dashboard escribe datos + documentos y encola un job; el worker lo toma, corre la
automatización y escribe el resultado de vuelta. No hay API HTTP entre medio.

**Prerrequisito:** la base creada con [`../../supabase/setup.sql`](../../supabase/setup.sql), y el
worker corriendo contra el mismo proyecto Supabase (ver [`../../INSTALL.md`](../../INSTALL.md)).

---

## Flujo completo (3 escrituras + 1 lectura)

```
1. UPSERT clients            (datos del Paso 1 + credenciales + rutas de documentos)
2. subir PDFs a Storage      (bucket 'documentos') + INSERT client_documents (uno por certificado)
3. INSERT automation_jobs     ← esto es el botón "Ejecutar"
   ────────────────────────────────────────────────────
4. el worker toma el job, corre, y actualiza automation_jobs.status + automation_alerts
   tu dashboard hace polling/realtime de esas dos tablas
```

---

## 1. `clients` — datos del cliente (UPSERT por `rut`)

Una fila por cliente. El `rut` es UNIQUE — usalo como llave para hacer upsert.

| Columna | Obligatoria | Qué es |
|---|---|---|
| `rut` | ✅ | RUT del cliente, formato `12345678-9`. |
| `name` | ✅ | Nombre completo. |
| `clave_unica_rut` | ✅ | RUT de la ClaveÚnica con que se entra al portal (normalmente el mismo). |
| `clave_unica_password` | ✅ | Clave del cliente para el portal. |
| `fecha_nacimiento` | ✅* | `DD/MM/AAAA`. Obligatoria para un envío real (Paso 1). |
| `nacionalidad`, `estado_civil`, `regimen_patrimonial`, `profesion_oficio`, `ocupacion`, `direccion`, `region`, `comuna`, `email`, `telefono_prefijo`, `telefono` | ▲ | Paso 1. Usá los **valores del portal** (ver `supabase/portal_select_values.json`): los `<select>` van por código/etiqueta exactos. |
| `informe_cmf_path` | ✅ | Ruta en Storage del Informe de Deudas CMF (Paso 3). **Obligatorio.** |
| `carpeta_tributaria_path` | ✅ | Ruta en Storage de la Carpeta Tributaria SII (Paso 2). |
| `carpeta_retenedores_path` | ▲ | Ruta en Storage de Agentes Retenedores SII (Paso 5, si aplica). |

`*` sin `fecha_nacimiento` el Paso 1 no se puede completar. `▲` = recomendado/según el caso.

> El worker toma el `client_id` (UUID) que devuelve este upsert para enlazar el job y los documentos.

---

## 2. Documentos — Storage `documentos` + `client_documents`

Subí cada PDF al bucket **`documentos`** y guardá su ruta. Hay dos tipos de documento:

**a) Documentos "de cabecera"** (uno de cada uno) → van en columnas de `clients`:
Informe CMF → `informe_cmf_path`; Carpeta Tributaria → `carpeta_tributaria_path`;
Agentes Retenedores → `carpeta_retenedores_path`.

**b) Certificados de acreditación (Paso 3) y documentos de ingreso (Paso 5)** → una fila por
documento en `client_documents`:

| Columna | Qué es |
|---|---|
| `client_id` | FK al cliente. |
| `storage_path` | Ruta del PDF en el bucket `documentos`. **Única por documento.** |
| `filename` | Nombre del archivo. |
| `document_type` | `22` = acredita **monto**, `23` = acredita **vencimiento**, `24` = general. |
| `acreditacion_tipo` | `'monto'`, `'vencimiento'` o `'general'` (coherente con `document_type`). |
| `institucion_cmf` | Opcional. Si lo dejás vacío, el worker deriva el acreedor leyendo el **RUT del emisor** dentro del PDF. |

> No hace falta clasificar los documentos con precisión: el Centinela lee cada PDF, identifica al
> acreedor por su RUT/contenido y decide 260/261. Lo que no sea certificado de acreedor lo trata
> como documento de ingreso (Paso 5). Con subirlos y crear la fila alcanza.

---

## 3. `automation_jobs` — encolar (el botón "Ejecutar")

Insertá **una fila**. El worker la detecta en ≤5s.

```sql
INSERT INTO automation_jobs (client_id, step, dry_run)
VALUES ('<uuid-del-cliente>', 0, false);
```

| Columna | Valor | Qué significa |
|---|---|---|
| `client_id` | UUID | El cliente a procesar. |
| `step` | `0` | Flujo completo (Pasos 1→5). Un número `1..5` corre solo ese paso. |
| `dry_run` | `false` | Llena el borrador vivo (no envía, no radica) para revisión del abogado. `true` = prueba con auto-limpieza. |

**Idempotencia:** no encoles un segundo job para el mismo cliente si ya hay uno `pending`/`running`
— reutilizá esa fila. El worker procesa de a uno por cliente.

---

## 4. Leer el resultado — `automation_jobs` + `automation_alerts`

Hacé polling (o Realtime) de la fila del job:

| Columna | Para mostrar |
|---|---|
| `status` | `pending` → `running` → `success` \| `failed` \| `blocked` \| `pending_review`. |
| `progress_message` | Fase actual en lenguaje claro (ej. "Revisando el Informe CMF…"). En vivo. |
| `error_message` | Motivo legible si `failed`/`blocked`. |
| `screenshot_url` | Captura del portal (bucket `screenshots`, público). |

**Estados terminales:**
- `success` — borrador cargado. Si `dry_run=false`, el abogado entra al portal, revisa y **envía a mano**.
- `blocked` — el caso no califica (requisito de fondo: <2 deudas 90+d, Primera Categoría F29, CMF vencido). Mirá `automation_alerts`. Reintentar no lo resuelve.
- `failed` — error técnico (red, portal caído). Reintentable.
- `pending_review` — el worker frenó esperando confirmación del abogado (ver §5).

**Alertas** (`automation_alerts`, filtrar por `job_id` o `client_id`): cada fila trae `alert_type`
(`'blocked'` | `'needs_review'`), `step` y `description` (texto para el abogado). Mostralas junto
al caso. Son **informativas**: un `needs_review` no frena el borrador, solo pide revisión.

---

## 5. Reanudar un `pending_review` (opcional)

Si el worker deja el job en `pending_review` (ej. detectó un acreedor NO-CMF que conviene que el
abogado confirme), tu dashboard lo reanuda así:

```sql
UPDATE automation_jobs
SET status = 'pending', lawyer_confirmed = true
WHERE id = '<job-id>' AND status = 'pending_review';
```

El worker lo vuelve a tomar y, al ver `lawyer_confirmed = true`, continúa sin frenar de nuevo.

---

## Ejemplo mínimo (TypeScript, `@supabase/supabase-js`)

```ts
// 1. cliente
const { data: c } = await supabase.from('clients').upsert({
  rut: '12345678-9', name: 'Juana Pérez',
  clave_unica_rut: '12345678-9', clave_unica_password: '****',
  fecha_nacimiento: '15/03/1985', region: 'Región Metropolitana', comuna: 'SANTIAGO',
  informe_cmf_path: 'juana/cmf.pdf', carpeta_tributaria_path: 'juana/ct.pdf',
}, { onConflict: 'rut' }).select('id').single();

// 2. subir un certificado y registrarlo
await supabase.storage.from('documentos').upload('juana/cert_banco.pdf', fileBlob);
await supabase.from('client_documents').insert({
  client_id: c.id, storage_path: 'juana/cert_banco.pdf',
  filename: 'cert_banco.pdf', document_type: 22, acreditacion_tipo: 'monto',
});

// 3. encolar
await supabase.from('automation_jobs').insert({ client_id: c.id, step: 0, dry_run: false });

// 4. seguir el estado
const { data: job } = await supabase.from('automation_jobs')
  .select('status, progress_message, error_message, screenshot_url')
  .eq('client_id', c.id).order('created_at', { ascending: false }).limit(1).single();
```

---

## Notas

- **Catálogo de acreedores:** cargá `acreedores_canonicos` con los acreedores que esperás (nombre,
  `rut`, `nombres_alternativos`). El worker lo usa para normalizar nombres del CMF → RUT. Sin
  catálogo, un acreedor puede quedar sin declarar y se reporta en `automation_alerts`.
- **Seguridad:** `setup.sql` deja RLS **abierto** (cualquiera con la anon key escribe). Sirve para
  un proyecto dedicado. Antes de exponerlo, endurecé las policies y usá la `service_role` key solo
  del lado servidor.
- **Credenciales externas:** si preferís no guardar la ClaveÚnica en `clients`, el worker puede
  leerla de un sistema externo por `airtable_id` (`PROD_SUPABASE_*`). Es opcional; lo simple es
  ponerla en `clients.clave_unica_password`.
