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

/**
 * Evidencia de lectura que Claude reporta por período (red anti-error, espejo del
 * Paso 3 / Centinela). TS verifica el HECHO (la cifra leída) contra la cita textual;
 * no decide la estructura. Ver lecciones/paso3-acreedores.md L2/L5.
 */
export interface PeriodEvidence {
  /** Fragmento VERBATIM del documento de donde se leyó la cifra (anti-alucinación). */
  cita_monto?: string;
  /** Confianza 0..1 de la lectura de ESTE período (escaneos garbled → baja). */
  confidence?: number;
}

/** Un período de un documento de ingreso (un mes de liquidación, o una boleta). */
export interface IncomePeriod {
  /** Etiqueta del período tal como aparece (ej. "Mayo-2025", "ABR-2025", "05/2025"). */
  period_label: string;
  /**
   * "Líquido a pagar" del documento (L1) — NUNCA "Alcance Líquido". Es lo que la
   * persona efectivamente recibe. null si el documento no lo expone (ej. aporte,
   * o una boleta de honorarios que solo trae bruto/retención).
   */
  liquido_a_pagar: number | null;
  /**
   * Monto BRUTO de una boleta de honorarios (honorarios brutos, antes de retención).
   * Solo aplica a la categoría "honorarios"; null/ausente en liquidaciones de sueldo.
   */
  monto_bruto?: number | null;
  /** Retención de la boleta de honorarios (impuesto retenido, recuperable). */
  retencion?: number | null;
  /** Líneas de descuento del período (para clasificar legal vs voluntario, L2). */
  deductions?: DeductionLine[];
  /**
   * Días trabajados del período (L13). Cuando el documento los expone y son < 28
   * (licencia médica, ausencias, ingreso/egreso a mitad de mes), el mes es PARCIAL:
   * su líquido subestima el ingreso normal → se EXCLUYE del promedio a favor de los
   * meses completos (si los hay) y se ALERTA. null/ausente = se asume completo.
   */
  dias_trabajados?: number | null;
  /**
   * Moneda del monto leído (handoff Paso 3, regla #5). El portal declara en CLP; un monto
   * en UF tratado como CLP es un error de ~38.000×. Si es 'UF' se ALERTA (requiere conversión).
   */
  moneda?: 'CLP' | 'UF';
  /** Respaldo anti-error de la cifra leída en este período. */
  evidence?: PeriodEvidence;
}

/** Discrepancia entre lo que Claude leyó y su propia cita / confianza (red anti-error). */
export interface IncomeReadIssue {
  filename: string;
  period_label: string;
  /** Cifra cruda leída (líquido o bruto) que se intenta respaldar. */
  monto: number;
  tipo: 'sin_evidencia' | 'monto_sin_respaldo_en_cita' | 'baja_confianza';
  detalle: string;
}

/** Hechos extraídos por el LLM de UN documento de ingreso. */
export interface ExtractedIncomeDoc {
  filename: string;
  category: IncomeCategory;
  /**
   * Clave de la FUENTE del ingreso (L9): RUT del empleador/pagador (o su nombre si no
   * hay RUT). Dos documentos de la misma categoría pero distinta fuente NO se fusionan:
   * son ingresos separados que se SUMAN (ej. dos empleadores concurrentes). Si se omite,
   * todos los docs de una categoría se tratan como una sola fuente (compat. hacia atrás).
   */
  source_key?: string | null;
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
  /** Señales anti-error sobre la lectura de Claude (cita/confianza). Informativo. */
  claudeReadIssues: IncomeReadIssue[];
}

// ---------------------------------------------------------------------------
// Periodicidad
// ---------------------------------------------------------------------------
export const PERIODICIDAD_MENSUAL = 4;
export const PERIODICIDAD_UNICA_VEZ = 8;

/**
 * Umbral de días trabajados para considerar un mes COMPLETO (L13). Por debajo de
 * este valor el mes es parcial (licencia/ingreso/egreso a mitad de mes) y subestima
 * el ingreso normal. 28 tolera meses de 28-31 días y descuentos de 1-2 días.
 */
export const PARTIAL_MONTH_DAYS = 28;

// ---------------------------------------------------------------------------
// Crosswalk categoría → (tipoIngreso, tipoAntecedente) — L7. DETERMINISTA.
// ---------------------------------------------------------------------------
/**
 * Modo de cálculo del monto mensual:
 *  - 'liquido'  : períodos mensuales con "Líquido a pagar" (+ descuentos voluntarios);
 *                 promedio = Σ líquidos de los `promedioMeses` más recientes / nº usados.
 *  - 'boletas'  : boletas de honorarios; promedio = Σ montos de la ventana / `promedioMeses`
 *                 (divisor FIJO = meses de la ventana, no nº de boletas).
 *  - 'directo'  : monto mensual ya declarado en el documento (aportes, retiro, esporádico),
 *                 o promedio simple si vienen períodos.
 */
type IncomeMode = 'liquido' | 'boletas' | 'directo' | 'subsidio';

interface CrosswalkEntry {
  tipoIngreso: number;
  tipoIngresoLabel: string;
  tipoAntecedente: number;
  /** Ventana de promedio en meses (L3). null = monto mensual directo (no promedio). */
  promedioMeses: number | null;
  mode: IncomeMode;
}

