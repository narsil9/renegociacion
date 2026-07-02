/**
 * TEST end-to-end de la CAPA QUE DECLARA (`planStep3Rows`) sobre los 3 casos reales con
 * verdad-terreno de la abogada (screenshots): Cristian (10), Miguel (13), Néctor (12).
 *
 * Pipeline: fixtures → assembleRawFromDocFacts (ensamblador) → planStep3Rows (clasificación
 * final 260/261 + multiproducto). Comprueba que el CONTEO total de filas iguala el de la
 * abogada (métrica primaria pedida por el usuario: "misma cantidad de deudas"), e imprime el
 * split 260/261 declarado vs el de la abogada (informativo: el robot puede poner MÁS en 260 si
 * el cert acredita venc — regla del usuario, no es error).
 *
 * NO corre los backstops post-LLM (requieren PDFs reales; se validan en test_backstops_golden).
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_step3_casos_reales.ts
 */
import { assembleRawFromDocFacts } from '../../src/utils/sentinel_per_doc';
import { planStep3Rows, ClassifyInput } from '../../src/automation/step3_classify';
import { casosReales, TODAY } from './casos_reales_fixtures';
import { OracleCase } from './oracle_truth';

const logger = { log: (_: string) => {}, error: (m: string) => console.error(m) };
let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const clp = (n: number) => '$' + n.toLocaleString('es-CL');

function rawToClassifyInput(raw: any, cmf: any): ClassifyInput {
  return {
    creditors: cmf.creditors.map((c: any) => ({ institucion: c.institucion, tipoCredito: c.tipoCredito, overdue90Days: c.overdue90Days, totalCredito: c.totalCredito })),
    overrides: (raw.cmf260DirectOverrides ?? []).map((o: any) => ({ institucion_cmf: o.institucion_cmf, monto_clp: o.monto_clp, fecha_vencimiento: o.fecha_vencimiento })),
    id261: (raw.identified261Creditors ?? []).map((r: any) => ({ institucion_cmf: r.institucion_cmf, total_credito_clp: r.total_credito_clp, document_filename: r.document_filename })),
    reclassified: (raw.reclassifiedCreditors ?? []).map((r: any) => ({ institucion_cmf: r.institucion_cmf, total_credito_clp: r.total_credito_clp, delinquency_start_date: r.delinquency_start_date })),
    deReclassified: (raw.deReclassified261Creditors ?? []).map((d: any) => ({ institucion_cmf: d.institucion_cmf, total_credito_clp: d.total_credito_clp })),
    additional: (raw.additionalCreditors ?? []).map((a: any) => ({ bank: a.bank, institucion_cmf: a.institucion_cmf, total_credito_clp: a.total_credito_clp, categoria_articulo: a.categoria_articulo })),
  };
}

function run(label: string, cmf: any, facts: any, oc: OracleCase) {
  console.log(`\n══════════ ${label} (abogada declaró ${oc.total}) ══════════`);
  const raw = assembleRawFromDocFacts(facts, cmf, [], oc.rut, TODAY, logger);
  const rows = planStep3Rows(rawToClassifyInput(raw, cmf));
  const n260 = rows.filter((r) => r.art === 260).length;
  const n261 = rows.filter((r) => r.art === 261).length;
  const abog260 = oc.productos.filter((p) => p.seccion === 260).length;
  const abog261 = oc.productos.filter((p) => p.seccion === 261).length;
  for (const r of rows) console.log(`     [${r.art}/${r.source}] ${r.institucion} ${clp(r.monto)}${r.fechaVenc ? ' venc ' + r.fechaVenc : ''}`);
  console.log(`   Conteo: robot ${rows.length} vs abogada ${oc.total}  |  split robot 260/261 = ${n260}/${n261}  ·  abogada = ${abog260}/${abog261}`);
  check(`${label}: conteo total = abogada (${oc.total})`, rows.length === oc.total, `robot=${rows.length}`);
  check(`${label}: split 260/261 = abogada (${abog260}/${abog261})`, n260 === abog260 && n261 === abog261, `robot ${n260}/${n261}`);
  check(`${label}: sin montos $0`, rows.every((r) => r.monto > 0));
}

console.log('═══ planStep3Rows sobre casos reales (vs screenshots de la abogada) ═══');
for (const c of casosReales()) run(c.label, c.cmf, c.facts, c.oc);

console.log(`\n${fail === 0 ? '✅' : '❌'} casos reales: ${ok} OK, ${fail} fallos.`);
process.exit(fail === 0 ? 0 : 1);
