/**
 * Sube los certificados de Cinthia Lisbet Rodríguez Vargas a Supabase Storage
 * y registra cada uno en client_documents.
 *
 * CMF (6 acreedores + 1 NO-CMF):
 *   Art. 260 — CAR - Ripley ($1.631.468), CAT ex-CENCOSUD ($6.553.197), CMR Falabella ($2.570.928)
 *   Art. 261 — Banco Estado ($723.724), PRESTO LIDER ($623.064), Solventa Tarjetas ($284.324)
 *   NO-CMF    — Fashion's Park / Inversiones Crediman S.A. ($98.716, Art.261)
 *
 * Uso (ejecutar DESPUÉS de setup_test.ts):
 *   npx ts-node -r dotenv/config casos/cinthia_rodriguez/upload_documents.ts
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

const BUCKET      = 'documentos';
const CLIENT_RUT  = '24.950.897-7';
const PREFIX      = 'cinthia_rodriguez';
const D           = path.resolve(__dirname, 'documentos');

const DOCS = [
  // ── CAR - Ripley (Art. 260 — tipo 24 monto+vencimiento) ──────────────────
  {
    local: path.join(D, 'CAR Ripley Cinthia.pdf'),
    storagePath: `${PREFIX}/CAR Ripley Cinthia.pdf`,
    filename: 'CAR Ripley Cinthia.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── CAT ex-CENCOSUD (Art. 260 — tipo 24) ─────────────────────────────────
  {
    local: path.join(D, 'cert_deuda_249508977_202510281424.pdf'),
    storagePath: `${PREFIX}/cert_deuda_249508977_202510281424.pdf`,
    filename: 'cert_deuda_249508977_202510281424.pdf',
    institucion_cmf: 'CAT (ex CENCOSUD)',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── CMR Falabella (Art. 260 — tipo 24) ───────────────────────────────────
  {
    local: path.join(D, 'Certificado de Deuda.pdf'),
    storagePath: `${PREFIX}/Certificado de Deuda.pdf`,
    filename: 'Certificado de Deuda.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── Banco Estado (Art. 261 — tipo 22 monto) — 2 docs ─────────────────────
  {
    local: path.join(D, '8480 Noviembre_.pdf'),
    storagePath: `${PREFIX}/8480 Noviembre_.pdf`,
    filename: '8480 Noviembre_.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  {
    local: path.join(D, 'LC Banco Estado.pdf'),
    storagePath: `${PREFIX}/LC Banco Estado.pdf`,
    filename: 'LC Banco Estado.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── PRESTO LIDER (Art. 261 — tipo 22) ────────────────────────────────────
  {
    local: path.join(D, '249508977 CERT (1).pdf'),
    storagePath: `${PREFIX}/249508977 CERT (1).pdf`,
    filename: '249508977 CERT (1).pdf',
    institucion_cmf: 'PRESTO LIDER',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Solventa Tarjetas (Art. 261 — tipo 22) ───────────────────────────────
  {
    local: path.join(D, 'Certificado de deuda cinthia.pdf'),
    storagePath: `${PREFIX}/Certificado de deuda cinthia.pdf`,
    filename: 'Certificado de deuda cinthia.pdf',
    institucion_cmf: 'Solventa Tarjetas',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Fashion's Park (NO-CMF Art.261 — tipo 22) ────────────────────────────
  // Inversiones Crediman S.A. / Inversiones Kimco S.A. en catálogo
  {
    local: path.join(D, 'document (6).pdf'),
    storagePath: `${PREFIX}/document (6).pdf`,
    filename: 'document (6).pdf',
    institucion_cmf: "Fashion's Park",
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
];

async function run() {
  console.log("🔧 Subiendo documentos de Cinthia Lisbet Rodríguez Vargas → client_documents\n");

  const { data: client, error: fetchErr } = await supabase
    .from('clients').select('id, name').eq('rut', CLIENT_RUT).single();

  if (fetchErr || !client) {
    console.error('❌ Perfil no encontrado (RUT', CLIENT_RUT, '). Corré primero setup_test.ts');
    process.exit(1);
  }
  console.log(`✓ Cliente: ${client.name} (client_id: ${client.id})\n`);

  const { error: deleteErr } = await supabase
    .from('client_documents').delete().eq('client_id', client.id);
  if (deleteErr) console.warn(`⚠️  No se limpiaron rows anteriores: ${deleteErr.message}`);
  else console.log('✓ Rows anteriores limpiadas\n');

  for (const doc of DOCS) {
    if (!fs.existsSync(doc.local)) {
      console.error(`❌ Archivo no encontrado: ${doc.local}`);
      process.exit(1);
    }

    const buffer = fs.readFileSync(doc.local);
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET).upload(doc.storagePath, buffer, { contentType: 'application/pdf', upsert: true });
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
  console.log('  BYPASS_DATE_CHECK=true BYPASS_RUT_CHECK=true \\');
  console.log('    npx ts-node --transpile-only -r dotenv/config casos/cinthia_rodriguez/test_full_chain.ts');
}

run().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