const CROSSWALK: Record<Exclude<IncomeCategory, 'certificado_cotizaciones'>, CrosswalkEntry> = {
  liquidacion_sueldo:     { tipoIngreso: 1,  tipoIngresoLabel: 'Remuneración',                tipoAntecedente: 28, promedioMeses: 3,    mode: 'liquido' },
  comprobante_pension:    { tipoIngreso: 2,  tipoIngresoLabel: 'Pensión, jubilación, montepío', tipoAntecedente: 29, promedioMeses: 3,    mode: 'liquido' },
  licencia_medica:        { tipoIngreso: 3,  tipoIngresoLabel: 'Licencia Médica',              tipoAntecedente: 30, promedioMeses: null, mode: 'subsidio' },
  aporte_terceros_deudas: { tipoIngreso: 4,  tipoIngresoLabel: 'Aporte de terceros para deudas', tipoAntecedente: 31, promedioMeses: null, mode: 'directo' },
  aporte_terceros_gastos: { tipoIngreso: 5,  tipoIngresoLabel: 'Aporte de terceros para gastos', tipoAntecedente: 31, promedioMeses: null, mode: 'directo' },
  comprobante_arriendo:   { tipoIngreso: 7,  tipoIngresoLabel: 'Arriendos',                    tipoAntecedente: 32, promedioMeses: 3,    mode: 'liquido' },
  retiro_sociedades:      { tipoIngreso: 6,  tipoIngresoLabel: 'Retiro de sociedades',         tipoAntecedente: 33, promedioMeses: null, mode: 'directo' },
  honorarios:             { tipoIngreso: 10, tipoIngresoLabel: 'Honorarios',                   tipoAntecedente: 45, promedioMeses: 12,   mode: 'boletas' },
  esporadico:             { tipoIngreso: 8,  tipoIngresoLabel: 'Ingresos esporádicos',         tipoAntecedente: 34, promedioMeses: null, mode: 'directo' },
  otro:                   { tipoIngreso: 9,  tipoIngresoLabel: 'Otros',                        tipoAntecedente: 34, promedioMeses: null, mode: 'directo' },
};

// ---------------------------------------------------------------------------
// Parseo de la etiqueta de período → clave ordenable YYYYMM (Fix bug ordenamiento).
// El LLM no garantiza orden; el promedio de "los últimos N meses" debe usar los
// períodos MÁS RECIENTES → se ordena determinísticamente por fecha parseada.
// ---------------------------------------------------------------------------
const MONTHS_ES: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, set: 9, sept: 9, septiembre: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

/** Convierte "Mayo-2025"/"05/2025"/"2025-05"/"abr-25"/"1 de diciembre de 2025" → 202505. null si no parsea. */
export function parsePeriodKey(label: string | undefined): number | null {
  if (!label) return null;
  const t = label.toLowerCase();
  let m = t.match(/(20\d{2})\s*[-/.]\s*(0?[1-9]|1[0-2])(?!\d)/); // 2025-05
  if (m) return +m[1] * 100 + +m[2];
  m = t.match(/(?<!\d)(0?[1-9]|1[0-2])\s*[-/.]\s*(20\d{2})/); // 05/2025 (lookbehind: "13/2025" NO es "3/2025")
  if (m) return +m[2] * 100 + +m[1];
  m = t.match(/([a-z]{3,})\.?\s*[-/ ]?\s*(20\d{2})/); // mayo-2025
  if (m && MONTHS_ES[m[1]] != null) return +m[2] * 100 + MONTHS_ES[m[1]];
  // año de 2 dígitos ACOTADO a 20–40 (2020-2040) para evitar confundir un DÍA con el año
  // (ej. "abril 03" NO es abril de 2003). "abr-25"/"mayo 40" → 2025/2040.
  m = t.match(/([a-z]{3,})\.?\s*[-/ ]?\s*'?(2\d|3\d|40)\b/); // abr-25
  if (m && MONTHS_ES[m[1]] != null) return (2000 + +m[2]) * 100 + MONTHS_ES[m[1]];
  // Fallback verboso: "1 de diciembre de 2025" → mes nombrado + un año 20YY en el texto.
  const yearM = t.match(/\b(20\d{2})\b/);
  if (yearM) {
    for (const tok of t.split(/[^a-záéíóúñ]+/i).filter(Boolean)) {
      if (MONTHS_ES[tok] != null) return +yearM[1] * 100 + MONTHS_ES[tok];
    }
  }
  return null;
}

/** Distancia en meses entre dos claves YYYYMM (a − b). */
function monthsBetween(a: number, b: number): number {
  return (Math.floor(a / 100) * 12 + (a % 100)) - (Math.floor(b / 100) * 12 + (b % 100));
}

/** Ordena períodos de más reciente a más antiguo; los no parseables van al final. */
function sortPeriodsDesc(periods: IncomePeriod[]): IncomePeriod[] {
  return [...periods].sort((p, q) => {
    const kp = parsePeriodKey(p.period_label);
    const kq = parsePeriodKey(q.period_label);
    if (kp == null && kq == null) return 0;
    if (kp == null) return 1;
    if (kq == null) return -1;
    return kq - kp;
  });
}

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
  'impuesto', 'sis', 'mutual', 'achs', 'institucion de salud', 'institución de salud',
];
// Descuentos VOLUNTARIOS: préstamos/ahorro forzoso REDIRIGIBLES → se SUMAN de vuelta
// (el líquido baja pero la capacidad de ingreso no). Lista CONSERVADORA (L10): solo
// préstamos de empleador/caja y ahorro voluntario. NO incluye anticipos (devolución de
// dinero ya recibido), cuota sindical/seguro/bienestar (gastos reales) ni "crédito" a
// secas (demasiado amplio) — esos caen a 'ambiguous' → se ALERTAN, no se suman.
const VOLUNTARY_DEDUCTION_KEYWORDS = [
  'prestamo', 'préstamo', 'ptmo', 'ccaf', 'caja de compensacion', 'caja de compensación',
  // el rótulo a menudo omite el "de": "Crédito Caja Compensación", "Caja Compensacion Los Andes"
  'caja compensacion', 'caja compensación', 'credito social', 'crédito social',
  'los andes', 'la araucana', 'los heroes', 'los héroes', '18 de septiembre', 'gabriela mistral',
  'apv', 'ahorro voluntario', 'aporte voluntario', 'credito personal', 'crédito personal',
];

