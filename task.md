# Tareas: Automatización Superir — Estado Actual

---

## 🚀 PRIORIDAD — Camino a Producción

> La cadena completa (Tributario→Centinela→Mapeador→Steps 1→4) fue validada en DRY_RUN con 9 casos el 2026-06-17.
> El paso siguiente es probar con documentos reales y frescos, corregir los últimos gaps de catálogo, y conectar el worker al loop de producción.

### P0 — Desbloqueadores inmediatos

- [x] **Aliases catálogo — CCAF / Coopeuch** ⚡ *(2026-06-17)*
  - Aliases en `ALIASES` de `acreedor_matcher.ts`: "Caja Los Andes", "Caja de Compensación de Los Andes/Los Andes" → "CCAF Los Andes". Ídem para CCAF 18 de Septiembre, Gabriela Mistral, La Araucana, Los Héroes.
  - "Coopeuch" → "Coopeuch Ltda" (alias explícito para Tier 1; token-containment ya lo resolvía).
  - Catálogo ya tenía: Coopeuch Ltda (82878900-7), Municipalidades RM (incluye Santiago y Las Condes).
  - **Pendiente**: Municipalidad de Colina y Registro Civil — RUT no verificado, no insertados. William excluye multa Colina del test; el abogado la declara manual.

- [ ] **Primer run con cliente REAL y docs frescos (<30 días)** 🎯
  - Obtener un cliente nuevo O solicitar docs actualizados para Jaime Cartes (Santander TC 2982 + Tenpo 9924) o Noelia Lorca (La Araucana + Forum)
  - Crear carpeta `casos/nuevo_cliente/` con `analisis_deudas.md` + `setup_test.ts` + `upload_documents.ts`
  - Correr sin flags de bypass: `npx ts-node --transpile-only -r dotenv/config casos/nuevo_cliente/test_full_chain.ts` (Centinela corre por defecto; solo poner `DISABLE_SENTINEL=true` en pruebas sin API)
  - Objetivo: que el Centinela apruebe (APROBADO, no RECHAZADO), que el Mapeador no genere alertas, que Playwright complete los 4 pasos limpiamente

- [ ] **Primer envío real (DRY_RUN=false)** 🎯
  - Una vez que el run con docs frescos pase sin bypass, correr con `DRY_RUN=false` para un cliente confirmado por el abogado
  - Verificar en el portal Superir que los datos quedaron grabados correctamente

### P1 — Infraestructura de producción

- [x] **Conectar worker al loop real de la cadena** *(2026-06-18)* — `npm run worker` corre la cadena completa (tributario→centinela→mapeador→Steps 1→4) vía la cola `pato_prueba_automation_jobs`. Job `d65d7a9f` (Cinthia Rodríguez, DRY_RUN=true, step=0): ✅ 6/6 acreedores CMF + docs adjuntos, Steps 1→2→3→4 exitosos, `status=success` en Supabase. **Primer run histórico del worker daemon end-to-end vía queue.**
  - ⚠️ Fashion's Park (NO-CMF Art.260 $98.716) **no apareció** — en ese momento el flag era `ENABLE_SENTINEL=true` (ya obsoleto). Hoy el Centinela corre por defecto; para desactivarlo usar `DISABLE_SENTINEL=true`.
  - ⚠️ El worker requiere que `clients` sandbox tenga datos personales completos con **valores exactos del portal** (números de opción: `estado_civil='1'`, `region='Región Metropolitana'`, `comuna='LO BARNECHEA'`). Sin esto, Step 1 falla en `selectBootstrap`.

- [x] **`ENABLE_SENTINEL` → `DISABLE_SENTINEL` (2026-06-18)** — Lógica invertida: el Centinela corre por defecto; para saltarlo usar `DISABLE_SENTINEL=true` en `.env` (solo en pruebas sin API). `.env` actualizado. Workers viejos con bypass matados. **Centinela corre por defecto en producción; ENABLE_SENTINEL ya no existe.**

