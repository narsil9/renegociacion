/**
 * Agente Centinela — wrapper del análisis preventivo de documentos (API Key #1).
 *
 * Delega la lógica de negocio en `sentinel.ts` (runSentinelCheck) y añade:
 *  - Idempotencia: SHA-256 del CMF → si el PDF no cambió y hay un run completed,
 *    reutiliza el output sin gastar créditos de API.
 *  - Persistencia en agent_runs (step=3, agent_type='centinela').
 *  - Validación con validateCentinelaOutput antes de completeRun.
 *  - Conversión SentinelResult → CentinelaOutput (interfaz tipada de la cadena).
 *
 * ENABLE_SENTINEL=true requerido para llamar a Claude. Si no está activo, devuelve
 * output vacío SIN escribir en agent_runs (preserva idempotencia para cuando se active).
 *
 * cmfDocumentOverrides[] — en esta versión siempre vacío. Próxima iteración:
 * extraer monto+fecha de los documentos de los acreedores CMF directos Art. 260.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { CentinelaOutput } from './types';
import { insertAgentRun, markRunning, completeRun, failRun, getLatestRun } from './agent_runs';
import { validateCentinelaOutput, logValidationResult } from './validator';
import { runSentinelCheck, ClientProfile, SimpleLogger } from '../utils/sentinel';

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const EMPTY_OUTPUT: CentinelaOutput = {
  reclassifiedCreditors: [],
  identified261Creditors: [],
  additionalCreditors: [],
  cmfDocumentOverrides: [],
  fechasClave: [],
};

/**
 * Corre el Agente Centinela y persiste el resultado en agent_runs.
 *
 * @param supabase        — cliente Supabase del sandbox
 * @param clientId        — UUID del cliente (para agent_runs)
 * @param clientProfile   — perfil del cliente (incluye informe_cmf_path, rut, etc.)
 * @param cmfLocalPath    — CMF ya descargado localmente (se usa para el hash de idempotencia)
 * @param logger          — logger opcional
 * @returns CentinelaOutput persistido en agent_runs, o vacío si ENABLE_SENTINEL=false
 */
export async function runCentinelaAgent(
  supabase: SupabaseClient,
  clientId: string,
  clientProfile: ClientProfile,
  cmfLocalPath: string,
  logger?: SimpleLogger
): Promise<CentinelaOutput> {
  const log = (msg: string) => {
    if (logger) logger.log(`🛡️ [CentinelaAgent] ${msg}`);
    else console.log(`🛡️ [CentinelaAgent] ${msg}`);
  };
  const logErr = (msg: string, err?: unknown) => {
    if (logger) logger.error(`🛡️ [CentinelaAgent] ${msg}`, err);
    else console.error(`🛡️ [CentinelaAgent] ${msg}`, err);
  };

  // Bypass: ENABLE_SENTINEL no activo → flujo sin Claude, sin escribir en agent_runs
  if (process.env.ENABLE_SENTINEL !== 'true') {
    log('Bypass activo (ENABLE_SENTINEL !== true) — omitiendo análisis preventivo.');
    return EMPTY_OUTPUT;
  }

  // --- Idempotencia ---
  const inputHash = hashFile(cmfLocalPath);
  const existing = await getLatestRun<CentinelaOutput>(supabase, clientId, 'centinela');
  if (existing?.input_hash === inputHash && existing.output_json) {
    log(`Reutilizando run centinela existente (${existing.id}) — CMF sin cambios.`);
    return existing.output_json;
  }

  // --- Nuevo run ---
  const runId = await insertAgentRun(supabase, clientId, 3, 'centinela', inputHash);
  await markRunning(supabase, runId);
  log(`Run centinela iniciado (runId: ${runId})`);

  try {
    // runSentinelCheck descarga el CMF internamente usando client.informe_cmf_path.
    // El CMF ya está en cmfLocalPath (descargado por el worker), pero sentinel.ts
    // lo re-descarga a su propio tmp. Aceptado: eliminar la doble descarga es
    // una optimización pendiente (requiere refactor de sentinel.ts).
    const sentinelResult = await runSentinelCheck(clientProfile, supabase, logger ?? {
      log: (m) => console.log(m),
      error: (m, e) => console.error(m, e),
    });

    if (!sentinelResult.success) {
      const errors = sentinelResult.errors;
      await failRun(supabase, runId, errors);
      if (sentinelResult.technicalError) {
        // Error técnico (API caída, créditos agotados, red): relanzar como Error genérico
        // para que el retry loop del worker reintente sin bloquear el caso.
        throw new Error(`Error técnico del centinela (reintentable): ${errors.join('; ')}`);
      }
      // Error semántico (docs deficientes, CMF no registrado): bloquear el caso
      throw new CentinelaBlockedError(errors.join('; '));
    }

    const output: CentinelaOutput = {
      reclassifiedCreditors: sentinelResult.reclassifiedCreditors ?? [],
      identified261Creditors: sentinelResult.identified261Creditors ?? [],
      additionalCreditors: sentinelResult.additionalCreditors ?? [],
      cmfDocumentOverrides: [], // TODO: extraer monto+fecha de docs de acreedores CMF 260 directos
      fechasClave: sentinelResult.fechasClave ?? [],
    };

    const validation = validateCentinelaOutput(output);
    logValidationResult(validation, 'centinela', log);

    if (!validation.valid) {
      await failRun(supabase, runId, validation.errors);
      throw new Error(`Validación centinela fallida: ${validation.errors.join('; ')}`);
    }

    await completeRun(supabase, runId, output, validation.needsLawyerReview);
    log(
      `Run centinela completado — ` +
      `reclasif: ${output.reclassifiedCreditors.length}, ` +
      `no-CMF: ${output.additionalCreditors.length}, ` +
      `needsLawyerReview: ${validation.needsLawyerReview}`
    );
    return output;

  } catch (err) {
    if (err instanceof CentinelaBlockedError) throw err; // ya llamó failRun
    const msg = err instanceof Error ? err.message : String(err);
    logErr(`Error en agente centinela (runId: ${runId}):`, err);
    await failRun(supabase, runId, [msg]);
    throw err;
  }
}

/**
 * Error específico para cuando el Centinela bloquea el caso por documentos deficientes.
 * El worker lo captura y registra la alerta sin sobreescribir el estado del run.
 */
export class CentinelaBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CentinelaBlockedError';
  }
}
