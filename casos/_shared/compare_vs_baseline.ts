/**
 * Arnés de validación de las mejoras del Centinela (NO entra al portal, sin Playwright).
 *
 * Para cada caso de validación: corre `runSentinelCheck` DIRECTO (sin la caché de
 * idempotencia de agent_runs → siempre fresco, refleja el código actual) y normaliza el
 * SentinelResult en una lista plana de "filas" que produciría el Paso 3 (sección 260/261,
 * institución, monto, vencimiento, documento). Vuelca:
 *   - casos/<caso>/_validacion/centinela_out.json   (corrida actual)
 *   - tabla legible en consola + diff contra baseline_pre.json (regresión)
 *
 * Congela el baseline pre-mejoras con --save-baseline.
 *
 * Gasta créditos de la API (corre el Centinela). Usa BYPASS_DATE_CHECK=true (docs viejos;
 * NUNCA en envío real).
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/_shared/compare_vs_baseline.ts
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/_shared/compare_vs_baseline.ts --save-baseline
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/_shared/compare_vs_baseline.ts miguel_lugo
 */
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { runSentinelCheck, SentinelResult } from '../../src/utils/sentinel';
dotenv.config();

const CASES: Array<{ dir: string; rut: string; label: string }> = [
  { dir: 'cristian_mancilla', rut: '16.587.870-1', label: 'Cristian Mancilla' },
  { dir: 'miguel_lugo',       rut: '26.625.555-1', label: 'Miguel Lugo' },
  { dir: 'nector_ruiz',       rut: '15.420.073-8', label: 'Néctor Ruiz' },
];

interface Row {
  seccion: 260 | 261;
  fuente: string;        // de qué array del Centinela salió
  institucion: string;
  monto: number;
  vencimiento?: string;
  documento?: string;
  evidence?: any;        // ExtractionEvidence reportada por Claude (rut_emisor, cita_monto, confidence…)
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}

/** Normaliza el SentinelResult en filas comparables del Paso 3. */
function toRows(r: SentinelResult): Row[] {
  const rows: Row[] = [];
  for (const x of r.reclassifiedCreditors ?? [])
    rows.push({ seccion: 260, fuente: 'reclassified', institucion: x.institucion_cmf, monto: x.total_credito_clp, vencimiento: x.delinquency_start_date, documento: (x as any).document_filename, evidence: x.evidence });
  for (const o of r.cmf260DirectOverrides ?? [])
    rows.push({ seccion: 260, fuente: 'cmf260Override', institucion: o.institucion_cmf, monto: o.monto_clp, vencimiento: o.fecha_vencimiento, documento: o.document_filename, evidence: o.evidence });
  for (const x of r.identified261Creditors ?? [])
    rows.push({ seccion: 261, fuente: 'identified261', institucion: x.institucion_cmf, monto: x.total_credito_clp, documento: (x as any).document_filename, evidence: x.evidence });
  for (const a of r.additionalCreditors ?? [])
    rows.push({ seccion: a.categoria_articulo, fuente: 'additional', institucion: a.institucion_cmf, monto: a.total_credito_clp, vencimiento: a.delinquency_start_date, documento: a.document_filename, evidence: a.evidence });
  for (const x of r.deReclassified261Creditors ?? [])
    rows.push({ seccion: 261, fuente: 'deReclassified', institucion: x.institucion_cmf ?? (x as any).bank, monto: x.total_credito_clp, documento: (x as any).document_filename });
  rows.sort((a, b) => a.seccion - b.seccion || b.monto - a.monto);
  return rows;
}

const clp = (n: number) => '$' + n.toLocaleString('es-CL');

function printRows(label: string, rows: Row[]) {
  console.log(`\n  ── ${label} (${rows.length} filas) ──`);
  for (const sec of [260, 261] as const) {
    const sub = rows.filter((r) => r.seccion === sec);
    if (sub.length === 0) continue;
    console.log(`   Art. ${sec}:`);
    for (const r of sub) {
      const venc = r.vencimiento ? ` venc ${r.vencimiento}` : '';
      const doc = r.documento ? ` [${r.documento}]` : '';
      console.log(`     • ${r.institucion}  ${clp(r.monto)}${venc}  (${r.fuente})${doc}`);
      const ev = r.evidence;
      if (ev) {
        const conf = typeof ev.confidence === 'number' ? ` conf=${ev.confidence}` : '';
        const rut = ev.rut_emisor ? ` rut=${ev.rut_emisor}` : '';
        const op = ev.numero_operacion ? ` op=${ev.numero_operacion}` : '';
        const mon = ev.moneda ? ` ${ev.moneda}` : '';
        console.log(`         evidence:${rut}${op}${mon}${conf}${ev.cita_monto ? `  cita="${ev.cita_monto}"` : '  (sin cita_monto)'}`);
      } else {
        console.log(`         evidence: (Claude no devolvió evidence)`);
      }
    }
  }
}

