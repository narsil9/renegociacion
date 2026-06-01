import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { URL } from 'url';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const prodUrl = process.env.PROD_SUPABASE_URL;

if (!connectionString) {
  console.error('❌ Error: Missing DATABASE_URL in .env');
  process.exit(1);
}

async function run() {
  try {
    const targetHost = new URL(connectionString!).host;
    
    // Safety check against prod URL
    if (prodUrl) {
      const prodHost = new URL(prodUrl).host;
      const prodProjectRef = prodHost.split('.')[0];
      if (targetHost.includes(prodProjectRef)) {
        console.error(`🚫 Error: Refusing DDL. Target host '${targetHost}' matches production project ref '${prodProjectRef}'!`);
        process.exit(1);
      }
    }

    if (!process.argv.includes('--confirm')) {
      console.log(`⚠️  Warning: Dry-run check completed for host: ${targetHost}.`);
      console.log(`To run the DDL and create the tables, execute:`);
      console.log(`   npx ts-node src/utils/create_sandbox_tables.ts --confirm`);
      process.exit(0);
    }

    console.log(`⚡ Running DDL against SANDBOX host: ${targetHost}`);
    
    const client = new Client({ connectionString });
    await client.connect();

    // 1. Create pato_prueba_clients table
    console.log('⏳ Creating table pato_prueba_clients...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS pato_prueba_clients (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          airtable_id TEXT UNIQUE NOT NULL,
          rut TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          clave_unica_rut TEXT NOT NULL,
          nacionalidad TEXT,
          fecha_nacimiento TEXT,
          estado_civil TEXT,
          regimen_patrimonial TEXT,
          profesion_oficio TEXT,
          ocupacion TEXT,
          direccion TEXT,
          region TEXT,
          comuna TEXT,
          email TEXT,
          telefono_prefijo TEXT,
          telefono TEXT,
          missing_fields TEXT[] DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 2. Create pato_prueba_automation_jobs table
    console.log('⏳ Creating table pato_prueba_automation_jobs...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS pato_prueba_automation_jobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id UUID REFERENCES pato_prueba_clients(id) ON DELETE CASCADE,
          step INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed')),
          dry_run BOOLEAN NOT NULL DEFAULT true,
          error_log TEXT,
          screenshot_url TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 3. Enable RLS and create public policies (required for dashboard VITE_SUPABASE_ANON_KEY access)
    console.log('⏳ Enabling RLS and creating policies...');
    await client.query(`
      ALTER TABLE pato_prueba_clients ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "pato_prueba_clients service only" ON pato_prueba_clients;
      DROP POLICY IF EXISTS "Allow public access to pato_prueba_clients" ON pato_prueba_clients;
      CREATE POLICY "Allow public access to pato_prueba_clients" ON pato_prueba_clients FOR ALL TO public USING (true) WITH CHECK (true);

      ALTER TABLE pato_prueba_automation_jobs ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "pato_prueba_jobs service only" ON pato_prueba_automation_jobs;
      DROP POLICY IF EXISTS "Allow public access to pato_prueba_automation_jobs" ON pato_prueba_automation_jobs;
      CREATE POLICY "Allow public access to pato_prueba_automation_jobs" ON pato_prueba_automation_jobs FOR ALL TO public USING (true) WITH CHECK (true);
    `);

    // 4. Verify tables exist
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('pato_prueba_clients', 'pato_prueba_automation_jobs');
    `);

    console.log(`\n🎉 Success! Tables created:`, res.rows.map(r => r.table_name));

    await client.end();
  } catch (err: any) {
    console.error('🚨 DDL Execution failed:', err.message || err);
    process.exit(1);
  }
}

run();
