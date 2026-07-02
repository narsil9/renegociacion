/**
 * CLASIFICACIÓN PURA del Paso 3 (sin Playwright, sin I/O) — decide QUÉ filas declarar y en qué
 * artículo (260/261), con qué monto y vencimiento, a partir de las filas del CMF + las listas del
 * Centinela (overrides, identified261, reclassified, additional, deReclassified). `fillStep3` la usa
 * para decidir y luego SOLO ejecuta (resuelve RUT, llena el portal, adjunta). Ser pura la hace
 * unit-testeable con el output ya obtenido del LLM/ensamblador (G3: TS blinda la estructura).
 *
 * Principio (2026-07-01): un banco "representado a nivel de producto" por las listas del Centinela
 * se declara DESDE esas listas (override→260, identified261→261, reclassified→260), y sus filas
 * CRUDAS del CMF se SALTAN — así no se re-mapea el CMF ni se duplica. Esto unifica el multiproducto
 * 260 (ya existía) con el multiproducto 261 (faltaba: causaba el doble conteo de BCI en Alfonso —
 * 5 productos id261 vs 2 filas al-día del CMF → 3 se perdían y las 90+d se degradaban duplicando).
 */
import { canonicalInstitutionKey, normalizeText } from '../utils/acreedor_matcher';

export interface ClassifyCreditor {
  institucion: string;
  tipoCredito: string;
  overdue90Days: number;
  totalCredito: number;
}
export interface ClassifyOverride { institucion_cmf: string; monto_clp?: number; fecha_vencimiento?: string; }
export interface ClassifyId261 { institucion_cmf: string; total_credito_clp: number; document_filename?: string; }
export interface ClassifyReclass { institucion_cmf: string; total_credito_clp: number; delinquency_start_date?: string; }
export interface ClassifyDeRecl { institucion_cmf: string; total_credito_clp: number; }
export interface ClassifyAdditional { bank: string; institucion_cmf: string; total_credito_clp: number; categoria_articulo: number; }

export interface PlannedRow {
  /** Nombre de institución a resolver contra el catálogo (RUT) en la ejecución. */
  institucion: string;
  monto: number;
  art: 260 | 261;
  /** YYYY-MM-DD si aplica (solo 260). */
  fechaVenc?: string;
  cmf: boolean;                 // true = del CMF; false = NO-CMF (additional)
  source: 'override' | 'id261' | 'reclassified' | 'dereclassified' | 'cmf' | 'additional';
}

export interface ClassifyInput {
  creditors: ClassifyCreditor[];
  overrides?: ClassifyOverride[];
  id261?: ClassifyId261[];
  reclassified?: ClassifyReclass[];
  deReclassified?: ClassifyDeRecl[];
  additional?: ClassifyAdditional[];
}

