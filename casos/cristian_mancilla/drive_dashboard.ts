/**
 * Simula el procedimiento REAL del abogado contra el dashboard live de Vercel:
 *   1. /datos-personales: buscar RUT → ver prefill → "Guardar y continuar"
 *   2. /subir-caso: seleccionar carpeta → "Iniciar Carga" → confirmar → éxito
 * Captura respuestas de red (init/sign/record/finalize, storage), errores de consola/página,
 * y el estado del gate de datos personales (relevante para cliente fuera de RM: Valdivia).
 */
import { chromium, Page } from 'playwright';
import * as path from 'path';

const BASE = 'https://rp-carga-documentos.vercel.app';
const RUT = process.env.CASE_RUT || '16.587.870-1';
const DIR = path.resolve(process.env.CASE_DIR || '/Users/patomartini/Desktop/renegociacion/casos/cristian_mancilla/documentos');
const SHOT = '/private/tmp/claude-501/-Users-patomartini-Desktop-renegociacion/1366f6ba-3992-4196-8896-32fa084fee6a/scratchpad';

const log = (m: string) => console.log(m);

async function attachListeners(page: Page, net: string[], errs: string[]) {
  page.on('console', m => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });
  page.on('pageerror', e => errs.push(`PAGEERR: ${e.message}`));
  page.on('requestfailed', r => errs.push(`REQFAIL: ${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', async r => {
    const u = r.url();
    if (u.includes('/api/subir-caso') || u.includes('/api/datos-personales') || u.includes('/storage/v1/object')) {
      let tag = u.replace(BASE, '').split('?')[1] || u.split('/').slice(-2).join('/');
      let extra = '';
      if (r.status() >= 400) {
        const body = await r.text().catch(() => '');
        extra = ` ⟵ ${body.slice(0, 300)}`;
      }
      net.push(`${r.status()} ${r.request().method()} ${tag}${extra}`);
    }
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const net: string[] = [];
  const errs: string[] = [];
  await attachListeners(page, net, errs);

  // ---------- PASO A: Datos Personales ----------
  log(`\n══ A. /datos-personales ══`);
  await page.goto(`${BASE}/datos-personales`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByPlaceholder(/RUT del cliente/i).first().fill(RUT);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.waitForTimeout(4000);

  // Leer estado del form: region/comuna selects + banner de faltantes
  const formState = await page.evaluate(() => {
    const getSel = (label: string) => {
      const els = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
      const found = els.find(s => (s.previousElementSibling?.textContent || s.getAttribute('aria-label') || '').toLowerCase().includes(label));
      return found ? { value: found.value, options: found.options.length } : null;
    };
    const bodyText = document.body.innerText;
    const faltan = bodyText.match(/[Ff]altan?[^.\n]*/g)?.slice(0, 3) || [];
    return {
      region: getSel('regi'),
      comuna: getSel('comuna'),
      faltanHints: faltan,
    };
  });
  log(`  Form region select: ${JSON.stringify(formState.region)}`);
  log(`  Form comuna select: ${JSON.stringify(formState.comuna)}`);
  log(`  Hints "faltan": ${JSON.stringify(formState.faltanHints)}`);
  await page.screenshot({ path: `${SHOT}/drive_A_datos.png`, fullPage: true });

  // Guardar y continuar
  const btnCont = page.getByRole('button', { name: /Guardar y continuar a Cargar Caso/i });
  if (await btnCont.isVisible().catch(() => false)) {
    await btnCont.click();
    const btnConfirm = page.getByRole('button', { name: /Sí, guardar y continuar/i });
    await btnConfirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await btnConfirm.click().catch(() => log('  ⚠️ no se pudo clickear confirm guardar'));
    await page.waitForTimeout(4000);
    log(`  → URL tras guardar: ${page.url()}`);
  } else {
    log('  ⚠️ Botón "Guardar y continuar" no visible.');
  }

  // ---------- PASO B: Subir Caso ----------
  log(`\n══ B. /subir-caso ══`);
  if (!page.url().includes('/subir-caso')) {
    await page.goto(`${BASE}/subir-caso?rut=${encodeURIComponent(RUT)}`, { waitUntil: 'networkidle', timeout: 60000 });
  }
  await page.waitForTimeout(2000);
  // Si el cliente no se autocargó, buscarlo
  const clientVisible = await page.getByText(/Datos personales:/i).first().isVisible().catch(() => false);
  if (!clientVisible) {
    await page.getByPlaceholder(/RUT del cliente/i).first().fill(RUT);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.waitForTimeout(4000);
  }
  // Leer pills de estado (datos personales / CMF / etc.)
  const pills = await page.evaluate(() => Array.from(document.querySelectorAll('.pill')).map(p => p.textContent?.trim()).filter(Boolean));
  log(`  Pills estado: ${JSON.stringify(pills)}`);

  // Seleccionar carpeta
  await page.setInputFiles('#folder-input', DIR);
  await page.waitForTimeout(3000);
  const counter = await page.locator('text=/archivo\\(s\\)/').first().textContent().catch(() => null);
  log(`  Contador: ${counter}`);

  // Checklist: leer tonos (ok/warn/danger) y mensajes
  const checks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.alert, [class*="check"]')).map(e => (e as HTMLElement).innerText?.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
  });
  log(`  Checklist/alerts: ${JSON.stringify(checks)}`);
  await page.screenshot({ path: `${SHOT}/drive_B_clasificacion.png`, fullPage: true });

  // Iniciar carga
  const btnIniciar = page.getByRole('button', { name: /Iniciar Carga de Expediente/i });
  if (await btnIniciar.isVisible().catch(() => false) && await btnIniciar.isEnabled().catch(() => false)) {
    await btnIniciar.click();
    const btnSi = page.getByRole('button', { name: /Sí, iniciar la carga/i });
    await btnSi.waitFor({ state: 'visible', timeout: 5000 });
    log('  → Confirmando carga real…');
    await btnSi.click();
    // Esperar éxito o error (hasta 90s: sube 14 archivos por signed URL)
    const ok = await page.getByText(/¡Carga Exitosa!/i).waitFor({ state: 'visible', timeout: 90000 }).then(() => true).catch(() => false);
    log(`  ${ok ? '✅ Carga Exitosa (UI)' : '❌ No apareció el éxito en 90s'}`);
    if (!ok) {
      const errBox = await page.locator('.alert-msg').allTextContents().catch(() => []);
      log(`  Errores en UI: ${JSON.stringify(errBox)}`);
    }
  } else {
    log('  ❌ Botón "Iniciar Carga" no disponible (bloqueado por checklist o ausente).');
  }
  await page.screenshot({ path: `${SHOT}/drive_C_resultado.png`, fullPage: true });

  log(`\n══ Red (api/storage) ══`);
  net.forEach(n => log('  ' + n));
  log(`\n══ Errores (${errs.length}) ══`);
  errs.forEach(e => log('  ' + e));

  await browser.close();
})().catch(e => { console.error('🚨', e); process.exit(1); });
