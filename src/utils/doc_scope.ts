/**
 * Qué documento le toca a qué paso.
 *
 * Hoy el Centinela lee TODOS los `client_documents` del cliente, incluidas las
 * liquidaciones de sueldo y el certificado de cotizaciones. Un documento de ingreso
 * nunca puede generar un producto declarable en el Paso 3: la lectura es costo puro, y
 * encima el agente de Ingresos lo vuelve a leer con otro prompt en el Paso 5.
 *
 * Criterio, deliberadamente conservador: es "de ingreso" solo si NO tiene NINGUNA marca
 * de certificado de acreedor Y su nombre lo prueba. Ante la duda → lo lee el Paso 3.
 * Preferimos pagar una lectura de más a dejar un acreedor sin declarar.
 *
 * ⚠️ Ojo con `liquidacion_payoff`: un certificado de liquidación/prepago de un crédito
 * es un documento de DEUDA, y su nombre suele traer "liquidacion". Por eso la palabra
 * sola no alcanza.
 *
 * La prueba del nombre NO es una lista negra de palabras de deuda: esa carrera se pierde
 * contra el vocabulario financiero chileno (`prestamo`, `pagare`, `mutuo`, `insoluto`,
 * `repactacion`, `leasing`, `castigo`… — medido el 2026-07-29: 7 de 19 nombres
 * verosímiles se colaban como ingreso). Es una lista blanca: se enumera cómo se llama un
 * documento de ingreso, y cualquier palabra desconocida en el nombre lo manda a leerse.
 */

/**
 * INEQUÍVOCAS: si alguna aparece, el documento es de ingreso sin importar qué más diga el
 * nombre. Ninguna tiene lectura posible como documento de deuda.
 */
const INGRESO_INEQUIVOCO = [
  'afp',
  'previred',
  'sueldo',
  'remuneracion',
  'remuneraciones',
  'haberes',
  'honorarios',
  'pension',
  'jubilacion',
  'laboral',
  'nomina',
];

/**
 * AMBIGUAS: en Chile nombran tanto un documento de ingreso como uno de DEUDA.
 * "Liquidación" es la boleta de sueldo Y el certificado de prepago de un crédito.
 * Solo cuentan como ingreso si el nombre no trae ninguna otra palabra con contenido
 * (ver `esDocumentoDeIngreso`).
 */
const INGRESO_AMBIGUO = ['liquidacion', 'liquidaciones', 'cotizacion', 'cotizaciones', 'finiquito'];

/**
 * Palabras sin contenido clasificatorio: conectores, meses, y el ruido que dejan el
 * proyector y las descargas (`(1)`, `copia`, la extensión). No convierten un nombre
 * "pelado" en uno calificado.
 */
const RUIDO = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'mi', 'mis', 'para', 'por', 'con', 'a',
  'copia', 'pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'scan', 'scanned', 'img', 'image',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
]);

/**
 * Palabras que delatan un documento de DEUDA. Si aparece cualquiera de estas, el documento
 * NO es de ingreso — sin importar en qué posición esté ni qué palabras haya en el medio.
 *
 * Antes esto era una regex que exigía que la palabra de deuda estuviera PEGADA a
 * "liquidacion". Con eso, "liquidacion final de credito hipotecario.pdf" (un certificado de
 * prepago, o sea DEUDA) se clasificaba como ingreso y su acreedor desaparecía de la
 * declaración. El sesgo tiene que ser el contrario: ante cualquier señal de deuda, lo lee
 * el Paso 3.
 */
const PALABRAS_DE_DEUDA = ['credito', 'prepago', 'deuda', 'hipotecario'];

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

/**
 * Palabras con contenido clasificatorio del nombre de archivo: sin extensión, sin números
 * sueltos ni numeración del proyector, sin conectores ni meses.
 */
function palabrasConContenido(filename: string): string[] {
  return sinTildes(filename)
    .replace(/\.[a-z0-9]{1,5}$/, '')       // extensión
    .split(/[^a-z0-9]+/)                    // separadores: espacios, _, -, (), .
    .filter((w) => w.length > 0)
    .filter((w) => !/^\d+$/.test(w))        // "1", "2026", numeración de descargas
    .filter((w) => !RUIDO.has(w));
}

/**
 * Un documento se salta SOLO con evidencia positiva de que es de ingreso. La duda se
 * resuelve leyéndolo: pagar una lectura de más cuesta centavos; dejar un acreedor sin
 * declarar es riesgo de inadmisibilidad.
 *
 * Tres barreras, en orden:
 *  1. Cualquier marca de acreedor en la metadata → se lee. La metadata manda sobre el nombre.
 *  2. Cualquier palabra de deuda en el nombre → se lee.
 *  3. Evidencia de ingreso. Una palabra INEQUÍVOCA basta. Una AMBIGUA solo cuenta si el
 *     nombre no trae ninguna otra palabra con contenido.
 *
 * El punto 3 es lo que hace la regla ACOTADA en vez de una carrera contra el vocabulario
 * financiero. No se puede enumerar todo lo que nombra una deuda —`prestamo`, `pagare`,
 * `mutuo`, `insoluto`, `repactacion`, `leasing`, `castigo`…— pero sí se puede enumerar cómo
 * se llama una boleta de sueldo. Cualquier palabra desconocida junto a "liquidacion" manda
 * el documento a leerse, que es el lado seguro.
 *
 * TECHO CONOCIDO: un documento de deuda cuyo nombre sea EXACTAMENTE una palabra ambigua y
 * nada más (`liquidacion.pdf` para un certificado de prepago) se salta igual. Es
 * indistinguible por nombre; contra eso la defensa es la metadata, no el filename.
 */
export function esDocumentoDeIngreso(doc: {
  filename: string;
  institucion_cmf?: string | null;
  acreditacion_tipo?: string | null;
  document_type?: number | null;
}): boolean {
  if (esCertificadoDeAcreedor(doc)) return false;
  const n = sinTildes(doc.filename ?? '');
  if (!n) return false;
  if (PALABRAS_DE_DEUDA.some((k) => n.includes(k))) return false;

  const palabras = palabrasConContenido(doc.filename ?? '');
  if (palabras.some((w) => INGRESO_INEQUIVOCO.includes(w))) return true;

  const ambiguas = palabras.filter((w) => INGRESO_AMBIGUO.includes(w));
  if (ambiguas.length === 0) return false;
  // Ambigua sola: toda palabra con contenido tiene que ser una de ellas.
  return palabras.length === ambiguas.length;
}
