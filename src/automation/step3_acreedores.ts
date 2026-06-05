import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';
import { screenshotOnFailure } from '../utils/browser';
import { extractCreditors, CmfCreditor } from '../utils/cmf_analyzer';
import {
  fetchAcreedoresCatalog,
  matchAcreedor,
  getRegionValue,
  normalizeRut,
  normalizeText,
  AcreedorCatalogEntry,
} from '../utils/acreedor_matcher';
import * as fs from 'fs';
import * as path from 'path';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: unknown): void;
}

export interface Step3Report {
  added: { institucion: string; nombreCatalogo: string; monto: number }[];
  skipped: { institucion: string; reason: string }[];
}

const MAX = { nombre: 70, direccion: 100, email: 100, telefono: 20, monto: 12 };

/**
 * Fills Step 3 (Acreedores): uploads the CMF report, then declares every
 * creditor found in the report (direct + indirect) using data from the
 * `acreedores_canonicos` catalog. Creditors that are missing or ambiguous in
 * the catalog are skipped and reported for manual review.
 */
export async function fillStep3(
  page: Page,
  cmfLocalPath: string,
  supabase: SupabaseClient,
  logger?: SimpleLogger,
  boletinComercialPath?: string
): Promise<Step3Report> {
  const log = (msg: string) => {
    if (logger) {
      logger.log(msg);
    } else {
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
      console.log(`[${ts}] ${msg}`);
    }
  };
  const logError = (msg: string, err?: unknown) => {
    if (logger) logger.error(msg, err);
    else console.error(msg, err ?? '');
  };

  const report: Step3Report = { added: [], skipped: [] };

  if (!fs.existsSync(cmfLocalPath)) {
    throw new Error(`Informe CMF local no encontrado: ${cmfLocalPath}`);
  }

  try {
    // URL check first (BUG-09), then wait for the form.
    if (!page.url().includes('renegociacion')) {
      throw new Error(`URL inesperada para Paso 3: ${page.url()}`);
    }

    log('⏳ Esperando formulario de Paso 3 (Acreedores)...');
    await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 30000 });

    log('→ Esperando estabilización de scripts en la página...');
    await page.waitForTimeout(3000);

    // --- 1. Upload Boletín Comercial (opcional) --------------------------
    if (boletinComercialPath && fs.existsSync(boletinComercialPath)) {
      log('→ Seleccionando archivo de Boletín Comercial...');
      await page.locator('#boletinComercial').setInputFiles(boletinComercialPath);
      log('→ Presionando botón Subir Boletín Comercial...');
      await page.locator('#btnSubirBoletinComercial').click();
      await page.waitForTimeout(3000);
      log('✓ Boletín Comercial subido.');
    }

    // --- 2. Upload Informe CMF -------------------------------------------
    log('→ Seleccionando archivo de Informe CMF...');
    await page.locator('#informeCMF').setInputFiles(cmfLocalPath);

    log('→ Presionando botón Subir Informe CMF...');
    await page.locator('#btnSubirInformeCMF').click();

    log('→ Esperando confirmación de subida de Informe CMF...');
    await page.locator('#btnEliminarCMF, #btnVerCMF').first().waitFor({ state: 'attached', timeout: 45000 });
    log('✓ Informe CMF subido correctamente.');

    // --- 3. Extract creditors from the CMF + load catalog ----------------
    const creditors = await extractCreditors(cmfLocalPath, logger);
    if (creditors.length === 0) {
      throw new Error('No se detectó ningún acreedor en el Informe CMF.');
    }

    log('→ Cargando catálogo acreedores_canonicos...');
    const catalog = await fetchAcreedoresCatalog(supabase);
    log(`✓ Catálogo cargado: ${catalog.length} acreedores canónicos.`);

    // --- 4. Add each creditor --------------------------------------------
    for (const creditor of creditors) {
      const match = matchAcreedor(creditor.institucion, catalog);

      if (match.status === 'not_found') {
        const reason = 'No existe en acreedores_canonicos (sin RUT para buscar en el portal).';
        log(`⏭️  Saltando "${creditor.institucion}": ${reason}`);
        report.skipped.push({ institucion: creditor.institucion, reason });
        continue;
      }
      if (match.status === 'ambiguous') {
        const names = (match.candidates ?? []).map((c) => c.nombre).join(' | ');
        const reason = `Múltiples candidatos en el catálogo: ${names}`;
        log(`⏭️  Saltando "${creditor.institucion}": ${reason}`);
        report.skipped.push({ institucion: creditor.institucion, reason });
        continue;
      }

      const entry = match.entry!;
      try {
        const isPersona = entry.tipo?.toLowerCase().includes('persona') === true;
        if (isPersona) {
          await addPersonaAcreedor(page, entry, creditor, log);
        } else {
          await addEmpresaAcreedor(page, entry, creditor, log);
        }
        report.added.push({
          institucion: creditor.institucion,
          nombreCatalogo: entry.nombre,
          monto: creditor.totalCredito,
        });
        log(`✓ Acreedor agregado: ${entry.nombre} ($${creditor.totalCredito.toLocaleString('es-CL')}).`);
      } catch (err) {
        const reason = `Error al agregar en el portal: ${(err as Error).message}`;
        logError(`✗ Falló agregar "${creditor.institucion}" (${entry.nombre}).`, err);
        report.skipped.push({ institucion: creditor.institucion, reason });
        // Best-effort: close any open modal so the loop can continue.
        await dismissOpenModal(page).catch(() => {});
      }
    }

    // --- 5. Report summary -----------------------------------------------
    log('───────────────────────────────────────────');
    log(`📊 Resumen Paso 3: ${report.added.length} acreedor(es) agregado(s), ${report.skipped.length} saltado(s).`);
    report.skipped.forEach((s) => log(`   ⚠️ ${s.institucion}: ${s.reason}`));
    log('───────────────────────────────────────────');

    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const dryRun = process.env.DRY_RUN !== 'false';
    if (dryRun) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const shot = path.join(outputDir, `verify_step3_${stamp}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      log(`📸 Screenshot de verificación Paso 3: ${shot}`);

      log('🧹 DRY_RUN=true: limpiando acreedores agregados e Informe CMF...');
      await cleanupAcreedores(page, log).catch((err) => logError('No se pudo limpiar acreedores.', err));
      await cleanupCMF(page, log).catch((err) => logError('No se pudo limpiar el Informe CMF.', err));

      const cleanShot = path.join(outputDir, `verify_step3_clean_${stamp}.png`);
      await page.screenshot({ path: cleanShot, fullPage: true });
      log(`📸 Captura de borrador limpio: ${cleanShot}`);
      log('⚠️  DRY_RUN=true: formulario NO guardado permanentemente.');
      return report;
    }

    // --- PRODUCCIÓN: guardar y continuar al Paso 4 -----------------------
    log('→ Guardando y continuando al Paso 4...');
    const urlAntes = page.url();
    await page.locator('#btnContinuar').click();

    log('→ Esperando redirección al Paso 4...');
    await page.waitForFunction((before: string) => window.location.href !== before, urlAntes, { timeout: 60000 });

    const successPath = path.join(outputDir, 'step3_success.png');
    await page.screenshot({ path: successPath, fullPage: true });
    log(`✓ Paso 3 completado. Captura de éxito: ${successPath}`);
    log(`→ Nueva URL: ${page.url()}`);
    return report;

  } catch (error) {
    logError('✗ Error en Paso 3.', error);
    await screenshotOnFailure(page, 'step3');
    throw error;
  }
}

/**
 * Opens the "Agregar Empresa" modal and fills it for one creditor.
 */
async function addEmpresaAcreedor(
  page: Page,
  entry: AcreedorCatalogEntry,
  creditor: CmfCreditor,
  log: (m: string) => void
): Promise<void> {
  const rut = normalizeRut(entry.rut);
  if (!rut) throw new Error('El acreedor del catálogo no tiene RUT.');

  log(`→ Abriendo modal Empresa para "${entry.nombre}" (RUT ${rut})...`);
  await page.locator('#btnAgregarEmpresa').click();
  await page.locator('#modalEmpresa').waitFor({ state: 'visible', timeout: 15000 });

  // RUT + Buscar (portal autocompletes the name)
  await page.locator('#empresaRutDv').fill(rut);
  await page.locator('#buscarEmpresa').click();

  // Wait for the portal to populate the name; fall back to catalog name.
  const nombreInput = page.locator('#empresaNombre');
  const autofilled = await nombreInput
    .evaluate((el: HTMLInputElement) => new Promise<boolean>((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (el.value.trim().length > 0) return resolve(true);
        if (Date.now() - start > 10000) return resolve(false);
        setTimeout(tick, 250);
      };
      tick();
    }))
    .catch(() => false);

  if (!autofilled) {
    log('   ⚠️ El portal no autocompletó el nombre; usando el del catálogo.');
    await nombreInput.fill(truncate(entry.nombre, MAX.nombre));
  }

  // Address
  await locByName(page, 'empresaAcreedor.direccion').fill(truncate(entry.direccion ?? '', MAX.direccion));

  // Región + Comuna (dependent dropdowns)
  await selectRegionAndComuna(page, entry, log);

  // Contact
  await locByName(page, 'empresaAcreedor.notificacionEmail').fill(truncate(entry.email ?? '', MAX.email));
  await locByName(page, 'empresaAcreedor.notificacionTelefono').fill(truncate(entry.telefono ?? '', MAX.telefono));

  // Legal representative (optional)
  if (entry.representante_legal && entry.rut_representante) {
    await addRepresentante(page, entry, '#agregarRepresentanteLegalEmpresa', log).catch((err) =>
      log(`   ⚠️ No se pudo agregar representante legal: ${(err as Error).message}`)
    );
  }

  // Debt amount = "Total del crédito" from the CMF.
  await locByName(page, 'empresaAcreedor.deudaMonto').fill(truncate(String(creditor.totalCredito), MAX.monto));

  // Vencimiento — obligatorio en el modal real. Usamos hoy-90d como mínimo razonable
  // para deudas Obligaciones 260 (requieren 90+ días de mora).
  await page.locator('#empresaAcreedorFchCuotaImpaga').fill(dateDaysAgo(90));

  // Save
  await page.locator('#btnGuardarEmpresa').click();
  await page.locator('#modalEmpresa').waitFor({ state: 'hidden', timeout: 15000 });
}

/**
 * Selects Región (by option value) then Comuna (by matching visible text).
 */
async function selectRegionAndComuna(
  page: Page,
  entry: AcreedorCatalogEntry,
  log: (m: string) => void
): Promise<void> {
  const regionValue = getRegionValue(entry.comuna);
  if (!regionValue) {
    throw new Error(`Comuna sin mapeo a región: "${entry.comuna}".`);
  }

  await page.selectOption('#empresaRegion', regionValue);
  // Nudge bootstrap-select + dependent comuna loader.
  await page.evaluate(() => {
    const sel = document.querySelector('#empresaRegion') as HTMLSelectElement | null;
    sel?.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Wait for comuna options to populate.
  await page.waitForFunction(
    () => (document.querySelector('#empresaComuna') as HTMLSelectElement | null)?.options.length! > 1,
    undefined,
    { timeout: 15000 }
  );

  const target = normalizeText(entry.comuna ?? '');
  const comunaValue = await page.$$eval(
    '#empresaComuna option',
    (opts, t) =>
      (opts as HTMLOptionElement[]).find(
        (o) => o.textContent!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === t
      )?.value ?? null,
    target
  );

  if (!comunaValue) {
    throw new Error(`Comuna "${entry.comuna}" no está en el listado de la región.`);
  }

  await page.selectOption('#empresaComuna', comunaValue);
  await page.evaluate(() => {
    const sel = document.querySelector('#empresaComuna') as HTMLSelectElement | null;
    sel?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  log(`   ✓ Región (${regionValue}) y comuna ("${entry.comuna}") seleccionadas.`);
}

/**
 * Opens the Representante Legal modal and fills it. Tries the portal's RUT
 * lookup first; falls back to splitting the stored full name.
 */
async function addRepresentante(
  page: Page,
  entry: AcreedorCatalogEntry,
  btnSelector: string,
  log: (m: string) => void
): Promise<void> {
  const repRut = normalizeRut(entry.rut_representante);
  if (!repRut) throw new Error('Representante sin RUT.');

  await page.locator(btnSelector).click();
  await page.locator('#modalRepresentante').waitFor({ state: 'visible', timeout: 10000 });

  await page.locator('#representanteRutDv').fill(repRut);
  await page.locator('#btnBuscarRep').click();
  await page.waitForTimeout(2500);

  const nombresFilled = await page.locator('#representanteNombres').evaluate(
    (el: HTMLInputElement) => el.value.trim().length > 0
  );

  if (!nombresFilled) {
    const { nombres, paterno, materno } = splitName(entry.representante_legal!);
    await page.locator('#representanteNombres').fill(truncate(nombres, 50));
    await page.locator('#representanteAPaterno').fill(truncate(paterno, 30));
    if (materno) await page.locator('#representanteAMaterno').fill(truncate(materno, 30));
  }

  await page.locator('#guardarRep').click();
  await page.locator('#modalRepresentante').waitFor({ state: 'hidden', timeout: 10000 });
  log(`   ✓ Representante legal agregado (${repRut}).`);
}

/** Returns a date N days ago as dd/mm/yyyy. */
function dateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Best-effort cleanup of every creditor row in both tables added during a dry run.
 */
async function cleanupAcreedores(page: Page, log: (m: string) => void): Promise<void> {
  for (const tableId of ['tablaAcreedores', 'tablaOtrosAcreedores']) {
    for (let i = 0; i < 20; i++) {
      const deleteBtn = page
        .locator(`#${tableId} tbody tr button[title*="liminar"], #${tableId} tbody tr a[title*="liminar"]`)
        .first();
      if ((await deleteBtn.count()) === 0) break;

      await deleteBtn.click();
      const confirm = page.locator('#btnConfirmarModal');
      await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      await page.waitForTimeout(1500);
    }
  }
  log('   🗑️ Acreedores de prueba eliminados (best-effort).');
}

