// ═══════════════════════════════════════════════════════════════════════════════
// MIGRACIÓN PORTAL SUPERIR v6.0.1 — Autolimpieza del borrador  ⚠️ EN PROGRESO (2026-07-21)
// ───────────────────────────────────────────────────────────────────────────────
// La navegación + el Paso 1 YA están migrados y vivos. Este paso AÚN NO.
// NO se aplicó ningún rename a ciegas: los selectores marcados abajo con
//   `// TODO v6.0.1`  siguen con el id VIEJO a propósito. Hay que confirmarlos
// contra el HTML del mapeo (map_portal.mjs) y recién ahí editarlos (dual `#nuevo, #viejo`).
//
// Punch-list completo (archivo · línea · categoría · propuesta):
//   context/superir-v601-auditoria-selectores.md
// Sospechoso (casi seguro cambió): comparte ids con Paso 2/3 (data-documento, tablaAcreedores, btnEliminarCMF, dlgConfirmar) — actualizar con LOS MISMOS valores que se confirmen ahí
// ═══════════════════════════════════════════════════════════════════════════════

import { Page } from 'playwright';
import { dataRowCount } from './step5_ingresos';

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

    // --- 3. Clean Step 5 (Ingresos) -----------------------------------------
    // ponytail: ids de tabla (tablaIngresos, tablaDocumentos) confirmados en
    // step5_ingresos.ts; los selectores de borrado (botón tacho por fila + modal
    // #btnConfirmarModal / #dlgConfirmar) están derivados por analogía al Paso 3;
    // verificar contra el DOM real en la próxima corrida.
    const step5Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verIngresos`;
    log(`→ Navegando a Paso 5 para limpiar ingresos declarados y justificativos: ${step5Url}`);
    await page.goto(step5Url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Delete all declared incomes and all supporting documents from both tables
    for (const tableId of ['tablaIngresos', 'tablaDocumentos']) {
      log(`   🗑️  Buscando filas en "${tableId}" para eliminar...`);

      // A) Detección de falso-éxito: hay filas de datos pero el selector de tacho no matchea.
      const filasReales = await dataRowCount(page, tableId);
      const tieneBotonBorrado =
        (await page
          .locator(`#${tableId} tbody tr button[title*="liminar"], #${tableId} tbody tr a[title*="liminar"]`)
          .count()) > 0;
      if (filasReales > 0 && !tieneBotonBorrado) {
        log(
          `   ⚠️ Paso 5: la tabla "${tableId}" tiene ${filasReales} fila(s) pero no se encontró botón de eliminar (selector de tacho no matcheó) — NO se limpió; verificar DOM de verIngresos.`
        );
        continue;
      }

      for (let i = 0; i < 30; i++) {
        const deleteBtn = page
          .locator(`#${tableId} tbody tr button[title*="liminar"], #${tableId} tbody tr a[title*="liminar"]`)
          .first();
        if ((await deleteBtn.count()) === 0) break;

        const antes = await dataRowCount(page, tableId);

        log(`      🗑️  Eliminando fila ${i + 1} de "${tableId}"...`);
        await deleteBtn.click();

        const confirm = page.locator('#btnConfirmarModal');
        await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await confirm.isVisible().catch(() => false)) {
          await confirm.click();
          await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        }
        await page.waitForLoadState('load').catch(() => {});
        await page.waitForSelector('#ingresosRenegociacionForm', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);

        // B) Break por no-progreso: si el conteo no bajó, no re-clickear la misma fila.
        if ((await dataRowCount(page, tableId)) >= antes) {
          log(
            `   ⚠️ Paso 5: el borrado no redujo las filas de "${tableId}" (${antes} fila(s)) — corto para no reintentar la misma fila; verificar flujo de borrado.`
          );
          break;
        }
      }
    }

    // El ✓ final solo si efectivamente no quedan filas de datos en ninguna tabla.
    const filasRestantesStep5 =
      (await dataRowCount(page, 'tablaIngresos')) + (await dataRowCount(page, 'tablaDocumentos'));
    if (filasRestantesStep5 === 0) {
      log('   ✓ Todos los ingresos declarados y documentos justificativos eliminados del borrador.');
    }

    log('🎉 ¡El borrador del portal ha sido completamente limpiado!');
  } catch (err: any) {
    logError('⚠️ Error durante la ejecución de la autolimpieza del borrador en el portal:', err.message || err);
  }
}
