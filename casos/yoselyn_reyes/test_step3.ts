/**
 * Test hardcodeado de Step 3 — Caso Yoselyn Yudith Reyes Sánchez (perfil Patricio Martini).
 *
 * Simula el resultado de ambas APIs (Sentinel + Orchestrator) sin consumir créditos,
 * descarga los PDFs reales de Supabase Storage y ejecuta el Playwright real del Paso 3.
 *
 * ──────────────────────────────────────────────────────────────
 * ESTRUCTURA DEL CASO (corte CMF ~diciembre 2025):
 *
 *  Art. 260 (mora ≥91d, DIRECTOS en CMF — sin reclasificación Sentinel):
 *    • Banco Estado (Consumo, op. 38173330): mora desde 05/11/2025, 115d
 *      CMF $3.194.822 → doc $3.311.717 (override de monto y fecha)
 *    • Banco de Crédito e Inversiones (Consumo, op. D06100187077): mora desde 05/11/2025, 115d
 *      CMF $7.911.253 → doc $7.264.344 (override de monto y fecha)
 *    • CAR - Ripley (Tarjeta): mora desde 30/11/2025, 90d al 28/02/2026
 *      CMF $663.238 = doc $663.238 (solo override de fecha)
 *    • CMR Falabella (Tarjeta): mora desde 10/11/2025, 110d
 *      CMF $2.424.857 = doc $2.424.857 (solo override de fecha)
 *
 *  Art. 261 (vigente, en CMF):
 *    • Coopeuch (Consumo): $12.838.870 al día
 *
 *  Art. 261 NO-CMF (Sentinel additional — Caja Los Andes no figura en CMF):
 *    • Caja Los Andes Crédito 1: $513.124 vigente
 *    • Caja Los Andes Crédito 2: $649.310 vigente
 *    • Caja Los Andes Crédito 3: $12.551.466 vigente
 *
 * ──────────────────────────────────────────────────────────────
 * NOTA RIPLEY: Los 4 EECCs están registrados como tipo 24. Solo el primero
 * (Ripley Noviembre.pdf) se sube al portal (único slot tipo 24 por acreedor).
 * El monto final $663.238 se confirma vía `30_11 CAR YOSELYN.pdf` (cmfDocumentOverride).
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/yoselyn_reyes/test_step3.ts
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
import { fillStep3, AcreditacionDoc, CmfDocumentOverride } from '../../src/automation/step3_acreedores';
import { ReclassifiedCreditor, AdditionalCreditor } from '../../src/utils/sentinel';

// ─── Cliente de prueba ────────────────────────────────────────────────────────

const CLIENT_RUT = '21917363-6'; // RUT de Pato Martini (portal de prueba)
const CMF_STORAGE_PATH = 'yoselyn_reyes/informe_cmf.pdf';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');
const CMF_LOCAL = path.join(TMP_DIR, 'informe_cmf_yoselyn.pdf');

// ─── Sentinel hardcodeado (API Key #1 simulada) ───────────────────────────────
//
// Yoselyn no necesita reclasificación: todos sus acreedores con mora ≥91d
// ya aparecen en el CMF con overdue90Days > 0.
// Los únicos "adicionales" son los 3 créditos de Caja Los Andes (NO-CMF, Art. 261).

const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [];

const SENTINEL_ADDITIONAL: AdditionalCreditor[] = [
  {
    // CCAF Los Andes no figura en el CMF. Tres créditos vigentes al día → Art. 261.
    // En el catálogo figura como "CCAF Los Andes" (RUT 81826800-9), no "Caja Los Andes".
    // Descuentos por planilla: $378.963/mes (se suspenden al iniciar renegociación).
    bank: 'Caja Los Andes',
    product_type: 'credito_consumo',
    institucion_cmf: 'CCAF Los Andes',
    categoria_articulo: 261,
    total_credito_clp: 513124,
    reason:
      'Caja Los Andes Crédito 1 (op. 17.017CON105380854-4). No figura en CMF. ' +
      'Saldo $513.124 vigente, cuota $20.105, otorgado 16/12/2025.',
    document_filename: 'credito Caja los andes.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'Caja Los Andes',
    product_type: 'credito_consumo',
    institucion_cmf: 'CCAF Los Andes',
    categoria_articulo: 261,
    total_credito_clp: 649310,
    reason:
      'Caja Los Andes Crédito 2 (op. 212.212DIG100224378-8). No figura en CMF. ' +
      'Saldo $649.310 vigente, cuota $23.802, otorgado 23/02/2026.',
    document_filename: 'Credito los andes 2.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'Caja Los Andes',
    product_type: 'credito_consumo',
    institucion_cmf: 'CCAF Los Andes',
    categoria_articulo: 261,
    total_credito_clp: 12551466,
    reason:
      'Caja Los Andes Crédito 3 (op. 17.017CON105405290-0). No figura en CMF. ' +
      'Saldo $12.551.466 vigente, cuota $366.561, otorgado 05/03/2026.',
    document_filename: 'Credito los andes 3.pdf',
    needs_lawyer_confirmation: true,
  },
];

// ─── Overrides de monto y fecha de vencimiento (desde documentos reales) ──────
//
// Los acreedores Art. 260 ya están en el CMF con overdue90Days > 0.
// Los montos del certificado bancario difieren del CMF (lag de fecha de corte):
//   • Banco Estado:  CMF $3.194.822 → certificado 11/03/2026 → $3.311.717
//   • BCI:           CMF $7.911.253 → certificado 11/03/2026 → $7.264.344
//   • CAR Ripley:    CMF $663.238   = cupo utilizado (sin delta)
//   • CMR Falabella: CMF $2.424.857 = cupo utilizado (sin delta)
//
// Las fechas de vencimiento son reales (no el placeholder dateDaysAgo(90)).

const CMF_OVERRIDES: CmfDocumentOverride[] = [
  {
    institucion_cmf: 'Banco Estado',
    monto_clp: 3311717,
    fecha_vencimiento: '2025-11-05',   // Cuota 1 venció 05/11/2025
  },
  {
    institucion_cmf: 'Banco de Crédito e Inversiones',
    monto_clp: 7264344,
    fecha_vencimiento: '2025-11-05',   // Cuota 10 venció 05/11/2025
  },
  {
    institucion_cmf: 'CAR - Ripley',
    // monto sin override (CMF $663.238 = doc)
    fecha_vencimiento: '2025-11-30',   // EECC noviembre: vencimiento 30/11/2025
  },
  {
    institucion_cmf: 'CMR Falabella',
    // monto sin override (CMF $2.424.857 = cupo utilizado doc)
    fecha_vencimiento: '2025-11-10',   // EECC noviembre: vencimiento 10/11/2025
  },
];

// ─── Orchestrator hardcodeado (API Key #2 simulada) ──────────────────────────
//
// tipo_documento: 22=monto, 23=vencimiento, 24=monto+vencimiento en un solo doc
//
// Banco Estado (Art. 260):
//   • CERTIFICADO BANCO ESTADO.pdf → tipo 24 (monto $3.311.717 + venc. 05/11/2025)
//
// Banco de Crédito e Inversiones (Art. 260):
//   • CERTIFICADO BCI.pdf → tipo 24 (monto $7.264.344 + venc. 05/11/2025)
//
// CAR - Ripley (Art. 260, cadena de 4 EECCs):
//   • Ripley Noviembre.pdf → tipo 24 (primera mora, venc. 30/11/2025) ← se sube
//   • Ripley Diciembre.pdf → tipo 24 (cadena) ← omitido ("ya adjuntado")
//   • Ripley Enero.pdf    → tipo 24 (cadena) ← omitido
//   • 30_11 CAR YOSELYN.pdf → tipo 24 (final, $663.238) ← omitido
//
// CMR Falabella (Art. 260):
//   • 260 CMR YOSLEYN.pdf → tipo 24 (4 EECCs consolidados, venc. 10/11/2025)
//
// Coopeuch (Art. 261, vigente):
//   • CERTIFICADO COOPEUCH.pdf → tipo 22 (monto $12.838.870)
//
// Caja Los Andes NO-CMF (Art. 261 × 3 — match por filename):
//   • credito Caja los andes.pdf → tipo 22 ($513.124)
//   • Credito los andes 2.pdf   → tipo 22 ($649.310)
//   • Credito los andes 3.pdf   → tipo 22 ($12.551.466)

const MAPPED_DOCS: AcreditacionDoc[] = [
  // ── Banco Estado — certificado oficial (tipo 24) ──────────────────────────
  {
    institucion_cmf: 'Banco Estado',
    tipo_documento: 24,
    storage_path: 'yoselyn_reyes/certificado_banco_estado.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_cert_banco_estado.pdf'),
    filename: 'CERTIFICADO BANCO ESTADO.pdf',
  },
  // ── BCI — certificado oficial (tipo 24) ───────────────────────────────────
  {
    institucion_cmf: 'Banco de Crédito e Inversiones',
    tipo_documento: 24,
    storage_path: 'yoselyn_reyes/certificado_bci.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_cert_bci.pdf'),
    filename: 'CERTIFICADO BCI.pdf',
  },
  // ── CAR - Ripley — 4 EECCs (tipo 24 cada uno) ────────────────────────────
  // Solo el primero se sube al portal (un slot tipo 24 por acreedor).
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 24,
    storage_path: 'yoselyn_reyes/ripley_noviembre_2025.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_ripley_noviembre.pdf'),
    filename: 'Ripley Noviembre.pdf',
  },
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 24,
    storage_path: 'yoselyn_reyes/ripley_diciembre_2025.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_ripley_diciembre.pdf'),
    filename: 'Ripley Diciembre.pdf',
  },
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 24,
    storage_path: 'yoselyn_reyes/ripley_enero_2026.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_ripley_enero.pdf'),
    filename: 'Ripley Enero.pdf',
  },
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 24,
    storage_path: 'yoselyn_reyes/ripley_febrero_2026.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_ripley_febrero.pdf'),
    filename: '30_11 CAR YOSELYN.pdf',
  },
  // ── CMR Falabella — PDF consolidado 4 EECCs (tipo 24) ────────────────────
  {
    institucion_cmf: 'CMR Falabella',
    tipo_documento: 24,
    storage_path: 'yoselyn_reyes/cmr_consolidado_4_eecc.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_cmr_consolidado.pdf'),
    filename: '260 CMR YOSLEYN.pdf',
  },
  // ── Coopeuch — certificado deuda vigente (tipo 22) ────────────────────────
  {
    institucion_cmf: 'Coopeuch',
    tipo_documento: 22,
    storage_path: 'yoselyn_reyes/certificado_coopeuch.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_cert_coopeuch.pdf'),
    filename: 'CERTIFICADO COOPEUCH.pdf',
  },
  // ── Caja Los Andes NO-CMF × 3 (tipo 22 cada uno, match por filename) ─────
  {
    institucion_cmf: 'Caja Los Andes',
    tipo_documento: 22,
    storage_path: 'yoselyn_reyes/caja_andes_credito_1.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_caja_andes_1.pdf'),
    filename: 'credito Caja los andes.pdf',
  },
  {
    institucion_cmf: 'Caja Los Andes',
    tipo_documento: 22,
    storage_path: 'yoselyn_reyes/caja_andes_credito_2.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_caja_andes_2.pdf'),
    filename: 'Credito los andes 2.pdf',
  },
  {
    institucion_cmf: 'Caja Los Andes',
    tipo_documento: 22,
    storage_path: 'yoselyn_reyes/caja_andes_credito_3.pdf',
    local_path: path.join(TMP_DIR, 'yoselyn_caja_andes_3.pdf'),
    filename: 'Credito los andes 3.pdf',
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
  log('⏳ Descargando CMF de Yoselyn desde Storage...');
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
  log(`Sentinel reclassified: ${SENTINEL_RECLASSIFIED.length} (ninguno — todos Art.260 directos del CMF)`);
  log(`Sentinel additional (NO-CMF): ${SENTINEL_ADDITIONAL.length}`);
  for (const a of SENTINEL_ADDITIONAL) {
    log(`  • ${a.bank} [Art. ${a.categoria_articulo}]: $${a.total_credito_clp.toLocaleString('es-CL')} → ${a.document_filename}`);
  }
  log(`Overrides de monto/fecha (cmfDocumentOverrides): ${CMF_OVERRIDES.length}`);
  for (const o of CMF_OVERRIDES) {
    const montoStr = o.monto_clp ? `monto $${o.monto_clp.toLocaleString('es-CL')} + ` : '';
    log(`  • ${o.institucion_cmf}: ${montoStr}venc. ${o.fecha_vencimiento}`);
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
      SENTINEL_RECLASSIFIED,  // vacío — sin reclasificaciones para Yoselyn
      SENTINEL_ADDITIONAL,    // 3 créditos Caja Los Andes (NO-CMF, Art. 261)
      CMF_OVERRIDES           // montos reales y fechas de vencimiento exactas
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
