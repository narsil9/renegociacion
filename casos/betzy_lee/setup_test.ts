/**
 * Crea (o actualiza) la fila de Betzy Laishan Lee Chio Zurita en la tabla sandbox `clients`
 * y sube su Carpeta Tributaria y Agentes Retenedores al bucket de Storage.
 *
 * Estrategia multi-cliente:
 *   - Cada cliente real usa su propio RUT como identificador único en la BD (26.199.806-8).
 *   - El portal (Superir) se abre con las credenciales de Pato Martini (.env),
 *     porque CLAVE_UNICA_RUT y CLAVE_UNICA_PASSWORD son del perfil de prueba disponible.
 *   - La fila en clients y los client_documents quedan completamente separados
 *     de los perfiles de Patricio Martini, Claudia Silva y Alejandra Espinoza por client_id (UUID distinto).
 *
 * ⚠️ CMF (informe_cmf_path): NO disponible todavía. Agregar el PDF del CMF en la carpeta
 *    y actualizar FILES.cmf cuando el abogado lo proporcione.
 *    Para probar solo Step 3: usa BYPASS_DATE_CHECK=true.
 *
 * Uso: npx ts-node -r dotenv/config casos/betzy_lee/setup_test.ts
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
const STORAGE_PREFIX = 'betzy_lee';

const BETZY_RUT = '26.199.806-8';
const CASE_DIR = path.resolve(__dirname);

const FILES = {
  carpeta_tributaria: {
    local: path.join(CASE_DIR, 'documentos', '03_Tributaria_y_SII', 'Carpeta Tributaria.pdf'),
    storagePath: `${STORAGE_PREFIX}/carpeta_tributaria.pdf`,
  },
  agentes_retenedores: {
    local: path.join(CASE_DIR, 'documentos', '03_Tributaria_y_SII', 'Agentes Retenedores.pdf'),
    storagePath: `${STORAGE_PREFIX}/agentes_retenedores.pdf`,
  },
  // cmf: {
  //   local: path.join(CASE_DIR, 'informe_cmf.pdf'),   // agregar cuando esté disponible
  //   storagePath: `${STORAGE_PREFIX}/informe_cmf.pdf`,
  // },
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
  console.log('🔧 Setup test Betzy Laishan Lee Chio Zurita (credenciales de portal: Pato Martini)\n');

  // 1. Upsert fila de Betzy en clients (conflict en rut → actualiza si ya existía)
  console.log(`⏳ Creando/actualizando fila en clients para RUT ${BETZY_RUT}...`);
  const { data: upserted, error: upsertErr } = await supabase
    .from('clients')
    .upsert(
      {
        rut: BETZY_RUT,
        name: 'Betzy Laishan Lee Chio Zurita',
        // Credenciales del portal: se usa el perfil de Pato Martini para poder probar
        clave_unica_rut: process.env.CLAVE_UNICA_RUT ?? '21917363-6',
        clave_unica_password: process.env.CLAVE_UNICA_PASSWORD ?? '',
      },
      { onConflict: 'rut' }
    )
    .select('id, rut, name')
    .single();

  if (upsertErr || !upserted) {
    console.error('❌ Error al crear/actualizar cliente:', upsertErr?.message);
    process.exit(1);
  }
  const clientId = upserted.id;
  console.log(`✓ Cliente: ${upserted.name} (id: ${clientId})`);

  // 2. Subir Carpeta Tributaria
  console.log('\n⏳ Subiendo Carpeta Tributaria...');
  await uploadFile(
    FILES.carpeta_tributaria.local,
    FILES.carpeta_tributaria.storagePath,
    'Carpeta Tributaria'
  );

  // 3. Subir Agentes Retenedores
  console.log('\n⏳ Subiendo Agentes Retenedores...');
  await uploadFile(
    FILES.agentes_retenedores.local,
    FILES.agentes_retenedores.storagePath,
    'Agentes Retenedores'
  );

  // 4. Actualizar paths en clients
  console.log('\n⏳ Actualizando paths en clients...');
  const { error: updateErr } = await supabase
    .from('clients')
    .update({
      carpeta_tributaria_path: FILES.carpeta_tributaria.storagePath,
      carpeta_retenedores_path: FILES.agentes_retenedores.storagePath,
      informe_cmf_path: null,          // pendiente: obtener CMF del abogado
      acreditacion_documentos_json: [],
    })
    .eq('rut', BETZY_RUT);

  if (updateErr) {
    console.error('❌ Error actualizando clients:', updateErr.message);
    process.exit(1);
  }
  console.log('✓ carpeta_tributaria_path y carpeta_retenedores_path actualizados.');
  console.log('⚠️  informe_cmf_path = null (pendiente).');

  // 5. Limpiar client_documents anteriores (si se re-ejecuta el script)
  console.log('\n⏳ Limpiando client_documents anteriores...');
  const { data: deleted, error: deleteErr } = await supabase
    .from('client_documents')
    .delete()
    .eq('client_id', clientId)
    .select('id, filename');

  if (deleteErr) {
    console.error('❌ Error eliminando client_documents:', deleteErr.message);
    process.exit(1);
  }
  if (deleted && deleted.length > 0) {
    console.log(`✓ ${deleted.length} registro(s) eliminado(s) de client_documents:`);
    deleted.forEach((d: { filename?: string; id: string }) => console.log(`   • ${d.filename ?? d.id}`));
  } else {
    console.log('✓ No había registros previos en client_documents.');
  }

  // 6. Resumen final
  console.log('\n📋 Estado final:');
  console.log(`  client_id:                ${clientId}`);
  console.log(`  rut BD:                   ${BETZY_RUT}`);
  console.log(`  clave_unica_rut:          ${process.env.CLAVE_UNICA_RUT} (Pato — portal de prueba)`);
  console.log(`  carpeta_tributaria_path:  ${FILES.carpeta_tributaria.storagePath}`);
  console.log(`  carpeta_retenedores_path: ${FILES.agentes_retenedores.storagePath}`);
  console.log(`  informe_cmf_path:         ⚠️  null (obtener CMF del abogado)`);
  console.log(`  storage_prefix:           ${STORAGE_PREFIX}/`);
  console.log(`  client_documents:         vacío (listo para upload_documents.ts)\n`);
  console.log('🎉 Listo. Cuando tengas el CMF, actualiza FILES.cmf y re-ejecuta.');
  console.log(`   CLIENT_ID="${clientId}"`);
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
