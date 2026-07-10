import { SupabaseClient } from '@supabase/supabase-js';

/**
 * One row of the `acreedores_canonicos` catalog (master list of possible
 * financial creditors). Source for the data filled into Step 3.
 */
export interface AcreedorCatalogEntry {
  id: number;
  nombre: string;
  nombre_normalizado: string;
  tipo: string | null;
  rut: string | null;
  direccion: string | null;
  comuna: string | null;
  email: string | null;
  telefono: string | null;
  representante_legal: string | null;
  rut_representante: string | null;
  activo: boolean;
  nombre_normalizado_local?: string;
  // Variantes de nombre como aparecen en el CMF/certs (columna `nombres_alternativos`).
  nombres_alternativos?: string[] | null;
  // Cache normalizado (mismo transform que `target` en matchAcreedor / canonicalInstitutionKey).
  nombres_alternativos_norm?: string[];
}

export type MatchStatus = 'matched' | 'ambiguous' | 'not_found';

export interface MatchResult {
  status: MatchStatus;
  cmfName: string;
  entry?: AcreedorCatalogEntry; // present when status === 'matched'
  candidates?: AcreedorCatalogEntry[]; // present when status === 'ambiguous'
}

/**
 * Normalizes a name for comparison: lowercase, strip diacritics, replace any
 * non-alphanumeric run with a single space, collapse and trim.
 * "CAT (ex CENCOSUD)" -> "cat ex cencosud"
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * El parser del CMF PEGA/INSERTA el tipo de cr\u00e9dito dentro del nombre de la
 * instituci\u00f3n, truncado a la fila: "Consumo"\u2192"Consum", "Tarjeta"\u2192"Tarjet",
 * "Cr\u00e9dito"\u2192"Credit", "Vivienda"\u2192"Vivien", "L\u00ednea"\u2192"Linea". Eso rompe el match
 * contra el cat\u00e1logo (ej. "Banco del Estado de Chile Consum" no contiene como
 * subsecuencia a "Banco Estado"). Se quitan como TOKENS EXACTOS.
 *
 * \u26a0\ufe0f NO incluir "credito" (romper\u00eda "Banco de Cr\u00e9dito e Inversiones" / BCI) ni
 * "tarjeta"/"tarjetas" (romper\u00eda "... Administradora de Tarjetas"). Solo las
 * formas TRUNCADAS que el parser inyecta, que no colisionan con nombres reales.
 */
const CREDIT_TYPE_TOKENS = new Set([
  'consum', 'consumo', 'tarjet', 'linea', 'vivien', 'vivienda', 'credit',
]);
export function stripCreditTypeTokens(normalized: string): string {
  return normalized
    .split(' ')
    .filter((t) => t && !CREDIT_TYPE_TOKENS.has(t))
    .join(' ')
    .trim();
}

/**
 * Normalizes a Chilean RUT to the portal-friendly form: no dots, single dash
 * before the verifier digit, uppercase K. "6.434.569-9" -> "6434569-9".
 */
export function normalizeRut(rut: string | null): string | null {
  if (!rut) return null;
  const clean = rut.replace(/[.\s]/g, '').toUpperCase();
  const body = clean.replace(/-/g, '');
  if (body.length < 2) return clean;
  const dv = body.slice(-1);
  const num = body.slice(0, -1);
  return `${num}-${dv}`;
}

/**
 * Returns true if the RUT is in a valid format (7-8 digits followed by a dash and check digit/K).
 */
export function isValidRut(rut: string | null): boolean {
  if (!rut) return false;
  const norm = normalizeRut(rut);
  if (!norm) return false;
  return /^\d{7,8}-[\dK]$/i.test(norm);
}

/**
 * Matches Chilean RUTs in free text, with or without thousands separators.
 * e.g. "97.006.000-6", "97006000-6", "6.434.569-9".
 */
const RUT_IN_TEXT_REGEX = /\b\d{1,2}(?:\.?\d{3}){2}\s*-\s*[\dkK]\b|\b\d{7,8}\s*-\s*[\dkK]\b/gi;

