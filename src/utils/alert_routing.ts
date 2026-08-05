/**
 * Decide qué señales tienen que llegarle al abogado en `automation_alerts`.
 *
 * Existe porque el worker enrutaba 3 de los 6 tipos de alerta del Mapeador
 * (`rut_mismatch`, `missing_document`, `amount_mismatch`) y los otros 3 —`expired_cmf`,
 * `expired_certificate`, `other`— quedaban solo en `agent_runs`, tabla que el panel no lee.
 * Mismo hueco con las contribuciones morosas: `validator.ts` las detecta y pone
 * `needs_lawyer_review`, y ahí termina.
 *
 * Función pura: recibe las señales y devuelve las líneas a insertar. El worker hace el INSERT.
 */
export function senalesParaElAbogado(input: {
  alerts: Array<{ type: string; message: string }>;
  contribucionesDeuda: Array<{ rol: string }>;
  yaEnrutados: readonly string[];
}): string[] {
  const out: string[] = [];

  const etiqueta: Record<string, string> = {
    expired_cmf: 'CMF vencido',
    expired_certificate: 'certificado vencido',
    other: 'revisión del Mapeador',
  };
  for (const a of input.alerts) {
    if (input.yaEnrutados.includes(a.type)) continue;   // ya tiene su propia ruta
    out.push(`${etiqueta[a.type] ?? a.type}: ${a.message}`);
  }

  if (input.contribucionesDeuda.length > 0) {
    const roles = input.contribucionesDeuda.map((p) => p.rol).join(', ');
    out.push(
      `${input.contribucionesDeuda.length} propiedad(es) con contribuciones morosas (Rol ${roles}). ` +
      `Requiere Certificado de Deuda TGR — declarar como acreedor no-CMF. ` +
      `TGR no está en el catálogo de acreedores, así que el checklist no lo pide solo.`
    );
  }

  return out;
}
