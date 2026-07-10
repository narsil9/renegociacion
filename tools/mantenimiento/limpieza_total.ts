/**
 * 🧹 LIMPIEZA TOTAL del borrador de Renegociación en el portal del Superir.
 *
 * Deja la solicitud lista para volver a probar el flujo real (Pasos 1→4):
 * inicia sesión con ClaveÚnica y elimina del borrador del portal:
 *   - Paso 2: Carpeta Tributaria y Certificado de Agentes Retenedores.
 *   - Paso 3: TODOS los acreedores (Obligaciones 260 + Otros) y el Informe CMF.
 *
 * Los Pasos 1 (información personal) y 4 (apoderado) NO se borran porque son
 * solo campos que se sobrescriben al volver a correr la automatización; no
 * acumulan ni bloquean un re-test. Lo que sí ensucia un re-run son los
 * archivos y acreedores subidos, que es justo lo que este script elimina.
 *
 * Uso:
 *   npx ts-node -r dotenv/config tools/mantenimiento/limpieza_total.ts
 *   CLAVE_UNICA_RUT=12345678-9 npx ts-node -r dotenv/config tools/mantenimiento/limpieza_total.ts
 *
 * Requiere en .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, y la ClaveÚnica
 * (CLAVE_UNICA_PASSWORD para el cliente de prueba 21917363-6, o el campo
 * clave_unica_password de la tabla clients para el resto).
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from '../../src/utils/browser';
import { loginAndNavigateToStep1 } from '../../src/automation/login';
import { cleanupDraft } from '../../src/automation/cleanup';
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
const log = (msg: string) => console.log(`[${ts()}] ${msg}`);
const logErr = (msg: string, err?: unknown) => console.error(`[${ts()}] ${msg}`, err ?? '');
const logger = { log, error: logErr };

async function run() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('🧹 LIMPIEZA TOTAL — Borrador de Renegociación (portal Superir)');
  console.log('══════════════════════════════════════════════════════');
  log(`RUT objetivo: ${CLIENT_RUT}`);
  console.log('⚠️  Esto ELIMINA del portal real: archivos del Paso 2 y acreedores + CMF del Paso 3.\n');

  // 1. Cargar cliente
  log('⏳ Cargando cliente desde Supabase...');
  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('rut', CLIENT_RUT)
    .limit(1);

  if (clientErr || !clients?.length) {
    logErr('❌ Cliente no encontrado en Supabase.', clientErr?.message);
    process.exit(1);
  }
  const client = clients[0];
  log(`✓ Cliente: ${client.name} (RUT ${client.rut})`);

  // 2. Resolver ClaveÚnica (env para el cliente de prueba; DB para el resto)
  let claveUnicaPassword = '';
  if (client.rut === '21917363-6' || client.airtable_id === 'recPatoPrueba') {
    claveUnicaPassword = process.env.CLAVE_UNICA_PASSWORD || '';
    if (!claveUnicaPassword) {
      logErr('❌ Falta CLAVE_UNICA_PASSWORD en .env para el cliente de prueba.');
      process.exit(1);
    }
  } else {
    claveUnicaPassword = client.clave_unica_password;
    if (!claveUnicaPassword) {
      logErr('❌ Falta clave_unica_password en la tabla clients para este cliente.');
      process.exit(1);
    }
  }

  // 3. Login + limpieza
  log('🚀 Abriendo navegador...');
  const { browser, page } = await launchBrowser();
  try {
    log('🔒 Iniciando sesión con ClaveÚnica...');
    await loginAndNavigateToStep1(page, client.clave_unica_rut ?? client.rut, claveUnicaPassword, logger, {
      region: client.region,
      comuna: client.comuna,
      email: client.email,
      telefono: client.telefono,
    });
    log('✓ Sesión iniciada y formulario de Renegociación cargado.');

    await page
      .screenshot({ path: path.join(OUTPUT_DIR, `limpieza_antes_${client.rut}.png`), fullPage: false })
      .catch(() => {});

    // Rutina de limpieza (reusa la misma que usa el worker en dry-run / validación fallida)
    await cleanupDraft(page, logger);

    await page
      .screenshot({ path: path.join(OUTPUT_DIR, `limpieza_despues_${client.rut}.png`), fullPage: false })
      .catch(() => {});

    console.log('\n══════════════════════════════════════════════════════');
    log('✅ LIMPIEZA TOTAL COMPLETADA. La solicitud quedó lista para un nuevo test del flujo 1→4.');
    log('   (Pasos 1 y 4 se sobrescriben al re-correr; no requieren limpieza.)');
    console.log('══════════════════════════════════════════════════════\n');
  } catch (err) {
    logErr('❌ Error durante la limpieza:', err instanceof Error ? err.message : err);
    await page
      .screenshot({ path: path.join(OUTPUT_DIR, `limpieza_error_${client.rut}.png`), fullPage: false })
      .catch(() => {});
    await browser.close();
    process.exit(1);
  }

  await browser.close();
  log('🔌 Navegador cerrado.');
}

run().catch((err) => {
  logErr('❌ Error fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
