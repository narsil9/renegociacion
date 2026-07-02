/**
 * TEST (Tier 1) — las heurísticas de tipo de documento CONFÍAN en el `doc_type` del LLM y el
 * regex de chat queda como fallback ENDURECIDO (un timestamp de generación en el pie ya NO
 * marca "chat"). Testigo: cert CCAF con "01-07-2026 13:46:42" que antes se descartaba como chat.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_ischat_doctype.ts
 */
import { isChatDocument, classifyNonAccreditingDoc } from '../../src/utils/sentinel_backstops';

let ok = 0, fail = 0;
const check = (n: string, c: boolean, d = '') => { c ? (ok++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`)); };

console.log('═══ isChatDocument / classifyNonAccreditingDoc — Tier 1 (confía en doc_type) ═══');

// Texto tipo cert CCAF: tabla de crédito + UN timestamp de generación en el pie (repetido por pág).
const ccafText = `Información de Crédito
Nombre SILVA SWITT YASMIN
Saldo Cuotas $ 1.285.657   Cuotas Morosas 0
01-07-2026 13:46:42
01-07-2026 13:46:42`;

// 1) doc_type del LLM MANDA: 'desglose_por_producto' → NO es chat aunque el regex viera timestamps.
check("doc_type=desglose → NO chat (aunque tenga timestamp de pie)", isChatDocument(ccafText, '1_CCAF.pdf', 'desglose_por_producto') === false);
// 2) doc_type='chat' → sí chat.
check("doc_type=chat → chat", isChatDocument('lo que sea', 'x.pdf', 'chat') === true);

// 3) SIN doc_type (camino monolítico): regex endurecido. 2 timestamps (pie) → NO chat.
check("sin doc_type + 2 timestamps (pie) → NO chat", isChatDocument(ccafText, '1_CCAF.pdf') === false);
// 4) SIN doc_type: 3+ timestamps (mensajes) → chat.
const waText = `[10/01/2026, 10:01] Juan: hola\n[10/01/2026, 10:02] Ana: deuda\n[10/01/2026, 10:03] Juan: 90 dias`;
check("sin doc_type + 3+ timestamps → chat", isChatDocument(waText, 'conversa.pdf') === true);
// 5) SIN doc_type: marcador fuerte por filename → chat.
check("sin doc_type + filename whatsapp → chat", isChatDocument('texto', 'captura_whatsapp.pdf') === true);
// 6) SIN doc_type + 'escribió:' → chat.
check("sin doc_type + 'escribió:' → chat", isChatDocument('Juan escribió: hola', 'x.pdf') === true);

// classifyNonAccreditingDoc con doc_type
check("doc_type=comprobante_pago → no acredita", classifyNonAccreditingDoc('x', 'x.pdf', 'comprobante_pago').tipo === 'comprobante_pago');
check("doc_type=cartola → no acredita", classifyNonAccreditingDoc('x', 'x.pdf', 'cartola').tipo === 'cartola');
check("doc_type=desglose → SÍ acredita (tipo null)", classifyNonAccreditingDoc('x', 'x.pdf', 'desglose_por_producto').tipo === null);

console.log(`\n${fail === 0 ? '✅' : '❌'} Tier 1: ${ok} OK, ${fail} fallos.`);
process.exit(fail === 0 ? 0 : 1);
