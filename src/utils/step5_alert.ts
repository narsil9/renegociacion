/**
 * Arma el texto de la alerta del Paso 5 a partir de las advertencias que devuelve `fillStep5`.
 *
 * Existe como función pura y separada por dos motivos: (1) se llama desde dos lugares
 * (`worker.ts` y `all_steps.ts`) y el texto tiene que ser el mismo; (2) se puede testear sin
 * portal, sin Playwright y sin API — que es la única forma de probarlo hoy.
 *
 * Devuelve `null` cuando no hay nada que alertar: una alerta vacía sería ruido, y el abogado deja
 * de leer las que importan.
 */
export function buildStep5Alert(warnings: string[]): string | null {
  if (!warnings || warnings.length === 0) return null;
  const enc = warnings.length === 1
    ? 'El Paso 5 (Ingresos) terminó con 1 advertencia. Revisá el borrador en el portal:'
    : `El Paso 5 (Ingresos) terminó con ${warnings.length} advertencias. Revisá el borrador en el portal:`;
  return `${enc}\n${warnings.map((w) => `• ${w}`).join('\n')}`;
}
