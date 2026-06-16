# Renegociación Superintendencia - Automation Project

This repository contains the hybrid automation system for filling out the renegotiation request portal at the Superintendencia de Insolvencia y Reemprendimiento (Superir) in Chile. It is designed for lawyers working on debt/bankruptcy cases to trigger step-by-step automation fragments while maintaining human-in-the-loop validation and manual control.

## Quick Facts

- **Stack**: Node.js, TypeScript, Playwright, Ghostscript (PDF compression), Supabase (Client Data & Cookie Sharing), Anthropic SDK (`@anthropic-ai/sdk` — Cognitive Orchestrator / Mente Pensante)
- **Runtime Environment**: Mac Mini (Headless Server)
- **Start / Run Command**: `npm run automate -- --rut=<RUT> --step=<STEP_NUMBER>`
- **Worker Command**: `npm run worker`
- **Build Command**: `npm run build`
- **Test Command**: `npm test`

## Key Directories

- `src/automation/` - Step-specific Playwright scripts (`login.ts`, `step1_personal.ts`, `step2_declaraciones.ts`, `step3_acreedores.ts`, `step4_apoderado.ts`, `all_steps.ts`)
- `src/utils/` - Utility functions (browser controllers, logger, Supabase clients, PDF optimizer/analyzer, acreedor_matcher, cmf_analyzer, **cognitive_orchestrator**, date_helper, sentinel)
- `src/agents/` - Cadena multi-agente: `types.ts`, `agent_runs.ts`, `validator.ts`, `tributario_agent.ts`, `centinela_agent.ts`, `mapeador_agent.ts`
- `outputs/` - Screenshots, HTML snapshots, and log files of successful/failed automation steps
- `outputs/acreditaciones_tmp/` - Temporary local copies of downloaded certificate PDFs (used by cognitive_orchestrator)

> ⚠️ The local `dashboard/` directory has been **removed**. All UI control is now handled by the supervisor's external dashboard.

## Code Style

- **TypeScript strict mode** enabled.
- **Composition over Inheritance**: Keep utility files independent.
- **No `any`**: Use `unknown` or specific interfaces where typing is dynamic.
- **Early Returns**: Avoid nested conditionals. Use early returns for checks.
- **Selectors Rule**: Always prefer accessibility and text-based selectors (`getByRole`, `getByLabel`, `getByText`) or robust IDs over brittle CSS/XPath selectors.
- **Clean State**: Always verify you are on the correct URL/state before initiating data entry.

## Git Conventions

- **Branch naming**: `{initials}/{description}` (e.g., `pm/feat-step2-declaraciones`)
- **Commit format**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.)
- **PR titles**: Same as commit format.

## Critical Rules

### Error Handling
- NEVER swallow errors silently. Always catch, log via `RunnerLogger`, and update the job status in Supabase.
- Playwright scripts must capture a screenshot upon failure and save the page HTML to the `outputs/` directory.

### Portal State Integrity (Testing & Dry-Runs)
- **Dry Runs**: By default, runs are executed with `DRY_RUN=true`. Under dry runs, do NOT commit/submit forms to proceed to the next step.
- **Auto-Cleanup**: In Step 2, if `DRY_RUN=true`, the script must automatically delete the uploaded files at the end of the test so that subsequent trials start with a clean draft state.
- **Database Safety**: Never write directly to production database tables. All job polling and client reading must target the sandbox tables (`pato_prueba_clients` and `pato_prueba_automation_jobs` when in test mode).

### Modal Bypass & Direct Submissions
- **Step 1 Modal Workaround**: If the preview modal `#confirmarInformacionModal` doesn't become visible within 5 seconds of clicking Save, programmatically trigger the submission via page evaluation:
  ```javascript
  form.setAttribute('action', `/miSuperir/autenticado/renegociacion/guardarInformacionPersonal?_csrf=${csrfEl.value}`);
  form.submit();
  ```
- **Step 2 Declarations Mapping**: Determine the tax category from the Carpeta Tributaria PDF text. If `segunda`, check `#calidadPersonaDeudora1`. If `primera`, check `#calidadPersonaDeudora2` and `#inicioActividades1`. If `ninguna`, do not check any quality of debtor radios (the document might be damaged/invalid). In all cases, check `#tipoDeclaracionNotificacionNo`.
- **`ninguna` tax category**: Returned by `analyzeTaxCategory` when the Carpeta Tributaria PDF does not contain a legible "Categoría Tributaria:" label (e.g. scanned/image PDF). The automation continues correctly but does not select any quality radio. Verify with the client or replace the PDF if a real category exists.

