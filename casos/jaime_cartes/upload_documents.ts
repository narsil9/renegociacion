/**
 * Sube los certificados de Jaime Hernán Cartes Fuentes a Supabase Storage
 * y registra cada uno en client_documents para la cadena de agentes.
 *
 * CMF (2 acreedores + indirecto):
 *   Art. 260 — Banco Santander TC 2982 ($2.730.267), Tenpo Payments ($298.964)
 *   Art. 261 — Coopeuch mutuo hipotecario indirecto ($103.633.300)
 *
 * Uso (ejecutar DESPUÉS de setup_test.ts):
 *   npx ts-node -r dotenv/config casos/jaime_cartes/upload_documents.ts
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
const CLIENT_RUT = '17.596.599-8';
const PREFIX     = 'jaime_cartes';
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
  // ── Banco Santander TC 2982 — historial de mora (Art.260 — tipo 24) ──────
  {
    local: path.join(D260, 'Banco_Santander', '2982 TC ESTADOS DE CUENTA MORA 8_8.pdf'),
    storagePath: `${PREFIX}/santander_2982_historial.pdf`,
    filename: '2982 TC ESTADOS DE CUENTA MORA 8_8.pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── Banco Santander TC 2982 — último EECC (Art.260 — tipo 22 monto) ──────
  {
    local: path.join(D260, 'Banco_Santander', 'estado-de-cuenta (13).pdf'),
    storagePath: `${PREFIX}/santander_2982_noviembre.pdf`,
    filename: 'estado-de-cuenta (13).pdf',
    institucion_cmf: 'Santander-Chile',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
  // ── Tenpo Payments TC 9924 (Art.260 — tipo 24 monto+vencimiento) ─────────
  {
    local: path.join(D260, 'Tenpo_Payments', 'Constancia de Deuda 17596599-8 .pdf'),
    storagePath: `${PREFIX}/tenpo_constancia.pdf`,
    filename: 'Constancia de Deuda 17596599-8 .pdf',
    institucion_cmf: 'Tenpo Payments S.A.',
    document_type: 24,
    acreditacion_tipo: 'general',
  },
  // ── Coopeuch mutuo hipotecario (Art.261 — tipo 22 monto, rol de aval) ────
  {
    local: path.join(D261, 'Coopeuch', 'Hoja Resumen - 2025-06-27T151837.177.pdf'),
    storagePath: `${PREFIX}/coopeuch_hipotecario.pdf`,
    filename: 'Hoja Resumen - 2025-06-27T151837.177.pdf',
    institucion_cmf: 'Coopeuch',
    document_type: 22,
    acreditacion_tipo: 'monto',
  },
];

async function run() {
  console.log('🔧 Subiendo documentos de Jaime Hernán Cartes Fuentes → client_documents\n');

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
  console.log('  npx ts-node --transpile-only -r dotenv/config casos/enqueue_worker_test.ts 17.596.599-8 3');
}

run().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
