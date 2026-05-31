import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

async function run() {
  console.log('🚀 Iniciando script de prueba de Dashboard E2E...');
  
  // Launch playwright browser
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('📡 Navegando al dashboard local en http://localhost:5173/ ...');
    await page.goto('http://localhost:5173/');
    
    // Wait for the clients table to load
    await page.waitForSelector('.clients-table');
    console.log('✓ Dashboard cargado. Buscando fila del cliente...');

    // Find row for RUT '21917363-6'
    const row = page.locator('tr', { hasText: '21917363-6' });
    await expectRowExists(row);

    // Take an initial screenshot before clicking
    const outputsDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputsDir)) {
      fs.mkdirSync(outputsDir, { recursive: true });
    }
    
    await page.screenshot({ path: path.join(outputsDir, 'dashboard_before.png') });
    console.log('📸 Captura guardada: outputs/dashboard_before.png');

    // Find the "Correr Paso 1" button in that row and click it
    const runButton = row.locator('button.btn-action-run');
    console.log('👉 Haciendo click en "Correr Paso 1"...');
    await runButton.click();

    // Wait a brief moment and check if the status changed to pending/running
    await page.waitForTimeout(1500);
    
    await page.screenshot({ path: path.join(outputsDir, 'dashboard_running.png') });
    console.log('📸 Captura guardada: outputs/dashboard_running.png (procesando...)');

    // Poll the dashboard UI until the status changes back to success/failed
    console.log('⏳ Esperando a que el worker procese el trabajo...');
    let completed = false;
    let attempts = 0;
    const maxAttempts = 15; // 15 attempts * 4s = 60s max wait

    while (!completed && attempts < maxAttempts) {
      attempts++;
      await page.waitForTimeout(4000);
      
      const statusText = await row.locator('td:nth-child(4)').innerText();
      console.log(`[Intento ${attempts}/${maxAttempts}] Estado actual en UI: "${statusText.trim()}"`);

      if (statusText.includes('Paso 1 Listo') || statusText.includes('Listo para Paso 2')) {
        console.log('🎉 ¡El trabajo se completó con ÉXITO en el dashboard!');
        completed = true;
      } else if (statusText.includes('Fallo')) {
        console.error('❌ El trabajo FALLÓ según el dashboard.');
        completed = true;
      }
    }

    // Take final screenshot
    await page.screenshot({ path: path.join(outputsDir, 'dashboard_final.png') });
    console.log('📸 Captura final guardada: outputs/dashboard_final.png');

    if (!completed) {
      console.warn('⚠️ Se alcanzó el tiempo de espera máximo sin cambios de estado definitivos.');
    }

  } catch (error) {
    console.error('🚨 Error durante la simulación de clic en el dashboard:', error);
  } finally {
    await browser.close();
    console.log('🔌 Conexión cerrada.');
  }
}

async function expectRowExists(row: any) {
  const count = await row.count();
  if (count === 0) {
    throw new Error('No se encontró la fila del cliente con RUT 21917363-6');
  }
}

run();
