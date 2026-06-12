/**
 * Test hardcodeado de Step 3 — Caso Claudia Silva (perfil Patricio Martini).
 *
 * Simula el resultado de ambas APIs (Sentinel + Orchestrator) sin consumir créditos,
 * descarga los PDFs reales de Supabase Storage y ejecuta el Playwright real del Paso 3.
 *
 * Uso:
 *   npx ts-node -r dotenv/config src/utils/test_step3_claudia.ts
 *
 * Variables de entorno requeridas:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (sandbox)
 *   CLAVE_UNICA_PASSWORD                     (para RUT 21917363-6)
 *   BYPASS_DATE_CHECK=true                   (documentos de prueba vencidos)
 *   DRY_RUN=true                             (no submit final)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { launchBrowser } from './browser';
import { loginAndNavigateToStep1 } from '../automation/login';
import { fillStep3, AcreditacionDoc } from '../automation/step3_acreedores';
import { ReclassifiedCreditor } from './sentinel';

// ─── Cliente de prueba ────────────────────────────────────────────────────────

const CLIENT_RUT = '21917363-6';
const CMF_STORAGE_PATH = 'patricio_martini/informe_cmf.pdf';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');
const CMF_LOCAL = path.join(TMP_DIR, 'informe_cmf_claudia.pdf');

// ─── Sentinel hardcodeado (API Key #1 simulada) ───────────────────────────────
//
// BCI Consumo: 3 cuotas vencidas, cuota 4 = 03/09/2024 → 91 días al 03/12/2024
// Ripley:      PAGAR HASTA 25/08/2024, 4 ECs sin pago    → 100 días al 03/12/2024

const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [
  {
    bank: 'Banco de Chile',
    product_type: 'credito_consumo',
    institucion_cmf: 'Banco de Chile',
    delinquency_start_date: '2024-09-03',
    delinquency_days: 91,
    total_credito_clp: 48236275,
    new_classification: 'obligaciones_260',
    reason:
      'Informe Crédito 20/11/2024: 3 cuotas vencidas no pagadas. Cuota 4 venció 03/09/2024 = 91 días al 03/12/2024.',
    document_filename: 'Banco de Chile Crédito Consumo - Informe Crédito.pdf',
  },
  {
    bank: 'CAR - Ripley',
    product_type: 'tarjeta_credito',
    institucion_cmf: 'CAR - Ripley',
    delinquency_start_date: '2024-08-25',
    delinquency_days: 100,
    total_credito_clp: 1218565,
    new_classification: 'obligaciones_260',
    reason:
      'EC Agosto 2024: PAGAR HASTA 25/08/2024. 4 ECs consecutivos sin pago. Al 03/12/2024 = 100 días de mora.',
    document_filename: 'RIPLEY AGOSTO.pdf',
  },
];

// ─── Orchestrator hardcodeado (API Key #2 simulada) ──────────────────────────
//
// Docs clasificados por storage_path real en bucket `documentos`.
// tipo_documento: 22=monto, 23=vencimiento, 24=ambos (mismo PDF)
//
// Banco de Chile consumo (Art. 260): Informe Crédito cubre monto + vencimiento (tipo 24)
// CAR - Ripley (Art. 260):           AGOSTO=vencimiento, SEPT+OCT=cadena, NOV=monto
// Banco de Chile tarjeta (Art. 261): EC Octubre 2024, solo monto (tipo 22)

const MAPPED_DOCS: AcreditacionDoc[] = [
  // BCI Consumo — monto (tipo 22, mismo archivo que vencimiento)
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 22,
    storage_path: 'patricio_martini/banco_de_chile_consumo_report.pdf',
    local_path: path.join(TMP_DIR, 'banco_de_chile_consumo_report.pdf'),
  },
  // BCI Consumo — vencimiento (tipo 23, mismo archivo)
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 23,
    storage_path: 'patricio_martini/banco_de_chile_consumo_report.pdf',
    local_path: path.join(TMP_DIR, 'banco_de_chile_consumo_report.pdf'),
  },
  // Ripley — vencimiento: primer mes impago 25/08/2024
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 23,
    storage_path: 'patricio_martini/ripley_estado_cuenta_agosto_2024.pdf',
    local_path: path.join(TMP_DIR, 'ripley_estado_cuenta_agosto_2024.pdf'),
  },
  // Ripley — vencimiento cadena (sept)
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 23,
    storage_path: 'patricio_martini/ripley_estado_cuenta_septiembre_2024.pdf',
    local_path: path.join(TMP_DIR, 'ripley_estado_cuenta_septiembre_2024.pdf'),
  },
  // Ripley — vencimiento cadena (oct)
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 23,
    storage_path: 'patricio_martini/ripley_estado_cuenta_octubre_2024.pdf',
    local_path: path.join(TMP_DIR, 'ripley_estado_cuenta_octubre_2024.pdf'),
  },
  // Ripley — monto (saldo $1.218.565 al 10/11/2024)
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 22,
    storage_path: 'patricio_martini/ripley_estado_cuenta_noviembre_2024.pdf',
    local_path: path.join(TMP_DIR, 'ripley_estado_cuenta_noviembre_2024.pdf'),
  },
  // BdChile Tarjeta — Art. 261 — solo monto ($65.864 al 22/10/2024)
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 22,
    storage_path: 'patricio_martini/banco_de_chile_tarjeta_octubre_2024.pdf',
    local_path: path.join(TMP_DIR, 'banco_de_chile_tarjeta_octubre_2024.pdf'),
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
  log('⏳ Descargando CMF desde Storage...');
  await downloadFromStorage(supabase, CMF_STORAGE_PATH, CMF_LOCAL);

  // 2. Descargar docs de acreditación (deduplica por storage_path)
  log('⏳ Descargando documentos de acreditación...');
  const seen = new Set<string>();
  for (const doc of MAPPED_DOCS) {
    if (seen.has(doc.storage_path)) continue;
    seen.add(doc.storage_path);
    await downloadFromStorage(supabase, doc.storage_path, doc.local_path!);
  }

  // 3. Mostrar resumen del plan hardcodeado
  log('\n═══════════════ PLAN HARDCODEADO ═══════════════');
  log(`Sentinel reclassified (→ Art. 260): ${SENTINEL_RECLASSIFIED.length}`);
  for (const r of SENTINEL_RECLASSIFIED) log(`  • ${r.institucion_cmf} (${r.delinquency_days}d mora, $${r.total_credito_clp.toLocaleString('es-CL')})`);
  log(`Docs mapeados para Playwright: ${MAPPED_DOCS.length}`);
  for (const d of MAPPED_DOCS) log(`  • [tipo ${d.tipo_documento}] ${d.institucion_cmf} → ${path.basename(d.storage_path)}`);
  log('═══════════════════════════════════════════════\n');

  // 4. Lanzar Playwright y login
  log('🚀 Lanzando navegador Playwright...');
  const { browser, page } = await launchBrowser();

  try {
    log('🔒 Login con ClaveÚnica...');
    await loginAndNavigateToStep1(page, CLIENT_RUT, claveUnica, logger);

    // 5. Navegar a Paso 3
    const baseUrl = new URL(page.url()).origin;
    const step3Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verAcreedores`;
    log(`→ Navegando a Paso 3: ${step3Url}`);
    await page.goto(step3Url, { waitUntil: 'domcontentloaded' });

    // 6. Ejecutar fillStep3 con datos hardcodeados
    log('📝 Ejecutando fillStep3 con datos hardcodeados...');
    const report = await fillStep3(
      page,
      CMF_LOCAL,
      supabase as Parameters<typeof fillStep3>[2],
      logger,
      undefined,           // boletinComercialPath
      MAPPED_DOCS,
      SENTINEL_RECLASSIFIED
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
