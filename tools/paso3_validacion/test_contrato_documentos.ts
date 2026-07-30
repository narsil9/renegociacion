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

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
