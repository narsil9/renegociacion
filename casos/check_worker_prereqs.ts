/**
 * Verifica prerequisitos para correr el worker daemon con Cinthia.
 * Cancela el job duplicado si existe.
 * Uso: npx ts-node --transpile-only -r dotenv/config casos/check_worker_prereqs.ts
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const prodSb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Cancelar job duplicado creado accidentalmente
  const { error: cancelErr } = await sb.from('automation_jobs')
    .update({ status: 'failed', error_message: 'duplicado cancelado manualmente' })
    .eq('id', '1609ac3c-fad8-4df8-9219-ca951b28a66a');
  if (!cancelErr) console.log('✓ Job duplicado cancelado');

  // 1. Client en sandbox
  const { data: client, error: clientErr } = await sb.from('clients')
    .select('id,name,rut,airtable_id,informe_cmf_path,carpeta_tributaria_path,carpeta_retenedores_path')
    .eq('rut', '24.950.897-7').single();

  if (clientErr || !client) {
    console.error('❌ Cliente no encontrado en sandbox:', clientErr?.message);
    return;
  }
  console.log('\n✅ [SANDBOX] clients:');
  console.log('   id:', client.id);
  console.log('   airtable_id:', client.airtable_id);
  console.log('   CMF:', client.informe_cmf_path ?? '✗ FALTA');
  console.log('   CT:', client.carpeta_tributaria_path ?? '✗ FALTA');
  console.log('   Ret:', client.carpeta_retenedores_path ?? '✗ FALTA');

  // 2. Credenciales en PROD
  const { data: overrides, error: overridesErr } = await prodSb
    .from('renegociacion_overrides')
    .select('airtable_id, airtable_clave_unica, clave_cu_override')
    .eq('airtable_id', client.airtable_id)
    .maybeSingle();

  const hasCredential = !!(overrides?.airtable_clave_unica || overrides?.clave_cu_override);
  console.log('\n[PROD] renegociacion_overrides:');
  console.log('   found:', !!overrides);
  console.log('   hasClaveUnica:', hasCredential);
  if (overridesErr) console.log('   error:', overridesErr.message);

  // 3. client_documents
  const { data: docs } = await sb.from('client_documents')
    .select('id,document_type,filename,institucion_cmf')
    .eq('client_id', client.id);
  console.log('\n[SANDBOX] client_documents:', docs?.length ?? 0, 'docs');
  (docs ?? []).forEach((d: any) =>
    console.log('  •', d.filename, '->', d.institucion_cmf, `(tipo ${d.document_type})`)
  );

  // 4. Jobs pendientes
  const { data: jobs } = await sb.from('automation_jobs')
    .select('id,status,step,dry_run,created_at')
    .eq('client_id', client.id)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false });
  console.log('\n[SANDBOX] automation_jobs activos:', jobs?.length ?? 0);
  (jobs ?? []).forEach((j: any) =>
    console.log(`  • id=${j.id} step=${j.step} status=${j.status} dry_run=${j.dry_run}`)
  );

  console.log('\n---');
  const allGood = client.informe_cmf_path && client.carpeta_tributaria_path && hasCredential;
  console.log(allGood ? '✅ Todo listo para correr el worker.' : '❌ Faltan datos — ver arriba.');
}

main().catch(console.error);
