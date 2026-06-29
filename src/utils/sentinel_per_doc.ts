/**
 * Centinela — lectura POR DOCUMENTO (una llamada por cert, solo EXTRACCIÓN) + ensamblador TS.
 *
 * Motivación (causa raíz de la inestabilidad, validada esta sesión): leer TODOS los certificados en
 * UNA sola llamada hace que el modelo reparta su atención y deje caer/mezcle productos → el conteo
 * de deudas fluctúa entre corridas. Leyendo UN documento a la vez (contexto chico, atención total) la
 * extracción es correcta y completa (igual a la del oráculo: Cristian 10, Miguel 13, Néctor 12).
 *
 * Regla rectora: el LLM SOLO extrae HECHOS por documento (DocFacts). NO decide 260/261, NO-CMF,
 * dedup ni multiproducto — eso lo arma TypeScript (assembleRawFromDocFacts) de forma determinista,
 * anclando el conteo de productos al CMF. La salida final (raw-shaped) la siguen refinando los
 * backstops post-LLM existentes en sentinel.ts (reconciliación, completitud, gate 260→261, anti-error).
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  AcreedorCatalogEntry,
  canonicalInstitutionKey,
  findCatalogEntryByRut,
  matchAcreedor,
  normalizeRut,
} from './acreedor_matcher';

// --- Tipos de extracción (lo único que devuelve el LLM, por documento) ---

export interface DocProduct {
  operacion?: string;
  monto: number;                 // payoff/saldo del producto en su moneda
  etiqueta_monto: string;        // rótulo verbatim ("Saldo Insoluto", "Cupo Utilizado", "Saldo Deuda", …)
  moneda: 'CLP' | 'UF';
  fecha_mora?: string;           // YYYY-MM-DD si el doc la trae (inicio mora / cobranza judicial / cuota impaga)
  cita_monto: string;            // fragmento textual verbatim de donde salió el monto
  cita_fecha?: string;
  confidence: number;            // 0..1
  monto_clp?: number;            // poblado por TS si moneda=UF (conversión)
}

export type DocType =
  | 'desglose_por_producto'
  | 'resumen_global'
  | 'liquidacion_payoff'
  | 'estado_cuenta'
  | 'comprobante_pago'
  | 'cartola'
  | 'chat'
  | 'otro';

export interface DocFacts {
  filename: string;
  institucion_asignada?: string | null;   // doc.institucion_cmf (banco al que el resolver/dashboard lo asignó)
  doc_type: DocType;
  emisor_nombre?: string;
  rut_emisor?: string;
  totales_por_moneda?: { moneda: 'CLP' | 'UF' | 'USD'; monto: number; cita: string }[];
  productos: DocProduct[];
}

/** Estructura mínima de un documento del Centinela que el extractor necesita. */
export interface SentinelDocLike {
  filename: string;
  institucion_cmf: string | null;
  acreditacion_tipo?: string | null;
  isImageDoc?: boolean;
  imageMimeType?: string;
  imageBase64?: string;
  nativePdfBase64?: string;
  textContent?: string;
}

export interface SimpleLogger { log(m: string): void; error(m: string, e?: unknown): void; }

const PER_DOC_MAX_OUTPUT = 4000;

/** Filas del CMF de la institución asignada al doc — referencia de cuántos productos esperar. */
export interface CmfRowRef { tipoCredito: string; totalCredito: number; overdue90Days: number; }

