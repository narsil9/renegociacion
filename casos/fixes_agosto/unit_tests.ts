/**
 * Pruebas unitarias DETERMINISTAS de los arreglos de agosto 2026.
 * Sin API, sin framework, aserción pura. exit(1) si algo falla.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/fixes_agosto/unit_tests.ts
 */
import { esCandidatoAResolver } from '../../src/utils/cert_institution_resolver';
import { dedupOplessProducts } from '../../src/utils/sentinel_per_doc';
import { mergeReadIssues } from '../../src/utils/sentinel_backstops';
import { esPdf } from '../../src/utils/doc_format';
import { tiposDeAcreditacion } from '../../src/automation/step3_acreedores';
import { senalesParaElAbogado } from '../../src/utils/alert_routing';
import { enrichUnDocConMora } from '../../src/utils/calculadora-mora/mora-runner';
import type { DocFacts } from '../../src/utils/sentinel_per_doc';

// --------------------------------------------------------------------------- mini-harness
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function section(t: string) { console.log(`\n• ${t}`); }

// =========================================================================== T1 resolver
section('T1 — el resolver solo toca certificados de acreedor (22/23)');

eq('22 (acredita monto) es candidato', esCandidatoAResolver({ document_type: 22 }), true);
eq('23 (acredita vencimiento) es candidato', esCandidatoAResolver({ document_type: 23 }), true);
// Kerum: sus liquidaciones llegaron como 24 y el resolver las convirtió en acreedor.
eq('24 (general) NO es candidato', esCandidatoAResolver({ document_type: 24 }), false);
eq('null NO es candidato', esCandidatoAResolver({ document_type: null }), false);
eq('0 NO es candidato', esCandidatoAResolver({ document_type: 0 }), false);

// =========================================================================== T8 dedupOplessProducts
section('T8 — qué dedupea de verdad dedupOplessProducts');

const it = (bankKey: string, etiqueta: string, emision: string, clp: number, extra: any = {}) =>
  ({ bankKey, etiqueta, emision, clp, docTypeScore: 1, confidence: 0.9, ...extra } as any);

// Mismo estado en dos formatos (.png y .pdf): colapsa.
eq('mismo banco/producto/mes y monto equivalente → 1',
  dedupOplessProducts([it('bch', 'tarjeta', '2026-06-10', 1_000_000), it('bch', 'tarjeta', '2026-06-20', 1_000_000)]).length, 1);

// Meses distintos: es una serie, se conserva.
eq('meses distintos → se conservan',
  dedupOplessProducts([it('bch', 'tarjeta', '2026-05-10', 1_000_000), it('bch', 'tarjeta', '2026-06-10', 1_000_000)]).length, 2);

// Montos materialmente distintos: productos reales distintos.
eq('montos muy distintos → se conservan',
  dedupOplessProducts([it('bch', 'tarjeta', '2026-06-10', 1_000_000), it('bch', 'tarjeta', '2026-06-11', 9_000_000)]).length, 2);

// Sin mes legible: conservador, no dedupea.
eq('sin emisión → se conservan',
  dedupOplessProducts([it('bch', 'tarjeta', '', 1_000_000), it('bch', 'tarjeta', '', 1_000_000)]).length, 2);

// =========================================================================== T6 mergeReadIssues
section('T6 — los issues del backstop se acumulan');

const previo = [{ tipo: 'identidad_no_confirmada' }];
const nuevos = [{ tipo: 'moneda_inconsistente' }, { tipo: 'baja_confianza' }];
const merged = mergeReadIssues(previo, nuevos);
eq('conserva los previos y agrega los nuevos', merged.length, 3);
eq('el de identidad sobrevive', merged.some((i) => i.tipo === 'identidad_no_confirmada'), true);
eq('el previo va primero', merged[0].tipo, 'identidad_no_confirmada');
eq('sin previos funciona', mergeReadIssues(undefined, nuevos).length, 2);
eq('sin nuevos conserva los previos', mergeReadIssues(previo, []).length, 1);

// =========================================================================== T3 esPdf
section('T3 — la regla del estudio es PDF');

eq('pdf sirve', esPdf('/tmp/a.pdf'), true);
eq('PDF mayúscula sirve', esPdf('/tmp/caja_compensacion_261.PDF'), true);
eq('jpg no cumple la regla', esPdf('/tmp/Linea_de_Credito_Bice.jpg'), false);
eq('png no cumple la regla', esPdf('/tmp/Captura de pantalla 2026-06-02 102417.png'), false);
eq('sin extensión no cumple', esPdf('/tmp/archivo'), false);
eq('null no cumple', esPdf(null), false);
eq('undefined no cumple', esPdf(undefined), false);
eq('.pdf en el medio del nombre no cuenta', esPdf('/tmp/a.pdf.png'), false);

// =========================================================================== T5 tiposDeAcreditacion
section('T5 — el Art. 260 exige monto Y vencimiento; el 261 solo monto');

