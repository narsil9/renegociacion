# Renegociación Superintendencia - Automation Project

This repository contains the hybrid automation system for filling out the renegotiation request portal at the Superintendencia de Insolvencia y Reemprendimiento (Superir) in Chile. It is designed for lawyers working on debt/bankruptcy cases to trigger step-by-step automation fragments while maintaining human-in-the-loop validation and manual control.

## ⭐ PERMANENT GOVERNING RULE — General solutions, never per-case patches

> **Applies EVERY TIME we fix a problem in the renegotiation request automation. This is the highest-priority rule: it overrides any shortcut.**

Whenever a problem appears, the solution must aim to **fix the category of problem that can recur across other clients**, not the specific symptom of the case in front of us.

- **Identify the underlying problem**, not client X's symptom. The concrete case is only the **witness** that reveals the general problem and serves to **validate** the solution.
- **Build deterministic logic/rules** that work for the **majority of clients**, not shortcuts that fix a single client.
- **NEVER hardcode the specific case.** Rules like "if it's Itaú / this bank / this RUT, do X" are forbidden. Instead, write a general rule that applies to any institution/client in that same situation (e.g. the amount was anchored to the CMF via a general rule, **not** by naming Itaú).
- **When in doubt, generalize.** If a solution only works for this case, it is incomplete: redesign it until it covers the whole family of cases.

This is consistent with the principles already established in this file (see *"El LLM no decide la estructura"* and the Step 3 deterministic backstops): **the LLM extracts facts from messy documents; TypeScript shields the structure with deterministic, general logic.**

## Quick Facts

- **Stack**: Node.js, TypeScript, Playwright, Ghostscript (PDF compression), Supabase (Client Data & Cookie Sharing), Anthropic SDK (`@anthropic-ai/sdk` — Cognitive Orchestrator / Mente Pensante)
- **Runtime Environment**: Mac Mini (Headless Server)
- **Start / Run Command**: `npm run automate -- --rut=<RUT> --step=<STEP_NUMBER>`
- **Worker Command**: `npm run worker`
- **Build Command**: `npm run build`
- **Test Command**: `npm test`

## 🟢 Encender el sistema (worker / daemon)

> Cuando el usuario diga **"enciende el sistema"** (o "prende el worker / el daemon"), ejecutá en la terminal:
> ```bash
> bash scripts/sistema.sh start
> ```

El **worker es el daemon** (un solo proceso): pollea la cola `automation_jobs` cada 5s y, por cada job, corre la cadena de agentes + Playwright Pasos 1→4 contra el portal Superir. **Si el worker no está corriendo, los casos cargados desde el dashboard quedan en `pending` y no pasa nada.** Por eso debe quedar SIEMPRE encendido.

`scripts/sistema.sh` es **portátil** (este Mac u otra máquina con Node + el repo + `.env`). Hace, de forma idempotente: `npm install` si falta, `npx playwright install chromium`, valida que exista `.env`, y arranca el worker — con **pm2** si está instalado (auto-restart + arranque al boot), o con `nohup` en background si no.

| Acción | Comando |
|---|---|
| Encender | `bash scripts/sistema.sh start` |
| Ver estado / log | `bash scripts/sistema.sh status` |
| Seguir el log en vivo | `bash scripts/sistema.sh logs` |
| Apagar | `bash scripts/sistema.sh stop` |
| Arranque al bootear (Mac Mini, 1 vez) | `pm2 startup` (seguir la instrucción que imprime) |

