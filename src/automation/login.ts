import { Page } from 'playwright';
import { screenshotOnFailure } from '../utils/browser';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

export class CredentialError extends Error {
  constructor(
    message: string,
    public readonly code: 'rut_incorrecto' | 'clave_unica_incorrecta' | 'riesgo_bloqueo' | 'usuario_bloqueado'
  ) {
    super(message);
    this.name = 'CredentialError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Detecta un bloqueo REAL de la cuenta de ClaveÚnica y devuelve el texto del aviso (o null).
 *
 * Busca FRASES (no palabras sueltas) y SOLO dentro de los contenedores de error de la página.
 * El chequeo anterior corría un `includes('bloque'|'intentos'|'limite'…)` sobre el innerText
 * completo del body: los links permanentes de ClaveÚnica ("desbloquear tu cuenta", "¿cuántos
 * intentos tengo?") lo activaban y cualquier cliente quedaba marcado como bloqueado.
 */
async function detectAccountLockout(page: Page): Promise<string | null> {
  const LOCKOUT_PHRASES = [
    /cuenta\s+(ha\s+sido\s+)?(temporalmente\s+)?bloquead/i,
    /usuario\s+bloquead/i,
    /clave\s*[úu]nica\s+bloquead/i,
    /te\s+quedan\s+\d+\s+intentos/i,
    /(superaste|excediste|super[oó])\s+.{0,30}(intentos|l[íi]mite)/i,
    /demasiados\s+intentos/i,
    /cuenta\s+(suspendida|inhabilitada)/i,
  ];
  const containers = page.locator('.alert, [role="alert"], .error, .msg-error, #error, .form-error');
  const n = await containers.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const raw = ((await containers.nth(i).innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    if (LOCKOUT_PHRASES.some((re) => re.test(raw))) return raw.substring(0, 350);
  }
  return null;
}

export async function loginAndNavigateToStep1(
  page: Page,
  rut: string,
  password: string,
  logger?: SimpleLogger,
  clientDetails?: {
    region: string;
    comuna: string;
    email: string;
    telefono: string;
  }
): Promise<void> {
  const log = (msg: string) => {
    if (logger) {
      logger.log(msg);
    } else {
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
      console.log(`[${ts}] ${msg}`);
    }
  };
  if (!rut || !password) {
    throw new Error('RUT o contraseña vacíos');
  }

  try {
    log('→ Navegando a superir.gob.cl...');
    await page.goto('https://www.superir.gob.cl/', { waitUntil: 'domcontentloaded' });

    const popup = page.locator('[data-dismiss="modal"]').first();
    // isVisible() no acepta timeout (resuelve inmediato); waitFor sí espera al pop-up.
    const popupVisible = await popup.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (popupVisible) {
      await popup.click();
      log('→ Pop-up cerrado.');
      await page.waitForTimeout(500);
    }

    log('→ Haciendo click en INGRESAR de Portal Mi Superir...');
    await page.locator('a[href*="claveunica.gob.cl"]').first().click();

    log('→ Esperando formulario de ClaveÚnica...');
    await page.waitForSelector('#uname', { timeout: 30000 });

    // Bloqueo REAL de la cuenta, por FRASE y dentro del contenedor de error — no por
    // substrings ('intentos', 'bloque', 'limite') sobre el innerText de toda la página: los
    // links de recuperación de ClaveÚnica ("¿olvidaste tu clave?", "desbloquear cuenta")
    // contienen esas palabras y bloqueaban a TODOS los clientes sin un solo intento.
    const preLockoutMsg = await detectAccountLockout(page);
    if (preLockoutMsg) {
      const msg = `ALERTA DE BLOQUEO PREVIA DETECTADA: "${preLockoutMsg}"`;
      log(`❌ ${msg}`);
      throw new CredentialError(msg, 'usuario_bloqueado');
    }

    log('→ Ingresando credenciales...');
    
    // Rellenar RUT simulando escritura para gatillar eventos de formateador (jQuery.rut)
    await page.locator('#uname').click();
    await page.locator('#uname').focus();
    await page.keyboard.press('Meta+A'); // Limpiar en Mac
    await page.keyboard.press('Control+A'); // Limpiar en Windows/Linux
    await page.keyboard.press('Backspace');
    await page.keyboard.type(rut, { delay: 60 });
    await page.keyboard.press('Tab'); // Salir del campo para disparar 'change/blur'

    // Rellenar Contraseña
    await page.locator('#pword').click();
    await page.locator('#pword').focus();
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(password, { delay: 60 });
    await page.keyboard.press('Tab');

    // Desenfocar los campos haciendo click en el fondo para validar el formulario
    await page.locator('body').click({ position: { x: 0, y: 0 } });
    await page.waitForTimeout(500);

    // reCAPTCHA Enterprise puede habilitar el botón automáticamente (score-based).
    // Si no pasa en 8s, espera hasta 2 min imprimiendo progreso para que el usuario
    // sepa que debe resolver el captcha en el browser visible.
    const botonHabilitado = await page.waitForSelector(
      '#login-submit:not([disabled])',
      { timeout: 8000 }
    ).then(() => true).catch(() => false);

    if (!botonHabilitado) {
      // Inyectar banner visible en el browser para guiar al usuario
      await page.evaluate(() => {
        const div = document.createElement('div');
        div.id = '__automate_banner';
        div.style.cssText = [
          'position:fixed', 'top:16px', 'right:16px', 'z-index:99999',
          'background:#e85d04', 'color:#fff', 'padding:16px 20px',
          'border-radius:10px', 'font-size:15px', 'font-weight:bold',
          'box-shadow:0 4px 16px rgba(0,0,0,0.4)', 'max-width:280px',
          'line-height:1.5',
        ].join(';');
        div.innerHTML = '🤖 SCRIPT EN PAUSA<br><br>'
          + '➡ Hacé click en<br><b>"No soy un robot"</b><br><br>'
          + 'El script continúa solo<br>cuando el botón se habilite.';
        document.body.appendChild(div);
      });

      log('⚠️  reCAPTCHA bloqueó el botón INGRESAR.');
      log('   → En el BROWSER: hacé click en "No soy un robot".');
      log('   → El script continúa automáticamente (máx. 2 min).');

      let elapsed = 0;
      const timer = setInterval(() => {
        elapsed += 5;
        log(`   ⏳ Esperando reCAPTCHA... ${elapsed}s`);
      }, 5000);

      try {
        await page.waitForSelector('#login-submit:not([disabled])', { timeout: 120000 });
      } finally {
        clearInterval(timer);
        await page.evaluate(() => {
          document.getElementById('__automate_banner')?.remove();
        }).catch(() => {});
      }
      log('   ✓ Botón habilitado por reCAPTCHA.');
    }

    log('→ Enviando login...');
    await page.locator('#login-submit').click();

    // Wait for either:
    // A) Navigation to authenticated area (URL contains "autenticado")
    // B) ClaveÚnica error banner: "Datos de acceso no" (which displays "Datos de acceso no válidos")
    // C) ClaveÚnica input validation: "Ingresa correctamente tu RUN" (displays "Ingresa correctamente tu RUN de 7 u 8 números...")
    try {
      await Promise.race([
        page.waitForURL(/autenticado/, { timeout: 45000 }),
        page.waitForSelector('text="Datos de acceso no válidos"', { state: 'visible', timeout: 45000 }),
        page.waitForSelector('text="Ingresa correctamente tu RUN de 7 u 8 números más dígito verificador"', { state: 'visible', timeout: 45000 }),
        // (Se quitó un cuarto competidor `locator('body').filter({hasText:/bloque|intentos|…/})`:
        //  el <body> siempre está visible, así que resolvía en 0 ms si la página contenía
        //  cualquiera de esas palabras y la carrera terminaba antes de la navegación → un login
        //  correcto se clasificaba como error. El chequeo de bloqueo corre igual más abajo.)
      ]);
    } catch (raceErr) {
      // Ignore race timeout and let url check decide
    }

    if (!page.url().includes('autenticado')) {
      // ORDEN IMPORTANTE: primero el diagnóstico EXACTO de credenciales. ClaveÚnica muestra
      // "Datos de acceso no válidos" junto al contador de reintentos, así que un chequeo de
      // bloqueo por substrings ganaba siempre y una clave simplemente cambiada se reportaba
      // como "riesgo_bloqueo" — el abogado dejaba de intentar cuando solo había que actualizar
      // la clave. (Mismo patrón del falso "bloqueo de IP" ya vivido.)
      const isInvalidRun = await page.locator('text="Ingresa correctamente tu RUN de 7 u 8 números más dígito verificador"').isVisible().catch(() => false);
      const isInvalidAccess = await page.locator('text="Datos de acceso no válidos"').isVisible().catch(() => false);

      if (!isInvalidRun && !isInvalidAccess) {
        const lockoutMsg = await detectAccountLockout(page);
        if (lockoutMsg) {
          const msg = `ALERTA DE BLOQUEO DETECTADA: "${lockoutMsg}"`;
          log(`❌ ${msg}`);
          throw new CredentialError(msg, 'riesgo_bloqueo');
        }
      }

      if (isInvalidRun) {
        const msg = 'El RUN (RUT) ingresado es incorrecto o inválido ("Ingresa correctamente tu RUN de 7 u 8 números más dígito verificador").';
        log(`❌ ${msg}`);
        throw new CredentialError(msg, 'rut_incorrecto');
      } else if (isInvalidAccess) {
        const msg = 'La ClaveÚnica o contraseña ingresada es incorrecta ("Datos de acceso no válidos").';
        log(`❌ ${msg}`);
        throw new CredentialError(msg, 'clave_unica_incorrecta');
      } else {
        const msg = `Error de autenticación no reconocido (posible portal caído o timeout). URL actual: ${page.url()}`;
        log(`❌ ${msg}`);
        throw new Error(msg);
      }
    }

    log(`→ Login exitoso. URL: ${page.url()}`);

    // Si somos redirigidos a la pantalla de registrar ciudadano (primer ingreso con este RUT)
    if (page.url().includes('verRegistrarCiudadano')) {
      log('⚠️  [REGISTRO] El RUT ingresado no está registrado en el portal. Realizando registro por única vez...');
      if (!clientDetails) {
        throw new Error('Faltan los detalles del cliente (clientDetails) para el registro en el portal.');
      }

      let phoneValue = clientDetails.telefono;
      if (phoneValue.startsWith('+56')) {
        phoneValue = phoneValue.substring(3);
      } else if (phoneValue.startsWith('56') && phoneValue.length > 9) {
        phoneValue = phoneValue.substring(2);
      }
      log(`→ [REGISTRO] Rellenando teléfono: ${phoneValue}`);
      await page.locator('#telefono').click();
      await page.locator('#telefono').fill(phoneValue);
      await page.locator('#telefono').dispatchEvent('keyup');
      await page.locator('#telefono').dispatchEvent('change');

      log(`→ [REGISTRO] Seleccionando región: ${clientDetails.region}`);
      await selectBootstrap(page, 'region', clientDetails.region);

      log('→ [REGISTRO] Esperando carga de comunas...');
      await page.waitForFunction(
        () => {
          const el = document.getElementById('comuna') as HTMLSelectElement;
          return el !== null && el.options.length > 1;
        },
        { timeout: 15000 }
      );

      log(`→ [REGISTRO] Seleccionando comuna: ${clientDetails.comuna}`);
      await selectBootstrap(page, 'comuna', clientDetails.comuna);

      log(`→ [REGISTRO] Rellenando correo: ${clientDetails.email}`);
      await page.locator('#email').fill(clientDetails.email);
      await page.locator('#email').dispatchEvent('keyup');
      await page.locator('#email').dispatchEvent('blur');

      await page.locator('#emailConfirm').fill(clientDetails.email);
      await page.locator('#emailConfirm').dispatchEvent('keyup');
      await page.locator('#emailConfirm').dispatchEvent('blur');

      // Desenfocar campos para validar
      await page.locator('body').click({ position: { x: 0, y: 0 } });
      await page.waitForTimeout(500);

      // Gatillar función de validación nativa de la página
      await page.evaluate(() => {
        // @ts-ignore
        if (typeof validarFormulario === 'function') {
          // @ts-ignore
          validarFormulario();
        }
      });

      const isGuardarEnabled = await page.evaluate(() => {
        const btn = document.getElementById('btnGuardar') as HTMLButtonElement;
        return btn ? !btn.disabled : false;
      });

      if (!isGuardarEnabled) {
        log('⚠️ [REGISTRO] El botón Guardar sigue deshabilitado. Forzando su habilitación...');
        await page.evaluate(() => {
          const btn = document.getElementById('btnGuardar') as HTMLButtonElement;
          if (btn) btn.removeAttribute('disabled');
        });
      }

      log('→ [REGISTRO] Clickeando Guardar...');
      const urlAntes = page.url();
      await page.locator('#btnGuardar').click();

      log('→ [REGISTRO] Esperando navegación post-registro...');
      await page.waitForFunction(
        (before: string) => window.location.href !== before,
        urlAntes,
        { timeout: 60000 }
      );

      log(`✓ [REGISTRO] Registro de ciudadano completado. URL actual: ${page.url()}`);
    }

    log('→ Navegando a Renegociación...');
    // Portal SUPERIR v6.0.1 (2026-07): el menú "Renegociación" pasó de un
    // <a onclick="...renegociacion..."> a un <a href="/miSuperir/autenticado/
    // renegociacion/inicio"> plano. El selector viejo por onclick daba timeout.
    // Se prueba el href nuevo y, como red de seguridad, el texto del menú.
    const navRenegociacion = page.locator('nav.primary-menu a[href*="renegociacion"], a[href*="/renegociacion/inicio"], a[onclick*="renegociacion"]').first();
    await navRenegociacion.waitFor({ state: 'visible', timeout: 30000 });
    await navRenegociacion.click();
    await page.waitForURL(/renegociacion/, { timeout: 30000 });

    log('→ Haciendo click en Solicitud Renegociación...');
    await page.waitForSelector('text=Solicitud Renegociación', { timeout: 15000 });
    await page.getByText('Solicitud Renegociación').first().click();

    // Portal v6.0.1 (2026-07): el <form> de la solicitud pasó de id="renegociacionForm"
    // a id="deudorForm" (action=/renegociacion/solicitud). Los checkboxes y el botón de
    // abajo (#mensajeLeido, #autorizoConvenioDatos, #btnEnviar) NO cambiaron.
    await page.waitForSelector('#deudorForm, #renegociacionForm', { timeout: 30000 });
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500); // Esperar estabilización de scripts onload

    // Check if we are on the introductory "Solicitud de Renegociación" page (for first-time drafts)
    const isIntroPage = await page.locator('#mensajeLeido').isVisible({ timeout: 5000 }).catch(() => false);
    if (isIntroPage) {
      log('⚠️  [INICIO] Detectada página introductoria de Solicitud de Renegociación. Aceptando términos...');
      
      await page.evaluate(() => {
        const chkLeido = document.getElementById('mensajeLeido') as HTMLInputElement;
        const chkConvenio = document.getElementById('autorizoConvenioDatos') as HTMLInputElement;
        const btnEnviar = document.getElementById('btnEnviar') as HTMLButtonElement;
        
        if (chkLeido) {
          chkLeido.checked = true;
          chkLeido.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (chkConvenio) {
          chkConvenio.removeAttribute('disabled');
          chkConvenio.checked = true;
          chkConvenio.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (btnEnviar) {
          btnEnviar.classList.remove('hidden');
          btnEnviar.removeAttribute('disabled');
        }
      });
      
      await page.waitForTimeout(500);
      
      log('→ [INICIO] Enviando formulario introductorio...');
      const urlAntes = page.url();
      await page.locator('#btnEnviar').click();
      
      log('→ [INICIO] Esperando redirección al Paso 1 real...');
      await page.waitForFunction(
        (before: string) => window.location.href !== before,
        urlAntes,
        { timeout: 60000 }
      );
      
      // Esperar al formulario Step 1 real
      // Portal v6.0.1: el Paso 1 le sacó el prefijo "persona" a todos los ids del
      // formulario. #personaNacionalidad → #nacionalidad. (El resto del llenado vive en
      // step1_personal.ts y necesita la misma migración de ids — ver mapa v6.0.1.)
      await page.waitForSelector('#nacionalidad, #personaNacionalidad', { timeout: 30000 });
      log('✓ [INICIO] Paso 1 real cargado correctamente.');
    } else {
      log('✓ Formulario Paso 1 cargado correctamente.');
    }

  } catch (error) {
    if (logger) logger.error('✗ Error en login/navegación.', error);
    else console.error(`[${new Date().toISOString()}] ✗ Error en login/navegación.`, error);
    await screenshotOnFailure(page, 'login');
    throw error;
  }
}

async function selectBootstrap(page: Page, selectId: string, value: string): Promise<void> {
  await page.locator(`#${selectId}`).selectOption(value);
  await page.evaluate((id) => {
    const el = document.getElementById(id) as HTMLSelectElement;
    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selectId);
  await page.waitForTimeout(200);
}

