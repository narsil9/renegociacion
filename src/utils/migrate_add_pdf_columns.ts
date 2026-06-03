import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!connectionString || !supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Faltan credenciales en el .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('⏳ 1. Modificando tabla "clients" en Postgres...');
  
  const pgClient = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000
  });

  try {
    await pgClient.connect();
    console.log('✓ Conectado a Postgres.');
    
    // Add columns to clients table
    await pgClient.query(`
      ALTER TABLE clients 
      ADD COLUMN IF NOT EXISTS carpeta_tributaria_path TEXT,
      ADD COLUMN IF NOT EXISTS carpeta_retenedores_path TEXT;
    `);
    console.log('✓ Columnas carpeta_tributaria_path y carpeta_retenedores_path creadas/verificadas en la tabla "clients".');
    
    await pgClient.end();
  } catch (err: any) {
    console.error('❌ Error en Postgres:', err.message || err);
    pgClient.end().catch(() => {});
  }

  console.log('\n⏳ 2. Verificando / creando bucket "documentos" en Supabase Storage...');
  try {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) throw listError;

    const exists = buckets.some(b => b.id === 'documentos');
    if (!exists) {
      console.log('⏳ Creando bucket "documentos"...');
      const { error: createError } = await supabase.storage.createBucket('documentos', {
        public: true,
        allowedMimeTypes: ['application/pdf']
      });
      if (createError) throw createError;
      console.log('✓ Bucket "documentos" creado con éxito.');
    } else {
      console.log('✓ El bucket "documentos" ya existe.');
    }
  } catch (err: any) {
    console.error('❌ Error en Supabase Storage:', err.message || err);
  }

  console.log('\n🎉 Sincronización de esquema completada.');
}

run();