**Requisitos en la máquina** (one-time): Node + npm; el repo clonado; un `.env` con `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `HEADLESS=true`. **NO** poner `BYPASS_DATE_CHECK` ni `DISABLE_SENTINEL=true` en producción. La máquina debe estar encendida, sin dormir y con internet (Superir + Supabase + Anthropic). El dashboard (input) vive en Vercel y está siempre on — no se enciende acá. Cada cliente trae su propia ClaveÚnica en la tabla `clients` (la carga el dashboard); `CLAVE_UNICA_PASSWORD` del `.env` es solo para el cliente de prueba `21917363-6`.

## Key Directories

- `src/automation/` - Step-specific Playwright scripts (`login.ts`, `step1_personal.ts`, `step2_declaraciones.ts`, `step3_acreedores.ts`, `step4_apoderado.ts`, `all_steps.ts`)
- `src/utils/` - Utility functions (browser controllers, logger, Supabase clients, PDF optimizer/analyzer, acreedor_matcher, cmf_analyzer, **cognitive_orchestrator**, date_helper, sentinel)
- `src/agents/` - Cadena multi-agente: `types.ts`, `agent_runs.ts`, `validator.ts`, `tributario_agent.ts`, `centinela_agent.ts`, `mapeador_agent.ts`
- `outputs/` - Screenshots, HTML snapshots, and log files of successful/failed automation steps
- `outputs/acreditaciones_tmp/` - Temporary local copies of downloaded certificate PDFs (used by cognitive_orchestrator)
- `tools/` - **Scripts dev/diagnóstico/one-off — NO producción.** (inspect_*, check_*, migrate_*, run_*, upload_*, el CLI legacy `index.ts`, etc.) Fuera del build de producción. Los `*_*` con prefijo de diagnóstico están gitignored.

> ### ⚙️ Superficie de PRODUCCIÓN (qué corre en el robot)
> El único entry de producción es **`src/worker.ts`** (daemon). Su grafo de imports = lo que corre en producción: `src/worker.ts` + `src/automation/*` + `src/agents/*` + 15 módulos de `src/utils/` (acreedor_matcher, alerts, browser, cert_institution_resolver, cert_line_items, cmf_analyzer, cognitive_orchestrator, date_helper, deterministic_mapeador, logger, ocr_helper, pdf_analyzer, pdf_optimizer, sentinel, supabaseWorker).
> **`src/` contiene SOLO producción.** Todo lo de prueba/dev vive en `tools/` (scripts sueltos) y `casos/` (tests por cliente).
> Build production-only: **`npm run build:prod`** (`tsconfig.build.json`, compila solo el grafo del worker → `dist/`). Deploy: ship `dist/`. El daemon: `bash scripts/sistema.sh start`.

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
- **Database Safety / Sandbox-como-producción**: El sistema opera HOY sobre el proyecto Supabase **sandbox (`fnz…`)** como si fuera producción. El worker usa las tablas `clients` y `automation_jobs` del sandbox (las viejas `pato_prueba_*` quedaron **obsoletas**, no se usan). **NUNCA** crear, escribir ni importar datos del proyecto del abogado (`ton…`); solo se lee de prod (read-only) para credenciales cuando un cliente tiene `airtable_id` (hoy no aplica: los clientes nuevos llevan su ClaveÚnica propia en `clients.clave_unica_password`).

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
- **⚖️ Regla DECISIVA 260 vs 261 (abogado, 2026-06-23)**: una deuda 90+d va a **Obligaciones 260 SOLO si se acredita MONTO Y VENCIMIENTO**. Si no se puede acreditar el vencimiento → **Art. 261** (solo monto). El flag "90+d" del CMF NO basta por sí solo. Implementado como **backstop determinista** en `sentinel.ts` (no depende del LLM): un acreedor CMF con `overdue90Days>0` que no tenga `cmf260DirectOverride` con fecha (ni reclasificación) se **degrada a 261** con su monto + alerta `needs_review`. El robot declara en 260 TODA deuda acreditable (más completo que el abogado, que suele dejar solo 2 en 260 por atajo).
- **Obligaciones 260** (`#btnAgregarEmpresa` / `#btnAgregarPersona`): Creditors where (`overdue90Days > 0` **OR** reclassified `reclassifiedCreditors`) **AND NOT** de-reclassified to 261 (`deReclassified261Creditors`, REGLA 10) **AND** with an accreditable vencimiento.
- **Otros Acreedores** (`#btnAgregarEmpresa2` / `#btnAgregarPersona2`): Creditors where `overdue90Days === 0` AND not reclassified, **OR** de-reclassified 260→261, **OR** degraded by the backstop (90+d sin vencimiento acreditable). Both sections share the same modals — the distinction is which button opens them.
- **REGLA 10 — de-reclasificación 260→261**: el CMF puede estar desactualizado; si el cert certifica la deuda **vigente** ("Certificado de Deudas Vigentes"), se declara 261 aunque el CMF la marque 90+d (`DeReclassified261Creditor[]`). Caso testigo: Banco Estado de Néctor.
- **Chat/WhatsApp solo acredita VENCIMIENTO**: un chat de cobranza (detección por CONTENIDO vía `isChatDocument`, no por filename) NO crea acreedor ni aporta monto — solo la fecha/días de mora de productos ya existentes (rescate Chat→260). El monto SIEMPRE del certificado formal. Caso testigo: Falabella+CMR de Néctor.
- **`isOtros` invariant**: `(creditor.overdue90Days === 0 && !isReclassifiedTo260(creditor)) || isDeReclassifiedTo261(creditor)`. This value is computed once and passed explicitly to `addEmpresaAcreedor`, `addPersonaAcreedor`, and `attachDocumentoAcreedor`. **Never recompute from `overdue90Days` alone inside those functions** — the CMF cut date can lag the bank documents by weeks, causing multi-million CLP gaps.
- **Sentinel name matching**: Only institution name is used (no monto tolerance). CMF dates and bank document dates differ — the same loan can appear as $38.9M in CMF and $48.2M in the bank's report.

### Step 3 — Acreedores NO-CMF (reconciliación)
Algunas deudas reales NO aparecen en el Informe CMF pero igual deben declararse (Art. 261 obliga a declarar todos los pasivos): TGR, cajas de compensación, fintechs (Mercado Pago, Tenpo), tarjetas no reportadas, deudas castigadas. El **Centinela** (`sentinel.ts`) las detecta vía **reconciliación documentos − CMF**:
- **Pre-pase determinista (TS)**: por cada documento, `extractRutsFromText` + match contra los acreedores del CMF (por RUT primero, luego por nombre). Marca `issuerInCmf` en `nonCmfReconciliation` (parte de `localAnalysis`).
- **Claude (API #1) confirma/extrae**: decide qué documento es un acreedor NO-CMF a declarar y lo clasifica 260/261. El caso "mismo banco, producto distinto" (tarjeta BdCh vs. consumo BdCh) lo resuelve Claude, no el pre-pase. Devuelve `additionalCreditors[]` (interfaz `AdditionalCreditor`, con `needs_lawyer_confirmation: true`).
- **Flujo**: `worker.ts` captura `_sentinelAdditional` → `runCognitiveOrchestrator(..., sentinelAdditional)` genera los `AcreditacionDoc` de los no-CMF (261→tipo 22, 260→tipo 24) → `fillStep3(..., additionalCreditors)` los ingresa tras la Fase 1 (`isOtros = categoria_articulo === 261`).
- **Matching documento↔acreedor por `filename`**: los acreedores NO-CMF asocian su certificado por `AcreditacionDoc.filename` exacto (no por institución), y los del CMF **excluyen** los filenames reservados a NO-CMF. Esto evita el cruce cuando hay varios productos del mismo banco. **El orquestador debe poblar `AcreditacionDoc.filename`** (lo hace) para que el match funcione en producción.
- **Fechas clave** (`FechaClave[]` en `SentinelResult`, determinista, no bloqueante): expiración CMF/certificados (+30d) y cruce 261→260 (+91d).

### Step 3 — Backstop determinista de completitud (el LLM NO decide la estructura)
**Principio (2026-06-23):** el LLM (Centinela) es no-determinista; entre corridas nombra distinto las instituciones y reparte distinto los productos entre `identified261`/`additionalCreditors`. La **estructura** (clasificación, mapeo cert↔CMF, nombres, split) es **determinista dada los hechos** y NO debe depender del LLM. El LLM extrae hechos de documentos messy; TypeScript blinda la estructura con backstops. Implementado en `sentinel.ts` (tras la respuesta del LLM) y `acreedor_matcher.ts`:
- **`src/utils/cert_line_items.ts`** — `extractCertLineItems(text)` extrae (operación, monto, etiqueta) de cualquier cert. 2 detectores generales y CONSERVADORES: (1) línea con etiqueta de **payoff inequívoca** ("Saldo Deuda/Insoluto/Total a Pagar", "Costo Total del/Monetario Prepago"); (2) tabla de **Certificado de Liquidación/portabilidad** (Nº Operación + monto). Excluye cupo/autorizado/aprobado/**facturado del mes**/no-vencido/indirecta (cero falsos positivos).
- **Backstop de completitud**: por cada cert (texto vía `-layout`, imagen vía OCR), agrega los ítems que el LLM OMITIÓ — override de monto si el banco tiene fila CMF sin reclamar, o NO-CMF si es solo-en-cert. Aditivo. Resuelve **BCI cuenta corriente $615** y **BancoEstado línea $389.848** sin depender del LLM.
- **`canonicalInstitutionKey` quita sufijos "— descriptor" + paréntesis** antes del alias: el LLM escribe "Banco de Chile — Tarjeta de crédito (*2949)" → "banco de chile". Sin romper "Santander-Chile" (requiere guión rodeado de espacios).
- **Reconciliación `additional`→`identified261`**: un producto del CMF mal puesto en `additionalCreditors` por el LLM, cuyo monto cae cerca (≤30% o ≤$500k) de una fila CMF del mismo banco sin reclamar, se mueve a override (evita doble conteo: fila CMF + fila NO-CMF). NO-CMF genuino (CCAF/TGR, o banco con todas sus filas reclamadas) queda como additional.
- **`isCovered` por `document_filename`**: "ya cubierto por el LLM" se decide primero por filename + monto (robusto a cómo nombre la institución), fallback al banco canónico. Evita duplicar un producto que el LLM sí emitió.
- **Aliases de nombre largo de CCAF**: el CMF escribe "Caja de Compensación de **Asignación Familiar** <X>"; sin alias, una CCAF del CMF se SALTA en el Paso 3. Cubiertos Los Andes / 18 de Septiembre / Gabriela Mistral / Los Héroes / La Araucana → "CCAF <X>".

