/**
 * (1) Verifica al MEJOR candidato campo por campo (mapeo real al portal + PDFs).
 * (2) Cuenta, en TODA la prod, cuántos clientes están "completos" = todo lo que el
 *     worker necesita EXCEPTO fecha_nacimiento (ausente para todos).
 *
 * ⚠️ READ-ONLY ton…. PII-SAFE: solo agregados/presencia, sin nombre/RUT/domicilio.
 * Uso: npx ts-node --transpile-only -r dotenv/config tools/verify_and_count_complete.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs'; import * as path from 'path';
import * as dotenv from 'dotenv'; dotenv.config();

const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const enums = JSON.parse(fs.readFileSync(path.join(__dirname, '../supabase/portal_select_values.json'), 'utf8')) as Record<string, { value: string; label: string }[]>;
const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const rutNorm = (r: string) => r.replace(/[.\-]/g, '').toLowerCase();
const daysAgo = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
const chunk = <T>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

const mapEC = (t: string | null) => /solter|casad|divorc|viud|separaci|convivien/.test(norm(t ?? ''));
const mapProf = (t: string | null) => {
  const n = norm(t ?? ''); if (!n) return false;
  return enums.personaProfesionOficio.some(x => norm(x.label) === n || norm(x.label).includes(n) || n.includes(norm(x.label)));
};
const comunaEnCatalogo = (c: string | null) => !!c && enums.personaComuna.some(x => norm(x.label) === norm(c));

// Paginador genérico (PostgREST corta en 1000)
async function fetchAll(rel: string, schema: string | null, select: string, filter?: (q: any) => any): Promise<any[]> {
  const out: any[] = []; let from = 0; const size = 1000;
  for (;;) {
    let q = (schema ? sb.schema(schema) : sb).from(rel).select(select).range(from, from + size - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) { console.error(`fetchAll ${rel}:`, error.message); break; }
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
    from += size;
  }
  return out;
}

async function main() {
  console.log('🔎 Verificación de #1 + conteo de clientes completos (read-only)\n');

  // A. Casos (rut ↔ airtable_id)
  const casos = await fetchAll('v_casos_renegociacion', null, 'airtable_id, rut');
  const rutByCase = new Map<string, string>(); const caseByRutNorm = new Map<string, string>();
  for (const c of casos) if (c.rut) { rutByCase.set(c.airtable_id, c.rut); caseByRutNorm.set(rutNorm(c.rut), c.airtable_id); }

  // B. Certificados clasificados (documento_checklist) por rut_norm
  const certRows = await fetchAll('renegociacion_audit_pdf', null, 'rut_norm', q => q.eq('tipo_documento', 'documento_checklist'));
  const certCount = new Map<string, number>();
  for (const r of certRows) if (r.rut_norm) certCount.set(r.rut_norm, (certCount.get(r.rut_norm) ?? 0) + 1);
  console.log(`Certificados clasificados: ${certRows.length} PDFs en ${certCount.size} clientes distintos.`);

  // Universo de evaluación: clientes con CMF + ≥1 cert clasificado
  const cmfRows = await fetchAll('cmf_informes', null, 'case_airtable_id, fecha_emision', q => q.not('case_airtable_id', 'is', null));
  const cmfLatest = new Map<string, string>();
  for (const c of cmfRows) { const d = c.fecha_emision; if (d && (!cmfLatest.has(c.case_airtable_id) || d > cmfLatest.get(c.case_airtable_id)!)) cmfLatest.set(c.case_airtable_id, d); }
  console.log(`Casos con CMF: ${cmfLatest.size}.`);

  // Clientes a evaluar = tienen cert clasificado Y su caso tiene CMF
  const evalCases: { airtable_id: string; rut: string; certs: number; cmfDias: number | null }[] = [];
  for (const [rn, n] of certCount) {
    const aid = caseByRutNorm.get(rn); if (!aid) continue;
    if (!cmfLatest.has(aid)) continue;
    evalCases.push({ airtable_id: aid, rut: rutByCase.get(aid)!, certs: n, cmfDias: daysAgo(cmfLatest.get(aid)!) });
  }
  console.log(`Clientes con CMF + ≥1 cert clasificado: ${evalCases.length}.\n`);

  // C. Datos en bloque
  const ruts = evalCases.map(e => e.rut);
  const personas: any[] = [];
  for (const c of chunk(ruts, 100)) personas.push(...await (sb.schema('core').from('persona').select('rut, estado_civil, profesion, clave_unica, airtable_main_id, fecha_nacimiento').in('rut', c)).then(r => r.data ?? []));
  const persByRut = new Map(personas.map(p => [p.rut, p]));
  const amids = personas.map(p => p.airtable_main_id).filter(Boolean);
  const bronze: any[] = [];
  for (const c of chunk(amids, 100)) bronze.push(...await sb.from('bronze_customers_main').select('airtable_id, data').in('airtable_id', c).then(r => r.data ?? []));
  const bronzeById = new Map(bronze.map(b => [b.airtable_id, b.data ?? {}]));
  const caseIds = evalCases.map(e => e.airtable_id);
  const siiRows: any[] = [];
  for (const c of chunk(caseIds, 100)) siiRows.push(...await sb.from('mac_mini_jobs').select('airtable_id, command').in('airtable_id', c).in('command', ['sii-carpeta', 'sii-agente-retenedor']).eq('status', 'done').then(r => r.data ?? []));
  const siiByCase = new Map<string, Set<string>>();
  for (const j of siiRows) { if (!siiByCase.has(j.airtable_id)) siiByCase.set(j.airtable_id, new Set()); siiByCase.get(j.airtable_id)!.add(j.command); }

  // D. Evaluar cada cliente contra el estándar (excepto fecha_nacimiento)
  type Ev = { e: typeof evalCases[0]; cu: boolean; ec: boolean; prof: boolean; bronze: boolean; comunaCat: boolean; ct: boolean; ar: boolean; score: number };
  const evals: Ev[] = [];
  for (const e of evalCases) {
    const p = persByRut.get(e.rut) ?? {}; const b = p.airtable_main_id ? bronzeById.get(p.airtable_main_id) : null;
    const sii = siiByCase.get(e.airtable_id) ?? new Set();
    const ev: Ev = {
      e, cu: !!p.clave_unica, ec: mapEC(p.estado_civil), prof: mapProf(p.profesion),
      bronze: !!(b && b['Comuna'] && b['Domicilio']), comunaCat: comunaEnCatalogo(b?.['Comuna'] ?? null),
      ct: sii.has('sii-carpeta'), ar: sii.has('sii-agente-retenedor'), score: 0,
    };
    ev.score = Math.min(e.certs, 5) + (e.cmfDias !== null && e.cmfDias <= 30 ? 3 : 0) + (ev.cu ? 3 : 0) + (ev.bronze ? 3 : 0) + (ev.ec ? 1 : 0) + (ev.prof ? 1 : 0) + (ev.ct ? 1 : 0) + (ev.ar ? 1 : 0);
    evals.push(ev);
  }
  evals.sort((a, b) => b.score - a.score || a.e.airtable_id.localeCompare(b.e.airtable_id));

  // Estándar "completo (excepto DOB)"
  const isComplete = (v: Ev) => v.cu && v.e.certs >= 2 && (v.e.cmfDias ?? 999) <= 30 && v.bronze && v.ec && v.prof && v.ct && v.ar;
  const completos = evals.filter(isComplete);
  const completosSinFreshness = evals.filter(v => v.cu && v.e.certs >= 2 && v.bronze && v.ec && v.prof && v.ct && v.ar); // ignora <30d

  // (1) Verificación del #1
  const top = evals[0]; const f = (b: boolean) => b ? '✅' : '🔴';
  console.log('═══ (1) VERIFICACIÓN del candidato #1 (mejor score) ═══');
  console.log(`  certificados clasificados: ${f(top.e.certs >= 2)} (${top.e.certs})`);
  console.log(`  CMF fresco (<30d):         ${f((top.e.cmfDias ?? 999) <= 30)} (${top.e.cmfDias}d)`);
  console.log(`  ClaveÚnica:                ${f(top.cu)}`);
  console.log(`  estado_civil → código:     ${f(top.ec)}`);
  console.log(`  profesión → catálogo 290:  ${f(top.prof)}`);
  console.log(`  bronze (domicilio+comuna): ${f(top.bronze)}`);
  console.log(`  comuna en catálogo portal: ${f(top.comunaCat)} ${top.comunaCat ? '(RM → región derivable)' : '(fuera de RM o falta cargar comuna)'}`);
  console.log(`  Carpeta Tributaria done:   ${f(top.ct)}`);
  console.log(`  Agentes Retenedores done:  ${f(top.ar)}`);
  console.log(`  fecha_nacimiento:          🔴 (ausente para TODOS → placeholder)`);
  console.log(`  → ${isComplete(top) ? '✅ COMPLETO (excepto DOB) — apto para probar' : '⚠️ le falta algo del estándar'}`);

  // (2) Conteo
  console.log('\n═══ (2) CONTEO de clientes como #1 (completos excepto DOB) ═══');
  console.log(`  Estándar estricto (ClaveÚnica + ≥2 certs + CMF<30d + bronze + estCivil + profesión + CT + AR): ${completos.length}`);
  console.log(`  Mismo estándar pero SIN exigir CMF<30d (sirve re-descargando CMF): ${completosSinFreshness.length}`);
  console.log(`  Universo evaluado (CMF + ≥1 cert clasificado): ${evalCases.length}`);
}

main().catch(e => { console.error('🚨', e instanceof Error ? e.message : e); process.exit(1); });
