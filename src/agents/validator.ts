/**
 * TS Validator — comprobaciones deterministas sobre los outputs de cada agente.
 * Se llama ANTES de `completeRun` para bloquear si hay errores estructurales o
 * de negocio, y ANTES de Playwright para confirmar que el agente anterior es válido.
 *
 * Reglas que aplica:
 *   - Regla 30d: CMF y certificados ≤30 días (salteable con BYPASS_DATE_CHECK=true)
 *   - Estructura: shape mínimo de cada output (type guards)
 *   - Art. 260 con vencimiento: reclasificados y no-CMF-260 deben tener fecha
 *   - Requisito de sesión: ≥2 productos con mora ≥91d
 *   - Monto ≥80 UF: advertencia no bloqueante
 *   - Filenames únicos por institución en mappedDocs
 *   - RUT mismatch → bloqueante (salteable con BYPASS_RUT_CHECK=true para pruebas)
 *   - missing_document → needsLawyerReview + error bloqueante (no salteable)
 *
 * No hace llamadas a Supabase ni a la API de Claude — es pura lógica TS.
 */

import {
  TributarioOutput,
  CmfParseOutput,
  CentinelaOutput,
  MapeadorOutput,
  AgentType,
} from './types';

// ---------------------------------------------------------------------------
// Resultado de validación
// ---------------------------------------------------------------------------

export interface ValidationResult {
  /** false si hay al menos un error bloqueante. */
  valid: boolean;
  /** true si el abogado debe revisar antes de que Playwright continúe. */
  needsLawyerReview: boolean;
  /** Errores bloqueantes — el agente debe llamar failRun() si alguno está presente. */
  errors: string[];
  /** Advertencias no bloqueantes — se loguean pero no detienen el flujo. */
  warnings: string[];
}

function getBypassDateCheck(): boolean {
  return (
    process.env.BYPASS_DATE_CHECK === 'true' ||
    process.env.BYPASS_DATE_VALIDATION === 'true'
  );
}

function getBypassRutCheck(): boolean {
  return process.env.BYPASS_RUT_CHECK === 'true';
}

// ---------------------------------------------------------------------------
// Type guards — comprobación de shape en tiempo de ejecución sobre JSONB de Supabase
// ---------------------------------------------------------------------------

export function isTributarioOutput(v: unknown): v is TributarioOutput {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.categoria === 'string' &&
    ['primera', 'segunda', 'ninguna'].includes(o.categoria) &&
    Array.isArray(o.f29_meses_con_actividad) &&
    (o.contribuciones_deuda === undefined || Array.isArray(o.contribuciones_deuda))
  );
}

export function isCmfParseOutput(v: unknown): v is CmfParseOutput {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.creditors) &&
    typeof o.cmfAgeDays === 'number' &&
    typeof o.qualifying90PlusCount === 'number' &&
    typeof o.meets90DaysRequirement === 'boolean' &&
    typeof o.meetsAmountRequirement === 'boolean' &&
    typeof o.totalCreditoOf90PlusCreditors === 'number' &&
    typeof o.ufValueCLP === 'number'
  );
}

export function isCentinelaOutput(v: unknown): v is CentinelaOutput {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.reclassifiedCreditors) &&
    Array.isArray(o.identified261Creditors) &&
    Array.isArray(o.additionalCreditors) &&
    Array.isArray(o.cmfDocumentOverrides) &&
    Array.isArray(o.fechasClave)
  );
}

export function isMapeadorOutput(v: unknown): v is MapeadorOutput {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.mappedDocs) && Array.isArray(o.alerts);
}

/** Devuelve el type guard correcto para cada AgentType. */
export function isValidOutput(agentType: AgentType, v: unknown): boolean {
  switch (agentType) {
    case 'tributario':   return isTributarioOutput(v);
    case 'cmf_parser':   return isCmfParseOutput(v);
    case 'centinela':    return isCentinelaOutput(v);
    case 'mapeador':     return isMapeadorOutput(v);
  }
}

// ---------------------------------------------------------------------------
// Validadores por agente
// ---------------------------------------------------------------------------

/**
 * Step 2 — Tributario.
 * Categoría válida; primera-categoría con actividad F29 → revisión abogado.
 */
