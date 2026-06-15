import { Page } from 'playwright';
import { SupabaseClient } from '@supabase/supabase-js';
import { screenshotOnFailure } from '../utils/browser';
import { extractCreditors, CmfCreditor } from '../utils/cmf_analyzer';
import { ReclassifiedCreditor, AdditionalCreditor } from '../utils/sentinel';
import {
  fetchAcreedoresCatalog,
  matchAcreedor,
  getRegionValue,
  normalizeRut,
  normalizeText,
  AcreedorCatalogEntry,
  isValidRut,
  extractRutsFromText,
  findCatalogEntryByRut,
} from '../utils/acreedor_matcher';
import { extractTextFromPdf } from '../utils/pdf_analyzer';
import * as fs from 'fs';
import * as path from 'path';

export interface AcreditacionDoc {
  institucion_cmf: string;
  tipo_documento: 22 | 23 | 24;
  storage_path: string;
  local_path?: string;
  // Nombre legible del client_document. Necesario para asociar correctamente el
  // documento a un acreedor NO-CMF cuando hay varios productos del mismo banco
  // (ej. el CPF de las tarjetas BdCh vs. el consultaCredito del consumo BdCh).
  filename?: string;
}

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: unknown): void;
}

export interface Step3Report {
  added: { institucion: string; nombreCatalogo: string; monto: number }[];
  skipped: { institucion: string; reason: string }[];
}

/**
 * Override de monto y/o fecha de vencimiento "según el documento de acreditación"
 * para un acreedor del CMF (los reclasificados y no-CMF ya traen estos datos en
 * sus propias estructuras). El monto del documento es más actual que el del CMF;
 * la fecha de vencimiento real reemplaza el placeholder `dateDaysAgo(90)`.
 * En producción lo puebla el Orquestador (pendiente de extraer los valores);
 * en los tests se provee hardcodeado.
 */
export interface CmfDocumentOverride {
  institucion_cmf: string;
  monto_clp?: number;
  fecha_vencimiento?: string; // YYYY-MM-DD o dd/mm/yyyy
}

