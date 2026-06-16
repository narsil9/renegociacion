/**
 * Sube y registra los documentos de acreditación de Yoselyn Yudith Reyes Sánchez
 * en client_documents. Debe ejecutarse DESPUÉS de setup_test.ts.
 *
 * Mapeo según analisis_deudas.md (Sección VI):
 *
 *  Art. 260 — Banco Estado (Consumo):
 *    - CERTIFICADO BANCO ESTADO.pdf → Tipo 24 (acredita MONTO $3.311.717 y mora desde 05/11/2025)
 *
 *  Art. 260 — Banco BCI (Consumo):
 *    - CERTIFICADO BCI.pdf → Tipo 24 (acredita MONTO $7.264.344 y mora desde 05/11/2025)
 *
 *  Art. 260 — CAR - Ripley (Tarjeta) — 4 EECCs consecutivos:
 *    - Ripley Noviembre.pdf   → Tipo 24 (vencimiento 30/11/2025)
 *    - Ripley Diciembre.pdf   → Tipo 24 (cadena de mora)
 *    - Ripley Enero.pdf       → Tipo 24 (cadena de mora)
 *    - 30_11 CAR YOSELYN.pdf  → Tipo 24 (acredita MONTO $663.238, febrero 2026)
 *
 *  Art. 260 — CMR Falabella (Tarjeta) — PDF consolidado 4 EECCs:
 *    - 260 CMR YOSLEYN.pdf → Tipo 24 (MONTO $2.424.857 y VENCIMIENTO 10/11/2025)
 *
 *  Art. 261 — Coopeuch (Consumo, vigente):
 *    - CERTIFICADO COOPEUCH.pdf → Tipo 22 (acredita MONTO $12.838.870)
 *
 *  Art. 261 NO-CMF — Caja Los Andes (3 créditos vigentes):
 *    - credito Caja los andes.pdf → Tipo 22 (Crédito 1, $513.124)
 *    - Credito los andes 2.pdf    → Tipo 22 (Crédito 2, $649.310)
 *    - Credito los andes 3.pdf    → Tipo 22 (Crédito 3, $12.551.466)
 *
 * Uso: npx ts-node -r dotenv/config casos/yoselyn_reyes/upload_documents.ts
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
const YOSELYN_RUT = '16.563.374-1';
const STORAGE_PREFIX = 'yoselyn_reyes';
const CASE_DIR = path.resolve(__dirname);

const ART260_BE  = path.join(CASE_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_Estado');
const ART260_BCI = path.join(CASE_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_BCI');
const ART260_RIP = path.join(CASE_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_Ripley');
const ART260_CMR = path.join(CASE_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_Falabella');
const ART261_COO = path.join(CASE_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Coopeuch');
const ART261_CA  = path.join(CASE_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Caja_Los_Andes');

const DOCS_TO_UPLOAD = [
  // ── Art. 260: Banco Estado — Crédito de Consumo ──────────────────────────
  // Tipo 24: certificado oficial que acredita saldo ($3.311.717) y fecha mora (05/11/2025)
  {
    local: path.join(ART260_BE, 'CERTIFICADO BANCO ESTADO.pdf'),
    storagePath: `${STORAGE_PREFIX}/certificado_banco_estado.pdf`,
    filename: 'CERTIFICADO BANCO ESTADO.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 24,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  // ── Art. 260: Banco BCI — Crédito de Consumo ─────────────────────────────
  // Tipo 24: certificado oficial con saldo ($7.264.344) y mora desde 05/11/2025
  {
    local: path.join(ART260_BCI, 'CERTIFICADO BCI.pdf'),
    storagePath: `${STORAGE_PREFIX}/certificado_bci.pdf`,
    filename: 'CERTIFICADO BCI.pdf',
    institucion_cmf: 'Banco de Crédito e Inversiones',
    document_type: 24,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  // ── Art. 260: CAR - Ripley — Tarjeta (4 EECCs consecutivos) ──────────────
  {
    local: path.join(ART260_RIP, 'Ripley Noviembre.pdf'),
    storagePath: `${STORAGE_PREFIX}/ripley_noviembre_2025.pdf`,
    filename: 'Ripley Noviembre.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  {
    local: path.join(ART260_RIP, 'Ripley Diciembre.pdf'),
    storagePath: `${STORAGE_PREFIX}/ripley_diciembre_2025.pdf`,
    filename: 'Ripley Diciembre.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  {
    local: path.join(ART260_RIP, 'Ripley Enero.pdf'),
    storagePath: `${STORAGE_PREFIX}/ripley_enero_2026.pdf`,
    filename: 'Ripley Enero.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  {
    local: path.join(ART260_RIP, '30_11 CAR YOSELYN.pdf'),
    storagePath: `${STORAGE_PREFIX}/ripley_febrero_2026.pdf`,
    filename: '30_11 CAR YOSELYN.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  // ── Art. 260: CMR Falabella — Tarjeta (PDF consolidado 4 EECCs) ──────────
  // Un solo PDF que contiene los 4 estados de cuenta (Nov-Feb). Acredita monto y vencimiento.
  {
    local: path.join(ART260_CMR, '260 CMR YOSLEYN.pdf'),
    storagePath: `${STORAGE_PREFIX}/cmr_consolidado_4_eecc.pdf`,
    filename: '260 CMR YOSLEYN.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  // ── Art. 261: Coopeuch — Crédito de Consumo (vigente) ────────────────────
  {
    local: path.join(ART261_COO, 'CERTIFICADO COOPEUCH.pdf'),
    storagePath: `${STORAGE_PREFIX}/certificado_coopeuch.pdf`,
    filename: 'CERTIFICADO COOPEUCH.pdf',
    institucion_cmf: 'Coopeuch',
    document_type: 22,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  // ── Art. 261 NO-CMF: Caja Los Andes — 3 créditos vigentes ────────────────
  // Caja Los Andes no aparece en CMF. El Sentinel los detectará como NO-CMF.
  {
    local: path.join(ART261_CA, 'credito Caja los andes.pdf'),
    storagePath: `${STORAGE_PREFIX}/caja_andes_credito_1.pdf`,
    filename: 'credito Caja los andes.pdf',
    institucion_cmf: 'Caja Los Andes',
    document_type: 22,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  {
    local: path.join(ART261_CA, 'Credito los andes 2.pdf'),
    storagePath: `${STORAGE_PREFIX}/caja_andes_credito_2.pdf`,
    filename: 'Credito los andes 2.pdf',
    institucion_cmf: 'Caja Los Andes',
    document_type: 22,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
  {
    local: path.join(ART261_CA, 'Credito los andes 3.pdf'),
    storagePath: `${STORAGE_PREFIX}/caja_andes_credito_3.pdf`,
    filename: 'Credito los andes 3.pdf',
    institucion_cmf: 'Caja Los Andes',
    document_type: 22,
    acreditacion_tipo: 'general',
    contentType: 'application/pdf',
  },
];

async function run() {
  console.log('🔧 Subiendo y registrando documentos de Yoselyn Reyes en client_documents...\n');

  // 1. Fetch client_id por RUT
  const { data: client, error: fetchErr } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', YOSELYN_RUT)
    .single();

  if (fetchErr || !client) {
    console.error('❌ No se encontró la fila de Yoselyn (RUT', YOSELYN_RUT, ').');
    console.error('   Corré primero: npx ts-node -r dotenv/config casos/yoselyn_reyes/setup_test.ts');
    process.exit(1);
  }
  console.log(`✓ Cliente: ${client.name} (client_id: ${client.id})\n`);
  const CLIENT_ID = client.id;

  // 2. Limpiar client_documents anteriores (idempotente)
  const { data: deleted } = await supabase
    .from('client_documents')
    .delete()
    .eq('client_id', CLIENT_ID)
    .select('id, filename');
  if (deleted && deleted.length > 0) {
    console.log(`🧹 ${deleted.length} registro(s) anteriores eliminados de client_documents.\n`);
  }

  // 3. Subir cada certificado y registrar en client_documents
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

  console.log('🎉 Todos los documentos de Yoselyn han sido subidos y registrados.');
  console.log('\n📋 Resumen de acreedores:');
  console.log('  Art. 260 (mora ≥91d): Banco Estado, BCI, CAR-Ripley, CMR Falabella');
  console.log('  Art. 261 (vigente):   Coopeuch');
  console.log('  Art. 261 NO-CMF:      Caja Los Andes (3 créditos — Sentinel los detectará)');
  console.log(`   CLIENT_ID="${CLIENT_ID}"`);
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
