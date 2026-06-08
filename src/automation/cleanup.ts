import { Page } from 'playwright';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

/**
 * Wipes the entire portal draft (documents, declarations, creditors) for the current renegotiation flow.
 * Ensures the portal is left in a clean "blank slate" state.
 */
export async function cleanupDraft(page: Page, logger: SimpleLogger): Promise<void> {
  const log = (msg: string) => logger.log(msg);
  const logError = (msg: string, err?: any) => logger.error(msg, err);

  log('🧹 Iniciando rutina de autolimpieza del borrador en el portal...');

  try {
    const baseUrl = new URL(page.url()).origin;

    // --- 1. Clean Step 2 (Declaraciones y Archivos) -------------------------
    const step2Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verDeclaraciones`;
    log(`→ Navegando a Paso 2 para limpiar archivos: ${step2Url}`);
    await page.goto(step2Url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Check if Carpeta Tributaria is uploaded and delete it
    const isTributariaUploaded = await page.evaluate(() => {
      const el = document.getElementById('descargaCarpetaTributaria');
      return el ? !el.classList.contains('hidden') : false;
    });

    if (isTributariaUploaded) {
      log('   🗑️  Eliminando Carpeta Tributaria del borrador...');
      await page.locator('button[data-documento="carpetaTributaria"]').click();
      
      const confirm = page.locator('#btnConfirmarModal');
      await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await page.locator('#descargaCarpetaTributaria').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      log('   ✓ Carpeta Tributaria eliminada.');
      await page.waitForTimeout(1000);
    }

    // Check if Agentes Retenedores is uploaded and delete it
    const isRetenedoresUploaded = await page.evaluate(() => {
      const el = document.getElementById('descargaInformacionIngresos');
      return el ? !el.classList.contains('hidden') : false;
    });

    if (isRetenedoresUploaded) {
      log('   🗑️  Eliminando Certificado de Agentes Retenedores del borrador...');
      await page.locator('button[data-documento="informacionIngresos"]').click();
      
      const confirm = page.locator('#btnConfirmarModal');
      await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await page.locator('#descargaInformacionIngresos').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      log('   ✓ Agentes Retenedores eliminado.');
      await page.waitForTimeout(1000);
    }

    // --- 2. Clean Step 3 (Acreedores y CMF) ---------------------------------
    const step3Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verAcreedores`;
    log(`→ Navegando a Paso 3 para limpiar acreedores e informe CMF: ${step3Url}`);
    await page.goto(step3Url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Delete all creditors from both tables
    for (const tableId of ['tablaAcreedores', 'tablaOtrosAcreedores']) {
      log(`   🗑️  Buscando acreedores en "${tableId}" para eliminar...`);
      for (let i = 0; i < 30; i++) {
        const deleteBtn = page
          .locator(`#${tableId} tbody tr button[title*="liminar"], #${tableId} tbody tr a[title*="liminar"]`)
          .first();
        if ((await deleteBtn.count()) === 0) break;

        log(`      🗑️  Eliminando acreedor ${i + 1} de la tabla...`);
        await deleteBtn.click();
        
        const confirm = page.locator('#btnConfirmarModal');
        await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await confirm.isVisible().catch(() => false)) {
          await confirm.click();
          await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        }
        await page.waitForLoadState('load').catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
    log('   ✓ Todos los acreedores eliminados del borrador.');

    // Delete CMF PDF report
    const deleteCMFSelector = '#btnEliminarCMF';
    if (await page.locator(deleteCMFSelector).count() > 0) {
      log('   🗑️  Eliminando Informe CMF del borrador...');
      await page.locator(deleteCMFSelector).click();
      
      const confirm = page.locator('#btnConfirmarModal');
      await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await page.locator(deleteCMFSelector).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      log('   ✓ Informe CMF eliminado.');
      await page.waitForTimeout(1000);
    }

    log('🎉 ¡El borrador del portal ha sido completamente limpiado!');
  } catch (err: any) {
    logError('⚠️ Error durante la ejecución de la autolimpieza del borrador en el portal:', err.message || err);
  }
}
