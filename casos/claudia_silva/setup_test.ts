/**
 * Configura el perfil de Patricio Martini (RUT 21917363-6) para testear
 * el caso de Claudia Silva: sin mora 90+ días y sin umbral 80 UF.
 *
 * Cambios:
 *   - Sube el CMF de Claudia → patricio_martini/informe_cmf.pdf (upsert)
 *   - Sube la Carpeta Tributaria de Claudia → patricio_martini/carpeta_tributaria.pdf (upsert)
 *   - Agentes Retenedores de Patricio se mantienen intactos
 *   - Elimina todos los registros de client_documents del cliente
 *   - Limpia acreditacion_documentos_json a []
 *
 * Uso: npx ts-node -r dotenv/config casos/claudia_silva/setup_test.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const BUCKET = 'documentos';
const PATRICIO_RUT = '21917363-6';

const CLAUDIA_DIR = path.resolve(__dirname, 'documentos');

const FILES = {
  cmf: {
    local: path.join(CLAUDIA_DIR, 'informe_deudas_18810379-0 (2).pdf'),
    storagePath: 'patricio_martini/informe_cmf.pdf',
  },
  tributaria: {
    local: path.join(CLAUDIA_DIR, 'Sii', 'Carpeta Tributaria', 'CARPETA TRIBUTARIA CLAUDIA SILVA.pdf'),
    storagePath: 'patricio_martini/carpeta_tributaria.pdf',
  },
};

async function uploadFile(localPath: string, storagePath: string, label: string): Promise<void> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Archivo no encontrado: ${localPath}`);
  }
  const buffer = fs.readFileSync(localPath);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`Storage upload (${label}): ${error.message}`);
  console.log(`✓ ${label} subido → ${storagePath}`);
}

async function run() {
  console.log('🔧 Setup test Claudia Silva en perfil Patricio Martini\n');

  // 1. Fetch Patricio's client id
  const { data: client, error: fetchErr } = await supabase
    .from('clients')
    .select('id, rut, name, informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path')
    .eq('rut', PATRICIO_RUT)
    .single();

  if (fetchErr || !client) {
    console.error('❌ No se encontró el cliente con RUT', PATRICIO_RUT, fetchErr?.message);
    process.exit(1);
  }
  console.log(`✓ Cliente encontrado: ${client.name} (id: ${client.id})`);
  console.log(`  informe_cmf_path actual:        ${client.informe_cmf_path}`);
  console.log(`  carpeta_tributaria_path actual:  ${client.carpeta_tributaria_path}`);
  console.log(`  carpeta_retenedores_path actual: ${client.carpeta_retenedores_path} (sin cambio)\n`);

  // 2. Subir CMF de Claudia
  console.log('⏳ Subiendo CMF de Claudia...');
  await uploadFile(FILES.cmf.local, FILES.cmf.storagePath, 'CMF Claudia');

  // 3. Subir Carpeta Tributaria de Claudia
  console.log('⏳ Subiendo Carpeta Tributaria de Claudia...');
  await uploadFile(FILES.tributaria.local, FILES.tributaria.storagePath, 'Carpeta Tributaria Claudia');

  // 4. Actualizar paths en clients (CMF + tributaria; retenedores sin tocar)
  console.log('\n⏳ Actualizando paths en tabla clients...');
  const { error: updateErr } = await supabase
    .from('clients')
    .update({
      informe_cmf_path: FILES.cmf.storagePath,
      carpeta_tributaria_path: FILES.tributaria.storagePath,
      acreditacion_documentos_json: [],
    })
    .eq('rut', PATRICIO_RUT);

  if (updateErr) {
    console.error('❌ Error actualizando clients:', updateErr.message);
    process.exit(1);
  }
  console.log('✓ Tabla clients actualizada.');

  // 5. Eliminar todos los client_documents del cliente
  console.log('\n⏳ Eliminando client_documents existentes...');
  const { data: deleted, error: deleteErr } = await supabase
    .from('client_documents')
    .delete()
    .eq('client_id', client.id)
    .select('id, filename');

  if (deleteErr) {
    console.error('❌ Error eliminando client_documents:', deleteErr.message);
    process.exit(1);
  }
  if (deleted && deleted.length > 0) {
    console.log(`✓ ${deleted.length} registro(s) eliminado(s) de client_documents:`);
    deleted.forEach((d: any) => console.log(`   • ${d.filename ?? d.id}`));
  } else {
    console.log('✓ No había registros en client_documents (ya estaba limpio).');
  }

  // 6. Resumen final
  console.log('\n📋 Estado final del cliente:');
  console.log(`  informe_cmf_path:        ${FILES.cmf.storagePath}  ← CMF de Claudia Silva`);
  console.log(`  carpeta_tributaria_path:  ${FILES.tributaria.storagePath}  ← Carpeta Tributaria de Claudia Silva`);
  console.log(`  carpeta_retenedores_path: ${client.carpeta_retenedores_path}  ← Patricio Martini (sin cambio)`);
  console.log(`  acreditacion_documentos_json: []`);
  console.log(`  client_documents: vacío\n`);
  console.log('🎉 Listo. El worker usará los datos de Claudia para el CMF y la Carpeta Tributaria.');
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
