/**
 * Test E2E del Paso 5 (Ingresos) contra el portal Superir — caso Jorge Romero.
 *
 * Patrón claudia_silva: hardcodea la VERDAD-TERRENO (resultado del agente, ya
 * validado por test_agent_nativo.ts) y ejecuta Playwright REAL. Así prueba el
 * llenado del portal sin gastar créditos de API en cada corrida.
 *
 * Login con la ClaveÚnica del cliente de prueba (RUT 21917363-6 + CLAVE_UNICA_PASSWORD),
 * navega a verIngresos sobre el borrador y corre fillStep5. DRY_RUN por defecto
 * (no presiona "Guardar y Continuar"; deja el borrador para inspección).
 *
 * Correr:
 *   DRY_RUN=true npx ts-node --transpile-only -r dotenv/config casos/jorge_romero/test_step5.ts
 * Para enviar de verdad (avanza el borrador): DRY_RUN=false ...
 */

import * as path from 'path';
import * as fs from 'fs';
import { launchBrowser } from '../../src/utils/browser';
import { loginAndNavigateToStep1 } from '../../src/automation/login';
import { fillStep5, Step5Input } from '../../src/automation/step5_ingresos';
import { DeclaredIncome } from '../../src/utils/income_extractor';

const CARPETA = '/Users/patomartini/Desktop/JORGE ANDRES ROMERO MANUGUIAN/Ingresos';
const LIQUIDACIONES = path.join(CARPETA, 'Contrato de trabajo o últimas 3 liquidaciones de sueldo/LIQUIDACIONES JORGE ROMERO.pdf');
const COTIZACIONES = path.join(CARPETA, 'Certificado de cotizaciones previsionales (12 meses)/Cotizaciones.pdf');

// Cliente de prueba: login con la ClaveÚnica de Pato (no la del cliente real).
const CLIENT_RUT = process.env.CLAVE_UNICA_RUT ?? '21917363-6';

// --- VERDAD-TERRENO (validada por test_extractor.ts y test_agent_nativo.ts) ---
const incomes: DeclaredIncome[] = [
  {
    tipoIngreso: 1,
    tipoIngresoLabel: 'Remuneración',
    concepto: 'Remuneración',
    monto: 2162230, // promedio de los 3 "Líquido a pagar"
    periodicidad: 4, // Mensual
    tipoAntecedente: 28, // 3 últimas liquidaciones de sueldo
    documentFilenames: ['LIQUIDACIONES JORGE ROMERO.pdf'],
    detalle: 'promedio de Mar/Abr/May 2025',
    alerts: [],
  },
];

const step5Input: Step5Input = {
  incomes,
  justificativos: [
    { tipoAntecedente: 28, localPath: LIQUIDACIONES, filename: 'LIQUIDACIONES JORGE ROMERO.pdf' },
  ],
  cotizacionesPath: COTIZACIONES,
};

async function main() {
  for (const p of [LIQUIDACIONES, COTIZACIONES]) {
    if (!fs.existsSync(p)) { console.error(`❌ No existe: ${p}`); process.exit(1); }
  }
  const password = process.env.CLAVE_UNICA_PASSWORD || '';
  if (!password) { console.error('❌ Falta CLAVE_UNICA_PASSWORD en .env'); process.exit(1); }

  console.log(`=== Test Paso 5 E2E — Jorge Romero (login ${CLIENT_RUT}, DRY_RUN=${process.env.DRY_RUN ?? 'true'}) ===`);
  const { browser, page } = await launchBrowser();
  try {
    console.log('🔒 Login ClaveÚnica...');
    await loginAndNavigateToStep1(page, CLIENT_RUT, password);
    const baseUrl = new URL(page.url()).origin;
    const step5Url = `${baseUrl}/miSuperir/autenticado/renegociacion/verIngresos`;
    console.log(`→ Navegando a Paso 5: ${step5Url}`);
    await page.goto(step5Url, { waitUntil: 'domcontentloaded' });

    const report = await fillStep5(page, step5Input);
    console.log('\n=== Reporte Paso 5 ===');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('❌ Error en el test Paso 5:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('🔌 Navegador cerrado.');
  }
}

main();
