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

async function insertMiledStep1() {
  const rut = '20285122-3';

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

  // Delete existing jobs for this client to start clean
  console.log('→ Limpiando trabajos anteriores de la cola para este cliente...');
  await supabase
    .from('automation_jobs')
    .delete()
    .eq('client_id', clientId);

  console.log('→ Insertando nuevo job del Paso 1 en la cola "automation_jobs" (con DRY_RUN = false)...');
  const { data: jobs, error: jobError } = await supabase
    .from('automation_jobs')
    .insert({
      client_id: clientId,
      step: 1,
      status: 'pending',
      dry_run: false, // Save Step 1 draft to allow Step 2 access
    })
    .select();

  if (jobError) {
    console.error('❌ Error insertando job:', jobError.message);
  } else {
    console.log('🎉 Job de Paso 1 para Miled insertado correctamente en Supabase!');
    console.table(jobs);
  }
}

insertMiledStep1();
