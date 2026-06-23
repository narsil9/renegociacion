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
 * El Centinela corre por defecto en producción. Para saltarlo (sin detección NO-CMF)
 * usar DISABLE_SENTINEL=true en .env. En ese caso devuelve output vacío SIN escribir
 * en agent_runs (preserva idempotencia para cuando se reactive).
 *
 * cmfDocumentOverrides[] — poblado desde sentinelResult.cmf260DirectOverrides (REGLA 9
 * del prompt del Centinela): monto y fecha real desde el certificado para cada Art.260
 * directo del CMF (overdue90Days > 0, no reclasificado). Reemplaza monto del CMF y
 * el placeholder dateDaysAgo(90) que se usaba antes.
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
  deReclassified261Creditors: [],
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
 * @returns CentinelaOutput persistido en agent_runs, o vacío si DISABLE_SENTINEL=true
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

  // Bypass explícito: DISABLE_SENTINEL=true → flujo sin Claude, sin escribir en agent_runs
  if (process.env.DISABLE_SENTINEL === 'true') {
    log('Bypass activo (DISABLE_SENTINEL=true) — omitiendo análisis preventivo. Los acreedores NO-CMF NO serán detectados.');
    return EMPTY_OUTPUT;
  }

  // --- Idempotencia ---
  // El sufijo de versión invalida los runs cacheados cuando cambia la LÓGICA del Centinela
  // (no solo el CMF). Subir al cambiar reglas como el backstop de acreditación 260→261.
  const CENTINELA_LOGIC_VERSION = 'v11-contribuciones-solo-morosa';
  const inputHash = `${hashFile(cmfLocalPath)}:${CENTINELA_LOGIC_VERSION}`;
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
      // Claude devuelve los errores como objetos {code, severity, message, filename}.
      // Extraemos texto LEGIBLE (message + filename) en vez de volcar el JSON crudo,
      // para que la alerta y error_message se lean claros en el panel del abogado.
      const errorStrings = (errors as unknown[]).map(e => {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object' && 'message' in (e as Record<string, unknown>)) {
          const o = e as { message?: unknown; filename?: unknown };
          const fn = typeof o.filename === 'string' && o.filename ? ` (${o.filename})` : '';
          return `${String(o.message)}${fn}`;
        }
        return JSON.stringify(e);
      });

      if (sentinelResult.technicalError) {
        // Error técnico (API caída, créditos agotados, red): relanzar como Error genérico
        // para que el retry loop del worker reintente sin bloquear el caso.
        await failRun(supabase, runId, errorStrings);
        throw new Error(`Error técnico del centinela (reintentable): ${errorStrings.join('; ')}`);
      }

      // BYPASS: en modo de prueba con documentos vencidos, Claude dice RECHAZADO por
      // fechas pero igual encontró acreedores válidos. Omitir el bloqueo y continuar.
      if (process.env.BYPASS_DATE_CHECK === 'true' || process.env.BYPASS_DATE_VALIDATION === 'true') {
        log(`⚠️ Centinela rechazó documentos pero BYPASS_DATE_CHECK activo — omitiendo bloqueo. Motivo: ${errorStrings.join('; ')}`);
        // Fall through — build output from whatever Claude found
      } else {
        // Error semántico (docs deficientes, CMF no registrado): bloquear el caso
        await failRun(supabase, runId, errorStrings);
        throw new CentinelaBlockedError(errorStrings.join('; '));
      }
    }

    const output: CentinelaOutput = {
      reclassifiedCreditors: sentinelResult.reclassifiedCreditors ?? [],
      identified261Creditors: sentinelResult.identified261Creditors ?? [],
      additionalCreditors: sentinelResult.additionalCreditors ?? [],
      cmfDocumentOverrides: (sentinelResult.cmf260DirectOverrides ?? []).map(o => ({
        institucion_cmf: o.institucion_cmf,
        monto_clp: o.monto_clp,
        fecha_vencimiento: o.fecha_vencimiento,
      })),
      deReclassified261Creditors: sentinelResult.deReclassified261Creditors ?? [],
      fechasClave: sentinelResult.fechasClave ?? [],
    };

    const validation = validateCentinelaOutput(output);
    logValidationResult(validation, 'centinela', log);

    if (!validation.valid) {
      // Las fallas de validación del Centinela son SEMÁNTICAS (documentos vencidos,
      // falta monto/fecha, categoría inválida) — no técnicas (red/API/créditos). Deben
      // BLOQUEAR el caso con una alerta clara, no reintentarse ni reportarse como
      // "error técnico genérico". Por eso se lanza CentinelaBlockedError (el worker lo
      // captura, registra la alerta y marca el job como 'blocked').
      await failRun(supabase, runId, validation.errors);
      throw new CentinelaBlockedError(validation.errors.join(' · '));
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