/**
 * Extracts every Chilean RUT found in a block of text, returned in the
 * portal-friendly normalized form (no dots, single dash, uppercase K),
 * de-duplicated and order-preserving. Single source of truth for RUT
 * extraction shared by Step 3 and the Cognitive Orchestrator.
 */
export function extractRutsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(RUT_IN_TEXT_REGEX) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const norm = normalizeRut(m);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/**
 * Given a list of RUTs (e.g. extracted from a certificate) and the canonical
 * catalog, returns the first catalog entry whose RUT matches one of them,
 * skipping the client's own RUT. Returns null when none match.
 */
export function findCatalogEntryByRut(
  ruts: string[],
  catalog: AcreedorCatalogEntry[],
  clientRut?: string | null
): AcreedorCatalogEntry | null {
  const clientRutNorm = clientRut ? normalizeRut(clientRut) : null;
  for (const rut of ruts) {
    if (clientRutNorm && rut === clientRutNorm) continue;
    const entry = catalog.find((e) => normalizeRut(e.rut) === rut);
    if (entry) return entry;
  }
  return null;
}

/**
 * Map of comuna (normalized) -> portal Región <select> option value.
 * Covers every comuna currently present in `acreedores_canonicos`.
 */
const COMUNA_TO_REGION: Record<string, string> = {
  // Región de Arica y Parinacota (15)
  arica: '15',
  // Región de Tarapacá (1)
  iquique: '1',
  'alto hospicio': '1',
  // Región de Antofagasta (2)
  antofagasta: '2',
  calama: '2',
  // Región de Atacama (3)
  copiapo: '3',
  vallenar: '3',
  freirina: '3',
  // Región de Coquimbo (4)
  'la serena': '4',
  coquimbo: '4',
  illapel: '4',
  // Región de Valparaíso (5)
  valparaiso: '5',
  'vina del mar': '5',
  'la calera': '5',
  'san felipe': '5',
  'los andes': '5',
  quilpue: '5',
  quillota: '5',
  'san antonio': '5',
  casablanca: '5',
  // Región Metropolitana (13)
  santiago: '13',
  'las condes': '13',
  providencia: '13',
  huechuraba: '13',
  vitacura: '13',
  nunoa: '13',
  'san bernardo': '13',
  quilicura: '13',
  macul: '13',
  'estacion central': '13',
  renca: '13',
  'quinta normal': '13',
  maipu: '13',
  pudahuel: '13',
  'la florida': '13',
  recoleta: '13',
  penalolen: '13',
  'lo espejo': '13',
  conchali: '13',
  'lo barnechea': '13',
  'san miguel': '13',
  independencia: '13',
  colina: '13',
  'san joaquin': '13',
  'la pintana': '13',
  talagante: '13',
  lampa: '13',
  penaflor: '13',
  cerrillos: '13',
  'cerro navia': '13',
  'el bosque': '13',
  'la cisterna': '13',
  'la granja': '13',
  'la reina': '13',
  'lo prado': '13',
  'pedro aguirre cerda': '13',
  'puente alto': '13',
  'san ramon': '13',
  // Región del Libertador General Bernardo O'Higgins (6)
  rancagua: '6',
  rengo: '6',
  'san fernando': '6',
  // Región del Maule (7)
  talca: '7',
  curico: '7',
  linares: '7',
  cauquenes: '7',
  // Región de Ñuble (16)
  chillan: '16',
  // Región del Biobío (8)
  concepcion: '8',
  'los angeles': '8',
  talcahuano: '8',
  tome: '8',
  lota: '8',
  // Región de la Araucanía (9)
  temuco: '9',
  pucon: '9',
  victoria: '9',
  // Región de los Ríos (14)
  valdivia: '14',
  paillaco: '14',
  // Región de los Lagos (10)
  osorno: '10',
  'puerto montt': '10',
  // Región Aysén (11)
  coyhaique: '11',
  aysen: '11',
  // Región de Magallanes (12)
  'punta arenas': '12',
};

