import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const prod = createClient(
  process.env.PROD_SUPABASE_URL!,
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  // Buscar por apellido exacto
  const { data: martini } = await prod
    .from('v_casos_renegociacion')
    .select('airtable_id,rut,nombre,email,estado')
    .ilike('nombre', '%martini%');
  console.log('\n=== Martini ===');
  console.log(JSON.stringify(martini, null, 2));

  const { data: gassibe } = await prod
    .from('v_casos_renegociacion')
    .select('airtable_id,rut,nombre,email,estado')
    .ilike('nombre', '%gassibe%');
  console.log('\n=== Gassibe ===');
  console.log(JSON.stringify(gassibe, null, 2));

  const clientes = [...(martini ?? []), ...(gassibe ?? [])];
  if (clientes.length === 0) { console.log('No encontrados.'); return; }

  for (const c of clientes) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`▶ ${c.nombre} | RUT: ${c.rut} | ID: ${c.airtable_id}`);

    // CMF Informes
    const { data: cmfs, error: ce } = await prod
      .from('cmf_informes')
      .select('id, filename, storage_path, fecha_emision_pdf, pdf_size_bytes, pdf_extract_error')
      .eq('case_airtable_id', c.airtable_id);
    console.log('\n  [cmf_informes]:');
    if (ce) console.log('  error:', ce.message);
    else console.log(JSON.stringify(cmfs, null, 2));

    // Overrides — columnas relevantes
    const { data: ovr, error: oe } = await prod
      .from('renegociacion_overrides')
      .select('*')
      .eq('airtable_id', c.airtable_id)
      .single();
    if (oe) { console.log('  overrides error:', oe.message); continue; }
    if (!ovr) { console.log('  Sin override.'); continue; }

    // Listar todas las columnas del override con valores no nulos
    console.log('\n  [renegociacion_overrides] — columnas con valor:');
    for (const [k, v] of Object.entries(ovr)) {
      if (v === null || v === undefined) continue;
      const display = typeof v === 'object' ? JSON.stringify(v).substring(0, 300) : String(v).substring(0, 150);
      console.log(`    ${k}: ${display}`);
    }

    // Columnas nulas (igual útil para saber el schema)
    const nullCols = Object.entries(ovr).filter(([,v]) => v === null).map(([k]) => k);
    console.log(`  Columnas NULL: ${nullCols.join(', ')}`);
  }

  // Storage: explorar informes-cmf y expedientes-sii
  console.log('\n\n=== STORAGE: informes-cmf ===');
  const { data: cmfRoot } = await prod.storage.from('informes-cmf').list('', { limit: 100 });
  console.log('Carpetas/archivos raíz:', cmfRoot?.map(f => f.name).join(', '));

  for (const c of clientes) {
    console.log(`\n  Carpeta ${c.airtable_id} (${c.nombre}):`);
    const { data: files } = await prod.storage.from('informes-cmf').list(c.airtable_id, { limit: 50 });
    if (!files || files.length === 0) { console.log('    (vacía o no existe)'); continue; }
    for (const f of files) {
      console.log(`    ${f.name} — ${f.metadata?.size ?? '?'} bytes`);
    }
  }

  console.log('\n=== STORAGE: expedientes-sii (primeros 20) ===');
  const { data: siiRoot } = await prod.storage.from('expedientes-sii').list('', { limit: 20 });
  console.log(siiRoot?.map(f => f.name).join(', '));
}

main().catch(console.error);
