/**
 * Pruebas unitarias DETERMINISTAS del Paso 5 (sin API, sin framework).
 * Blindan `src/utils/income_extractor.ts` para producción. Estilo aserción pura (como
 * run_deterministic.ts). Matriz B1–B8 de REVISION_Y_PLAN.md. exit(1) si algo falla.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/paso5_pruebas/unit_tests.ts
 */
import {
  parsePeriodKey,
  classifyDeduction,
  computeDeclaredIncomeForDoc,
  computeIncomes,
  validateIncomeReads,
  ExtractedIncomeDoc,
  IncomePeriod,
  DeductionLine,
  CotizacionesCertFacts,
} from '../../src/utils/income_extractor';

// --------------------------------------------------------------------------- mini-harness
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function near(name: string, got: number, want: number, tol = 3) {
  ok(name, Number.isFinite(got) && Math.abs(got - want) <= tol, `got ${got} want ~${want}`);
}
function hasAlert(alerts: string[], sub: string): boolean {
  return alerts.some((a) => a.toLowerCase().includes(sub.toLowerCase()));
}
function section(t: string) { console.log(`\n• ${t}`); }

// builders
const ded = (label: string, amount: number): DeductionLine => ({ label, amount });
const per = (period_label: string, liquido: number | null, deductions: DeductionLine[] = [], extra: Partial<IncomePeriod> = {}): IncomePeriod =>
  ({ period_label, liquido_a_pagar: liquido, deductions, ...extra });
const doc = (category: ExtractedIncomeDoc['category'], periods: IncomePeriod[], extra: Partial<ExtractedIncomeDoc> = {}): ExtractedIncomeDoc =>
  ({ filename: extra.filename ?? `${category}.pdf`, category, periods, ...extra });
const COT: CotizacionesCertFacts = { filename: 'cot.pdf', fecha_emision: '2026-06-17', rut_entidad_pagadora: '11111111-1' };
// alerts de un solo doc declarable
const incAlerts = (d: ExtractedIncomeDoc) => computeDeclaredIncomeForDoc(d)?.alerts ?? [];
const allAlerts = (c: ReturnType<typeof computeIncomes>) => [...c.alerts, ...c.incomes.flatMap((i) => i.alerts)];

// =========================================================================== B1 parsePeriodKey
section('B1 parsePeriodKey');
eq('B1 mayo 2025', parsePeriodKey('Mayo 2025'), 202505);
eq('B1 MAYO-2025', parsePeriodKey('MAYO-2025'), 202505);
eq('B1 2025-05', parsePeriodKey('2025-05'), 202505);
eq('B1 05/2025', parsePeriodKey('05/2025'), 202505);
eq('B1 2025.5', parsePeriodKey('2025.5'), 202505);
eq('B1 abr-25', parsePeriodKey('abr-25'), 202504);
eq('B1 dic 2026', parsePeriodKey('diciembre 2026'), 202612);
eq('B1 DD.MM.YYYY 31.05.2026', parsePeriodKey('31.05.2026'), 202605);
eq('B1 verbosa "1 de diciembre de 2025" [H4]', parsePeriodKey('1 de diciembre de 2025'), 202512);
eq('B1 falso positivo "abril 03" NO 200003 [H4]', parsePeriodKey('abril 03'), null);
eq('B1 basura', parsePeriodKey('Remuneración'), null);
eq('B1 vacío', parsePeriodKey(''), null);
eq('B1 undefined', parsePeriodKey(undefined), null);
eq('B1 mes inválido 2025-13', parsePeriodKey('2025-13'), null);
eq('B1 año fuera de rango 1999-05', parsePeriodKey('1999-05'), null);
eq('B1 idempotencia', parsePeriodKey('Mayo 2025'), parsePeriodKey('Mayo 2025'));

