/**
 * TEST del ENSAMBLADOR (sin API) para los 3 casos reales (Cristian 10, Miguel 13, Néctor 12).
 *
 * Inyecta DocFacts sintéticos (= la lectura ORÁCULO, lo que el extractor por-documento debería
 * devolver) + las filas del CMF, y verifica que `assembleRawFromDocFacts` produzca la estructura
 * correcta anclada al CMF (L11): un producto por fila CMF, 260 vs 261 por mora+fecha, NO-CMF para
 * emisores fuera del CMF, multiproducto, UF→CLP. El conteo por institución debe igualar el de la
 * abogada (derivado de oracle_truth.ts). Valida el ensamblador SIN API.
 *
 * - Miguel usa su CMF REAL hand-fixture (montos del CMF que DIFIEREN de los certs → prueba la
 *   tolerancia de pickProductForRow).
 * - Cristian y Néctor se construyen desde oracle_truth.ts (CMF y DocFacts derivados de la verdad).
 *
 * NO corre los backstops post-LLM (eso lo hace test_backstops_golden.ts); valida el primer ensamblado.
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_assembler.ts
 */
import { assembleRawFromDocFacts, DocFacts } from '../../src/utils/sentinel_per_doc';
import { canonicalInstitutionKey } from '../../src/utils/acreedor_matcher';
import { ORACLE, OracleCase, OracleProduct } from './oracle_truth';

const TODAY = '2026-06-29';
const UF = 40661;

interface CmfRow { institucion: string; tipoCredito: string; totalCredito: number; overdue90Days: number; }
interface CmfFixture {
  ufValueCLP: number; meets90DaysRequirement: boolean; meetsAmountRequirement: boolean;
  totalCreditoOf90PlusCreditors: number; qualifying90PlusCount: number; creditors: CmfRow[];
}

const log = (m: string) => console.log('   ' + m);
const logger = { log, error: (m: string) => console.error(m) };

// ---- Caso de referencia: Miguel con su CMF REAL (montos ≠ certs) ----
const miguelCmf: CmfFixture = {
  ufValueCLP: UF, meets90DaysRequirement: true, meetsAmountRequirement: true,
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

// ---- Builders genéricos desde el oráculo (Cristian, Néctor) ----
function tipoFromNota(p: OracleProduct): string {
  const t = `${p.nota ?? ''} ${p.doc}`.toLowerCase();
  if (p.moneda === 'UF' || /hipotec|vivienda/.test(t)) return 'Vivienda';
  if (/tarjeta|visa|cmr|cat\b/.test(t)) return 'Tarjeta de crédito';
  if (/l[ií]nea/.test(t)) return 'Línea de crédito';
  return 'Consumo';
}
function labelFromNota(p: OracleProduct): string {
  const t = `${p.nota ?? ''}`.toLowerCase();
  if (p.moneda === 'UF' || /hipotec|vivienda/.test(t)) return 'Saldo hipotecario';
  if (/tarjeta|visa|cmr|cat\b/.test(t)) return 'Cupo Utilizado Tarjeta';
  if (/l[ií]nea/.test(t)) return 'Saldo línea de crédito';
  return 'Saldo Insoluto';
}
/** Monto en la moneda del documento: para UF parsea la cifra UF de la nota ("3.538,959 UF"). */
function docMonto(p: OracleProduct): number {
  if (p.moneda !== 'UF') return p.monto;
  const m = (p.nota ?? '').match(/([\d.]+,\d+|\d[\d.]*)\s*UF/i);
  if (m) return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  return Math.round(p.monto / UF);
}
function cmfFromOracle(oc: OracleCase): CmfFixture {
  const creditors: CmfRow[] = oc.productos
    .filter((p) => p.cmf)
    .map((p) => ({ institucion: p.institucion, tipoCredito: tipoFromNota(p), totalCredito: p.monto, overdue90Days: p.seccion === 260 ? p.monto : 0 }));
  const q90 = creditors.filter((c) => c.overdue90Days > 0);
  return {
    ufValueCLP: UF, meets90DaysRequirement: q90.length >= 2, meetsAmountRequirement: true,
    totalCreditoOf90PlusCreditors: q90.reduce((s, c) => s + c.totalCredito, 0), qualifying90PlusCount: q90.length,
    creditors,
  };
}
function docFactsFromOracle(oc: OracleCase): DocFacts[] {
  const byDoc = new Map<string, DocFacts>();
  for (const p of oc.productos) {
    if (!byDoc.has(p.doc)) {
      byDoc.set(p.doc, { filename: p.doc, institucion_asignada: p.institucion, doc_type: /liquidacion|payoff/i.test(p.doc) ? 'liquidacion_payoff' : 'desglose_por_producto', productos: [] });
    }
    const monto = docMonto(p);
    const label = labelFromNota(p);
    byDoc.get(p.doc)!.productos.push({
      operacion: p.operacion,
      monto,
      etiqueta_monto: label,
      moneda: p.moneda ?? 'CLP',
      fecha_mora: p.seccion === 260 ? '2026-01-15' : undefined,
      cita_monto: `${label}: ${p.moneda === 'UF' ? monto + ' UF' : '$' + monto.toLocaleString('es-CL')}`,
      confidence: 0.95,
    });
  }
  return [...byDoc.values()];
}

// ---- Runner genérico ----
function countByKey(rows: { institucion_cmf?: string; bank?: string }[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of rows) { const k = canonicalInstitutionKey(r.institucion_cmf ?? r.bank ?? ''); acc[k] = (acc[k] ?? 0) + 1; }
  return acc;
}
function expectedFromOracle(oc: OracleCase): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const p of oc.productos) { const k = canonicalInstitutionKey(p.institucion); acc[k] = (acc[k] ?? 0) + 1; }
  return acc;
}

