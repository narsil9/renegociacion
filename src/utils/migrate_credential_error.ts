import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

async function run() {
  console.log('⏳ Intentando conectar a la base de datos de Sandbox...');
  
  if (!connectionString) {
    console.error('❌ Error: Falta DATABASE_URL en el archivo .env');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('127.0.0.1') || connectionString.includes('localhost') 
      ? false 
      : { rejectUnauthorized: true },
    connectionTimeoutMillis: 5000
  });

  try {
    await client.connect();
    console.log('✓ Conexión establecida con éxito.');
    
    console.log('⏳ Agregando columna "credential_error" a la tabla "clients"...');
    await client.query(`
      ALTER TABLE clients 
      ADD COLUMN IF NOT EXISTS credential_error TEXT;
    `);
    console.log('✓ Columna "credential_error" agregada con éxito a la tabla "clients".');
    
  } catch (err: any) {
    console.error('\n❌ No se pudo conectar directamente a Postgres por TCP/IP:', err.message || err);
    console.log('\n💡 ACCIÓN REQUERIDA:');
    console.log('Por favor, ejecuta la siguiente consulta en el SQL Editor de tu panel de Supabase:');
    console.log('\n   ALTER TABLE clients ADD COLUMN IF NOT EXISTS credential_error TEXT;\n');
  } finally {
    await client.end().catch(() => {});
  }
}

run();
