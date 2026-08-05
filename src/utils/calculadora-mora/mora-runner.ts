/**
 * ENGANCHE calculadora de mora ↔ Centinela.
 *
 * Es el paso que corre JUSTO entre `extractDocFacts` (lectura por doc) y
 * `assembleRawFromDocFacts` (ruteo 260/261). Para cada documento que el LLM clasificó como
 * `estado_cuenta`, deriva la fecha de inicio de mora con la calculadora (que corre el mismo
 * prompt + `recomputarEstados`, sin cambios) y la inyecta como `fecha_mora` del producto.
 *
 * De la calculadora se consume SOLO la fecha (el monto lo lee el extractor de Centinela).
 * La llamada al modelo se inyecta (`runCalc`): en prod es la API de Anthropic; en pruebas,
 * la salida cacheada de un subagente. Puro respecto a Centinela: solo muta `fecha_mora`/`cita_fecha`.
 */
import { citaCorroboratesVenc, type DocFacts, type DocProduct } from '../sentinel_per_doc';
import { recomputarEstados, type MoraEstado } from './mora';
import type { ClaudeReadIssue } from '../sentinel';

/**
 * Tarea 3 (plan-calculadora-mora-2026-08-05): la Tarea 1 resuelve QUIÉN gana cuando el extractor y
 * la calculadora dan fechas de mora distintas — pero eso esconde el desacuerdo. Regla del proyecto:
 * nada desaparece en silencio, y es justo lo que hace seguro el cambio en los bancos que el corpus
 * no cubre (si el sistema se equivoca donde no medimos, tiene que avisar, no decidir calladito).
 *
 * Umbral: se alerta ante CUALQUIER diferencia, sin margen de "ruido". No hay evidencia en este
 * código de una fuente de ruido de pocos días: las fechas son strings DD/MM/YYYY extraídas por el
 * LLM y parseadas deterministamente (`toIsoDate`), no un cálculo relativo a un reloj que pueda
 * desviarse — no hay redondeo ni huso horario de por medio. La única variación real observable es
 * un desacuerdo real entre fuentes (medido: 2 meses de diferencia en el consolidado de CMR).
 */
function registrarDiscrepanciaMora(
  facts: DocFacts,
  p: DocProduct,
  idProd: string,
  fechaExtractor: string,
  citaExtractor: string | undefined,
  fechaCalculadora: string,
  explicacionCalculadora: string | undefined,
  log: (m: string) => void
): void {
  const issue: ClaudeReadIssue = {
    document_filename: facts.filename,
    institucion: facts.institucion_asignada || facts.emisor_nombre || '(institución no resuelta)',
    monto_clp: p.moneda === 'CLP' ? p.monto : (p.monto_clp ?? 0),
    tipo: 'fecha_mora_discrepante',
    detalle: `Para "${idProd}" en ${facts.filename}, el extractor leyó fecha_mora=${fechaExtractor} ` +
      `(cita: "${(citaExtractor ?? '(sin cita)').slice(0, 160)}") y la calculadora derivó ${fechaCalculadora} ` +
      `recorriendo saldos (${(explicacionCalculadora ?? '(sin explicación)').slice(0, 160)}). Las dos fuentes ` +
      `discrepan — verificar cuál es la fecha real de inicio de mora antes de presentar.`,
  };
  facts.claudeReadIssues = [...(facts.claudeReadIssues ?? []), issue];
  log(`🚨 ${facts.filename}: fecha_mora del extractor (${fechaExtractor}) y de la calculadora (${fechaCalculadora}) DIFIEREN para "${idProd}" — señal emitida para el abogado.`);
}

/** La calculadora devuelve `estados[]` crudos del modelo (el JSON parseado). */
export type RunCalculadora = (doc: DocFacts) => Promise<unknown[]>;