async function cleanupCMF(page: Page, log: (m: string) => void): Promise<void> {
  const deleteSelector = '#btnEliminarCMF';
  if (!(await page.locator(deleteSelector).count())) return;

  await page.locator(deleteSelector).click();
  await page.waitForSelector('#btnConfirmarModal', { state: 'visible', timeout: 5000 });
  await page.locator('#btnConfirmarModal').click();
  await page.locator(deleteSelector).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  log('   🗑️ Informe CMF eliminado.');
}

/**
 * Opens the "Agregar Persona Natural" modal and fills it for one creditor.
 */
async function addPersonaAcreedor(
  page: Page,
  entry: AcreedorCatalogEntry,
  creditor: CmfCreditor,
  log: (m: string) => void
): Promise<void> {
  const rut = normalizeRut(entry.rut);
  if (!rut) throw new Error('El acreedor del catálogo no tiene RUT.');

  log(`→ Abriendo modal Persona Natural para "${entry.nombre}" (RUT ${rut})...`);
  await page.locator('#btnAgregarPersona').click();
  await page.locator('#modalPersona').waitFor({ state: 'visible', timeout: 15000 });

  await page.locator('#personaRutDv').fill(rut);
  await page.locator('#buscarPersona').click();
  await page.waitForTimeout(2500);

  const nombresFilled = await page.locator('[id="persona.nombres"]').evaluate(
    (el: HTMLInputElement) => el.value.trim().length > 0
  );
  if (!nombresFilled) {
    const { nombres, paterno, materno } = splitName(entry.nombre);
    await page.locator('[id="persona.nombres"]').fill(truncate(nombres, 50));
    await page.locator('[id="persona.aPaterno"]').fill(truncate(paterno, 30));
    if (materno) await page.locator('[id="persona.aMaterno"]').fill(truncate(materno, 30));
  }

  await locByName(page, 'personaAcreedor.direccion').fill(truncate(entry.direccion ?? '', MAX.direccion));
  await selectPersonaRegionAndComuna(page, entry, log);
  await locByName(page, 'personaAcreedor.notificacionEmail').fill(truncate(entry.email ?? '', MAX.email));
  await locByName(page, 'personaAcreedor.notificacionTelefono').fill(truncate(entry.telefono ?? '', MAX.telefono));

  if (entry.representante_legal && entry.rut_representante) {
    await addRepresentante(page, entry, '#agregarRepresentanteLegalPersona', log).catch((err) =>
      log(`   ⚠️ No se pudo agregar representante legal: ${(err as Error).message}`)
    );
  }

  await locByName(page, 'personaAcreedor.deudaMonto').fill(truncate(String(creditor.totalCredito), MAX.monto));
  // Vencimiento — obligatorio en el modal real.
  await page.locator('#personaFechaCuotaImpaga').fill(dateDaysAgo(90));

  await page.locator('#btnGuardarPersona').click();
  await page.locator('#modalPersona').waitFor({ state: 'hidden', timeout: 15000 });
}

