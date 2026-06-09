# Tareas: Automatización Superir — Estado Actual

## Completadas (sesiones anteriores)

- [x] **CMF Analyzer** — normalización diacríticos, extracción `overdue90DaysTotal`, mapeo columnas dinámico, validación 80 UF
- [x] **Alerts** — `createAlert`/`clearAlert` con `clientsTable`, formato `credential_error`
- [x] **Login** — `CredentialError` tipada, selectores exactos, fallback error genérico
- [x] **Worker** — `instanceof CredentialError`, `alertType` por `.code`
- [x] **Steps 2 y 4** — URL check antes de `waitForSelector`, `logger?.error()` en catch
- [x] **Step 3 Playwright** — `:not(.hidden)` en CMF, timeouts extendidos, estabilización post-cleanup
- [x] **Datos sandbox** — tabla `client_documents` migrada, 12 registros Patricio Martini
- [x] **Cognitive Orchestrator** — soporte de imágenes (JPG/PNG), extracción de fechas desde texto, MIME detection
- [x] **F29 Activity Check** — `detectF29ActivityLast24Months` en `pdf_analyzer.ts` + `BlockedError` en `worker.ts`
- [x] **`dateDaysAgo` timezone** — usa `America/Santiago` en `step3_acreedores.ts`
- [x] **Prueba E2E completa** — Pasos 1→2→3→4 para Patricio Martini: ✅ 4/4 exitosos (2026-06-09)

---

## Pendientes

- [ ] **Commit cambios acumulados** — Los siguientes archivos tienen cambios sin commitear:
  - `src/automation/step1_personal.ts` — `page.once` en lugar de `page.on`; error log mejorado
  - `src/automation/step3_acreedores.ts` — `dateDaysAgo` con timezone Chile
  - `src/utils/pdf_analyzer.ts` — nueva función `detectF29ActivityLast24Months`
  - `src/utils/cognitive_orchestrator.ts` — soporte imágenes, extracción fechas, MIME detection
  - `src/worker.ts` — `BlockedError`, F29 check para Primera Categoría, log model name correcto

- [ ] **Verificar categoría tributaria de Patricio Martini** — En la prueba E2E de 2026-06-09 la categoría fue `ninguna`. Confirmar si el cliente es efectivamente sin categoría o si la Carpeta Tributaria tiene texto no extraíble (PDF escaneado). Si tiene categoría, registrar override en Supabase o reemplazar el PDF.

- [ ] **Limpiar utils de prueba** (`src/utils/`) — Hay ~50 scripts utilitarios de diagnóstico (inspect_*, check_*, test_*, migrate_*, scan_*) que nunca se commitearán. Evaluar si algunos deben quedar en el repo o borrarlos.

- [ ] **Prueba con cliente de Primera Categoría** — Verificar que el `BlockedError` + F29 check funcione correctamente cuando el cliente SÍ tiene actividad F29 en los últimos 24 meses.
