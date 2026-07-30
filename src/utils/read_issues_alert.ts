/**
 * Construye el texto de la alerta `needs_review` que el worker emite al dashboard a partir
 * de las señales de la validación anti-error de la lectura nativa de Claude
 * (`SentinelResult.claudeReadIssues`). Función PURA y exportada para poder testearla sin
 * correr el worker/portal — el worker la llama y mete el texto en `automation_alerts`.
 *
 * La mayoría de las señales NO bloquean ni cambian la estructura: el monto se declara igual y el
 * aviso es para que el abogado lo verifique antes de presentar (regla G2: nunca bajar un valor en
 * silencio; las dudas se alertan).
 *
 * ⚠️ Excepción: las de `TIPOS_QUE_NO_DECLARAN` sí implican que el monto quedó FUERA de la
 * declaración (el guard de identidad del backstop). Van en un encabezado aparte y primero: si se
 * mezclaran con las otras, el texto diría "el monto se declaró igual" mientras falta una deuda en
 * la presentación. Al agregar un tipo nuevo, decidí en qué grupo va.
 */
import type { ClaudeReadIssue } from './sentinel';

const ETIQUETA: Record<ClaudeReadIssue['tipo'], string> = {
  baja_confianza: 'lectura poco nítida (escaneo/tabla ambigua) — verificar el monto',
  monto_sin_respaldo_en_cita: 'el monto no aparece literal en la cita del documento — verificar (puede ser suma de cupos o lectura errónea)',
  sin_evidencia: 'el robot no respaldó el monto con una cita del documento — verificar',
  rut_no_coincide: 'el RUT del emisor no coincide con la institución asignada — verificar a qué acreedor pertenece',
  documento_no_acredita: 'el documento de respaldo no acredita la deuda por sí solo (parece comprobante de pago o cartola) — verificar con un certificado formal',
  moneda_inconsistente: 'posible confusión de moneda entre UF y pesos al leer el monto — verificar el monto contra el documento',
  posible_duplicado: 'el mismo producto (igual nº de operación) aparece más de una vez — verificar que no se declare dos veces',
  posible_subdivision_operacion: 'la misma operación aparece con montos distintos y se declaró uno solo — si son sub-líneas de una tarjeta/crédito el monto correcto es la SUMA; verificar que no falte deuda',
  monto_trivial: 'monto menor a 1 UF — puede ser un remanente/comisión trivial (no declarar) o una deuda pequeña real (TGR/CCAF/multa); verificar',
  fecha_no_acreditada: 'el documento no acredita una fecha de vencimiento (la fecha leída era último pago / emisión / otorgamiento) — se declaró en Art. 261; verificar si corresponde Art. 260',
  nombre_de_archivo_repetido: 'dos documentos distintos del caso tienen el MISMO nombre de archivo — el robot asocia por nombre, así que puede haber mezclado sus datos; verificar a mano qué certificado respalda a cada acreedor y renombrar los archivos',
  identidad_no_confirmada: 'el documento NO imprime el RUT del acreedor que tiene asignado, así que el robot no pudo confirmar que ese papel sea de ese acreedor: el monto NO se declaró, para no atribuirle la deuda al equivocado. Identificá el emisor real del documento y declaralo a mano si corresponde',
};

/**
 * Señales en las que el monto NO se declaró (a diferencia del resto, que son avisos sobre un
 * monto que SÍ se declaró). El encabezado de la alerta tiene que decir la verdad: si dice "el
 * monto se declaró igual" cuando en realidad se cayó de la presentación, el abogado lee el aviso
 * y no hace nada mientras falta una deuda. Regla G2 aplicada al texto, no solo al dato.
 */
const TIPOS_QUE_NO_DECLARAN: ReadonlySet<ClaudeReadIssue['tipo']> = new Set<ClaudeReadIssue['tipo']>([
  'identidad_no_confirmada',
]);

const clp = (n: number | undefined): string =>
  typeof n === 'number' && n > 0 ? '$' + n.toLocaleString('es-CL') : '';

/**
 * Devuelve el texto de la alerta, o `null` si no hay señales (no se emite alerta).
 */
export function buildReadIssuesAlert(issues: ClaudeReadIssue[] | undefined | null): string | null {
  if (!issues || issues.length === 0) return null;
  const bullets = (xs: ClaudeReadIssue[]) =>
    xs
      .map((i) => {
        const monto = clp(i.monto_clp);
        return `• ${i.institucion}${monto ? ` (${monto})` : ''}: ${ETIQUETA[i.tipo] || i.detalle}`;
      })
      .join('\n');
  // Los montos que NO se declararon van en su propio encabezado y PRIMEROS: son los accionables
  // de verdad (falta una deuda en la presentación), no un "verificá por si acaso".
  const noDeclarados = issues.filter((i) => TIPOS_QUE_NO_DECLARAN.has(i.tipo));
  const declarados = issues.filter((i) => !TIPOS_QUE_NO_DECLARAN.has(i.tipo));
  const bloques: string[] = [];
  if (noDeclarados.length > 0) {
    const enc =
      noDeclarados.length === 1
        ? '⛔ 1 monto NO se declaró en el Paso 3 porque el robot no pudo confirmar de quién es la deuda. Revisalo y cargalo a mano si corresponde:'
        : `⛔ ${noDeclarados.length} montos NO se declararon en el Paso 3 porque el robot no pudo confirmar de quién es la deuda. Revisalos y cargalos a mano si corresponde:`;
    bloques.push(`${enc}\n${bullets(noDeclarados)}`);
  }
  if (declarados.length > 0) {
    const enc =
      declarados.length === 1
        ? 'El robot leyó 1 monto con baja certeza en el Paso 3. Verificalo contra el documento antes de presentar (el monto se declaró igual):'
        : `El robot leyó ${declarados.length} montos con baja certeza en el Paso 3. Verificalos contra el documento antes de presentar (los montos se declararon igual):`;
    bloques.push(`${enc}\n${bullets(declarados)}`);
  }
  return bloques.join('\n\n');
}