// =========================================================================== B2 classifyDeduction
section('B2 classifyDeduction');
eq('B2 AFP=legal', classifyDeduction('Cotización AFP Provida'), 'legal');
eq('B2 Salud ISAPRE=legal', classifyDeduction('Salud ISAPRE Banmédica'), 'legal');
eq('B2 Cesantía=legal', classifyDeduction('Seguro de Cesantía'), 'legal');
eq('B2 Impuesto=legal', classifyDeduction('Impuesto Único'), 'legal');
eq('B2 Caja Los Andes=voluntary', classifyDeduction('Crédito Personal Caja Los Andes'), 'voluntary');
eq('B2 CCAF Ptmo=voluntary', classifyDeduction('Descto. Ptmo. CCAF Los Andes'), 'voluntary');
eq('B2 APV=voluntary', classifyDeduction('Ahorro Voluntario APV'), 'voluntary');
eq('B2 Anticipos=ambiguous', classifyDeduction('Anticipos Varios'), 'ambiguous');
eq('B2 Sindicato=ambiguous', classifyDeduction('Cuota Sindicato'), 'ambiguous');
eq('B2 Seguro Vida=ambiguous', classifyDeduction('Seguro Vida'), 'ambiguous');
eq('B2 Bienestar=ambiguous', classifyDeduction('Aporte 2% Bienestar'), 'ambiguous');
eq('B2 Cta Cte=ambiguous', classifyDeduction('Cta. Cte. Clinica UF'), 'ambiguous');
eq('B2 prioridad legal (préstamo + cotización)', classifyDeduction('Cotización préstamo'), 'legal');
eq('B2 label vacío=ambiguous', classifyDeduction(''), 'ambiguous');
eq('B2 símbolos=ambiguous', classifyDeduction('***'), 'ambiguous');

// =========================================================================== B3 camino liquido
section('B3 liquido / periodNetIncome');
{
  // sin voluntarios
  const d = doc('liquidacion_sueldo', [per('Mayo 2026', 1000000, [ded('AFP', 100000)])]);
  near('B3 1 período, líquido tal cual', computeDeclaredIncomeForDoc(d)!.monto, 1000000);
}
{
  // con voluntario sumado
  const d = doc('liquidacion_sueldo', [per('Mayo 2026', 1000000, [ded('Préstamo empleador', 50000)])]);
  near('B3 voluntario se suma', computeDeclaredIncomeForDoc(d)!.monto, 1050000);
}
{
  // ambiguo NO se suma + alerta
  const d = doc('liquidacion_sueldo', [per('Mayo 2026', 1000000, [ded('Seguro Vida', 5000)])]);
  const r = computeDeclaredIncomeForDoc(d)!;
  near('B3 ambiguo no se suma', r.monto, 1000000);
  ok('B3 ambiguo alerta', hasAlert(r.alerts, 'Seguro Vida'));
}
{
  // Fix1: 4 períodos ventana 3 → usa los 3 más recientes (excluye enero)
  const d = doc('liquidacion_sueldo', [
    per('Enero 2026', 1000000), per('Febrero 2026', 2000000), per('Marzo 2026', 2000000), per('Abril 2026', 2000000),
  ]);
  near('B3 Fix1 promedio 3 recientes', computeDeclaredIncomeForDoc(d)!.monto, 2000000);
}
{
  // H1: duplicado exacto NO distorsiona (vía computeIncomes con 2 docs idénticos del mismo empleador)
  const mk = () => doc('liquidacion_sueldo', [
    per('Mayo 2026', 3000000), per('Abril 2026', 2000000), per('Marzo 2026', 1000000),
  ], { source_key: '77-7' });
  const c = computeIncomes([mk(), mk()], COT);
  eq('B3 H1 un solo ingreso (no 2)', c.incomes.length, 1);
  near('B3 H1 dedup → promedio correcto [H1]', c.incomes[0].monto, 2000000); // (3+2+1)/3, NO (3+3+2)/3
  ok('B3 H1 alerta de duplicado [H1]', hasAlert(allAlerts(c), 'duplicado'));
}
{
  // divisor parcial: 2 períodos con ventana 3 → divisor 2 + alerta
  const d = doc('liquidacion_sueldo', [per('Mayo 2026', 2000000), per('Abril 2026', 2000000)]);
  const r = computeDeclaredIncomeForDoc(d)!;
  near('B3 divisor parcial', r.monto, 2000000);
  ok('B3 divisor parcial alerta', hasAlert(r.alerts, 'se esperaban 3'));
}
{
  // período null entre válidos → excluido
  const d = doc('liquidacion_sueldo', [per('Mayo 2026', 2000000), per('Abril 2026', null), per('Marzo 2026', 2000000)]);
  near('B3 null excluido', computeDeclaredIncomeForDoc(d)!.monto, 2000000);
}
{
  // H5: negativo e Infinity/NaN → ilegibles + alerta, no rompen
  const dNeg = doc('liquidacion_sueldo', [per('Mayo 2026', 2000000), per('Abril 2026', -500)]);
  const rNeg = computeDeclaredIncomeForDoc(dNeg)!;
  near('B5/H5 negativo no contamina', rNeg.monto, 2000000);
  ok('B5/H5 negativo alerta [H5]', hasAlert(rNeg.alerts, 'ilegible'));
  const dInf = doc('liquidacion_sueldo', [per('Mayo 2026', 1000000), per('Abril 2026', Infinity)]);
  const rInf = computeDeclaredIncomeForDoc(dInf)!;
  ok('B5/H5 Infinity → monto finito [H5]', Number.isFinite(rInf.monto));
  near('B5/H5 Infinity excluido', rInf.monto, 1000000);
}
{
  // invariancia al orden de entrada
  const ps = [per('Marzo 2026', 1000000), per('Mayo 2026', 3000000), per('Abril 2026', 2000000)];
  const a = computeDeclaredIncomeForDoc(doc('liquidacion_sueldo', ps))!.monto;
  const b = computeDeclaredIncomeForDoc(doc('liquidacion_sueldo', [...ps].reverse()))!.monto;
  eq('B3 invariancia al orden', a, b);
}

