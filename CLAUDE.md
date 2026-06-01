# Renegociación Superintendencia - Automation Project

This repository contains the hybrid automation system for filling out the renegotiation request portal at the Superintendencia de Insolvencia y Reemprendimiento (Superir) in Chile. It is designed for lawyers working on debt/bankruptcy cases to trigger step-by-step automation fragments while maintaining human-in-the-loop validation and manual control.

## Quick Facts

- **Stack**: Node.js, TypeScript, Playwright, Supabase (Client Data & Cookie Sharing)
- **Runtime Environment**: Mac Mini (Headless Server)
- **Start Command**: `npm run dev`
- **Run Automation Command**: `npm run automate -- --rut=<RUT> --step=<STEP_NUMBER>`
- **Test Command**: `npm test`

## Key Directories

- `src/automation/` - Step-specific Playwright scripts (`step1_personal.ts`, `login.ts`, etc.)
- `src/utils/` - Utility functions (browser controllers, cookie handlers, Supabase clients)
- `src/dashboard/` - Next.js Dashboard code (if integrated into the same repo)
- `outputs/` - Screenshots of successful/failed automation steps

## Code Style & Conventions

- **TypeScript strict mode** enabled.
- **Selectors Rule**: Always prefer accessibility and text-based selectors (`getByRole`, `getByLabel`, `getByText`) over brittle CSS/XPath selectors.
- **Failures & Logs**: Playwright scripts must capture a screenshot upon failure and save the page HTML to the `outputs/` directory.
- **State Verification**: Every step script must verify it is on the correct URL/state before initiating data entry.

## The 8 Portal Steps

1. **Información Personal** (Personal Information) [Priority 1 Automation]
2. **Declaraciones** (Declarations) [Manual/Auto Hybrid]
3. **Acreedores** (Creditors & Debts) [Auto from CMF/Bank PDF data]
4. **Apoderado** (Power of Attorney/Representative) [Manual/Auto]
5. **Ingresos** (Income details)
6. **Bienes** (Assets & Properties)
7. **Propuesta** (Payment Proposal)
8. **Finalizar** (Final Review & Submission)

---

## SuperWhisp Database — Supabase de Producción

La base de datos del estudio del Abogado Ricardo Puelma ("SuperWhisp") es la fuente de verdad de todos los clientes y casos de renegociación. Se accede vía Supabase con las variables `PROD_SUPABASE_URL` y `PROD_SUPABASE_SERVICE_ROLE_KEY` en el `.env`. Hay **48 tablas** en total; abajo se documentan solo las relevantes para la automatización.

La clave de unión entre las tablas de renegociación es **`airtable_id`** (el record ID del caso en Airtable, ej. `recXXXXXXXXXXXXXX`). **Excepciones a tener en cuenta:**
- `cmf_informes`: el `airtable_id` es el record del *attachment*; el caso se enlaza por **`case_airtable_id`**.
- `renegociacion_audit` y `v_correos_renegociacion`: además del `airtable_id`, traen el RUT normalizado (`rut_norm` / `case_rut`) como identificador alternativo.

### Tablas y vistas principales para la automatización

#### `v_casos_renegociacion` (VISTA — lectura principal de casos)

La vista más importante. Agrega datos de múltiples tablas en un solo registro por caso. **Usar esta vista para obtener los datos de un cliente antes de automatizar.**

| Campo | Descripción |
|-------|-------------|
| `airtable_id` | Clave foránea principal. Enlaza con todas las demás tablas. |
| `rut` | RUT del cliente (formato `XXXXXXXX-X`). Usado como identificador en el portal Superir. |
| `nombre` | Nombre completo del cliente. |
| `email` | Email del cliente. |
| `telefono` | Teléfono del cliente. |
| `t0` | Fecha de inicio del proceso de renegociación (T0). |
| `t60`, `t89`, `t90` | Fechas límite calculadas. T90 es la fecha de vencimiento crítica. |
| `monto` | Monto total a renegociar (en pesos CLP). |
| `asesor` | Nombre del abogado asesor asignado. |
| `estado` | Estado del caso (`activo`, etc.). |
| `drive_link` | Link a la carpeta Google Drive del cliente con sus documentos. |
| `documentos_drive` | Array JSON de archivos detectados en Drive. |
| `checklist_sii`, `checklist_extras`, `checklist_overrides` | Checklists de documentos pendientes. |
| `notas` | Notas internas del caso. |

---

#### `renegociacion_overrides` (CRÍTICA — credenciales y datos de automatización)

