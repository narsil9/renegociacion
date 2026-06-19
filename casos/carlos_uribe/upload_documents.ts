/**
 * Sube los certificados de Carlos Robinson Uribe Ruiz a Supabase Storage
 * y registra cada uno en client_documents.
 *
 * CMF (5 acreedores):
 *   Art. 260 — Internacional ($1.301.652 en 90+d), CMR Falabella ($232.466 en 90+d)
 *   Art. 261 — Banco Estado, Santander-Chile, Banco Itaú Chile
 *
 * Uso (ejecutar DESPUÉS de setup_test.ts):
 *   npx ts-node -r dotenv/config casos/carlos_uribe/upload_documents.ts
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
const CLIENT_RUT = '16.523.825-7';
const PREFIX = 'carlos_uribe';
const D = path.resolve(__dirname, 'documentos');

const DOCS = [
  // ── Internacional (Art. 260 — 90+d: $1.301.652) ──────────────────────────
  {
    local: path.join(D, 'cert_internacional.pdf'),
    storagePath: `${PREFIX}/cert_internacional.pdf`,
    filename: 'cert_internacional.pdf',
    institucion_cmf: 'Internacional',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── CMR Falabella (Art. 260 — 90+d: $232.466) ────────────────────────────
  // Documentos emitidos por Banco Falabella (misma entidad en CMF como "CMR Falabella")
  {
    local: path.join(D, 'cert_cmr_eecc_08_25.pdf'),
    storagePath: `${PREFIX}/cert_cmr_eecc_08_25.pdf`,
    filename: 'cert_cmr_eecc_08_25.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_cmr_eecc_09_25.pdf'),
    storagePath: `${PREFIX}/cert_cmr_eecc_09_25.pdf`,
    filename: 'cert_cmr_eecc_09_25.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_cmr_eecc_10_25.pdf'),
    storagePath: `${PREFIX}/cert_cmr_eecc_10_25.pdf`,
    filename: 'cert_cmr_eecc_10_25.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_cmr_eecc_11_25.pdf'),
    storagePath: `${PREFIX}/cert_cmr_eecc_11_25.pdf`,
    filename: 'cert_cmr_eecc_11_25.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_cmr_eecc_dic.pdf'),
    storagePath: `${PREFIX}/cert_cmr_eecc_dic.pdf`,
    filename: 'cert_cmr_eecc_dic.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_cmr_eecc_ene.pdf'),
    storagePath: `${PREFIX}/cert_cmr_eecc_ene.pdf`,
    filename: 'cert_cmr_eecc_ene.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  // ── Banco Estado (Art. 261) ───────────────────────────────────────────────
  {
    local: path.join(D, 'cert_bancoestado_eecc_08_25.pdf'),
    storagePath: `${PREFIX}/cert_bancoestado_eecc_08_25.pdf`,
    filename: 'cert_bancoestado_eecc_08_25.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_bancoestado_eecc_09_25.pdf'),
    storagePath: `${PREFIX}/cert_bancoestado_eecc_09_25.pdf`,
    filename: 'cert_bancoestado_eecc_09_25.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_bancoestado_eecc_10_25.pdf'),
    storagePath: `${PREFIX}/cert_bancoestado_eecc_10_25.pdf`,
    filename: 'cert_bancoestado_eecc_10_25.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_bancoestado_eecc_11_25.pdf'),
    storagePath: `${PREFIX}/cert_bancoestado_eecc_11_25.pdf`,
    filename: 'cert_bancoestado_eecc_11_25.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_bancoestado_eecc_dic.pdf'),
    storagePath: `${PREFIX}/cert_bancoestado_eecc_dic.pdf`,
    filename: 'cert_bancoestado_eecc_dic.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_bancoestado_gen.pdf'),
    storagePath: `${PREFIX}/cert_bancoestado_gen.pdf`,
    filename: 'cert_bancoestado_gen.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  {
    local: path.join(D, 'cert_bancoestado_lc.pdf'),
    storagePath: `${PREFIX}/cert_bancoestado_lc.pdf`,
    filename: 'cert_bancoestado_lc.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── Santander-Chile (Art. 261) ────────────────────────────────────────────
  {
    local: path.join(D, 'cert_santander_eecc_08_25.pdf'),
    storagePath: `${PREFIX}/cert_santander_eecc_08_25.pdf`,
    filename: 'cert_santander_eecc_08_25.pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_santander_eecc_09_25.pdf'),
    storagePath: `${PREFIX}/cert_santander_eecc_09_25.pdf`,
    filename: 'cert_santander_eecc_09_25.pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_santander_eecc_10_25.pdf'),
    storagePath: `${PREFIX}/cert_santander_eecc_10_25.pdf`,
    filename: 'cert_santander_eecc_10_25.pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_santander_eecc_11_25.pdf'),
    storagePath: `${PREFIX}/cert_santander_eecc_11_25.pdf`,
    filename: 'cert_santander_eecc_11_25.pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_santander_eecc_dic.pdf'),
    storagePath: `${PREFIX}/cert_santander_eecc_dic.pdf`,
    filename: 'cert_santander_eecc_dic.pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(D, 'cert_santander_lc.pdf'),
    storagePath: `${PREFIX}/cert_santander_lc.pdf`,
    filename: 'cert_santander_lc.pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── Banco Itaú Chile (Art. 261) ───────────────────────────────────────────
  {
    local: path.join(D, 'cert_itau.pdf'),
    storagePath: `${PREFIX}/cert_itau.pdf`,
    filename: 'cert_itau.pdf',
    institucion_cmf: 'Banco Itaú Chile',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
];

async function run() {
  console.log('🔧 Subiendo documentos de Carlos Robinson Uribe Ruiz → client_documents\n');

  const { data: client, error: fetchErr } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', CLIENT_RUT)
    .single();

  if (fetchErr || !client) {
    console.error('❌ Perfil no encontrado (RUT', CLIENT_RUT, '). Corré primero setup_test.ts');
    process.exit(1);
  }
  console.log(`✓ Cliente: ${client.name} (client_id: ${client.id})\n`);

  const { error: deleteErr } = await supabase
    .from('client_documents')
    .delete()
    .eq('client_id', client.id);
  if (deleteErr) console.warn(`⚠️  No se limpiaron rows anteriores: ${deleteErr.message}`);
  else console.log('✓ Rows anteriores limpiadas\n');

  for (const doc of DOCS) {
    if (!fs.existsSync(doc.local)) {
      console.error(`❌ Archivo no encontrado: ${doc.local}`);
      process.exit(1);
    }

    const buffer = fs.readFileSync(doc.local);
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(doc.storagePath, buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadErr) {
      console.error(`❌ Storage upload ${doc.filename}:`, uploadErr.message);
      process.exit(1);
    }

    const { error: dbErr } = await supabase.from('client_documents').insert({
      client_id: client.id,
      filename: doc.filename,
      storage_path: doc.storagePath,
      document_type: doc.document_type,
      acreditacion_tipo: doc.acreditacion_tipo,
      institucion_cmf: doc.institucion_cmf,
      uploaded_at: new Date().toISOString(),
    });
    if (dbErr) {
      console.error(`❌ DB insert ${doc.filename}:`, dbErr.message);
      process.exit(1);
    }

    console.log(`  ✓ ${doc.filename} → ${doc.institucion_cmf} (tipo ${doc.document_type})`);
  }

  console.log(`\n🎉 ${DOCS.length} documentos subidos y registrados.`);
  console.log('\nSiguiente paso:');
  console.log('  BYPASS_DATE_CHECK=true BYPASS_RUT_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/carlos_uribe/test_full_chain.ts');
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
