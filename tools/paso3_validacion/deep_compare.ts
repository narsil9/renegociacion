/**
 * COMPARACIÓN ENRIQUECIDA — declarado (capa determinista real) vs esperado (lectura), por fila.
 *
 * El harness `test_renegociacion_docs.ts` solo compara CONTEO por institución + total. Este script
 * corre la MISMA capa (assembleRawFromDocFacts → applyDeterministicBackstops) pero matchea fila-a-fila
 * (institución + monto) y reporta:
 *   - ART   : esperado 260/261 vs declarado (¿degradó o promovió?)
 *   - MONTO : declarado ≠ esperado (>1% y >$100k) → TS eligió otro número (CMF total vs payoff, etc.)
 *   - FUENTE: esperado cmf=true/false vs declarado CMF/NO-CMF (additional mal clasificado)
 *   - HUÉRFANAS: filas declaradas sin par esperado, o esperadas sin declarar.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/deep_compare.ts [caso]
 */
import * as fs from 'fs';
import * as path from 'path';
import { assembleRawFromDocFacts, DocFacts } from '../../src/utils/sentinel_per_doc';
import { applyDeterministicBackstops } from '../../src/utils/sentinel_backstops';
import { canonicalInstitutionKey } from '../../src/utils/acreedor_matcher';

const TODAY = '2026-06-29';
const UF = 40661;
const FIXTURE_DIR = path.join(__dirname, 'reneg_fixtures');

const logger = { log: () => {}, error: (_m: string) => {} };
const log = (_m: string) => {};

function tipoToEnum(t: string): 'credito_consumo' | 'tarjeta_credito' | 'otro' {
  const s = (t || '').toLowerCase();
  if (/tarjeta|visa|master|cmr|cat\b|car\b/.test(s)) return 'tarjeta_credito';
  if (/consumo|cuota/.test(s)) return 'credito_consumo';
  return 'otro';
}
function toDocFacts(d: any): DocFacts {
  return {
    filename: d.filename, institucion_asignada: d.institucion_asignada ?? null,
    doc_type: (d.doc_type as any) ?? 'otro', emisor_nombre: d.emisor_nombre, rut_emisor: d.rut_emisor,
    totales_por_moneda: d.totales_por_moneda as any,
    productos: (d.productos ?? []).map((p: any) => ({
      operacion: p.operacion, monto: Number(p.monto) || 0, etiqueta_monto: p.etiqueta_monto ?? '',
      moneda: p.moneda === 'UF' ? 'UF' : 'CLP', fecha_mora: p.fecha_mora ?? undefined,
      cita_monto: p.cita_monto ?? `${p.etiqueta_monto ?? ''}: ${p.monto}`, cita_fecha: p.cita_fecha,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.9,
    })),
  };
}
interface DRow { key: string; monto: number; art: number; cmf: boolean; src: string; }
function declaredSet(raw: any): DRow[] {
  const near5 = (a: number, b: number) => b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.05;
  const degraded = (raw.deReclassified261Creditors ?? []).map((d: any) => ({ key: canonicalInstitutionKey(d.institucion_cmf), monto: d.total_credito_clp }));
  const out: DRow[] = [];
  for (const o of raw.cmf260DirectOverrides ?? []) {
    const key = canonicalInstitutionKey(o.institucion_cmf);
    if (degraded.some((d: any) => d.key === key && near5(d.monto, o.monto_clp))) continue;
    out.push({ key, monto: o.monto_clp, art: 260, cmf: true, src: '260ovr' });
  }
  for (const r of raw.reclassifiedCreditors ?? []) out.push({ key: canonicalInstitutionKey(r.institucion_cmf), monto: r.total_credito_clp, art: 260, cmf: true, src: 'reclass' });
  for (const r of raw.identified261Creditors ?? []) out.push({ key: canonicalInstitutionKey(r.institucion_cmf), monto: r.total_credito_clp, art: 261, cmf: true, src: 'id261' });
  for (const a of raw.additionalCreditors ?? []) out.push({ key: canonicalInstitutionKey(a.institucion_cmf), monto: a.total_credito_clp, art: a.categoria_articulo, cmf: false, src: `NOCMF${a.categoria_articulo}` });
  return out;
}
const money = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

