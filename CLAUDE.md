# Renegociación Superintendencia - Automation Project

This repository contains the hybrid automation system for filling out the renegotiation request portal at the Superintendencia de Insolvencia y Reemprendimiento (Superir) in Chile. It is designed for lawyers working on debt/bankruptcy cases to trigger step-by-step automation fragments while maintaining human-in-the-loop validation and manual control.

## Quick Facts

- **Stack**: Node.js, TypeScript, Playwright, Ghostscript (PDF compression), Supabase (Client Data & Cookie Sharing)
- **Runtime Environment**: Mac Mini (Headless Server)
- **Start / Run Command**: `npm run automate -- --rut=<RUT> --step=<STEP_NUMBER>`
- **Worker Command**: `npm run worker`
- **Build Command**: `npm run build`
- **Test Command**: `npm test`

## Key Directories

- `src/automation/` - Step-specific Playwright scripts (`step1_personal.ts`, `step2_declaraciones.ts`, `login.ts`)
- `src/utils/` - Utility functions (browser controllers, cookie handlers, logger, Supabase clients, PDF optimizer)
- `dashboard/` - Next.js Dashboard code (simple portal control panel)
- `outputs/` - Screenshots, HTML snapshots, and log files of successful/failed automation steps

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
- **Step 2 Declarations Mapping**: Determine the tax category from the Carpeta Tributaria PDF text. If `segunda`, check `#calidadPersonaDeudora1`. If `primera`, check `#calidadPersonaDeudora2` and `#inicioActividades1`. In all cases, check `#tipoDeclaracionNotificacionNo`.

### Playwright Stability
- Always wait for script stabilization (`page.waitForTimeout(3000)`) after navigating to a step to allow frontend event handlers to register before clicking delete or upload buttons.

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
```
