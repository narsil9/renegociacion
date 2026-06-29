/**
 * Paso 5 — Ingresos. Declara los ingresos del deudor en el portal Superir:
 *   1) una fila por fuente de ingreso (modal "Nuevo Ingreso"),
 *   2) los documentos justificativos (por tipo de antecedente),
 *   3) el Certificado de Cotizaciones Previsionales (upload obligatorio aparte).
 *
 * General para CUALQUIER cliente: recibe los ingresos YA calculados de forma
 * determinista (`income_extractor.ts` vía el agente de ingresos). Este módulo solo
 * maneja el portal — no decide montos ni tipos. Ver lecciones/paso5-ingresos.md.
 */

import { Page } from 'playwright';
import { screenshotOnFailure } from '../utils/browser';
import * as fs from 'fs';
import * as path from 'path';
import { DeclaredIncome } from '../utils/income_extractor';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

/** Documento justificativo a subir (resuelto a su ruta local). */
export interface JustificativoUpload {
  tipoAntecedente: number; // value del <select> #tipoAntecedente (28..45)
  localPath: string;
  filename: string;
}

export interface Step5Input {
  incomes: DeclaredIncome[];
  justificativos: JustificativoUpload[];
  /** Ruta local del Certificado de Cotizaciones (obligatorio). null si no hay. */
  cotizacionesPath: string | null;
}

export interface Step5Report {
  incomesAdded: number;
  documentsUploaded: number;
  cotizacionesUploaded: boolean;
  warnings: string[];
}

const TIPO_INGRESO_SELECT = 'ingresotipoIngresoSolicitud';
const PERIODICIDAD_SELECT = 'ingreso.tipoPeriodicidad';
const TIPO_ANTECEDENTE_SELECT = 'tipoAntecedente';

