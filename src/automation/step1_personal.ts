import { Page } from 'playwright';
import { screenshotOnFailure } from '../utils/browser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Clears a text input completely and types the new value.
 * Triple-click selects all existing content before fill() replaces it.
 */
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
 * Bootstrap Select wraps native <select> elements with a custom UI.
 * selectOption() replaces the current selection and dispatches a change event
 * so Bootstrap Select updates its display.
 */
async function selectBootstrap(page: Page, selectId: string, value: string): Promise<void> {
  // BUG-16 FIX: Use jQuery selectpicker API when available, falling back to native.
  // The portal uses Bootstrap Select which replaces <select> with a custom widget.
  await page.locator(`#${selectId}`).selectOption(value);
  await page.evaluate((id) => {
    const $ = (window as any).jQuery || (window as any).$;
    const el = document.getElementById(id) as HTMLSelectElement;
    if ($ && $(el).selectpicker) {
      $(el).selectpicker('val', el.value);
      $(el).selectpicker('refresh');
      $(el).trigger('change');
    } else if (el) {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
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

function validateClientData(client: ClientData, warn: (m: string) => void): void {
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

  // BUG-20 FIX: Validate regimen_patrimonial for married clients (estado_civil === '2')
  if (client.estado_civil === '2' && !client.regimen_patrimonial) {
    throw new Error('El cliente está casado/a (estado_civil=2) pero no tiene regimen_patrimonial definido en Supabase. El portal requiere este campo para clientes casados.');
  }

  // BUG-19 FIX: Warn explicitly when fecha_nacimiento was substituted with fallback
  if (client.fecha_nacimiento === '01/01/1990') {
    // Por el logger (no console.warn): así queda en el error_log del job y el abogado lo ve.
    warn('⚠️ ADVERTENCIA: fecha_nacimiento tiene valor de fallback "01/01/1990". Es posible que el dato no exista en la ficha del cliente.');
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
  validateClientData(client, log);

  page.once('console', msg => log(`[PAGE CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.once('pageerror', err => log(`[PAGE ERROR] ${err.message}\n${err.stack}`));

  try {
    await page.waitForSelector('#deudorForm', { timeout: 30000 });
    if (!page.url().includes('renegociacion')) {
      throw new Error(`URL inesperada para Paso 1: ${page.url()}`);
    }

    // Dar tiempo a que los scripts de inicialización de la página (jQuery document.ready)
    // se ejecuten y configuren los estados de deshabilitado y botones de edición.
    log('→ Esperando estabilización de scripts en la página...');
    await page.waitForTimeout(3000);

    // Esperar a que el campo nacionalidad esté cargado en la página
    await page.waitForSelector('#nacionalidad', { timeout: 15000 });

    // Si el formulario tiene datos guardados, los campos aparecen deshabilitados
    // en modo vista. Hay que clickear "Modificar Información" para desbloquearlo.
    // Usamos page.evaluate para evaluar el estado real del DOM, ya que Bootstrap Select
    // oculta los inputs nativos con display:none, lo que hace que Playwright .isVisible() retorne false.
    const isViewMode = await page.evaluate(() => {
      const el = document.getElementById('nacionalidad') as HTMLInputElement;
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
        const el = document.getElementById('nacionalidad') as HTMLInputElement;
        return el ? !el.disabled && !el.hasAttribute('disabled') : false;
      }, { timeout: 15000 });

      log('→ Campos desbloqueados.');
    }

    log('→ Rellenando Paso 1 - Información Personal...');

    // Nombres, apellidos y género son completados automáticamente por el portal
    // a partir del RUT (Registro Civil vía ClaveÚnica). No se tocan.

    // --- Campos de texto ---
    await clearAndFill(page, '#nacionalidad', client.nacionalidad);

    // Check if birthdate is editable before filling it
    const isFechaNacimientoEditable = await page.evaluate(() => {
      const el = document.getElementById('fchNacimiento') as HTMLInputElement;
      return el ? !el.disabled && !el.readOnly : false;
    });

    // El portal PRE-LLENA la fecha de nacimiento desde el Registro Civil. Si ya trae un valor,
    // ese dato manda: pisarlo con el de `clients` (cargado a mano, en formato ambiguo) podía
    // declarar el 3 de septiembre en vez del 9 de marzo, sin ninguna alerta.
    const fechaNacPortal = (await page.inputValue('#fchNacimiento').catch(() => '')).trim();
    if (fechaNacPortal) {
      const mismaFecha = client.fecha_nacimiento
        ? fechaNacPortal.replace(/[^0-9]/g, '') === String(client.fecha_nacimiento).replace(/[^0-9]/g, '')
        : true;
      log(`→ Fecha de Nacimiento ya cargada por el portal (Registro Civil): ${fechaNacPortal} — se respeta.`);
      if (!mismaFecha) {
        log(`⚠️ La fecha de nacimiento de la ficha (${client.fecha_nacimiento}) NO coincide con la del portal (${fechaNacPortal}). Se usa la del portal; revisá la ficha del cliente.`);
      }
    } else if (isFechaNacimientoEditable && client.fecha_nacimiento && client.fecha_nacimiento !== '01/01/1990') {
      log('→ Completando Fecha de Nacimiento (campo es editable)...');
      
      let dateValue = client.fecha_nacimiento;
      const inputType = await page.evaluate(() => {
        const el = document.getElementById('fchNacimiento') as HTMLInputElement;
        return el ? el.type : 'text';
      });

      // Parse DD/MM/YYYY or YYYY-MM-DD
      let day = '', month = '', year = '';
      if (dateValue.includes('/')) {
        const parts = dateValue.split('/');
        if (parts.length === 3) {
          if (parts[0].length === 4) { // YYYY/MM/DD
            [year, month, day] = parts;
          } else { // DD/MM/YYYY
            [day, month, year] = parts;
          }
        }
      } else if (dateValue.includes('-')) {
        const parts = dateValue.split('-');
        if (parts.length === 3) {
          if (parts[0].length === 4) { // YYYY-MM-DD
            [year, month, day] = parts;
          } else { // DD-MM-YYYY
            [day, month, year] = parts;
          }
        }
      }

      if (day && month && year) {
        const dd = day.padStart(2, '0');
        const mm = month.padStart(2, '0');
        const yyyy = year;
        
        if (inputType === 'date') {
          dateValue = `${yyyy}-${mm}-${dd}`;
        } else {
          dateValue = `${dd}/${mm}/${yyyy}`;
        }
        log(`→ Fecha formateada para input de tipo "${inputType}": ${dateValue}`);
      }

      await clearAndFill(page, '#fchNacimiento', dateValue);

      if (inputType !== 'date') {
        log('→ Seteando fecha de nacimiento en el widget bootstrap-datepicker...');
        const datepickerUpdated = await page.evaluate((val) => {
          const $el = (window as any).jQuery ? (window as any).jQuery('#fchNacimiento') : null;
          if ($el && typeof $el.datepicker === 'function') {
            $el.datepicker('setDate', val);
            return true;
          }
          return false;
        }, dateValue);
        log(`→ ¿Datepicker de Bootstrap actualizado? ${datepickerUpdated ? 'SÍ' : 'NO'}`);
      }
    } else {
      log('→ Campo Fecha de Nacimiento omitido (pre-llenado automáticamente por el portal o sin valor válido).');
    }

    // --- Dropdowns Bootstrap Select ---
    const estadoCivil = client.estado_civil;
    await selectBootstrap(page, 'estadoCivil', estadoCivil);

    // Régimen Patrimonial solo aparece si Estado Civil = Casado(a) (valor "2")
    if (estadoCivil === '2' && client.regimen_patrimonial) {
      await page.waitForSelector('#rowRegimenPatrimonial:not(.hidden)', { timeout: 5000 });
      await selectBootstrap(page, 'regimenPatrimonial', client.regimen_patrimonial);
    }

    await selectBootstrap(page, 'profesionOficio', client.profesion_oficio);
    await selectBootstrap(page, 'ocupacion', client.ocupacion);

    // --- Dirección ---
    await clearAndFill(page, '#direccion', client.direccion);

    // Región primero, luego esperar que el dropdown de comunas se pueble vía AJAX
    await selectBootstrap(page, 'region', client.region);
    await page.waitForFunction(
      () => {
        const el = document.getElementById('comuna') as HTMLSelectElement;
        return el !== null && el.options.length > 1;
      },
      { timeout: 10000 }
    );
    await selectBootstrap(page, 'comuna', client.comuna);

    // --- Contacto ---
    await clearAndFill(page, '#email', client.email);
    await selectBootstrap(page, 'prefijo', client.telefono_prefijo);
    await clearAndFill(page, '#telefono', client.telefono);

    log('✓ Todos los campos completados.');

    const dryRun = process.env.DRY_RUN !== 'false';
    if (dryRun) {
      const outputDir = path.join(process.cwd(), 'outputs');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const screenshotPath = path.join(outputDir, `verify_step1_${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`📸 Screenshot de verificación: ${screenshotPath}`);
      log('⚠️  DRY_RUN=true: formulario NO guardado. Cambiá a DRY_RUN=false en .env para producción.');
      return;
    }

    if (process.env.DEBUG === 'true') {
      // Diagnosticar validación antes de clickear
      const validationDiag = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input.obligatorio, select.obligatorio, textarea.obligatorio'));
        return inputs.map(el => {
          const id = el.id;
          const val = (el as any).value;
          const isSelectpicker = el.classList.contains('selectpicker');
          let selectpickerVal = null;
          if (isSelectpicker && (window as any).$) {
            selectpickerVal = (window as any).$(el).selectpicker('val');
          }
          return {
            id,
            tagName: el.tagName,
            classes: el.className,
            value: val,
            selectpickerVal,
            isDisabled: (el as any).disabled
          };
        });
      });
      log(`🔍 DIAGNÓSTICO DE CAMPOS OBLIGATORIOS: ${JSON.stringify(validationDiag, null, 2)}`);

      // Fetch and search validationUtils.js and util.js for sanitizaInputNumber
      const validationScripts = await page.evaluate(async () => {
        const fetchScript = async (url: string) => {
          try {
            const res = await fetch(url);
            return await res.text();
          } catch (e: any) {
            return `Error fetching ${url}: ${e.message}`;
          }
        };
        const validationUtils = await fetchScript('/miSuperir/resources/js/util/validationUtils.js?v=2');
        const util = await fetchScript('/miSuperir/resources/js/util/util.js?v=2');
        
        const findFunc = (text: string, name: string) => {
          const idx = text.indexOf(name);
          if (idx === -1) return `${name} not found`;
          return text.substring(idx - 100, idx + 1000);
        };
        
        return {
          sanitizaInUtils: findFunc(validationUtils, 'sanitizaInputNumber'),
          sanitizaInUtil: findFunc(util, 'sanitizaInputNumber'),
          validarFormInUtils: findFunc(validationUtils, 'validarFormObligatorio'),
          validarFormInUtil: findFunc(util, 'validarFormObligatorio'),
        };
      });
      log(`🔍 VALIDATION SCRIPTS CLIPPINGS: ${JSON.stringify(validationScripts, null, 2)}`);
    }

    // --- PRODUCCIÓN: guardar y continuar al Paso 2 ---
    log('→ Guardando y continuando al Paso 2...');

    const urlAntes = page.url();
    // .first() evita strict-mode violation si el onclick matchea más de un botón.
    const btnGuardarYContinuar = page.locator('button[onclick*="guardarYContinuar"]').first();
    const btnGuardar = page.locator('#btnGuardar');
    if (await btnGuardarYContinuar.isVisible().catch(() => false)) {
      log('→ Clickeando botón guardarYContinuar...');
      await btnGuardarYContinuar.click();
    } else {
      log('→ Botón guardarYContinuar no visible. Clickeando #btnGuardar...');
      await btnGuardar.click();
    }

    // v6.0.2: el modal de confirmación es #confirmarInformacionModal y su botón de confirmar es
    // #btnConfirmar ("Guardar", btn-success). El selector viejo (#btnConfirmarModal / onclick="confirmar()")
    // ya no matchea, y 5s era corto (tras re-llenar en modo "Modificar" el modal tarda >5s en aparecer)
    // → el guardado caía a un fallback (form.submit + openProcesandoSolicitud) que dejaba la página
    // colgada en "procesando". Verificado contra el portal real (2026-07-24): #btnConfirmar + espera 15s.
    log('→ Esperando modal de confirmación HTML...');
    await page.waitForTimeout(2500);
    // Diagnóstico: si el form quedó inválido tras re-llenar, el modal NO se abre. Log de la validación visible.
    const vErrs: string[] = await page.evaluate(() => {
      const vis = (el: Element) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null; };
      return Array.from(document.querySelectorAll('.invalid-feedback,.error,.text-danger,.help-block,label.error,span.error'))
        .filter((e) => vis(e) && (e.textContent || '').trim())
        .map((e) => { const grp = e.closest('.form-group,.form-row,.row,div'); const fld = (grp?.querySelector('input,select,textarea') as HTMLElement)?.id || ''; return `${fld || '?'}: ${(e.textContent || '').trim()}`; })
        .slice(0, 15);
    });
    if (vErrs.length) log(`   ⚠️ validación visible tras guardarYContinuar: ${JSON.stringify(vErrs)}`);
    const selectorConfirmar = '#btnConfirmar, #confirmarInformacionModal button.btn-success, button[onclick="confirmar()"], #btnConfirmarModal';
    const modalBtn = page.locator(selectorConfirmar).filter({ visible: true }).first();
    try {
      await modalBtn.waitFor({ state: 'visible', timeout: 15000 });
      log('→ Modal de confirmación visible. Click en "Guardar"...');
      await modalBtn.click();
    } catch {
      throw new Error(`El modal de confirmación del Paso 1 (#confirmarInformacionModal) no se abrió. Validación visible: ${vErrs.length ? JSON.stringify(vErrs) : 'ninguna detectada'}`);
    }

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
    if (logger) logger.error('✗ Error en Paso 1.', error);
    else console.error(`[${new Date().toISOString()}] ✗ Error en Paso 1.`, error);
    await screenshotOnFailure(page, 'step1');
    throw error;
  }
}
