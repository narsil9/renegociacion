/**
 * Test DETERMINISTA del extractor de ingresos (Paso 5) — caso testigo Jorge Romero.
 * No gasta créditos de API: alimenta los HECHOS que el LLM extraería (los líquidos
 * leídos nativamente de las 3 liquidaciones) y verifica que la ESTRUCTURA calculada
 * por TS coincide con la verdad-terreno del abogado.
 *
 * Verdad-terreno (audio del abogado + lectura nativa de LIQUIDACIONES JORGE ROMERO.pdf):
 *   - Marzo-2025  "Líquido a pagar" = 2.162.761
 *   - Abril-2025  "Líquido a pagar" = 2.162.042
 *   - Mayo-2025   "Líquido a pagar" = 2.161.887
 *   - Sin descuentos voluntarios (solo AFP/salud/cesantía/impuesto = legales).
 *   - Promedio /3 = $2.162.230  ← exactamente lo que declaró el abogado.
 *   - Tipo ingreso = Remuneración (1), doc = 3 liquidaciones (28), periodicidad = Mensual (4).
 *   - Cert de cotizaciones AFP ProVida, emitido 2025-05-22, RUT empleador 59212930-2.
 *
 * Correr: npx ts-node --transpile-only -r dotenv/config casos/jorge_romero/test_extractor.ts
 */

import { computeIncomes, ExtractedIncomeDoc, CotizacionesCertFacts } from '../../src/utils/income_extractor';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FALLO: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${msg}`);
  }
}

// --- HECHOS (lo que el LLM extrae de las liquidaciones; transcribe descuentos sin clasificar) ---
const liquidaciones: ExtractedIncomeDoc = {
  filename: 'LIQUIDACIONES JORGE ROMERO.pdf',
  category: 'liquidacion_sueldo',
  periods: [
    {
      period_label: 'Marzo-2025',
      liquido_a_pagar: 2162761,
      deductions: [
        { label: 'Cotizacion AFP Provida', amount: 319832 },
        { label: 'Salud Banmedica', amount: 274904 },
        { label: 'Seguro de Cesantia', amount: 16760 },
        { label: 'Impuesto', amount: 59033 },
      ],
    },
    {
      period_label: 'Abril-2025',
      liquido_a_pagar: 2162042,
      deductions: [
        { label: 'Cotizacion AFP Provida', amount: 319832 },
        { label: 'Salud Banmedica', amount: 276185 },
        { label: 'Seguro de Cesantia', amount: 16760 },
        { label: 'Impuesto', amount: 58471 },
      ],
    },
    {
      period_label: 'Mayo-2025',
      liquido_a_pagar: 2161887,
      deductions: [
        { label: 'Cotizacion AFP Provida', amount: 319832 },
        { label: 'Salud Banmedica', amount: 276991 },
        { label: 'Seguro de Cesantia', amount: 16760 },
        { label: 'Impuesto', amount: 57820 },
      ],
    },
  ],
};

const cotizaciones: CotizacionesCertFacts = {
  filename: 'Cotizaciones.pdf',
  fecha_emision: '2025-05-22',
  rut_entidad_pagadora: '59212930-2',
};

console.log('=== Test extractor de ingresos — Jorge Romero ===\n');

const result = computeIncomes([liquidaciones], cotizaciones);

console.log('Resultado:', JSON.stringify(result, null, 2), '\n');

assert(result.incomes.length === 1, 'Se declara exactamente 1 ingreso (consolidado).');
const inc = result.incomes[0];
if (inc) {
  assert(inc.tipoIngreso === 1, `tipoIngreso = 1 (Remuneración) — fue ${inc.tipoIngreso}.`);
  assert(inc.tipoAntecedente === 28, `tipoAntecedente = 28 (3 liquidaciones) — fue ${inc.tipoAntecedente}.`);
  assert(inc.periodicidad === 4, `periodicidad = 4 (Mensual) — fue ${inc.periodicidad}.`);
  assert(inc.monto === 2162230, `monto = $2.162.230 (verdad-terreno del abogado) — fue $${inc.monto.toLocaleString('es-CL')}.`);
  assert(inc.alerts.length === 0, `sin alertas de descuentos (todos legales) — alertas: ${inc.alerts.length}.`);
  assert(inc.documentFilenames.includes('LIQUIDACIONES JORGE ROMERO.pdf'), 'el doc justificativo queda asociado al ingreso.');
}
assert(result.cotizacionesCert !== null, 'cert de cotizaciones presente.');
assert(result.alerts.length === 0, `sin alertas globales — alertas: ${result.alerts.join(' | ') || '(ninguna)'}.`);

// --- Sub-test: descuento VOLUNTARIO (préstamo empleador) se SUMA de vuelta (L2) ---
console.log('\n=== Sub-test L2: descuento voluntario se suma de vuelta ===');
const conPrestamo: ExtractedIncomeDoc = {
  filename: 'liq_con_prestamo.pdf',
  category: 'liquidacion_sueldo',
  periods: [
    { period_label: 'M1', liquido_a_pagar: 1000000, deductions: [{ label: 'Prestamo empleador', amount: 200000 }, { label: 'Cotizacion AFP', amount: 100000 }] },
    { period_label: 'M2', liquido_a_pagar: 1000000, deductions: [{ label: 'Préstamo Caja de Compensación Los Andes', amount: 200000 }] },
    { period_label: 'M3', liquido_a_pagar: 1000000, deductions: [{ label: 'Impuesto', amount: 50000 }] },
  ],
};
const r2 = computeIncomes([conPrestamo], cotizaciones);
// M1: 1.000.000 + 200.000 = 1.200.000 ; M2: 1.000.000 + 200.000 = 1.200.000 ; M3: 1.000.000 → prom = 1.133.333
assert(r2.incomes[0]?.monto === Math.round((1200000 + 1200000 + 1000000) / 3),
  `monto con préstamos sumados de vuelta = $${r2.incomes[0]?.monto?.toLocaleString('es-CL')} (esperado 1.133.333).`);

// --- Sub-test: descuento AMBIGUO alerta y NO se suma ---
console.log('\n=== Sub-test L2: descuento ambiguo alerta y no se suma ===');
const ambiguo: ExtractedIncomeDoc = {
  filename: 'liq_ambiguo.pdf',
  category: 'liquidacion_sueldo',
  periods: [
    { period_label: 'M1', liquido_a_pagar: 1000000, deductions: [{ label: 'Descuento varios', amount: 50000 }] },
  ],
};
const r3 = computeIncomes([ambiguo], cotizaciones);
assert(r3.incomes[0]?.monto === 1000000, 'descuento ambiguo NO se suma (monto = líquido).');
assert((r3.incomes[0]?.alerts.length ?? 0) > 0, 'descuento ambiguo genera alerta.');

console.log('\n=== Fin del test ===');
