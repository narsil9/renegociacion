/**
 * Sube y registra los certificados de acreditación de Alejandra Espinoza
 * en client_documents. Debe ejecutarse DESPUÉS de setup_test.ts.
 *
 * Documentos según análisis_deudas.md Sección VI:
 *
 *  Art. 260 — CAT (ex CENCOSUD):
 *    - Agosto_2025_EECC.pdf   → acredita VENCIMIENTO (05/09/2025, primer estado impago)
 *    - Diciembre_2025_EECC.pdf → acredita MONTO ($11.275.392)
 *
 *  Art. 260 — CMR Falabella:
 *    - Diciembre_2025_CMR.pdf → acredita MONTO ($1.781.499) Y VENCIMIENTO (25/08/2025,
 *      vía sección "Aviso de Cobranza" del estado de diciembre)
 *
 *  Art. 261 — Banco de Chile Crédito de Consumo:
 *    - consultaCredito DE CONSUMO.pdf → acredita MONTO ($3.125.486)
 *
 *  Art. 261 — Banco de Chile Tarjetas (Visa Platinium + Visa Entel):
 *    - CPF portabilidad → acredita MONTO unificado ($517.442 + $1.407.530)
 *
 * Uso: npx ts-node -r dotenv/config casos/alejandra_espinoza/upload_documents.ts
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
const ALEJANDRA_RUT = '18.738.680-2';
const STORAGE_PREFIX = 'pato_alejandra';

const DOCS_DIR = path.resolve(__dirname, 'documentos');
const CAT_DIR = path.join(DOCS_DIR, 'Acreedores CMF', 'CAT (ex CENCOSUD)', 'Certificado de Deuda');
const CMR_DIR = path.join(DOCS_DIR, 'Acreedores CMF', 'CMR Falabella', 'Certificado de Deuda');
const CHILE_DIR = path.join(DOCS_DIR, 'Acreedores CMF', 'Banco de Chile', 'Certificado de Deuda');

const DOCS_TO_UPLOAD = [
  // ── Art. 260: CAT (ex CENCOSUD) ──────────────────────────────────────────
  {
    local: path.join(CAT_DIR, 'Agosto_2025_EECC.pdf'),
    storagePath: `${STORAGE_PREFIX}/cat_cencosud_agosto_2025.pdf`,
    filename: 'Agosto_2025_EECC.pdf',
    institucion_cmf: 'CAT (ex CENCOSUD)',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  {
    local: path.join(CAT_DIR, 'Diciembre_2025_EECC.pdf'),
    storagePath: `${STORAGE_PREFIX}/cat_cencosud_diciembre_2025.pdf`,
    filename: 'Diciembre_2025_EECC.pdf',
    institucion_cmf: 'CAT (ex CENCOSUD)',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  // ── Art. 260: CMR Falabella ───────────────────────────────────────────────
  {
    local: path.join(CMR_DIR, 'Diciembre_2025_CMR.pdf'),
    storagePath: `${STORAGE_PREFIX}/cmr_falabella_diciembre_2025.pdf`,
    filename: 'Diciembre_2025_CMR.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
  },
  // ── Art. 261: Banco de Chile Crédito de Consumo ──────────────────────────
  {
    local: path.join(CHILE_DIR, 'consultaCredito DE CONSUMO.pdf'),
    storagePath: `${STORAGE_PREFIX}/chile_consumo_consulta.pdf`,
    filename: 'consultaCredito DE CONSUMO.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 22,
    acreditacion_tipo: 'general',
  },
  // ── Art. 261: Banco de Chile Tarjetas (Platinium + Entel) ────────────────
  // Un solo Certificado de Liquidación de Portabilidad acredita ambas tarjetas.
  {
    local: path.join(DOCS_DIR, 'CPF-1767634532-649919-cl-REDBANC-ICL 6.pdf'),
    storagePath: `${STORAGE_PREFIX}/chile_certificado_liquidacion.pdf`,
    filename: 'CPF-1767634532-649919-cl-REDBANC-ICL 6.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 22,
    acreditacion_tipo: 'general',
  },
];

async function run() {
  console.log('🔧 Subiendo y registrando documentos de Alejandra en client_documents...\n');

  // 1. Fetch client_id de Alejandra por RUT
  const { data: client, error: fetchErr } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', ALEJANDRA_RUT)
    .single();

  if (fetchErr || !client) {
    console.error('❌ No se encontró la fila de Alejandra (RUT', ALEJANDRA_RUT, ').');
    console.error('   Corré primero: npx ts-node -r dotenv/config casos/alejandra_espinoza/setup_test.ts');
    process.exit(1);
  }
  console.log(`✓ Cliente: ${client.name} (client_id: ${client.id})\n`);
  const CLIENT_ID = client.id;

  // 2. Subir cada documento y registrar en client_documents
  for (const doc of DOCS_TO_UPLOAD) {
    if (!fs.existsSync(doc.local)) {
      console.error(`❌ Archivo local no encontrado: ${doc.local}`);
      process.exit(1);
    }

    const fileBuffer = fs.readFileSync(doc.local);

    console.log(`⏳ Subiendo: ${doc.filename}...`);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(doc.storagePath, fileBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      console.error(`❌ Error al subir ${doc.filename}:`, uploadError.message);
      process.exit(1);
    }
    console.log(`   ✓ Storage: ${BUCKET}/${doc.storagePath}`);

    const { error: dbError } = await supabase
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

    if (dbError) {
      console.error(`❌ Error al registrar en DB ${doc.filename}:`, dbError.message);
      process.exit(1);
    }
    console.log(`   ✓ DB: client_documents registrado (${doc.acreditacion_tipo} / ${doc.institucion_cmf})\n`);
  }

  console.log('🎉 Todos los documentos han sido subidos y registrados con éxito.');
  console.log('\n📋 Resumen de lo que queda pendiente:');
  console.log('  • Carpeta Tributaria de Alejandra (para Step 2) — obtener de SII');
  console.log('  • test_step3.ts — crear script hardcodeado para probar el Step 3 aislado');
  console.log('\nPara probar Step 3 directamente una vez disponible:');
  console.log('  BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_step3.ts');
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
