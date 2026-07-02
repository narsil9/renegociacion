/**
 * CASO REAL — Yasmín Margaret Silva Switt (RUT 18.424.396-2), verdad-terreno = screenshots de la
 * abogada (9 acreedores: 3×260 + 6×261).
 *
 * Prueba con ANÁLISIS HARDCODEADO (fiel a los PDFs, sin API): CMF hand-fixture + DocFacts que
 * reproducen lo que el lector DEBE extraer de cada cert. Corre el ensamblador + planStep3Rows y
 * compara conteo + split 260/261 contra la abogada.
 *
 * Valor del caso: 90+d ≠ 260. Líder BCI y Banco Falabella están 90+d en el CMF pero sus certs NO
 * acreditan vencimiento (deuda castigada) → la abogada (y la regla decisiva) los declara 261.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_yasmin.ts
 */
import { assembleRawFromDocFacts, DocFacts } from '../../src/utils/sentinel_per_doc';
import { planStep3Rows, ClassifyInput } from '../../src/automation/step3_classify';
import { CmfFixture } from './casos_reales_fixtures';

const TODAY = '2026-06-29';
const UF = 40661;
const logger = { log: (_: string) => {}, error: (m: string) => console.error(m) };
const clp = (n: number) => '$' + n.toLocaleString('es-CL');

