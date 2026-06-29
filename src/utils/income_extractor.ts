/**
 * income_extractor.ts — Núcleo DETERMINISTA del Paso 5 (Ingresos).
 *
 * Filosofía del proyecto (regla rectora): el LLM extrae HECHOS de los documentos
 * (líquidos por período, líneas de descuento, categoría del documento, metadatos del
 * certificado de cotizaciones); TypeScript blinda la ESTRUCTURA de forma determinista:
 *   - elegir "Líquido a pagar" (no "Alcance Líquido")            → lección L1
 *   - sumar de vuelta SOLO los descuentos VOLUNTARIOS            → lección L2
 *   - promediar/mensualizar según el tipo de ingreso            → lección L3
 *   - periodicidad Mensual (salvo única vez)                    → lección L4
 *   - mapear cada doc a los DOS enums del portal (crosswalk)    → lección L7
 *
 * General para CUALQUIER cliente: no hay nada hardcodeado al caso testigo (Jorge Romero).
 * Ver lecciones/paso5-ingresos.md.
 */

// ---------------------------------------------------------------------------
// Categorías semánticas que devuelve el LLM (set CERRADO). El LLM NO elige el
// `value` del portal — devuelve una de estas etiquetas y TS la mapea (L7).
// ---------------------------------------------------------------------------
export type IncomeCategory =
  | 'liquidacion_sueldo'
  | 'comprobante_pension'
  | 'licencia_medica'
  | 'aporte_terceros_deudas'
  | 'aporte_terceros_gastos'
  | 'comprobante_arriendo'
  | 'retiro_sociedades'
  | 'honorarios'
  | 'esporadico'
  | 'otro'
  | 'certificado_cotizaciones'; // NO es un ingreso: upload obligatorio aparte

/** Una línea de descuento de una liquidación (la extrae el LLM tal cual aparece). */
export interface DeductionLine {
  label: string;
  amount: number;
}

/** Un período de un documento de ingreso (un mes de liquidación, p. ej.). */
export interface IncomePeriod {
  /** Etiqueta del período tal como aparece (ej. "Mayo-2025", "ABR-2025"). */
  period_label: string;
  /**
   * "Líquido a pagar" del documento (L1) — NUNCA "Alcance Líquido". Es lo que la
   * persona efectivamente recibe. null si el documento no lo expone (ej. aporte).
   */
  liquido_a_pagar: number | null;
  /** Líneas de descuento del período (para clasificar legal vs voluntario, L2). */
  deductions?: DeductionLine[];
}

/** Hechos extraídos por el LLM de UN documento de ingreso. */
export interface ExtractedIncomeDoc {
  filename: string;
  category: IncomeCategory;
  /** Períodos con su líquido (liquidaciones, pensión, arriendo). */
  periods?: IncomePeriod[];
  /**
   * Monto mensual ya declarado en el documento (aportes de terceros, retiro de
   * sociedades, esporádicos): cuando el doc no viene por "períodos" sino con un
   * monto mensual directo. Si hay `periods`, se prioriza el promedio de períodos.
   */
  monto_mensual_declarado?: number | null;
  /** Texto libre del LLM (motivos, dudas) — informativo. */
  notes?: string;
}

/** Metadatos del Certificado de Cotizaciones Previsionales (L6). */
export interface CotizacionesCertFacts {
  filename: string;
  /** Fecha de emisión YYYY-MM-DD (para la regla de 30 días). */
  fecha_emision: string | null;
  /** RUT de la entidad pagadora (empleador/AFP) que debe constar (L6). */
  rut_entidad_pagadora: string | null;
}

// ---------------------------------------------------------------------------
// Resultado determinista: lo que se declara en el portal.
// ---------------------------------------------------------------------------
export interface DeclaredIncome {
  /** value del <select> #ingresotipoIngresoSolicitud (1..10). */
  tipoIngreso: number;
  tipoIngresoLabel: string;
  /**
   * Texto del concepto. Solo se ESCRIBE en #nombreConcepto cuando tipoIngreso=9
   * (Otros) — para el resto el portal usa la etiqueta del propio <select>.
   */
  concepto: string;
  /** Monto mensual ya mensualizado (entero CLP, sin separadores). */
  monto: number;
  /** value del <select> #ingreso.tipoPeriodicidad (4=Mensual por defecto, L4). */
  periodicidad: number;
  /** value del <select> #tipoAntecedente (28..45) del documento justificativo. */
  tipoAntecedente: number;
  /** Filenames de los documentos que justifican este ingreso (se adjuntan). */
  documentFilenames: string[];
  /** Detalle del cálculo (transparencia/log). */
  detalle: string;
  /** Alertas para el abogado (descuentos ambiguos, montos en duda, etc.). */
  alerts: string[];
}