### Step 3 — Alertas al dashboard de acreedores no declarados
`fillStep3` devuelve `Step3Report { added[], skipped[] }`; `fillAllSteps` lo propaga (`Promise<Step3Report|undefined>`) y **`worker.ts` emite una `automation_alert` (`alert_type:'needs_review'`, step 3) consolidada** listando cada acreedor que el Paso 3 NO pudo declarar (sin match en `acreedores_canonicos` sin RUT, comuna del catálogo sin región, cert faltante, etc.). Es **informativo** (no bloquea ni marca `failed`; el borrador igual queda cargado) → el abogado lo ve en el panel `/automatizacion` y carga manual. Aplica a ambos caminos (Paso 3 individual y flujo completo step:0).

### Step 3 — Monto y vencimiento "según el documento" (no del CMF)
El Paso 3 ingresa el **monto del documento de acreditación** (más actual que el CMF, dentro de la tolerancia de $300–500k) y la **fecha real de la cuota impaga** (en vez del placeholder `dateDaysAgo(90)`). Fuentes por tipo de acreedor:
- **Reclasificados** (`reclassifiedCreditors`): `total_credito_clp` + `delinquency_start_date`. Funciona en producción (el worker ya los pasa).
- **No-CMF** (`additionalCreditors`): `total_credito_clp` + `delinquency_start_date` (solo 260). Funciona en producción.
- **260 directos del CMF** (ej. CAT/CMR/Santander): vía `cmfDocumentOverrides?: CmfDocumentOverride[]` (param de `fillStep3`). **Ya funciona en producción**: el Centinela (REGLA 9) extrae `monto_clp` ("Monto total a pagar", NO "Saldo del crédito") + `fecha_vencimiento` (inicio de mora / "Cobranza Judicial iniciada", NO contratación) por producto y los expone en `sentinelResult.cmf260DirectOverrides` → `centinela_agent.ts` los mapea a `cmfDocumentOverrides` → `worker.ts` los pasa a `fillStep3`/`fillAllSteps`.
- **Monto efectivo**: cuando el monto del documento sobrescribe al del CMF, ese valor se propaga a `isCreditorAlreadyInTable` y a `attachDocumentoAcreedor` (que matchean por monto). **Nunca usar `creditor.totalCredito` del CMF directamente si hay override** — la fila quedaría con un monto y el attach buscaría otro.

