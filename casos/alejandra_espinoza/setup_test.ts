/**
 * Crea (o actualiza) la fila de Alejandra Espinoza en la tabla sandbox `clients`
 * y sube su CMF al bucket de Storage.
 *
 * Estrategia multi-cliente:
 *   - Cada cliente real usa su propio RUT como identificador único en la BD (18.738.680-2).
 *   - El portal (Superir) se abre con las credenciales de Pato Martini (.env),
 *     porque CLAVE_UNICA_RUT y CLAVE_UNICA_PASSWORD son del perfil de prueba disponible.
 *   - La fila en clients y los client_documents quedan completamente separados
 *     del perfil de Patricio Martini y de Claudia Silva por client_id (UUID distinto).
 *
 * Documentos de Alejandra (Art. 260): CAT ex-Cencosud + CMR Falabella.
 * Mora visible directamente en CMF → no requiere reclasificación Sentinel.
 *
 * ⚠️ Carpeta tributaria: NO disponible. Obtener de SII antes de probar Steps 1→4 completos.
 *    Para probar solo Step 3: corré test_step3.ts con BYPASS_DATE_CHECK=true.
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

const ALEJANDRA_RUT = '18.738.680-2';
const DOCS_DIR = path.resolve(__dirname, 'documentos');

const FILES = {
  cmf: {
    local: path.join(DOCS_DIR, '02_Informe_CMF', 'informe_deudas_18738680-2 (5).pdf'),
    storagePath: `${STORAGE_PREFIX}/informe_cmf.pdf`,
  },
  // carpeta_tributaria: no disponible. Agregar aquí cuando el abogado la proporcione.
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
  console.log('🔧 Setup test Alejandra Espinoza (credenciales de portal: Pato Martini)\n');

  // 1. Upsert fila de Alejandra en clients (conflict en rut → actualiza si ya existía)
  console.log(`⏳ Creando/actualizando fila en clients para RUT ${ALEJANDRA_RUT}...`);
  const { data: upserted, error: upsertErr } = await supabase
    .from('clients')
    .upsert(
      {
        rut: ALEJANDRA_RUT,
        name: 'Alejandra Belén Espinoza Díaz',
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

  // 2. Subir CMF de Alejandra
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
    console.log(`✓ ${deleted.length} registro(s) eliminado(s) de client_documents:`);
    deleted.forEach((d: { filename?: string; id: string }) => console.log(`   • ${d.filename ?? d.id}`));
  } else {
    console.log('✓ No había registros previos en client_documents.');
  }

  // 5. Resumen final
  console.log('\n📋 Estado final:');
  console.log(`  client_id:               ${clientId}`);
  console.log(`  rut BD:                  ${ALEJANDRA_RUT}`);
  console.log(`  clave_unica_rut:         ${process.env.CLAVE_UNICA_RUT} (Pato — portal de prueba)`);
  console.log(`  informe_cmf_path:        ${FILES.cmf.storagePath}`);
  console.log(`  carpeta_tributaria_path: ⚠️  null (obtener de SII)`);
  console.log(`  storage_prefix:          ${STORAGE_PREFIX}/`);
  console.log(`  client_documents:        vacío (listo para upload_documents.ts)\n`);
  console.log('🎉 Listo. Ahora corré upload_documents.ts para registrar los certificados.');
  console.log(`   CLIENT_ID="${clientId}"`);
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
