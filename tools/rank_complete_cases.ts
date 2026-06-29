/**
 * Rankea los casos de ton… por COMPLETITUD para elegir con cuál(es) probar.
 * Universo: casos CON Informe CMF. Puntúa: certs, CMF fresco, ClaveÚnica, bronze
 * (domicilio/comuna), estado_civil mapeable, profesión, SII carpeta+agente.
 *
 * ⚠️ READ-ONLY ton…. PII-SAFE: identifica por ÍNDICE (#1..#N), no muestra
 *    nombre/RUT/domicilio. Orden determinístico → el índice es estable entre corridas.
 *
 * Uso: npx ts-node --transpile-only -r dotenv/config tools/rank_complete_cases.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs'; import * as path from 'path';
import * as dotenv from 'dotenv'; dotenv.config();

const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const enums = JSON.parse(fs.readFileSync(path.join(__dirname, '../supabase/portal_select_values.json'), 'utf8')) as Record<string, { value: string; label: string }[]>;
const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const rutNorm = (r: string) => r.replace(/[.\-]/g, '').toLowerCase();
const daysAgo = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
const ecMappable = (t: string | null) => /solter|casad|divorc|viud|separaci|convivien/.test(norm(t ?? ''));

const POOL = 80; // casos más recientes por CMF a evaluar

async function main() {
  console.log(`🏅 Ranking de casos por completitud (pool: ${POOL} CMF más recientes)\n`);

  // 1) Pool: CMF más recientes, dedup por caso
  const { data: cmfs } = await sb.from('cmf_informes')
    .select('case_airtable_id, fecha_emision').not('case_airtable_id', 'is', null)
    .not('fecha_emision', 'is', null).order('fecha_emision', { ascending: false }).limit(400);
  const cmfByCase = new Map<string, string>();
  for (const c of cmfs ?? []) if (!cmfByCase.has(c.case_airtable_id)) cmfByCase.set(c.case_airtable_id, c.fecha_emision);
  const caseIds = [...cmfByCase.keys()].slice(0, POOL);

  // 2) Casos → rut (bulk)
  const casos = await sb.from('v_casos_renegociacion').select('airtable_id, rut').in('airtable_id', caseIds);
  const rutByCase = new Map<string, string>();
  for (const c of casos.data ?? []) if (c.rut) rutByCase.set(c.airtable_id, c.rut);
  const ruts = [...rutByCase.values()];
  const rutsNorm = ruts.map(rutNorm);

  // 3) Personas (bulk)
  const personas = await sb.schema('core').from('persona')
    .select('rut, estado_civil, profesion, clave_unica, airtable_main_id, fecha_nacimiento').in('rut', ruts);
  const persByRut = new Map<string, any>();
  for (const p of personas.data ?? []) persByRut.set(p.rut, p);

  // 4) Bronze (bulk) por airtable_main_id
  const amids = [...persByRut.values()].map(p => p.airtable_main_id).filter(Boolean);
  const bronze = await sb.from('bronze_customers_main').select('airtable_id, data').in('airtable_id', amids);
  const bronzeById = new Map<string, any>();
  for (const b of bronze.data ?? []) bronzeById.set(b.airtable_id, b.data ?? {});

  // 5) Certs (bulk) por rut_norm
  const certs = await sb.from('renegociacion_audit_pdf').select('rut_norm').in('rut_norm', rutsNorm).eq('tipo_documento', 'documento_checklist').limit(5000);
  const certCount = new Map<string, number>();
  for (const c of certs.data ?? []) certCount.set(c.rut_norm, (certCount.get(c.rut_norm) ?? 0) + 1);

  // 6) SII jobs done (bulk)
  const sii = await sb.from('mac_mini_jobs').select('airtable_id, command').in('airtable_id', caseIds).in('command', ['sii-carpeta', 'sii-agente-retenedor']).eq('status', 'done');
  const siiByCase = new Map<string, Set<string>>();
  for (const j of sii.data ?? []) { if (!siiByCase.has(j.airtable_id)) siiByCase.set(j.airtable_id, new Set()); siiByCase.get(j.airtable_id)!.add(j.command); }

  // Scoring
  type Row = { airtable_id: string; score: number; certs: number; cmfDias: number | null; cu: boolean; bronze: boolean; ec: boolean; prof: boolean; ct: boolean; ar: boolean; dob: boolean };
  const rows: Row[] = [];
  for (const [aid, rut] of rutByCase) {
    const p = persByRut.get(rut) ?? {};
    const b = p.airtable_main_id ? bronzeById.get(p.airtable_main_id) : null;
    const nCerts = certCount.get(rutNorm(rut)) ?? 0;
    const cmfDias = daysAgo(cmfByCase.get(aid) ?? null);
    const siiSet = siiByCase.get(aid) ?? new Set();
    const r: Row = {
      airtable_id: aid, certs: nCerts, cmfDias,
      cu: !!p.clave_unica, bronze: !!(b && b['Comuna'] && b['Domicilio']),
      ec: ecMappable(p.estado_civil), prof: !!p.profesion, dob: !!p.fecha_nacimiento,
      ct: siiSet.has('sii-carpeta'), ar: siiSet.has('sii-agente-retenedor'), score: 0,
    };
    r.score = (Math.min(r.certs, 5)) + (r.cmfDias !== null && r.cmfDias <= 30 ? 3 : 0) + (r.cu ? 3 : 0)
      + (r.bronze ? 3 : 0) + (r.ec ? 1 : 0) + (r.prof ? 1 : 0) + (r.ct ? 1 : 0) + (r.ar ? 1 : 0);
    if (nCerts >= 1 && r.cu) rows.push(r); // solo candidatos viables (cert + ClaveÚnica)
  }
  rows.sort((a, b) => b.score - a.score || a.airtable_id.localeCompare(b.airtable_id));

  const f = (b: boolean) => b ? '✅' : '🔴';
  console.log(`Candidatos viables (≥1 cert + ClaveÚnica): ${rows.length}. Top 12:\n`);
  console.log('  #  | score | certs | CMF<30d | ClaveÚnica | bronze(dom/com) | estCivil | profesión | CT | AR | fechaNac');
  console.log('  ---|-------|-------|---------|-----------|-----------------|----------|-----------|----|----|--------');
  rows.slice(0, 12).forEach((r, i) => {
    console.log(`  #${String(i + 1).padEnd(2)}|  ${String(r.score).padStart(2)}   |   ${String(r.certs).padStart(2)}  |   ${r.cmfDias !== null && r.cmfDias <= 30 ? '✅' : '🔴'} (${r.cmfDias}d) |    ${f(r.cu)}     |       ${f(r.bronze)}        |    ${f(r.ec)}    |     ${f(r.prof)}    | ${f(r.ct)} | ${f(r.ar)} |   ${f(r.dob)}`);
  });
  console.log('\n(Identidad omitida. Elegí por #; yo resuelvo el RUT internamente sin imprimirlo.)');
}

main().catch(e => { console.error('🚨', e instanceof Error ? e.message : e); process.exit(1); });