function nowTag(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Bootstrap selectpicker: set value vía API jQuery + change (como step1/step3). */
async function selectBootstrap(page: Page, selectId: string, value: string): Promise<void> {
  await page.locator(`#${selectId.replace(/\./g, '\\.')}`).selectOption(value).catch(async () => {
    // selectOption falla si el <select> está oculto por el widget; usar la API.
  });
  await page.evaluate(
    ({ id, val }) => {
      const $ = (window as any).jQuery || (window as any).$;
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (!el) return;
      el.value = val;
      if ($ && $(el).selectpicker) {
        $(el).selectpicker('val', val);
        $(el).selectpicker('refresh');
        $(el).trigger('change');
      } else {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
    { id: selectId, val: value }
  );
  await page.waitForTimeout(250);
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, delayMs: number, log: (m: string) => void): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      log(`   ↻ intento ${i}/${attempts} falló: ${e instanceof Error ? e.message : String(e)}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  throw lastErr;
}

/** Nº de filas de datos en una tabla del paso (excluye la fila placeholder). */
async function dataRowCount(page: Page, tableId: string): Promise<number> {
  return page.evaluate((id) => {
    const t = document.getElementById(id);
    if (!t) return 0;
    const rows = Array.from(t.querySelectorAll('tbody tr'));
    // La fila vacía tiene un <td colspan> con el mensaje "No ha declarado...".
    return rows.filter((r) => !r.querySelector('td[colspan]')).length;
  }, tableId);
}

/** Agrega una fila de ingreso vía el modal "Nuevo Ingreso". */
async function addIncome(page: Page, inc: DeclaredIncome, log: (m: string) => void): Promise<void> {
  const before = await dataRowCount(page, 'tablaIngresos');

  await page.locator('#btnAgregarIngreso').click();
  await page.locator('#modalIngreso').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);

  // Tipo de ingreso (etiquetado "Concepto" en el modal).
  await selectBootstrap(page, TIPO_INGRESO_SELECT, String(inc.tipoIngreso));

  // #nombreConcepto solo está visible/required para "Otros" (tipoIngreso=9).
  if (inc.tipoIngreso === 9) {
    const nombre = (inc.concepto || 'Otros ingresos').slice(0, 50);
    await page.locator('#nombreConcepto').fill(nombre);
  }

  // Monto: input maxlength=9, solo dígitos (sin separadores).
  const montoStr = String(Math.max(0, Math.round(inc.monto)));
  if (montoStr.length > 9) {
    throw new Error(`Monto de ingreso fuera de rango para el portal (>9 dígitos): ${montoStr}`);
  }
  await page.locator('#ingreso\\.monto').fill(montoStr);

  // Periodicidad.
  await selectBootstrap(page, PERIODICIDAD_SELECT, String(inc.periodicidad));

  await page.locator('#btnGuardarIngreso').click();

  // El modal se cierra y la fila aparece en la tabla.
  await page.locator('#modalIngreso').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(800);

  const after = await dataRowCount(page, 'tablaIngresos');
  if (after <= before) {
    throw new Error(`El ingreso no se agregó a la tabla (filas antes=${before}, después=${after}).`);
  }
  log(`   ✓ Ingreso agregado: ${inc.tipoIngresoLabel} — $${inc.monto.toLocaleString('es-CL')} (mensual).`);
}

/** Sube un documento justificativo (select tipo + file + botón Subir). */
async function uploadJustificativo(page: Page, doc: JustificativoUpload, log: (m: string) => void): Promise<void> {
  if (!fs.existsSync(doc.localPath)) throw new Error(`Justificativo no encontrado: ${doc.localPath}`);

  await selectBootstrap(page, TIPO_ANTECEDENTE_SELECT, String(doc.tipoAntecedente));
  await page.locator('#fileAntecedente').setInputFiles(doc.localPath);
  await page.waitForTimeout(400);

  // El botón se habilita por JS al elegir archivo; forzar enable como respaldo.
  await page.evaluate(() => {
    const b = document.getElementById('btnSubirAntecedente') as HTMLButtonElement | null;
    if (b) b.disabled = false;
  });

  const before = await dataRowCount(page, 'tablaDocumentos');
  await page.locator('#btnSubirAntecedente').click();
  // guardar() puede recargar la página (form multipart) — esperar carga + tabla.
  await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
  await page.waitForSelector('#ingresosRenegociacionForm', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const after = await dataRowCount(page, 'tablaDocumentos');
  if (after <= before) {
    throw new Error(`El documento justificativo no aparece en la tabla (antes=${before}, después=${after}).`);
  }
  log(`   ✓ Justificativo subido (tipo ${doc.tipoAntecedente}): ${doc.filename}.`);
}

/** Sube el Certificado de Cotizaciones (upload obligatorio aparte). */
async function uploadCotizaciones(page: Page, localPath: string, log: (m: string) => void): Promise<void> {
  if (!fs.existsSync(localPath)) throw new Error(`Certificado de cotizaciones no encontrado: ${localPath}`);

  await page.locator('#fileCertificadoCotizaciones').setInputFiles(localPath);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const b = document.getElementById('btnSubirCertCotizaciones') as HTMLButtonElement | null;
    if (b) b.disabled = false;
  });
  await page.locator('#btnSubirCertCotizaciones').click();
  await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
  await page.waitForSelector('#ingresosRenegociacionForm', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  log('   ✓ Certificado de Cotizaciones subido.');
}

export async function fillStep5(
  page: Page,
  input: Step5Input,
  logger?: SimpleLogger
): Promise<Step5Report> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(`[${new Date().toISOString()}] ${msg}`);
  };

  const report: Step5Report = { incomesAdded: 0, documentsUploaded: 0, cotizacionesUploaded: false, warnings: [] };

  try {
    if (!page.url().includes('verIngresos')) {
      throw new Error(`URL inesperada para Paso 5: ${page.url()}`);
    }
    log('⏳ Esperando formulario de Paso 5 (Ingresos)...');
    await page.waitForSelector('#ingresosRenegociacionForm', { timeout: 30000 });
    await page.waitForTimeout(3000); // estabilización de handlers (regla del proyecto)

    if (input.incomes.length === 0) {
      report.warnings.push('No hay ingresos para declarar (lista vacía).');
      log('⚠️ Paso 5: no hay ingresos para declarar.');
    }

    // --- 1) Ingresos ---
    log(`📝 Declarando ${input.incomes.length} ingreso(s)...`);
    for (const inc of input.incomes) {
      if (inc.monto <= 0) {
        report.warnings.push(`Ingreso "${inc.tipoIngresoLabel}" con monto 0 — omitido (revisar documento).`);
        log(`⚠️ Omitido ingreso "${inc.tipoIngresoLabel}" por monto 0.`);
        continue;
      }
      await withRetry(() => addIncome(page, inc, log), 3, 4000, log);
      report.incomesAdded++;
    }

    // --- 2) Documentos justificativos ---
    log(`📎 Subiendo ${input.justificativos.length} documento(s) justificativo(s)...`);
    for (const doc of input.justificativos) {
      try {
        await withRetry(() => uploadJustificativo(page, doc, log), 2, 3000, log);
        report.documentsUploaded++;
      } catch (e) {
        report.warnings.push(`No se pudo subir el justificativo ${doc.filename}: ${e instanceof Error ? e.message : e}`);
        log(`⚠️ Falló la subida del justificativo ${doc.filename}.`);
      }
    }

    // --- 3) Certificado de Cotizaciones (obligatorio) ---
    if (input.cotizacionesPath) {
      await withRetry(() => uploadCotizaciones(page, input.cotizacionesPath!, log), 2, 3000, log);
      report.cotizacionesUploaded = true;
    } else {
      report.warnings.push('Falta el Certificado de Cotizaciones (obligatorio). El portal no permitirá continuar.');
      log('⚠️ Paso 5: sin Certificado de Cotizaciones — el portal exige este documento.');
    }

    // --- Captura + (DRY_RUN no envía) ---
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const dryRun = process.env.DRY_RUN !== 'false';
    if (dryRun) {
      const shot = path.join(outputDir, `verify_step5_${nowTag()}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      log(`📸 DRY_RUN: captura de verificación Paso 5: ${shot}`);
      log('⚠️ DRY_RUN=true: NO se presiona "Guardar y Continuar" (borrador no avanzado).');
      return report;
    }

    // --- PRODUCCIÓN: Guardar y Continuar ---
    log('→ Guardando y continuando (Paso 5 → Paso 6)...');
    const urlAntes = page.url();
    await page.locator('#btnContinuar').click();
    await page.waitForFunction((b: string) => window.location.href !== b, urlAntes, { timeout: 60000 }).catch(() => {
      report.warnings.push('No se detectó redirección tras "Guardar y Continuar" en el Paso 5.');
    });
    const successPath = path.join(outputDir, 'step5_success.png');
    await page.screenshot({ path: successPath, fullPage: true });
    log(`✓ Paso 5 completado. Captura: ${successPath} | URL: ${page.url()}`);
    return report;
  } catch (error) {
    if (logger) logger.error('✗ Error en Paso 5.', error);
    else console.error('✗ Error en Paso 5.', error);
    await screenshotOnFailure(page, 'step5');
    throw error;
  }
}

/** Construye los uploads de justificativos (dedup por tipo+archivo) desde los ingresos. */
export function buildJustificativos(
  incomes: DeclaredIncome[],
  resolvePath: (filename: string) => string | null
): JustificativoUpload[] {
  const seen = new Set<string>();
  const out: JustificativoUpload[] = [];
  for (const inc of incomes) {
    for (const filename of inc.documentFilenames) {
      const localPath = resolvePath(filename);
      if (!localPath) continue;
      const key = `${inc.tipoAntecedente}::${localPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tipoAntecedente: inc.tipoAntecedente, localPath, filename });
    }
  }
  return out;
}