// Medido en el portal el 2026-08-05 (harness, 5 ciclos): con solo el 22, la fila del 260 queda
// con la columna "Acredita (Sí/No)" en NO — declarada sin acreditar. El 261 sale en Sí con el 22.
eq('Art. 260 pide los dos tipos', tiposDeAcreditacion(false).length, 2);
eq('el 22 acredita el monto', tiposDeAcreditacion(false)[0], 22);
eq('el 23 acredita el vencimiento', tiposDeAcreditacion(false)[1], 23);
eq('"Otros" (261) pide uno solo', tiposDeAcreditacion(true).length, 1);
eq('y es el 22, porque el 261 no exige vencimiento', tiposDeAcreditacion(true)[0], 22);

// =========================================================================== T7 alert_routing
section('T7 — ninguna señal del Mapeador ni de contribuciones se queda sin destinatario');

const YA = ['rut_mismatch', 'missing_document', 'amount_mismatch'] as const;

// Los 3 tipos huérfanos hoy.
const huerfanos = senalesParaElAbogado({
  alerts: [
    { type: 'expired_cmf', message: 'CMF de mayo, vencido' },
    { type: 'expired_certificate', message: 'certificado BCI vencido' },
    { type: 'other', message: 'fallback por institución' },
  ],
  contribucionesDeuda: [],
  yaEnrutados: YA,
});
eq('los 3 tipos sin ruta generan señal', huerfanos.length, 3);
ok('menciona el CMF vencido', huerfanos.some((s) => s.includes('CMF de mayo')));
ok('menciona el fallback', huerfanos.some((s) => s.includes('fallback por institución')));

// Los que ya se enrutan no se duplican.
const yaCubiertos = senalesParaElAbogado({
  alerts: [{ type: 'rut_mismatch', message: 'x' }, { type: 'amount_mismatch', message: 'y' }],
  contribucionesDeuda: [],
  yaEnrutados: YA,
});
eq('los ya enrutados no se repiten', yaCubiertos.length, 0);

// Contribuciones morosas.
const contrib = senalesParaElAbogado({
  alerts: [],
  contribucionesDeuda: [{ rol: '03603-00225' }, { rol: '03603-00270' }],
  yaEnrutados: YA,
});
eq('las contribuciones generan una señal', contrib.length, 1);
ok('nombra los roles', contrib[0].includes('03603-00225') && contrib[0].includes('03603-00270'));
ok('pide el certificado TGR', contrib[0].toUpperCase().includes('TGR'));

// Nada que decir.
eq('sin señales: array vacío', senalesParaElAbogado({ alerts: [], contribucionesDeuda: [], yaEnrutados: YA }).length, 0);

// =========================================================================== T9 mora-runner precedencia
section('T9 — la fecha literal del extractor no la pisa la derivada de la calculadora');

const mkFacts = (filename: string, fecha_mora?: string, cita_fecha?: string): DocFacts => ({
  filename,
  doc_type: 'estado_cuenta',
  productos: [{
    monto: 235_084,
    etiqueta_monto: 'Cuotas atrasadas',
    moneda: 'CLP',
    cita_monto: 'Cancelar cuotas atrasadas de $ 235.084',
    fecha_mora,
    cita_fecha,
    confidence: 0.9,
  }],
});

// La calculadora, en los 3 casos, deriva 05/06/2026 (distinto del 2026-02-05 real).
const calcDerivaOtraFecha = async () => [{ numero_contrato: '1234', fecha_inicio_mora: '05/06/2026', explicacion: 'recorrido de saldos' }];

async function runT9() {
  // (a) el extractor trae fecha acreditada por su propia cita → gana el extractor, cita intacta.
  const factsA = mkFacts(
    'cmr_a.pdf',
    '2026-02-05',
    'AVISO DE COBRANZA Cancelar cuotas atrasadas del 05-febrero de $ 235.084',
  );
  await enrichUnDocConMora(factsA, calcDerivaOtraFecha);
  eq('(a) gana la fecha literal del extractor', factsA.productos[0].fecha_mora, '2026-02-05');
  eq('(a) se conserva la cita original', factsA.productos[0].cita_fecha, 'AVISO DE COBRANZA Cancelar cuotas atrasadas del 05-febrero de $ 235.084');

  // (b) el extractor no trajo fecha → gana la calculadora (comportamiento actual, no romper).
  const factsB = mkFacts('cmr_b.pdf', undefined, undefined);
  await enrichUnDocConMora(factsB, calcDerivaOtraFecha);
  eq('(b) sin fecha del extractor, gana la calculadora', factsB.productos[0].fecha_mora, '2026-06-05');

  // (c) el extractor trae fecha, pero su cita NO la corrobora (es "Fecha último Pago", etiqueta
  // negativa) → esa fecha no está acreditada → gana la calculadora.
  const factsC = mkFacts('cmr_c.pdf', '2026-02-05', 'Fecha último Pago: 05/02/2026');
  await enrichUnDocConMora(factsC, calcDerivaOtraFecha);
  eq('(c) cita no acredita → gana la calculadora', factsC.productos[0].fecha_mora, '2026-06-05');
}

// --------------------------------------------------------------------------- salida
runT9().then(() => {
  console.log(`\n${pass} aserción(es) OK, ${fails.length} fallo(s).`);
  if (fails.length > 0) { fails.forEach((f) => console.error(`  ✗ ${f}`)); process.exit(1); }
}).catch((e) => { console.error(e); process.exit(1); });
