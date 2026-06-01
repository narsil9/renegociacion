# Tarea para el Agente — Worker Daemon + Fixes

Eres el agente que construyó el dashboard de automatización para el proyecto `renegociacion` (Superintendencia de Insolvencia y Reemprendimiento de Chile). Otro revisor ya aplicó 4 fixes menores al código que generaste. Tu tarea ahora es construir la pieza que falta y resolver los puntos pendientes.

---

## CONTEXTO DEL PROYECTO

**Stack actual:**
- `src/` → Automatización: Node.js + TypeScript + Playwright
- `dashboard/` → Frontend: Vite + React + TypeScript + Supabase JS
- Supabase (sandbox) → Base de datos + Realtime + Storage
- Mac Mini → servidor headless que corre Playwright en producción

**Flujo completo que debe funcionar:**
1. Abogado abre el dashboard → ve lista de clientes
2. Hace click en "Correr Paso 1" → dashboard inserta un job `pending` en `automation_jobs`
3. **Worker en Mac Mini** detecta el job → lo ejecuta con Playwright → actualiza estado + sube screenshot
4. Dashboard recibe update por Supabase Realtime → muestra resultado en vivo

**El paso 3 no existe todavía. Es lo más crítico a construir.**

---

## LO QUE YA FUE CORREGIDO (no tocar)

Estos bugs ya fueron aplicados:
- `ClientModal.tsx`: overlay cierra el modal al hacer click (igual que `JobDiagnosticModal`)
- `dashboard/.gitignore`: agregado `.env` y `.env.local`
- `App.tsx`: query de jobs ordena `descending` y conserva solo el primero por `client_id`
- `App.tsx`: eventos `DELETE` de Realtime eliminan el job del estado local

---

## ARCHIVOS RELEVANTES QUE YA EXISTEN

- `src/utils/browser.ts` → `launchBrowser()`, `screenshotOnFailure()`
- `src/automation/login.ts` → `loginAndNavigateToStep1(page, rut, password, logger?)`
- `src/automation/step1_personal.ts` → `fillStep1(page, clientData, logger?)` y `interface ClientData`
- `src/utils/init_supabase.ts` → ejemplo de conexión a Supabase con `SERVICE_ROLE_KEY`

**Variables de entorno en `.env` raíz:**
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...   ← usar en el worker (nunca la anon key)
HEADLESS=true                   ← worker corre headless en producción
DRY_RUN=false                   ← worker SIEMPRE guarda, nunca es prueba
```

---

## LO QUE HAY QUE CONSTRUIR

### 1. `src/utils/supabaseWorker.ts`
Cliente Supabase para el worker usando `SERVICE_ROLE_KEY` (separado del cliente anon del dashboard).

### 2. `src/worker.ts` — Worker Daemon

Proceso Node.js que corre indefinidamente en el Mac Mini, polling a Supabase cada 5 segundos.

**Flujo exacto:**
```
Al arrancar:
  → Buscar jobs con status='running' huérfanos y marcarlos 'failed' con error_log='Worker reiniciado: job abandonado'

Cada 5 segundos:
  1. SELECT * FROM automation_jobs WHERE status='pending' ORDER BY created_at ASC LIMIT 1
  2. Si no hay job → esperar 5s y repetir
  3. Si hay job:
     a. UPDATE SET status='running', updated_at=now()
     b. SELECT * FROM clients WHERE id=job.client_id
     c. Acumular logs en un string (usar el parámetro logger de login y fillStep1)
     d. launchBrowser()
     e. loginAndNavigateToStep1(page, client.clave_unica_rut, client.clave_unica_password, logger)
     f. Construir objeto ClientData desde los campos del cliente
     g. fillStep1(page, clientData, logger)  ← forzar DRY_RUN=false internamente
     h. Tomar screenshot de éxito → subir a Supabase Storage bucket 'screenshots'
     i. UPDATE SET status='success', screenshot_url=<url_publica>, updated_at=now()
  4. Si cualquier paso falla (catch):
     a. Tomar screenshot del error con screenshotOnFailure()
     b. Subir screenshot a Storage
     c. UPDATE SET status='failed', error_log=<logs_acumulados + mensaje_error>, screenshot_url=<url>, updated_at=now()
  5. Cerrar browser en bloque finally
  6. Esperar 5s → repetir
```

### 3. SQL para Supabase

Proporcionar el SQL completo para crear las tablas si no existen:

**Tabla `clients`:**
```sql
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
rut text UNIQUE NOT NULL,
name text NOT NULL,
clave_unica_rut text NOT NULL,
clave_unica_password text NOT NULL,
nacionalidad text,
fecha_nacimiento text,
estado_civil text,
regimen_patrimonial text,
profesion_oficio text,
ocupacion text,
direccion text,
region text,
comuna text,
email text,
telefono_prefijo text,
telefono text,
created_at timestamptz DEFAULT now()
```

**Tabla `automation_jobs`:**
```sql
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
step integer NOT NULL DEFAULT 1,
status text NOT NULL DEFAULT 'pending',
error_log text,
screenshot_url text,
created_at timestamptz DEFAULT now(),
updated_at timestamptz DEFAULT now()
```

### 4. `package.json` raíz

Agregar script:
```json
"worker": "ts-node src/worker.ts"
```

---

## PREGUNTAS QUE DEBES RESPONDER Y RESOLVER ANTES DE IMPLEMENTAR

Analiza cada una, propone la mejor solución para este contexto (Mac Mini, ~50-200 clientes, sandbox de prueba) y justifica tu decisión:

**A) ¿Polling (setTimeout loop) o Supabase Realtime en el worker?**
Polling es más simple. Realtime es más eficiente pero más complejo en un proceso de larga duración. ¿Cuál es mejor aquí?

**B) ¿Cómo manejar el DRY_RUN en el worker?**
`fillStep1` lee `process.env.DRY_RUN`. El worker siempre debe guardar. ¿Forzás `process.env.DRY_RUN = 'false'` al inicio del worker, o modificás la firma de `fillStep1` para recibir el flag como parámetro explícito?

**C) ¿Cómo subir el screenshot a Supabase Storage?**
`screenshotOnFailure()` guarda el PNG localmente en `outputs/`. El worker necesita subirlo a Storage. ¿Modificás `screenshotOnFailure()` para que acepte un cliente Supabase y suba automáticamente, o lo hacés en el worker después de guardar localmente?

**D) ¿Qué pasa si Supabase Storage no tiene el bucket 'screenshots' creado?**
El worker debe manejarlo gracefully: si el upload falla, igual marcar el job como `failed` con el `error_log`, sin crashear.

---

## ENTREGABLES ESPERADOS

1. `src/utils/supabaseWorker.ts`
2. `src/worker.ts`
3. SQL de creación de tablas `clients` y `automation_jobs` (como archivo `supabase/schema.sql` o pegado en comentarios)
4. `package.json` raíz con script `worker`
5. `npx tsc --noEmit` debe pasar sin errores al finalizar
