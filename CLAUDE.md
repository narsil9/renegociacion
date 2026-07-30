# Renegociación Superintendencia - Automation Project

This repository contains the hybrid automation system for filling out the renegotiation request portal at the Superintendencia de Insolvencia y Reemprendimiento (Superir) in Chile. It is designed for lawyers working on debt/bankruptcy cases to trigger step-by-step automation fragments while maintaining human-in-the-loop validation and manual control.

## 💬 Response Style (ALWAYS)

> The user wants **concise, precise, brief, fast-to-read** answers — to understand quickly and move fast.

- Get to the point: conclusion or action first, no preamble or filler.
- Short sentences. Bullets over long paragraphs.
- Don't explain what they already know or narrate options you won't pursue; give the recommendation, not the inventory.
- Add detail only when the user asks for it or when an action is irreversible.

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
- **Worker Command**: `npm run worker`
- **Build Command**: `npm run build`
- **Test Command**: `npm test` (⚠️ solo Paso 5). La batería determinista del Paso 3 son **28 suites** (al 2026-07-30) y no tiene script: `npx ts-node --transpile-only tools/paso3_validacion/run_all.ts`. Una suite nueva hay que registrarla en el array `TESTS` o no corre.

## 🟢 Encender el sistema (worker / daemon)

> ⚠️ **En el Mac Mini (producción) NO se usa `sistema.sh`.** El proceso real corre bajo pm2 con el
> nombre **`superir-worker`** (`ecosystem.config.js`), y `sistema.sh` usa otro nombre
> (`renegociacion-worker`): su `stop` no lo detiene por pm2 (cae a `pkill` y pm2 lo revive), y su
> `start` no toma la config de producción. En el Mini:
> ```bash
> cd ~/superir-worker && ./deploy.sh     # git pull --ff-only origin main + pm2 restart superir-worker
> pm2 status | pm2 logs superir-worker   # estado y logs
> ```
> `deploy.sh` y `ecosystem.config.js` viven solo en el Mini (untracked).
> *(Follow-up de 2 líneas, sin hacer: que `sistema.sh` resuelva el nombre real de pm2 en vez de
> asumir `renegociacion-worker`.)*

> Para **otra máquina** (este Mac, una nueva), `sistema.sh` sí sirve:
> ```bash
> bash scripts/sistema.sh start
> ```

El **worker es el daemon** (un solo proceso): pollea la cola `automation_jobs` cada 5s y, por cada job, corre la cadena de agentes + Playwright Pasos 1→5 contra el portal Superir. **Si el worker no está corriendo, los casos cargados desde el dashboard quedan en `pending` y no pasa nada.** Por eso debe quedar SIEMPRE encendido.

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

- `src/automation/` - Step-specific Playwright scripts (`login.ts`, `step1_personal.ts`, `step2_declaraciones.ts`, `step3_acreedores.ts`, `step4_apoderado.ts`, `step5_ingresos.ts`, `all_steps.ts`)
- `src/utils/` - Utility functions (browser controllers, logger, Supabase clients, PDF optimizer/analyzer, acreedor_matcher, cmf_analyzer, **cognitive_orchestrator**, date_helper, sentinel)
- `src/agents/` - Cadena multi-agente: `types.ts`, `agent_runs.ts`, `validator.ts`, `tributario_agent.ts`, `centinela_agent.ts`, `mapeador_agent.ts`
- `outputs/` - Screenshots, HTML snapshots, and log files of successful/failed automation steps
- `outputs/acreditaciones_tmp/` - Temporary local copies of downloaded certificate PDFs (used by cognitive_orchestrator)
- `tools/` - **Scripts dev/diagnóstico/one-off — NO producción.** (inspect_*, check_*, migrate_*, run_*, upload_*, el CLI legacy `index.ts`, etc.) Fuera del build de producción. Los `*_*` con prefijo de diagnóstico están gitignored.

> ### ⚙️ Superficie de PRODUCCIÓN (qué corre en el robot)
> El único entry de producción es **`src/worker.ts`** (daemon). Su grafo de imports = lo que corre en producción: `src/worker.ts` + `src/automation/*` (incl. `step5_ingresos.ts`) + `src/agents/*` (incl. `ingresos_agent.ts`) + módulos de `src/utils/` (acreedor_matcher, alerts, browser, calculadora-mora/, cert_institution_resolver, cert_line_items, cmf_analyzer, cognitive_orchestrator, date_helper, deterministic_mapeador, doc_scope, document_reads, income_extractor, logger, pdf_analyzer, pdf_optimizer, sentinel, sentinel_backstops, sentinel_per_doc, supabaseWorker).
> **`src/` contiene SOLO producción.** Todo lo de prueba/dev vive en `tools/` (scripts sueltos) y `casos/` (tests por cliente).
> Build production-only: **`npm run build:prod`** (`tsconfig.build.json`, compila solo el grafo del worker → `dist/`). Deploy: ship `dist/`.
> **El daemon en producción lo maneja pm2, proceso `superir-worker`, con `deploy.sh` en el Mac Mini.** ⚠️ `scripts/sistema.sh` usa otro nombre de proceso y **NO controla producción** — arrancarlo con eso levanta un worker paralelo al que ya corre.

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

