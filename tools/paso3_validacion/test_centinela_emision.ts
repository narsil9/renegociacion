/**
 * TEST de resolveEmision — política híbrida de fecha de emisión por documento.
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_centinela_emision.ts
 */
import { resolveEmision } from '../../src/utils/sentinel_per_doc';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const d = (s: string) => new Date(s + 'T00:00:00');

console.log('═══ resolveEmision ═══');
// 1) hay fecha determinista (texto) → gana la determinista, ignora la de Claude
check('determinista gana sobre Claude', resolveEmision(d('2026-07-20'), '2026-05-01') === '2026-07-20');
// 2) no hay determinista (imagen/escaneo) → usa la de Claude
check('sin determinista usa Claude', resolveEmision(null, '2026-05-01') === '2026-05-01');
// 3) ni determinista ni Claude → undefined
check('sin nada → undefined', resolveEmision(null, undefined) === undefined);
// 4) determinista presente, Claude ausente → determinista
check('solo determinista', resolveEmision(d('2026-06-15'), undefined) === '2026-06-15');

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
