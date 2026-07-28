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
import type { DocFacts } from '../sentinel_per_doc';
import { recomputarEstados, type MoraEstado } from './mora';

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
 */
export async function enrichUnDocConMora(
  facts: DocFacts,
  runCalc: RunCalculadora,
  log: (m: string) => void = () => {}
): Promise<void> {
  if (facts.doc_type !== 'estado_cuenta' || facts.productos.length === 0) return;
  let estados: MoraEstado[];
  try {
    estados = recomputarEstados(await runCalc(facts)); // la mitad determinista de la calculadora
  } catch (e) {
    log(`⚠️ calculadora de mora falló en ${facts.filename}: ${e instanceof Error ? e.message : String(e)} — se deja sin fecha_mora`);
    return;
  }
  for (const p of facts.productos) {
    const card = pickCard(estados, p.operacion);
    const iso = toIsoDate(card?.fecha_inicio_mora);
    if (!card || !iso) continue;
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
    log(`📅 ${facts.filename}: fecha_mora=${iso} por calculadora (${card.dias_mora}d) → ${p.operacion ?? p.etiqueta_monto}. Motivo: ${(card.explicacion ?? '').slice(0, 200)}`);
  }
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
