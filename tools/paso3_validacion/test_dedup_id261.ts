/**
 * TEST de `dedupeIdentified261Products` (backstop L38): colapsa la MISMA deuda emitida 2 veces por el
 * LLM —misma Nº de operación (cross-institución) o hipoteca saldo/prepago del mismo banco casi idéntica—
 * y NO fusiona deudas distintas. Testigos: Néctor (op 29821865337 Falabella↔CMR; hipoteca 142,5M/144,7M).
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_dedup_id261.ts
 */
import { dedupeIdentified261Products } from '../../src/automation/step3_acreedores';
import { Identified261Creditor } from '../../src/utils/sentinel';

let ok = 0, fail = 0;
const check = (n: string, c: boolean, d = '') => { c ? (ok++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`)); };
const P = (inst: string, monto: number, op?: string, conf = 0.9): Identified261Creditor => ({
  bank: inst, product_type: 'otro', institucion_cmf: inst, total_credito_clp: monto, reason: '', document_filename: '',
  evidence: { numero_operacion: op, confidence: conf } as any,
});
const noop = (_: string) => {};

console.log('═══ dedupeIdentified261Products ═══');

// 1) misma Nº op cross-institución (Falabella $2.988.488 op = CMR $2.988.488 op) → 1
{
  const out = dedupeIdentified261Products([
    P('Banco Falabella', 2_988_488, '29821865337', 0.92),
    P('Promotora CMR Falabella S.A.', 2_988_488, '29821865337', 0.85),
  ], noop);
  check('misma op → 1 fila', out.length === 1, `got ${out.length}`);
  check('misma op → conserva mayor confianza (Banco Falabella)', out[0]?.bank === 'Banco Falabella');
}

// 2) hipoteca mismo banco, ambos grandes, ≤3% (saldo 142,5M / prepago 144,7M) → 1, conserva payoff
{
  const out = dedupeIdentified261Products([
    P('Banco de Chile Vivien', 142_510_035),
    P('Linea Banco de Chile', 144_745_041, '430-9-929961-500'),
  ], noop);
  check('hipoteca saldo/prepago → 1 fila', out.length === 1, `got ${out.length}`);
  check('hipoteca → conserva el payoff (mayor)', out[0]?.total_credito_clp === 144_745_041);
}

// 3) NO fusiona deudas DISTINTAS del mismo banco (BancoEstado $389.848 vs $553.350 = 30%)
{
  const out = dedupeIdentified261Products([
    P('Banco del Estado de Chile', 389_848, '00040145148'),
    P('Banco del Estado de Chile', 553_350, '00040166973'),
  ], noop);
  check('distintos (30%) → 2 filas', out.length === 2, `got ${out.length}`);
}

// 4) NO fusiona dos tarjetas chicas del mismo banco cercanas pero <umbral grande ($1.33M vs $1.44M, 8%)
{
  const out = dedupeIdentified261Products([
    P('Banco de Chile', 1_335_287, '2949'),
    P('Banco de Chile', 1_443_774, '9558'),
  ], noop);
  check('dos tarjetas distintas → 2 filas', out.length === 2, `got ${out.length}`);
}

// 5) sin duplicados → intacto
{
  const out = dedupeIdentified261Products([P('A', 100), P('B', 200), P('C', 300)], noop);
  check('sin dups → 3 filas', out.length === 3);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} dedupeIdentified261Products: ${ok} OK, ${fail} fallos.`);
process.exit(fail === 0 ? 0 : 1);
