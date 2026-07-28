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

// Rama 1 — banco con mora 90+d en el CMF que YA tiene override(s) Art. 260 pero SIN fecha
// de vencimiento acreditada: se degrada CADA override a su PROPIO monto (no el total del
// CMF, para no doble-contar un banco multiproducto) y se propaga su `evidence`. Antes de
// esta tarea, todos los tests inicializaban cmf260DirectOverrides: [] → esta rama nunca se
// ejecutó (overridesForKey.length > 0 nunca era cierto). Se usan DOS overrides del mismo
// banco (como el caso real "Santander multiproducto" que menciona el comentario del código)
// para verificar que la degradación es POR override, no una sola fila por banco.
{
  const result: any = {
    reclassifiedCreditors: [], identified261Creditors: [], additionalCreditors: [],
    cmf260DirectOverrides: [
      {
        institucion_cmf: 'Banco Santander',
        monto_clp: 1_200_000,
        fecha_vencimiento: '',
        document_filename: 'santander_cre.pdf',
        evidence: { cita_monto: 'Saldo Insoluto: $1.200.000 [TEST-CASO1-A]', confidence: 0.9 },
      },
      {
        institucion_cmf: 'Banco Santander',
        monto_clp: 350_000,
        fecha_vencimiento: '',
        document_filename: 'santander_tc.pdf',
        evidence: { cita_monto: 'Cupo Utilizado: $350.000 [TEST-CASO1-B]', confidence: 0.85 },
      },
    ],
    deReclassified261Creditors: [], fechasClave: [],
  };
  const ctx: any = {
    cmfCreditors: [
      { institucion: 'Banco Santander', tipoCredito: 'Consumo', totalCredito: 9_000_000, overdue90Days: 9_000_000 },
    ],
    documents: [], certificateAnalyses: [], catalog: [], clientRut: null, todayDate: new Date('2026-07-27'),
  };
  applyDeterministicBackstops(result, ctx, noop);

  const degradadas = (result.deReclassified261Creditors ?? []).filter((f: any) => f.institucion_cmf === 'Banco Santander');
  const porArchivo = new Map(degradadas.map((f: any) => [f.document_filename, f]));
  const filaA = porArchivo.get('santander_cre.pdf');
  const filaB = porArchivo.get('santander_tc.pdf');

  check('1) se emitió una fila de degradación por cada override (2 overrides → 2 filas)',
    degradadas.length === 2, JSON.stringify(degradadas));

  check('2) el rule_id es EXACTAMENTE BACKSTOP_OVERRIDE_DEGRADADO en ambas filas',
    !!filaA && !!filaB && filaA.rule_id === 'BACKSTOP_OVERRIDE_DEGRADADO' && filaB.rule_id === 'BACKSTOP_OVERRIDE_DEGRADADO',
    JSON.stringify(degradadas.map((f: any) => f.rule_id)));

  check('3) la evidence propagada es la del override correcto (cita_monto distintiva, no cruzada)',
    !!filaA && !!filaB &&
    filaA.evidence?.cita_monto === 'Saldo Insoluto: $1.200.000 [TEST-CASO1-A]' &&
    filaB.evidence?.cita_monto === 'Cupo Utilizado: $350.000 [TEST-CASO1-B]',
    JSON.stringify({ a: filaA?.evidence, b: filaB?.evidence }));

  check('4) el monto de cada fila es el del override, NO el total del CMF ($9.000.000)',
    !!filaA && !!filaB && filaA.total_credito_clp === 1_200_000 && filaB.total_credito_clp === 350_000,
    JSON.stringify({ a: filaA?.total_credito_clp, b: filaB?.total_credito_clp }));

  const reasonSinDocumento = 'Mora 90+d en el CMF SIN documento que acredite el VENCIMIENTO (Banco Santander) → se declara en Otros Acreedores (Art. 261). Revisar antes de presentar.';
  check('5) el reason de esta rama es distinto del de BACKSTOP_SIN_DOCUMENTO',
    !!filaA && filaA.reason !== reasonSinDocumento && !!filaB && filaB.reason !== reasonSinDocumento,
    JSON.stringify({ a: filaA?.reason, b: filaB?.reason }));

  check('6) los overrides degradados se quitaron de cmf260DirectOverrides (no quedan declarados en 260 y 261 a la vez)',
    (result.cmf260DirectOverrides ?? []).filter((o: any) => o.institucion_cmf === 'Banco Santander').length === 0,
    JSON.stringify(result.cmf260DirectOverrides));
}

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
