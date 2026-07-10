/**
 * Harness FASE 1 — Paso 5 determinista (sin API).
 *
 * Corre `computeIncomes` (la capa determinista de income_extractor.ts) sobre los HECHOS
 * hardcodeados de cada caso (fixtures.ts) y compara la salida contra el esperado del
 * analista. Verifica que la ESTRUCTURA (líquido, promedio, Fix1, multi-fuente, descuentos,
 * subsidio) se calcule bien ANTES de gastar créditos en la lectura nativa (Fase 2).
 *
 * Uso:  npx ts-node --transpile-only casos/paso5_pruebas/run_deterministic.ts
 * NO toca el portal, Supabase ni la API de Anthropic. No es producción (vive en casos/).
 */
import { computeIncomes } from '../../src/utils/income_extractor';
import { FIXTURES, Step5Fixture, ExpectedIncome } from './fixtures';

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

  // Ingresos calculados
  console.log('  Ingresos calculados:');
  for (const inc of comp.incomes) {
    console.log(`    • [${inc.tipoIngreso}] ${inc.tipoIngresoLabel}: ${C.bold}${clp(inc.monto)}${C.reset} ` +
      `(periodicidad ${inc.periodicidad}) ${C.dim}${inc.detalle}${C.reset}`);
  }
  if (comp.incomes.length === 0) console.log(`    ${C.yellow}(ninguno)${C.reset}`);

  // Match de esperados (por tipo + rango de monto; cada esperado consume un ingreso)
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
  // Nº de ingresos coincide con nº de esperados (detecta fusiones/splits indebidos)
  if (comp.incomes.length !== fx.expectedIncomes.length) {
    failures.push(`nº de ingresos: esperaba ${fx.expectedIncomes.length}, obtuvo ${comp.incomes.length}`);
  }

  // El consumidor real (ingresos_agent) fusiona las alertas globales con las de cada
  // ingreso → el harness chequea la UNIÓN.
  const allAlerts = [...comp.alerts, ...comp.incomes.flatMap((i) => i.alerts)];

  // Alertas esperadas (subcadenas)
  for (const sub of fx.expectAlertSubstrings ?? []) {
    if (!allAlerts.some((a) => a.toLowerCase().includes(sub.toLowerCase()))) {
      failures.push(`faltó alerta que contenga "${sub}"`);
    }
  }

  // claudeReadIssues: con citas auto-consistentes NO debería haber ninguno
  if (comp.claudeReadIssues.length > 0) {
    failures.push(`claudeReadIssues inesperados: ${comp.claudeReadIssues.map((i) => i.tipo).join(', ')}`);
  }

  // Alertas (informativo)
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
  console.log(`${C.bold}=== Paso 5 — Harness determinista (Fase 1, sin API) ===${C.reset}`);
  const results = FIXTURES.map(runCase);
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${C.bold}━━━ RESUMEN ━━━${C.reset}`);
  results.forEach((r) => console.log(`  ${r.passed ? ok(r.name) : bad(r.name)}`));
  console.log(`\n  ${passed}/${results.length} casos OK`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
