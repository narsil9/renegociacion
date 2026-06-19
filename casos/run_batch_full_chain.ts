/**
 * Batch runner — cadena completa (Tributario→Centinela→Mapeador + Steps 1→4) para
 * todos los casos activos (no bloqueados).
 *
 * Cada caso corre en orden, con DRY_RUN=true (cleanup automático del borrador).
 * Los errores se capturan por caso y el runner continúa al siguiente.
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true BYPASS_RUT_CHECK=true \
 *     npx ts-node --transpile-only -r dotenv/config casos/run_batch_full_chain.ts
 *
 * Para saltar el Centinela (sin detección NO-CMF, sin gasto de créditos API):
 *   DISABLE_SENTINEL=true BYPASS_DATE_CHECK=true BYPASS_RUT_CHECK=true \
 *     npx ts-node --transpile-only -r dotenv/config casos/run_batch_full_chain.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { runTributarioAgent } from '../src/agents/tributario_agent';
import { runCentinelaAgent, CentinelaBlockedError } from '../src/agents/centinela_agent';
import { runMapeadorAgent, mapeadorHasBlockers } from '../src/agents/mapeador_agent';
import { loginAndNavigateToStep1 } from '../src/automation/login';
import { fillAllSteps } from '../src/automation/all_steps';
import { ClientData } from '../src/automation/step1_personal';
import { launchBrowser } from '../src/utils/browser';

const PORTAL_RUT     = '21917363-6';
const TMP_DIR        = path.resolve('outputs', 'acreditaciones_tmp');

// ─── Casos activos (sin _BLOQUEADO.md) ────────────────────────────────────────
// localCtPath / localRetPath: ruta absoluta al PDF local; null = descargar de Supabase o no disponible
interface CaseConfig {
  slug:         string;
  label:        string;
  clientRut:    string;
  localCtPath:  string | null;
  localRetPath: string | null;
}

const CASES: CaseConfig[] = [
  {
    slug:         'alejandra_espinoza',
    label:        'Alejandra Espinoza',
    clientRut:    '18.738.680-2',
    localCtPath:  null,   // sin CT — se descargará de Supabase si está disponible
    localRetPath: null,
  },
  {
    slug:         'betzy_lee',
    label:        'Betzy Lee',
    clientRut:    '26.199.806-8',
    localCtPath:  path.resolve('casos/betzy_lee/documentos/03_Tributaria_y_SII/Carpeta Tributaria.pdf'),
    localRetPath: path.resolve('casos/betzy_lee/documentos/03_Tributaria_y_SII/Agentes Retenedores.pdf'),
  },
  {
    slug:         'carlos_uribe',
    label:        'Carlos Uribe',
    clientRut:    '16.523.825-7',
    localCtPath:  path.resolve('casos/carlos_uribe/documentos/carpeta_tributaria.pdf'),
    localRetPath: path.resolve('casos/carlos_uribe/documentos/agentes_retenedores.pdf'),
  },
  {
    slug:         'cinthia_rodriguez',
    label:        'Cinthia Rodríguez',
    clientRut:    '24.950.897-7',
    localCtPath:  path.resolve('casos/cinthia_rodriguez/documentos/carpeta_tributaria.pdf'),
    localRetPath: null,   // cinthia no tiene retenedores
  },
  {
    slug:         'claudia_silva',
    label:        'Claudia Silva',
    clientRut:    '21917363-6',   // cliente = portal (Pato Martini)
    localCtPath:  path.resolve('casos/claudia_silva/documentos/03_Tributaria_y_SII/CARPETA TRIBUTARIA CLAUDIA SILVA.pdf'),
    localRetPath: null,
  },
  {
    slug:         'maria_paz_bravo',
    label:        'María Paz Bravo',
    clientRut:    '16.997.909-K',
    localCtPath:  path.resolve('casos/maria_paz_bravo/documentos/03_Tributaria_y_SII/Carpeta_Tributaria_Regular (29).pdf'),
    localRetPath: null,
  },
  {
    slug:         'nicolas_bascuñan',
    label:        'Nicolás Bascuñán',
    clientRut:    '18.755.318-0',
    localCtPath:  path.resolve('casos/nicolas_bascuñan/documentos/03_Tributaria_y_SII/Carpeta_Tributaria_Regular (18).pdf'),
    localRetPath: path.resolve('casos/nicolas_bascuñan/documentos/03_Tributaria_y_SII/AG 2024_AG 2025_merged.pdf'),
  },
  {
    slug:         'susana_matamala',
    label:        'Susana Matamala',
    clientRut:    '16.983.419-9',
    localCtPath:  null,   // CT de Patricio Martini en Supabase — se descargará
    localRetPath: null,
  },
  {
    slug:         'william_montero',
    label:        'William Montero',
    clientRut:    '25.656.359-2',
    localCtPath:  path.resolve('casos/william_montero/documentos/03_Tributaria_y_SII/Carpeta_Tributaria_Regular (31).pdf'),
    localRetPath: path.resolve('casos/william_montero/documentos/03_Tributaria_y_SII/Agentes Retenedores.pdf'),
  },
  {
    slug:         'yoselyn_reyes',
    label:        'Yoselyn Reyes',
    clientRut:    '16.563.374-1',
    localCtPath:  path.resolve('casos/yoselyn_reyes/documentos/03_Tributaria_y_SII/Carpeta_Tributaria_Regular (15).pdf'),
    localRetPath: path.resolve('casos/yoselyn_reyes/documentos/03_Tributaria_y_SII/AR 2025.pdf'),
  },
];

// ─── Tipos ────────────────────────────────────────────────────────────────────
type CaseStatus = 'ok' | 'skip' | 'error';
interface CaseResult {
  label:   string;
  status:  CaseStatus;
  detail:  string;
  duraS:   number;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}

function makeLogger(prefix: string) {
  const log = (msg: string) => {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
    console.log(`[${ts}] [${prefix}] ${msg}`);
  };
  return { log, error: (msg: string, err?: unknown) => console.error(`[${prefix}] ${msg}`, err ?? '') };
}

/** Descarga un PDF de Supabase Storage si no existe localmente. */
async function ensureLocal(
  supabase: ReturnType<typeof createClient>,
  storagePath: string,
  localDest: string,
  log: (m: string) => void
): Promise<void> {
  if (fs.existsSync(localDest)) {
    log(`  ♻️  Caché: ${path.basename(localDest)}`);
    return;
  }
  const { data, error } = await supabase.storage.from('documentos').download(storagePath);
  if (error || !data) throw new Error(`Error descargando ${storagePath}: ${error?.message}`);
  fs.mkdirSync(path.dirname(localDest), { recursive: true });
  fs.writeFileSync(localDest, Buffer.from(await data.arrayBuffer()));
  log(`  ✓ Descargado ${storagePath} → ${path.basename(localDest)}`);
}

