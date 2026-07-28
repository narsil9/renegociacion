/**
 * TEST de las llaves de document_reads.
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_document_reads.ts
 */
import { contentHash, contextHash, PER_DOC_READER } from '../../src/utils/document_reads';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('═══ document_reads — llaves ═══');

// contentHash
const a = Buffer.from('PDF-A');
const a2 = Buffer.from('PDF-A');
const b = Buffer.from('PDF-B');
check('contentHash determinista', contentHash(a) === contentHash(a2));
check('contentHash distingue contenido', contentHash(a) !== contentHash(b));
check('contentHash es sha256 de 64 hex', /^[0-9a-f]{64}$/.test(contentHash(a)), contentHash(a));

// contextHash — el orden de las filas del CMF no puede cambiar la llave
const rows1 = [
  { tipoCredito: 'Consumo', totalCredito: 1000, overdue90Days: 500 },
  { tipoCredito: 'Tarjeta de crédito', totalCredito: 2000, overdue90Days: 0 },
];
const rows2 = [rows1[1], rows1[0]];
const base = { institucionCmf: 'Banco de Chile', acreditacionTipo: 'monto' };
check('contextHash no depende del orden de las filas',
  contextHash({ ...base, cmfRows: rows1 }) === contextHash({ ...base, cmfRows: rows2 }));

check('contextHash distingue la institución asignada',
  contextHash({ ...base, cmfRows: rows1 }) !== contextHash({ ...base, institucionCmf: 'Banco Santander', cmfRows: rows1 }));

check('contextHash distingue el tipo de acreditación',
  contextHash({ ...base, cmfRows: rows1 }) !== contextHash({ ...base, acreditacionTipo: 'vencimiento', cmfRows: rows1 }));

check('contextHash distingue los montos del CMF',
  contextHash({ ...base, cmfRows: rows1 }) !==
  contextHash({ ...base, cmfRows: [{ tipoCredito: 'Consumo', totalCredito: 9999, overdue90Days: 500 }, rows1[1]] }));

check('contextHash tolera sin institución y sin filas',
  typeof contextHash({ institucionCmf: null, acreditacionTipo: null, cmfRows: [] }) === 'string');

check('contextHash normaliza mayúsculas y espacios de la institución',
  contextHash({ ...base, cmfRows: rows1 }) === contextHash({ ...base, institucionCmf: '  BANCO DE CHILE ', cmfRows: rows1 }));

check('el reader per-doc tiene nombre estable', PER_DOC_READER === 'centinela_per_doc');

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
