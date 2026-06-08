/**
 * Test directo del Paso 3 (sin cola de jobs ni PM2).
 * Carga el cliente de Supabase, descarga el CMF, hace login y corre fillStep3.
 * DRY_RUN=true → limpia todo al terminar y toma screenshots.
 *
 * Uso: npx ts-node -r dotenv/config src/utils/test_step3_direct.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from './browser';
import { loginAndNavigateToStep1 } from '../automation/login';
import { fillStep3 } from '../automation/step3_acreedores';
import { analyzeCmfPdf } from './cmf_analyzer';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const CLIENT_RUT = process.env.CLAVE_UNICA_RUT ?? '21917363-6';
const OUTPUT_DIR = path.join(process.cwd(), 'outputs');

function ts(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}
function log(msg: string) { console.log(`[${ts()}] ${msg}`); }
function logErr(msg: string, err?: unknown) { console.error(`[${ts()}] ${msg}`, err ?? ''); }

async function run() {
  log(`\n🤖 TEST DIRECTO — Paso 3 | RUT: ${CLIENT_RUT} | DRY_RUN=${process.env.DRY_RUN ?? 'true'}\n`);

  // 1. Obtener cliente
  log('⏳ Cargando cliente desde Supabase...');
  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('rut', CLIENT_RUT)
    .limit(1);

  if (clientErr || !clients?.length) {
    logErr('❌ Cliente no encontrado.', clientErr?.message);
    process.exit(1);
  }
  const client = clients[0];
  log(`✓ Cliente: ${client.name} (RUT ${client.rut})`);

  // 2. Verificar CMF
  if (!client.informe_cmf_path) {
    logErr('❌ El cliente no tiene informe_cmf_path registrado en la tabla clients.');
    process.exit(1);
  }

  // 3. Descargar CMF a outputs/
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const cmfLocalPath = path.join(OUTPUT_DIR, `cmf_test_step3_${CLIENT_RUT}.pdf`);

  log(`⏳ Descargando CMF: ${client.informe_cmf_path}...`);
  const { data: cmfBlob, error: cmfErr } = await supabase.storage
    .from('documentos')
    .download(client.informe_cmf_path);

  if (cmfErr || !cmfBlob) {
    logErr('❌ Error descargando CMF.', cmfErr?.message);
    process.exit(1);
  }
  fs.writeFileSync(cmfLocalPath, Buffer.from(await cmfBlob.arrayBuffer()));
  log(`✓ CMF descargado: ${cmfLocalPath}`);

  // 4. Validación CMF (90 días y 80 UF)
  log('⏳ Validando requisitos legales del CMF...');
  const logger = {
    log: (m: string) => log(m),
    error: (m: string, e?: unknown) => logErr(m, e),
  };
  const cmfResult = await analyzeCmfPdf(cmfLocalPath, logger);
  log(`   Atraso 90+ días : ${cmfResult.meets90DaysRequirement ? '✓ Sí' : '✗ No'}`);
  log(`   Monto 90+ días  : $${cmfResult.directOverdue90Days.toLocaleString('es-CL')} (mín. $${cmfResult.requiredAmountCLP.toLocaleString('es-CL')})`);
  if (!cmfResult.meets90DaysRequirement || !cmfResult.meetsAmountRequirement) {
    log('⚠️  El CMF NO cumple los requisitos estrictos de 90d/80UF, pero continuamos la prueba de UI de todas formas.');
  } else {
    log('✓ CMF cumple los requisitos legales.');
  }

  // 5. Abrir navegador y hacer login
  const password = process.env.CLAVE_UNICA_PASSWORD;
  if (!password) {
    logErr('❌ Falta CLAVE_UNICA_PASSWORD en el .env');
    process.exit(1);
  }

  log('🚀 Abriendo navegador...');
  const { browser, page } = await launchBrowser();

  try {
    log('🔒 Iniciando sesión con ClaveÚnica...');
    await loginAndNavigateToStep1(page, client.clave_unica_rut, password, logger, {
      region: client.region,
      comuna: client.comuna,
      email: client.email,
      telefono: client.telefono,
    });

    // Interceptor de red: captura todas las respuestas relacionadas con acreedores
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('Acreedor') || url.includes('acreedor') || url.includes('guardar') || url.includes('agregar')) {
        const status = response.status();
        const body = await response.text().catch(() => '(no body)');
        log(`   🌐 AJAX ${status} ${url.split('/').slice(-2).join('/')} → ${body.substring(0, 300)}`);
      }
    });

    // 6. Navegar al Paso 3
    const baseUrl = new URL(page.url()).origin;
    const step3Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verAcreedores`;
    log(`→ Navegando al Paso 3: ${step3Url}`);
    await page.goto(step3Url, { waitUntil: 'domcontentloaded' });

    // 7. Ejecutar fillStep3 con documentos de acreditación
    const acreditacionDocs = client.acreditacion_documentos_json ?? [];
    log(`📋 Certificados de acreditación cargados: ${acreditacionDocs.length}`);

    const report = await fillStep3(page, cmfLocalPath, supabase, logger, undefined, acreditacionDocs);

    // 8. Resumen
    log('\n════════════════════════════════════════════════');
    log(`📊 RESULTADO PASO 3:`);
    log(`   ✅ Acreedores agregados : ${report.added.length}`);
    report.added.forEach(a => log(`      • ${a.institucion} → ${a.nombreCatalogo} ($${a.monto.toLocaleString('es-CL')})`));
    if (report.skipped.length) {
      log(`   ⚠️ Saltados             : ${report.skipped.length}`);
      report.skipped.forEach(s => log(`      • ${s.institucion}: ${s.reason}`));
    }
    log('════════════════════════════════════════════════\n');

    // 9. Mostrar screenshots generados
    const shots = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.startsWith('verify_step3_') || f === 'step3_success.png')
      .sort();
    if (shots.length) {
      log('📸 Screenshots generados:');
      shots.forEach(s => log(`   outputs/${s}`));
    }

  } catch (err) {
    logErr('🚨 Error en la prueba:', err);
  } finally {
    await browser.close();
    // Limpiar CMF temporal
    if (fs.existsSync(cmfLocalPath)) fs.unlinkSync(cmfLocalPath);
    log('🧹 Archivo CMF temporal eliminado.');
  }
}

run().catch((err) => {
  logErr('🚨 Error fatal:', err);
  process.exit(1);
});
