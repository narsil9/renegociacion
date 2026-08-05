/**
 * Pruebas unitarias DETERMINISTAS de los arreglos de agosto 2026.
 * Sin API, sin framework, aserción pura. exit(1) si algo falla.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/fixes_agosto/unit_tests.ts
 */
import { esCandidatoAResolver } from '../../src/utils/cert_institution_resolver';

// --------------------------------------------------------------------------- mini-harness
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function section(t: string) { console.log(`\n• ${t}`); }

// =========================================================================== T1 resolver
section('T1 — el resolver solo toca certificados de acreedor (22/23)');

eq('22 (acredita monto) es candidato', esCandidatoAResolver({ document_type: 22 }), true);
eq('23 (acredita vencimiento) es candidato', esCandidatoAResolver({ document_type: 23 }), true);
// Kerum: sus liquidaciones llegaron como 24 y el resolver las convirtió en acreedor.
eq('24 (general) NO es candidato', esCandidatoAResolver({ document_type: 24 }), false);
eq('null NO es candidato', esCandidatoAResolver({ document_type: null }), false);
eq('0 NO es candidato', esCandidatoAResolver({ document_type: 0 }), false);

// --------------------------------------------------------------------------- salida
console.log(`\n${pass} aserción(es) OK, ${fails.length} fallo(s).`);
if (fails.length > 0) { fails.forEach((f) => console.error(`  ✗ ${f}`)); process.exit(1); }
