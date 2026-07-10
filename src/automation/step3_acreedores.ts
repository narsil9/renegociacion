import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';
import { screenshotOnFailure } from '../utils/browser';
import { extractCreditors, CmfCreditor } from '../utils/cmf_analyzer';
import { ReclassifiedCreditor, AdditionalCreditor, Identified261Creditor, DeReclassified261Creditor } from '../utils/sentinel';
import {
  fetchAcreedoresCatalog,
  matchAcreedor,
  MatchResult,
  getRegionValue,
  normalizeRut,
  normalizeText,
  AcreedorCatalogEntry,
  isValidRut,
  extractRutsFromText,
  findCatalogEntryByRut,
  canonicalInstitutionKey,
} from '../utils/acreedor_matcher';
import { extractTextFromPdf } from '../utils/pdf_analyzer';
import { extractCertLineItems, normalizeOperationId } from '../utils/cert_line_items';
import * as fs from 'fs';
import * as path from 'path';

export interface AcreditacionDoc {
  institucion_cmf: string;
  tipo_documento: 22 | 23 | 24;
  storage_path: string;
  local_path?: string;
  // Nombre legible del client_document. Necesario para asociar correctamente el
  // documento a un acreedor NO-CMF cuando hay varios productos del mismo banco
  // (ej. el CPF de las tarjetas BdCh vs. el consultaCredito del consumo BdCh).
  filename?: string;
  // Nombre canónico del catálogo que el Resolver (cert_institution_resolver.ts)
  // derivó por RUT/nombre de archivo y persistió en client_documents.institucion_cmf.
  // Fallback de `step3` para resolver el acreedor (y su RUT) cuando el nombre del
  // CMF/Centinela no matchea el catálogo (ej. "Tenpo Payments" vs "Tenpo Prepago",
  // o un NO-CMF cuyo nombre libre del Centinela no está en acreedores_canonicos).
  catalogInstitucion?: string;
}

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/**
 * Código del motivo por el que un acreedor no se agregó en el Paso 3. Permite que el worker
 * arme una alerta CLARA y precisa para el abogado y, sobre todo, distinga lo que requiere
 * ACCIÓN (cargar manual) de lo que es intencional/informativo (no molestar al abogado).
 */
export type SkipCode =
  | 'sin_catalogo'        // sin match en acreedores_canonicos y sin RUT → cargar manual
  | 'catalogo_ambiguo'    // varios candidatos en el catálogo → elegir el correcto
  | 'comuna_sin_region'   // la comuna del catálogo no mapea a región → cargar región/comuna
  | 'error_portal'        // el portal falló al agregarlo tras varios intentos → reintentar/cargar manual
  | 'falta_documento'     // falta el documento de acreditación
  | 'remanente_trivial'   // remanente < 1 UF excluido a propósito → NO requiere acción
  | 'movido_a_261';       // producto 260 sin vencimiento → se declara en Art. 261 → informativo

/** Códigos que el abogado DEBE atender (el acreedor quedó sin cargar). El resto es informativo. */
export const SKIP_CODES_ACCIONABLES: ReadonlySet<SkipCode> = new Set<SkipCode>([
  'sin_catalogo', 'catalogo_ambiguo', 'comuna_sin_region', 'error_portal', 'falta_documento',
]);

export interface Step3Report {
  added: { institucion: string; nombreCatalogo: string; monto: number }[];
  skipped: { institucion: string; reason: string; code: SkipCode; monto?: number }[];
}

/**
 * Override de monto y/o fecha de vencimiento "según el documento de acreditación"
 * para un acreedor del CMF (los reclasificados y no-CMF ya traen estos datos en
 * sus propias estructuras). El monto del documento es más actual que el del CMF;
 * la fecha de vencimiento real reemplaza el placeholder `dateDaysAgo(90)`.
 * En producción lo puebla el Orquestador (pendiente de extraer los valores);
 * en los tests se provee hardcodeado.
 */
export interface CmfDocumentOverride {
  institucion_cmf: string;
  monto_clp?: number;
  fecha_vencimiento?: string; // YYYY-MM-DD o dd/mm/yyyy
}

/** Convierte una fecha YYYY-MM-DD (o dd/mm/yyyy) al formato dd/mm/yyyy del portal. */
function toPortalDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
  return undefined; // formato no reconocido → caller usa fallback
}

const MAX = { nombre: 70, direccion: 100, email: 100, telefono: 20, monto: 12 };

/**
 * Fills Step 3 (Acreedores): uploads the CMF report, then declares every
 * creditor found in the report (direct + indirect) using data from the
 * `acreedores_canonicos` catalog. Creditors that are missing or ambiguous in
 * the catalog are skipped and reported for manual review.
 */
/**
 * Captura de COMPARACIÓN del Paso 3 (robot vs abogada). Guarda en `outputs/step3_comparacion/`:
 *   - página completa (`paso3_full_<tag>.png`)
 *   - tabla Obligaciones 260 (`paso3_260_<tag>.png`)
 *   - tabla Otros Acreedores 261 (`paso3_261_<tag>.png`)
 * `<tag>` = RUT (si es legible en la página) + timestamp, para no pisar corridas. Se llama con
 * TODOS los acreedores ya agregados y ANTES de cualquier limpieza, en DRY_RUN y en producción.
 * Best-effort: cualquier fallo se loguea y NO interrumpe el Paso 3.
 */
export async function captureStep3ForComparison(page: Page, log: (m: string) => void): Promise<void> {
  try {
    const dir = path.join(process.cwd(), 'outputs', 'step3_comparacion');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let rut = '';
    try {
      const body = await page.locator('body').innerText({ timeout: 3000 });
      rut = (body.match(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/) ?? [''])[0].replace(/\./g, '');
    } catch { /* best-effort: sin RUT legible → solo timestamp */ }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const tag = `${rut ? rut + '_' : ''}${stamp}`;

    const full = path.join(dir, `paso3_full_${tag}.png`);
    await page.screenshot({ path: full, fullPage: true });
    log(`📸 [comparación] Página completa Paso 3: ${full}`);

    for (const [tableId, label] of [['tablaAcreedores', '260'], ['tablaOtrosAcreedores', '261']] as const) {
      try {
        const tbl = page.locator(`#${tableId}`);
        if ((await tbl.count()) === 0) { log(`   ℹ️ Tabla ${label} no presente en la página.`); continue; }
        await tbl.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        const shot = path.join(dir, `paso3_${label}_${tag}.png`);
        await tbl.screenshot({ path: shot });
        log(`📸 [comparación] Tabla ${label === '260' ? 'Obligaciones 260' : 'Otros Acreedores 261'}: ${shot}`);
      } catch (err) {
        log(`   ⚠️ No se pudo capturar la tabla ${label}: ${(err as Error).message.substring(0, 80)}`);
      }
    }
  } catch (err) {
    log(`   ⚠️ Captura de comparación Paso 3 falló (no bloqueante): ${(err as Error).message.substring(0, 100)}`);
  }
}

/**
 * Borra TODOS los acreedores existentes de ambas tablas del Paso 3 (Obligaciones 260
 * y Otros Acreedores) ANTES de llenar. Hace el llenado IDEMPOTENTE: re-correr la
 * automatización REEMPLAZA en vez de APILAR. NO toca el Informe CMF ni los archivos
 * del Paso 2. Mismo selector/flujo que cleanup.ts.
 */
async function clearExistingAcreedores(page: Page, log: (m: string) => void): Promise<void> {
  let removed = 0;
  for (const tableId of ['tablaAcreedores', 'tablaOtrosAcreedores']) {
    for (let i = 0; i < 40; i++) {
      const deleteBtn = page
        .locator(`#${tableId} tbody tr button[title*="liminar"], #${tableId} tbody tr a[title*="liminar"]`)
        .first();
      if ((await deleteBtn.count()) === 0) break;
      await deleteBtn.click();
      const confirm = page.locator('#btnConfirmarModal');
      await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(1200);
      removed++;
    }
  }
  if (removed > 0) log(`🧹 Limpieza idempotente: ${removed} acreedor(es) preexistente(s) eliminado(s) antes de llenar.`);
  else log('🧹 Tabla de acreedores vacía (sin preexistentes) — llenado limpio.');
}

/**
 * Dedup determinista de `identified261Creditors` (el LLM a veces emite la MISMA deuda dos veces):
 *  (a) misma Nº de operación normalizada (cross-institución) — ej. una hipoteca cuyo saldo y prepago
 *      comparten la op, o un producto que el LLM rotula con 2 nombres de banco (Falabella↔CMR);
 *  (b) mismo banco (looseKey, ignora sufijo país "chile") + AMBOS montos grandes (≥ ~50 UF) + monto
 *      casi idéntico (≤3%) — ej. una hipoteca leída como "Saldo" ($142,5M) y "Prepago" ($144,7M).
 * Se conserva UNO por grupo: mayor confianza y, a igualdad, el monto MAYOR (payoff). Es aditivo y
 * general (no depende del caso); ver L38. Nunca fusiona deudas distintas (op distinta y monto >3%).
 */
export function dedupeIdentified261Products(
  list: Identified261Creditor[],
  log: (m: string) => void
): Identified261Creditor[] {
  const LARGE = 2_000_000; // ~50 UF: umbral para el criterio de "casi idéntico" del mismo banco
  const bankKey = (r: Identified261Creditor) =>
    canonicalInstitutionKey(r.bank || r.institucion_cmf).replace(/(?<!\bde)\s+chile$/, '').trim();
  const conf = (r: Identified261Creditor) => r.evidence?.confidence ?? 0;
  const kept: Identified261Creditor[] = [];
  for (const r of list) {
    const rop = normalizeOperationId(r.evidence?.numero_operacion ?? null);
    const rbank = bankKey(r);
    const idx = kept.findIndex((k) => {
      const kop = normalizeOperationId(k.evidence?.numero_operacion ?? null);
      if (rop && kop && rop === kop) return true; // (a) misma operación
      const rel = Math.abs(k.total_credito_clp - r.total_credito_clp) / Math.max(k.total_credito_clp, r.total_credito_clp, 1);
      const big = r.total_credito_clp >= LARGE && k.total_credito_clp >= LARGE;
      return bankKey(k) === rbank && big && rel <= 0.03; // (b) mismo banco, grande, ≤3%
    });
    if (idx === -1) { kept.push(r); continue; }
    const k = kept[idx];
    // Conservar el mejor: mayor confianza; a igualdad, el monto mayor (payoff del crédito).
    const rWins = conf(r) > conf(k) || (conf(r) === conf(k) && r.total_credito_clp > k.total_credito_clp);
    const winner = rWins ? r : k, loser = rWins ? k : r;
    kept[idx] = winner;
    log(`🔁 Dedup id261 (misma deuda): "${loser.institucion_cmf}" $${loser.total_credito_clp.toLocaleString('es-CL')} ≡ "${winner.institucion_cmf}" $${winner.total_credito_clp.toLocaleString('es-CL')} — se conserva el payoff/mayor confianza.`);
  }
  return kept;
}