const overrideBaseKey = (inst: string): string => normalizeText(inst.replace(/\s*\(.*$/s, ''));

/**
 * Devuelve el plan de filas a declarar. NO aplica filtros de I/O (no-doc, comuna, trivial): esos
 * quedan en la ejecución de fillStep3 y solo afectan a las filas `source:'cmf'` (las listas del
 * Centinela ya vienen acreditadas por documento).
 */
export function planStep3Rows(input: ClassifyInput): PlannedRow[] {
  const { creditors, overrides = [], id261 = [], reclassified = [], deReclassified = [], additional = [] } = input;
  const rows: PlannedRow[] = [];

  const reclassKeys = new Set(reclassified.map((r) => canonicalInstitutionKey(r.institucion_cmf)));
  const deReclKeys = new Set(deReclassified.map((d) => canonicalInstitutionKey(d.institucion_cmf)));
  const isReclass = (c: ClassifyCreditor) => reclassKeys.has(canonicalInstitutionKey(c.institucion));
  const isDeRecl = (c: ClassifyCreditor) => deReclKeys.has(canonicalInstitutionKey(c.institucion));

  // --- Multiproducto 260: bancos con ≥2 overrides (un cert de liquidación con N créditos) ---
  const overrideGroups = new Map<string, ClassifyOverride[]>();
  for (const o of overrides) {
    const k = overrideBaseKey(o.institucion_cmf);
    overrideGroups.set(k, [...(overrideGroups.get(k) ?? []), o]);
  }
  const multiProduct260 = new Set([...overrideGroups.entries()].filter(([, a]) => a.length >= 2).map(([k]) => k));

  // --- Multiproducto 261: bancos cuyos id261 SUPERAN el pool de filas CMF reclamables (al-día MÁS
  // 90+d SIN override: su payoff). Si NO lo superan, el loop principal + el reclamo de filas 90+d
  // por id261 los declara bien. Antes el denominador era solo al-día → un banco con 2 id261, 1
  // línea al-día y 2 filas 90+d (Itaú de Miguel) se marcaba multiproducto y perdía la línea. ---
  const alDia = creditors.filter((c) => (c.overdue90Days === 0 && !isReclass(c)) || isDeRecl(c));
  const hasOverrideFor = (c: ClassifyCreditor) =>
    overrides.some((o) => canonicalInstitutionKey(o.institucion_cmf) === canonicalInstitutionKey(c.institucion));
  const id261ByBank = new Map<string, ClassifyId261[]>();
  for (const r of id261) {
    const k = canonicalInstitutionKey(r.institucion_cmf);
    id261ByBank.set(k, [...(id261ByBank.get(k) ?? []), r]);
  }
  const poolCountByBank = new Map<string, number>();
  for (const c of creditors) {
    const esAlDia = (c.overdue90Days === 0 && !isReclass(c)) || isDeRecl(c);
    const es90SinOv = c.overdue90Days > 0 && !isReclass(c) && !isDeRecl(c) && !hasOverrideFor(c);
    if (!esAlDia && !es90SinOv) continue;
    const k = canonicalInstitutionKey(c.institucion);
    poolCountByBank.set(k, (poolCountByBank.get(k) ?? 0) + 1);
  }
  const multiProduct261 = new Set(
    [...id261ByBank.entries()].filter(([k, arr]) => arr.length > (poolCountByBank.get(k) ?? 0)).map(([k]) => k)
  );

  // --- Emisión 1: filas de PRODUCTO de bancos multiproducto (se saltan sus filas CMF abajo) ---
  for (const [k, arr] of overrideGroups.entries()) {
    if (!multiProduct260.has(k)) continue;
    for (const o of arr) rows.push({ institucion: o.institucion_cmf, monto: o.monto_clp ?? 0, art: 260, fechaVenc: o.fecha_vencimiento, cmf: true, source: 'override' });
  }
  for (const [k, arr] of id261ByBank.entries()) {
    if (!multiProduct261.has(k)) continue;
    for (const r of arr) rows.push({ institucion: r.institucion_cmf, monto: r.total_credito_clp, art: 261, cmf: true, source: 'id261' });
  }

  const reclByKey = new Map(reclassified.map((r) => [canonicalInstitutionKey(r.institucion_cmf), r]));
  const deReclByKey = new Map(deReclassified.map((d) => [canonicalInstitutionKey(d.institucion_cmf), d]));
  const getOverride = (c: ClassifyCreditor): ClassifyOverride | undefined => {
    const key = canonicalInstitutionKey(c.institucion);
    const matches = overrides.filter((o) => canonicalInstitutionKey(o.institucion_cmf) === key);
    if (!matches.length) return undefined;
    const withDate = matches.filter((o) => o.fecha_vencimiento);
    const pool = withDate.length ? withDate : matches;
    return pool.reduce((b, o) => (Math.abs((o.monto_clp ?? 0) - c.totalCredito) < Math.abs((b.monto_clp ?? 0) - c.totalCredito) ? o : b));
  };

  // --- id261 assignment (bancos NO multiproducto-261): 1:1 greedy por cercanía de monto ---
  // El pool incluye filas al-día MÁS filas 90+d SIN override: una fila 90+d cuyo payoff se emitió
  // como identified261 (por no traer venc) es la MISMA deuda → si no la reclama, el id261 se ancla
  // a una fila al-día y la 90+d se declara aparte al monto del CMF (DOBLE CONTEO). Testigo:
  // Santander consumo de Cristian (CMF $6.891.901 90+d / payoff $6.985.718). El payoff no acredita
  // venc → la fila 90+d reclamada se declara 261 (abajo). Refuerza L36 (anclaje por monto).
  const claimable90 = (c: ClassifyCreditor) =>
    c.overdue90Days > 0 && !isReclass(c) && !isDeRecl(c) && !getOverride(c);
  const id261Assignment = new Map<ClassifyCreditor, ClassifyId261>();
  {
    const byBank = new Map<string, { cmf: ClassifyCreditor[]; ids: ClassifyId261[] }>();
    for (const c of creditors) {
      const k = canonicalInstitutionKey(c.institucion);
      if (multiProduct261.has(k)) continue; // sus filas se saltan; sus id261 ya se emitieron
      const eligible = ((c.overdue90Days === 0 && !isReclass(c)) || isDeRecl(c)) || claimable90(c);
      if (!eligible) continue;
      const g = byBank.get(k) ?? { cmf: [], ids: [] };
      g.cmf.push(c); byBank.set(k, g);
    }
    for (const r of id261) {
      const k = canonicalInstitutionKey(r.institucion_cmf);
      if (multiProduct261.has(k)) continue;
      const g = byBank.get(k); if (g) g.ids.push(r);
    }
    for (const { cmf, ids } of byBank.values()) {
      const free = new Set(cmf);
      for (const id of [...ids].sort((a, b) => b.total_credito_clp - a.total_credito_clp)) {
        let best: ClassifyCreditor | undefined;
        for (const c of free) if (!best || Math.abs(c.totalCredito - id.total_credito_clp) < Math.abs(best.totalCredito - id.total_credito_clp)) best = c;
        if (best) { id261Assignment.set(best, id); free.delete(best); }
      }
    }
  }

  // --- Emisión 2: loop principal sobre filas del CMF NO cubiertas por multiproducto ---
  for (const c of creditors) {
    const k = canonicalInstitutionKey(c.institucion);
    const esObligacion260 = (c.overdue90Days > 0 || isReclass(c)) && !isDeRecl(c);
    if (multiProduct260.has(k) && esObligacion260) continue;  // sus 260 ya se emitieron
    if (multiProduct261.has(k)) continue;                     // banco representado por id261

    let isOtros = (c.overdue90Days === 0 && !isReclass(c)) || isDeRecl(c);
    // Fila 90+d sin override propio pero reclamada por su payoff (id261) → 261 al monto del cert
    // (una fila, evita el doble conteo). Testigo: Santander consumo de Cristian.
    if (!isOtros && !isReclass(c) && !getOverride(c) && id261Assignment.get(c)) isOtros = true;
    const rec = reclByKey.get(k);
    const cmfOv = !isOtros ? getOverride(c) : undefined;
    const idm = isOtros ? id261Assignment.get(c) : undefined;
    const deRecl = isOtros ? deReclByKey.get(k) : undefined;
    const monto =
      rec?.total_credito_clp ? rec.total_credito_clp :
      cmfOv?.monto_clp ? cmfOv.monto_clp :
      idm?.total_credito_clp ? idm.total_credito_clp :
      deRecl?.total_credito_clp ? deRecl.total_credito_clp :
      c.totalCredito;
    const fechaVenc = rec?.delinquency_start_date ?? cmfOv?.fecha_vencimiento;
    if (!isOtros && !fechaVenc) isOtros = true; // 260 sin venc acreditable → 261 (no se pierde)
    const source: PlannedRow['source'] = rec ? 'reclassified' : cmfOv ? 'override' : idm ? 'id261' : deRecl ? 'dereclassified' : 'cmf';
    rows.push({ institucion: c.institucion, monto, art: isOtros ? 261 : 260, fechaVenc: isOtros ? undefined : fechaVenc, cmf: true, source });
  }

  // --- Emisión 3: NO-CMF (additional) ---
  for (const a of additional) {
    rows.push({ institucion: a.institucion_cmf || a.bank, monto: a.total_credito_clp, art: a.categoria_articulo === 260 ? 260 : 261, cmf: false, source: 'additional' });
  }

  return rows;
}
