import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import {
  AcreditacionDoc,
  CmfDocumentOverride,
  fillStep3,
} from '../../src/automation/step3_acreedores';
import { loginAndNavigateToStep1 } from '../../src/automation/login';
import { launchBrowser } from '../../src/utils/browser';
import {
  AdditionalCreditor,
  ReclassifiedCreditor,
} from '../../src/utils/sentinel';

dotenv.config();

const BUCKET = 'documentos';
const PORTAL_TEST_RUT = '21917363-6';
const TMP_DIR = path.resolve('outputs/acreditaciones_tmp');

export interface SetupProfileConfig {
  clientName: string;
  clientRut: string;
  storagePrefix: string;
  cmfLocalPath: string;
  ctLocalPath?: string;
  portalClaveUnicaRut?: string;
}

export interface UploadFileSpec {
  localPath: string;
  storagePath: string;
  contentType: string;
}

export interface UploadDocumentsConfig {
  label: string;
  files: UploadFileSpec[];
}

export interface Step3CaseConfig {
  label: string;
  cmfStoragePath: string;
  cmfLocalFilename: string;
  mappedDocs: Omit<AcreditacionDoc, 'local_path'>[];
  sentinelReclassified?: ReclassifiedCreditor[];
  sentinelAdditional?: AdditionalCreditor[];
  cmfOverrides?: CmfDocumentOverride[];
  portalRut?: string;
  planLines?: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en .env`);
  }
  return value;
}

function buildSupabase(): SupabaseClient {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );
}

function logLine(msg: string) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  console.log(`[${ts}] ${msg}`);
}

function ensureFile(localPath: string) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Archivo no encontrado: ${localPath}`);
  }
}

