/**
 * Agente Mapeador — wrapper del Orquestador Cognitivo (API Key #2).
 *
 * Delega la lógica de negocio en `cognitive_orchestrator.ts`
 * (runCognitiveOrchestrator) y añade:
 *  - Idempotencia: input_hash = ID del último run completado del Centinela.
 *    Si el Centinela no re-corrió, el Mapeador reutiliza su output cacheado.
 *  - Persistencia en agent_runs (step=3, agent_type='mapeador').
 *  - Validación con validateMapeadorOutput antes de completeRun.
 *  - Conversión OrchestrationResult → MapeadorOutput (interfaz tipada de la cadena).
 *
 * Manejo de errores:
 *  - Error técnico (technicalError=true): failRun + throw → el retry loop reintenta.
 *  - Error semántico (missing_document, rut_mismatch): completeRun con
 *    needsLawyerReview=true y las alertas en MapeadorOutput.alerts. El worker
 *    lee las alertas para decidir si bloquea el Paso 3.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { MapeadorOutput, CentinelaOutput } from './types';
import { insertAgentRun, markRunning, completeRun, failRun, getLatestRun } from './agent_runs';
import { validateMapeadorOutput, logValidationResult } from './validator';
import { runCognitiveOrchestrator, CognitiveAlert, ClientProfile } from '../utils/cognitive_orchestrator';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: unknown): void;
}

const EMPTY_OUTPUT: MapeadorOutput = { mappedDocs: [], alerts: [] };

/**
 * Corre el Agente Mapeador y persiste el resultado en agent_runs.
 *
 * @param supabase         — cliente Supabase del sandbox
 * @param clientId         — UUID del cliente (para agent_runs)
 * @param clientProfile    — perfil del cliente (informe_cmf_path, acreditacion_documentos_json, etc.)
 * @param cmfLocalPath     — CMF ya descargado localmente
 * @param centinelaOutput  — output del Centinela (reclasificados, no-CMF, etc.)
 * @param logger           — logger opcional
 * @returns MapeadorOutput persistido en agent_runs
 */
export async function runMapeadorAgent(
  supabase: SupabaseClient,
  clientId: string,
  clientProfile: ClientProfile,
  cmfLocalPath: string,
  centinelaOutput: CentinelaOutput,
  logger?: SimpleLogger
): Promise<MapeadorOutput> {
  const log = (msg: string) => {
    if (logger) logger.log(`🗺️ [MapeadorAgent] ${msg}`);
    else console.log(`🗺️ [MapeadorAgent] ${msg}`);
  };
  const logErr = (msg: string, err?: unknown) => {
    if (logger) logger.error(`🗺️ [MapeadorAgent] ${msg}`, err);
    else console.error(`🗺️ [MapeadorAgent] ${msg}`, err);
  };

  // --- Idempotencia: usar el run ID del Centinela como hash ---
  // Si el Centinela no re-corrió (mismo ID), el Mapeador reutiliza su output.
  const centinelaRun = await getLatestRun<CentinelaOutput>(supabase, clientId, 'centinela');
  const inputHash = centinelaRun?.id ?? 'no-centinela-run';

  const existing = await getLatestRun<MapeadorOutput>(supabase, clientId, 'mapeador');
  if (existing?.input_hash === inputHash && existing.output_json) {
    log(`Reutilizando run mapeador existente (${existing.id}) — Centinela sin cambios.`);
    return existing.output_json;
  }

  // --- Nuevo run ---
  const runId = await insertAgentRun(supabase, clientId, 3, 'mapeador', inputHash);
  await markRunning(supabase, runId);
  log(`Run mapeador iniciado (runId: ${runId})`);

  const defaultLogger: SimpleLogger = {
    log: (m) => console.log(m),
    error: (m, e) => console.error(m, e),
  };

  try {
    const orchResult = await runCognitiveOrchestrator(
      clientProfile,
      cmfLocalPath,
      supabase,
      logger ?? defaultLogger,
      centinelaOutput.reclassifiedCreditors,
      centinelaOutput.identified261Creditors,
      centinelaOutput.additionalCreditors
    );

    // Error técnico (API caída, JSON malformado): relanzar para que el retry loop reintente
    if (orchResult.status === 'error' && orchResult.technicalError) {
      const msg = orchResult.reason ?? 'Error técnico del orquestador cognitivo';
      await failRun(supabase, runId, [msg]);
      throw new Error(`Error técnico del mapeador (reintentable): ${msg}`);
    }

    const output: MapeadorOutput = {
      mappedDocs: orchResult.mappedDocs ?? [],
      alerts: orchResult.alerts,
    };

    const validation = validateMapeadorOutput(output);
    logValidationResult(validation, 'mapeador', log);

    // Los errores de validación (rut_mismatch, missing_document) son semánticos:
    // se persisten como completed con needsLawyerReview=true para que el abogado revise.
    // El worker lee las alertas para decidir si bloquea Playwright.
    await completeRun(supabase, runId, output, validation.needsLawyerReview);
    log(
      `Run mapeador completado — ` +
      `docs mapeados: ${output.mappedDocs.length}, ` +
      `alertas: ${output.alerts.length}, ` +
      `needsLawyerReview: ${validation.needsLawyerReview}`
    );
    return output;

  } catch (err) {
    // Solo re-lanzar si ya llamamos failRun (errores técnicos)
    if (err instanceof Error && err.message.startsWith('Error técnico del mapeador')) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    logErr(`Error en agente mapeador (runId: ${runId}):`, err);
    await failRun(supabase, runId, [msg]);
    throw err;
  }
}

/**
 * Determina si el MapeadorOutput tiene alertas que deben bloquear Playwright.
 * Separado de validateMapeadorOutput para que el worker pueda decidir sin
 * re-instanciar la lógica de validación.
 */
export function mapeadorHasBlockers(output: MapeadorOutput): { blocked: boolean; reason: string } {
  const blockers = output.alerts.filter(
    (a: CognitiveAlert) => a.type === 'missing_document' || a.type === 'rut_mismatch'
  );
  if (blockers.length === 0) return { blocked: false, reason: '' };
  return {
    blocked: true,
    reason: blockers.map((a: CognitiveAlert) => a.message).join('; '),
  };
}