export function validateTributarioOutput(output: TributarioOutput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let needsLawyerReview = false;

  if (!['primera', 'segunda', 'ninguna'].includes(output.categoria)) {
    errors.push(`categoria inválida: "${output.categoria}"`);
  }

  if (output.categoria === 'primera' && output.f29_meses_con_actividad.length > 0) {
    needsLawyerReview = true;
    warnings.push(
      `Primera categoría con actividad F29 en ${output.f29_meses_con_actividad.length} mes(es): ` +
      output.f29_meses_con_actividad.join(', ')
    );
  }

  if (output.contribuciones_deuda && output.contribuciones_deuda.length > 0) {
    needsLawyerReview = true;
    warnings.push(
      `${output.contribuciones_deuda.length} propiedad(es) con contribuciones morosas ` +
      `(${output.contribuciones_deuda.map(p => `Rol ${p.rol}`).join(', ')}). ` +
      'Requiere Certificado de Deuda TGR — declarar como acreedor no-CMF.'
    );
  }

  return { valid: errors.length === 0, needsLawyerReview, errors, warnings };
}

/**
 * Step 3 — CMF Parser (TS determinista, sin Claude).
 * Antigüedad del CMF ≤30d; ≥2 productos 91+ días; advertencia si <80 UF.
 */
export function validateCmfParseOutput(output: CmfParseOutput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (output.cmfAgeDays > 30) {
    const msg = `CMF vencido: ${output.cmfAgeDays} días de antigüedad (máx 30).`;
    if (getBypassDateCheck()) {
      warnings.push(`⚠️  ${msg} — BYPASS_DATE_CHECK activo`);
    } else {
      errors.push(`${msg} Usa BYPASS_DATE_CHECK=true para pruebas.`);
    }
  }

  if (!output.meets90DaysRequirement) {
    errors.push(
      `Requisito de sesión no cumplido: ${output.qualifying90PlusCount} producto(s) con ` +
      'mora ≥91 días (mínimo 2 requeridos).'
    );
  }

  if (!output.meetsAmountRequirement) {
    const uf80 = (80 * output.ufValueCLP).toLocaleString('es-CL');
    warnings.push(
      `⚠️  Monto insuficiente para la sesión: ` +
      `$${output.totalCreditoOf90PlusCreditors.toLocaleString('es-CL')} < $${uf80} (80 UF). ` +
      'Verificar con documentos actualizados.'
    );
  }

  return { valid: errors.length === 0, needsLawyerReview: false, errors, warnings };
}

/**
 * Step 3 — Centinela (Claude API #1).
 * Reclasificados y no-CMF-260 deben tener fecha de vencimiento.
 * Cualquier acreedor con needs_lawyer_confirmation → needsLawyerReview.
 */
export function validateCentinelaOutput(output: CentinelaOutput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let needsLawyerReview = false;

  for (const r of output.reclassifiedCreditors) {
    if (!r.delinquency_start_date) {
      errors.push(
        `Reclasificado Art.260 "${r.bank}" (${r.product_type}) sin fecha de vencimiento.`
      );
    }
    if (!r.total_credito_clp) {
      errors.push(`Reclasificado "${r.bank}" (${r.product_type}) sin monto.`);
    }
  }

  for (const a of output.additionalCreditors) {
    if (a.categoria_articulo === 260 && !a.delinquency_start_date) {
      errors.push(
        `Acreedor no-CMF Art.260 "${a.bank}" (${a.product_type}) sin fecha de vencimiento.`
      );
    }
    if (!a.total_credito_clp) {
      errors.push(
        `Acreedor no-CMF "${a.bank}" (${a.product_type}) sin monto.`
      );
    }
    if (a.categoria_articulo !== 260 && a.categoria_articulo !== 261) {
      errors.push(
        `Acreedor no-CMF "${a.bank}" con categoría de artículo inválida: ${a.categoria_articulo}`
      );
    }
    if (a.needs_lawyer_confirmation) {
      needsLawyerReview = true;
    }
  }

  if (output.additionalCreditors.length > 0) {
    warnings.push(
      `${output.additionalCreditors.length} acreedor(es) no-CMF detectados ` +
      '— verificar confirmación del abogado antes de presentar.'
    );
  }

  // Gate de acreditación Art. 260: un override 260 directo del CMF sin fecha de vencimiento
  // no acredita el vencimiento. NO es error bloqueante (el backstop del Centinela ya lo
  // degrada a 261); solo advertencia + revisión del abogado.
  for (const o of output.cmfDocumentOverrides ?? []) {
    if (!o.fecha_vencimiento || String(o.fecha_vencimiento).trim().length === 0) {
      warnings.push(
        `Override Art.260 "${o.institucion_cmf}" sin fecha de vencimiento — revisar (debería declararse en Art. 261).`
      );
      needsLawyerReview = true;
    }
  }

  const expiredCmfClave = output.fechasClave.find(f => f.tipo === 'expiracion_cmf' && f.diasRestantes < 0);
  if (expiredCmfClave) {
    const msg = `CMF vencido: ${expiredCmfClave.detalle}`;
    if (getBypassDateCheck()) {
      warnings.push(`⚠️  ${msg} — BYPASS_DATE_CHECK activo`);
    } else {
      errors.push(msg);
    }
  }

  const expiredCerts = output.fechasClave.filter(f => f.tipo === 'expiracion_certificado' && f.diasRestantes < 0);
  for (const c of expiredCerts) {
    if (getBypassDateCheck()) {
      warnings.push(`⚠️  Certificado expirado: ${c.detalle} — BYPASS_DATE_CHECK activo`);
    } else {
      errors.push(`Certificado expirado: ${c.detalle}`);
    }
  }

  return { valid: errors.length === 0, needsLawyerReview, errors, warnings };
}

