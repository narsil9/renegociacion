import { Page } from 'playwright';
import { screenshotOnFailure } from '../utils/browser';

function log(msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  console.log(`[${ts}] ${msg}`);
}

export async function loginAndNavigateToStep1(page: Page): Promise<void> {
  const rut = process.env.CLAVE_UNICA_RUT;
  const password = process.env.CLAVE_UNICA_PASSWORD;

  if (!rut || !password) {
    throw new Error('Faltan CLAVE_UNICA_RUT o CLAVE_UNICA_PASSWORD en .env');
  }

  try {
    log('→ Navegando a superir.gob.cl...');
    await page.goto('https://www.superir.gob.cl/', { waitUntil: 'domcontentloaded' });

    const popup = page.locator('[data-dismiss="modal"]').first();
    const popupVisible = await popup.isVisible({ timeout: 5000 }).catch(() => false);
    if (popupVisible) {
      await popup.click();
      log('→ Pop-up cerrado.');
      await page.waitForTimeout(500);
    }

    log('→ Haciendo click en INGRESAR de Portal Mi Superir...');
    await page.locator('a[href*="claveunica.gob.cl"]').first().click();

    log('→ Esperando formulario de ClaveÚnica...');
    await page.waitForSelector('#uname', { timeout: 30000 });

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
    await page.waitForURL(/autenticado/, { timeout: 60000 });
    log(`→ Login exitoso. URL: ${page.url()}`);

    log('→ Navegando a Renegociación...');
    await page.locator('a[onclick*="renegociacion"]').first().click();
    await page.waitForURL(/renegociacion/, { timeout: 30000 });

    log('→ Haciendo click en Solicitud Renegociación...');
    await page.waitForSelector('text=Solicitud Renegociación', { timeout: 15000 });
    await page.getByText('Solicitud Renegociación').first().click();

    await page.waitForSelector('#renegociacionForm', { timeout: 30000 });
    log('✓ Formulario Paso 1 cargado correctamente.');

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ✗ Error en login/navegación.`);
    await screenshotOnFailure(page, 'login');
    throw error;
  }
}