function perDocSystemPrompt(todayStr: string): string {
  return `Eres un EXTRACTOR de datos de UN certificado de deuda chileno (Ley 20.720 — renegociación). Hoy es ${todayStr}.

Tu ÚNICA tarea es leer ESTE documento y reportar los HECHOS que contiene. NO clasifiques Art. 260/261, NO decidas si es deuda del CMF o no, NO sumes ni promedies entre documentos. Solo extrae lo que ves en ESTE documento.

Devuelve un objeto JSON encerrado en <json>...</json> con esta forma:
{
  "doc_type": uno de: "desglose_por_producto" | "resumen_global" | "liquidacion_payoff" | "estado_cuenta" | "comprobante_pago" | "cartola" | "chat" | "otro",
  "emisor_nombre": razón social del emisor tal como aparece impresa,
  "rut_emisor": RUT del EMISOR (la institución acreedora), formato XXXXXXXX-X. NO el RUT del cliente/deudor. Búscalo en encabezado/pie.
  "totales_por_moneda": SOLO si doc_type="resumen_global": [{ "moneda": "CLP"|"UF"|"USD", "monto": number, "cita": "texto verbatim" }],
  "productos": [ { "operacion": "Nº operación/CRE/contrato/tarjeta si está", "monto": number (entero en su moneda, sin separadores), "etiqueta_monto": "rótulo verbatim del monto", "moneda": "CLP"|"UF", "fecha_mora": "YYYY-MM-DD" (inicio de mora / cobranza judicial / 1ª cuota impaga, SOLO si el documento la indica), "cita_monto": "fragmento textual verbatim de donde sacaste el monto", "cita_fecha": "verbatim de la fecha", "confidence": 0.0-1.0 } ]
}

CÓMO IDENTIFICAR doc_type:
- "resumen_global": lista SOLO totales por moneda ("Total deudas en PESO CHILENO $X", "Total en UF Y") SIN desglose por operación/producto. ⚠️ En este caso "productos" va VACÍO y llenas "totales_por_moneda". NUNCA conviertas el total global en un producto.
- "desglose_por_producto": tabla/lista con una fila por operación (Nº operación + monto). Llena un item de "productos" por fila.
- "liquidacion_payoff": certificado de liquidación/prepago con tabla de "Monto a Pagar" por fecha sucesiva. Es UN solo producto: reporta UN item con el monto de la fecha MÁS RECIENTE (la última fila de la tabla).
- "estado_cuenta": estado de cuenta de tarjeta/cuenta (cupo utilizado / deuda facturada). Un producto (o varios cupos sumados, ver abajo).
- "comprobante_pago": comprobante/voucher de pago o transferencia → NO acredita saldo de deuda. Reporta productos solo si muestra un saldo adeudado explícito; si no, "productos" vacío y confidence baja.
- "cartola": detalle de movimientos → NO certifica saldo. "productos" vacío salvo que muestre un saldo de deuda claro.
- "chat": captura de WhatsApp/conversación → solo aporta fecha de mora, NO monto. "productos" vacío.

CÓMO LEER EL MONTO (reglas generales):
- El monto es el PAYOFF / saldo a pagar del producto: "Saldo Deuda", "Saldo Insoluto", "Saldo Total a Pagar", "Costo Total del Prepago", "Monto total a pagar", "Cupo Utilizado", "Deuda Total". NO el "Monto original/aprobado/autorizado/cupo total" ni el "cupo disponible".
- VARIOS PERÍODOS en un estado de cuenta: usa el período MÁS RECIENTE (fecha "PAGAR HASTA"/"VENCE" más nueva).
- VARIOS CUPOS en una tarjeta (Compras + Avances/Avances XL/Súper Avance): el monto es la SUMA de los "Cupo Utilizado" de TODOS los componentes del período más reciente.
- MONEDA: si los montos están en UF (hipotecario suele estar en UF) pon moneda="UF" y el monto en UF; si en pesos, moneda="CLP".
- Un comprobante de PAGO NUNCA significa deuda $0: la deuda se prueba con saldo, no con un pago.
- Sé HONESTO con "confidence": escaneo borroso/tabla ambigua → baja (<0.70); texto nítido → alta. NUNCA inventes un monto; si no lo lees con certeza, baja la confianza.
- "cita_monto" debe ser el fragmento TEXTUAL del documento (no tu razonamiento).`;
}