// =========================================================================== B4 boletas (honorarios)
section('B4 honorarios / computeBoletasIncome');
{
  // 4 boletas en 4 meses → Σbruto/12 (divisor fijo)
  const d = doc('honorarios', ['2026-02', '2026-03', '2026-04', '2026-05'].map((m) =>
    per(m, null, [], { monto_bruto: 600000, retencion: 82500 })));
  near('B4 divisor fijo 12', computeDeclaredIncomeForDoc(d)!.monto, Math.round(2400000 / 12));
}
{
  // boleta fuera de ventana (>12m del ancla) → ignorada + alerta
  const d = doc('honorarios', [
    per('2026-05', null, [], { monto_bruto: 600000 }),
    per('2024-01', null, [], { monto_bruto: 600000 }), // >12m antes
  ]);
  ok('B4 fuera de ventana alerta', hasAlert(computeDeclaredIncomeForDoc(d)!.alerts, 'fuera de la ventana'));
}
{
  // H3: todas sin fecha (anchor null) → alerta, no /12 silencioso
  const d = doc('honorarios', [per('basura', null, [], { monto_bruto: 600000 })]);
  ok('B4 anchor null alerta [H3]', hasAlert(computeDeclaredIncomeForDoc(d)!.alerts, 'sin fecha'));
}
{
  // 0 boletas legibles → monto 0 + alerta
  const d = doc('honorarios', [per('2026-05', null)]);
  const r = computeDeclaredIncomeForDoc(d)!;
  eq('B4 0 boletas monto 0', r.monto, 0);
  ok('B4 0 boletas alerta', r.alerts.length > 0);
}

// =========================================================================== B5 subsidio (licencia médica)
section('B5 licencia médica / computeSubsidioIncome');
{
  // fragmentado en 3 meses → declara el mes más completo (abril)
  const d = doc('licencia_medica', [
    per('2026-03', 269522), per('2026-03', 443971),
    per('2026-04', 178373), per('2026-04', 981054), per('2026-04', 1487963),
    per('2026-05', 350109), per('2026-05', 1900967),
  ]);
  near('B5 mes más completo (abril)', computeDeclaredIncomeForDoc(d)!.monto, 2647390);
}
{
  // duplicado exacto → deduplicado + alerta
  const d = doc('licencia_medica', [per('2026-04', 981054), per('2026-04', 981054)]);
  const r = computeDeclaredIncomeForDoc(d)!;
  near('B5 dedup', r.monto, 981054);
  ok('B5 dedup alerta', hasAlert(r.alerts, 'duplicado'));
}
{
  // H2: pago sin mes parseable → alertado, NO descartado en silencio
  const d = doc('licencia_medica', [per('2026-04', 981054), per('sin fecha', 500000)]);
  ok('B5 sin mes parseable alerta [H2]', hasAlert(computeDeclaredIncomeForDoc(d)!.alerts, 'sin mes parseable'));
}
{
  // 1 solo pago → ese monto
  const d = doc('licencia_medica', [per('2026-04', 1234567)]);
  near('B5 un pago', computeDeclaredIncomeForDoc(d)!.monto, 1234567);
}

