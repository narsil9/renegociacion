/**
 * Harness FASE 1 — Paso 5 determinista sobre la carpeta REAL ~/Desktop/renegociacion_docs.
 *
 * Corre `computeIncomes` sobre los HECHOS extraídos (actuando como el LLM, ver
 * fixtures_renegociacion_docs.ts) de los 11 clientes con documentos de ingreso y compara
 * contra el esperado del analista. Mismo motor que run_deterministic.ts; casos NUEVOS.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/paso5_pruebas/run_renegociacion_docs.ts
 * NO toca portal/Supabase/API. No es producción (vive en casos/).
 */
import { computeIncomes } from '../../src/utils/income_extractor';
import { Step5Fixture } from './fixtures';
import { FIXTURES_REAL } from './fixtures_renegociacion_docs';

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' };
const ok = (s: string) => `${C.green}✓${C.reset} ${s}`;
const bad = (s: string) => `${C.red}✗${C.reset} ${s}`;
const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;

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
  if (comp.claudeReadIssues.length > 0) {
    failures.push(`claudeReadIssues inesperados: ${comp.claudeReadIssues.map((i) => `${i.tipo}@${i.period_label}`).join(', ')}`);
  }

  if (allAlerts.length) {
    console.log(`  ${C.dim}Alertas (${allAlerts.length}):${C.reset}`);
    allAlerts.forEach((a) => console.log(`    ${C.dim}- ${a}${C.reset}`));
  }

  const passed = failures.length === 0;
  console.log(passed ? ok('PASS') : bad('FAIL'));
  failures.forEach((f) => console.log(`      ${bad(f)}`));
  return { name: fx.name, passed, failures };
}

function main() {
  console.log(`${C.bold}=== Paso 5 — Harness determinista carpeta REAL renegociacion_docs (Fase 1, sin API) ===${C.reset}`);
  const results = FIXTURES_REAL.map(runCase);
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${C.bold}━━━ RESUMEN ━━━${C.reset}`);
  results.forEach((r) => console.log(`  ${r.passed ? ok(r.name) : bad(r.name)}`));
  console.log(`\n  ${passed}/${results.length} casos OK`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