/** Convierte una fecha YYYY-MM-DD (o dd/mm/yyyy) al formato dd/mm/yyyy del portal. */
function toPortalDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
  return undefined; // formato no reconocido → caller usa fallback
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
  boletinComercialPath?: string,
  acreditacionDocs?: AcreditacionDoc[],
  reclassifiedCreditors?: ReclassifiedCreditor[],
  additionalCreditors?: AdditionalCreditor[],
  cmfDocumentOverrides?: CmfDocumentOverride[]
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

    // --- 2. Upload Informe CMF (with retry + idempotency check) --------------
    const cmfAlreadyUploaded = await page
      .locator('#btnEliminarCMF, #btnVerCMF')
      .first()
      .isVisible()
      .catch(() => false);

    if (cmfAlreadyUploaded) {
      log('✓ Informe CMF ya estaba subido (omitiendo upload).');
    } else {
      await withRetry(
        async () => {
          if (
            await page.locator('#btnEliminarCMF, #btnVerCMF').first().isVisible().catch(() => false)
          ) {
            return; // already uploaded in a previous attempt
          }
          log('→ Seleccionando archivo de Informe CMF...');
          await page.locator('#informeCMF').setInputFiles(cmfLocalPath);
          log('→ Presionando botón Subir Informe CMF...');
          await page.locator('#btnSubirInformeCMF').click();
          log('→ Esperando confirmación de subida de Informe CMF...');
          await page.locator('#btnEliminarCMF:not(.hidden), #btnVerCMF:not(.hidden)').first().waitFor({ state: 'attached', timeout: 45000 });
        },
        {
          attempts: 3,
          delayMs: 4000,
          onRetry: (attempt, err) =>
            log(`⚠️ Reintento ${attempt}/2 subida CMF: ${err.message.substring(0, 120)}`),
        }
      );
      log('✓ Informe CMF subido correctamente.');
    }

    // --- 3. Extract creditors from the CMF + load catalog ----------------
    const creditors = await extractCreditors(cmfLocalPath, logger);
    if (creditors.length === 0) {
      throw new Error('No se detectó ningún acreedor en el Informe CMF.');
    }

    log('→ Cargando catálogo acreedores_canonicos...');
    const catalog = await withRetry(() => fetchAcreedoresCatalog(supabase), {
      attempts: 3,
      delayMs: 3000,
      onRetry: (attempt, err) =>
        log(`⚠️ Reintento ${attempt}/2 carga catálogo: ${err.message.substring(0, 100)}`),
    });
    log(`✓ Catálogo cargado: ${catalog.length} acreedores canónicos.`);

    // --- 3b. Download acreditacion docs from Storage ----------------------
    const docs = acreditacionDocs ?? [];
    if (docs.length > 0) {
      const tmpDir = path.join(process.cwd(), 'outputs', 'acreditaciones_tmp');
      await downloadAcreditacionDocs(supabase, docs, tmpDir, log);
    }

    // --- 3c. Classify creditors + validate 80 UF requirement ----------------
    const UF_80_CLP = 3_253_000; // 80 UF ≈ $3,253,000 CLP
    // Un acreedor es reclasificado a Art. 260 si el sentinel detectó mora ≥91d
    // en sus documentos, aunque el CMF muestre $0 en la columna 90+d.
    // Name-only matching: monto is deliberately excluded because the CMF cut date
    // and the bank document date can differ by weeks, causing multi-million CLP gaps.
    const getReclassifiedMatch = (c: CmfCreditor): ReclassifiedCreditor | undefined => {
      if (!reclassifiedCreditors || reclassifiedCreditors.length === 0) return undefined;
      const normInst = normalizeText(c.institucion);
      return reclassifiedCreditors.find(r => {
        const normR = normalizeText(r.institucion_cmf);
        return normInst.includes(normR) || normR.includes(normInst);
      });
    };
    const isReclassifiedTo260 = (c: CmfCreditor): boolean => !!getReclassifiedMatch(c);

    const getCmfOverride = (c: CmfCreditor): CmfDocumentOverride | undefined => {
      if (!cmfDocumentOverrides || cmfDocumentOverrides.length === 0) return undefined;
      const normInst = normalizeText(c.institucion);
      return cmfDocumentOverrides.find(o => {
        const normO = normalizeText(o.institucion_cmf);
        return normInst.includes(normO) || normO.includes(normInst);
      });
    };

    const obligaciones260 = creditors.filter((c) => c.overdue90Days > 0 || isReclassifiedTo260(c));
    const otrosAcreedores = creditors.filter((c) => c.overdue90Days === 0 && !isReclassifiedTo260(c));
    const total90Days = obligaciones260.reduce((sum, c) => sum + c.totalCredito, 0);

    log('→ Clasificación de acreedores:');
    log(`   📋 Obligaciones 260 (morosidad >90d): ${obligaciones260.length}`);
    obligaciones260.forEach((c) =>
      log(`      • ${c.institucion}: 90d=$${c.overdue90Days.toLocaleString('es-CL')}, total=$${c.totalCredito.toLocaleString('es-CL')}`)
    );
    log(`   📋 Otros Acreedores (sin morosidad >90d): ${otrosAcreedores.length}`);
    otrosAcreedores.forEach((c) =>
      log(`      • ${c.institucion}: total=$${c.totalCredito.toLocaleString('es-CL')}`)
    );
    log(`→ Suma total del crédito (acreedores con 90+d): $${total90Days.toLocaleString('es-CL')} (mín. $${UF_80_CLP.toLocaleString('es-CL')} / 80 UF)`);
    if (total90Days < UF_80_CLP) {
      log(`⚠️  ADVERTENCIA: Suma del total del crédito con morosidad >90d ($${total90Days.toLocaleString('es-CL')}) no alcanza 80 UF. Flujo continúa; revisar documentos adicionales si aplica.`);
    } else {
      log('✓ Requisito 80 UF cumplido.');
    }

    // --- 4a. Add each creditor (Phase 1) ------------------------------------
    // Creditors with overdue90Days > 0 → Obligaciones 260 (#btnAgregarEmpresa)
    // Creditors with overdue90Days === 0 → Otros Acreedores (#btnAgregarEmpresa2)
    // The portal only enables "Subir Documento" buttons once ALL creditors are
    // present in the table. We add all first, then attach documents separately.
    const addedDocs: { entry: AcreedorCatalogEntry; creditor: CmfCreditor; nonCmfDocFilename?: string }[] = [];

    // Extract client's RUT from the CMF to ignore it when scanning certificates
    let clientRutClean: string | null = null;
    try {
      const cmfText = await extractTextFromPdf(cmfLocalPath);
      const rutMatch = cmfText.match(/Rut\s*:\s*([\d.kK-]+)/i);
      if (rutMatch) {
        clientRutClean = normalizeRut(rutMatch[1]);
        log(`🔍 RUT del cliente extraído del CMF para filtrado de certificados: ${clientRutClean}`);
      }
    } catch (err) {
      log(`⚠️ No se pudo extraer el RUT del cliente del CMF: ${(err as Error).message}`);
    }

    for (const creditor of creditors) {
      let entry: AcreedorCatalogEntry | null = null;

      // 1. Try to detect creditor by certificate RUT first
      const creditorDocs = findAcreditacionDocs(creditor.institucion, docs);
      for (const doc of creditorDocs) {
        if (doc?.local_path && fs.existsSync(doc.local_path)) {
          log(`🔍 Escaneando certificado "${path.basename(doc.local_path)}" para identificar RUT del emisor...`);
          const docMatchedEntry = await detectCreditorRutFromDoc(doc.local_path, clientRutClean, catalog, log);
          if (docMatchedEntry) {
            log(`   ✓ Coincidencia por certificado: RUT ${docMatchedEntry.rut} (${docMatchedEntry.nombre}). Sobrescribiendo match de nombre.`);
            entry = docMatchedEntry;
            break;
          }
        }
      }

      // 2. Fallback to matching by name
      if (!entry) {
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

        entry = match.entry!;
      }
      const isOtros = creditor.overdue90Days === 0 && !isReclassifiedTo260(creditor);

      // Monto y vencimiento "según el documento de acreditación" (más actuales que el CMF):
      // los reclasificados traen sus propios datos; los 260 directos del CMF se
      // sobrescriben vía cmfDocumentOverrides. El monto efectivo se propaga a la
      // idempotencia y a la adjunción de documentos (que matchean por monto).
      const rec = getReclassifiedMatch(creditor);
      const cmfOv = getCmfOverride(creditor);
      const montoEfectivo =
        rec?.total_credito_clp && rec.total_credito_clp > 0 ? rec.total_credito_clp :
        cmfOv?.monto_clp && cmfOv.monto_clp > 0 ? cmfOv.monto_clp :
        creditor.totalCredito;
      const fechaVenc = toPortalDate(rec?.delinquency_start_date) ?? toPortalDate(cmfOv?.fecha_vencimiento);
      const creditorEff: CmfCreditor =
        montoEfectivo !== creditor.totalCredito ? { ...creditor, totalCredito: montoEfectivo } : creditor;
      if (montoEfectivo !== creditor.totalCredito) {
        log(`   💰 Monto según documento: $${montoEfectivo.toLocaleString('es-CL')} (CMF: $${creditor.totalCredito.toLocaleString('es-CL')}).`);
      }
      if (fechaVenc) log(`   📅 Vencimiento según documento: ${fechaVenc}.`);

      try {
        await withRetry(
          async () => {
            // Idempotency: if already in table (from a previous attempt), skip the add.
            if (await isCreditorAlreadyInTable(page, creditorEff.totalCredito, isOtros)) {
              log(`   ℹ️ "${entry.nombre}" ya existe en la tabla — omitiendo add.`);
              return;
            }
            await ensureOnAcreedoresPage(page, log);
            await dismissOpenModal(page).catch(() => {});
            await dismissBlockingDialogs(page, log).catch(() => {});
            const isPersona = entry.tipo?.toLowerCase().includes('persona') === true;
            if (isPersona) {
              await addPersonaAcreedor(page, entry, creditorEff, log, isOtros, fechaVenc);
            } else {
              await addEmpresaAcreedor(page, entry, creditorEff, log, isOtros, fechaVenc);
            }
          },
          {
            attempts: 3,
            delayMs: 4000,
            onRetry: (attempt, err) => {
              log(
                `⚠️ Reintento ${attempt}/2 para "${entry.nombre}": ${err.message.substring(0, 120)}`
              );
            },
          }
        );
        report.added.push({
          institucion: creditor.institucion,
          nombreCatalogo: entry.nombre,
          monto: creditorEff.totalCredito,
        });
        log(`✓ Acreedor agregado: ${entry.nombre} ($${creditorEff.totalCredito.toLocaleString('es-CL')}).`);
        addedDocs.push({ entry, creditor: creditorEff });
      } catch (err) {
        const reason = `Error al agregar en el portal (tras 3 intentos): ${(err as Error).message}`;
        logError(`✗ Falló agregar "${creditor.institucion}" (${entry.nombre}).`, err);
        report.skipped.push({ institucion: creditor.institucion, reason });
        await dismissOpenModal(page).catch(() => {});
      }
    }

    // --- 4a-bis. Add NON-CMF creditors (Phase 1, continued) -----------------
    // Acreedores detectados por el Centinela que NO están en el CMF pero igual
    // deben declararse (Art. 261 — TGR, cajas, fintechs, tarjetas no reportadas).
    // Se agregan con las MISMAS funciones que los del CMF. isOtros sale del
    // artículo que decidió el Centinela. Requieren confirmación del abogado (flag).
    if (additionalCreditors && additionalCreditors.length > 0) {
      log(`→ Acreedores NO-CMF detectados por el Centinela: ${additionalCreditors.length} (requieren confirmación del abogado).`);
      for (const ac of additionalCreditors) {
        const match = matchAcreedor(ac.institucion_cmf, catalog);
        if (match.status !== 'matched' || !match.entry) {
          const reason = match.status === 'ambiguous'
            ? `NO-CMF: múltiples candidatos en el catálogo para "${ac.institucion_cmf}".`
            : `NO-CMF: "${ac.institucion_cmf}" no existe en acreedores_canonicos (sin RUT para el portal).`;
          log(`⏭️  Saltando acreedor NO-CMF "${ac.bank}": ${reason}`);
          report.skipped.push({ institucion: ac.bank, reason });
          continue;
        }
        const entry = match.entry;
        const isOtros = ac.categoria_articulo === 261;
        // Vencimiento real desde el documento (solo aplica a 260; 261 no acredita vencimiento).
        const fechaVenc = ac.categoria_articulo === 260 ? toPortalDate(ac.delinquency_start_date) : undefined;
        // CmfCreditor sintético: monto = total del documento (ya es el monto a declarar).
        const synthCreditor: CmfCreditor = {
          institucion: ac.institucion_cmf,
          tipoCredito: ac.product_type,
          totalCredito: ac.total_credito_clp,
          vigente: ac.categoria_articulo === 261 ? ac.total_credito_clp : 0,
          overdue30to59: 0,
          overdue60to89: 0,
          overdue90Days: ac.categoria_articulo === 260 ? ac.total_credito_clp : 0,
          esIndirecta: false,
        };
        try {
          await withRetry(
            async () => {
              if (await isCreditorAlreadyInTable(page, synthCreditor.totalCredito, isOtros)) {
                log(`   ℹ️ NO-CMF "${entry.nombre}" ya existe en la tabla — omitiendo add.`);
                return;
              }
              await ensureOnAcreedoresPage(page, log);
              await dismissOpenModal(page).catch(() => {});
              await dismissBlockingDialogs(page, log).catch(() => {});
              const isPersona = entry.tipo?.toLowerCase().includes('persona') === true;
              log(`🆕 ACREEDOR NO-CMF (Art. ${ac.categoria_articulo}, requiere confirmación abogado): ${entry.nombre} ($${synthCreditor.totalCredito.toLocaleString('es-CL')}) — ${ac.reason}`);
              if (isPersona) {
                await addPersonaAcreedor(page, entry, synthCreditor, log, isOtros, fechaVenc);
              } else {
                await addEmpresaAcreedor(page, entry, synthCreditor, log, isOtros, fechaVenc);
              }
            },
            {
              attempts: 3,
              delayMs: 4000,
              onRetry: (attempt, err) =>
                log(`⚠️ Reintento ${attempt}/2 para NO-CMF "${entry.nombre}": ${err.message.substring(0, 120)}`),
            }
          );
          report.added.push({
            institucion: `${ac.bank} (NO-CMF)`,
            nombreCatalogo: entry.nombre,
            monto: synthCreditor.totalCredito,
          });
          log(`✓ Acreedor NO-CMF agregado: ${entry.nombre} ($${synthCreditor.totalCredito.toLocaleString('es-CL')}).`);
          addedDocs.push({ entry, creditor: synthCreditor, nonCmfDocFilename: ac.document_filename });
        } catch (err) {
          const reason = `NO-CMF: error al agregar en el portal (tras 3 intentos): ${(err as Error).message}`;
          logError(`✗ Falló agregar acreedor NO-CMF "${ac.bank}" (${entry.nombre}).`, err);
          report.skipped.push({ institucion: ac.bank, reason });
          await dismissOpenModal(page).catch(() => {});
        }
      }
    }

    // --- 4b. Attach acreditacion documents (Phase 2) ------------------------
    // Run only after ALL creditors are in the table (portal enables the button then).
    if (docs.length > 0 && addedDocs.length > 0) {
      log('→ Adjuntando certificados de acreditación...');
      // Documentos reservados a acreedores NO-CMF: se asocian por filename, no por
      // institución, para no cruzarlos con otros productos del mismo banco que sí
      // están en el CMF (ej. el CPF de las tarjetas vs. el consultaCredito del consumo).
      const reservedNonCmfFilenames = new Set(
        (additionalCreditors ?? []).map((a) => a.document_filename).filter(Boolean)
      );
      for (const { entry, creditor, nonCmfDocFilename } of addedDocs) {
        // NO-CMF → matchear el documento exacto por filename.
        // CMF    → matchear por institución, excluyendo los reservados a NO-CMF.
        const creditorDocs = nonCmfDocFilename
          ? docs.filter((d) => d.filename === nonCmfDocFilename)
          : findAcreditacionDocs(creditor.institucion, docs).filter(
              (d) => !d.filename || !reservedNonCmfFilenames.has(d.filename)
            );
        if (nonCmfDocFilename && creditorDocs.length === 0) {
          log(`   ⚠️ Acreedor NO-CMF "${entry.nombre}": no se encontró el documento "${nonCmfDocFilename}" en los mappedDocs (¿el orquestador pobló filename?). No se adjunta.`);
        }
        for (const doc of creditorDocs) {
          if (!doc.local_path) continue;

          const isOtros = creditor.overdue90Days === 0 && !isReclassifiedTo260(creditor);
          if (isOtros && doc.tipo_documento !== 22) {
            log(`   ℹ️ Omitiendo documento tipo ${doc.tipo_documento} para "${creditor.institucion}" porque es Otros Acreedores (morosidad <= 90 días).`);
            continue;
          }

          await withRetry(
            () => attachDocumentoAcreedor(page, doc, creditor.totalCredito, isOtros, log),
            {
              attempts: 2,
              delayMs: 3000,
              onRetry: (attempt, err) =>
                log(
                  `⚠️ Reintento ${attempt}/1 adjuntar doc tipo ${doc.tipo_documento} "${entry.nombre}": ${err.message.substring(0, 100)}`
                ),
            }
          ).catch((err) =>
            log(`⚠️ No se pudo adjuntar documento tipo ${doc.tipo_documento} para "${entry.nombre}": ${(err as Error).message}`)
          );
        }
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
      await dismissOpenModal(page).catch(() => {});
      await dismissBlockingDialogs(page, log).catch(() => {});
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
    await withRetry(
      async () => {
        const urlAntes = page.url();
        await page.locator('#btnContinuar').click();
        log('→ Esperando redirección al Paso 4...');
        await page.waitForFunction(
          (before: string) => window.location.href !== before,
          urlAntes,
          { timeout: 60000 }
        );
      },
      {
        attempts: 3,
        delayMs: 4000,
        onRetry: (attempt, err) =>
          log(`⚠️ Reintento ${attempt}/2 botón Continuar: ${err.message.substring(0, 100)}`),
      }
    );

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
  log: (m: string) => void,
  isOtros: boolean,
  fechaVencimientoOverride?: string
): Promise<void> {
  const rut = normalizeRut(entry.rut);
  if (!rut) throw new Error('El acreedor del catálogo no tiene RUT.');
  const btnSelector = isOtros ? '#btnAgregarEmpresa2' : '#btnAgregarEmpresa';
  log(`→ Abriendo modal Empresa para "${entry.nombre}" (RUT ${rut}) [Otros: ${isOtros}]...`);
  await page.locator(btnSelector).click();
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
    await page.evaluate(() => {
      const el = document.getElementById('empresaNombre');
      if (el) el.removeAttribute('readonly');
    });
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
  if (entry.representante_legal && entry.rut_representante && isValidRut(entry.rut_representante)) {
    await addRepresentante(page, entry, '#agregarRepresentanteLegalEmpresa', log).catch((err) =>
      log(`   ⚠️ No se pudo agregar representante legal: ${(err as Error).message}`)
    );
  } else if (entry.representante_legal) {
    log(`   ⚠️ Omitiendo agregar representante legal "${entry.representante_legal}" porque su RUT "${entry.rut_representante}" no tiene un formato válido.`);
  }

  // Debt amount = "Total del crédito" from the CMF.
  await locByName(page, 'empresaAcreedor.deudaMonto').fill(truncate(String(creditor.totalCredito), MAX.monto));

  // Vencimiento — obligatorio. Usa la fecha real del documento si está disponible,
  // si no, el placeholder de 90 días. Intentamos 3 métodos en cascada.
  const dateStr = fechaVencimientoOverride ?? dateDaysAgo(90);
  await fillDateField(page, '#empresaAcreedorFchCuotaImpaga', dateStr, log);

  // Dismiss any overlay dialog blocking clicks (e.g. #dlgImportante after rep modal closes)
  await dismissBlockingDialogs(page, log);

  // Save
  await page.locator('#btnGuardarEmpresa').click();
  await page.locator('#modalEmpresa').waitFor({ state: 'hidden', timeout: 20000 });

  // Wait for the full page reload/navigation to complete and scripts to stabilize
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
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

  await selectBootstrap(page, 'empresaRegion', regionValue);

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

  await selectBootstrap(page, 'empresaComuna', comunaValue);
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
  // Portal may show #dlgImportante after saving a representative — dismiss it immediately
  await dismissBlockingDialogs(page, log);
  log(`   ✓ Representante legal agregado (${repRut}).`);
}

/** Returns a date N days ago as dd/mm/yyyy. */
function dateDaysAgo(days: number): string {
  // Use Chile timezone so the date is correct regardless of Mac Mini system timezone
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
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

      log(`   🗑️ Eliminando fila de acreedor...`);
      await deleteBtn.click();
      const confirm = page.locator('#btnConfirmarModal');
      await confirm.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(2000);
    }
  }
  log('   🗑️ Acreedores de prueba eliminados (best-effort).');
}

