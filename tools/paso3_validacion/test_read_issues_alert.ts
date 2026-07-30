/**
 * TESTS del texto de la alerta de señales de lectura (`buildReadIssuesAlert`).
 *
 * Por qué existe: el guard de identidad del backstop (Task 16) hace que un monto NO se declare,
 * pero el encabezado de esta alerta afirmaba "el monto se declaró igual" para TODAS las señales.
 * El abogado leería el aviso y no haría nada mientras falta una deuda en la presentación. Un
 * diagnóstico que nombra la consecuencia equivocada es un bug, no un detalle de redacción.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_read_issues_alert.ts
 */
import { buildReadIssuesAlert } from '../../src/utils/read_issues_alert';
import type { ClaudeReadIssue } from '../../src/utils/sentinel';

let ok = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    ok++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const issue = (tipo: ClaudeReadIssue['tipo'], institucion = 'Banco de Chile', monto = 1_000_000): ClaudeReadIssue =>
  ({ document_filename: 'x.pdf', institucion, monto_clp: monto, tipo, detalle: 'detalle crudo' } as ClaudeReadIssue);

console.log('═══ Alerta de señales: el encabezado dice la verdad ═══');

check('sin señales no hay alerta', buildReadIssuesAlert([]) === null && buildReadIssuesAlert(undefined) === null);

{
  const txt = buildReadIssuesAlert([issue('identidad_no_confirmada')]) ?? '';
  check('un monto NO declarado NO dice "se declaró igual"', !/se declar[óo] igual/i.test(txt), txt);
  check('un monto NO declarado dice que NO se declaró', /NO se declaró/.test(txt), txt);
}

{
  const txt = buildReadIssuesAlert([issue('baja_confianza')]) ?? '';
  check('un monto sí declarado conserva el texto de siempre', /el monto se declaró igual/.test(txt), txt);
  check('y no aparece el encabezado de los no declarados', !/NO se declaró/.test(txt), txt);
}

{
  // El caso mezclado es el que importa: los dos grupos, cada uno con su encabezado, y el
  // bloqueante primero.
  const txt =
    buildReadIssuesAlert([
      issue('baja_confianza', 'BCI', 500_000),
      issue('identidad_no_confirmada', 'Banco de Chile', 5_279_356),
    ]) ?? '';
  check('mezclados: aparecen los dos encabezados', /NO se declaró/.test(txt) && /se declaró igual/.test(txt), txt);
  check(
    'el bloque de los NO declarados va primero',
    txt.indexOf('NO se declaró') < txt.indexOf('se declaró igual'),
    txt
  );
  check('cada monto queda en su bloque', /Banco de Chile \(\$5\.279\.356\)/.test(txt) && /BCI \(\$500\.000\)/.test(txt), txt);
  check(
    'el conteo de cada encabezado es 1, no 2',
    /1 monto NO se declaró/.test(txt) && /leyó 1 monto con baja certeza/.test(txt),
    txt
  );
}

{
  // Todo tipo del union tiene etiqueta: si alguien agrega uno y olvida el texto, cae al detalle
  // crudo del issue en vez de a `undefined`.
  const tipos: ClaudeReadIssue['tipo'][] = [
    'monto_sin_respaldo_en_cita', 'rut_no_coincide', 'baja_confianza', 'sin_evidencia',
    'documento_no_acredita', 'moneda_inconsistente', 'posible_duplicado',
    'posible_subdivision_operacion', 'monto_trivial', 'fecha_no_acreditada',
    'nombre_de_archivo_repetido', 'identidad_no_confirmada',
  ];
  const txt = buildReadIssuesAlert(tipos.map((t) => issue(t))) ?? '';
  check('ningún tipo produce "undefined" en el texto', !/undefined/.test(txt), txt.slice(0, 200));
  check('los 12 tipos aparecen', txt.split('•').length - 1 === tipos.length, `bullets=${txt.split('•').length - 1}`);
}

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
