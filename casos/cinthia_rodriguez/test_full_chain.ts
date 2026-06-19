/**
 * Test de la cadena completa de agentes + Playwright — Cinthia Lisbet Rodríguez Vargas.
 *
 * Flujo:
 *   1. Lee perfil de Cinthia desde Supabase
 *   2. Lee perfil portal (credenciales ClaveÚnica)
 *   3. Agente Tributario  → categoria + F29 + contribuciones
 *   4. Agente Centinela   → reclasificaciones + no-CMF (Fashion's Park) + overrides
 *   5. Agente Mapeador    → mappedDocs para Playwright
 *   6. Playwright Steps 1→4 (DRY_RUN=true)
 *
 * CMF de Cinthia (6 acreedores + 1 NO-CMF):
 *   Art. 260 — CAR - Ripley ($1.631.468), CAT ex-CENCOSUD ($6.553.197), CMR Falabella ($2.570.928)
 *   Art. 261 — Banco Estado ($723.724), PRESTO LIDER ($623.064), Solventa Tarjetas ($284.324)
 *   NO-CMF    — Fashion's Park (Inversiones Kimco S.A.) Art.261 ($98.716)
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true BYPASS_RUT_CHECK=true \
 *     npx ts-node --transpile-only -r dotenv/config casos/cinthia_rodriguez/test_full_chain.ts
 *
 * Variables de entorno requeridas:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 *   CLAVE_UNICA_PASSWORD
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { runTributarioAgent } from '../../src/agents/tributario_agent';
import { runCentinelaAgent, CentinelaBlockedError } from '../../src/agents/centinela_agent';
import { runMapeadorAgent, mapeadorHasBlockers } from '../../src/agents/mapeador_agent';
import { loginAndNavigateToStep1 } from '../../src/automation/login';
import { fillAllSteps } from '../../src/automation/all_steps';
import { ClientData } from '../../src/automation/step1_personal';
import { launchBrowser } from '../../src/utils/browser';

// ─── Configuración ─────────────────────────────────────────────────────────
const CINTHIA_RUT = '24.950.897-7';
const PORTAL_RUT  = '21917363-6';

const TMP_DIR       = path.resolve('outputs', 'acreditaciones_tmp');
const CMF_LOCAL_PATH = path.join(TMP_DIR, 'cinthia_rodriguez_informe_cmf.pdf');

const D                    = path.resolve(__dirname, 'documentos');
const CT_LOCAL_PATH        = path.join(D, 'carpeta_tributaria.pdf');
const RETENEDORES_LOCAL_PATH = path.join(D, 'agentes_retenedores.pdf');

// ─── Logger ─────────────────────────────────────────────────────────────────
const log = (msg: string) => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  console.log(`[${ts}] ${msg}`);
};
const logger = {
  log,
  error: (msg: string, err?: unknown) => console.error(msg, err ?? ''),
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}

async function downloadCmf(supabase: ReturnType<typeof createClient>, storagePath: string) {
  if (fs.existsSync(CMF_LOCAL_PATH)) {
    log(`  ♻️  CMF ya en caché: ${CMF_LOCAL_PATH}`);
    return;
  }
  const { data, error } = await supabase.storage.from('documentos').download(storagePath);
  if (error || !data) throw new Error(`Error descargando CMF: ${error?.message}`);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(CMF_LOCAL_PATH, Buffer.from(await data.arrayBuffer()));
  log(`  ✓ CMF descargado: ${CMF_LOCAL_PATH}`);
}

async function main() {
  requireEnv('SUPABASE_URL');
  requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  requireEnv('ANTHROPIC_API_KEY');
  const claveUnicaPassword = requireEnv('CLAVE_UNICA_PASSWORD');

  process.env.DRY_RUN          = 'true';
  process.env.BYPASS_DATE_CHECK = 'true';
  process.env.BYPASS_RUT_CHECK  = 'true';

  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );

  // ── 1. Perfiles ──────────────────────────────────────────────────────────
  log('⏳ Cargando perfiles desde Supabase...');

  const { data: cinthia, error: errC } = await supabase
    .from('clients').select('*').eq('rut', CINTHIA_RUT).single();
  if (errC || !cinthia) throw new Error(`Perfil Cinthia no encontrado: ${errC?.message}`);
  log(`✓ Cliente: ${cinthia.name} (${cinthia.id})`);

  const { data: portal, error: errP } = await supabase
    .from('clients').select('*').eq('rut', PORTAL_RUT).single();
  if (errP || !portal) throw new Error(`Perfil portal no encontrado (RUT ${PORTAL_RUT}): ${errP?.message}`);
  log(`✓ Portal RUT: ${portal.name} (${PORTAL_RUT})`);

  // ── 2. CMF ───────────────────────────────────────────────────────────────
  if (!cinthia.informe_cmf_path) throw new Error('Cinthia no tiene informe_cmf_path. Corré setup_test.ts.');
  log('⏳ Verificando CMF local...');
  await downloadCmf(supabase as any, cinthia.informe_cmf_path);

  // ── 3. Agente Tributario ─────────────────────────────────────────────────
  log('\n📊 === AGENTE TRIBUTARIO ===');
  if (!cinthia.carpeta_tributaria_path) throw new Error('Cinthia no tiene carpeta_tributaria_path.');

  const tributarioOutput = await runTributarioAgent(
    supabase as any,
    cinthia.id,
    CT_LOCAL_PATH,
    logger
  );
  const categoria = tributarioOutput.categoria;
  log(`✓ Categoría: ${categoria}`);

  if (tributarioOutput.f29_meses_con_actividad.length > 0) {
    log(`\n🚫 BLOQUEADO — Primera categoría con actividad F29 en: ${tributarioOutput.f29_meses_con_actividad.join(', ')}`);
    log('   El caso no puede proceder. Revisar con el abogado.');
    process.exit(1);
  }

  if (tributarioOutput.contribuciones_deuda && tributarioOutput.contribuciones_deuda.length > 0) {
    log(`⚠️  Contribuciones morosas: ${tributarioOutput.contribuciones_deuda.length} propiedad/es — revisar con abogado.`);
  }

  // ── 4. Agente Centinela ──────────────────────────────────────────────────
  log('\n🛡️  === AGENTE CENTINELA ===');
  let centinelaOutput;
  try {
    centinelaOutput = await runCentinelaAgent(
      supabase as any,
      cinthia.id,
      cinthia,
      CMF_LOCAL_PATH,
      logger
    );
  } catch (err) {
    if (err instanceof CentinelaBlockedError) {
      log(`\n❌ BLOQUEADO por Centinela: ${err.message}`);
      log('   Revisar documentos con el abogado antes de continuar.');
      process.exit(1);
    }
    throw err;
  }

  log(`✓ Centinela completado:`);
  log(`  • Reclasificados 261→260: ${centinelaOutput.reclassifiedCreditors.length}`);
  log(`  • Acreedores NO-CMF: ${centinelaOutput.additionalCreditors.length}`);
  log(`  • CMF 260 directos (overrides): ${centinelaOutput.cmfDocumentOverrides.length}`);
  log(`  • Fechas clave: ${centinelaOutput.fechasClave.length}`);

  centinelaOutput.reclassifiedCreditors.forEach(r =>
    log(`    ↑ ${r.institucion_cmf}: ${r.delinquency_days}d → $${r.total_credito_clp.toLocaleString('es-CL')}`)
  );
  centinelaOutput.additionalCreditors.forEach(a =>
    log(`    + ${a.bank} [Art.${a.categoria_articulo}] $${a.total_credito_clp.toLocaleString('es-CL')}`)
  );
  centinelaOutput.cmfDocumentOverrides.forEach(o =>
    log(`    ~ ${o.institucion_cmf}: $${o.monto_clp?.toLocaleString('es-CL')} / ${o.fecha_vencimiento}`)
  );

  // ── 5. Agente Mapeador ───────────────────────────────────────────────────
  log('\n🗺️  === AGENTE MAPEADOR ===');
  const mapeadorOutput = await runMapeadorAgent(
    supabase as any,
    cinthia.id,
    cinthia,
    CMF_LOCAL_PATH,
    centinelaOutput,
    logger
  );

  log(`✓ Mapeador: ${mapeadorOutput.mappedDocs.length} docs, ${mapeadorOutput.alerts.length} alertas`);
  mapeadorOutput.alerts.forEach(a => log(`  ⚠️  [${a.type}] ${a.message}`));

  const { blocked, reason } = mapeadorHasBlockers(mapeadorOutput);
  if (blocked) {
    log(`\n🚫 BLOQUEADO por Mapeador: ${reason}`);
    log('   Corregir documentos antes de continuar con Playwright.');
    process.exit(1);
  }

  // ── 6. Playwright Steps 1→4 ─────────────────────────────────────────────
  log('\n🎭 === PLAYWRIGHT (Steps 1→4, DRY_RUN=true) ===');

  const clientData: ClientData = {
    nacionalidad:        portal.nacionalidad        ?? 'Chilena',
    fecha_nacimiento:    portal.fecha_nacimiento    ?? '01/01/1985',
    estado_civil:        portal.estado_civil        ?? 'soltero',
    regimen_patrimonial: portal.regimen_patrimonial ?? null,
    profesion_oficio:    portal.profesion_oficio    ?? 'Empleado',
    ocupacion:           portal.ocupacion           ?? 'Empleado',
    direccion:           portal.direccion           ?? 'Avenida Providencia 1234',
    region:              portal.region              ?? 'Región Metropolitana de Santiago',
    comuna:              portal.comuna              ?? 'Providencia',
    email:               portal.email               ?? 'test@test.cl',
    telefono_prefijo:    portal.telefono_prefijo    ?? '+56',
    telefono:            portal.telefono            ?? '912345678',
  };

  const { browser, page } = await launchBrowser();
  try {
    log('🔒 Login con ClaveÚnica...');
    await loginAndNavigateToStep1(page, PORTAL_RUT, claveUnicaPassword, logger);

    await fillAllSteps(
      page,
      clientData,
      CT_LOCAL_PATH,
      RETENEDORES_LOCAL_PATH,
      categoria,
      CMF_LOCAL_PATH,
      supabase as any,
      mapeadorOutput.mappedDocs,
      logger,
      null,
      centinelaOutput.reclassifiedCreditors,
      centinelaOutput.additionalCreditors,
      centinelaOutput.cmfDocumentOverrides
    );

    log('\n✅ Test full chain Cinthia completado (DRY_RUN=true — borrador NO enviado).');
    log('\n📋 Resumen esperado (analisis-deuda-cinthia.md):');
    log('   Art. 260 (Obligaciones 260): CAR-Ripley, CAT ex-CENCOSUD, CMR Falabella');
    log('   Art. 261 (Otros Acreedores): Banco Estado, PRESTO LIDER, Solventa Tarjetas');
    log("   NO-CMF Art. 261:             Fashion's Park (Inversiones Kimco S.A.)");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\n🚨 ERROR FATAL:', (err as Error).message || err);
  process.exit(1);
});