### Step 3 — Multiproducto (un certificado de liquidación cubre N créditos)
Un certificado de liquidación de un banco puede cubrir VARIOS créditos del mismo deudor (ej. Santander con 3 créditos de consumo). El Centinela emite **un `cmfDocumentOverride` por producto** (sufijo de producto entre paréntesis en `institucion_cmf`, ej. `"Banco Santander-Chile (Consumo 05/06/2025 — Op. ...)"`). `step3` los agrupa por institución base (`overrideBaseKey`, quita el sufijo); si hay ≥2 → **multiproducto**: se omiten en el loop principal y se crea **una fila 260 por producto** con su "Monto total a pagar" (NO un monto consolidado). **"VARIOS DEUDORES"/"OTROS DEUDORES" SÍ se declaran** (deuda directa del deudor como titular junto a otros — regla del abogado, 2026-06-23); solo se **excluye** la deuda **indirecta** (codeudor/fiador/aval de un *tercero*) y los montos triviales (<1 UF, remanentes/comisiones). ⚠️ El CMF puede partir UN crédito en 2 filas (mora + vigente, misma fecha de otorgamiento) → es un solo crédito, se declara UNA vez al payoff total (no declarar la porción vigente aparte = doble conteo).

### Step 3 — Adjunción Art.260 = tipo 22 + tipo 23 por separado
Los acreedores **Art.260** suben el MISMO certificado **dos veces**: una como "Acredita Monto" (tipo 22) y otra como "Acredita Vencimiento" (tipo 23) — así lo hace el abogado. En `step3_acreedores.ts` la fase de adjunción usa `neededTipos = isOtros ? [22] : [22,23]` y fuerza el `tipo_documento` del `AcreditacionDoc` base (que puede venir como 24) a cada tipo necesario. Los **Art.261** suben solo tipo 22 (Monto). `attachDocumentoAcreedor` distingue por el texto del tipo ("monto" vs "vencimiento"), así ambos adjuntos conviven sin pisarse.