export interface IncomeComputation {
  incomes: DeclaredIncome[];
  cotizacionesCert: CotizacionesCertFacts | null;
  /** Alertas a nivel global (falta cert de cotizaciones, etc.). */
  alerts: string[];
}

// ---------------------------------------------------------------------------
// Periodicidad
// ---------------------------------------------------------------------------
export const PERIODICIDAD_MENSUAL = 4;
export const PERIODICIDAD_UNICA_VEZ = 8;

// ---------------------------------------------------------------------------
// Crosswalk categoría → (tipoIngreso, tipoAntecedente) — L7. DETERMINISTA.
// ---------------------------------------------------------------------------
interface CrosswalkEntry {
  tipoIngreso: number;
  tipoIngresoLabel: string;
  tipoAntecedente: number;
  /** Ventana de promedio en meses (L3). null = monto mensual directo (no promedio). */
  promedioMeses: number | null;
}

const CROSSWALK: Record<Exclude<IncomeCategory, 'certificado_cotizaciones'>, CrosswalkEntry> = {
  liquidacion_sueldo:     { tipoIngreso: 1,  tipoIngresoLabel: 'Remuneración',                tipoAntecedente: 28, promedioMeses: 3 },
  comprobante_pension:    { tipoIngreso: 2,  tipoIngresoLabel: 'Pensión, jubilación, montepío', tipoAntecedente: 29, promedioMeses: 3 },
  licencia_medica:        { tipoIngreso: 3,  tipoIngresoLabel: 'Licencia Médica',              tipoAntecedente: 30, promedioMeses: null },
  aporte_terceros_deudas: { tipoIngreso: 4,  tipoIngresoLabel: 'Aporte de terceros para deudas', tipoAntecedente: 31, promedioMeses: null },
  aporte_terceros_gastos: { tipoIngreso: 5,  tipoIngresoLabel: 'Aporte de terceros para gastos', tipoAntecedente: 31, promedioMeses: null },
  comprobante_arriendo:   { tipoIngreso: 7,  tipoIngresoLabel: 'Arriendos',                    tipoAntecedente: 32, promedioMeses: 3 },
  retiro_sociedades:      { tipoIngreso: 6,  tipoIngresoLabel: 'Retiro de sociedades',         tipoAntecedente: 33, promedioMeses: null },
  honorarios:             { tipoIngreso: 10, tipoIngresoLabel: 'Honorarios',                   tipoAntecedente: 45, promedioMeses: 12 },
  esporadico:             { tipoIngreso: 8,  tipoIngresoLabel: 'Ingresos esporádicos',         tipoAntecedente: 34, promedioMeses: null },
  otro:                   { tipoIngreso: 9,  tipoIngresoLabel: 'Otros',                        tipoAntecedente: 34, promedioMeses: null },
};

// ---------------------------------------------------------------------------
// Clasificación de descuentos: legal (NO se suma de vuelta) vs voluntario
// (SÍ se suma) vs ambiguo (se ALERTA, no se suma — principio: dudas se alertan). L2
// ---------------------------------------------------------------------------
// Descuentos LEGALES/obligatorios: ya correctamente restados del líquido, no se
// devuelven. (AFP, salud previsional, seguro de cesantía, impuesto, SIS/mutual.)
const LEGAL_DEDUCTION_KEYWORDS = [
  'afp', 'a.f.p', 'cotizacion', 'cotización', 'cotiz', 'prevision', 'previsión', 'previsional',
  'salud', 'isapre', 'fonasa', 'banmedica', 'consalud', 'colmena', 'cruz blanca', 'vida tres',
  'nueva masvida', 'masvida', 'seguro de cesantia', 'seguro de cesantía', 'cesantia', 'cesantía',
  'impuesto', 'sis', 'mutual', ' achs', 'institucion de salud', 'institución de salud',
];
// Descuentos VOLUNTARIOS: bajan el líquido pero no reflejan menor capacidad de
// ingreso → se SUMAN de vuelta. (Préstamos empleador, cajas de compensación,
// convenios, créditos, anticipos.)
const VOLUNTARY_DEDUCTION_KEYWORDS = [
  'prestamo', 'préstamo', 'anticipo', 'caja de compensacion', 'caja de compensación',
  'los andes', 'la araucana', 'los heroes', 'los héroes', '18 de septiembre', 'gabriela mistral',
  'convenio', 'gimnasio', 'credito', 'crédito', 'cuota sindical', 'sindicato', 'aporte voluntario',
];

