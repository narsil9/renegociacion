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

// ── Los campos que REETIQUETA el proyector del dashboard tienen que invalidar el caché ──
// El proyector reescribe `filename`, `institucion_cmf` y `document_type` SIN tocar el
// `storage_path`. Con una firma que solo miraba la ruta, el análisis viejo seguía vigente:
// el fix se deployaba y no pasaba nada, en silencio. Barraza tiene un run `completed` del
// 23-jul, así que sin esto ninguno de los fixes del contrato se activa para ella.
const C = {
  storage_path: 'x/certs/c.pdf',
  uploaded_at: '2026-07-21T04:00:00.000Z',
  filename: 'cert.pdf',
  institucion_cmf: 'Banco de Chile',
  document_type: 22,
};
check('renombrar el archivo cambia la firma',
  documentSetSignature([C]) !== documentSetSignature([{ ...C, filename: 'email-5261_cert.pdf' }]));
check('cambiar la institucion cambia la firma',
  documentSetSignature([C]) !== documentSetSignature([{ ...C, institucion_cmf: 'BANCO DE CHILE' }]));
check('cambiar el document_type cambia la firma',
  documentSetSignature([C]) !== documentSetSignature([{ ...C, document_type: 24 }]));
check('los campos nuevos son opcionales (retrocompatible)',
  typeof documentSetSignature([{ storage_path: 'y', uploaded_at: null }]) === 'string');
// Un campo nuevo ausente y el mismo campo en null/vacío tienen que dar LO MISMO: si no, la
// primera corrida tras el deploy invalidaría el caché de todos los clientes sin motivo.
check('ausente y vacío son equivalentes',
  documentSetSignature([{ storage_path: 'y', uploaded_at: null }]) ===
  documentSetSignature([{ storage_path: 'y', uploaded_at: null, filename: null, institucion_cmf: null, document_type: null }]));

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
