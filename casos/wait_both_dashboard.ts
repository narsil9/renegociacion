/**
 * Espera a que el job más reciente de CADA RUT (Néctor + Miguel) llegue a estado terminal.
 * Pensado para correr en background tras encolar ambos por el dashboard.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const RUTS = ['15.420.073-8', '26.625.555-1'];
const TERMINAL = ['success', 'failed', 'blocked', 'pending_review'];
const MAX_MS = 35 * 60 * 1000;

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const ids: Record<string, string> = {};
  for (const rut of RUTS) {
    const { data: c } = await sb.from('clients').select('id').eq('rut', rut).maybeSingle();
    if (c) ids[rut] = c.id;
  }
  const start = Date.now();
  const done: Record<string, string> = {};
  const lastProg: Record<string, string> = {};
  while (Date.now() - start < MAX_MS) {
    for (const rut of RUTS) {
      if (done[rut]) continue;
      const { data: job } = await sb.from('automation_jobs')
        .select('id,status,error_message,progress_message')
        .eq('client_id', ids[rut]).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!job) continue;
      const key = `${rut}:${job.progress_message}`;
      if (job.progress_message && lastProg[rut] !== key) { lastProg[rut] = key; console.log(`WAIT ${rut} [${job.status}] ${job.progress_message}`); }
      if (TERMINAL.includes(job.status)) {
        done[rut] = job.status;
        console.log(`WAIT_DONE ${rut} status=${job.status} job=${job.id}${job.error_message ? ' err=' + job.error_message : ''}`);
      }
    }
    if (Object.keys(done).length === RUTS.length) { console.log('\nWAIT_ALL_DONE ' + JSON.stringify(done)); process.exit(0); }
    await new Promise(r => setTimeout(r, 8000));
  }
  console.log('WAIT_TIMEOUT ' + JSON.stringify(done));
  process.exit(2);
}
main().catch(e => { console.log('WAIT_FATAL', e.message); process.exit(1); });
