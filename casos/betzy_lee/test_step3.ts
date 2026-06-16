/**
 * Test hardcodeado de Step 3 — Caso Betzy Laishan Lee Chio Zurita (perfil Patricio Martini).
 *
 * Simula el resultado de ambas APIs (Sentinel + Orchestrator) sin consumir créditos,
 * descarga los PDFs reales de Supabase Storage y ejecuta el Playwright real del Paso 3.
 *
 * ──────────────────────────────────────────────────────────────
 * CASO SENTINEL: El CMF (corte 17/10/2025) solo tiene UNA entrada de Banco de Chile
 * (el crédito de consumo, $19.195.091) con $0 en mora 90+ días.
 * Los certificados de noviembre 2025 acreditan mora real en DOS productos:
 *
 *   • BdCh Crédito de Consumo (op. 20933): en CMF → RECLASIFICADO Art. 261→260
 *   • BdCh Tarjeta Visa (op. 0856 / Socofin): NO está en el CMF → ADDITIONAL Art. 260
 *
 * La tarjeta Visa NO puede ser "reclasificada" porque no tiene fila en el CMF.
 * Se declara como AdditionalCreditor (acreedor fuera del CMF, categoria_articulo: 260).
 * CAT Cencosud, CMR Falabella y PRESTO LIDER permanecen en Art. 261 (vigentes o <91d).
 * ──────────────────────────────────────────────────────────────
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/betzy_lee/test_step3.ts
 *
 * Variables de entorno requeridas:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (sandbox)
 *   CLAVE_UNICA_PASSWORD                     (para RUT 21917363-6)
 *   BYPASS_DATE_CHECK=true                   (documentos de prueba vencidos)
 *   DRY_RUN=true                             (no submit final — se activa automáticamente)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { launchBrowser } from '../../src/utils/browser';
import { loginAndNavigateToStep1 } from '../../src/automation/login';
import { fillStep3, AcreditacionDoc } from '../../src/automation/step3_acreedores';
import { ReclassifiedCreditor, AdditionalCreditor } from '../../src/utils/sentinel';

// ─── Cliente de prueba ────────────────────────────────────────────────────────

const CLIENT_RUT = '21917363-6'; // RUT de Pato Martini (portal de prueba)
const CMF_STORAGE_PATH = 'betzy_lee/informe_cmf.pdf';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');
const CMF_LOCAL = path.join(TMP_DIR, 'informe_cmf_betzy.pdf');

// ─── Sentinel hardcodeado (API Key #1 simulada) ───────────────────────────────
//
// El CMF de Betzy (corte 17/10/2025) registra $0 mora para Banco de Chile.
// Los certificados bancarios de noviembre 2025 demuestran mora real ≥ 91 días.
//
// Dos productos de BdCh en mora, pero el CMF solo tiene UNA entrada (consumo, $19.195.091).
// La tarjeta Visa (operación 0856) NO aparece como línea separada en el CMF
// → NO puede ser "reclasificada" (reclasificación requiere una entrada CMF que cambiar).
// → Se declara como acreedor ADICIONAL (NO-CMF, Art. 260) vía SENTINEL_ADDITIONAL.
//
// RECLASSIFIED: solo el consumo (hay una sola entrada BdCh en el CMF).
// ADDITIONAL:   la tarjeta Visa (fuera del CMF, mora real 111 días, Art. 260).

const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [
  {
    // Crédito de Consumo (operación 20933) — SÍ aparece en el CMF ($19.195.091)
    bank: 'Banco de Chile',
    product_type: 'credito_consumo',
    institucion_cmf: 'Banco de Chile',
    delinquency_start_date: '2025-08-04',   // Cuota 20 venció 04/08/2025
    delinquency_days: 114,                   // al 26/11/2025 (fecha informe Socofin)
    total_credito_clp: 18191754,             // saldo según informeCredito.pdf (13/11/2025)
    new_classification: 'obligaciones_260',
    reason:
      'informeCredito.pdf (13/11/2025): 4 cuotas vencidas. Cuota 20 venció 04/08/2025 → 114 días al 26/11/2025. CMF mostraba $0 mora (corte 17/10/2025 = solo 74d).',
    document_filename: 'informeCredito.pdf',
  },
];

const SENTINEL_ADDITIONAL: AdditionalCreditor[] = [
  {
    // Tarjeta de Crédito Visa (operación 0856 / Socofin) — NO aparece en el CMF
    // El CMF registra solo una línea BdCh (el consumo). La tarjeta es un producto
    // distinto no reportado en el corte CMF → acreedor adicional fuera del CMF.
    bank: 'Banco de Chile',
    product_type: 'tarjeta_credito',
    institucion_cmf: 'Banco de Chile',
    categoria_articulo: 260,
    total_credito_clp: 3716235,              // saldo según certificado Socofin (26/11/2025)
    delinquency_start_date: '2025-08-07',   // fecha de vencimiento declarada en Socofin
    delinquency_days: 111,                   // al 26/11/2025
    reason:
      'Tarjeta Visa (op. 0856) no aparece como entrada separada en el CMF. ' +
      'Certificado Socofin (26/11/2025) acredita mora desde 07/08/2025 → 111 días. ' +
      'Dos productos distintos del mismo banco: consumo (en CMF) + tarjeta (fuera del CMF).',
    document_filename: 'Estado de deudas banco de chile socofin.pdf',
    needs_lawyer_confirmation: true,
  },
];

// ─── Orchestrator hardcodeado (API Key #2 simulada) ──────────────────────────
//
// tipo_documento: 22=monto, 23=vencimiento, 24=monto+vencimiento en un solo doc
//
// Banco de Chile Consumo (Art. 260, reclasificado):
//   • informeCredito.pdf → tipo 22 (monto $18.191.754)
//   • 4_8_banco_chile_vencimiento_cuota_20.png → tipo 23 (vencimiento cuota 20: 04/08/2025)
//
// Banco de Chile Tarjeta (Art. 260, reclasificado):
//   • Estado de deudas banco de chile socofin.pdf → tipo 24 (monto $3.716.235 + venc. 07/08/2025)
//
// CAT (ex CENCOSUD) (Art. 261, vigente):
//   • Octubre_2025 cencosud.pdf → tipo 22 (monto $9.262.634)
//
// CMR Falabella (Art. 261, vigente):
//   • cmr estado de cuenta octubre.pdf → tipo 22 (monto $1.173.246)
//
// PRESTO LIDER (Art. 261, 62d mora):
//   • lider bci estado de cuenta octubre.pdf → tipo 22 (monto $682.194)

const MAPPED_DOCS: AcreditacionDoc[] = [
  // ── BdCh Consumo — monto (tipo 22) ───────────────────────────────────────
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 22,
    storage_path: 'betzy_lee/bch_informe_credito_consumo.pdf',
    local_path: path.join(TMP_DIR, 'betzy_bch_informe_credito_consumo.pdf'),
    filename: 'informeCredito.pdf',
  },
  // ── BdCh Consumo — vencimiento (tipo 23): Aviso Vencimiento agosto (PDF) ──
  // El portal no acepta PNG → se usa el Aviso de Vencimiento oficial (PDF).
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 23,
    storage_path: 'betzy_lee/bch_aviso_vencimiento_agosto.pdf',
    local_path: path.join(TMP_DIR, 'betzy_bch_aviso_vencimiento_agosto.pdf'),
    filename: 'AvisoVencimientoCredito banco de chile agosto.pdf',
  },
  // ── BdCh Tarjeta Visa — monto + vencimiento (tipo 24): Socofin ───────────
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 24,
    storage_path: 'betzy_lee/bch_socofin_tarjeta.pdf',
    local_path: path.join(TMP_DIR, 'betzy_bch_socofin_tarjeta.pdf'),
    filename: 'Estado de deudas banco de chile socofin.pdf',
  },
  // ── CAT (ex CENCOSUD) — monto (tipo 22): EECC octubre 2025 ──────────────
  {
    institucion_cmf: 'CAT (ex CENCOSUD)',
    tipo_documento: 22,
    storage_path: 'betzy_lee/cat_cencosud_eecc_octubre.pdf',
    local_path: path.join(TMP_DIR, 'betzy_cat_cencosud_eecc_octubre.pdf'),
    filename: 'Octubre_2025 cencosud.pdf',
  },
  // ── CMR Falabella — monto (tipo 22): EECC octubre 2025 ───────────────────
  {
    institucion_cmf: 'CMR Falabella',
    tipo_documento: 22,
    storage_path: 'betzy_lee/cmr_eecc_octubre.pdf',
    local_path: path.join(TMP_DIR, 'betzy_cmr_eecc_octubre.pdf'),
    filename: 'cmr estado de cuenta octubre.pdf',
  },
  // ── PRESTO LIDER — monto (tipo 22): EECC octubre 2025 ────────────────────
  {
    institucion_cmf: 'PRESTO LIDER',
    tipo_documento: 22,
    storage_path: 'betzy_lee/lider_bci_eecc_octubre.pdf',
    local_path: path.join(TMP_DIR, 'betzy_lider_bci_eecc_octubre.pdf'),
    filename: 'lider bci estado de cuenta octubre.pdf',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const log = (msg: string) => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  console.log(`[${ts}] ${msg}`);
};
const logger = { log, error: (msg: string, err?: unknown) => console.error(msg, err ?? '') };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function downloadFromStorage(
  supabase: SupabaseClient<any>,
  storagePath: string,
  localPath: string
): Promise<void> {
  if (fs.existsSync(localPath)) {
    log(`  ♻️  Ya existe localmente: ${path.basename(localPath)}`);
    return;
  }
  const { data, error } = await supabase.storage.from('documentos').download(storagePath);
  if (error || !data) throw new Error(`Storage download failed [${storagePath}]: ${error?.message}`);
  fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
  log(`  ✓ Descargado: ${path.basename(localPath)}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const claveUnica = process.env.CLAVE_UNICA_PASSWORD;

  if (!supabaseUrl || !supabaseKey) throw new Error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
  if (!claveUnica) throw new Error('Falta CLAVE_UNICA_PASSWORD en .env (requerida para RUT 21917363-6)');

  process.env.DRY_RUN = 'true';
  process.env.BYPASS_DATE_CHECK = 'true';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(supabaseUrl, supabaseKey) as SupabaseClient<any>;
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // 1. Descargar CMF
  log('⏳ Descargando CMF de Betzy desde Storage...');
  await downloadFromStorage(supabase, CMF_STORAGE_PATH, CMF_LOCAL);

  // 2. Descargar docs de acreditación (deduplica por storage_path)
  log('⏳ Descargando documentos de acreditación...');
  const seen = new Set<string>();
  for (const doc of MAPPED_DOCS) {
    if (seen.has(doc.storage_path)) continue;
    seen.add(doc.storage_path);
    await downloadFromStorage(supabase, doc.storage_path, doc.local_path!);
  }

  // 3. Resumen del plan
  log('\n═══════════════ PLAN HARDCODEADO ═══════════════');
  log(`Sentinel reclassified (→ Art. 260, en CMF): ${SENTINEL_RECLASSIFIED.length}`);
  for (const r of SENTINEL_RECLASSIFIED) {
    log(`  • ${r.product_type} ${r.institucion_cmf}: ${r.delinquency_days}d mora desde ${r.delinquency_start_date}, $${r.total_credito_clp.toLocaleString('es-CL')}`);
  }
  log(`Sentinel additional (NO-CMF): ${SENTINEL_ADDITIONAL.length}`);
  for (const a of SENTINEL_ADDITIONAL) {
    log(`  • ${a.product_type} ${a.institucion_cmf} [Art. ${a.categoria_articulo}]: ${a.delinquency_days}d mora, $${a.total_credito_clp.toLocaleString('es-CL')}`);
  }
  log(`Docs mapeados: ${MAPPED_DOCS.length}`);
  for (const d of MAPPED_DOCS) log(`  • [tipo ${d.tipo_documento}] ${d.institucion_cmf} → ${d.filename}`);
  log('═══════════════════════════════════════════════\n');

  // 4. Lanzar Playwright y login
  log('🚀 Lanzando navegador Playwright...');
  const { browser, page } = await launchBrowser();

  try {
    log('🔒 Login con ClaveÚnica (RUT 21917363-6)...');
    await loginAndNavigateToStep1(page, CLIENT_RUT, claveUnica, logger);

    // 5. Navegar a Paso 3
    const baseUrl = new URL(page.url()).origin;
    const step3Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verAcreedores`;
    log(`→ Navegando a Paso 3: ${step3Url}`);
    await page.goto(step3Url, { waitUntil: 'domcontentloaded' });

    // 6. Ejecutar fillStep3 con datos hardcodeados
    log('📝 Ejecutando fillStep3...');
    const report = await fillStep3(
      page,
      CMF_LOCAL,
      supabase as Parameters<typeof fillStep3>[2],
      logger,
      undefined,              // boletinComercialPath
      MAPPED_DOCS,
      SENTINEL_RECLASSIFIED,
      SENTINEL_ADDITIONAL,    // tarjeta Visa BdCh — NO-CMF, Art. 260, mora 111d
      []                      // cmfDocumentOverrides: los reclasificados usan sus propios montos/fechas
    );

    log('\n═══════════════ RESULTADO ═══════════════');
    log(`Acreedores agregados: ${report.added.length}`);
    for (const a of report.added) {
      log(`  ✅ ${a.institucion} → ${a.nombreCatalogo} ($${a.monto.toLocaleString('es-CL')})`);
    }
    if (report.skipped.length > 0) {
      log(`Acreedores saltados: ${report.skipped.length}`);
      for (const s of report.skipped) log(`  ⚠️  ${s.institucion}: ${s.reason}`);
    }
    log('════════════════════════════════════════\n');

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message || err);
  process.exit(1);
});
