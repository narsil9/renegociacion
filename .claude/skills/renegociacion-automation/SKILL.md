---
name: renegociacion-automation
description: Guidelines for developing, running, and troubleshooting Playwright automation scripts for the Superintendencia de Insolvencia y Reemprendimiento (Superir) portal.
allowed-tools: Read, Grep, Glob, Bash
---

# Superintendencia Renegotiation Automation Skill

This skill teaches Claude Code how to interact with the modular, hybrid automation scripts of the `renegociacion` project.

> **🔗 North star (read first):** This automation is the **downstream executor** of a two-layer pipeline. The supervisor's dashboard (SuperWhisp, prod `ton…`) collects + classifies the client's documents and, when ready, the lawyer hits **Ejecutar** (= enqueues a job) → **our worker** runs Steps 1→4 on the portal. Build every change with that seam in mind (worker = job-triggered executor; input eventually sourced from `ton…` by RUT). Full detail in CLAUDE.md → "🔗 Integración futura — Convergencia con el dashboard del supervisor". Don't write to `ton…` until the governance decision is made.

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
| Obligaciones 260 | `#btnAgregarEmpresa` / `#btnAgregarPersona` | `#tablaAcreedores` | `overdue90Days > 0` **OR** reclassified by Sentinel |
| Otros Acreedores | `#btnAgregarEmpresa2` / `#btnAgregarPersona2` | `#tablaOtrosAcreedores` | `overdue90Days === 0` AND not reclassified |

**`isOtros` se calcula siempre como:**
```typescript
const isOtros = creditor.overdue90Days === 0 && !isReclassifiedTo260(creditor);
```
Este valor se pasa explícitamente a `addEmpresaAcreedor`, `addPersonaAcreedor` y `attachDocumentoAcreedor`. **Nunca recalcular `isOtros` desde `overdue90Days` dentro de esas funciones** — el CMF puede mostrar $0 en mora aunque el Sentinel haya detectado 91+ días en los documentos.

Both sections **share the same modals**: `#modalEmpresa` (empresa) and `#modalPersona` (persona natural). The distinction is only which button opens them.

### Monto y vencimiento "según el documento" (override del CMF)
`addEmpresaAcreedor`/`addPersonaAcreedor` reciben `fechaVencimientoOverride?` (dd/mm/yyyy). El monto se ingresa desde `creditor.totalCredito`, que puede ser el **monto efectivo** (del documento) en vez del CMF:
- Reclasificados → `total_credito_clp` + `delinquency_start_date` (del Sentinel).
- No-CMF → `total_credito_clp` + `delinquency_start_date` (solo 260).
- 260 directos del CMF → `cmfDocumentOverrides` (param de `fillStep3`; hoy solo el test lo provee).
- **Regla de oro del monto efectivo**: si el monto del documento sobrescribe al del CMF, se construye un `creditorEff = { ...creditor, totalCredito: montoEfectivo }` y se usa ese en `isCreditorAlreadyInTable` Y en la adjunción (`attachDocumentoAcreedor`). Ambos matchean por monto: si la fila se crea con el monto del documento pero el attach busca el del CMF, **no encuentra la fila**.
- `toPortalDate(YYYY-MM-DD | dd/mm/yyyy)` convierte al formato del portal; si no reconoce el formato, el caller cae al placeholder `dateDaysAgo(90)`. 261 no requiere vencimiento real (usa placeholder).

### Business Rule: Requisito de sesión (2 productos + 80 UF)
Para que el cliente califica para iniciar la sesión de renegociación deben cumplirse **ambas** condiciones:

1. **Mínimo 2 productos con mora ≥ 91 días**: Al menos 2 líneas en el CMF con `overdue90Days > 0`. Los 2 productos pueden ser del **mismo banco** (ej. crédito consumo + tarjeta del mismo banco).
2. **Suma de `totalCredito` de esos productos ≥ 80 UF (~$3.253.000 CLP)**: Se usa `totalCredito`, no el monto atrasado.

`fillStep3` ya suma `totalCredito` correctamente y registra `⚠️ ADVERTENCIA` si no alcanza 80 UF. El chequeo de **mínimo 2 productos** aún no está implementado en código — está pendiente en `task.md`.

### Two-Phase Approach
The portal only enables "Subir Documento" links once ALL creditors are in the table. The script therefore:
1. **Phase 1** — Add all creditors (both Obligaciones 260 and Otros Acreedores).
   - **1a** — CMF creditors (loop over `creditors`).
   - **1a-bis** — NON-CMF creditors (`additionalCreditors` del Sentinel). Se sintetiza un `CmfCreditor` (las funciones del portal solo leen `totalCredito`), se resuelve el catálogo con `matchAcreedor(institucion_cmf)`, y se agrega con `isOtros = categoria_articulo === 261`. Cada uno se loguea como "ACREEDOR NO-CMF (requiere confirmación abogado)".
