import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import { launchBrowser, screenshotOnFailure } from './utils/browser';
import { loginAndNavigateToStep1, CredentialError } from './automation/login';
import { fillStep1, ClientData } from './automation/step1_personal';
import { supabase } from './utils/supabaseWorker';
import { RunnerLogger } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { fillStep2 } from './automation/step2_declaraciones';
import { fillStep3, AcreditacionDoc } from './automation/step3_acreedores';
import { fillStep4 } from './automation/step4_apoderado';
import { fillAllSteps } from './automation/all_steps';
import { getOptimizedPdfPath } from './utils/pdf_optimizer';
import { analyzeTaxCategory, detectF29ActivityLast24Months } from './utils/pdf_analyzer';
import { analyzeCmfPdf } from './utils/cmf_analyzer';
import { createAlert, clearAlert } from './utils/alerts';
import { cleanupDraft } from './automation/cleanup';
import { runCognitiveOrchestrator } from './utils/cognitive_orchestrator';

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

// Determine queue mode and corresponding tables
const queueMode = process.env.QUEUE_MODE || 'production';
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
    const { data, error } = await supabase.storage
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
    // Si queda con motivo: el cliente califica pero los documentos del Paso 3 no
    // cumplen → en el flujo completo (step:0) se omite SOLO el Paso 3 y se guardan 1, 2 y 4.
    let skipStep3Reason: string | null = null;

    // Limpieza best-effort del borrador del portal (login + cleanupDraft). Se usa
    // cuando el caso es inválido de raíz (no califica) o cuando el Paso 3 individual falla.
    const cleanupPortalDraftBestEffort = async () => {
      try {
        logger.log('⏳ Iniciando navegador y sesión para limpiar el borrador en el portal...');
        const clave = (client.rut === '21917363-6' || client.airtable_id === 'recPatoPrueba')
          ? (process.env.CLAVE_UNICA_PASSWORD || '')
          : client.clave_unica_password;
        if (clave) {
          const { browser, page } = await launchBrowser();
          browserInstance = browser;
          await loginAndNavigateToStep1(page, client.clave_unica_rut, clave, logger, {
            region: client.region, comuna: client.comuna, email: client.email, telefono: client.telefono,
          });
          await cleanupDraft(page, logger);
        } else {
          logger.log('⚠️ No se encontró ClaveÚnica en el perfil del cliente, omitiendo la limpieza automática.');
        }
      } catch (cleanupErr: any) {
        logger.error(`⚠️ No se pudo realizar la autolimpieza en el portal: ${cleanupErr.message || cleanupErr}`);
      }
    };

    try {
      if (job.step === 3 || job.step === 0) {
        logger.log('⏳ Iniciando validación legal de Informe de Deudas CMF para el Paso 3...');
        if (!client.informe_cmf_path) {
          throw new Error('Error: No se encontró la ruta del informe CMF en el perfil del cliente para el Paso 3.');
        }

        const tempDir = path.join(process.cwd(), 'outputs');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
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

        // 2. Analyze CMF PDF (result also passed into cognitive orchestrator to avoid double-parse)
        const cmfResult = await analyzeCmfPdf(cmfLocalPath, logger);

        // 3. Run AI Cognitive Orchestrator ("Mente Pensante")
        logger.log('🧠 Ejecutando orquestador cognitivo de IA (Claude Sonnet 4.5) para auditar documentos y fechas...');
        const orchResult = await runCognitiveOrchestrator(client, cmfLocalPath, supabase, logger);

        if (orchResult.status === 'success' && orchResult.mappedDocs) {
          mappedAcreditacionDocs = orchResult.mappedDocs;
        }

        // --- Decisión de validación ---
        // (A) ELEGIBILIDAD de fondo (atraso 90+ días y monto >= 80 UF): si NO califica,
        //     el caso es inválido de raíz → se BLOQUEA TODO (no se guarda ningún paso).
        const noCalifica = !cmfResult.meets90DaysRequirement || !cmfResult.meetsAmountRequirement;
        if (noCalifica) {
          const detalle = `El cliente no cumple con los requisitos legales para la renegociación. Atraso 90+ días: ${cmfResult.meets90DaysRequirement ? 'Sí' : 'No'}. Monto 90+ días: $${(cmfResult.overdue90DaysTotal || 0).toLocaleString('es-CL')} (mínimo requerido: $${cmfResult.requiredAmountCLP.toLocaleString('es-CL')} / 80 UF).`;
          logger.error(`❌ No califica para renegociación: ${detalle}`);
          await cleanupPortalDraftBestEffort();
          await supabase
            .from(JOBS_TABLE)
            .update({
              status: 'failed',
              error_log: logger.getBufferText() + `\n\n❌ ERROR DE VALIDACIÓN (no califica): ${detalle}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id);
          return;
        }

        // (B) El cliente SÍ califica, pero los DOCUMENTOS del Paso 3 no pasan la auditoría
        //     (vencidos / incompletos / RUT). En el flujo completo (step:0) se OMITE solo el
        //     Paso 3 y se guardan 1, 2 y 4. En un job de Paso 3 individual, el job falla.
        if (orchResult.status === 'error') {
          const motivo = orchResult.reason || 'Los documentos de acreditación del Paso 3 no cumplen los requisitos.';
          if (job.step === 0) {
            skipStep3Reason = motivo;
            logger.log(`⏭️  Paso 3 será OMITIDO (se guardarán Pasos 1, 2 y 4): ${motivo}`);
            try {
              const { error: insertErr } = await supabase.from('automation_alerts').insert({
                job_id: job.id,
                client_id: String(client.id),
                step: 3,
                alert_type: 'blocked',
                description: `Paso 3 omitido (documentos no cumplen requisitos): ${motivo}`,
              });
              if (insertErr) logger.error('⚠️ No se pudo registrar alerta de Paso 3 omitido:', insertErr.message);
            } catch (alertErr: any) {
              logger.error('⚠️ Excepción al registrar alerta de Paso 3 omitido:', alertErr?.message || alertErr);
            }
          } else {
            logger.error(`❌ Documentos del Paso 3 inválidos: ${motivo}`);
            await cleanupPortalDraftBestEffort();
            await supabase
              .from(JOBS_TABLE)
              .update({
                status: 'failed',
                error_log: logger.getBufferText() + `\n\n❌ ERROR DE VALIDACIÓN (documentos Paso 3): ${motivo}`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id);
            return;
          }
        } else {
          logger.log('✓ El cliente cumple los requisitos y los documentos del Paso 3 son válidos. Continuando con automatización...');
        }
      }

      if (job.step === 2 || job.step === 0) {
        logger.log('⏳ Iniciando preparación de PDFs para el Paso 2...');
        if (!client.carpeta_tributaria_path || !client.carpeta_retenedores_path) {
          throw new Error('Error: Falta registrar la ruta de Carpeta Tributaria o de Agentes Retenedores en la tabla clients.');
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

      // Retrieve ClaveÚnica password from local Sandbox clients table or env fallback
      let claveUnicaPassword = '';
      if (client.rut === '21917363-6' || client.airtable_id === 'recPatoPrueba') {
        claveUnicaPassword = process.env.CLAVE_UNICA_PASSWORD || '';
        if (!claveUnicaPassword) {
          throw new Error('Error: Falta la variable de entorno CLAVE_UNICA_PASSWORD en el archivo .env para el cliente de prueba.');
        }
      } else {
        claveUnicaPassword = client.clave_unica_password;
        if (!claveUnicaPassword) {
          throw new Error('Falta clave_unica_password en la tabla clients del Sandbox.');
        }
      }

      logger.log('🚀 Iniciando navegador Playwright (Headless)...');
      const { browser, page } = await launchBrowser();
      browserInstance = browser;

      logger.log('🔒 Intentando iniciar sesión con ClaveÚnica...');
      await loginAndNavigateToStep1(page, client.clave_unica_rut, claveUnicaPassword, logger, {
        region: client.region,
        comuna: client.comuna,
        email: client.email,
        telefono: client.telefono,
      });

      // Clear any prior credential errors upon successful login
      await clearAlert(client.id, CLIENTS_TABLE, logger).catch(() => {});

      if (job.step === 1) {
        logger.log('📝 Llenando el Paso 1 (Información Personal)...');
        
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
        
        logger.log('🕵️‍♂️ Analizando la Carpeta Tributaria para determinar la categoría tributaria...');
        const categoria = await analyzeTaxCategory(tributariaLocalPath, logger);

        // --- BLOQUEO: Primera categoría con actividad F29 en últimos 24 meses ---
        if (categoria === 'primera') {
          logger.log('🔍 Contribuyente de Primera Categoría — verificando actividad F29 en los últimos 24 meses...');
          const f29Result = await detectF29ActivityLast24Months(tributariaLocalPath, logger);

          if (f29Result.hasActivityLast24Months) {
            const alertDesc = `Paso 2 bloqueado: ${f29Result.summary}`;
            logger.log(`🚫 ${alertDesc}`);

            // BUG-10 FIX: wrap insert in try/catch so a schema error doesn't
            // replace the block message with a cryptic Supabase error.
            try {
              const { error: insertErr } = await supabase.from('automation_alerts').insert({
                job_id: job.id,
                client_id: String(client.id),
                step: 2,
                alert_type: 'blocked',
                description: alertDesc
              });
              if (insertErr) logger.error('⚠️ No se pudo registrar alerta en automation_alerts:', insertErr.message);
            } catch (alertInsertErr: any) {
              logger.error('⚠️ Excepción al insertar en automation_alerts:', alertInsertErr);
            }

            // Marcar el job como bloqueado
            await supabase
              .from(JOBS_TABLE)
              .update({ status: 'blocked', error_message: alertDesc, updated_at: new Date().toISOString() })
              .eq('id', job.id);

            // BUG-08 FIX: throw BlockedError instead of generic Error so the
            // retry loop breaks immediately and doesn't overwrite status to 'failed'.
            throw new BlockedError(alertDesc);
          } else {
            logger.log('✅ Sin actividad F29 en los últimos 24 meses. Continuando con Paso 2.');
          }
        }

        const currentUrl = page.url();
        const baseUrl = new URL(currentUrl).origin;
        const step2Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verDeclaraciones`;
        logger.log(`→ Redireccionando a la URL del Paso 2: ${step2Url}`);
        await page.goto(step2Url, { waitUntil: 'domcontentloaded' });

        await fillStep2(page, tributariaOptimizedPath, retenedoresOptimizedPath, categoria, logger);
      } else if (job.step === 3) {
        logger.log('📝 Navegando e ingresando información de Paso 3...');
        
        const currentUrl = page.url();
        const baseUrl = new URL(currentUrl).origin;
        const step3Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verAcreedores`;
        logger.log(`→ Redireccionando a la URL del Paso 3: ${step3Url}`);
        await page.goto(step3Url, { waitUntil: 'domcontentloaded' });

        await fillStep3(page, cmfLocalPath, supabase, logger, undefined, mappedAcreditacionDocs);
      } else if (job.step === 4) {
        logger.log('📝 Navegando e ingresando información de Paso 4...');
        
        const currentUrl = page.url();
        const baseUrl = new URL(currentUrl).origin;
        const step4Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verApoderado`;
        logger.log(`→ Redireccionando a la URL del Paso 4: ${step4Url}`);
        await page.goto(step4Url, { waitUntil: 'domcontentloaded' });

        await fillStep4(page, logger);
      } else if (job.step === 0) {
        logger.log('📝 Llenando Todos los Pasos (Secuencia Completa 1 a 4)...');
        
        logger.log('🕵️‍♂️ Analizando la Carpeta Tributaria para determinar la categoría tributaria...');
        const categoria = await analyzeTaxCategory(tributariaLocalPath, logger);
        
        // BUG-14 / BUG-23 FIX: Run the same F29 check that step===2 does.
        // Previously, step===0 computed `categoria` but never ran detectF29ActivityLast24Months.
        if (categoria === 'primera') {
          logger.log('🔍 [step=0] Contribuyente de Primera Categoría — verificando actividad F29 en los últimos 24 meses...');
          const f29Result = await detectF29ActivityLast24Months(tributariaLocalPath, logger);

          if (f29Result.hasActivityLast24Months) {
            const alertDesc = `Paso 2 (all-steps) bloqueado: ${f29Result.summary}`;
            logger.log(`🚫 ${alertDesc}`);

            try {
              const { error: insertErr } = await supabase.from('automation_alerts').insert({
                job_id: job.id,
                client_id: String(client.id),
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

        await fillAllSteps(
          page,
          clientData,
          tributariaOptimizedPath,
          retenedoresOptimizedPath,
          categoria,
          cmfLocalPath,
          supabase,
          mappedAcreditacionDocs,
          logger,
          skipStep3Reason
        );
      }

      logger.log('📸 Guardando captura de éxito...');
      const successDir = path.join(process.cwd(), 'outputs');
      let localSuccessPath = '';
      
      if (job.step === 1) {
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
  console.log(`🤖 DAEMON WORKER INICIADO (Modo: ${queueMode.toUpperCase()})`);
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

  // 2. Poll loop
  while (keepRunning) {
    try {
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
          // Locked successfully! Execute the job
          await processJob(job);
        }
      } else {
        // Queue is empty, wait
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (loopErr) {
      console.error('🚨 Excepción en el bucle principal:', loopErr);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
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