/**
 * Returns the portal Región <select> option value for a given comuna text,
 * or null if the comuna is unknown.
 */
export function getRegionValue(comuna: string | null): string | null {
  if (!comuna) return null;
  return COMUNA_TO_REGION[normalizeText(comuna)] ?? null;
}

/**
 * Loads the full `acreedores_canonicos` catalog (active entries only).
 */
// Aliases-como-DATO: variante normalizada → clave canónica de su institución.
// Se llena desde `acreedores_canonicos.nombres_alternativos` al cargar el catálogo y
// lo consulta `canonicalInstitutionKey` (además del mapa estático `ALIASES`), para que
// el nombre del CMF y el del documento colapsen a la MISMA clave (ej. "Tenpo Payments"
// y "Tenpo Prepago"). El catálogo es global → este registro es idéntico para todo cliente.
const catalogAliasRegistry: Record<string, string> = {};

export async function fetchAcreedoresCatalog(
  client: SupabaseClient
): Promise<AcreedorCatalogEntry[]> {
  const { data, error } = await client
    .from('acreedores_canonicos')
    .select('id, nombre, nombre_normalizado, tipo, rut, direccion, comuna, email, telefono, representante_legal, rut_representante, activo, nombres_alternativos')
    .eq('activo', true);

  if (error) {
    throw new Error(`Error al cargar acreedores_canonicos: ${error.message}`);
  }
  const entries = (data ?? []) as AcreedorCatalogEntry[];
  for (const entry of entries) {
    entry.nombre_normalizado_local = normalizeText(entry.nombre);
    // Normalizar las variantes con el MISMO transform que `target`/`norm` (strip de tipo de crédito).
    entry.nombres_alternativos_norm = (entry.nombres_alternativos ?? [])
      .map((a) => stripCreditTypeTokens(normalizeText(a)))
      .filter((a) => a.length > 0);
    // Registrar cada variante → clave canónica de esta institución.
    const canonKey = stripCreditTypeTokens(normalizeText(entry.nombre));
    for (const altKey of entry.nombres_alternativos_norm) {
      if (altKey !== canonKey) catalogAliasRegistry[altKey] = canonKey;
    }
  }
  return entries;
}

/**
 * Matches a creditor name extracted from the CMF against the catalog.
 *
 * Tiers (first that yields a single hit wins):
 *  1. Exact normalized equality.
 *  2. Token-containment: the CMF name appears as a token sequence inside a
 *     catalog name, or vice-versa.
 *
 * Multiple hits in a tier -> 'ambiguous'. No hits at all -> 'not_found'.
 */