export async function runSetupProfile(config: SetupProfileConfig) {
  const supabase = buildSupabase();
  const portalClaveUnicaRut = config.portalClaveUnicaRut ?? PORTAL_TEST_RUT;
  const claveUnicaPassword = requireEnv('CLAVE_UNICA_PASSWORD');

  console.log(`🔧 Setup perfil Supabase - ${config.clientName}\n`);

  ensureFile(config.cmfLocalPath);
  if (config.ctLocalPath) {
    ensureFile(config.ctLocalPath);
  }

  const { data: existing } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', config.clientRut)
    .maybeSingle();

  let clientId: string;

  if (existing) {
    console.log(`ℹ️  Perfil ya existe: ${existing.name} (${existing.id})`);
    clientId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from('clients')
      .insert({
        name: config.clientName,
        rut: config.clientRut,
        clave_unica_rut: portalClaveUnicaRut,
        clave_unica_password: claveUnicaPassword,
        carpeta_tributaria_path: null,
        carpeta_retenedores_path: null,
        informe_cmf_path: null,
      })
      .select('id, name')
      .single();

    if (error || !inserted) {
      throw new Error(`Error creando perfil: ${error?.message ?? 'insert vacio'}`);
    }
    console.log(`✓ Perfil creado: ${inserted.name} (${inserted.id})`);
    clientId = inserted.id;
  }

  const cmfStoragePath = `${config.storagePrefix}/informe_cmf.pdf`;
  const { error: cmfUploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(cmfStoragePath, fs.readFileSync(config.cmfLocalPath), {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (cmfUploadErr) {
    throw new Error(`Error subiendo CMF: ${cmfUploadErr.message}`);
  }

  const updatePayload: Record<string, string | null> = {
    informe_cmf_path: cmfStoragePath,
  };

  console.log(`✓ CMF subido -> ${BUCKET}/${cmfStoragePath}`);

  if (config.ctLocalPath) {
    const ctStoragePath = `${config.storagePrefix}/carpeta_tributaria.pdf`;
    const { error: ctUploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(ctStoragePath, fs.readFileSync(config.ctLocalPath), {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (ctUploadErr) {
      throw new Error(`Error subiendo CT: ${ctUploadErr.message}`);
    }
    updatePayload.carpeta_tributaria_path = ctStoragePath;
    console.log(`✓ Carpeta Tributaria subida -> ${BUCKET}/${ctStoragePath}`);
  }

  const { error: updateErr } = await supabase
    .from('clients')
    .update(updatePayload)
    .eq('rut', config.clientRut);
  if (updateErr) {
    throw new Error(`Error actualizando perfil: ${updateErr.message}`);
  }

  const { data: profile, error: verifyErr } = await supabase
    .from('clients')
    .select('id, name, rut, informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path')
    .eq('rut', config.clientRut)
    .single();

  if (verifyErr || !profile) {
    throw new Error(`Error verificando perfil: ${verifyErr?.message ?? 'sin fila'}`);
  }

  console.log('\n✅ Perfil verificado:');
  console.log(JSON.stringify(profile, null, 2));

  const pathsToValidate = [
    profile.informe_cmf_path,
    profile.carpeta_tributaria_path,
  ].filter(Boolean) as string[];
  const contaminated = pathsToValidate.some((entry) => !entry.startsWith(config.storagePrefix));
  if (contaminated) {
    throw new Error(`CONTAMINACION detectada: algun path no usa el prefijo "${config.storagePrefix}"`);
  }

  if (profile.carpeta_retenedores_path && !profile.carpeta_retenedores_path.startsWith(config.storagePrefix)) {
    console.log(
      `\n⚠️ carpeta_retenedores_path externo conservado: ${profile.carpeta_retenedores_path}`
    );
  }

  console.log(`\n✓ Sin contaminacion en CMF/CT - ambos paths usan prefijo "${config.storagePrefix}"`);
  console.log(`   CLIENT_ID="${clientId}"`);
}

export async function runUploadDocuments(config: UploadDocumentsConfig) {
  const supabase = buildSupabase();

  console.log(`🔧 Subiendo documentos - ${config.label}\n`);

  for (const file of config.files) {
    ensureFile(file.localPath);
    const buffer = fs.readFileSync(file.localPath);
    const { error } = await supabase.storage.from(BUCKET).upload(file.storagePath, buffer, {
      contentType: file.contentType,
      upsert: true,
    });
    if (error) {
      throw new Error(`Error subiendo ${path.basename(file.localPath)}: ${error.message}`);
    }
    console.log(
      `  ✓ ${path.basename(file.localPath)} -> ${file.storagePath} (${(buffer.length / 1024).toFixed(0)} KB)`
    );
  }

  console.log('\n🎉 Upload completado.');
}

function buildLocalDocPath(storagePath: string): string {
  const ext = path.extname(storagePath) || '.pdf';
  const slug = storagePath.replace(/[\\/]/g, '__').replace(new RegExp(`${ext}$`), '');
  return path.join(TMP_DIR, `${slug}${ext}`);
}

async function downloadFromStorage(
  supabase: SupabaseClient,
  storagePath: string,
  localPath: string
) {
  if (fs.existsSync(localPath)) {
    logLine(`  ♻️  Cache: ${path.basename(localPath)}`);
    return;
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Download failed [${storagePath}]: ${error?.message ?? 'blob vacio'}`);
  }

  fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
  logLine(`  ✓ Descargado: ${path.basename(localPath)}`);
}

export async function runStep3Case(config: Step3CaseConfig) {
  const supabase = buildSupabase() as SupabaseClient;
  const claveUnicaPassword = requireEnv('CLAVE_UNICA_PASSWORD');
  const portalRut = config.portalRut ?? PORTAL_TEST_RUT;

  process.env.DRY_RUN = 'true';
  process.env.BYPASS_DATE_CHECK = 'true';

  fs.mkdirSync(TMP_DIR, { recursive: true });

  const cmfLocalPath = path.join(TMP_DIR, config.cmfLocalFilename);
  const docs: AcreditacionDoc[] = config.mappedDocs.map((doc) => ({
    ...doc,
    local_path: buildLocalDocPath(doc.storage_path),
  }));

  logLine(`⏳ Descargando CMF - ${config.label}...`);
  await downloadFromStorage(supabase, config.cmfStoragePath, cmfLocalPath);

  logLine('⏳ Descargando documentos de acreditacion...');
  const seen = new Set<string>();
  for (const doc of docs) {
    if (seen.has(doc.storage_path)) continue;
    seen.add(doc.storage_path);
    await downloadFromStorage(supabase, doc.storage_path, doc.local_path!);
  }

  logLine(`\n═══════════════ PLAN ${config.label.toUpperCase()} ═══════════════`);
  for (const line of config.planLines ?? []) {
    logLine(line);
  }
  logLine(`Overrides CMF: ${config.cmfOverrides?.length ?? 0}`);
  logLine(`Reclasificados Sentinel: ${config.sentinelReclassified?.length ?? 0}`);
  logLine(`Acreedores NO-CMF: ${config.sentinelAdditional?.length ?? 0}`);
  logLine(`Docs mapeados: ${docs.length}`);
  logLine('═══════════════════════════════════════════════\n');

  const logger = {
    log: logLine,
    error: (msg: string, err?: unknown) => console.error(msg, err ?? ''),
  };

  const { browser, page } = await launchBrowser();
  try {
    logLine('🔒 Login con ClaveUnica...');
    await loginAndNavigateToStep1(page, portalRut, claveUnicaPassword, logger);

    const step3Url = `${new URL(page.url()).origin}/miSuperir/autenticado/renegociacion/verAcreedores`;
    logLine(`→ Navegando a Paso 3: ${step3Url}`);
    await page.goto(step3Url, { waitUntil: 'domcontentloaded' });

    logLine('📝 Ejecutando fillStep3...');
    const report = await fillStep3(
      page,
      cmfLocalPath,
      supabase as Parameters<typeof fillStep3>[2],
      logger,
      undefined,
      docs,
      config.sentinelReclassified ?? [],
      config.sentinelAdditional ?? [],
      config.cmfOverrides ?? []
    );

    logLine('\n═══════════════ RESULTADO ═══════════════');
    logLine(`Acreedores agregados: ${report.added.length}`);
    for (const added of report.added) {
      logLine(
        `  ✅ ${added.institucion} -> ${added.nombreCatalogo} ($${added.monto.toLocaleString('es-CL')})`
      );
    }
    logLine(`Acreedores saltados: ${report.skipped.length}`);
    for (const skipped of report.skipped) {
      logLine(`  ⚠️  ${skipped.institucion}: ${skipped.reason}`);
    }
    logLine('════════════════════════════════════════\n');
  } finally {
    await browser.close();
  }
}
