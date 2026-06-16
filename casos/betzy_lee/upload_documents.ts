/**
 * Sube y registra los documentos de acreditación de Betzy Laishan Lee Chio Zurita
 * en client_documents. También sube el CMF y actualiza informe_cmf_path.
 *
 * ⚠️  CASO SENTINEL: Ambos productos de Banco de Chile tienen $0 mora en el CMF
 * (corte 17/10/2025). Los certificados de noviembre 2025 acreditan ≥91 días reales.
 * El Sentinel deberá reclasificarlos de Art. 261 → Art. 260 antes del Paso 3.
 *
 * Mapeo según analisis_deudas.md (Sección V):
 *
 *  CMF (actualización):
 *    - 02_Informe_CMF/informe_deudas_26199806-8.pdf → informe_cmf_path
 *
 *  Art. 260 — Banco de Chile (Crédito de Consumo):
 *    - informeCredito.pdf   → Tipo 22 (acredita MONTO $18.191.754)
 *    - 4_8_banco_chile_vencimiento_cuota_20.png → Tipo 23 (acredita VENCIMIENTO 04/08/2025)
 *
 *  Art. 260 — Banco de Chile (Tarjeta de Crédito Visa):
 *    - Estado de deudas banco de chile socofin.pdf → Tipo 24 (acredita MONTO $3.716.235 y VENCIMIENTO 07/08/2025)
 *
 *  Art. 261 — CAT (ex CENCOSUD):
 *    - certificado de deuda cencosud .jpg → Tipo 22 (acredita MONTO $9.262.634)
 *
 *  Art. 261 — CMR Falabella:
 *    - certificado-deuda cmr.pdf → Tipo 22 (acredita MONTO $1.173.246)
 *
 *  Art. 261 — PRESTO LIDER (Lider Bci):
 *    - certificado de deuda líder bci .jpg → Tipo 22 (acredita MONTO $682.194)
 *
 * Uso: npx ts-node -r dotenv/config casos/betzy_lee/upload_documents.ts
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
const BETZY_RUT = '26.199.806-8';
const STORAGE_PREFIX = 'betzy_lee';
const CASE_DIR = path.resolve(__dirname);

const ART260_DIR = path.join(CASE_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_de_Chile');
const CAT_DIR    = path.join(CASE_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'CAT_Cencosud');
const CMR_DIR    = path.join(CASE_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'CMR_Falabella');
const LIDER_DIR  = path.join(CASE_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Presto_Lider');

const DOCS_TO_UPLOAD = [
  // ── Art. 260: Banco de Chile — Crédito de Consumo ────────────────────────
  // Tipo 22: acredita MONTO ($18.191.754) del crédito de consumo
  {
    local: path.join(ART260_DIR, 'informeCredito.pdf'),
    storagePath: `${STORAGE_PREFIX}/bch_informe_credito_consumo.pdf`,
    filename: 'informeCredito.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 22,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  // Tipo 23: acredita VENCIMIENTO (Cuota 20, 04/08/2025) del crédito de consumo.
  // El portal no acepta PNG → se usa el Aviso de Vencimiento de agosto (PDF oficial del banco).
  {
    local: path.join(ART260_DIR, 'AvisoVencimientoCredito banco de chile agosto.pdf'),
    storagePath: `${STORAGE_PREFIX}/bch_aviso_vencimiento_agosto.pdf`,
    filename: 'AvisoVencimientoCredito banco de chile agosto.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 23,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  // ── Art. 260: Banco de Chile — Tarjeta de Crédito Visa ───────────────────
  // Tipo 24: acredita MONTO ($3.716.235) y VENCIMIENTO (07/08/2025) de la tarjeta
  {
    local: path.join(ART260_DIR, 'Estado de deudas banco de chile socofin.pdf'),
    storagePath: `${STORAGE_PREFIX}/bch_socofin_tarjeta.pdf`,
    filename: 'Estado de deudas banco de chile socofin.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 24,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  // ── Art. 261: CAT (ex CENCOSUD) ──────────────────────────────────────────
  // Nota: el certificado de deuda original (.jpg, nov-2025) no está en la carpeta.
  // Se usa el EECC de octubre 2025 (igualmente válido para acreditar monto en Art. 261).
  {
    local: path.join(CAT_DIR, 'Octubre_2025 cencosud.pdf'),
    storagePath: `${STORAGE_PREFIX}/cat_cencosud_eecc_octubre.pdf`,
    filename: 'Octubre_2025 cencosud.pdf',
    institucion_cmf: 'CAT (ex CENCOSUD)',
    document_type: 22,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  // ── Art. 261: CMR Falabella ───────────────────────────────────────────────
  // Nota: el certificado-deuda cmr.pdf original no está en la carpeta.
  // Se usa el EECC de octubre 2025.
  {
    local: path.join(CMR_DIR, 'cmr estado de cuenta octubre.pdf'),
    storagePath: `${STORAGE_PREFIX}/cmr_eecc_octubre.pdf`,
    filename: 'cmr estado de cuenta octubre.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 22,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  // ── Art. 261: PRESTO LIDER (Lider Bci) ───────────────────────────────────
  // Nota: el certificado de deuda líder bci .jpg original no está en la carpeta.
  // Se usa el EECC de octubre 2025.
  {
    local: path.join(LIDER_DIR, 'lider bci estado de cuenta octubre.pdf'),
    storagePath: `${STORAGE_PREFIX}/lider_bci_eecc_octubre.pdf`,
    filename: 'lider bci estado de cuenta octubre.pdf',
    institucion_cmf: 'PRESTO LIDER',
    document_type: 22,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
];

async function run() {
  console.log('🔧 Subiendo y registrando documentos de Betzy Lee en client_documents...\n');

  // 1. Fetch client_id por RUT
  const { data: client, error: fetchErr } = await supabase
    .from('clients')
    .select('id, name, informe_cmf_path')
    .eq('rut', BETZY_RUT)
    .single();

  if (fetchErr || !client) {
    console.error('❌ No se encontró la fila de Betzy (RUT', BETZY_RUT, ').');
    console.error('   Corré primero: npx ts-node -r dotenv/config casos/betzy_lee/setup_test.ts');
    process.exit(1);
  }
  console.log(`✓ Cliente: ${client.name} (client_id: ${client.id})`);
  const CLIENT_ID = client.id;

  // 2. Subir CMF y actualizar informe_cmf_path (no estaba disponible en setup)
  const cmfLocal = path.join(CASE_DIR, 'documentos', '02_Informe_CMF', 'informe_deudas_26199806-8.pdf');
  const cmfStoragePath = `${STORAGE_PREFIX}/informe_cmf.pdf`;

  if (client.informe_cmf_path) {
    console.log(`ℹ️  CMF ya existe en BD: ${client.informe_cmf_path} (re-subiendo para actualizar)\n`);
  } else {
    console.log('⏳ CMF no estaba cargado — subiendo ahora...');
  }

  if (!fs.existsSync(cmfLocal)) {
    console.error(`❌ CMF no encontrado: ${cmfLocal}`);
    process.exit(1);
  }
  const cmfBuffer = fs.readFileSync(cmfLocal);
  const { error: cmfUploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(cmfStoragePath, cmfBuffer, { contentType: 'application/pdf', upsert: true });
  if (cmfUploadErr) {
    console.error('❌ Error subiendo CMF:', cmfUploadErr.message);
    process.exit(1);
  }
  const { error: cmfUpdateErr } = await supabase
    .from('clients')
    .update({ informe_cmf_path: cmfStoragePath })
    .eq('rut', BETZY_RUT);
  if (cmfUpdateErr) {
    console.error('❌ Error actualizando informe_cmf_path:', cmfUpdateErr.message);
    process.exit(1);
  }
  console.log(`✓ CMF subido y actualizado → ${cmfStoragePath}\n`);

  // 3. Limpiar client_documents anteriores (idempotente)
  const { data: deleted } = await supabase
    .from('client_documents')
    .delete()
    .eq('client_id', CLIENT_ID)
    .select('id, filename');
  if (deleted && deleted.length > 0) {
    console.log(`🧹 ${deleted.length} registro(s) anteriores eliminados de client_documents.\n`);
  }

  // 4. Subir cada certificado y registrar en client_documents
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

    if (uploadErr) {
      console.error(`❌ Error al subir ${doc.filename}:`, uploadErr.message);
      process.exit(1);
    }
    console.log(`   ✓ Storage: ${BUCKET}/${doc.storagePath}`);

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

    if (dbErr) {
      console.error(`❌ Error al registrar en DB ${doc.filename}:`, dbErr.message);
      process.exit(1);
    }
    console.log(`   ✓ DB: tipo ${doc.document_type} / ${doc.institucion_cmf}\n`);
  }

  console.log('🎉 Todos los documentos de Betzy han sido subidos y registrados.');
  console.log('\n⚠️  RECORDATORIO: Ambos productos de Banco de Chile tienen $0 en mora CMF.');
  console.log('   El Sentinel debe reclasificarlos Art. 261 → Art. 260 antes del Paso 3.');
  console.log(`   CLIENT_ID="${CLIENT_ID}"`);
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