const ALIASES: Record<string, string> = {
  'presto lider': 'tarjeta lider',
  'presto': 'tarjeta lider',
  'tarjeta presto': 'tarjeta lider',
  'lider': 'tarjeta lider',
  'bci': 'banco de credito e inversiones',
  // El CMF imprime la columna institución SIN el prefijo "Banco" para varias entidades →
  // colapsan distinto que el nombre del certificado ("Banco de Crédito e Inversiones",
  // "Banco Internacional") y el producto no ancla a su fila CMF. Aliases del nombre corto del CMF.
  'de credito e inversiones': 'banco de credito e inversiones',
  'internacional': 'banco internacional',
  // El CMF abrevia "Santander Consumer"; el cert imprime "Santander Consumer Finance (Limitada)".
  // Mismo acreedor (RUT 79.072.290-3), distinto de "Santander-Chile" (banco).
  'santander consumer finance': 'santander consumer',
  'santander consumer finance limitada': 'santander consumer',
  'santander': 'banco santander',
  'santander chile': 'banco santander', // CMF escribe "Santander-Chile" (banco) → distinto de "Santander Consumer"
  'banco santander chile': 'banco santander', // variante con prefijo "Banco"
  'car ripley': 'car s a tarjeta ripley',
  'car': 'car s a tarjeta ripley',
  // El cert imprime el emisor como "CAR S.A. (Tarjeta Ripley)" → tras quitar el paréntesis queda
  // "CAR S.A." (≠ "CAR - Ripley" del CMF). Sin este alias el producto Ripley cae a NO-CMF.
  'car s a': 'car s a tarjeta ripley',
  // CCAF: los documentos usan "Caja de Compensación X" pero el catálogo registra "CCAF X".
  // Sin estos aliases, matchAcreedor devuelve not_found para los NO-CMF de cajas de compensación.
  'caja los andes': 'ccaf los andes',
  'caja de compensacion de los andes': 'ccaf los andes',
  'caja de compensacion los andes': 'ccaf los andes',
  'caja compensacion los andes': 'ccaf los andes',
  'caja de compensacion 18 de septiembre': 'ccaf 18 de septiembre',
  'caja 18 de septiembre': 'ccaf 18 de septiembre',
  'caja de compensacion gabriela mistral': 'ccaf gabriela mistral',
  'caja gabriela mistral': 'ccaf gabriela mistral',
  'caja de compensacion la araucana': 'ccaf la araucana',
  'caja la araucana': 'ccaf la araucana',
  'caja de compensacion los heroes': 'ccaf los heroes',
  'caja los heroes': 'ccaf los heroes',
  // Coopeuch: token-containment ya lo resuelve, pero alias explícito para Tier 1 más rápido y seguro.
  'coopeuch': 'coopeuch ltda',
  // La Polar: el texto de las transacciones a veces la escribe pegada ("Lapolar"); el Centinela
  // puede devolver "La Polar" o "Lapolar". Ambas → "Empresas La Polar S.A." (RUT 96874030-K).
  'lapolar': 'empresas la polar',
  'la polar': 'empresas la polar',
  // El CMF usa el nombre legal largo "Banco del Estado de Chile"; el catálogo, "Banco Estado".
  'banco del estado de chile': 'banco estado',
  'banco estado de chile': 'banco estado',
  // Cajas de compensación: el CMF las escribe con la forma LARGA "Caja de Compensación de
  // Asignación Familiar <X>" (con "Asignación Familiar"), distinta de la forma corta de los
  // certificados ("CCAF <X>" / "Caja <X>"). Sin estos aliases, una CCAF que figura en el CMF
  // se SALTA en el Paso 3 ("No existe en acreedores_canonicos") porque el nombre largo no
  // matchea el catálogo y la fila del CMF no trae RUT. Caso testigo: 3 CCAF Los Andes de
  // Miguel ($1.555.410 / $2.715.591 / $4.672.364) que el CMF lista con el nombre largo.
  'caja de compensacion de asignacion familiar la araucana': 'ccaf la araucana',
  'caja de compensacion asignacion familiar la araucana': 'ccaf la araucana',
  'caja de compensacion de asignacion familiar los andes': 'ccaf los andes',
  'caja de compensacion asignacion familiar los andes': 'ccaf los andes',
  'caja de compensacion de asignacion familiar 18 de septiembre': 'ccaf 18 de septiembre',
  'caja de compensacion asignacion familiar 18 de septiembre': 'ccaf 18 de septiembre',
  'caja de compensacion de asignacion familiar gabriela mistral': 'ccaf gabriela mistral',
  'caja de compensacion asignacion familiar gabriela mistral': 'ccaf gabriela mistral',
  'caja de compensacion de asignacion familiar los heroes': 'ccaf los heroes',
  'caja de compensacion asignacion familiar los heroes': 'ccaf los heroes',
  // CAT / Cencosud: el CMF dice "CAT Administradora de Tarjetas S.A."; el catálogo registra
  // "Cencosud Administradora de Tarjetas S.A." (mismo RUT 99500840-8 que "CAT (ex CENCOSUD)").
  'cat administradora de tarjetas s a': 'cencosud administradora de tarjetas s a',
  'cat administradora de tarjetas': 'cencosud administradora de tarjetas s a',
  // El CMF abrevia el emisor de la tarjeta Cencosud como "CAT (ex CENCOSUD)" → tras quitar el
  // paréntesis queda "CAT", que no calzaba con el cert "CAT/Cencosud Administradora de Tarjetas
  // S.A." → el cert no anclaba a la fila CMF y se duplicaba (1 fila CMF + 1 NO-CMF). Mismo RUT.
  'cat': 'cencosud administradora de tarjetas s a',
};

