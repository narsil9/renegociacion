/**
 * Extractor DETERMINISTA de ítems (productos con saldo) de un certificado de deuda.
 *
 * Motivación (general, no per-caso): el Centinela (LLM) a veces NO enumera todos los
 * productos que un certificado certifica — omite operaciones de un cert multi-operación
 * (ej. una de tres líneas CRE de BancoEstado) o productos solo-en-cert de monto chico
 * (ej. una cuenta corriente con saldo < 1 UF en un certificado de liquidación de BCI).
 * Esto es variabilidad/incompletitud del LLM. Este módulo extrae los ítems de forma
 * determinista para usarse como BACKSTOP DE COMPLETITUD: garantiza que todo producto con
 * saldo positivo que el certificado certifica quede representado, para CUALQUIER cliente.
 *
 * Es CONSERVADOR a propósito (un falso positivo = declarar una deuda inexistente):
 * solo emite un ítem cuando hay (a) un monto con etiqueta INEQUÍVOCA de deuda
 * ("Saldo Deuda/Insoluto", "Monto total a Pagar", "Costo Total del Prepago", …) o
 * (b) una fila de tabla de certificado de portabilidad/liquidación con Nº de operación +
 * monto. Excluye montos etiquetados como cupo/autorizado/aprobado/disponible/mínimo/
 * no-vencido y deudas indirectas (codeudor/aval/fiador). Reusable por sentinel.ts.
 */

/**
 * Mejora #3 — Detecta la MONEDA predominante de los montos de deuda de un documento.
 * Tie-breaker determinista para distinguir vivienda (hipotecario, casi siempre en UF) de
 * consumo/comercial (en pesos) cuando un mismo acreedor aparece en ambos. NO decide la
 * estructura: es una señal de apoyo (logging + cross-check de evidence.moneda + clasificación
 * de tipo de crédito). General para cualquier banco.
 *
 * Conservador: solo devuelve 'UF' si el documento ASOCIA UF a un monto de deuda (no por una
 * mención suelta de "UF"); 'CLP' si el payoff está en pesos; null si no hay señal clara.
 */
export function detectDocumentCurrency(text: string | null | undefined): 'UF' | 'CLP' | null {
  if (!text || text.trim().length < 20) return null;
  // UF asociada a un monto: "Saldo … (UF): 3.538,959", "3.559,669 UF", "Unidad de Fomento".
  const ufHits =
    (text.match(/\b\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*UF\b/gi) || []).length +
    (text.match(/\bUF\s*[:\)]?\s*\d/gi) || []).length +
    (text.match(/\(UF\)/gi) || []).length +
    (text.match(/unidad(?:es)?\s+de\s+fomento/gi) || []).length;
  // Pesos asociados a un monto: "$36.130.323", "pesos".
  const clpHits =
    (text.match(/\$\s*\d{1,3}(?:\.\d{3})+/g) || []).length +
    (text.match(/\b(?:en\s+)?pesos\b/gi) || []).length;
  if (ufHits === 0 && clpHits === 0) return null;
  // UF gana solo si tiene presencia real (≥2 señales) y supera a pesos — un hipotecario suele
  // citar varias cifras en UF; evita que una sola mención marginal de "UF" gane.
  if (ufHits >= 2 && ufHits >= clpHits) return 'UF';
  if (clpHits > 0) return 'CLP';
  return null;
}

/**
 * Mejora #2 — Normaliza un número de operación/contrato/tarjeta para comparar productos del
 * MISMO banco (dedup de estados de cuenta mensuales repetidos; desambiguación multiproducto).
 * Quita separadores y enmascarado de tarjetas: "5546-XXXX-9558" → "5546XXXX9558";
 * "CRE - 00039038355" → "CRE00039038355". Devuelve null si queda muy corto para ser fiable.
 */
export function normalizeOperationId(op: string | null | undefined): string | null {
  if (!op) return null;
  // Quitar descriptores entre paréntesis que el LLM agrega ("60451478 (Consumo)" → "60451478")
  // y luego separadores/enmascarado, para que el MISMO producto descrito por documentos
  // distintos colapse a una sola clave (dedup multiproducto).
  let norm = op.toUpperCase().replace(/\([^)]*\)/g, '').replace(/[\s\-._]/g, '');
  // Debe tener suficientes dígitos/letras significativas para no colisionar por casualidad.
  const significant = norm.replace(/X+/g, '').replace(/[^A-Z0-9]/g, '');
  if (significant.length < 4) return null;
  // Operación puramente numérica: quitar ceros a la izquierda ("000060451478" ≡ "60451478").
  // (Solo si es todo dígitos; los códigos alfanuméricos tipo "D06100206841" se dejan intactos.)
  if (/^\d+$/.test(norm)) norm = norm.replace(/^0+/, '') || '0';
  return norm;
}

export interface CertLineItem {
  /** Identificador de la operación si el documento lo trae (CRE-…, Nº Operación, D…). */
  operationId: string | null;
  /** Monto de la deuda en CLP (entero; separador de miles "." removido). */
  amount: number;
  /** Etiqueta/heurística que lo identificó (para logging/auditoría). */
  label: string;
  /** Línea cruda de la que se extrajo (para auditoría). */
  rawLine: string;
}