/** "DD/MM/YYYY" (formato de la calculadora) → "YYYY-MM-DD" (formato de Centinela). null si no parsea. */
export function toIsoDate(fecha: string | null | undefined): string | null {
  if (!fecha) return null;
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(fecha.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const dn = +d, mn = +mo;
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return null;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Últimos 4 dígitos de un identificador (para matchear tarjeta de la calculadora ↔ producto). */
const last4 = (s?: string) => (s ? s.replace(/\D/g, '').slice(-4) : '');

/**
 * ÚNICA definición de "este documento necesita la calculadora de mora".
 *
 * Es la condición de entrada de `enrichUnDocConMora` Y el guard que usa el caller para saber
 * que una corrida con el toggle apagado dejó una unidad incompleta. Estaba duplicada en los dos
 * lugares: si esta función ampliara su alcance (p. ej. a `cartola`), el guard del toggle dejaría
 * de coincidir y volvería a colarse una lectura sin `fecha_mora` al caché, en silencio.
 */
export function necesitaMora(facts: DocFacts): boolean {
  return facts.doc_type === 'estado_cuenta' && facts.productos.length > 0;
}

function pickCard(estados: MoraEstado[], operacion?: string): MoraEstado | undefined {
  if (estados.length === 1) return estados[0]; // 1 doc = 1 tarjeta (caso común)
  const want = last4(operacion);
  return want ? estados.find((e) => last4(e.numero_contrato) === want) : undefined;
}

/**
 * Enriquece UN documento con la fecha de inicio de mora.
 *
 * Se extrajo de `enrichEstadosCuentaConMora` para que el caché de lecturas pueda cubrir
 * "extracción + mora" como una sola unidad: las dos leen el mismo papel y la segunda
 * muta los hechos de la primera. Si se cachearan por separado, una lectura reutilizada
 * volvería a pagar la llamada de mora en cada corrida.
 *
 * No lanza: si la calculadora falla, el documento queda sin `fecha_mora` y se avisa —
 * el ruteo 260/261 lo degradará a 261, que es el comportamiento correcto y ya existente.
 *
 * Pero SÍ informa qué pasó, con el resultado:
 *   'no_aplica' → el documento no necesita mora (ver `necesitaMora`);
 *   'ok'        → la calculadora RESPONDIÓ sobre todos los productos de este documento
 *                 (incluida la respuesta negativa "este producto no está en mora");
 *   'fallo'     → de al menos un producto no se obtuvo respuesta: la calculadora lanzó
 *                 (429/529/JSON ilegible), no devolvió estados, no reportó ese producto,
 *                 o reportó una fecha que no se pudo interpretar.
 *
 * ⚠️ 'ok' NO significa "algún producto quedó con fecha_mora". Un estado de cuenta AL DÍA no
 * tiene mora y esa es una respuesta válida que SÍ hay que cachear; medir "ningún producto
 * obtuvo fecha" como fallo mataría el ahorro para todos los papeles sanos. La distinción que
 * importa es respuesta AUSENTE (no se cachea) vs respuesta NEGATIVA (se cachea).
 * El caller lo necesita para NO persistir en el caché una unidad incompleta: si se guardara,
 * el índice único la volvería la lectura vigente y la mora nunca se reintentaría — un 529
 * transitorio dejaría esa deuda en Art. 261 para siempre y para todos los clientes con ese PDF.
 */
export async function enrichUnDocConMora(
  facts: DocFacts,
  runCalc: RunCalculadora,
  log: (m: string) => void = () => {}
): Promise<'no_aplica' | 'ok' | 'fallo'> {
  if (!necesitaMora(facts)) return 'no_aplica';
  let estados: MoraEstado[];
  try {
    estados = recomputarEstados(await runCalc(facts)); // la mitad determinista de la calculadora
  } catch (e) {
    log(`⚠️ calculadora de mora falló en ${facts.filename}: ${e instanceof Error ? e.message : String(e)} — se deja sin fecha_mora`);
    return 'fallo';
  }
  if (estados.length === 0) {
    // `runCalculadoraMora` no lanza cuando la respuesta del modelo no es interpretable:
    // devuelve `estados: []`. El efecto sobre el documento es el MISMO que un 529 (queda sin
    // `fecha_mora`), así que también cuenta como fallo y la lectura no se cachea.
    log(`⚠️ calculadora de mora no devolvió estados para ${facts.filename} (respuesta no interpretable) — se deja sin fecha_mora`);
    return 'fallo';
  }
  // Respuesta AUSENTE sobre algún producto. Se sigue procesando el resto (la clasificación de
  // esta corrida no cambia: cada producto que sí obtuvo fecha la conserva), pero el resultado
  // es 'fallo' para que el caller NO congele la unidad en el caché.
  let ausente = false;
  for (const p of facts.productos) {
    const idProd = p.operacion ?? p.etiqueta_monto;
    const card = pickCard(estados, p.operacion);
    if (!card) {
      // `pickCard` con >=2 estados exige los últimos 4 dígitos: si el extractor reporta el
      // número de operación del crédito y la calculadora la tarjeta enmascarada, no matchea.
      // La calculadora no dijo NADA de este producto → respuesta ausente, no negativa.
      ausente = true;
      log(`⚠️ ${facts.filename}: la calculadora no reportó ningún estado para la operación "${idProd}" (contratos reportados: ${estados.map((e) => e.numero_contrato ?? '(sin numero_contrato)').join(', ')}) — sin fecha_mora y la lectura NO se cachea`);
      continue;
    }
    const cruda = (card.fecha_inicio_mora ?? '').trim();
    if (!cruda) {
      // Respuesta NEGATIVA: la calculadora encontró el producto y dice que no está en mora
      // (estado de cuenta al día). Es información válida → 'ok', se cachea.
      log(`✅ ${facts.filename}: la calculadora reporta "${idProd}" SIN mora (fecha_inicio_mora vacía) — respuesta válida, la lectura se cachea`);
      continue;
    }
    const iso = toIsoDate(cruda);
    if (!iso) {
      // Hubo respuesta pero se perdió al parsear (p. ej. "05/02/26": `toIsoDate` exige 4
      // dígitos de año). El valor crudo va al log: es lo que hace falta para arreglar `toIsoDate`.
      ausente = true;
      log(`⚠️ ${facts.filename}: fecha_inicio_mora=${JSON.stringify(cruda)} de "${idProd}" no se pudo interpretar (toIsoDate) — hubo respuesta pero se perdió al parsear; la lectura NO se cachea`);
      continue;
    }
    // Precedencia de evidencia: una fecha que el acreedor imprime literalmente (el extractor,
    // acreditada por su propia cita vía `citaCorroboratesVenc`) vale más que una fecha que
    // NOSOTROS derivamos recorriendo saldos. Si ya hay una literal acreditada, la calculadora
    // NO la pisa (ni a ella ni a su cita) — solo gana cuando no hay fecha previa, o cuando la
    // que había no está acreditada por su cita (no es mejor que inventarla).
    if (p.fecha_mora && citaCorroboratesVenc(p.fecha_mora, p.cita_fecha)) {
      log(`📌 ${facts.filename}: gana la fecha del extractor (${p.fecha_mora}, acreditada por su cita) sobre la derivada de la calculadora (${iso}) → ${p.operacion ?? p.etiqueta_monto}.`);
      if (p.fecha_mora !== iso) {
        registrarDiscrepanciaMora(facts, p, idProd, p.fecha_mora, p.cita_fecha, iso, card.explicacion, log);
      }
      continue;
    }
    // El extractor pudo traer una fecha (no acreditada por su cita, por eso no ganó arriba) que
    // igual es una SEGUNDA fuente que difiere de la derivada — el caso real medido (consolidado
    // CMR: fecha_mora=2026-04-05, cita "05-febrero") es EXACTAMENTE este: no estar acreditada no
    // la vuelve ruido, solo decide que no se declara con ella. Se alerta igual.
    if (p.fecha_mora && p.fecha_mora !== iso) {
      registrarDiscrepanciaMora(facts, p, idProd, p.fecha_mora, p.cita_fecha, iso, card.explicacion, log);
    }
    const previa = p.fecha_mora;
    p.fecha_mora = iso;
    const [cy, cm, cd] = iso.split('-');
    const canon = `${cd}/${cm}/${cy}`; // DD/MM/YYYY canónico → siempre corrobora la Capa 2
    // ⚠️ La cita AHORA SE PERSISTE (entra en `document_reads.facts_json`), así que no puede
    // llevar nada relativo a hoy. Antes decía `${card.dias_mora} días de mora al análisis`:
    // ese conteo es contra la fecha de la corrida y quedaría CONGELADO del día de la lectura
    // — dos meses después la declaración mostraría un número falso al abogado. Es
    // exactamente el invariante "nunca guardar derivaciones relativas a hoy".
    // No se pierde nada: los días se recalculan determinísticamente aguas abajo
    // (`daysBetween(p.fecha_mora, todayStr)`, sentinel_per_doc.ts:659) y el log de acá
    // sigue imprimiéndolos. Verificado que nadie parsea los días desde `cita_fecha`:
    // `citaCorroboratesVenc` solo busca la fecha canónica, e `isCollectionNotice` corre
    // sobre `doc.textContent`, no sobre la cita.
    p.cita_fecha = `${canon} — inicio de mora (calculadora Ley 20.720)`;
    log(`📅 ${facts.filename}: fecha_mora=${iso} por calculadora (${card.dias_mora}d)${previa ? ` — pisó "${previa}" (su cita no la acreditaba)` : ''} → ${p.operacion ?? p.etiqueta_monto}. Motivo: ${(card.explicacion ?? '').slice(0, 200)}`);
  }
  return ausente ? 'fallo' : 'ok';
}

/** Versión por lista. Se conserva por compatibilidad con los tests existentes. */
export async function enrichEstadosCuentaConMora(
  factsList: DocFacts[],
  runCalc: RunCalculadora,
  log: (m: string) => void = () => {}
): Promise<DocFacts[]> {
  for (const facts of factsList) await enrichUnDocConMora(facts, runCalc, log);
  return factsList;
}
