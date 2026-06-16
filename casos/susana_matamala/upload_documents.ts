/**
 * Sube y registra los documentos de acreditación de Susana Valeria Matamala Fuica
 * en client_documents.
 *
 * Art. 260 — Banco de Chile (3 productos cubiertos por UN solo certificado Socofin):
 *   - EEDD_7616.pdf → Tipo 24 (Línea de Crédito op.34579 + Tarjeta op.01235 + Varios op.34849)
 *
 * Art. 260 — CMR Falabella:
 *   - Cmr susana 09-01.pdf → Tipo 24 (EECC enero 2026: monto $5.515.144 + venc. 25/08/2025)
 *
 * Art. 261 — CAT (ex CENCOSUD):
 *   - Estado de Cuenta Oct - Cencosud.pdf → Tipo 22 (monto $17.265.985)
 *
 * Art. 261 — CAR - Ripley:
 *   - Estado de Cuenta Nov - Ripley.pdf → Tipo 22 (monto $93.275)
 *
 * Uso: npx ts-node -r dotenv/config casos/susana_matamala/upload_documents.ts
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
const SUSANA_RUT = '16.983.419-9';
const STORAGE_PREFIX = 'susana_matamala';
const CASE_DIR = path.resolve(__dirname);

const ART260_BDC = path.join(CASE_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_de_Chile');
const ART260_CMR = path.join(CASE_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_Falabella');
const ART261_CAT = path.join(CASE_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'CAT_Cencosud');
const ART261_RIP = path.join(CASE_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Banco_Ripley');

const DOCS_TO_UPLOAD = [
  // ── Art. 260: Banco de Chile — un certificado Socofin cubre 3 operaciones ──
  // Operaciones: 34579 (Línea CTE), 01235 (Tarjeta), 34849 (Varios Deudores).
  // Tipo 24: acredita monto + vencimiento de los 3 productos.
  {
    local: path.join(ART260_BDC, 'EEDD_7616.pdf'),
    storagePath: `${STORAGE_PREFIX}/bch_eedd_socofin.pdf`,
    filename: 'EEDD_7616.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 24,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  // ── Art. 260: CMR Falabella — EECC enero 2026 ────────────────────────────
  // Tipo 24: acredita monto ($5.515.144) y vencimiento más antiguo (25/08/2025).
  {
    local: path.join(ART260_CMR, 'Cmr susana 09-01.pdf'),
    storagePath: `${STORAGE_PREFIX}/cmr_eecc_enero_2026.pdf`,
    filename: 'Cmr susana 09-01.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  // ── Art. 261: CAT (ex CENCOSUD) — EECC octubre 2025 ─────────────────────
  // Tipo 22: acredita monto ($17.265.985, repactación vigente al día).
  {
    local: path.join(ART261_CAT, 'Estado de Cuenta Oct - Cencosud.pdf'),
    storagePath: `${STORAGE_PREFIX}/cat_cencosud_eecc_octubre.pdf`,
    filename: 'Estado de Cuenta Oct - Cencosud.pdf',
    institucion_cmf: 'CAT (ex CENCOSUD)',
    document_type: 22,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  // ── Art. 261: CAR - Ripley — EECC noviembre 2025 ─────────────────────────
  // Tipo 22: acredita monto ($93.275, al día).
  {
    local: path.join(ART261_RIP, 'Estado de Cuenta Nov - Ripley.pdf'),
    storagePath: `${STORAGE_PREFIX}/car_ripley_eecc_noviembre.pdf`,
    filename: 'Estado de Cuenta Nov - Ripley.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 22,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
];

async function run() {
  console.log('🔧 Subiendo documentos de Susana Matamala en client_documents...\n');

  const { data: client, error: fetchErr } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', SUSANA_RUT)
    .single();

  if (fetchErr || !client) {
    console.error('❌ Cliente no encontrado. Corré primero setup_test.ts');
    process.exit(1);
  }
  console.log(`✓ Cliente: ${client.name} (client_id: ${client.id})`);
  const CLIENT_ID = client.id;

  // Limpiar registros anteriores (idempotente)
  const { data: deleted } = await supabase
    .from('client_documents')
    .delete()
    .eq('client_id', CLIENT_ID)
    .select('id, filename');
  if (deleted && deleted.length > 0) {
    console.log(`🧹 ${deleted.length} registro(s) anteriores eliminados.\n`);
  }

  for (const doc of DOCS_TO_UPLOAD) {
    if (!fs.existsSync(doc.local)) {
      console.error(`❌ Archivo no encontrado: ${doc.local}`);
      process.exit(1);
    }
    const buffer = fs.readFileSync(doc.local);

    console.log(`⏳ Subiendo: ${doc.filename}...`);
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(doc.storagePath, buffer, { contentType: doc.contentType, upsert: true });
    if (uploadErr) { console.error('❌', uploadErr.message); process.exit(1); }
    console.log(`   ✓ Storage: ${doc.storagePath}`);

    const { error: dbErr } = await supabase
      .from('client_documents')
      .insert({
        client_id: CLIENT_ID,
        filename: doc.filename,
        storage_path: doc.storagePath,
        document_type: doc.document_type,
        acreditacion_tipo: doc.acreditacion_tipo,
        institucion_cmf: doc.institucion_cmf,
        uploaded_at: new Date().toISOString(),
      });
    if (dbErr) { console.error('❌ DB:', dbErr.message); process.exit(1); }
    console.log(`   ✓ DB: tipo ${doc.document_type} / ${doc.institucion_cmf}\n`);
  }

  console.log('🎉 Documentos de Susana registrados.');
  console.log('   Art. 260: Banco de Chile (3 ops. en 1 cert.) + CMR Falabella');
  console.log('   Art. 261: CAT Cencosud + CAR Ripley');
}

run().catch(err => { console.error('🚨', err.message); process.exit(1); });
