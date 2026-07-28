/**
 * Qué documento le toca a qué paso.
 *
 * Hoy el Centinela lee TODOS los `client_documents` del cliente, incluidas las
 * liquidaciones de sueldo y el certificado de cotizaciones. Un documento de ingreso
 * nunca puede generar un producto declarable en el Paso 3: la lectura es costo puro, y
 * encima el agente de Ingresos lo vuelve a leer con otro prompt en el Paso 5.
 *
 * Criterio, deliberadamente conservador: es "de ingreso" solo si NO tiene NINGUNA marca
 * de certificado de acreedor Y su nombre es inequívoco. Ante la duda → lo lee el Paso 3.
 * Preferimos pagar una lectura de más a dejar un acreedor sin declarar.
 *
 * ⚠️ Ojo con `liquidacion_payoff`: un certificado de liquidación/prepago de un crédito
 * es un documento de DEUDA, y su nombre suele traer "liquidacion". Por eso la palabra
 * sola no alcanza; el desempate lo dan las marcas de acreedor.
 */

/** Nombres que solo tiene un documento de ingreso. Sin ambigüedad con deuda. */
const NOMBRES_DE_INGRESO = [
  'liquidacion de sueldo',
  'liquidacion sueldo',
  'liquidacion',
  'cotizacion',
  'cotizaciones',
  'afp',
  'previred',
  'finiquito',
  'pension',
];

// Mismo transform que `normalizeText` de acreedor_matcher.ts:43-44 (forma escapada a
// propósito: los caracteres combinantes crudos son invisibles y se corrompen al copiar).
const sinTildes = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** true si el documento tiene alguna marca de ser un certificado de acreedor. */
export function esCertificadoDeAcreedor(doc: {
  institucion_cmf?: string | null;
  acreditacion_tipo?: string | null;
  document_type?: number | null;
}): boolean {
  const inst = (doc.institucion_cmf ?? '').toString().trim();
  const tipo = (doc.acreditacion_tipo ?? '').toString().trim().toLowerCase();
  const dt = Number(doc.document_type);
  return inst.length > 0 || tipo === 'monto' || tipo === 'vencimiento' || dt === 22 || dt === 23;
}

export function esDocumentoDeIngreso(doc: {
  filename: string;
  institucion_cmf?: string | null;
  acreditacion_tipo?: string | null;
  document_type?: number | null;
}): boolean {
  if (esCertificadoDeAcreedor(doc)) return false;
  const n = sinTildes(doc.filename ?? '');
  if (!n) return false;
  // "liquidacion_prepago" / "liquidacion de credito" son documentos de DEUDA.
  if (/liquidacion[\s_-]*(de[\s_-]*)?(prepago|credito|deuda)/.test(n)) return false;
  return NOMBRES_DE_INGRESO.some((k) => n.includes(k));
}