// =========================================================================== B6 computeIncomes
section('B6 computeIncomes (orquestación)');
{
  // multi-empleador → 2 ingresos
  const c = computeIncomes([
    doc('liquidacion_sueldo', [per('Mayo 2026', 1700000)], { source_key: 'A', filename: 'a.pdf' }),
    doc('liquidacion_sueldo', [per('Mayo 2026', 440000)], { source_key: 'B', filename: 'b.pdf' }),
  ], COT);
  eq('B6 multi-empleador 2 ingresos', c.incomes.length, 2);
}
{
  // mismo empleador en 3 docs → 1 ingreso
  const c = computeIncomes([
    doc('liquidacion_sueldo', [per('Mayo 2026', 2000000)], { source_key: 'A', filename: 'm.pdf' }),
    doc('liquidacion_sueldo', [per('Abril 2026', 2000000)], { source_key: 'A', filename: 'a.pdf' }),
    doc('liquidacion_sueldo', [per('Marzo 2026', 2000000)], { source_key: 'A', filename: 'mz.pdf' }),
  ], COT);
  eq('B6 mismo empleador 1 ingreso', c.incomes.length, 1);
  near('B6 mismo empleador promedio', c.incomes[0].monto, 2000000);
}
{
  // conflicto sueldo + licencia médica
  const c = computeIncomes([
    doc('liquidacion_sueldo', [per('Mayo 2026', 2000000)], { source_key: 'A' }),
    doc('licencia_medica', [per('2026-04', 2600000)], { source_key: 'B' }),
  ], COT);
  ok('B6 conflicto alerta', hasAlert(c.alerts, 'REEMPLAZA'));
}
{
  // cot faltante / sin RUT
  ok('B6 sin cot alerta', hasAlert(computeIncomes([doc('liquidacion_sueldo', [per('Mayo 2026', 1000000)])], null).alerts, 'Certificado de Cotizaciones'));
  ok('B6 cot sin RUT alerta', hasAlert(computeIncomes([doc('liquidacion_sueldo', [per('Mayo 2026', 1000000)])], { filename: 'c', fecha_emision: '2026-06-01', rut_entidad_pagadora: null }).alerts, 'RUT'));
}
{
  // UF → alerta
  const c = computeIncomes([doc('comprobante_arriendo', [per('Mayo 2026', 38, [], { moneda: 'UF' })])], COT);
  ok('B6 UF alerta', hasAlert(c.alerts, 'UF'));
}
{
  // vacío
  ok('B6 docs vacío alerta', hasAlert(computeIncomes([], COT).alerts, 'ningún ingreso'));
  // sólo cert cotizaciones → 0 ingresos
  eq('B6 sólo cert 0 ingresos', computeIncomes([doc('certificado_cotizaciones', [])], COT).incomes.length, 0);
}
{
  // sin source_key → 1 grupo por categoría (compat hacia atrás)
  const c = computeIncomes([
    doc('liquidacion_sueldo', [per('Mayo 2026', 2000000)]),
    doc('liquidacion_sueldo', [per('Abril 2026', 2000000)]),
  ], COT);
  eq('B6 sin source_key fusiona', c.incomes.length, 1);
}

