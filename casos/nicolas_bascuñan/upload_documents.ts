/**
 * Sube los certificados de Nicolás Bascuñán a Supabase Storage
 * y registra cada uno en client_documents para la cadena de agentes.
 *
 * CMF (6 acreedores):
 *   Art. 260 — BdCh Consumo (reclasificado), BCI Consumo (directo 260)
 *   Art. 261 — BdCh Vivienda, CAR Ripley, CMR Falabella, Santander Consumer
 *   NO-CMF    — CCAF Los Andes (×2), Municipalidad Santiago+Las Condes
 *
 * Uso (ejecutar DESPUÉS de setup_test.ts):
 *   npx ts-node -r dotenv/config casos/nicolas_bascuñan/upload_documents.ts
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

const BUCKET     = 'documentos';
const CLIENT_RUT = '18.755.318-0';
const PREFIX     = 'nicolas_bascunan';
const D260       = path.resolve(__dirname, 'documentos', '06_Acreedores_Art260_Mora');
const D261       = path.resolve(__dirname, 'documentos', '07_Acreedores_Art261_Al_Dia');

const DOCS: {
  local: string;
  storagePath: string;
  filename: string;
  institucion_cmf: string | null;
  document_type: 22 | 23 | 24;
  acreditacion_tipo: 'monto' | 'vencimiento' | 'general';
  contentType?: string;
}[] = [
  // ── BdCh Consumo (Art.260 reclasificado — tipo 24 monto+vencimiento) ─────────
  {
    local: path.join(D260, 'Banco_de_Chile', 'Estado de Deuda - Power Apps.pdf RUT 187553180.pdf'),
    storagePath: `${PREFIX}/bch_poder_apps.pdf`,
    filename: 'Estado de Deuda - Power Apps.pdf RUT 187553180.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── BdCh Vivienda (Art.261 — tipo 22 monto) ──────────────────────────────────
  {
    local: path.join(D261, 'Banco_de_Chile', 'informe-credito-hipotecario.pdf'),
    storagePath: `${PREFIX}/bch_hipotecario.pdf`,
    filename: 'informe-credito-hipotecario.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── BCI Consumo (Art.260 directo — tipo 22 monto) ────────────────────────────
  {
    local: path.join(D260, 'Banco_de_Crédito_e_Inversiones', 'BCI-40670058-certificado-prepago_unlocked.pdf'),
    storagePath: `${PREFIX}/bci_prepago.pdf`,
    filename: 'BCI-40670058-certificado-prepago_unlocked.pdf',
    institucion_cmf: 'De Credito e Inversiones',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── BCI mora (Art.260 — tipo 23 vencimiento) ─────────────────────────────────
  {
    local: path.join(D260, 'Banco_de_Crédito_e_Inversiones', 'Mora BCI.pdf'),
    storagePath: `${PREFIX}/bci_mora.pdf`,
    filename: 'Mora BCI.pdf',
    institucion_cmf: 'De Credito e Inversiones',
    document_type: 23,
    acreditacion_tipo: 'vencimiento',
  },
  // ── Santander Consumer (Art.261 — tipo 22 monto) ─────────────────────────────
  {
    local: path.join(D261, 'Banco_Santander', '650071881789 (1).pdf'),
    storagePath: `${PREFIX}/santander_consumer.pdf`,
    filename: '650071881789 (1).pdf',
    institucion_cmf: 'Santander Consumer',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── CAR - Ripley (Art.261 — tipo 22 monto) ───────────────────────────────────
  {
    local: path.join(D261, 'Banco_Ripley', 'Estado Ripley Octubre.pdf'),
    storagePath: `${PREFIX}/ripley_octubre.pdf`,
    filename: 'Estado Ripley Octubre.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── CMR Falabella (Art.261 — tipo 22 monto, imagen JPEG) ─────────────────────
  {
    local: path.join(D261, 'Banco_Falabella', 'WhatsApp Image 2025-11-04 at 3.36.39 PM.jpeg'),
    storagePath: `${PREFIX}/cmr_app.jpeg`,
    filename: 'WhatsApp Image 2025-11-04 at 3.36.39 PM.jpeg',
    institucion_cmf: 'CMR Falabella',
    document_type: 22,
    acreditacion_tipo: 'monto',
    contentType: 'image/jpeg',
  },
  // ── CCAF Los Andes crédito 1 (NO-CMF Art.261 — tipo 22 monto) ────────────────
  {
    local: path.join(D261, 'Caja_Los_Andes', 'c8346617-f01f-49a6-a634-4f51eaedf21e.pdf'),
    storagePath: `${PREFIX}/cla_32032.pdf`,
    filename: 'c8346617-f01f-49a6-a634-4f51eaedf21e.pdf',
    institucion_cmf: null,
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── CCAF Los Andes crédito 2 (NO-CMF Art.261 — tipo 22 monto) ────────────────
  {
    local: path.join(D261, 'Caja_Los_Andes', '65018458-3412-4998-ae61-16f4474560f2.pdf'),
    storagePath: `${PREFIX}/cla_51051.pdf`,
    filename: '65018458-3412-4998-ae61-16f4474560f2.pdf',
    institucion_cmf: null,
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Multas RMNP (NO-CMF Art.261, cubre Santiago + Las Condes — tipo 22) ──────
  {
    local: path.join(D261, 'Multas_Transito', 'MNP_500664842138_SPLG.21.pdf'),
    storagePath: `${PREFIX}/rmnp_multas.pdf`,
    filename: 'MNP_500664842138_SPLG.21.pdf',
    institucion_cmf: null,
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
];

async function run() {
  console.log('🔧 Subiendo documentos de Nicolás Bascuñán → client_documents\n');

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
    const ct = doc.contentType ?? 'application/pdf';
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET).upload(doc.storagePath, buffer, { contentType: ct, upsert: true });
    if (uploadErr) {
      console.error(`❌ Storage upload ${doc.filename}:`, uploadErr.message);
      process.exit(1);
    }

    const { error: dbErr } = await supabase.from('client_documents').insert({
      client_id:       client.id,
      filename:        doc.filename,
      storage_path:    doc.storagePath,
      document_type:   doc.document_type,
      acreditacion_tipo: doc.acreditacion_tipo,
      institucion_cmf: doc.institucion_cmf,
      uploaded_at:     new Date().toISOString(),
    });
    if (dbErr) {
      console.error(`❌ DB insert ${doc.filename}:`, dbErr.message);
      process.exit(1);
    }

    const inst = doc.institucion_cmf ?? '(NO-CMF)';
    console.log(`  ✓ ${doc.filename} → ${inst} (tipo ${doc.document_type})`);
  }

  console.log(`\n🎉 ${DOCS.length} documentos subidos y registrados.`);
  console.log('\nSiguiente paso (batch completo):');
  console.log('  BYPASS_DATE_CHECK=true BYPASS_RUT_CHECK=true \\');
  console.log('    npx ts-node --transpile-only -r dotenv/config casos/run_batch_full_chain.ts');
}

run().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
