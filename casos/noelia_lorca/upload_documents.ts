/**
 * Sube los certificados de Noelia Pilar Lorca Guerrero a Supabase Storage
 * y registra cada uno en client_documents para la cadena de agentes.
 *
 * CMF (4 acreedores) + NO-CMF (4: 2×BdCh extra, La Araucana, Forum):
 *   Art. 260 — Banco de Chile consumo 1136 ($13.524.920), La Araucana CCAF ($9.536.311, sin saldo liquidado)
 *   Art. 261 — Banco Estado 3350 ($1.744.312), CAR-Ripley ($453.905), CMR Falabella ($991.601)
 *   NO-CMF    — BdCh LC 3570 ($114.782), BdCh TC 9782 ($377.461), La Araucana (tipo 23), Forum
 *
 * ⚠️  La Araucana y Forum están pendientes de certificados con saldo liquidado.
 *     El Centinela bloqueará igualmente por CMF vencido (191d > 30d).
 *
 * Uso (ejecutar DESPUÉS de setup_test.ts):
 *   npx ts-node -r dotenv/config casos/noelia_lorca/upload_documents.ts
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
const CLIENT_RUT = '15.121.553-K';
const PREFIX     = 'noelia_lorca';
const D260       = path.resolve(__dirname, 'documentos', '06_Acreedores_Art260_Mora');
const D261       = path.resolve(__dirname, 'documentos', '07_Acreedores_Art261_Al_Dia');
const DNOCMF     = path.resolve(__dirname, 'documentos', '08_Acreedores_NO_CMF');

const DOCS: {
  local: string;
  storagePath: string;
  filename: string;
  institucion_cmf: string | null;
  document_type: 22 | 23 | 24;
  acreditacion_tipo: 'monto' | 'vencimiento' | 'general';
  contentType?: string;
}[] = [
  // ── BdCh consumo 1136 — monto (Art.260 — tipo 22) ───────────────────────
  {
    local: path.join(D260, 'Banco_de_Chile', '1136 Bco Chile Cred.pdf'),
    storagePath: `${PREFIX}/bch_1136_cred.pdf`,
    filename: '1136 Bco Chile Cred.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── BdCh consumo 1136 — vencimiento (Art.260 — tipo 23) ─────────────────
  {
    local: path.join(D260, 'Banco_de_Chile', '1136 MORA CONSUMO 5-8.jpg'),
    storagePath: `${PREFIX}/bch_1136_mora.jpg`,
    filename: '1136 MORA CONSUMO 5-8.jpg',
    institucion_cmf: 'Banco de Chile',
    document_type: 23,
    acreditacion_tipo: 'vencimiento',
    contentType: 'image/jpeg',
  },
  // ── Banco Estado consumo 3350 (Art.261 — tipo 22 monto) ─────────────────
  {
    local: path.join(D261, 'Banco_Estado', '3350 CONSUMO.pdf'),
    storagePath: `${PREFIX}/bde_3350.pdf`,
    filename: '3350 CONSUMO.pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── CAR - Ripley (Art.261 — tipo 22 monto) ───────────────────────────────
  {
    local: path.join(D261, 'Banco_Ripley', 'noviembre.pdf'),
    storagePath: `${PREFIX}/ripley_noviembre.pdf`,
    filename: 'noviembre.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── CMR Falabella (Art.261 — tipo 22 monto) ──────────────────────────────
  {
    local: path.join(D261, 'Banco_Falabella', '7379 11_25.pdf'),
    storagePath: `${PREFIX}/cmr_7379_1125.pdf`,
    filename: '7379 11_25.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── BdCh LC 3570 (NO-CMF Art.261 — tipo 22 general) ─────────────────────
  {
    local: path.join(D260, 'Banco_de_Chile', '3570 Bco Chile LC.pdf'),
    storagePath: `${PREFIX}/bch_3570.pdf`,
    filename: '3570 Bco Chile LC.pdf',
    institucion_cmf: null,
    document_type: 22,
    acreditacion_tipo: 'general',
  },
  // ── BdCh TC 9782 (NO-CMF Art.261 — tipo 22 general) ─────────────────────
  {
    local: path.join(D260, 'Banco_de_Chile', '9782 TARJETA DE CREDITO MORA 7-8.pdf'),
    storagePath: `${PREFIX}/bch_9782.pdf`,
    filename: '9782 TARJETA DE CREDITO MORA 7-8.pdf',
    institucion_cmf: null,
    document_type: 22,
    acreditacion_tipo: 'general',
  },
  // ── La Araucana CCAF — vencimiento (NO-CMF Art.260 — tipo 23) ───────────
  // Falta saldo liquidado; el cert solo acredita cuotas morosas
  {
    local: path.join(DNOCMF, 'La_Araucana', 'certificado_detalle_credito_vigente (1).pdf'),
    storagePath: `${PREFIX}/la_araucana_vigente.pdf`,
    filename: 'certificado_detalle_credito_vigente (1).pdf',
    institucion_cmf: null,
    document_type: 23,
    acreditacion_tipo: 'vencimiento',
  },
  // ── Forum Servicios Financieros (NO-CMF Art.261 — tipo 22 monto) ─────────
  // Falta certificado de saldo liquidado; el doc solo acredita existencia
  {
    local: path.join(DNOCMF, 'Forum', 'document (9) (2).pdf'),
    storagePath: `${PREFIX}/forum_documento.pdf`,
    filename: 'document (9) (2).pdf',
    institucion_cmf: null,
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
];

async function run() {
  console.log('🔧 Subiendo documentos de Noelia Pilar Lorca Guerrero → client_documents\n');

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
      client_id:        client.id,
      filename:         doc.filename,
      storage_path:     doc.storagePath,
      document_type:    doc.document_type,
      acreditacion_tipo: doc.acreditacion_tipo,
      institucion_cmf:  doc.institucion_cmf,
      uploaded_at:      new Date().toISOString(),
    });
    if (dbErr) {
      console.error(`❌ DB insert ${doc.filename}:`, dbErr.message);
      process.exit(1);
    }

    const inst = doc.institucion_cmf ?? '(NO-CMF)';
    console.log(`  ✓ ${doc.filename} → ${inst} (tipo ${doc.document_type})`);
  }

  console.log(`\n🎉 ${DOCS.length} documentos subidos y registrados en client_documents.`);
  console.log('\nSiguiente paso (encolar job):');
  console.log('  npx ts-node --transpile-only -r dotenv/config casos/enqueue_worker_test.ts 15.121.553-K 3');
}

run().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