### Gotchas verificados contra producción (2026-07-27)
- **`content_hash` mezcla dos largos**: 4.939 filas tienen un prefijo de 16 caracteres y 238 el sha256 completo. Un join contra un hash recién calculado falla en silencio en el 95%.
- **RLS: `setup.sql` miente.** Declara `POLICY FOR ALL TO public` que nunca se aplicó. En prod las tablas del worker tienen RLS activa **sin policies** (= cerradas). El bucket `screenshots` sí es **público**.
- **`uq_active_job_per_client` NO existe en prod**, aunque `superir-proyector.ts:341` atrapa el 23505 como si existiera.
- **El caché de `agent_runs` es "el último run", no un store por llave.** Si el input va A→B→A, volver a A NO es un hit.
- **Re-correr un caso NO re-lee documentos**: `docsSig` no cambia → el Centinela pega en caché y solo se re-ejecuta Playwright. Para forzar lectura: `delete from agent_runs where client_id = …`.
- **La verdad-terreno de los 36 fixtures es sintética** (`ground_truth_source: "derivado"`, la derivó una IA). Mejorar el scorecard puede ser mejorar el acuerdo con otra IA. Los contrastes reales: `oracle_truth.ts` (3 casos) y los conteos de `scorecard.ts`.
- **Las suites verdes no prueban el código que declara en el portal**: `planStep3Rows` y `fillStep3` son la misma lógica dos veces y ya divergió; los golden corren sobre la copia pura. `deep_compare.ts` no está en la batería.
- **El panel se queda atrás rápido** (43 commits en 5 días). `git fetch origin && git log origin/auth-admin` antes de planificar algo que lo toque. `lib/models.ts` es un contrato: debe ser idéntico en los dos repos.

### Error Handling
- NEVER swallow errors silently. Always catch, log via `RunnerLogger`, and update the job status in Supabase.
- Playwright scripts must capture a screenshot upon failure and save the page HTML to the `outputs/` directory.

