# Tareas: Corrección de Errores en Automatización y CMF Analyzer

- [x] **1. CMF Analyzer**
  - [x] Implementar normalización de diacríticos para búsquedas internas (BUG-11)
  - [x] Implementar extracción de `overdue90DaysTotal` basada en anclas y fallback (BUG-10)
  - [x] Implementar mapeo de columnas dinámico y check de sanidad para `directOverdue90Days` (BUG-01)
  - [x] Sumar deuda directa e indirecta para validación de 80 UF (BUG-02)

- [x] **2. Utilidad de Alertas** — `src/utils/alerts.ts`
  - [x] `createAlert` y `clearAlert` ya aceptan `clientsTable` como parámetro (BUG-20)
  - [x] `credential_error` ya concatena tipo y mensaje: `` `${tipo}: ${mensaje}` `` (BUG-19)

- [x] **3. Login y Detección de ClaveÚnica** — `src/automation/login.ts`
  - [x] Clase `CredentialError` con `.code` tipado ya definida y exportada (BUG-12 / BUG-16)
  - [x] Selectores de texto ya usan comillas exactas: `text="Datos de acceso no válidos"` (BUG-15)
  - [x] El `else` final lanza `Error` genérico para portal caído / timeout (BUG-14)
  - [x] Catch block ya usa `logger.error()` con fallback a `console.error` (BUG-21)

- [x] **4. Worker** — `src/worker.ts`
  - [x] Importar `CredentialError` desde `./automation/login` y reemplazar `err.message?.includes('Alerta:')` por `err instanceof CredentialError` en líneas 484 y 544 (BUG-12 / BUG-16)
  - [x] Reemplazar detección de `alertType` por `lastError.code` y `lastError.message` de `CredentialError` — eliminar el string matching en español de líneas 549–551 (BUG-16)

- [x] **5. Script de Migración** — `src/utils/migrate_credential_error.ts`
  - [x] Eliminar `rejectUnauthorized: false` o reemplazar conexión `pg` directa por el cliente Supabase (BUG-22)

- [x] **6. Script de Pruebas de Credenciales** — `src/utils/test_invalid_credentials.ts`
  - [x] Corregir parseador de `.env`: `split('=')[1]` → `slice(key.length + 1)` para soportar contraseñas/API keys con `=` (BUG-13)
  - [x] Añadir `await new Promise(r => setTimeout(r, 5000))` después de `pm2 restart` (BUG-17)
  - [x] Filtrar borrado de jobs previos solo a estados terminales: `.in('status', ['pending', 'success', 'failed'])` (BUG-18)

- [x] **7. Pasos de Automatización — Steps 2 y 4** (Step 3 ya corregido)
  - [x] Step 2 (`step2_declaraciones.ts` línea 37–39): mover URL check antes del `waitForSelector` (BUG-09)
  - [x] Step 2 (`step2_declaraciones.ts` línea 193): reemplazar `console.error` por `logger?.error()` (BUG-08)
  - [x] Step 4 (`step4_apoderado.ts` línea 26–28): mover URL check antes del `waitForSelector` (BUG-09)
  - [x] Step 4 (`step4_apoderado.ts` línea 76): reemplazar `console.error` por `logger?.error()` (BUG-08)

- [x] **8. Step 3 — Fixes de Playwright** — `src/automation/step3_acreedores.ts`
  - [x] Línea 114: agregar `:not(.hidden)` al selector de confirmación de subida CMF — `#btnEliminarCMF:not(.hidden), #btnVerCMF:not(.hidden)` (BUG-05)
  - [x] `cleanupAcreedores` línea 548 y `cleanupCMF` línea 567: aumentar timeout de `#btnConfirmarModal` de `5000` a `15000` ms (BUG-06)
  - [x] `cleanupCMF` (tras línea 573): agregar `await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 20000 }).catch(() => {})` después de `waitForLoadState('load')` (BUG-07)

- [x] **9. Datos de Clientes en Storage / Sandbox**
  - [x] `acreditacion_documentos_json` de Patricio Martini: registrar los 4 archivos `cert_X.pdf` huérfanos como entradas `tipo_documento: 24` — `cert_banco_estado.pdf`, `cert_bci.pdf`, `cert_bci_lider.pdf`, `cert_santander.pdf` (DATO-01)
  - [x] Agregar campos `filename` y `uploaded_at` a cada entrada del JSONB para trazabilidad (DATO-02)
  - [x] (Producción) Migrar de `acreditacion_documentos_json` (JSONB plano) a tabla `client_documents` con columnas `document_type`, `acreditacion_tipo`, `institucion_cmf`, `storage_path`, `filename`, `uploaded_at` (DATO-03)

- [x] **10. Compilación y Verificación**
  - [x] Ejecutar `npm run build` para asegurar compilación limpia
  - [x] Ejecutar `npx ts-node -r dotenv/config src/utils/test_cmf_parser.ts` y validar resultados
  - [x] Ejecutar `npx ts-node -r dotenv/config src/utils/test_invalid_credentials.ts` y validar flujo E2E

