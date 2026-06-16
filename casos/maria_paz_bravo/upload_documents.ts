/**
 * Sube y registra los documentos de acreditación de María Paz Bravo Norambuena
 * en client_documents.
 *
 * ─── Estructura del Paso 3 ────────────────────────────────────────────────────
 *
 *  Art. 260 (mora ≥91d — ambos en CMF con overdue90Days > 0):
 *   • CMR Falabella (tarjeta):   EECC noviembre 2025 → tipo 24
 *                                (certifica $9.763.965 + venc. 05/08/2025)
 *   • Banco Itaú Chile (3 prod): CARTERA VENCIDA 02/12/2025 → tipo 24
 *                                (cubre consumo $3.219.943 venc.25/08 + tarjeta
 *                                $1.612.453 venc.10/09 + línea $301.888 venc.26/11)
 *
 *  Art. 261 (al día en CMF — sin mora >90d):
 *   • Banco Estado (hipotecario): Captura portal (2038).pdf → tipo 22
 *   • Banco Estado (línea):       Captura portal (2038).pdf → mismo doc cubre ambas filas
 *   • Coopeuch:                   Certificado Liquidación Portabilidad → tipo 22
 *
 * NOTA: Un único doc ("Captura de pantalla (2038).pdf") cubre ambas filas de
 * Banco Estado. Se registra UNA sola vez; fillStep3 lo adjunta a cada fila por
 * monto (buscando $71.018.320 y $1.000.000 respectivamente).
 *
 * Uso: npx ts-node -r dotenv/config casos/maria_paz_bravo/upload_documents.ts
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
const CLIENT_RUT = '16.997.909-K';
const STORAGE_PREFIX = 'maria_paz_bravo';

const DOCS_DIR = path.resolve(__dirname);

const DIR_260_FALABELLA = path.join(DOCS_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_Falabella');
const DIR_260_ITAU      = path.join(DOCS_DIR, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_Itau');
const DIR_261_ESTADO    = path.join(DOCS_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Banco_Estado');
const DIR_261_COOPEUCH  = path.join(DOCS_DIR, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Coopeuch');

const DOCS_TO_UPLOAD = [
  // ── Art. 260: CMR Falabella ─────────────────────────────────────────────────
  // Tipo 24 = monto + vencimiento. EECC nov. 2025 muestra saldo $9.763.965 y
  // "Aviso de Cobranza" con cuotas vencidas desde 05/08/2025.
  {
    local: path.join(DIR_260_FALABELLA, 'Estado de Cuenta CMR noviembre_unlocked.pdf'),
    storagePath: `${STORAGE_PREFIX}/cmr_eecc_noviembre_2025.pdf`,
    filename: 'Estado de Cuenta CMR noviembre_unlocked.pdf',
    institucion_cmf: 'CMR Falabella',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta',
    contentType: 'application/pdf',
  },
  // ── Art. 260: Banco Itaú Chile (3 productos en 1 fila CMF) ─────────────────
  // Tipo 24. Cartera Vencida del 02/12/2025: p1=Línea, p2=Consumo, p3=Tarjeta.
  // Certifica todos los vencimientos y saldos en un solo doc.
  {
    local: path.join(DIR_260_ITAU, 'CARTERA VENCIDA.pdf'),
    storagePath: `${STORAGE_PREFIX}/itau_cartera_vencida.pdf`,
    filename: 'CARTERA VENCIDA.pdf',
    institucion_cmf: 'Banco Itaú Chile',
    document_type: 24,
    acreditacion_tipo: 'cartera_vencida',
    contentType: 'application/pdf',
  },
  // ── Art. 261: Banco Estado (hipotecario + línea — doc único cubre ambas filas) ─
  // Tipo 22 = monto. La captura del portal BancoEstado muestra:
  //   • Hipotecario 114869790: capital insoluto $71.018.320 al día
  //   • Línea de crédito 43500265389: cupo usado $1.000.000
  // fillStep3 adjunta este mismo doc a cada fila usando el monto como key.
  {
    local: path.join(DIR_261_ESTADO, 'Captura de pantalla (2038).pdf'),
    storagePath: `${STORAGE_PREFIX}/bde_captura_portal.pdf`,
    filename: 'Captura de pantalla (2038).pdf',
    institucion_cmf: 'Banco Estado',
    document_type: 22,
    acreditacion_tipo: 'captura_portal',
    contentType: 'application/pdf',
  },
  // ── Art. 261: Coopeuch ──────────────────────────────────────────────────────
  // Tipo 22 = monto. Certificado de Liquidación de Portabilidad 24/11/2025:
  // costo de prepago $16.076.650, primer vencimiento 15/01/2026.
  {
    local: path.join(DIR_261_COOPEUCH, 'CERTIFICADO_LIQUIDACION_1763985892716.pdf'),
    storagePath: `${STORAGE_PREFIX}/coopeuch_cert_liquidacion.pdf`,
    filename: 'CERTIFICADO_LIQUIDACION_1763985892716.pdf',
    institucion_cmf: 'Coopeuch',
    document_type: 22,
    acreditacion_tipo: 'certificado_liquidacion',
    contentType: 'application/pdf',
  },
];

async function run() {
  console.log('🔧 Subiendo documentos de acreditación de María Paz Bravo Norambuena...\n');

  const { data: client, error: fetchErr } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', CLIENT_RUT)
    .single();

  if (fetchErr || !client) {
    console.error('❌ Cliente no encontrado. Correr primero setup_test.ts');
    process.exit(1);
  }
  console.log(`✓ Cliente: ${client.name} (client_id: ${client.id})`);
  const CLIENT_ID = client.id;

  // Idempotente: borrar registros anteriores
  const { data: deleted } = await supabase
    .from('client_documents')
    .delete()
    .eq('client_id', CLIENT_ID)
    .select('id, filename');
  if (deleted && deleted.length > 0) {
    console.log(`🧹 ${deleted.length} documento(s) anterior(es) eliminado(s).\n`);
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
    if (uploadErr) { console.error('❌ Storage:', uploadErr.message); process.exit(1); }
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

  console.log('🎉 Documentos de María Paz registrados en client_documents.');
  console.log('   Art. 260: CMR Falabella + Banco Itaú Chile (3 productos en 1 fila)');
  console.log('   Art. 261: Banco Estado (hipotecario + línea) + Coopeuch');
}

run().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
