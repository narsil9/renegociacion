/**
 * Crea (o actualiza) la fila de Alejandra Espinoza en la tabla sandbox `clients`
 * y sube su CMF al bucket de Storage.
 *
 * Estrategia multi-cliente:
 *   - Cada cliente real usa su propio RUT como identificador único en la BD.
 *   - El portal (Superir) siempre se abre con las credenciales de Pato Martini (.env),
 *     porque CLAVE_UNICA_RUT y CLAVE_UNICA_PASSWORD son del perfil de prueba.
 *   - La fila en clients y los client_documents quedan completamente separados
 *     del perfil de Claudia Silva por client_id (UUID distinto).
 *
 * Uso: npx ts-node -r dotenv/config casos/alejandra_espinoza/setup_test.ts
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
const STORAGE_PREFIX = 'pato_alejandra';

// RUT real de Alejandra → identificador único de su fila en la BD sandbox
const ALEJANDRA_RUT = '18.738.680-2';
const DOCS_DIR = path.resolve(__dirname, 'documentos');

const FILES = {
  cmf: {
    local: path.join(DOCS_DIR, 'informe_deudas_18738680-2 (5).pdf'),
    storagePath: `${STORAGE_PREFIX}/informe_cmf.pdf`,
  },
  // Carpeta tributaria: agregar aquí cuando esté disponible
  // tributaria: {
  //   local: path.join(DOCS_DIR, 'Sii', 'Carpeta Tributaria', '...pdf'),
  //   storagePath: `${STORAGE_PREFIX}/carpeta_tributaria.pdf`,
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
  console.log('🔧 Setup test Alejandra Espinoza (perfil de portal: Pato Martini)\n');

  // 1. Upsert fila de Alejandra en clients
  // ON CONFLICT en rut → actualiza si ya existía
  console.log(`⏳ Creando/actualizando fila en clients para RUT ${ALEJANDRA_RUT}...`);
  const { data: upserted, error: upsertErr } = await supabase
    .from('clients')
    .upsert(
      {
        rut: ALEJANDRA_RUT,
        name: 'Alejandra Belén Espinoza Díaz',
        clave_unica_rut: process.env.CLAVE_UNICA_RUT ?? '21917363-6',
        clave_unica_password: process.env.CLAVE_UNICA_PASSWORD ?? '',
        // Datos personales: completar cuando se configure el portal Step 1
        // nacionalidad, fecha_nacimiento, estado_civil, etc.
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

  // 2. Subir CMF
  console.log('\n⏳ Subiendo CMF de Alejandra...');
  await uploadFile(FILES.cmf.local, FILES.cmf.storagePath, 'CMF Alejandra');

  // 3. Actualizar informe_cmf_path en clients
  console.log('\n⏳ Actualizando informe_cmf_path en clients...');
  const { error: updateErr } = await supabase
    .from('clients')
    .update({
      informe_cmf_path: FILES.cmf.storagePath,
      acreditacion_documentos_json: [],
    })
    .eq('rut', ALEJANDRA_RUT);

  if (updateErr) {
    console.error('❌ Error actualizando clients:', updateErr.message);
    process.exit(1);
  }
  console.log('✓ informe_cmf_path actualizado.');

  // 4. Limpiar client_documents anteriores (si se re-ejecuta el script)
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
    console.log(`✓ ${deleted.length} registro(s) eliminado(s) de client_documents.`);
  } else {
    console.log('✓ No había registros previos en client_documents.');
  }

  // 5. Resumen final
  console.log('\n📋 Estado final:');
  console.log(`  client_id:         ${clientId}`);
  console.log(`  rut BD:            ${ALEJANDRA_RUT}`);
  console.log(`  clave_unica_rut:   ${process.env.CLAVE_UNICA_RUT} (Pato — portal de prueba)`);
  console.log(`  informe_cmf_path:  ${FILES.cmf.storagePath}`);
  console.log(`  storage_prefix:    ${STORAGE_PREFIX}/`);
  console.log(`  client_documents:  vacío (listo para upload_documents.ts)\n`);
  console.log('🎉 Listo. Ahora corré upload_documents.ts para cargar los certificados.');
  console.log(`   Guardá el client_id: ${clientId}`);
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
