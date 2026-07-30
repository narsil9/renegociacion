/**
 * TESTS del contrato de documentos dashboard → worker (Tanda A del plan
 * 2026-07-30-contrato-documentos-dashboard-worker.md).
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_contrato_documentos.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { identidadConfirmadaPorElPapel } from '../../src/utils/sentinel_backstops';
import { detectarInstitucionesNoResueltas } from '../../src/utils/sentinel';
import { documentosDeIngresoDescartados } from '../../src/utils/doc_scope';
import { buildMappedDocsDeterministic } from '../../src/utils/deterministic_mapeador';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('═══ Backstop: identidad confirmada por el papel ═══');

// El flag lo pone computeRutCheckLocal en la ÚNICA rama donde el RUT del acreedor asignado
// aparece en el certificado (sentinel.ts, Caso 1). El predicado solo lo lee: NO compara
// nombres, porque comparar institucion_cmf con bancoSegunRut falla en casos reales medidos
// ("Banco del Estado de Chile" vs "BancoEstado" dan claves distintas sin el alias cargado).
check('confirmado explícitamente → true',
  identidadConfirmadaPorElPapel({ filename: 'a.pdf', identidadAsignadaConfirmada: true }) === true);

// EL CASO BARRAZA REAL: estado de cuenta de una tarjeta FORUS etiquetado 'Banco de Chile'
// (ANALISIS_BARRAZA.md:52,56). El cross-check no encontró el RUT de Banco de Chile en el papel
// → el flag queda en false. Ojo: ese documento SÍ resuelve al catálogo (Banco de Chile, id
// 478), así que un guard por acreedor_canonico_id lo habría dejado pasar.
check('no confirmado → false (caso FORUS de Barraza)',
  identidadConfirmadaPorElPapel({ filename: 'ilovepdf_merged (22).pdf', identidadAsignadaConfirmada: false }) === false);

// Sin análisis del documento (imagen sin capa de texto, o no se pudo verificar):
// AUSENCIA DE PRUEBA NO ES PRUEBA.
check('sin análisis → false, no true por omisión',
  identidadConfirmadaPorElPapel(undefined) === false);

// Un análisis viejo sin el campo (retrocompatibilidad) tampoco confirma.
check('flag ausente → false',
  identidadConfirmadaPorElPapel({ filename: 'b.pdf' }) === false);

// ── El flag tiene que VIAJAR del origen al backstop ────────────────────────────
// Por qué es un chequeo sobre el CÓDIGO y no de comportamiento: `computeRutCheckLocal` es un
// closure dentro de `runSentinelCheck`, que necesita API de Anthropic y Supabase, así que la
// batería Tier 1 no puede ejercitarlo. Y el golden de backstops inyecta
// `identidadAsignadaConfirmada` directo en `certificateAnalyses`, así que tampoco cubre el
// tramo origen→backstop: borrar la propagación en sentinel.ts dejaba TODA la batería en verde.
// Este chequeo es el stopgap hasta que el dry_run end-to-end lo cubra (necesita cuota de API).
{
  const src = readFileSync(join(__dirname, '../../src/utils/sentinel.ts'), 'utf8');
  check('sentinel.ts marca la confirmación en el Caso 1 del cross-check de RUT',
    /result\.identidadAsignadaConfirmada\s*=\s*true/.test(src));
  check('sentinel.ts propaga el flag a certificateAnalyses',
    /identidadAsignadaConfirmada:\s*rutCheck\.identidadAsignadaConfirmada/.test(src));
}

// ── Task 9: instituciones que no resuelven contra el catálogo ────────────────────────────
// `computeRutCheckLocal` saca el RUT esperado del emisor con matchAcreedor(institucion_cmf).
// Si no resuelve, `assignedEntry` queda null y el chequeo NUNCA puede marcar `rutMismatch`:
// justo en los documentos donde la institución viene mal, la defensa contra "adjuntamos el
// certificado del banco equivocado" está APAGADA, y antes eso pasaba en silencio.
console.log('\n═══ Instituciones no resueltas ═══');
{
  const catalog = [
    { id: 478, nombre: 'Banco de Chile', nombre_normalizado: 'banco de chile', tipo: 'banco',
      rut: '97004000-5', direccion: null, comuna: null, email: null, telefono: null,
      representante_legal: null, rut_representante: null, activo: true,
      nombre_normalizado_local: 'banco de chile', nombres_alternativos: [], nombres_alternativos_norm: [] },
  ] as never;

  const issues = detectarInstitucionesNoResueltas(
    [
      { filename: 'a.pdf', institucion_cmf: 'Banco de Chile', document_type: 22 },
      { filename: 'b.pdf', institucion_cmf: 'Tricard S.A.', document_type: 22 },
      { filename: 'c.pdf', institucion_cmf: null, document_type: 24 },
    ],
    catalog
  );
  check('avisa por el cert cuya institución no resuelve',
    issues.length === 1 && issues[0].document_filename === 'b.pdf',
    `issues=${JSON.stringify(issues.map((i) => i.document_filename))}`);
  check('no avisa por el que sí resuelve ni por el documento de ingreso',
    !issues.some((i) => ['a.pdf', 'c.pdf'].includes(i.document_filename)));
  check('el tipo del issue es el suyo', issues[0]?.tipo === 'institucion_no_resuelta');
  check('el detalle nombra la institución que falló', /Tricard/.test(issues[0]?.detalle ?? ''));

  // Sin catálogo no se puede afirmar que una institución "no existe": sería culpar al dato
  // equivocado cuando el problema es que el catálogo no cargó.
  check('sin catálogo no inventa alertas',
    detectarInstitucionesNoResueltas([{ filename: 'b.pdf', institucion_cmf: 'Tricard S.A.', document_type: 22 }], [] as never).length === 0);

  // Un alias del catálogo SÍ resuelve → no alerta.
  const conAlias = [
    { ...(catalog as never as Array<Record<string, unknown>>)[0], nombres_alternativos: ['cmr falabella'],
      nombres_alternativos_norm: ['cmr falabella'] },
  ] as never;
  check('no alerta si resuelve por alias',
    detectarInstitucionesNoResueltas([{ filename: 'd.pdf', institucion_cmf: 'Banco de Chile', document_type: 22 }], conAlias).length === 0);
}

// ── Task 13: documentos que salen del Paso 5 por su metadata, con nombre que no lo delata ──
// La alerta de omisión del Paso 5 solo dispara si NO queda NINGÚN documento de ingreso. Un
// documento suelto que pasa a cert de acreedor (porque el proyector le puso institución)
// desaparece del Paso 5 en silencio — y con nombres genéricos como 'Certificado (4)_merged.pdf'
// o 'ilovepdf_merged (23).pdf' (dos nombres REALES de Barraza) nadie lo nota.
console.log('\n═══ Paso 5: documentos descartados ═══');
{
  const descartados = documentosDeIngresoDescartados([
    { filename: 'liquidacion.pdf', institucion_cmf: null, acreditacion_tipo: 'general', document_type: 24 },
    { filename: 'Certificado (4)_merged.pdf', institucion_cmf: 'Banco de Chile', acreditacion_tipo: 'monto', document_type: 22 },
    { filename: 'estado_cta_bci.pdf', institucion_cmf: 'BCI', acreditacion_tipo: 'monto', document_type: 22 },
  ]);
  check('lista el cert de nombre genérico que salió del Paso 5',
    descartados.includes('Certificado (4)_merged.pdf'), JSON.stringify(descartados));
  check('no lista la liquidación (sigue siendo de ingreso)', !descartados.includes('liquidacion.pdf'));
  check('no lista el doc cuyo nombre ya dice qué es', !descartados.includes('estado_cta_bci.pdf'));
  // "Certificado" a secas NO delata: puede ser de renta o de cotizaciones. La keyword tiene que
  // nombrar el TIPO de documento ('deuda', 'estado de cuenta', 'cartola'), no la palabra suelta.
  check('un "Certificado ..." ambiguo sigue alertando',
    documentosDeIngresoDescartados([
      { filename: 'Certificado.pdf', institucion_cmf: 'Banco X', acreditacion_tipo: 'monto', document_type: 22 },
    ]).length === 1);
  check('un "certificado de deuda" explícito no alerta',
    documentosDeIngresoDescartados([
      { filename: 'certificado_de_deuda_bci.pdf', institucion_cmf: 'BCI', acreditacion_tipo: 'monto', document_type: 22 },
    ]).length === 0);

  // El nombre real de Barraza, que es el caso testigo.
  const barraza = documentosDeIngresoDescartados([
    { filename: 'ilovepdf_merged (23).pdf', institucion_cmf: 'Tanner', acreditacion_tipo: 'monto', document_type: 22 },
  ]);
  check('lista el ilovepdf_merged de Barraza', barraza.length === 1, JSON.stringify(barraza));

  // Sin descartes no hay ruido.
  check('un caso sano no produce lista',
    documentosDeIngresoDescartados([
      { filename: 'liquidacion.pdf', institucion_cmf: null, acreditacion_tipo: 'general', document_type: 24 },
    ]).length === 0);
}

// ── Task 6: el Mapeador no pierde el documento cuando el nombre no matchea ───────────────
// `reclassifiedCreditors` y `additionalCreditors` matcheaban por filename exacto SIN fallback
// (identified261 sí lo tenía). Con Barraza eso es `ilovepdf_merged (22).pdf` y `(23).pdf`: si el
// nombre cambia —y la Task 7 renombra TODO— las dos filas se declaran SIN certificado adjunto.
//
// Pero el fallback cambia un fallo visible por uno invisible, así que cada vez que adivina tiene
// que alertar, y con un tipo NO BLOQUEANTE: `missing_document` frena el Paso 3 entero
// (mapeador_agent.mapeadorHasBlockers / validator.ts), o sea la alerta abortaría la corrida que
// el fallback venía a salvar.
console.log('\n═══ Mapeador: fallback por institución ═══');
// `buildMappedDocsDeterministic` es async → el bloque va en una IIFE y el resumen final adentro.
void (async () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    id: 'd1', client_id: 'c1', document_type: 22, acreditacion_tipo: 'monto',
    institucion_cmf: 'Banco de Chile', storage_path: 'x/certs/drive-1_cert.pdf',
    filename: 'drive-1_cert.pdf', uploaded_at: '2026-07-21T00:00:00.000Z', ...over,
  } as never);
  const centinela = (over: Record<string, unknown> = {}) => ({
    reclassifiedCreditors: [], identified261Creditors: [], additionalCreditors: [],
    cmfDocumentOverrides: [], deReclassified261Creditors: [], fechasClave: [], ...over,
  } as never);
  const logger = { log: () => {} };

  // El Centinela nombró el archivo con el nombre VIEJO (output cacheado antes del rename).
  const out = await buildMappedDocsDeterministic(
    centinela({
      reclassifiedCreditors: [{
        bank: 'Banco de Chile', institucion_cmf: 'Banco de Chile', product_type: 'tarjeta_credito',
        delinquency_days: 120, delinquency_start_date: '2026-02-01', total_credito_clp: 5_900_000,
        reason: '', document_filename: 'ilovepdf_merged (22).pdf',
      }],
    }),
    [doc({ filename: 'drive-1_ilovepdf_merged (22).pdf' })],
    [],
    logger
  );
  check('reclasificado: cae al fallback por institución en vez de perder el doc',
    out.mappedDocs.length >= 1,
    `mappedDocs=${out.mappedDocs.length} alerts=${out.alerts.map((a: any) => a.type).join(',')}`);
  check('caer al fallback deja una alerta',
    out.alerts.some((a: any) => /fallback|no nombr|misma instituci/i.test(a.message)),
    JSON.stringify(out.alerts.map((a: any) => a.message)));
  check('y esa alerta NO es bloqueante (no puede abortar el Paso 3)',
    out.alerts.every((a: any) => a.type !== 'missing_document' && a.type !== 'rut_mismatch'),
    JSON.stringify(out.alerts.map((a: any) => a.type)));

  const out2 = await buildMappedDocsDeterministic(
    centinela({
      additionalCreditors: [{
        bank: 'Tanner', institucion_cmf: 'Tanner Servicios Financieros', product_type: 'otro',
        categoria_articulo: 261, total_credito_clp: 1_000_000, reason: '',
        document_filename: 'ilovepdf_merged (23).pdf',
      }],
    }),
    [doc({ institucion_cmf: 'Tanner Servicios Financieros', filename: 'drive-2_ilovepdf_merged (23).pdf' })],
    [],
    logger
  );
  check('NO-CMF: cae al fallback por institución', out2.mappedDocs.length >= 1, `mappedDocs=${out2.mappedDocs.length}`);
  check('NO-CMF: el fallback tampoco bloquea',
    out2.alerts.every((a: any) => a.type !== 'missing_document'),
    JSON.stringify(out2.alerts.map((a: any) => a.type)));

  // El fallback NO inventa: sin ningún doc de esa institución, sigue alertando missing_document
  // (ahí SÍ corresponde bloquear: no hay con qué acreditar).
  const out3 = await buildMappedDocsDeterministic(
    centinela({
      reclassifiedCreditors: [{
        bank: 'Scotiabank', institucion_cmf: 'Scotiabank Chile', product_type: 'otro',
        delinquency_days: 100, delinquency_start_date: '2026-03-01', total_credito_clp: 1,
        reason: '', document_filename: 'no-existe.pdf',
      }],
    }),
    [doc()],
    [],
    logger
  );
  check('sin doc de esa institución, sigue alertando missing_document',
    out3.alerts.some((a: any) => a.type === 'missing_document'));

  // Match EXACTO: no alerta, porque no adivinó nada.
  const out4 = await buildMappedDocsDeterministic(
    centinela({
      reclassifiedCreditors: [{
        bank: 'Banco de Chile', institucion_cmf: 'Banco de Chile', product_type: 'tarjeta_credito',
        delinquency_days: 120, delinquency_start_date: '2026-02-01', total_credito_clp: 5_900_000,
        reason: '', document_filename: 'drive-1_cert.pdf',
      }],
    }),
    [doc()],
    [],
    logger
  );
  check('con match exacto no hay alerta de fallback',
    !out4.alerts.some((a: any) => /fallback|misma instituci/i.test(a.message)),
    JSON.stringify(out4.alerts.map((a: any) => a.message)));

  console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
  process.exit(fail === 0 ? 0 : 1);
})();