/** Diff grueso por (seccion, institución canónica simple, monto ±tol). */
function diffRows(baseline: Row[], current: Row[]) {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(50000, a * 0.05);
  const key = (r: Row) => `${r.seccion}|${r.institucion.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12)}`;
  const matched = new Set<number>();
  const perdidas: Row[] = [];
  for (const b of baseline) {
    const i = current.findIndex((c, idx) => !matched.has(idx) && key(c) === key(b) && near(c.monto, b.monto));
    if (i >= 0) matched.add(i);
    else perdidas.push(b);
  }
  const nuevas = current.filter((_, idx) => !matched.has(idx));
  return { perdidas, nuevas };
}

async function main() {
  const args = process.argv.slice(2);
  const saveBaseline = args.includes('--save-baseline');
  const only = args.find((a) => !a.startsWith('--'));

  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const logger = { log: (m: string) => console.log(m), error: (m: string, e?: unknown) => console.error(m, e ?? '') };

  const cases = only ? CASES.filter((c) => c.dir === only) : CASES;
  if (cases.length === 0) throw new Error(`Caso desconocido: ${only}`);

  for (const c of cases) {
    console.log(`\n${'═'.repeat(70)}\n🧪 ${c.label} (${c.rut})\n${'═'.repeat(70)}`);
    const { data: client } = await supabase.from('clients').select('*').eq('rut', c.rut).maybeSingle();
    if (!client) { console.log(`  ⚠️ Cliente no encontrado — correr setup_test.ts`); continue; }
    if (!client.informe_cmf_path) { console.log(`  ⚠️ Sin informe_cmf_path`); continue; }

    let result: SentinelResult;
    try {
      result = await runSentinelCheck(client, supabase, logger);
    } catch (err) {
      console.error(`  🚨 Centinela falló: ${(err as Error).message}`);
      continue;
    }

    const rows = toRows(result);
    const outDir = path.resolve(__dirname, '..', c.dir, '_validacion');
    fs.mkdirSync(outDir, { recursive: true });
    const dump = { rut: c.rut, success: result.success, errors: result.errors, details: result.details, rows, claudeReadIssues: result.claudeReadIssues ?? [] };
    fs.writeFileSync(path.join(outDir, 'centinela_out.json'), JSON.stringify(dump, null, 2));

    printRows('CORRIDA ACTUAL', rows);
    console.log(`   details: 90d=${result.details?.meets90DaysRequirement} monto=${result.details?.meetsAmountRequirement} total=${clp(result.details?.totalAmountCLP ?? 0)} con90d=${result.details?.creditorsWith90DaysCount}`);
    if ((result.errors ?? []).length) console.log(`   errores: ${JSON.stringify(result.errors)}`);

    // Validación anti-error: errores que Claude cometió leyendo los PDFs (lo que vamos a aprender).
    const issues = result.claudeReadIssues ?? [];
    console.log(`\n  ── VALIDACIÓN ANTI-ERROR (lectura de Claude) — ${issues.length} señal(es) ──`);
    if (issues.length === 0) console.log('   ✅ Sin discrepancias detectadas.');
    for (const i of issues) console.log(`   ⚠️ [${i.tipo}] ${i.institucion} ${clp(i.monto_clp)} — ${i.detalle}`);

    const baselinePath = path.join(outDir, 'baseline_pre.json');
    if (saveBaseline) {
      fs.writeFileSync(baselinePath, JSON.stringify(dump, null, 2));
      console.log(`   📌 baseline_pre.json congelado.`);
    } else if (fs.existsSync(baselinePath)) {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).rows as Row[];
      const { perdidas, nuevas } = diffRows(baseline, rows);
      console.log(`\n  ── DIFF vs baseline ──`);
      if (perdidas.length === 0 && nuevas.length === 0) console.log('   ✅ Sin cambios.');
      perdidas.forEach((r) => console.log(`   🔴 PERDIDA (regresión): Art.${r.seccion} ${r.institucion} ${clp(r.monto)}`));
      nuevas.forEach((r) => console.log(`   🟢 NUEVA: Art.${r.seccion} ${r.institucion} ${clp(r.monto)} (${r.fuente})`));
    } else {
      console.log(`   (sin baseline — correr con --save-baseline para congelar)`);
    }
  }
  console.log('\n✅ Listo.\n');
}

main().catch((err) => { console.error('\n🚨', (err as Error).message, err); process.exit(1); });