### Step 3 — Auto-asociación cert→acreedor por RUT (`cert_institution_resolver.ts`)
Antes del Centinela, `resolveCertInstitutions(supabase, client, logger)` deriva el `institucion_cmf` de cada `client_document` por **RUT** (descarga el PDF → `pdftotext` → `extractRutsFromText` → `findCatalogEntryByRut`), con fallback por keyword del filename (`FILENAME_KEYWORDS` → `matchAcreedor`). Persiste el nombre canónico en `client_documents.institucion_cmf`. El dashboard ya **no exige** que el abogado elija el banco. `deterministic_mapeador` propaga ese nombre a `AcreditacionDoc.catalogInstitucion`, que `step3` usa como **fallback** para hallar el RUT cuando el nombre CMF/Centinela no matchea el catálogo (ej. "Tenpo Payments" vs "Tenpo Prepago"). Los NO-CMF cuyo RUT no aparece en el documento (ej. La Polar, cuyo cert solo imprime el RUT del administrador) los identifica el Centinela por contenido.

### Agente Tributario — Contribuciones (Impuesto Territorial)
- **Función**: `detectContribucionesDeuda(pdfPath, logger)` en `src/utils/pdf_analyzer.ts`. Usa `pdftotext -layout` para preservar columnas.
- **Regla**: sección "Propiedades y Bienes Raíces" de la CT → filas con `Condición = AFECTO` **Y** `Cuotas vencidas por pagar = SI` → contribuciones morosas.
- **Destino**: si la keyword no aparece en la línea (multi-línea en PDF), infiere del prefijo del Rol (BD→Bodega/Almacenaje, DP→Departamento, LC→Local Comercial, etc.).
- **Output**: `TributarioOutput.contribuciones_deuda?: ContribucionProperty[]`. Si hay propiedades morosas, `validateTributarioOutput` emite `needsLawyerReview = true`.
- **Monto**: el monto **NO** está en la CT — el abogado debe obtener el Certificado de Deuda TGR y cargarlo como acreedor no-CMF (similar a William Montero).
- ✅ **Validado con CT de formato 2024 Y nuevo formato 2026** — El nuevo formato incluye la sección F22 (Declaraciones de Renta) DESPUÉS de F29, con referencias de fecha como `04/2026` que causaban falsos positivos. Fix: `detectF29ActivityLast24Months` trunca `f29Section` en el límite de F22 (regex `Declaraciones de Renta.*Formulario 22`). Adicionalmente, el nuevo formato lista los 36 períodos F29 siempre, incluso vacíos (`"No se registra declaración para este período."`) — se ignoran con un `NO_DECLARATION_PHRASE` check en el contexto post-match. `analyzeTaxCategory` también excluye texto post-F22 para evitar que etiquetas del formulario como "CRÉDITO POR IMPUESTO DE PRIMERA CATEGORÍA" generen falsos positivos de categoría.

### Step 3 — Requisito de sesión (Art. 260 / 80 UF)
Para que el cliente pueda iniciar una sesión de renegociación deben cumplirse **dos condiciones simultáneas**:

1. **Mínimo 2 productos con mora > 90 días (≥ 91 días)**: Al menos dos líneas de crédito distintas deben tener valor > 0 en la columna "90 o más días de atraso" del CMF. Los dos productos **pueden ser del mismo banco** (por ejemplo, un crédito de consumo y una tarjeta de crédito de Banco Estado).
2. **Suma de `totalCredito` ≥ 80 UF (~$3.253.000 CLP)**: Se suman los campos `totalCredito` de esos productos (no el monto atrasado). Si el CMF no alcanza el umbral, se deben revisar documentos adicionales.

