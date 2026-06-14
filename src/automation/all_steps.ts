import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';
import { fillStep1, ClientData } from './step1_personal';
import { fillStep2 } from './step2_declaraciones';
import { fillStep3, AcreditacionDoc } from './step3_acreedores';
import { fillStep4 } from './step4_apoderado';
import { ReclassifiedCreditor, AdditionalCreditor } from '../utils/sentinel';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

/**
 * Executes all automation steps sequentially (Step 1 -> Step 2 -> Step 3 -> Step 4)
 * within a single browser session.
 */
export async function fillAllSteps(
  page: Page,
  clientData: ClientData,
  tributariaOptimizedPath: string,
  retenedoresOptimizedPath: string,
  categoria: 'primera' | 'segunda' | 'ninguna',
  cmfLocalPath: string,
  supabase: SupabaseClient,
  acreditacionDocs: AcreditacionDoc[],
  logger?: SimpleLogger,
  // Si viene con motivo, se OMITE el Paso 3 (acreedores) pero se completan 1, 2 y 4.
  // Se usa cuando el cliente SÍ califica pero los documentos de acreditación no cumplen
  // los requisitos: se guarda lo correcto y no se guarda el Paso 3.
  skipStep3Reason: string | null = null,
  reclassifiedCreditors?: ReclassifiedCreditor[],
  additionalCreditors?: AdditionalCreditor[],
): Promise<void> {
  const log = (msg: string) => {
    if (logger) {
      logger.log(msg);
    } else {
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
      console.log(`[${ts}] ${msg}`);
    }
  };

  log('🚀 Iniciando flujo secuencial de todos los pasos (Pasos 1 al 4)...');

  // --- PASO 1 ---
  log('\n📝 === INICIANDO PASO 1 (Información Personal) ===');
  await fillStep1(page, clientData, logger);
  log('✓ Paso 1 completado.');

  // Get base URL from current page URL
  const currentUrl = page.url();
  const baseUrl = new URL(currentUrl).origin;

  // --- PASO 2 ---
  log('\n📝 === INICIANDO PASO 2 (Declaraciones y PDFs) ===');
  const step2Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verDeclaraciones`;
  if (!page.url().includes('verDeclaraciones')) {
    log(`→ Navegando a Paso 2: ${step2Url}`);
    await page.goto(step2Url, { waitUntil: 'domcontentloaded' });
  } else {
    log('→ Ya redirigido a la página de Paso 2.');
  }
  await fillStep2(page, tributariaOptimizedPath, retenedoresOptimizedPath, categoria, logger);
  log('✓ Paso 2 completado.');

  // --- PASO 3 ---
  if (skipStep3Reason) {
    log('\n⏭️  === PASO 3 OMITIDO (Acreedores) ===');
    log(`   Motivo: ${skipStep3Reason}`);
    log('   El cliente califica, pero los documentos de acreditación no cumplen los requisitos.');
    log('   Se guardan los Pasos 1, 2 y 4; el Paso 3 queda sin completar para revisión/corrección.');
  } else {
    log('\n📝 === INICIANDO PASO 3 (Acreedores) ===');
    const step3Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verAcreedores`;
    if (!page.url().includes('verAcreedores')) {
      log(`→ Navegando a Paso 3: ${step3Url}`);
      await page.goto(step3Url, { waitUntil: 'domcontentloaded' });
    } else {
      log('→ Ya redirigido a la página de Paso 3.');
    }
    await fillStep3(page, cmfLocalPath, supabase, logger, undefined, acreditacionDocs, reclassifiedCreditors, additionalCreditors);
    log('✓ Paso 3 completado.');
  }

  // --- PASO 4 ---
  log('\n📝 === INICIANDO PASO 4 (Apoderado) ===');
  const step4Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verApoderado`;
  if (!page.url().includes('verApoderado')) {
    log(`→ Navegando a Paso 4: ${step4Url}`);
    await page.goto(step4Url, { waitUntil: 'domcontentloaded' });
  } else {
    log('→ Ya redirigido a la página de Paso 4.');
  }
  await fillStep4(page, logger);
  log('✓ Paso 4 completado.');

  log('\n🎉 Flujo de todos los pasos completado con éxito.');
}
