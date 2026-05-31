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

async function checkStatus() {
  const { data: jobs, error } = await supabase
    .from('automation_jobs')
    .select('*, clients(*)')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error fetching jobs:', error.message);
    process.exit(1);
  }

  console.log('\n📡 Ultimos 5 Trabajos en la Cola:');
  console.table(
    jobs?.map((j) => ({
      ID: j.id,
      RUT: j.clients?.rut,
      Paso: j.step,
      Estado: j.status,
      Screenshot: j.screenshot_url ? 'SI (Disponible)' : 'NO',
      'Actualizado En': j.updated_at,
    }))
  );

  // If the latest job is failed, print the error log
  if (jobs && jobs.length > 0 && jobs[0].status === 'failed') {
    console.log('\n❌ DETALLE DEL ERROR (Último Trabajo Fallido):');
    console.log('======================================================');
    console.log(jobs[0].error_log);
    console.log('======================================================');
    console.log(`URL Captura: ${jobs[0].screenshot_url}`);
  }
}

checkStatus();