/**
 * Matches a creditor name extracted from the CMF against the catalog.
 *
 * Tiers (first that yields a single hit wins):
 *  1. Exact normalized equality.
 *  2. Token-containment: the CMF name appears as a token sequence inside a
 *     catalog name, or vice-versa.
 *
 * Multiple hits in a tier -> 'ambiguous'. No hits at all -> 'not_found'.
 */
export function matchAcreedor(
  cmfName: string,
  catalog: AcreedorCatalogEntry[]
): MatchResult {
  // Quitar los tokens de tipo de crédito que el parser del CMF inyecta en el nombre,
  // ANTES de buscar alias/catálogo (sino "Banco del Estado de Chile Consum" nunca matchea).
  let target = stripCreditTypeTokens(normalizeText(cmfName));
  // Cajas de compensación: el CMF imprime el nombre LARGO ("Caja de Compensación de Asignación
  // Familiar <X>") y por el ancho de columna a veces lo TRUNCA mid-word ("...Famili Los Andes"),
  // rompiendo el match exacto y dejándolo ambiguo con otras entradas "<X>" (Universidad/IP Los
  // Andes). El catálogo las nombra "CCAF <X>". Normalizar ese prefijo largo (aunque venga truncado)
  // a "ccaf" hace que calce exacto con "CCAF <X>" — GENERAL para cualquier caja (Los Andes, Los
  // Héroes, La Araucana, 18 de Septiembre, Gabriela Mistral).
  target = target.replace(/caja de compensacion(?: de asignacion famil\w*)?/, 'ccaf').replace(/\s+/g, ' ').trim();
  if (ALIASES[target]) {
    target = ALIASES[target];
  }

  // Tier 1: exact normalized equality — contra el nombre canónico O cualquier nombre alternativo.
  const exact = catalog.filter((e) =>
    (e.nombre_normalizado_local ?? normalizeText(e.nombre)) === target ||
    (e.nombres_alternativos_norm ?? []).includes(target)
  );
  if (exact.length === 1) {
    return { status: 'matched', cmfName, entry: exact[0] };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', cmfName, candidates: exact };
  }

  // Tier 2: token-containment in either direction (también contra los nombres alternativos).
  const containment = catalog.filter((e) => {
    const candidate = e.nombre_normalizado_local ?? normalizeText(e.nombre);
    if (isTokenSubsequence(target, candidate) || isTokenSubsequence(candidate, target)) return true;
    return (e.nombres_alternativos_norm ?? []).some(
      (alt) => isTokenSubsequence(target, alt) || isTokenSubsequence(alt, target)
    );
  });

  if (containment.length === 1) {
    return { status: 'matched', cmfName, entry: containment[0] };
  }
  if (containment.length > 1) {
    return { status: 'ambiguous', cmfName, candidates: containment };
  }

  return { status: 'not_found', cmfName };
}

/**
 * A1 — Clave canónica de institución, alias-aware. Resuelve el nombre del CMF
 * ("CAR - Ripley", "Santander-Chile") y el nombre canónico del catálogo
 * ("CAR S.A. (Tarjeta Ripley)", "Banco Santander") a la MISMA clave vía ALIASES,
 * para que el matching documento↔acreedor por institución no falle cuando el
 * dashboard guarda el nombre canónico y el worker compara contra el del CMF.
 */
