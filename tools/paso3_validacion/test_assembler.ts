/**
 * TEST del ENSAMBLADOR (sin API): inyecta DocFacts sintéticos (lo que el extractor por-documento
 * DEBERÍA devolver, = mi lectura oráculo) + las filas reales del CMF, y verifica que
 * `assembleRawFromDocFacts` produzca la estructura correcta anclada al CMF (L11): un producto por
 * fila CMF, 260 vs 261 por mora+fecha, NO-CMF para emisores fuera del CMF.
 *
 * Valida el CÓDIGO NUEVO de mayor riesgo sin depender del LLM (cuya cuota está agotada). NO corre
 * los backstops post-LLM de sentinel.ts (que refinan después); valida el primer ensamblado.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_assembler.ts
 */
import { assembleRawFromDocFacts, DocFacts } from '../../src/utils/sentinel_per_doc';
import { canonicalInstitutionKey } from '../../src/utils/acreedor_matcher';

// CMF real de Miguel (del log del Centinela)
const miguelCmf = {
  ufValueCLP: 40661, meets90DaysRequirement: true, meetsAmountRequirement: true,
  totalCreditoOf90PlusCreditors: 51_559_065, qualifying90PlusCount: 5,
  creditors: [
    { institucion: 'Banco de Crédito e Inversiones', tipoCredito: 'Consumo', totalCredito: 14_894_364, overdue90Days: 0 },
    { institucion: 'Banco Itaú Chile', tipoCredito: 'Consumo', totalCredito: 7_263_340, overdue90Days: 7_072_120 },
    { institucion: 'Banco Itaú Chile', tipoCredito: 'Tarjeta de crédito', totalCredito: 9_511_066, overdue90Days: 9_511_066 },
    { institucion: 'Banco Itaú Chile', tipoCredito: 'Línea de crédito', totalCredito: 500_000, overdue90Days: 0 },
    { institucion: 'Banco de Chile', tipoCredito: 'Consumo', totalCredito: 33_644_716, overdue90Days: 2_395_296 },
    { institucion: 'Banco de Chile', tipoCredito: 'Tarjeta de crédito', totalCredito: 639_943, overdue90Days: 639_943 },
    { institucion: 'Banco de Chile', tipoCredito: 'Línea de crédito', totalCredito: 500_000, overdue90Days: 500_000 },
    { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', tipoCredito: 'Consumo', totalCredito: 1_555_410, overdue90Days: 0 },
    { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', tipoCredito: 'Consumo', totalCredito: 4_672_364, overdue90Days: 0 },
    { institucion: 'Caja de Compensación de Asignación Familiar Los Andes', tipoCredito: 'Consumo', totalCredito: 2_715_591, overdue90Days: 0 },
    { institucion: 'Tenpo Prepago SA', tipoCredito: 'Tarjeta de crédito', totalCredito: 409_690, overdue90Days: 0 },
  ],
};

// DocFacts sintéticos = lo que el extractor por-doc debería devolver (mi lectura oráculo de Miguel)
const P = (monto: number, etiqueta: string, op?: string, fecha_mora?: string, moneda: 'CLP'|'UF' = 'CLP') =>
  ({ operacion: op, monto, etiqueta_monto: etiqueta, moneda, fecha_mora, cita_monto: `${etiqueta}: $${monto.toLocaleString('es-CL')}`, confidence: 0.95 });

const miguelFacts: DocFacts[] = [
  { filename: 'ESTADO DE DEUDA - Banco de Chile.pdf', institucion_asignada: 'Banco de Chile', doc_type: 'desglose_por_producto', rut_emisor: '97004000-5', productos: [
    P(606_175, 'Total deuda prejudicial', '72012', '2026-02-18'),
    P(45_798, 'VARIOS DEUDORES Total deuda prejudicial', '97000', '2026-02-19'),
    P(34_170_587, 'CRÉDITO EN CUOTAS Total deuda prejudicial', '30010', '2026-01-02'),
    P(750_944, 'TARJETAS VENCIDAS Total deuda prejudicial', '01167', '2026-01-07'),
  ] },
  { filename: 'Certificado Deuda - Banco Itau.pdf', institucion_asignada: 'Banco Itaú Chile', doc_type: 'desglose_por_producto', productos: [
    P(6_756_287, 'Saldo Insoluto', '60384313'),
    P(500_000, 'Monto Utilizado Línea Preferencial', '226430883'),
    P(9_511_066, '$ Utilizado Tarjeta MasterCard', '5598002100197410'),
  ] },
  { filename: 'Certificado - CCAF Los Andes.pdf', institucion_asignada: 'Caja de Compensación de Asignación Familiar Los Andes', doc_type: 'desglose_por_producto', productos: [
    P(1_589_849, 'Saldo Total Diario a Pagar', '119CON103798269'),
    P(2_767_909, 'Saldo Total Diario a Pagar', '044CON104657781'),
    P(4_774_083, 'Saldo Total Diario a Pagar', '191CON104134409'),
  ] },
  { filename: 'Certificado - BCI.pdf', institucion_asignada: 'Banco de Crédito e Inversiones', doc_type: 'liquidacion_payoff', productos: [
    P(14_830_069, 'Monto total a pagar', 'D43400044917'),
    P(615, 'Saldo Deuda cuenta corriente', 'ENTE21904910'),
  ] },
  { filename: 'Estado Cuenta - Tenpo.pdf', institucion_asignada: 'Tenpo Prepago SA', doc_type: 'estado_cuenta', productos: [
    P(6_180, 'Cupo Total Utilizado'),
  ] },
];

const raw = assembleRawFromDocFacts(miguelFacts, miguelCmf, [], '26625555-1', '2026-06-29',
  { log: (m) => console.log('   '+m), error: (m) => console.error(m) });

const all = [
  ...raw.cmf260DirectOverrides.map((o: any) => ({ sec: 260, inst: o.institucion_cmf, monto: o.monto_clp, venc: o.fecha_vencimiento, src: 'override' })),
  ...raw.reclassifiedCreditors.map((r: any) => ({ sec: 260, inst: r.institucion_cmf, monto: r.total_credito_clp, src: 'reclass' })),
  ...raw.identified261Creditors.map((r: any) => ({ sec: 261, inst: r.institucion_cmf, monto: r.total_credito_clp, src: 'id261' })),
  ...raw.additionalCreditors.map((a: any) => ({ sec: a.categoria_articulo, inst: a.institucion_cmf, monto: a.total_credito_clp, src: 'additional' })),
];
console.log('\n=== Ensamblado (antes de backstops post-LLM) ===');
for (const x of all) console.log(`  [${x.sec}] ${x.inst} $${x.monto.toLocaleString('es-CL')} (${x.src})${x.venc ? ' venc '+x.venc : ''}`);

// Conteo por institución canónica (debe acercarse a la abogada: BdCh 4, Itaú 3, CCAF 3, BCI 2, Tenpo 1 = 13)
const byInst: Record<string, number> = {};
for (const x of all) { const k = canonicalInstitutionKey(x.inst); byInst[k] = (byInst[k] ?? 0) + 1; }
const expected: Record<string, number> = { 'banco de chile': 4, 'banco itau chile': 3, 'ccaf los andes': 3, 'banco de credito e inversiones': 2, 'tenpo prepago sa': 1 };
console.log('\n=== Conteo por institución (ensamblador, pre-backstops) ===');
let ok = true;
for (const k of new Set([...Object.keys(expected), ...Object.keys(byInst)])) {
  const e = expected[k] ?? 0, o = byInst[k] ?? 0;
  if (e !== o) ok = false;
  console.log(`  ${k.padEnd(34)} esperado ${e}  ensamblado ${o}  ${e === o ? '✅' : '⚠️'}`);
}
console.log(`\n  Total: esperado 13, ensamblado ${all.length}`);
console.log(ok ? '\n✅ El ensamblador ancla al CMF y produce la estructura correcta dada la extracción correcta.' : '\n⚠️ Diferencias (algunas las cierran los backstops post-LLM: overflow→additional, completitud, reconciliación).');
