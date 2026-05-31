import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load local .env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyAndSetup() {
  console.log('🤖 Iniciando verificación y configuración de Supabase...');

  // 1. Verificar Tabla 'clients'
  const { data: clientsData, error: clientsError } = await supabase
    .from('clients')
    .select('id')
    .limit(1);

  if (clientsError) {
    console.error('❌ Error verificando tabla "clients":', clientsError.message);
  } else {
    console.log('✓ Tabla "clients" verificada con éxito.');
  }

  // 2. Verificar Tabla 'automation_jobs'
  const { data: jobsData, error: jobsError } = await supabase
    .from('automation_jobs')
    .select('id')
    .limit(1);

  if (jobsError) {
    console.error('❌ Error verificando tabla "automation_jobs":', jobsError.message);
  } else {
    console.log('✓ Tabla "automation_jobs" verificada con éxito.');
  }

  // 3. Verificar y Crear Storage Bucket 'screenshots'
  console.log('→ Buscando storage bucket "screenshots"...');
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();

  if (bucketsError) {
    console.error('❌ Error al obtener buckets:', bucketsError.message);
    process.exit(1);
  }

  const screenshotBucket = buckets.find((b) => b.id === 'screenshots');

  if (screenshotBucket) {
    console.log('✓ Storage bucket "screenshots" ya existe.');
  } else {
    console.log('→ Creando storage bucket "screenshots" público...');
    const { data: newBucket, error: createError } = await supabase.storage.createBucket('screenshots', {
      public: true,
      allowedMimeTypes: ['image/png', 'image/jpeg'],
    });

    if (createError) {
      console.error('❌ Error creando storage bucket:', createError.message);
    } else {
      console.log('✓ Storage bucket "screenshots" creado con éxito y configurado como público.');
    }
  }

  console.log('\n🎉 Configuración completada correctamente.\n');
}

verifyAndSetup();