// Etiquetas que INEQUÍVOCAMENTE marcan el PAYOFF/saldo de deuda a la fecha (lo que se debe
// para saldar el producto). NO se incluye "monto total a pagar" ni "monto total facturado a
// pagar": en un estado de cuenta de TARJETA esa es la CUOTA/factura del mes, no la deuda
// total — incluirla haría declarar DOBLE el producto (factura del mes + cupo utilizado). El
// "Monto total a Pagar" de un certificado de PORTABILIDAD sí es payoff, pero ese se captura
// por la tabla (detector 2), no acá.
const DEBT_LABEL =
  /(saldo\s+deuda|saldo\s+insoluto|saldo\s+total\s+a\s+pagar|costo\s+(?:total\s+del|monetario)\s+prepago|payoff)/i;

// Etiquetas PROHIBIDAS: nunca son la deuda a declarar (cupo, montos originales, cuotas
// futuras, mínimos, etc.). Si la línea las menciona, se descarta para evitar falsos montos.
const FORBIDDEN_LABEL =
  /(cupo|autorizad\w*|aprobad\w*|disponible|m[ií]nim\w*|no\s+vencid\w*|por\s+vencer|contratad\w*|otorgad\w*|cursad\w*|monto\s+original|solicitad\w*)/i;

// Deuda INDIRECTA (garantía de deuda de un tercero): no se declara como pasivo propio.
const INDIRECT_LABEL = /(codeudor|co-?deudor|aval|fiador|deuda\s+indirecta|garant[ií]a\s+de\s+terceros)/i;

// Identificador de operación: CRE-00040145148, D43400044917, 21904910, etc.
const OP_ID_RE = /([A-Z]{2,4}\s*-?\s*\d{6,}|[A-Z]\d{6,}|\b\d{7,}\b)/;

// Monto CLP: "$36.130.323.-", "$ 615", "$0", "$1.234,56".
const MONEY_RE = /\$\s*([\d][\d.]*(?:,\d+)?)/g;

/** Parsea un monto CLP en formato chileno ("36.130.323" → 36130323; "615" → 615). */
function parseClp(raw: string): number {
  const intPart = raw.split(',')[0].replace(/\./g, '').replace(/[^\d]/g, '');
  return intPart ? parseInt(intPart, 10) : 0;
}

/** Primer monto válido (>0) de una línea, o null. */
function firstMoney(line: string): number | null {
  const matches = [...line.matchAll(MONEY_RE)];
  for (const m of matches) {
    const v = parseClp(m[1]);
    if (v > 0) return v;
  }
  return null;
}

function firstOpId(line: string): string | null {
  const m = line.match(OP_ID_RE);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Extrae los ítems de deuda de un certificado. Devuelve [] si el texto es vacío/imagen
 * sin OCR. Deduplica por (operationId, monto). El llamador decide cómo reconciliarlos
 * contra lo que ya emitió el LLM (override CMF vs NO-CMF).
 */
export function extractCertLineItems(text: string | null | undefined): CertLineItem[] {
  if (!text || text.trim().length === 0) return [];
  const lines = text.split(/\r?\n/);
  const items: CertLineItem[] = [];

  // Detector 1 — línea con etiqueta INEQUÍVOCA de deuda + monto en la misma línea.
  // Cubre "CRE - 00040145148 Saldo Deuda $389.848.-" (BancoEstado) y estados de cuenta
  // con "Monto total facturado a pagar"/"Costo total del prepago" inline.
  for (const line of lines) {
    if (!DEBT_LABEL.test(line)) continue;
    if (FORBIDDEN_LABEL.test(line) || INDIRECT_LABEL.test(line)) continue;
    const amount = firstMoney(line);
    if (amount === null) continue;
    items.push({
      operationId: firstOpId(line),
      amount,
      label: (line.match(DEBT_LABEL)?.[0] ?? 'saldo').toLowerCase(),
      rawLine: line.trim(),
    });
  }

  // Detector 2 — filas de un certificado de LIQUIDACIÓN / PORTABILIDAD (formato regulado,
  // común a todos los bancos): tabla con "Nº Operación" + "Monto total a Pagar". Solo se
  // activa si el documento tiene ese encabezado (evita falsos positivos en otros docs).
  const isPortabilityCert =
    /certificado\s+de\s+liquidaci[oó]n|de\s+portabilidad/i.test(text);
  if (isPortabilityCert) {
    for (const line of lines) {
      if (FORBIDDEN_LABEL.test(line) || INDIRECT_LABEL.test(line)) continue;
      const opId = firstOpId(line);
      const amount = firstMoney(line);
      // Fila de producto = tiene Nº de operación Y un monto en la misma línea.
      if (!opId || amount === null) continue;
      items.push({ operationId: opId, amount, label: 'tabla-portabilidad', rawLine: line.trim() });
    }
  }

  // Dedup por (operationId|monto). Si dos detectores emiten el mismo monto/op, queda uno.
  const seen = new Set<string>();
  const deduped: CertLineItem[] = [];
  for (const it of items) {
    const key = `${it.operationId ?? ''}|${it.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }
  return deduped;
}
