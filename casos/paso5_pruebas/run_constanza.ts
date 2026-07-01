/**
 * Harness Paso 5 — lote Constanza Mulchi (30 casos, 2026-06-30).
 *
 * Claude actuó como el LLM lector nativo de los documentos de Ingresos de cada caso y volcó, por caso,
 * un JSON `{ name, rut, docs[], cotizaciones, expectedIncomes[], expectAlertSubstrings[], notes }` en
 * fixtures_constanza/. Este runner corre `computeIncomes` (capa determinista de producción, sin API) y
 * compara contra el esperado del lector.
 *
 * ⚠️ Sin verdad-terreno del abogado → consistencia interna. Lo válido: bugs de TS (promedio, multi-fuente,
 * descuentos, subsidio, dedup) + reglas de lectura ancladas al documento. INFORMATIVO.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' \
 *        npx --no-install ts-node --transpile-only casos/paso5_pruebas/run_constanza.ts [caso]
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeIncomes } from '../../src/utils/income_extractor';
import { Step5Fixture } from './fixtures';

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' };
const ok = (s: string) => `${C.green}✓${C.reset} ${s}`;
const bad = (s: string) => `${C.red}✗${C.reset} ${s}`;
const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;

const FIXTURE_DIR = path.join(__dirname, 'fixtures_constanza');

interface CaseResult { name: string; passed: boolean; failures: string[] }

function runCase(fx: Step5Fixture): CaseResult {
  const failures: string[] = [];
  const comp = computeIncomes(fx.docs, fx.cotizaciones);

  console.log(`\n${C.bold}━━━ ${fx.name} (${fx.rut}) ━━━${C.reset}`);
  if (fx.notes) console.log(`${C.dim}${fx.notes}${C.reset}`);

  console.log('  Ingresos calculados:');
  for (const inc of comp.incomes) {
    console.log(`    • [${inc.tipoIngreso}] ${inc.tipoIngresoLabel}: ${C.bold}${clp(inc.monto)}${C.reset} ${C.dim}${inc.detalle}${C.reset}`);
  }
  if (comp.incomes.length === 0) console.log(`    ${C.yellow}(ninguno)${C.reset}`);

  const used = new Set<number>();
  for (const exp of fx.expectedIncomes) {
    const idx = comp.incomes.findIndex((inc, i) =>
      !used.has(i) && inc.tipoIngreso === exp.tipoIngreso && inc.monto >= exp.montoMin && inc.monto <= exp.montoMax);
    if (idx === -1) {
      const got = comp.incomes.filter((inc) => inc.tipoIngreso === exp.tipoIngreso).map((inc) => clp(inc.monto)).join(', ') || '—';
      failures.push(`esperaba ${exp.label} [${exp.tipoIngreso}] en ${clp(exp.montoMin)}–${clp(exp.montoMax)}; obtuvo: ${got}`);
    } else {
      used.add(idx);
    }
  }
  if (comp.incomes.length !== fx.expectedIncomes.length) {
    failures.push(`nº de ingresos: esperaba ${fx.expectedIncomes.length}, obtuvo ${comp.incomes.length}`);
  }

  const allAlerts = [...comp.alerts, ...comp.incomes.flatMap((i) => i.alerts)];
  for (const sub of fx.expectAlertSubstrings ?? []) {
    if (!allAlerts.some((a) => a.toLowerCase().includes(sub.toLowerCase()))) {
      failures.push(`faltó alerta que contenga "${sub}"`);
    }
  }

  if (allAlerts.length) {
    console.log(`  ${C.dim}Alertas (${allAlerts.length}):${C.reset}`);
    allAlerts.forEach((a) => console.log(`    ${C.dim}- ${a}${C.reset}`));
  }
  if (comp.claudeReadIssues.length) {
    console.log(`  ${C.yellow}claudeReadIssues (${comp.claudeReadIssues.length}):${C.reset}`);
    comp.claudeReadIssues.forEach((i) => console.log(`    ${C.dim}- ${i.tipo}@${i.period_label}: ${i.detalle}${C.reset}`));
  }

  const passed = failures.length === 0;
  console.log(passed ? ok('PASS') : bad('FAIL'));
  failures.forEach((f) => console.log(`      ${bad(f)}`));
  return { name: fx.name, passed, failures };
}

function main() {
  const only = process.argv[2];
  console.log(`${C.bold}=== Paso 5 — Harness Constanza Mulchi (Fase 1, sin API) ===${C.reset}`);
  if (!fs.existsSync(FIXTURE_DIR)) { console.error(`No existe: ${FIXTURE_DIR}`); process.exit(0); }
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && (!only || f.includes(only))).sort();
  if (files.length === 0) { console.error(`Sin fixtures .json en ${FIXTURE_DIR}`); process.exit(0); }

  const results: CaseResult[] = [];
  for (const f of files) {
    let fx: Step5Fixture;
    try { fx = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')); }
    catch (e: any) { console.error(`❌ ${f}: JSON inválido — ${e.message}`); results.push({ name: f, passed: false, failures: ['JSON inválido'] }); continue; }
    try { results.push(runCase(fx)); }
    catch (e: any) { console.error(`❌ ${fx.name}: error — ${e.message}`); results.push({ name: fx.name, passed: false, failures: [e.message] }); }
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${C.bold}━━━ RESUMEN ━━━${C.reset}`);
  results.forEach((r) => console.log(`  ${r.passed ? ok(r.name) : bad(r.name)}`));
  console.log(`\n  ${passed}/${results.length} casos OK (consistencia interna; sin verdad-terreno del abogado).`);
}

main();
