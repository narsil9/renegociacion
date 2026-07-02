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
import { ORACLE, OracleCase } from './oracle_truth';
import { CmfFixture, cmfFromOracle, docFactsFromOracle, miguelCmf, miguelFacts, TODAY } from './casos_reales_fixtures';

const log = (m: string) => console.log('   ' + m);
const logger = { log, error: (m: string) => console.error(m) };

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
