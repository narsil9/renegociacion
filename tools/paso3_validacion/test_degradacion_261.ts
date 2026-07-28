/**
 * TEST de la degradación 260 → 261: cada fila tiene que decir POR QUÉ.
 *
 * Motivación: la pregunta "¿por qué esta deuda quedó en 261 y no en 260?" no se podía
 * contestar desde la base. El `reason` era una constante idéntica para las tres ramas y
 * la evidencia no se propagaba.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_degradacion_261.ts
 */
import { applyDeterministicBackstops } from '../../src/utils/sentinel_backstops';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const noop = () => {};

// Solo los dos ALCANZABLES. El "banco ya cubierto" no emite fila (ver la nota de esta tarea).
const RULE_IDS = ['BACKSTOP_OVERRIDE_DEGRADADO', 'BACKSTOP_SIN_DOCUMENTO'];

console.log('═══ degradación 260→261: rule_id + evidencia ═══');

// Rama 3 — banco con mora 90+d en el CMF y SIN ningún documento.
{
  const result: any = {
    reclassifiedCreditors: [], identified261Creditors: [], additionalCreditors: [],
    cmf260DirectOverrides: [], deReclassified261Creditors: [], fechasClave: [],
  };
  const ctx: any = {
    cmfCreditors: [{ institucion: 'Banco Falabella', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 5_000_000 }],
    documents: [], certificateAnalyses: [], catalog: [], clientRut: null, todayDate: new Date('2026-07-27'),
  };
  applyDeterministicBackstops(result, ctx, noop);
  const filas = result.deReclassified261Creditors ?? [];
  check('rama sin documento produce una degradación', filas.length === 1, JSON.stringify(filas));
  if (filas.length === 1) {
    check('lleva rule_id', typeof filas[0].rule_id === 'string' && filas[0].rule_id.length > 0, JSON.stringify(filas[0]));
    check('el rule_id es uno de los tres conocidos', RULE_IDS.includes(filas[0].rule_id), filas[0].rule_id);
    check('el rule_id identifica la rama correcta', filas[0].rule_id === 'BACKSTOP_SIN_DOCUMENTO', filas[0].rule_id);
    check('el reason menciona el banco', String(filas[0].reason).includes('Falabella'), filas[0].reason);
  }
}

// Contrato general: ninguna degradación puede salir sin rule_id.
{
  const result: any = {
    reclassifiedCreditors: [], identified261Creditors: [], additionalCreditors: [],
    cmf260DirectOverrides: [], deReclassified261Creditors: [], fechasClave: [],
  };
  const ctx: any = {
    cmfCreditors: [
      { institucion: 'Banco Falabella', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 5_000_000 },
      { institucion: 'Banco Estado', tipoCredito: 'Consumo', totalCredito: 3_000_000, overdue90Days: 3_000_000 },
    ],
    documents: [], certificateAnalyses: [], catalog: [], clientRut: null, todayDate: new Date('2026-07-27'),
  };
  applyDeterministicBackstops(result, ctx, noop);
  const filas = result.deReclassified261Creditors ?? [];
  check('toda degradación lleva rule_id', filas.length > 0 && filas.every((f: any) => RULE_IDS.includes(f.rule_id)),
    JSON.stringify(filas.map((f: any) => f.rule_id)));
  // Los dos bancos caen por la MISMA rama (ninguno tiene documento), así que comparten rule_id.
  // Lo que tiene que distinguirlos es el banco, no la regla.
  check('los dos bancos degradan por falta de documento',
    filas.length === 2 && filas.every((f: any) => f.rule_id === 'BACKSTOP_SIN_DOCUMENTO'),
    JSON.stringify(filas.map((f: any) => f.rule_id)));
  check('cada fila identifica su banco',
    new Set(filas.map((f: any) => f.institucion_cmf)).size === filas.length,
    JSON.stringify(filas.map((f: any) => f.institucion_cmf)));
}

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
