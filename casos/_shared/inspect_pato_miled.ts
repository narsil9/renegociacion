import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const prod = createClient(
  process.env.PROD_SUPABASE_URL!,
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  // --- 1. Buscar ambos clientes ---
  const { data: pato } = await prod
    .from('v_casos_renegociacion')
    .select('airtable_id,rut,nombre,email,estado')
    .ilike('nombre', '%patricio%');
  console.log('\n=== Patricio ===');
  console.log(JSON.stringify(pato, null, 2));

  const { data: miled } = await prod
    .from('v_casos_renegociacion')
    .select('airtable_id,rut,nombre,email,estado')
    .ilike('nombre', '%miled%');
  console.log('\n=== Miled ===');
  console.log(JSON.stringify(miled, null, 2));

  const clientes = [...(pato ?? []), ...(miled ?? [])];
  if (clientes.length === 0) { console.log('No se encontraron clientes.'); return; }

  // --- 2. Para cada cliente: overrides + cmf_informes ---
  for (const c of clientes) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`▶ ${c.nombre} | RUT: ${c.rut} | ID: ${c.airtable_id}`);

    // Overrides — primero traemos todas las columnas disponibles
    const { data: ovr, error: oe } = await prod
      .from('renegociacion_overrides')
      .select('*')
      .eq('airtable_id', c.airtable_id)
      .single();

    if (oe) {
      console.log('  overrides error:', oe.message);
    } else if (ovr) {
      console.log('\n  [renegociacion_overrides] columnas disponibles:');
      const cols = Object.keys(ovr);
      console.log(' ', cols.join(', '));

      // Mostrar columnas relevantes a CMF y acreditaciones
      const cmfCols = cols.filter(k => k.includes('cmf') || k.includes('acred') || k.includes('doc') || k.includes('cert'));
      for (const col of cmfCols) {
        const val = ovr[col];
        if (val !== null && val !== undefined) {
          const display = typeof val === 'object' ? JSON.stringify(val).substring(0, 400) : String(val).substring(0, 200);
          console.log(`\n  ${col}:\n    ${display}`);
        } else {
          console.log(`  ${col}: NULL`);
        }
      }
    }

    // CMF Informes
    const { data: cmfs, error: ce } = await prod
      .from('cmf_informes')
      .select('*')
      .eq('case_airtable_id', c.airtable_id);

    console.log('\n  [cmf_informes]:');
    if (ce) console.log('  error:', ce.message);
    else console.log(JSON.stringify(cmfs, null, 2));
  }

  // --- 3. Storage: buckets y archivos ---
  console.log('\n=== STORAGE BUCKETS ===');
  const { data: buckets } = await prod.storage.listBuckets();
  console.log(buckets?.map(b => `${b.name} (public: ${b.public})`).join('\n'));

  // Listar contenido de informes-cmf
  for (const bucket of ['informes-cmf', 'expedientes-sii', 'audit-attachments', 'airtable-raw-attachments']) {
    console.log(`\n--- Bucket: ${bucket} ---`);
    const { data: files, error: fe } = await prod.storage.from(bucket).list('', { limit: 50 });
    if (fe) { console.log('  error:', fe.message); continue; }
    console.log(`  ${files?.length ?? 0} items en raíz:`, files?.map(f => f.name).join(', '));
  }

  // Buscar archivos del cliente Patricio en informes-cmf por su airtable_id
  const patricio = clientes.find(c => c.nombre?.toLowerCase().includes('patricio'));
  if (patricio) {
    console.log(`\n--- informes-cmf folder: ${patricio.airtable_id} ---`);
    const { data: pFiles } = await prod.storage.from('informes-cmf').list(patricio.airtable_id, { limit: 50 });
    console.log(JSON.stringify(pFiles?.map(f => ({ name: f.name, size: f.metadata?.size })), null, 2));
  }
}

main().catch(console.error);
