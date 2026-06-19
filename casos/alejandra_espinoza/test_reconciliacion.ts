/**
 * Test del pase de reconciliación NO-CMF — Caso Alejandra Espinoza.
 *
 * Corre el Centinela (API Key #1) REAL sobre el perfil de Alejandra y muestra:
 *   - additionalCreditors  → acreedores que NO están en el CMF (las 2 tarjetas BdCh)
 *   - reclassifiedCreditors → acreedores del CMF reclasificados a Art. 260
 *   - identified261Creditors → deudas Art. 261 identificadas desde documentos
 *   - fechasClave           → expiración CMF/certificados + cruce 261→260 (determinista)
 *
 * NO toca el portal (no hay Playwright). Solo valida la detección.
 *
 * Resultado esperado para Alejandra:
 *   - additionalCreditors: 2 (Visa Platinium $517.442 + Visa Entel $1.407.530), Art. 261
 *   - NO debe inventar deuda de TGR (no se subió documento de TGR a client_documents)
 *   - NO debe duplicar el crédito de consumo de Banco de Chile (sí está en el CMF)
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true \
 *     npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_reconciliacion.ts
 *
 * Para saltar el Centinela (sin gasto de créditos API):
 *   DISABLE_SENTINEL=true BYPASS_DATE_CHECK=true \
 *     npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_reconciliacion.ts
 *
 * Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY en .env
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { runSentinelCheck, ClientProfile } from '../../src/utils/sentinel';

const ALEJANDRA_RUT = '18.738.680-2';

const log = (msg: string) => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  console.log(`[${ts}] ${msg}`);
};
const logger = { log, error: (msg: string, err?: unknown) => console.error(msg, err ?? '') };

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en .env (el Centinela llama a Claude).');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(supabaseUrl, supabaseKey) as SupabaseClient<any>;

  log(`⏳ Buscando perfil de Alejandra (RUT ${ALEJANDRA_RUT})...`);
  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('rut', ALEJANDRA_RUT)
    .single();
  if (error || !client) throw new Error(`No se encontró el cliente: ${error?.message ?? 'vacío'}`);
  log(`✓ Cliente: ${client.name} (id: ${client.id})`);

  log('\n🛡️  Ejecutando Centinela (API Key #1) — esto consume créditos de Claude...\n');
  const result = await runSentinelCheck(client as ClientProfile, supabase, logger);

  log('\n═══════════════ RESULTADO RECONCILIACIÓN ═══════════════');
  log(`success: ${result.success}`);
  if (result.errors.length) log(`errors: ${result.errors.join(' | ')}`);

  log(`\n🆕 additionalCreditors (NO-CMF): ${result.additionalCreditors?.length ?? 0}`);
  (result.additionalCreditors ?? []).forEach((a) =>
    log(`  • ${a.bank} (${a.product_type}) [Art. ${a.categoria_articulo}]: $${a.total_credito_clp.toLocaleString('es-CL')} — ${a.reason}`)
  );

  log(`\n♻️  reclassifiedCreditors (CMF → 260): ${result.reclassifiedCreditors?.length ?? 0}`);
  (result.reclassifiedCreditors ?? []).forEach((r) =>
    log(`  • ${r.institucion_cmf}: ${r.delinquency_days}d desde ${r.delinquency_start_date} ($${r.total_credito_clp.toLocaleString('es-CL')})`)
  );

  log(`\n📋 identified261Creditors (CMF, Art. 261): ${result.identified261Creditors?.length ?? 0}`);
  (result.identified261Creditors ?? []).forEach((r) =>
    log(`  • ${r.institucion_cmf}: $${r.total_credito_clp.toLocaleString('es-CL')} — ${r.reason}`)
  );

  log(`\n🗓️  fechasClave: ${result.fechasClave?.length ?? 0}`);
  (result.fechasClave ?? []).forEach((f) => {
    const estado = f.diasRestantes < 0 ? `VENCIDO hace ${Math.abs(f.diasRestantes)}d` : `en ${f.diasRestantes}d`;
    log(`  • [${f.tipo}] ${f.referencia}: ${f.fecha} (${estado})`);
  });
  log('════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message || err);
  process.exit(1);
});
