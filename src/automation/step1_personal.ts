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

export interface ClientData {
  nacionalidad: string;
  fecha_nacimiento: string;
  estado_civil: string;
  regimen_patrimonial?: string | null;
  profesion_oficio: string;
  ocupacion: string;
  direccion: string;
  region: string;
  comuna: string;
  email: string;
  telefono_prefijo: string;
  telefono: string;
}

function validateClientData(client: ClientData): void {
  const required: (keyof ClientData)[] = [
    'nacionalidad',
    'fecha_nacimiento',
    'estado_civil',
    'profesion_oficio',
    'ocupacion',
    'direccion',
    'region',
    'comuna',
    'email',
    'telefono_prefijo',
    'telefono',
  ];
  const missing = required.filter((k) => !client[k]);
  if (missing.length > 0) {
    throw new Error(`Faltan campos requeridos en los datos del cliente: ${missing.join(', ')}`);
  }
}

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

export async function fillStep1(page: Page, client: ClientData, logger?: SimpleLogger): Promise<void> {
  const log = (msg: string) => {
    if (logger) {
      logger.log(msg);
    } else {
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
      console.log(`[${ts}] ${msg}`);
    }
  };
  validateClientData(client);

  try {
    await page.waitForSelector('#renegociacionForm', { timeout: 30000 });
    if (!page.url().includes('renegociacion')) {
      throw new Error(`URL inesperada para Paso 1: ${page.url()}`);
    }

    // Dar tiempo a que los scripts de inicialización de la página (jQuery document.ready)
    // se ejecuten y configuren los estados de deshabilitado y botones de edición.
    log('→ Esperando estabilización de scripts en la página...');
    await page.waitForTimeout(3000);

    // Esperar a que el campo nacionalidad esté cargado en la página
    await page.waitForSelector('#personaNacionalidad', { timeout: 15000 });

    // Si el formulario tiene datos guardados, los campos aparecen deshabilitados
    // en modo vista. Hay que clickear "Modificar Información" para desbloquearlo.
    // Usamos page.evaluate para evaluar el estado real del DOM, ya que Bootstrap Select
    // oculta los inputs nativos con display:none, lo que hace que Playwright .isVisible() retorne false.
    const isViewMode = await page.evaluate(() => {
      const el = document.getElementById('personaNacionalidad') as HTMLInputElement;
      const btnModificar = document.getElementById('btnModificar');
      const fieldDisabled = el ? el.disabled || el.hasAttribute('disabled') : false;
      const btnVisible = btnModificar ? !btnModificar.classList.contains('hidden') && btnModificar.style.display !== 'none' : false;
      return fieldDisabled || btnVisible;
    });

    if (isViewMode) {
      log('→ Formulario en modo vista (detectado vía DOM). Clickeando Modificar Información...');
      await page.locator('#btnModificar').click();
      
      // Esperar a que se elimine el atributo disabled de la página
      await page.waitForFunction(() => {
        const el = document.getElementById('personaNacionalidad') as HTMLInputElement;
        return el ? !el.disabled && !el.hasAttribute('disabled') : false;
      }, { timeout: 15000 });

      log('→ Campos desbloqueados.');
    }

    log('→ Rellenando Paso 1 - Información Personal...');

    // Nombres, apellidos y género son completados automáticamente por el portal
    // a partir del RUT (Registro Civil vía ClaveÚnica). No se tocan.

    // --- Campos de texto ---
    await clearAndFill(page, '#personaNacionalidad', client.nacionalidad);

    // Check if birthdate is editable before filling it
    const isFechaNacimientoEditable = await page.evaluate(() => {
      const el = document.getElementById('personaFechaNacimiento') as HTMLInputElement;
      return el ? !el.disabled && !el.readOnly : false;
    });

    if (isFechaNacimientoEditable && client.fecha_nacimiento && client.fecha_nacimiento !== '01/01/1990') {
      log('→ Completando Fecha de Nacimiento (campo es editable)...');
      await clearAndFill(page, '#personaFechaNacimiento', client.fecha_nacimiento);
    } else {
      log('→ Campo Fecha de Nacimiento omitido (pre-llenado automáticamente por el portal o sin valor válido).');
    }

    // --- Dropdowns Bootstrap Select ---
    const estadoCivil = client.estado_civil;
    await selectBootstrap(page, 'personaEstadoCivil', estadoCivil);

    // Régimen Patrimonial solo aparece si Estado Civil = Casado(a) (valor "2")
    if (estadoCivil === '2' && client.regimen_patrimonial) {
      await page.waitForSelector('#rowRegimenPatrimonial:not(.hidden)', { timeout: 5000 });
      await selectBootstrap(page, 'personaRegimenPatrimonial', client.regimen_patrimonial);
    }

    await selectBootstrap(page, 'personaProfesionOficio', client.profesion_oficio);
    await selectBootstrap(page, 'personaOcupacion', client.ocupacion);

    // --- Dirección ---
    await clearAndFill(page, '#personaDireccion', client.direccion);

    // Región primero, luego esperar que el dropdown de comunas se pueble vía AJAX
    await selectBootstrap(page, 'personaRegion', client.region);
    await page.waitForFunction(
      () => {
        const el = document.getElementById('personaComuna') as HTMLSelectElement;
        return el !== null && el.options.length > 1;
      },
      { timeout: 10000 }
    );
    await selectBootstrap(page, 'personaComuna', client.comuna);

    // --- Contacto ---
    await clearAndFill(page, '#personaCorreoElectronico', client.email);
    await selectBootstrap(page, 'personaTelefonoPrefijo', client.telefono_prefijo);
    await clearAndFill(page, '#personaTelefono', client.telefono);

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

    const urlAntes = page.url();
    await page.locator('button[onclick*="guardarYContinuar"]').click();

    // Esperar a que el modal HTML de confirmación aparezca y hacer click en "Guardar" (onclick="confirmar()")
    log('→ Esperando modal de confirmación HTML...');
    const btnConfirmar = page.locator('button[onclick="confirmar()"]');
    await btnConfirmar.waitFor({ state: 'visible', timeout: 15000 });
    await btnConfirmar.click();

    log('→ Esperando redirección al Paso 2...');
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