export async function fillStep3(
  page: Page,
  cmfLocalPath: string,
  supabase: SupabaseClient,
  logger?: SimpleLogger,
  boletinComercialPath?: string,
  acreditacionDocs?: AcreditacionDoc[],
  reclassifiedCreditors?: ReclassifiedCreditor[],
  additionalCreditors?: AdditionalCreditor[],
  cmfDocumentOverrides?: CmfDocumentOverride[],
  identified261Creditors?: Identified261Creditor[],
  deReclassified261Creditors?: DeReclassified261Creditor[]
): Promise<Step3Report> {
  const log = (msg: string) => {
    if (logger) {
      logger.log(msg);
    } else {
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
      console.log(`[${ts}] ${msg}`);
    }
  };
  const logError = (msg: string, err?: unknown) => {
    if (logger) logger.error(msg, err);
    else console.error(msg, err ?? '');
  };

  const report: Step3Report = { added: [], skipped: [] };

  if (!fs.existsSync(cmfLocalPath)) {
    throw new Error(`Informe CMF local no encontrado: ${cmfLocalPath}`);
  }

  try {
    // URL check first (BUG-09), then wait for the form.
    if (!page.url().includes('renegociacion')) {
      throw new Error(`URL inesperada para Paso 3: ${page.url()}`);
    }

    log('⏳ Esperando formulario de Paso 3 (Acreedores)...');
    await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 30000 });

    log('→ Esperando estabilización de scripts en la página...');
    await page.waitForTimeout(3000);

    // --- 1. Upload Boletín Comercial (opcional) --------------------------
    if (boletinComercialPath && fs.existsSync(boletinComercialPath)) {
      log('→ Seleccionando archivo de Boletín Comercial...');
      await page.locator('#boletinComercial').setInputFiles(boletinComercialPath);
      log('→ Presionando botón Subir Boletín Comercial...');
      await page.locator('#btnSubirBoletinComercial').click();
      await page.waitForTimeout(3000);
      log('✓ Boletín Comercial subido.');
    }

    // --- 2. Upload Informe CMF (with retry + idempotency check) --------------
    const cmfAlreadyUploaded = await page
      .locator('#btnEliminarCMF, #btnVerCMF')
      .first()
      .isVisible()
      .catch(() => false);

    if (cmfAlreadyUploaded) {
      log('✓ Informe CMF ya estaba subido (omitiendo upload).');
    } else {
      await withRetry(
        async () => {
          if (
            await page.locator('#btnEliminarCMF, #btnVerCMF').first().isVisible().catch(() => false)
          ) {
            return; // already uploaded in a previous attempt
          }
          log('→ Seleccionando archivo de Informe CMF...');
          await page.locator('#informeCMF').setInputFiles(cmfLocalPath);
          log('→ Presionando botón Subir Informe CMF...');
          await page.locator('#btnSubirInformeCMF').click();
          log('→ Esperando confirmación de subida de Informe CMF...');
          await page.locator('#btnEliminarCMF:not(.hidden), #btnVerCMF:not(.hidden)').first().waitFor({ state: 'attached', timeout: 45000 });
        },
        {
          attempts: 3,
          delayMs: 4000,
          onRetry: (attempt, err) =>
            log(`⚠️ Reintento ${attempt}/2 subida CMF: ${err.message.substring(0, 120)}`),
        }
      );
      log('✓ Informe CMF subido correctamente.');
    }

    // --- 3. Extract creditors from the CMF + load catalog ----------------
    const creditors = await extractCreditors(cmfLocalPath, logger);
    if (creditors.length === 0) {
      throw new Error('No se detectó ningún acreedor en el Informe CMF.');
    }

    log('→ Cargando catálogo acreedores_canonicos...');
    const catalog = await withRetry(() => fetchAcreedoresCatalog(supabase), {
      attempts: 3,
      delayMs: 3000,
      onRetry: (attempt, err) =>
        log(`⚠️ Reintento ${attempt}/2 carga catálogo: ${err.message.substring(0, 100)}`),
    });
    log(`✓ Catálogo cargado: ${catalog.length} acreedores canónicos.`);

    // --- 3b. Download acreditacion docs from Storage ----------------------
    const docs = acreditacionDocs ?? [];
    if (docs.length > 0) {
      const tmpDir = path.join(process.cwd(), 'outputs', 'acreditaciones_tmp');
      await downloadAcreditacionDocs(supabase, docs, tmpDir, log);
    }

    // --- 3c. Classify creditors + validate 80 UF requirement ----------------
    const UF_80_CLP = 3_253_000; // 80 UF ≈ $3,253,000 CLP
    // Un acreedor es reclasificado a Art. 260 si el sentinel detectó mora ≥91d
    // en sus documentos, aunque el CMF muestre $0 en la columna 90+d.
    // Name-only matching as primary key. When the same institution has multiple
    // reclassified products (e.g. BdCh consumo + BdCh tarjeta both reclassified),
    // use closest totalCredito as tiebreaker — the inter-product gap ($M range) is
    // always larger than the CMF/doc date gap ($300-500k), so this is unambiguous.
    const getReclassifiedMatch = (c: CmfCreditor): ReclassifiedCreditor | undefined => {
      if (!reclassifiedCreditors || reclassifiedCreditors.length === 0) return undefined;
      const normInst = normalizeText(c.institucion);
      const matches = reclassifiedCreditors.filter(r => {
        const normR = normalizeText(r.institucion_cmf);
        return normInst.includes(normR) || normR.includes(normInst);
      });
      if (matches.length === 0) return undefined;
      // Always pick closest monto (tiebreaker for multiple matches, guard for single).
      const best = matches.reduce((b, r) =>
        Math.abs(r.total_credito_clp - c.totalCredito) < Math.abs(b.total_credito_clp - c.totalCredito)
          ? r : b
      );
      // Guard: reject if monto gap exceeds 30% of the larger value. This prevents
      // a reclassified consumo ($14.8M) from matching a different product of the
      // same bank, e.g. a vivienda/hipotecaria ($90M).
      const larger = Math.max(best.total_credito_clp, c.totalCredito);
      if (larger > 0 && Math.abs(best.total_credito_clp - c.totalCredito) / larger > 0.30) {
        return undefined;
      }
      return best;
    };
    const isReclassifiedTo260 = (c: CmfCreditor): boolean => !!getReclassifiedMatch(c);

    // De-reclasificación 260 → 261 (REGLA 10 del Centinela): el CMF marca un
    // producto con mora 90+d, pero su certificado (más reciente que el CMF) lo
    // certifica VIGENTE → se declara como Otro Acreedor (Art. 261, solo monto).
    // Camino inverso a getReclassifiedMatch. Match por nombre con desempate por
    // monto más cercano + guarda del 30% (igual criterio), para apuntar al
    // producto correcto cuando el banco tiene varias líneas.
    const getDeReclassified261Match = (c: CmfCreditor): DeReclassified261Creditor | undefined => {
      if (!deReclassified261Creditors || deReclassified261Creditors.length === 0) return undefined;
      const normInst = normalizeText(c.institucion);
      const matches = deReclassified261Creditors.filter(r => {
        const normR = normalizeText(r.institucion_cmf);
        return !!normR && (normInst.includes(normR) || normR.includes(normInst));
      });
      if (matches.length === 0) return undefined;
      const best = matches.reduce((b, r) =>
        Math.abs(r.total_credito_clp - c.totalCredito) < Math.abs(b.total_credito_clp - c.totalCredito) ? r : b
      );
      const larger = Math.max(best.total_credito_clp, c.totalCredito);
      if (larger > 0 && Math.abs(best.total_credito_clp - c.totalCredito) / larger > 0.30) {
        return undefined;
      }
      return best;
    };
    const isDeReclassifiedTo261 = (c: CmfCreditor): boolean => !!getDeReclassified261Match(c);

    const getCmfOverride = (c: CmfCreditor): CmfDocumentOverride | undefined => {
      if (!cmfDocumentOverrides || cmfDocumentOverrides.length === 0) return undefined;
      const normInst = normalizeText(c.institucion);
      const keyInst = canonicalInstitutionKey(c.institucion);
      const matches = cmfDocumentOverrides.filter(o => {
        // Match canónico (alias-aware + strippea tokens de tipo de crédito y sufijo de
        // producto): resuelve el caso en que el parser CMF manglea el nombre ("Tarjet
        // Promotora CMR Falabella S.A. crédit") y el override viene con el nombre limpio
        // ("Promotora CMR Falabella S.A. (Tarjeta CMR …)") → un substring crudo no matchea.
        if (keyInst && canonicalInstitutionKey(o.institucion_cmf) === keyInst) return true;
        // Fallback: substring crudo (compatibilidad con el comportamiento previo).
        const normO = normalizeText(o.institucion_cmf);
        return normInst.includes(normO) || normO.includes(normInst);
      });
      if (matches.length === 0) return undefined;
      // El Centinela puede emitir DOS overrides para el mismo producto: uno del LLM SIN
      // fecha (ej. "Cartera Vencida" sin día exacto) y otro del rescate chat→260 CON fecha
      // estimada. Un .find() tomaba el primero (sin fecha) → el 260 se degradaba a 261 por
      // falta de vencimiento. Preferir SIEMPRE un override con fecha_vencimiento (acredita el
      // 260); entre varios, desempatar por monto más cercano al del CMF.
      const withDate = matches.filter(o => o.fecha_vencimiento);
      const pool = withDate.length > 0 ? withDate : matches;
      return pool.reduce((best, o) =>
        Math.abs((o.monto_clp ?? 0) - c.totalCredito) < Math.abs((best.monto_clp ?? 0) - c.totalCredito) ? o : best
      );
    };

    // Fix — monto del DOCUMENTO para acreedores Art.261 del CMF. El Centinela ya
    // extrajo el monto real del estado de cuenta en identified261Creditors[].total_credito_clp
    // (período más reciente). step3 declaraba el monto del CMF (desactualizado) →
    // subdeclaraba/sobredeclaraba.
    //
    // Emparejamiento 1:1 GLOBAL por institución CANÓNICA (alias-aware + strippea los tokens
    // de tipo de crédito que el parser CMF inyecta DENTRO del nombre: "CAT Administradora de
    // Tarjetas **Tarjet** S.A. **crédit**", "**Linea** Banco de Chile **Crédit**"). El match
    // previo usaba un substring crudo de normalizeText → con esos tokens NO matcheaba el
    // override del cert (CAT caía a $816 del CMF en vez de $105.185 del estado de cuenta).
    // Dentro de cada institución con varios productos (ej. Banco de Chile: consumo + 2
    // tarjetas + línea + hipotecario), los identified261 se asignan greedily de MAYOR a menor
    // a la fila del CMF de monto más cercano, consumiendo cada fila una sola vez. Para el par
    // asignado el monto del cert MANDA (sin guard del 30%): el Centinela es la fuente de verdad
    // por producto. Las filas del CMF que quedan SIN par (líneas remanentes triviales <1 UF
    // sin documento) se filtran luego en el loop principal (no se pierde ninguna deuda real).
    // Dedup determinista de la MISMA deuda emitida 2 veces por el LLM (op repetida / hipoteca
    // saldo+prepago) — antes de armar los grupos, para que todo lo de abajo use la lista limpia.
    const identified261Deduped = dedupeIdentified261Products(identified261Creditors ?? [], log);
    const id261Assignment = new Map<CmfCreditor, Identified261Creditor>();
    // additionalCreditors que en realidad SON una línea del CMF (no un acreedor extra). El
    // Centinela (LLM) es no-determinista al partir productos entre el CMF y los NO-CMF: puede
    // emitir como NO-CMF un producto que el CMF SÍ trae (ej. las 2 tarjetas Banco de Chile de
    // Néctor — el CMF las lista al día con su cupo y el certificado con su saldo). Si step3
    // declara la fila del CMF *y* la NO-CMF, ese producto se cuenta DOBLE. Backstop
    // determinista (corre siempre, no depende del LLM ni del caché del Centinela): un NO-CMF
    // que empareja 1:1 con una fila CMF libre del MISMO banco y MISMO tipo (tarjeta↔tarjeta) y
    // monto cercano (≤30% relativo) se reconcilia como override de esa fila (el saldo del cert
    // manda) y se EXCLUYE de la fase NO-CMF → una sola fila. Los NO-CMF genuinos (más
    // certificados que líneas del CMF de ese tipo, ej. una 3ª operación BancoEstado) no
    // emparejan y quedan como acreedor extra.
    const dedupedAdditional = new Set<AdditionalCreditor>();
    {
      // Tarjeta-ness desde el tipo Y el nombre: el parser del CMF a veces destroza el campo
      // tipoCredito (mete la fecha de otorgamiento: "a de 13/05/2025 o") y pega el token de
      // tipo al nombre de la institución ("Tarjet Banco de Chile crédit"). Mirar solo
      // tipoCredito perdía la señal → el dedup no emparejaba las tarjetas.
      const isTarjetaCmf = (c: CmfCreditor) => /tarjet/i.test(c.tipoCredito ?? '') || /tarjet/i.test(c.institucion ?? '');
      // Clave que ignora el sufijo de país " chile" ("Banco Itaú Chile" vs "BANCO ITAU") pero NO
      // "de chile" (Banco de Chile). Sin esto, un additional emitido como "BANCO ITAU" no agrupa
      // con las filas/ids del CMF "Banco Itaú Chile" → el dedup no ve el duplicado. Testigo: Itaú
      // $9.511.066 de Miguel (id261 + NO-CMF, mismo producto).
      const looseKey = (s: string) => canonicalInstitutionKey(s).replace(/(?<!\bde)\s+chile$/, '').trim();
      const isAlDia = (c: CmfCreditor) => (c.overdue90Days === 0 && !isReclassifiedTo260(c)) || isDeReclassifiedTo261(c);
      const cmf261 = creditors.filter(isAlDia);
      // Una fila 90+d SIN override (el cert no acreditó su venc → su payoff se emitió como
      // identified261) también es RECLAMABLE por ese id261: es la MISMA deuda. Si no se
      // incluye en el pool de asignación, el id261 (payoff) se ancla a una fila al-día y la
      // fila 90+d se declara aparte degradada al monto del CMF → DOBLE CONTEO. Testigo:
      // Santander consumo de Cristian (CMF $6.891.901 90+d / payoff cert $6.985.718). Se
      // asignan por cercanía de monto junto a las al-día; la naturaleza revolvente/venc NO
      // cambia (el payoff no acredita venc → 261). El dedup NO-CMF (paso 2) sigue SOLO sobre
      // al-día (un NO-CMF 261 no debe colapsar contra una deuda morosa genuina).
      const claimable90 = creditors.filter(c =>
        c.overdue90Days > 0 && !isReclassifiedTo260(c) && !isDeReclassifiedTo261(c) && !getCmfOverride(c)
      );
      const groups = new Map<string, { cmf: CmfCreditor[]; alDia: Set<CmfCreditor>; ids: Identified261Creditor[] }>();
      for (const c of [...cmf261, ...claimable90]) {
        const k = canonicalInstitutionKey(c.institucion);
        if (!k) continue;
        const g = groups.get(k) ?? { cmf: [], alDia: new Set<CmfCreditor>(), ids: [] };
        g.cmf.push(c);
        if (isAlDia(c)) g.alDia.add(c);
        groups.set(k, g);
      }
      for (const r of identified261Deduped) {
        const k = canonicalInstitutionKey(r.institucion_cmf);
        const g = k ? groups.get(k) : undefined;
        if (g) g.ids.push(r);
      }
      for (const [key, { cmf, alDia, ids }] of groups.entries()) {
        const free = new Set(cmf);
        // 1) Override del LLM (identified261): emparejamiento 1:1 por cercanía de monto
        //    (incluye filas 90+d sin override: el id261 es su payoff).
        for (const id of [...ids].sort((a, b) => b.total_credito_clp - a.total_credito_clp)) {
          let best: CmfCreditor | undefined;
          for (const c of free) {
            if (!best || Math.abs(c.totalCredito - id.total_credito_clp) < Math.abs(best.totalCredito - id.total_credito_clp)) best = c;
          }
          if (best) {
            id261Assignment.set(best, id);
            free.delete(best);
          }
        }
        // El dedup NO-CMF (paso 2) solo puede colapsar contra filas AL DÍA libres.
        for (const c of [...free]) if (!alDia.has(c)) free.delete(c);
        // 2) Dedup NO-CMF→CMF: un additionalCreditor del mismo banco que empareja con una fila
        //    CMF libre del MISMO tipo y monto cercano (≤30%) ES esa línea del CMF, no un extra.
        // Matchear por banco usando AMBOS nombres: el Centinela suele anteponer el tipo de
        // producto al institucion_cmf ("Tarjeta Banco de Chile") y ese prefijo NO lo quita
        // canonicalInstitutionKey → quedaría "tarjeta banco de chile" ≠ "banco de chile". El
        // campo bank trae el nombre limpio ("Banco de Chile"), que sí canonicaliza al grupo.
        // Solo Art.261: el dedup convierte el NO-CMF en override de una fila CMF AL DÍA
        // (cmf261). Un NO-CMF Art.260 (mora 90+d, ej. "Varios Deudores" $45.798 de Miguel)
        // es deuda morosa genuina y NO debe colapsarse contra una línea al día.
        const sameBankAdditional = (additionalCreditors ?? [])
          .filter(a => a.categoria_articulo === 261 && [a.bank, a.institucion_cmf].some(n => looseKey(n) === looseKey(key)))
          .sort((a, b) => b.total_credito_clp - a.total_credito_clp);
        for (const a of sameBankAdditional) {
          // 2a) Duplicado de un id261 YA declarado del mismo banco: el LLM (no-determinista) emitió
          //     el MISMO producto en identified261 Y en additionalCreditors (split inconsistente).
          //     No es un acreedor extra → se descarta (evita el doble conteo). Testigo: Itaú
          //     $9.511.066 de Miguel (id261 + NO-CMF) y $6.756.287≈id261 $7.263.340. Match por
          //     monto (≤30% relativo o casi idéntico) contra los id261 del mismo banco.
          const dupId261 = ids.find((id) => {
            // EXIGIR misma institución específica por institucion_cmf (no por el grupo, que se une
            // también por a.bank): "Banco Falabella" ≠ "Promotora CMR Falabella" aunque compartan
            // el grupo. Sin esto, CMR $2.296.733 se descartaba como "dup" de Banco Falabella
            // $2.988.488 (23%). Regla de oro del catálogo: Banco Falabella≠CMR, Ripley≠CAR.
            if (looseKey(id.institucion_cmf) !== looseKey(a.institucion_cmf)) return false;
            // "Duplicado" = MISMO producto en id261 y additional → monto casi idéntico (mismo cert)
            // o pequeña brecha cert-vs-CMF (≤10%). NO dos préstamos distintos del mismo banco
            // (ej. BancoEstado $389.848 vs $553.350 = 30% → deudas separadas, no se descarta).
            const rel = Math.abs(id.total_credito_clp - a.total_credito_clp) / Math.max(id.total_credito_clp, a.total_credito_clp);
            return rel <= 0.10 || Math.abs(id.total_credito_clp - a.total_credito_clp) <= 2000;
          });
          if (dupId261) {
            dedupedAdditional.add(a);
            log(`🔁 Dedup NO-CMF↔id261: ${a.bank} $${a.total_credito_clp.toLocaleString('es-CL')} duplica el id261 $${dupId261.total_credito_clp.toLocaleString('es-CL')} del mismo banco (mismo producto en 2 listas del LLM) — se descarta.`);
            continue;
          }
          const wantTarjeta = a.product_type === 'tarjeta_credito';
          let best: CmfCreditor | undefined;
          for (const c of free) {
            if (isTarjetaCmf(c) !== wantTarjeta) continue;
            const rel = Math.abs(c.totalCredito - a.total_credito_clp) / Math.max(c.totalCredito, a.total_credito_clp);
            if (rel > 0.30) continue;
            if (!best || Math.abs(c.totalCredito - a.total_credito_clp) < Math.abs(best.totalCredito - a.total_credito_clp)) best = c;
          }
          if (!best) continue;
          id261Assignment.set(best, {
            bank: a.bank,
            product_type: a.product_type === 'tarjeta_credito' || a.product_type === 'credito_consumo' ? a.product_type : 'otro',
            institucion_cmf: a.institucion_cmf || a.bank,
            total_credito_clp: a.total_credito_clp,
            reason: `Reconciliación determinista (step3): el Centinela lo emitió como NO-CMF pero corresponde a la línea "${best.tipoCredito}" del CMF de ${a.bank} (mismo tipo, monto cercano) → override de monto, no fila extra (evita doble conteo).`,
            document_filename: a.document_filename,
          });
          free.delete(best);
          dedupedAdditional.add(a);
          log(`🔁 Dedup NO-CMF→CMF: ${a.bank} $${a.total_credito_clp.toLocaleString('es-CL')} es la línea "${best.tipoCredito}" del CMF ($${best.totalCredito.toLocaleString('es-CL')}) — se evita el doble conteo.`);
        }
      }
    }
    const getIdentified261Match = (c: CmfCreditor): Identified261Creditor | undefined =>
      id261Assignment.get(c);

    // --- Gate I2 — respaldo documental por CONTENIDO (regla rectora) ----------
    // Una deuda se declara SOLO con un documento que acredite su monto. Un producto del CMF
    // AL DÍA (Art.261) que NO viene de un documento (sin reclasificación / override / id261 /
    // de-reclasificación) se declara únicamente si algún CERTIFICADO del cliente acredita SU
    // monto — verificado por CONTENIDO (montos extraídos de la capa de texto del PDF), no por nombre de
    // banco. Sin esto, step3 declaraba el producto con la cifra del CMF y le adjuntaba un
    // certificado de OTRO producto del mismo banco (caso Cristian: tarjetas/líneas que la
    // abogada omitió por no tener certificado). `certifiedAmounts` se construye una sola vez
    // (lazy: solo si aparece un producto "pelado") leyendo los montos de cada doc; un monto
    // está acreditado si difiere ≤5% de alguno (tolerancia documento-vs-CMF, conservadora).
    let _certifiedByInst: Map<string, number[]> | null = null;
    const getCertifiedByInst = async (): Promise<Map<string, number[]>> => {
      if (_certifiedByInst) return _certifiedByInst;
      const map = new Map<string, number[]>();
      const add = (k: string, vals: number[]) => {
        if (!k || vals.length === 0) return;
        const arr = map.get(k) ?? [];
        arr.push(...vals);
        map.set(k, arr);
      };
      for (const d of docs) {
        if (!d.local_path || !fs.existsSync(d.local_path)) continue;
        let text = '';
        // Tesseract ELIMINADO: solo capa de texto (pdftotext). Los montos de certs escaneados los
        // acredita el Centinela por lectura NATIVA (override/id261/additional); el Gate I2 solo
        // dispara sobre productos CMF "pelados" (sin reclasificación/override/id261/de-reclass).
        try { text = await extractTextFromPdf(d.local_path); } catch { /* doc ilegible / sin capa de texto */ }
        if (!text) continue;
        // (1) cert_line_items: payoffs inequívocos (PDFs de texto con etiqueta/tabla).
        const lineItems = extractCertLineItems(text).map((it) => it.amount).filter((a) => a > 0);
        // (2) Montos DOMINANTES del documento (≥10% del mayor monto del propio doc). El payoff
        //     de un producto es uno de los montos mayores de SU certificado; las cuotas/
        //     intereses/comisiones son mucho menores. Tomar TODOS los montos haría que un
        //     renglón suelto matcheara por casualidad a otro producto.
        const all: number[] = [];
        for (const m of text.matchAll(/\$\s*([\d][\d.]*)/g)) {
          const n = parseInt(m[1].replace(/\./g, ''), 10);
          if (Number.isFinite(n) && n >= 1000) all.push(n);
        }
        const max = all.length ? Math.max(...all) : 0;
        const vals = [...lineItems, ...all.filter((n) => n >= max * 0.10)];
        // Indexar por institución del documento (institucion_cmf y catalogInstitucion). El
        // match del gate es por MISMA institución: evita que un monto de un banco acredite por
        // casualidad un producto chico de OTRO banco (caso Cristian: $338.248 de una tarjeta
        // BancoEstado sin cert ≈ $328.990 de un renglón de CMR).
        add(canonicalInstitutionKey(d.institucion_cmf || ''), vals);
        if (d.catalogInstitucion) add(canonicalInstitutionKey(d.catalogInstitucion), vals);
      }
      _certifiedByInst = map;
      const total = [...map.values()].reduce((s, a) => s + a.length, 0);
      log(`🔎 [Gate I2] Montos acreditados por documentos: ${total} valor(es) en ${map.size} institución(es).`);
      return map;
    };
    const isAmountCertified = async (creditor: CmfCreditor, amount: number): Promise<boolean> => {
      const byInst = await getCertifiedByInst();
      const k = canonicalInstitutionKey(creditor.institucion);
      const cands = byInst.get(k) ?? [];
      return cands.some((a) => a > 0 && Math.abs(a - amount) / Math.max(a, amount) <= 0.05);
    };

    // Fix #3 — Instituciones MULTIPRODUCTO. Cuando el Centinela emite VARIOS
    // cmfDocumentOverrides para la misma institución (un certificado de liquidación
    // que cubre N créditos, ej. Banco Santander con 3 consumos), cada override es un
    // PRODUCTO distinto que debe declararse como una FILA separada en Obligaciones 260.
    // La base se obtiene quitando el sufijo de producto entre paréntesis del
    // institucion_cmf del override ("Banco Santander-Chile (Consumo … — Op. …)").
    // Sin esto, getCmfOverride devolvía SIEMPRE el primer override → las N líneas del
    // CMF se fundían en una sola fila con un monto único (incorrecto).
    const overrideBaseKey = (inst: string): string => normalizeText(inst.replace(/\s*\(.*$/s, ''));
    const overrideGroups = new Map<string, CmfDocumentOverride[]>();
    for (const o of cmfDocumentOverrides ?? []) {
      const k = overrideBaseKey(o.institucion_cmf);
      const arr = overrideGroups.get(k) ?? [];
      arr.push(o);
      overrideGroups.set(k, arr);
    }
    const multiProductBases = new Set(
      [...overrideGroups.entries()].filter(([, arr]) => arr.length >= 2).map(([k]) => k)
    );
    const isMultiProductOverrideInstitution = (c: CmfCreditor): boolean =>
      multiProductBases.has(normalizeText(c.institucion));

    // Multiproducto 261 (2026-07-01) — ESPEJO del multiproducto-260. Un banco cuyos identified261
    // (productos del cert, Art.261) SUPERAN sus filas al-día del CMF: el CMF no alcanza para
    // mapearlos 1:1, y los extra representan también sus filas 90+d. Se declaran TODOS sus id261
    // como filas 261 (bloque dedicado abajo) y se SALTAN sus filas CMF crudas en el loop principal.
    // Evita el doble conteo (filas 90+d degradadas a 261 al monto CMF + id261 mal-asignados a las
    // al-día). Testigo: BCI de Alfonso (5 id261 vs 2 líneas al-día). Lógica idéntica a la de la
    // función pura testeable `planStep3Rows` (step3_classify.ts).
    const id261ByBankKey = new Map<string, Identified261Creditor[]>();
    for (const r of identified261Deduped) {
      const k = canonicalInstitutionKey(r.institucion_cmf);
      if (k) id261ByBankKey.set(k, [...(id261ByBankKey.get(k) ?? []), r]);
    }
    // Denominador = filas del CMF que un id261 PUEDE reclamar: al-día MÁS 90+d SIN override (su
    // payoff). Un banco es multiproducto-261 solo si sus id261 SUPERAN ese pool (el cert cubre más
    // productos que filas CMF). Si NO lo supera, el loop principal + el reclamo de filas 90+d por
    // id261 lo declara bien (y no pierde una línea al-día con su propio NO-CMF). Antes el
    // denominador era solo al-día → Itaú de Miguel (2 id261, 1 línea al-día + 2 filas 90+d) se
    // marcaba multiproducto y se comía la línea $500.000. Alfonso/sintético (id261 = pool) siguen
    // resolviéndose por el loop principal (mismo resultado).
    const poolCountByBankKey = new Map<string, number>();
    for (const c of creditors) {
      const esOtros = (c.overdue90Days === 0 && !isReclassifiedTo260(c)) || isDeReclassifiedTo261(c);
      const es90SinOverride = c.overdue90Days > 0 && !isReclassifiedTo260(c) && !isDeReclassifiedTo261(c) && !getCmfOverride(c);
      if (!esOtros && !es90SinOverride) continue;
      const k = canonicalInstitutionKey(c.institucion);
      if (k) poolCountByBankKey.set(k, (poolCountByBankKey.get(k) ?? 0) + 1);
    }
    const multiProduct261Bases = new Set(
      [...id261ByBankKey.entries()].filter(([k, arr]) => arr.length > (poolCountByBankKey.get(k) ?? 0)).map(([k]) => k)
    );
    const isMultiProduct261Institution = (c: CmfCreditor): boolean =>
      multiProduct261Bases.has(canonicalInstitutionKey(c.institucion));

    const obligaciones260 = creditors.filter((c) => (c.overdue90Days > 0 || isReclassifiedTo260(c)) && !isDeReclassifiedTo261(c));
    const otrosAcreedores = creditors.filter((c) => (c.overdue90Days === 0 && !isReclassifiedTo260(c)) || isDeReclassifiedTo261(c));
    const total90Days = obligaciones260.reduce((sum, c) => sum + c.totalCredito, 0);

    log('→ Clasificación de acreedores:');
    log(`   📋 Obligaciones 260 (morosidad >90d): ${obligaciones260.length}`);
    obligaciones260.forEach((c) =>
      log(`      • ${c.institucion}: 90d=$${c.overdue90Days.toLocaleString('es-CL')}, total=$${c.totalCredito.toLocaleString('es-CL')}`)
    );
    log(`   📋 Otros Acreedores (sin morosidad >90d): ${otrosAcreedores.length}`);
    otrosAcreedores.forEach((c) =>
      log(`      • ${c.institucion}: total=$${c.totalCredito.toLocaleString('es-CL')}`)
    );
    log(`→ Suma total del crédito (acreedores con 90+d): $${total90Days.toLocaleString('es-CL')} (mín. $${UF_80_CLP.toLocaleString('es-CL')} / 80 UF)`);
    if (total90Days < UF_80_CLP) {
      log(`⚠️  ADVERTENCIA: Suma del total del crédito con morosidad >90d ($${total90Days.toLocaleString('es-CL')}) no alcanza 80 UF. Flujo continúa; revisar documentos adicionales si aplica.`);
    } else {
      log('✓ Requisito 80 UF cumplido.');
    }

    // --- 4a. Add each creditor (Phase 1) ------------------------------------
    // Creditors with overdue90Days > 0 → Obligaciones 260 (#btnAgregarEmpresa)
    // Creditors with overdue90Days === 0 → Otros Acreedores (#btnAgregarEmpresa2)
    // The portal only enables "Subir Documento" buttons once ALL creditors are
    // present in the table. We add all first, then attach documents separately.
    // `isOtros` es el valor FINAL usado al declarar (post-degradación 90+d→261, de-reclasificación,
    // etc.). Se guarda acá para que la fase de adjunción NO lo recompute desde overdue90Days (que
    // contradice la declaración y sube el cert a la tabla equivocada — invariante del CLAUDE.md).
    const addedDocs: { entry: AcreedorCatalogEntry; creditor: CmfCreditor; nonCmfDocFilename?: string; isOtros: boolean }[] = [];

    // Extract client's RUT from the CMF to ignore it when scanning certificates
    let clientRutClean: string | null = null;
    try {
      const cmfText = await extractTextFromPdf(cmfLocalPath);
      const rutMatch = cmfText.match(/Rut\s*:\s*([\d.kK-]+)/i);
      if (rutMatch) {
        clientRutClean = normalizeRut(rutMatch[1]);
        log(`🔍 RUT del cliente extraído del CMF para filtrado de certificados: ${clientRutClean}`);
      }
    } catch (err) {
      log(`⚠️ No se pudo extraer el RUT del cliente del CMF: ${(err as Error).message}`);
    }

    // --- 4a-0. LIMPIEZA IDEMPOTENTE — borrar acreedores preexistentes ---------
    // Hace que el llenado REEMPLACE en vez de APILAR. Sin esto, una re-corrida
    // agrega encima de la anterior y, como el Centinela puede leer montos
    // levemente distintos entre corridas, isCreditorAlreadyInTable (que matchea
    // por monto) no detecta el duplicado → se acumulan filas repetidas (ej. Tenpo
    // $2.289.252 y $2.358.815). Borrar primero garantiza un Paso 3 limpio en cada
    // ejecución. NO toca el CMF ni los archivos del Paso 2.
    await ensureOnAcreedoresPage(page, log).catch(() => {});
    await clearExistingAcreedores(page, log);

    for (const creditor of creditors) {
      // Fix #3 — si la institución es multiproducto (varios overrides del mismo
      // certificado), sus productos Art.260 se declaran una fila por override en la
      // fase dedicada de abajo, así que se saltan acá. PERO los productos Art.261 de
      // esa misma institución (overdue90Days === 0, sin reclasificar) NO están cubiertos
      // por ningún override → deben seguir el flujo normal y entrar a Otros Acreedores.
      // Sin esta condición se perdían: ej. la Línea de crédito Itaú $500.000 (al día)
      // junto a 2 productos Itaú en mora caía en el vacío. Solo se saltan los 260.
      // Debe coincidir con la clasificación 260 de arriba, que incluye la
      // de-reclasificación de la REGLA 10: un producto de la institución multiproducto
      // que el certificado de-reclasificó a 261 NO es 260 → NO se saltea acá (sigue el
      // flujo normal y entra a Otros Acreedores en vez de perderse).
      const esObligacion260 = (creditor.overdue90Days > 0 || isReclassifiedTo260(creditor)) && !isDeReclassifiedTo261(creditor);
      if (isMultiProductOverrideInstitution(creditor) && esObligacion260) continue;
      // Multiproducto 261: TODAS las filas CMF del banco se declaran desde sus id261 (bloque
      // dedicado abajo) → saltar acá para no duplicar (90+d degradadas + id261 mal-asignados).
      if (isMultiProduct261Institution(creditor)) continue;

      let entry: AcreedorCatalogEntry | null = null;

      // 0. El RUT del emisor que el LLM ya leyó GANA sobre nombre/PDF (confiar en el LLM).
      //    Resuelve certs imagen (donde `pdftotext` de detectCreditorRutFromDoc falla) y
      //    nombres del CMF que no matchean el catálogo pero cuyo RUT sí (ej. "Servicios
      //    Financieros y Adm. de Créditos Comerciales" 77085380-K → "Tarjeta Lider"). El RUT
      //    viene en el `evidence` del acreedor emitido por el Centinela (id261/reclass/de-recl).
      // Solo reclassified/identified261 llevan `evidence` (los de-reclasificados 260→261 son
      // bancos del CMF que resuelven por nombre sin problema).
      const llmSrc = getReclassifiedMatch(creditor) ?? getIdentified261Match(creditor);
      const llmRutEmisor = llmSrc?.evidence?.rut_emisor;
      if (llmRutEmisor) {
        const byLlmRut = findCatalogEntryByRut([llmRutEmisor], catalog, clientRutClean);
        if (byLlmRut) {
          log(`   ✓ Resuelto por RUT del emisor leído por el LLM: ${byLlmRut.rut} (${byLlmRut.nombre}) [gana sobre nombre/PDF].`);
          entry = byLlmRut;
        }
      }

      // 0b. Si el RUT no resolvió, probar el NOMBRE del emisor que leyó el LLM del cert (logo/
      //     encabezado). Resuelve cuando el nombre del CMF llega mangleado/truncado pero el LLM
      //     leyó uno limpio (ej. CCAF: el CMF trunca "…Asignación Famili Los Andes", el cert dice
      //     "Caja Los Andes"). Confía en la lectura del LLM antes que en el nombre del CMF.
      if (!entry && llmSrc?.evidence?.emisor_nombre) {
        const byLlmName = matchAcreedor(llmSrc.evidence.emisor_nombre, catalog);
        if (byLlmName.status === 'matched' && byLlmName.entry) {
          log(`   ✓ Resuelto por nombre del emisor leído por el LLM: "${llmSrc.evidence.emisor_nombre}" → "${byLlmName.entry.nombre}".`);
          entry = byLlmName.entry;
        }
      }

      // 1. Try to detect creditor by certificate RUT (re-extracción del PDF) — solo si el RUT
      //    del LLM no resolvió (fallback para el camino monolítico o RUT no leído).
      const creditorDocs = findAcreditacionDocs(creditor.institucion, docs);
      if (!entry) {
        for (const doc of creditorDocs) {
          if (doc?.local_path && fs.existsSync(doc.local_path)) {
            log(`🔍 Escaneando certificado "${path.basename(doc.local_path)}" para identificar RUT del emisor...`);
            const docMatchedEntry = await detectCreditorRutFromDoc(doc.local_path, clientRutClean, catalog, log);
            if (docMatchedEntry) {
              log(`   ✓ Coincidencia por certificado: RUT ${docMatchedEntry.rut} (${docMatchedEntry.nombre}). Sobrescribiendo match de nombre.`);
              entry = docMatchedEntry;
              break;
            }
          }
        }
      }

      // 2. Fallback to matching by name
      if (!entry) {
        let match = matchAcreedor(creditor.institucion, catalog);

        // 2b. Fix #1 — si el nombre del CMF no matchea el catálogo (ej. "Tenpo
        // Payments S.A." vs "Tenpo Prepago SA"), usar el nombre canónico que el
        // Resolver dejó en client_documents (ya catalog-resuelto, con RUT),
        // propagado en AcreditacionDoc.catalogInstitucion. Evita perder acreedores
        // por brecha de nombre CMF↔catálogo cuando el certificado es escaneado.
        if (match.status !== 'matched') {
          const resolverName = creditorDocs.map((d) => d.catalogInstitucion).find(Boolean);
          if (resolverName) {
            const byResolver = matchAcreedor(resolverName, catalog);
            if (byResolver.status === 'matched' && byResolver.entry) {
              log(`   ✓ Resuelto por el Resolver (catálogo): "${creditor.institucion}" → "${byResolver.entry.nombre}" (RUT ${byResolver.entry.rut}).`);
              match = byResolver;
            }
          }
        }

        if (match.status === 'not_found') {
          const reason = 'No existe en acreedores_canonicos (sin RUT para buscar en el portal).';
          log(`⏭️  Saltando "${creditor.institucion}": ${reason}`);
          report.skipped.push({ institucion: creditor.institucion, reason, code: 'sin_catalogo' });
          continue;
        }
        if (match.status === 'ambiguous') {
          const names = (match.candidates ?? []).map((c) => c.nombre).join(' | ');
          const reason = `Múltiples candidatos en el catálogo: ${names}`;
          log(`⏭️  Saltando "${creditor.institucion}": ${reason}`);
          report.skipped.push({ institucion: creditor.institucion, reason, code: 'catalogo_ambiguo' });
          continue;
        }

        entry = match.entry!;
      }
      let isOtros = (creditor.overdue90Days === 0 && !isReclassifiedTo260(creditor)) || isDeReclassifiedTo261(creditor);

      // Fila 90+d SIN override 260 propio pero cuyo payoff está en identified261 (misma deuda,
      // anclada por monto en la asignación de arriba): se declara UNA vez como Art.261 al monto
      // del cert (el payoff no acredita vencimiento). Sin esto, la fila 90+d se degradaría al
      // monto del CMF Y su id261 se declararía en una fila al-día → DOBLE CONTEO. Testigo:
      // Santander consumo de Cristian. (Si trae override 260 con venc, queda 260 y no entra acá.)
      if (!isOtros && !getCmfOverride(creditor) && !isReclassifiedTo260(creditor) && getIdentified261Match(creditor)) {
        log(`   ↩️ "${creditor.institucion}" 90+d sin venc acreditable pero con payoff en el cert → Art.261 (una fila, evita doble conteo).`);
        isOtros = true;
      }

      // Monto y vencimiento "según el documento de acreditación" (más actuales que el CMF):
      // los reclasificados traen sus propios datos; los 260 directos del CMF se
      // sobrescriben vía cmfDocumentOverrides. El monto efectivo se propaga a la
      // idempotencia y a la adjunción de documentos (que matchean por monto).
      const rec = getReclassifiedMatch(creditor);
      // cmfDocumentOverrides son SOLO para productos Art.260 (mora 90+d). Un producto
      // Art.261 (isOtros) NUNCA debe tomar un override 260: en instituciones
      // multiproducto (ej. Itaú con 2 overrides 260 + 1 línea 261) getCmfOverride
      // matchea por nombre y le encajaría un monto 260 ajeno ($8.183.872 a la línea de
      // $500.000). Los 261 usan id261/deRecl; los 260 usan rec/cmfOv.
      const cmfOv = !isOtros ? getCmfOverride(creditor) : undefined;
      // Art.261 del CMF: usar el monto del documento (período más reciente) que extrajo
      // el Centinela, en vez del monto del CMF (desactualizado). Solo aplica a 261 (isOtros);
      // los 260 ya usan rec/cmfOv arriba.
      const id261 = isOtros ? getIdentified261Match(creditor) : undefined;
      // De-reclasificados (REGLA 10): el monto a declarar es el del certificado
      // (deReclassified261Creditors.total_credito_clp), no el del CMF (desactualizado:
      // el CMF aún lo marca 90+d mientras el cert lo certifica vigente).
      const deRecl = isOtros ? getDeReclassified261Match(creditor) : undefined;
      const montoEfectivo =
        rec?.total_credito_clp && rec.total_credito_clp > 0 ? rec.total_credito_clp :
        cmfOv?.monto_clp && cmfOv.monto_clp > 0 ? cmfOv.monto_clp :
        id261?.total_credito_clp && id261.total_credito_clp > 0 ? id261.total_credito_clp :
        deRecl?.total_credito_clp && deRecl.total_credito_clp > 0 ? deRecl.total_credito_clp :
        creditor.totalCredito;
      const fechaVenc = toPortalDate(rec?.delinquency_start_date) ?? toPortalDate(cmfOv?.fecha_vencimiento);
      const creditorEff: CmfCreditor =
        montoEfectivo !== creditor.totalCredito ? { ...creditor, totalCredito: montoEfectivo } : creditor;
      if (montoEfectivo !== creditor.totalCredito) {
        log(`   💰 Monto según documento: $${montoEfectivo.toLocaleString('es-CL')} (CMF: $${creditor.totalCredito.toLocaleString('es-CL')}).`);
      }
      if (fechaVenc) log(`   📅 Vencimiento según documento: ${fechaVenc}.`);

      // Descarte de filas CMF triviales en Art.261: el CMF suele incluir remanentes de líneas
      // de crédito casi saldadas (ej. Banco de Chile $13 y $11.050 de Néctor) que NO son
      // deuda real a declarar. Si la fila es Art.261, su monto efectivo es <1 UF y NO tiene
      // NINGÚN documento que la respalde (sin reclasificación, override 260, identified261 ni
      // de-reclasificación), se omite. El umbral <1 UF coincide con la regla de montos
      // triviales (remanentes/comisiones). Una deuda real chica acreditada por documento
      // (ej. Tenpo $6.180 vía identified261) NO entra acá porque tiene id261 → se conserva.
      const UF_1_CLP = Math.round(UF_80_CLP / 80);
      if (isOtros && montoEfectivo < UF_1_CLP && !rec && !cmfOv && !id261 && !deRecl) {
        const reason = `Fila CMF Art.261 trivial (<1 UF, $${montoEfectivo.toLocaleString('es-CL')}) sin documento de respaldo — remanente, no se declara.`;
        log(`   ⏭️ "${entry.nombre}" omitido: ${reason}`);
        report.skipped.push({ institucion: creditor.institucion, reason, code: 'remanente_trivial', monto: montoEfectivo });
        continue;
      }

      // Gate I2 — Art.261 del CMF SIN respaldo documental verificado NO se declara.
      // Un producto al día "pelado" (solo en el CMF: sin rec/cmfOv/id261/deRecl) solo se
      // declara si un certificado del cliente acredita SU monto (verificación por contenido).
      // Si ningún documento lo respalda → se reporta 'falta_documento' (accionable) y el
      // abogado lo carga a mano; NUNCA se declara con un certificado ajeno (riesgo de que la
      // Superir rechace la fila por documento que no corresponde). General: cualquier producto
      // al día sin cert. Caso testigo: BancoEstado tarjetas/Santander líneas de Cristian.
      if (isOtros && !rec && !cmfOv && !id261 && !deRecl && !(await isAmountCertified(creditor, montoEfectivo))) {
        const reason = `Producto del CMF al día ($${montoEfectivo.toLocaleString('es-CL')}) sin certificado que acredite el monto — no se declara (requiere documento; cargar a mano).`;
        log(`   ⏭️ "${entry.nombre}" omitido: ${reason}`);
        report.skipped.push({ institucion: creditor.institucion, reason, code: 'falta_documento', monto: montoEfectivo });
        continue;
      }

      // Backstop final de la regla decisiva 260/261: un producto destinado a Obligaciones
      // 260 (no isOtros) que NO trae una fecha de vencimiento ACREDITABLE (fechaVenc real)
      // no puede declararse en 260. En vez de perder el acreedor (addEmpresa/Persona lanza
      // y el alta se descarta tras los reintentos), se DEGRADA a Art.261 (Otros) — nunca se
      // descarta una deuda. Cubre el caso en que el Centinela dejó un producto en 260 sin que
      // llegara una fecha real (ej. rescate chat→260 cuya fecha estimada no se propagó). El
      // monto efectivo ya calculado se conserva; 261 no acredita vencimiento.
      if (!isOtros && !fechaVenc) {
        log(`   ⚠️ "${entry.nombre}": Art.260 sin vencimiento acreditable → se declara en Art.261 (Otros) [regla 260/261, no se pierde la deuda].`);
        isOtros = true;
      }

      // M6: si es empresa y la comuna del catálogo no mapea a una región, el alta va a
      // fallar SIEMPRE (selectRegionAndComuna lanza). Es NO recuperable → saltar acá en
      // vez de gastar 3 reintentos garantizados a fallar.
      const isPersonaEntry = entry.tipo?.toLowerCase().includes('persona') === true;
      if (!isPersonaEntry && entry.comuna && !getRegionValue(entry.comuna)) {
        const reason = `Comuna sin mapeo a región: "${entry.comuna}" (no recuperable).`;
        log(`   ⏭️ "${entry.nombre}" omitido: ${reason}`);
        report.skipped.push({ institucion: creditor.institucion, reason, code: 'comuna_sin_region' });
        continue;
      }

      try {
        await withRetry(
          async () => {
            // Idempotency: if already in table (from a previous attempt), skip the add.
            if (await isCreditorAlreadyInTable(page, creditorEff.totalCredito, isOtros, log)) {
              log(`   ℹ️ "${entry.nombre}" ya existe en la tabla — omitiendo add.`);
              return;
            }
            await ensureOnAcreedoresPage(page, log);
            await dismissOpenModal(page).catch(() => {});
            await dismissBlockingDialogs(page, log).catch(() => {});
            const isPersona = entry.tipo?.toLowerCase().includes('persona') === true;
            if (isPersona) {
              await addPersonaAcreedor(page, entry, creditorEff, log, isOtros, fechaVenc);
            } else {
              await addEmpresaAcreedor(page, entry, creditorEff, log, isOtros, fechaVenc);
            }
          },
          {
            attempts: 3,
            delayMs: 4000,
            onRetry: (attempt, err) => {
              log(
                `⚠️ Reintento ${attempt}/2 para "${entry.nombre}": ${err.message.substring(0, 120)}`
              );
            },
          }
        );
        report.added.push({
          institucion: creditor.institucion,
          nombreCatalogo: entry.nombre,
          monto: creditorEff.totalCredito,
        });
        log(`✓ Acreedor agregado: ${entry.nombre} ($${creditorEff.totalCredito.toLocaleString('es-CL')}).`);
        addedDocs.push({ entry, creditor: creditorEff, isOtros });
      } catch (err) {
        const reason = `Error al agregar en el portal (tras 3 intentos): ${(err as Error).message}`;
        logError(`✗ Falló agregar "${creditor.institucion}" (${entry.nombre}).`, err);
        report.skipped.push({ institucion: creditor.institucion, reason, code: 'error_portal' });
        await dismissOpenModal(page).catch(() => {});
      }
    }

    // --- 4a-pre. Instituciones MULTIPRODUCTO: una fila 260 por override --------
    // Un certificado de liquidación que cubre N créditos del mismo banco (ej.
    // Santander con 3 consumos) → N filas separadas en Obligaciones 260, cada una
    // con el "Monto total a pagar" y el vencimiento de ESE producto (no un monto
    // único consolidado). Los acreedores de estas instituciones fueron saltados en
    // el loop principal de arriba.
    for (const base of multiProductBases) {
      const ovs = overrideGroups.get(base) ?? [];
      const baseName = ovs[0].institucion_cmf.replace(/\s*\(.*$/s, '');
      const match = matchAcreedor(baseName, catalog);
      if (match.status !== 'matched' || !match.entry) {
        const reason = `Multiproducto: "${baseName}" no resoluble en el catálogo (${match.status}).`;
        log(`⏭️  Saltando multiproducto "${baseName}": ${reason}`);
        report.skipped.push({ institucion: baseName, reason, code: 'sin_catalogo' });
        continue;
      }
      const entry = match.entry;
      const isPersonaEntry = entry.tipo?.toLowerCase().includes('persona') === true;
      if (!isPersonaEntry && entry.comuna && !getRegionValue(entry.comuna)) {
        const reason = `Comuna sin mapeo a región: "${entry.comuna}" (no recuperable).`;
        log(`   ⏭️ "${entry.nombre}" (multiproducto) omitido: ${reason}`);
        report.skipped.push({ institucion: baseName, reason, code: 'comuna_sin_region' });
        continue;
      }
      log(`→ Institución MULTIPRODUCTO "${entry.nombre}": ${ovs.length} producto(s) → ${ovs.length} fila(s) en Obligaciones 260.`);
      const UF_1_CLP = Math.round(UF_80_CLP / 80); // ≈ $40.662
      for (const ov of ovs) {
        const monto = ov.monto_clp;
        if (!monto || monto <= 0) {
          log(`   ⏭️ Producto "${ov.institucion_cmf}" sin monto válido — omitiendo.`);
          continue;
        }
        // "VARIOS DEUDORES"/"OTROS DEUDORES" SÍ se declaran: son deuda DIRECTA del deudor
        // (titular junto a otras personas), regla del abogado (2026-06-23). Solo se excluye
        // la deuda INDIRECTA (codeudor/fiador/aval de un TERCERO) y los montos triviales
        // (< 1 UF, remanentes/comisiones residuales que no son un producto real a declarar).
        const label = (ov.institucion_cmf || '').toLowerCase();
        const esIndirecta = /co-?deudor|fiador|aval/.test(label);
        if (esIndirecta || monto < UF_1_CLP) {
          log(`   ⏭️ Producto "${ov.institucion_cmf}" ($${monto.toLocaleString('es-CL')}) omitido: ${esIndirecta ? 'deuda indirecta (codeudor/fiador/aval de un tercero)' : 'monto trivial < 1 UF'} — no se declara.`);
          continue;
        }
        const fechaVenc = toPortalDate(ov.fecha_vencimiento);
        // Un producto 260 SIN fecha de vencimiento no se puede acreditar → no cargarlo en 260
        // (no inventar placeholder). Se omite con alerta; el backstop del Centinela debería
        // haberlo degradado a 261 antes de llegar acá.
        if (!fechaVenc) {
          const reason = `Producto 260 "${ov.institucion_cmf}" sin fecha de vencimiento acreditable — omitido de Obligaciones 260 (debe ir a Art. 261).`;
          log(`   ⏭️ ${reason}`);
          report.skipped.push({ institucion: ov.institucion_cmf, reason, code: 'movido_a_261' });
          continue;
        }
        // CmfCreditor sintético: monto = "Monto total a pagar" del producto (del cert);
        // overdue90Days > 0 → cae en Obligaciones 260. institucion conserva el sufijo
        // de producto solo para logs/dedup; el alta usa `entry` (nombre + RUT del catálogo).
        const synth: CmfCreditor = {
          institucion: ov.institucion_cmf,
          tipoCredito: 'otro',
          totalCredito: monto,
          vigente: 0,
          overdue30to59: 0,
          overdue60to89: 0,
          overdue90Days: monto,
          esIndirecta: false,
        };
        try {
          await withRetry(
            async () => {
              if (await isCreditorAlreadyInTable(page, synth.totalCredito, false, log)) {
                log(`   ℹ️ Producto "${ov.institucion_cmf}" ($${synth.totalCredito.toLocaleString('es-CL')}) ya existe — omitiendo.`);
                return;
              }
              await ensureOnAcreedoresPage(page, log);
              await dismissOpenModal(page).catch(() => {});
              await dismissBlockingDialogs(page, log).catch(() => {});
              if (isPersonaEntry) {
                await addPersonaAcreedor(page, entry, synth, log, false, fechaVenc);
              } else {
                await addEmpresaAcreedor(page, entry, synth, log, false, fechaVenc);
              }
            },
            {
              attempts: 3,
              delayMs: 4000,
              onRetry: (attempt, err) =>
                log(`⚠️ Reintento ${attempt}/2 multiproducto "${entry.nombre}": ${err.message.substring(0, 120)}`),
            }
          );
          report.added.push({ institucion: ov.institucion_cmf, nombreCatalogo: entry.nombre, monto: synth.totalCredito });
          log(`✓ Producto agregado (260): ${entry.nombre} ($${synth.totalCredito.toLocaleString('es-CL')}) venc ${fechaVenc ?? '—'}.`);
          addedDocs.push({ entry, creditor: synth, isOtros: false });
        } catch (err) {
          const reason = `Multiproducto: error al agregar en el portal (tras 3 intentos): ${(err as Error).message}`;
          logError(`✗ Falló agregar producto multiproducto "${ov.institucion_cmf}" (${entry.nombre}).`, err);
          report.skipped.push({ institucion: ov.institucion_cmf, reason, code: 'error_portal' });
          await dismissOpenModal(page).catch(() => {});
        }
      }
    }

    // --- 4a-pre-261. Instituciones MULTIPRODUCTO 261 (espejo del 260) ---------
    // Un cert de portabilidad/liquidación cubre N productos del mismo banco que van a Otros
    // Acreedores (Art.261, sin vencimiento acreditable). Se declara UNA fila por identified261
    // con su monto de cert. Las filas CMF de estos bancos se saltaron en el loop principal (evita
    // el doble conteo: 90+d degradadas al monto CMF + id261 mal-asignados). Testigo: BCI de Alfonso.
    for (const base of multiProduct261Bases) {
      const ids = id261ByBankKey.get(base) ?? [];
      if (ids.length === 0) continue;
      const baseName = (ids[0].institucion_cmf || '').replace(/\s*\(.*$/s, '');
      let entry: AcreedorCatalogEntry | null = null;
      const idDocs = findAcreditacionDocs(baseName, docs);
      for (const doc of idDocs) {
        if (doc?.local_path && fs.existsSync(doc.local_path)) {
          const e = await detectCreditorRutFromDoc(doc.local_path, clientRutClean, catalog, log);
          if (e) { entry = e; break; }
        }
      }
      if (!entry) {
        let match = matchAcreedor(baseName, catalog);
        if (match.status !== 'matched') {
          const resolverName = idDocs.map((d) => d.catalogInstitucion).find(Boolean);
          if (resolverName) { const m = matchAcreedor(resolverName, catalog); if (m.status === 'matched' && m.entry) match = m; }
        }
        if (match.status !== 'matched' || !match.entry) {
          const reason = `Multiproducto 261: "${baseName}" no resoluble en el catálogo (${match.status}).`;
          log(`⏭️  Saltando multiproducto 261 "${baseName}": ${reason}`);
          for (const id of ids) report.skipped.push({ institucion: id.institucion_cmf, reason, code: 'sin_catalogo' });
          continue;
        }
        entry = match.entry;
      }
      const isPersonaEntry261 = entry.tipo?.toLowerCase().includes('persona') === true;
      if (!isPersonaEntry261 && entry.comuna && !getRegionValue(entry.comuna)) {
        const reason = `Comuna sin mapeo a región: "${entry.comuna}" (no recuperable).`;
        log(`   ⏭️ "${entry.nombre}" (multiproducto 261) omitido: ${reason}`);
        for (const id of ids) report.skipped.push({ institucion: id.institucion_cmf, reason, code: 'comuna_sin_region' });
        continue;
      }
      log(`→ Institución MULTIPRODUCTO 261 "${entry.nombre}": ${ids.length} producto(s) → ${ids.length} fila(s) en Otros Acreedores.`);
      for (const id of ids) {
        const monto = id.total_credito_clp;
        if (!monto || monto <= 0) { log(`   ⏭️ Producto 261 "${id.institucion_cmf}" sin monto válido — omitiendo.`); continue; }
        const label = (id.institucion_cmf || '').toLowerCase();
        if (/co-?deudor|fiador|aval/.test(label)) { log(`   ⏭️ Producto 261 "${id.institucion_cmf}" indirecto (codeudor/fiador/aval de un tercero) — no se declara.`); continue; }
        // Nota: NO se filtran <1 UF acá — un id261 viene acreditado por documento (la alerta
        // monto_trivial del Centinela lo marca si corresponde); no es un remanente CMF pelado.
        const synth: CmfCreditor = { institucion: id.institucion_cmf, tipoCredito: 'otro', totalCredito: monto, vigente: monto, overdue30to59: 0, overdue60to89: 0, overdue90Days: 0, esIndirecta: false };
        try {
          await withRetry(
            async () => {
              if (await isCreditorAlreadyInTable(page, synth.totalCredito, true, log)) { log(`   ℹ️ Producto 261 "${id.institucion_cmf}" ($${monto.toLocaleString('es-CL')}) ya existe — omitiendo.`); return; }
              await ensureOnAcreedoresPage(page, log);
              await dismissOpenModal(page).catch(() => {});
              await dismissBlockingDialogs(page, log).catch(() => {});
              if (isPersonaEntry261) await addPersonaAcreedor(page, entry!, synth, log, true);
              else await addEmpresaAcreedor(page, entry!, synth, log, true);
            },
            { attempts: 3, delayMs: 4000, onRetry: (a, e) => log(`⚠️ Reintento ${a}/2 multiproducto 261 "${entry!.nombre}": ${e.message.substring(0, 120)}`) }
          );
          report.added.push({ institucion: id.institucion_cmf, nombreCatalogo: entry.nombre, monto });
          log(`✓ Producto agregado (261): ${entry.nombre} ($${monto.toLocaleString('es-CL')}).`);
          addedDocs.push({ entry, creditor: synth, isOtros: true });
        } catch (err) {
          const reason = `Multiproducto 261: error al agregar en el portal (tras 3 intentos): ${(err as Error).message}`;
          logError(`✗ Falló agregar producto 261 "${id.institucion_cmf}" (${entry.nombre}).`, err);
          report.skipped.push({ institucion: id.institucion_cmf, reason, code: 'error_portal' });
          await dismissOpenModal(page).catch(() => {});
        }
      }
    }

    // --- 4a-bis. Add NON-CMF creditors (Phase 1, continued) -----------------
    // Acreedores detectados por el Centinela que NO están en el CMF pero igual
    // deben declararse (Art. 261 — TGR, cajas, fintechs, tarjetas no reportadas).
    // Se agregan con las MISMAS funciones que los del CMF. isOtros sale del
    // artículo que decidió el Centinela. Requieren confirmación del abogado (flag).
    const additionalToDeclare = (additionalCreditors ?? []).filter((a) => !dedupedAdditional.has(a));
    if (additionalToDeclare.length > 0) {
      log(`→ Acreedores NO-CMF detectados por el Centinela: ${additionalToDeclare.length} (requieren confirmación del abogado).`);
      for (const ac of additionalToDeclare) {
        // NO-CMF creditors may have null/empty institucion_cmf (not in CMF) — usar `||`
        // (no `??`) para que un string vacío también caiga al bank name.
        const institutionName = ac.institucion_cmf || ac.bank;

        // 0. RUT del emisor leído por el LLM primero (confiar en el LLM): gana sobre el nombre
        //    libre del Centinela (que rara vez matchea el catálogo) y sobre el filename.
        let match: MatchResult;
        const acLlmRut = ac.evidence?.rut_emisor;
        const acByLlmRut = acLlmRut ? findCatalogEntryByRut([acLlmRut], catalog, clientRutClean) : null;
        if (acByLlmRut) {
          log(`   ✓ NO-CMF resuelto por RUT del emisor leído por el LLM: ${acByLlmRut.rut} (${acByLlmRut.nombre}).`);
          match = { status: 'matched', cmfName: institutionName, entry: acByLlmRut };
        } else {
          match = matchAcreedor(institutionName, catalog);
        }

        // El Centinela puede devolver un nombre COMPUESTO ("La Polar (Inversiones LP
        // S.A.)") que no matchea el catálogo. Reintentar con el bank y quitando el
        // paréntesis ("La Polar" → alias → Empresas La Polar S.A.).
        if (match.status !== 'matched' || !match.entry) {
          const stripParen = (x: string) => x.replace(/\s*\(.*$/s, '').trim();
          for (const nm of [ac.bank, stripParen(institutionName), stripParen(ac.bank)]) {
            if (!nm || !nm.trim()) continue;
            const m = matchAcreedor(nm, catalog);
            if (m.status === 'matched' && m.entry) {
              if (nm !== institutionName) log(`   ✓ NO-CMF resuelto normalizando el nombre: "${ac.bank}" → "${m.entry.nombre}" (RUT ${m.entry.rut}).`);
              match = m;
              break;
            }
          }
        }

        // Fix #1 — el nombre libre del Centinela ("Tarjeta Hites", "COFISA S.A.
        // (Tarjeta La Polar / ABCDIN)") rara vez está en el catálogo. Fallback al
        // nombre canónico que el Resolver dejó en client_documents (catalog-resuelto,
        // con RUT), asociado por el filename del documento del acreedor NO-CMF.
        if (match.status !== 'matched' || !match.entry) {
          const acDoc = docs.find(
            (d) => d.filename && ac.document_filename && d.filename.toLowerCase() === ac.document_filename.toLowerCase()
          );
          if (acDoc?.catalogInstitucion) {
            const byResolver = matchAcreedor(acDoc.catalogInstitucion, catalog);
            if (byResolver.status === 'matched' && byResolver.entry) {
              log(`   ✓ NO-CMF resuelto por el Resolver (catálogo): "${ac.bank}" → "${byResolver.entry.nombre}" (RUT ${byResolver.entry.rut}).`);
              match = byResolver;
            }
          }
        }

        if (match.status !== 'matched' || !match.entry) {
          const reason = match.status === 'ambiguous'
            ? `NO-CMF: múltiples candidatos en el catálogo para "${institutionName}".`
            : `NO-CMF: "${institutionName}" no existe en acreedores_canonicos (sin RUT para el portal).`;
          log(`⏭️  Saltando acreedor NO-CMF "${ac.bank}": ${reason}`);
          report.skipped.push({ institucion: ac.bank, reason, code: match.status === 'ambiguous' ? 'catalogo_ambiguo' : 'sin_catalogo' });
          continue;
        }
        const entry = match.entry;
        const isOtros = ac.categoria_articulo === 261;
        // Vencimiento real desde el documento (solo aplica a 260; 261 no acredita vencimiento).
        const fechaVenc = ac.categoria_articulo === 260 ? toPortalDate(ac.delinquency_start_date) : undefined;
        // CmfCreditor sintético: monto = total del documento (ya es el monto a declarar).
        const synthCreditor: CmfCreditor = {
          institucion: institutionName,
          tipoCredito: ac.product_type,
          totalCredito: ac.total_credito_clp,
          vigente: ac.categoria_articulo === 261 ? ac.total_credito_clp : 0,
          overdue30to59: 0,
          overdue60to89: 0,
          overdue90Days: ac.categoria_articulo === 260 ? ac.total_credito_clp : 0,
          esIndirecta: false,
        };
        try {
          await withRetry(
            async () => {
              if (await isCreditorAlreadyInTable(page, synthCreditor.totalCredito, isOtros, log)) {
                log(`   ℹ️ NO-CMF "${entry.nombre}" ya existe en la tabla — omitiendo add.`);
                return;
              }
              await ensureOnAcreedoresPage(page, log);
              await dismissOpenModal(page).catch(() => {});
              await dismissBlockingDialogs(page, log).catch(() => {});
              const isPersona = entry.tipo?.toLowerCase().includes('persona') === true;
              log(`🆕 ACREEDOR NO-CMF (Art. ${ac.categoria_articulo}, requiere confirmación abogado): ${entry.nombre} ($${synthCreditor.totalCredito.toLocaleString('es-CL')}) — ${ac.reason}`);
              if (isPersona) {
                await addPersonaAcreedor(page, entry, synthCreditor, log, isOtros, fechaVenc);
              } else {
                await addEmpresaAcreedor(page, entry, synthCreditor, log, isOtros, fechaVenc);
              }
            },
            {
              attempts: 3,
              delayMs: 4000,
              onRetry: (attempt, err) =>
                log(`⚠️ Reintento ${attempt}/2 para NO-CMF "${entry.nombre}": ${err.message.substring(0, 120)}`),
            }
          );
          report.added.push({
            institucion: `${ac.bank} (NO-CMF)`,
            nombreCatalogo: entry.nombre,
            monto: synthCreditor.totalCredito,
          });
          log(`✓ Acreedor NO-CMF agregado: ${entry.nombre} ($${synthCreditor.totalCredito.toLocaleString('es-CL')}).`);
          addedDocs.push({ entry, creditor: synthCreditor, nonCmfDocFilename: ac.document_filename, isOtros });
        } catch (err) {
          const reason = `NO-CMF: error al agregar en el portal (tras 3 intentos): ${(err as Error).message}`;
          logError(`✗ Falló agregar acreedor NO-CMF "${ac.bank}" (${entry.nombre}).`, err);
          report.skipped.push({ institucion: ac.bank, reason, code: 'error_portal' });
          await dismissOpenModal(page).catch(() => {});
        }
      }
    }

    // --- 4b. Attach acreditacion documents (Phase 2) ------------------------
    // Run only after ALL creditors are in the table (portal enables the button then).
    if (docs.length > 0 && addedDocs.length > 0) {
      log('→ Adjuntando certificados de acreditación...');
      // Documentos reservados a acreedores NO-CMF: se asocian por filename, no por
      // institución, para no cruzarlos con otros productos del mismo banco que sí
      // están en el CMF (ej. el CPF de las tarjetas vs. el consultaCredito del consumo).
      // Los additionalCreditors deduplicados (NO-CMF que resultaron ser una línea del CMF)
      // NO reservan su filename: su certificado debe quedar disponible para adjuntarse a la
      // fila del CMF que ahora lo representa (override), no a una fila NO-CMF inexistente.
      const reservedNonCmfFilenames = new Set(
        additionalToDeclare.map((a) => a.document_filename).filter(Boolean)
      );
      for (const { entry, creditor, nonCmfDocFilename, isOtros } of addedDocs) {
        // NO-CMF → matchear el documento exacto por filename.
        // CMF    → matchear por institución, excluyendo los reservados a NO-CMF.
        let creditorDocs: AcreditacionDoc[];
        if (nonCmfDocFilename) {
          creditorDocs = docs.filter((d) => d.filename === nonCmfDocFilename);
        } else {
          // PERO si excluir los reservados deja al acreedor CMF SIN ningún documento, es
          // porque el MISMO certificado cubre un producto CMF y uno NO-CMF del mismo banco
          // (ej. cert BCI: consumo $14.830.069 en CMF + cuenta corriente $615 NO-CMF). En
          // ese caso se reusa el cert compartido (el adjunto se asocia por monto a cada
          // fila), en vez de dejar al producto CMF sin acreditación.
          const allInstDocs = findAcreditacionDocs(creditor.institucion, docs);
          const noReservados = allInstDocs.filter(
            (d) => !d.filename || !reservedNonCmfFilenames.has(d.filename)
          );
          creditorDocs = noReservados.length > 0 ? noReservados : allInstDocs;
        }
        if (nonCmfDocFilename && creditorDocs.length === 0) {
          log(`   ⚠️ Acreedor NO-CMF "${entry.nombre}": no se encontró el documento "${nonCmfDocFilename}" en los mappedDocs (¿el orquestador pobló filename?). No se adjunta.`);
        }
        if (creditorDocs.length === 0) continue;

        // `isOtros` viene del addedDocs (el valor FINAL con que se DECLARÓ la fila, post-degradación
        // 90+d→261). NO se recomputa desde overdue90Days: hacerlo mandaba un producto degradado a
        // 261 a buscar su fila en la tabla 260 (equivocada) → el cert no quedaba en la fila 261.
        // Art. 260 → acredita MONTO (22) Y VENCIMIENTO (23): se sube el MISMO documento
        // DOS veces, una por cada tipo (así lo hace el abogado), NO como tipo 24 ni doble monto.
        // Art. 261 → solo MONTO (22).
        const neededTipos: (22 | 23)[] = isOtros ? [22] : [22, 23];
        // Documento que respalda cada tipo: el que ya es de ese tipo; si no, el general
        // (24 = monto+venc) reusado; si no, el primero disponible.
        const pickDoc = (tipo: 22 | 23): AcreditacionDoc | undefined =>
          creditorDocs.find((d) => d.local_path && d.tipo_documento === tipo) ??
          creditorDocs.find((d) => d.local_path && d.tipo_documento === 24) ??
          creditorDocs.find((d) => d.local_path);
        for (const tipo of neededTipos) {
          const baseDoc = pickDoc(tipo);
          if (!baseDoc?.local_path) {
            log(`   ⚠️ "${entry.nombre}": sin documento para acreditar ${tipo === 22 ? 'monto' : 'vencimiento'} (tipo ${tipo}).`);
            continue;
          }
          const docToAttach: AcreditacionDoc = { ...baseDoc, tipo_documento: tipo };
          await withRetry(
            () => attachDocumentoAcreedor(page, docToAttach, creditor.totalCredito, isOtros, log),
            {
              attempts: 2,
              delayMs: 3000,
              onRetry: (attempt, err) =>
                log(`⚠️ Reintento ${attempt}/1 adjuntar tipo ${tipo} "${entry.nombre}": ${err.message.substring(0, 100)}`),
            }
          ).catch((err) =>
            log(`⚠️ No se pudo adjuntar tipo ${tipo} (${tipo === 22 ? 'monto' : 'vencimiento'}) para "${entry.nombre}": ${(err as Error).message}`)
          );
        }
      }
    }

    // --- 5. Report summary -----------------------------------------------
    log('───────────────────────────────────────────');
    log(`📊 Resumen Paso 3: ${report.added.length} acreedor(es) agregado(s), ${report.skipped.length} saltado(s).`);
    report.skipped.forEach((s) => log(`   ⚠️ ${s.institucion}: ${s.reason}`));
    log('───────────────────────────────────────────');

    // Captura de comparación (robot vs abogada): página completa + tabla 260 + tabla 261, con
    // TODOS los acreedores ya cargados y ANTES de limpiar. Corre en DRY_RUN y en producción.
    await captureStep3ForComparison(page, log);

    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const dryRun = process.env.DRY_RUN !== 'false';
    if (dryRun) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const shot = path.join(outputDir, `verify_step3_${stamp}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      log(`📸 Screenshot de verificación Paso 3: ${shot}`);

      log('🧹 DRY_RUN=true: limpiando acreedores agregados e Informe CMF...');
      await dismissOpenModal(page).catch(() => {});
      await dismissBlockingDialogs(page, log).catch(() => {});
      await cleanupAcreedores(page, log).catch((err) => logError('No se pudo limpiar acreedores.', err));
      await cleanupCMF(page, log).catch((err) => logError('No se pudo limpiar el Informe CMF.', err));

      const cleanShot = path.join(outputDir, `verify_step3_clean_${stamp}.png`);
      await page.screenshot({ path: cleanShot, fullPage: true });
      log(`📸 Captura de borrador limpio: ${cleanShot}`);
      log('⚠️  DRY_RUN=true: formulario NO guardado permanentemente.');
      return report;
    }

    // --- PRODUCCIÓN: guardar y continuar al Paso 4 -----------------------
    log('→ Guardando y continuando al Paso 4...');
    await withRetry(
      async () => {
        const urlAntes = page.url();
        await page.locator('#btnContinuar').click();
        log('→ Esperando redirección al Paso 4...');
        await page.waitForFunction(
          (before: string) => window.location.href !== before,
          urlAntes,
          { timeout: 60000 }
        );
      },
      {
        attempts: 3,
        delayMs: 4000,
        onRetry: (attempt, err) =>
          log(`⚠️ Reintento ${attempt}/2 botón Continuar: ${err.message.substring(0, 100)}`),
      }
    );

    const successPath = path.join(outputDir, 'step3_success.png');
    await page.screenshot({ path: successPath, fullPage: true });
    log(`✓ Paso 3 completado. Captura de éxito: ${successPath}`);
    log(`→ Nueva URL: ${page.url()}`);
    return report;

  } catch (error) {
    logError('✗ Error en Paso 3.', error);
    await screenshotOnFailure(page, 'step3');
    throw error;
  }
}

/**
 * Opens the "Agregar Empresa" modal and fills it for one creditor.
 */
async function addEmpresaAcreedor(
  page: Page,
  entry: AcreedorCatalogEntry,
  creditor: CmfCreditor,
  log: (m: string) => void,
  isOtros: boolean,
  fechaVencimientoOverride?: string
): Promise<void> {
  const rut = normalizeRut(entry.rut);
  if (!rut) throw new Error('El acreedor del catálogo no tiene RUT.');
  const btnSelector = isOtros ? '#btnAgregarEmpresa2' : '#btnAgregarEmpresa';
  log(`→ Abriendo modal Empresa para "${entry.nombre}" (RUT ${rut}) [Otros: ${isOtros}]...`);
  await page.locator(btnSelector).click();
  await page.locator('#modalEmpresa').waitFor({ state: 'visible', timeout: 15000 });

  // RUT + Buscar (portal autocompletes the name)
  await page.locator('#empresaRutDv').fill(rut);
  await page.locator('#buscarEmpresa').click();

  // Wait for the portal to populate the name; fall back to catalog name.
  const nombreInput = page.locator('#empresaNombre');
  const autofilled = await nombreInput
    .evaluate((el: HTMLInputElement) => new Promise<boolean>((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (el.value.trim().length > 0) return resolve(true);
        if (Date.now() - start > 10000) return resolve(false);
        setTimeout(tick, 250);
      };
      tick();
    }))
    .catch(() => false);

  if (!autofilled) {
    log('   ⚠️ El portal no autocompletó el nombre; usando el del catálogo.');
    await page.evaluate(() => {
      const el = document.getElementById('empresaNombre');
      if (el) el.removeAttribute('readonly');
    });
    await nombreInput.fill(truncate(entry.nombre, MAX.nombre));
  }

  // Address
  await locByName(page, 'empresaAcreedor.direccion').fill(truncate(entry.direccion ?? '', MAX.direccion));

  // Región + Comuna (dependent dropdowns)
  await selectRegionAndComuna(page, entry, log);

  // Contact
  await locByName(page, 'empresaAcreedor.notificacionEmail').fill(truncate(entry.email ?? '', MAX.email));
  await locByName(page, 'empresaAcreedor.notificacionTelefono').fill(truncate(entry.telefono ?? '', MAX.telefono));

  // Legal representative (optional)
  if (entry.representante_legal && entry.rut_representante && isValidRut(entry.rut_representante)) {
    await addRepresentante(page, entry, '#agregarRepresentanteLegalEmpresa', log).catch((err) =>
      log(`   ⚠️ No se pudo agregar representante legal: ${(err as Error).message}`)
    );
  } else if (entry.representante_legal) {
    log(`   ⚠️ Omitiendo agregar representante legal "${entry.representante_legal}" porque su RUT "${entry.rut_representante}" no tiene un formato válido.`);
  }

  // Debt amount = "Total del crédito" from the CMF.
  await locByName(page, 'empresaAcreedor.deudaMonto').fill(truncate(String(creditor.totalCredito), MAX.monto));

  // Vencimiento — SOLO para Art. 260 (Obligaciones). El Art. 261 (Otros Acreedores)
  // NO acredita vencimiento → la columna va EN BLANCO (igual que lo hace el abogado).
  // Antes se llenaba siempre con dateDaysAgo(90), poniendo una fecha (21/03/2026) en
  // los 261 que no corresponde.
  if (isOtros) {
    log(`   ℹ️ Art.261 "${entry.nombre}": sin fecha de vencimiento (Otros Acreedores no la acredita).`);
  } else {
    // Art.260 requiere fecha de cuota impaga REAL. NUNCA inventar con placeholder:
    // un 260 sin vencimiento acreditable debe haberse degradado a Art.261 aguas arriba
    // (backstop del Centinela). Si igual llega acá sin fecha, es un bug → abortar este
    // acreedor (el loop lo reporta como skipped y sigue) en vez de cargar una fecha falsa.
    if (!fechaVencimientoOverride) {
      throw new Error(
        `Art.260 "${entry.nombre}" sin fecha de vencimiento real: no se carga en 260 con placeholder. ` +
        `Debió degradarse a Art.261 (sin acreditación de vencimiento).`
      );
    }
    await fillDateField(page, '#empresaAcreedorFchCuotaImpaga', fechaVencimientoOverride, log);
  }

  // Dismiss any overlay dialog blocking clicks (e.g. #dlgImportante after rep modal closes)
  await dismissBlockingDialogs(page, log);

  // Save
  await page.locator('#btnGuardarEmpresa').click();
  await page.locator('#modalEmpresa').waitFor({ state: 'hidden', timeout: 20000 });

  // Wait for the full page reload/navigation to complete and scripts to stabilize
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
}

/**
 * Selects Región (by option value) then Comuna (by matching visible text).
 */
async function selectRegionAndComuna(
  page: Page,
  entry: AcreedorCatalogEntry,
  log: (m: string) => void
): Promise<void> {
  const regionValue = getRegionValue(entry.comuna);
  if (!regionValue) {
    throw new Error(`Comuna sin mapeo a región: "${entry.comuna}".`);
  }

  await selectBootstrap(page, 'empresaRegion', regionValue);

  // Wait for comuna options to populate.
  await page.waitForFunction(
    () => (document.querySelector('#empresaComuna') as HTMLSelectElement | null)?.options.length! > 1,
    undefined,
    { timeout: 15000 }
  );

  const target = normalizeText(entry.comuna ?? '');
  const comunaValue = await page.$$eval(
    '#empresaComuna option',
    (opts, t) =>
      (opts as HTMLOptionElement[]).find(
        (o) => o.textContent!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === t
      )?.value ?? null,
    target
  );

  if (!comunaValue) {
    throw new Error(`Comuna "${entry.comuna}" no está en el listado de la región.`);
  }

  await selectBootstrap(page, 'empresaComuna', comunaValue);
  log(`   ✓ Región (${regionValue}) y comuna ("${entry.comuna}") seleccionadas.`);
}

/**
 * Opens the Representante Legal modal and fills it. Tries the portal's RUT
 * lookup first; falls back to splitting the stored full name.
 */
async function addRepresentante(
  page: Page,
  entry: AcreedorCatalogEntry,
  btnSelector: string,
  log: (m: string) => void
): Promise<void> {
  const repRut = normalizeRut(entry.rut_representante);
  if (!repRut) throw new Error('Representante sin RUT.');

  await page.locator(btnSelector).click();
  await page.locator('#modalRepresentante').waitFor({ state: 'visible', timeout: 10000 });

  await page.locator('#representanteRutDv').fill(repRut);
  await page.locator('#btnBuscarRep').click();
  await page.waitForTimeout(2500);

  const nombresFilled = await page.locator('#representanteNombres').evaluate(
    (el: HTMLInputElement) => el.value.trim().length > 0
  );

  if (!nombresFilled) {
    const { nombres, paterno, materno } = splitName(entry.representante_legal!);
    await page.locator('#representanteNombres').fill(truncate(nombres, 50));
    await page.locator('#representanteAPaterno').fill(truncate(paterno, 30));
    if (materno) await page.locator('#representanteAMaterno').fill(truncate(materno, 30));
  }

  await page.locator('#guardarRep').click();
  await page.locator('#modalRepresentante').waitFor({ state: 'hidden', timeout: 10000 });
  // Portal may show #dlgImportante after saving a representative — dismiss it immediately
  await dismissBlockingDialogs(page, log);
  log(`   ✓ Representante legal agregado (${repRut}).`);
}

/** Returns a date N days ago as dd/mm/yyyy. */
function dateDaysAgo(days: number): string {
  // Use Chile timezone so the date is correct regardless of Mac Mini system timezone
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  d.setDate(d.getDate() - days);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Best-effort cleanup of every creditor row in both tables added during a dry run.
 */
async function cleanupAcreedores(page: Page, log: (m: string) => void): Promise<void> {
  for (const tableId of ['tablaAcreedores', 'tablaOtrosAcreedores']) {
    for (let i = 0; i < 20; i++) {
      const deleteBtn = page
        .locator(`#${tableId} tbody tr button[title*="liminar"], #${tableId} tbody tr a[title*="liminar"]`)
        .first();
      if ((await deleteBtn.count()) === 0) break;

      log(`   🗑️ Eliminando fila de acreedor...`);
      await deleteBtn.click();
      const confirm = page.locator('#btnConfirmarModal');
      await confirm.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(2000);
    }
  }
  log('   🗑️ Acreedores de prueba eliminados (best-effort).');
}

async function cleanupCMF(page: Page, log: (m: string) => void): Promise<void> {
  const deleteSelector = '#btnEliminarCMF';
  if (!(await page.locator(deleteSelector).count())) return;

  log('   🗑️ Eliminando Informe CMF...');
  await page.locator(deleteSelector).click();
  const confirm = page.locator('#btnConfirmarModal');
  await confirm.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
    await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }
  await page.locator(deleteSelector).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  log('   🗑️ Informe CMF eliminado.');
}

/**
 * Opens the "Agregar Persona Natural" modal and fills it for one creditor.
 */
async function addPersonaAcreedor(
  page: Page,
  entry: AcreedorCatalogEntry,
  creditor: CmfCreditor,
  log: (m: string) => void,
  isOtros: boolean,
  fechaVencimientoOverride?: string
): Promise<void> {
  const rut = normalizeRut(entry.rut);
  if (!rut) throw new Error('El acreedor del catálogo no tiene RUT.');
  const btnSelector = isOtros ? '#btnAgregarPersona2' : '#btnAgregarPersona';
  log(`→ Abriendo modal Persona Natural para "${entry.nombre}" (RUT ${rut}) [Otros: ${isOtros}]...`);
  await page.locator(btnSelector).click();
  await page.locator('#modalPersona').waitFor({ state: 'visible', timeout: 15000 });

  await page.locator('#personaRutDv').fill(rut);
  await page.locator('#buscarPersona').click();
  await page.waitForTimeout(2500);

  const nombresFilled = await page.locator('[id="persona.nombres"]').evaluate(
    (el: HTMLInputElement) => el.value.trim().length > 0
  );
  if (!nombresFilled) {
    const { nombres, paterno, materno } = splitName(entry.nombre);
    await page.evaluate(() => {
      const n = document.getElementById('persona.nombres');
      const p = document.getElementById('persona.aPaterno');
      const m = document.getElementById('persona.aMaterno');
      if (n) n.removeAttribute('readonly');
      if (p) p.removeAttribute('readonly');
      if (m) m.removeAttribute('readonly');
    });
    await page.locator('[id="persona.nombres"]').fill(truncate(nombres, 50));
    await page.locator('[id="persona.aPaterno"]').fill(truncate(paterno, 30));
    if (materno) await page.locator('[id="persona.aMaterno"]').fill(truncate(materno, 30));
  }

  await locByName(page, 'personaAcreedor.direccion').fill(truncate(entry.direccion ?? '', MAX.direccion));
  await selectPersonaRegionAndComuna(page, entry, log);
  await locByName(page, 'personaAcreedor.notificacionEmail').fill(truncate(entry.email ?? '', MAX.email));
  await locByName(page, 'personaAcreedor.notificacionTelefono').fill(truncate(entry.telefono ?? '', MAX.telefono));

  if (entry.representante_legal && entry.rut_representante && isValidRut(entry.rut_representante)) {
    await addRepresentante(page, entry, '#agregarRepresentanteLegalPersona', log).catch((err) =>
      log(`   ⚠️ No se pudo agregar representante legal: ${(err as Error).message}`)
    );
  } else if (entry.representante_legal) {
    log(`   ⚠️ Omitiendo agregar representante legal "${entry.representante_legal}" porque su RUT "${entry.rut_representante}" no tiene un formato válido.`);
  }

  await locByName(page, 'personaAcreedor.deudaMonto').fill(truncate(String(creditor.totalCredito), MAX.monto));
  // Vencimiento — SOLO Art. 260. El Art. 261 (Otros Acreedores) va EN BLANCO.
  if (isOtros) {
    log(`   ℹ️ Art.261 "${entry.nombre}": sin fecha de vencimiento (Otros Acreedores no la acredita).`);
  } else {
    // Art.260 requiere fecha de vencimiento REAL — nunca placeholder (ver addEmpresaAcreedor).
    if (!fechaVencimientoOverride) {
      throw new Error(
        `Art.260 "${entry.nombre}" sin fecha de vencimiento real: no se carga en 260 con placeholder. ` +
        `Debió degradarse a Art.261 (sin acreditación de vencimiento).`
      );
    }
    await clearAndFill(page, '#personaFechaCuotaImpaga', fechaVencimientoOverride);
  }

  await page.locator('#btnGuardarPersona').click();
  await page.locator('#modalPersona').waitFor({ state: 'hidden', timeout: 20000 });

  // Wait for the full page reload/navigation to complete and scripts to stabilize
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
}

/**
 * Selects Región + Comuna for the Persona Natural modal.
 */
async function selectPersonaRegionAndComuna(
  page: Page,
  entry: AcreedorCatalogEntry,
  log: (m: string) => void
): Promise<void> {
  const regionValue = getRegionValue(entry.comuna);
  if (!regionValue) {
    throw new Error(`Comuna sin mapeo a región: "${entry.comuna}".`);
  }

  await selectBootstrap(page, 'personaRegion', regionValue);

  await page.waitForFunction(
    () => (document.querySelector('#personaAcreedorcomuna') as HTMLSelectElement | null)?.options.length! > 1,
    undefined,
    { timeout: 15000 }
  );

  const target = normalizeText(entry.comuna ?? '');
  const comunaValue = await page.$$eval(
    '#personaAcreedorcomuna option',
    (opts, t) =>
      (opts as HTMLOptionElement[]).find(
        (o) => o.textContent!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() === t
      )?.value ?? null,
    target
  );

  if (!comunaValue) {
    throw new Error(`Comuna "${entry.comuna}" no está en el listado de la región (persona).`);
  }

  await selectBootstrap(page, 'personaAcreedorcomuna', comunaValue);
  log(`   ✓ Región (${regionValue}) y comuna ("${entry.comuna}") seleccionadas (persona).`);
}

// ─── Acreditación helpers ────────────────────────────────────────────────────

function normInst(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findAcreditacionDocs(
  institucion: string,
  docs: AcreditacionDoc[]
): AcreditacionDoc[] {
  if (!docs.length) return [];
  const target = normInst(institucion);
  const targetKey = canonicalInstitutionKey(institucion); // A1: alias-aware
  return docs.filter((d) => {
    const n = normInst(d.institucion_cmf);
    if (n === target || target.includes(n) || n.includes(target)) return true;
    // A1: fallback alias-aware — el doc puede traer el nombre canónico del catálogo
    // ("CAR S.A. (Tarjeta Ripley)") y el acreedor el del CMF ("CAR - Ripley").
    const key = canonicalInstitutionKey(d.institucion_cmf);
    return key !== '' && key === targetKey;
  });
}

async function downloadAcreditacionDocs(
  supabase: SupabaseClient,
  docs: AcreditacionDoc[],
  tmpDir: string,
  log: (m: string) => void
): Promise<void> {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (const doc of docs) {
    const ext = path.extname(doc.storage_path) || '.pdf';
    const slug = path.basename(doc.storage_path, ext);
    const localPath = path.join(tmpDir, `${slug}${ext}`);

    if (fs.existsSync(localPath)) {
      doc.local_path = localPath;
      log(`→ Certificado en caché local: ${path.basename(localPath)}`);
      continue;
    }

    log(`→ Descargando certificado "${doc.institucion_cmf}"...`);
    let downloaded: Blob | null = null;
    try {
      downloaded = await withRetry(
        async () => {
          const { data, error } = await supabase.storage.from('documentos').download(doc.storage_path);
          if (error || !data) throw new Error(error?.message ?? 'blob vacío');
          return data;
        },
        {
          attempts: 3,
          delayMs: 2000,
          onRetry: (attempt, err) =>
            log(`⚠️ Reintento ${attempt}/2 descarga "${doc.storage_path}": ${err.message}`),
        }
      );
    } catch (err) {
      log(
        `⚠️ No se pudo descargar "${doc.storage_path}" tras 3 intentos: ${(err as Error).message}`
      );
      continue;
    }
    fs.writeFileSync(localPath, Buffer.from(await downloaded.arrayBuffer()));
    doc.local_path = localPath;
    log(`✓ Descargado: ${path.basename(localPath)}`);
  }
}

/**
 * Opens #modalAdjunto for the most recently added creditor row,
 * sets the file (PDF or JPEG) and tipo, then saves.
 */
async function attachDocumentoAcreedor(
  page: Page,
  doc: AcreditacionDoc,
  monto: number,
  isOtros: boolean,
  log: (m: string) => void
): Promise<void> {
  if (!doc.local_path || !fs.existsSync(doc.local_path)) {
    throw new Error(`Archivo local no disponible: ${doc.local_path ?? '(sin ruta)'}`);
  }

  // El portal de la Superir solo acepta PDF, JPG y JPEG. Otros formatos (PNG, etc.)
  // se rechazan en el cliente y dejan el botón "Guardar" deshabilitado → timeout
  // críptico. Fallar acá con un mensaje claro y accionable.
  const ext = path.extname(doc.local_path).toLowerCase();
  const ACCEPTED = ['.pdf', '.jpg', '.jpeg'];
  if (!ACCEPTED.includes(ext)) {
    throw new Error(
      `Formato "${ext}" no soportado por el portal para "${doc.institucion_cmf}" ` +
      `(${path.basename(doc.local_path)}). Solo PDF/JPG/JPEG. Convertir el archivo (ej. PNG → JPG) antes de adjuntar.`
    );
  }

  const tableSelector = isOtros ? '#tablaOtrosAcreedores' : '#tablaAcreedores';

  log(`→ Adjuntando documento tipo ${doc.tipo_documento} de "${doc.institucion_cmf}" (Monto: $${monto.toLocaleString('es-CL')}, Otros: ${isOtros})...`);

  // Wait for the table to have at least one row after the AJAX reload
  await page.locator(`${tableSelector} tbody tr`).first().waitFor({ state: 'visible', timeout: 20000 });

  const rows = page.locator(`${tableSelector} tbody tr`);
  const rowCount = await rows.count();
  let docBtn = null;

  const targetName = normalizeText(doc.institucion_cmf);
  log(`   🔍 Buscando en ${tableSelector} fila con monto $${monto.toLocaleString('es-CL')} para subir tipo ${doc.tipo_documento}...`);

  // First pass: look for a row with matching amount and check if the specific document type is already attached
  for (let i = rowCount - 1; i >= 0; i--) {
    const row = rows.nth(i);
    const cols = row.locator('td');
    const colCount = await cols.count();
    if (colCount < 7) continue;

    const montoText = await cols.nth(2).textContent().catch(() => '');
    const cleanMonto = parseInt(montoText?.replace(/[^0-9]/g, '') ?? '0', 10);

    if (cleanMonto === monto) {
      const docColText = (await cols.nth(5).textContent().catch(() => '')) ?? '';
      const docColTextNorm = normalizeText(docColText);

      let alreadyUploaded = false;
      if (doc.tipo_documento === 22) {
        alreadyUploaded = docColTextNorm.includes('monto') || docColTextNorm.includes('monto y vencimiento') || docColTextNorm.includes('vencimiento y monto');
      } else if (doc.tipo_documento === 23) {
        alreadyUploaded = docColTextNorm.includes('vencimiento') || docColTextNorm.includes('monto y vencimiento') || docColTextNorm.includes('vencimiento y monto');
      } else if (doc.tipo_documento === 24) {
        alreadyUploaded = docColTextNorm.includes('monto y vencimiento') || docColTextNorm.includes('vencimiento y monto') || (docColTextNorm.includes('monto') && docColTextNorm.includes('vencimiento'));
      }

      if (alreadyUploaded) {
        log(`   ℹ️ El documento tipo ${doc.tipo_documento} ya está adjuntado para esta fila (Monto: $${monto.toLocaleString('es-CL')}). Omitiendo upload.`);
        return;
      }

      const btn = cols.nth(5).locator('button, a').filter({ hasText: /subir/i }).first();
      if (await btn.count() > 0) {
        docBtn = btn;
        log(`   ✓ Fila exacta encontrada por monto en índice ${i} de ${tableSelector} para subir tipo ${doc.tipo_documento}.`);
        break;
      }
    }
  }

  // Second pass fallback: generic match using text or col position in the same table
  if (!docBtn) {
    log(`   ⚠️ No se encontró fila exacta por monto. Buscando por botón de subida en ${tableSelector}...`);
    for (let i = rowCount - 1; i >= 0; i--) {
      const byText = rows.nth(i).locator('button, a').filter({ hasText: /subir/i }).first();
      if ((await byText.count()) > 0) {
        docBtn = byText;
        break;
      }
    }
  }

  if (!docBtn) throw new Error(`No se encontró el botón "Subir Documento" en ${tableSelector}.`);

  await docBtn.click();
  await page.locator('#modalAdjunto').waitFor({ state: 'visible', timeout: 10000 });

  // Select tipo documento (bootstrap-select needs a change event)
  await selectBootstrap(page, 'tipoArchivoAdjunto', String(doc.tipo_documento));

  // Set file — Playwright bypasses the accept filter; works for PDF, JPEG, JPG
  await page.locator('#archivoAdjunto').setInputFiles(doc.local_path);
  await page.evaluate(() => {
    const inp = document.querySelector('#archivoAdjunto') as HTMLInputElement | null;
    inp?.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Wait for the guardar button to become enabled
  await page.waitForFunction(
    () => !(document.querySelector('#guardarAdjunto') as HTMLButtonElement | null)?.disabled,
    undefined,
    { timeout: 10000 }
  );

  await page.locator('#guardarAdjunto').click();
  await page.locator('#modalAdjunto').waitFor({ state: 'hidden', timeout: 15000 });

  // Wait for the full page reload/navigation to complete and scripts to stabilize
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);

  log(`✓ Documento adjuntado para "${doc.institucion_cmf}".`);
}

/**
 * Dismisses dialogs that overlay #modalEmpresa and block pointer events.
 * The portal shows #dlgImportante (an informational modal) after saving a
 * representante legal. We must close it before clicking #btnGuardarEmpresa.
 */
async function dismissBlockingDialogs(page: Page, log: (m: string) => void): Promise<void> {
  const blockers = ['#dlgImportante'];
  for (const id of blockers) {
    const dlg = page.locator(`${id}.show`);
    if ((await dlg.count()) === 0) continue;

    const content = await dlg.locator('.modal-body').first().textContent().catch(() => '');
    log(`   ℹ️ Cerrando diálogo bloqueador ${id}: "${content?.trim().substring(0, 120)}"`);

    const btn = dlg.locator('button[data-dismiss="modal"], .btn-close, button.close, .modal-footer button').first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await dlg.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    } else {
      await page.evaluate((dlgId) => {
        const el = document.getElementById(dlgId) as HTMLElement | null;
        if (!el) return;
        el.classList.remove('show');
        (el as HTMLElement).style.display = 'none';
        el.removeAttribute('aria-modal');
        document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
        document.body.classList.remove('modal-open');
      }, id.replace('#', ''));
      log(`   ℹ️ ${id} cerrado vía JS.`);
    }
  }
}

async function dismissOpenModal(page: Page): Promise<void> {
  const closeBtn = page.locator('.modal.show button[data-dismiss="modal"]').first();
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click();
    await page.waitForTimeout(500);
    return;
  }
  // Force-close via jQuery (handles static-backdrop modals like #modalEmpresa)
  await page.evaluate(() => {
    const $ = (window as any).$;
    if ($) $('.modal.show').each((_: unknown, el: HTMLElement) => { $(el).modal('hide'); });
  }).catch(() => {});
  await page.waitForTimeout(800);
}

/** Locator by exact `id` attribute (safe for IDs containing dots). */
function locByName(page: Page, id: string) {
  return page.locator(`[id="${id}"]`);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.substring(0, max) : value;
}

/**
 * Splits a full Chilean name into nombres / apellido paterno / apellido materno.
 * Heuristic: last token = materno, second-to-last = paterno, rest = nombres.
 */
function splitName(full: string): { nombres: string; paterno: string; materno: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { nombres: parts[0], paterno: '', materno: '' };
  if (parts.length === 2) return { nombres: parts[0], paterno: parts[1], materno: '' };
  const materno = parts.pop()!;
  const paterno = parts.pop()!;
  return { nombres: parts.join(' '), paterno, materno };
}

async function clearAndFill(page: Page, selector: string, value: string): Promise<void> {
  const locator = page.locator(selector);
  await locator.click({ clickCount: 3 });
  await locator.fill(value);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }, selector);
}