// =========================================================================== B7 validateIncomeReads
section('B7 validateIncomeReads');
{
  const respalda = doc('liquidacion_sueldo', [per('Mayo 2026', 2161887, [], { evidence: { cita_monto: 'Líquido a Pagar $2.161.887', confidence: 0.97 } })]);
  eq('B7 cita respalda → 0 issues', validateIncomeReads([respalda]).length, 0);
  const noRespalda = doc('liquidacion_sueldo', [per('Mayo 2026', 2161887, [], { evidence: { cita_monto: 'Alcance Líquido 2.243.348', confidence: 0.97 } })]);
  ok('B7 cita no respalda', validateIncomeReads([noRespalda])[0]?.tipo === 'monto_sin_respaldo_en_cita');
  const sinEv = doc('liquidacion_sueldo', [per('Mayo 2026', 2161887)]);
  ok('B7 sin evidencia', validateIncomeReads([sinEv])[0]?.tipo === 'sin_evidencia');
  const baja = doc('liquidacion_sueldo', [per('Mayo 2026', 2161887, [], { evidence: { cita_monto: '2.161.887', confidence: 0.5 } })]);
  ok('B7 baja confianza', validateIncomeReads([baja]).some((i) => i.tipo === 'baja_confianza'));
}

// =========================================================================== B8 propiedad / fuzz
section('B8 propiedad / fuzz');
{
  const base = [
    doc('liquidacion_sueldo', [per('Mayo 2026', 2000000), per('Abril 2026', 2100000), per('Marzo 2026', 1900000)], { source_key: 'A' }),
    doc('licencia_medica', [per('2026-04', 2600000)], { source_key: 'B' }),
  ];
  eq('B8 idempotencia', JSON.stringify(computeIncomes(base, COT)), JSON.stringify(computeIncomes(base, COT)));
  // invariancia al orden de docs
  const a = computeIncomes(base, COT).incomes.map((i) => i.monto).sort().join(',');
  const b = computeIncomes([...base].reverse(), COT).incomes.map((i) => i.monto).sort().join(',');
  eq('B8 invariancia al orden de docs', a, b);
}
{
  const cats: ExtractedIncomeDoc['category'][] = ['liquidacion_sueldo', 'comprobante_pension', 'licencia_medica', 'honorarios', 'retiro_sociedades', 'aporte_terceros_deudas', 'esporadico', 'otro'];
  const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
  const labels = ['Mayo 2026', '2026-04', 'basura', '', '1 de marzo de 2026', 'abril 03', '31.05.2026'];
  const liqs: (number | null)[] = [1000000, 0, -500, NaN, Infinity, -Infinity, null, 999999999999, 250000];
  let crashes = 0, nonFinite = 0, silentZero = 0;
  for (let i = 0; i < 1000; i++) {
    const nDocs = Math.floor(Math.random() * 4);
    const docs: ExtractedIncomeDoc[] = Array.from({ length: nDocs }, (_, k) => {
      const np = Math.floor(Math.random() * 5);
      const periods: IncomePeriod[] = Array.from({ length: np }, () => ({
        period_label: pick(labels),
        liquido_a_pagar: pick(liqs),
        monto_bruto: pick([null, 800000, NaN, Infinity]),
        retencion: pick([null, 100000]),
        deductions: [ded(pick(['AFP', 'Préstamo', 'Seguro Vida', 'Anticipos', '']), pick([100000, -5, NaN, 50000]))],
        moneda: pick(['CLP', 'UF', undefined]) as any,
        evidence: pick([undefined, { cita_monto: pick(['x', '1000000']), confidence: pick([0.5, 0.9, NaN]) }]) as any,
      }));
      return { filename: `f${i}_${k}.pdf`, category: pick(cats), source_key: pick(['1-1', '2-2', null]), periods, monto_mensual_declarado: pick([null, 300000, NaN, -100, Infinity]) };
    });
    try {
      const c = computeIncomes(docs, pick([COT, null]));
      for (const inc of c.incomes) {
        if (!Number.isFinite(inc.monto) || inc.monto < 0) nonFinite++;
        if (inc.monto === 0 && inc.alerts.length === 0) silentZero++; // nunca $0 en silencio
      }
    } catch {
      crashes++;
    }
  }
  eq('B8 fuzz 1000× sin crashes', crashes, 0);
  eq('B8 fuzz montos finitos ≥ 0 [H5]', nonFinite, 0);
  eq('B8 fuzz nunca $0 en silencio', silentZero, 0);
}

