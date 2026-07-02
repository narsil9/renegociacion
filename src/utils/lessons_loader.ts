/**
 * Inyección de la base viva de lecciones (`lecciones/`) al prompt de los agentes lectores.
 *
 * Principio (memoria `project_memoria_lecciones_centinela`): guardamos prueba-por-prueba lo aprendido
 * (reglas generales validadas vs verdad-terreno) en `lecciones/` divididas por paso, y lo INYECTAMOS
 * en el prompt de cada agente para que no repita errores. RAG por contexto, NO fine-tuning.
 *
 * Es ADITIVO y a prueba de fallos: si el archivo no está, devuelve "" (nunca rompe el run). Se lee una
 * sola vez por proceso (memo). Inyecta: (a) los principios generales completos (G1/G2/G3, cortos y de
 * máxima señal) y (b) el CUERPO COMPLETO de las reglas del paso (`paso3-acreedores.md` /
 * `paso5-ingresos.md`) — para que el LLM sepa tanto como quien las escribió (el detalle/por qué/ejemplo
 * testigo de cada regla, no solo el título). Es viable en costo porque el system prompt per-doc va con
 * `cache_control: ephemeral` (idéntico en las N llamadas por documento del run) → se cachea una vez.
 */
import * as fs from 'fs';
import * as path from 'path';

type Step = 'paso3' | 'paso5';
const FILE_BY_STEP: Record<Step, string> = { paso3: 'paso3-acreedores.md', paso5: 'paso5-ingresos.md' };

function lessonsDir(): string {
  // El worker corre desde la raíz del repo (ts-node src/worker.ts o node dist/worker.js desde la raíz),
  // por eso cwd/lecciones es lo más robusto; con fallbacks relativos al módulo por si acaso.
  const candidates = [
    path.join(process.cwd(), 'lecciones'),
    path.join(__dirname, '..', '..', 'lecciones'),
    path.join(__dirname, '..', '..', '..', 'lecciones'),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      /* siguiente candidato */
    }
  }
  return candidates[0];
}

function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

const cache = new Map<Step, string>();

/** Bloque compacto de lecciones para anexar al system prompt de un agente lector. "" si no hay archivos. */
export function loadReaderLessons(step: Step): string {
  const memo = cache.get(step);
  if (memo !== undefined) return memo;

  const dir = lessonsDir();
  const parts: string[] = [];

  const generales = readIfExists(path.join(dir, 'principios-generales.md'));
  if (generales) {
    // quita el encabezado H1 y el blockquote de formato; deja los principios G1/G2/G3
    const body = generales
      .replace(/^#[^\n]*\n/, '')
      .replace(/^>.*$/gm, '')
      .trim();
    if (body) parts.push(body);
  }

  const stepMd = readIfExists(path.join(dir, FILE_BY_STEP[step]));
  if (stepMd) {
    // CUERPO COMPLETO de las reglas del paso (todo lo que arranca en el 1er `### `): título + detalle,
    // el por qué y el ejemplo testigo de cada lección. Es lo que hace accionable la regla (un título
    // suelto no basta). Se recorta solo el preámbulo previo a la 1ª regla (encabezado del archivo).
    const firstRule = stepMd.search(/^###\s/m);
    const body = (firstRule >= 0 ? stepMd.slice(firstRule) : stepMd)
      .replace(/^>.*$/gm, '') // quita blockquotes de formato/meta
      .trim();
    if (body) {
      parts.push(
        `Lecciones validadas del paso (base de conocimiento del estudio; NO repetir estos errores, ` +
          `aplicar estas reglas al leer y clasificar):\n\n${body}`
      );
    }
  }

  const out = parts.length
    ? `\n\n=== LECCIONES VIVAS (base de conocimiento del estudio; fuente: lecciones/${FILE_BY_STEP[step]}) ===\n${parts.join('\n\n')}`
    : '';
  cache.set(step, out);
  return out;
}
