---
name: renegociacion-automation
description: Guidelines for developing, running, and troubleshooting Playwright automation scripts for the Superintendencia de Insolvencia y Reemprendimiento (Superir) portal.
allowed-tools: Read, Grep, Glob, Bash
---

# Superintendencia Renegotiation Automation Skill

This skill teaches Claude Code how to interact with the modular, hybrid automation scripts of the `renegociacion` project.

## Core Patterns

### 1. Step Isolation
Each step of the renegotiation portal has a dedicated Playwright script in `src/automation/`:
- `login.ts`: RUT + ClaveÚnica login. Handles first-time registration (`/verRegistrarCiudadano`) and terms acceptance.
- `step1_personal.ts`: Fills personal info. Uses direct `form.submit()` bypass if `#confirmarInformacionModal` doesn't appear within 5s.
- `step2_declaraciones.ts`: Extracts tax category from Carpeta Tributaria PDF via `pdftotext`, selects correct radio buttons, uploads PDFs. Auto-cleanup on `DRY_RUN=true`.
- `step3_acreedores.ts`: Full creditor entry — uploads CMF, classifies creditors, fills Obligaciones 260 and Otros Acreedores sections. See Step 3 section below.
- `step4_apoderado.ts`: Fills the representative (apoderado) section.
- `all_steps.ts`: Orchestrates all steps in sequence.

### 2. Bulletproof Selectors & Navigation
- **Do not use coordinates or strict div paths.**
- Always prefer accessibility and ID-based selectors:
  ```typescript
  await page.locator('#btnGuardarEmpresa').click();
  await page.getByRole('button', { name: 'Guardar y Continuar' }).click();
  await rows.nth(i).getByText(/subir documento/i).first();
  ```
- **Timeouts**: Set at least 60s for ClaveÚnica transitions. Portal form saves do a 302 redirect then full page reload — always `waitForLoadState('load')` after modal closes.

### 3. Retry / Resilience Pattern
All critical operations in `step3_acreedores.ts` are wrapped in `withRetry<T>(fn, opts)` (linear back-off, defined at the bottom of the file). Rules:
- **Never swallow errors** — re-throw after max attempts.
- **Idempotency check before retry**: call `isCreditorAlreadyInTable(page, monto, isOtros)` to avoid adding a duplicate if the previous attempt partially succeeded.
- **Page recovery**: `ensureOnAcreedoresPage(page, log)` re-navigates to `verAcreedores` if URL drifted; throws "Sesión expirada" if it hit a login page.

---

## Step 3 — Acreedores: Full Reference

### Portal Structure
The verAcreedores page has two creditor tables:

| Section | Button to open modal | Table ID | Condition |
|---------|---------------------|----------|-----------|
| Obligaciones 260 | `#btnAgregarEmpresa` / `#btnAgregarPersona` | `#tablaAcreedores` | `creditor.overdue90Days > 0` |
| Otros Acreedores | `#btnAgregarEmpresa2` / `#btnAgregarPersona2` | `#tablaOtrosAcreedores` | `creditor.overdue90Days === 0` |

Both sections **share the same modals**: `#modalEmpresa` (empresa) and `#modalPersona` (persona natural). The distinction is only which button opens them.

### Business Rule: 80 UF Validation
`fillStep3` sums `overdue90Days` for all Obligaciones 260 creditors and warns if the total is below **80 UF (~$3,253,000 CLP)**. It does NOT block the run — just logs `⚠️ ADVERTENCIA`.

### Two-Phase Approach
The portal only enables "Subir Documento" links once ALL creditors are in the table. The script therefore:
1. **Phase 1** — Add all creditors (both Obligaciones 260 and Otros Acreedores).
2. **Phase 2** — Attach acreditación documents for each creditor.

### Known Portal Blockers
1. **`#dlgImportante` blocks `#btnGuardarEmpresa`**: After saving a representante legal (`#guardarRep`), the portal shows `#dlgImportante` on top of `#modalEmpresa`, intercepting all pointer events.
   - Fix: `dismissBlockingDialogs(page, log)` — called (a) after `#modalRepresentante` hides, and (b) immediately before clicking `#btnGuardarEmpresa`.
2. **"Subir Documento" is a plain `<a>` without `.btn`**: Use `getByText(/subir documento/i)` — never `a.btn`.
3. **Bootstrap select needs `selectpicker('val', ...)` + `trigger('change')`**: Standard `<select>` change events don't update the visible Bootstrap dropdown. Always call `selectBootstrap(page, id, value)` which wraps both.
4. **Date fields**: `fillDateField` uses jQuery `val()` first (confirmed working), then falls back to `datepicker('setDate', ...)`, then `fill()`, then `pressSequentially`.

### Creditor Matching Logic (in `fillStep3` loop)
```
For each creditor from CMF:
  1. If an acreditación doc exists → scan its PDF for RUTs → match against catalog by RUT
     (skips client's own RUT, uses isValidRut() guard)
  2. Fallback → matchAcreedor(name, catalog) → fuzzy name match with ALIASES
  3. If not_found or ambiguous → skip + add to report.skipped
```
Alias map in `acreedor_matcher.ts`: `'presto lider'` → `'tarjeta lider'`, `'bci'` → `'banco de credito e inversiones'`, etc.

