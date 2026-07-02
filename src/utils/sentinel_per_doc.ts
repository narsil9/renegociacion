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
import { normalizeOperationId } from './cert_line_items';
import { loadReaderLessons } from './lessons_loader';

// --- Tipos de extracción (lo único que devuelve el LLM, por documento) ---

export type ProductType = 'tarjeta_credito' | 'credito_consumo' | 'linea_credito' | 'hipotecario' | 'otro';

export interface DocProduct {
  operacion?: string;
  monto: number;                 // payoff/saldo del producto en su moneda
  etiqueta_monto: string;        // rótulo verbatim ("Saldo Insoluto", "Cupo Utilizado", "Saldo Deuda", …)
  moneda: 'CLP' | 'UF';
  // Tipo de producto CLASIFICADO POR EL LLM (más robusto que el regex sobre la etiqueta). TS lo
  // prefiere para el gate 260/261 (una `linea_credito` es revolvente → 261) y el bucket de producto.
  product_type?: ProductType;
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
  // true si el doc es un AVISO DE COBRANZA por CONTENIDO (días de mora / deuda castigada / cobranza
  // judicial). Su vencimiento acredita, y su monto es referencial (el cert formal trae el monto).
  es_cobranza?: boolean;
}

/**
 * ¿El documento es un AVISO DE COBRANZA / mora (por CONTENIDO, no por filename)? Señales fuertes de
 * morosidad: "N días de mora", "deuda castigada", "cartera vencida", "cobranza judicial/prejudicial".
 * En ese contexto un "último pago: DD/MM" o "N días de mora" SÍ acredita el vencimiento (L47). Un
 * estado de cuenta/cert normal que solo mencione "Fecha último Pago" NO califica (no matchea acá).
 */