2. **Phase 2** — Attach acreditación documents for each creditor.
   - **Matching por `filename` para NO-CMF**: cada acreedor NO-CMF asocia su documento por `AcreditacionDoc.filename === additionalCreditor.document_filename` (NO por institución). Los acreedores del CMF **excluyen** los filenames reservados a NO-CMF (`reservedNonCmfFilenames`). Esto evita que productos del mismo banco se crucen el certificado (ej. el CPF de las tarjetas vs. el `consultaCredito` del consumo, todos "Banco de Chile"). **Requiere que el orquestador pueble `AcreditacionDoc.filename`.**
   - **Art.260 = adjuntar el MISMO doc dos veces (tipo 22 + tipo 23)**: los acreedores 260 suben el certificado una vez como "Acredita Monto" (22) y otra como "Acredita Vencimiento" (23), como el abogado. `neededTipos = isOtros ? [22] : [22,23]`; se fuerza el `tipo_documento` del `AcreditacionDoc` base (que puede venir como 24) a cada tipo. Los 261 suben solo tipo 22. `attachDocumentoAcreedor` distingue por el texto del tipo, así ambos adjuntos conviven.

### CMF Consolidation Patterns

El CMF puede presentar los acreedores de dos formas distintas que afectan directamente cuántas filas crea el robot en el portal:

**Patrón A — Múltiples productos del mismo banco en UNA sola fila CMF**
Cuando el CMF tiene un solo tipo de producto (ej. todos "Consumo"), todos los créditos del banco van en una fila. El portal solo recibe UNA entrada para ese banco.
- Ejemplo: Banco Itaú Chile tiene 3 productos (consumo + tarjeta + línea) → CMF muestra 1 fila `[Consumo]` con $5.072.748 total.
- El certificado que se adjunta debe cubrir todos los productos (ej. Cartera Vencida con páginas por producto).
- El monto a declarar = suma de los certificados individuales (puede diferir del CMF por intereses).

**Patrón B — Dos filas del mismo banco por tipo distinto (ej. Banco Estado Vivienda + Consumo)**
El CMF separa por tipo (`Vivienda` vs. `Consumo`), generando dos filas y dos entradas en el portal.
- `findAcreditacionDocs('Banco Estado', docs)` devuelve TODOS los docs con `institucion_cmf: 'Banco Estado'`.
- `attachDocumentoAcreedor` usa el **monto** como key para encontrar la fila correcta → un doc puede cubrir ambas filas si se adjunta secuencialmente.
- Si un solo documento (ej. captura del portal) muestra los dos productos, registrarlo UNA vez en `MAPPED_DOCS` es suficiente — fillStep3 lo adjuntará a cada fila por monto.

**Patrón C — Un certificado de liquidación cubre N créditos del mismo banco (multiproducto)**
Un certificado de liquidación/portabilidad puede listar VARIOS créditos del deudor (ej. Santander: 3 créditos de consumo). El Centinela (REGLA 9) emite **un `cmfDocumentOverride` por producto** (sufijo del producto entre paréntesis en `institucion_cmf`). `step3` agrupa por institución base (`overrideBaseKey`); si hay ≥2 overrides → **multiproducto**: omite la institución en el loop principal y crea **una fila 260 por producto** con su "Monto total a pagar" (NO un monto consolidado, NO el "Saldo del crédito").
- **"VARIOS DEUDORES"/"OTROS DEUDORES" SÍ se declaran** (deuda directa del deudor como titular junto a otros — regla del abogado, 2026-06-23). **Excluir** solo la deuda **indirecta** (codeudor/fiador/aval de un *tercero*) y los montos **triviales** (< 1 UF, remanentes/comisiones).
- ⚠️ **CMF parte un crédito en 2 filas**: la misma operación puede aparecer como `mora` + `vigente` (misma fecha de otorgamiento). Es UN crédito → se declara UNA vez al payoff total. Declarar la porción vigente aparte = doble conteo. (Caso Gabriel Santander: op ...258302 = $2.929.423 mora + $8.665.385 vigente → 1 fila a $12.821.458.)
- **`clearExistingAcreedores`** corre al inicio del llenado: borra ambas tablas para que cada corrida REEMPLACE en vez de APILAR (montos levemente distintos entre runs burlaban el dedup por monto).

