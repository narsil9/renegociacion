/**
 * TEST de RAMAS del ENSAMBLADOR (sin API): fixtures mínimos (1-2 filas CMF + 1 doc) que aíslan
 * CADA decisión de `assembleRawFromDocFacts`, ejercitando indirectamente los helpers puros
 * (productTypeOf, daysBetween, pickProductForRow, issuerInCmf). Cubre: multiproducto, UF→CLP,
 * NO-CMF 260/261, overflow→id261, gate 260 vs 261 a nivel ensamblador, CMF que parte 1 crédito
 * en 2 filas (mora+vigente → 1 sola declaración), docs sin productos (comprobante saltado vs
 * resumen global), y el tipo de producto por rótulo.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_assembler_edge.ts
 */
import { assembleRawFromDocFacts, DocFacts } from '../../src/utils/sentinel_per_doc';

const TODAY = '2026-06-29';
const UF = 40661;
const silent = { log: () => {}, error: () => {} };

interface Row { institucion: string; tipoCredito: string; totalCredito: number; overdue90Days: number; }
function assemble(facts: DocFacts[], creditors: Row[]) {
  return assembleRawFromDocFacts(
    facts,
    { creditors, ufValueCLP: UF, meets90DaysRequirement: true, meetsAmountRequirement: true, totalCreditoOf90PlusCreditors: 0, qualifying90PlusCount: 0 },
    [], '11111111-1', TODAY, silent
  );
}
function allRows(raw: any): any[] {
  return [...raw.cmf260DirectOverrides, ...raw.reclassifiedCreditors, ...raw.identified261Creditors, ...raw.additionalCreditors];
}
const prod = (monto: number, etiqueta: string, extra: Partial<DocFacts['productos'][number]> = {}) =>
  ({ monto, etiqueta_monto: etiqueta, moneda: 'CLP' as const, cita_monto: `${etiqueta}: $${monto}`, confidence: 0.95, ...extra });

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('═══ Ramas del ensamblador ═══');

// 1. multiproducto: 2 ops en el cert, 1 fila CMF → 2 declaraciones (1 anclada + 1 overflow)
{
  const raw = assemble(
    [{ filename: 'cert.pdf', institucion_asignada: 'Banco Uno', doc_type: 'desglose_por_producto', productos: [prod(1_000_000, 'Saldo', { operacion: 'A' }), prod(2_000_000, 'Saldo', { operacion: 'B' })] }],
    [{ institucion: 'Banco Uno', tipoCredito: 'Consumo', totalCredito: 1_000_000, overdue90Days: 0 }]
  );
  check('multiproducto: 2 productos / 1 fila CMF → 2 entradas', allRows(raw).length === 2, `got ${allRows(raw).length}`);
}

// 2. UF→CLP: producto en UF → monto_clp = round(uf * tasa); product_type 'otro'
{
  const raw = assemble(
    [{ filename: 'hipo.pdf', institucion_asignada: 'Banco Hipo', doc_type: 'desglose_por_producto', productos: [prod(1000, 'Saldo hipotecario', { moneda: 'UF', operacion: 'H' })] }],
    [{ institucion: 'Banco Hipo', tipoCredito: 'Vivienda', totalCredito: 40_000_000, overdue90Days: 0 }]
  );
  const r = raw.identified261Creditors[0];
  check('UF→CLP: monto convertido = round(1000 × UF)', r && r.total_credito_clp === Math.round(1000 * UF), `got ${r?.total_credito_clp}`);
  check('UF: product_type = otro', r && r.product_type === 'otro', `got ${r?.product_type}`);
}

// 3a. NO-CMF con mora ≥91d → additionalCreditor Art. 260
{
  const raw = assemble(
    [{ filename: 'fintech.pdf', institucion_asignada: 'Fintech Z', doc_type: 'estado_cuenta', productos: [prod(500_000, 'Saldo', { fecha_mora: '2026-01-01' })] }],
    [{ institucion: 'Otro Banco', tipoCredito: 'Consumo', totalCredito: 9_000_000, overdue90Days: 0 }]
  );
  const a = raw.additionalCreditors[0];
  check('NO-CMF con mora ≥91d → additional Art. 260', a && a.categoria_articulo === 260 && a.delinquency_days >= 91, `got ${a?.categoria_articulo}/${a?.delinquency_days}`);
}
// 3b. NO-CMF sin fecha → Art. 261
{
  const raw = assemble(
    [{ filename: 'fintech.pdf', institucion_asignada: 'Fintech Z', doc_type: 'estado_cuenta', productos: [prod(500_000, 'Saldo')] }],
    [{ institucion: 'Otro Banco', tipoCredito: 'Consumo', totalCredito: 9_000_000, overdue90Days: 0 }]
  );
  const a = raw.additionalCreditors[0];
  check('NO-CMF sin fecha de mora → additional Art. 261', a && a.categoria_articulo === 261, `got ${a?.categoria_articulo}`);
}

