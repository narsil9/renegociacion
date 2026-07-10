/**
 * Encola y MONITOREA el job E2E del caso proyectado (sandbox). Borrador vivo
 * (dry_run=false → Pasos 1→4, NO radica). Pollea automation_jobs hasta estado
 * terminal o timeout, imprimiendo el progreso. Lee las alertas al final.
 *
 * Uso: npx ts-node --transpile-only -r dotenv/config tools/mantenimiento/run_projected_test.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv'; dotenv.config();

const CLIENT_ID = 'd5b77dbe-6e43-42eb-b3f1-4e1ed6b17458';
const sbx = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  // limpiar jobs activos previos del cliente
  await sbx.from('automation_jobs').delete().eq('client_id', CLIENT_ID).in('status', ['pending', 'running']);
  // chequear otros pendientes que podrían demorar al worker
  const { count: otros } = await sbx.from('automation_jobs').select('id', { count: 'exact', head: true }).in('status', ['pending', 'running']);
  console.log(`Otros jobs pending/running en sandbox: ${otros ?? 0}`);

  const { data: job, error } = await sbx.from('automation_jobs').insert({ client_id: CLIENT_ID, step: 0, status: 'pending', dry_run: false }).select('id').single();
  if (error || !job) throw new Error('enqueue: ' + error?.message);
  console.log(`✅ Job encolado: ${job.id} (step 0, dry_run=false)\n`);

  let last = '';
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) { // 120 × 15s = 30 min máx
    await sleep(15000);
    const { data: j } = await sbx.from('automation_jobs').select('status, progress_message, error_message').eq('id', job.id).maybeSingle();
    if (!j) continue;
    const line = `[${Math.round((Date.now() - t0) / 1000)}s] ${j.status} — ${j.progress_message ?? ''}`;
    if (line !== last) { console.log(line); last = line; }
    if (['success', 'failed', 'blocked', 'pending_review'].includes(j.status)) {
      console.log(`\n══ ESTADO FINAL: ${j.status} ══`);
      if (j.error_message) console.log('error_message:', j.error_message);
      break;
    }
  }

  // alertas del cliente
  const { data: alerts } = await sbx.from('automation_alerts').select('alert_type, step, description, created_at').eq('client_id', CLIENT_ID).order('created_at', { ascending: false }).limit(10);
  console.log(`\n── Alertas (${alerts?.length ?? 0}) ──`);
  for (const a of alerts ?? []) console.log(`  [${a.alert_type} · step ${a.step}] ${(a.description ?? '').slice(0, 300)}`);
}

main().catch(e => { console.error('🚨', e instanceof Error ? e.message : e); process.exit(1); });