async function cleanupCMF(page: Page, log: (m: string) => void): Promise<void> {
  const deleteSelector = '#btnEliminarCMF';
  if (!(await page.locator(deleteSelector).count())) return;

  log('   🗑️ Eliminando Informe CMF...');
  await page.locator(deleteSelector).click();
  const confirm = page.locator('#btnConfirmarModal');
  await confirm.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
    await page.locator('#dlgConfirmar').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }
  await page.locator(deleteSelector).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  log('   🗑️ Informe CMF eliminado.');
}

/**
 * Opens the "Agregar Persona Natural" modal and fills it for one creditor.
 */
async function addPersonaAcreedor(
  page: Page,
  entry: AcreedorCatalogEntry,
  creditor: CmfCreditor,
  log: (m: string) => void,
  isOtros: boolean,
  fechaVencimientoOverride?: string
): Promise<void> {
  const rut = normalizeRut(entry.rut);
  if (!rut) throw new Error('El acreedor del catálogo no tiene RUT.');
  const btnSelector = isOtros ? '#btnAgregarPersona2' : '#btnAgregarPersona';
  log(`→ Abriendo modal Persona Natural para "${entry.nombre}" (RUT ${rut}) [Otros: ${isOtros}]...`);
  await page.locator(btnSelector).click();
  await page.locator('#modalPersona').waitFor({ state: 'visible', timeout: 15000 });

  await page.locator('#personaRutDv').fill(rut);
  await page.locator('#buscarPersona').click();
  await page.waitForTimeout(2500);

  const nombresFilled = await page.locator('[id="persona.nombres"]').evaluate(
    (el: HTMLInputElement) => el.value.trim().length > 0
  );
  if (!nombresFilled) {
    const { nombres, paterno, materno } = splitName(entry.nombre);
    await page.evaluate(() => {
      const n = document.getElementById('persona.nombres');
      const p = document.getElementById('persona.aPaterno');
      const m = document.getElementById('persona.aMaterno');
      if (n) n.removeAttribute('readonly');
      if (p) p.removeAttribute('readonly');
      if (m) m.removeAttribute('readonly');
    });
    await page.locator('[id="persona.nombres"]').fill(truncate(nombres, 50));
    await page.locator('[id="persona.aPaterno"]').fill(truncate(paterno, 30));
    if (materno) await page.locator('[id="persona.aMaterno"]').fill(truncate(materno, 30));
  }

  await locByName(page, 'personaAcreedor.direccion').fill(truncate(entry.direccion ?? '', MAX.direccion));
  await selectPersonaRegionAndComuna(page, entry, log);
  await locByName(page, 'personaAcreedor.notificacionEmail').fill(truncate(entry.email ?? '', MAX.email));
  await locByName(page, 'personaAcreedor.notificacionTelefono').fill(truncate(entry.telefono ?? '', MAX.telefono));

  if (entry.representante_legal && entry.rut_representante && isValidRut(entry.rut_representante)) {
    await addRepresentante(page, entry, '#agregarRepresentanteLegalPersona', log).catch((err) =>
      log(`   ⚠️ No se pudo agregar representante legal: ${(err as Error).message}`)
    );
  } else if (entry.representante_legal) {
    log(`   ⚠️ Omitiendo agregar representante legal "${entry.representante_legal}" porque su RUT "${entry.rut_representante}" no tiene un formato válido.`);
  }

  await locByName(page, 'personaAcreedor.deudaMonto').fill(truncate(String(creditor.totalCredito), MAX.monto));
  // Vencimiento — obligatorio en el modal real.
  await clearAndFill(page, '#personaFechaCuotaImpaga', fechaVencimientoOverride ?? dateDaysAgo(90));

  await page.locator('#btnGuardarPersona').click();
  await page.locator('#modalPersona').waitFor({ state: 'hidden', timeout: 20000 });

  // Wait for the full page reload/navigation to complete and scripts to stabilize
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
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

  await selectBootstrap(page, 'personaRegion', regionValue);

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

  await selectBootstrap(page, 'personaAcreedorcomuna', comunaValue);
  log(`   ✓ Región (${regionValue}) y comuna ("${entry.comuna}") seleccionadas (persona).`);
}