**Patrón C — `getReclassifiedMatch` con tiebreaker**
Si el Sentinel reclasifica dos productos del mismo banco (ej. BdCh consumo + BdCh tarjeta ambos reclasificados), el match por nombre devolvería ambos. Se usa el `totalCredito` más cercano como desempate: la brecha entre productos distintos (rango de millones) siempre supera la brecha CMF/doc ($300–500k), por lo que el tiebreaker es unambiguo.

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
     (skips client's own RUT, uses isValidRut() guard) → OVERRIDES name match
  2. Fallback → matchAcreedor(name, catalog) → fuzzy name match with ALIASES
  3. If not_found or ambiguous → skip + add to report.skipped
```
Alias map en `acreedor_matcher.ts` (clave normalizada → nombre_normalizado del catálogo):
```
'presto lider'  → 'tarjeta lider'
'presto'        → 'tarjeta lider'
'tarjeta presto'→ 'tarjeta lider'
'lider'         → 'tarjeta lider'
'bci'           → 'banco de credito e inversiones'
'santander'     → 'banco santander'
'car ripley'    → 'car s a tarjeta ripley'   ← CMF llama "CAR - Ripley", catálogo: "CAR S.A. (Tarjeta Ripley)"
'car'           → 'car s a tarjeta ripley'
```
**Por qué monto NO se usa en el matching del Sentinel**: El CMF corta datos con hasta 2-3 semanas de retraso respecto a los documentos del banco. El mismo acreedor puede aparecer con $38.9M en el CMF y $48.2M en el informe de crédito → diferencia de millones → `montoMatch` con tolerancia absoluta siempre fallará. Se usa solo `nameMatch` (contención de tokens normalizados).

**RUT-from-text utilities (single source of truth, `acreedor_matcher.ts`)**:
- `extractRutsFromText(text)` → normalized RUTs found in a document's text.
- `findCatalogEntryByRut(ruts, catalog, clientRut?)` → catalog entry whose RUT matches, skipping the client's RUT.
Used by both `step3_acreedores.ts` (`detectCreditorRutFromDoc`) and the Cognitive Orchestrator's deterministic RUT pre-check. The RUT in the certificate is authoritative — it overrides whatever bank name was assigned.

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

## Sentinel — Centinela de Carga (API Key #1)

`src/utils/sentinel.ts` — pre-validación que corre **antes** del Orquestador Cognitivo (API Key #2) y antes de Playwright.

### Propósito
El CMF puede tener datos con retraso de 2-3 semanas. El Sentinel analiza los documentos bancarios para:
1. **`reclassifiedCreditors`**: Detectar deudas que el CMF marca con $0 mora pero que los documentos prueban como ≥91 días → reclasificar de Art. 261 a Art. 260.
2. **`identified261Creditors`**: Confirmar deudas que sí son Art. 261 (vigentes, sin mora).

### Interfaces clave
```typescript
export interface ReclassifiedCreditor {
  bank: string;
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'otro';
  institucion_cmf: string;        // debe coincidir con nombre en CMF
  delinquency_start_date: string; // YYYY-MM-DD primera cuota impaga
  delinquency_days: number;
  total_credito_clp: number;
  new_classification: 'obligaciones_260';
  reason: string;
  document_filename: string;
}

export interface Identified261Creditor {
  bank: string;
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'otro';
  institucion_cmf: string;
  total_credito_clp: number;
  reason: string;
  document_filename: string;
}

// Acreedor que NO está en el CMF pero debe declararse (TGR, cajas, fintechs, tarjetas).
// Detección: pre-pase determinista (diff doc−CMF, `issuerInCmf`) + Claude confirma/extrae.
export interface AdditionalCreditor {
  bank: string;
  institucion_cmf: string;
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'tgr' | 'caja_compensacion' | 'otro';
  categoria_articulo: 260 | 261;
  total_credito_clp: number;
  delinquency_start_date?: string;   // solo si 260
  delinquency_days?: number;          // solo si 260
  reason: string;
  document_filename: string;
  needs_lawyer_confirmation: boolean; // siempre true en esta fase
}

// Fecha clave determinista (sin Claude), no bloqueante.
export interface FechaClave {
  tipo: 'expiracion_cmf' | 'expiracion_certificado' | 'cruce_261_a_260';
  referencia: string; fecha: string; diasRestantes: number; detalle: string;
}
```
`SentinelResult` ahora incluye `additionalCreditors?: AdditionalCreditor[]` y `fechasClave?: FechaClave[]`. Ver [Step 3 — Acreedores NO-CMF en CLAUDE.md] para el flujo completo worker → orquestador → fillStep3.

### Activación
- `ENABLE_SENTINEL=true` en `.env` → activo.
- `BYPASS_DATE_CHECK=true` → salta alertas de fecha (no bloquea por docs vencidos).
- Si el Sentinel bloquea (documentos deficientes), el worker registra una `automation_alert` y marca el job como `failed` **sin** continuar.

### Caso real: Claudia Silva
- CMF (corte 08/11/2024): Banco de Chile $0 mora, Ripley $479.941 mora (solo 66 días en esa fecha).
- Al 03/12/2024: Banco de Chile Consumo = 91 días (Sentinel detecta desde Informe de Crédito).
- Al 03/12/2024: CAR Ripley = 100 días (Sentinel detecta desde ECs Agosto-Noviembre).
- Ambos pasan a `reclassifiedCreditors` → `fillStep3` los ingresa en `#tablaAcreedores` (Art. 260).

### Test sin créditos de API
```bash
BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config src/utils/test_step3_claudia.ts
```
El script hardcodea los resultados de ambas APIs y ejecuta Playwright real. Ver `claudia_test_mapping.md` para los valores exactos.

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
  mappedDocs?: AcreditacionDoc[],       // listos para fillStep3() como acreditacionDocs
  technicalError?: boolean
}
```

### Firma actual (con datos del Sentinel)
```typescript
runCognitiveOrchestrator(
  client, cmfLocalPath, supabase, logger,
  sentinelReclassified?: SentinelReclassifiedCreditor[],
  sentinelIdentified261?: SentinelIdentified261Creditor[]
): Promise<OrchestrationResult>
```
El Orquestador recibe los datos del Sentinel como contexto para la IA — Claude actúa como segunda línea de control que corrobora lo que el TS ya calculó determinísticamente.

### Cuándo llamarlo
- Antes de `fillStep3`, para validar documentos frescos (<30 días).
- Si `result.status === 'error'`, abortar o alertar al supervisor; no continuar adjuntando.
- Si `result.status === 'success'`, pasar `result.mappedDocs` a `fillStep3(..., acreditacionDocs, reclassifiedCreditors)`.

### Modelo y configuración
- Modelo: `claude-sonnet-4-5-20250929` con `thinking: { type: 'enabled', budget_tokens: 2048 }`.
- Requiere `ANTHROPIC_API_KEY` en `.env`. Si falta, retorna `status: 'error'` con alerta `'other'` — no lanza excepción.
- PDFs cacheados en `outputs/acreditaciones_tmp/` para evitar descargas repetidas.

### Reglas de auditoría inyectadas
1. **30 días** — CMF y certificados vencen en 30 días desde hoy (Chile). Alerta: `expired_cmf` / `expired_certificate`.
2. **Art 260 vs 261** — morosidad ≥90 días requiere monto+vencimiento; deuda al día solo requiere monto.
3. **Mapeo por nombre** — asocia archivos a acreedores del CMF (fuzzy, normalizado).
4. **Validación RUT** — verifica RUT del emisor del certificado. Alerta bloqueante `rut_mismatch` si no corresponde al banco asignado.

### Patrón TS-determinista → Claude-corrobora
El orquestador arma un `localAnalysis` (pre-cálculo TS) y se lo pasa a Claude, que es la **segunda línea de control**. El TS calcula determinísticamente: requisitos 90d/80UF, antigüedad (CMF + certs de texto), presencia monto+vencimiento por acreedor (`cumpleRequisitosAcreditacion`) y el **pre-chequeo de RUT** por certificado (`computeRutCheck` → `rutCheckTypeScript`, `rutMismatch`, `bancoSegunRut`).
- Certificados **imagen**: TS no puede leer fecha/RUT → marcados "Claude debe verificar". Sin falsos positivos.
- **`BYPASS_DATE_CHECK=true`** omite SOLO alertas de antigüedad; estructurales (`missing_document`, `rut_mismatch`, `amount_mismatch`) siempre bloquean. Útil para pruebas mecánicas con fixtures vencidos.

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
| Sentinel-reclassified creditor ends up in Otros | `isOtros` recomputed from `overdue90Days` inside add/attach functions | Pass `isOtros` as parameter; never recompute inside `addEmpresaAcreedor`, `addPersonaAcreedor`, `attachDocumentoAcreedor` |
| CMF name "CAR - Ripley" not matched | Token-sequence match fails ("car ripley" ≠ "car s.a. tarjeta ripley") | Covered by ALIAS `'car ripley' → 'car s a tarjeta ripley'` in `acreedor_matcher.ts` |

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
  sentinel.ts                  ← runSentinelCheck (API Key #1: pre-validación + reclasificación)
  cognitive_orchestrator.ts    ← runCognitiveOrchestrator (API Key #2: Mente Pensante / Claude AI)
  date_helper.ts               ← getCurrentChileDate, getDaysDifference, parseDateString
  browser.ts                   ← launchBrowser, screenshotOnFailure
  alerts.ts                    ← createAlert, clearAlert
src/index.ts               ← CLI runner
src/worker.ts              ← job queue daemon
```
