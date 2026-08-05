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
import { buildStep5Alert } from '../../src/utils/step5_alert';
import { buildSentinelResult } from '../../src/utils/sentinel';
import { applyDeterministicBackstops } from '../../src/utils/sentinel_backstops';
import { assembleRawFromDocFacts } from '../../src/utils/sentinel_per_doc';

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

// =========================================================================== T11 buildStep5Alert
section('T11 — las advertencias del Paso 5 se convierten en alerta accionable');

// (a) sin advertencias → no se alerta (no generar ruido)
eq('(a) sin advertencias no se emite alerta', buildStep5Alert([]), null);

// (b) una advertencia → texto en singular, con el detalle
{
  const desc = buildStep5Alert(['Falta el Certificado de Cotizaciones (obligatorio). El portal no permitirá continuar.']);
  ok('(b) con 1 advertencia se emite alerta', desc !== null);
  ok('(b) la alerta conserva el detalle de la advertencia', desc!.includes('Certificado de Cotizaciones'));
  ok('(b) el encabezado va en singular', desc!.includes('1 advertencia'));
}

// (c) varias advertencias → plural y TODAS presentes (ninguna se pierde por el camino)
{
  const desc = buildStep5Alert([
    'Falta el Certificado de Cotizaciones (obligatorio). El portal no permitirá continuar.',
    'No se pudo subir el justificativo liquidacion_marzo.pdf: timeout',
    'No se detectó redirección tras "Guardar y Continuar" en el Paso 5.',
  ]);
  ok('(c) el encabezado va en plural con el conteo', desc!.includes('3 advertencias'));
  ok('(c) conserva la advertencia 1', desc!.includes('Certificado de Cotizaciones'));
  ok('(c) conserva la advertencia 2', desc!.includes('liquidacion_marzo.pdf'));
  ok('(c) conserva la advertencia 3', desc!.includes('Guardar y Continuar'));
}

// =========================================================================== T12 buildSentinelResult
section('T12 — _dedupDrops y _fechaNoAcreditada llegan al result');

const noComputed = { reclassifiedCreditors: [], identified261Creditors: [], additionalCreditors: [], deReclassified261Creditors: [], fechasClave: [] };

// (a) raw con las dos señales pobladas → sobreviven en result, mismos elementos.
{
  const rawDedup = [{ bank: 'BancoEstado', op: 'CRE-123', kept: 100_000, dropped: 50_000, keptFile: 'a.pdf', droppedFile: 'b.pdf' }];
  const rawFechaNoAcred = [{ bank: 'CMR', monto: 235_084, fecha: '2026-02-05', cita: 'Fecha último Pago: 05/02/2026', filename: 'cmr.pdf' }];
  const raw: any = { success: true, errors: [], details: {}, _dedupDrops: rawDedup, _fechaNoAcreditada: rawFechaNoAcred };
  const result = buildSentinelResult(raw, noComputed);
  eq('(a) result._dedupDrops === raw._dedupDrops', result._dedupDrops, rawDedup as any);
  eq('(a) result._fechaNoAcreditada === raw._fechaNoAcreditada', result._fechaNoAcreditada, rawFechaNoAcred as any);
}

// (b) raw sin esas señales → no rompe; sentinel_backstops.ts las lee con `?? []`, tolera undefined.
{
  const raw: any = { success: true, errors: [], details: {} };
  const result = buildSentinelResult(raw, noComputed);
  eq('(b) sin señales en raw: result._dedupDrops queda undefined', result._dedupDrops, undefined);
  eq('(b) sin señales en raw: result._fechaNoAcreditada queda undefined', result._fechaNoAcreditada, undefined);
}

// =========================================================================== T13 evidence/product_type sobreviven a la reclasificación
section('T13 — reclasificar acreedores no pierde evidence ni degrada product_type');

const noDate = new Date('2026-08-05');