**Chequeo "mínimo 2 productos" (implementado en `worker.ts`)**: el worker cuenta `totalQualifyingCount = productos CMF con 90+d + reclasificados por el Centinela + NO-CMF Art.260`. Si `< 2`, el cliente **no califica**: en un Paso 3 individual el job queda `status='blocked'` (no `failed` — reintentar no resuelve un requisito de fondo) con `automation_alert` (`blocked`) + `error_message` legible para el panel del dashboard; en el flujo completo (step:0) se **omite solo el Paso 3** y se guardan los Pasos 1, 2 y 4, con la alerta registrada. La condición **2 (80 UF)** sí es **no bloqueante** (solo `⚠️ ADVERTENCIA`); el abogado debe confirmarla antes de presentar.

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
- **Segunda Categoría (boletas de honorarios) NO bloquea**: Las boletas de honorarios no son impedimento legal para la renegociación. Se declaran como ingreso en el **Paso 5**: sumar los montos de boletas emitidas en los últimos 6 meses y dividir por 6 → ingreso mensual declarado. El único bloqueo tributario es `categoria === 'primera'` con actividad real en F29 en los últimos 24 meses.
- **El Centinela corre por defecto**: A partir de 2026-06-18, el Centinela se ejecuta siempre en el worker. Para desactivarlo (sin detección NO-CMF, sin gasto de créditos API) usar `DISABLE_SENTINEL=true` en `.env`. **NO usar `DISABLE_SENTINEL=true` en producción** — los acreedores NO-CMF (TGR, cajas, fintechs, tarjetas no reportadas) quedarían sin declarar.
- **Datos personales en `clients` deben usar valores exactos del portal**: `selectBootstrap` en `step1_personal.ts` usa `locator.selectOption(value)` que requiere el atributo `value` exacto del `<option>`. Texto libre o etiquetas descriptivas causan timeout de 60s. Valores conocidos: `estado_civil='1'` (Soltero/a), `region='Región Metropolitana'` (value=13), `comuna='LO BARNECHEA'` (uppercase, value=293), `profesion_oficio='Administrativos'` (value=4), `ocupacion='Trabajador/a dependiente'` (value=13). Para descubrir valores desconocidos: revisar el HTML dump en `outputs/failure_step1_*.html`.

### Worker — Gate del abogado (`pending_review` + reanudación)
Cuando el Paso 3 produce señales que requieren revisión humana (acreedores NO-CMF a confirmar, `amount_mismatch` del Mapeador), el worker se comporta distinto según el modo del job:
- **Run real (`dry_run === false`) sin confirmar**: marca el job `status='pending_review'` + `needs_lawyer_review=true`, inserta una `automation_alert` (`alert_type:'needs_review'`) y **NO corre Playwright** (`return` temprano). El abogado debe revisar y re-encolar desde el dashboard.
- **Supervisado (`dry_run`)**: llena el borrador igual (para que el abogado lo revise) y solo marca `needs_lawyer_review=true`.
- **Reanudación**: el dashboard (`/automatizacion`, botón "Confirmar y reanudar" → `POST /api/automatizacion {job_id, action:'resume'}`) hace `status='pending'` + `lawyer_confirmed=true` (idempotente vía `.eq('status','pending_review')`; maneja 23505 del índice de job activo). El poller retoma el job; el worker, al ver `lawyer_confirmed === true` en el gate, **continúa el Paso 3** pese a las señales y limpia `needs_lawyer_review=false` (revisión resuelta).
- **Columna**: `automation_jobs.lawyer_confirmed` (BOOLEAN, default `false`; `supabase/migration_sandbox_v5.sql`). ⚠️ **Esa migración debe correrse en el SQL Editor del sandbox `fnz...`** — sin la columna, el POST de reanudar falla.

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

La base de datos del estudio del Abogado Ricardo Puelma es la fuente de verdad de todos los clientes y casos de renegociación. Se accede vía Supabase con las variables `PROD_SUPABASE_URL` y `PROD_SUPABASE_SERVICE_ROLE_KEY` en el `.env`. Hay **48 tablas** en total; abajo se documentan solo las relevantes para la automatización.

> 🗺️ **Mapa verificado de fuentes:** para saber **a qué tabla/columna/bucket ir por cada dato o documento**, ver **[`docs/integracion/mapa-fuentes-produccion.md`](docs/integracion/mapa-fuentes-produccion.md)** (verificado en vivo contra `ton…`, con columnas reales y cobertura). Re-verificar con `tools/audit_prod_sources.ts`.
> ⚠️ **SOLO LECTURA sobre `ton…`** (SELECT/GET). NUNCA insert/update/delete. La service-role key da acceso total → la disciplina de solo-lectura es nuestra.

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

## 🔗 Integración futura — Convergencia con el dashboard del supervisor

> **Esta es la dirección a la que apunta TODO el desarrollo de aquí en adelante.** El sistema final NO es nuestra automatización aislada: es un **pipeline de dos capas** que converge con el dashboard del supervisor (`rp_renegociaciones-auth-admin`, prod Supabase `tonrzmlrrcnizamtzqte` = `ton…`).

**Arquitectura objetivo:**

