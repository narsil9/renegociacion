import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function run() {
  const projectRef = 'fnzdruyojclfannkwyqe';
  const password = '5jZtZvkUfKVWFp6l';
  const host = 'aws-0-sa-east-1.pooler.supabase.com';
  
  // Try both ports
  for (const port of [5432, 6543]) {
    const connectionString = `postgresql://postgres.${projectRef}:${password}@${host}:${port}/postgres`;
    console.log(`📡 Probando conexión pooler a ${host}:${port}...`);
    
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
    });
    
    try {
      await client.connect();
      console.log(`🎉 ¡CONECTADO CON ÉXITO a puerto ${port}!`);
      
      const res = await client.query(`
        SELECT 
          pr.pubname,
          schemaname,
          tablename
        FROM pg_publication_rel pr_rel
        JOIN pg_publication pr ON pr.oid = pr_rel.prpubid
        JOIN pg_class cl ON cl.oid = pr_rel.prrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        WHERE pr.pubname = 'supabase_realtime' AND cl.relname = 'automation_jobs';
      `);

      if (res.rows.length > 0) {
        console.log('✓ La tabla "automation_jobs" ya está agregada a la publicación "supabase_realtime".');
      } else {
        console.log('⚠️  La tabla "automation_jobs" NO está en la publicación "supabase_realtime". Realtime no funcionará.');
        console.log('→ Intentando agregar "automation_jobs" a "supabase_realtime"...');
        
        try {
          await client.query(`ALTER PUBLICATION supabase_realtime ADD TABLE automation_jobs;`);
          console.log('🎉 ¡Tabla "automation_jobs" agregada con éxito a "supabase_realtime"!');
        } catch (alterErr: any) {
          console.error('❌ Error al alterar la publicación:', alterErr.message);
        }
      }
      
      await client.end();
      return;
    } catch (err: any) {
      console.log(`❌ Puerto ${port} falló: ${err.message}`);
    }
  }
}

run();
