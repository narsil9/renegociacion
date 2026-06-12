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

---

## En Curso — Caso Claudia Silva (cliente sin mora en CMF, con estados de cuenta)

El caso de Claudia representa el flujo donde el CMF no muestra mora ≥ 91 días, pero los documentos adicionales (estados de cuenta) sí la prueban. Este flujo aún no está implementado y es el siguiente paso.

### Paso 1 — Subir estados de cuenta de Claudia al perfil de prueba
- [ ] **Obtener archivos de estados de cuenta de Claudia** — el abogado debe proporcionar los PDFs de tarjeta de crédito y/o crédito de consumo que prueban mora ≥ 91 días.
- [ ] **Subirlos a Supabase Storage** bajo el prefijo `patricio_martini/` (bucket `documentos`), con nombres descriptivos (ej. `estado_cuenta_tarjeta.pdf`, `estado_cuenta_consumo.pdf`).
- [ ] **Registrarlos en `client_documents`** con `client_id = a9ddf715-3bdf-4377-8cb3-2d467089227d`, `acreditacion_tipo = 'estado_cuenta'`, `institucion_cmf` = nombre del banco correspondiente.

### Paso 2 — Agregar lógica de reclasificación al Centinela (`sentinel.ts`)
El sentinel ya descarga los estados de cuenta y los envía a Claude, pero el system prompt no incluye el algoritmo para calcular mora desde ellos ni devuelve reclasificaciones. Hay que:
- [ ] **Actualizar el system prompt de `sentinel.ts`** — incorporar el algoritmo de `API1_instructions.md`: detectar mora desde estados de cuenta (pago realizado < mínimo para tarjetas; reconstrucción hacia atrás de cuotas para crédito de consumo). Indicar a Claude que si detecta mora ≥ 91 días en un estado de cuenta, debe declarar ese acreedor como reclasificado a `obligaciones_260` aunque el CMF muestre 0.
- [ ] **Ampliar `SentinelResult`** — agregar campo `reclassifiedCreditors: ReclassifiedCreditor[]` con la lista de acreedores que cambian de `otros_acreedores` → `obligaciones_260` por análisis de estados de cuenta, incluyendo la fecha de inicio de mora calculada y los días.
- [ ] **Actualizar el pre-análisis TypeScript en `sentinel.ts`** — para estados de cuenta (`acreditacion_tipo = 'estado_cuenta'`), agregar en `localAnalysis` un flag explícito: "este documento requiere que Claude calcule la mora desde el historial de pagos".

### Paso 3 — Aplicar reclasificación en el worker antes del Step 3
Cuando el sentinel devuelve `reclassifiedCreditors` no vacío, el worker debe informarle al Step 3 cuáles acreedores cambian de categoría:
- [ ] **`worker.ts`**: después de `runSentinelCheck`, si `result.reclassifiedCreditors.length > 0`, guardar la lista en una variable y pasarla a `fillStep3`.
- [ ] **`step3_acreedores.ts`**: recibir un parámetro opcional `reclassifiedCreditors`. Al clasificar acreedores de la CMF, si un acreedor figura en `reclassifiedCreditors`, forzar su categoría a `obligaciones_260` (independiente de lo que diga el CMF).

### Paso 4 — Probar con `ENABLE_SENTINEL=true` y `BYPASS_DATE_CHECK=true`
- [ ] **Ejecutar sentinel aislado** primero: `npx ts-node -r dotenv/config src/utils/test_sentinel_claudia.ts` (script de prueba que llama solo a `runSentinelCheck` e imprime el resultado).
- [ ] **Verificar output JSON del sentinel**: ¿detecta mora ≥ 91 días en los estados de cuenta? ¿Reclasifica correctamente?
- [ ] **Ejecutar E2E completo** (paso 0) con `ENABLE_SENTINEL=true BYPASS_DATE_CHECK=true` y el perfil de Claudia.
- [ ] **Verificar en el portal** que los acreedores reclasificados queden en Obligaciones 260 y los no reclasificados en Otros Acreedores.

