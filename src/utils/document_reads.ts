/**
 * Lecturas por documento — el único módulo que conoce la tabla `document_reads`.
 *
 * Idea: la lectura de un documento con el LLM es una FUNCIÓN PURA de
 *   (bytes del documento, contexto del caso que va en el prompt, prompt, lecciones, modelo).
 * Si esas cinco cosas no cambian, el resultado no cambia — así que se guarda y se reutiliza.
 *
 * Lo que NO entra en la llave, a propósito:
 *  · la fecha de hoy — la extracción no produce nada relativo a hoy (ver Task 3);
 *  · el cliente — el mismo papel leído con el mismo contexto da lo mismo para cualquiera.
 *
 * El consumo de tokens NO se guarda acá: va a `herramientas_uso`, la tabla que ya
 * existe (la creó el panel el 2026-07-27), con `source='worker'`.
 */
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Nombre estable del lector del Paso 3. Va en la llave, así que NO se renombra a la ligera. */
export const PER_DOC_READER = 'centinela_per_doc';
/** Nombre del lector de la calculadora de mora (solo para la telemetría; su lectura se
 *  guarda dentro de la misma fila que la del extractor, porque muta los mismos hechos). */
export const MORA_READER = 'mora';

export interface CmfRowRef {
  tipoCredito?: string | null;
  totalCredito?: number | null;
  overdue90Days?: number | null;
}

export interface ReadKey {
  docSha256: string;
  reader: string;
  promptVersion: string;
  lessonsVersion: string;
  model: string;
  contextHash: string;
}

