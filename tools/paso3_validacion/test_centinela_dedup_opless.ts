/**
 * TEST de dedupOplessProducts — dedup determinista por identidad (acreedor+producto+mes) para
 * productos SIN Nº de operación. Escenarios reales (María Barraza):
 *  - misma captura como .png y .pdf (mismo banco+producto+mes+monto) → 1
 *  - serie de estados de meses distintos (junio vs julio) → se conservan todos
 *  - dos tarjetas reales del mismo banco/mes con montos distintos → se conservan las dos
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_centinela_dedup_opless.ts
 */
import { dedupOplessProducts } from '../../src/utils/sentinel_per_doc';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const it = (o: Partial<any>) => ({ bankKey: 'bdch', productType: 'tarjeta_credito', etiqueta: 'saldo', clp: 100000, emision: '2026-06-18', docTypeScore: 1, confidence: 0.9, ...o });

console.log('═══ dedupOplessProducts ═══');

// 1) misma identidad + mismo mes + mismo monto (captura .png y .pdf) → colapsa a 1
check('duplicado .png/.pdf → 1', dedupOplessProducts([it({}), it({})]).length === 1);

// 2) misma identidad, DISTINTO mes (junio vs julio) → se conservan los 2 (serie)
check('meses distintos → 2', dedupOplessProducts([it({ emision: '2026-06-18' }), it({ emision: '2026-07-18' })]).length === 2);

// 3) mismo mes, montos materialmente distintos (2 tarjetas reales) → se conservan los 2
check('montos distintos → 2', dedupOplessProducts([it({ clp: 100000 }), it({ clp: 900000 })]).length === 2);

// 4) mismo mes+monto, distinta emisión → gana el de emisión más nueva
{
  const r = dedupOplessProducts([it({ emision: '2026-06-10', confidence: 0.5 }), it({ emision: '2026-06-20', confidence: 0.5 })]);
  check('gana emisión más nueva', r.length === 1 && r[0].emision === '2026-06-20');
}

// 5) sin emisión → no se puede fechar → se conservan todos (conservador)
check('sin emisión → no colapsa', dedupOplessProducts([it({ emision: undefined }), it({ emision: undefined })]).length === 2);

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