- [x] **Datos personales en `clients` con valores exactos del portal** *(2026-06-18)* — Resuelto vía el dashboard (ver subsección "Dashboard de carga" abajo). Convención fijada: `estado_civil` = **value** (`'1'`..`'7'`), el resto (`profesion_oficio`, `ocupacion`, `region`, `comuna`) = **label exacto** (comuna en MAYÚSCULA). Enums reales en `supabase/portal_select_values.json`. La fila se crea/edita desde la vista "Datos Personales" del dashboard, validada contra esos enums.

### P1.b — Dashboard de carga (input del abogado) — repo `rp_carga_documentos`

> El abogado NO entra a Supabase: usa el dashboard. Flujo: **Datos Personales** (crea la fila `clients`) → **Cargar Caso** (sube la carpeta) → encola `automation_jobs` → worker. Apunta al sandbox `fnz…`.

- [x] **Vista "Datos Personales"** *(2026-06-18)* — `app/datos-personales/` + `app/api/datos-personales/route.ts` + `lib/portal-values.ts`. Form con los mismos dropdowns del portal (cascada región→comuna, régimen solo si casado), upsert a `clients` por RUT (ilike), validación contra enums, trigger opcional de job (idempotente). Probado E2E contra el dev server.
- [x] **Fixes en "Cargar Caso"** *(2026-06-18)* — `classify()` por nombre de archivo (retenedores ya no se confunde con tributaria), Checklist de requisitos que bloquea si falta CMF, tabla editable (nada se descarta en silencio), `rut.ilike` (RUT con DV "K"), preserva extensión real, tipo de doc por certificado (22/23/24), enqueue idempotente.
- [x] **Enqueue por defecto = `step:0` + `dry_run:false`** *(2026-06-18)* — Ambos puntos (`subir-caso/finalize` y `datos-personales`) encolan la **cadena completa Pasos 1→4** (`step:0`) y dejan el **borrador vivo en Superir sin radicar** (`dry_run:false`; el flujo para en la vista del Paso 5). Antes encolaban `step:1`/`dry_run:true` (solo Paso 1 + limpiaba el borrador). **Validado E2E**: run real dashboard→worker→portal con RUT de prueba 21917363-6 + carpeta Alejandra → `success`, borrador cargado 1→4, 5 acreedores, sin presentar.
- [x] **Primer flujo COMPLETO dashboard→portal con borrador vivo** *(2026-06-18)* — crear cliente (dashboard) → subir carpeta (dashboard) → worker `DRY_RUN=false` → Pasos 1→4 guardados en Superir, no radicado. Todo persiste (clients, client_documents, job success + screenshots). **2ª verificación** con datos reales de Pato + nuevo default (sin parche) → `success`.
- [x] **Datos Personales: sin trigger + guardado parcial** *(2026-06-18)* — Quitado el checkbox de "encolar" (encolaba antes de subir docs → worker fallaba). Ahora la vista SOLO guarda. Guardado **parcial** permitido (solo bloquea valores inválidos; campos vacíos se permiten y se reportan). Prefill por RUT + banner de faltantes + borde ámbar en campos obligatorios vacíos + botón "Guardar avance/datos".
- [x] **Gate "datos personales completos" en Cargar Caso** *(2026-06-18)* — `lib/personal-fields.ts` (lógica compartida). GET de subir-caso devuelve `personal_complete`+`missing_personal` (pill en el banner + ítem rojo en el checklist que bloquea "Iniciar Carga"). `finalize` devuelve **409** si está incompleto (backstop server-side). Así el worker nunca corre con Paso 1 incompleto.
- [x] **Plantilla de carpeta (molde)** *(2026-06-18)* — Card "Formato de la carpeta" en Cargar Caso + botón "Descargar carpeta molde (.zip)" (`public/plantilla_caso_cliente.zip`: subcarpetas 02_Informe_CMF / 03_Tributaria_y_SII / acreedores_cmf / acreedores_no_cmf + LEEME). El abogado la llena y la sube.
- [x] **Encender el sistema (worker daemon) — `scripts/sistema.sh`** *(2026-06-18)* — Script portátil (`start`/`stop`/`status`/`logs`) que instala deps + Playwright y deja el worker corriendo (pm2 si está, sino nohup). Documentado en CLAUDE.md ("🟢 Encender el sistema"): el usuario dice "enciende el sistema" → `bash scripts/sistema.sh start`. **Falta dejarlo persistente al boot en el Mac Mini (`pm2 startup`).**
- [ ] **Régimen patrimonial — opciones reales** — `lib/portal-values.ts` usa labels estándar SIN verificar contra el portal (ningún dump tiene la lista; carga dinámica solo con casado). Verificar con un dump de cliente casado antes de un run real con casado. **[BLOQUEANTE para clientes casados]**
- [ ] **Comunas fuera de RM** — `portal_select_values.json` solo trae las 52 comunas de la Región Metropolitana; otras regiones caen a texto libre. Cargar las comunas del resto de regiones cuando aparezca un caso no-RM.
- [ ] **Recarga atómica de carpeta** — `subir-caso action=init` borra `client_documents`+Storage antes de subir; una falla a mitad deja el expediente parcial. Cambiar a subir-y-luego-reemplazar para recargas.
- [ ] **Deploy del dashboard** — `rp_carga_documentos` (Next 16, Vercel) — deployar con los cambios de esta sesión.
- [ ] **Auth en rutas API del dashboard** — hoy sin gate de usuario (service-role del lado server). Agregar antes de producción pública.

