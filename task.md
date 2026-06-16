# Tareas: Automatización Superir — Estado Actual

## Completadas (sesiones anteriores)

- [x] **CMF Analyzer** — normalización diacríticos, extracción `overdue90DaysTotal`, mapeo columnas dinámico, validación 80 UF
- [x] **Alerts** — `createAlert`/`clearAlert` con `clientsTable`, formato `credential_error`
- [x] **Login** — `CredentialError` tipada, selectores exactos, fallback error genérico
- [x] **Worker** — `instanceof CredentialError`, `alertType` por `.code`
- [x] **Steps 2 y 4** — URL check antes de `waitForSelector`, `logger?.error()` en catch
- [x] **Step 3 Playwright** — `:not(.hidden)` en CMF, timeouts extendidos, estabilización post-cleanup
- [x] **Datos sandbox** — tabla `client_documents` migrada, registros Patricio Martini
- [x] **Cognitive Orchestrator (API Key #2)** — soporte imágenes (JPG/PNG), extracción fechas, MIME detection, pre-chequeo RUT determinista, exención estados de cuenta (30d), 80 UF no bloqueante
- [x] **F29 Activity Check** — `detectF29ActivityLast24Months` en `pdf_analyzer.ts` + `BlockedError` en `worker.ts`
- [x] **`dateDaysAgo` timezone** — usa `America/Santiago` en `step3_acreedores.ts`
- [x] **Prueba E2E completa** — Pasos 1→2→3→4 para Patricio Martini: ✅ 4/4 exitosos (2026-06-09)
- [x] **Dashboard "Carga de Documentos"** (`dashboard_rene`) — vista `/subir-caso` + `/api/subir-caso` para adjuntar CMF + certificados. Fix cap `/api/acreedores` (50→1000).
- [x] **Fix compilación worker** — campo `downloadFailed` faltante en interfaz `ClientDocument`.
- [x] **Pre-chequeo de RUT determinista** — `extractRutsFromText`/`findCatalogEntryByRut` en `acreedor_matcher.ts`; `computeRutCheck` en el orquestador.
- [x] **Sentinel (API Key #1) — base construida** — `src/utils/sentinel.ts` integrado en el worker. Descarga CMF + certificados, pre-análisis TypeScript (fechas, RUT, 30d/estado_cuenta), llama a Claude, devuelve `SentinelResult`. Activado con `ENABLE_SENTINEL=true`.
- [x] **CMF parser fix (hasDates=false)** — formato clásico sin fechas (Claudia): usa detección por espacios en blanco en lugar de `substring` de posición fija. Evita truncar nombres de institución.
- [x] **`qualifying90PlusCount`** — campo en `CmfAnalysisResult`; `meets90DaysRequirement` exige ≥ 2 productos.
- [x] **80 UF usa `totalCredito`** — corregido en `cmf_analyzer.ts`, `step3_acreedores.ts`, `cognitive_orchestrator.ts`.
- [x] **API1_instructions.md** — instrucciones completas del Centinela (API Key #1): flujo CMF → estados de cuenta, algoritmo mora tarjeta/consumo, reclasificación, formato JSON de salida, regla 30d/exención estados de cuenta.
- [x] **Perfil de Claudia en sandbox** — CMF y Carpeta Tributaria de Claudia Silva enlazados al perfil de Patricio Martini para pruebas. `client_documents` vacío (pendiente carga de estados de cuenta).
- [x] **Módulo de acreedores NO-CMF (núcleo)** — Reconciliación documentos − CMF dentro del Centinela. Detecta deudas que no salen en el CMF pero deben declararse (TGR, cajas, fintechs, tarjetas no reportadas). TS hace el diff determinista (`nonCmfReconciliation`, `issuerInCmf` por RUT+nombre); Claude confirma/extrae y devuelve `additionalCreditors[]`. Nuevo campo en `SentinelResult`; propagado por `worker.ts` → `cognitive_orchestrator.ts` (genera los `AcreditacionDoc` no-CMF) → `fillStep3`/`fillAllSteps`. Paso 3 los ingresa en la sección por artículo (`isOtros = categoria_articulo === 261`).
- [x] **Fechas clave deterministas** — `FechaClave[]` en `SentinelResult` (sin Claude): expiración CMF/certificados (+30d) y cruce 261→260 (+91d). No bloqueante, solo alerta/log.
- [x] **Fix matching documento↔acreedor por filename** — Acreedores NO-CMF asocian su documento por `filename` exacto; los del CMF excluyen los reservados a NO-CMF. Resuelve el cruce "mismo banco, productos distintos" (CPF de tarjetas vs. consultaCredito del consumo BdCh). `AcreditacionDoc.filename` agregado; el orquestador lo puebla.
- [x] **Fix all_steps propagación** — `fillAllSteps` ahora propaga `reclassifiedCreditors` y `additionalCreditors` a `fillStep3` (antes el flujo step:0 no pasaba reclasificaciones).
- [x] **Caso Alejandra Espinoza — perfil + documentos cargados** — Fila propia en `clients` (RUT 18.738.680-2, credenciales de portal de Pato), CMF + 5 certificados en `client_documents`. Scripts: `setup_test.ts`, `upload_documents.ts`, `test_step3.ts` (hardcodeado), `test_reconciliacion.ts` (Centinela aislado).
- [x] **Prueba E2E Paso 3 — Alejandra (2026-06-14)** — `test_step3.ts` ✅ 5/5 acreedores: CAT + CMR (Art. 260) y BdCh consumo + 2 tarjetas NO-CMF (Art. 261), con documentos correctos por filename. DRY_RUN limpió el borrador.
- [x] **Monto y vencimiento "según el documento" (no del CMF)** — El Paso 3 ahora ingresa el monto del documento de acreditación (override del CMF, dentro de tolerancia) y la fecha real de la cuota impaga (reemplaza el placeholder `dateDaysAgo(90)`). Fuentes: `reclassifiedCreditors` (`total_credito_clp` + `delinquency_start_date`), `additionalCreditors` (no-CMF), y `cmfDocumentOverrides` (260 directos del CMF). El **monto efectivo** se propaga a idempotencia y adjunción (que matchean por monto). Verificado E2E con Alejandra: CAT $11.275.392/05-09-2025, CMR $1.781.499/25-08-2025.
- [x] **PR `pm/feat-acreedores-no-cmf` → `main` preparado (2026-06-15)** — Rama limpia (tsc exitoso, git status vacío), 3 commits sobre main (ff5642e → 0697c84), pusheada a origin. Incluye: módulo acreedores no-CMF, monto/vencimiento desde documento, caso Alejandra E2E, .gitignore para scripts de diagnóstico, análisis_deudas.md actualizado. Link: https://github.com/narsil9/renegociacion/compare/main...pm/feat-acreedores-no-cmf
- [x] **Deuda técnica resuelta — commit cambios acumulados** — Todos los archivos pendientes (sentinel.ts, step3, cognitive_orchestrator, cmf_analyzer, pdf_analyzer, worker, step1, API1_instructions.md) están en los commits f71aa39 y ff5642e de la rama.
- [x] **Deuda técnica resuelta — limpiar utils de prueba** — ~50 scripts de diagnóstico en `src/utils/` (inspect_*, check_*, test_*, migrate_*, scan_*, etc.) cubiertos por patrones en `.gitignore`. El árbol queda limpio sin eliminar los archivos.
- [x] **Confirmación E2E Paso 3 Alejandra (2026-06-15)** — Segunda ejecución `test_step3.ts` ✅ 5/5 acreedores, 0 saltados: BdCh consumo $3.125.486 (261), CAT $11.275.392/05-09-2025 (260), CMR $1.781.499/25-08-2025 (260), Visa Platinium $517.442 NO-CMF (261), Visa Entel $1.407.530 NO-CMF (261). Matching por filename perfecto. DRY_RUN limpió. **Caso Alejandra CERRADO.**

- [x] **Prueba E2E Paso 3 — Claudia Silva (2026-06-15)** — `test_step3.ts` ✅ 2/2 acreedores: BdCh Consumo $48.236.275/03-09-2024 (reclasificado 261→260 por Sentinel) y CAR Ripley $1.218.565/25-08-2024 (reclasificado 261→260). Monto y fecha tomados del documento. DRY_RUN limpió. **Caso Claudia CERRADO.**

- [x] **Prueba E2E Paso 3 — Betzy Lee (2026-06-15)** — ✅ 5/5: BdCh consumo $18.191.754 reclasificado (261→260) + BdCh tarjeta $3.716.235 NO-CMF Art.260 + 3 Art.261 (CAT, CMR, PRESTO). Patrón validado: mismo banco, producto fuera del CMF → `additionalCreditors`. `reservedNonCmfFilenames` evita cruce de docs. **Caso Betzy CERRADO.**

- [x] **Prueba E2E Paso 3 — Yoselyn Reyes (2026-06-15)** — ✅ 8/8: 4 Art.260 del CMF (BancoEstado, BCI, CAR Ripley, CMR) + 1 Art.261 (Coopeuch) + 3 NO-CMF Art.261 (CCAF Los Andes). Lección: "Caja Los Andes" en docs = "CCAF Los Andes" en catálogo (RUT 81826800-9). cmfDocumentOverrides con 4 entradas. **Caso Yoselyn CERRADO.**

- [x] **Prueba E2E Paso 3 — Susana Matamala (2026-06-15)** — ✅ 4/4: CMF consolida 3 ops BdCh en 1 fila ($11.601.044) → EEDD_7616.pdf certifica $13.304.962 (c/intereses). CMR, CAT, CAR Ripley. Sin Sentinel. CT usa la de Pato Martini (pendiente SII). **Caso Susana CERRADO.**

- [x] **Prueba E2E Paso 3 — María Paz Bravo (2026-06-15)** — ✅ 5/5: CMR ($9.763.965/05-08-2025) + Itaú ($5.134.284/25-08-2025, 3 productos en 1 fila CMF) + BancoEstado×2 (Vivienda $71.189.175 + Línea $1.031.582, 1 doc cubre ambas filas) + Coopeuch $16.905.601. Catálogo BANCO ITAU corregido (RUT 97023000-9, comuna Las Condes). **Caso María Paz CERRADO.**

- [x] **Fix `getReclassifiedMatch` tiebreaker (2026-06-15)** — Cuando el Sentinel reclasifica múltiples productos del mismo banco (ej. BdCh consumo + BdCh tarjeta), el `find` original siempre devolvía el primero. Ahora usa `filter` + `reduce` por `totalCredito` más cercano como desempate. Validado: la brecha entre productos (millones) siempre supera la brecha CMF/doc ($300–500k).

- [x] **Análisis de deudas Jaime Cartes, Noelia Lorca, Nicolás Bascuñán y William Montero — generados por Codex/Gemini (2026-06-15)** — Los cuatro `analisis_deudas.md` fueron producidos por agentes externos (Codex / Gemini) usando la skill `/analisis-deudas-renegociacion`. Claude los leyó y asimiló en esta sesión. Resumen: Jaime y Noelia **bloqueados** tributariamente (ver Pendientes). Nicolás y William tienen análisis completos y están listos para crear sus scripts de prueba.

---

## En Curso — Arquitectura Multi-Agente (Pasos 2 y 3)

Objetivo: reemplazar los valores hardcodeados de `test_step3.ts` y el análisis manual de docs por agentes Claude que extraen datos, con TS que valida antes de pasarlos a Playwright. En producción los docs deben tener ≤30 días (excepción: estados de cuenta). En pruebas: `BYPASS_DATE_CHECK=true`.

### Flujo objetivo

```
Docs (CMF + certs + carpeta tributaria)
  ├── TS: parse CMF (cmf_analyzer.ts, gratis/determinista) → agent_runs
  ├── Agente Tributario → categoria + F29 → agent_runs       [Step 2]
  ├── Agente Centinela  → reclasif + no-CMF + montos/fechas → agent_runs  [Step 3]
  └── Agente Mapeador   → lee JSONs de agent_runs → step3_config → agent_runs  [Step 3]
        ↓
  TS Validator (regla 30d, RUT, 2 prods, 80 UF, vencimientos 260)
        ↓
  Playwright Step 2 / Step 3
```

### Infraestructura base
- [x] **Tabla `agent_runs` en Supabase** — `supabase/schema_agent_runs.sql` creado y ejecutado en SQL Editor (2026-06-16). `src/agents/agent_runs.ts` con CRUD tipado.
- [x] **Interfaces TypeScript de output** — `TributarioOutput`, `CmfParseOutput`, `CentinelaOutput`, `MapeadorOutput` + `AgentRunRow<T>` en `src/agents/types.ts`.
- [x] **TS Validator (`src/agents/validator.ts`)** — Type guards por output, regla 30d (bypasseable), ≥2 productos, ≥80 UF (advertencia), Art.260 con fecha, filenames únicos por institución, needsLawyerReview propagado. `mergeResults` + `logValidationResult` helpers.

### Agente Tributario (Step 2)
- [x] **`src/agents/tributario_agent.ts`** — Estrategia dual: texto→determinista / escaneado→Claude Opus 4.8 con documento base64. Idempotencia por SHA-256. Valida con `validateTributarioOutput` antes de `completeRun`. F29 con actividad → `needsLawyerReview = true`.
- [x] **Conectar al worker** — `worker.ts` llama a `runTributarioAgent` en step 2 y step 0. Eliminados `analyzeTaxCategory` y `detectF29ActivityLast24Months` del worker. `BlockedError` y alerta en `automation_alerts` preservados.

### Agente Centinela (Step 3)
- [x] **`src/agents/centinela_agent.ts`** — Wrapper de `sentinel.ts` con idempotencia SHA-256, agent_runs (step=3), `validateCentinelaOutput` antes de completeRun, conversión `SentinelResult→CentinelaOutput`. `ENABLE_SENTINEL=false` → bypass sin escribir a agent_runs. `CentinelaBlockedError` para bloqueos semánticos. `cmfDocumentOverrides` vacío (TODO próxima iteración).
- [x] **Worker conectado al centinela_agent** — `runSentinelCheck` eliminado del worker. Centinela se corre dentro del bloque `step===3|0` después del CMF descargado. `orchResult`, `fillStep3` y `fillAllSteps` consumen `centinelaOutput.*`.
- [x] **Fix `technicalError` en sentinel.ts** — Campo `technicalError?: boolean` en `SentinelResult`; catch externo lo marca `true`. `centinela_agent.ts` distingue: técnico → throw Error genérico (reintentable), semántico → `CentinelaBlockedError` (bloquea caso). Antes, API caída o créditos agotados bloqueaban el caso permanentemente.
- [ ] **Probar con Alejandra** — `test_centinela_agent.ts` listo en `casos/alejandra_espinoza/`. Bloqueado por créditos API agotados. Recargar en console.anthropic.com y correr: `ENABLE_SENTINEL=true BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_centinela_agent.ts`

### Agente Mapeador (Step 3)
- [x] **`src/agents/mapeador_agent.ts`** — Wrapper de `cognitive_orchestrator.ts` con idempotencia (hash = centinela run ID), agent_runs (step=3), conversión `OrchestrationResult→MapeadorOutput`. Errores técnicos → failRun+throw (retry). Errores semánticos (missing_document, rut_mismatch) → completeRun con needsLawyerReview. `mapeadorHasBlockers()` helper para el worker.
- [x] **Worker conectado al mapeador_agent** — `runCognitiveOrchestrator` eliminado del worker. Worker llama `runMapeadorAgent` y usa `mapeadorHasBlockers` para decidir si bloquea el Paso 3.
- [ ] **`cmfDocumentOverrides` desde el Centinela** — El Centinela ya extrae monto/fecha de cada cert; el Mapeador los recibe como parte del JSON. Pendiente de implementar en `centinela_agent.ts`.

### Conexión al flujo real
- [ ] **Worker orquesta la cadena** — `worker.ts` corre secuencialmente: CMF parser → Centinela (espera `cmf` completed) → Mapeador (espera `centinela` completed) → Playwright. Si un paso falla, los siguientes no corren.
- [ ] **`input_hash` para idempotencia** — Hash del set de PDFs. Si los docs no cambiaron y el run anterior completó, reusar output (no gastar créditos).
- [ ] **Gate del abogado** — Si `needs_lawyer_review = true` en cualquier agente, pausar antes de Playwright y notificar en dashboard.

---

## Pendientes — Casos

- [ ] **Jaime Cartes (RUT 17.596.599-8)** — **BLOQUEADO** hasta **13/07/2026** (boletas honorarios). Certs Santander TC + Tenpo desactualizados (monto <80 UF). Sin scripts.
- [ ] **Noelia Lorca (RUT 15.121.553-K)** — **BLOQUEADA** hasta ~**dic/2026**. Docs incompletos (La Araucana, Forum, TGR). Sin scripts.
- [ ] **Irene Arévalo (RUT 16.143.425-6)** — **BLOQUEADA** doble hasta ~**oct/2027**. Scripts listos, no ejecutar.

---

## Pendientes — Técnico (pre-agentes)

- [x] **Probar camino NO-CMF Art.260** — ✅ Validado con TGR de William Montero (2026-06-16).
- [ ] **Run mecánico completo Patricio (BYPASS_DATE_CHECK=true)** — Pasos 1→4. Pendiente: `missing_document` PRESTO LIDER.
- [ ] **Run real 1→4 con docs frescos** — Requiere CMF + certs <30 días.
- [ ] **ClaveÚnica de Miled** — `Miled12345` inválida.
- [ ] **Prueba cliente Primera Categoría** — Verificar `BlockedError` + F29 con actividad real.
- [ ] **Verificar categoría tributaria Patricio** — `ninguna` en E2E jun/2026. ¿Real o PDF escaneado?

---

## Completadas (sesiones anteriores)

- [x] **CMF Analyzer** — normalización diacríticos, extracción `overdue90DaysTotal`, mapeo columnas dinámico, validación 80 UF
- [x] **Alerts** — `createAlert`/`clearAlert` con `clientsTable`, formato `credential_error`
- [x] **Login** — `CredentialError` tipada, selectores exactos, fallback error genérico
- [x] **Worker** — `instanceof CredentialError`, `alertType` por `.code`
- [x] **Steps 2 y 4** — URL check antes de `waitForSelector`, `logger?.error()` en catch
- [x] **Step 3 Playwright** — `:not(.hidden)` en CMF, timeouts extendidos, estabilización post-cleanup
- [x] **Datos sandbox** — tabla `client_documents` migrada, registros Patricio Martini
- [x] **Cognitive Orchestrator (API Key #2)** — soporte imágenes, extracción fechas, MIME detection, pre-chequeo RUT determinista, exención estados de cuenta
- [x] **F29 Activity Check** — `detectF29ActivityLast24Months` + `BlockedError`
- [x] **`dateDaysAgo` timezone** — usa `America/Santiago`
- [x] **Prueba E2E Pasos 1→4 Patricio Martini** — ✅ 4/4 (2026-06-09)
- [x] **Dashboard "Carga de Documentos"** — vista `/subir-caso` + `/api/subir-caso`. Fix cap acreedores.
- [x] **Pre-chequeo RUT determinista** — `extractRutsFromText`/`findCatalogEntryByRut`/`computeRutCheck`
- [x] **Sentinel (API Key #1) — base construida** — `sentinel.ts` integrado en worker. `ENABLE_SENTINEL=true`.
- [x] **`qualifying90PlusCount`** + **80 UF usa `totalCredito`** corregidos
- [x] **Módulo no-CMF (núcleo)** — reconciliación doc−CMF, `AdditionalCreditor`, `FechaClave[]`, match por filename
- [x] **Fix `getReclassifiedMatch` tiebreaker** — filter + reduce por `totalCredito` más cercano
- [x] **Monto y vencimiento "según el documento"** — override CMF, `cmfDocumentOverrides`, monto efectivo propagado
- [x] **Fix all_steps propagación** — `reclassifiedCreditors` + `additionalCreditors` a `fillStep3`
- [x] **E2E Step 3 — Alejandra Espinoza** — ✅ 5/5 (2026-06-14 y 2026-06-15). CAT+CMR 260, BdCh consumo+2 tarjetas NO-CMF 261.
- [x] **E2E Step 3 — Claudia Silva** — ✅ 2/2 (2026-06-15). BdCh Consumo+CAR Ripley reclasif. 260.
- [x] **E2E Step 3 — Betzy Lee** — ✅ 5/5 (2026-06-15). BdCh reclasif.+tarjeta NO-CMF 260, 3×261.
- [x] **E2E Step 3 — Yoselyn Reyes** — ✅ 8/8 (2026-06-15). CCAF Los Andes NO-CMF.
- [x] **E2E Step 3 — Susana Matamala** — ✅ 4/4 (2026-06-15). CMF consolida 3 ops BdCh en 1 fila.
- [x] **E2E Step 3 — María Paz Bravo** — ✅ 5/5 (2026-06-15). Itaú RUT corregido.
- [x] **E2E Step 3 — Nicolás Bascuñán** — ✅ 10/10 (2026-06-16). 2×CCAF+2×Muni NO-CMF.
- [x] **E2E Step 3 — William Montero** — ✅ 11/11 (2026-06-16). TGR NO-CMF Art.260 real.
- [x] **Commit rama `pm/feat-acreedores-no-cmf`** + **`.gitignore` utils prueba** — resueltos.

---

## Arquitectura de agentes (objetivo producción)

| Momento | Agente | Input | Output → Supabase |
|---|---|---|---|
| Step 2 | **Agente Tributario** | carpeta_tributaria.pdf | `{ categoria, f29_meses }` |
| Step 3 (TS) | **CMF Parser** | informe_cmf.pdf | `CmfCreditor[]` (determinista) |
| Step 3 | **Agente Centinela** | CMF JSON + certs PDFs | `{ reclasificados, no-CMF, overrides, fechas_emision }` |
| Step 3 | **Agente Mapeador** | JSONs de agent_runs | `{ mappedDocs[], step3_config }` |
| Step 3 | **TS Validator** | MapeadorOutput | Bloquea si regla 30d / RUT / monto falla |
| Steps 2+3 | **Playwright** | step3_config + categoria | Llena portal Superir |
