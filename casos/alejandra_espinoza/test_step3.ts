/**
 * Test hardcodeado de Step 3 — Caso Alejandra Espinoza (perfil Patricio Martini).
 *
 * Simula el resultado de ambas APIs (Sentinel + Orchestrator) sin consumir créditos,
 * descarga los PDFs reales de Supabase Storage y ejecuta el Playwright real del Paso 3.
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/alejandra_espinoza/test_step3.ts
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
import { launchBrowser } from '../../src/utils/browser';
import { loginAndNavigateToStep1 } from '../../src/automation/login';
import { fillStep3, AcreditacionDoc, CmfDocumentOverride } from '../../src/automation/step3_acreedores';
import { ReclassifiedCreditor, AdditionalCreditor } from '../../src/utils/sentinel';

// ─── Cliente de prueba ────────────────────────────────────────────────────────

const CLIENT_RUT = '21917363-6'; // RUT de Pato Martini para login en portal de pruebas
const CMF_STORAGE_PATH = 'pato_alejandra/informe_cmf.pdf';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');
const CMF_LOCAL = path.join(TMP_DIR, 'informe_cmf_alejandra.pdf');

// ─── Sentinel hardcodeado (API Key #1 simulada) ───────────────────────────────
//
// Alejandra ya tiene mora >= 91 días en el CMF para CAT (ex CENCOSUD) y CMR Falabella.
// Por ende, no requiere reclasificaciones adicionales.
const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [];

// ─── Acreedores NO-CMF hardcodeados (lo que devolvería la reconciliación) ─────
//
// Las 2 tarjetas de Banco de Chile (Visa Platinium + Visa Entel) NO aparecen en
// el CMF pero deben declararse. Están al día → Art. 261, acreditan solo monto.
const SENTINEL_ADDITIONAL: AdditionalCreditor[] = [
  {
    bank: 'Banco de Chile',
    institucion_cmf: 'Banco de Chile',
    product_type: 'tarjeta_credito',
    categoria_articulo: 261,
    total_credito_clp: 517442,
    reason: 'Tarjeta Visa Platinium con cupo propio, NO listada en el CMF. CPF de portabilidad acredita monto, sin morosidad → Art. 261.',
    document_filename: 'CPF-1767634532-649919-cl-REDBANC-ICL 6.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'Banco de Chile',
    institucion_cmf: 'Banco de Chile',
    product_type: 'tarjeta_credito',
    categoria_articulo: 261,
    total_credito_clp: 1407530,
    reason: 'Tarjeta Visa Entel con cupo propio, NO listada en el CMF. Mismo CPF de portabilidad acredita monto, sin morosidad → Art. 261.',
    document_filename: 'CPF-1767634532-649919-cl-REDBANC-ICL 6.pdf',
    needs_lawyer_confirmation: true,
  },
];

// ─── Override de monto/vencimiento "según documento" para los 260 directos del CMF ──
// CAT y CMR vienen como 260 directos del CMF (no reclasificados). El CMF no tiene la
// fecha de la cuota impaga y su monto está desfasado; el documento sí. En producción
// esto lo poblaría el Orquestador; acá se hardcodea para probar la mecánica.
const CMF_OVERRIDES: CmfDocumentOverride[] = [
  { institucion_cmf: 'CAT (ex CENCOSUD)', monto_clp: 11275392, fecha_vencimiento: '2025-09-05' },
  { institucion_cmf: 'CMR Falabella', monto_clp: 1781499, fecha_vencimiento: '2025-08-25' },
];

// ─── Orchestrator hardcodeado (API Key #2 simulada) ──────────────────────────
//
// Docs clasificados por storage_path real en bucket `documentos`.
// tipo_documento: 22=monto, 23=vencimiento, 24=ambos (mismo PDF)
const MAPPED_DOCS: AcreditacionDoc[] = [
  // CAT (ex CENCOSUD) — vencimiento (Agosto 2025, venció 05/09/2025)
  {
    institucion_cmf: 'CAT (ex CENCOSUD)',
    tipo_documento: 23,
    storage_path: 'pato_alejandra/cat_cencosud_agosto_2025.pdf',
    local_path: path.join(TMP_DIR, 'cat_cencosud_agosto_2025.pdf'),
    filename: 'Agosto_2025_EECC.pdf',
  },
  // CAT (ex CENCOSUD) — monto (Diciembre 2025, saldo total $11.275.392)
  {
    institucion_cmf: 'CAT (ex CENCOSUD)',
    tipo_documento: 22,
    storage_path: 'pato_alejandra/cat_cencosud_diciembre_2025.pdf',
    local_path: path.join(TMP_DIR, 'cat_cencosud_diciembre_2025.pdf'),
    filename: 'Diciembre_2025_EECC.pdf',
  },
  // CMR Falabella — vencimiento y monto (Diciembre 2025, vencimiento 25/08/2025 en aviso de cobranza, saldo $1.781.499)
  {
    institucion_cmf: 'CMR Falabella',
    tipo_documento: 23,
    storage_path: 'pato_alejandra/cmr_falabella_diciembre_2025.pdf',
    local_path: path.join(TMP_DIR, 'cmr_falabella_diciembre_2025.pdf'),
    filename: 'Diciembre_2025_CMR.pdf',
  },
  {
    institucion_cmf: 'CMR Falabella',
    tipo_documento: 22,
    storage_path: 'pato_alejandra/cmr_falabella_diciembre_2025.pdf',
    local_path: path.join(TMP_DIR, 'cmr_falabella_diciembre_2025.pdf'),
    filename: 'Diciembre_2025_CMR.pdf',
  },
  // Banco de Chile — monto de consumo (saldo $3.125.486). CMF → Art. 261.
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 22,
    storage_path: 'pato_alejandra/chile_consumo_consulta.pdf',
    local_path: path.join(TMP_DIR, 'chile_consumo_consulta.pdf'),
    filename: 'consultaCredito DE CONSUMO.pdf',
  },
  // Banco de Chile — CPF de portabilidad: acredita el MONTO de las 2 tarjetas NO-CMF.
  // Se asocia por filename (coincide con AdditionalCreditor.document_filename).
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 22,
    storage_path: 'pato_alejandra/chile_certificado_liquidacion.pdf',
    local_path: path.join(TMP_DIR, 'chile_certificado_liquidacion.pdf'),
    filename: 'CPF-1767634532-649919-cl-REDBANC-ICL 6.pdf',
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
  log(`Sentinel reclassified (→ Art. 260): ${SENTINEL_RECLASSIFIED.length} (CAT y CMR ya vienen 260 del CMF)`);
  log(`Acreedores NO-CMF (Art. 261): ${SENTINEL_ADDITIONAL.length}`);
  for (const a of SENTINEL_ADDITIONAL) log(`  • ${a.bank} ${a.product_type} $${a.total_credito_clp.toLocaleString('es-CL')}`);
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
