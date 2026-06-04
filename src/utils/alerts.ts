import { supabase } from './supabaseWorker';
import { RunnerLogger } from './logger';

/**
 * Updates the client's credential error column in the sandbox database.
 */
export async function createAlert(
  clientId: string,
  tipo: string,
  mensaje: string,
  clientsTable: string,
  logger: RunnerLogger
): Promise<void> {
  logger.log(`🧪 [SANDBOX] Actualizando error de credenciales en la tabla "${clientsTable}" para ID: ${clientId} (${tipo}): "${mensaje}"...`);
  
  const val = `${tipo}: ${mensaje}`;
  const { error } = await supabase
    .from(clientsTable)
    .update({ credential_error: val })
    .eq('id', clientId);

  if (error) {
    logger.error(`❌ Error al actualizar "credential_error" en la tabla "${clientsTable}": ${error.message}`);
  } else {
    logger.log(`✓ Columna "credential_error" actualizada con éxito a "${val}".`);
  }
}

/**
 * Clears the client's credential error column in the sandbox database.
 */
export async function clearAlert(
  clientId: string,
  clientsTable: string,
  logger: RunnerLogger
): Promise<void> {
  logger.log(`🧪 [SANDBOX] Limpiando error de credenciales en la tabla "${clientsTable}" para ID: ${clientId}...`);
  
  const { error } = await supabase
    .from(clientsTable)
    .update({ credential_error: null })
    .eq('id', clientId);

  if (error) {
    logger.error(`❌ Error al limpiar "credential_error" en la tabla "${clientsTable}": ${error.message}`);
  } else {
    logger.log(`✓ Columna "credential_error" limpiada con éxito.`);
  }
}
