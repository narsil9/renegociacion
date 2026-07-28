/**
 * TEST de pureza y versionado de la extracción per-doc.
 *
 * El caché de lecturas depende de que la extracción NO dependa de la fecha. Si alguien
 * vuelve a meter "hoy" en el system prompt, este test lo agarra: una lectura cacheada
 * ayer devolvería hechos calculados con otra fecha.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_extraccion_pura.ts
 */
import { perDocSystemPrompt, PER_DOC_PROMPT_VERSION } from '../../src/utils/sentinel_per_doc';
import { lessonsVersion } from '../../src/utils/lessons_loader';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('═══ extracción pura + versiones ═══');

const p = perDocSystemPrompt();

// ⚠️ Corregido el 2026-07-28 durante la implementación. Acá había un check
// `!/\d{4}-\d{2}-\d{2}/.test(p)` ("el prompt no lleva ninguna fecha ISO") que era un proxy
// equivocado y **no puede pasar**: el prompt termina con `${loadReaderLessons('paso3')}`, así
// que incluye el corpus de lecciones con 40 marcas de procedencia del tipo `(2026-06-29)`
// —cuándo se validó cada lección— más 3 fechas en los ejemplos resueltos del few-shot
// (`fecha_mora:"2026-04-27"`). Ninguna es "hoy", y borrarlas degradaría justo el material que
// le enseña al modelo a leer fechas de mora.
// Los dos checks de abajo capturan el invariante REAL y son más fuertes: uno mira la fecha de
// hoy concreta, y el otro prueba estructuralmente que la función no puede conocer el día.
const hoy = new Date().toISOString().slice(0, 10);
check('el prompt no contiene la fecha de hoy', !p.includes(hoy), hoy);
check('la función no consulta la fecha por ninguna vía',
  !/new Date|Date\.now|todayStr|getCurrentChileDate/.test(perDocSystemPrompt.toString()));
check('el prompt no dice "Hoy es"', !/hoy es/i.test(p));
check('perDocSystemPrompt no toma argumentos', perDocSystemPrompt.length === 0);
check('el prompt es idéntico entre llamadas', perDocSystemPrompt() === perDocSystemPrompt());

// Sigue siendo el prompt del extractor: no se rompió nada al sacarle la fecha.
check('conserva la instrucción de no clasificar', /NO clasifiques Art\. 260\/261/.test(p));
check('conserva el contrato de salida', p.includes('"productos"') && p.includes('"cita_monto"'));

// Versiones
check('PER_DOC_PROMPT_VERSION no está vacía', typeof PER_DOC_PROMPT_VERSION === 'string' && PER_DOC_PROMPT_VERSION.length > 0);

const v3 = lessonsVersion('paso3');
const v5 = lessonsVersion('paso5');
check('lessonsVersion es estable', v3 === lessonsVersion('paso3'));
check('lessonsVersion distingue paso3 de paso5', v3 !== v5, `${v3} vs ${v5}`);
check('lessonsVersion es hex corto', /^[0-9a-f]{16}$/.test(v3), v3);

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