export type DeductionClass = 'legal' | 'voluntary' | 'ambiguous';

/** Clasifica una línea de descuento. Legal primero (más específico/seguro). */
export function classifyDeduction(label: string): DeductionClass {
  const t = label.toLowerCase();
  if (LEGAL_DEDUCTION_KEYWORDS.some((k) => t.includes(k))) return 'legal';
  if (VOLUNTARY_DEDUCTION_KEYWORDS.some((k) => t.includes(k))) return 'voluntary';
  return 'ambiguous';
}

// ---------------------------------------------------------------------------
// Cálculo del ingreso mensual de UN documento por períodos (L1 + L2 + L3).
// ---------------------------------------------------------------------------
function round(n: number): number {
  return Math.round(n);
}

interface PeriodAmountResult {
  amount: number;
  alerts: string[];
  detalle: string;
}

/**
 * Ingreso de un período = "Líquido a pagar" + Σ(descuentos voluntarios). Los
 * descuentos legales NO se suman; los ambiguos se ALERTAN (no se suman).
 */
function periodNetIncome(p: IncomePeriod): PeriodAmountResult {
  const alerts: string[] = [];
  if (p.liquido_a_pagar == null) {
    return { amount: 0, alerts: [`Período "${p.period_label}" sin "Líquido a pagar" legible.`], detalle: '' };
  }
  let voluntarySum = 0;
  const voluntaryDetails: string[] = [];
  for (const d of p.deductions ?? []) {
    const cls = classifyDeduction(d.label);
    if (cls === 'voluntary') {
      voluntarySum += d.amount;
      voluntaryDetails.push(`+${d.amount} (${d.label})`);
    } else if (cls === 'ambiguous') {
      alerts.push(
        `Descuento no clasificado en "${p.period_label}": "${d.label}" $${d.amount}. ` +
        `Verificar si es voluntario (préstamo/convenio → sumar de vuelta) o legal (no sumar).`
      );
    }
  }
  const amount = p.liquido_a_pagar + voluntarySum;
  const detalle =
    voluntarySum > 0
      ? `${p.period_label}: líquido ${p.liquido_a_pagar} + voluntarios ${voluntaryDetails.join(' ')} = ${amount}`
      : `${p.period_label}: líquido ${p.liquido_a_pagar}`;
  return { amount, alerts, detalle };
}

/**
 * Convierte los hechos de UN documento de ingreso en un ingreso declarable.
 * Devuelve null si la categoría no es declarable (cotizaciones) o no hay monto.
 */
