/**
 * Cadena de backstops DETERMINISTAS del Centinela (Paso 3) — extraída de runSentinelCheck.
 *
 * Principio rector del proyecto: *el LLM extrae hechos; TypeScript blinda la estructura*.
 * Esta es la capa de blindaje: opera sobre el `raw` que produjo el LLM (mega-llamada) o el
 * ensamblador por-documento (`assembleRawFromDocFacts`) y lo refina de forma 100% determinista
 * (sin red, sin API). Vive en su propio módulo para ser UNIT-TESTEABLE sin gastar API
 * (golden tests con `raw` sintético) — antes vivía inline en runSentinelCheck (que llama al LLM).
 *
 * Orden (idéntico al que corría inline):
 *  1. Reconciliación additionalCreditors → identified261Creditors (anti doble conteo).
 *  2. Completitud vía extractCertLineItems (agrega ítems del cert que el LLM omitió).
 *  3. Gate de acreditación Art. 260 → degradar 260→261 + rescate-por-chat.
 *  4. promoteOverflowIdentified261ToAdditional (productos extra → NO-CMF).
 *  5. Validación anti-error (Capas 1/2: auto-cita, cross-check RUT, confianza, moneda, dedup op)
 *     → produce claudeReadIssues (informativo).
 *
 * NO cambia el contrato de salida (SentinelResult). El único import desde sentinel.ts es de
 * TIPOS (`import type`, erased en runtime) → no hay ciclo de imports en tiempo de ejecución.
 */

import type {
  SentinelResult,
  Identified261Creditor,
  AdditionalCreditor,
  ExtractionEvidence,
  ClaudeReadIssue,
} from './sentinel';
import type { CmfCreditor } from './cmf_analyzer';
import type { ClientDocument } from './cognitive_orchestrator';
import { canonicalInstitutionKey, normalizeRut, findCatalogEntryByRut, AcreedorCatalogEntry } from './acreedor_matcher';
import { extractCertLineItems, detectDocumentCurrency, normalizeOperationId } from './cert_line_items';
import { extractTextFromPdfLayout } from './pdf_analyzer';

// --- Slots de productos por institución (usados por la promoción de overflow) ---
interface InstitutionSlots {
  total: number;
  credito_consumo: number;
  tarjeta_credito: number;
  otro: number;
}

function emptyInstitutionSlots(): InstitutionSlots {
  return { total: 0, credito_consumo: 0, tarjeta_credito: 0, otro: 0 };
}

function getCmfProductBucket(c: CmfCreditor): keyof Omit<InstitutionSlots, 'total'> {
  if (c.tipoCredito === 'credito_consumo' || c.tipoCredito === 'tarjeta_credito') {
    return c.tipoCredito;
  }
  return 'otro';
}

function getIdentified261ProductBucket(c: Identified261Creditor): keyof Omit<InstitutionSlots, 'total'> {
  if (c.product_type === 'credito_consumo' || c.product_type === 'tarjeta_credito') {
    return c.product_type;
  }
  return 'otro';
}

export function isChatDocument(textContent: string | null | undefined, filename: string, docType?: string): boolean {
  // CONFIAR EN EL LLM: en el camino per-doc el LLM ya clasifica el tipo de documento. Su
  // `doc_type` es más robusto que el regex (que sufre falsos positivos, ej. un timestamp de
  // GENERACIÓN en el pie de un certificado legítimo). Si el LLM lo clasificó, su palabra manda;
  // el regex de abajo queda SOLO como fallback del camino monolítico (sin doc_type por documento).
  if (docType) return docType === 'chat';
  if (!textContent) return false;
  const textLower = textContent.toLowerCase();
  const nameLower = filename.toLowerCase();
  // Señales FUERTES de conversación (filename o marcadores de mensajería) → chat.
  if (
    nameLower.includes('chat') ||
    nameLower.includes('whatsapp') ||
    nameLower.includes('captura') ||
    textLower.includes('[whatsapp]') ||
    textLower.includes('escribió:') ||
    textLower.includes('escribio:') ||
    textLower.includes('mensajes de whatsapp')
  ) {
    return true;
  }
  // Señal DÉBIL: marcas de tiempo "dd/mm/aaaa hh:mm". Un chat trae MUCHAS (una por mensaje);
  // un certificado suele traer UNA de generación en el pie. Exigir ≥3 evita el falso positivo
  // del timestamp de pie (testigo: cert CCAF con "01-07-2026 13:46:42" repetido por página).
  const tsMatches = textContent.match(/\[?\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?)?\]?/gi);
  return !!tsMatches && tsMatches.length >= 3;
}

/**
 * Detecta documentos que NO acreditan por sí solos el MONTO de una deuda (mejora #4,
 * importada del flujo del supervisor). CONSERVADOR y por CONTENIDO (no por filename):
 * NUNCA descarta el acreedor ni pone $0 (regla rectora G2: jamás bajar un valor en
 * silencio) — solo MARCA para que el abogado verifique el monto contra un cert formal.
 * Solo dispara si el documento NO trae ningún rótulo de payoff/saldo (esos sí acreditan).
 *
 *  - comprobante_pago: comprobante de pago/transferencia (prueba un PAGO, no la deuda).
 *    Es el más peligroso (puede inducir "deuda saldada → $0"); ver lección L1.
 *  - cartola: cartola/detalle de movimientos SIN rótulo de saldo/deuda a pagar.
 *
 * En imágenes/escaneos (textContent es placeholder) devuelve null: ahí no hay texto
 * determinista → la disciplina recae en la confianza que reporta Claude (ver prompt).
 */
