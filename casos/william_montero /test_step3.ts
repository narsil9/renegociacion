/**
 * Test hardcodeado de Step 3 — Caso William Montero (login portal de prueba Pato Martini).
 *
 * Simula Sentinel + Orchestrator sin gastar créditos, descarga los PDFs reales de
 * Storage (pato_william/) y ejecuta el Playwright real del Paso 3.
 *
 * Plan (11 filas):
 *   Art. 260 (Obligaciones 260):
 *     - Internacional        $5.819.828  venc 05/09/2025  (override CMF, liquidación judicial)
 *     - CAT (ex CENCOSUD)    $889.688    venc 11/08/2025  (override CMF, 1ª boleta impaga julio)
 *     - Banco Itaú Chile     $13.747.818 venc 15/09/2025  (RECLASIFICADO: portal 91 días mora)
 *     - TGR (contribuciones) $128.838    venc 30/04/2025  (NO-CMF Art.260 — camino nuevo)
 *   Art. 261 (Otros Acreedores):
 *     - Scotiabank Chile (Consumo)   $16.672.594  (CMF)
 *     - Scotiabank Chile (Vivienda)  $92.057.933  (CMF)
 *     - Santander-Chile              $1.631.456   (CMF, consolida línea + 2 tarjetas)
 *     - CMR Falabella                $752.421     (CMF)
 *     - Solventa Tarjetas            $1.083.254   (CMF)
 *     - Santander Consumer           $6.573.007   (CMF)
 *     - CCAF Los Andes               $3.081.706   (NO-CMF, crédito por planilla)
 *
 * FUERA DEL TEST: la multa de tránsito ($68k, JPL Colina) — "Municipalidad de Colina"
 * NO existe en acreedores_canonicos → la declara el abogado manual o se agrega al catálogo.
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config "casos/William Alexander Montero Romero - 25.656.359-2 -- Renegociacion/test_step3.ts"
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { launchBrowser } from '../../src/utils/browser';
import { loginAndNavigateToStep1 } from '../../src/automation/login';
import { fillStep3, AcreditacionDoc, CmfDocumentOverride } from '../../src/automation/step3_acreedores';
import { ReclassifiedCreditor, AdditionalCreditor } from '../../src/utils/sentinel';

const CLIENT_RUT = '21917363-6'; // Pato Martini — portal de prueba
const CMF_STORAGE_PATH = 'pato_william/informe_cmf.pdf';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');
const CMF_LOCAL = path.join(TMP_DIR, 'informe_cmf_william.pdf');

// ─── Sentinel reclasificados (API #1 simulada): Itaú consumo → Art.260 ─────────
const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [
  {
    bank: 'Banco Itaú Chile',
    product_type: 'credito_consumo',
    institucion_cmf: 'Banco Itaú Chile',
    delinquency_start_date: '2025-09-15',
    delinquency_days: 91,
    total_credito_clp: 13747818,
    new_classification: 'obligaciones_260',
    reason: 'Portal Soluciones de Pago Itaú: 91 días de mora (op 60498640) al 15/12/2025. CMF aún $0 en 90+. Constancia 01/12 saldo insoluto $13.747.818.',
    document_filename: 'itau_constancia.pdf',
  },
];

// ─── Acreedores NO-CMF (lo que devolvería la reconciliación) ───────────────────
const SENTINEL_ADDITIONAL: AdditionalCreditor[] = [
  {
    bank: 'CCAF Los Andes',
    institucion_cmf: 'CCAF Los Andes',
    product_type: 'caja_compensacion',
    categoria_articulo: 261,
    total_credito_clp: 3081706,
    reason: 'Crédito social Ley 20.130 (cód. 108CON103862169) por planilla, vigente. NO figura en CMF.',
    document_filename: 'caja_los_andes.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    // NO-CMF Art. 260 (camino nunca antes probado): contribuciones morosas ≥91d.
    bank: 'Tesorería General de la República',
    institucion_cmf: 'Tesorería General de la República',
    product_type: 'tgr',
    categoria_articulo: 260,
    total_credito_clp: 128838,
    delinquency_start_date: '2025-04-30',
    delinquency_days: 229,
    reason: 'Contribuciones territoriales morosas (rol Lampa 078-00800-169), 4 cuotas 2025 impagas, la más antigua venc. 30/04/2025. NO figura en CMF.',
    document_filename: 'tgr_contribuciones.pdf',
    needs_lawyer_confirmation: true,
  },
];

// ─── Overrides monto/vencimiento para los Art.260 directos del CMF ─────────────
const CMF_OVERRIDES: CmfDocumentOverride[] = [
  { institucion_cmf: 'Internacional', monto_clp: 5819828, fecha_vencimiento: '2025-09-05' },
  { institucion_cmf: 'CAT (ex CENCOSUD)', monto_clp: 889688, fecha_vencimiento: '2025-08-11' },
];

// ─── Docs mapeados (Orchestrator simulado). tipo: 22=monto, 23=venc, 24=ambos ──
const MAPPED_DOCS: AcreditacionDoc[] = [
  // Art. 260 — Internacional (liquidación judicial acredita monto + venc)
  { institucion_cmf: 'Internacional', tipo_documento: 24, storage_path: 'pato_william/internacional_liquidacion.pdf', local_path: path.join(TMP_DIR, 'wm_internacional.pdf'), filename: 'internacional_liquidacion.pdf' },
  // Art. 260 — Itaú (constancia = monto, captura portal = venc)
  { institucion_cmf: 'Banco Itaú Chile', tipo_documento: 22, storage_path: 'pato_william/itau_constancia.pdf', local_path: path.join(TMP_DIR, 'wm_itau_constancia.pdf'), filename: 'itau_constancia.pdf' },
  // OJO: el portal NO acepta PNG (solo PDF/JPG/JPEG). La captura del portal Itaú se convirtió de .png → .jpg.
  { institucion_cmf: 'Banco Itaú Chile', tipo_documento: 23, storage_path: 'pato_william/itau_mora.jpg', local_path: path.join(TMP_DIR, 'wm_itau_mora.jpg'), filename: 'itau_mora.jpg' },
  // Art. 260 — CAT (Nov = monto, Julio = venc)
  { institucion_cmf: 'CAT (ex CENCOSUD)', tipo_documento: 22, storage_path: 'pato_william/cat_noviembre.pdf', local_path: path.join(TMP_DIR, 'wm_cat_nov.pdf'), filename: 'cat_noviembre.pdf' },
  { institucion_cmf: 'CAT (ex CENCOSUD)', tipo_documento: 23, storage_path: 'pato_william/cat_julio.pdf', local_path: path.join(TMP_DIR, 'wm_cat_jul.pdf'), filename: 'cat_julio.pdf' },
  // Art. 261 representativos
  { institucion_cmf: 'CMR Falabella', tipo_documento: 22, storage_path: 'pato_william/falabella_noviembre.pdf', local_path: path.join(TMP_DIR, 'wm_falabella.pdf'), filename: 'falabella_noviembre.pdf' },
  { institucion_cmf: 'Solventa Tarjetas', tipo_documento: 22, storage_path: 'pato_william/solventa_noviembre.pdf', local_path: path.join(TMP_DIR, 'wm_solventa.pdf'), filename: 'solventa_noviembre.pdf' },
  { institucion_cmf: 'Santander-Chile', tipo_documento: 22, storage_path: 'pato_william/santander_3530_nov.pdf', local_path: path.join(TMP_DIR, 'wm_santander.pdf'), filename: 'santander_3530_nov.pdf' },
  { institucion_cmf: 'Santander Consumer', tipo_documento: 22, storage_path: 'pato_william/santander_consumer.pdf', local_path: path.join(TMP_DIR, 'wm_santander_consumer.pdf'), filename: 'santander_consumer.pdf' },
  // NO-CMF (match por filename con AdditionalCreditor.document_filename)
  { institucion_cmf: 'CCAF Los Andes', tipo_documento: 22, storage_path: 'pato_william/caja_los_andes.pdf', local_path: path.join(TMP_DIR, 'wm_caja.pdf'), filename: 'caja_los_andes.pdf' },
  { institucion_cmf: 'Tesorería General de la República', tipo_documento: 24, storage_path: 'pato_william/tgr_contribuciones.pdf', local_path: path.join(TMP_DIR, 'wm_tgr.pdf'), filename: 'tgr_contribuciones.pdf' },
];

const log = (msg: string) => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  console.log(`[${ts}] ${msg}`);
};
const logger = { log, error: (msg: string, err?: unknown) => console.error(msg, err ?? '') };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function downloadFromStorage(supabase: SupabaseClient<any>, storagePath: string, localPath: string) {
  if (fs.existsSync(localPath)) { log(`  ♻️  Caché: ${path.basename(localPath)}`); return; }
  const { data, error } = await supabase.storage.from('documentos').download(storagePath);
  if (error || !data) throw new Error(`Download failed [${storagePath}]: ${error?.message}`);
  fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
  log(`  ✓ Descargado: ${path.basename(localPath)}`);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const claveUnica = process.env.CLAVE_UNICA_PASSWORD;
  if (!supabaseUrl || !supabaseKey) throw new Error('Faltan variables SUPABASE en .env');
  if (!claveUnica) throw new Error('Falta CLAVE_UNICA_PASSWORD en .env');

  process.env.DRY_RUN = 'true';
  process.env.BYPASS_DATE_CHECK = 'true';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(supabaseUrl, supabaseKey) as SupabaseClient<any>;
  fs.mkdirSync(TMP_DIR, { recursive: true });

  log('⏳ Descargando CMF...');
  await downloadFromStorage(supabase, CMF_STORAGE_PATH, CMF_LOCAL);

  log('⏳ Descargando documentos de acreditación...');
  const seen = new Set<string>();
  for (const doc of MAPPED_DOCS) {
    if (seen.has(doc.storage_path)) continue;
    seen.add(doc.storage_path);
    await downloadFromStorage(supabase, doc.storage_path, doc.local_path!);
  }

  log('\n═══════════════ PLAN WILLIAM ═══════════════');
  log(`Reclasificados → Art.260: ${SENTINEL_RECLASSIFIED.length} (Banco Itaú Chile)`);
  log(`NO-CMF: ${SENTINEL_ADDITIONAL.length} (CCAF Los Andes 261, TGR contribuciones 260)`);
  log(`Overrides CMF (Art.260): ${CMF_OVERRIDES.length} (Internacional, CAT)`);
  log(`Docs mapeados: ${MAPPED_DOCS.length}`);
  log('Esperado: 4 filas en Obligaciones 260 + 7 en Otros Acreedores = 11');
  log('⚠️  FUERA: multa tránsito (Municipalidad de Colina no está en catálogo)');
  log('═════════════════════════════════════════════\n');

  const { browser, page } = await launchBrowser();
  try {
    log('🔒 Login con ClaveÚnica...');
    await loginAndNavigateToStep1(page, CLIENT_RUT, claveUnica, logger);

    const step3Url = `${new URL(page.url()).origin}/miSuperir/autenticado/renegociacion/verAcreedores`;
    log(`→ Navegando a Paso 3: ${step3Url}`);
    await page.goto(step3Url, { waitUntil: 'domcontentloaded' });

    log('📝 Ejecutando fillStep3...');
    const report = await fillStep3(
      page,
      CMF_LOCAL,
      supabase as Parameters<typeof fillStep3>[2],
      logger,
      undefined,
      MAPPED_DOCS,
      SENTINEL_RECLASSIFIED,
      SENTINEL_ADDITIONAL,
      CMF_OVERRIDES
    );

    log('\n═══════════════ RESULTADO ═══════════════');
    log(`Acreedores agregados: ${report.added.length}`);
    for (const a of report.added) log(`  ✅ ${a.institucion} → ${a.nombreCatalogo} ($${a.monto.toLocaleString('es-CL')})`);
    log(`Acreedores saltados: ${report.skipped.length}`);
    for (const s of report.skipped) log(`  ⚠️  ${s.institucion}: ${s.reason}`);
    log('════════════════════════════════════════\n');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message || err);
  process.exit(1);
});
