/**
 * Sube los documentos de Carlos Uribe a PRODUCCIÓN (PROD_SUPABASE_URL).
 * - Agentes retenedores → Storage + actualiza clients.carpeta_retenedores_path
 * - Todos los certificados → Storage + client_documents
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/carlos_uribe/upload_prod.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.PROD_SUPABASE_URL!,
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const BUCKET = 'documentos';
const CLIENT_RUT = '16.523.825-7';
const PREFIX = 'carlos_uribe';
const D = path.resolve(__dirname, 'documentos');

const CERTS = [
  { local: 'cert_internacional.pdf',      institucion_cmf: 'Internacional',    acreditacion_tipo: 'general'      },
  { local: 'cert_cmr_eecc_08_25.pdf',     institucion_cmf: 'CMR Falabella',    acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_cmr_eecc_09_25.pdf',     institucion_cmf: 'CMR Falabella',    acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_cmr_eecc_10_25.pdf',     institucion_cmf: 'CMR Falabella',    acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_cmr_eecc_11_25.pdf',     institucion_cmf: 'CMR Falabella',    acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_cmr_eecc_dic.pdf',       institucion_cmf: 'CMR Falabella',    acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_cmr_eecc_ene.pdf',       institucion_cmf: 'CMR Falabella',    acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_bancoestado_eecc_08_25.pdf', institucion_cmf: 'Banco Estado', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_bancoestado_eecc_09_25.pdf', institucion_cmf: 'Banco Estado', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_bancoestado_eecc_10_25.pdf', institucion_cmf: 'Banco Estado', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_bancoestado_eecc_11_25.pdf', institucion_cmf: 'Banco Estado', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_bancoestado_eecc_dic.pdf',   institucion_cmf: 'Banco Estado', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_bancoestado_gen.pdf',    institucion_cmf: 'Banco Estado',     acreditacion_tipo: 'general'      },
  { local: 'cert_bancoestado_lc.pdf',     institucion_cmf: 'Banco Estado',     acreditacion_tipo: 'general'      },
  { local: 'cert_santander_eecc_08_25.pdf', institucion_cmf: 'Santander-Chile', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_santander_eecc_09_25.pdf', institucion_cmf: 'Santander-Chile', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_santander_eecc_10_25.pdf', institucion_cmf: 'Santander-Chile', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_santander_eecc_11_25.pdf', institucion_cmf: 'Santander-Chile', acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_santander_eecc_dic.pdf', institucion_cmf: 'Santander-Chile',  acreditacion_tipo: 'estado_cuenta' },
  { local: 'cert_santander_lc.pdf',       institucion_cmf: 'Santander-Chile',  acreditacion_tipo: 'general'      },
  { local: 'cert_itau.pdf',               institucion_cmf: 'Banco Itaú Chile', acreditacion_tipo: 'general'      },
];

async function run() {
  console.log('🔧 Subiendo documentos de Carlos Uribe → PRODUCCIÓN\n');

  // 1. Obtener client_id de producción
  const { data: client, error: fetchErr } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', CLIENT_RUT)
    .single();

  if (fetchErr || !client) {
    console.error('❌ Cliente no encontrado en producción:', fetchErr?.message);
    process.exit(1);
  }
  console.log(`✓ Cliente: ${client.name} (id: ${client.id})\n`);

  // 2. Subir agentes_retenedores.pdf y actualizar clients
  console.log('📄 Subiendo agentes_retenedores.pdf...');
  const retPath = path.join(D, 'agentes_retenedores.pdf');
  const retStoragePath = `${PREFIX}/agentes_retenedores.pdf`;

  const { error: retUploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(retStoragePath, fs.readFileSync(retPath), { contentType: 'application/pdf', upsert: true });
  if (retUploadErr) { console.error('❌', retUploadErr.message); process.exit(1); }

  const { error: retUpdateErr } = await supabase
    .from('clients')
    .update({ carpeta_retenedores_path: retStoragePath })
    .eq('id', client.id);
  if (retUpdateErr) { console.error('❌', retUpdateErr.message); process.exit(1); }
  console.log(`  ✓ agentes_retenedores.pdf → clients.carpeta_retenedores_path\n`);

  // 3. Limpiar client_documents anteriores y subir certificados
  console.log('🗑️  Limpiando client_documents anteriores...');
  await supabase.from('client_documents').delete().eq('client_id', client.id);

  console.log('📄 Subiendo certificados...');
  for (const cert of CERTS) {
    const localPath = path.join(D, cert.local);
    if (!fs.existsSync(localPath)) {
      console.error(`❌ No encontrado: ${localPath}`);
      process.exit(1);
    }

    const storagePath = `${PREFIX}/${cert.local}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fs.readFileSync(localPath), { contentType: 'application/pdf', upsert: true });
    if (upErr) { console.error(`❌ Storage ${cert.local}:`, upErr.message); process.exit(1); }

    const { error: dbErr } = await supabase.from('client_documents').insert({
      client_id: client.id,
      filename: cert.local,
      storage_path: storagePath,
      document_type: 24,
      acreditacion_tipo: cert.acreditacion_tipo,
      institucion_cmf: cert.institucion_cmf,
      uploaded_at: new Date().toISOString(),
    });
    if (dbErr) { console.error(`❌ DB ${cert.local}:`, dbErr.message); process.exit(1); }

    console.log(`  ✓ ${cert.local} → ${cert.institucion_cmf}`);
  }

  console.log(`\n🎉 Listo. ${CERTS.length} certificados + retenedores subidos a producción.`);
  console.log('\nSiguiente paso: encolar el job en automation_jobs de producción y correr el worker.');
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