export function classifyNonAccreditingDoc(
  textContent: string | null | undefined,
  _filename: string,
  docType?: string
): { tipo: 'comprobante_pago' | 'cartola' | null; motivo: string } {
  // CONFIAR EN EL LLM: si el LLM ya clasificó el documento (camino per-doc), su doc_type manda.
  if (docType) {
    if (docType === 'comprobante_pago')
      return { tipo: 'comprobante_pago', motivo: 'el LLM lo clasificó como COMPROBANTE DE PAGO, no un certificado de deuda — verificar el monto con un certificado formal' };
    if (docType === 'cartola')
      return { tipo: 'cartola', motivo: 'el LLM lo clasificó como CARTOLA / detalle de movimientos, que no acredita por sí sola el saldo — verificar con estado de cuenta o certificado' };
    return { tipo: null, motivo: '' };
  }
  const text = (textContent || '').toLowerCase();
  if (text.length < 25 || text.trim().startsWith('[')) return { tipo: null, motivo: '' };

  // Rótulos de payoff/saldo que SÍ acreditan una deuda vigente. Si el doc trae alguno,
  // no lo tratamos como comprobante/cartola por más que mencione "pago" o "movimientos".
  const tienePayoff =
    /saldo\s+(insoluto|deuda|adeudad|total|capital|para\s+(liquidar|prepago))/i.test(text) ||
    /(monto\s+total\s+a\s+pagar|deuda\s+total|total\s+a\s+pagar|total\s+adeudado|monto\s+utilizado)/i.test(text) ||
    /costo\s+(de\s+prepago|monetario\s+(de\s+)?prepago|total\s+(del|monetario)\s+prepago)/i.test(text) ||
    /cartera\s+vencida|cobranza\s+(judicial|prejudicial)|deuda\s+prejudicial/i.test(text);

  if (tienePayoff) return { tipo: null, motivo: '' };

  const esComprobantePago =
    /comprobante\s+de\s+(pago|transferencia|transacci[oó]n)/i.test(text) ||
    /(pago|transferencia|transacci[oó]n)\s+(exitosa|exitoso|realizad[oa]|aprobad[oa]|recibid[oa]|procesad[oa])/i.test(text) ||
    /tu\s+pago\s+(fue|ha\s+sido)\s+(procesad|recibid|aprobad)/i.test(text);
  if (esComprobantePago)
    return { tipo: 'comprobante_pago', motivo: 'parece un COMPROBANTE DE PAGO, no un certificado de deuda. Un pago no acredita el monto adeudado — verificar con un certificado formal' };

  const esCartola =
    /cartola(\s+(hist[oó]rica|de\s+movimientos|nacional|cuatrimestral|mensual|electr[oó]nica))?/i.test(text) ||
    /detalle\s+de\s+movimientos/i.test(text);
  if (esCartola)
    return { tipo: 'cartola', motivo: 'parece una CARTOLA / detalle de movimientos, que no acredita por sí sola el saldo de la deuda — verificar con estado de cuenta o certificado' };

  return { tipo: null, motivo: '' };
}

/**
 * Si un mismo certificado de una institución genera MÁS productos 261 que las
 * líneas que esa institución tiene en el CMF, los excedentes deben viajar como
 * NO-CMF para que step3 cree filas extra. Sin esta promoción, step3 solo ajusta
 * montos de filas CMF existentes y el producto extra se pierde. Caso testigo:
 * BancoEstado de Néctor (3 CRE en el certificado, pero solo 2 líneas BancoEstado en el CMF).
 */
export function promoteOverflowIdentified261ToAdditional(
  result: SentinelResult,
  cmfCreditors: CmfCreditor[],
  documents: Array<{ filename: string; textContent?: string | null; llmDocType?: string }>,
  log: (msg: string) => void
): void {
  if (!result.identified261Creditors || result.identified261Creditors.length === 0) return;

  const slotsByInstitution = new Map<string, InstitutionSlots>();
  for (const creditor of cmfCreditors) {
    const key = canonicalInstitutionKey(creditor.institucion);
    if (!key) continue;
    const slots = slotsByInstitution.get(key) ?? emptyInstitutionSlots();
    slots.total += 1;
    slots[getCmfProductBucket(creditor)] += 1;
    slotsByInstitution.set(key, slots);
  }

  const docsByFilename = new Map(documents.map((d) => [d.filename, d]));
  const usageByInstitution = new Map<string, InstitutionSlots>();
  const existingAdditional = new Set(
    (result.additionalCreditors ?? []).map((a) =>
      `${canonicalInstitutionKey(a.institucion_cmf || a.bank)}|${a.document_filename}|${a.total_credito_clp}|${a.categoria_articulo}`
    )
  );

  const keptIdentified: Identified261Creditor[] = [];
  const promoted: AdditionalCreditor[] = [];

  for (const creditor of result.identified261Creditors) {
    const key = canonicalInstitutionKey(creditor.institucion_cmf || creditor.bank);
    const slots = slotsByInstitution.get(key);
    const usage = usageByInstitution.get(key) ?? emptyInstitutionSlots();
    const bucket = getIdentified261ProductBucket(creditor);
    const sourceDoc = docsByFilename.get(creditor.document_filename);
    const comesFromChat = isChatDocument(sourceDoc?.textContent, creditor.document_filename, sourceDoc?.llmDocType);

    const hasExactBucketSlot = !!slots && usage[bucket] < slots[bucket];
    const hasAnyInstitutionSlot = !!slots && usage.total < slots.total;

    if (!comesFromChat && (!slots || slots.total === 0 || !hasAnyInstitutionSlot)) {
      const promotedCreditor: AdditionalCreditor = {
        bank: creditor.bank,
        institucion_cmf: creditor.institucion_cmf,
        product_type: creditor.product_type === 'credito_consumo' || creditor.product_type === 'tarjeta_credito'
          ? creditor.product_type
          : 'otro',
        categoria_articulo: 261,
        total_credito_clp: creditor.total_credito_clp,
        reason:
          `${creditor.reason} Producto adicional de una institución que ya aparece en el CMF, ` +
          'pero no está representado por una línea propia del CMF; se promueve a NO-CMF para crear una fila extra en el portal.',
        document_filename: creditor.document_filename,
        needs_lawyer_confirmation: true,
      };
      const dedupeKey =
        `${canonicalInstitutionKey(promotedCreditor.institucion_cmf || promotedCreditor.bank)}|` +
        `${promotedCreditor.document_filename}|${promotedCreditor.total_credito_clp}|261`;
      if (!existingAdditional.has(dedupeKey)) {
        promoted.push(promotedCreditor);
        existingAdditional.add(dedupeKey);
        log(
          `🔀 [Promoción a NO-CMF] "${creditor.bank}" ($${creditor.total_credito_clp.toLocaleString('es-CL')}) ` +
          `sale de identified261 → additionalCreditors: la institución ya agotó sus ${slots?.total ?? 0} línea(s) CMF.`
        );
      }
      continue;
    }

    keptIdentified.push(creditor);
    usage.total += 1;
    if (hasExactBucketSlot) usage[bucket] += 1;
    usageByInstitution.set(key, usage);
  }

  if (promoted.length === 0) return;
  result.identified261Creditors = keptIdentified;
  result.additionalCreditors = [...(result.additionalCreditors ?? []), ...promoted];
}

