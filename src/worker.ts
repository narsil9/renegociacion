import * as dotenv from 'dotenv';
dotenv.config();

import { launchBrowser, screenshotOnFailure } from './utils/browser';
import { loginAndNavigateToStep1 } from './automation/login';
import { fillStep1, ClientData } from './automation/step1_personal';
import { supabase } from './utils/supabaseWorker';
import { RunnerLogger } from './utils/logger';
import { getProdReadOnlyClient } from './utils/prodReadOnly';
import * as fs from 'fs';
import * as path from 'path';

const POLL_INTERVAL_MS = 5000;
let keepRunning = true;

// Determine queue mode and corresponding tables
const queueMode = process.env.QUEUE_MODE || 'production';
const CLIENTS_TABLE = queueMode === 'production' ? 'pato_prueba_clients' : 'clients';
const JOBS_TABLE = queueMode === 'production' ? 'pato_prueba_automation_jobs' : 'automation_jobs';

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

  // Only support step 1 for now
  if (job.step !== 1) {
    const errorMsg = `Paso ${job.step} no está soportado. Actualmente solo se automatiza Paso 1.`;
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
  process.env.DRY_RUN = job.dry_run ? 'true' : 'false';
  logger.log(`⚙️  Configurando DRY_RUN para esta ejecución: ${process.env.DRY_RUN}`);

  // Fetch ClaveÚnica password JIT from production if in production queue mode
  let claveUnicaPassword = '';
  if (queueMode === 'production') {
    logger.log(`🔒 [JIT] Buscando credencial ClaveÚnica en producción para airtable_id: ${client.airtable_id}...`);
    try {
      const prodClient = getProdReadOnlyClient();
      
      // Try overrides first
      const { data: overrides, error: overridesError } = await prodClient
        .from('renegociacion_overrides')
        .select('clave_cu_override, airtable_clave_unica')
        .eq('airtable_id', client.airtable_id)
        .limit(1);
        
      if (overridesError) {
        logger.error(`Error obteniendo overrides en producción: ${overridesError.message}`);
      } else if (overrides && overrides.length > 0) {
        claveUnicaPassword = overrides[0].clave_cu_override || overrides[0].airtable_clave_unica || '';
      }
      
      // Fallback to customer master profile
      if (!claveUnicaPassword) {
        logger.log(`⚠️ No se encontró override. Buscando en bronze_customers_main...`);
        const normRut = client.rut.toLowerCase().replace(/[^0-9k]/g, '');
        
        const { data: customers, error: customerError } = await prodClient
          .from('bronze_customers_main')
          .select('data');
          
        if (customerError) {
          logger.error(`Error al buscar en bronze_customers_main: ${customerError.message}`);
        } else {
          const match = customers?.find(cust => {
            const r = cust.data?.['RUT (individual)'];
            return r && r.toLowerCase().replace(/[^0-9k]/g, '') === normRut;
          });
          claveUnicaPassword = match?.data?.['Clave Unica'] || '';
        }
      }
    } catch (err: any) {
      logger.error(`Excepción obteniendo contraseña JIT de producción: ${err.message || err}`);
    }
    
    if (!claveUnicaPassword) {
      const errMsg = 'No se encontró contraseña ClaveÚnica para este cliente en el sistema de producción.';
      logger.error(errMsg);
      await supabase
        .from(JOBS_TABLE)
        .update({
          status: 'failed',
          error_log: logger.getBufferText() || errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      
      // Reset DRY_RUN
      if (originalDryRun !== undefined) {
        process.env.DRY_RUN = originalDryRun;
      } else {
        delete process.env.DRY_RUN;
      }
      return;
    }
    logger.log('✓ Contraseña ClaveÚnica recuperada en memoria de forma segura (sin guardarse en DB).');
  } else {
    claveUnicaPassword = client.clave_unica_password;
    if (!claveUnicaPassword) {
      const errMsg = 'Falta clave_unica_password en la tabla clients del Sandbox.';
      logger.error(errMsg);
      await supabase
        .from(JOBS_TABLE)
        .update({
          status: 'failed',
          error_log: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      
      // Reset DRY_RUN
      if (originalDryRun !== undefined) {
        process.env.DRY_RUN = originalDryRun;
      } else {
        delete process.env.DRY_RUN;
      }
      return;
    }
  }

  // Launch browser inside process
  let browserInstance: any = null;
  
  try {
    logger.log('🚀 Iniciando navegador Playwright (Headless)...');
    const { browser, page } = await launchBrowser();
    browserInstance = browser;

    logger.log('🔒 Intentando iniciar sesión con ClaveÚnica...');
    await loginAndNavigateToStep1(page, client.clave_unica_rut, claveUnicaPassword, logger);

    logger.log('📝 Llenando el Paso 1 (Información Personal)...');
    
    const clientData: ClientData = {
      nacionalidad: client.nacionalidad,
      fecha_nacimiento: client.fecha_nacimiento || '01/01/1990', // fallback or placeholder if missing
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

    logger.log('📸 Guardando captura de éxito...');
    // Locate the generated file (it may have a timestamp)
    const successDir = path.join(process.cwd(), 'outputs');
    let localSuccessPath = path.join(successDir, 'step1_success.png');
    
    // Find the latest generated verify_step1_*.png or success screenshot
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

  } catch (err: any) {
    logger.error(`Error durante la ejecución del job:`, err);

    let publicFailureUrl: string | null = null;
    
    if (browserInstance) {
      try {
        const pages = await browserInstance.contexts()[0]?.pages();
        const activePage = pages && pages.length > 0 ? pages[pages.length - 1] : null;
        
        if (activePage) {
          logger.log('📸 Tomando captura del fallo...');
          const failurePaths = await screenshotOnFailure(activePage, `step1_fail_${job.id}`);
          if (failurePaths && failurePaths.screenshotPath) {
            const destName = `failure_${job.id}_${Date.now()}.png`;
            logger.log(`→ Subiendo captura del fallo a Supabase Storage...`);
            publicFailureUrl = await uploadToStorage(failurePaths.screenshotPath, destName, logger);
          }
        }
      } catch (screenshotErr: any) {
        logger.error('No se pudo tomar o subir la captura de error:', screenshotErr);
      }
    }

    const fullErrorLog = logger.getBufferText();
    
    await supabase
      .from(JOBS_TABLE)
      .update({
        status: 'failed',
        error_log: fullErrorLog,
        screenshot_url: publicFailureUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

  } finally {
    if (browserInstance) {
      logger.log('🔌 Cerrando navegador...');
      await browserInstance.close().catch(() => {});
    }
    
    // Reset DRY_RUN
    if (originalDryRun !== undefined) {
      process.env.DRY_RUN = originalDryRun;
    } else {
      delete process.env.DRY_RUN;
    }
    
    logger.log(`🏁 Finalizado procesamiento del Job ${job.id}.\n`);
  }
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