// ─── Acreditación helpers ────────────────────────────────────────────────────

function normInst(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findAcreditacionDocs(
  institucion: string,
  docs: AcreditacionDoc[]
): AcreditacionDoc[] {
  if (!docs.length) return [];
  const target = normInst(institucion);
  return docs.filter((d) => {
    const n = normInst(d.institucion_cmf);
    return n === target || target.includes(n) || n.includes(target);
  });
}

async function downloadAcreditacionDocs(
  supabase: SupabaseClient,
  docs: AcreditacionDoc[],
  tmpDir: string,
  log: (m: string) => void
): Promise<void> {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (const doc of docs) {
    const ext = path.extname(doc.storage_path) || '.pdf';
    const slug = path.basename(doc.storage_path, ext);
    const localPath = path.join(tmpDir, `${slug}${ext}`);

    if (fs.existsSync(localPath)) {
      doc.local_path = localPath;
      log(`→ Certificado en caché local: ${path.basename(localPath)}`);
      continue;
    }

    log(`→ Descargando certificado "${doc.institucion_cmf}"...`);
    let downloaded: Blob | null = null;
    try {
      downloaded = await withRetry(
        async () => {
          const { data, error } = await supabase.storage.from('documentos').download(doc.storage_path);
          if (error || !data) throw new Error(error?.message ?? 'blob vacío');
          return data;
        },
        {
          attempts: 3,
          delayMs: 2000,
          onRetry: (attempt, err) =>
            log(`⚠️ Reintento ${attempt}/2 descarga "${doc.storage_path}": ${err.message}`),
        }
      );
    } catch (err) {
      log(
        `⚠️ No se pudo descargar "${doc.storage_path}" tras 3 intentos: ${(err as Error).message}`
      );
      continue;
    }
    fs.writeFileSync(localPath, Buffer.from(await downloaded.arrayBuffer()));
    doc.local_path = localPath;
    log(`✓ Descargado: ${path.basename(localPath)}`);
  }
}

/**
 * Opens #modalAdjunto for the most recently added creditor row,
 * sets the file (PDF or JPEG) and tipo, then saves.
 */
async function attachDocumentoAcreedor(
  page: Page,
  doc: AcreditacionDoc,
  monto: number,
  isOtros: boolean,
  log: (m: string) => void
): Promise<void> {
  if (!doc.local_path || !fs.existsSync(doc.local_path)) {
    throw new Error(`Archivo local no disponible: ${doc.local_path ?? '(sin ruta)'}`);
  }

  const tableSelector = isOtros ? '#tablaOtrosAcreedores' : '#tablaAcreedores';

  log(`→ Adjuntando documento tipo ${doc.tipo_documento} de "${doc.institucion_cmf}" (Monto: $${monto.toLocaleString('es-CL')}, Otros: ${isOtros})...`);

  // Wait for the table to have at least one row after the AJAX reload
  await page.locator(`${tableSelector} tbody tr`).first().waitFor({ state: 'visible', timeout: 20000 });

  const rows = page.locator(`${tableSelector} tbody tr`);
  const rowCount = await rows.count();
  let docBtn = null;

  const targetName = normalizeText(doc.institucion_cmf);
  log(`   🔍 Buscando en ${tableSelector} fila con monto $${monto.toLocaleString('es-CL')} para subir tipo ${doc.tipo_documento}...`);

  // First pass: look for a row with matching amount and check if the specific document type is already attached
  for (let i = rowCount - 1; i >= 0; i--) {
    const row = rows.nth(i);
    const cols = row.locator('td');
    const colCount = await cols.count();
    if (colCount < 7) continue;

    const montoText = await cols.nth(2).textContent().catch(() => '');
    const cleanMonto = parseInt(montoText?.replace(/[^0-9]/g, '') ?? '0', 10);

    if (cleanMonto === monto) {
      const docColText = (await cols.nth(5).textContent().catch(() => '')) ?? '';
      const docColTextNorm = normalizeText(docColText);

      let alreadyUploaded = false;
      if (doc.tipo_documento === 22) {
        alreadyUploaded = docColTextNorm.includes('monto') || docColTextNorm.includes('monto y vencimiento') || docColTextNorm.includes('vencimiento y monto');
      } else if (doc.tipo_documento === 23) {
        alreadyUploaded = docColTextNorm.includes('vencimiento') || docColTextNorm.includes('monto y vencimiento') || docColTextNorm.includes('vencimiento y monto');
      } else if (doc.tipo_documento === 24) {
        alreadyUploaded = docColTextNorm.includes('monto y vencimiento') || docColTextNorm.includes('vencimiento y monto') || (docColTextNorm.includes('monto') && docColTextNorm.includes('vencimiento'));
      }

      if (alreadyUploaded) {
        log(`   ℹ️ El documento tipo ${doc.tipo_documento} ya está adjuntado para esta fila (Monto: $${monto.toLocaleString('es-CL')}). Omitiendo upload.`);
        return;
      }

      const btn = cols.nth(5).locator('button, a').filter({ hasText: /subir/i }).first();
      if (await btn.count() > 0) {
        docBtn = btn;
        log(`   ✓ Fila exacta encontrada por monto en índice ${i} de ${tableSelector} para subir tipo ${doc.tipo_documento}.`);
        break;
      }
    }
  }

  // Second pass fallback: generic match using text or col position in the same table
  if (!docBtn) {
    log(`   ⚠️ No se encontró fila exacta por monto. Buscando por botón de subida en ${tableSelector}...`);
    for (let i = rowCount - 1; i >= 0; i--) {
      const byText = rows.nth(i).locator('button, a').filter({ hasText: /subir/i }).first();
      if ((await byText.count()) > 0) {
        docBtn = byText;
        break;
      }
    }
  }

  if (!docBtn) throw new Error(`No se encontró el botón "Subir Documento" en ${tableSelector}.`);

  await docBtn.click();
  await page.locator('#modalAdjunto').waitFor({ state: 'visible', timeout: 10000 });

  // Select tipo documento (bootstrap-select needs a change event)
  await selectBootstrap(page, 'tipoArchivoAdjunto', String(doc.tipo_documento));

  // Set file — Playwright bypasses the accept filter; works for PDF, JPEG, JPG
  await page.locator('#archivoAdjunto').setInputFiles(doc.local_path);
  await page.evaluate(() => {
    const inp = document.querySelector('#archivoAdjunto') as HTMLInputElement | null;
    inp?.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Wait for the guardar button to become enabled
  await page.waitForFunction(
    () => !(document.querySelector('#guardarAdjunto') as HTMLButtonElement | null)?.disabled,
    undefined,
    { timeout: 10000 }
  );

  await page.locator('#guardarAdjunto').click();
  await page.locator('#modalAdjunto').waitFor({ state: 'hidden', timeout: 15000 });

  // Wait for the full page reload/navigation to complete and scripts to stabilize
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);

  log(`✓ Documento adjuntado para "${doc.institucion_cmf}".`);
}

/**
 * Dismisses dialogs that overlay #modalEmpresa and block pointer events.
 * The portal shows #dlgImportante (an informational modal) after saving a
 * representante legal. We must close it before clicking #btnGuardarEmpresa.
 */
async function dismissBlockingDialogs(page: Page, log: (m: string) => void): Promise<void> {
  const blockers = ['#dlgImportante'];
  for (const id of blockers) {
    const dlg = page.locator(`${id}.show`);
    if ((await dlg.count()) === 0) continue;

    const content = await dlg.locator('.modal-body').first().textContent().catch(() => '');
    log(`   ℹ️ Cerrando diálogo bloqueador ${id}: "${content?.trim().substring(0, 120)}"`);

    const btn = dlg.locator('button[data-dismiss="modal"], .btn-close, button.close, .modal-footer button').first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await dlg.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    } else {
      await page.evaluate((dlgId) => {
        const el = document.getElementById(dlgId) as HTMLElement | null;
        if (!el) return;
        el.classList.remove('show');
        (el as HTMLElement).style.display = 'none';
        el.removeAttribute('aria-modal');
        document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
        document.body.classList.remove('modal-open');
      }, id.replace('#', ''));
      log(`   ℹ️ ${id} cerrado vía JS.`);
    }
  }
}

async function dismissOpenModal(page: Page): Promise<void> {
  const closeBtn = page.locator('.modal.show button[data-dismiss="modal"]').first();
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click();
    await page.waitForTimeout(500);
    return;
  }
  // Force-close via jQuery (handles static-backdrop modals like #modalEmpresa)
  await page.evaluate(() => {
    const $ = (window as any).$;
    if ($) $('.modal.show').each((_: unknown, el: HTMLElement) => { $(el).modal('hide'); });
  }).catch(() => {});
  await page.waitForTimeout(800);
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

async function clearAndFill(page: Page, selector: string, value: string): Promise<void> {
  const locator = page.locator(selector);
  await locator.click({ clickCount: 3 });
  await locator.fill(value);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }, selector);
}