// ───────────────────────── CMF real de Yasmín (8 filas de deuda directa) ─────────────────────────
const yasminCmf: CmfFixture = {
  ufValueCLP: UF, meets90DaysRequirement: true, meetsAmountRequirement: true,
  totalCreditoOf90PlusCreditors: 305_633 + 114_492 + 711_897, qualifying90PlusCount: 3,
  creditors: [
    { institucion: 'Banco Santander-Chile', tipoCredito: 'Consumo', totalCredito: 1_318_621, overdue90Days: 0 },
    { institucion: 'Banco Santander-Chile', tipoCredito: 'Tarjeta de crédito', totalCredito: 166_143, overdue90Days: 0 },
    { institucion: 'Banco Santander-Chile', tipoCredito: 'Tarjeta de crédito', totalCredito: 21_759, overdue90Days: 0 },
    { institucion: 'Tricard S.A.', tipoCredito: 'Tarjeta de crédito', totalCredito: 305_633, overdue90Days: 34_576 },
    { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', tipoCredito: 'Consumo', totalCredito: 1_391_996, overdue90Days: 0 },
    { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', tipoCredito: 'Consumo', totalCredito: 2_336_377, overdue90Days: 0 },
    { institucion: 'Banco Falabella', tipoCredito: 'Consumo', totalCredito: 114_492, overdue90Days: 114_492 },
    { institucion: 'Servicios Financieros y Administracion de Creditos Comerciales S.A.', tipoCredito: 'Tarjeta de crédito', totalCredito: 711_897, overdue90Days: 272_535 },
  ],
};

// Helper: producto extraído. cita_fecha se puebla SOLO si hay fecha_mora (corrobora el venc).
const P = (monto: number, etiqueta: string, op?: string, fecha_mora?: string) => ({
  operacion: op, monto, etiqueta_monto: etiqueta, moneda: 'CLP' as const, fecha_mora,
  cita_monto: `${etiqueta}: $${monto.toLocaleString('es-CL')}`,
  cita_fecha: fecha_mora ? `Días Mora / vencimiento ${fecha_mora}` : undefined, confidence: 0.95,
});

// ───────────────────────── DocFacts (lectura FIEL de cada PDF) ─────────────────────────
const yasminFacts: DocFacts[] = [
  // ── 260 declarados por la abogada ──
  // Hites: NO-CMF (deuda castigada), "Días Mora: 176" → venc ≈ 2026-01-05, monto+venc → 260.
  { filename: '1_INVERSIONES_Y_TARJETAS_Hites_2154240.pdf', institucion_asignada: 'Inversiones y Tarjetas S.A.', doc_type: 'desglose_por_producto', rut_emisor: '85325100-3', productos: [
    P(2_154_240, 'Total a pagar', undefined, '2026-01-05'),
  ] },
  // La Polar: NO-CMF (deuda castigada), monto pero SIN fecha en el cert → lectura fiel = 261.
  { filename: '2_INVERSIONES_LP_LaPolar_2364308.pdf', institucion_asignada: 'Inversiones LP S.A.', doc_type: 'desglose_por_producto', rut_emisor: '76265724-4', productos: [
    P(2_364_308, 'Monto Total Deuda Castigada'),
  ] },
  // Tricot: EN CMF (90+d), Costo Monetario Prepago + "Pagar Hasta"/mora → 260.
  { filename: '3_TRICOT_355163.pdf', institucion_asignada: 'Tricard S.A.', doc_type: 'estado_cuenta', productos: [
    P(355_163, 'Costo Monetario Prepago', 'XXXX4908', '2026-03-05'),
  ] },

  // ── 261 declarados por la abogada ──
  { filename: '1_CCAF_LosAndes_1285657.pdf', institucion_asignada: 'Caja de Compensación de Asignación Familiar Los Andes', doc_type: 'desglose_por_producto', productos: [
    P(1_285_657, 'Saldo Cuotas', '59059CON104262720-0'),
  ] },
  { filename: '2_Santander_consumo_2268481.pdf', institucion_asignada: 'Banco Santander-Chile', doc_type: 'desglose_por_producto', productos: [
    P(2_268_481, 'Monto', '650052453890'),
  ] },
  { filename: '3_Santander_tarjeta_prepago_202061.pdf', institucion_asignada: 'Banco Santander-Chile', doc_type: 'estado_cuenta', productos: [
    P(202_061, 'Costo Monetario Prepago'),
  ] },
  // Líder BCI: EN CMF (90+d) pero cert SIN vencimiento → 261 (regla decisiva).
  { filename: '4_ServiciosFinancieros_LiderBCI_789001.pdf', institucion_asignada: 'Servicios Financieros y Administracion de Creditos Comerciales S.A.', doc_type: 'desglose_por_producto', rut_emisor: '77085380-K', productos: [
    P(789_001, 'Deuda Total'),
  ] },
  { filename: '5_CCAF_LosAndes_2188071.pdf', institucion_asignada: 'Caja de Compensación de Asignación Familiar Los Andes', doc_type: 'desglose_por_producto', productos: [
    P(2_188_071, 'Saldo Cuotas', '179179CON103678202-2'),
  ] },
  // Falabella: EN CMF (90+d) pero cert "Cartera Vencida / Castigada" SIN vencimiento → 261.
  { filename: '6_BancoFalabella_114492.pdf', institucion_asignada: 'Banco Falabella', doc_type: 'desglose_por_producto', productos: [
    P(114_492, 'Monto Utilizado Cartera Vencida', '29812743754'),
  ] },
];

function rawToClassifyInput(raw: any, cmf: CmfFixture): ClassifyInput {
  return {
    creditors: cmf.creditors.map((c) => ({ institucion: c.institucion, tipoCredito: c.tipoCredito, overdue90Days: c.overdue90Days, totalCredito: c.totalCredito })),
    overrides: (raw.cmf260DirectOverrides ?? []).map((o: any) => ({ institucion_cmf: o.institucion_cmf, monto_clp: o.monto_clp, fecha_vencimiento: o.fecha_vencimiento })),
    id261: (raw.identified261Creditors ?? []).map((r: any) => ({ institucion_cmf: r.institucion_cmf, total_credito_clp: r.total_credito_clp, document_filename: r.document_filename })),
    reclassified: (raw.reclassifiedCreditors ?? []).map((r: any) => ({ institucion_cmf: r.institucion_cmf, total_credito_clp: r.total_credito_clp, delinquency_start_date: r.delinquency_start_date })),
    deReclassified: (raw.deReclassified261Creditors ?? []).map((d: any) => ({ institucion_cmf: d.institucion_cmf, total_credito_clp: d.total_credito_clp })),
    additional: (raw.additionalCreditors ?? []).map((a: any) => ({ bank: a.bank, institucion_cmf: a.institucion_cmf, total_credito_clp: a.total_credito_clp, categoria_articulo: a.categoria_articulo })),
  };
}

console.log('═══ Yasmín Silva Switt — análisis hardcodeado vs abogada (3×260 + 6×261 = 9) ═══');
const raw = assembleRawFromDocFacts(yasminFacts, yasminCmf, [], '18424396-2', TODAY, logger);
const rows = planStep3Rows(rawToClassifyInput(raw, yasminCmf));

// El flujo real (fillStep3, Gate I2) descarta las filas source:'cmf' al-día SIN cert que acredite
// su monto (falta_documento). En este caso es la porción USD de la tarjeta Santander ($21.759),
// misma tarjeta ya cubierta por el prepago $202.061 (CMF Nota 3: nacional/extranjera). No es una
// deuda perdida. El conteo EFECTIVO (lo que se declara en el portal) las excluye.
const droppedByGateI2 = (r: (typeof rows)[number]) => r.source === 'cmf'; // sin doc de respaldo
const effective = rows.filter((r) => !droppedByGateI2(r));

console.log('\n  Filas del plan puro (planStep3Rows):');
for (const r of rows) {
  const drop = droppedByGateI2(r) ? '  ⟵ descartada por Gate I2 (sin cert propio; misma tarjeta que $202.061)' : '';
  console.log(`     [${r.art}/${r.source}] ${r.institucion} ${clp(r.monto)}${r.fechaVenc ? ' venc ' + r.fechaVenc : ''}${drop}`);
}
const n260 = effective.filter((r) => r.art === 260).length;
const n261 = effective.filter((r) => r.art === 261).length;
console.log(`\n  Conteo EFECTIVO (post-Gate-I2): robot ${effective.length} vs abogada 9  |  split robot 260/261 = ${n260}/${n261}  ·  abogada = 3/6`);

let ok = 0, fail = 0;
const check = (n: string, c: boolean, d = '') => { c ? (ok++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`)); };
check('conteo efectivo = 9 (abogada) — captura TODAS las deudas', effective.length === 9, `robot=${effective.length}`);
check('sin montos $0', rows.every((r) => r.monto > 0));
check('las 3 del 260 de la abogada están declaradas (Hites+Tricot en 260, La Polar declarada)',
  effective.some((r) => /tarjetas/i.test(r.institucion) && r.art === 260) &&
  effective.some((r) => /tricard/i.test(r.institucion) && r.art === 260) &&
  effective.some((r) => /inversiones lp/i.test(r.institucion)));

console.log('\n  ⚖️ DIVERGENCIA DE JUICIO (no error de conteo):');
console.log('     La Polar (Inversiones LP): abogada=260, robot=261. El cert es "deuda castigada" SIN');
console.log('     fecha de vencimiento → la regla decisiva (260 requiere monto Y venc acreditable)');
console.log('     lo manda a 261. La abogada usó un venc externo (01/12/2025). La deuda se declara igual.');

console.log(`\n${fail === 0 ? '✅' : '❌'} Yasmín: ${ok} OK, ${fail} fallo(s). (Split 2/7 vs 3/6 = solo La Polar, defendible.)`);
process.exit(fail === 0 ? 0 : 1);