export function canonicalInstitutionKey(name: string | null | undefined): string {
  if (!name) return '';
  // Normalizar a la institución BASE antes del alias, para que variantes del MISMO banco
  // colapsen a una sola clave. Se quitan, en orden:
  //  (1) Sufijo descriptivo que el LLM agrega tras un guión rodeado de espacios — el LLM es
  //      no-determinista al nombrar y a veces escribe "Banco de Chile — Tarjeta de crédito
  //      (*2949)" o "Banco del Estado de Chile — Operación adicional (CRE-…)". Sin quitarlo,
  //      el matching/dedup/backstop fallan según cómo el LLM escriba el nombre esa corrida.
  //      Requiere espacios alrededor del guión para NO romper "Santander-Chile".
  //  (2) Sufijo de producto entre paréntesis (multiproducto: "Banco X (Consumo …)").
  //  (3) Tokens de tipo de crédito que el parser del CMF pega al nombre ("… Consum").
  // Así "Banco del Estado de Chile Consum", "Banco del Estado de Chile — Operación adicional"
  // y "Banco Estado" colapsan todas a la misma clave.
  //      También corta en " / " (el LLM a veces escribe el nombre compuesto "CMR Falabella /
  //      Banco Falabella" o "PRESTO LIDER / Servicios…"): se queda con la institución PRIMARIA.
  const base = name.replace(/\s+[—–/-]\s+.*$/s, '').replace(/\s*\(.*$/s, '');
  const norm = stripCreditTypeTokens(normalizeText(base));
  // Aliases-como-dato del catálogo (nombres_alternativos) primero, luego el mapa estático.
  return catalogAliasRegistry[norm] ?? ALIASES[norm] ?? norm;
}

/**
 * Mejora #6 — Top-N candidatos del catálogo por similitud de nombre, para cuando
 * `matchAcreedor` no resuelve único (not_found/ambiguous). En vez de alertar "sin match"
 * a secas, ofrece las instituciones más parecidas para que el abogado elija de una lista.
 * Determinista (solapamiento de tokens + bonus por contención); reusa la misma normalización
 * que el matcher. Considera nombre, nombre_normalizado y nombres_alternativos del catálogo.
 */
export interface CandidateSuggestion {
  entry: AcreedorCatalogEntry;
  score: number; // 0..~1.2
}

export function topNCandidates(
  name: string | null | undefined,
  catalog: AcreedorCatalogEntry[],
  n = 3
): CandidateSuggestion[] {
  if (!name) return [];
  const q = stripCreditTypeTokens(normalizeText(name));
  if (!q) return [];
  const qTokens = new Set(q.split(' ').filter(Boolean));
  if (qTokens.size === 0) return [];

  const scored: CandidateSuggestion[] = [];
  for (const e of catalog) {
    const variants = [e.nombre, e.nombre_normalizado, ...(e.nombres_alternativos ?? [])].filter(
      (v): v is string => typeof v === 'string' && v.length > 0
    );
    let best = 0;
    for (const v of variants) {
      const vn = stripCreditTypeTokens(normalizeText(v));
      if (!vn) continue;
      const vTokens = new Set(vn.split(' ').filter(Boolean));
      if (vTokens.size === 0) continue;
      const inter = [...qTokens].filter((t) => vTokens.has(t)).length;
      const union = new Set([...qTokens, ...vTokens]).size;
      const jaccard = union ? inter / union : 0;
      const contains = vn.includes(q) || q.includes(vn) ? 0.25 : 0;
      best = Math.max(best, jaccard + contains);
    }
    if (best > 0) scored.push({ entry: e, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n);
}

/**
 * True if all whitespace-separated tokens of `needle` appear, in order and
 * contiguously, within `haystack`. Avoids loose substring false-positives
 * (e.g. "cat" matching "catolica").
 */
function isTokenSubsequence(needle: string, haystack: string): boolean {
  if (!needle || !haystack) return false;
  const n = needle.split(' ');
  const h = haystack.split(' ');
  if (n.length > h.length) return false;
  for (let i = 0; i + n.length <= h.length; i++) {
    let ok = true;
    for (let j = 0; j < n.length; j++) {
      if (h[i + j] !== n[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