interface CaseStat { case: string; countOk: boolean; artMism: number; montoMism: number; srcMism: number; orphanD: number; orphanE: number; issues: number; material: number; }

async function runCase(rep: any): Promise<{ stat: CaseStat; detail: string }> {
  const L: string[] = [];
  const cmfHuman = rep.cmf_rows.map((c: any) => ({ institucion: c.institucion, tipoCredito: c.tipoCredito, totalCredito: c.totalCredito, overdue90Days: c.overdue90Days }));
  const q90 = cmfHuman.filter((c: any) => c.overdue90Days > 0);
  const cmfFixture = { ufValueCLP: UF, meets90DaysRequirement: q90.length >= 2, meetsAmountRequirement: true, totalCreditoOf90PlusCreditors: q90.reduce((s: number, c: any) => s + c.totalCredito, 0), qualifying90PlusCount: q90.length, creditors: cmfHuman };
  const facts = (rep.doc_facts ?? []).map(toDocFacts);
  const raw = assembleRawFromDocFacts(facts, cmfFixture, [], rep.rut ?? null, TODAY, logger);
  const cmfEnum = rep.cmf_rows.map((c: any) => ({ institucion: c.institucion, tipoCredito: tipoToEnum(c.tipoCredito), totalCredito: c.totalCredito, overdue90Days: c.overdue90Days })) as any;
  const documents = (rep.doc_facts ?? []).map((d: any) => ({ filename: d.filename, institucion_cmf: d.institucion_asignada ?? null, textContent: '', isImageDoc: false })) as any;
  const { result, claudeReadIssues } = await applyDeterministicBackstops(raw, { cmfCreditors: cmfEnum, documents, certificateAnalyses: [], catalog: [], clientRut: rep.rut ?? null, todayDate: new Date(TODAY + 'T12:00:00') }, log);

  const declared = declaredSet(result);
  const expected = (rep.expected_declaration ?? []).map((e: any) => ({ key: canonicalInstitutionKey(String(e.institucion).split(' / ')[0]), monto: Number(e.monto) || 0, art: e.art, cmf: e.cmf !== false, doc: e.doc }));

  // match greedy por institución + monto más cercano
  const dUsed = new Array(declared.length).fill(false);
  let artMism = 0, montoMism = 0, srcMism = 0, orphanE = 0;
  L.push(`\n══════════ ${rep.case}  (esperado ${expected.length}, declarado ${declared.length}) ══════════`);
  for (const e of expected) {
    let best = -1, bestDelta = Infinity;
    for (let i = 0; i < declared.length; i++) {
      if (dUsed[i] || declared[i].key !== e.key) continue;
      const delta = Math.abs(declared[i].monto - e.monto);
      if (delta < bestDelta) { bestDelta = delta; best = i; }
    }
    if (best < 0) { orphanE++; L.push(`   ❌ ESPERADA sin declarar: ${e.key.padEnd(30)} ${money(e.monto)} art${e.art} ${e.doc ?? ''}`); continue; }
    dUsed[best] = true;
    const d = declared[best];
    const flags: string[] = [];
    const mDelta = Math.abs(d.monto - e.monto);
    const mPct = e.monto > 0 ? mDelta / Math.max(d.monto, e.monto) : 0;
    if (d.art !== e.art) { artMism++; flags.push(`ART esperado ${e.art}→declarado ${d.art}`); }
    if (mDelta > 100000 && mPct > 0.01) { montoMism++; flags.push(`MONTO esperado ${money(e.monto)}→declarado ${money(d.monto)} (Δ${money(mDelta)})`); }
    if (d.cmf !== e.cmf) { srcMism++; flags.push(`FUENTE esperado ${e.cmf ? 'CMF' : 'NO-CMF'}→declarado ${d.cmf ? 'CMF' : 'NO-CMF'} [${d.src}]`); }
    if (flags.length) L.push(`   ⚠️  ${e.key.padEnd(28)} ${flags.join('  |  ')}`);
  }
  const orphanD = dUsed.filter((u) => !u).length;
  for (let i = 0; i < declared.length; i++) if (!dUsed[i]) L.push(`   ➕ DECLARADA de más: ${declared[i].key.padEnd(30)} ${money(declared[i].monto)} art${declared[i].art} [${declared[i].src}]`);

  const countOk = declared.length === expected.length;
  // MATERIAL = cambia la declaración del portal (art 260/261, monto, acreedor de más/menos).
  // NO-MATERIAL = fuente CMF vs NO-CMF con MISMO art+monto: es routing interno (ambos caen en la
  // misma sección del portal; el overflow multiproducto→NO-CMF es por diseño para crear la fila extra).
  const material = artMism + montoMism + orphanD + orphanE;
  const issues = material + srcMism;
  if (issues === 0 && countOk) L.push(`   ✅ EXACTO (art + monto + fuente + conteo)`);
  else if (material === 0) L.push(`   ✅ PORTAL-OK (material 0) · no-material: fuente:${srcMism}`);
  else L.push(`   ⚠️ MATERIAL → art:${artMism} monto:${montoMism} huérfanas D:${orphanD}/E:${orphanE}  ·  no-material fuente:${srcMism}${claudeReadIssues.length ? `  🔎 señales:${claudeReadIssues.length}` : ''}`);
  return { stat: { case: rep.case, countOk, artMism, montoMism, srcMism, orphanD, orphanE, issues, material }, detail: L.join('\n') };
}