- [x] **Correr migration_sandbox_v4.sql en sandbox** *(2026-06-18)* — Aplicada en SQL Editor `fnz...`. `clients.airtable_id` creada, `automation_alerts.client_id` → uuid+FK a clients, `automation_jobs.needs_lawyer_review` + `pending_review` en el CHECK. Verificado (3/3 columnas). Fixes: `DECLARE r RECORD` faltante + comparación `client_id::text` en el DELETE (client_id ya era uuid). Tabla `clients` documentada con `COMMENT ON COLUMN` (valores literales del portal). **Sandbox-como-producción: NO se toca el proyecto del abogado (`ton...`).**

- [ ] **(DIFERIDO) Correr migration_prod_v4.sql en producción** — Solo cuando se decida pasar a la DB real del abogado (`ton...`). HOY operamos sandbox-como-producción y NO se toca `ton...`. Migraciones obsoletas (`_v1/_v2/_v3`, sandbox `_v1`/`_v3_cleanup`) ya eliminadas; queda solo `migration_prod_v4.sql` como referencia futura. **Coordinar con abogado.**

- [ ] **Gate del abogado (needsLawyerReview)** — Cuando el Centinela o el Mapeador marcan `needsLawyerReview=true`, el worker hoy sigue de todas formas. En producción debe: (a) guardar el estado `pending_review` en `automation_jobs`, (b) no correr Playwright, (c) notificar al dashboard para que el abogado confirme/corrija antes de continuar.

- [ ] **(DIFERIDO) Apuntar worker a la DB real** — El worker ya usa `clients` / `automation_jobs` en el sandbox `fnz...` (las tablas `pato_prueba_*` quedaron obsoletas, no se usan). Solo si se pasa a la DB del abogado habría que cambiar `SUPABASE_URL` a `ton...`. Hoy NO.

### P2 — Casos pendientes (necesitan docs del abogado)

- [ ] **Jaime Cartes (RUT 17.596.599-8)** — Solicitar certs frescos: Santander TC 2982 + Tenpo TC 9924 + Coopeuch. Con docs nov/2025 el total era ~76 UF (<80 UF). Tributariamente libre. Scripts listos. `institucion_cmf` Santander corregido a `'Santander-Chile'` (como aparece en CMF). Credenciales sandbox `Udechile.0930` rechazadas — confirmar clave actual.
- [ ] **Noelia Lorca (RUT 15.121.553-K)** — Solicitar docs frescos + cert saldo La Araucana + cert Forum. Scripts listos. Centinela detectó 3 NO-CMF: La Araucana $9.5M (Art.260, 322d), Forum $5.4M (Art.260, 164d), tarjeta 9782 $300k (Art.260, ~254d, emisor sin identificar — probablemente BdCh, confirmar). Credenciales sandbox `Jose1705.` rechazadas — confirmar clave actual.
- [ ] **Alejandra Espinoza** — Obtener su Carpeta Tributaria (SII). El resto de sus docs ya están en `client_documents`.

