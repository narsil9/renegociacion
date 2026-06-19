/**
 * Encola un job en automation_jobs para probar el worker daemon.
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/enqueue_worker_test.ts [RUT]
 *
 * Ejemplo:
 *   npx ts-node -r dotenv/config casos/enqueue_worker_test.ts 24.950.897-7
 *
 * Después de encolar, correr en otra terminal:
 *   BYPASS_DATE_CHECK=true npm run worker
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  const targetRut = process.argv[2] || '24.950.897-7'; // Cinthia por defecto

  console.log(`\n🔍 Buscando cliente con RUT ${targetRut}...`);

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, rut, informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path')
    .eq('rut', targetRut)
    .maybeSingle();

  if (error || !client) {
    console.error(`❌ Cliente no encontrado: ${error?.message ?? 'sin resultado'}`);
    process.exit(1);
  }

  console.log(`✓ Cliente: ${client.name} (${client.rut})`);
  console.log(`  CMF:  ${client.informe_cmf_path ?? '✗ FALTA'}`);
  console.log(`  CT:   ${client.carpeta_tributaria_path ?? '✗ FALTA'}`);
  console.log(`  Ret:  ${client.carpeta_retenedores_path ?? '✗ FALTA'}`);

  if (!client.informe_cmf_path || !client.carpeta_tributaria_path) {
    console.error('❌ Faltan documentos obligatorios (CMF o CT). Abortando.');
    process.exit(1);
  }

  // Verificar que no haya un job pending/running ya para este cliente
  const { data: existingJobs } = await supabase
    .from('automation_jobs')
    .select('id, status, step')
    .eq('client_id', client.id)
    .in('status', ['pending', 'running']);

  if (existingJobs && existingJobs.length > 0) {
    console.warn(`⚠️  Ya hay ${existingJobs.length} job(s) pending/running para este cliente:`);
    for (const j of existingJobs) console.warn(`   → id=${j.id} step=${j.step} status=${j.status}`);
    console.warn('   Continuando de todas formas...');
  }

  // Encolar step 0 (todos los pasos: 1→2→3→4), DRY_RUN=true
  const { data: job, error: insertError } = await supabase
    .from('automation_jobs')
    .insert({
      client_id: client.id,
      step: 0,
      status: 'pending',
      dry_run: true,
    })
    .select('id, step, status, dry_run, created_at')
    .single();

  if (insertError || !job) {
    console.error(`❌ Error encolando job: ${insertError?.message ?? 'insert vacío'}`);
    process.exit(1);
  }

  console.log(`\n✅ Job encolado exitosamente:`);
  console.log(`   id:      ${job.id}`);
  console.log(`   step:    ${job.step} (todos los pasos)`);
  console.log(`   status:  ${job.status}`);
  console.log(`   dry_run: ${job.dry_run}`);
  console.log(`   created: ${job.created_at}`);
  console.log(`\n▶️  Para procesarlo, correr en otra terminal:`);
  console.log(`   BYPASS_DATE_CHECK=true npm run worker`);
}

main().catch((err) => {
  console.error('🚨', err.message);
  process.exit(1);
});