async function main() {
  const only = process.argv[2];
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && (!only || f.includes(only))).sort();
  const stats: CaseStat[] = [];
  for (const f of files) {
    let rep: any;
    try { rep = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')); } catch (e: any) { console.error(`❌ ${f}: JSON inválido — ${e.message}`); continue; }
    try { const r = await runCase(rep); console.log(r.detail); stats.push(r.stat); }
    catch (e: any) { console.error(`❌ ${rep.case}: ${e.message}\n${e.stack}`); }
  }
  console.log(`\n${'═'.repeat(72)}\nRESUMEN — comparación fila-a-fila (MATERIAL = portal; fuente = no-material)\n${'═'.repeat(72)}`);
  let exact = 0, portalOk = 0;
  for (const s of stats) {
    const ex = s.issues === 0 && s.countOk;
    const pok = s.material === 0;
    if (ex) exact++;
    if (pok) portalOk++;
    const tag = ex ? '✅ EXACTO ' : pok ? '🟢 PORTAL ' : '⚠️ MATERIAL';
    console.log(`  ${tag} ${s.case.padEnd(24)} material:${s.material} (art:${s.artMism} monto:${s.montoMism} huérf:${s.orphanD + s.orphanE}) · fuente:${s.srcMism}`);
  }
  const tot = stats.reduce((a, s) => ({ art: a.art + s.artMism, monto: a.monto + s.montoMism, src: a.src + s.srcMism, orph: a.orph + s.orphanD + s.orphanE, mat: a.mat + s.material }), { art: 0, monto: 0, src: 0, orph: 0, mat: 0 });
  console.log(`\n${portalOk}/${stats.length} casos PORTAL-OK (0 discrepancias materiales). ${exact}/${stats.length} exactos (incl. fuente).`);
  console.log(`Materiales → ART:${tot.art}  MONTO:${tot.monto}  HUÉRFANAS:${tot.orph}  (TOTAL material ${tot.mat}).  No-material FUENTE(cmf/nocmf):${tot.src}.`);
}
main();
