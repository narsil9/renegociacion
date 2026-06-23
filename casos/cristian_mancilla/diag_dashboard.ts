/**
 * Diagnóstico: ¿Playwright puebla webkitRelativePath al subir una carpeta?
 * Navega al dashboard live, busca el RUT, setea la carpeta y lee la tabla de clasificación.
 */
import { chromium } from 'playwright';
import * as path from 'path';

const URL = 'https://rp-carga-documentos.vercel.app/subir-caso';
const RUT = '16.587.870-1';
const DIR = path.resolve('/Users/patomartini/Desktop/renegociacion/casos/cristian_mancilla/documentos');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`PAGEERR: ${e.message}`));
  page.on('requestfailed', r => errors.push(`REQFAIL: ${r.url()} — ${r.failure()?.errorText}`));

  console.log(`→ Navegando a ${URL}`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  console.log(`✓ Título: ${await page.title()}`);

  // Buscar RUT
  await page.getByPlaceholder(/RUT del cliente/i).first().fill(RUT);
  await page.getByRole('button', { name: 'Buscar' }).click();
  // Esperar la ficha del cliente
  await page.waitForTimeout(4000);
  const clientShown = await page.getByText(/Cristian|RUT:/i).first().isVisible().catch(() => false);
  console.log(`✓ Ficha cliente visible: ${clientShown}`);

  // Setear la carpeta en el input oculto
  console.log(`→ setInputFiles(directorio) = ${DIR}`);
  try {
    await page.setInputFiles('#folder-input', DIR);
  } catch (e) {
    console.log(`⚠️ setInputFiles(dir) falló: ${(e as Error).message}`);
  }
  await page.waitForTimeout(3000);

  // Leer la tabla de clasificación: nombre + title(relativePath) + categoría seleccionada
  const rows = await page.evaluate(() => {
    const out: { name: string; relativePath: string; category: string }[] = [];
    document.querySelectorAll('table.tbl tbody tr').forEach(tr => {
      const nameDiv = tr.querySelector('td:first-child .truncate') as HTMLElement | null;
      const sel = tr.querySelector('select') as HTMLSelectElement | null;
      if (nameDiv) out.push({
        name: nameDiv.textContent?.trim() || '',
        relativePath: nameDiv.getAttribute('title') || '',
        category: sel ? sel.value : '',
      });
    });
    return out;
  });
  console.log(`\n=== Tabla de clasificación (${rows.length} filas) ===`);
  for (const r of rows) console.log(`  [${r.category}] ${r.name}  (relativePath="${r.relativePath}")`);

  // Contador que muestra la UI
  const counter = await page.locator('text=/archivo\\(s\\)/').first().textContent().catch(() => null);
  console.log(`\nContador UI: ${counter}`);

  await page.screenshot({ path: '/private/tmp/claude-501/-Users-patomartini-Desktop-renegociacion/1366f6ba-3992-4196-8896-32fa084fee6a/scratchpad/diag_dashboard.png', fullPage: true });
  console.log(`\n=== Errores capturados (${errors.length}) ===`);
  errors.forEach(e => console.log('  ' + e));

  await browser.close();
})().catch(e => { console.error('🚨', e); process.exit(1); });
