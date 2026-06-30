/**
 * RUNNER de la batería DETERMINISTA del Paso 3 (sin API, sin Supabase, sin Playwright).
 *
 * Corre todos los tests deterministas en orden y sale con exit code ≠ 0 si CUALQUIERA falla.
 * Es el "botón verde" a correr en cada cambio del flujo determinista y antes de cualquier commit.
 *
 * NO incluye los tests con API (validación EN VIVO del LLM, requieren cuota Anthropic):
 *   - scorecard.ts            (corre el Centinela N veces; mide estabilidad 10/13/12)
 *   - test_e2e_read_issues.ts (propagación de claudeReadIssues end-to-end)
 *   - debug_perdoc.ts         (debug del camino por-documento)
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/run_all.ts
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

const DIR = __dirname;
const TESTS = [
  'test_reglas_deterministas.ts', // invariantes + utilidades puras (CMF, matcher, moneda, op, etc.)
  'test_assembler.ts',            // ensamblador → 3 casos reales (Cristian 10, Miguel 13, Néctor 12)
  'test_assembler_edge.ts',       // ramas del ensamblador (multiproducto, UF, NO-CMF, overflow, gate…)
  'test_backstops_golden.ts',     // golden de applyDeterministicBackstops (refactor Parte A)
  'test_oracle_injection.ts',     // oráculo → agrupación/dedup = declaración de la abogada
  'test_renegociacion_docs.ts',   // 13 casos reales de renegociacion_docs/ (fixtures congelados); guard de regresión
];

const results: { test: string; passed: boolean }[] = [];
for (const t of TESTS) {
  console.log(`\n${'█'.repeat(60)}\n▶ ${t}\n${'█'.repeat(60)}`);
  try {
    execFileSync('npx', ['ts-node', '--transpile-only', path.join(DIR, t)], { stdio: 'inherit' });
    results.push({ test: t, passed: true });
  } catch {
    results.push({ test: t, passed: false });
  }
}

console.log(`\n${'═'.repeat(60)}\nRESUMEN — batería determinista del Paso 3\n${'═'.repeat(60)}`);
for (const r of results) console.log(`  ${r.passed ? '✅' : '❌'} ${r.test}`);
const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} suites OK${failed ? `, ${failed} con fallos` : ''}.`);
if (failed > 0) { console.error('\n❌ Batería determinista CON FALLOS — revisar arriba.'); process.exit(1); }
console.log('\n✅ Batería determinista COMPLETA y verde. (Validación en vivo del LLM: scorecard.ts, requiere cuota API.)');