---

## Pendientes (post-Claudia)

### Técnico / Robot
- [ ] **Run mecánico completo de Patricio con `BYPASS_DATE_CHECK=true`** — Probar 1→4 con documentos vencidos para verificar flujo mecánico. Resolver `missing_document` de PRESTO LIDER (cert "Deuda Castigada" sin fecha de vencimiento).
- [ ] **Run real 1→4 con documentos frescos (<30 días)** — CMF + certs actuales. Ver memoria `project_expired_test_fixtures`.
- [ ] **ClaveÚnica de Miled** — `Miled12345` es inválida. Pendiente clave real para reintentar.
- [ ] **Prueba con cliente de Primera Categoría** — Verificar `BlockedError` + F29 check funciona cuando el cliente SÍ tiene actividad F29 en los últimos 24 meses.
- [ ] **Verificar categoría tributaria de Patricio Martini** — En E2E 2026-06-09 la categoría fue `ninguna`. Confirmar si es real o PDF escaneado.

### Arquitectura — Mejoras futuras
- [ ] **Dashboard integration para API Key #1** — Actualmente el sentinel solo corre en el worker. Próximo paso: exponer el análisis del sentinel como respuesta inmediata en `/api/subir-caso` (POST) para que el abogado reciba el diagnóstico en el Dashboard en el momento de la carga, antes de encolar el job.
- [ ] **(Opcional) Veto determinista fase 2** — Bloquear fallos estructurales inequívocos aunque Claude diga `success`. No implementado por riesgo de falsos positivos.
- [ ] **Implementar no-CMF creditors** — TGR, Tenpo, deudas castigadas. `fillStep3` solo itera CMF creditors; el flujo no-CMF no está construido.

### Deuda técnica
- [ ] **Commit cambios acumulados** — Los siguientes archivos tienen cambios sin commitear desde sesiones previas:
  - `src/automation/step1_personal.ts` — `page.once` en lugar de `page.on`; error log mejorado
  - `src/automation/step3_acreedores.ts` — `dateDaysAgo` con timezone Chile; `totalCredito` en vez de `overdue90Days` para 80 UF
  - `src/utils/pdf_analyzer.ts` — nueva función `detectF29ActivityLast24Months`
  - `src/utils/cognitive_orchestrator.ts` — soporte imágenes, extracción fechas, MIME detection, 80 UF no bloqueante, exención estado_cuenta
  - `src/utils/cmf_analyzer.ts` — `qualifying90PlusCount`, parser hasDates=false, fix 80 UF con totalCredito
  - `src/utils/sentinel.ts` — archivo nuevo (API Key #1 Centinela)
  - `src/worker.ts` — `BlockedError`, F29 check, llamada al sentinel
  - `API1_instructions.md` — instrucciones completas API Key #1
- [ ] **Limpiar utils de prueba** (`src/utils/`) — ~50 scripts de diagnóstico (inspect_*, check_*, test_*, migrate_*, scan_*) que nunca se commitearán. Evaluar cuáles quedan en el repo.

---

## Resumen de la arquitectura de API Keys

| Momento | Quién actúa | Qué hace |
|---|---|---|
| Carga de documentos (Dashboard) | TypeScript + API Key #1 (Sentinel) | Valida antigüedad, mora ≥ 91d (CMF + estados de cuenta), ≥ 2 productos, ≥ 80 UF, reclasifica acreedores. Bloquea si falla. |
| Antes del Paso 3 (Worker) | TypeScript + API Key #2 (Cognitive Orchestrator) | Re-corrobora antigüedad, RUT, mapeo certificado → acreedor, presencia monto/vencimiento. Devuelve `mappedDocs` para Playwright. |
| Paso 3 (Playwright) | Playwright | Ejecuta la entrada de datos en el portal usando `mappedDocs` y la clasificación reclasificada. |