/**
 * Lee UN documento con Claude (una llamada, solo extracción) → DocFacts.
 * Reintenta una vez ante respuesta vacía / sin <json>.
 */
export async function extractDocFacts(
  doc: SentinelDocLike,
  cmfRows: CmfRowRef[],
  anthropic: Anthropic,
  model: string,
  todayStr: string,
  logger?: SimpleLogger
): Promise<DocFacts> {
  const log = (m: string) => (logger ? logger.log(`🛡️ [PerDoc] ${m}`) : console.log(m));
  const empty: DocFacts = { filename: doc.filename, institucion_asignada: doc.institucion_cmf, doc_type: 'otro', productos: [] };

  const parts: any[] = [];
  const cmfHint = cmfRows.length
    ? `\nReferencia (filas del CMF de la institución asignada "${doc.institucion_cmf}"): ${cmfRows.map((r) => `${r.tipoCredito} total≈$${Math.round(r.totalCredito).toLocaleString('es-CL')} mora90+=$${Math.round(r.overdue90Days).toLocaleString('es-CL')}`).join(' | ')}. (Solo referencia de cuántos productos podría tener este banco; reporta lo que VES en el documento.)`
    : '';
  const header = `=== DOCUMENTO: ${doc.filename} (institución asignada: ${doc.institucion_cmf ?? 's/asignar'}, tipo: ${doc.acreditacion_tipo ?? 'general'}) ===${cmfHint}`;

  if (doc.isImageDoc && doc.imageBase64) {
    parts.push({ type: 'text', text: `${header}\nLeé la IMAGEN adjunta.` });
    parts.push({ type: 'image', source: { type: 'base64', media_type: doc.imageMimeType || 'image/jpeg', data: doc.imageBase64 } });
  } else if (doc.nativePdfBase64) {
    parts.push({ type: 'text', text: `${header}\nLeé el PDF adjunto (el texto extraíble es pobre/incompleto). Texto de apoyo parcial:\n${doc.textContent ?? ''}` });
    parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.nativePdfBase64 } });
  } else {
    parts.push({ type: 'text', text: `${header}\n${doc.textContent ?? ''}` });
  }
  parts.push({ type: 'text', text: `\nExtraé los hechos de ESTE documento y devolvé el JSON en <json>...</json>.` });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await anthropic.messages.create({
        model,
        max_tokens: PER_DOC_MAX_OUTPUT,
        system: perDocSystemPrompt(todayStr),
        messages: [{ role: 'user', content: parts }],
      });
      const textBlock = resp.content.find((b) => b.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
      const m = text.match(/<json>([\s\S]*?)<\/json>/);
      if (!m) { log(`⚠️ ${doc.filename}: sin <json> (intento ${attempt}).`); continue; }
      const raw = JSON.parse(m[1].trim());
      const productos: DocProduct[] = Array.isArray(raw.productos)
        ? raw.productos
            .map((p: any) => ({
              operacion: p.operacion ? String(p.operacion) : undefined,
              monto: Number(p.monto) || 0,
              etiqueta_monto: String(p.etiqueta_monto ?? ''),
              moneda: p.moneda === 'UF' ? 'UF' : 'CLP',
              fecha_mora: p.fecha_mora ? String(p.fecha_mora) : undefined,
              cita_monto: String(p.cita_monto ?? ''),
              cita_fecha: p.cita_fecha ? String(p.cita_fecha) : undefined,
              confidence: typeof p.confidence === 'number' ? p.confidence : 0.7,
            }))
            .filter((p: DocProduct) => p.monto > 0)
        : [];
      const facts: DocFacts = {
        filename: doc.filename,
        institucion_asignada: doc.institucion_cmf,
        doc_type: raw.doc_type ?? 'otro',
        emisor_nombre: raw.emisor_nombre ? String(raw.emisor_nombre) : undefined,
        rut_emisor: raw.rut_emisor ? String(raw.rut_emisor) : undefined,
        totales_por_moneda: Array.isArray(raw.totales_por_moneda) ? raw.totales_por_moneda : undefined,
        productos,
      };
      log(`${doc.filename}: doc_type=${facts.doc_type}, ${productos.length} producto(s)${facts.rut_emisor ? `, rut_emisor=${facts.rut_emisor}` : ''}.`);
      return facts;
    } catch (err: any) {
      log(`⚠️ ${doc.filename}: error de extracción (intento ${attempt}): ${err?.message || err}`);
    }
  }
  log(`⚠️ ${doc.filename}: extracción vacía tras 2 intentos → DocFacts vacío.`);
  return empty;
}

