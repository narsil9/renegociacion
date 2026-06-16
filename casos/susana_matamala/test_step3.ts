/**
 * Test hardcodeado de Step 3 — Caso Susana Valeria Matamala Fuica (perfil Patricio Martini).
 *
 * ──────────────────────────────────────────────────────────────
 * ESTRUCTURA DEL CASO (CMF corte 05/12/2025):
 *
 *  Art. 260 (mora ≥91d — directos en CMF, sin reclasificación Sentinel):
 *    • Banco de Chile [Consumo]:
 *        CMF $11.601.044 (90+d: $2.570.000).
 *        El CMF agrupa las 3 operaciones del certificado Socofin en UNA entrada:
 *          - Op. 34579  Línea CTE:      capital $2.570.000, venc. 04/09/2025
 *          - Op. 01235  Tarjeta:        capital $9.031.044, venc. 08/09/2025
 *          - Op. 34849  Varios Deudores: capital $134.637, venc. 04/09/2025
 *        Total Socofin (c/intereses+gestión): $3.030.497 + $10.107.707 + $166.758 = $13.304.962.
 *        Override: monto → $13.304.962, vencimiento → 04/09/2025 (el más antiguo).
 *    • CMR Falabella [Consumo]:
 *        CMF $5.146.199 (90+d: $355.738). EECC enero 2026 → $5.515.144, venc. 25/08/2025.
 *
 *  Art. 261 (vigente — en CMF, sin mora legal):
 *    • CAT (ex CENCOSUD):  CMF $16.910.767 → EECC oct 2025 → $17.265.985
 *    • CAR - Ripley:       CMF $52.560     → EECC nov 2025 → $93.275
 *
 *  Sin NO-CMF adicionales.
 * ──────────────────────────────────────────────────────────────
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/susana_matamala/test_step3.ts
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

const CLIENT_RUT = '21917363-6';
const CMF_STORAGE_PATH = 'susana_matamala/informe_cmf.pdf';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');
const CMF_LOCAL = path.join(TMP_DIR, 'informe_cmf_susana.pdf');

// ─── Sin Sentinel — todos los Art.260 ya están en CMF con overdue90Days > 0 ──
const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [];
const SENTINEL_ADDITIONAL: AdditionalCreditor[] = [];

// ─── Overrides: monto documento vs CMF + vencimientos reales ─────────────────
//
// BdCh: CMF $11.601.044 (capital bruto, 2 productos) → Socofin total $13.304.962
//   (capital $11.735.681 + intereses $1.045.114 + gestión $523.163 ≈ $13.304.962)
//   Vencimiento más antiguo entre las 3 ops: 04/09/2025 (ops. 34579 y 34849).
//
// CMR: CMF $5.146.199 (corte dic 2025) → EECC enero 2026 → $5.515.144
//   Cuota más antigua impaga: 25/08/2025.
//
// CAT y Ripley (Art. 261): solo override de monto (sin vencimiento, están al día).

const CMF_OVERRIDES: CmfDocumentOverride[] = [
  {
    institucion_cmf: 'Banco de Chile',
    monto_clp: 13304962,            // suma total Socofin (3 ops. c/intereses)
    fecha_vencimiento: '2025-09-04', // vencimiento más antiguo (ops. 34579 y 34849)
  },
  {
    institucion_cmf: 'CMR Falabella',
    monto_clp: 5515144,             // costo de prepago según EECC 09/01/2026
    fecha_vencimiento: '2025-08-25', // cuota más antigua impaga
  },
  {
    institucion_cmf: 'CAT (ex CENCOSUD)',
    monto_clp: 17265985,            // cupo utilizado según EECC oct 2025
    // sin fecha_vencimiento: Art. 261, al día
  },
  {
    institucion_cmf: 'CAR - Ripley',
    monto_clp: 93275,               // cupo utilizado según EECC nov 2025
    // sin fecha_vencimiento: Art. 261, al día
  },
];

// ─── Docs mapeados (Orchestrator hardcodeado) ─────────────────────────────────
//
// EEDD_7616.pdf cubre las 3 operaciones BdCh en un solo certificado Socofin.
// Se asocia a la institución "Banco de Chile" → fillStep3 lo adjunta a la fila BdCh.

const MAPPED_DOCS: AcreditacionDoc[] = [
  {
    institucion_cmf: 'Banco de Chile',
    tipo_documento: 24,
    storage_path: 'susana_matamala/bch_eedd_socofin.pdf',
    local_path: path.join(TMP_DIR, 'susana_bch_eedd_socofin.pdf'),
    filename: 'EEDD_7616.pdf',
  },
  {
    institucion_cmf: 'CMR Falabella',
    tipo_documento: 24,
    storage_path: 'susana_matamala/cmr_eecc_enero_2026.pdf',
    local_path: path.join(TMP_DIR, 'susana_cmr_eecc_enero.pdf'),
    filename: 'Cmr susana 09-01.pdf',
  },
  {
    institucion_cmf: 'CAT (ex CENCOSUD)',
    tipo_documento: 22,
    storage_path: 'susana_matamala/cat_cencosud_eecc_octubre.pdf',
    local_path: path.join(TMP_DIR, 'susana_cat_cencosud_octubre.pdf'),
    filename: 'Estado de Cuenta Oct - Cencosud.pdf',
  },
  {
    institucion_cmf: 'CAR - Ripley',
    tipo_documento: 22,
    storage_path: 'susana_matamala/car_ripley_eecc_noviembre.pdf',
    local_path: path.join(TMP_DIR, 'susana_car_ripley_noviembre.pdf'),
    filename: 'Estado de Cuenta Nov - Ripley.pdf',
  },
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

  log('⏳ Descargando certificados...');
  for (const doc of MAPPED_DOCS) {
    await downloadFromStorage(supabase, doc.storage_path, doc.local_path!);
  }

  log('\n═══════════════ PLAN ═══════════════');
  log(`Sentinel reclassified: 0 | additional: 0`);
  log(`Overrides: ${CMF_OVERRIDES.length}`);
  CMF_OVERRIDES.forEach(o => log(`  • ${o.institucion_cmf}: monto=${o.monto_clp?.toLocaleString('es-CL')} venc.=${o.fecha_vencimiento ?? '—'}`));
  log(`Docs: ${MAPPED_DOCS.length}`);
  MAPPED_DOCS.forEach(d => log(`  • [tipo ${d.tipo_documento}] ${d.institucion_cmf} → ${d.filename}`));
  log('══════════════════════════════════════\n');

  const { browser, page } = await launchBrowser();
  try {
    log('🔒 Login...');
    await loginAndNavigateToStep1(page, CLIENT_RUT, claveUnica, logger);

    const step3Url = `${new URL(page.url()).origin}/miSuperir/autenticado/renegociacion/verAcreedores`;
    await page.goto(step3Url, { waitUntil: 'domcontentloaded' });

    log('📝 fillStep3...');
    const report = await fillStep3(
      page, CMF_LOCAL,
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
    report.added.forEach(a => log(`  ✅ ${a.institucion} → ${a.nombreCatalogo} ($${a.monto.toLocaleString('es-CL')})`));
    if (report.skipped.length > 0) {
      log(`Saltados: ${report.skipped.length}`);
      report.skipped.forEach(s => log(`  ⚠️  ${s.institucion}: ${s.reason}`));
    }
    log('═════════════════════════════════════════\n');
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error('ERROR FATAL:', err.message || err); process.exit(1); });