/**
 * Step 3 — Mapeador (Claude API #2).
 * RUT mismatch y missing_document son bloqueantes (needsLawyerReview).
 * expired_* respeta BYPASS_DATE_CHECK.
 * Filenames duplicados entre instituciones distintas → error.
 */
export function validateMapeadorOutput(output: MapeadorOutput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let needsLawyerReview = false;

  for (const alert of output.alerts) {
    if (alert.type === 'rut_mismatch') {
      const msg = `RUT mismatch: ${alert.message}`;
      if (getBypassRutCheck()) {
        warnings.push(`⚠️  ${msg} — BYPASS_RUT_CHECK activo`);
      } else {
        errors.push(msg);
        needsLawyerReview = true;
      }
    } else if (alert.type === 'missing_document') {
      errors.push(`Documento faltante: ${alert.message}`);
      needsLawyerReview = true;
    } else if (alert.type === 'expired_cmf' || alert.type === 'expired_certificate') {
      const msg = `Documento vencido: ${alert.message}`;
      if (getBypassDateCheck()) {
        warnings.push(`⚠️  ${msg} — BYPASS_DATE_CHECK activo`);
      } else {
        errors.push(msg);
      }
    } else if (alert.type === 'amount_mismatch') {
      warnings.push(`⚠️  Diferencia de monto: ${alert.message}`);
    } else {
      warnings.push(`Alerta: ${alert.message}`);
    }
  }

  // Filenames duplicados en instituciones distintas
  const filenameToInstitution = new Map<string, string>();
  for (const doc of output.mappedDocs) {
    if (!doc.filename) continue;
    const existing = filenameToInstitution.get(doc.filename);
    if (existing && existing !== doc.institucion_cmf) {
      errors.push(
        `Filename duplicado entre instituciones: "${doc.filename}" asignado a ` +
        `"${existing}" y a "${doc.institucion_cmf}".`
      );
    } else {
      filenameToInstitution.set(doc.filename, doc.institucion_cmf);
    }
  }

  return { valid: errors.length === 0, needsLawyerReview, errors, warnings };
}

// ---------------------------------------------------------------------------
// Helpers de uso en agentes
// ---------------------------------------------------------------------------

/**
 * Fusiona dos ValidationResult. El resultado es inválido si alguno lo es.
 * needsLawyerReview y warnings se acumulan.
 */
export function mergeResults(...results: ValidationResult[]): ValidationResult {
  return results.reduce(
    (acc, r) => ({
      valid: acc.valid && r.valid,
      needsLawyerReview: acc.needsLawyerReview || r.needsLawyerReview,
      errors: [...acc.errors, ...r.errors],
      warnings: [...acc.warnings, ...r.warnings],
    }),
    { valid: true, needsLawyerReview: false, errors: [], warnings: [] }
  );
}

/**
 * Loga el resultado de validación. Compatible con el logger simple de step3.
 */
export function logValidationResult(
  result: ValidationResult,
  label: string,
  log: (msg: string) => void
): void {
  if (result.errors.length > 0) {
    log(`[Validator] ❌ ${label} — ${result.errors.length} error(es):`);
    for (const e of result.errors) log(`  • ${e}`);
  }
  if (result.warnings.length > 0) {
    log(`[Validator] ⚠️  ${label} — ${result.warnings.length} advertencia(s):`);
    for (const w of result.warnings) log(`  • ${w}`);
  }
  if (result.needsLawyerReview) {
    log(`[Validator] 👨‍⚖️ ${label} — requiere revisión del abogado antes de continuar.`);
  }
  if (result.valid && result.errors.length === 0 && result.warnings.length === 0) {
    log(`[Validator] ✅ ${label} — OK`);
  }
}