/**
 * Sets a date text-input that may be controlled by a jQuery datepicker.
 * Tries (1) jQuery datepicker API, (2) Playwright fill(), (3) pressSequentially.
 */
async function fillDateField(
  page: Page,
  selector: string,
  value: string,
  log: (m: string) => void
): Promise<void> {
  // Method 0: Simple jQuery val()
  const setSimpleVal = await page.evaluate(({ sel, date }) => {
    const $ = (window as any).$;
    if (!$) return false;
    const $el = $(sel);
    if (!$el.length) return false;
    $el.val(date);
    $el.trigger('change');
    return true;
  }, { sel: selector, date: value });

  if (setSimpleVal) {
    const v = await page.locator(selector).inputValue().catch(() => '');
    if (v === value) {
      log(`   ✓ Vencimiento seteado via jQuery val(): "${v}"`);
      return;
    }
  }

  // Method 1: jQuery datepicker setDate
  const setViaJQuery = await page.evaluate(({ sel, date }) => {
    const $ = (window as any).$;
    if (!$) return false;
    const $el = $(sel);
    if (!$el.length) return false;
    try {
      if (typeof $el.datepicker === 'function') {
        $el.datepicker('setDate', date);
        $el.datepicker('update');
        $el.trigger('changeDate').trigger('change');
        return true;
      }
    } catch (_) { /* not a datepicker */ }
    return false;
  }, { sel: selector, date: value });

  if (setViaJQuery) {
    const v = await page.locator(selector).inputValue().catch(() => '');
    if (v) { log(`   ✓ Vencimiento seteado via jQuery datepicker: "${v}"`); return; }
  }

  // Method 2: Playwright fill() with triple-click
  await page.locator(selector).click({ clickCount: 3 });
  await page.locator(selector).fill(value);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }, selector);

  const v2 = await page.locator(selector).inputValue().catch(() => '');
  if (v2) { log(`   ✓ Vencimiento seteado via fill(): "${v2}"`); return; }

  // Method 3: pressSequentially (simulates real keypresses)
  log(`   ⚠️ fill() no funcionó. Intentando pressSequentially...`);
  await page.locator(selector).click({ clickCount: 3 });
  await page.keyboard.press('Delete');
  await page.locator(selector).pressSequentially(value, { delay: 80 });
  await page.locator(selector).dispatchEvent('change');

  const v3 = await page.locator(selector).inputValue().catch(() => '');
  log(`   🔍 Vencimiento tras pressSequentially: "${v3}"`);
}