### P3 — Mejoras post-producción

- [ ] **Worker: idempotencia por hash de PDFs** — Si el CMF y los certs no cambiaron desde el último run `completed`, reusar el output de `agent_runs` sin gastar créditos API.
- [ ] **Validación "mínimo 2 productos" en TS** — El check de `qualifying90PlusCount >= 2` ya existe en el Centinela/validator, pero no bloquea en el worker. Agregar guardia antes de Playwright.
- [ ] **CT Jorge Romero con formato 2025+** — Re-testear `detectContribucionesDeuda` cuando aparezca una CT con el nuevo layout del SII.

---

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
- [x] **`detectContribucionesDeuda` (2026-06-16)** — Detección determinista de deudas por contribuciones (Impuesto Territorial) en la CT. Sección "Propiedades y Bienes Raíces", regla AFECTO+vencidas=SI. `ContribucionProperty[]` en `TributarioOutput.contribuciones_deuda`. Validator → `needsLawyerReview=true`. Validado con CT Jorge Romero: Rol BD 20 (Bodega/Almacenaje). ⚠️ Re-testear con CT de nuevo formato 2025+.

### Agente Centinela (Step 3)
- [x] **`src/agents/centinela_agent.ts`** — Wrapper de `sentinel.ts` con idempotencia SHA-256, agent_runs (step=3), `validateCentinelaOutput` antes de completeRun, conversión `SentinelResult→CentinelaOutput`. `ENABLE_SENTINEL=false` → bypass sin escribir a agent_runs. `CentinelaBlockedError` para bloqueos semánticos. `cmfDocumentOverrides` vacío (TODO próxima iteración).
- [x] **Worker conectado al centinela_agent** — `runSentinelCheck` eliminado del worker. Centinela se corre dentro del bloque `step===3|0` después del CMF descargado. `orchResult`, `fillStep3` y `fillAllSteps` consumen `centinelaOutput.*`.
- [x] **Fix `technicalError` en sentinel.ts** — Campo `technicalError?: boolean` en `SentinelResult`; catch externo lo marca `true`. `centinela_agent.ts` distingue: técnico → throw Error genérico (reintentable), semántico → `CentinelaBlockedError` (bloquea caso). Antes, API caída o créditos agotados bloqueaban el caso permanentemente.
- [ ] **Probar con Alejandra** — `test_centinela_agent.ts` listo en `casos/alejandra_espinoza/`. Bloqueado: falta CT del SII. Correr cuando llegue la CT: `BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_centinela_agent.ts`

