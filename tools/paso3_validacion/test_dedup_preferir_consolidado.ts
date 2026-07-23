/**
 * TEST de atLeastAsAuthoritative — elección de la FUENTE de un producto en el dedup por operación.
 * Foco: preferencia por el estado de cuenta CONSOLIDADO (varios estados unidos) SOLO entre el mismo
 * doc_type (caso María Barraza / CMR: el merged de 4 estados perdía contra un estado suelto).
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_dedup_preferir_consolidado.ts
 */
import { atLeastAsAuthoritative } from '../../src/utils/sentinel_per_doc';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
// "gana(a,b)" = a es el elegido cuando se comparan a y b (en cualquier orden de llamada).
const gana = (a: any, b: any) => atLeastAsAuthoritative(a, b) && !atLeastAsAuthoritative(b, a);
const est = (o: Partial<any> = {}) => ({ docType: 'estado_cuenta', periodos: 1, confidence: 0.9, clp: 1_000_000, ...o });

console.log('═══ atLeastAsAuthoritative (preferir consolidado) ═══');

// 1) EL FIX: consolidado (4 estados) le gana al estado suelto, AUNQUE el suelto tenga más confianza
//    y más monto. Sin la preferencia por períodos, el suelto ganaba por monto.
{
  const consolidado = est({ periodos: 4, confidence: 0.7, clp: 100_000 });
  const suelto = est({ periodos: 1, confidence: 0.99, clp: 900_000 });
  check('consolidado(4) gana al suelto(1) pese a menor conf/monto', gana(consolidado, suelto));
}

// 2) La preferencia por períodos NO cruza doc_type: una liquidacion_payoff (1 período) le gana a un
//    estado_cuenta consolidado (4 períodos) — el monto autoritativo lo define el escalón doc_type.
{
  const payoff = est({ docType: 'liquidacion_payoff', periodos: 1 });
  const consolidado = est({ docType: 'estado_cuenta', periodos: 4 });
  check('liquidacion_payoff(1) gana a estado consolidado(4)', gana(payoff, consolidado));
}

// 3) Igual con desglose_por_producto: doc_type manda sobre períodos.
{
  const desglose = est({ docType: 'desglose_por_producto', periodos: 1 });
  const consolidado = est({ docType: 'estado_cuenta', periodos: 4 });
  check('desglose(1) gana a estado consolidado(4)', gana(desglose, consolidado));
}

// 4) Mismo doc_type y mismos períodos → decide la confianza.
check('mismos períodos → gana mayor confianza',
  gana(est({ periodos: 2, confidence: 0.95 }), est({ periodos: 2, confidence: 0.6 })));

// 5) Mismo doc_type, mismos períodos, misma confianza → decide el monto.
check('empate períodos+confianza → gana mayor monto',
  gana(est({ periodos: 1, clp: 2_000_000 }), est({ periodos: 1, clp: 1_000_000 })));

// 6) periodos ausente se trata como 1 (no rompe el orden previo).
check('periodos undefined = 1',
  gana(est({ periodos: 4 }), est({ periodos: undefined })));

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
