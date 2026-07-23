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
 * Enriquece los DocFacts de estados de cuenta con la `fecha_mora` derivada por la calculadora.
 * Muta la lista y la devuelve. Si la calculadora falla, deja el doc sin fecha (Centinela cae a
 * su comportamiento actual → 261) pero lo REGISTRA (nunca silencioso: no queremos concluir
 * "no califica" por un error de lectura).
 */
export async function enrichEstadosCuentaConMora(
  factsList: DocFacts[],
  runCalc: RunCalculadora,
  log: (m: string) => void = () => {}
): Promise<DocFacts[]> {
  for (const facts of factsList) {
    if (facts.doc_type !== 'estado_cuenta' || facts.productos.length === 0) continue;
    let estados: MoraEstado[];
    try {
      estados = recomputarEstados(await runCalc(facts)); // la mitad determinista de la calculadora
    } catch (e) {
      log(`⚠️ calculadora de mora falló en ${facts.filename}: ${e instanceof Error ? e.message : String(e)} — se deja sin fecha_mora`);
      continue;
    }
    for (const p of facts.productos) {
      const card = pickCard(estados, p.operacion);
      const iso = toIsoDate(card?.fecha_inicio_mora);
      if (!card || !iso) continue;
      p.fecha_mora = iso;
      // Cita que ACREDITA el vencimiento para la Capa 2 de Centinela: lleva la fecha literal
      // (DD/MM/YYYY) — la evidencia es el recorrido de períodos de la calculadora, no un renglón suelto.
      p.cita_fecha = `${card.fecha_inicio_mora} — inicio de mora (calculadora Ley 20.720, ${card.dias_mora} días de mora al análisis)`;
      log(`📅 ${facts.filename}: fecha_mora=${iso} por calculadora (${card.dias_mora}d) → ${p.operacion ?? p.etiqueta_monto}`);
    }
  }
  return factsList;
}