function runCase(label: string, cmf: CmfFixture, facts: DocFacts[], oc: OracleCase): boolean {
  console.log(`\n══════════ ${label} (esperado ${oc.total}) ══════════`);
  const raw = assembleRawFromDocFacts(facts, cmf, [], oc.rut, TODAY, logger);
  const all = [
    ...raw.cmf260DirectOverrides.map((o: any) => ({ institucion_cmf: o.institucion_cmf, monto: o.monto_clp, src: '260' })),
    ...raw.reclassifiedCreditors.map((r: any) => ({ institucion_cmf: r.institucion_cmf, monto: r.total_credito_clp, src: 'reclass' })),
    ...raw.identified261Creditors.map((r: any) => ({ institucion_cmf: r.institucion_cmf, monto: r.total_credito_clp, src: 'id261' })),
    ...raw.additionalCreditors.map((a: any) => ({ institucion_cmf: a.institucion_cmf, monto: a.total_credito_clp, src: `NO-CMF/${a.categoria_articulo}` })),
  ];
  for (const x of all) log(`[${x.src}] ${x.institucion_cmf} $${x.monto.toLocaleString('es-CL')}`);

  const exp = expectedFromOracle(oc);
  const got = countByKey(all);
  let ok = all.length === oc.total;
  console.log(`   — conteo por institución —`);
  for (const k of new Set([...Object.keys(exp), ...Object.keys(got)])) {
    const e = exp[k] ?? 0, g = got[k] ?? 0;
    if (e !== g) ok = false;
    console.log(`     ${k.padEnd(40)} esperado ${e}  ensamblado ${g}  ${e === g ? '✅' : '⚠️'}`);
  }
  console.log(`   Total: esperado ${oc.total}, ensamblado ${all.length}  ${ok ? '✅' : '⚠️'}`);
  return ok;
}

const results = [
  runCase('Cristian Mancilla', cmfFromOracle(ORACLE.cristian_mancilla), docFactsFromOracle(ORACLE.cristian_mancilla), ORACLE.cristian_mancilla),
  runCase('Miguel Lugo (CMF real)', miguelCmf, miguelFacts, ORACLE.miguel_lugo),
  runCase('Néctor Ruiz', cmfFromOracle(ORACLE.nector_ruiz), docFactsFromOracle(ORACLE.nector_ruiz), ORACLE.nector_ruiz),
];

const passed = results.filter(Boolean).length;
console.log(`\n════════════════════════════════════════`);
console.log(`Ensamblador: ${passed}/${results.length} casos OK`);
if (passed !== results.length) { console.error('⚠️ El ensamblador no reprodujo la estructura del oráculo en algún caso.'); process.exit(1); }
console.log('✅ El ensamblador ancla al CMF y reproduce la estructura de la abogada en los 3 casos.');