/** Contexto determinista para los backstops (sin API; todo ya extraído aguas arriba). */
export interface BackstopContext {
  cmfCreditors: CmfCreditor[];
  documents: ClientDocument[];
  /** Pre-análisis por-cert (filename, isImageDoc, rutEmisorDetectado, bancoSegunRut). */
  certificateAnalyses: Array<{
    filename: string;
    isImageDoc?: boolean;
    rutEmisorDetectado?: string | null;
    bancoSegunRut?: string | null;
    [key: string]: unknown;
  }>;
  catalog: AcreedorCatalogEntry[];
  clientRut: string | null;
  todayDate: Date;
}

/**
 * Aplica la cadena determinista de backstops + validación anti-error sobre `result` (lo MUTA
 * in place) y devuelve `{ result, claudeReadIssues }`. Equivalente exacto al bloque que corría
 * inline en runSentinelCheck — sin API, testeable con `raw` sintético.
 */
export async function applyDeterministicBackstops(
  result: SentinelResult,
  ctx: BackstopContext,
  log: (msg: string) => void
): Promise<{ result: SentinelResult; claudeReadIssues: ClaudeReadIssue[] }> {
  const { cmfCreditors, documents, certificateAnalyses, catalog, clientRut: clientRutForCerts, todayDate } = ctx;
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // --- Backstop determinista de COMPLETITUD (ítems del certificado) ---
  // El LLM puede OMITIR productos que un certificado certifica: una operación de un cert
  // multi-operación cuyo saldo difiere del cupo del CMF (no emite el override), o un
  // producto solo-en-cert de monto chico (lo emite de forma inconsistente). Para CUALQUIER
  // cliente, extraemos deterministamente los ítems con saldo de cada cert (cert_line_items)
  // y agregamos los que el LLM no representó: si el banco tiene una fila CMF sin reclamar →
  // identified261 (el saldo del cert sobrescribe el cupo del CMF); si no → additionalCreditor
  // (producto solo-en-cert / NO-CMF). Conservador (solo etiquetas de payoff inequívocas;
  // ver cert_line_items.ts) y aditivo (nunca quita/modifica lo que emitió el LLM). Caso
  // testigo: BancoEstado CRE-00040145148 $389.848 (override de la línea) y BCI cuenta
  // corriente $615 (solo-en-cert). NO se salta con BYPASS_DATE_CHECK (es regla de fondo).
  {
    const COVERED_TOL = 0.05; // 5%: "ya cubierto" por una entrada del LLM (absorbe payoff≈cupo)
    const near = (a: number, b: number) => b > 0 && Math.abs(a - b) / Math.max(a, b) <= COVERED_TOL;
    const cmfMappedAmounts = (key: string): number[] => {
      const acc: number[] = [];
      for (const r of result.reclassifiedCreditors ?? []) if (canonicalInstitutionKey(r.institucion_cmf) === key) acc.push(r.total_credito_clp);
      for (const r of result.identified261Creditors ?? []) if (canonicalInstitutionKey(r.institucion_cmf) === key) acc.push(r.total_credito_clp);
      for (const r of result.deReclassified261Creditors ?? []) if (canonicalInstitutionKey(r.institucion_cmf) === key) acc.push(r.total_credito_clp);
      for (const o of result.cmf260DirectOverrides ?? []) if (canonicalInstitutionKey(o.institucion_cmf) === key) acc.push(o.monto_clp);
      return acc;
    };
    const cmfCountByBank = new Map<string, number>();
    for (const c of cmfCreditors) {
      const k = canonicalInstitutionKey(c.institucion);
      if (k) cmfCountByBank.set(k, (cmfCountByBank.get(k) ?? 0) + 1);
    }

    // --- Reconciliación: additionalCreditors mal clasificados → identified261 ---
    // El LLM es no-determinista al partir productos entre identified261 (productos del
    // CMF) y additionalCreditors (NO-CMF): una corrida pone una tarjeta del CMF como
    // identified261 (override → 1 fila) y otra la pone como additionalCreditor (→ step3
    // declara la fila del CMF + una fila NO-CMF = DOBLE CONTEO). Backstop determinista: si
    // un additionalCreditor es del MISMO banco que una fila del CMF AÚN SIN RECLAMAR y su
    // monto es cercano a esa fila (≤30% o ≤$500k, tolerancia cert vs CMF), entonces NO es
    // un NO-CMF: es ese producto del CMF → se mueve a identified261 (override). Un NO-CMF
    // genuino (CCAF, TGR, fintech, o un producto cuyo banco ya tiene todas sus filas CMF
    // reclamadas, ej. BCI cuenta corriente $615) NO matchea y queda como additional.
    if (result.additionalCreditors?.length) {
      const claimedCount = new Map<string, number>();
      for (const [k, amts] of [...cmfCountByBank.keys()].map((k) => [k, cmfMappedAmounts(k)] as const)) {
        // deduplicar montos reclamados (mismo producto emitido 2 veces, ej. id261 + deRecl)
        claimedCount.set(k, amts.filter((a, i) => amts.findIndex((b) => near(a, b)) === i).length);
      }
      const closeToCmf = (key: string, amount: number): boolean =>
        cmfCreditors.some(
          (c) => canonicalInstitutionKey(c.institucion) === key &&
            (Math.abs(c.totalCredito - amount) / Math.max(c.totalCredito, amount) <= 0.30 ||
             Math.abs(c.totalCredito - amount) <= 500_000)
        );
      const stillAdditional: AdditionalCreditor[] = [];
      for (const a of result.additionalCreditors) {
        const k = canonicalInstitutionKey(a.institucion_cmf);
        const cmfN = cmfCountByBank.get(k) ?? 0;
        const claimedN = claimedCount.get(k) ?? 0;
        if (k && cmfN > claimedN && closeToCmf(k, a.total_credito_clp)) {
          (result.identified261Creditors = result.identified261Creditors ?? []).push({
            bank: a.bank,
            product_type: a.product_type === 'tarjeta_credito' ? 'tarjeta_credito' : 'otro',
            institucion_cmf: a.institucion_cmf,
            total_credito_clp: a.total_credito_clp,
            reason: `Reconciliación determinista: el LLM lo emitió como NO-CMF, pero corresponde a una línea del CMF de ${a.bank} aún sin reclamar y de monto cercano → es ese producto del CMF (override de monto), NO un acreedor extra (evita doble conteo). ${a.reason}`,
            document_filename: a.document_filename,
          });
          claimedCount.set(k, claimedN + 1);
          log(`🔁 Reconciliación: additional→identified261 ${a.bank} $${a.total_credito_clp.toLocaleString('es-CL')} (fila CMF del mismo banco sin reclamar) — evita doble conteo.`);
        } else {
          stillAdditional.push(a);
        }
      }
      result.additionalCreditors = stillAdditional;
    }

    // ¿Ya emitió el LLM una entrada por este monto, DESDE ESTE MISMO documento? El match por
    // document_filename es el más robusto: no depende de cómo el LLM escriba la institución
    // (mismatch "Tenpo Prepago SA" vs "Tenpo Payments" → el match por nombre fallaba y el
    // backstop duplicaba el producto). Se complementa con el match por banco canónico + monto.
    const coveredByFilename = (filename: string, amount: number): boolean => {
      const pairs: Array<[string | undefined, number | undefined]> = [
        ...(result.reclassifiedCreditors ?? []).map((r) => [r.document_filename, r.total_credito_clp] as [string | undefined, number]),
        ...(result.identified261Creditors ?? []).map((r) => [r.document_filename, r.total_credito_clp] as [string | undefined, number]),
        ...(result.additionalCreditors ?? []).map((r) => [r.document_filename, r.total_credito_clp] as [string | undefined, number]),
        ...(result.deReclassified261Creditors ?? []).map((r) => [r.document_filename, r.total_credito_clp] as [string | undefined, number]),
        ...(result.cmf260DirectOverrides ?? []).map((o) => [o.document_filename, o.monto_clp] as [string | undefined, number]),
      ];
      return pairs.some(([fn, amt]) => !!fn && fn === filename && amt !== undefined && near(amt, amount));
    };
    const isCovered = (key: string, amount: number, filename: string): boolean => {
      if (coveredByFilename(filename, amount)) return true;
      if (cmfMappedAmounts(key).some((a) => near(a, amount))) return true;
      return (result.additionalCreditors ?? []).some(
        (a) => canonicalInstitutionKey(a.institucion_cmf) === key && near(a.total_credito_clp, amount)
      );
    };
    for (const doc of documents) {
      if (!doc.institucion_cmf) continue;
      if (isChatDocument(doc.textContent, doc.filename, doc.llmDocType)) continue;
      const key = canonicalInstitutionKey(doc.institucion_cmf);
      if (!key) continue;
      // El texto que ve Claude (doc.textContent) viene de pdftotext SIN -layout y clampeado:
      // colapsa las TABLAS de los certificados de liquidación/portabilidad (el Nº de
      // operación, la fecha y el monto quedan en líneas separadas) → el extractor por-fila
      // no las reconoce y se pierde, por ejemplo, "CUENTA CORRIENTE … $615" de BCI. Para la
      // extracción determinista re-leemos el PDF con -layout (preserva columnas).
      // ⚠️ Tesseract fue ELIMINADO (Mejora #1: Claude lee el PDF/imagen nativo, mejor que el OCR):
      // por eso este chequeo de completitud determinista solo aplica a PDFs CON capa de texto.
      // En escaneos/imágenes no hay texto que extraer (certText queda en placeholder → 0 ítems)
      // y la lectura del monto la hace Claude nativo, validada aguas abajo (tolerancia vs CMF + RUT).
      let certText = doc.textContent || '';
      if (!doc.isImageDoc && doc.local_path) {
        const layout = await extractTextFromPdfLayout(doc.local_path).catch(() => '');
        if (layout.trim().length > 40) certText = layout;
      }
      const items = extractCertLineItems(certText);
      if (items.length === 0) continue;
      const cmfRows = cmfCreditors.filter((c) => canonicalInstitutionKey(c.institucion) === key);
      const claimed = cmfMappedAmounts(key);
      const dedupClaimed = claimed.filter((a, i) => claimed.findIndex((b) => near(a, b)) === i);
      let availableCmfSlots = Math.max(0, cmfRows.length - dedupClaimed.length);
      for (const it of items) {
        if (it.amount <= 0) continue;
        if (isCovered(key, it.amount, doc.filename)) continue;
        const productType: 'tarjeta_credito' | 'otro' =
          /tarjet|visa|master|cmr|cencosud|cat\b/i.test(it.rawLine) ? 'tarjeta_credito' : 'otro';
        if (availableCmfSlots > 0) {
          result.identified261Creditors = result.identified261Creditors ?? [];
          result.identified261Creditors.push({
            bank: doc.institucion_cmf,
            product_type: productType,
            institucion_cmf: doc.institucion_cmf,
            total_credito_clp: it.amount,
            reason: `Backstop determinista de completitud: el certificado ${doc.filename} certifica esta operación (${it.operationId ?? 's/op'}, "${it.label}") por $${it.amount.toLocaleString('es-CL')} y el LLM no la emitió. Mapeada a una línea del CMF de ${doc.institucion_cmf} (el saldo del cert sobrescribe el cupo del CMF). Art.261.`,
            document_filename: doc.filename,
          });
          availableCmfSlots--;
          log(`🧩 Backstop completitud: +identified261 ${doc.institucion_cmf} $${it.amount.toLocaleString('es-CL')} (op ${it.operationId ?? 's/op'}) — el LLM lo omitió.`);
        } else {
          result.additionalCreditors = result.additionalCreditors ?? [];
          result.additionalCreditors.push({
            bank: doc.institucion_cmf,
            institucion_cmf: doc.institucion_cmf,
            product_type: productType,
            categoria_articulo: 261,
            total_credito_clp: it.amount,
            reason: `Backstop determinista de completitud: producto solo-en-cert no representado por el CMF. El certificado ${doc.filename} certifica la operación ${it.operationId ?? 's/op'} ("${it.label}") por $${it.amount.toLocaleString('es-CL')} y el LLM no la emitió. Art.261.`,
            document_filename: doc.filename,
            needs_lawyer_confirmation: true,
          });
          log(`🧩 Backstop completitud: +additionalCreditor NO-CMF ${doc.institucion_cmf} $${it.amount.toLocaleString('es-CL')} (op ${it.operationId ?? 's/op'}) — el LLM lo omitió.`);
        }
      }
    }
  }

  // --- Backstop determinista: gate de acreditación Art. 260 (degradar 260→261) ---
  // Regla de fondo (abogado 2026-06-22): una deuda con mora 90+d va a Obligaciones 260
  // SOLO si se acredita MONTO Y VENCIMIENTO. La señal de "vencimiento acreditado" es que
  // el Centinela emitió un cmf260DirectOverride CON fecha_vencimiento (solo lo hace si leyó
  // una fecha de mora/cobranza real en el documento). Si un acreedor del CMF con
  // overdue90Days>0 NO tiene override-con-fecha, y no fue reclasificado (261→260) ni ya
  // de-reclasificado (REGLA 10), se DEGRADA a Art. 261 con su monto del CMF + alerta.
  // Es DETERMINISTA: garantiza la regla aunque el LLM no dispare la de-reclasificación.
  // NO se salta con BYPASS_DATE_CHECK (es regla de fondo, no de antigüedad de 30 días).
  {
    const keysWithVenc = (result.cmf260DirectOverrides ?? [])
      .filter((o) => o.fecha_vencimiento && String(o.fecha_vencimiento).trim().length > 0)
      .map((o) => canonicalInstitutionKey(o.institucion_cmf));
    const reclassKeys = (result.reclassifiedCreditors ?? []).map((r) => canonicalInstitutionKey(r.institucion_cmf));
    const deReclKeys = (result.deReclassified261Creditors ?? []).map((r) => canonicalInstitutionKey(r.institucion_cmf));
    // Snapshot (ANTES de degradar) de las instituciones que YA tienen representación basada en
    // certificados — override, identified261, reclasificado o additional. Si un banco 90+d sin
    // vencimiento YA está representado por sus productos (típico multiproducto: el cert desglosa
    // N operaciones y el CMF tiene 1 fila → 1 override + (N-1) en identified261), NO se debe
    // inyectar una fila extra por el TOTAL del CMF (sería doble conteo). El total del CMF solo se
    // inyecta cuando el banco 90+d NO tiene NINGÚN documento que lo represente (G2: no perderlo).
    const preRepresentedKeys = new Set<string>();
    for (const o of result.cmf260DirectOverrides ?? []) preRepresentedKeys.add(canonicalInstitutionKey(o.institucion_cmf));
    for (const r of result.identified261Creditors ?? []) preRepresentedKeys.add(canonicalInstitutionKey(r.institucion_cmf));
    for (const r of result.reclassifiedCreditors ?? []) preRepresentedKeys.add(canonicalInstitutionKey(r.institucion_cmf));
    for (const a of result.additionalCreditors ?? []) preRepresentedKeys.add(canonicalInstitutionKey(a.institucion_cmf));
    for (const c of cmfCreditors) {
      if (c.overdue90Days <= 0) continue;
      const k = canonicalInstitutionKey(c.institucion);
      if (!k) continue;
      if (keysWithVenc.includes(k) || reclassKeys.includes(k) || deReclKeys.includes(k)) continue;
      const assocDoc = documents.find((d) => d.institucion_cmf && canonicalInstitutionKey(d.institucion_cmf) === k);

      // --- Rescate por CHAT (acepta WhatsApp como acreditación de vencimiento) ---
      // Si un CHAT adjunto menciona ESE banco (token distintivo del nombre) y "N días de
      // mora" (≥91), el producto SÍ tiene mora acreditada → se mantiene en Art. 260 con
      // un vencimiento ESTIMADO (fecha del chat − N días). El monto sigue siendo el del
      // CMF/cert. Determinista (no depende del LLM). ⚠️ La fecha es estimada: el chat
      // puede traer varios "N días" para distintos productos del mismo banco; usamos el
      // mayor (mora más antigua) y SIEMPRE alertamos para que el abogado fije la exacta.
      const distinctiveTokens = k.split(' ').filter((tok) => tok.length >= 7);
      if (distinctiveTokens.length > 0) {
        let bestN = 0;
        let chatFile = '';
        let chatRef: Date | null = null;
        for (const d of documents) {
          if (!isChatDocument(d.textContent, d.filename, d.llmDocType)) continue;
          const ct = (d.textContent || '').toLowerCase();
          if (!distinctiveTokens.some((tok) => ct.includes(tok))) continue;
          const matches = [...ct.matchAll(/(\d{2,4})\s*d[ií]as?\s+(?:de\s+)?(?:mora|demora|atraso)/g)];
          for (const m of matches) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n >= 91 && n > bestN) { bestN = n; chatFile = d.filename; }
          }
          if (bestN > 0) {
            const dm = ct.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (dm) chatRef = new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]));
          }
        }
        if (bestN > 0) {
          const ref = chatRef ?? todayDate;
          const fechaEstimada = fmt(addDays(ref, -bestN));
          result.cmf260DirectOverrides!.push({
            institucion_cmf: c.institucion,
            monto_clp: c.totalCredito,
            fecha_vencimiento: fechaEstimada,
            document_filename: assocDoc?.filename ?? chatFile,
          });
          log(
            `🛡️ [Chat→260] "${c.institucion}" (mora 90+d $${c.overdue90Days.toLocaleString('es-CL')}): el chat ` +
            `${chatFile} indica ${bestN} días de mora → se mantiene en Art. 260 con vencimiento ESTIMADO ` +
            `${fechaEstimada}. ⚠️ Fecha estimada desde un chat — el abogado DEBE verificar la fecha exacta de mora.`
          );
          continue;
        }
      }

      // Mora 90+d sin vencimiento acreditable (ni cert ni chat) → degradar a Art. 261.
      const motivo =
        'Mora 90+d en el CMF SIN documento que acredite el VENCIMIENTO → declarada en ' +
        'Otros Acreedores (Art. 261) por el backstop determinista. Revisar antes de presentar.';
      const productType = c.tipoCredito === 'tarjeta_credito' || c.tipoCredito === 'credito_consumo' ? c.tipoCredito : 'otro';

      // Caso 1 — el banco YA tiene override(s) (sin vencimiento, porque keysWithVenc excluyó los que
      // sí tienen fecha): se DEGRADA cada override a su PROPIO monto (sub-producto del cert) y se
      // QUITA de cmf260DirectOverrides. Así un banco multiproducto no inyecta el total del CMF
      // encima de sus sub-productos (bug de doble conteo: ej. Santander de Jaime, 3 ops + total CMF).
      const overridesForKey = (result.cmf260DirectOverrides ?? []).filter(o => canonicalInstitutionKey(o.institucion_cmf) === k);
      if (overridesForKey.length > 0) {
        for (const o of overridesForKey) {
          result.deReclassified261Creditors!.push({ bank: c.institucion, institucion_cmf: c.institucion, total_credito_clp: o.monto_clp, reason: motivo, document_filename: o.document_filename ?? '' });
          result.identified261Creditors!.push({ bank: c.institucion, product_type: productType, institucion_cmf: c.institucion, total_credito_clp: o.monto_clp, reason: motivo, document_filename: o.document_filename ?? '', evidence: o.evidence });
        }
        result.cmf260DirectOverrides = (result.cmf260DirectOverrides ?? []).filter(o => canonicalInstitutionKey(o.institucion_cmf) !== k);
        log(`🛡️ [Backstop 260→261] "${c.institucion}" (mora 90+d): ${overridesForKey.length} override(s) sin vencimiento → degradados a Art. 261 (monto del cert, no el total del CMF).`);
        continue;
      }

      // Caso 2 — el banco NO tiene override pero YA está representado por sus productos
      // (identified261/reclassified/additional del cert, ej. overflow de multiproducto): NO se
      // inyecta nada (ya está declarado, en 261); evita la fila fantasma por el total del CMF.
      if (preRepresentedKeys.has(k)) {
        log(`🛡️ [Backstop 260→261] "${c.institucion}" (mora 90+d) ya representado por productos del certificado → sin fila extra (evita doble conteo con el total del CMF).`);
        continue;
      }

      // Caso 3 — el banco 90+d NO tiene NINGÚN documento que lo represente → se inyecta el total
      // del CMF como Art. 261 para no perder el acreedor (G2). Es el único caso que usa el total.
      result.deReclassified261Creditors!.push({ bank: c.institucion, institucion_cmf: c.institucion, total_credito_clp: c.totalCredito, reason: motivo, document_filename: assocDoc?.filename ?? '' });
      result.identified261Creditors!.push({ bank: c.institucion, product_type: productType, institucion_cmf: c.institucion, total_credito_clp: c.totalCredito, reason: motivo, document_filename: assocDoc?.filename ?? '' });
      log(
        `🛡️ [Backstop 260→261] "${c.institucion}" (mora 90+d $${c.overdue90Days.toLocaleString('es-CL')}) ` +
        `sin vencimiento acreditable ni documento → Art. 261 por el total del CMF ($${c.totalCredito.toLocaleString('es-CL')}).`
      );
    }
  }

  // Si un mismo certificado de una institución genera MÁS productos 261 que las
  // líneas que esa institución tiene en el CMF, los excedentes deben viajar como
  // NO-CMF para que step3 cree filas extra. Sin esta promoción, step3 solo ajusta
  // montos de filas CMF existentes y el producto extra se pierde.
  promoteOverflowIdentified261ToAdditional(result, cmfCreditors, documents, log);

  log(`Centinela de Carga completó la verificación. Resultado: ${result.success ? '✅ PASÓ' : '❌ RECHAZADO'}`);
  if (result.reclassifiedCreditors && result.reclassifiedCreditors.length > 0) {
    log(`📋 ${result.reclassifiedCreditors.length} acreedor(es) reclasificado(s) a Obligaciones 260 por análisis de documentos:`);
    result.reclassifiedCreditors.forEach(r =>
      log(`   - ${r.bank} (${r.product_type}): ${r.delinquency_days}d mora desde ${r.delinquency_start_date} — $${r.total_credito_clp.toLocaleString('es-CL')}`)
    );
  }
  if (result.identified261Creditors && result.identified261Creditors.length > 0) {
    log(`📋 ${result.identified261Creditors.length} deuda(s) Art. 261 identificada(s) desde documentos:`);
    result.identified261Creditors.forEach(r =>
      log(`   - ${r.bank} (${r.product_type}): $${r.total_credito_clp.toLocaleString('es-CL')} — ${r.reason}`)
    );
  }
  if (result.additionalCreditors && result.additionalCreditors.length > 0) {
    log(`📋 ${result.additionalCreditors.length} acreedor(es) NO-CMF detectado(s) (requieren confirmación del abogado):`);
    result.additionalCreditors.forEach(a =>
      log(`   - ${a.bank} (${a.product_type}) [Art. ${a.categoria_articulo}]: $${a.total_credito_clp.toLocaleString('es-CL')} — ${a.reason}`)
    );
  }
  if (result.deReclassified261Creditors && result.deReclassified261Creditors.length > 0) {
    log(`📋 ${result.deReclassified261Creditors.length} producto(s) de-reclasificado(s) 260→261 (certificado vigente sobre CMF):`);
    result.deReclassified261Creditors.forEach(r =>
      log(`   - ${r.bank}: $${r.total_credito_clp.toLocaleString('es-CL')} — ${r.reason}`)
    );
  }
  if (result.fechasClave && result.fechasClave.length > 0) {
    log(`🗓️  Fechas clave (no bloqueante):`);
    result.fechasClave.forEach(f => {
      const estado = f.diasRestantes < 0 ? `VENCIDO hace ${Math.abs(f.diasRestantes)}d` : `en ${f.diasRestantes}d`;
      log(`   - [${f.tipo}] ${f.referencia}: ${f.fecha} (${estado}) — ${f.detalle}`);
    });
  }

  // --- VALIDACIÓN ANTI-ERROR de la lectura de Claude (Capas 1 y 2) ---
  // No decide la estructura; verifica los HECHOS que Claude reportó (evidence) contra fuentes
  // deterministas: la propia cita (anti-alucinación) y el catálogo de RUT (identidad). Es la
  // red de seguridad que reemplaza al backstop por-texto en certs leídos NATIVOS por Claude
  // (sin capa de texto / imágenes), donde extractCertLineItems no tiene texto. Solo verifica
  // acreedores que traen evidence (los que emitió el LLM); los agregados por backstops TS no.
  {
    const issues: ClaudeReadIssue[] = [];
    const digitsOnly = (s: string) => (s || '').replace(/[^\d]/g, '');
    // ¿La cita textual respalda el monto reportado? Conservador: el monto puede ser una SUMA
    // de cupos (no aparece verbatim) → si no calza, es señal de REVISAR, no de error seguro.
    const citaRespaldaMonto = (cita: string | undefined, monto: number, moneda?: string): boolean => {
      if (!cita) return false;
      if (moneda === 'UF') return true; // monto_clp es conversión; la cita está en UF → no comparable por dígitos
      const target = String(Math.round(monto));
      return target.length >= 4 && digitsOnly(cita).includes(target);
    };
    const emitted: Array<{ filename: string; institucion: string; monto: number; ev?: ExtractionEvidence }> = [
      ...(result.reclassifiedCreditors ?? []).map(c => ({ filename: c.document_filename, institucion: c.institucion_cmf, monto: c.total_credito_clp, ev: c.evidence })),
      ...(result.identified261Creditors ?? []).map(c => ({ filename: c.document_filename, institucion: c.institucion_cmf, monto: c.total_credito_clp, ev: c.evidence })),
      ...(result.additionalCreditors ?? []).map(c => ({ filename: c.document_filename, institucion: c.institucion_cmf, monto: c.total_credito_clp, ev: c.evidence })),
      ...(result.cmf260DirectOverrides ?? []).map(c => ({ filename: c.document_filename, institucion: c.institucion_cmf, monto: c.monto_clp, ev: c.evidence })),
    ];
    // L3 — fallback determinista para Capa 2: el RUT del emisor extraído del TEXTO del cert
    // (vía computeRutCheckLocal, ya calculado en certificateAnalyses), para no depender de que
    // Claude reporte `evidence.rut_emisor` (que casi nunca puebla). Solo aplica a certs con capa
    // de texto; en imágenes/escaneos no hay texto → queda a cargo de lo que reporte Claude.
    const detectedByFilename = new Map<string, { rut: string | null; banco: string | null }>();
    for (const ca of certificateAnalyses) {
      if (ca.isImageDoc) continue;
      if (ca.rutEmisorDetectado || ca.bancoSegunRut) {
        detectedByFilename.set(ca.filename, { rut: ca.rutEmisorDetectado ?? null, banco: ca.bancoSegunRut ?? null });
      }
    }

    // #4 — texto por filename para detectar documentos que no acreditan (comprobante de pago / cartola).
    const textByFilename = new Map<string, string>();
    const docTypeByFilename = new Map<string, string | undefined>();
    for (const d of documents) { textByFilename.set(d.filename, d.textContent || ''); docTypeByFilename.set(d.filename, d.llmDocType); }

    let withEvidence = 0;
    for (const e of emitted) {
      if (!e.ev) continue; // agregado por backstop TS o LLM no pobló evidence → no se verifica acá
      withEvidence++;
      const ev = e.ev;

      // Capa 2 — cross-check de RUT del emisor contra el catálogo (identidad de la institución).
      // Fuente del RUT: lo que reportó Claude (ev.rut_emisor) o, si no lo dio, el RUT detectado
      // determinísticamente en el texto del cert (L3). La verificación es la misma en ambos casos.
      if (catalog.length > 0) {
        let detected: { nombre: string } | null = null;
        let rutMostrado: string | null = null;
        let fuente: 'reportado por Claude' | 'leído del documento' | null = null;

        const clientRutNorm = clientRutForCerts ? normalizeRut(clientRutForCerts) : null;
        if (ev.rut_emisor) {
          const rutNorm = normalizeRut(ev.rut_emisor);
          if (rutNorm && rutNorm !== clientRutNorm) {
            const d = findCatalogEntryByRut([rutNorm], catalog, clientRutForCerts ?? undefined);
            if (d) { detected = d; rutMostrado = rutNorm; fuente = 'reportado por Claude'; }
          }
        } else {
          const det = detectedByFilename.get(e.filename);
          if (det?.banco) { detected = { nombre: det.banco }; rutMostrado = det.rut; fuente = 'leído del documento'; }
        }

        if (detected && canonicalInstitutionKey(detected.nombre) !== canonicalInstitutionKey(e.institucion)) {
          issues.push({
            document_filename: e.filename,
            institucion: e.institucion,
            monto_clp: e.monto,
            tipo: 'rut_no_coincide',
            detalle: `El RUT del emisor${rutMostrado ? ` ${rutMostrado}` : ''} (${fuente}) pertenece a "${detected.nombre}", pero el cert quedó asignado a "${e.institucion}". Verificar institución.`,
          });
        }
      }

      // Capa 1 — anti-alucinación por auto-cita: el monto reportado debe estar en la cita.
      if (e.monto > 0) {
        if (!ev.cita_monto) {
          issues.push({ document_filename: e.filename, institucion: e.institucion, monto_clp: e.monto, tipo: 'sin_evidencia', detalle: `Claude no devolvió "cita_monto" para respaldar $${e.monto.toLocaleString('es-CL')}.` });
        } else if (!citaRespaldaMonto(ev.cita_monto, e.monto, ev.moneda)) {
          issues.push({ document_filename: e.filename, institucion: e.institucion, monto_clp: e.monto, tipo: 'monto_sin_respaldo_en_cita', detalle: `El monto $${e.monto.toLocaleString('es-CL')} no aparece verbatim en la cita ("${ev.cita_monto}"). Puede ser una suma de cupos o una lectura errónea — revisar.` });
        }
      }

      // Confianza baja autodeclarada por Claude (umbral <0.70: captura escaneos garbled borderline,
      // ej. Itaú "Cart.Veida" conf 0.65 — ver lección L4).
      if (typeof ev.confidence === 'number' && ev.confidence < 0.7) {
        issues.push({ document_filename: e.filename, institucion: e.institucion, monto_clp: e.monto, tipo: 'baja_confianza', detalle: `Claude reportó confidence ${ev.confidence.toFixed(2)} al leer este certificado.` });
      }

      // #4 — el documento que respalda este monto NO acredita por sí solo (comprobante de pago /
      // cartola). No se descarta el acreedor ni se toca el monto; solo se marca para revisión.
      if (e.monto > 0) {
        const naDoc = classifyNonAccreditingDoc(textByFilename.get(e.filename), e.filename, docTypeByFilename.get(e.filename));
        if (naDoc.tipo) {
          issues.push({ document_filename: e.filename, institucion: e.institucion, monto_clp: e.monto, tipo: 'documento_no_acredita', detalle: `El documento que respalda $${e.monto.toLocaleString('es-CL')} ${naDoc.motivo}.` });
        }
      }

      // #3 — consistencia de moneda: si Claude leyó el monto en CLP pero el documento está
      // claramente en UF (o viceversa), el monto puede estar mal interpretado (una cifra en UF
      // leída como pesos infla la deuda ~38.000×). Solo se marca; no se toca el monto.
      if (ev.moneda) {
        const docCur = detectDocumentCurrency(textByFilename.get(e.filename));
        if (docCur && docCur !== ev.moneda) {
          issues.push({ document_filename: e.filename, institucion: e.institucion, monto_clp: e.monto, tipo: 'moneda_inconsistente', detalle: `Claude leyó el monto en ${ev.moneda}, pero el documento parece estar denominado en ${docCur}. Verificar moneda y monto (una cifra en UF leída como pesos cambia la deuda drásticamente).` });
        }
      }
    }

    // #2 — dedup por nº de operación: dos acreedores emitidos con la MISMA institución canónica
    // y el MISMO nº de operación normalizado son el mismo producto (típico: dos estados de cuenta
    // mensuales del mismo crédito). Se marca para revisión (no se descarta automáticamente: el
    // split 260/261 lo decide TS aguas abajo; esto solo avisa de un posible doble conteo).
    {
      const byOp = new Map<string, { filename: string; institucion: string; monto: number }[]>();
      for (const e of emitted) {
        const op = normalizeOperationId(e.ev?.numero_operacion);
        if (!op) continue;
        const key = `${canonicalInstitutionKey(e.institucion)}|${op}`;
        if (!byOp.has(key)) byOp.set(key, []);
        byOp.get(key)!.push({ filename: e.filename, institucion: e.institucion, monto: e.monto });
      }
      for (const [, group] of byOp) {
        if (group.length < 2) continue;
        // Distintos montos en el mismo producto → posible doble conteo (el abogado revisa).
        const montos = [...new Set(group.map(g => g.monto))];
        const g0 = group[0];
        issues.push({
          document_filename: g0.filename,
          institucion: g0.institucion,
          monto_clp: Math.max(...group.map(g => g.monto)),
          tipo: 'posible_duplicado',
          detalle: `El mismo producto (${g0.institucion}, Nº operación ${normalizeOperationId(emitted.find(e => e.filename === g0.filename)?.ev?.numero_operacion)}) aparece ${group.length} veces${montos.length > 1 ? ` con montos distintos (${montos.map(m => '$' + m.toLocaleString('es-CL')).join(', ')})` : ''}. Verificar que no se declare dos veces.`,
        });
      }
    }

    // Sub-división de operación: el dedup del ensamblador descartó un producto de la MISMA operación
    // con monto MATERIALMENTE distinto → posible sub-línea perdida (ej. una tarjeta leída como varias
    // líneas con la misma operación → el dedup conserva 1 y tira el resto). No se toca el monto; se
    // alerta para que el abogado verifique que no falte deuda (nunca en silencio — G2).
    const dedupDrops = (result as unknown as { _dedupDrops?: Array<{ bank: string; op: string; kept: number; dropped: number; droppedFile: string }> })._dedupDrops ?? [];
    for (const d of dedupDrops) {
      issues.push({
        document_filename: d.droppedFile,
        institucion: d.bank,
        monto_clp: d.dropped,
        tipo: 'posible_subdivision_operacion',
        detalle: `La operación ${d.op} de ${d.bank} aparece con montos distintos ($${d.kept.toLocaleString('es-CL')} y $${d.dropped.toLocaleString('es-CL')}); se declaró UNO solo. Si son sub-líneas de UNA tarjeta/crédito, el monto correcto es la SUMA — verificar que no falte deuda.`,
      });
    }

    // Fecha de mora que el lector puso pero la cita NO corrobora como vencimiento (Capa 2): TS no la
    // aceptó → el producto fue a Art. 261 (lado seguro). Se alerta para que el abogado verifique si
    // había un vencimiento acreditable (que habilitaría Art. 260) — nunca se pierde ni se fuerza a 260.
    const fechaNoAcred = (result as unknown as { _fechaNoAcreditada?: Array<{ bank: string; monto: number; fecha: string; cita: string; filename: string }> })._fechaNoAcreditada ?? [];
    for (const f of fechaNoAcred) {
      issues.push({
        document_filename: f.filename,
        institucion: f.bank,
        monto_clp: f.monto,
        tipo: 'fecha_no_acreditada',
        detalle: `El robot leyó una fecha (${f.fecha}) pero la cita del documento no la acredita como vencimiento ("${(f.cita || '').slice(0, 80)}") — se declaró en Art. 261 (solo monto). Si el documento SÍ acredita un vencimiento, verificar para eventual Art. 260.`,
      });
    }

    // Monto trivial (< 1 UF ≈ $39.000): NO se descarta (un monto chico puede ser deuda REAL — TGR,
    // multa, cuota CCAF — ver lección L30) → se DECLARA y se alerta para que el abogado confirme si
    // es un remanente/comisión trivial. Lo "trivial" es semántico, no un umbral que TS aplique a ciegas.
    const UF_MIN_CLP = 39000;
    for (const e of emitted) {
      if (e.monto > 0 && e.monto < UF_MIN_CLP) {
        issues.push({ document_filename: e.filename, institucion: e.institucion, monto_clp: e.monto, tipo: 'monto_trivial', detalle: `Monto declarado $${e.monto.toLocaleString('es-CL')} < 1 UF (~$${UF_MIN_CLP.toLocaleString('es-CL')}). Puede ser un remanente/comisión trivial (no declarar) o una deuda pequeña real (TGR/CCAF/multa). Verificar.` });
      }
    }

    if (issues.length > 0) {
      result.claudeReadIssues = issues;
      log(`🔎 Validación anti-error: ${issues.length} señal(es) sobre la lectura de Claude (${withEvidence}/${emitted.length} acreedores con evidencia):`);
      issues.forEach(i => log(`   - [${i.tipo}] ${i.institucion} ($${i.monto_clp.toLocaleString('es-CL')}) — ${i.detalle}`));
    } else if (emitted.length > 0) {
      log(`🔎 Validación anti-error: sin discrepancias (${withEvidence}/${emitted.length} acreedores con evidencia verificable).`);
    }
  }

  return { result, claudeReadIssues: result.claudeReadIssues ?? [] };
}