// 4. overflow: 3 productos, 1 fila CMF → 3 id261 (el backstop luego promueve los excedentes)
{
  const raw = assemble(
    [{ filename: 'multi.pdf', institucion_asignada: 'Banco Tres', doc_type: 'desglose_por_producto', productos: [prod(1_000_000, 'S', { operacion: 'A' }), prod(2_000_000, 'S', { operacion: 'B' }), prod(3_000_000, 'S', { operacion: 'C' })] }],
    [{ institucion: 'Banco Tres', tipoCredito: 'Consumo', totalCredito: 1_000_000, overdue90Days: 0 }]
  );
  check('overflow: 3 productos / 1 fila → 3 entradas', allRows(raw).length === 3, `got ${allRows(raw).length}`);
}

// 5a. gate ensamblador: CMF overdue>0 + fecha_mora → override CON fecha
{
  const raw = assemble(
    [{ filename: 'c.pdf', institucion_asignada: 'Banco Mora', doc_type: 'desglose_por_producto', productos: [prod(5_000_000, 'Saldo', { fecha_mora: '2026-01-01', operacion: 'X' })] }],
    [{ institucion: 'Banco Mora', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 5_000_000 }]
  );
  const o = raw.cmf260DirectOverrides[0];
  check('CMF 90+d + fecha → override con fecha_vencimiento', o && o.fecha_vencimiento === '2026-01-01', `got ${o?.fecha_vencimiento}`);
}
// 5b. CMF overdue=0 + mora≥91d acreditada → reclassified (261→260)
{
  const raw = assemble(
    [{ filename: 'c.pdf', institucion_asignada: 'Banco Recl', doc_type: 'desglose_por_producto', productos: [prod(5_000_000, 'Saldo', { fecha_mora: '2026-01-01' })] }],
    [{ institucion: 'Banco Recl', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 0 }]
  );
  check('CMF al día + mora ≥91d en doc → reclassified', raw.reclassifiedCreditors.length === 1, `got ${raw.reclassifiedCreditors.length}`);
}
// 5c. CMF overdue=0 + sin fecha → id261
{
  const raw = assemble(
    [{ filename: 'c.pdf', institucion_asignada: 'Banco Vig', doc_type: 'desglose_por_producto', productos: [prod(5_000_000, 'Saldo')] }],
    [{ institucion: 'Banco Vig', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 0 }]
  );
  check('CMF al día + sin fecha → id261', raw.identified261Creditors.length === 1 && raw.cmf260DirectOverrides.length === 0, `id261=${raw.identified261Creditors.length}`);
}

// 6. CMF parte 1 crédito en 2 filas (mora + vigente, mismo monto) + 1 producto → 1 sola declaración
{
  const raw = assemble(
    [{ filename: 'liq.pdf', institucion_asignada: 'Banco Split', doc_type: 'liquidacion_payoff', productos: [prod(5_000_000, 'Saldo total a pagar', { operacion: 'S' })] }],
    [
      { institucion: 'Banco Split', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 5_000_000 },
      { institucion: 'Banco Split', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 0 },
    ]
  );
  check('CMF 1 crédito en 2 filas (mora+vigente) + 1 cert → 1 declaración', allRows(raw).length === 1, `got ${allRows(raw).length}`);
}

// 7a. doc sin productos: comprobante_pago se SALTA (aunque traiga monto) → 0 contribución
{
  const raw = assemble(
    [{ filename: 'comprobante.pdf', institucion_asignada: 'Banco Comp', doc_type: 'comprobante_pago', productos: [prod(9_000_000, 'Pago realizado')] }],
    [{ institucion: 'Banco Comp', tipoCredito: 'Consumo', totalCredito: 9_000_000, overdue90Days: 0 }]
  );
  check('comprobante_pago no aporta productos → 0 entradas', allRows(raw).length === 0, `got ${allRows(raw).length}`);
}
// 7b. resumen_global SÍ habilita declarar la fila CMF (monto del CMF) aunque no haya desglose
{
  const raw = assemble(
    [{ filename: 'global.pdf', institucion_asignada: 'Banco Glob', doc_type: 'resumen_global', productos: [], totales_por_moneda: [{ moneda: 'CLP', monto: 3_000_000, cita: 'Total $3.000.000' }] }],
    [{ institucion: 'Banco Glob', tipoCredito: 'Consumo', totalCredito: 3_000_000, overdue90Days: 0 }]
  );
  const r = raw.identified261Creditors[0];
  check('resumen_global → id261 con monto del CMF', allRows(raw).length === 1 && r && r.total_credito_clp === 3_000_000, `got ${allRows(raw).length}/${r?.total_credito_clp}`);
}

// 8. product_type por rótulo: "Tarjeta/Visa/Cupo" → tarjeta_credito
{
  const raw = assemble(
    [{ filename: 't.pdf', institucion_asignada: 'Banco Tar', doc_type: 'desglose_por_producto', productos: [prod(800_000, 'Cupo Utilizado Tarjeta Visa')] }],
    [{ institucion: 'Banco Tar', tipoCredito: 'Tarjeta de crédito', totalCredito: 800_000, overdue90Days: 0 }]
  );
  const r = raw.identified261Creditors[0];
  check('rótulo "Tarjeta/Visa/Cupo" → product_type tarjeta_credito', r && r.product_type === 'tarjeta_credito', `got ${r?.product_type}`);
}

console.log(`\nRamas del ensamblador: ${ok} OK, ${fail} fallidos`);
if (fail > 0) process.exit(1);