// ─── Retry / resilience helpers ──────────────────────────────────────────────

/**
 * Retries an async operation up to `attempts` times with linear back-off.
 * If all attempts fail, the last error is re-thrown.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    delayMs?: number;
    onRetry?: (attempt: number, err: Error) => void;
  } = {}
): Promise<T> {
  const { attempts = 3, delayMs = 3000, onRetry } = opts;
  let lastErr: Error = new Error('No attempts made');
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err as Error;
      if (i < attempts) {
        onRetry?.(i, lastErr);
        await new Promise<void>((r) => setTimeout(r, delayMs * i));
      }
    }
  }
  throw lastErr;
}

/**
 * Returns true if a row with exactly `monto` already exists in the target table.
 * Used to skip adding a creditor again after a retry.
 */
async function isCreditorAlreadyInTable(
  page: Page,
  monto: number,
  isOtros: boolean
): Promise<boolean> {
  const tableId = isOtros ? '#tablaOtrosAcreedores' : '#tablaAcreedores';
  const rows = page.locator(`${tableId} tbody tr`);
  const count = await rows.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const cols = rows.nth(i).locator('td');
    const colCount = await cols.count().catch(() => 0);
    if (colCount < 3) continue;
    const montoText = await cols.nth(2).textContent().catch(() => '');
    const cleanMonto = parseInt(montoText?.replace(/[^0-9]/g, '') ?? '0', 10);
    if (cleanMonto === monto) return true;
  }
  return false;
}