export interface LlmCallRecord {
  skill: string;
  model: string;
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

const sha256 = (s: string | Buffer): string =>
  crypto.createHash('sha256').update(s).digest('hex');

/** Identidad de CONTENIDO del documento: sha256 de los bytes tal como se bajaron del bucket. */
export function contentHash(buf: Buffer): string {
  return sha256(buf);
}

/**
 * Hash del contexto del caso que viaja DENTRO del prompt per-doc: la institución que
 * el resolver le asignó al documento, su tipo de acreditación, y las filas del CMF de
 * ese banco. Sin esto, la lectura hecha para un cliente se serviría a otro con un ancla
 * de CMF distinta — y el ancla cambia lo que el modelo reporta.
 *
 * Es insensible al orden de las filas y a mayúsculas/espacios de la institución.
 *
 * Verificado (2026-07-28, en respuesta a la revisión de Milo) contra `sentinel_per_doc.ts:209-249`:
 * `extractDocFacts` no mete nada más específico del cliente en el mensaje — ni RUT, ni
 * nombre, ni otras filas del CMF. `runCalculadoraMora` (el otro LLM call que el caché
 * envuelve) tampoco. `doc.filename` SÍ entra al header del prompt, pero a propósito NO
 * entra a este hash: es cosmético para la clasificación, y el prompt instruye clasificar
 * por CONTENIDO, no por nombre de archivo (ej. "no trates una captura como chat aunque
 * el archivo se llame WhatsApp"). Nada queda afuera de la llave.
 */
export function contextHash(input: {
  institucionCmf: string | null | undefined;
  acreditacionTipo: string | null | undefined;
  cmfRows: CmfRowRef[];
}): string {
  const inst = (input.institucionCmf ?? '').trim().toLowerCase();
  const tipo = (input.acreditacionTipo ?? '').trim().toLowerCase();
  const rows = (input.cmfRows ?? [])
    .map((r) =>
      [
        (r.tipoCredito ?? '').trim().toLowerCase(),
        Math.round(Number(r.totalCredito) || 0),
        Math.round(Number(r.overdue90Days) || 0),
      ].join('|')
    )
    .sort();
  return sha256(`inst=${inst}\ntipo=${tipo}\nn=${rows.length}\n${rows.join('\n')}`);
}

/**
 * Devuelve los hechos de la lectura vigente para esta llave, o null si no hay.
 *
 * Solo mira `status='completed'`: una lectura fallida jamás se reutiliza (si no, un 529
 * transitorio se volvería una respuesta permanente equivocada).
 *
 * Un error de base NO se traga (G2) pero tampoco tumba la corrida: se reporta y se
 * devuelve null → se lee del LLM. Un caché caído encarece; no puede romper.
 */
export async function findLecturaVigente(
  supabase: SupabaseClient,
  key: ReadKey,
  logger?: { log: (m: string) => void; error: (m: string, e?: unknown) => void }
): Promise<unknown | null> {
  const { data, error } = await supabase
    .from('document_reads')
    .select('facts_json')
    .eq('doc_sha256', key.docSha256)
    .eq('reader', key.reader)
    .eq('prompt_version', key.promptVersion)
    .eq('lessons_version', key.lessonsVersion)
    .eq('model', key.model)
    .eq('context_hash', key.contextHash)
    .eq('status', 'completed')
    .maybeSingle();

  if (error) {
    logger?.error(`📖 [Lecturas] No se pudo consultar el caché (se lee del LLM): ${error.message}`);
    return null;
  }
  return data?.facts_json ?? null;
}

/**
 * Persiste una lectura completada y su consumo. Nunca lanza: si falla el registro, la
 * lectura ya se hizo y su resultado es lo que importa (mismo criterio que
 * `logHerramientaUso` del panel). Pero SÍ se loguea — nada desaparece en silencio.
 */
export async function registrarLectura(
  supabase: SupabaseClient,
  key: ReadKey,
  args: {
    facts: unknown;
    filename: string;
    durationMs: number;
    llmCalls: LlmCallRecord[];
    automationJobId: string | null;
    rut: string | null;
  },
  logger?: { log: (m: string) => void; error: (m: string, e?: unknown) => void }
): Promise<void> {
  const { error } = await supabase.from('document_reads').insert({
    doc_sha256: key.docSha256,
    filename: args.filename,
    reader: key.reader,
    prompt_version: key.promptVersion,
    lessons_version: key.lessonsVersion,
    model: key.model,
    context_hash: key.contextHash,
    status: 'completed',
    facts_json: args.facts as Record<string, unknown>,
    duration_ms: args.durationMs,
    automation_job_id: args.automationJobId,
    llm_calls: args.llmCalls.length,
  });

  // 23505 = otra corrida ganó la carrera e insertó la misma llave. No es un error:
  // el invariante del índice único hizo exactamente su trabajo.
  if (error && (error as { code?: string }).code !== '23505') {
    logger?.error(`📖 [Lecturas] No se pudo guardar la lectura de ${args.filename}: ${error.message}`);
  }

  await registrarConsumo(supabase, args.llmCalls, {
    rut: args.rut,
    automationJobId: args.automationJobId,
    filename: args.filename,
  }, logger);
}

/**
 * Consumo de tokens → `herramientas_uso` (la tabla del panel), con `source='worker'`.
 *
 * Ojo: `herramientas_uso.job_id` es un bigint que referencia `mac_mini_jobs`, que no
 * tiene nada que ver con nuestros jobs. El id de `automation_jobs` es un uuid, así que
 * va en `meta`, y `job_id` queda null.
 *
 * Datos CRUDOS, sin costo calculado: el precio del modelo cambia y se deriva al leer.
 *
 * ⚠️ CONTRATO COMPARTIDO con el panel (`auth-admin`): dos equipos escriben esta misma
 * tabla, cada uno con su `source`. Mismo espíritu que `lib/models.ts` — si este lado
 * cambia el esquema del insert, avisar al otro antes, no después.
 */
export async function registrarConsumo(
  supabase: SupabaseClient,
  calls: LlmCallRecord[],
  ctx: { rut: string | null; automationJobId: string | null; filename?: string },
  logger?: { log: (m: string) => void; error: (m: string, e?: unknown) => void }
): Promise<void> {
  if (calls.length === 0) return;
  const filas = calls.map((c) => ({
    skill: c.skill,
    model: c.model,
    input_tokens: c.usage.input_tokens ?? 0,
    output_tokens: c.usage.output_tokens ?? 0,
    cache_creation_tokens: c.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: c.usage.cache_read_input_tokens ?? 0,
    job_id: null,
    rut: ctx.rut,
    source: 'worker',
    meta: { automation_job_id: ctx.automationJobId, filename: ctx.filename ?? null },
  }));
  const { error } = await supabase.from('herramientas_uso').insert(filas);
  if (error) {
    logger?.error(`📖 [Lecturas] No se pudo registrar el consumo: ${error.message}`);
  }
}