Almacena las credenciales de acceso del cliente y todos los datos estructurados que alimentan la automatización. **Siempre consultar antes de ejecutar cualquier script.**

| Campo | Descripción |
|-------|-------------|
| `airtable_id` | PK. Enlaza con `v_casos_renegociacion`. |
| `airtable_clave_unica` | **ClaveÚnica del cliente** — usada en `login.ts` para autenticar en Superir y SII. |
| `airtable_clave_ct` | **Clave Tributaria del cliente** — usada para acceder al SII. |
| `clave_cu_override` / `clave_ct_override` | Sobrescritura manual de credenciales si difieren de Airtable. |
| `cmf_deudas_json` | JSON estructurado con las deudas CMF del cliente (acreedor, monto, tipo). Fuente para el Paso 3 (Acreedores). |
| `sii_carpeta_json` | Datos extraídos de la Carpeta Tributaria SII. |
| `sii_boletas_json` | Datos de boletas de honorarios SII. |
| `sii_agente_json` | Datos del Agente Retenedor SII (empleadores, ingresos). Fuente para el Paso 5 (Ingresos). |
| `t0_override` | Sobrescritura manual de la fecha T0. |
| `checklist_generated_at` | Cuándo se generó el checklist de documentos. |
| `credenciales_updated_at` / `credenciales_updated_by` | Auditoría de quién actualizó las credenciales. |

---

#### `mac_mini_jobs` (COLA DE TRABAJOS — robot descargador del SII)

> ⚠️ **OJO:** Esta tabla **NO** pertenece a nuestra automatización del portal Superir. Es la cola de un **robot separado de descarga de documentos del SII** (Servicio de Impuestos Internos) que corre en el Mac Mini. Sus comandos son `sii-carpeta`, `sii-boletas`, `sii-agente-retenedor`, etc. — descargan la Carpeta Tributaria, boletas y datos del agente retenedor. **No registra ni ejecuta el proceso de renegociación.** No usar esta tabla para filtrar "actividad previa" de renegociación. Nuestra automatización del portal Superir es un sistema nuevo que aún **no tiene** cola en producción (en pruebas usa `pato_prueba_automation_jobs` en el sandbox).

Tabla de jobs que el Mac Mini daemon lee por polling y donde escribe los resultados de las descargas SII.

| Campo | Descripción |
|-------|-------------|
| `id` | PK autoincremental del job. |
| `command` | Comando de descarga SII a ejecutar. Ej: `sii-carpeta`, `sii-boletas`, `sii-agente-retenedor`. |
| `args` | JSON con los argumentos. Siempre incluye `rut`. Las claves (`clave_cu`) se limpian (`[CLEANED]`) en el log post-ejecución. |
| `airtable_id` | Caso al que pertenece el job. |
| `status` | Estado: `pending` → `running` → `done` / `failed`. |
| `result` | JSON con el resultado completo de la ejecución (paths de archivos, logs, bytes, etc.). |
| `error` | Mensaje de error si el job falló. |
| `exit_code` | Código de salida del proceso. |
| `duration_ms` | Duración total en milisegundos. |
| `requested_by` / `source` | Quién / desde dónde se solicitó el job. |
| `created_at` / `started_at` / `completed_at` | Timestamps del ciclo de vida del job. |
| `retry_count` | Número de reintentos realizados. |

---

#### `bronze_project_renegociacion` (RAW Airtable — datos completos del proyecto)

Copia bruta de los registros de Airtable para cada caso de renegociación. El campo `data` es un JSON con todos los campos de Airtable, incluyendo: `Monto a Renegociar`, `Prioridad`, `T0`, `Fecha de Audiencia ADP/AR`, `Número de Anuncio`, checklist de bienes y deudas (vehículos, inmuebles, inversiones, etc.), y el RUT individual.

- `airtable_id`: PK.
- `data`: JSONB con todo el detalle del caso en Airtable.
- `updated_at`: Última sincronización con Airtable.

---

#### `acreedores_canonicos` (PASO 3 — catálogo de acreedores normalizados)

Catálogo maestro de acreedores (501 registros). Cada acreedor tiene un `nombre` y un `nombre_normalizado`, usados para normalizar los nombres extraídos del CMF antes de ingresarlos en el portal Superir (Paso 3). Incluye también datos de contacto y legales del acreedor.