### Playwright Stability
- Always wait for script stabilization (`page.waitForTimeout(3000)`) after navigating to a step to allow frontend event handlers to register before clicking delete or upload buttons.

### Step 3 — Acreedores Business Rules
- **Obligaciones 260** (`#btnAgregarEmpresa` / `#btnAgregarPersona`): Creditors where `overdue90Days > 0` **OR** reclassified by the Sentinel (`reclassifiedCreditors`).
- **Otros Acreedores** (`#btnAgregarEmpresa2` / `#btnAgregarPersona2`): Creditors where `overdue90Days === 0` AND not reclassified. Both sections share the same modals — the distinction is which button opens them.
- **`isOtros` invariant**: Always `creditor.overdue90Days === 0 && !isReclassifiedTo260(creditor)`. This value is computed once and passed explicitly to `addEmpresaAcreedor`, `addPersonaAcreedor`, and `attachDocumentoAcreedor`. **Never recompute from `overdue90Days` alone inside those functions** — the CMF cut date can lag the bank documents by weeks, causing multi-million CLP gaps.
- **Sentinel name matching**: Only institution name is used (no monto tolerance). CMF dates and bank document dates differ — the same loan can appear as $38.9M in CMF and $48.2M in the bank's report.

### Step 3 — Acreedores NO-CMF (reconciliación)
Algunas deudas reales NO aparecen en el Informe CMF pero igual deben declararse (Art. 261 obliga a declarar todos los pasivos): TGR, cajas de compensación, fintechs (Mercado Pago, Tenpo), tarjetas no reportadas, deudas castigadas. El **Centinela** (`sentinel.ts`) las detecta vía **reconciliación documentos − CMF**:
- **Pre-pase determinista (TS)**: por cada documento, `extractRutsFromText` + match contra los acreedores del CMF (por RUT primero, luego por nombre). Marca `issuerInCmf` en `nonCmfReconciliation` (parte de `localAnalysis`).
- **Claude (API #1) confirma/extrae**: decide qué documento es un acreedor NO-CMF a declarar y lo clasifica 260/261. El caso "mismo banco, producto distinto" (tarjeta BdCh vs. consumo BdCh) lo resuelve Claude, no el pre-pase. Devuelve `additionalCreditors[]` (interfaz `AdditionalCreditor`, con `needs_lawyer_confirmation: true`).
- **Flujo**: `worker.ts` captura `_sentinelAdditional` → `runCognitiveOrchestrator(..., sentinelAdditional)` genera los `AcreditacionDoc` de los no-CMF (261→tipo 22, 260→tipo 24) → `fillStep3(..., additionalCreditors)` los ingresa tras la Fase 1 (`isOtros = categoria_articulo === 261`).
- **Matching documento↔acreedor por `filename`**: los acreedores NO-CMF asocian su certificado por `AcreditacionDoc.filename` exacto (no por institución), y los del CMF **excluyen** los filenames reservados a NO-CMF. Esto evita el cruce cuando hay varios productos del mismo banco. **El orquestador debe poblar `AcreditacionDoc.filename`** (lo hace) para que el match funcione en producción.
- **Fechas clave** (`FechaClave[]` en `SentinelResult`, determinista, no bloqueante): expiración CMF/certificados (+30d) y cruce 261→260 (+91d).

### Step 3 — Monto y vencimiento "según el documento" (no del CMF)
El Paso 3 ingresa el **monto del documento de acreditación** (más actual que el CMF, dentro de la tolerancia de $300–500k) y la **fecha real de la cuota impaga** (en vez del placeholder `dateDaysAgo(90)`). Fuentes por tipo de acreedor:
- **Reclasificados** (`reclassifiedCreditors`): `total_credito_clp` + `delinquency_start_date`. Funciona en producción (el worker ya los pasa).
- **No-CMF** (`additionalCreditors`): `total_credito_clp` + `delinquency_start_date` (solo 260). Funciona en producción.
- **260 directos del CMF** (ej. CAT/CMR): vía `cmfDocumentOverrides?: CmfDocumentOverride[]` (param de `fillStep3`). **Hoy solo lo provee el test**; en producción el Orquestador debe extraer monto+fecha y poblarlo (pendiente, ver `task.md`).
- **Monto efectivo**: cuando el monto del documento sobrescribe al del CMF, ese valor se propaga a `isCreditorAlreadyInTable` y a `attachDocumentoAcreedor` (que matchean por monto). **Nunca usar `creditor.totalCredito` del CMF directamente si hay override** — la fila quedaría con un monto y el attach buscaría otro.

### Agente Tributario — Contribuciones (Impuesto Territorial)
- **Función**: `detectContribucionesDeuda(pdfPath, logger)` en `src/utils/pdf_analyzer.ts`. Usa `pdftotext -layout` para preservar columnas.
- **Regla**: sección "Propiedades y Bienes Raíces" de la CT → filas con `Condición = AFECTO` **Y** `Cuotas vencidas por pagar = SI` → contribuciones morosas.
- **Destino**: si la keyword no aparece en la línea (multi-línea en PDF), infiere del prefijo del Rol (BD→Bodega/Almacenaje, DP→Departamento, LC→Local Comercial, etc.).
- **Output**: `TributarioOutput.contribuciones_deuda?: ContribucionProperty[]`. Si hay propiedades morosas, `validateTributarioOutput` emite `needsLawyerReview = true`.
- **Monto**: el monto **NO** está en la CT — el abogado debe obtener el Certificado de Deuda TGR y cargarlo como acreedor no-CMF (similar a William Montero).
- ⚠️ **Validado con CT de formato 2024** (Jorge Romero). Re-testear con CT de nuevo formato 2025+ cuando aparezca el primer caso.

### Step 3 — Requisito de sesión (Art. 260 / 80 UF)
Para que el cliente pueda iniciar una sesión de renegociación deben cumplirse **dos condiciones simultáneas**:

1. **Mínimo 2 productos con mora > 90 días (≥ 91 días)**: Al menos dos líneas de crédito distintas deben tener valor > 0 en la columna "90 o más días de atraso" del CMF. Los dos productos **pueden ser del mismo banco** (por ejemplo, un crédito de consumo y una tarjeta de crédito de Banco Estado).
2. **Suma de `totalCredito` ≥ 80 UF (~$3.253.000 CLP)**: Se suman los campos `totalCredito` de esos productos (no el monto atrasado). Si el CMF no alcanza el umbral, se deben revisar documentos adicionales.

Esta validación es **no bloqueante** en el flujo técnico (solo genera `⚠️ ADVERTENCIA`), pero el abogado debe confirmar que se cumplen ambas condiciones antes de presentar la solicitud. El código aún no implementa el chequeo de "mínimo 2 productos" — está pendiente. Ver `task.md`.

### Step 3 — Known Portal Blockers
- **`#dlgImportante` blocking `#btnGuardarEmpresa`**: After saving a representante legal, the portal shows `#dlgImportante` which intercepts all pointer events. The fix is `dismissBlockingDialogs(page, log)`, called both after `#modalRepresentante` closes and immediately before clicking `#btnGuardarEmpresa`.
- **`Subir Documento` is a plain `<a>`, not `<a class="btn">`**: Use `getByText(/subir documento/i)` as the primary selector. Document attachment only works after ALL creditors have been added (portal enables the links then). This requires the two-phase approach: add all creditors first, then attach documents.

### Cadena Multi-Agente (`src/agents/`)

El worker no llama directamente a `analyzeTaxCategory`, `runSentinelCheck` ni `runCognitiveOrchestrator`. Toda la cadena pasa por los agentes:

```
CMF download → analyzeCmfPdf (TS)
            → runTributarioAgent   (step 2) → agent_runs
            → runCentinelaAgent    (step 3) → agent_runs
            → runMapeadorAgent     (step 3) → agent_runs → Playwright
```

- **`types.ts`** — interfaces tipadas: `TributarioOutput`, `CmfParseOutput`, `CentinelaOutput`, `MapeadorOutput`, `AgentRunRow<T>`.
- **`agent_runs.ts`** — CRUD: `insertAgentRun`, `markRunning`, `completeRun`, `failRun`, `getLatestRun`.
- **`validator.ts`** — type guards + reglas de negocio por agente (30d bypasseable, ≥2 prods, ≥80 UF, RUT, filenames únicos). `mergeResults` + `logValidationResult`.
- **Idempotencia**: tributario = SHA-256 del PDF de la carpeta tributaria; centinela = SHA-256 del CMF; mapeador = run ID del centinela.
- **Errores técnicos vs semánticos**: errores de API (créditos agotados, red) → `failRun` + throw `Error` genérico (el retry loop reintenta). Errores de documentos (faltantes, RUT incorrecto) → `CentinelaBlockedError` o `completeRun` con `needsLawyerReview=true`.
- **`SentinelResult.technicalError`**: campo `boolean?` en `sentinel.ts`. El catch externo lo marca `true`; `centinela_agent.ts` lo lee para distinguir error retryable de bloqueo semántico.
- **Para agregar un agente nuevo**: hash → idempotencia → insertAgentRun → markRunning → lógica → validateXxxOutput → completeRun/failRun. Ver `tributario_agent.ts` como plantilla.

### Worker — Primera Categoría & F29 Block
- **F29 Activity Check**: After detecting `categoria === 'primera'` from the Carpeta Tributaria, the worker calls `detectF29ActivityLast24Months(tributariaLocalPath, logger)` from `pdf_analyzer.ts`. If activity is found, it inserts an `automation_alerts` record (`alert_type: 'blocked'`), sets the job status to `'blocked'`, and throws `BlockedError` — which breaks the retry loop without overwriting the status to `'failed'`.
- **`BlockedError`**: Dedicated error class in `worker.ts`. Treated identically to `CredentialError` in the retry guard (`if (isValidationError || isBlockedError) break`). Do NOT use a generic `Error` for this case — it would overwrite the `blocked` status with `failed`.

### Step 3 — Resilience Pattern (`withRetry`)
All critical Playwright operations in `step3_acreedores.ts` are wrapped in `withRetry<T>(fn, opts)` with linear back-off:

| Operation | Attempts | Delay |
|-----------|----------|-------|
| CMF upload | 3 | 4s/8s |
| Catalog fetch (Supabase) | 3 | 3s/6s |
| Each document download | 3 | 2s/4s/6s |
| Add empresa/persona | 3 | 4s/8s |
| Attach document | 2 | 3s |
| `#btnContinuar` (prod) | 3 | 4s/8s |

**Idempotency**: Before each retry of an add operation, `isCreditorAlreadyInTable` checks if the creditor row (matched by `monto`) already exists in the table — prevents duplicates from partial successes.

**Page recovery**: `ensureOnAcreedoresPage` checks the current URL before each add attempt. If it drifted (unexpected redirect), it navigates back to `verAcreedores`. If it hit a login/ClaveÚnica page, it throws "Sesión expirada" immediately.

---

## Supabase Database — Supabase de Producción

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
| `estado` | Estado del caso (`activo`, etc.). |
| `drive_link` | Link a la carpeta Google Drive del cliente con sus documentos. |

#### `renegociacion_overrides` (CRÍTICA — credenciales y datos de automatización)
Almacena las credenciales de acceso del cliente y todos los datos estructurados que alimentan la automatización. **Siempre consultar antes de ejecutar cualquier script.**

| Campo | Descripción |
|-------|-------------|
| `airtable_id` | PK. Enlaza con `v_casos_renegociacion`. |
| `airtable_clave_unica` | **ClaveÚnica del cliente** — usada en `login.ts` para autenticar en Superir y SII. |
| `airtable_clave_ct` | **Clave Tributaria del cliente** — usada para acceder al SII. |
| `clave_cu_override` / `clave_ct_override` | Sobrescritura manual de credenciales si difieren de Airtable. |
| `cmf_deudas_json` | JSON estructurado con las deudas CMF del cliente. Fuente para el Paso 3 (Acreedores). |
| `sii_agente_json` | Datos del Agente Retenedor SII (empleadores, ingresos). Fuente para el Paso 5 (Ingresos). |

#### `mac_mini_jobs` (COLA DE TRABAJOS — robot descargador del SII)
> ⚠️ **OJO:** Esta tabla **NO** pertenece a nuestra automatización del portal Superir. Es la cola de un **robot separado de descarga de documentos del SII** (Servicio de Impuestos Internos) que corre en el Mac Mini. **No registra ni ejecuta el proceso de renegociación.**

#### `acreedores_canonicos` (PASO 3 Normalización)
Catálogo maestro de acreedores. Cada acreedor tiene un `nombre` y un `nombre_normalizado`, usados para normalizar los nombres extraídos del CMF antes de ingresarlos en el portal Superir (Paso 3).

#### `client_documents` (PASO 3 — Acreditaciones de Deuda)
Tabla de documentos de acreditación por cliente, usada por el **Orquestador Cognitivo**. Migrada desde el campo JSONB `acreditacion_documentos_json` de la tabla `clients`.

| Campo | Descripción |
|-------|-------------|
| `id` | UUID de la fila |
| `client_id` | FK → `clients.id` |
| `document_type` | Código numérico del tipo (22=monto, 23=vencimiento, 24=genérico) |
| `acreditacion_tipo` | `'monto'`, `'vencimiento'`, o `'general'` |
| `institucion_cmf` | Nombre de la institución según el CMF (ej. `'Banco Estado'`) |
| `storage_path` | Ruta en Supabase Storage (`documentos` bucket) |
| `filename` | Nombre del archivo (ej. `cert_bci.pdf`) |
| `uploaded_at` | ISO timestamp de cuando se subió el archivo |

**Nota:** La tabla `client_documents` se consulta en el sandbox. El bucket `documentos` contiene las 4 categorías de archivos del cliente (CMF, carpeta tributaria, agentes retenedores, certificados de acreditación).

---

## Cognitive Orchestrator — Mente Pensante

`src/utils/cognitive_orchestrator.ts` es el módulo de IA que audita los documentos de acreditación **antes** de que el Paso 3 los adjunte al portal.

### Función principal
```typescript
runCognitiveOrchestrator(client, cmfLocalPath, supabase, logger): Promise<OrchestrationResult>
```

### Flujo
1. Verifica que `ANTHROPIC_API_KEY` esté en `.env`.
2. Descarga cada certificado desde `client_documents` → Supabase Storage → `outputs/acreditaciones_tmp/`.
3. Extrae texto (hasta 12,000 chars/cert, 15,000 chars/CMF) vía `extractTextFromPdf`.
4. Llama a `claude-sonnet-4-5-20250929` con **thinking activado** (`budget_tokens: 2048`).
5. Parsea el bloque `<json>...</json>` de la respuesta.
6. Retorna `OrchestrationResult` con `status`, `alerts`, `documentMapping` y `mappedDocs` (listos para Playwright).

### Reglas de Auditoría
- **Regla 1 (30 días)**: CMF y certificados no pueden tener más de 30 días de antigüedad. Devuelve `expired_cmf` o `expired_certificate` si se violan.
- **Regla 2 (Art 260/261)**: Deudas con morosidad ≥90 días requieren `monto` + `vencimiento`. Deudas al día solo requieren `monto`.
- **Regla 3 (Mapeo)**: Asocia certificados a acreedores del CMF por nombre de institución.
- **Regla 4 (RUT)**: Valida el RUT del emisor del certificado. Devuelve `rut_mismatch` (bloqueante) si el RUT del certificado no corresponde al banco asignado.

### Arquitectura de validación: TS determinista → Claude corrobora
El orquestador corre **primero** un pre-análisis local en TypeScript (`localAnalysis`) que calcula determinísticamente: requisitos de sesión (90 días / 80 UF), antigüedad de CMF y de cada certificado de **texto**, presencia de monto+vencimiento por acreedor (`cumpleRequisitosAcreditacion`), y el **pre-chequeo de RUT** (`rutCheck` / `rutCheckTypeScript` por certificado). Ese reporte estructurado (lo correcto **y** lo incorrecto) se inyecta en el prompt y **Claude actúa como segunda línea de control**, corroborándolo contra el texto/imágenes y decidiendo `status` final.
- Los documentos **imagen** (escaneados, 0 caracteres) NO pueden analizarse por TS → se marcan "Claude debe verificar" (fecha y RUT). No generan falsos positivos.
- **Pre-chequeo de RUT determinista**: por cada certificado de texto, `computeRutCheck` extrae los RUTs (`extractRutsFromText`), busca el banco real en el catálogo (`findCatalogEntryByRut`) y lo compara con el banco que el abogado asignó (`institucion_cmf`). Si difieren, marca `rutMismatch: true` y sugiere el banco correcto; Claude lo corrobora y emite `rut_mismatch`. Resuelve el caso "el abogado asigna 'Banco Santander' pero el certificado es de 'Santander Consumer'".
- **`extractRutsFromText` / `findCatalogEntryByRut`** viven en `acreedor_matcher.ts` (fuente única de verdad) y son reusados por `step3_acreedores.ts` (`detectCreditorRutFromDoc`).
- **`BYPASS_DATE_CHECK=true`** (o `BYPASS_DATE_VALIDATION=true`): omite SOLO las alertas de antigüedad (`expired_cmf` / `expired_certificate`) para pruebas mecánicas. NUNCA omite alertas estructurales (`missing_document`, `rut_mismatch`, `amount_mismatch`).

### Configuración requerida en `.env`
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```
**Nunca hardcodear ni commitear esta clave.**

---

## Dashboard — Carga de Documentos (repo `dashboard_rene/rp_renegociaciones`)

Vista del abogado (`/subir-caso`, label "Carga de Documentos") para adjuntar documentos a un cliente **que ya existe** en Supabase con sus datos personales. **No** crea ni edita datos personales.
- **`GET /api/subir-caso?rut=`**: confirma que el cliente existe y devuelve su nombre + `has_cmf`.
- **`POST /api/subir-caso`** (multipart): requiere solo `rut`; **404** si el cliente no existe. Reemplaza los certificados anteriores, sube el CMF (opcional, conserva el existente si no se adjunta) y los certificados, llena `client_documents` (tipo 22=monto, 23=vencimiento), actualiza `acreditacion_documentos_json`, y reencola un job (`step: 1`, `dry_run: true`). Errores de inserción NO se silencian (limpia huérfanos y retorna error).
- **`GET /api/acreedores`**: catálogo `acreedores_canonicos` (cap subido a 1000 para que carguen los ~501 activos).
- El form tiene 3 áreas: **CMF**, **Certificados de Deuda (monto)**, **Certificados de Vencimiento**; cada certificado lleva su banco (selector con autocompletado). Selector de archivo con botón claro ("Seleccionar archivo" → "Cambiar archivo" + nombre del archivo).
- El worker consume estos documentos: descarga el CMF vía `informe_cmf_path` y los certificados vía `client_documents`. Para un run completo 1→4 el cliente además necesita `carpeta_tributaria_path` y `carpeta_retenedores_path` (que el dashboard NO sube).

---

## Flujo de datos para la automatización Superir

Nuestra automatización del portal **lee** de producción (read-only) y ejecuta/registra todo en el sandbox. En fase de prueba, la cola propia es `pato_prueba_automation_jobs` en el sandbox.

```
[PROD, read-only]
  v_casos_renegociacion      → obtener rut, nombre, t0, estado
  renegociacion_overrides    → obtener clave_unica (just-in-time), clave_ct, cmf_deudas_json, sii_agente_json

[SANDBOX]
  pato_prueba_automation_jobs (INSERT) → encolar job de automatización (client_id + step)
  [Mac Mini ejecuta Playwright]        → login.ts → step1_personal.ts → step2_declaraciones.ts
  pato_prueba_automation_jobs (UPDATE) → escribir status/error/screenshot/logs al completar
```

---

## Session Initialization (Mandatory)

At the beginning of every session, you MUST immediately read:
- [task.md](file://./task.md) to review completed and pending tasks.
- [CLAUDE.md](file://./CLAUDE.md) to align on the architecture and active tables.
- [.claude/skills/renegociacion-automation/SKILL.md](file://./.claude/skills/renegociacion-automation/SKILL.md) to align on the automation rules.

## Skill Activation

Before implementing ANY task, check if relevant skills apply:
- Modifying automation scripts → `renegociacion-automation` skill
- Working with Supabase / Database → `supabase` skill

## Common Commands

```bash
# Run automation for a specific step
npm run automate -- --rut=12345678-9 --step=2

# Start the worker daemon
npm run worker

# Compile TypeScript
npm run build

# Test Paso 3 hardcodeado (sin job queue ni créditos de API) — caso Claudia Silva
BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/claudia_silva/test_step3.ts

# Test Paso 3 hardcodeado — caso Alejandra Espinoza (incluye acreedores NO-CMF: 2 tarjetas BdCh)
BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_step3.ts

# Test del Centinela aislado (DETECCIÓN no-CMF) — GASTA créditos de Claude (API #1)
ENABLE_SENTINEL=true BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_reconciliacion.ts

# Setup de un caso nuevo (perfil + CMF) y carga de certificados a client_documents
npx ts-node -r dotenv/config casos/alejandra_espinoza/setup_test.ts
npx ts-node -r dotenv/config casos/alejandra_espinoza/upload_documents.ts

# 🧹 LIMPIEZA TOTAL del borrador en el portal (correr ANTES de re-testear el flujo real)
# Borra archivos del Paso 2 y acreedores + CMF del Paso 3 de la solicitud. Login con ClaveÚnica.
npx ts-node -r dotenv/config src/utils/limpieza_total.ts
# Para otro cliente: CLAVE_UNICA_RUT=12345678-9 npx ts-node -r dotenv/config src/utils/limpieza_total.ts

# Inspect the verAcreedores page for HTML IDs (run while portal session is active)
npx ts-node -r dotenv/config src/utils/inspect_otros_acreedores.ts
```