/**
 * Selects Región + Comuna for the Persona Natural modal.
 */
async function selectPersonaRegionAndComuna(
  page: Page,
  entry: AcreedorCatalogEntry,
  log: (m: string) => void
): Promise<void> {
  const regionValue = getRegionValue(entry.comuna);
  if (!regionValue) {
    throw new Error(`Comuna sin mapeo a región: "${entry.comuna}".`);
  }

  await page.selectOption('#personaRegion', regionValue);
  await page.evaluate(() => {
    const sel = document.querySelector('#personaRegion') as HTMLSelectElement | null;
    sel?.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.waitForFunction(
    () => (document.querySelector('#personaAcreedorcomuna') as HTMLSelectElement | null)?.options.length! > 1,
    undefined,
    { timeout: 15000 }
  );

  const target = normalizeText(entry.comuna ?? '');
  const comunaValue = await page.$$eval(
    '#personaAcreedorcomuna option',
    (opts, t) =>
      (opts as HTMLOptionElement[]).find(
        (o) => o.textContent!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() === t
      )?.value ?? null,
    target
  );

  if (!comunaValue) {
    throw new Error(`Comuna "${entry.comuna}" no está en el listado de la región (persona).`);
  }

  await page.selectOption('#personaAcreedorcomuna', comunaValue);
  await page.evaluate(() => {
    const sel = document.querySelector('#personaAcreedorcomuna') as HTMLSelectElement | null;
    sel?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  log(`   ✓ Región (${regionValue}) y comuna ("${entry.comuna}") seleccionadas (persona).`);
}

async function dismissOpenModal(page: Page): Promise<void> {
  const closeBtn = page.locator('.modal.show button[data-dismiss="modal"]').first();
  if (await closeBtn.count()) {
    await closeBtn.click();
    await page.waitForTimeout(500);
  }
}

/** Locator by exact `id` attribute (safe for IDs containing dots). */
function locByName(page: Page, id: string) {
  return page.locator(`[id="${id}"]`);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.substring(0, max) : value;
}

/**
 * Splits a full Chilean name into nombres / apellido paterno / apellido materno.
 * Heuristic: last token = materno, second-to-last = paterno, rest = nombres.
 */
function splitName(full: string): { nombres: string; paterno: string; materno: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { nombres: parts[0], paterno: '', materno: '' };
  if (parts.length === 2) return { nombres: parts[0], paterno: parts[1], materno: '' };
  const materno = parts.pop()!;
  const paterno = parts.pop()!;
  return { nombres: parts.join(' '), paterno, materno };
}