/**
 * Sets a date text-input that may be controlled by a jQuery datepicker.
 * Tries (1) jQuery datepicker API, (2) Playwright fill(), (3) pressSequentially.
 */
async function fillDateField(
  page: Page,
  selector: string,
  value: string,
  log: (m: string) => void
): Promise<void> {
  // Method 0: Simple jQuery val()
  const setSimpleVal = await page.evaluate(({ sel, date }) => {
    const $ = (window as any).$;
    if (!$) return false;
    const $el = $(sel);
    if (!$el.length) return false;
    $el.val(date);
    $el.trigger('change');
    return true;
  }, { sel: selector, date: value });

  if (setSimpleVal) {
    const v = await page.locator(selector).inputValue().catch(() => '');
    if (v === value) {
      log(`   ✓ Vencimiento seteado via jQuery val(): "${v}"`);
      return;
    }
  }

  // Method 1: jQuery datepicker setDate
  const setViaJQuery = await page.evaluate(({ sel, date }) => {
    const $ = (window as any).$;
    if (!$) return false;
    const $el = $(sel);
    if (!$el.length) return false;
    try {
      if (typeof $el.datepicker === 'function') {
        $el.datepicker('setDate', date);
        $el.datepicker('update');
        $el.trigger('changeDate').trigger('change');
        return true;
      }
    } catch (_) { /* not a datepicker */ }
    return false;
  }, { sel: selector, date: value });

  if (setViaJQuery) {
    const v = await page.locator(selector).inputValue().catch(() => '');
    if (v) { log(`   ✓ Vencimiento seteado via jQuery datepicker: "${v}"`); return; }
  }

  // Method 2: Playwright fill() with triple-click
  await page.locator(selector).click({ clickCount: 3 });
  await page.locator(selector).fill(value);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }, selector);

  const v2 = await page.locator(selector).inputValue().catch(() => '');
  if (v2) { log(`   ✓ Vencimiento seteado via fill(): "${v2}"`); return; }

  // Method 3: pressSequentially (simulates real keypresses)
  log(`   ⚠️ fill() no funcionó. Intentando pressSequentially...`);
  await page.locator(selector).click({ clickCount: 3 });
  await page.keyboard.press('Delete');
  await page.locator(selector).pressSequentially(value, { delay: 80 });
  await page.locator(selector).dispatchEvent('change');

  const v3 = await page.locator(selector).inputValue().catch(() => '');
  log(`   🔍 Vencimiento tras pressSequentially: "${v3}"`);
}