// (a)+(c) — reconciliación additional→identified261 (sentinel_backstops.ts:349-361): un
// additionalCreditor 'credito_consumo' cuyo monto cae dentro de tolerancia de una fila CMF del
// mismo banco AÚN SIN RECLAMAR se mueve a identified261. Debe conservar evidence Y product_type.
async function runT13a() {
  const cmfCreditors: any[] = [
    { institucion: 'Banco X', tipoCredito: 'Consumo', totalCredito: 1_000_000, vigente: 0, overdue30to59: 0, overdue60to89: 0, overdue90Days: 0, esIndirecta: false },
  ];
  const evidence = { cita_monto: 'Total adeudado $950.000', confidence: 0.87 };
  const additionalCreditors: any[] = [
    {
      bank: 'Banco X',
      institucion_cmf: 'Banco X',
      product_type: 'credito_consumo',
      categoria_articulo: 261,
      total_credito_clp: 950_000, // dentro del 30% / $500k de tolerancia vs la fila CMF ($1.000.000)
      reason: 'test reconciliación',
      document_filename: 'doc.pdf',
      needs_lawyer_confirmation: true,
      evidence,
    },
  ];
  const result: any = {
    success: true, errors: [], additionalCreditors,
    details: { meets90DaysRequirement: true, meetsAmountRequirement: true, totalAmountCLP: 0, creditorsWith90DaysCount: 0, documentsAgeValid: true, requiredCertificatesPresent: true },
  };
  await applyDeterministicBackstops(result, {
    cmfCreditors, documents: [], certificateAnalyses: [], catalog: [], clientRut: null, todayDate: noDate,
  } as any, () => {});

  eq('(a) additional→identified261: la reconciliación se disparó', (result.identified261Creditors ?? []).length, 1);
  ok('(a) additional→identified261 conserva evidence', result.identified261Creditors?.[0]?.evidence === evidence);
  eq('(c) additional→identified261 conserva product_type credito_consumo', result.identified261Creditors?.[0]?.product_type, 'credito_consumo');
}

// (b) — promoción identified261→additional (promoteOverflowIdentified261ToAdditional,
// sentinel_backstops.ts:206-220): sin ninguna fila CMF para esa institución (sin slots), el
// identified261Creditor se promueve a additionalCreditor. Debe conservar evidence.
async function runT13b() {
  const evidence = { cita_monto: 'Total $300.000', confidence: 0.85 };
  const identified261Creditors: any[] = [
    {
      bank: 'Fintech Y',
      product_type: 'otro',
      institucion_cmf: 'Fintech Y',
      total_credito_clp: 300_000,
      reason: 'test promoción',
      document_filename: 'fintech.pdf',
      evidence,
    },
  ];
  const result: any = {
    success: true, errors: [], identified261Creditors,
    details: { meets90DaysRequirement: true, meetsAmountRequirement: true, totalAmountCLP: 0, creditorsWith90DaysCount: 0, documentsAgeValid: true, requiredCertificatesPresent: true },
  };
  await applyDeterministicBackstops(result, {
    cmfCreditors: [], documents: [], certificateAnalyses: [], catalog: [], clientRut: null, todayDate: noDate,
  } as any, () => {});

  eq('(b) identified261→additional: la promoción se disparó', (result.additionalCreditors ?? []).length, 1);
  eq('(b) identified261 quedó vacío tras promover', (result.identified261Creditors ?? []).length, 0);
  ok('(b) identified261→additional conserva evidence', result.additionalCreditors?.[0]?.evidence === evidence);
}

// =========================================================================== T14 Capa 2 en la rama NO-CMF
section('T14 — la rama NO-CMF también exige que la cita corrobore el vencimiento');

// Emisor que NO figura en el CMF (cmfResult.creditors vacío, catalog vacío) → issuerInCmf() da
// false → el producto va por la rama additionalCreditors (sentinel_per_doc.ts:901-922), que hoy
// (antes del fix) tomaba fecha_mora sin pasar por citaCorroboratesVenc.
const mkFactsNoCmf = (filename: string, cita_fecha: string): DocFacts => ({
  filename,
  doc_type: 'estado_cuenta',
  institucion_asignada: 'Fintech Z',
  productos: [{
    monto: 500_000,
    etiqueta_monto: 'Saldo Deuda',
    moneda: 'CLP',
    cita_monto: 'Saldo deuda $500.000',
    fecha_mora: '2026-01-17', // ~200 días antes de todayStr (2026-08-05) → mora ≥91d
    cita_fecha,
    confidence: 0.9,
  }],
});
const cmfVacio = { creditors: [] };

// (a) la cita NO corrobora el vencimiento (etiqueta negativa "último pago") → debe caer a 261,
// sin fecha de mora declarada — el mismo guard que ya aplican las ramas CMF-matched y CMF-overflow.
{
  const raw = assembleRawFromDocFacts(
    [mkFactsNoCmf('fintech_a.pdf', 'Fecha último Pago: 17/01/2026')],
    cmfVacio, [], null, '2026-08-05',
  );
  const c = raw.additionalCreditors[0];
  eq('(a) NO-CMF sin cita que corrobore → Art. 261', c.categoria_articulo, 261);
  eq('(a) sin vencimiento acreditado, delinquency_start_date queda undefined', c.delinquency_start_date, undefined);
  eq('(a) se emite fechaNoAcreditada', raw._fechaNoAcreditada.length, 1);
}