export function computeDeclaredIncomeForDoc(doc: ExtractedIncomeDoc): DeclaredIncome | null {
  if (doc.category === 'certificado_cotizaciones') return null;

  const cw = CROSSWALK[doc.category];
  if (!cw) return null;

  const alerts: string[] = [];
  const detalleParts: string[] = [];
  let monto = 0;

  const periods = doc.periods ?? [];
  if (periods.length > 0) {
    // Mensualización por promedio (L3). Usa hasta `promedioMeses` períodos más
    // recientes si la ventana está definida; si no, promedia los disponibles.
    const window = cw.promedioMeses ?? periods.length;
    const used = periods.slice(0, window);
    let sum = 0;
    let counted = 0;
    for (const p of used) {
      const r = periodNetIncome(p);
      alerts.push(...r.alerts);
      if (r.amount > 0) {
        sum += r.amount;
        counted += 1;
        detalleParts.push(r.detalle);
      }
    }
    if (counted === 0) {
      alerts.push(`"${doc.filename}": ningún período con monto legible.`);
      return {
        tipoIngreso: cw.tipoIngreso, tipoIngresoLabel: cw.tipoIngresoLabel,
        concepto: cw.tipoIngreso === 9 ? (doc.notes || 'Otros ingresos') : cw.tipoIngresoLabel,
        monto: 0, periodicidad: PERIODICIDAD_MENSUAL, tipoAntecedente: cw.tipoAntecedente,
        documentFilenames: [doc.filename], detalle: 'sin monto legible', alerts,
      };
    }
    // Divisor = nº de períodos esperado por la regla (si está definido y hay menos
    // períodos, se alerta) o el nº de períodos contados.
    const divisor = cw.promedioMeses != null ? Math.min(cw.promedioMeses, counted) : counted;
    monto = round(sum / divisor);
    if (cw.promedioMeses != null && counted < cw.promedioMeses) {
      alerts.push(
        `Se esperaban ${cw.promedioMeses} períodos para promediar y solo hay ${counted} legibles ` +
        `→ promedio sobre ${counted}. Verificar que estén las ${cw.promedioMeses} liquidaciones.`
      );
    }
  } else if (doc.monto_mensual_declarado != null && doc.monto_mensual_declarado > 0) {
    monto = round(doc.monto_mensual_declarado);
    detalleParts.push(`monto mensual declarado en el documento: ${monto}`);
  } else {
    alerts.push(`"${doc.filename}": no se pudo determinar un monto mensual (sin períodos ni monto declarado).`);
  }

  return {
    tipoIngreso: cw.tipoIngreso,
    tipoIngresoLabel: cw.tipoIngresoLabel,
    concepto: cw.tipoIngreso === 9 ? (doc.notes || 'Otros ingresos') : cw.tipoIngresoLabel,
    monto,
    periodicidad: PERIODICIDAD_MENSUAL, // L4
    tipoAntecedente: cw.tipoAntecedente,
    documentFilenames: [doc.filename],
    detalle: detalleParts.join(' | '),
    alerts,
  };
}

/**
 * Agrupa todos los documentos de ingreso en los ingresos a declarar.
 * Varios documentos de la MISMA categoría que representan la misma fuente
 * (ej. 3 liquidaciones del mismo empleador, ya sea como 1 PDF multipágina o 3
 * PDFs sueltos) se consolidan en UN solo ingreso, promediando todos sus períodos.
 */
export function computeIncomes(
  docs: ExtractedIncomeDoc[],
  cotizaciones: CotizacionesCertFacts | null
): IncomeComputation {
  const globalAlerts: string[] = [];

  const declarable = docs.filter((d) => d.category !== 'certificado_cotizaciones');

  // Consolidar por categoría (una fuente por tipo de ingreso). Esto cubre el caso
  // general "N liquidaciones sueltas del mismo empleador" sin asumir un solo PDF.
  const byCategory = new Map<IncomeCategory, ExtractedIncomeDoc[]>();
  for (const d of declarable) {
    const arr = byCategory.get(d.category) ?? [];
    arr.push(d);
    byCategory.set(d.category, arr);
  }

  const incomes: DeclaredIncome[] = [];
  for (const [category, group] of byCategory) {
    const merged: ExtractedIncomeDoc = {
      filename: group[0].filename,
      category,
      periods: group.flatMap((g) => g.periods ?? []),
      monto_mensual_declarado:
        group.find((g) => g.monto_mensual_declarado != null)?.monto_mensual_declarado ?? null,
      notes: group.map((g) => g.notes).filter(Boolean).join('; ') || undefined,
    };
    const income = computeDeclaredIncomeForDoc(merged);
    if (income) {
      income.documentFilenames = Array.from(new Set(group.map((g) => g.filename)));
      incomes.push(income);
    }
  }

  if (incomes.length === 0) {
    globalAlerts.push('No se detectó ningún ingreso declarable en los documentos.');
  }
  if (!cotizaciones) {
    globalAlerts.push(
      'Falta el Certificado de Cotizaciones Previsionales (obligatorio en el Paso 5). ' +
      'Sin él el portal no permite continuar.'
    );
  } else if (!cotizaciones.rut_entidad_pagadora) {
    globalAlerts.push(
      'El Certificado de Cotizaciones no expone el RUT de la entidad pagadora (requisito del portal).'
    );
  }

  return { incomes, cotizacionesCert: cotizaciones, alerts: globalAlerts };
}
