/**
 * Runner de la calculadora de mora (llamada REAL a Claude con el estado de cuenta).
 *
 * Es el `runCalc` de producción: manda el documento a Claude con el system prompt de la
 * calculadora (sin cambios) y devuelve los `estados[]` crudos del modelo, para que el enganche
 * los pase por `recomputarEstados`. Espeja el armado de partes de `extractDocFacts`
 * (imagen / PDF nativo / texto).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SentinelDocLike, SimpleLogger } from '../sentinel_per_doc';
import { buildMoraSystemPrompt, MORA_USER_MESSAGE } from './mora-prompt';

const MORA_MAX_OUTPUT = 4000;

/** JSON directo; si falla, el bloque {...} o [...] más externo (tolerante, como el endpoint rp). */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* sigue */ }
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { /* sigue */ } }
  const as = t.indexOf('['), ae = t.lastIndexOf(']');
  if (as !== -1 && ae > as) { try { return JSON.parse(t.slice(as, ae + 1)); } catch { /* sigue */ } }
  return null;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (la calculadora recibe la fecha de hoy en formato chileno). */
export function todayToChileLabel(todayStr: string): string {
  const [y, mo, d] = todayStr.split('-');
  return `${d}/${mo}/${y}`;
}

/**
 * Corre la calculadora de mora sobre UN estado de cuenta (una llamada a Claude, solo lectura).
 * Devuelve los `estados[]` crudos del modelo (el enganche los pasa por recomputarEstados).
 */
export async function runCalculadoraMora(
  doc: SentinelDocLike,
  anthropic: Anthropic,
  model: string,
  todayStr: string,
  logger?: SimpleLogger
): Promise<unknown[]> {
  const log = (m: string) => (logger ? logger.log(`🧮 [Mora] ${m}`) : console.log(m));
  const parts: any[] = [];
  if (doc.isImageDoc && doc.imageBase64) {
    parts.push({ type: 'text', text: 'Leé la IMAGEN adjunta (estado de cuenta).' });
    parts.push({ type: 'image', source: { type: 'base64', media_type: doc.imageMimeType || 'image/jpeg', data: doc.imageBase64 } });
  } else if (doc.nativePdfBase64) {
    parts.push({ type: 'text', text: `Leé el PDF adjunto (estados de cuenta). Texto de apoyo parcial:\n${doc.textContent ?? ''}` });
    parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.nativePdfBase64 } });
  } else {
    parts.push({ type: 'text', text: doc.textContent ?? '' });
  }
  parts.push({ type: 'text', text: MORA_USER_MESSAGE });

  const resp = await anthropic.messages.create({
    model,
    max_tokens: MORA_MAX_OUTPUT,
    system: [{ type: 'text', text: buildMoraSystemPrompt(todayToChileLabel(todayStr)), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: parts }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  const parsed = parseJsonLoose(block && block.type === 'text' ? block.text : '');
  const estados = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { estados?: unknown }).estados)
      ? (parsed as { estados: unknown[] }).estados
      : null;
  if (!estados) { log(`${doc.filename}: respuesta no interpretable → sin estados`); return []; }
  log(`${doc.filename}: ${estados.length} estado(s) analizado(s).`);
  return estados as unknown[];
}
