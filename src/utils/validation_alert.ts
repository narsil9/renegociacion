/**
 * Arma el texto de la alerta de validación (vencimientos, monto insuficiente, etc.) a partir de
 * los `warnings` que devuelven `validateCentinelaOutput` / `validateMapeadorOutput` / etc.
 * (`src/agents/validator.ts`).
 *
 * Existe porque `logValidationResult` solo hace `log(...)` — los warnings del validador nunca
 * llegaban a `automation_alerts` (tabla que lee el panel del abogado). Misma forma que
 * `buildStep5Alert` (`src/utils/step5_alert.ts`): función pura, testeable sin portal ni API.
 *
 * Devuelve `null` cuando no hay nada que alertar: una alerta vacía sería ruido.
 */
export function buildValidationAlert(warnings: string[]): string | null {
  if (!warnings || warnings.length === 0) return null;
  const enc = warnings.length === 1
    ? 'La validación encontró 1 advertencia. Revisar antes de presentar:'
    : `La validación encontró ${warnings.length} advertencias. Revisar antes de presentar:`;
  return `${enc}\n${warnings.map((w) => `• ${w}`).join('\n')}`;
}
