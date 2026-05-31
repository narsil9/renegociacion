import { Client } from 'pg';

const regions = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'sa-east-1',
  'ca-central-1',
];

async function run() {
  const projectRef = 'fnzdruyojclfannkwyqe';
  const password = '5jZtZvkUfKVWFp6l';
  
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const connectionString = `postgresql://postgres.${projectRef}:${password}@${host}:6543/postgres`;
    
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 3000,
    });
    
    try {
      await client.connect();
      console.log(`🎉 ¡CONECTADO CON ÉXITO a ${region}!`);
      await client.end();
      return;
    } catch (err: any) {
      console.log(`❌ Región ${region} falló: ${err.message.trim()}`);
    }
  }
}

run();