### Modal Fields Reference (`#modalEmpresa`)
```
#empresaRutDv            → RUT (search trigger: #buscarEmpresa)
#empresaNombre           → nombre (autofilled after search, may be readonly)
[name="empresaAcreedor.direccion"]
#empresaRegion           → Bootstrap select (region)
[name="empresaAcreedor.comuna"] → Bootstrap select (commune, dynamic)
[name="empresaAcreedor.notificacionEmail"]
[name="empresaAcreedor.notificacionTelefono"]
[name="empresaAcreedor.deudaMonto"] → total credit amount
#empresaAcreedorFchCuotaImpaga    → vencimiento date (dd/mm/yyyy)
#agregarRepresentanteLegalEmpresa → opens #modalRepresentante
#btnGuardarEmpresa        → saves and closes modal (302 redirect)
```

### DRY_RUN Cleanup
If `DRY_RUN !== 'false'`, after taking a screenshot the script:
1. Calls `dismissOpenModal` + `dismissBlockingDialogs` to clear any open state.
2. Deletes all rows from `#tablaAcreedores` and `#tablaOtrosAcreedores` (confirms via `#btnConfirmarModal`).
3. Deletes the Informe CMF upload.
4. Takes a clean-state screenshot.

---

## Cognitive Orchestrator — Mente Pensante

`src/utils/cognitive_orchestrator.ts` audita los certificados de acreditación usando Claude **antes** de que el Paso 3 los adjunte al portal. Se invoca con:

```typescript
import { runCognitiveOrchestrator } from '../utils/cognitive_orchestrator';
const result = await runCognitiveOrchestrator(client, cmfLocalPath, supabase, logger);
```

### Resultado esperado (`OrchestrationResult`)
```typescript
{
  status: 'success' | 'error',
  reason?: string,                      // solo si status === 'error'
  documentMapping: CognitiveCreditorMapping[], // por institución
  alerts: CognitiveAlert[],             // expired_cmf, expired_certificate, missing_document…
  mappedDocs?: AcreditacionDoc[]        // listos para attachDocuments() en step3
}
```

### Cuándo llamarlo
- Antes de `fillStep3`, para validar documentos frescos (<30 días).
- Si `result.status === 'error'`, abortar o alertar al supervisor; no continuar adjuntando.
- Si `result.status === 'success'`, pasar `result.mappedDocs` a `attachDocuments()`.

### Modelo y configuración
- Modelo: `claude-sonnet-4-5-20250929` con `thinking: { type: 'enabled', budget_tokens: 2048 }`.
- Requiere `ANTHROPIC_API_KEY` en `.env`. Si falta, retorna `status: 'error'` con alerta `'other'` — no lanza excepción.
- PDFs cacheados en `outputs/acreditaciones_tmp/` para evitar descargas repetidas.

### Reglas de auditoría inyectadas
1. **30 días** — CMF y certificados vencen en 30 días desde hoy (Chile). Alerta: `expired_cmf` / `expired_certificate`.
2. **Art 260 vs 261** — morosidad ≥90 días requiere monto+vencimiento; deuda al día solo requiere monto.
3. **Mapeo por nombre** — asocia archivos a acreedores del CMF (fuzzy, normalizado).
4. **Validación RUT** — verifica RUT del emisor del certificado.

---

## Troubleshooting Guide

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `#btnGuardarEmpresa` timeout | `#dlgImportante` blocking pointer events | Check for `.modal.show` overlays; call `dismissBlockingDialogs` before click |
| "Subir Documento" not found | Selector uses `a.btn` | Change to `getByText(/subir documento/i)` |
| Document attach fails for first N-1 creditors | Portal only enables button after ALL creditors added | Ensure two-phase approach: add all first, then attach |
| Modal stays open after save | Validation error in a field | Check `.is-invalid` classes on inputs; review `fillDateField` result |
| `Comuna X no está en el listado` | `getRegionValue(entrada.comuna)` returns null | Add the missing commune to the `REGION_MAP` in `acreedor_matcher.ts` |
| `Sesión expirada` error | Portal redirected to login mid-session | Re-run from login; check ClaveÚnica session duration |
| Duplicate creditor rows after retry | Idempotency check missing | `isCreditorAlreadyInTable` must be called at start of each retry attempt |

---

## Example File Structure
```
src/automation/
  login.ts
  step1_personal.ts
  step2_declaraciones.ts
  step3_acreedores.ts      ← main creditor entry script
  step4_apoderado.ts
  all_steps.ts
src/utils/
  acreedor_matcher.ts          ← catalog lookup, normalizeRut, isValidRut, ALIASES
  cmf_analyzer.ts              ← extractCreditors, CmfCreditor.overdue90Days
  pdf_analyzer.ts              ← extractTextFromPdf, analyzeTaxCategory
  cognitive_orchestrator.ts    ← runCognitiveOrchestrator (Mente Pensante / Claude AI)
  date_helper.ts               ← getCurrentChileDate, getDaysDifference, parseDateString
  browser.ts                   ← launchBrowser, screenshotOnFailure
  alerts.ts                    ← createAlert, clearAlert
src/index.ts               ← CLI runner
src/worker.ts              ← job queue daemon
```
