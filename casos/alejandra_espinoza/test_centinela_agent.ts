/**
 * Test de integración del Agente Centinela — Caso Alejandra Espinoza.
 *
 * A diferencia de `test_reconciliacion.ts` (que llama runSentinelCheck directo),
 * este script ejerce el wrapper `runCentinelaAgent` que añade:
 *   - Idempotencia SHA-256 del CMF → agent_runs
 *   - Validación con validateCentinelaOutput
 *   - CentinelaBlockedError para bloqueos semánticos
 *
 * Valores esperados para Alejandra:
 *   reclassifiedCreditors : []  (CAT y CMR ya tienen mora ≥91d en el CMF)
 *   additionalCreditors   : 2  (Visa Platinium $517.442 + Visa Entel $1.407.530)
 *   identified261Creditors: ≥0 (BdCh consumo $3.125.486 al día)
 *
 * Prerrequisitos:
 *   1. Tabla agent_runs creada en Supabase (pegar supabase/schema_agent_runs.sql en SQL Editor).
 *   2. Perfil de Alejandra en tabla `clients` (RUT 18.738.680-2) con CMF en storage.
 *   3. ENABLE_SENTINEL=true activo → gasta créditos de Claude (API Key #1).
 *
 * Uso:
 *   ENABLE_SENTINEL=true BYPASS_DATE_CHECK=true \
 *     npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_centinela_agent.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { runCentinelaAgent, CentinelaBlockedError } from '../../src/agents/centinela_agent';
import { CentinelaOutput } from '../../src/agents/types';

const ALEJANDRA_RUT = '18.738.680-2';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');
const CMF_LOCAL = path.join(TMP_DIR, 'informe_cmf_alejandra_centinela_test.pdf');

// Valores esperados (según test_step3.ts hardcodeado, validado E2E 2026-06-14 y 2026-06-15)
const EXPECTED_RECLASSIFIED = 0;
const EXPECTED_ADDITIONAL = 2; // Visa Platinium $517.442 + Visa Entel $1.407.530

const log = (msg: string) => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  console.log(`[${ts}] ${msg}`);
};
const logger = { log, error: (msg: string, err?: unknown) => console.error(msg, err ?? '') };

function assertEq(label: string, actual: number, expected: number): void {
  const ok = actual === expected;
  log(`  ${ok ? '✅' : '❌'} ${label}: ${actual} (esperado ${expected})`);
  if (!ok) process.exitCode = 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function downloadCmf(supabase: SupabaseClient<any>, storagePath: string): Promise<void> {
  if (fs.existsSync(CMF_LOCAL)) {
    log(`  ♻️  CMF ya existe localmente: ${CMF_LOCAL}`);
    return;
  }
  const { data, error } = await supabase.storage.from('documentos').download(storagePath);
  if (error || !data) throw new Error(`Error descargando CMF [${storagePath}]: ${error?.message}`);
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(CMF_LOCAL, Buffer.from(await data.arrayBuffer()));
  log(`  ✓ CMF descargado: ${CMF_LOCAL}`);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
  if (process.env.ENABLE_SENTINEL !== 'true') throw new Error('Requiere ENABLE_SENTINEL=true');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en .env');

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

  if (!client.informe_cmf_path) throw new Error('El cliente no tiene informe_cmf_path');
  log(`⏳ Descargando CMF (${client.informe_cmf_path})...`);
  await downloadCmf(supabase, client.informe_cmf_path);

  log('\n🛡️  Ejecutando runCentinelaAgent (con agent_runs + idempotencia)...\n');

  let output: CentinelaOutput;
  try {
    output = await runCentinelaAgent(supabase, client.id, client, CMF_LOCAL, logger);
  } catch (err) {
    if (err instanceof CentinelaBlockedError) {
      log(`\n❌ CentinelaBlockedError: ${err.message}`);
      log('El caso fue bloqueado por documentos deficientes — revisar con el abogado.');
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  log('\n═══════════════ OUTPUT runCentinelaAgent ═══════════════');
  log(`\n♻️  reclassifiedCreditors: ${output.reclassifiedCreditors.length}`);
  output.reclassifiedCreditors.forEach((r) =>
    log(`  • ${r.institucion_cmf}: ${r.delinquency_days}d desde ${r.delinquency_start_date} ($${r.total_credito_clp.toLocaleString('es-CL')})`)
  );

  log(`\n🆕 additionalCreditors (NO-CMF): ${output.additionalCreditors.length}`);
  output.additionalCreditors.forEach((a) =>
    log(`  • ${a.bank} [Art. ${a.categoria_articulo}] $${a.total_credito_clp.toLocaleString('es-CL')} — ${a.reason}`)
  );

  log(`\n📋 identified261Creditors: ${output.identified261Creditors.length}`);
  output.identified261Creditors.forEach((c) =>
    log(`  • ${c.institucion_cmf}: $${c.total_credito_clp.toLocaleString('es-CL')}`)
  );

  log(`\n📄 cmfDocumentOverrides: ${output.cmfDocumentOverrides.length} (pendiente de implementar)`);

  log(`\n🗓️  fechasClave: ${output.fechasClave.length}`);
  output.fechasClave.forEach((f) => {
    const estado = f.diasRestantes < 0 ? `VENCIDO hace ${Math.abs(f.diasRestantes)}d` : `en ${f.diasRestantes}d`;
    log(`  • [${f.tipo}] ${f.referencia}: ${f.fecha} (${estado})`);
  });
  log('════════════════════════════════════════════════════════\n');

  log('📊 ASSERTIONS vs valores hardcodeados en test_step3.ts:');
  assertEq('reclassifiedCreditors.length', output.reclassifiedCreditors.length, EXPECTED_RECLASSIFIED);
  assertEq('additionalCreditors.length', output.additionalCreditors.length, EXPECTED_ADDITIONAL);

  // Verificar montos de las tarjetas NO-CMF
  const montos = output.additionalCreditors
    .map((a) => a.total_credito_clp)
    .sort((a, b) => a - b);
  const montosOk = montos.length === 2 && montos[0] === 517442 && montos[1] === 1407530;
  log(`  ${montosOk ? '✅' : '❌'} Montos NO-CMF: [${montos.join(', ')}] (esperado [517442, 1407530])`);
  if (!montosOk) process.exitCode = 1;

  // Verificar que todos son Art. 261 (no reclasificados)
  const todosArt261 = output.additionalCreditors.every((a) => a.categoria_articulo === 261);
  log(`  ${todosArt261 ? '✅' : '❌'} Todos additionalCreditors Art. 261: ${todosArt261}`);
  if (!todosArt261) process.exitCode = 1;

  // Verificar que no hay duplicación del crédito de consumo BdCh (sí está en el CMF)
  const duplicadoBdCh = output.additionalCreditors.some(
    (a) => a.bank === 'Banco de Chile' && a.product_type === 'consumo'
  );
  log(`  ${!duplicadoBdCh ? '✅' : '❌'} Sin duplicar crédito consumo BdCh (ya en CMF): ${!duplicadoBdCh}`);
  if (duplicadoBdCh) process.exitCode = 1;

  log('');
  if (process.exitCode === 1) {
    log('❌ Algunas assertions fallaron — revisar output arriba.');
  } else {
    log('✅ Todas las assertions pasaron. runCentinelaAgent produce el output esperado.');
  }
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message || err);
  process.exit(1);
});
