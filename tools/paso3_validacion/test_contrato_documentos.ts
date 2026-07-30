/**
 * TESTS del contrato de documentos dashboard → worker (Tanda A del plan
 * 2026-07-30-contrato-documentos-dashboard-worker.md).
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_contrato_documentos.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { identidadConfirmadaPorElPapel } from '../../src/utils/sentinel_backstops';

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

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
