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
import { clearStep5Incomes } from './step5_ingresos';
import { clearStep2Documents } from './step2_declaraciones';
import { clearStep3Creditors } from './step3_acreedores';

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

    await clearStep2Documents(page, log);

    // --- 2. Clean Step 3 (Acreedores y CMF) ---------------------------------
    const step3Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verAcreedores`;
    log(`→ Navegando a Paso 3 para limpiar acreedores e informe CMF: ${step3Url}`);
    await page.goto(step3Url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await clearStep3Creditors(page, log);

    // --- 3. Clean Step 5 (Ingresos) -----------------------------------------
    const step5Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verIngresos`;
    log(`→ Navegando a Paso 5 para limpiar ingresos declarados y justificativos: ${step5Url}`);
    await page.goto(step5Url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await clearStep5Incomes(page, log);

    log('🎉 ¡El borrador del portal ha sido completamente limpiado!');
  } catch (err: any) {
    logError('⚠️ Error durante la ejecución de la autolimpieza del borrador en el portal:', err.message || err);
  }
}
