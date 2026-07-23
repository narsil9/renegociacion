/**
 * Test unitario PURO de la capa determinista de la calculadora (mora.ts).
 * Sin API, sin framework — aserción pura, exit(1) si falla.
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/calculadora_mora_pruebas/unit_mora.ts
 */
import { parseChileanDateUTC, veredicto, recomputarEstados } from '../../src/utils/calculadora-mora/mora';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

// parseChileanDateUTC: tolerante a / - . ; rechaza basura y meses/días inválidos.
ok(parseChileanDateUTC('05/02/2026') === Date.UTC(2026, 1, 5), 'parsea 05/02/2026');
ok(parseChileanDateUTC('5-2-2026') === Date.UTC(2026, 1, 5), 'parsea 5-2-2026');
ok(parseChileanDateUTC('2026-02-05') === null, 'rechaza ISO (no es formato chileno)');
ok(parseChileanDateUTC('32/01/2026') === null, 'rechaza día 32');
ok(parseChileanDateUTC('') === null && parseChileanDateUTC(null) === null, 'rechaza vacío/null');

// veredicto: umbral legal 90 / 75.
ok(veredicto(168).estado === 'cumple' && veredicto(90).estado === 'cumple', '≥90 → cumple');
ok(veredicto(89).estado === 'advertencia' && veredicto(75).estado === 'advertencia', '75–89 → advertencia');
ok(veredicto(74).estado === 'no_cumple', '<75 → no_cumple');

// recomputarEstados: recalcula días desde fecha_inicio_mora (no confía en el nº del modelo) y conserva el del modelo.
const [e] = recomputarEstados([{ fecha_inicio_mora: '05/02/2026', dias_mora: 999 }]);
ok(typeof e.dias_mora === 'number' && e.dias_mora! >= 91, `recomputa días ≥91 (dio ${e.dias_mora}, ignoró 999)`);
ok(e.dias_mora_modelo === 999, 'conserva dias_mora_modelo=999 para diagnóstico');
ok(e.veredicto?.estado === 'cumple', 'estampa veredicto CUMPLE');

console.log(fails ? `\n✗ ${fails} fallo(s)` : '\n✓ PASS unit_mora');
process.exit(fails ? 1 : 0);
