/**
 * TEST de la lectura de la Carpeta Tributaria (`pdf_analyzer.ts`), sin PDF ni API: ambas
 * funciones aceptan `preExtractedText`.
 *
 * Cubre los tres falsos positivos que bloqueaban casos VÁLIDOS (un bloqueo por F29 deja el job
 * en 'blocked' y el caso nunca se presenta):
 *   1. La columna "Fecha declaración" (15/04/2026) marcaba abril como período F29 activo.
 *   2. Los períodos vacíos ("No se registra declaración para este período") solo se ignoraban
 *      en el patrón de nombres de mes, no en mm/aaaa ni en ISO.
 *   3. Una CT que dice "Segunda Categoría" se leía como 'primera' porque la ventana de 150
 *      chars se comía la línea siguiente ("...actividades de Primera Categoría vigentes").
 */
import { analyzeTaxCategory, detectF29ActivityLast24Months } from '../../src/utils/pdf_analyzer';

const silent = { log: () => {}, error: () => {} };
let ok = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};

/** "Marzo 2026" para un mes relativo al actual (dentro de la ventana de 24 meses). */
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function mesRelativo(offset: number): { nombre: string; mm: string; yyyy: string } {
  const hoy = new Date();
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - offset, 1);
  return {
    nombre: `${MESES[d.getMonth()]} ${d.getFullYear()}`,
    mm: String(d.getMonth() + 1).padStart(2, '0'),
    yyyy: String(d.getFullYear()),
  };
}

async function main() {
  console.log('═══ Carpeta Tributaria: categoría + actividad F29 ═══');

  const m1 = mesRelativo(1);
  const m2 = mesRelativo(2);

  // --- F29: períodos vacíos con columna "Fecha declaración" → SIN actividad ---
  const ctVacia = `
Declaraciones de IVA - Formulario 29
Período        Fecha declaración   Estado
${m1.nombre}    15/${m1.mm}/${m1.yyyy}    No se registra declaración para este período.
${m2.nombre}    13/${m2.mm}/${m2.yyyy}    No se registra declaración para este período.
`;
  const rVacia = await detectF29ActivityLast24Months('dummy.pdf', silent, ctVacia);
  check('36 períodos vacíos con fecha de declaración → SIN actividad F29',
    rVacia.hasActivityLast24Months === false,
    `activeMonths=${JSON.stringify(rVacia.activeMonths)}`);

  // --- F29: períodos vacíos en formato mm/aaaa (sin nombre de mes) → SIN actividad ---
  const ctVaciaMm = `
Formulario 29
${m1.mm}/${m1.yyyy}   No se registra declaración para este período.
${m2.mm}/${m2.yyyy}   No se registra declaración para este período.
`;
  const rVaciaMm = await detectF29ActivityLast24Months('dummy.pdf', silent, ctVaciaMm);
  check('períodos vacíos en mm/aaaa → SIN actividad F29',
    rVaciaMm.hasActivityLast24Months === false,
    `activeMonths=${JSON.stringify(rVaciaMm.activeMonths)}`);

  // --- F29: actividad REAL sigue detectándose (no se rompió el bloqueo legítimo) ---
  const ctConActividad = `
Declaraciones de IVA - Formulario 29
${m1.nombre}   Débito Fiscal 1.250.000   Crédito Fiscal 900.000   Folio 123456789
`;
  const rActiva = await detectF29ActivityLast24Months('dummy.pdf', silent, ctConActividad);
  check('período CON débito/crédito declarado → CON actividad F29',
    rActiva.hasActivityLast24Months === true && rActiva.activeMonths.includes(`${m1.yyyy}-${m1.mm}`),
    `activeMonths=${JSON.stringify(rActiva.activeMonths)}`);

  // --- Categoría: "Segunda Categoría" no se contamina con la línea siguiente ---
  const ctSegunda = `
Datos del Contribuyente
Categoría Tributaria: Segunda Categoría
Observación: no registra actividades de Primera Categoría vigentes.
`;
  const catSegunda = await analyzeTaxCategory('dummy.pdf', silent, ctSegunda);
  check('etiqueta "Segunda Categoría" + mención a Primera en la línea siguiente → segunda',
    catSegunda === 'segunda', `devolvió "${catSegunda}"`);

  // --- Categoría: primera sigue siendo primera ---
  const ctPrimera = `
Datos del Contribuyente
Categoría Tributaria: Primera Categoría
`;
  const catPrimera = await analyzeTaxCategory('dummy.pdf', silent, ctPrimera);
  check('etiqueta "Primera Categoría" → primera', catPrimera === 'primera', `devolvió "${catPrimera}"`);

  // --- Categoría: el formulario F22 embebido no debe decidir la categoría ---
  const ctF22 = `
Datos del Contribuyente
Actividades económicas: Servicios profesionales
Declaraciones de Renta
Formulario 22
CRÉDITO POR IMPUESTO DE PRIMERA CATEGORÍA        0
`;
  const catF22 = await analyzeTaxCategory('dummy.pdf', silent, ctF22);
  check('encabezado F22 en dos líneas (sin guión) → la etiqueta del F22 NO define la categoría',
    catF22 !== 'primera', `devolvió "${catF22}"`);

  console.log(`\n${fail === 0 ? '✅' : '❌'} Carpeta Tributaria: ${ok} OK, ${fail} fallos.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
