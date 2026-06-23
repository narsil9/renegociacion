/**
 * Poll-ea el último job de Cristian Mancilla hasta estado terminal y sale.
 * Imprime status + error_message + progreso. Pensado para correr en background:
 * al salir, re-invoca el loop.
 *
 * Uso: npx ts-node -r dotenv/config casos/cristian_mancilla/wait_job.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const RUT = process.env.CASE_RUT || '16.587.870-1';
const TERMINAL = ['success', 'failed', 'blocked', 'pending_review'];
const MAX_MS = 20 * 60 * 1000;

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: client } = await supabase.from('clients').select('id').eq('rut', RUT).maybeSingle();
  if (!client) { console.log('WAIT: cliente no encontrado'); process.exit(1); }

  const start = Date.now();
  let lastProgress = '';
  while (Date.now() - start < MAX_MS) {
    const { data: job } = await supabase
      .from('automation_jobs')
      .select('id, status, error_message, progress_message, updated_at')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (job) {
      if (job.progress_message && job.progress_message !== lastProgress) {
        lastProgress = job.progress_message;
        console.log(`WAIT: [${job.status}] ${job.progress_message}`);
      }
      if (TERMINAL.includes(job.status)) {
        console.log(`\nWAIT_DONE status=${job.status} job=${job.id}`);
        if (job.error_message) console.log(`WAIT_ERR: ${job.error_message}`);
        process.exit(0);
      }
    }
    await new Promise(r => setTimeout(r, 8000));
  }
  console.log('WAIT_TIMEOUT: el job no llegó a estado terminal en 20 min');
  process.exit(2);
}
main().catch(e => { console.log('WAIT_FATAL', e.message); process.exit(1); });
