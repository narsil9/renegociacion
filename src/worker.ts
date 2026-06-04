import * as dotenv from 'dotenv';
dotenv.config();

import { launchBrowser, screenshotOnFailure } from './utils/browser';
import { loginAndNavigateToStep1 } from './automation/login';
import { fillStep1, ClientData } from './automation/step1_personal';
import { supabase } from './utils/supabaseWorker';
import { RunnerLogger } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { fillStep2 } from './automation/step2_declaraciones';
import { fillStep3 } from './automation/step3_acreedores';
import { fillStep4 } from './automation/step4_apoderado';
import { getOptimizedPdfPath } from './utils/pdf_optimizer';
import { analyzeTaxCategory } from './utils/pdf_analyzer';
import { analyzeCmfPdf } from './utils/cmf_analyzer';
import { createAlert, clearAlert } from './utils/alerts';

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

  // Support steps 1, 2, 3, and 4
  if (job.step !== 1 && job.step !== 2 && job.step !== 3 && job.step !== 4) {
    const errorMsg = `Paso ${job.step} no está soportado. Actualmente solo se automatizan Pasos 1, 2, 3 y 4.`;
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

    try {
      if (job.step === 3) {
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

        // 2. Analyze CMF PDF
        const cmfResult = await analyzeCmfPdf(cmfLocalPath, logger);

        if (!cmfResult.meets90DaysRequirement || !cmfResult.meetsAmountRequirement) {
          const detail = `El cliente no cumple con los requisitos legales para la renegociación. Atraso 90+ días: ${cmfResult.meets90DaysRequirement ? 'Sí' : 'No'}. Monto 90+ días: $${cmfResult.directOverdue90Days.toLocaleString('es-CL')} (mínimo requerido: $${cmfResult.requiredAmountCLP.toLocaleString('es-CL')} / 80 UF).`;
          logger.error(`❌ Validación fallida: ${detail}`);
          
          // Update job status to failed (no retries)
          await supabase
            .from(JOBS_TABLE)
            .update({
              status: 'failed',
              error_log: logger.getBufferText() + `\n\n❌ ERROR DE VALIDACIÓN: ${detail}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id);
          
          return;
        }

        logger.log('✓ El cliente cumple con los requisitos del Informe CMF (atraso >= 90 días y monto >= 80 UF). Continuando con automatización...');
      }

      if (job.step === 2) {
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
      await clearAlert(client.id, logger).catch(() => {});

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

        await fillStep3(page, cmfLocalPath, logger);
      } else if (job.step === 4) {
        logger.log('📝 Navegando e ingresando información de Paso 4...');
        
        const currentUrl = page.url();
        const baseUrl = new URL(currentUrl).origin;
        const step4Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verApoderado`;
        logger.log(`→ Redireccionando a la URL del Paso 4: ${step4Url}`);
        await page.goto(step4Url, { waitUntil: 'domcontentloaded' });

        await fillStep4(page, logger);
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
      } else if (job.step === 4) {
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

      const isValidationError = err.message?.includes('Alerta:');

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

      if (isValidationError) {
        logger.error('🛑 Se detectó un error de validación/credenciales de ClaveÚnica. Abortando reintentos.');
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
    logger.error(`❌ Todos los ${maxAttempts} intentos fallaron. Marcando job como fallido.`);

    // Check if it was a validation error (ClaveÚnica or RUT invalid)
    const isValidationError = lastError?.message?.includes('Alerta:');
    if (isValidationError) {
      let alertType = 'clave_unica_incorrecta';
      let alertMessage = 'La ClaveÚnica o contraseña ingresada es incorrecta (Datos de acceso no válidos).';

      if (lastError.message.includes('RUN (RUT) ingresado es incorrecto') || lastError.message.includes('RUN de 7 u 8 números')) {
        alertType = 'rut_incorrecto';
        alertMessage = 'El RUT (RUN) ingresado es incorrecto. Ingrese correctamente su RUN de 7 u 8 números más dígito verificador.';
      }

      logger.log(`🚨 Detectado error de credenciales. Actualizando "credential_error" a "${alertType}" para cliente ID: ${client.id}...`);
      try {
        await createAlert(client.id, alertType, alertMessage, logger);
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
