import { Page } from 'playwright';
import { screenshotOnFailure } from '../utils/browser';
import * as fs from 'fs';
import * as path from 'path';

function log(msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  console.log(`[${ts}] ${msg}`);
}

/**
 * Clears a text input completely and types the new value.
 * Triple-click selects all existing content before fill() replaces it.
 */
async function clearAndFill(page: Page, selector: string, value: string): Promise<void> {
  const locator = page.locator(selector);
  await locator.click({ clickCount: 3 });
  await locator.fill(value);
}

/**
 * Bootstrap Select wraps native <select> elements with a custom UI.
 * selectOption() replaces the current selection and dispatches a change event
 * so Bootstrap Select updates its display.
 */
async function selectBootstrap(page: Page, selectId: string, value: string): Promise<void> {
  await page.locator(`#${selectId}`).selectOption(value);
  await page.evaluate((id) => {
    const el = document.getElementById(id) as HTMLSelectElement;
    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selectId);
  await page.waitForTimeout(200);
}

function validateEnv(): void {
  const required = [
    'PERSONA_NACIONALIDAD',
    'PERSONA_FECHA_NACIMIENTO',
    'PERSONA_ESTADO_CIVIL',
    'PERSONA_PROFESION_OFICIO',
    'PERSONA_OCUPACION',
    'PERSONA_DIRECCION',
    'PERSONA_REGION',
    'PERSONA_COMUNA',
    'PERSONA_EMAIL',
    'PERSONA_TELEFONO_PREFIJO',
    'PERSONA_TELEFONO',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables en .env: ${missing.join(', ')}`);
  }
}

export async function fillStep1(page: Page): Promise<void> {
  validateEnv();

  try {
    await page.waitForSelector('#renegociacionForm', { timeout: 30000 });
    if (!page.url().includes('renegociacion')) {
      throw new Error(`URL inesperada para Paso 1: ${page.url()}`);
    }

    // Si el formulario tiene datos guardados, los campos aparecen deshabilitados
    // en modo vista. Hay que clickear "Modificar Información" para desbloquearlo.
    const campoDeshabilitado = await page.locator('#personaNacionalidad[disabled], #personaNacionalidad:disabled').isVisible({ timeout: 2000 }).catch(() => false);
    if (campoDeshabilitado) {
      log('→ Formulario en modo vista. Clickeando Modificar Información...');
      await page.locator('#btnModificar').click();
      await page.waitForSelector('#personaNacionalidad:not([disabled])', { timeout: 15000 });
      log('→ Campos desbloqueados.');
    }

    log('→ Rellenando Paso 1 - Información Personal...');

    // Nombres, apellidos y género son completados automáticamente por el portal
    // a partir del RUT (Registro Civil vía ClaveÚnica). No se tocan.

    // --- Campos de texto ---
    await clearAndFill(page, '#personaNacionalidad', process.env.PERSONA_NACIONALIDAD!);
    await clearAndFill(page, '#personaFechaNacimiento', process.env.PERSONA_FECHA_NACIMIENTO!);

    // --- Dropdowns Bootstrap Select ---
    const estadoCivil = process.env.PERSONA_ESTADO_CIVIL!;
    await selectBootstrap(page, 'personaEstadoCivil', estadoCivil);

    // Régimen Patrimonial solo aparece si Estado Civil = Casado(a) (valor "2")
    if (estadoCivil === '2' && process.env.PERSONA_REGIMEN_PATRIMONIAL) {
      await page.waitForSelector('#rowRegimenPatrimonial:not(.hidden)', { timeout: 5000 });
      await selectBootstrap(page, 'personaRegimenPatrimonial', process.env.PERSONA_REGIMEN_PATRIMONIAL);
    }

    await selectBootstrap(page, 'personaProfesionOficio', process.env.PERSONA_PROFESION_OFICIO!);
    await selectBootstrap(page, 'personaOcupacion', process.env.PERSONA_OCUPACION!);

    // --- Dirección ---
    await clearAndFill(page, '#personaDireccion', process.env.PERSONA_DIRECCION!);

    // Región primero, luego esperar que el dropdown de comunas se pueble vía AJAX
    await selectBootstrap(page, 'personaRegion', process.env.PERSONA_REGION!);
    await page.waitForFunction(
      () => {
        const el = document.getElementById('personaComuna') as HTMLSelectElement;
        return el !== null && el.options.length > 1;
      },
      { timeout: 10000 }
    );
    await selectBootstrap(page, 'personaComuna', process.env.PERSONA_COMUNA!);

    // --- Contacto ---
    await clearAndFill(page, '#personaCorreoElectronico', process.env.PERSONA_EMAIL!);
    await selectBootstrap(page, 'personaTelefonoPrefijo', process.env.PERSONA_TELEFONO_PREFIJO!);
    await clearAndFill(page, '#personaTelefono', process.env.PERSONA_TELEFONO!);

    log('✓ Todos los campos completados.');

    const dryRun = process.env.DRY_RUN !== 'false';
    if (dryRun) {
      const screenshotPath = `outputs/verify_step1_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`📸 Screenshot de verificación: ${screenshotPath}`);
      log('⚠️  DRY_RUN=true: formulario NO guardado. Cambiá a DRY_RUN=false en .env para producción.');
      return;
    }

    // --- PRODUCCIÓN: guardar y continuar al Paso 2 ---
    log('→ Guardando y continuando al Paso 2...');

    // El portal muestra un modal de confirmación (onclick="confirmar()") al guardar.
    // Hay que aceptarlo automáticamente.
    page.once('dialog', (dialog) => {
      log(`→ Alerta del browser: "${dialog.message()}" → aceptando.`);
      dialog.accept();
    });

    const urlAntes = page.url();
    await page.locator('button[onclick*="guardarYContinuar"]').click();

    await page.waitForFunction(
      (before: string) => window.location.href !== before,
      urlAntes,
      { timeout: 60000 }
    );

    // Guardar screenshot de éxito del Paso 2 cargado
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const successPath = path.join(outputDir, 'step1_success.png');
    await page.screenshot({ path: successPath, fullPage: true });
    log(`✓ Paso 1 completado. Captura de éxito guardada en: ${successPath}`);
    log(`→ Nueva URL: ${page.url()}`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ✗ Error en Paso 1.`);
    await screenshotOnFailure(page, 'step1');
    throw error;
  }
}