/**
 * Verifies we are still on the verAcreedores page.
 * Navigates back if we drifted (e.g. after an unexpected redirect).
 * Throws if the session appears to have expired.
 */
async function ensureOnAcreedoresPage(page: Page, log: (m: string) => void): Promise<void> {
  const url = page.url();
  if (url.includes('login') || url.includes('claveunica') || url.includes('acceso')) {
    throw new Error(`Sesión expirada — redirigido a: ${url}`);
  }
  if (!url.includes('verAcreedores') && !url.includes('acreedores')) {
    log(`⚠️ URL inesperada (${url}). Renavegando a verAcreedores...`);
    const base = new URL(url).origin;
    await page.goto(`${base}/miSuperir/autenticado/renegociacion/verAcreedores`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#acreedoresRenegociacionForm', { timeout: 20000 });
    await page.waitForTimeout(2000);
  }
}

async function selectBootstrap(page: Page, selectId: string, value: string): Promise<void> {
  await page.locator(`#${selectId}`).selectOption(value);
  await page.evaluate(({ id, val }) => {
    // @ts-ignore
    const $ = window.$;
    if ($ && $(`#${id}`).hasClass('selectpicker')) {
      // @ts-ignore
      $(`#${id}`).selectpicker('val', val);
      // @ts-ignore
      $(`#${id}`).selectpicker('refresh');
      // @ts-ignore
      $(`#${id}`).trigger('change');
    } else {
      const el = document.getElementById(id);
      if (el) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, { id: selectId, val: value });
  await page.waitForTimeout(300);
}

/**
 * Scans a certificate PDF for Chilean RUTs, filters out the client's RUT,
 * and checks if any remaining RUT matches a canonical creditor in the catalog.
 */
async function detectCreditorRutFromDoc(
  pdfPath: string,
  clientRut: string | null,
  catalog: AcreedorCatalogEntry[],
  log: (m: string) => void
): Promise<AcreedorCatalogEntry | null> {
  try {
    const text = await extractTextFromPdf(pdfPath);
    const ruts = extractRutsFromText(text);
    return findCatalogEntryByRut(ruts, catalog, clientRut);
  } catch (err) {
    log(`   ⚠️ Error al intentar extraer RUT del certificado ${path.basename(pdfPath)}: ${(err as Error).message}`);
  }
  return null;
}