// ─── Runner por caso ──────────────────────────────────────────────────────────
async function runCase(
  cfg: CaseConfig,
  supabase: ReturnType<typeof createClient>,
  claveUnicaPassword: string,
  portalClient: Record<string, unknown>
): Promise<Pick<CaseResult, 'status' | 'detail'>> {
  const logger = makeLogger(cfg.slug);
  const log = logger.log.bind(logger);

  // ── Perfil del cliente ───────────────────────────────────────────────────
  log(`⏳ Cargando perfil desde Supabase (RUT ${cfg.clientRut})...`);
  const { data: client, error: errC } = await supabase
    .from('clients').select('*').eq('rut', cfg.clientRut).single();
  if (errC || !client) throw new Error(`Perfil no encontrado: ${errC?.message}`);
  log(`✓ Cliente: ${client.name} (${client.id})`);

  // ── CMF ──────────────────────────────────────────────────────────────────
  if (!client.informe_cmf_path) throw new Error('Sin informe_cmf_path en Supabase. Corré setup_test.ts.');
  const cmfLocal = path.join(TMP_DIR, `${cfg.slug}_informe_cmf.pdf`);
  await ensureLocal(supabase, client.informe_cmf_path as string, cmfLocal, log);

  // ── Carpeta Tributaria ───────────────────────────────────────────────────
  let ctLocalPath: string | null = cfg.localCtPath && fs.existsSync(cfg.localCtPath) ? cfg.localCtPath : null;

  if (!ctLocalPath && client.carpeta_tributaria_path) {
    const ctDest = path.join(TMP_DIR, `${cfg.slug}_carpeta_tributaria.pdf`);
    await ensureLocal(supabase, client.carpeta_tributaria_path as string, ctDest, log);
    ctLocalPath = ctDest;
  }

  if (!ctLocalPath) {
    return { status: 'skip', detail: 'Sin Carpeta Tributaria disponible (local ni Supabase).' };
  }

  // ── Agentes Retenedores (opcional) ───────────────────────────────────────
  let retLocalPath: string | null = cfg.localRetPath && fs.existsSync(cfg.localRetPath) ? cfg.localRetPath : null;

  if (!retLocalPath && client.carpeta_retenedores_path) {
    const retDest = path.join(TMP_DIR, `${cfg.slug}_agentes_retenedores.pdf`);
    await ensureLocal(supabase, client.carpeta_retenedores_path as string, retDest, log);
    retLocalPath = retDest;
  }

  if (!retLocalPath) {
    log('⚠️  Sin Agentes Retenedores — Step 2 omitirá la subida de retenedores.');
  }

  // ── Agente Tributario ────────────────────────────────────────────────────
  log('\n📊 AGENTE TRIBUTARIO');
  const tributarioOutput = await runTributarioAgent(supabase as any, client.id as string, ctLocalPath, logger);
  const categoria = tributarioOutput.categoria;
  log(`✓ Categoría: ${categoria}`);

  if (tributarioOutput.f29_meses_con_actividad.length > 0) {
    log(`⚠️  Primera categoría con actividad F29 — caso bloqueado técnicamente (abogado debe revisar).`);
    return { status: 'skip', detail: `Bloqueado: primera categoría con F29 (${tributarioOutput.f29_meses_con_actividad.slice(0, 3).join(', ')}...).` };
  }

  // ── Agente Centinela ─────────────────────────────────────────────────────
  log('\n🛡️  AGENTE CENTINELA');
  let centinelaOutput;
  try {
    centinelaOutput = await runCentinelaAgent(supabase as any, client.id as string, client as any, cmfLocal, logger);
  } catch (err) {
    if (err instanceof CentinelaBlockedError) {
      return { status: 'skip', detail: `CentinelaBlockedError: ${err.message}` };
    }
    throw err;
  }
  log(`✓ Reclasificados: ${centinelaOutput.reclassifiedCreditors.length}, NO-CMF: ${centinelaOutput.additionalCreditors.length}, Overrides: ${centinelaOutput.cmfDocumentOverrides.length}`);

  // ── Agente Mapeador ──────────────────────────────────────────────────────
  log('\n🗺️  AGENTE MAPEADOR');
  const mapeadorOutput = await runMapeadorAgent(
    supabase as any, client.id as string, client as any, cmfLocal, centinelaOutput, logger
  );
  log(`✓ Mapeador: ${mapeadorOutput.mappedDocs.length} docs, ${mapeadorOutput.alerts.length} alertas`);

  const { blocked, reason } = mapeadorHasBlockers(mapeadorOutput);
  if (blocked) {
    return { status: 'skip', detail: `Mapeador bloqueado: ${reason}` };
  }

  // ── Playwright Steps 1→4 ─────────────────────────────────────────────────
  log('\n🎭 PLAYWRIGHT Steps 1→4');
  const clientData: ClientData = {
    nacionalidad:         (portalClient.nacionalidad      as string) ?? 'Chilena',
    fecha_nacimiento:     (portalClient.fecha_nacimiento  as string) ?? '01/01/1985',
    estado_civil:         (portalClient.estado_civil      as string) ?? 'soltero',
    regimen_patrimonial:  (portalClient.regimen_patrimonial as string | null) ?? null,
    profesion_oficio:     (portalClient.profesion_oficio  as string) ?? 'Abogado',
    ocupacion:            (portalClient.ocupacion         as string) ?? 'Abogado',
    direccion:            (portalClient.direccion         as string) ?? 'Avenida Providencia 1234',
    region:               (portalClient.region            as string) ?? 'Región Metropolitana de Santiago',
    comuna:               (portalClient.comuna            as string) ?? 'Providencia',
    email:                (portalClient.email             as string) ?? 'test@test.cl',
    telefono_prefijo:     (portalClient.telefono_prefijo  as string) ?? '+56',
    telefono:             (portalClient.telefono          as string) ?? '912345678',
  };

  const { browser, page } = await launchBrowser();
  try {
    log('🔒 Login con ClaveÚnica...');
    await loginAndNavigateToStep1(page, PORTAL_RUT, claveUnicaPassword, logger);

    await fillAllSteps(
      page,
      clientData,
      ctLocalPath,
      retLocalPath,
      categoria,
      cmfLocal,
      supabase as any,
      mapeadorOutput.mappedDocs,
      logger,
      null,
      centinelaOutput.reclassifiedCreditors,
      centinelaOutput.additionalCreditors,
      centinelaOutput.cmfDocumentOverrides
    );

    return { status: 'ok', detail: `${mapeadorOutput.mappedDocs.length} docs mapeados. categoria=${categoria}` };
  } finally {
    await browser.close();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  requireEnv('SUPABASE_URL');
  requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  requireEnv('ANTHROPIC_API_KEY');
  const claveUnicaPassword = requireEnv('CLAVE_UNICA_PASSWORD');

  process.env.DRY_RUN             = 'true';
  process.env.BYPASS_DATE_CHECK   = 'true';
  process.env.BYPASS_RUT_CHECK    = 'true';

  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );

  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Cargar perfil del portal (Pato Martini) una vez
  const { data: portalClient, error: errP } = await supabase
    .from('clients').select('*').eq('rut', PORTAL_RUT).single();
  if (errP || !portalClient) throw new Error(`Perfil portal ${PORTAL_RUT} no encontrado: ${errP?.message}`);
  console.log(`✓ Portal RUT: ${portalClient.name} (${PORTAL_RUT})\n`);

  const results: CaseResult[] = [];

  for (const cfg of CASES) {
    const startMs = Date.now();
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🔄  CASO: ${cfg.label.toUpperCase()} (${cfg.clientRut})`);
    console.log(`${'═'.repeat(70)}`);

    let status: CaseStatus = 'error';
    let detail = '';
    try {
      const r = await runCase(cfg, supabase, claveUnicaPassword, portalClient as any);
      status = r.status;
      detail = r.detail;
    } catch (err) {
      status = 'error';
      detail = (err as Error).message ?? String(err);
      console.error(`\n💥 Error inesperado en ${cfg.label}:`, detail);
    }

    const duraS = Math.round((Date.now() - startMs) / 1000);
    results.push({ label: cfg.label, status, detail, duraS });

    const icon = status === 'ok' ? '✅' : status === 'skip' ? '⏭️ ' : '❌';
    console.log(`\n${icon}  ${cfg.label}: ${status.toUpperCase()} (${duraS}s) — ${detail}`);
  }

  // ── Resumen final ─────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log('RESUMEN BATCH');
  console.log(`${'═'.repeat(70)}`);
  console.log(`${'CASO'.padEnd(30)} ${'ESTADO'.padEnd(8)} ${'TIEMPO'.padEnd(8)} DETALLE`);
  console.log(`${'-'.repeat(70)}`);
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'skip' ? '⏭️ ' : '❌';
    console.log(`${(icon + ' ' + r.label).padEnd(32)} ${r.status.padEnd(8)} ${(r.duraS + 's').padEnd(8)} ${r.detail.substring(0, 50)}`);
  }
  console.log(`${'-'.repeat(70)}`);
  const ok    = results.filter(r => r.status === 'ok').length;
  const skip  = results.filter(r => r.status === 'skip').length;
  const error = results.filter(r => r.status === 'error').length;
  console.log(`TOTAL: ${results.length} casos — ✅ ${ok} ok  ⏭️  ${skip} skip  ❌ ${error} error`);

  if (error > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\n🚨 ERROR FATAL:', (err as Error).message || err);
  process.exit(1);
});
