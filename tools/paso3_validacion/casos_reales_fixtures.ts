/**
 * Fixtures compartidos de los 3 casos reales con verdad-terreno de la abogada (screenshots):
 * Cristian (10), Miguel (13), Néctor (12). Construyen el CMF + DocFacts que alimentan el
 * ensamblador (`assembleRawFromDocFacts`) y la clasificación (`planStep3Rows`).
 *
 * Fuente única para test_assembler.ts (conteo por institución del ensamblador) y
 * test_step3_casos_reales.ts (conteo + split 260/261 de la capa que realmente declara).
 * Miguel usa su CMF REAL hand-fixture (montos del CMF que DIFIEREN de los certs → prueba la
 * tolerancia de pickProductForRow); Cristian y Néctor se derivan del oráculo.
 */
import { DocFacts } from '../../src/utils/sentinel_per_doc';
import { ORACLE, OracleCase, OracleProduct } from './oracle_truth';

export const TODAY = '2026-06-29';
export const UF = 40661;

export interface CmfRow { institucion: string; tipoCredito: string; totalCredito: number; overdue90Days: number; }
export interface CmfFixture {
  ufValueCLP: number; meets90DaysRequirement: boolean; meetsAmountRequirement: boolean;
  totalCreditoOf90PlusCreditors: number; qualifying90PlusCount: number; creditors: CmfRow[];
}

// ---- Caso de referencia: Miguel con su CMF REAL (montos ≠ certs) ----
export const miguelCmf: CmfFixture = {
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
// Cuando el doc trae una fecha de vencimiento, el LLM devuelve su cita verbatim (cita_fecha); la
// regla citaCorroboratesVenc la exige para clasificar 260. La simulamos fielmente aquí.
const P = (monto: number, etiqueta: string, op?: string, fecha_mora?: string, moneda: 'CLP' | 'UF' = 'CLP') =>
  ({ operacion: op, monto, etiqueta_monto: etiqueta, moneda, fecha_mora,
     cita_monto: `${etiqueta}: $${monto.toLocaleString('es-CL')}`,
     cita_fecha: fecha_mora ? `Fecha de vencimiento ${fecha_mora}` : undefined, confidence: 0.95 });
export const miguelFacts: DocFacts[] = [
  { filename: 'ESTADO DE DEUDA - Banco de Chile.pdf', institucion_asignada: 'Banco de Chile', doc_type: 'desglose_por_producto', rut_emisor: '97004000-5', productos: [
    P(606_175, 'LINEA DE CREDITO / CTA CTE Total deuda prejudicial', '72012', '2026-02-18'),
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
export function cmfFromOracle(oc: OracleCase): CmfFixture {
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
export function docFactsFromOracle(oc: OracleCase): DocFacts[] {
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
      cita_fecha: p.seccion === 260 ? 'Fecha de vencimiento 2026-01-15' : undefined,
      confidence: 0.95,
    });
  }
  return [...byDoc.values()];
}

/** Los 3 casos listos para correr: (label, cmf, facts, oracle). */
export function casosReales(): { label: string; cmf: CmfFixture; facts: DocFacts[]; oc: OracleCase }[] {
  return [
    { label: 'Cristian Mancilla', cmf: cmfFromOracle(ORACLE.cristian_mancilla), facts: docFactsFromOracle(ORACLE.cristian_mancilla), oc: ORACLE.cristian_mancilla },
    { label: 'Miguel Lugo (CMF real)', cmf: miguelCmf, facts: miguelFacts, oc: ORACLE.miguel_lugo },
    { label: 'Néctor Ruiz', cmf: cmfFromOracle(ORACLE.nector_ruiz), facts: docFactsFromOracle(ORACLE.nector_ruiz), oc: ORACLE.nector_ruiz },
  ];
}