// ─── Retry / resilience helpers ──────────────────────────────────────────────

/**
 * Retries an async operation up to `attempts` times with linear back-off.
 * If all attempts fail, the last error is re-thrown.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    delayMs?: number;
    onRetry?: (attempt: number, err: Error) => void;
  } = {}
): Promise<T> {
  const { attempts = 3, delayMs = 3000, onRetry } = opts;
  let lastErr: Error = new Error('No attempts made');
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err as Error;
      if (i < attempts) {
        onRetry?.(i, lastErr);
        await new Promise<void>((r) => setTimeout(r, delayMs * i));
      }
    }
  }
  throw lastErr;
}

/**
 * Returns true if a row with exactly `monto` already exists in the target table.
 * Used to skip adding a creditor again after a retry.
 */
async function isCreditorAlreadyInTable(
  page: Page,
  monto: number,
  isOtros: boolean,
  log?: (m: string) => void
): Promise<boolean> {
  const tableId = isOtros ? '#tablaOtrosAcreedores' : '#tablaAcreedores';
  const rows = page.locator(`${tableId} tbody tr`);
  const count = await rows.count().catch(() => 0);
  // A2: contar coincidencias por monto. La idempotencia matchea SOLO por monto;
  // si dos acreedores distintos tienen el mismo monto, hay riesgo de falso "ya existe"
  // y de cruce de certificados. Al menos lo advertimos.
  let matches = 0;
  for (let i = 0; i < count; i++) {
    const cols = rows.nth(i).locator('td');
    const colCount = await cols.count().catch(() => 0);
    if (colCount < 3) continue;
    const montoText = await cols.nth(2).textContent().catch(() => '');
    const cleanMonto = parseInt(montoText?.replace(/[^0-9]/g, '') ?? '0', 10);
    if (cleanMonto === monto) matches++;
  }
  if (matches > 1 && log) {
    log(`⚠️ ${matches} filas con el mismo monto ($${monto.toLocaleString('es-CL')}) en ${tableId}: la idempotencia/adjunción por monto puede confundirlas. Revisar.`);
  }
  return matches > 0;
}

