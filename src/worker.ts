import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import { launchBrowser, screenshotOnFailure } from './utils/browser';
import { loginAndNavigateToStep1, CredentialError } from './automation/login';
import { fillStep1, ClientData } from './automation/step1_personal';
import { supabase, prodSupabase } from './utils/supabaseWorker';
import { RunnerLogger } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { fillStep2 } from './automation/step2_declaraciones';
import { fillStep3, AcreditacionDoc, Step3Report, SkipCode, SKIP_CODES_ACCIONABLES } from './automation/step3_acreedores';
import { fillStep4 } from './automation/step4_apoderado';
import { fillStep5, buildJustificativos, Step5Input } from './automation/step5_ingresos';
import { fillAllSteps } from './automation/all_steps';
import { runIngresosAgent, IncomeDocInput } from './agents/ingresos_agent';
import { getOptimizedPdfPath } from './utils/pdf_optimizer';
import { runTributarioAgent } from './agents/tributario_agent';
import { analyzeCmfPdf } from './utils/cmf_analyzer';
import { createAlert, clearAlert } from './utils/alerts';
import { cleanupDraft } from './automation/cleanup';
import { runCentinelaAgent, CentinelaBlockedError } from './agents/centinela_agent';
import { resolveCertInstitutions } from './utils/cert_institution_resolver';
import { fetchAcreedoresCatalog, topNCandidates } from './utils/acreedor_matcher';
import { buildReadIssuesAlert } from './utils/read_issues_alert';
import { runMapeadorAgent } from './agents/mapeador_agent';
import { CentinelaOutput } from './agents/types';

/**
 * BUG-08 FIX: Dedicated error class for cases that must not be retried and
 * must preserve the 'blocked' status (e.g. F29 activity detected).
 * Treated the same as CredentialError in the retry loop — breaks immediately.
 */
class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

const POLL_INTERVAL_MS = 5000;
let keepRunning = true;

const CLIENTS_TABLE = 'clients';
const JOBS_TABLE = 'automation_jobs';

/**
 * Uploads a local file to Supabase storage 'screenshots' bucket
 * and returns the public URL. Gracefully handles errors.
 */
