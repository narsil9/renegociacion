import { Page } from 'playwright';
import { screenshotOnFailure } from '../utils/browser';
import * as fs from 'fs';
import * as path from 'path';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

export async function fillStep4(
  page: Page,
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

  try {
    if (!page.url().includes('renegociacion')) {
      throw new Error(`URL inesperada para Paso 4: ${page.url()}`);
    }

    log('⏳ Esperando formulario de Paso 4 (Apoderado)...');
    await page.waitForSelector('#apoderadoRenegociacionForm', { timeout: 30000 });

    log('→ Esperando estabilización de scripts en la página...');
    await page.waitForTimeout(3000);

    log('→ Seleccionando opción: Asistiré personalmente a las audiencias...');
    await page.locator('#representadoPorApoderadoNo').check({ force: true });

    log('✓ Todos los campos requeridos del Paso 4 completados.');

    const dryRun = process.env.DRY_RUN !== 'false';
    if (dryRun) {
      const outputDir = path.join(process.cwd(), 'outputs');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const screenshotPath = path.join(outputDir, `verify_step4_${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`📸 Screenshot de verificación Paso 4: ${screenshotPath}`);
      log('⚠️  DRY_RUN=true: formulario NO guardado permanentemente.');
      return;
    }

    // --- PRODUCCIÓN: guardar y continuar al Paso 5 ---
    log('→ Guardando y continuando al Paso 5...');
    const urlAntes = page.url();
    await page.locator('#btnContinuar').click();

    log('→ Esperando redirección al Paso 5...');
    await page.waitForFunction(
      (before: string) => window.location.href !== before,
      urlAntes,
      { timeout: 60000 }
    );

    // Guardar screenshot de éxito del Paso 5 cargado
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const successPath = path.join(outputDir, 'step4_success.png');
    await page.screenshot({ path: successPath, fullPage: true });
    log(`✓ Paso 4 completado. Captura de éxito guardada en: ${successPath}`);
    log(`→ Nueva URL: ${page.url()}`);

  } catch (error) {
    if (logger) {
      logger.error('✗ Error en Paso 4.', error);
    } else {
      console.error(`[${new Date().toISOString()}] ✗ Error en Paso 4.`, error);
    }
    await screenshotOnFailure(page, 'step4');
    throw error;
  }
}