/**
 * Verifies we are still on the verAcreedores page.
 * Navigates back if we drifted (e.g. after an unexpected redirect).
 * Throws if the session appears to have expired.
 */
async function ensureOnAcreedoresPage(page: Page, log: (m: string) => void): Promise<void> {
  const url = page.url();
  if (url.includes('login') || url.includes('claveunica') || url.includes('acceso')) {
    throw new Error(`Sesión expirada — redirigido a: ${url}`);
  }
  if (!url.includes('verAcreedores') && !url.includes('acreedores')) {
    log(`⚠️ URL inesperada (${url}). Renavegando a verAcreedores...`);
    const base = new URL(url).origin;
    await page.goto(`${base}/miSuperir/autenticado/renegociacion/verAcreedores`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 20000 });
    await page.waitForTimeout(2000);
  }
}

async function selectBootstrap(page: Page, selectId: string, value: string): Promise<void> {
  await page.locator(`#${selectId}`).selectOption(value);
  await page.evaluate(({ id, val }) => {
    // @ts-ignore
    const $ = window.$;
    if ($ && $(`#${id}`).hasClass('selectpicker')) {
      // @ts-ignore
      $(`#${id}`).selectpicker('val', val);
      // @ts-ignore
      $(`#${id}`).selectpicker('refresh');
      // @ts-ignore
      $(`#${id}`).trigger('change');
    } else {
      const el = document.getElementById(id);
      if (el) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, { id: selectId, val: value });
  await page.waitForTimeout(300);
}

/**
 * Scans a certificate PDF for Chilean RUTs, filters out the client's RUT,
 * and checks if any remaining RUT matches a canonical creditor in the catalog.
 */
async function detectCreditorRutFromDoc(
  pdfPath: string,
  clientRut: string | null,
  catalog: AcreedorCatalogEntry[],
  log: (m: string) => void
): Promise<AcreedorCatalogEntry | null> {
  try {
    const text = await extractTextFromPdf(pdfPath);
    const ruts = extractRutsFromText(text);
    return findCatalogEntryByRut(ruts, catalog, clientRut);
  } catch (err) {
    log(`   ⚠️ Error al intentar extraer RUT del certificado ${path.basename(pdfPath)}: ${(err as Error).message}`);
  }
  return null;
}

