/**
 * Test de LECTURA NATIVA por Claude (Paso 5) — caso Jorge Romero.
 * ⚠️ GASTA créditos de API (lee los PDFs reales de ingreso de la carpeta del cliente).
 *
 * Valida la cadena completa SIN base de datos: Claude lee nativamente las 3
 * liquidaciones (escaneo, 0 texto) + el cert de cotizaciones → extrae los hechos →
 * el extractor determinista calcula la estructura → se compara con la verdad-terreno
 * ($2.162.230, Remuneración/28/Mensual).
 *
 * Correr: npx ts-node --transpile-only -r dotenv/config casos/jorge_romero/test_agent_nativo.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { extractIncomeFactsNative, IncomeDocInput } from '../../src/agents/ingresos_agent';
import { computeIncomes } from '../../src/utils/income_extractor';

const CARPETA = '/Users/patomartini/Desktop/JORGE ANDRES ROMERO MANUGUIAN/Ingresos';
const DOCS: IncomeDocInput[] = [
  {
    filename: 'LIQUIDACIONES JORGE ROMERO.pdf',
    localPath: path.join(CARPETA, 'Contrato de trabajo o últimas 3 liquidaciones de sueldo/LIQUIDACIONES JORGE ROMERO.pdf'),
  },
  {
    filename: 'Cotizaciones.pdf',
    localPath: path.join(CARPETA, 'Certificado de cotizaciones previsionales (12 meses)/Cotizaciones.pdf'),
  },
];

async function main() {
  for (const d of DOCS) {
    if (!fs.existsSync(d.localPath)) {
      console.error(`❌ No existe el documento: ${d.localPath}`);
      process.exit(1);
    }
  }

  console.log('=== Lectura nativa por Claude — Jorge Romero ===\n');
  const { extracted, cotizaciones } = await extractIncomeFactsNative(DOCS);

  console.log('\n--- HECHOS extraídos por Claude ---');
  console.log(JSON.stringify({ extracted, cotizaciones }, null, 2));

  const result = computeIncomes(extracted, cotizaciones);
  console.log('\n--- ESTRUCTURA determinista a declarar ---');
  console.log(JSON.stringify(result, null, 2));

  const inc = result.incomes[0];
  console.log('\n=== Comparación contra verdad-terreno ===');
  const ok =
    result.incomes.length === 1 &&
    inc?.tipoIngreso === 1 &&
    inc?.tipoAntecedente === 28 &&
    inc?.periodicidad === 4 &&
    inc?.monto === 2162230 &&
    result.cotizacionesCert !== null;
  console.log(`Ingreso declarado: ${inc?.tipoIngresoLabel} $${inc?.monto?.toLocaleString('es-CL')} (mensual)`);
  console.log(`Esperado:          Remuneración $2.162.230 (mensual)`);
  console.log(`Cert cotizaciones: ${result.cotizacionesCert ? 'presente ✓' : 'AUSENTE ✗'}`);
  if (result.alerts.length) console.log(`Alertas: ${result.alerts.join(' | ')}`);
  console.log(ok ? '\n✅ COINCIDE con la verdad-terreno.' : '\n❌ NO coincide — revisar extracción.');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
