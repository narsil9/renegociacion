import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function queuePatoStep3Job() {
  const rut = process.env.CLAVE_UNICA_RUT || '21917363-6';
  
  console.log(`🤖 Buscando cliente con RUT: ${rut}...`);
  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('id')
    .eq('rut', rut)
    .limit(1);

  if (clientError) {
    console.error('❌ Error buscando cliente:', clientError.message);
    process.exit(1);
  }

  if (!clients || clients.length === 0) {
    console.error(`❌ Error: No se encontró ningún cliente con RUT ${rut} en la base de datos.`);
    process.exit(1);
  }

  const clientId = clients[0].id;
  console.log(`✓ Cliente encontrado. ID: ${clientId}`);

  // Delete existing jobs for this client
  console.log('→ Limpiando trabajos anteriores para este cliente...');
  await supabase
    .from('automation_jobs')
    .delete()
    .eq('client_id', clientId);

  console.log('→ Insertando nuevo job del Paso 3 en la cola "automation_jobs" (con Dry Run activado)...');
  const { data: jobs, error: jobError } = await supabase
    .from('automation_jobs')
    .insert({
      client_id: clientId,
      step: 3,
      status: 'pending',
      dry_run: true,
    })
    .select();

  if (jobError) {
    console.error('❌ Error insertando job:', jobError.message);
  } else {
    console.log('🎉 Job de Paso 3 insertado con éxito en Supabase!');
    console.log('Detalles del Job:');
    console.table(jobs);
    console.log('\n👉 Para iniciar el worker y procesar este job de prueba, ejecuta:');
    console.log('   BYPASS_DATE_VALIDATION=true npx ts-node src/worker.ts');
  }
}

queuePatoStep3Job();
