/**
 * Construye el texto de la alerta `needs_review` que el worker emite al dashboard a partir
 * de las señales de la validación anti-error de la lectura nativa de Claude
 * (`SentinelResult.claudeReadIssues`). Función PURA y exportada para poder testearla sin
 * correr el worker/portal — el worker la llama y mete el texto en `automation_alerts`.
 *
 * Las señales NO bloquean ni cambian la estructura: el monto se declara igual. Son un aviso
 * para que el abogado verifique el monto/identidad antes de presentar (regla G2: nunca bajar
 * un valor en silencio; las dudas se alertan).
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
};

const clp = (n: number | undefined): string =>
  typeof n === 'number' && n > 0 ? '$' + n.toLocaleString('es-CL') : '';

/**
 * Devuelve el texto de la alerta, o `null` si no hay señales (no se emite alerta).
 */
export function buildReadIssuesAlert(issues: ClaudeReadIssue[] | undefined | null): string | null {
  if (!issues || issues.length === 0) return null;
  const bullets = issues
    .map((i) => {
      const monto = clp(i.monto_clp);
      return `• ${i.institucion}${monto ? ` (${monto})` : ''}: ${ETIQUETA[i.tipo] || i.detalle}`;
    })
    .join('\n');
  const enc =
    issues.length === 1
      ? 'El robot leyó 1 monto con baja certeza en el Paso 3. Verificalo contra el documento antes de presentar (el monto se declaró igual):'
      : `El robot leyó ${issues.length} montos con baja certeza en el Paso 3. Verificalos contra el documento antes de presentar (los montos se declararon igual):`;
  return `${enc}\n${bullets}`;
}
