/**
 * Encola el job E2E de Cristian Mancilla: step 0 (Pasos 1→4), DRY_RUN=false (borrador vivo).
 * Limpia jobs activos previos del cliente para evitar choque con el índice único.
 *
 * Uso: npx ts-node -r dotenv/config casos/cristian_mancilla/enqueue.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const RUT = '16.587.870-1';

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, informe_cmf_path, carpeta_tributaria_path')
    .eq('rut', RUT)
    .maybeSingle();
  if (!client) { console.error('❌ Cliente no encontrado'); process.exit(1); }
  if (!client.informe_cmf_path || !client.carpeta_tributaria_path) {
    console.error('❌ Faltan CMF o CT'); process.exit(1);
  }

  // Limpiar jobs activos previos (pending/running) para re-correr limpio.
  await supabase.from('automation_jobs').delete()
    .eq('client_id', client.id).in('status', ['pending', 'running']);

  const { data: job, error } = await supabase
    .from('automation_jobs')
    .insert({ client_id: client.id, step: 0, status: 'pending', dry_run: false })
    .select('id, step, status, dry_run, created_at')
    .single();
  if (error || !job) { console.error(`❌ Error encolando: ${error?.message}`); process.exit(1); }

  console.log(`✅ Job encolado: id=${job.id} step=${job.step} dry_run=${job.dry_run} (cliente ${client.name})`);
}

main().catch(e => { console.error('🚨', e.message); process.exit(1); });