```
SU DASHBOARD (rp_renegociaciones-auth-admin, prod Supabase ton…)   ← capa AGUAS ARRIBA (suya)
  agente (Anthropic API, skills + máquina de estados R1–R5, cron 3×/día)
  recopila docs (Gmail/Drive/SII/CMF) → clasifica cert→acreedor → completa checklist
        │
        ▼  "Cliente listo para enviar solicitud a renegociación"   ← gate de él
        │  [ Ejecutar ]  (el abogado aprieta el botón = encola un job)
        ▼
NUESTRO WORKER (daemon Mac Mini)               ← capa AGUAS ABAJO (nuestra)
  toma el job → login ClaveÚnica → Pasos 1→4 en el portal Superir → borrador
```

- **Su dashboard = fuente de verdad + disparador.** Su agente ya hace lo que hoy hace nuestro `rp_carga_documentos` (recopilar y clasificar documentos) — y mejor. Su skill `match-documents` lee cada cert por contenido y extrae institución, nº de operación, monto, fecha y vigencia (30d) → tabla `renegociacion_documento_match`.
- **Nosotros = ejecutor.** Toda la lógica de **declaración en el portal** (260/261, multiproducto, NO-CMF, override de monto, adjunción 22/23, gate de elegibilidad) es nuestra y NO la hace él. Su LLM extrae hechos; nuestro TS blinda la estructura (regla rectora arriba).
- **El botón "Ejecutar" = encolar un job — patrón que él YA tiene.** Su dashboard encola las skills SII a un daemon del Mac Mini vía `mac_mini_jobs`. **Nuestro worker es un daemon hermano**: "Ejecutar" inserta una fila de job que nuestro worker pollea. Es la plomería más simple para conectar.
- **Llave-puente = RUT.** Su `reports.casos_renegociacion` carga `rut` + `airtable_id` juntos (join spine). Nuestra automatización ya keyea por RUT/`client_id`. ⚠️ `renegociacion_audit_pdf.rut_norm` viene SIN puntos/guion → normalizar al cruzar.
- **Contrato de datos**: `contrato-superir-mapeo-inputs.md` (en la raíz) mapea cada input que necesita nuestro robot → dónde vive en `ton…`, con cobertura y brechas.