### Portal State Integrity (Testing & Dry-Runs)
- **Dry Runs**: By default, runs are executed with `DRY_RUN=true`. Under dry runs, do NOT commit/submit forms to proceed to the next step.
- **Auto-Cleanup**: In Step 2, if `DRY_RUN=true`, the script must automatically delete the uploaded files at the end of the test so that subsequent trials start with a clean draft state.
- **Database Safety**: hay **una sola** Supabase (`tonrzmlrrcnizamtzqte`) y es la del estudio. El sandbox `fnz…` no existe (verificado 2026-07-27). El worker **escribe** ahí: `clients`, `automation_jobs`, `agent_runs`, `automation_alerts`, `client_documents` y el bucket `documentos`. Todo lo demás de esa base es de Milo o del warehouse del estudio: **no escribir fuera de esas cinco tablas y ese bucket**. Sin sandbox no hay red de seguridad, y la service-role key da acceso total.

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
**Principio (2026-06-23):** el LLM (Centinela) es no-determinista; entre corridas nombra distinto las instituciones y reparte distinto los productos entre `identified261`/`additionalCreditors`. La **estructura** (clasificación, mapeo cert↔CMF, nombres, split) es **determinista dada los hechos** y NO debe depender del LLM. El LLM extrae hechos de documentos messy; TypeScript blinda la estructura con backstops. Implementado en **`sentinel_backstops.ts`** (`applyDeterministicBackstops` — función PURA extraída de `runSentinelCheck`, unit-testeable sin API; corre igual sobre el `raw` del LLM o del ensamblador por-doc) y `acreedor_matcher.ts`. Batería determinista sin API: `tools/paso3_validacion/run_all.ts`. Detalle:
- **`src/utils/cert_line_items.ts`** — `extractCertLineItems(text)` extrae (operación, monto, etiqueta) de cualquier cert. 2 detectores generales y CONSERVADORES: (1) línea con etiqueta de **payoff inequívoca** ("Saldo Deuda/Insoluto/Total a Pagar", "Costo Total del/Monetario Prepago"); (2) tabla de **Certificado de Liquidación/portabilidad** (Nº Operación + monto). Excluye cupo/autorizado/aprobado/**facturado del mes**/no-vencido/indirecta (cero falsos positivos).
- **Backstop de completitud**: por cada cert **con capa de texto** (re-leído vía `-layout`), agrega los ítems que el LLM OMITIÓ — override de monto si el banco tiene fila CMF sin reclamar, o NO-CMF si es solo-en-cert. Aditivo. Resuelve **BCI cuenta corriente $615** y **BancoEstado línea $389.848** sin depender del LLM. ⚠️ **Tesseract eliminado (Mejora #1)**: en **escaneos/imágenes ya NO hay OCR** → este chequeo determinista de completitud **solo aplica a PDFs con capa de texto**. En certs escaneados/imagen el monto lo lee **Claude nativo** (`nativePdfBase64` / bloque imagen), validado aguas abajo (tolerancia vs CMF + cross-check de RUT). NO reintroducir Tesseract: la lectura nativa demostró ser más confiable.
- **`canonicalInstitutionKey` quita sufijos "— descriptor" + paréntesis** antes del alias: el LLM escribe "Banco de Chile — Tarjeta de crédito (*2949)" → "banco de chile". Sin romper "Santander-Chile" (requiere guión rodeado de espacios).
- **Reconciliación `additional`→`identified261`**: un producto del CMF mal puesto en `additionalCreditors` por el LLM, cuyo monto cae cerca (≤30% o ≤$500k) de una fila CMF del mismo banco sin reclamar, se mueve a override (evita doble conteo: fila CMF + fila NO-CMF). NO-CMF genuino (CCAF/TGR, o banco con todas sus filas reclamadas) queda como additional.
- **`isCovered` por `document_filename`**: "ya cubierto por el LLM" se decide primero por filename + monto (robusto a cómo nombre la institución), fallback al banco canónico. Evita duplicar un producto que el LLM sí emitió.
- **Aliases de nombre largo de CCAF**: el CMF escribe "Caja de Compensación de **Asignación Familiar** <X>"; sin alias, una CCAF del CMF se SALTA en el Paso 3. Cubiertos Los Andes / 18 de Septiembre / Gabriela Mistral / Los Héroes / La Araucana → "CCAF <X>".
- **Dedup por Nº de operación + no declarar $0 (ensamblador, `sentinel_per_doc.ts`)**: el MISMO producto suele venir en varios docs (mensual + mora + liquidación) → se deduplican por `(banco canónico + normalizeOperationId)` conservando el de mejor `doc_type`/confianza (`normalizeOperationId` quita ceros a la izquierda y paréntesis). Productos con `monto ≤ 0` se descartan (G2: nunca $0; ej. multas en UTM sin convertir → se caen, ver lección L17). Límite: si el mismo producto trae números distintos por doc (last-4 vs PAN), el dedup exacto no los une — un dedup fuzzy violaría G2 → queda la alerta `posible_duplicado` + lección L20.
- **Gate 260→261 multiproducto NO inyecta el total del CMF (`sentinel_backstops.ts`)**: cuando un banco 90+d es multiproducto (cert con N ops, 1 fila CMF), el gate degrada los **override(s) reales** del banco (a su propio monto, los quita de `cmf260DirectOverrides`); si el banco ya está representado por sus productos (snapshot pre-gate de id261/reclass/additional) NO inyecta nada; SOLO inyecta el total del CMF si el banco 90+d no tiene NINGÚN documento (G2). Arregla el doble conteo (fila fantasma = total CMF encima de los sub-productos). Testigo: Santander de Jaime.
- **Aliases del nombre CORTO del CMF + " / " compuestos**: el CMF imprime la institución sin "Banco" ("De Crédito e Inversiones", "Internacional") y abreviada ("CAT (ex CENCOSUD)" = Cencosud Administradora de Tarjetas, mismo RUT; "Santander Consumer Finance" = Santander Consumer) → aliases en `acreedor_matcher.ts`. `canonicalInstitutionKey` corta también en `" / "` (nombres compuestos del LLM: "CMR Falabella / Banco Falabella").
- **Validación de los 13 casos reales sin API**: `tools/paso3_validacion/test_renegociacion_docs.ts` (fixtures `reneg_fixtures/`) corre el ensamblador + backstops sobre 13 clientes previos y compara contra la verdad-terreno; integrado en `run_all.ts` como guard de regresión. **`run_all.ts` corre hoy 18 suites** (el 26-jul se incorporaron 5 que existían en el repo y no corrían —dedup sin nº de operación, firma de documentos, fecha de emisión, estado consolidado, caso Yasmín— más 2 nuevas: `test_carpeta_tributaria.ts` y `test_cert_line_items.ts`). Si agregás un test, agregalo también a la lista de `run_all.ts` o no protege de nada.

### Step 3 — Alertas al dashboard de acreedores no declarados
`fillStep3` devuelve `Step3Report { added[], skipped[] }`; `fillAllSteps` lo propaga (`Promise<Step3Report|undefined>`) y **`worker.ts` emite una `automation_alert` (`alert_type:'needs_review'`, step 3) consolidada** listando cada acreedor que el Paso 3 NO pudo declarar (sin match en `acreedores_canonicos` sin RUT, comuna del catálogo sin región, cert faltante, etc.). Es **informativo** (no bloquea ni marca `failed`; el borrador igual queda cargado) → el abogado lo ve en el panel `/automatizacion` y carga manual. Aplica a ambos caminos (Paso 3 individual y flujo completo step:0).

### Step 3 — Monto y vencimiento "según el documento" (no del CMF)
El Paso 3 ingresa el **monto del documento de acreditación** (más actual que el CMF, dentro de la tolerancia de $300–500k) y la **fecha real de la cuota impaga** (en vez del placeholder `dateDaysAgo(90)`). Fuentes por tipo de acreedor:
- **Reclasificados** (`reclassifiedCreditors`): `total_credito_clp` + `delinquency_start_date`. Funciona en producción (el worker ya los pasa).
- **No-CMF** (`additionalCreditors`): `total_credito_clp` + `delinquency_start_date` (solo 260). Funciona en producción.
- **260 directos del CMF** (ej. CAT/CMR/Santander): vía `cmfDocumentOverrides?: CmfDocumentOverride[]` (param de `fillStep3`). **Ya funciona en producción**: el Centinela (REGLA 9) extrae `monto_clp` ("Monto total a pagar", NO "Saldo del crédito") + `fecha_vencimiento` (inicio de mora / "Cobranza Judicial iniciada", NO contratación) por producto y los expone en `sentinelResult.cmf260DirectOverrides` → `centinela_agent.ts` los mapea a `cmfDocumentOverrides` → `worker.ts` los pasa a `fillStep3`/`fillAllSteps`.
- **Monto efectivo**: cuando el monto del documento sobrescribe al del CMF, ese valor se propaga a `isCreditorAlreadyInTable` y a `attachDocumentoAcreedor` (que matchean por monto). **Nunca usar `creditor.totalCredito` del CMF directamente si hay override** — la fila quedaría con un monto y el attach buscaría otro.

### Step 3 — Multiproducto (un certificado de liquidación cubre N créditos)
Un certificado de liquidación de un banco puede cubrir VARIOS créditos del mismo deudor (ej. Santander con 3 créditos de consumo). El Centinela emite **un `cmfDocumentOverride` por producto** (sufijo de producto entre paréntesis en `institucion_cmf`, ej. `"Banco Santander-Chile (Consumo 05/06/2025 — Op. ...)"`). `step3` los agrupa por institución base (`overrideBaseKey`, quita el sufijo); si hay ≥2 → **multiproducto**: se omiten en el loop principal y se crea **una fila 260 por producto** con su "Monto total a pagar" (NO un monto consolidado). **"VARIOS DEUDORES"/"OTROS DEUDORES" SÍ se declaran** (deuda directa del deudor como titular junto a otros — regla del abogado, 2026-06-23); solo se **excluye** la deuda **indirecta** (codeudor/fiador/aval de un *tercero*). ⚠️ **No hay filtro por monto** en este camino (se quitó el `< 1 UF` el 2026-07-26: se comía una TGR de $18.000 acreditada por certificado, L30 revisada). Un producto multiproducto sin fecha de vencimiento acreditable **se declara en Art. 261** con su monto, no se descarta. ⚠️ El CMF puede partir UN crédito en 2 filas (mora + vigente, misma fecha de otorgamiento) → es un solo crédito, se declara UNA vez al payoff total (no declarar la porción vigente aparte = doble conteo).

### Step 3 — Adjunción Art.260 = tipo 22 + tipo 23 por separado
Los acreedores **Art.260** suben el MISMO certificado **dos veces**: una como "Acredita Monto" (tipo 22) y otra como "Acredita Vencimiento" (tipo 23) — así lo hace el abogado. En `step3_acreedores.ts` la fase de adjunción usa `neededTipos = isOtros ? [22] : [22,23]` y fuerza el `tipo_documento` del `AcreditacionDoc` base (que puede venir como 24) a cada tipo necesario. Los **Art.261** suben solo tipo 22 (Monto). `attachDocumentoAcreedor` distingue por el texto del tipo ("monto" vs "vencimiento"), así ambos adjuntos conviven sin pisarse.

### Step 3 — Contrato de documentos dashboard→worker (2026-07-30)
- **El archivo adjunto sale de la MISMA fuente que el monto declarado.** `centinela_agent.ts` propaga `document_filename` en `cmfDocumentOverride` (antes se descartaba); `step3_acreedores.ts::seleccionarDocsDeLaFila` da precedencia al archivo que citó el Centinela, y `montoEfectivo`/`fuenteMonto` calculan monto+archivo en una sola expresión (no en cadenas separadas que puedan divergir en un banco multi-producto). Cierra el error del feedback de Barraza: monto de un estado de cuenta con otro estado adjunto.
- **Multiproducto 261 (espejo del 260): dedup por MONTO DISTINTO, no por cantidad cruda.** Dos `id261` del mismo banco con el mismo monto exacto son la misma deuda en dos papeles (dos períodos, el cert y su reemisión). `contarMontosDistintosPorBanco` (el gate) e `id261FilasAEmitir` (la emisión) viven en `step3_acreedores.ts` y las usan **tanto `fillStep3` (el camino real) como `step3_classify.ts::planStep3Rows`** (la función pura testeable, que **no tiene llamadores de producción** — solo la usan los tests; si se toca una sin la otra, el fix queda en un test verde que no protege la corrida real). El colapso por monto exacto es una heurística: cuando dispara, alerta `posible_duplicado` (por si son dos créditos distintos que coinciden en el monto por casualidad).
- **El backstop de completitud no declara sin que el papel confirme la identidad.** `identidadConfirmadaPorElPapel` (`sentinel_backstops.ts`) exige que `certificateAnalyses[].identidadAsignadaConfirmada` sea `true` — que ya lo calcula `computeRutCheckLocal`/`computeRutCheck` cuando el RUT del acreedor asignado aparece impreso en el cert — antes de que el backstop rescate un ítem que el LLM omitió. Sin esto, el backstop podía anclar un monto al "banco con cupo libre en el CMF" sin verificar que el papel fuera de ese banco — el mecanismo exacto del acreedor fantasma de Barraza ($5.279.356 de una tarjeta FORUS declarado como Banco de Chile).
- **El Mapeador cae a fallback por institución cuando el filename citado no matchea** (rename, output cacheado, distinta capitalización), en `reclassifiedCreditors` y `additionalCreditors` — antes solo `identified261Creditors` lo tenía. La alerta del fallback es `type: 'other'` (**no** `missing_document`, que es bloqueante y abortaría el Paso 3 que el fallback vino a salvar). El fallback NO-CMF excluye `reservedNonCmfFilenames`: sin eso, el fallback de un NO-CMF podía robarle el documento a OTRO NO-CMF del mismo banco que sí lo citó correctamente.
- **La firma del caché del Centinela (`documentSetSignature`, v23) mira `filename`/`institucion_cmf`/`document_type`, no solo `storage_path`** — codificados con `JSON.stringify`, no `join('|')` (colisión de delimitador con un "|" literal). El proyector del dashboard hoy es **insert-only por `storage_path`**: una fila ya en `client_documents` NO se actualiza en una re-proyección (gap conocido, ver TAREAS.md P8) — la firma cubre una corrección manual futura de esos campos, no protege contra este gap.
- **`client_documents.acreedor_canonico_id`** (nuevo, escrito por el proyector) identifica al acreedor por id, no por nombre — el worker no lo usa todavía como fuente del guard de identidad (usa `certificateAnalyses` en su lugar, ver arriba), queda disponible para un cross-check futuro.
- **El panel decide deuda-vs-ingreso por la PROCEDENCIA de la sección** (`origen` empieza con `CMF —` o `Agregado manualmente` → deuda; `SII —`/`Default` → ingreso/respaldo), no por si el nombre resuelve contra el catálogo — antes un acreedor real fuera del catálogo (Tricard S.A., agregado a mano con "+ agregar acreedor") se proyectaba como documento de ingreso y no se declaraba nunca.

### Step 3 — Auto-asociación cert→acreedor por RUT (`cert_institution_resolver.ts`)
Antes del Centinela, `resolveCertInstitutions(supabase, client, logger)` deriva el `institucion_cmf` de cada `client_document` por **RUT** (descarga el PDF → `pdftotext` → `extractRutsFromText` → `findCatalogEntryByRut`), con fallback por keyword del filename (`FILENAME_KEYWORDS` → `matchAcreedor`). Persiste el nombre canónico en `client_documents.institucion_cmf`. El dashboard ya **no exige** que el abogado elija el banco. `deterministic_mapeador` propaga ese nombre a `AcreditacionDoc.catalogInstitucion`, que `step3` usa como **fallback** para hallar el RUT cuando el nombre CMF/Centinela no matchea el catálogo (ej. "Tenpo Payments" vs "Tenpo Prepago"). Los NO-CMF cuyo RUT no aparece en el documento (ej. La Polar, cuyo cert solo imprime el RUT del administrador) los identifica el Centinela por contenido.
- **Aliases-como-dato + crosswalk**: cuando el nombre del CMF/cert no calza con el catálogo (ej. "Tenpo Payments" vs "Tenpo Prepago", "Santander Consumer Finance Limitada" vs "Santander Consumer Chile"), la variante se registra en **`docs/acreedores-crosswalk.md`** y se carga en la columna **`acreedores_canonicos.nombres_alternativos`** (sandbox; `migration_sandbox_v7.sql`). **Regla de oro: verificar que el RUT de la fila sea la MISMA empresa que el alias** (RUT del cert > catálogo; ojo Banco Falabella≠CMR, Banco Ripley≠CAR). Pendiente: que `acreedor_matcher.ts` lea esa columna.
- **Lectura nativa de PDF/imagen por Claude (Mejora #1, reemplaza a Tesseract)** (`sentinel.ts`): muchos certs son escaneos/fotos PNG/JPEG o PDFs sin capa de texto limpia. `pdfNativeReason` decide ante la duda (texto <50 chars, imagen raster grande embebida, o densidad <200 chars/página) y adjunta el PDF **nativo** a Claude (`nativePdfBase64`, ≤6 MB) en vez de OCR; las imágenes van como bloque `image`. El OCR de Tesseract fue **eliminado** (la lectura nativa demostró leer mejor montos/tablas/escaneos). Si el PDF es ilegible y supera el tope, queda placeholder + alerta (no tumba el job). El texto digital limpio (`pdftotext`) se sigue confiando sin llamar a Claude nativo.
- **Validación anti-error de la lectura de Claude** (`sentinel.ts`, REGLA 11): como Claude lee nativo (sin red determinista por-texto en escaneos), se le exige un objeto **`evidence`** por acreedor (`rut_emisor`, `numero_operacion`, `moneda`, `cita_monto`, `cita_fecha`, `confidence`) en las **4 listas** (reclassified/identified261/deReclassified/additional/cmf260Override). TS verifica los HECHOS, **no la estructura**: (1) **auto-cita** — el monto debe aparecer verbatim en `cita_monto` (anti-alucinación; tolera UF y sumas de cupos); (2) **cross-check de RUT** — `rut_emisor`→catálogo debe ser la institución asignada; (3) **confianza** <0.70 → alerta. Las discrepancias salen en `SentinelResult.claudeReadIssues[]` (informativo, no bloquea) y el worker **ya las propaga** a una `automation_alert` (`buildReadIssuesAlert`). ⚠️ Hueco conocido: la auto-cita **se auto-aprueba cuando `moneda === 'UF'`**, que es justo donde el error de lectura es multiplicativo (×1.000 / ×39.000) — ahí no queda señal. Lecciones vivas en `lecciones/paso3-acreedores.md`.

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
2. **Suma de `totalCredito` ≥ 80 UF (~$3.253.000 CLP)**: Se suman los campos `totalCredito` de esos productos (no el monto atrasado). El valor de la UF y el umbral viven en **una sola constante** (`UF_CLP` / `UF_80_CLP` en `cmf_analyzer.ts`) — estaba triplicado con valores distintos (40662.5 / 39000 / 3253000); si hay que actualizar la UF, es ahí y solo ahí. Si el CMF no alcanza el umbral, se deben revisar documentos adicionales.

**Chequeo "mínimo 2 productos" (implementado en `worker.ts`)**: el worker cuenta `totalQualifyingCount = productos CMF con 90+d + reclasificados por el Centinela + NO-CMF Art.260`. Si `< 2`, el cliente **no califica**: en un Paso 3 individual el job queda `status='blocked'` (no `failed` — reintentar no resuelve un requisito de fondo) con `automation_alert` (`blocked`) + `error_message` legible para el panel del dashboard; en el flujo completo (step:0) se **omite solo el Paso 3** y se guardan los Pasos 1, 2 y 4, con la alerta registrada. La condición **2 (80 UF)** sí es **no bloqueante** (solo `⚠️ ADVERTENCIA`); el abogado debe confirmarla antes de presentar.

### Step 3 — Known Portal Blockers
- **`#dlgImportante` blocking `#btnGuardarEmpresa`**: After saving a representante legal, the portal shows `#dlgImportante` which intercepts all pointer events. The fix is `dismissBlockingDialogs(page, log)`, called both after `#modalRepresentante` closes and immediately before clicking `#btnGuardarEmpresa`.
- **`Subir Documento` is a plain `<a>`, not `<a class="btn">`**: Use `getByText(/subir documento/i)` as the primary selector. Document attachment only works after ALL creditors have been added (portal enables the links then). This requires the two-phase approach: add all creditors first, then attach documents.

### Step 5 — Ingresos (`step5_ingresos.ts` + `ingresos_agent.ts` + `income_extractor.ts`)
Pipeline general (no hardcodeado): `gatherStep5Input` (worker) reúne los docs de ingreso de `client_documents` → `runIngresosAgent` (Claude **lee nativo, UNA LLAMADA POR DOCUMENTO**) → `income_extractor.ts` (capa determinista BULLETPROOF) → `fillStep5` (Playwright, tras el Paso 4). Reglas clave (detalle en `lecciones/paso5-ingresos.md` L1–L35 + **playbook de extracción para el LLM**, **reglas oficiales Superir** verificadas ahí):
- **Detección de docs de ingreso por METADATA, no por filename (L35)**: `client_documents` es compartida (Paso 3 certs + Paso 5 ingresos; CMF/CT/retenedores viven en `clients.*_path`). Un cert de acreedor se reconoce por `institucion_cmf` poblado / `acreditacion_tipo` ∈ {monto,vencimiento} / `document_type` ∈ {22,23}. Regla general: **candidato a ingreso = TODO lo que NO es cert de acreedor** — así un doc de ingreso con nombre no descriptivo (`ilovepdf_merged.pdf`) no se pierde; lo que se cuele lo descarta el LLM (`category:'otro'`). Si tras el filtro NO hay docs de ingreso, el flujo completo emite `automation_alert` (step 5, needs_review) en vez de omitir en silencio.
- **VERDAD-TERRENO validada (Alfonso Martínez, 2026-07-01)**: el motor dio **$2.033.410 idéntico al peso** a lo declarado por la abogada (3 liquidaciones Buk, promedio de líquido). Confirma L33 (liquidación/líquido manda sobre resumen SII/Agente Retenedor/imponible, que sobre-declara ~20-25%) y L34 ("LÍQUIDO A RECIBIR" es sinónimo válido de líquido).
- **Monto = "Líquido a pagar"** y sinónimos ("Líquido a Cobrar/Recibir", "Rem. Neta", "Monto Líquido") — NUNCA "Alcance Líquido"/"Imponible" (sobre-declara). ⚠️ **L19: "Alcance Líquido" depende del formato** — si hay un "Líq. a Pago" MENOR aparte, usar ese; si "Alcance Líquido" es el ÚNICO neto final (Buk simple), ese SÍ se usa. El ingreso real = líquido + **descuentos voluntarios** redirigibles (préstamo empleador/CCAF/caja, **APV** —incluso "A.P.V.I. EN AFP", L17); los **legales** (AFP/salud/cesantía/impuesto) y los **anticipos/sindicato/seguros** NO se suman (caen a "ambiguo" → se alertan). **L20: la etiqueta manda** — "PRESTAMO X" → voluntario; nombre a secas ("COOPEUCH") → ambiguo (no sumar, alertar). Clasificación por keyword con **límite de palabra izquierdo**.
- **Multi-empleador (L9):** una fuente por **RUT pagador** (`source_key`); dos empleadores concurrentes = dos ingresos que se **suman** (no se promedian entre sí).
- **Promedio mensualizado (L3):** permanentes (sueldo/pensión/arriendo) = últimos **3 meses** (ordenados por fecha, dedup de duplicados); honorarios = **12 meses** (divisor fijo, declara bruto + alerta). **L15: varios pagos del MISMO mes calendario se SUMAN** (sueldo + aguinaldo/retroactivo/planilla accesoria); el divisor cuenta **meses, no líneas de pago**. **L16: mes PARCIAL** (días trabajados < 28: licencia médica, ingreso/egreso a mitad de mes) se **EXCLUYE** del promedio a favor de meses completos (fallback si todos parciales) + alerta. **Licencia médica:** subsidio fragmentado → dedup + reconstrucción por mes + mes más completo. Periodicidad **siempre Mensual** (value 4) salvo única vez. ⚠️ El portal NO dicta cómo calcular el monto (criterio del abogado, ver `PREGUNTAS_ABOGADO_PASO5.md`); fija los **documentos** de respaldo.
- **L18 — honorarios + sueldo coexisten:** declarar ambos + **alerta de coexistencia** (concurrente → se suman; secuencial → solo el vigente; lo decide el abogado).
- **Crosswalk determinista doc→(tipo_ingreso, tipo_documento)** en TS (el LLM solo clasifica la categoría semántica): remuneración→(1,28), pensión→(2,29), licencia médica→(3,30), arriendo→(7,32), retiro sociedades→(6,33), honorarios→(10,45), etc.
- **Red anti-error** por período (`evidence`: cita_monto verbatim + confidence) + **alerta UF** (un monto en UF tratado como CLP = error ~38.000×) + **conflicto sueldo↔licencia** (el subsidio reemplaza al sueldo) — todo informativo, no bloquea.
- **Certificado de Cotizaciones Previsionales**: upload **obligatorio** aparte (`#fileCertificadoCotizaciones`), últimos 12 meses, ≤30 días, con RUT de la entidad pagadora. NO es un ingreso.
- Si no hay docs de ingreso, el Paso 5 se **omite** (no rompe el flujo 1→4) **pero el flujo completo emite `automation_alert` (step 5, needs_review)** para que el abogado cargue el respaldo y declare manual (L35). `migration_sandbox_v8_ingresos.sql` agrega `'ingresos'` al CHECK de `agent_runs` (correr en el SQL Editor del sandbox).
- **Pruebas (no producción, en `casos/paso5_pruebas/`):** `npm test` corre la suite determinista (**132 unit** incl. fuzz 1000× + B10/B11 de los fixes nuevos + **5 casos** lote `casos-paso5` + **11 casos** lote `renegociacion_docs` + **31 casos** lote `casos_constanza_mulchi` incl. Alfonso con verdad-terreno, 28/31). Revisión + criterios "bulletproof" en `REVISION_Y_PLAN.md`. Fase 2 (lectura nativa real) en `run_native.ts` (pendiente API). Decisiones de criterio del abogado en `PREGUNTAS_ABOGADO_PASO5.md`.

### Cadena Multi-Agente (`src/agents/`)

El worker no llama directamente a `analyzeTaxCategory`, `runSentinelCheck` ni `runCognitiveOrchestrator`. Toda la cadena pasa por los agentes:

```
CMF download → analyzeCmfPdf (TS)
            → runTributarioAgent   (step 2) → agent_runs
            → runCentinelaAgent    (step 3) → agent_runs
            → runMapeadorAgent     (step 3) → agent_runs → Playwright
            → runIngresosAgent     (step 5) → agent_runs → Playwright
```

- **`types.ts`** — interfaces tipadas: `TributarioOutput`, `CmfParseOutput`, `CentinelaOutput`, `MapeadorOutput`, `IngresosOutput`, `AgentRunRow<T>`.
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

### Worker — Gate del abogado: ❌ ELIMINADO (decisión del abogado, 2026-06-19)
**No existe** el gate de `pending_review`: cuando el abogado sube la carpeta y autoriza la
automatización, el flujo corre de corrido. Ningún job entra en `pending_review`, y el camino de
reanudación del dashboard (`lawyer_confirmed`) es código muerto del lado del worker. Se documenta
solo para que nadie lo busque en el código ni lo "arregle".

Las señales que antes frenaban ahora **se declaran igual y se alertan**:
- `amount_mismatch` (cert vs CMF) y acreedores NO-CMF por confirmar → `automation_alert`
  (`needs_review`, step 3). Se declara el monto del **certificado** (G1) y la contradicción se avisa.
- `missing_document` → se declaran los acreedores acreditables y los faltantes quedan en
  `Step3Report.skipped` → alerta.
- `rut_mismatch` → **sí bloquea**: el certificado está mal atribuido.

### Worker — Invariantes que NO hay que deshacer (review 2026-07-26)
Cada uno arregla un bug que ya pasó; si un cambio futuro los toca, hay que entender por qué están:
- **Deuda indirecta del CMF** (`esIndirecta`): no se declara ni cuenta para los requisitos de fondo.
  Es deuda de un tercero (aval/fiador).
- **Conteo de productos en mora**: solo la de-reclasificación de la **REGLA 10** (cert que dice
  "vigente") resta del conteo. Las degradadas a 261 por falta del documento del vencimiento
  (`degradedForMissingVenc`) **siguen contando**: la mora existe, falta el papel.
- **Bloqueo por F29**: exige `categoria === 'primera'` (`f29BlockingMonths`). El camino de visión
  devuelve meses sin mirar la categoría → sin el guard se bloquea a un cliente de segunda.
- **Temporales de documentos**: nombre derivado del `storage_path` completo (nunca del basename) y
  **siempre re-descargar**. El caché por basename cruzaba certificados entre clientes y servía
  para siempre la versión vieja de un cert corregido.
- **`WORKER_CONCURRENCY` clampeado a 1**: el modo dry-run viaja por `process.env.DRY_RUN`, que es
  del proceso. Para subirlo hay que pasar el flag como parámetro por `fillAllSteps`/`fillStepN`.
- **Institución vacía nunca es comodín** en el match de reclasificados/overrides.
- **Clear-before-fill que no logra vaciar → se corta** (Pasos 3 y 5), en vez de apilar filas o
  declarar el ingreso dos veces.
- **Paso 4 respeta un apoderado ya declarado**; `cleanupDraft(page, logger, scope)` limpia solo los
  pasos que se le piden (el bloqueo del Paso 3 no borra el Paso 2 ni el 5).
- **Un flujo completo sin Paso 3 termina `blocked`**, no `success`.
- Códigos de `Step3Report.skipped` nuevos: `deuda_indirecta` (informativo) y `posible_duplicado`
  (accionable, del dedup de id261).

### Step 3 — Caché de lectura por documento (`document_reads`, 2026-07-28)
Cada documento se lee con el LLM **una sola vez en la historia del estudio**. La lectura se guarda en `document_reads` y se reutiliza en cualquier corrida futura, de cualquier cliente, que traiga el mismo archivo. Módulos: `src/utils/document_reads.ts` (el único que conoce la tabla) y `src/utils/doc_scope.ts` (qué documentos merecen la lectura).

**La llave es el contenido, no el nombre ni la fila.** `doc_sha256` se calcula sobre el Buffer recién bajado del bucket, nunca releyendo de disco — así el bug de los temporales no puede envenenar el caché. Un documento sin `sha256` recibe llave propia y no colapsa con nada.

**Se cachea lo que dice el papel, nunca lo que decidimos declarar.** La clasificación 260/261, el dedup de productos y los backstops corren en cada corrida. Solo se guarda el `DocFacts`.

**Nada relativo a hoy entra al caché.** Es la regla que más fácil se rompe sin darse cuenta:
- Los prompts NO llevan la fecha de hoy. `perDocSystemPrompt` no consulta la fecha por ninguna vía; hay un test estructural sobre su `toString()` que lo vigila.
- `emision` se deriva de hoy (`extractEmissionDateFromText` descarta candidatos futuros) → se persiste `emision_llm` (el crudo del modelo) y `emision` se recompone en cada corrida. **Si en `facts_json` aparece `emision`, alguien volvió a guardar la derivación.**
- Lo mismo con `dias_mora` en la cita de la calculadora de mora.

**Dos ejes de versión, y hay que subir el correcto:**
- `PER_DOC_PROMPT_VERSION` — cambió el prompt del extractor.
- `READ_UNIT_VERSION` — cambió cualquier otra cosa de la unidad de lectura: `isCollectionNotice`, `resolveEmision`, `n_periodos`, `recomputarEstados`. Su lista de disparadores está junto a la constante.
- El prompt de la mora se hashea solo (sobre un placeholder `'__FECHA__'`, no la fecha real — si no, el caché se invalidaría todos los días).
- `CENTINELA_LOGIC_VERSION` sigue siendo lo suyo: el armado, no la extracción.

**Solo se persiste una unidad de lectura COMPLETA.** Una falla transitoria de la mora (un 529) no lanza por diseño; si se persistiera esa lectura, esa deuda quedaría declarada en Art. 261 en vez de 260 **para siempre y para cualquier cliente con ese PDF**, y el único remedio sería un DELETE a mano en una tabla append-only. `enrichUnDocConMora` devuelve `'no_aplica' | 'ok' | 'fallo'` justamente para esto. Un estado de cuenta al día SÍ se cachea (respuesta negativa ≠ respuesta ausente).

**Un hit devuelve la lectura guardada pero con el `filename` y la `institucion_asignada` de ESTA corrida.** `filename` está fuera de la llave a propósito, pero es la llave de asociación de medio pipeline — incluido el chequeo de RUT que es BLOQUEANTE.

**El Paso 3 no lee documentos de ingreso** (`esDocumentoDeIngreso`). Se omite solo con evidencia positiva: la metadata manda sobre el filename, y `document_type = 24` NO significa "ingreso". Toda omisión se loguea con nombre y motivo.

📌 **Esto es la Etapa 0 de un plan de tres.** Las Etapas 1 y 2 —cortar los duplicados en el origen y **mover la lectura profunda al panel**, para que el sistema entero haga una clasificación barata + una sola lectura detallada— están sin empezar y requieren acuerdo con el lado de Milo. El worker necesita 13 campos por documento y el panel cubre 4, ninguno de los que disparan el Art. 260. Detalle, orden de negociación y protocolo de medición: `renegociacion-cockpit/.claude/PENDIENTE-lectura-unica.md`.

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

La base de datos del estudio del Abogado Ricardo Puelma es la fuente de verdad de todos los clientes y casos de renegociación. Se accede con `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (las únicas que existen). `public` tiene **48 tablas y 17 vistas**; la base completa son 8 esquemas. Abajo se documentan solo las relevantes para la automatización.

> 🗺️ **Mapa de fuentes:** [`docs/integracion/mapa-fuentes-produccion.md`](docs/integracion/mapa-fuentes-produccion.md) — ⚠️ su arquitectura (sandbox + prod) es FALSA desde el 2026-07-27; sus columnas y coberturas siguen sirviendo. Los `tools/audit_*` que cita fueron borrados en `cbec1e5`.
> ⚠️ El worker **escribe** en esta base (jobs, agent_runs, alertas). La regla vieja de "solo lectura sobre `ton…`" ya no aplica: es la única base que hay.

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
| `sha256` | Hash de los bytes del archivo en el bucket. Lo escribe el worker al descargar; es el join hacia `document_reads`. |

El bucket `documentos` contiene las 4 categorías de archivos del cliente (CMF, carpeta tributaria, agentes retenedores, certificados de acreditación).

⚠️ **El proyector del panel inserta DOS filas por PDF** cuando el documento llegó por email y por Drive: dos `storage_path` distintos, mismos bytes. Y las dos copias NO son intercambiables — una suele traer `institucion_cmf` y la otra no. Al elegir una, preferir la que trae información (ver `dedupPorContenido` en `doc_scope.ts`).

#### `document_reads` (PASO 3 — caché de lectura por documento)
Append-only. Una fila = un documento leído una vez por el LLM. Ver la sección **Step 3 — Caché de lectura por documento** más arriba.

| Campo | Descripción |
|-------|-------------|
| `doc_sha256` | Identidad del contenido. Join → `client_documents.sha256`. |
| `reader` | Qué lector produjo la fila (`per_doc`, `mora`). Es parte de la llave. |
| `prompt_version` / `context_hash` | Versión de la extracción y hash del contexto (pista del CMF). Parte de la llave. |
| `facts_json` | El `DocFacts` crudo del papel. Nunca lo que decidimos declarar. |
| `status` | `completed` o `failed`. El índice único parcial solo aplica a `completed`. |
| `automation_job_id` | uuid de `automation_jobs` — qué corrida produjo la lectura. |

El invariante "una sola lectura vigente por llave" lo garantiza el **índice único parcial `document_reads_vigente`**, no una convención del código. RLS activa con cero policies y sin grants a `anon`.

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

## Flujo de datos para la automatización Superir

De dónde toma el worker cada input: CMF vía `clients.informe_cmf_path`, certificados vía `client_documents`, carpeta tributaria vía `carpeta_tributaria_path`, agentes retenedores vía `carpeta_retenedores_path`.

> El dashboard `rp_carga_documentos` que llenaba estas columnas fue **jubilado y borrado** (2026-07-27). Hoy las llena el panel `auth-admin` con `lib/superir-proyector.ts`. Convenciones de los `<select>` del Paso 1 (`estado_civil` = value `'1'`..`'7'`; `region`/`comuna`/`profesion_oficio` = label exacto, comuna en MAYÚSCULA): `supabase/portal_select_values.json`.

**UNA sola Supabase: `tonrzmlrrcnizamtzqte`.** El sandbox `fnz…` NO existe en ningún entorno vivo (verificado 2026-07-27 contra el `.env` del Mac Mini y `.env.example`: solo hay `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Las tablas del worker y las de Milo conviven ahí.

```
[Panel auth-admin] botón "Ejecutar" — solo-admin, gate `presentacion_pato`='manual'
  lib/superir-proyector.ts → copia PDFs al bucket `documentos`
                           → upsert clients (ClaveÚnica en claro; el panel la borra al terminar)
                           → insert client_documents (dedup por storage_path, NUNCA borra)
                           → INSERT automation_jobs (step 0, dry_run)

[Mac Mini — pm2 `superir-worker`, polling 5s]
  worker.ts toma el job → cadena de agentes (tributario→centinela→mapeador)
                        → Playwright login → pasos 1→5 (NUNCA radica)
  automation_jobs (UPDATE) + automation_alerts + agent_runs
```

⚠️ `prodSupabase` (`supabaseWorker.ts:32`) queda **null** en producción porque `PROD_SUPABASE_*` no existe → `resolveClaveUnica` nunca lee `renegociacion_overrides` (1.391 filas, misma base, misma key) y cae al fallback. Ya mató un job el 2026-07-23. `rp_carga_documentos` no existe en disco.

📄 Estado desplegado, verificado en vivo: `renegociacion-cockpit/docs/2026-07-27-revision-completa-produccion.md`.

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
# Batería determinista del Paso 3 — 25 suites, NO gasta API, no toca nada.
# Es el chequeo de siempre antes de commitear. Una suite nueva va en el array TESTS.
npx ts-node --transpile-only tools/paso3_validacion/run_all.ts

# Verificación en vivo del LLM (GASTA API): compara contra la verdad-terreno de la abogada.
# Ojo: sus 3 casos (cristian_mancilla, miguel_lugo, nector_ruiz) NO existen en la base —
# imprime "Cliente no encontrado" y no prueba nada. Para un caso real usar debug_perdoc.ts.
npx ts-node --transpile-only -r dotenv/config tools/paso3_validacion/debug_perdoc.ts 16991741-8

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
npx ts-node -r dotenv/config tools/mantenimiento/limpieza_total.ts
# Para otro cliente: CLAVE_UNICA_RUT=12345678-9 npx ts-node -r dotenv/config tools/mantenimiento/limpieza_total.ts

# Inspect the verAcreedores page for HTML IDs (run while portal session is active)
npx ts-node -r dotenv/config tools/inspect_otros_acreedores.ts
```
