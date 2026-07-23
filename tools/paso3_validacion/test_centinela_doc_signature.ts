/**
 * TEST de documentSetSignature — firma determinista del conjunto de documentos.
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_centinela_doc_signature.ts
 */
import { documentSetSignature } from '../../src/agents/centinela_agent';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const A = { storage_path: '169917418/certs/a.pdf', uploaded_at: '2026-07-21T04:00:00.000Z' };
const B = { storage_path: '169917418/certs/b.pdf', uploaded_at: '2026-07-21T04:00:00.000Z' };
const B2 = { storage_path: '169917418/certs/b.pdf', uploaded_at: '2026-07-22T04:00:00.000Z' };

console.log('═══ documentSetSignature ═══');

// 1) Determinista: mismo conjunto en distinto orden → misma firma
check('orden no importa', documentSetSignature([A, B]) === documentSetSignature([B, A]));

// 2) Agregar un documento cambia la firma
check('agregar doc cambia firma', documentSetSignature([A]) !== documentSetSignature([A, B]));

// 3) Cambiar uploaded_at (re-subida) cambia la firma
check('cambio de uploaded_at cambia firma', documentSetSignature([A, B]) !== documentSetSignature([A, B2]));

// 4) Conjunto vacío devuelve una firma estable no vacía
check('vacío es estable', documentSetSignature([]) === documentSetSignature([]) && documentSetSignature([]).length === 64);

// 5) uploaded_at null no rompe
check('null uploaded_at ok', typeof documentSetSignature([{ storage_path: 'x', uploaded_at: null }]) === 'string');

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