export type DeductionClass = 'legal' | 'voluntary' | 'ambiguous';

/**
 * ¿La etiqueta contiene la keyword como INICIO de palabra? Límite IZQUIERDO (no derecho)
 * para: (a) no confundir substrings dentro de otra palabra ("sis" en "asistencia/análisis",
 * "achs" suelto) → evita falsos positivos; (b) seguir matcheando stems en español
 * ("cotiz"→"cotizaciones", "prevision"→"previsionales"). Acentos/ñ cuentan como letra.
 */
function startsWordWith(t: string, kw: string): boolean {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-záéíóúñ])${esc}`, 'i').test(t);
}

/**
 * APV / APVC (Ahorro Previsional Voluntario) — VOLUNTARIO y redirigible, aunque la
 * etiqueta lo escriba "en AFP" (que dispararía el match legal de 'afp') o con puntos
 * ("A.P.V.I."). Se detecta con prioridad sobre lo legal. Tolera puntos/espacios entre
 * letras (A.P.V., A P V). NO confunde "AFP" (a-f-p) ni "aporte" (a-p-o). También cubre
 * "ahorro previsional voluntario" y "depósito convenido" (otro ahorro voluntario).
 */
const APV_RE = /(^|[^a-záéíóúñ])a\.?\s?p\.?\s?v/i;
function isApvVoluntary(t: string): boolean {
  return APV_RE.test(t) || t.includes('ahorro previsional voluntario') ||
    t.includes('deposito convenido') || t.includes('depósito convenido') ||
    // "Cotización (Previsional) Voluntaria" / "Ahorro Previsional Voluntario" — es APVC:
    // ahorro REDIRIGIBLE. El keyword legal 'cotiz'/'prevision' la sombreaba → se corrige aquí
    // (L27). Solo cuando la etiqueta dice "voluntari" (no toca la cotización obligatoria).
    (/voluntari/.test(t) && /(cotiz|prevision|previsión|ahorro)/.test(t));
}

/** Clasifica una línea de descuento. APV (voluntario) primero, luego legal, luego voluntario. */
export function classifyDeduction(label: string): DeductionClass {
  const t = label.toLowerCase();
  if (isApvVoluntary(t)) return 'voluntary'; // APV/APVC gana sobre 'afp'/'cotiz' legal (es ahorro redirigible)
  // "Ahorro AFP" / "Ahorro Previsional" (no explícitamente "voluntario", ya cubierto arriba): ahorro
  // en la AFP que puede ser redirigible o forzoso → AMBIGUO (se alerta, no se suma). Va antes del legal
  // para que el keyword 'afp' no lo trague como cotización obligatoria. Acotado a afp/previsión para no
  // pisar "Ahorro Caja Los Andes"/"Ahorro CCAF" (préstamo/ahorro redirigible → voluntario). L31.
  if (/(^|[^a-záéíóúñ])ahorro/.test(t) && /(^|[^a-záéíóúñ])a\.?f\.?p|previsi/.test(t)) return 'ambiguous';
  if (LEGAL_DEDUCTION_KEYWORDS.some((k) => startsWordWith(t, k))) return 'legal';
  // Un "Préstamo de Negociación/Contrato COLECTIVO" NO es un préstamo personal redirigible
  // (aporte ligado a la negociación colectiva/sindicato) → ambiguo, se ALERTA (no se suma
  // por el solo keyword 'prestamo'). L28.
  if (/negociaci[oó]n colectiv|contrato colectiv/.test(t)) return 'ambiguous';
  if (VOLUNTARY_DEDUCTION_KEYWORDS.some((k) => startsWordWith(t, k))) return 'voluntary';
  return 'ambiguous';
}

// ---------------------------------------------------------------------------
// Red anti-error: la cifra cruda leída por Claude debe estar VERBATIM en su cita.
// Espejo de la Capa 1 del Centinela (Paso 3). Conservador: si no calza, es señal
// de REVISAR (puede ser otra cifra del documento), no un error seguro.
// ---------------------------------------------------------------------------
function citaRespaldaMonto(cita: string | undefined, monto: number): boolean {
  if (!cita) return false;
  const target = String(Math.round(monto));
  return target.length >= 4 && cita.replace(/[^\d]/g, '').includes(target);
}

/** Monto positivo y FINITO, o null (guarda contra NaN/Infinity/negativos — H5). */
function posFinite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/** Cifra cruda que Claude reportó para un período (bruto de boleta o líquido). */
function rawReadAmount(p: IncomePeriod): number | null {
  return posFinite(p.monto_bruto) ?? posFinite(p.liquido_a_pagar);
}

/**
 * Verifica la lectura de Claude período por período (NO la estructura): que la cifra
 * leída esté en su cita textual y que la confianza no sea baja. Devuelve señales
 * informativas para el abogado (no bloquea).
 */
export function validateIncomeReads(docs: ExtractedIncomeDoc[]): IncomeReadIssue[] {
  const issues: IncomeReadIssue[] = [];
  for (const doc of docs) {
    if (doc.category === 'certificado_cotizaciones') continue;
    for (const p of doc.periods ?? []) {
      const raw = rawReadAmount(p);
      if (raw == null) continue;
      const ev = p.evidence;
      if (!ev || !ev.cita_monto) {
        issues.push({
          filename: doc.filename, period_label: p.period_label, monto: raw, tipo: 'sin_evidencia',
          detalle: `Claude no devolvió "cita_monto" para respaldar $${raw.toLocaleString('es-CL')} en "${p.period_label}".`,
        });
      } else if (!citaRespaldaMonto(ev.cita_monto, raw)) {
        issues.push({
          filename: doc.filename, period_label: p.period_label, monto: raw, tipo: 'monto_sin_respaldo_en_cita',
          detalle: `$${raw.toLocaleString('es-CL')} no aparece verbatim en la cita ("${ev.cita_monto}") — posible mala lectura (ej. "Alcance Líquido" en vez de "Líquido a pagar"). Revisar.`,
        });
      }
      if (typeof ev?.confidence === 'number' && ev.confidence < 0.7) {
        issues.push({
          filename: doc.filename, period_label: p.period_label, monto: raw, tipo: 'baja_confianza',
          detalle: `Claude reportó confidence ${ev.confidence.toFixed(2)} al leer "${p.period_label}" (escaneo dudoso).`,
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Cálculo del ingreso mensual de UN documento por períodos (L1 + L2 + L3).
// ---------------------------------------------------------------------------
function round(n: number): number {
  return Math.round(n);
}

/**
 * Honorarios (mode 'boletas'): el monto mensual = Σ (montos de las boletas de la
 * ventana) / nº de meses de la ventana (divisor FIJO = `promedioMeses`, no nº de
 * boletas). La ventana se ancla en la boleta MÁS RECIENTE (robusto a fixtures viejos).
 * Se declara el BRUTO de la boleta; bruto-vs-líquido y la ventana 6-vs-12 quedan
 * marcados para confirmación del abogado (lección pendiente).
 */
function computeBoletasIncome(
  doc: ExtractedIncomeDoc,
  cw: CrosswalkEntry
): { monto: number; detalle: string; alerts: string[] } {
  const alerts: string[] = [];
  const window = cw.promedioMeses ?? 12;
  const legibles = (doc.periods ?? []).filter((p) => rawReadAmount(p) != null);
  // P1.4a: deduplicar boletas idénticas (mismo período + monto) — subir el mismo PDF 2×
  // inflaría el bruto (el divisor es fijo). Mismo criterio que liquidaciones/subsidio.
  const seenB = new Set<string>();
  const boletas = legibles.filter((p) => {
    const k = `${p.period_label}|${rawReadAmount(p)}`;
    if (seenB.has(k)) return false;
    seenB.add(k);
    return true;
  });
  if (boletas.length < legibles.length) {
    alerts.push(`Honorarios: se ignoraron ${legibles.length - boletas.length} boleta(s) duplicada(s) (mismo período y monto).`);
  }
  if (boletas.length === 0) {
    alerts.push(`"${doc.filename}": honorarios sin boletas con monto legible.`);
    return { monto: 0, detalle: 'honorarios sin monto legible', alerts };
  }

  const keys = boletas.map((b) => parsePeriodKey(b.period_label)).filter((k): k is number => k != null);
  const anchor = keys.length ? Math.max(...keys) : null;
  if (anchor == null) {
    // H3: ninguna boleta con fecha parseable → no se pudo acotar la ventana.
    alerts.push(
      `Honorarios: ${boletas.length} boleta(s) sin fecha parseable → no se pudo acotar la ventana; ` +
      `el promedio /${window} puede subestimar. Verificar las fechas de emisión.`
    );
  }

  const inWindow = anchor == null
    ? boletas
    : boletas.filter((b) => {
        const k = parsePeriodKey(b.period_label);
        return k != null && monthsBetween(anchor, k) >= 0 && monthsBetween(anchor, k) < window;
      });
  const ignored = boletas.length - inWindow.length;

  let sumBruto = 0;
  let sumLiquido = 0;
  for (const b of inWindow) {
    const bruto = rawReadAmount(b)!; // bruto si existe, si no el líquido (ambos posFinite)
    sumBruto += bruto;
    const ret = posFinite(b.retencion);
    const liq = posFinite(b.monto_bruto) != null && ret != null ? bruto - ret! : (posFinite(b.liquido_a_pagar) ?? bruto);
    sumLiquido += liq;
  }

  const monto = round(sumBruto / window);
  const montoLiquido = round(sumLiquido / window);
  alerts.push(
    `Honorarios: declarado el BRUTO mensualizado $${monto.toLocaleString('es-CL')} ` +
    `(Σ ${inWindow.length} boleta(s) / ${window} meses). Líquido equivalente ≈ ` +
    `$${montoLiquido.toLocaleString('es-CL')}. ⚠️ Confirmar con el abogado: (a) declarar BRUTO o LÍQUIDO; ` +
    `(b) ventana 6 vs 12 meses (CLAUDE.md dice 6, el portal/L3 dice 12).`
  );
  if (anchor != null && inWindow.length < window) {
    alerts.push(
      `Honorarios: solo ${inWindow.length} mes(es) con boletas en la ventana de ${window} ` +
      `→ el promedio se divide igual por ${window} (ingreso irregular). Verificar.`
    );
  }
  if (ignored > 0) {
    alerts.push(`Honorarios: ${ignored} boleta(s) fuera de la ventana de ${window} meses — no contadas.`);
  }

  return {
    monto,
    detalle: `boletas en ventana: ${inWindow.map((b) => `${b.period_label}=${rawReadAmount(b)}`).join(', ')} | Σbruto ${sumBruto} / ${window}`,
    alerts,
  };
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
  const liquido = posFinite(p.liquido_a_pagar);
  if (liquido == null) {
    // null, NaN, Infinity o negativo → ilegible/ inválido (H5). No se descarta en silencio.
    const why = p.liquido_a_pagar == null ? 'sin "Líquido a pagar" legible' : `"Líquido a pagar" ilegible o inválido (${p.liquido_a_pagar})`;
    return { amount: 0, alerts: [`Período "${p.period_label}" ${why}.`], detalle: '' };
  }
  let voluntarySum = 0;
  const voluntaryDetails: string[] = [];
  for (const d of p.deductions ?? []) {
    const cls = classifyDeduction(d.label);
    if (cls === 'voluntary') {
      const amt = posFinite(d.amount); // ignora montos de descuento no finitos/negativos
      if (amt != null) { voluntarySum += amt; voluntaryDetails.push(`+${amt} (${d.label})`); }
    } else if (cls === 'ambiguous') {
      alerts.push(
        `Descuento no clasificado en "${p.period_label}": "${d.label}" $${d.amount}. ` +
        `Verificar si es voluntario (préstamo/convenio → sumar de vuelta) o legal (no sumar).`
      );
    }
  }
  const amount = liquido + voluntarySum;
  if (voluntarySum > 0) {
    // No sumar en silencio: avisar al abogado QUÉ descuentos se re-sumaron (materia de L10:
    // conciliar contra el documento del préstamo). Surface, no decisión silenciosa (G2).
    alerts.push(
      `En "${p.period_label}" se SUMARON de vuelta descuento(s) VOLUNTARIO(s) [${voluntaryDetails.join(', ')}] ` +
      `= +$${voluntarySum.toLocaleString('es-CL')} sobre el líquido. Verificar que sean préstamos/ahorro ` +
      `REDIRIGIBLES (L2/L10); si alguno es un gasto real, el abogado debe restarlo.`
    );
  }
  const detalle =
    voluntarySum > 0
      ? `${p.period_label}: líquido ${liquido} + voluntarios ${voluntaryDetails.join(' ')} = ${amount}`
      : `${p.period_label}: líquido ${liquido}`;
  return { amount, alerts, detalle };
}

/**
 * Licencia médica (mode 'subsidio'): el subsidio por incapacidad llega FRAGMENTADO en
 * muchos pagos parciales por días (varias licencias encadenadas), con PDFs duplicados.
 * (L11) Reglas: (a) deduplica pagos idénticos (mismo período + monto); (b) agrupa por
 * MES calendario sumando los "Monto Líquido"; (c) declara el mes más completo (mejor
 * proxy de un mes íntegro de subsidio) y alerta para que el abogado confirme la
 * mensualización. NO usa el "Promedio mensual" impreso (es la base de cálculo, no lo
 * percibido). El subsidio REEMPLAZA al sueldo en el período de licencia (ver conflicto
 * en computeIncomes).
 */
function computeSubsidioIncome(
  doc: ExtractedIncomeDoc
): { monto: number; detalle: string; alerts: string[] } {
  const alerts: string[] = [];
  const pagos = (doc.periods ?? []).filter((p) => posFinite(p.liquido_a_pagar) != null); // H5: finito y > 0
  if (pagos.length === 0) {
    return { monto: 0, detalle: 'subsidio sin pagos legibles', alerts: [`"${doc.filename}": licencia médica sin "Monto Líquido" legible.`] };
  }
  // (a) dedup exacto: mismo period_label + mismo monto líquido.
  const seen = new Set<string>();
  const unique = pagos.filter((p) => {
    const k = `${p.period_label}|${p.liquido_a_pagar}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const dupes = pagos.length - unique.length;
  if (dupes > 0) alerts.push(`Licencia médica: se ignoraron ${dupes} pago(s) duplicado(s) (mismo período y monto).`);

  // (b) agrupar por mes calendario (clave YYYYMM del period_label).
  const byMonth = new Map<number, number>();
  let sinMes = 0;
  for (const p of unique) {
    const key = parsePeriodKey(p.period_label);
    if (key == null) { sinMes += p.liquido_a_pagar ?? 0; continue; }
    byMonth.set(key, (byMonth.get(key) ?? 0) + (p.liquido_a_pagar ?? 0));
  }
  if (byMonth.size === 0) {
    // No se pudo mensualizar → promedio simple de los pagos únicos (con alerta).
    const sum = unique.reduce((s, p) => s + (p.liquido_a_pagar ?? 0), 0);
    const monto = round(sum / unique.length);
    alerts.push('Licencia médica: no se pudo asignar los pagos a meses calendario; se promedió por pago. Verificar.');
    return { monto, detalle: `subsidio: promedio simple de ${unique.length} pago(s)`, alerts };
  }
  // H2: pagos sin mes parseable → NO se descartan en silencio, se alertan.
  if (sinMes > 0) {
    alerts.push(
      `Licencia médica: pago(s) de subsidio por $${sinMes.toLocaleString('es-CL')} con "period_label" sin mes ` +
      `parseable → no asignados a un mes calendario. Verificar las fechas.`
    );
  }
  // (c) declarar el mes con mayor subsidio acumulado (proxy de mes íntegro de licencia).
  const monthly = Array.from(byMonth.entries()).sort((a, b) => b[0] - a[0]);
  const maxMes = Math.max(...monthly.map(([, v]) => v));
  const detalle = `subsidio por mes: ${monthly.map(([k, v]) => `${k}=${v}`).join(', ')} → declara mes más completo ${maxMes}`;
  alerts.push(
    `Licencia médica: subsidio reconstruido por mes (${monthly.map(([k, v]) => `${k}:$${v.toLocaleString('es-CL')}`).join(', ')}). ` +
    `Se declara el mes más completo ($${maxMes.toLocaleString('es-CL')}); los meses parciales (inicio/fin de licencia) lo subestiman. Confirmar mensualización con el abogado.`
  );
  return { monto: maxMes, detalle, alerts };
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

  // P3.1: si un modo por-períodos no logró monto pero el doc trae un monto mensual
  // declarado > 0, usarlo (con alerta) en vez de declarar $0 e ignorarlo en silencio.
  const fallbackDeclarado = (r: { monto: number; detalle: string; alerts: string[] }) => {
    if (r.monto === 0 && posFinite(doc.monto_mensual_declarado) != null) {
      const m = round(doc.monto_mensual_declarado as number);
      return {
        monto: m,
        detalle: `monto mensual declarado en el documento: ${m}`,
        alerts: [...r.alerts, `Sin períodos legibles; se usó el monto mensual declarado ($${m.toLocaleString('es-CL')}). Verificar.`],
      };
    }
    return r;
  };

  // Honorarios: lógica propia (boletas, divisor fijo = meses de la ventana).
  if (cw.mode === 'boletas') {
    const r = fallbackDeclarado(computeBoletasIncome(doc, cw));
    return {
      tipoIngreso: cw.tipoIngreso, tipoIngresoLabel: cw.tipoIngresoLabel,
      concepto: cw.tipoIngreso === 9 ? (doc.notes || 'Otros ingresos') : cw.tipoIngresoLabel,
      monto: r.monto, periodicidad: PERIODICIDAD_MENSUAL, tipoAntecedente: cw.tipoAntecedente,
      documentFilenames: [doc.filename], detalle: r.detalle, alerts: r.alerts,
    };
  }

  // Licencia médica: subsidio fragmentado (dedup + reconstrucción por mes).
  if (cw.mode === 'subsidio') {
    const r = fallbackDeclarado(computeSubsidioIncome(doc));
    return {
      tipoIngreso: cw.tipoIngreso, tipoIngresoLabel: cw.tipoIngresoLabel,
      concepto: cw.tipoIngresoLabel,
      monto: r.monto, periodicidad: PERIODICIDAD_MENSUAL, tipoAntecedente: cw.tipoAntecedente,
      documentFilenames: [doc.filename], detalle: r.detalle, alerts: r.alerts,
    };
  }

  const rawPeriods = doc.periods ?? [];
  // H1: deduplicar períodos idénticos (mismo período + monto) — un PDF de liquidación
  // subido 2× duplicaría un mes y distorsionaría el promedio de "los últimos N".
  const dseen = new Set<string>();
  const periods = rawPeriods.filter((p) => {
    const k = `${p.period_label}|${p.liquido_a_pagar}`;
    if (dseen.has(k)) return false;
    dseen.add(k);
    return true;
  });
  if (periods.length < rawPeriods.length) {
    alerts.push(`"${doc.filename}": se ignoraron ${rawPeriods.length - periods.length} período(s) duplicado(s) (mismo período y monto).`);
  }
  if (periods.length > 0) {
    // Mensualización por promedio (L3). El divisor es el nº de MESES calendario, NO el
    // nº de líneas de pago: varios pagos del mismo mes (sueldo + aguinaldo/retroactivo/
    // planilla accesoria) se SUMAN en ese mes (L12). Luego se promedian los `promedioMeses`
    // meses más recientes, prefiriendo meses COMPLETOS (L13).
    const netParts = periods.map((p) => ({ p, r: periodNetIncome(p) }));
    netParts.forEach(({ r }) => alerts.push(...r.alerts));

    // Agrupar por MES calendario. Los períodos con etiqueta no parseable (sin clave de
    // mes) no se pueden fusionar → cada uno es su propia unidad (clave null, va al final).
    interface MonthUnit { key: number | null; amount: number; count: number; dias: number | null; detalle: string[] }
    const monthMap = new Map<number, MonthUnit>();
    const looseUnits: MonthUnit[] = [];
    for (const { p, r } of netParts) {
      if (r.amount <= 0) continue; // null/ilegible ya alertado por periodNetIncome
      const key = parsePeriodKey(p.period_label);
      const dias = posFinite(p.dias_trabajados);
      if (key == null) {
        looseUnits.push({ key: null, amount: r.amount, count: 1, dias, detalle: [r.detalle] });
        continue;
      }
      const m = monthMap.get(key) ?? { key, amount: 0, count: 0, dias: null, detalle: [] };
      m.amount += r.amount; m.count += 1; m.detalle.push(r.detalle);
      if (dias != null) m.dias = m.dias == null ? dias : Math.max(m.dias, dias);
      monthMap.set(key, m);
    }
    // L12: avisar de meses con varios pagos sumados (no es un error, pero el abogado debe
    // saber que ese mes combina sueldo + bono/retroactivo y no es el sueldo "base").
    for (const m of monthMap.values()) {
      if (m.count > 1) {
        alerts.push(
          `Mes ${m.key}: se sumaron ${m.count} pagos del mismo período (= $${m.amount.toLocaleString('es-CL')}) ` +
          `— ej. sueldo + aguinaldo/retroactivo/planilla accesoria. Verificar.`
        );
      }
    }
    if (looseUnits.length > 0 && cw.promedioMeses != null) {
      alerts.push(
        `No se pudo asignar a un mes ${looseUnits.length} período(s) (etiqueta de fecha no parseable) ` +
        `→ el promedio de los últimos ${cw.promedioMeses} meses podría no usar los más recientes. Verificar.`
      );
    }

    // L13: preferir meses COMPLETOS (días ≥ umbral o desconocidos). Si TODOS son parciales,
    // se usan igual (no se descarta el único ingreso disponible) con alerta.
    const allUnits: MonthUnit[] = [...monthMap.values(), ...looseUnits];
    const isFull = (u: MonthUnit) => u.dias == null || u.dias >= PARTIAL_MONTH_DAYS;
    const fullUnits = allUnits.filter(isFull);
    const partialUnits = allUnits.filter((u) => !isFull(u));
    let pool = fullUnits.length > 0 ? fullUnits : allUnits;
    if (fullUnits.length > 0 && partialUnits.length > 0) {
      alerts.push(
        `Se excluyó(eron) del promedio ${partialUnits.length} mes(es) PARCIAL(es) ` +
        `(${partialUnits.map((u) => `${u.key ?? '¿?'}: ${u.dias} días`).join(', ')}) — licencia médica o ` +
        `ingreso/egreso a mitad de mes subestiman el ingreso normal. El abogado puede reconsiderarlos.`
      );
    }
    // L29: mes con líquido ANÓMALO-BAJO (< 50% de la mediana del pool) — típicamente un
    // clawback de anticipo/liquidación anterior o ausencia no reflejada en "días" — subestima
    // el ingreso normal igual que un mes parcial → se EXCLUYE si quedan ≥1 mes normal + alerta.
    // Simétrico a L16 (mes parcial). Conservador: no toca meses ALTOS (bonos/aguinaldos), que
    // son ingreso real y los decide el abogado; solo saca los bajos anómalos.
    if (pool.length >= 2) {
      const amts = pool.map((u) => u.amount).sort((a, b) => a - b);
      const mid = Math.floor(amts.length / 2);
      const median = amts.length % 2 ? amts[mid] : (amts[mid - 1] + amts[mid]) / 2;
      const lowOutliers = pool.filter((u) => u.amount < 0.5 * median);
      if (lowOutliers.length > 0 && pool.length - lowOutliers.length >= 1) {
        pool = pool.filter((u) => !lowOutliers.includes(u));
        alerts.push(
          `Se excluyó(eron) del promedio ${lowOutliers.length} mes(es) con líquido ANÓMALO-BAJO ` +
          `(${lowOutliers.map((u) => `${u.key ?? '¿?'}: $${u.amount.toLocaleString('es-CL')}`).join(', ')}) ` +
          `— muy por debajo de la mediana ($${Math.round(median).toLocaleString('es-CL')}), probable clawback de ` +
          `anticipo/liquidación anterior o ausencia. El abogado puede reconsiderarlos.`
        );
      }
      // Mes ALTO-anómalo (> 2× mediana): probable bono/aguinaldo/reliquidación de PAGO ÚNICO.
      // NO se excluye (es ingreso real que el abogado puede querer promediar), pero se ALERTA
      // para que decida si lo normaliza. L32.
      const highOutliers = pool.filter((u) => u.amount > 2 * median);
      if (highOutliers.length > 0) {
        alerts.push(
          `Mes(es) con líquido ANÓMALO-ALTO (${highOutliers.map((u) => `${u.key ?? '¿?'}: $${u.amount.toLocaleString('es-CL')}`).join(', ')}) ` +
          `muy por encima de la mediana — posible bono/aguinaldo/reliquidación de pago único. Se INCLUYE en el ` +
          `promedio (ingreso real); el abogado puede excluirlo si no es recurrente.`
        );
      }
    }
    // Ordenar meses de más reciente a más antiguo (clave null al final) y tomar la ventana.
    pool.sort((a, b) => (b.key ?? -Infinity) - (a.key ?? -Infinity));
    const window = cw.promedioMeses ?? pool.length;
    const used = pool.slice(0, window);
    const counted = used.length;
    if (counted === 0) {
      alerts.push(`"${doc.filename}": ningún período con monto legible.`);
      return {
        tipoIngreso: cw.tipoIngreso, tipoIngresoLabel: cw.tipoIngresoLabel,
        concepto: cw.tipoIngreso === 9 ? (doc.notes || 'Otros ingresos') : cw.tipoIngresoLabel,
        monto: 0, periodicidad: PERIODICIDAD_MENSUAL, tipoAntecedente: cw.tipoAntecedente,
        documentFilenames: [doc.filename], detalle: 'sin monto legible', alerts,
      };
    }
    used.forEach((u) => detalleParts.push(...u.detalle));
    // Divisor = nº de MESES esperado por la regla (si hay menos, se alerta) o los contados.
    const divisor = cw.promedioMeses != null ? Math.min(cw.promedioMeses, counted) : counted;
    const sum = used.reduce((s, u) => s + u.amount, 0);
    monto = round(sum / divisor);
    if (cw.promedioMeses != null && counted < cw.promedioMeses) {
      alerts.push(
        `Se esperaban ${cw.promedioMeses} meses para promediar y solo hay ${counted} mes(es) completo(s) legible(s) ` +
        `→ promedio sobre ${counted}. Verificar que estén las ${cw.promedioMeses} liquidaciones.`
      );
    }
  } else if (posFinite(doc.monto_mensual_declarado) != null) {
    monto = round(doc.monto_mensual_declarado as number); // H5: finito y > 0
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

  // Moneda (handoff Paso 3, regla #5): un monto en UF tratado como CLP es catastrófico
  // (~38.000×). El portal declara en CLP → si algún período viene en UF, se ALERTA.
  for (const d of declarable) {
    if ((d.periods ?? []).some((p) => p.moneda === 'UF')) {
      globalAlerts.push(
        `"${d.filename}": monto(s) leído(s) en UF. El portal declara en CLP → requiere conversión UF→CLP ` +
        `antes de declarar (un monto en UF tratado como pesos es un error de ~38.000×). Verificar.`
      );
    }
  }

  // Consolidar por (categoría + FUENTE). N liquidaciones del MISMO empleador → un solo
  // ingreso; dos empleadores DISTINTOS (source_key distinto) → dos ingresos que se SUMAN
  // (L9). source_key vacío/ausente = una sola fuente (compat. hacia atrás).
  const byGroup = new Map<string, ExtractedIncomeDoc[]>();
  for (const d of declarable) {
    const key = `${d.category}::${d.source_key ?? ''}`;
    const arr = byGroup.get(key) ?? [];
    arr.push(d);
    byGroup.set(key, arr);
  }

  // L30 — SECUENCIAL vs CONCURRENTE (refina L9). Dos fuentes de la MISMA categoría cuyos
  // rangos de MESES son DISJUNTOS = cambio de trabajo (secuencial) → se declara SOLO la fuente
  // vigente (la de meses más recientes), NO se suman. Si los rangos SE SOLAPAN = empleadores
  // concurrentes → se suman (comportamiento L9). Solo aplica a fuentes con meses conocidos.
  const groupMonths = new Map<string, number[]>();
  for (const [key, gdocs] of byGroup) {
    groupMonths.set(
      key,
      gdocs.flatMap((g) => (g.periods ?? []).map((p) => parsePeriodKey(p.period_label)).filter((k): k is number => k != null))
    );
  }
  const keysByCat = new Map<string, string[]>();
  for (const key of byGroup.keys()) {
    const cat = key.split('::')[0];
    const arr = keysByCat.get(cat) ?? [];
    arr.push(key);
    keysByCat.set(cat, arr);
  }
  for (const [cat, keys] of keysByCat) {
    const withMonths = keys.filter((k) => (groupMonths.get(k) ?? []).length > 0);
    if (withMonths.length < 2) continue;
    const disjoint = withMonths.every((a, i) =>
      withMonths.every((b, j) => i >= j || !groupMonths.get(a)!.some((m) => groupMonths.get(b)!.includes(m)))
    );
    if (!disjoint) continue; // se solapan → concurrentes → se suman (L9), no tocar
    const latest = withMonths.reduce((best, k) =>
      Math.max(...groupMonths.get(k)!) > Math.max(...groupMonths.get(best)!) ? k : best
    );
    for (const k of withMonths) if (k !== latest) byGroup.delete(k);
    globalAlerts.push(
      `Se detectaron ${withMonths.length} fuentes de "${cat}" con períodos DISJUNTOS (cambio de trabajo ` +
      `secuencial) → se declara solo la fuente VIGENTE (más reciente). Si en realidad son CONCURRENTES ` +
      `(dos empleos en paralelo), el abogado debe declararlas y sumarlas.`
    );
  }

  const incomes: DeclaredIncome[] = [];
  for (const group of byGroup.values()) {
    // P1.3: SUMAR los montos mensuales declarados de los docs de la MISMA fuente (no tomar
    // solo el primero → se perdían en silencio). Solo se usa en el modo 'directo' sin períodos.
    const declaredVals = group
      .map((g) => g.monto_mensual_declarado)
      .filter((v) => posFinite(v) != null) as number[];
    const merged: ExtractedIncomeDoc = {
      filename: group[0].filename,
      category: group[0].category,
      source_key: group[0].source_key ?? null,
      periods: group.flatMap((g) => g.periods ?? []),
      monto_mensual_declarado: declaredVals.length ? declaredVals.reduce((a, b) => a + b, 0) : null,
      notes: group.map((g) => g.notes).filter(Boolean).join('; ') || undefined,
    };
    const income = computeDeclaredIncomeForDoc(merged);
    if (income) {
      income.documentFilenames = Array.from(new Set(group.map((g) => g.filename)));
      if (declaredVals.length > 1 && (merged.periods?.length ?? 0) === 0) {
        income.alerts.push(
          `Se sumaron ${declaredVals.length} montos mensuales declarados de la misma fuente ` +
          `(total $${income.monto.toLocaleString('es-CL')}). Verificar que no sean el mismo monto duplicado.`
        );
      }
      incomes.push(income);
    }
  }

  // NUNCA declarar un ingreso de $0. Un monto ≤ 0 = documento NO-ingreso mal clasificado (cédula,
  // captura del SII, hoja de crédito de un tercero) o lectura ilegible → se DESCARTA de la
  // declaración (no genera una fila fantasma en el portal) pero se conservan sus alertas (G2: la
  // duda se alerta, no se declara $0). General para cualquier documento ruidoso de la carpeta.
  for (let i = incomes.length - 1; i >= 0; i--) {
    if (incomes[i].monto <= 0) {
      for (const a of incomes[i].alerts) globalAlerts.push(`[ingreso descartado (monto 0): ${incomes[i].tipoIngresoLabel}] ${a}`);
      incomes.splice(i, 1);
    }
  }

  // P2.1: orden de salida DETERMINISTA (independiente del orden de los documentos de entrada).
  incomes.sort((a, b) =>
    a.tipoIngreso - b.tipoIngreso ||
    b.monto - a.monto ||
    a.documentFilenames.join(',').localeCompare(b.documentFilenames.join(',')));

  // Conflicto sueldo ↔ licencia médica: el subsidio REEMPLAZA al sueldo en el período de
  // licencia → no se declaran ambos sobre el mismo período. Se ALERTA (no se descarta
  // ninguno): el abogado decide cuál corresponde a la situación actual del deudor. (L11)
  const hasRemuneracion = incomes.some((i) => i.tipoIngreso === 1);
  const hasLicencia = incomes.some((i) => i.tipoIngreso === 3);
  if (hasRemuneracion && hasLicencia) {
    globalAlerts.push(
      'Coexisten Remuneración y Licencia Médica: el subsidio por incapacidad REEMPLAZA al sueldo ' +
      'durante la licencia (no se declaran ambos sobre el mismo período). El abogado debe elegir ' +
      'cuál refleja la situación actual del deudor (¿en licencia o reintegrado?).'
    );
  }

  // Coexistencia Honorarios ↔ Remuneración (L14): un deudor puede tener boletas de
  // honorarios Y sueldo. Si son CONCURRENTES (consultoría en paralelo al empleo) se
  // declaran y suman ambos; si son SECUENCIALES (dejó de boletear al entrar a planilla,
  // o viceversa) solo el vigente cuenta. TS no puede distinguirlo con certeza → se ALERTA.
  const hasHonorarios = incomes.some((i) => i.tipoIngreso === 10);
  if (hasRemuneracion && hasHonorarios) {
    globalAlerts.push(
      'Coexisten Remuneración (sueldo) y Honorarios (boletas): verificar si son CONCURRENTES ' +
      '(se declaran y suman ambos) o SECUENCIALES (transición sueldo↔honorarios → declarar solo ' +
      'el vigente). El abogado debe confirmar cuál(es) corresponde(n) a la situación actual.'
    );
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

  // Red anti-error: verifica la LECTURA de Claude (cita/confianza), no la estructura.
  const claudeReadIssues = validateIncomeReads(declarable);

  return { incomes, cotizacionesCert: cotizaciones, alerts: globalAlerts, claudeReadIssues };
}
