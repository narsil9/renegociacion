/**
 * Test hardcodeado de Step 3 — Caso María Paz Bravo Norambuena (portal Patricio Martini).
 *
 * ─── CMF (09/12/2025) — 5 acreedores ─────────────────────────────────────────
 *
 *  Art. 260 (mora ≥91d — ambos en CMF con overdue90Days > 0):
 *   • CMR Falabella [Consumo]:     CMF $9.618.318  → doc $9.763.965, venc. 05/08/2025
 *   • Banco Itaú Chile [Consumo]:  CMF $5.072.748  → doc $5.134.284, venc. 25/08/2025
 *     (El CMF agrupa las 3 operaciones Itaú en una sola fila:
 *       Consumo 60451478 $3.219.943 + Tarjeta 6620 $1.612.453 + Línea $301.888)
 *
 *  Art. 261 (al día en CMF — sin mora >90d):
 *   • Banco Estado [Vivienda]:     CMF $71.189.175 (hipotecario, al día)
 *   • Banco Estado [Consumo]:      CMF $1.031.582  (línea de crédito, al día)
 *   • Coopeuch [Consumo]:          CMF $16.905.601 (consumo, al día)
 *
 *  Sin NO-CMF adicionales. Sin reclasificaciones Sentinel.
 *
 *  Overrides: solo Art.260 necesitan vencimiento real.
 *  BancoEstado (2 filas): misma captura de portal cubre ambas — se adjunta a
 *  cada fila buscando por monto ($71.189.175 y $1.031.582 respectivamente).
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/maria_paz_bravo/test_step3.ts
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

const CLIENT_RUT = '21917363-6';          // Pato Martini — portal de prueba
const CMF_STORAGE_PATH = 'maria_paz_bravo/informe_cmf.pdf';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');
const CMF_LOCAL = path.join(TMP_DIR, 'informe_cmf_mariapaz.pdf');

// ─── Sin Sentinel — todos los Art.260 ya están en CMF con overdue90Days > 0 ──
const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [];
const SENTINEL_ADDITIONAL: AdditionalCreditor[] = [];

// ─── Overrides solo para Art.260 (necesitan vencimiento real) ─────────────────
//
// Itaú: CMF $5.072.748 → suma docs: $3.219.943 + $1.612.453 + $301.888 = $5.134.284
//   Vencimiento: 25/08/2025 (consumo 60451478, el más antiguo).
//
// CMR: CMF $9.618.318 → cert deuda $9.763.965 (capital+intereses+penales+gastos)
//   Vencimiento: 05/08/2025 (aviso cobranza del EECC noviembre).

const CMF_OVERRIDES: CmfDocumentOverride[] = [
  {
    institucion_cmf: 'Banco Itaú Chile',
    monto_clp: 5134284,
    fecha_vencimiento: '2025-08-25',
  },
  {
    institucion_cmf: 'CMR Falabella',
    monto_clp: 9763965,
    fecha_vencimiento: '2025-08-05',
  },
];

// ─── Docs mapeados ────────────────────────────────────────────────────────────
const MAPPED_DOCS: AcreditacionDoc[] = [
  {
    institucion_cmf: 'CMR Falabella',
    tipo_documento: 24,
    storage_path: 'maria_paz_bravo/cmr_eecc_noviembre_2025.pdf',
    local_path: path.join(TMP_DIR, 'mpp_cmr_eecc_noviembre.pdf'),
    filename: 'Estado de Cuenta CMR noviembre_unlocked.pdf',
  },
  {
    institucion_cmf: 'Banco Itaú Chile',
    tipo_documento: 24,
    storage_path: 'maria_paz_bravo/itau_cartera_vencida.pdf',
    local_path: path.join(TMP_DIR, 'mpp_itau_cartera_vencida.pdf'),
    filename: 'CARTERA VENCIDA.pdf',
  },
  {
    // Cubre AMBAS filas de Banco Estado (hipotecario y línea).
    // fillStep3 adjunta por monto: $71.189.175 → vivienda, $1.031.582 → consumo.
    institucion_cmf: 'Banco Estado',
    tipo_documento: 22,
    storage_path: 'maria_paz_bravo/bde_captura_portal.pdf',
    local_path: path.join(TMP_DIR, 'mpp_bde_captura_portal.pdf'),
    filename: 'Captura de pantalla (2038).pdf',
  },
  {
    institucion_cmf: 'Coopeuch',
    tipo_documento: 22,
    storage_path: 'maria_paz_bravo/coopeuch_cert_liquidacion.pdf',
    local_path: path.join(TMP_DIR, 'mpp_coopeuch_cert_liquidacion.pdf'),
    filename: 'CERTIFICADO_LIQUIDACION_1763985892716.pdf',
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
  log('CMF → 5 acreedores (2 Art.260 + 3 Art.261)');
  log(`Overrides: ${CMF_OVERRIDES.length}`);
  CMF_OVERRIDES.forEach(o =>
    log(`  • ${o.institucion_cmf}: monto=${o.monto_clp?.toLocaleString('es-CL')} venc.=${o.fecha_vencimiento ?? '—'}`)
  );
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
    report.added.forEach(a =>
      log(`  ✅ ${a.institucion} → ${a.nombreCatalogo} ($${a.monto.toLocaleString('es-CL')})`)
    );
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
