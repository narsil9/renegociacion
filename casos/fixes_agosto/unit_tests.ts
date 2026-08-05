/**
 * Pruebas unitarias DETERMINISTAS de los arreglos de agosto 2026.
 * Sin API, sin framework, aserción pura. exit(1) si algo falla.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/fixes_agosto/unit_tests.ts
 */
import { esCandidatoAResolver } from '../../src/utils/cert_institution_resolver';
import { dedupOplessProducts } from '../../src/utils/sentinel_per_doc';
import { mergeReadIssues } from '../../src/utils/sentinel_backstops';
import { esPdf } from '../../src/utils/doc_format';

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

// =========================================================================== T8 dedupOplessProducts
section('T8 — qué dedupea de verdad dedupOplessProducts');

const it = (bankKey: string, etiqueta: string, emision: string, clp: number, extra: any = {}) =>
  ({ bankKey, etiqueta, emision, clp, docTypeScore: 1, confidence: 0.9, ...extra } as any);

// Mismo estado en dos formatos (.png y .pdf): colapsa.
eq('mismo banco/producto/mes y monto equivalente → 1',
  dedupOplessProducts([it('bch', 'tarjeta', '2026-06-10', 1_000_000), it('bch', 'tarjeta', '2026-06-20', 1_000_000)]).length, 1);

// Meses distintos: es una serie, se conserva.
eq('meses distintos → se conservan',
  dedupOplessProducts([it('bch', 'tarjeta', '2026-05-10', 1_000_000), it('bch', 'tarjeta', '2026-06-10', 1_000_000)]).length, 2);

// Montos materialmente distintos: productos reales distintos.
eq('montos muy distintos → se conservan',
  dedupOplessProducts([it('bch', 'tarjeta', '2026-06-10', 1_000_000), it('bch', 'tarjeta', '2026-06-11', 9_000_000)]).length, 2);

// Sin mes legible: conservador, no dedupea.
eq('sin emisión → se conservan',
  dedupOplessProducts([it('bch', 'tarjeta', '', 1_000_000), it('bch', 'tarjeta', '', 1_000_000)]).length, 2);

// =========================================================================== T6 mergeReadIssues
section('T6 — los issues del backstop se acumulan');

const previo = [{ tipo: 'identidad_no_confirmada' }];
const nuevos = [{ tipo: 'moneda_inconsistente' }, { tipo: 'baja_confianza' }];
const merged = mergeReadIssues(previo, nuevos);
eq('conserva los previos y agrega los nuevos', merged.length, 3);
eq('el de identidad sobrevive', merged.some((i) => i.tipo === 'identidad_no_confirmada'), true);
eq('el previo va primero', merged[0].tipo, 'identidad_no_confirmada');
eq('sin previos funciona', mergeReadIssues(undefined, nuevos).length, 2);
eq('sin nuevos conserva los previos', mergeReadIssues(previo, []).length, 1);

// =========================================================================== T3 esPdf
section('T3 — la regla del estudio es PDF');

eq('pdf sirve', esPdf('/tmp/a.pdf'), true);
eq('PDF mayúscula sirve', esPdf('/tmp/caja_compensacion_261.PDF'), true);
eq('jpg no cumple la regla', esPdf('/tmp/Linea_de_Credito_Bice.jpg'), false);
eq('png no cumple la regla', esPdf('/tmp/Captura de pantalla 2026-06-02 102417.png'), false);
eq('sin extensión no cumple', esPdf('/tmp/archivo'), false);
eq('null no cumple', esPdf(null), false);
eq('undefined no cumple', esPdf(undefined), false);
eq('.pdf en el medio del nombre no cuenta', esPdf('/tmp/a.pdf.png'), false);

// --------------------------------------------------------------------------- salida
console.log(`\n${pass} aserción(es) OK, ${fails.length} fallo(s).`);
if (fails.length > 0) { fails.forEach((f) => console.error(`  ✗ ${f}`)); process.exit(1); }