// =========================================================================== B9 hallazgos adversarios
section('B9 hallazgos adversarios');
// P1.1 — DD/YYYY no debe confundir día con mes
eq('B9 P1.1 13/2025 no es marzo', parsePeriodKey('13/2025'), null);
eq('B9 P1.1 19/2025 no es septiembre', parsePeriodKey('19/2025'), null);
eq('B9 P1.1 3/2025 sí es marzo (1 dígito)', parsePeriodKey('3/2025'), 202503);
eq('B9 P1.1 contaminación de ventana honorarios', (() => {
  // boleta "13/2026" no debe anclar un mes inventado y contaminar
  const d = doc('honorarios', [
    per('05/2026', null, [], { monto_bruto: 600000 }),
    per('13/2026', null, [], { monto_bruto: 6000000 }),
  ]);
  return computeDeclaredIncomeForDoc(d)!.monto; })(), Math.round(600000 / 12)); // solo la boleta real entra a ventana
{
  // P1.3 — dos esporádico misma fuente: se SUMAN (no se pierde el 2º)
  const c = computeIncomes([
    doc('esporadico', [], { monto_mensual_declarado: 300000, filename: 'e1.pdf' }),
    doc('esporadico', [], { monto_mensual_declarado: 700000, filename: 'e2.pdf' }),
  ], COT);
  eq('B9 P1.3 un ingreso', c.incomes.length, 1);
  near('B9 P1.3 montos sumados [P1.3]', c.incomes[0].monto, 1000000);
  ok('B9 P1.3 alerta de suma [P1.3]', hasAlert(allAlerts(c), 'sumaron'));
}
{
  // P1.4a — honorarios deduplica boletas idénticas
  const d = doc('honorarios', [
    per('2026-05', null, [], { monto_bruto: 600000 }),
    per('2026-05', null, [], { monto_bruto: 600000 }),
  ]);
  const r = computeDeclaredIncomeForDoc(d)!;
  near('B9 P1.4a honorarios dedup [P1.4a]', r.monto, Math.round(600000 / 12));
  ok('B9 P1.4a alerta dup honorarios [P1.4a]', hasAlert(r.alerts, 'duplicada'));
}
{
  // P2.1 — orden de salida estable (SIN sort previo)
  const base = [
    doc('liquidacion_sueldo', [per('Mayo 2026', 2000000)], { source_key: 'A', filename: 'a.pdf' }),
    doc('licencia_medica', [per('2026-04', 2600000)], { source_key: 'B', filename: 'b.pdf' }),
  ];
  eq('B9 P2.1 orden de salida determinista [P2.1]',
    JSON.stringify(computeIncomes(base, COT).incomes.map((i) => [i.tipoIngreso, i.monto])),
    JSON.stringify(computeIncomes([...base].reverse(), COT).incomes.map((i) => [i.tipoIngreso, i.monto])));
}
// P2.2 / P2.3 — colisiones de keyword por substring
eq('B9 P2.2 "Descuento Asistencia" no es legal [P2.2]', classifyDeduction('Descuento Asistencia'), 'ambiguous');
eq('B9 P2.2 "Análisis" no es legal [P2.2]', classifyDeduction('Análisis'), 'ambiguous');
eq('B9 P2.3 "ACHS" sí es legal [P2.3]', classifyDeduction('ACHS'), 'legal');
eq('B9 P2.2 no rompe stems: "Cotizaciones Previsionales" legal', classifyDeduction('Cotizaciones Previsionales'), 'legal');
{
  // P3.1 — honorarios/subsidio sin períodos pero con monto_mensual_declarado → se usa
  const d = doc('honorarios', [], { monto_mensual_declarado: 500000 });
  const r = computeDeclaredIncomeForDoc(d)!;
  near('B9 P3.1 honorarios usa monto declarado [P3.1]', r.monto, 500000);
}

// =========================================================================== resumen
console.log(`\n━━━ RESUMEN UNIT ━━━`);
console.log(`  ${pass} OK, ${fails.length} FAIL`);
fails.forEach((f) => console.log(`  ✗ ${f}`));
process.exit(fails.length === 0 ? 0 : 1);
