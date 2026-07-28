/**
 * TEST de dedupPorContenido — el mismo PDF por dos caminos es UN documento.
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_dedup_contenido.ts
 */
import { dedupPorContenido } from '../../src/utils/sentinel';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const noop = () => {};

console.log('═══ dedupPorContenido ═══');

// El caso real: el mismo certificado llega por correo y por Drive. El proyector le
// puso dos storage_path distintos; el contenido es el mismo.
const porCorreo = { sha256: 'aaa', storage_path: '169917418/certs/email-5261_cert.pdf', filename: 'cert.pdf' };
const porDrive  = { sha256: 'aaa', storage_path: '169917418/certs/drive-1Ka2_cert.pdf', filename: 'cert.pdf' };
const otro      = { sha256: 'bbb', storage_path: '169917418/certs/email-5262_otro.pdf', filename: 'otro.pdf' };

const r1 = dedupPorContenido([porCorreo, porDrive, otro], noop);
check('colapsa el duplicado por contenido', r1.length === 2, `quedaron ${r1.length}`);
check('conserva el primero de los duplicados', r1[0].storage_path === porCorreo.storage_path);
check('conserva el documento distinto', r1.some((d) => d.sha256 === 'bbb'));

// Sin hash NO se agrupa: un sha256 ausente no puede colapsar documentos distintos.
const sinHashA = { storage_path: 'x/a.pdf', filename: 'a.pdf' } as { sha256?: string; storage_path: string; filename: string };
const sinHashB = { storage_path: 'x/b.pdf', filename: 'b.pdf' } as { sha256?: string; storage_path: string; filename: string };
const r2 = dedupPorContenido([sinHashA, sinHashB], noop);
check('sin sha256 no colapsa nada', r2.length === 2);

// Mismo contenido, distinto nombre → sigue siendo el mismo papel.
const r3 = dedupPorContenido(
  [{ sha256: 'ccc', storage_path: 'x/1.pdf', filename: 'Certificado.pdf' },
   { sha256: 'ccc', storage_path: 'x/2.pdf', filename: 'Certificado (1).pdf' }],
  noop
);
check('mismo contenido con distinto nombre colapsa', r3.length === 1);

// Desempate: si dos copias del mismo contenido difieren en n_periodos, gana la que
// cubre más períodos (regla existente del dedup del Centinela).
const r4 = dedupPorContenido(
  [{ sha256: 'ddd', storage_path: 'x/1.pdf', filename: 'ec.pdf', n_periodos: 1 },
   { sha256: 'ddd', storage_path: 'x/2.pdf', filename: 'ec.pdf', n_periodos: 4 }],
  noop
);
check('desempata por n_periodos', r4.length === 1 && r4[0].n_periodos === 4, JSON.stringify(r4));

// Desempate por INFORMACIÓN: las dos copias del proyector no son intercambiables. El resolver
// de instituciones resuelve por RUT o, si falla, por nombre de archivo (que difiere), así que
// una copia puede tener `institucion_cmf` y la otra no. Si gana la que no la tiene, el banco
// queda sin documento y el backstop declara el total del CMF en Art. 261.
const conInst = { sha256: 'eee', storage_path: 'x/1.pdf', filename: 'santander_cert.pdf', institucion_cmf: 'Banco Santander' };
const sinInst = { sha256: 'eee', storage_path: 'x/2.pdf', filename: 'documento (1).pdf', institucion_cmf: null };
for (const [nombre, lista] of [
  ['la que tiene institución primero', [conInst, sinInst]],
  ['la que tiene institución última', [sinInst, conInst]],
] as [string, typeof conInst[]][]) {
  const r = dedupPorContenido(lista, noop);
  check(`gana la copia con institucion_cmf (${nombre})`,
    r.length === 1 && r[0].institucion_cmf === 'Banco Santander', JSON.stringify(r));
}

// Segundo criterio: document_type 22/23 (acredita monto/vencimiento) por sobre otro tipo.
const r6 = dedupPorContenido(
  [{ sha256: 'fff', storage_path: 'x/1.pdf', filename: 'a.pdf', document_type: 24 },
   { sha256: 'fff', storage_path: 'x/2.pdf', filename: 'b.pdf', document_type: 22 }],
  noop
);
check('desempata por document_type 22/23', r6.length === 1 && r6[0].document_type === 22, JSON.stringify(r6));

// La institución pesa MÁS que n_periodos: perder el ancla del CMF es peor que perder períodos.
const r7 = dedupPorContenido(
  [{ sha256: 'ggg', storage_path: 'x/1.pdf', filename: 'a.pdf', institucion_cmf: null, n_periodos: 4 },
   { sha256: 'ggg', storage_path: 'x/2.pdf', filename: 'b.pdf', institucion_cmf: 'Banco de Chile', n_periodos: 1 }],
  noop
);
check('la institución pesa más que n_periodos', r7.length === 1 && r7[0].institucion_cmf === 'Banco de Chile', JSON.stringify(r7));

// No pierde nada cuando no hay duplicados.
const r5 = dedupPorContenido([otro], noop);
check('lista sin duplicados queda igual', r5.length === 1);

// Lista vacía no rompe.
check('lista vacía no rompe', dedupPorContenido([], noop).length === 0);

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
