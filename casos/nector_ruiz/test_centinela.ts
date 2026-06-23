/**
 * Test AISLADO del Centinela para Néctor — NO entra al portal (sin Playwright).
 * Verifica el Fix 2 (reconciliación por operación): que el certificado de
 * BancoEstado (3 CRE) genere la fila adicional CRE-00040166973 $553.350 que el
 * CMF no lista.
 *
 * Corre la MISMA cadena que el worker hasta el Centinela: descarga el CMF +
 * runCentinelaAgent (que internamente descarga los certs y llama a Claude).
 * NO toca el borrador del portal → seguro de correr en paralelo con otra prueba.
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/nector_ruiz/test_centinela.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { runCentinelaAgent, CentinelaBlockedError } from '../../src/agents/centinela_agent';
dotenv.config();

const RUT = '15.420.073-8';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}

async function main() {
  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const logger = { log: (m: string) => console.log(m), error: (m: string, e?: unknown) => console.error(m, e ?? '') };

  console.log(`\n🧪 Test aislado del Centinela — Néctor (${RUT}) — SIN portal\n`);

  const { data: client } = await supabase.from('clients').select('*').eq('rut', RUT).maybeSingle();
  if (!client) throw new Error('Cliente no encontrado');
  if (!client.informe_cmf_path) throw new Error('Cliente sin informe_cmf_path');

  // Descargar el CMF localmente (necesario para el hash de idempotencia del agente).
  const tempDir = path.join(process.cwd(), 'outputs');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const cmfLocalPath = path.join(tempDir, `cmf_test_centinela_${client.id}.pdf`);
  const { data: cmfBlob, error: cmfErr } = await supabase.storage.from('documentos').download(client.informe_cmf_path);
  if (cmfErr || !cmfBlob) throw new Error(`No se pudo descargar el CMF: ${cmfErr?.message}`);
  fs.writeFileSync(cmfLocalPath, Buffer.from(await cmfBlob.arrayBuffer()));
  console.log(`✓ CMF descargado: ${cmfLocalPath}\n`);

  let output;
  try {
    output = await runCentinelaAgent(supabase, client.id, client, cmfLocalPath, logger);
  } catch (err) {
    if (err instanceof CentinelaBlockedError) {
      console.error(`\n❌ Centinela BLOQUEÓ el caso (semántico): ${err.message}`);
      console.error('   (con BYPASS_DATE_CHECK=true no debería bloquear por fechas)');
      process.exit(1);
    }
    throw err;
  }

  const fmt = (n: number) => '$' + n.toLocaleString('es-CL');
  const line = '─'.repeat(60);

  console.log(`\n${line}\n📊 RESULTADO DEL CENTINELA\n${line}`);

  console.log(`\n🔵 reclassifiedCreditors (→ Art. 260): ${output.reclassifiedCreditors.length}`);
  output.reclassifiedCreditors.forEach((r) => console.log(`   - ${r.bank} (${r.institucion_cmf}) ${fmt(r.total_credito_clp)} venc ${r.delinquency_start_date}`));

  console.log(`\n🟢 identified261Creditors (→ Art. 261 desde docs): ${output.identified261Creditors.length}`);
  output.identified261Creditors.forEach((r) => console.log(`   - ${r.bank} (${r.institucion_cmf}) ${fmt(r.total_credito_clp)} — ${r.reason}`));

  console.log(`\n🟣 additionalCreditors (NO-CMF / operación extra): ${output.additionalCreditors.length}`);
  output.additionalCreditors.forEach((a) =>
    console.log(`   - ${a.bank} (${a.institucion_cmf}) [Art. ${a.categoria_articulo}] ${fmt(a.total_credito_clp)} — ${a.reason}`)
  );

  console.log(`\n🟠 cmfDocumentOverrides (260 directos del CMF): ${output.cmfDocumentOverrides.length}`);
  output.cmfDocumentOverrides.forEach((o) => console.log(`   - ${o.institucion_cmf} ${fmt(o.monto_clp)} venc ${o.fecha_vencimiento}`));

  console.log(`\n🔴 deReclassified261Creditors (260→261): ${output.deReclassified261Creditors.length}`);
  output.deReclassified261Creditors.forEach((r) => console.log(`   - ${r.bank} ${fmt(r.total_credito_clp)} — ${r.reason}`));

  // ---- Verificación específica del Fix 2 ----
  console.log(`\n${line}\n🎯 VERIFICACIÓN FIX 2 — BancoEstado $553.350 (CRE-00040166973)\n${line}`);
  const TARGET = 553350;
  const tol = 50000; // tolerancia documento vs CMF
  const all = [
    ...output.additionalCreditors.map((a) => ({ src: 'additionalCreditors', bank: a.bank, monto: a.total_credito_clp })),
    ...output.identified261Creditors.map((r) => ({ src: 'identified261Creditors', bank: r.bank, monto: r.total_credito_clp })),
    ...output.reclassifiedCreditors.map((r) => ({ src: 'reclassifiedCreditors', bank: r.bank, monto: r.total_credito_clp })),
  ];
  const hit = all.find((x) => /estado/i.test(x.bank) && Math.abs(x.monto - TARGET) <= tol);
  if (hit) {
    console.log(`\n✅ FIX 2 OK — BancoEstado ${fmt(hit.monto)} detectado en "${hit.src}". La fila extra se va a crear en el portal.`);
  } else {
    console.log(`\n❌ FIX 2 NO detectó el producto extra de BancoEstado (~${fmt(TARGET)}).`);
    console.log('   BancoEstado encontrado en:');
    all.filter((x) => /estado/i.test(x.bank)).forEach((x) => console.log(`     - ${x.src}: ${fmt(x.monto)}`));
  }

  fs.unlinkSync(cmfLocalPath);
}

main().catch((err) => {
  console.error('\n🚨', (err as Error).message, err);
  process.exit(1);
});
