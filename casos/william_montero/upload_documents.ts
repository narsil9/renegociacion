/**
 * Sube los certificados de William Montero a Supabase Storage
 * y registra cada uno en client_documents para la cadena de agentes.
 *
 * CMF (9 acreedores):
 *   Art. 260 — Internacional (directa), CAT Cencosud (directa)
 *   Art. 261 — Scotiabank Consumo, Scotiabank Vivienda, Santander-Chile,
 *              Itaú, CMR Falabella, Solventa Tarjetas, Santander Consumer
 *   NO-CMF   — TGR (Art.260 $128k), Caja Los Andes (Art.261)
 *
 * Uso (ejecutar DESPUÉS de setup_test.ts):
 *   npx ts-node -r dotenv/config casos/william_montero/upload_documents.ts
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
const CLIENT_RUT = '25.656.359-2';
const PREFIX     = 'pato_william';
const BASE       = __dirname;
const ART260     = path.join(BASE, 'documentos', '06_Acreedores_Art260_Mora');
const ART261     = path.join(BASE, 'documentos', '07_Acreedores_Art261_Al_Dia');
const NOCMF      = path.join(BASE, 'documentos', '08_Acreedores_NO_CMF');

const DOCS: {
  local: string;
  storagePath: string;
  filename: string;
  institucion_cmf: string | null;
  document_type: 22 | 23 | 24;
  acreditacion_tipo: 'monto' | 'vencimiento' | 'general';
  contentType?: string;
}[] = [
  // ── Internacional (Art.260 directo — tipo 24 general) ────────────────────────
  {
    local: path.join(ART260, 'Banco_Internacional', 'Liquidacion Judicial..pdf'),
    storagePath: `${PREFIX}/internacional_liquidacion.pdf`,
    filename: 'Liquidacion Judicial..pdf',
    institucion_cmf: 'Internacional',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── CAT Cencosud (Art.260 directo — tipo 24 general) ─────────────────────────
  {
    local: path.join(ART260, 'CAT_Cencosud', 'Noviembre_2025_EECC.pdf'),
    storagePath: `${PREFIX}/cat_noviembre.pdf`,
    filename: 'Noviembre_2025_EECC.pdf',
    institucion_cmf: 'CAT (ex CENCOSUD)',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── Itaú (Art.261 — tipo 22 monto, archivo en carpeta 260 del caso) ──────────
  {
    local: path.join(ART260, 'Banco_Itau', 'CreditoConsumoItau.pdf'),
    storagePath: `${PREFIX}/itau_constancia.pdf`,
    filename: 'CreditoConsumoItau.pdf',
    institucion_cmf: 'Banco Itaú Chile',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── CMR Falabella (Art.261 — tipo 22 monto) ───────────────────────────────────
  {
    local: path.join(ART261, 'Banco_Falabella', 'FallabelaNoviembre.pdf'),
    storagePath: `${PREFIX}/falabella_noviembre.pdf`,
    filename: 'FallabelaNoviembre.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Solventa Tarjetas (Art.261 — tipo 22 monto) ──────────────────────────────
  {
    local: path.join(ART261, 'Solventa_Tarjetas', 'estado-de-cuenta_Noviembre.pdf'),
    storagePath: `${PREFIX}/solventa_noviembre.pdf`,
    filename: 'estado-de-cuenta_Noviembre.pdf',
    institucion_cmf: 'Solventa Tarjetas',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Santander-Chile (Art.261 — tipo 22 monto) ────────────────────────────────
  {
    local: path.join(ART261, 'Banco_Santander', '3530 11_25.pdf'),
    storagePath: `${PREFIX}/santander_3530_nov.pdf`,
    filename: '3530 11_25.pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Santander Consumer (Art.261 — tipo 22 monto) ─────────────────────────────
  {
    local: path.join(ART261, 'Banco_Santander', 'DEUDA VIGENTE op 650077179296.pdf'),
    storagePath: `${PREFIX}/santander_consumer.pdf`,
    filename: 'DEUDA VIGENTE op 650077179296.pdf',
    institucion_cmf: 'Santander Consumer',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Scotiabank Consumo (Art.261 — tipo 22 monto) ─────────────────────────────
  {
    local: path.join(ART261, 'Scotiabank', 'ResumenCreditosConsumo.pdf'),
    storagePath: `${PREFIX}/scotiabank_consumo.pdf`,
    filename: 'ResumenCreditosConsumo.pdf',
    institucion_cmf: 'Scotiabank Chile',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Scotiabank Vivienda (Art.261 — tipo 22 monto, imagen PNG) ────────────────
  {
    local: path.join(ART261, 'Scotiabank', 'CreditoCasa.PNG'),
    storagePath: `${PREFIX}/scotiabank_hipotecario.png`,
    filename: 'CreditoCasa.PNG',
    institucion_cmf: 'Scotiabank Chile',
    document_type: 22,
    acreditacion_tipo: 'monto',
    contentType: 'image/png',
  },
  // ── TGR (NO-CMF Art.260 — tipo 24 general) ────────────────────────────────────
  {
    local: path.join(NOCMF, 'TGR', 'descarga (24).pdf'),
    storagePath: `${PREFIX}/tgr_contribuciones.pdf`,
    filename: 'descarga (24).pdf',
    institucion_cmf: null,
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── Caja Los Andes (NO-CMF Art.261 — tipo 22 monto) ─────────────────────────
  {
    local: path.join(NOCMF, 'Caja_Los_Andes', 'Certificado 20.130.pdf'),
    storagePath: `${PREFIX}/caja_los_andes.pdf`,
    filename: 'Certificado 20.130.pdf',
    institucion_cmf: null,
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
];

async function run() {
  console.log('🔧 Subiendo documentos de William Montero → client_documents\n');

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
      client_id:         client.id,
      filename:          doc.filename,
      storage_path:      doc.storagePath,
      document_type:     doc.document_type,
      acreditacion_tipo: doc.acreditacion_tipo,
      institucion_cmf:   doc.institucion_cmf,
      uploaded_at:       new Date().toISOString(),
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