// (b) NO REGRESIÓN: la cita SÍ corrobora el vencimiento (la fecha literal aparece, sin etiqueta
// negativa) → sigue siendo 260, con delinquency_start_date poblado. Si esto falla, el fix está mal.
{
  const raw = assembleRawFromDocFacts(
    [mkFactsNoCmf('fintech_b.pdf', 'Fecha de vencimiento: 17/01/2026')],
    cmfVacio, [], null, '2026-08-05',
  );
  const c = raw.additionalCreditors[0];
  eq('(b) NO-CMF con cita que corrobora → sigue Art. 260', c.categoria_articulo, 260);
  eq('(b) delinquency_start_date poblado', c.delinquency_start_date, '2026-01-17');
  eq('(b) no se emite fechaNoAcreditada', raw._fechaNoAcreditada.length, 0);
}

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

// =========================================================================== T10 alerta de discrepancia
section('T10 — dos fuentes de fecha_mora que difieren emiten señal accionable (needs_review)');

// La calculadora deriva 05/06/2026 en todos los casos salvo donde se indique lo contrario.
const calcDerivaJunio = async () => [{ numero_contrato: '1234', fecha_inicio_mora: '05/06/2026', explicacion: 'recorrido de saldos' }];
const calcDerivaFebrero = async () => [{ numero_contrato: '1234', fecha_inicio_mora: '05/02/2026', explicacion: 'recorrido de saldos' }];

async function runT10() {
  // (d) extractor acreditado por su cita (2026-02-05) vs calculadora que deriva otra fecha
  // (2026-06-05) → las dos fuentes DIFIEREN → señal con ambas fechas, ambas citas y el archivo.
  const factsD = mkFacts(
    'cmr_d.pdf',
    '2026-02-05',
    'AVISO DE COBRANZA Cancelar cuotas atrasadas del 05-febrero de $ 235.084',
  );
  await enrichUnDocConMora(factsD, calcDerivaJunio);
  const issuesD = factsD.claudeReadIssues ?? [];
  eq('(d) emite 1 señal de discrepancia', issuesD.length, 1);
  ok('(d) la señal es del archivo correcto', issuesD[0]?.document_filename === 'cmr_d.pdf');
  ok('(d) el detalle trae la fecha del extractor', issuesD[0]?.detalle.includes('2026-02-05'));
  ok('(d) el detalle trae la fecha de la calculadora', issuesD[0]?.detalle.includes('2026-06-05'));
  ok('(d) el detalle trae la cita del extractor', issuesD[0]?.detalle.includes('05-febrero'));

  // (e) extractor con cita que NO acredita (gana la calculadora, T9-c) pero la fecha impresa por el
  // acreedor SIGUE siendo una segunda fuente que difiere de la derivada → también alerta: el hecho de
  // que no esté acreditada como vencimiento no la vuelve automáticamente ruido, y es justo el caso real
  // medido en el consolidado de CMR (fecha_mora=2026-04-05 vs cita "05-febrero").
  const factsE = mkFacts('cmr_e.pdf', '2026-02-05', 'Fecha último Pago: 05/02/2026');
  await enrichUnDocConMora(factsE, calcDerivaJunio);
  eq('(e) también alerta cuando gana la calculadora', (factsE.claudeReadIssues ?? []).length, 1);

  // (f) las dos fuentes COINCIDEN (mismo día) → nada que decir, no se alerta de más.
  const factsF = mkFacts(
    'cmr_f.pdf',
    '2026-02-05',
    'AVISO DE COBRANZA Cancelar cuotas atrasadas del 05-febrero de $ 235.084',
  );
  await enrichUnDocConMora(factsF, calcDerivaFebrero);
  eq('(f) sin discrepancia: sin señales', (factsF.claudeReadIssues ?? []).length, 0);

  // (g) el extractor no trajo fecha (T9-b): no hay segunda fuente que comparar → sin señal.
  const factsG = mkFacts('cmr_g.pdf', undefined, undefined);
  await enrichUnDocConMora(factsG, calcDerivaJunio);
  eq('(g) sin fecha previa: sin señales', (factsG.claudeReadIssues ?? []).length, 0);
}

// --------------------------------------------------------------------------- salida
runT9().then(runT10).then(runT13a).then(runT13b).then(() => {
  console.log(`\n${pass} aserción(es) OK, ${fails.length} fallo(s).`);
  if (fails.length > 0) { fails.forEach((f) => console.error(`  ✗ ${f}`)); process.exit(1); }
}).catch((e) => { console.error(e); process.exit(1); });
