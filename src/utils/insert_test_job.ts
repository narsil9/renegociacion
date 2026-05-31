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

async function insertTestJob() {
  const rut = process.env.CLAVE_UNICA_RUT;
  if (!rut) {
    console.error('❌ Error: Missing CLAVE_UNICA_RUT in .env');
    process.exit(1);
  }

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
    console.error(`Pista: Ejecuta primero: npx ts-node src/utils/insert_test_client.ts`);
    process.exit(1);
  }

  const clientId = clients[0].id;
  console.log(`✓ Cliente encontrado. ID: ${clientId}`);

  console.log('→ Insertando nuevo job pendiente en la cola "automation_jobs"...');
  const { data: jobs, error: jobError } = await supabase
    .from('automation_jobs')
    .insert({
      client_id: clientId,
      step: 1,
      status: 'pending',
    })
    .select();

  if (jobError) {
    console.error('❌ Error insertando job:', jobError.message);
  } else {
    console.log('🎉 Job insertado correctamente en Supabase!');
    console.log('Detalles del Job:');
    console.table(jobs);
    console.log('\n👉 Para iniciar el worker y procesar este job ejecuta:');
    console.log('   npm run automate -- --mode=worker');
  }
}

insertTestJob();