async function uploadToStorage(
  localPath: string,
  destFileName: string,
  logger: RunnerLogger
): Promise<string | null> {
  try {
    if (!fs.existsSync(localPath)) {
      logger.error(`Archivo para subir no existe en la ruta local: ${localPath}`);
      return null;
    }

    const fileBuffer = fs.readFileSync(localPath);
    const { error } = await supabase.storage
      .from('screenshots')
      .upload(destFileName, fileBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) {
      logger.error(`Error al subir a Supabase Storage: ${error.message}`);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('screenshots')
      .getPublicUrl(destFileName);

    return urlData.publicUrl;
  } catch (err: any) {
    logger.error(`Excepción capturada al subir archivo a Storage: ${err.message || err}`);
    return null;
  }
}

/**
 * Obtiene las credenciales ClaveÚnica de un cliente.
 *
 * — Cliente de prueba (21917363-6 / recPatoPrueba): usa CLAVE_UNICA_PASSWORD del .env.
 * — Cliente real: lee `clave_cu_override ?? airtable_clave_unica` de la tabla
 *   `renegociacion_overrides` (unida por `airtable_id`).
 *
 * El RUT de login es siempre `client.rut` — en producción el cliente se autentica
 * con su propio RUT, no con un RUT de portal de prueba.
 */
async function resolveClaveUnica(
  client: any,
  logger: RunnerLogger
): Promise<{ claveUnicaRut: string; claveUnicaPassword: string }> {
  const isTestClient = client.rut === '21917363-6' || client.airtable_id === 'recPatoPrueba';

  if (isTestClient) {
    const pwd = (process.env.CLAVE_UNICA_PASSWORD ?? '').trim();
    if (!pwd) {
      throw new Error('Falta CLAVE_UNICA_PASSWORD en .env para el cliente de prueba.');
    }
    return { claveUnicaRut: client.clave_unica_rut ?? client.rut, claveUnicaPassword: pwd };
  }

  // Si el cliente tiene airtable_id, buscar en renegociacion_overrides (fuente canónica en prod).
  // OJO: `renegociacion_overrides` vive SOLO en producción (PROD_SUPABASE_URL), por eso se
  // consulta con `prodSupabase`, NO con el cliente sandbox. Si no hay conexión a prod
  // configurada, se omite el lookup y se cae al fallback de clients.clave_unica_password.
  if (client.airtable_id && prodSupabase) {
    const { data: overrides, error } = await prodSupabase
      .from('renegociacion_overrides')
      .select('clave_cu_override, airtable_clave_unica')
      .eq('airtable_id', client.airtable_id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Error leyendo renegociacion_overrides para airtable_id=${client.airtable_id}: ${error.message}`
      );
    }
    if (overrides) {
      const pwd = ((overrides.clave_cu_override ?? overrides.airtable_clave_unica) ?? '').trim();
      if (pwd) {
        const source = overrides.clave_cu_override ? 'clave_cu_override' : 'airtable_clave_unica';
        logger.log(`✓ ClaveÚnica obtenida de renegociacion_overrides (fuente: ${source}).`);
        return { claveUnicaRut: client.clave_unica_rut ?? client.rut, claveUnicaPassword: pwd };
      }
    }
    logger.log(`⚠️ renegociacion_overrides sin credenciales para airtable_id=${client.airtable_id}. Intentando fallback a clients.clave_unica_password.`);
  } else if (client.airtable_id && !prodSupabase) {
    logger.log(`⚠️ El cliente tiene airtable_id=${client.airtable_id} pero no hay conexión a producción (PROD_SUPABASE_URL/PROD_SUPABASE_SERVICE_ROLE_KEY) para leer renegociacion_overrides. Intentando fallback a clients.clave_unica_password.`);
  }

  // Fallback: clave_unica_password directo en la tabla clients
  const directPwd = (client.clave_unica_password ?? '').trim();
  if (directPwd) {
    logger.log(`✓ ClaveÚnica obtenida de clients.clave_unica_password (fallback).`);
    return { claveUnicaRut: client.clave_unica_rut ?? client.rut, claveUnicaPassword: directPwd };
  }

  throw new Error(
    `No se pudo resolver ClaveÚnica para ${client.rut}: ` +
    `sin airtable_id, sin renegociacion_overrides, y clave_unica_password vacío en clients.`
  );
}

/**
 * Checks for orphan jobs (stuck in 'running') at startup and marks them failed.
 */
async function cleanupOrphanJobs(): Promise<void> {
  console.log(`🤖 Buscando trabajos huérfanos en ${JOBS_TABLE} (en estado "running")...`);
  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .update({
      status: 'failed',
      error_log: 'Worker reiniciado: job abandonado',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .select();

  if (error) {
    console.error('❌ Error limpiando trabajos huérfanos:', error.message);
  } else if (data && data.length > 0) {
    console.log(`✓ Se marcaron como fallidos ${data.length} trabajos huérfanos.`);
  } else {
    console.log('✓ No se encontraron trabajos huérfanos.');
  }
}

/**
 * Processes a single automation job.
 */
/**
 * Escribe un mensaje de progreso en lenguaje claro (NO técnico) en automation_jobs
 * para que el panel del dashboard muestre, en vivo, qué está haciendo el robot ahora
 * mismo. También bumpea updated_at para que el caso "en proceso" quede arriba y su
 * "hace X" se sienta vivo. Best-effort: si la columna no existe todavía (migración v6
 * sin correr) o falla la red, NO interrumpe el run — el progreso es informativo.
 */
/**
 * Limpia el nombre de una institución para mostrarlo en una ALERTA al abogado. El parser del
 * CMF le pega tokens de tipo de crédito ("Linea Banco de Chile Crédit", "Banco del Estado de
 * Chile Consum"); para una alerta legible los quitamos y dejamos el banco a secas.
 */
function prettyInst(name: string): string {
  return (name || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')                 // sufijo de producto entre paréntesis
    .replace(/\s+[—–-]\s+.*$/g, '')                    // sufijo "— descriptor" del LLM
    .replace(/^\s*(L[íi]nea|Tarjet\w*)\s+/i, '')       // token de tipo al inicio
    .replace(/\s+(Consum\w*|Cr[ée]dit\w*|Vivien\w*|Hipotec\w*)\s*$/i, '') // token de tipo al final
    .replace(/\s+/g, ' ')
    .trim() || name;
}

/** Formatea un monto CLP como "$1.234.567". */
function clp(n: number | undefined): string {
  return `$${(n || 0).toLocaleString('es-CL')}`;
}

async function reportProgress(jobId: string, message: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from(JOBS_TABLE)
      .update({ progress_message: message, progress_updated_at: now, updated_at: now })
      .eq('id', jobId);
    if (error) console.warn(`[progress] no se pudo guardar (${error.message}); se continúa.`);
  } catch (err: any) {
    console.warn(`[progress] excepción al guardar (${err?.message || err}); se continúa.`);
  }
}

// Palabras clave (en el filename) que marcan un documento como de INGRESO (Paso 5).
// La CATEGORÍA fina (liquidación/pensión/arriendo/etc.) la decide el agente leyendo
// el contenido; acá solo separamos los docs de ingreso del resto (CMF/CT/acreedores).
const INCOME_FILENAME_KEYWORDS = [
  'liquidacion', 'liquidación', 'sueldo', 'remuneracion', 'remuneración', 'pension', 'pensión',
  'jubilacion', 'jubilación', 'montepio', 'montepío', 'arriendo', 'honorario', 'boleta',
  'aporte', 'retiro', 'renta', 'ingreso',
];
const COTIZACIONES_FILENAME_KEYWORDS = ['cotizacion', 'cotización', 'cotizaciones'];

/**
 * Reúne los documentos de ingreso del cliente desde `client_documents`, los
 * descarga, corre el Agente de Ingresos (lectura nativa + cálculo determinista)
 * y arma el `Step5Input` para `fillStep5`. Best-effort: cualquier fallo → null
 * (se omite el Paso 5 sin romper el job). General: sin nada hardcodeado al caso.
 */
async function gatherStep5Input(
  client: any,
  tempDir: string,
  logger: RunnerLogger,
  jobId?: string
): Promise<Step5Input | null> {
  try {
    const { data: docs, error } = await supabase
      .from('client_documents')
      .select('filename, storage_path, document_type, acreditacion_tipo, institucion_cmf')
      .eq('client_id', client.id);
    if (error) {
      logger.error('⚠️ [Paso 5] No se pudo leer client_documents:', error.message);
      return null;
    }
    const rows = (docs || []).filter((d: any) => d?.filename && d?.storage_path);
    const isCotiz = (f: string) => COTIZACIONES_FILENAME_KEYWORDS.some((k) => f.toLowerCase().includes(k));
    const isIncome = (f: string) => INCOME_FILENAME_KEYWORDS.some((k) => f.toLowerCase().includes(k));

    // Un cert de acreedor (Paso 3) se reconoce por su METADATA, no por el filename: institucion_cmf
    // poblado, acreditacion_tipo monto/vencimiento, o document_type 22/23. Los docs de ingreso quedan
    // con la metadata genérica del dashboard (institucion_cmf '', acreditacion_tipo 'general',
    // document_type 24). Regla GENERAL (L35): candidato a ingreso = TODO lo que NO es cert de acreedor,
    // para NO depender del nombre del archivo (un 'ilovepdf_merged.pdf' o 'scan1.pdf' se perdía y el
    // Paso 5 se omitía en silencio). Un cert mal-resuelto (institucion_cmf vacío) que se cuele lo
    // descarta aguas abajo el LLM (paso "0)" del prompt → category 'otro'); nunca declara un ingreso falso.
    const isAcreedorCert = (d: any): boolean => {
      const inst = (d?.institucion_cmf ?? '').toString().trim();
      const tipo = (d?.acreditacion_tipo ?? '').toString().trim().toLowerCase();
      const dt = Number(d?.document_type);
      return inst.length > 0 || tipo === 'monto' || tipo === 'vencimiento' || dt === 22 || dt === 23;
    };

    const incomeRows = rows.filter((d: any) => isCotiz(d.filename) || isIncome(d.filename) || !isAcreedorCert(d));
    if (incomeRows.length === 0) {
      logger.log('ℹ️ [Paso 5] No se encontraron documentos de ingreso en client_documents — se omite el Paso 5.');
      if (jobId) {
        const { error: alertErr } = await supabase.from('automation_alerts').insert({
          job_id: jobId,
          client_id: client.id,
          step: 5,
          alert_type: 'needs_review',
          description:
            'Paso 5 (Ingresos) omitido: el cliente no tiene ningún documento de ingreso cargado ' +
            '(liquidaciones, pensión, honorarios, etc.). Cargar el respaldo y declarar el ingreso manualmente.',
        });
        if (alertErr) logger.error('⚠️ [Paso 5] No se pudo registrar la alerta de omisión:', alertErr.message);
      }
      return null;
    }

    // Descargar a tempDir.
    const filenameToPath = new Map<string, string>();
    const incomeDocs: IncomeDocInput[] = [];
    let cotizacionesPath: string | null = null;
    for (const d of incomeRows) {
      const ext = path.extname(d.filename) || '.pdf';
      const local = path.join(tempDir, `step5_${client.id}_${path.basename(d.storage_path)}`).replace(/\s+/g, '_');
      const finalLocal = local.endsWith(ext) ? local : `${local}${ext}`;
      const { data: blob, error: dlErr } = await supabase.storage.from('documentos').download(d.storage_path);
      if (dlErr || !blob) {
        logger.error(`⚠️ [Paso 5] No se pudo descargar ${d.filename}: ${dlErr?.message || 'vacío'}`);
        continue;
      }
      fs.writeFileSync(finalLocal, Buffer.from(await blob.arrayBuffer()));
      filenameToPath.set(d.filename, finalLocal);
      if (isCotiz(d.filename)) {
        cotizacionesPath = finalLocal;
      }
      // El cert de cotizaciones también va al agente (extrae fecha+RUT), pero NO
      // es un ingreso justificativo.
      incomeDocs.push({ filename: d.filename, localPath: finalLocal });
    }

    if (incomeDocs.length === 0) return null;

    const ingresosOutput = await runIngresosAgent(supabase, client.id, incomeDocs, logger);

    // Resolver: si el cert de cotizaciones lo identificó el agente, preferir ese filename.
    if (!cotizacionesPath && ingresosOutput.cotizacionesCert?.filename) {
      cotizacionesPath = filenameToPath.get(ingresosOutput.cotizacionesCert.filename) || null;
    }

    const justificativos = buildJustificativos(
      ingresosOutput.incomes,
      (filename) => filenameToPath.get(filename) || null
    );

    return { incomes: ingresosOutput.incomes, justificativos, cotizacionesPath };
  } catch (err: any) {
    logger.error('⚠️ [Paso 5] Excepción al preparar el Paso 5 (se omite):', err?.message || err);
    return null;
  }
}

async function processJob(job: any): Promise<void> {
  // 1. Fetch client data associated with this job
  const { data: clients, error: clientError } = await supabase
    .from(CLIENTS_TABLE)
    .select('*')
    .eq('id', job.client_id)
    .limit(1);

  if (clientError || !clients || clients.length === 0) {
    console.error(`❌ Client not found for job ${job.id} in ${CLIENTS_TABLE}. Error:`, clientError?.message);
    await supabase
      .from(JOBS_TABLE)
      .update({
        status: 'failed',
        error_log: `Error: No se encontró el cliente con ID ${job.client_id} en la base de datos (${CLIENTS_TABLE}).`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    return;
  }

  const client = clients[0];
  
  const logger = new RunnerLogger(client.rut, job.step);
  
  logger.log(`🤖 Iniciando procesamiento de Job ${job.id} para cliente ${client.name} (RUT ${client.rut})`);
  await reportProgress(job.id, 'El robot tomó el caso y está preparando todo…');

  // A3 — Alarma de flags de bypass activos (desactivan validaciones críticas). En
  // producción NO deberían estar. Se loguea ruidoso para que quede en el registro del job.
  const activeBypass = ['DISABLE_SENTINEL', 'BYPASS_DATE_CHECK', 'BYPASS_DATE_VALIDATION', 'BYPASS_RUT_CHECK', 'FORCE_VISION_MAPEADOR']
    .filter((f) => process.env[f] === 'true');
  if (activeBypass.length > 0) {
    logger.log(`⚠️⚠️ FLAGS DE BYPASS ACTIVOS (solo para pruebas, NO producción): ${activeBypass.join(', ')}`);
  }

  // Support steps 0, 1, 2, 3, and 4
  if (job.step !== 0 && job.step !== 1 && job.step !== 2 && job.step !== 3 && job.step !== 4) {
    const errorMsg = `Paso ${job.step} no está soportado. Actualmente solo se automatizan Pasos 0, 1, 2, 3 y 4.`;
    logger.error(errorMsg);
    await supabase
      .from(JOBS_TABLE)
      .update({
        status: 'failed',
        error_log: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    return;
  }

  // Resolver credenciales una sola vez — se reusan en el login principal y en la
  // limpieza del borrador. Un fallo aquí falla el job sin reintentos (configuración inválida).
  let resolvedClaveUnicaRut = '';
  let resolvedClaveUnicaPassword = '';
  try {
    ({ claveUnicaRut: resolvedClaveUnicaRut, claveUnicaPassword: resolvedClaveUnicaPassword } =
      await resolveClaveUnica(client, logger));
  } catch (credErr: any) {
    const msg = `No se pudieron resolver las credenciales ClaveÚnica: ${credErr.message}`;
    logger.error(`❌ ${msg}`);
    await supabase
      .from(JOBS_TABLE)
      .update({ status: 'failed', error_log: msg, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    return;
  }

  // El Centinela (API #1) se corre dentro del bloque step===3|0, después de
  // descargar el CMF, para evitar la doble descarga y limitar el coste a los
  // pasos que realmente necesitan el análisis de acreedores.

  // Safety interlock: set DRY_RUN env dynamically for this job
  const originalDryRun = process.env.DRY_RUN;
  const maxAttempts = 3;
  let success = false;
  let lastError: any = null;
  let publicFailureUrl: string | null = null;
  let fullErrorLog = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    logger.log(`⏳ Intento ${attempt} de ${maxAttempts} para procesar el Job ${job.id}...`);

    // Temporary file paths for Step 2 and Step 3 PDFs on the Mac mini
    let tributariaLocalPath = '';
    let retenedoresLocalPath = '';
    let tributariaOptimizedPath = '';
    let retenedoresOptimizedPath = '';
    let cmfLocalPath = '';
    let browserInstance: any = null;
    let mappedAcreditacionDocs: AcreditacionDoc[] = [];
    let centinelaOutput: CentinelaOutput = {
      reclassifiedCreditors: [], identified261Creditors: [],
      additionalCreditors: [], cmfDocumentOverrides: [],
      deReclassified261Creditors: [], fechasClave: [],
    };
    // Si queda con motivo: el cliente califica pero los documentos del Paso 3 no
    // cumplen → en el flujo completo (step:0) se omite SOLO el Paso 3 y se guardan 1, 2 y 4.
    let skipStep3Reason: string | null = null;

    // Limpieza best-effort del borrador del portal (login + cleanupDraft). Se usa
    // cuando el caso es inválido de raíz (no califica) o cuando el Paso 3 individual falla.
    const cleanupPortalDraftBestEffort = async () => {
      try {
        logger.log('⏳ Iniciando navegador y sesión para limpiar el borrador en el portal...');
        const { browser, page } = await launchBrowser();
        browserInstance = browser;
        await loginAndNavigateToStep1(page, resolvedClaveUnicaRut, resolvedClaveUnicaPassword, logger, {
          region: client.region, comuna: client.comuna, email: client.email, telefono: client.telefono,
        });
        await cleanupDraft(page, logger);
      } catch (cleanupErr: any) {
        logger.error(`⚠️ No se pudo realizar la autolimpieza en el portal: ${cleanupErr.message || cleanupErr}`);
      }
    };

    try {
      if (job.step === 3 || job.step === 0) {
        logger.log('⏳ Iniciando validación legal de Informe de Deudas CMF para el Paso 3...');
        await reportProgress(job.id, 'Revisando el Informe de Deudas (CMF)…');
        if (!client.informe_cmf_path) {
          throw new Error('Error: No se encontró la ruta del informe CMF en el perfil del cliente para el Paso 3.');
        }

        const tempDir = path.join(process.cwd(), 'outputs');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        // A7 — En step:0, chequear F29 (Agente Tributario) ANTES del Centinela/Mapeador,
        // que gastan créditos de API. Si es Primera Categoría con actividad F29, se bloquea
        // temprano (sin gastar la cadena de acreedores). El Tributario es idempotente
        // (hash del PDF), así que la corrida posterior en all-steps reusa el cache.
        if (job.step === 0 && client.carpeta_tributaria_path) {
          const ctEarlyPath = path.join(tempDir, `tributaria_early_${job.id}.pdf`);
          const { data: ctBlob, error: ctErr } = await supabase.storage
            .from('documentos')
            .download(client.carpeta_tributaria_path);
          if (!ctErr && ctBlob) {
            fs.writeFileSync(ctEarlyPath, Buffer.from(await ctBlob.arrayBuffer()));
            const tribEarly = await runTributarioAgent(supabase, client.id, ctEarlyPath, logger);
            fs.existsSync(ctEarlyPath) && fs.unlinkSync(ctEarlyPath);
            if (tribEarly.f29_meses_con_actividad.length > 0) {
              const meses = tribEarly.f29_meses_con_actividad.join(', ');
              const alertDesc = `Paso 2 bloqueado (pre-chequeo A7): primera categoría con actividad F29 en ${tribEarly.f29_meses_con_actividad.length} mes(es): ${meses}`;
              logger.log(`🚫 ${alertDesc} — bloqueando antes de gastar el Centinela.`);
              const { error: insertErr } = await supabase.from('automation_alerts').insert({
                job_id: job.id, client_id: client.id, step: 2, alert_type: 'blocked', description: alertDesc,
              });
              if (insertErr) logger.error('⚠️ No se pudo registrar alerta F29:', insertErr.message);
              await supabase.from(JOBS_TABLE).update({
                status: 'blocked',
                error_log: logger.getBufferText() + `\n\n🚫 ${alertDesc}`,
                updated_at: new Date().toISOString(),
              }).eq('id', job.id);
              throw new BlockedError(alertDesc);
            }
          }
        }

        cmfLocalPath = path.join(tempDir, `cmf_raw_${job.id}.pdf`);

        // 1. Download CMF PDF
        logger.log(`⏳ Descargando Informe CMF de Supabase Storage: ${client.informe_cmf_path}...`);
        const { data: cmfBlob, error: cmfError } = await supabase.storage
          .from('documentos')
          .download(client.informe_cmf_path);

        if (cmfError || !cmfBlob) {
          throw new Error(`Error al descargar Informe CMF: ${cmfError?.message || 'Blob vacío'}`);
        }
        fs.writeFileSync(cmfLocalPath, Buffer.from(await cmfBlob.arrayBuffer()));
        logger.log('✓ Informe CMF descargado.');
        await reportProgress(job.id, 'Analizando las deudas del Informe CMF…');

        // 2. Analyze CMF PDF (result also passed into cognitive orchestrator to avoid double-parse)
        const cmfResult = await analyzeCmfPdf(cmfLocalPath, logger);

        // 2.5. Auto-asociación de certificados → acreedor del catálogo POR RUT.
        // El abogado ya NO elige el banco a mano en el dashboard; el worker lo
        // deriva del RUT del documento (fallback: nombre de archivo) y lo persiste
        // en client_documents, para que el Centinela y el Mapeador usen la
        // asociación correcta. Best-effort: no interrumpe el flujo si falla.
        await resolveCertInstitutions(supabase, client, logger).catch((err) =>
          logger.error('🔗 [Resolver] Error no controlado en la auto-asociación (se continúa):', err?.message || err)
        );

        // 3. Run Centinela Agent (API #1) — ahora aquí, después del CMF descargado
        await reportProgress(job.id, 'Revisando los documentos de cada deuda y clasificándolas (con mora vs. al día)…');
        try {
          centinelaOutput = await runCentinelaAgent(supabase, client.id, client, cmfLocalPath, logger);
        } catch (centinelaErr: any) {
          if (centinelaErr instanceof CentinelaBlockedError) {
            // Bloqueo SEMÁNTICO (documentos vencidos/incompletos): motivo claro y
            // accionable por el abogado. Estado real = 'blocked' (no 'failed'), con
            // alerta + error_message para que el panel muestre el motivo exacto,
            // no "falló sin alerta registrada".
            const reason = centinelaErr.message;
            logger.error(`🚫 Centinela bloqueó el caso: ${reason}`);
            const { error: alertErr } = await supabase.from('automation_alerts').insert({
              job_id: job.id, client_id: client.id, step: job.step,
              alert_type: 'blocked', description: reason,
            });
            if (alertErr) logger.error('⚠️ No se pudo registrar alerta de bloqueo del Centinela:', alertErr.message);
            await supabase.from(JOBS_TABLE).update({
              status: 'blocked',
              error_message: reason,
              error_log: logger.getBufferText() + `\n\n🚫 CENTINELA BLOQUEÓ: ${reason}`,
              updated_at: new Date().toISOString(),
            }).eq('id', job.id);
            return;
          }
          // Error TÉCNICO del centinela (red, créditos API) — distinto del bloqueo
          // semántico. El job queda 'failed', pero igual registramos alerta + error_message
          // para que el panel no muestre "falló sin alerta registrada".
          const techMsg = `Error técnico del Centinela (red, API o créditos): ${centinelaErr?.message || centinelaErr}`;
          logger.error(`⚠️ ${techMsg}`);
          const { error: techAlertErr } = await supabase.from('automation_alerts').insert({
            job_id: job.id, client_id: client.id, step: job.step,
            alert_type: 'failed', description: techMsg,
          });
          if (techAlertErr) logger.error('⚠️ No se pudo registrar alerta técnica del Centinela:', techAlertErr.message);
          await supabase.from(JOBS_TABLE).update({
            status: 'failed',
            error_message: techMsg,
            error_log: logger.getBufferText() + `\n\n❌ EXCEPCIÓN CENTINELA: ${centinelaErr?.message || centinelaErr}`,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          return;
        }

        // 4. Run Mapeador Agent (API #2) — mapea documentos a acreedores
        logger.log('🗺️ Ejecutando Agente Mapeador (Orquestador Cognitivo) para mapear documentos...');
        await reportProgress(job.id, 'Emparejando cada certificado con su deuda…');
        const mapeadorOutput = await runMapeadorAgent(
          supabase, client.id, client, cmfLocalPath, centinelaOutput, logger
        );
        mappedAcreditacionDocs = mapeadorOutput.mappedDocs;

        // El Paso 3 SOLO se completa si el cliente CALIFICA (atraso 91+ días) Y los DOCUMENTOS
        // pasan la auditoría cognitiva. La regla de 80 UF genera solo una advertencia, no bloquea.
        if (cmfResult.meets90DaysRequirement && !cmfResult.meetsAmountRequirement) {
          logger.log(`⚠️  ADVERTENCIA: Suma del total del crédito de acreedores con 90+d ($${cmfResult.totalCreditoOf90PlusCreditors.toLocaleString('es-CL')}) no alcanza 80 UF ($${cmfResult.requiredAmountCLP.toLocaleString('es-CL')}). El flujo continúa; revisar documentos adicionales si aplica.`);
        }

        // Requisito de fondo (Art. 260): al menos 2 productos con mora >= 91 días.
        // Se cuentan los del CMF + los reclasificados por el Centinela + los NO-CMF Art.260.
        // B2: contar también los acreedores NO-CMF Art.260 (patrón William/TGR) — un
        // cliente que califica gracias a una deuda NO-CMF 260 NO debe quedar fuera.
        const cmf90PlusCount = cmfResult.qualifying90PlusCount || 0;
        const reclassifiedCount = centinelaOutput.reclassifiedCreditors.length;
        const nonCmf260Count = (centinelaOutput.additionalCreditors || []).filter(
          (a) => a.categoria_articulo === 260
        ).length;
        // REGLA 10: productos que el CMF marcaba 90+d pero el certificado certifica
        // vigentes (260→261) ya NO cuentan para el requisito de 2 productos en mora.
        const deReclassifiedCount = (centinelaOutput.deReclassified261Creditors || []).length;
        const totalQualifyingCount =
          Math.max(0, cmf90PlusCount - deReclassifiedCount) + reclassifiedCount + nonCmf260Count;

        // Alerta (no bloqueante): deudas con mora 90+d que se declararon en Art. 261 por NO
        // poder acreditar el vencimiento (backstop determinista) o por certificado "vigente"
        // (REGLA 10). El abogado debe revisarlas antes de presentar.
        if ((centinelaOutput.deReclassified261Creditors || []).length > 0) {
          const items = centinelaOutput.deReclassified261Creditors!;
          const bullets = items
            .map((d) => `• ${prettyInst(d.institucion_cmf)} (${clp(d.total_credito_clp)})`)
            .join('\n');
          const enc = items.length === 1
            ? 'Hay 1 deuda con más de 90 días de mora que se declaró en Art. 261 (Otros Acreedores) en lugar de Art. 260, porque no se pudo acreditar la fecha de vencimiento con un documento (o el certificado la da como vigente).'
            : `Hay ${items.length} deudas con más de 90 días de mora que se declararon en Art. 261 (Otros Acreedores) en lugar de Art. 260, porque no se pudo acreditar la fecha de vencimiento con un documento (o el certificado las da como vigentes).`;
          const desc = `Revisar clasificación 260/261 antes de presentar:\n${bullets}\n\n${enc} Si conseguís un documento que acredite el vencimiento, podés moverla(s) a Art. 260.`;
          const { error: drAlertErr } = await supabase.from('automation_alerts').insert({
            job_id: job.id, client_id: client.id, step: 3, alert_type: 'needs_review', description: desc,
          });
          if (drAlertErr) logger.error('⚠️ No se pudo registrar alerta de de-reclasificación 260→261:', drAlertErr.message);
          logger.log(`🔔 ${desc}`);
        }

        const noCalifica = totalQualifyingCount < 2;
        // Bloqueos del Mapeador, separados por severidad (regla rectora: declarar TODO lo
        // acreditable; ante un documento faltante, no declarar ESA deuda, NO omitir el resto):
        //  · missing_document → NO bloquea. fillStep3 declara los acreedores que SÍ tienen
        //    documento y reporta (Step3Report.skipped) los que no; acá solo se alerta (needs_review).
        //  · rut_mismatch → SÍ bloquea: el certificado está mal atribuido (RUT del emisor ≠ acreedor),
        //    declararlo arriesga acreditar con el documento equivocado.
        const rutMismatchAlerts = mapeadorOutput.alerts.filter(
          (a) => a.type === 'rut_mismatch' && process.env.BYPASS_RUT_CHECK !== 'true'
        );
        const docMissingAlerts = mapeadorOutput.alerts.filter((a) => a.type === 'missing_document');
        const hardBlock = noCalifica || rutMismatchAlerts.length > 0;

        if (hardBlock) {
          const motivo = noCalifica
            ? `El cliente no cumple el requisito de fondo de la renegociación: se requieren al menos 2 productos con mora ≥ 91 días y se detectó(aron) ${totalQualifyingCount} ` +
              `(CMF: ${cmf90PlusCount}, reclasificados por el Centinela: ${reclassifiedCount}, NO-CMF Art. 260: ${nonCmf260Count}, de-reclasificados 260→261: ${deReclassifiedCount}). ` +
              `Revisar el Informe CMF y los documentos de acreditación; si el cliente igual debiera calificar, verificar que las deudas con mora estén bien clasificadas.`
            : `Certificado(s) mal atribuido(s) — el RUT del documento no corresponde al acreedor: ${rutMismatchAlerts.map((a) => a.message).join('; ')}`;

          if (job.step === 0) {
            // Flujo completo: se omite SOLO el Paso 3 y se guardan los Pasos 1, 2 y 4.
            skipStep3Reason = motivo;
            logger.log(`⏭️  Paso 3 NO se completará (se guardarán los Pasos 1, 2 y 4): ${motivo}`);
            const { error: insertErr } = await supabase.from('automation_alerts').insert({
              job_id: job.id,
              client_id: client.id,
              step: 3,
              alert_type: 'blocked',
              description: `Paso 3 omitido (no cumple requisitos): ${motivo}`,
            });
            if (insertErr) logger.error('⚠️ No se pudo registrar alerta de Paso 3 omitido:', insertErr.message);
          } else {
            // Paso 3 individual: no hay nada que guardar → el job queda 'blocked' (no
            // 'failed': reintentar no resuelve un requisito de fondo no cumplido o un
            // certificado mal atribuido). Se registra alerta + error_message para que el
            // panel del dashboard muestre el motivo legible, no "falló sin alerta".
            logger.error(`🚫 Paso 3 no se puede completar: ${motivo}`);
            await cleanupPortalDraftBestEffort();
            const { error: insertErr } = await supabase.from('automation_alerts').insert({
              job_id: job.id,
              client_id: client.id,
              step: 3,
              alert_type: 'blocked',
              description: motivo,
            });
            if (insertErr) logger.error('⚠️ No se pudo registrar alerta de bloqueo del Paso 3:', insertErr.message);
            await supabase
              .from(JOBS_TABLE)
              .update({
                status: 'blocked',
                error_message: motivo,
                error_log: logger.getBufferText() + `\n\n🚫 PASO 3 BLOQUEADO: ${motivo}`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id);
            return;
          }
        } else {
          logger.log('✓ El cliente califica. Se completará el Paso 3 declarando TODO lo acreditable.');

          // Documentos faltantes → NO bloquea: se declara el resto y se alerta lo faltante
          // (carga manual). fillStep3 igual reporta sus propios saltos por-acreedor.
          if (docMissingAlerts.length > 0) {
            const desc = `Acreedores sin documento de acreditación — se declara el resto y estos quedan para carga manual:\n` +
              docMissingAlerts.map((a) => `• ${a.message}`).join('\n');
            const { error: dmErr } = await supabase.from('automation_alerts').insert({
              job_id: job.id, client_id: client.id, step: 3, alert_type: 'needs_review', description: desc,
            });
            if (dmErr) logger.error('⚠️ No se pudo registrar alerta de documentos faltantes:', dmErr.message);
            logger.log(`🔔 ${desc}`);
          }

          // Detección informativa (NO bloqueante): el gate del abogado se eliminó por
          // decisión del abogado (2026-06-19). Cuando el abogado sube la carpeta y
          // autoriza la automatización, el flujo corre de corrido: ni los acreedores
          // NO-CMF ni los montos divergentes (amount_mismatch) frenan el Paso 3 en
          // 'pending_review'. Solo se anuncia éxito o fallo al final.
          // Los documentos faltantes (missing_document) NO bloquean: se declaran los
          // acreedores acreditables y se alertan los faltantes. Solo rut_mismatch bloquea (arriba).
          const informativeSignals: string[] = [];
          const nonCmfDetected = (centinelaOutput.additionalCreditors || []).filter((a) => a.needs_lawyer_confirmation);
          if (nonCmfDetected.length > 0) {
            informativeSignals.push(`${nonCmfDetected.length} acreedor(es) NO-CMF (${nonCmfDetected.map((a) => a.institucion_cmf).join(', ')})`);
          }
          const amountAlerts = mapeadorOutput.alerts.filter((a) => a.type === 'amount_mismatch');
          if (amountAlerts.length > 0) {
            informativeSignals.push(`monto divergente: ${amountAlerts.map((a) => a.message).join('; ')}`);
          }
          if (informativeSignals.length > 0) {
            // Solo se loguea para trazabilidad (queda en error_log del job). No se inserta
            // alerta 'needs_review' ni se detiene el flujo: se continúa con el Paso 3.
            logger.log(`ℹ️ Señales detectadas (no bloqueantes, se continúa con el Paso 3): ${informativeSignals.join(' · ')}.`);
          }
        }
      }

      if (job.step === 2 || job.step === 0) {
        logger.log('⏳ Iniciando preparación de PDFs para el Paso 2...');
        if (!client.carpeta_tributaria_path || !client.carpeta_retenedores_path) {
          throw new Error('Faltan documentos obligatorios: la Carpeta Tributaria y los Agentes Retenedores (ambos requeridos para el Paso 2) deben estar registrados en la tabla clients.');
        }

        const tempDir = path.join(process.cwd(), 'outputs');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        tributariaLocalPath = path.join(tempDir, `tributaria_raw_${job.id}.pdf`);
        retenedoresLocalPath = path.join(tempDir, `retenedores_raw_${job.id}.pdf`);
        tributariaOptimizedPath = path.join(tempDir, `tributaria_opt_${job.id}.pdf`);
        retenedoresOptimizedPath = path.join(tempDir, `retenedores_opt_${job.id}.pdf`);

        // 1. Download Carpeta Tributaria
        logger.log(`⏳ Descargando Carpeta Tributaria de Supabase Storage: ${client.carpeta_tributaria_path}...`);
        const { data: tribBlob, error: tribError } = await supabase.storage
          .from('documentos')
          .download(client.carpeta_tributaria_path);

        if (tribError || !tribBlob) {
          throw new Error(`Error al descargar Carpeta Tributaria: ${tribError?.message || 'Blob vacío'}`);
        }
        fs.writeFileSync(tributariaLocalPath, Buffer.from(await tribBlob.arrayBuffer()));
        logger.log('✓ Carpeta Tributaria descargada.');

        // 2. Download Agentes Retenedores
        logger.log(`⏳ Descargando Agentes Retenedores de Supabase Storage: ${client.carpeta_retenedores_path}...`);
        const { data: retBlob, error: retError } = await supabase.storage
          .from('documentos')
          .download(client.carpeta_retenedores_path);

        if (retError || !retBlob) {
          throw new Error(`Error al descargar Agentes Retenedores: ${retError?.message || 'Blob vacío'}`);
        }
        fs.writeFileSync(retenedoresLocalPath, Buffer.from(await retBlob.arrayBuffer()));
        logger.log('✓ Agentes Retenedores descargado.');

        // 3. Size check and conditional compression using Ghostscript
        logger.log('⚖️  Analizando tamaños de archivos y aplicando compresión si superan 10 MB...');
        tributariaOptimizedPath = await getOptimizedPdfPath(tributariaLocalPath, tributariaOptimizedPath, logger);
        retenedoresOptimizedPath = await getOptimizedPdfPath(retenedoresLocalPath, retenedoresOptimizedPath, logger);
      }

      process.env.DRY_RUN = job.dry_run === false ? 'false' : 'true';
      logger.log(`⚙️  Configurando DRY_RUN para esta ejecución: ${process.env.DRY_RUN}`);

      logger.log('🚀 Iniciando navegador Playwright (Headless)...');
      await reportProgress(job.id, 'Abriendo el portal de la Superintendencia…');
      const { browser, page } = await launchBrowser();
      browserInstance = browser;

      logger.log('🔒 Intentando iniciar sesión con ClaveÚnica...');
      await reportProgress(job.id, 'Iniciando sesión con la ClaveÚnica del cliente…');
      await loginAndNavigateToStep1(page, resolvedClaveUnicaRut, resolvedClaveUnicaPassword, logger, {
        region: client.region,
        comuna: client.comuna,
        email: client.email,
        telefono: client.telefono,
      });

      // Clear any prior credential errors upon successful login
      await clearAlert(client.id, CLIENTS_TABLE, logger).catch(() => {});

      // Reporte del Paso 3 (acreedores agregados / saltados). Se captura en los caminos que
      // corren el Paso 3 (step 3 individual y step 0 / all-steps) para luego emitir al panel
      // del dashboard una alerta con los acreedores que NO se pudieron declarar.
      let step3Report: Step3Report | undefined;

      if (job.step === 1) {
        logger.log('📝 Llenando el Paso 1 (Información Personal)...');
        await reportProgress(job.id, 'Completando los datos personales (Paso 1)…');
        
        const clientData: ClientData = {
          nacionalidad: client.nacionalidad,
          fecha_nacimiento: client.fecha_nacimiento || '01/01/1990',
          estado_civil: client.estado_civil,
          regimen_patrimonial: client.regimen_patrimonial,
          profesion_oficio: client.profesion_oficio,
          ocupacion: client.ocupacion,
          direccion: client.direccion,
          region: client.region,
          comuna: client.comuna,
          email: client.email,
          telefono_prefijo: client.telefono_prefijo,
          telefono: client.telefono,
        };

        await fillStep1(page, clientData, logger);
      } else if (job.step === 2) {
        logger.log('📝 Navegando e ingresando información de Paso 2...');
        await reportProgress(job.id, 'Completando las declaraciones (Paso 2)…');

        logger.log('🕵️‍♂️ Agente Tributario — analizando Carpeta Tributaria...');
        await reportProgress(job.id, 'Revisando la situación tributaria del cliente (SII)…');
        const tributariaOutput2 = await runTributarioAgent(supabase, client.id, tributariaLocalPath, logger);
        const categoria = tributariaOutput2.categoria;

        // --- BLOQUEO: Primera categoría con actividad F29 en últimos 24 meses ---
        if (tributariaOutput2.f29_meses_con_actividad.length > 0) {
          const meses = tributariaOutput2.f29_meses_con_actividad.join(', ');
          const alertDesc = `Paso 2 bloqueado: primera categoría con actividad F29 en ${tributariaOutput2.f29_meses_con_actividad.length} mes(es): ${meses}`;
          logger.log(`🚫 ${alertDesc}`);

          try {
            const { error: insertErr } = await supabase.from('automation_alerts').insert({
              job_id: job.id,
              client_id: client.id,
              step: 2,
              alert_type: 'blocked',
              description: alertDesc
            });
            if (insertErr) logger.error('⚠️ No se pudo registrar alerta en automation_alerts:', insertErr.message);
          } catch (alertInsertErr: any) {
            logger.error('⚠️ Excepción al insertar en automation_alerts:', alertInsertErr);
          }

          await supabase
            .from(JOBS_TABLE)
            .update({ status: 'blocked', error_message: alertDesc, updated_at: new Date().toISOString() })
            .eq('id', job.id);

          throw new BlockedError(alertDesc);
        } else {
          logger.log('✅ Sin actividad F29 en los últimos 24 meses. Continuando con Paso 2.');
        }

        const currentUrl = page.url();
        const baseUrl = new URL(currentUrl).origin;
        const step2Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verDeclaraciones`;
        logger.log(`→ Redireccionando a la URL del Paso 2: ${step2Url}`);
        await page.goto(step2Url, { waitUntil: 'domcontentloaded' });

        await fillStep2(page, tributariaOptimizedPath, retenedoresOptimizedPath, categoria, logger);
      } else if (job.step === 3) {
        logger.log('📝 Navegando e ingresando información de Paso 3...');
        await reportProgress(job.id, 'Cargando las deudas y los acreedores en el portal (Paso 3)…');

        const currentUrl = page.url();
        const baseUrl = new URL(currentUrl).origin;
        const step3Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verAcreedores`;
        logger.log(`→ Redireccionando a la URL del Paso 3: ${step3Url}`);
        await page.goto(step3Url, { waitUntil: 'domcontentloaded' });

        step3Report = await fillStep3(page, cmfLocalPath, supabase, logger, undefined, mappedAcreditacionDocs,
          centinelaOutput.reclassifiedCreditors, centinelaOutput.additionalCreditors,
          centinelaOutput.cmfDocumentOverrides, centinelaOutput.identified261Creditors,
          centinelaOutput.deReclassified261Creditors);
      } else if (job.step === 4) {
        logger.log('📝 Navegando e ingresando información de Paso 4...');
        await reportProgress(job.id, 'Completando el apoderado (Paso 4)…');

        const currentUrl = page.url();
        const baseUrl = new URL(currentUrl).origin;
        const step4Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verApoderado`;
        logger.log(`→ Redireccionando a la URL del Paso 4: ${step4Url}`);
        await page.goto(step4Url, { waitUntil: 'domcontentloaded' });

        await fillStep4(page, logger);
      } else if (job.step === 0) {
        logger.log('📝 Llenando Todos los Pasos (Secuencia Completa 1 a 4)...');
        
        logger.log('🕵️‍♂️ Agente Tributario — analizando Carpeta Tributaria...');
        await reportProgress(job.id, 'Revisando la situación tributaria del cliente (SII)…');
        const tributariaOutput0 = await runTributarioAgent(supabase, client.id, tributariaLocalPath, logger);
        const categoria = tributariaOutput0.categoria;

        if (tributariaOutput0.f29_meses_con_actividad.length > 0) {
          const meses = tributariaOutput0.f29_meses_con_actividad.join(', ');
          const alertDesc = `Paso 2 (all-steps) bloqueado: primera categoría con actividad F29 en ${tributariaOutput0.f29_meses_con_actividad.length} mes(es): ${meses}`;
          logger.log(`🚫 ${alertDesc}`);

          try {
            const { error: insertErr } = await supabase.from('automation_alerts').insert({
              job_id: job.id,
              client_id: client.id,
              step: 2,
              alert_type: 'blocked',
              description: alertDesc
            });
            if (insertErr) logger.error('⚠️ No se pudo registrar alerta en automation_alerts:', insertErr.message);
          } catch (alertInsertErr: any) {
            logger.error('⚠️ Excepción al insertar en automation_alerts:', alertInsertErr);
          }

          await supabase
            .from(JOBS_TABLE)
            .update({ status: 'blocked', error_message: alertDesc, updated_at: new Date().toISOString() })
            .eq('id', job.id);

          throw new BlockedError(alertDesc);
        } else {
          logger.log('✅ Sin actividad F29 en los últimos 24 meses. Continuando con all-steps.');
        }
        const clientData: ClientData = {
          nacionalidad: client.nacionalidad,
          fecha_nacimiento: client.fecha_nacimiento || '01/01/1990',
          estado_civil: client.estado_civil,
          regimen_patrimonial: client.regimen_patrimonial,
          profesion_oficio: client.profesion_oficio,
          ocupacion: client.ocupacion,
          direccion: client.direccion,
          region: client.region,
          comuna: client.comuna,
          email: client.email,
          telefono_prefijo: client.telefono_prefijo,
          telefono: client.telefono,
        };

        // Paso 5 (Ingresos): reunir docs de ingreso + correr el agente. Best-effort:
        // si no hay docs de ingreso → null → all_steps omite el Paso 5 (flujo 1→4 igual).
        await reportProgress(job.id, 'Revisando los ingresos del cliente (Paso 5)…');
        const step5Input = await gatherStep5Input(client, path.join(process.cwd(), 'outputs'), logger, job.id);

        step3Report = await fillAllSteps(
          page,
          clientData,
          tributariaOptimizedPath,
          retenedoresOptimizedPath,
          categoria,
          cmfLocalPath,
          supabase,
          mappedAcreditacionDocs,
          logger,
          skipStep3Reason,
          centinelaOutput.reclassifiedCreditors,
          centinelaOutput.additionalCreditors,
          centinelaOutput.cmfDocumentOverrides,
          centinelaOutput.identified261Creditors,
          centinelaOutput.deReclassified261Creditors,
          (msg: string) => reportProgress(job.id, msg),
          step5Input
        );
      } else if (job.step === 5) {
        logger.log('📝 Navegando e ingresando información de Paso 5 (Ingresos)...');
        await reportProgress(job.id, 'Declarando los ingresos del cliente (Paso 5)…');

        const step5Input = await gatherStep5Input(client, path.join(process.cwd(), 'outputs'), logger, job.id);
        if (!step5Input || (step5Input.incomes.length === 0 && !step5Input.cotizacionesPath)) {
          throw new Error('Paso 5: no se encontraron documentos de ingreso para este cliente.');
        }

        const currentUrl = page.url();
        const baseUrl = new URL(currentUrl).origin;
        const step5Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verIngresos`;
        logger.log(`→ Redireccionando a la URL del Paso 5: ${step5Url}`);
        await page.goto(step5Url, { waitUntil: 'domcontentloaded' });

        await fillStep5(page, step5Input, logger);
      }

      // --- Alerta al panel: acreedores que el Paso 3 NO pudo cargar (y requieren acción) ---
      // Solo se alertan los saltos ACCIONABLES (el acreedor quedó sin cargar y el abogado debe
      // intervenir). Los saltos intencionales/informativos (remanente trivial < 1 UF, producto
      // 260 movido a 261 que igual se declara) NO se alertan: serían ruido. El mensaje es en
      // lenguaje claro, con el nombre del banco limpio y la acción concreta. Informativo: NO
      // bloquea ni marca el job como fallido (el borrador igual quedó cargado).
      if (step3Report) {
        const accionables = step3Report.skipped.filter((s) => SKIP_CODES_ACCIONABLES.has(s.code));
        if (accionables.length > 0) {
          const accionPorCodigo: Record<SkipCode, string> = {
            sin_catalogo: 'no está en el catálogo de acreedores del portal y no se pudo identificar por su RUT → agregalo a mano eligiendo la institución',
            catalogo_ambiguo: 'tiene varias instituciones posibles en el catálogo del portal → agregalo a mano eligiendo la correcta',
            comuna_sin_region: 'su comuna no está mapeada a una región → agregalo a mano cargando región y comuna',
            error_portal: 'el portal falló al cargarlo tras varios intentos → reintentá la automatización o cargalo a mano',
            falta_documento: 'falta el documento de acreditación → adjuntalo y cargalo a mano',
            remanente_trivial: '', // no accionable (no se alerta)
            movido_a_261: '',      // no accionable (no se alerta)
          };
          // #6 — para acreedores sin match en el catálogo, ofrecer los candidatos más parecidos
          // (en vez de "no está en el catálogo" a secas) → el abogado elige de una lista corta.
          let catalogForSuggestions: Awaited<ReturnType<typeof fetchAcreedoresCatalog>> = [];
          const needsCandidates = accionables.some((s) => s.code === 'sin_catalogo' || s.code === 'catalogo_ambiguo');
          if (needsCandidates) {
            try {
              catalogForSuggestions = await fetchAcreedoresCatalog(supabase);
            } catch (catErr: any) {
              logger.error('⚠️ No se pudo cargar el catálogo para sugerir candidatos:', catErr?.message || catErr);
            }
          }
          const bullets = accionables
            .map((s) => {
              let suf = '';
              if ((s.code === 'sin_catalogo' || s.code === 'catalogo_ambiguo') && catalogForSuggestions.length > 0) {
                const cands = topNCandidates(s.institucion, catalogForSuggestions, 3).filter((c) => c.score >= 0.15);
                if (cands.length > 0) suf = ` Posibles coincidencias: ${cands.map((c) => prettyInst(c.entry.nombre)).join(', ')}.`;
              }
              return `• ${prettyInst(s.institucion)}${s.monto ? ` (${clp(s.monto)})` : ''}: ${accionPorCodigo[s.code] || s.reason}.${suf}`;
            })
            .join('\n');
          const enc = accionables.length === 1
            ? 'Quedó 1 acreedor sin cargar automáticamente en el Paso 3. Revisalo y cargalo a mano en el portal:'
            : `Quedaron ${accionables.length} acreedores sin cargar automáticamente en el Paso 3. Revisalos y cargalos a mano en el portal:`;
          const desc = `${enc}\n${bullets}`;
          logger.log(`⚠️ ${desc}`);
          try {
            const { error: skErr } = await supabase.from('automation_alerts').insert({
              job_id: job.id, client_id: client.id, step: 3, alert_type: 'needs_review', description: desc,
            });
            if (skErr) logger.error('⚠️ No se pudo registrar la alerta de acreedores no cargados:', skErr.message);
          } catch (skEx: any) {
            logger.error('⚠️ Excepción al registrar la alerta de acreedores no cargados:', skEx);
          }
        }
      }

      // --- Alerta al panel: lecturas de Claude con baja certeza (validación anti-error) ---
      // El Centinela lee los certificados de forma NATIVA (sin OCR); la red anti-error
      // (sentinel.ts) verifica los HECHOS que reportó: que el monto aparezca verbatim en su
      // cita (anti-alucinación), que el RUT del emisor calce con la institución asignada, y
      // que la confianza autodeclarada no sea baja (<0.70, típico en escaneos garbled). Estas
      // señales NO bloquean ni cambian la estructura: el monto se declara igual. Son un aviso
      // para que el abogado revise el monto/identidad de esos acreedores antes de presentar.
      const readIssues = centinelaOutput.claudeReadIssues ?? [];
      const readIssuesDesc = buildReadIssuesAlert(readIssues);
      if (readIssuesDesc) {
        const desc = readIssuesDesc;
        logger.log(`🔎 ${desc}`);
        try {
          const { error: riErr } = await supabase.from('automation_alerts').insert({
            job_id: job.id, client_id: client.id, step: 3, alert_type: 'needs_review', description: desc,
          });
          if (riErr) logger.error('⚠️ No se pudo registrar la alerta de lecturas de baja certeza:', riErr.message);
        } catch (riEx: any) {
          logger.error('⚠️ Excepción al registrar la alerta de lecturas de baja certeza:', riEx);
        }
      }

      logger.log('📸 Guardando captura de éxito...');
      const successDir = path.join(process.cwd(), 'outputs');
      let localSuccessPath = '';

      // Captura job-scoped desde la página activa. Los módulos de paso escriben
      // nombres FIJOS (stepN_success.png) que colisionan entre ejecuciones
      // concurrentes (el upload de un job tomaría el screenshot de otro). Tomar
      // una captura propia con el job.id en el nombre elimina esa carrera. Si
      // falla (página cerrada, etc.), cae al archivo de nombre fijo de abajo.
      try {
        const activePage = browserInstance?.contexts?.()[0]?.pages?.()[0];
        if (activePage) {
          const scopedPath = path.join(successDir, `success_local_${job.id}.png`);
          await activePage.screenshot({ path: scopedPath, fullPage: true });
          if (fs.existsSync(scopedPath)) localSuccessPath = scopedPath;
        }
      } catch {
        /* best-effort: si no se pudo capturar, se usa el fallback por nombre fijo */
      }

      if (localSuccessPath) {
        // ya capturado job-scoped arriba
      } else if (job.step === 1) {
        localSuccessPath = path.join(successDir, 'step1_success.png');
        if (!fs.existsSync(localSuccessPath)) {
          const files = fs.readdirSync(successDir);
          const verifyFiles = files
            .filter(f => f.startsWith('verify_step1_') && f.endsWith('.png'))
            .map(f => ({ name: f, time: fs.statSync(path.join(successDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);
          if (verifyFiles.length > 0) {
            localSuccessPath = path.join(successDir, verifyFiles[0].name);
          }
        }
      } else if (job.step === 2) {
        localSuccessPath = path.join(successDir, 'step2_success.png');
        if (!fs.existsSync(localSuccessPath)) {
          const files = fs.readdirSync(successDir);
          const verifyFiles = files
            .filter(f => f.startsWith('verify_step2_') && f.endsWith('.png'))
            .map(f => ({ name: f, time: fs.statSync(path.join(successDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);
          if (verifyFiles.length > 0) {
            localSuccessPath = path.join(successDir, verifyFiles[0].name);
          }
        }
      } else if (job.step === 3) {
        localSuccessPath = path.join(successDir, 'step3_success.png');
        if (!fs.existsSync(localSuccessPath)) {
          const files = fs.readdirSync(successDir);
          const verifyFiles = files
            .filter(f => f.startsWith('verify_step3_') && f.endsWith('.png'))
            .map(f => ({ name: f, time: fs.statSync(path.join(successDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);
          if (verifyFiles.length > 0) {
            localSuccessPath = path.join(successDir, verifyFiles[0].name);
          }
        }
      } else if (job.step === 4 || job.step === 0) {
        localSuccessPath = path.join(successDir, 'step4_success.png');
        if (!fs.existsSync(localSuccessPath)) {
          const files = fs.readdirSync(successDir);
          const verifyFiles = files
            .filter(f => f.startsWith('verify_step4_') && f.endsWith('.png'))
            .map(f => ({ name: f, time: fs.statSync(path.join(successDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);
          if (verifyFiles.length > 0) {
            localSuccessPath = path.join(successDir, verifyFiles[0].name);
          }
        }
      } else if (job.step === 5) {
        localSuccessPath = path.join(successDir, 'step5_success.png');
        if (!fs.existsSync(localSuccessPath)) {
          const files = fs.readdirSync(successDir);
          const verifyFiles = files
            .filter(f => f.startsWith('verify_step5_') && f.endsWith('.png'))
            .map(f => ({ name: f, time: fs.statSync(path.join(successDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);
          if (verifyFiles.length > 0) {
            localSuccessPath = path.join(successDir, verifyFiles[0].name);
          }
        }
      }

      let publicSuccessUrl: string | null = null;
      if (fs.existsSync(localSuccessPath)) {
        const destName = `success_${job.id}_${Date.now()}.png`;
        logger.log(`→ Subiendo captura de éxito a Supabase Storage...`);
        publicSuccessUrl = await uploadToStorage(localSuccessPath, destName, logger);
      }

      logger.log('✓ Job completado con éxito!');
      await supabase
        .from(JOBS_TABLE)
        .update({
          status: 'success',
          screenshot_url: publicSuccessUrl,
          error_log: logger.getBufferText(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      // Mensaje de progreso final (best-effort, en su propio update para no arriesgar
      // el status='success' si la columna de progreso aún no existe en la DB).
      await reportProgress(job.id, 'Listo: borrador cargado en el portal. Revisar y presentar.');

      success = true;
      break;
    } catch (err: any) {
      lastError = err;
      logger.error(`❌ Fallo en intento ${attempt} de ${maxAttempts}:`, err);

      const isValidationError = err instanceof CredentialError;
      const isBlockedError = err instanceof BlockedError; // BUG-08 FIX

      if (browserInstance) {
        try {
          const pages = await browserInstance.contexts()[0]?.pages();
          const activePage = pages && pages.length > 0 ? pages[pages.length - 1] : null;
          
          if (activePage) {
            logger.log('📸 Tomando captura del fallo...');
            const failurePaths = await screenshotOnFailure(activePage, `step${job.step}_fail_${job.id}_attempt${attempt}`);
            if (failurePaths && failurePaths.screenshotPath) {
              const destName = `failure_${job.id}_attempt${attempt}_${Date.now()}.png`;
              logger.log(`→ Subiendo captura del fallo a Supabase Storage...`);
              publicFailureUrl = await uploadToStorage(failurePaths.screenshotPath, destName, logger);
            }
          }
        } catch (screenshotErr: any) {
          logger.error('No se pudo tomar o subir la captura de error:', screenshotErr);
        }
      }

      fullErrorLog = logger.getBufferText();

      if (isValidationError || isBlockedError) {
        if (isValidationError) logger.error('🛑 Se detectó un error de validación/credenciales de ClaveÚnica. Abortando reintentos.');
        if (isBlockedError) logger.error('🛑 Job bloqueado (BlockedError). El estado \'blocked\' ya fue guardado. Abortando reintentos sin sobreescribir.');
        break;
      }

      if (attempt < maxAttempts) {
        logger.log(`🔄 Esperando 15 segundos antes de reintentar (intento ${attempt + 1})...`);
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    } finally {
      if (browserInstance) {
        logger.log('🔌 Cerrando navegador...');
        await browserInstance.close().catch(() => {});
      }

      logger.log('🧹 Limpiando archivos PDF temporales en disco...');
      try {
        if (fs.existsSync(tributariaLocalPath)) fs.unlinkSync(tributariaLocalPath);
        if (fs.existsSync(retenedoresLocalPath)) fs.unlinkSync(retenedoresLocalPath);
        if (fs.existsSync(tributariaOptimizedPath) && tributariaOptimizedPath !== tributariaLocalPath) {
          fs.unlinkSync(tributariaOptimizedPath);
        }
        if (fs.existsSync(retenedoresOptimizedPath) && retenedoresOptimizedPath !== retenedoresLocalPath) {
          fs.unlinkSync(retenedoresOptimizedPath);
        }
        if (fs.existsSync(cmfLocalPath)) fs.unlinkSync(cmfLocalPath);
        logger.log('✓ Limpieza de PDFs completada.');
      } catch (cleanupErr: any) {
        logger.error(`Error en limpieza de temporales: ${cleanupErr.message || cleanupErr}`);
      }
    }
  }

  if (!success) {
    // BUG-15 FIX: If the error was a BlockedError, the status was already
    // set to 'blocked' inside the step logic. Do NOT overwrite it to 'failed'.
    const isBlockedFinal = lastError instanceof BlockedError;

    if (isBlockedFinal) {
      logger.log('🛑 Job terminó por BlockedError. El estado "blocked" ya fue guardado — no se sobreescribe a "failed".');
    } else {
      logger.error(`❌ Todos los ${maxAttempts} intentos fallaron. Marcando job como fallido.`);

      // Check if it was a validation error (ClaveÚnica or RUT invalid)
      const isValidationError = lastError instanceof CredentialError;
      if (isValidationError) {
        const alertType = lastError.code;
        const alertMessage = lastError.message;

        logger.log(`🚨 Detectado error de credenciales. Actualizando "credential_error" a "${alertType}" para cliente ID: ${client.id}...`);
        try {
          await createAlert(client.id, alertType, alertMessage, CLIENTS_TABLE, logger);
        } catch (alertErr: any) {
          logger.error(`Error al actualizar error de credenciales: ${alertErr.message || alertErr}`);
        }
      }

      await supabase
        .from(JOBS_TABLE)
        .update({
          status: 'failed',
          error_log: fullErrorLog,
          screenshot_url: publicFailureUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }
  }

  // Reset DRY_RUN
  if (originalDryRun !== undefined) {
    process.env.DRY_RUN = originalDryRun;
  } else {
    delete process.env.DRY_RUN;
  }

  logger.log(`🏁 Finalizado procesamiento del Job ${job.id}.\n`);
}

/**
 * Main polling daemon loop.
 */
export async function runDaemon(): Promise<void> {
  console.log('\n======================================================');
  console.log(`🤖 DAEMON WORKER INICIADO`);
  console.log(`📋 Tabla Clientes: ${CLIENTS_TABLE}`);
  console.log(`📋 Tabla Trabajos: ${JOBS_TABLE}`);
  console.log(`📡 Intervalo de sondeo: ${POLL_INTERVAL_MS / 1000}s`);
  console.log('======================================================\n');

  // Handle shutdown signals
  process.on('SIGINT', () => {
    console.log('\n🛑 Deteniendo el daemon de forma ordenada (SIGINT)...');
    keepRunning = false;
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Deteniendo el daemon de forma ordenada (SIGTERM)...');
    keepRunning = false;
  });

  // 1. Cleanup orphan jobs from previous crashes
  await cleanupOrphanJobs();

  // 2. Poll loop — soporta hasta WORKER_CONCURRENCY jobs en paralelo (default 1 →
  // idéntico al comportamiento secuencial previo). El lock atómico
  // (update … where status='pending') garantiza que cada job lo toma una sola
  // iteración; el pool despacha sin bloquear el sondeo. SEGURO en paralelo solo
  // con clientes de ClaveÚnica DISTINTA (solicitudes de portal separadas): los
  // temporales ya están aislados por job.id / client.id. NO usar >1 para el modo
  // comparación (todos comparten la ClaveÚnica de Pato = un solo borrador).
  const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.WORKER_CONCURRENCY || '1', 10) || 1);
  if (MAX_CONCURRENCY > 1) {
    console.log(`⚙️  Concurrencia del worker: hasta ${MAX_CONCURRENCY} jobs en paralelo (WORKER_CONCURRENCY).`);
  }
  const inFlight = new Set<Promise<void>>();

  while (keepRunning) {
    try {
      // Pool lleno → esperar a que se libere un slot antes de sondear.
      if (inFlight.size >= MAX_CONCURRENCY) {
        await Promise.race(inFlight);
        continue;
      }

      // Fetch oldest pending job and update it atomically to 'running'
      const { data: pendingJobs, error: pollError } = await supabase
        .from(JOBS_TABLE)
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (pollError) {
        console.error('❌ Error al sondear la cola:', pollError.message);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      if (pendingJobs && pendingJobs.length > 0) {
        const job = pendingJobs[0];

        // Attempt to lock job
        const { data: lockedJobs, error: lockError } = await supabase
          .from(JOBS_TABLE)
          .update({
            status: 'running',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('status', 'pending') // Concurrency check
          .select();

        if (lockError) {
          console.error(`❌ Error intentando bloquear el job ${job.id}:`, lockError.message);
        } else if (lockedJobs && lockedJobs.length > 0) {
          // Locked successfully! Despachar SIN await — el pool lo trackea. Con
          // MAX_CONCURRENCY=1 la próxima iteración espera en Promise.race (secuencial).
          const run = processJob(job).catch((err) =>
            console.error(`🚨 Excepción no controlada en el job ${job.id}:`, err)
          );
          inFlight.add(run);
          run.finally(() => inFlight.delete(run));
          // Si quedan slots libres y hay más pendientes, seguir despachando ya.
          continue;
        }
      } else if (inFlight.size > 0) {
        // Sin pendientes pero con jobs corriendo: esperar a que termine alguno o
        // al próximo intervalo de sondeo (lo que ocurra primero).
        await Promise.race([
          Promise.race(inFlight),
          new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS)),
        ]);
      } else {
        // Cola vacía y nada en vuelo: esperar el intervalo.
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (loopErr) {
      console.error('🚨 Excepción en el bucle principal:', loopErr);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  // Apagado ordenado: esperar a que terminen los jobs en vuelo.
  if (inFlight.size > 0) {
    console.log(`⏳ Esperando ${inFlight.size} job(s) en vuelo antes de apagar...`);
    await Promise.allSettled(inFlight);
  }

  console.log('👋 Daemon worker apagado.');
}

// Start daemon if run directly
if (require.main === module) {
  runDaemon().catch((err) => {
    console.error('🚨 Fallo crítico en el arranque del daemon worker:', err);
    process.exit(1);
  });
}