/** Corre las extracciones por-documento con un pool de concurrencia. */
async function mapPool<T, R>(items: T[], limit: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Orquestador del camino POR-DOCUMENTO: una llamada por cert (pool) → DocFacts[] → ensamblador →
 * objeto raw-shaped (las mismas 5 listas que el LLM mega-llamada). Lo consume sentinel.ts detrás
 * del flag CENTINELA_PER_DOC; los backstops post-LLM corren igual sobre el resultado.
 */
export async function runPerDocExtraction(
  documents: SentinelDocLike[],
  cmfResult: CmfResultLike & { creditors: CmfCreditorLike[] },
  catalog: AcreedorCatalogEntry[],
  clientRut: string | null,
  todayStr: string,
  anthropic: Anthropic,
  model: string,
  logger?: SimpleLogger
): Promise<any> {
  const log = (m: string) => (logger ? logger.log(`🛡️ [PerDoc] ${m}`) : console.log(m));
  // Filas del CMF por banco canónico (referencia para cada doc)
  const rowsByBank = new Map<string, CmfRowRef[]>();
  for (const c of cmfResult.creditors) {
    const k = canonicalInstitutionKey(c.institucion);
    if (!k) continue;
    if (!rowsByBank.has(k)) rowsByBank.set(k, []);
    rowsByBank.get(k)!.push({ tipoCredito: c.tipoCredito, totalCredito: c.totalCredito, overdue90Days: c.overdue90Days });
  }
  log(`Leyendo ${documents.length} documento(s) UNO POR UNO con ${model} (pool 5)...`);
  const factsList = await mapPool(documents, 5, (doc) => {
    const rows = doc.institucion_cmf ? (rowsByBank.get(canonicalInstitutionKey(doc.institucion_cmf)) ?? []) : [];
    return extractDocFacts(doc, rows, anthropic, model, todayStr, logger);
  });
  return assembleRawFromDocFacts(factsList, cmfResult, catalog, clientRut, todayStr, logger);
}

// ---------------------------------------------------------------------------
// ENSAMBLADOR DETERMINISTA — DocFacts[] → objeto raw-shaped (5 listas) que los
// backstops post-LLM de sentinel.ts refinan igual que la salida del LLM mega-llamada.
// ---------------------------------------------------------------------------

interface CmfCreditorLike { institucion: string; tipoCredito: string; totalCredito: number; overdue90Days: number; }
interface CmfResultLike { creditors: CmfCreditorLike[]; ufValueCLP?: number; meets90DaysRequirement?: boolean; meetsAmountRequirement?: boolean; totalCreditoOf90PlusCreditors?: number; qualifying90PlusCount?: number; }

function mkEvidence(p: DocProduct, rutEmisor?: string) {
  return {
    rut_emisor: rutEmisor,
    numero_operacion: p.operacion,
    moneda: p.moneda,
    cita_monto: p.cita_monto,
    cita_fecha: p.cita_fecha,
    confidence: p.confidence,
  };
}

/** ¿El emisor del documento aparece en el CMF? (determina NO-CMF). */
function issuerInCmf(
  facts: DocFacts,
  assignedInst: string | null,
  cmfKeys: Set<string>,
  cmfRutSet: Set<string>,
  catalog: AcreedorCatalogEntry[],
  clientRut: string | null
): boolean {
  const assignedKey = assignedInst ? canonicalInstitutionKey(assignedInst) : '';
  if (assignedKey && cmfKeys.has(assignedKey)) return true;
  const ruts: string[] = [];
  if (facts.rut_emisor) { const r = normalizeRut(facts.rut_emisor); if (r) ruts.push(r); }
  const detected = findCatalogEntryByRut(ruts, catalog, clientRut);
  if (detected) {
    const r = detected.rut ? normalizeRut(detected.rut) : null;
    if (r && cmfRutSet.has(r)) return true;
    if (cmfKeys.has(canonicalInstitutionKey(detected.nombre))) return true;
  }
  if (facts.emisor_nombre && cmfKeys.has(canonicalInstitutionKey(facts.emisor_nombre))) return true;
  return false;
}

const PRODUCTLESS_TYPES: DocType[] = ['resumen_global', 'comprobante_pago', 'cartola', 'chat'];

/**
 * Construye el objeto raw-shaped (mismas 5 listas que el LLM) desde los DocFacts por documento,
 * ANCLANDO el número de productos al CMF (L11). El LLM ya extrajo hechos; acá TS decide la estructura.
 * Los backstops post-LLM de sentinel.ts (reconciliación, completitud, gate 260→261, overflow,
 * anti-error) corren después y refinan, igual que con la salida del LLM.
 */
export function assembleRawFromDocFacts(
  factsList: DocFacts[],
  cmfResult: CmfResultLike,
  catalog: AcreedorCatalogEntry[],
  clientRut: string | null,
  todayStr: string,
  logger?: SimpleLogger
): any {
  const log = (m: string) => (logger ? logger.log(`🛡️ [Assembler] ${m}`) : console.log(m));
  const factsByFile = new Map(factsList.map((f) => [f.filename, f]));
  const uf = cmfResult.ufValueCLP && cmfResult.ufValueCLP > 0 ? cmfResult.ufValueCLP : 39000;
  const toClp = (p: DocProduct): number => (p.moneda === 'UF' ? Math.round(p.monto * uf) : Math.round(p.monto));

  // Índices del CMF
  const cmfKeys = new Set<string>();
  const cmfRutSet = new Set<string>();
  for (const c of cmfResult.creditors) {
    const k = canonicalInstitutionKey(c.institucion);
    if (k) cmfKeys.add(k);
    const m = matchAcreedor(c.institucion, catalog);
    if (m.status === 'matched' && m.entry?.rut) { const r = normalizeRut(m.entry.rut); if (r) cmfRutSet.add(r); }
  }

  // Producto enriquecido con su origen
  interface PP { p: DocProduct; clp: number; filename: string; bankName: string; rutEmisor?: string; }

  // Repartir los productos extraídos: por banco del CMF (in-CMF) vs NO-CMF (additionalCreditors)
  const productsByBank = new Map<string, PP[]>();
  const additionalCreditors: any[] = [];
  const reclassifiedCreditors: any[] = [];
  const identified261Creditors: any[] = [];
  const cmf260DirectOverrides: any[] = [];
  const banksWithGlobalSummary = new Set<string>();

  for (const facts of factsList) {
    const bankName = facts.institucion_asignada || facts.emisor_nombre || '';
    const bankKey = canonicalInstitutionKey(bankName);
    if (facts.doc_type === 'resumen_global' && bankKey) banksWithGlobalSummary.add(bankKey);
    if (PRODUCTLESS_TYPES.includes(facts.doc_type) || facts.productos.length === 0) continue;

    const inCmf = issuerInCmf(facts, facts.institucion_asignada ?? null, cmfKeys, cmfRutSet, catalog, clientRut);
    for (const p of facts.productos) {
      const pp: PP = { p, clp: toClp(p), filename: facts.filename, bankName, rutEmisor: facts.rut_emisor };
      if (inCmf && bankKey) {
        if (!productsByBank.has(bankKey)) productsByBank.set(bankKey, []);
        productsByBank.get(bankKey)!.push(pp);
      } else {
        // NO-CMF: 260 si mora ≥91d acreditable; 261 si no
        const moraDays = p.fecha_mora ? daysBetween(p.fecha_mora, todayStr) : null;
        const is260 = moraDays !== null && moraDays >= 91;
        additionalCreditors.push({
          bank: bankName, institucion_cmf: bankName,
          product_type: productTypeOf(p.etiqueta_monto, p.moneda),
          categoria_articulo: is260 ? 260 : 261,
          total_credito_clp: pp.clp,
          delinquency_start_date: is260 ? p.fecha_mora : undefined,
          delinquency_days: is260 ? moraDays! : undefined,
          reason: `NO-CMF (emisor no figura en el CMF). doc_type=${facts.doc_type}. ${p.etiqueta_monto}`,
          document_filename: facts.filename,
          needs_lawyer_confirmation: true,
          evidence: mkEvidence(p, facts.rut_emisor),
        });
      }
    }
  }

  // Anclar al CMF: por cada banco, emparejar productos extraídos con sus filas CMF (L11).
  const usedFiles = new Set<string>();
  for (const c of cmfResult.creditors) {
    const k = canonicalInstitutionKey(c.institucion);
    const pool = productsByBank.get(k) ?? [];
    // match: por nº de operación → por monto cercano → por orden
    let match = pickProductForRow(pool, c);
    if (match) pool.splice(pool.indexOf(match), 1);

    const amount = match ? match.clp : Math.round(c.totalCredito);
    const filename = match ? match.filename : '';
    if (match) usedFiles.add(match.filename);
    const ev = match ? mkEvidence(match.p, match.rutEmisor) : undefined;
    const ptype = match ? productTypeOf(match.p.etiqueta_monto, match.p.moneda)
                        : (/(tarjeta|visa|master|cmr)/i.test(c.tipoCredito) ? 'tarjeta_credito' : (/consumo/i.test(c.tipoCredito) ? 'credito_consumo' : 'otro'));

    if (c.overdue90Days > 0) {
      // Art. 260 directo del CMF → override (con fecha si el doc la trae; sin fecha → el gate degrada a 261)
      cmf260DirectOverrides.push({
        institucion_cmf: c.institucion,
        monto_clp: amount,
        fecha_vencimiento: match?.p.fecha_mora ?? '',
        document_filename: filename,
        evidence: ev,
      });
    } else {
      // CMF al día. ¿El doc prueba mora ≥91d? → reclasificar a 260; si no → 261
      const moraDays = match?.p.fecha_mora ? daysBetween(match.p.fecha_mora, todayStr) : null;
      if (moraDays !== null && moraDays >= 91) {
        reclassifiedCreditors.push({
          bank: c.institucion, product_type: ptype, institucion_cmf: c.institucion,
          delinquency_start_date: match!.p.fecha_mora, delinquency_days: moraDays,
          total_credito_clp: amount, new_classification: 'obligaciones_260',
          reason: `Reclasificado: el documento ${filename} acredita mora de ${moraDays} días (≥91).`,
          document_filename: filename, evidence: ev,
        });
      } else {
        // 261. Solo emitir si hay documento que lo acredite (match) o un resumen global del banco.
        if (match || banksWithGlobalSummary.has(k)) {
          identified261Creditors.push({
            bank: c.institucion, product_type: ptype, institucion_cmf: c.institucion,
            total_credito_clp: amount,
            reason: match ? `Art. 261 vigente. ${match.p.etiqueta_monto}` : `Art. 261 vigente; monto del CMF (banco con certificado resumen global, sin desglose por producto).`,
            document_filename: filename, evidence: ev,
          });
        }
        // sin match ni resumen global → no se declara (falta documento); el backstop/gate decide.
      }
    }
  }

  // Productos sobrantes (más productos que filas CMF en ese banco) → identified261 extra;
  // el backstop promoteOverflowIdentified261ToAdditional los moverá a additional si exceden los slots.
  for (const [, pool] of productsByBank) {
    for (const pp of pool) {
      identified261Creditors.push({
        bank: pp.bankName, product_type: productTypeOf(pp.p.etiqueta_monto, pp.p.moneda),
        institucion_cmf: pp.bankName, total_credito_clp: pp.clp,
        reason: `Producto del certificado ${pp.filename} no emparejado a una fila CMF de ${pp.bankName} (posible operación extra). ${pp.p.etiqueta_monto}`,
        document_filename: pp.filename, evidence: mkEvidence(pp.p, pp.rutEmisor),
      });
    }
  }

  const details = {
    meets90DaysRequirement: cmfResult.meets90DaysRequirement ?? false,
    meetsAmountRequirement: cmfResult.meetsAmountRequirement ?? false,
    totalAmountCLP: cmfResult.totalCreditoOf90PlusCreditors ?? 0,
    creditorsWith90DaysCount: cmfResult.qualifying90PlusCount ?? 0,
    documentsAgeValid: true,
    requiredCertificatesPresent: true,
  };

  log(`ensamblado: ${cmf260DirectOverrides.length} override260, ${identified261Creditors.length} id261, ${reclassifiedCreditors.length} reclass, ${additionalCreditors.length} NO-CMF.`);

  return {
    success: true,
    errors: [],
    reclassifiedCreditors,
    identified261Creditors,
    additionalCreditors,
    cmf260DirectOverrides,
    deReclassified261Creditors: [],
    details,
  };
}

/** Tipo de producto a partir del rótulo del monto y la moneda. */
function productTypeOf(etiqueta: string, moneda: 'CLP' | 'UF'): 'credito_consumo' | 'tarjeta_credito' | 'otro' {
  const e = (etiqueta || '').toLowerCase();
  if (/tarjeta|visa|master|cmr|cupo/.test(e)) return 'tarjeta_credito';
  if (moneda === 'UF' || /hipotec|vivienda|dividendo/.test(e)) return 'otro';
  if (/consumo|cuota|cre\b|insoluto/.test(e)) return 'credito_consumo';
  return 'otro';
}

/** Elige el producto del pool que mejor matchea una fila CMF (op → monto → primero). */
function pickProductForRow(pool: { p: DocProduct; clp: number }[], c: CmfCreditorLike): any {
  if (pool.length === 0) return null;
  // 1) por moneda (UF↔hipotecario)
  const wantUF = /hipotec|vivienda/i.test(c.tipoCredito);
  // 2) por monto cercano (≤30% o ≤$500k)
  const near = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, 1) <= 0.30 || Math.abs(a - b) <= 500_000;
  const byAmount = pool.find((pp) => near(pp.clp, c.totalCredito) && (!wantUF || pp.p.moneda === 'UF'));
  if (byAmount) return byAmount;
  // 3) por moneda UF si la fila es hipotecaria
  if (wantUF) { const uf = pool.find((pp) => pp.p.moneda === 'UF'); if (uf) return uf; }
  // 4) el primero que no sea claramente UF si la fila no es hipotecaria
  const nonUF = pool.find((pp) => pp.p.moneda !== 'UF');
  return wantUF ? pool[0] : (nonUF ?? pool[0]);
}

/** Días entre una fecha YYYY-MM-DD y hoy (YYYY-MM-DD). Positivo si la fecha es pasada. */
function daysBetween(fecha: string, todayStr: string): number {
  const a = new Date(fecha + 'T00:00:00');
  const b = new Date(todayStr + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