| Campo | Descripción |
|-------|-------------|
| `id` | PK. |
| `nombre` / `nombre_normalizado` | Nombre canónico y su versión normalizada para matching. |
| `tipo` | Tipo de entidad (`Banco`, `Administrativo`, etc.). |
| `rut`, `direccion`, `comuna`, `email`, `telefono` | Datos del acreedor (pueden ser null). |
| `representante_legal`, `rut_representante` | Datos del representante legal. |
| `is_administrativo` | `true` para categorías especiales que **no** son acreedores reales (ej: "Documentos administrativos" = cédula, poder, contratos del titular). |
| `activo` | Si el acreedor está vigente en el catálogo. |

---

#### `cmf_informes` (PASO 3 — registro de PDFs de informes CMF)

**Registro de archivos PDF** de los informes de deuda CMF descargados (1158 registros). Guarda metadatos del archivo y estado de extracción — **NO** contiene los datos de deuda estructurados (esos, una vez procesados, viven en `renegociacion_overrides.cmf_deudas_json`).

| Campo | Descripción |
|-------|-------------|
| `id` | PK. |
| `case_airtable_id` | **FK al caso** (no usar `airtable_id`, que es el record del attachment). |
| `filename` | Nombre del PDF (ej: `informe_deudas_14556315-1.pdf`). |
| `storage_path` | Ruta en Supabase Storage. |
| `pdf_size_bytes` | Tamaño del archivo. |
| `fecha_emision`, `fecha_emision_pdf`, `fecha_informacion_pdf` | Fechas del informe. |
| `source` | Origen del archivo (ej: `airtable_sync`). |
| `pdf_extracted_at`, `pdf_extract_error` | Estado de la extracción del contenido del PDF. |

---

#### `renegociacion_hito` (SEGUIMIENTO DE HITOS)

Registra los hitos alcanzados en el proceso de cada caso.

| Campo | Descripción |
|-------|-------------|
| `airtable_id` | FK al caso. |
| `hito` | Nombre del hito: `propuesta_aceptada`, `contrato_firmado`, etc. |
| `estado` | `done` u otros estados. |
| `marcado_at` | Cuándo se marcó el hito. |

---

#### `alertas_renegociacion` (MONITOREO)

Alertas automáticas para el equipo sobre problemas en los casos.

| Tipo de alerta | Significado |
|---------------|-------------|
| `cmf_vencido` | El informe CMF tiene más de X días. Solicitar al cliente. |
| `caso_estancado` | Sin actividad por X días. Verificar pendientes T80–T90. |
| `nuevo_acreedor` | Se detectaron nuevos acreedores en el CMF. |

---

#### `renegociacion_audit` (AUDITORÍA DE EMAILS)

Resumen del historial de comunicaciones por correo para cada caso. Incluye categorización del estado real del proceso basada en los emails (`categoria`), como `C_SIN_CONTRATO_FIRMADO`, y los emails relevantes (`mensajes_resumen`).

---

#### `v_correos_renegociacion` (VISTA — emails asociados a casos)

Vista que cruza los emails del Gmail del estudio con los casos activos. Permite ver todos los correos enviados/recibidos para un `airtable_id` dado, incluyendo adjuntos, remitente, y si tiene checklist de documentos.

---

### Flujo de datos para la automatización Superir

Nuestra automatización del portal **lee** de producción (read-only) y ejecuta/registra todo en el sandbox. **No** usa `mac_mini_jobs` (esa cola es del robot SII). En fase de prueba, la cola propia es `pato_prueba_automation_jobs` en el sandbox.

```
[PROD, read-only]
  v_casos_renegociacion      → obtener rut, nombre, t0, estado
  renegociacion_overrides    → obtener clave_unica (just-in-time), clave_ct, cmf_deudas_json, sii_agente_json

[SANDBOX]
  pato_prueba_automation_jobs (INSERT) → encolar job de automatización (client_id + step)
  [Mac Mini ejecuta Playwright]        → login.ts → step1_personal.ts → stepN.ts
  pato_prueba_automation_jobs (UPDATE) → escribir status/error/screenshot al completar
```

> Detalles del aislamiento sandbox/producción y las garantías de no-disrupción: ver [implementation_plan.md](file://./implementation_plan.md).

## Session Initialization (Mandatory)

At the beginning of every session, you MUST immediately read:
- [task.md](file://./task.md) to review completed and pending tasks.
- [README.md](file://./README.md) to align on the architecture.
- [.claude/skills/renegociacion-automation/SKILL.md](file://./.claude/skills/renegociacion-automation/SKILL.md) to align on the automation rules.

## Skill Activation

Before implementing ANY task, check if relevant skills apply:
- Modifying automation scripts → `renegociacion-automation` skill

## Common Commands

```bash
# Run automation for a specific step
npm run automate -- --rut=12345678-9 --step=1

# Compile TypeScript
npm run build
```
