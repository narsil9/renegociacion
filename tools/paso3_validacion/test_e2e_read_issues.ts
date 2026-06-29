/**
 * E2E de la cadena del worker para la validación anti-error (sin portal):
 *   runCentinelaAgent (real, API + DB, idempotencia)  →  CentinelaOutput.claudeReadIssues
 *   →  buildReadIssuesAlert (texto que el worker mete en automation_alerts)
 *
 * Prueba que las señales que detecta el Centinela (auto-cita, RUT, confianza, moneda, etc.)
 * SOBREVIVEN la conversión a CentinelaOutput (antes se perdían) y producen una alerta legible
 * para el panel del abogado. NO entra al portal (esa capa es Playwright, downstream).
 *
 * Gasta créditos (corre el Centinela 1 vez; luego idempotente por hash del CMF).
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/_shared/test_e2e_read_issues.ts [miguel_lugo]
 */
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { runCentinelaAgent } from '../../src/agents/centinela_agent';
import { buildReadIssuesAlert } from '../../src/utils/read_issues_alert';
dotenv.config();

const CASES: Record<string, string> = {
  miguel_lugo: '26.625.555-1',
  nector_ruiz: '15.420.073-8',
  cristian_mancilla: '16.587.870-1',
};

function reqEnv(n: string): string { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }

async function main() {
  const only = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'miguel_lugo';
  const rut = CASES[only];
  if (!rut) throw new Error(`Caso desconocido: ${only}. Opciones: ${Object.keys(CASES).join(', ')}`);

  const supabase = createClient(reqEnv('SUPABASE_URL'), reqEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const logger = { log: (m: string) => console.log(m), error: (m: string, e?: unknown) => console.error(m, e ?? '') };

  const { data: client } = await supabase.from('clients').select('*').eq('rut', rut).maybeSingle();
  if (!client) throw new Error(`Cliente ${rut} no encontrado en el sandbox.`);
  if (!client.informe_cmf_path) throw new Error('Cliente sin informe_cmf_path.');

  // Descargar el CMF (igual que el worker) para el hash de idempotencia del agente.
  const tmpDir = path.join(process.cwd(), 'outputs');
  fs.mkdirSync(tmpDir, { recursive: true });
  const cmfLocalPath = path.join(tmpDir, `cmf_e2e_${only}.pdf`);
  const { data: cmfBlob, error: cmfErr } = await supabase.storage.from('documentos').download(client.informe_cmf_path);
  if (cmfErr || !cmfBlob) throw new Error(`Error al descargar CMF: ${cmfErr?.message || 'vacío'}`);
  fs.writeFileSync(cmfLocalPath, Buffer.from(await cmfBlob.arrayBuffer()));

  console.log(`\n🧪 E2E propagación anti-error — ${only} (${rut})\n${'═'.repeat(60)}`);
  const output = await runCentinelaAgent(supabase, client.id, client, cmfLocalPath, logger);

  const issues = output.claudeReadIssues ?? [];
  console.log(`\n── CentinelaOutput.claudeReadIssues: ${issues.length} señal(es) ──`);
  if (!('claudeReadIssues' in output)) {
    console.log('❌ FALLO: CentinelaOutput NO tiene el campo claudeReadIssues (no se propagó).');
    process.exit(1);
  }
  for (const i of issues) console.log(`   ⚠️ [${i.tipo}] ${i.institucion} $${i.monto_clp.toLocaleString('es-CL')} — ${i.detalle}`);

  const alerta = buildReadIssuesAlert(issues);
  console.log(`\n── Alerta que el worker insertaría en automation_alerts (needs_review) ──`);
  console.log(alerta ? alerta : '   (sin señales → no se emite alerta — comportamiento correcto)');

  console.log(`\n✅ E2E OK: el campo claudeReadIssues sobrevive la conversión a CentinelaOutput y produce ${alerta ? 'una alerta legible' : 'ninguna alerta (lectura limpia)'}.`);
}

main().catch((e) => { console.error('\n🚨', (e as Error).message); process.exit(1); });
