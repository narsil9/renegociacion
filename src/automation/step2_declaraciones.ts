import { Page } from 'playwright';
import { screenshotOnFailure } from '../utils/browser';
import * as fs from 'fs';
import * as path from 'path';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

export async function fillStep2(
  page: Page,
  tributariaLocalPath: string,
  retenedoresLocalPath: string,
  categoria: 'primera' | 'segunda',
  logger?: SimpleLogger
): Promise<void> {
  const log = (msg: string) => {
    if (logger) {
      logger.log(msg);
    } else {
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
      console.log(`[${ts}] ${msg}`);
    }
  };

  // Validate that files exist locally before trying to upload
  if (!fs.existsSync(tributariaLocalPath)) {
    throw new Error(`Carpeta tributaria local no encontrada: ${tributariaLocalPath}`);
  }
  if (!fs.existsSync(retenedoresLocalPath)) {
    throw new Error(`Archivo de agentes retenedores local no encontrado: ${retenedoresLocalPath}`);
  }

  try {
    log('⏳ Esperando formulario de Paso 2 (Declaraciones)...');
    await page.waitForSelector('#declaracionRenegociacionForm', { timeout: 30000 });
    
    if (!page.url().includes('renegociacion')) {
      throw new Error(`URL inesperada para Paso 2: ${page.url()}`);
    }

    log('→ Esperando estabilización de scripts en la página...');
    await page.waitForTimeout(3000);

    // 1. Check radio according to category
    if (categoria === 'primera') {
      log('→ Seleccionando calidad de persona deudora (CON actividades 1ra categoría)...');
      await page.locator('#calidadPersonaDeudora2').check({ force: true });
      
      log('→ Seleccionando no emisión de documentos tributarios en los últimos 24 meses...');
      await page.locator('#inicioActividades1').check({ force: true });
    } else {
      log('→ Seleccionando calidad de persona deudora (SIN actividades 1ra categoría)...');
      await page.locator('#calidadPersonaDeudora1').check({ force: true });
    }

    // 2. Upload Carpeta Tributaria
    log('→ Seleccionando archivo de Carpeta Tributaria...');
    await page.locator('#carpetaTributariaSolicitudCreditos').setInputFiles(tributariaLocalPath);
    
    log('→ Presionando botón Subir Carpeta Tributaria...');
    await page.locator('#btnSubirCarpetaTributaria').click();
    
    log('→ Esperando confirmación de subida de Carpeta Tributaria...');
    await page.locator('#descargaCarpetaTributaria:not(.hidden)').waitFor({ state: 'attached', timeout: 45000 });
    log('✓ Carpeta Tributaria subida correctamente.');

    // 3. Upload Agentes Retenedores
    log('→ Seleccionando archivo de Agentes Retenedores...');
    await page.locator('#informacionIngresosRetenedoresOtros').setInputFiles(retenedoresLocalPath);
    
    log('→ Presionando botón Subir Agentes Retenedores...');
    await page.locator('#btnSubirInfoAgentesRetenedores').click();
    
    log('→ Esperando confirmación de subida de Agentes Retenedores...');
    await page.locator('#descargaInformacionIngresos:not(.hidden)').waitFor({ state: 'attached', timeout: 45000 });
    log('✓ Agentes Retenedores subido correctamente.');

    // 4. Check radio: No ha sido notificado de demandas / juicios ejecutivos
    log('→ Declarando no notificación de demandas ejecutivas...');
    await page.locator('#tipoDeclaracionNotificacionNo').check({ force: true });

    log('✓ Todos los campos del Paso 2 completados.');

    const dryRun = process.env.DRY_RUN !== 'false';
    if (dryRun) {
      const screenshotPath = `outputs/verify_step2_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`📸 Screenshot de verificación Paso 2: ${screenshotPath}`);
      
      log('🧹 DRY_RUN=true: Iniciando limpieza de los archivos subidos para mantener el borrador vacío...');
      
      // Helper function to re-check the correct radios based on category after page reloads
      const recheckRequiredFields = async () => {
        log('→ Re-seleccionando campos obligatorios tras recarga...');
        if (categoria === 'primera') {
          await page.locator('#calidadPersonaDeudora2').check({ force: true });
          await page.locator('#inicioActividades1').check({ force: true });
        } else {
          await page.locator('#calidadPersonaDeudora1').check({ force: true });
        }
        await page.locator('#tipoDeclaracionNotificacionNo').check({ force: true });
        await page.waitForTimeout(1000);
      };

      // 1. Eliminar Carpeta Tributaria
      const isTributariaUploaded = await page.evaluate(() => {
        const el = document.getElementById('descargaCarpetaTributaria');
        return el ? !el.classList.contains('hidden') : false;
      });

      if (isTributariaUploaded) {
        log('🗑️  Eliminando Carpeta Tributaria...');
        const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        await page.locator('button[data-documento="carpetaTributaria"]').click();
        await navigationPromise;
        log('✓ Página recargada tras eliminar Carpeta Tributaria.');
        
        await page.waitForSelector('#declaracionRenegociacionForm', { timeout: 30000 });
        await recheckRequiredFields();
      }

      // 2. Eliminar Agentes Retenedores
      const isRetenedoresUploaded = await page.evaluate(() => {
        const el = document.getElementById('descargaInformacionIngresos');
        return el ? !el.classList.contains('hidden') : false;
      });

      if (isRetenedoresUploaded) {
        log('🗑️  Eliminando Agentes Retenedores...');
        const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        await page.locator('button[data-documento="informacionIngresos"]').click();
        await navigationPromise;
        log('✓ Página recargada tras eliminar Agentes Retenedores.');
      }
      
      const cleanScreenshotPath = `outputs/verify_step2_clean_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      await page.screenshot({ path: cleanScreenshotPath, fullPage: true });
      log(`📸 Captura de borrador limpio: ${cleanScreenshotPath}`);
      
      log('⚠️  DRY_RUN=true: formulario NO guardado permanentemente y archivos limpiados.');
      return;
    }

    // --- PRODUCCIÓN: guardar y continuar al Paso 3 ---
    log('→ Guardando y continuando al Paso 3...');
    const urlAntes = page.url();
    await page.locator('#btnContinuar').click();

    log('→ Esperando redirección al Paso 3...');
    await page.waitForFunction(
      (before: string) => window.location.href !== before,
      urlAntes,
      { timeout: 60000 }
    );

    // Guardar screenshot de éxito del Paso 3 cargado
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const successPath = path.join(outputDir, 'step2_success.png');
    await page.screenshot({ path: successPath, fullPage: true });
    log(`✓ Paso 2 completado. Captura de éxito guardada en: ${successPath}`);
    log(`→ Nueva URL: ${page.url()}`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ✗ Error en Paso 2.`);
    await screenshotOnFailure(page, 'step2');
    throw error;
  }
}
