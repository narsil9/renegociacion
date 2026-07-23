/**
 * Test determinista del runner (parseo tolerante + conversión de fecha). La llamada real a
 * Claude se ejerce en run_real_maria.ts (necesita API key). Aserción pura, exit(1) si falla.
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/calculadora_mora_pruebas/unit_mora_api.ts
 */
import { parseJsonLoose, todayToChileLabel } from '../../src/utils/calculadora-mora/mora-api';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

ok(todayToChileLabel('2026-07-23') === '23/07/2026', 'YYYY-MM-DD → DD/MM/YYYY');
const a = parseJsonLoose('prefacio {"estados":[{"fecha_inicio_mora":"05/02/2026"}]} epílogo') as any;
ok(a?.estados?.[0]?.fecha_inicio_mora === '05/02/2026', 'extrae el bloque {...} con ruido alrededor');
ok(parseJsonLoose('sin json') === null, 'devuelve null si no hay JSON');

console.log(fails ? `\n✗ ${fails}` : '\n✓ PASS unit_mora_api');
process.exit(fails ? 1 : 0);