**Decisiones tomadas (2026-06-27):**
- `rp_carga_documentos` (nuestro dashboard de carga) **se jubila** — era provisional. No invertir más ahí salvo brechas que a él le faltan.
- Lo que NOSOTROS ya resolvimos y le aportamos: **RUT del emisor del cert** (`cert_institution_resolver.ts` — su brecha #5, él solo guarda el nombre); **mapeo a enums del portal** (`portal_select_values.json` — region/estado_civil código/profesión).

**Arquitectura de conexión DECIDIDA (2026-06-27): proyección por-caso on-demand.**
No clonar ni sincronizar todo (evita duplicar PII de ~1.200 casos, ventana de staleness y copiar todos los PDFs). Al ejecutar, un **proyector read-only** de `ton…` materializa **SOLO ese caso** al sandbox (`clients` + `client_documents` + descarga de PDFs por signed URL) → el worker corre **como hoy** (lee del sandbox, sin cambios) → se purga al terminar. **Prod intacto (solo lectura); el worker no cambia.** Plan por etapas y convenciones de prueba en `task.md`. Verificado factible con `tools/spike_case_assembly.ts` (la capa de documentos se arma entera desde `ton…`; las brechas son los datos personales del Paso 1).

**Pendientes / decisiones abiertas:**
1. **Fuente de `fecha_nacimiento`** (vacía en `core.persona`, obligatoria en el Paso 1) + `region`/`ocupacion`. Bloqueante real para un envío. *(En pruebas se inventa un placeholder.)*
2. El gate "cliente listo" de él **debe codificar NUESTRAS precondiciones del portal** (≥2 deudas 90+d, ≥80 UF, sin Primera Categoría F29, CMF/certs <30d, certs presentes) o el botón rebotará en nuestro worker (juez final).
3. **Mecanismo de trigger** del botón "Ejecutar" → job (su patrón `mac_mini_jobs` o tabla nueva). Etapa 3, con el supervisor.

> **Implicación práctica para cada sesión nueva:** al mejorar la automatización, pensá el cambio en función de este encaje (el worker como ejecutor disparado por un job, con el input viniendo eventualmente de `ton…` por RUT).

---

## Dashboard del abogado — repo `rp_carga_documentos` (Next.js 16, separado) — ⚠️ TRANSITORIO (se jubila)

> **Estado (2026-06-27):** este dashboard fue el **input provisional** mientras no existía la conexión con el dashboard del supervisor. Su función (recopilar y clasificar la carpeta del cliente) la cubre el agente del dashboard del supervisor. **Se jubila** cuando se concrete la integración (ver sección anterior). Sigue documentado porque es lo que corre HOY.

Ubicación: `/Users/patomartini/Desktop/rp_carga_documentos`. Es el **input de producción HOY**: el abogado NO entra a Supabase. Apunta al sandbox `fnz…` (`lib/supabase.ts`). Tiene dos vistas:

### Vista "Datos Personales" (`app/datos-personales/`)
Crea/edita la fila del cliente en `clients` con los mismos `<select>` del portal (Paso 1).
- **`GET /api/datos-personales?rut=`**: trae la fila para precargar (match por `rut.ilike`, case/puntos-insensible).
- **`POST /api/datos-personales`**: valida contra los enums del portal y hace **upsert** en `clients`. Opcional `enqueue` → encola `automation_jobs` (idempotente: reusa job `pending`/`running`).
- **Convención de valores** (validada con Cinthia, que corrió 1→4): `estado_civil` = **value** (`'1'`..`'7'`, el worker decide casado por `=== '2'`); `profesion_oficio`/`ocupacion`/`region`/`comuna` = **label exacto** (comuna en MAYÚSCULA). `selectBootstrap` matchea por value O label. Enums en `lib/portal_select_values.json` (copia de `supabase/portal_select_values.json`).
- ⚠️ **Régimen patrimonial**: opciones provisionales (sin verificar contra el portal) — pendiente un dump de cliente casado. **Comunas**: solo RM cargadas; otras regiones caen a texto libre.

### Vista "Cargar Caso" (`app/subir-caso/`)
Sube la carpeta local del cliente y la clasifica.
- **`classify()`** clasifica por **nombre de archivo** (no por ruta): CMF, Carpeta Tributaria, Agentes Retenedores, certificados CMF / NO-CMF. Lo no reconocido se muestra para revisión (no se descarta en silencio).
- **Checklist de requisitos** bloquea la carga si falta el CMF (obligatorio aguas abajo en `worker.ts`).
- **`GET/POST /api/subir-caso`** (`action=init|file|finalize`): sube a Storage (`documentos`, preserva extensión real), llena `client_documents` (tipo 24 general / 22 monto / 23 vencimiento, elegible por certificado), setea `informe_cmf_path`/`carpeta_tributaria_path`/`carpeta_retenedores_path`, y `finalize` encola el job (idempotente). Match de cliente por `rut.ilike`.
- **`GET /api/acreedores`**: catálogo `acreedores_canonicos` (cap 1000).

El worker consume todo esto: CMF vía `informe_cmf_path`, certificados vía `client_documents`, CT vía `carpeta_tributaria_path`, retenedores vía `carpeta_retenedores_path`.

---

## Flujo de datos para la automatización Superir

Sandbox-como-producción: todo el flujo vive en el sandbox `fnz…`. El proyecto del abogado (`ton…`) NO se toca.

```
[Dashboard rp_carga_documentos] (abogado)
  Datos Personales → upsert clients (datos Paso 1 + ClaveÚnica propia)
  Cargar Caso      → Storage `documentos` + client_documents + *_path en clients
                   → INSERT automation_jobs (client_id + step, dry_run)

[SANDBOX fnz… — Mac Mini ejecuta el worker]
  worker.ts toma el job → cadena de agentes (tributario→centinela→mapeador)
                        → Playwright login → step1..step4
  automation_jobs (UPDATE) → status/error/screenshot/logs al completar
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
BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_reconciliacion.ts

# Para saltar el Centinela en tests (sin gasto de créditos API, sin detección NO-CMF)
DISABLE_SENTINEL=true BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_reconciliacion.ts

# Setup de un caso nuevo (perfil + CMF) y carga de certificados a client_documents
npx ts-node -r dotenv/config casos/alejandra_espinoza/setup_test.ts
npx ts-node -r dotenv/config casos/alejandra_espinoza/upload_documents.ts

# 🧹 LIMPIEZA TOTAL del borrador en el portal (correr ANTES de re-testear el flujo real)
# Borra archivos del Paso 2 y acreedores + CMF del Paso 3 de la solicitud. Login con ClaveÚnica.
npx ts-node -r dotenv/config tools/limpieza_total.ts
# Para otro cliente: CLAVE_UNICA_RUT=12345678-9 npx ts-node -r dotenv/config tools/limpieza_total.ts

# Inspect the verAcreedores page for HTML IDs (run while portal session is active)
npx ts-node -r dotenv/config tools/inspect_otros_acreedores.ts
```
