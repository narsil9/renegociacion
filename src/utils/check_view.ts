import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkView() {
  console.log('📡 Consultando la vista v_automation_jobs_ordenada en Supabase...');
  const { data, error } = await supabase
    .from('v_automation_jobs_ordenada')
    .select('*')
    .limit(10);

  if (error) {
    console.error('❌ Error al consultar la vista:', error.message);
    process.exit(1);
  }

  console.log('\n📊 Datos devueltos por la vista v_automation_jobs_ordenada (Primeros 10):');
  console.table(
    data?.map((j) => ({
      ID: j.id,
      Paso: j.step,
      Estado: j.status,
      'Creado En': j.created_at,
    }))
  );
}

checkView();
