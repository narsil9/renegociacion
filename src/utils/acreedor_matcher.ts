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
export async function fetchAcreedoresCatalog(
  client: SupabaseClient
): Promise<AcreedorCatalogEntry[]> {
  const { data, error } = await client
    .from('acreedores_canonicos')
    .select('id, nombre, nombre_normalizado, tipo, rut, direccion, comuna, email, telefono, representante_legal, rut_representante, activo')
    .eq('activo', true);

  if (error) {
    throw new Error(`Error al cargar acreedores_canonicos: ${error.message}`);
  }
  const entries = (data ?? []) as AcreedorCatalogEntry[];
  for (const entry of entries) {
    entry.nombre_normalizado_local = normalizeText(entry.nombre);
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
  'santander': 'banco santander',
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
  let target = normalizeText(cmfName);
  if (ALIASES[target]) {
    target = ALIASES[target];
  }

  // Tier 1: exact normalized equality
  const exact = catalog.filter((e) => (e.nombre_normalizado_local ?? normalizeText(e.nombre)) === target);
  if (exact.length === 1) {
    return { status: 'matched', cmfName, entry: exact[0] };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', cmfName, candidates: exact };
  }

  // Tier 2: token-containment in either direction
  const containment = catalog.filter((e) => {
    const candidate = e.nombre_normalizado_local ?? normalizeText(e.nombre);
    return (
      isTokenSubsequence(target, candidate) || isTokenSubsequence(candidate, target)
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
