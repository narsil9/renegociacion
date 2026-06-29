/**
 * Harness FASE 2 — Paso 5 con lectura NATIVA por Claude (gasta créditos de API).
 *
 * Para cada caso: lee los documentos REALES con `extractIncomeFactsNative` (una llamada por
 * documento, regla #1 del handoff Paso 3), corre la misma capa determinista `computeIncomes`,
 * y compara el resultado contra el esperado del analista (fixtures.ts). Así verifica que la
 * lectura real de Claude reproduce los montos que validamos en la Fase 1 (hardcodeada).
 *
 * Uso:
 *   # un solo caso (recomendado para controlar el gasto):
 *   npx ts-node --transpile-only -r dotenv/config casos/paso5_pruebas/run_native.ts "Jorge Romero"
 *   # todos los casos:
 *   npx ts-node --transpile-only -r dotenv/config casos/paso5_pruebas/run_native.ts
 *
 * Requiere ANTHROPIC_API_KEY en .env. NO toca el portal ni Supabase.
 * Vuelca los hechos extraídos a un JSON en el tmpdir para diff posterior vs fixtures.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeIncomes } from '../../src/utils/income_extractor';
import { extractIncomeFactsNative, IncomeDocInput } from '../../src/agents/ingresos_agent';
import { FIXTURES, Step5Fixture } from './fixtures';
import { CASE_DOCS } from './case_files';

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' };
const ok = (s: string) => `${C.green}✓${C.reset} ${s}`;
const bad = (s: string) => `${C.red}✗${C.reset} ${s}`;
const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;

async function runCase(fx: Step5Fixture): Promise<{ name: string; passed: boolean; failures: string[] }> {
  const failures: string[] = [];
  console.log(`\n${C.bold}━━━ ${fx.name} (${fx.rut}) ━━━${C.reset}`);

  const all = CASE_DOCS[fx.name] ?? [];
  const docs: IncomeDocInput[] = all.filter((d) => {
    const exists = fs.existsSync(d.localPath);
    if (!exists) console.log(`  ${C.yellow}⚠ falta archivo: ${d.localPath}${C.reset}`);
    return exists;
  });
  if (docs.length === 0) { failures.push('sin documentos legibles'); return { name: fx.name, passed: false, failures }; }

  // --- Lectura NATIVA por Claude (una llamada por documento) ---
  console.log(`  ${C.dim}Leyendo ${docs.length} documento(s) con Claude...${C.reset}`);
  const { extracted, cotizaciones } = await extractIncomeFactsNative(docs, {
    log: (m) => console.log(`    ${C.dim}${m}${C.reset}`),
    error: (m, e) => console.log(`    ${C.red}${m} ${e ?? ''}${C.reset}`),
  });

  // --- Hechos extraídos (para eyeball vs fixtures.ts) ---
  console.log('  Hechos extraídos por Claude:');
  for (const d of extracted) {
    const liqs = (d.periods ?? []).map((p) =>
      `${p.period_label}=${p.liquido_a_pagar ?? p.monto_bruto ?? '?'}${p.moneda === 'UF' ? 'UF' : ''}`).join(', ');
    console.log(`    • ${d.category} [fuente ${d.source_key ?? '—'}] ${liqs || `mensual ${d.monto_mensual_declarado ?? '?'}`}`);
  }
  console.log(`    cot: ${cotizaciones ? `${cotizaciones.fecha_emision} rut ${cotizaciones.rut_entidad_pagadora}` : '—'}`);

  // --- Capa determinista (idéntica a producción) ---
  const comp = computeIncomes(extracted, cotizaciones);
  console.log('  Ingresos declarables:');
  comp.incomes.forEach((inc) =>
    console.log(`    • [${inc.tipoIngreso}] ${inc.tipoIngresoLabel}: ${C.bold}${clp(inc.monto)}${C.reset} ${C.dim}${inc.detalle}${C.reset}`));

  // --- Comparación contra el esperado del analista ---
  const used = new Set<number>();
  for (const exp of fx.expectedIncomes) {
    const idx = comp.incomes.findIndex((inc, i) =>
      !used.has(i) && inc.tipoIngreso === exp.tipoIngreso && inc.monto >= exp.montoMin && inc.monto <= exp.montoMax);
    if (idx === -1) {
      const got = comp.incomes.filter((i) => i.tipoIngreso === exp.tipoIngreso).map((i) => clp(i.monto)).join(', ') || '—';
      failures.push(`esperaba ${exp.label} [${exp.tipoIngreso}] en ${clp(exp.montoMin)}–${clp(exp.montoMax)}; obtuvo ${got}`);
    } else used.add(idx);
  }
  if (comp.incomes.length !== fx.expectedIncomes.length)
    failures.push(`nº de ingresos: esperaba ${fx.expectedIncomes.length}, obtuvo ${comp.incomes.length}`);

  const allAlerts = [...comp.alerts, ...comp.incomes.flatMap((i) => i.alerts)];
  if (allAlerts.length) {
    console.log(`  ${C.dim}Alertas (${allAlerts.length}):${C.reset}`);
    allAlerts.forEach((a) => console.log(`    ${C.dim}- ${a}${C.reset}`));
  }

  // --- Volcar a JSON para diff posterior ---
  const outDir = path.join(os.tmpdir(), 'paso5_native');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${fx.name.replace(/\s+/g, '_')}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ extracted, cotizaciones, incomes: comp.incomes, alerts: allAlerts }, null, 2));
  console.log(`  ${C.dim}→ hechos volcados a ${outPath}${C.reset}`);

  const passed = failures.length === 0;
  console.log(passed ? ok('PASS') : bad('FAIL'));
  failures.forEach((f2) => console.log(`      ${bad(f2)}`));
  return { name: fx.name, passed, failures };
}

async function main() {
  const filter = process.argv[2];
  const cases = filter ? FIXTURES.filter((fx) => fx.name.toLowerCase().includes(filter.toLowerCase())) : FIXTURES;
  if (cases.length === 0) { console.error(`No hay caso que matchee "${filter}". Casos: ${FIXTURES.map((f) => f.name).join(', ')}`); process.exit(2); }

  console.log(`${C.bold}=== Paso 5 — Harness lectura nativa (Fase 2, con API) ===${C.reset}`);
  console.log(`${C.dim}Casos: ${cases.map((c) => c.name).join(', ')}${C.reset}`);
  const results = [];
  for (const fx of cases) {
    try { results.push(await runCase(fx)); }
    catch (e) { console.log(bad(`${fx.name}: ${e instanceof Error ? e.message : e}`)); results.push({ name: fx.name, passed: false, failures: [String(e)] }); }
  }
  console.log(`\n${C.bold}━━━ RESUMEN ━━━${C.reset}`);
  results.forEach((r) => console.log(`  ${r.passed ? ok(r.name) : bad(r.name)}`));
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n  ${passed}/${results.length} casos OK`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