### Agente Mapeador (Step 3)
- [x] **`src/agents/mapeador_agent.ts`** — Wrapper de `cognitive_orchestrator.ts` con idempotencia (hash = centinela run ID), agent_runs (step=3), conversión `OrchestrationResult→MapeadorOutput`. Errores técnicos → failRun+throw (retry). Errores semánticos (missing_document, rut_mismatch) → completeRun con needsLawyerReview. `mapeadorHasBlockers()` helper para el worker.
- [x] **Worker conectado al mapeador_agent** — `runCognitiveOrchestrator` eliminado del worker. Worker llama `runMapeadorAgent` y usa `mapeadorHasBlockers` para decidir si bloquea el Paso 3.
- [x] **`cmfDocumentOverrides` desde el Centinela** — El Centinela extrae monto+fecha de cada cert (260 directos) y los pasa al Mapeador. Implementado y validado con Carlos Uribe (Internacional + CMR Falabella).
- [x] **Fix cognitive_orchestrator — streaming + budget_tokens (2026-06-17)** — `messages.create` → `messages.stream()` + `stream.finalMessage()`. `thinking: { type: 'adaptive' }` → `{ type: 'enabled', budget_tokens: 8000 }`. Resuelve "Unexpected end of JSON input" (Claude consumía todos los tokens en thinking). Texto por cert reducido: 20k→4k chars (orchestrator) y 12k→4k chars (sentinel). Mismo fix ya aplicado a sentinel.ts en sesión anterior.
- [x] **E2E cadena completa (Steps 1→4) — Carlos Uribe (2026-06-17)** — ✅ 5/5: Internacional $19.591.001/02-09-2025 (260), CMR Falabella $1.867.320/05-10-2025 (260), BancoEstado $3.790.012 (261), Santander $5.176.316 (261), Itaú $26.908.918 (261). Primer test con cadena completa tributario→centinela→mapeador→Playwright. DRY_RUN limpió.
- [x] **OCR local multi-página Tesseract (2026-06-17)** — `src/utils/ocr_helper.ts` nuevo con `runOcrOnPdf` (pdftoppm→tesseract spa, todas las páginas) y `extractTextWithOcrFallback`. Reemplaza GS+Vision (página 1 solo) en `sentinel.ts` y `cognitive_orchestrator.ts`. Tributario: OCR-first para CTs escaneadas, Claude Opus solo como fallback. `pdf_analyzer.ts`: 3 funciones aceptan `preExtractedText?` (retrocompatible). Validado con EECC escaneados Cencosud (7432 chars vs 0 antes).
- [x] **Mapeador determinista (2026-06-17)** — `src/utils/deterministic_mapeador.ts` nuevo con `buildMappedDocsDeterministic`. Elimina la segunda llamada LLM (Claude) del Mapeador (~2 min). Mapeo en memoria desde `CentinelaOutput.document_filename` + `client_documents`. 0 tokens de API. `mapeador_agent.ts`: usa determinista por defecto; Claude como fallback con `FORCE_VISION_MAPEADOR=true`. Validado con Carlos Uribe: 10 docs, 0 alertas, milisegundos.
- [x] **E2E cadena completa (Steps 1→4) — Cinthia Rodríguez (2026-06-17)** — ✅ 7/7: Banco Estado $1.290.159 (261), CAR Ripley $1.647.930 (261), CAT/CENCOSUD $6.783.469 (260 CMF), PRESTO LIDER $646.166 (261), CMR Falabella $2.558.037 (260 CMF), Solventa $300.810 (261), Fashion's Park $98.716 (260 NO-CMF). Corregidos 2 bugs: `normInst(null)` en `deterministic_mapeador.ts` y `matchAcreedor(null)` en `step3_acreedores.ts` cuando `AdditionalCreditor.institucion_cmf` es null. CT categoría `ninguna` (escaneada). DRY_RUN limpió.

### Conexión al flujo real
- [x] **Batch completo 10 casos (2026-06-17)** — `casos/run_batch_full_chain.ts` corrió todos los casos no bloqueados. Resultado: ✅ 9 ok, ⏭️ 1 skip (Alejandra sin CT), ❌ 0 errores.
- [x] **Fix parsers nuevos formatos PDF (2026-06-18)**
  - CMF Ley 21.680: columnas a posiciones 0–41 (institución), 42–67 (tipo), 68+ (fecha). Fix `sliceAEnd=42`, `sliceBEnd=68`. Fix stripping de `(N)` global (no solo al final) en nombres de institución.
  - CT 2026 F29: sección F22 aparece después de F29 — `pdf_analyzer.ts` ahora trunca `f29Section` en el límite de F22 para evitar falsos positivos de actividad en `04/2026`.
  - Validados con CT `20260602-232145_carpeta_tributaria.pdf` y CMF `informe_deudas_18680500-3.pdf` (formato nuevo).
- [x] **Worker queue E2E — primer run histórico (2026-06-18)** — Ver P1 completada arriba. Job `d65d7a9f` Cinthia Rodríguez: Steps 1→4, 6/6 acreedores CMF, `status=success`.
- [x] **Test de producción Jaime + Noelia (2026-06-18)** — Pipeline validado sin bypass: Centinela bloqueó en ambos casos por CMF vencido. Jaime: `CMF_EXPIRED` 203d + 2 certs vencidos. Noelia: `CMF_EXPIRED` 191d + 5 certs vencidos + 3 NO-CMF detectados (La Araucana Art.260, Forum Art.260, tarjeta 9782 Art.260). Infra validada: ✅ Anthropic API, ✅ OCR Tesseract, ✅ Centinela por defecto, ✅ upload_documents con client_documents.
- [ ] **Worker + gate + aliases + run real** → ver sección **PRIORIDAD** al inicio del documento.

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
