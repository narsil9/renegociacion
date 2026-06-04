import { Page } from 'playwright';
import { screenshotOnFailure } from '../utils/browser';
import * as fs from 'fs';
import * as path from 'path';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

export async function fillStep3(
  page: Page,
  cmfLocalPath: string,
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

  // Validate that the CMF file exists locally before trying to upload
  if (!fs.existsSync(cmfLocalPath)) {
    throw new Error(`Informe CMF local no encontrado: ${cmfLocalPath}`);
  }

  try {
    log('⏳ Esperando formulario de Paso 3 (Acreedores)...');
    await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 30000 });

    if (!page.url().includes('renegociacion')) {
      throw new Error(`URL inesperada para Paso 3: ${page.url()}`);
    }

    log('→ Esperando estabilización de scripts en la página...');
    await page.waitForTimeout(3000);

    // Upload Informe CMF
    log('→ Seleccionando archivo de Informe CMF...');
    await page.locator('#informeCMF').setInputFiles(cmfLocalPath);

    log('→ Presionando botón Subir Informe CMF...');
    await page.locator('#btnSubirInformeCMF').click();

    log('→ Esperando confirmación de subida de Informe CMF...');
    const uploadIndicators = '#btnEliminarCMF, #btnVerCMF';

    await page.locator(uploadIndicators).first().waitFor({ state: 'attached', timeout: 45000 });
    log('✓ Informe CMF subido correctamente.');

    log('✓ Todos los campos requeridos del Paso 3 completados.');

    const dryRun = process.env.DRY_RUN !== 'false';
    if (dryRun) {
      const outputDir = path.join(process.cwd(), 'outputs');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const screenshotPath = path.join(outputDir, `verify_step3_${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`📸 Screenshot de verificación Paso 3: ${screenshotPath}`);

      log('🧹 DRY_RUN=true: Iniciando limpieza de los archivos subidos para mantener el borrador vacío...');

      const deleteSelector = '#btnEliminarCMF';
      const isCMFUploaded = await page.evaluate((sel) => {
        return !!document.querySelector(sel);
      }, deleteSelector);

      if (isCMFUploaded) {
        log('🗑️  Eliminando Informe CMF...');
        await page.locator(deleteSelector).click();

        log('→ Esperando modal de confirmación de eliminación...');
        await page.waitForSelector('#btnConfirmarModal', { state: 'visible', timeout: 5000 });
        await page.locator('#btnConfirmarModal').click();

        // Wait for page reloads / hide animations to complete
        await page.locator(deleteSelector).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
        log('✓ Estado limpio tras eliminar Informe CMF.');
      }

      const cleanScreenshotPath = path.join(outputDir, `verify_step3_clean_${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await page.screenshot({ path: cleanScreenshotPath, fullPage: true });
      log(`📸 Captura de borrador limpio: ${cleanScreenshotPath}`);

      log('⚠️  DRY_RUN=true: formulario NO guardado permanentemente y archivos de borrador limpiados.');
      return;
    }

    // --- PRODUCCIÓN: guardar y continuar al Paso 4 ---
    log('→ Guardando y continuando al Paso 4...');
    const urlAntes = page.url();
    await page.locator('#btnContinuar').click();

    log('→ Esperando redirección al Paso 4...');
    await page.waitForFunction(
      (before: string) => window.location.href !== before,
      urlAntes,
      { timeout: 60000 }
    );

    // Guardar screenshot de éxito del Paso 4 cargado
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const successPath = path.join(outputDir, 'step3_success.png');
    await page.screenshot({ path: successPath, fullPage: true });
    log(`✓ Paso 3 completado. Captura de éxito guardada en: ${successPath}`);
    log(`→ Nueva URL: ${page.url()}`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ✗ Error en Paso 3.`);
    await screenshotOnFailure(page, 'step3');
    throw error;
  }
}