export function isCollectionNotice(text?: string | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return /\bd[ií]as?\s+de\s+mora\b/.test(t)
    || /deuda\s+castigada|cartera\s+vencida/.test(t)
    || /cobranza\s+(judicial|prejudicial|extrajudicial)/.test(t);
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
  "productos": [ { "operacion": "Nº operación/CRE/contrato/tarjeta si está", "monto": number (entero en su moneda, sin separadores), "etiqueta_monto": "rótulo verbatim del monto", "moneda": "CLP"|"UF", "product_type": "tarjeta_credito"|"credito_consumo"|"linea_credito"|"hipotecario"|"otro", "fecha_mora": "YYYY-MM-DD" (inicio de mora / cobranza judicial / 1ª cuota impaga, SOLO si el documento la indica), "cita_monto": "fragmento textual verbatim de donde sacaste el monto", "cita_fecha": "verbatim de la fecha", "confidence": 0.0-1.0 } ]
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
- "cita_monto" debe ser el fragmento TEXTUAL del documento (no tu razonamiento).

REGLAS ESPECÍFICAS (validadas en casos reales — evitan errores de lectura frecuentes):
- TARJETA DE CRÉDITO / CASA COMERCIAL (CMR, CAT/Cencosud, Ripley, etc.): el payoff de la tarjeta es UN solo número, el "COSTO MONETARIO PREPAGO" (o "Costo Total del Prepago"). Es UN producto. La tabla de operaciones del detalle ("Super Avance", "compras en cuotas", avances) son COMPONENTES de esa misma tarjeta, NO productos separados → NO los reportes uno por uno. Tampoco uses el "Monto Total Facturado a Pagar"/"Monto Mínimo" (esos son la cuota del MES, no el saldo total). Una tarjeta = un item con su "COSTO MONETARIO PREPAGO".
- CAPTURA DE PANTALLA DEL PORTAL BANCARIO (home "Mis Productos", detalle de una cuenta/tarjeta) que muestra "Cupo utilizado / Saldo utilizado / Saldo adeudado / Monto adeudado" → SÍ acredita el saldo: reporta el producto con ese monto. NO la trates como "chat" aunque el archivo se llame "WhatsApp"/"captura": doc_type="chat" es SOLO una conversación entre personas (mensajes), que aporta fecha pero no monto. Clasifica por el CONTENIDO, no por el nombre del archivo.
- REPORTE DE DEUDA CON COLUMNA EN PESOS Y EN UF: si el documento trae el saldo YA convertido a pesos (columna "Saldo Actual $", "Saldo $", "Capital $"), usá ESE valor en CLP directamente (moneda="CLP") — NO lo re-conviertas desde la UF. Solo si el saldo está EXPRESADO en UF (sin columna en pesos) reportá moneda="UF" con la cifra UF.
- FORMATO NUMÉRICO CHILENO: el punto "." es separador de MILES y la coma "," es DECIMAL. "2.243,9113 UF" = 2243,9113 UF (≈ $88,9M a $39.643/UF), NO 22.439.113. "$1.407.530" = un millón cuatrocientos mil. No confundas el separador de miles con el decimal (un error infla la cifra ×1000 o más).
- UN PRODUCTO POR OPERACIÓN/TARJETA, AUNQUE APAREZCA EN VARIOS DOCUMENTOS: si el mismo crédito/tarjeta (mismo Nº de operación o mismos 4 últimos dígitos) aparece en varios archivos (estado de cuenta mensual + pantallazo de mora + certificado de liquidación), reportalo UNA sola vez, usando el documento más autoritativo (certificado/liquidación/constancia o el estado de cuenta más reciente). Los documentos de "mora"/mensuales solo aportan la FECHA de mora, no un producto nuevo. ⚠️ Si el MISMO crédito aparece con montos distintos por doc, elegí UN monto (el del doc más autoritativo/reciente) — NO emitas una línea por doc.
- SOLO EMITÍ COMO "producto" LO QUE ES UN PRODUCTO DECLARABLE. NO emitas como producto: (a) líneas de "componentes" de una cobranza consolidada ("VARIOS DEUDORES", costas, honorarios, sub-totales de una misma operación) — esos se suman dentro del producto real, no son productos aparte; (b) remanentes/comisiones/saldos mínimos triviales (< 1 UF ≈ $40.000) que no son una deuda real; (c) cuentas/cupos en $0. Ante la duda de si una cifra es un producto o un componente, integrala al producto padre.
- EL MONTO SIEMPRE VIENE DEL DOCUMENTO, NUNCA DEL CMF: no inventes un "producto" cuyo monto sea la cifra de mora 90+d del informe CMF. El CMF solo dice qué acreedores existen y si hay mora 90+d; el MONTO se lee del certificado/estado de cuenta. Si un banco figura con mora 90+d en el CMF pero no tenés su documento, NO fabriques un producto con el número del CMF (dejalo sin producto; el sistema decide aguas abajo).
- CRÉDITO HIPOTECARIO / VIVIENDA = UN SOLO PRODUCTO: un certificado hipotecario trae varias cifras del MISMO crédito — "Saldo del Crédito (UF)", "Valor del Dividendo (UF)", "Costo Total del Prepago (UF)", "Monto Vencido". NO son productos distintos. Reportá UN solo producto con el PAYOFF = "Costo Total del Prepago (UF)" (si no está, el "Saldo del Crédito"). NUNCA emitas el Saldo Y el Prepago como dos productos (es la misma casa contada dos veces). El Dividendo es la cuota mensual, no la deuda.
- CERTIFICADO DE DEUDA "GLOBAL" (totales por moneda, sin desglose por producto): un doc que solo trae "Total deudas en PESO CHILENO $X", "Total deudas en DÓLAR", "Total deudas en UNIDAD DE FOMENTO Y UF" es el TOTAL del banco, NO un producto. Reglas: (a) el total EN UF corresponde al crédito HIPOTECARIO/vivienda (declaralo como el producto hipotecario, no como uno extra); (b) el total EN PESOS es la suma de los productos en pesos de ese banco (consumo + tarjetas + líneas) — úsalo para acreditar el MONTO del/los producto(s) del CMF de ese banco que no tengan un certificado propio; NO lo declares como una deuda extra encima de los productos individuales, ni lo confundas con la hipoteca. doc_type="resumen_global" y llená "totales_por_moneda" (productos vacío).

TIPO DE PRODUCTO ("product_type") — clasificá cada producto por su NATURALEZA (no por la etiqueta literal):
- "tarjeta_credito": tarjeta de crédito (Visa/Mastercard/CMR/CAT/cupo rotativo de tienda).
- "credito_consumo": crédito de consumo/en cuotas a plazo fijo (incl. crédito social de una CCAF).
- "linea_credito": línea de crédito, cuenta corriente, sobregiro (obligación REVOLVENTE — TS la manda a Art. 261 aunque tenga mora 90+d).
- "hipotecario": crédito hipotecario/de vivienda (mutuo, dividendo).
- "otro": si no encaja o no estás seguro.
Es importante: "línea de crédito" y "cuenta corriente" NO son crédito de consumo aunque el monto venga en cuotas.

FECHA DE MORA / VENCIMIENTO — regla estricta (NO fabricar):
- Poné "fecha_mora" SOLO si el documento imprime una FECHA CALENDARIO literal del inicio de la mora / 1ª cuota impaga / cobranza judicial / "vencido desde DD/MM/AAAA". Copiá esa fecha textual en "cita_fecha".
- NO son fecha de vencimiento (dejá "fecha_mora" VACÍA si es lo único que hay): "N cuotas impagadas"/"cuotas morosas" (es un CONTEO, no una fecha), "monto mora", "Fecha último Pago", "Fecha de emisión", "Fecha de otorgamiento/contratación", "Fecha de proyección". Que el documento diga que HAY morosidad (advertencia de mora, N cuotas) NO significa que dé la FECHA de la mora.
- EXCEPCIÓN — DOCUMENTO DE COBRANZA: si el documento es un aviso/mensaje/correo de COBRANZA (trae señales de mora explícitas: "N días de mora", "deuda castigada", "cartera vencida", "cobranza judicial/prejudicial"), entonces SÍ acredita el vencimiento: usá la fecha del "último pago: DD/MM/AAAA" como "fecha_mora" (la deuda quedó impaga desde ese pago), o si solo hay "N días de mora", calculá fecha_mora = (fecha del documento − N días). Copiá la cita en "cita_fecha". Esto NO aplica a un estado de cuenta/cert normal que solo mencione "Fecha último Pago" sin señales de mora.
- NUNCA infieras ni calcules una fecha (no restes meses por las cuotas, no uses la fecha del cert). Si no hay una fecha de vencimiento literal, "fecha_mora" va vacía — TypeScript decidirá (irá a Art. 261). Es preferible dejarla vacía que inventarla.

EJEMPLOS RESUELTOS (aprendé de estos; NO son el documento actual):

▸ Ejemplo A — Estado de Deuda Directa Proyectado (banco, tabla de cobranza; desglose_por_producto):
Texto: "Estado de Deuda Directa Proyectado con Banco de Chile ... N° Operación / Descripción del producto / Fecha de vencimiento / ... / Total deuda prejudicial (en pesos)
  14960  LINEA DE CREDITO CTA.CTE.REZAG.CONSUMO   27 abril 2026   ...   1.149
  45819  CRÉDITO EN CUOTAS CONSUMO                 5 marzo 2026    ...   18.613.834
  00160  CRÉDITO TARJETAS VENCIDAS CONSUMO         12 marzo 2026   ...   7.896.713"
Extracción correcta: doc_type="desglose_por_producto"; UN producto por fila; monto = "Total deuda prejudicial"; fecha_mora = "Fecha de vencimiento" de esa fila. → productos:[{operacion:"14960",monto:1149,etiqueta_monto:"Total deuda prejudicial",moneda:"CLP",fecha_mora:"2026-04-27",cita_monto:"...1.149",cita_fecha:"27 abril 2026",confidence:0.95}, {operacion:"45819",monto:18613834,...,fecha_mora:"2026-03-05"}, {operacion:"00160",monto:7896713,...,fecha_mora:"2026-03-12"}]. (No decidís 260/261: solo reportás monto + fecha_mora; TS clasifica.)

▸ Ejemplo B — Certificado de prepago/portabilidad (tabla "Monto total a Pagar" por producto; SIN fecha de mora):
Texto: "Nombre de Fantasia / Nº Operación / (fecha) / Monto total a Pagar
  CTACTE  CUENTA CORRIENTE  89772016      22-04-2024  $ 3.047.485
  CRECON  CONSUMO ON-LINE   D26400005756  04-08-2025  $ 6.506.053
  ... Monto total a Pagar al 17-06-2026 para poner término a todos los productos $ 20.254.651"
Extracción correcta: doc_type="desglose_por_producto"; UN producto por fila con su "Monto total a Pagar"; la fecha junto a la operación es de OTORGAMIENTO, NO de mora → fecha_mora NO se pone (undefined). El total global ("para poner término a todos") NO es un producto. → productos:[{operacion:"89772016",monto:3047485,etiqueta_monto:"Monto total a Pagar",moneda:"CLP",cita_monto:"... $ 3.047.485",confidence:0.95}, {operacion:"D26400005756",monto:6506053,...}, ...] (sin fecha_mora).

▸ Ejemplo C — Estado de cuenta de tarjeta de crédito (una tarjeta con varios cupos):
Texto: "TARJETA VISA *1234 ... Cupo Utilizado Compras $ 800.000 ... Cupo Utilizado Avances $ 1.200.000 ... COSTO MONETARIO PREPAGO $ 2.050.000 ... Monto Mínimo a Pagar $ 95.000"
Extracción correcta: UNA tarjeta = UN producto; monto = "COSTO MONETARIO PREPAGO" ($2.050.000), NO la suma manual de cupos si el prepago ya está, NO el "Monto Mínimo" (es la cuota del mes). → productos:[{operacion:"*1234",monto:2050000,etiqueta_monto:"COSTO MONETARIO PREPAGO",moneda:"CLP",cita_monto:"COSTO MONETARIO PREPAGO $ 2.050.000",confidence:0.9}].${loadReaderLessons('paso3')}`;
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
        // System idéntico en todas las llamadas por-doc del caso → cache_control ephemeral: la 1ª llamada
        // paga los tokens, las demás lo leen del cache (~10% costo, TTL 5 min). Permite un system rico
        // (reglas + few-shot + lecciones vivas) sin costo por-documento. Ver lessons_loader.ts.
        system: [{ type: 'text', text: perDocSystemPrompt(todayStr), cache_control: { type: 'ephemeral' } }],
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
              product_type: ['tarjeta_credito', 'credito_consumo', 'linea_credito', 'hipotecario', 'otro'].includes(p.product_type)
                ? (p.product_type as ProductType)
                : undefined,
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
        es_cobranza: isCollectionNotice(doc.textContent),
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
  const raw = assembleRawFromDocFacts(factsList, cmfResult, catalog, clientRut, todayStr, logger);
  // Exponer el doc_type que el LLM clasificó por documento, para que las heurísticas
  // deterministas aguas abajo (isChatDocument / classifyNonAccreditingDoc) CONFÍEN en él en
  // vez de re-derivarlo por regex. Campo interno (prefijo __), no forma parte del contrato del LLM.
  raw.__docTypeByFilename = Object.fromEntries(factsList.map((f) => [f.filename, f.doc_type]));
  return raw;
}

// ---------------------------------------------------------------------------
// ENSAMBLADOR DETERMINISTA — DocFacts[] → objeto raw-shaped (5 listas) que los
// backstops post-LLM de sentinel.ts refinan igual que la salida del LLM mega-llamada.
// ---------------------------------------------------------------------------

interface CmfCreditorLike { institucion: string; tipoCredito: string; totalCredito: number; overdue90Days: number; }
interface CmfResultLike { creditors: CmfCreditorLike[]; ufValueCLP?: number; meets90DaysRequirement?: boolean; meetsAmountRequirement?: boolean; totalCreditoOf90PlusCreditors?: number; qualifying90PlusCount?: number; }

function mkEvidence(p: DocProduct, rutEmisor?: string, emisorNombre?: string) {
  return {
    rut_emisor: rutEmisor,
    emisor_nombre: emisorNombre,
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
  interface PP { p: DocProduct; clp: number; filename: string; bankName: string; bankKey: string; rutEmisor?: string; emisorNombre?: string; inCmf: boolean; docType: DocType; }

  // Repartir los productos extraídos: por banco del CMF (in-CMF) vs NO-CMF (additionalCreditors)
  const productsByBank = new Map<string, PP[]>();
  const additionalCreditors: any[] = [];
  const reclassifiedCreditors: any[] = [];
  const identified261Creditors: any[] = [];
  const cmf260DirectOverrides: any[] = [];
  const banksWithGlobalSummary = new Set<string>();

  // 1) Reunir TODOS los productos (descartando montos no positivos: nunca declarar $0 — G2).
  const gathered: PP[] = [];
  for (const facts of factsList) {
    const bankName = facts.institucion_asignada || facts.emisor_nombre || '';
    const bankKey = canonicalInstitutionKey(bankName);
    if (facts.doc_type === 'resumen_global' && bankKey) banksWithGlobalSummary.add(bankKey);
    if (PRODUCTLESS_TYPES.includes(facts.doc_type) || facts.productos.length === 0) continue;
    const inCmf = issuerInCmf(facts, facts.institucion_asignada ?? null, cmfKeys, cmfRutSet, catalog, clientRut);
    for (const p of facts.productos) {
      const clp = toClp(p);
      if (!(clp > 0)) continue; // $0 / negativo → no es un producto a declarar
      gathered.push({ p, clp, filename: facts.filename, bankName, bankKey, rutEmisor: facts.rut_emisor, emisorNombre: facts.emisor_nombre, inCmf, docType: facts.doc_type });
    }
  }

  // 2) Dedup por (banco canónico + Nº de operación normalizado): el MISMO producto puede venir
  //    de varios documentos (estado de cuenta mensual + pantallazo de mora + certificado de
  //    liquidación) → sin esto, cada doc se vuelve un "producto" y el banco se sobre-declara
  //    (ej. Itaú op 60451478 en 3 docs, BdCh op 20933 en 2). Se conserva UN producto por
  //    operación: prioridad liquidacion_payoff > desglose_por_producto > estado_cuenta, luego
  //    mayor confianza, luego mayor monto; y se hereda la fecha_mora de cualquiera del grupo
  //    (un doc puede traer el monto y otro la fecha). Productos SIN operación no se deduplican
  //    (no hay clave fiable; un banco con 2 créditos de monto similar son 2 productos reales).
  const docTypeScore = (t: DocType): number => (t === 'liquidacion_payoff' ? 3 : t === 'desglose_por_producto' ? 2 : t === 'estado_cuenta' ? 1 : 0);
  const better = (a: PP, b: PP): PP => {
    const sa = docTypeScore(a.docType), sb = docTypeScore(b.docType);
    if (sa !== sb) return sa > sb ? a : b;
    const ca = a.p.confidence ?? 0, cb = b.p.confidence ?? 0;
    if (Math.abs(ca - cb) > 0.001) return ca > cb ? a : b;
    return a.clp >= b.clp ? a : b;
  };
  const byOp = new Map<string, PP>();
  const products: PP[] = [];
  // Registro de descartes del dedup con monto MATERIALMENTE distinto: el mismo Nº de operación con
  // dos montos muy diferentes NO es una re-lectura del mismo saldo, sino un posible producto/sub-línea
  // distinto que se está PERDIENDO en silencio (ej. una tarjeta leída como N sub-líneas con la misma
  // operación: el dedup conserva 1 y tira el resto). No podemos sumar (arriesga doble conteo de una
  // re-lectura real) → los backstops emiten una ALERTA (nunca en silencio, G2). Umbral conservador:
  // difieren >5% Y >$100k (una re-lectura del mismo saldo con centavos/redondeo NO alerta).
  const dedupDrops: Array<{ bank: string; op: string; kept: number; dropped: number; keptFile: string; droppedFile: string }> = [];
  // Fechas de mora que el lector puso pero la cita NO corrobora como vencimiento (Capa 2) → alerta.
  const fechaNoAcreditada: Array<{ bank: string; monto: number; fecha: string; cita: string; filename: string }> = [];
  const materiallyDifferent = (a: number, b: number) => Math.abs(a - b) > 100_000 && Math.abs(a - b) / Math.max(a, b, 1) > 0.05;
  for (const pp of gathered) {
    const op = normalizeOperationId(pp.p.operacion);
    if (!op) { products.push(pp); continue; }
    const key = `${pp.bankKey}|${op}`;
    const prev = byOp.get(key);
    if (!prev) { byOp.set(key, pp); products.push(pp); continue; }
    const win = better(prev, pp), lose = win === prev ? pp : prev;
    if (!win.p.fecha_mora && lose.p.fecha_mora) win.p.fecha_mora = lose.p.fecha_mora; // heredar fecha
    if (win !== prev) { byOp.set(key, win); const i = products.indexOf(prev); if (i >= 0) products[i] = win; }
    if (materiallyDifferent(win.clp, lose.clp)) {
      dedupDrops.push({ bank: pp.bankName, op, kept: win.clp, dropped: lose.clp, keptFile: win.filename, droppedFile: lose.filename });
    }
    log(`🧹 Dedup por operación: ${pp.bankName} op ${op} aparece en ${lose.filename} y ${win.filename} → se conserva 1 ($${win.clp.toLocaleString('es-CL')}).`);
  }

  // 2b) PARTE B — El VENCIMIENTO de un aviso de COBRANZA se transfiere a la MISMA deuda de otro
  //     documento (mismo monto exacto): patrón típico "cert formal trae el monto (sin fecha) + aviso
  //     de cobranza trae el vencimiento" (ej. La Polar: cert Inversiones LP + correo de cobranza con
  //     'último pago 01/12/2025'). Es "chat/cobranza solo acredita vencimiento" (Néctor) extendido a
  //     NO-CMF. Se conserva UNA fila (la resuelta por RUT), con monto+venc; la otra se descarta — NO
  //     se pierde deuda porque el monto conservado es el mismo. Acotado (G2-safe): SOLO NO-CMF, mismo
  //     monto EXACTO, EXACTAMENTE uno trae fecha (la fusión AÑADE el venc, no borra montos distintos),
  //     y al menos uno es aviso de cobranza. Si no hay match, la cobranza se queda como acreedor.
  {
    const cobranzaFiles = new Set(factsList.filter((f) => f.es_cobranza).map((f) => f.filename));
    const noCmf = products.filter((pp) => !pp.inCmf);
    const removed = new Set<PP>();
    for (let i = 0; i < noCmf.length; i++) {
      for (let j = i + 1; j < noCmf.length; j++) {
        const a = noCmf[i], b = noCmf[j];
        if (removed.has(a) || removed.has(b)) continue;
        const sameMonto = Math.abs(a.clp - b.clp) <= Math.max(2000, Math.min(a.clp, b.clp) * 0.005);
        const aF = !!a.p.fecha_mora, bF = !!b.p.fecha_mora;
        if (!sameMonto || aF === bF) continue;                          // solo si EXACTAMENTE uno trae fecha
        if (!cobranzaFiles.has(a.filename) && !cobranzaFiles.has(b.filename)) continue; // al menos uno cobranza
        const withDate = aF ? a : b;
        const keep = !withDate.rutEmisor && (aF ? b : a).rutEmisor ? (aF ? b : a) : (withDate.rutEmisor ? withDate : (aF ? b : a));
        const drop = keep === a ? b : a;
        if (!keep.p.fecha_mora) { keep.p.fecha_mora = withDate.p.fecha_mora; keep.p.cita_fecha = withDate.p.cita_fecha; }
        removed.add(drop);
        log(`🔗 Cobranza: vencimiento (${withDate.p.fecha_mora}) de ${drop.filename} transferido a "${keep.bankName}" $${keep.clp.toLocaleString('es-CL')} (misma deuda, mismo monto) — se declara UNA fila con monto+venc.`);
      }
    }
    if (removed.size) for (let k = products.length - 1; k >= 0; k--) if (removed.has(products[k])) products.splice(k, 1);
  }

  // 3) Rutear: in-CMF → pool por banco; NO-CMF → additionalCreditors (260 si mora ≥91d, si no 261).
  for (const pp of products) {
    const { p, bankKey, inCmf } = pp;
    if (inCmf && bankKey) {
      if (!productsByBank.has(bankKey)) productsByBank.set(bankKey, []);
      productsByBank.get(bankKey)!.push(pp);
    } else {
      const moraDays = p.fecha_mora ? daysBetween(p.fecha_mora, todayStr) : null;
      const is260 = moraDays !== null && moraDays >= 91;
      additionalCreditors.push({
        bank: pp.bankName, institucion_cmf: pp.bankName,
        product_type: productTypeOf(p.etiqueta_monto, p.moneda, p.product_type),
        categoria_articulo: is260 ? 260 : 261,
        total_credito_clp: pp.clp,
        delinquency_start_date: is260 ? p.fecha_mora : undefined,
        delinquency_days: is260 ? moraDays! : undefined,
        reason: `NO-CMF (emisor no figura en el CMF). doc_type=${pp.docType}. ${p.etiqueta_monto}`,
        document_filename: pp.filename,
        needs_lawyer_confirmation: true,
        evidence: mkEvidence(p, pp.rutEmisor, pp.emisorNombre),
      });
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
    const ev = match ? mkEvidence(match.p, match.rutEmisor, match.emisorNombre) : undefined;
    const ptype = match ? productTypeOf(match.p.etiqueta_monto, match.p.moneda, match.p.product_type)
                        : (/(tarjeta|visa|master|cmr)/i.test(c.tipoCredito) ? 'tarjeta_credito' : (/consumo/i.test(c.tipoCredito) ? 'credito_consumo' : 'otro'));

    // Reglas del abogado (2026-07-01):
    //  · Línea/cta cte/sobregiro (revolvente) → SIEMPRE 261 (no acredita vencimiento), aunque 90+d.
    //  · Consumo/tarjeta → 260 SOLO si el documento trae fecha de vencimiento EXPLÍCITA (match.p.fecha_mora)
    //    y hay mora 90+d; si no → 261 (por el payoff). Nunca se pierde el acreedor.
    const revolving = isRevolvingLine(c.tipoCredito) || isRevolvingLine(match?.p.etiqueta_monto ?? '', match?.p.product_type);
    // Capa 2: solo se acepta como vencimiento si la CITA del documento lo corrobora (anti-fabricación).
    const rawVenc = match?.p.fecha_mora ?? '';
    let explicitVenc = rawVenc;
    if (rawVenc && !citaCorroboratesVenc(rawVenc, match?.p.cita_fecha)) {
      explicitVenc = '';
      fechaNoAcreditada.push({ bank: c.institucion, monto: amount, fecha: rawVenc, cita: match?.p.cita_fecha ?? '', filename });
    }
    const UF_1 = Math.round((cmfResult.ufValueCLP && cmfResult.ufValueCLP > 0 ? cmfResult.ufValueCLP : 39000));
    const push261 = (reason: string) => {
      if (match) {
        identified261Creditors.push({
          bank: c.institucion, product_type: ptype, institucion_cmf: c.institucion,
          total_credito_clp: amount, reason, document_filename: filename, evidence: ev,
        });
      } else if (banksWithGlobalSummary.has(k)) {
        // Acreditado por el resumen global del banco (sin cert propio), al monto del CMF. Pero NO
        // declarar un remanente TRIVIAL (<1 UF, ej. una línea del CMF en $13): sin cert propio y
        // bajo 1 UF es un resto, no una deuda real (la abogada tampoco lo declara).
        if (amount >= UF_1) {
          identified261Creditors.push({
            bank: c.institucion, product_type: ptype, institucion_cmf: c.institucion,
            total_credito_clp: amount, reason, document_filename: filename, evidence: ev,
          });
        }
      }
      // sin match ni resumen global → no se declara (falta documento); el backstop/gate decide.
    };

    if (c.overdue90Days > 0) {
      if (!revolving && explicitVenc) {
        // Art. 260: consumo/tarjeta con mora 90+d y vencimiento explícito acreditado.
        cmf260DirectOverrides.push({
          institucion_cmf: c.institucion, monto_clp: amount,
          fecha_vencimiento: explicitVenc, document_filename: filename, evidence: ev,
        });
      } else {
        // 90+d pero (revolvente → 261 siempre) o (sin fecha de vencimiento explícita → 261). Payoff.
        push261(revolving
          ? `Art. 261: línea de crédito/cta cte/sobregiro (obligación revolvente, no acredita vencimiento) — 90+d en el CMF pero va a Otros Acreedores.`
          : `Art. 261: 90+d en el CMF pero el documento no acredita una fecha de vencimiento explícita. ${match?.p.etiqueta_monto ?? ''}`);
      }
    } else {
      // CMF al día. Reclasificar a 260 solo si NO es revolvente y el doc acredita mora explícita ≥91d.
      const moraDays = explicitVenc ? daysBetween(explicitVenc, todayStr) : null;
      if (!revolving && moraDays !== null && moraDays >= 91) {
        reclassifiedCreditors.push({
          bank: c.institucion, product_type: ptype, institucion_cmf: c.institucion,
          delinquency_start_date: explicitVenc, delinquency_days: moraDays,
          total_credito_clp: amount, new_classification: 'obligaciones_260',
          reason: `Reclasificado: el documento ${filename} acredita mora de ${moraDays} días (≥91).`,
          document_filename: filename, evidence: ev,
        });
      } else {
        push261(match ? `Art. 261 vigente. ${match.p.etiqueta_monto}` : `Art. 261 vigente; monto del CMF (banco con certificado resumen global, sin desglose por producto).`);
      }
    }
  }

  // Productos sobrantes (más productos que filas CMF en ese banco). Se clasifican por su PROPIA
  // fecha_mora (regla decisiva del abogado: 260 SOLO si monto Y vencimiento acreditados; el robot
  // declara en 260 TODA deuda acreditable, más completo que dejar solo 1 por banco):
  //   - con fecha_mora ≥ 91d → Art. 260 (override CON fecha → el gate lo mantiene en 260).
  //   - sin vencimiento acreditable → identified261 (el backstop lo moverá a NO-CMF si excede slots).
  for (const [, pool] of productsByBank) {
    for (const pp of pool) {
      // Capa 2: la fecha_mora del extra solo cuenta si la cita la corrobora como vencimiento.
      const vencOk = citaCorroboratesVenc(pp.p.fecha_mora, pp.p.cita_fecha);
      if (pp.p.fecha_mora && !vencOk) {
        fechaNoAcreditada.push({ bank: pp.bankName, monto: pp.clp, fecha: pp.p.fecha_mora, cita: pp.p.cita_fecha ?? '', filename: pp.filename });
      }
      const moraDays = vencOk ? daysBetween(pp.p.fecha_mora!, todayStr) : null;
      // Revolvente (línea/cta cte/sobregiro) → 261 aunque tenga fecha_mora (regla del abogado).
      if (!isRevolvingLine(pp.p.etiqueta_monto ?? '', pp.p.product_type) && moraDays !== null && moraDays >= 91) {
        cmf260DirectOverrides.push({
          institucion_cmf: pp.bankName,
          monto_clp: pp.clp,
          fecha_vencimiento: pp.p.fecha_mora,
          document_filename: pp.filename,
          evidence: mkEvidence(pp.p, pp.rutEmisor, pp.emisorNombre),
        });
        continue;
      }
      identified261Creditors.push({
        bank: pp.bankName, product_type: productTypeOf(pp.p.etiqueta_monto, pp.p.moneda, pp.p.product_type),
        institucion_cmf: pp.bankName, total_credito_clp: pp.clp,
        reason: `Producto del certificado ${pp.filename} no emparejado a una fila CMF de ${pp.bankName} (posible operación extra). ${pp.p.etiqueta_monto}`,
        document_filename: pp.filename, evidence: mkEvidence(pp.p, pp.rutEmisor, pp.emisorNombre),
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
    // Descartes del dedup con monto materialmente distinto (posible sub-línea perdida) → los
    // backstops los convierten en alerta `posible_subdivision_operacion`. Campo transitorio.
    _dedupDrops: dedupDrops,
    // Fechas de mora no corroboradas por la cita (Capa 2 anti-fabricación) → alerta `fecha_no_acreditada`.
    _fechaNoAcreditada: fechaNoAcreditada,
  };
}

/**
 * Obligación REVOLVENTE (línea de crédito / cuenta corriente / sobregiro): SIEMPRE Art. 261.
 * Regla del abogado (2026-07-01): una línea de crédito no acredita vencimiento (es exigible a la
 * vista, sin cuotas ni fecha contractual), aunque el CMF la marque 90+d o el cert imprima una fecha.
 * Los créditos de consumo/tarjeta SÍ pueden ir a 260 (con fecha de vencimiento explícita). No matchea
 * "tarjeta" (esa es revolvente pero puede ir a 260 si está vencida y el cert acredita fecha).
 */
// Revolvente (línea/cta cte/sobregiro) → SIEMPRE 261. Confía en el product_type del LLM cuando viene
// (más robusto que el regex sobre la etiqueta: "Consumo Revolvente" no matchea "Línea de Crédito").
function isRevolvingLine(tipoOrLabel: string, productType?: ProductType): boolean {
  if (productType) return productType === 'linea_credito';
  const s = (tipoOrLabel || '').toLowerCase();
  return /l[íi]nea\s+de\s+cr[eé]dito|cuenta\s+corriente|cta\.?\s*cte|sobregiro/.test(s);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Capa 2 anti-fabricación (2026-07-01). ¿La cita textual del documento corrobora que `fecha` es una
 * fecha de VENCIMIENTO / inicio de mora ACREDITADA? El lector (LLM) es no-determinista y a veces
 * inventa `fecha_mora` desde "Fecha último Pago" / "emisión" / "otorgamiento" cuando el cert NO trae
 * una fecha de vencimiento real (ej. cert de portabilidad BCI: solo "N cuotas impagas"). TS no puede
 * ver el PDF, pero SÍ tiene la cita verbatim → exige que la fecha aparezca LITERAL en la cita y que la
 * cita no la etiquete como último pago/emisión/otorgamiento/proyección. Si no corrobora → esa fecha
 * NO acredita vencimiento → el producto va a Art. 261 (lado seguro) + alerta. Escudo determinista:
 * aunque el lector fabrique, TS no lo mete en 260.
 */
function citaCorroboratesVenc(fecha: string | undefined, cita: string | undefined): boolean {
  if (!fecha || !cita) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!m) return false;
  const c = cita.toLowerCase();
  // Etiqueta negativa explícita → la fecha NO es un vencimiento aunque aparezca en la cita.
  if (/[uú]ltimo\s*pago|fecha\s*(de\s*)?emisi[oó]n|otorgamiento|contrataci[oó]n|proyecci[oó]n/.test(c)) return false;
  const [, y, mo, d] = m;
  const dd = String(parseInt(d, 10)), mm = String(parseInt(mo, 10));
  const mes = MESES[parseInt(mo, 10) - 1];
  const cands = [
    `${y}-${mo}-${d}`,
    `${d}-${mo}-${y}`, `${dd}-${mm}-${y}`,
    `${d}/${mo}/${y}`, `${dd}/${mm}/${y}`,
    `${dd} ${mes} ${y}`, `${dd} de ${mes} de ${y}`, `${dd} de ${mes} ${y}`,
  ];
  return cands.some((s) => c.includes(s));
}

/** Tipo de producto a partir del rótulo del monto y la moneda. */
function productTypeOf(etiqueta: string, moneda: 'CLP' | 'UF', productType?: ProductType): 'credito_consumo' | 'tarjeta_credito' | 'otro' {
  // Preferir la clasificación del LLM (linea_credito e hipotecario caen en el bucket 'otro').
  if (productType) return productType === 'tarjeta_credito' || productType === 'credito_consumo' ? productType : 'otro';
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
  // 4) fallback: el primero razonable. NO forzar un producto de monto absurdamente distinto
  //    (ratio > 5×): un cert de $503.808 NO puede acreditar una fila CMF de $35.977.919 (70×). Si
  //    el único candidato es absurdo, devolver null → la fila queda sin match y el ensamblador la
  //    resuelve por el resumen global del banco (monto del CMF) o la deja para el gate. Preserva las
  //    diferencias legítimas cert-vs-CMF (≤30% ya matchean en (2); payoffs 2-3× siguen entrando).
  const plausible = (pp: { clp: number }) => {
    const a = pp.clp, b = c.totalCredito;
    return a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) <= 5;
  };
  if (wantUF) return pool.find((pp) => pp.p.moneda === 'UF') ?? pool.find(plausible) ?? null;
  return pool.find((pp) => pp.p.moneda !== 'UF' && plausible(pp)) ?? null;
}

/** Días entre una fecha YYYY-MM-DD y hoy (YYYY-MM-DD). Positivo si la fecha es pasada. */
function daysBetween(fecha: string, todayStr: string): number {
  const a = new Date(fecha + 'T00:00:00');
  const b = new Date(todayStr + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

