/**
 * FASE 2 — Comparación LLM real vs verdad-terreno del abogado (casos_comparacion_abogada-paso5).
 *
 * Lee los PDFs REALES con Claude nativo (`extractIncomeFactsNative`, la MISMA función de producción,
 * una llamada por documento) → corre la capa determinista `computeIncomes` → compara lo que DECIDE el
 * robot con lo que declaró la abogada en el portal (screenshots). GASTA créditos de API.
 *
 * Uso (con deps del hub + key del hub):
 *   ln -s ~/Desktop/renegociacion/node_modules node_modules   # temporal
 *   DOTENV_CONFIG_PATH=~/Desktop/renegociacion/.env \
 *   npx --no-install ts-node --transpile-only -r dotenv/config casos/paso5_pruebas/run_native_comparacion.ts [alfonso|yasmin]
 */
import * as fs from 'fs';
import * as os from 'os';
import { computeIncomes } from '../../src/utils/income_extractor';
import { extractIncomeFactsNative, IncomeDocInput } from '../../src/agents/ingresos_agent';

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m' };
const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;

const BASE = `${os.homedir()}/Desktop/casos_comparacion_abogada-paso5`;

interface Caso {
  key: string;
  name: string;
  rut: string;
  docs: IncomeDocInput[];
  abogada: string; // resumen de lo que declaró
  gtMonto: number; // promedio mensual declarado
}

const CASOS: Caso[] = [
  {
    key: 'alfonso',
    name: 'Alfonso Martinez Herrera',
    rut: '16554875-2',
    docs: [
      { filename: '3_liquidaciones_sueldo.pdf', localPath: `${BASE}/01 - Alfonso Martinez Herrera - 16554875-2/Documentos_Abogada/3_liquidaciones_sueldo.pdf` },
      { filename: 'cotizaciones_ultimos_12_meses.pdf', localPath: `${BASE}/01 - Alfonso Martinez Herrera - 16554875-2/Documentos_Abogada/cotizaciones_ultimos_12_meses.pdf` },
    ],
    abogada: 'Remuneración $2.033.410 Mensual (promedio de 3 liquidaciones, líquido).',
    gtMonto: 2033410,
  },
  {
    key: 'yasmin',
    name: 'Yasmin Margaret Silva Switt',
    rut: '18424396-2',
    docs: [
      { filename: 'Junio_merged.pdf', localPath: `${BASE}/02 - Yasmin Margaret Silva Switt - 18424396-2/Documentos_Abogada/Junio_merged.pdf` },
      { filename: 'BONO 1.pdf', localPath: `${BASE}/02 - Yasmin Margaret Silva Switt - 18424396-2/Documentos_Abogada/BONO 1.pdf` },
      { filename: 'bono2.pdf', localPath: `${BASE}/02 - Yasmin Margaret Silva Switt - 18424396-2/Documentos_Abogada/bono2.pdf` },
      { filename: 'Bono 3.pdf', localPath: `${BASE}/02 - Yasmin Margaret Silva Switt - 18424396-2/Documentos_Abogada/Bono 3.pdf` },
    ],
    abogada: 'Remuneración $1.035.208 Mensual + 3 bonos "Única Vez" (19410 $102.165, 19933 $90.525, L.20.158 $98.692).',
    gtMonto: 1035208,
  },
];

async function runCaso(c: Caso) {
  console.log(`\n${C.bold}━━━━━━━━━━ ${c.name} (${c.rut}) ━━━━━━━━━━${C.reset}`);
  const docs = c.docs.filter((d) => { const e = fs.existsSync(d.localPath); if (!e) console.log(`  ${C.yellow}⚠ falta: ${d.localPath}${C.reset}`); return e; });
  if (!docs.length) { console.log(`  ${C.red}sin documentos${C.reset}`); return; }

  const { extracted, cotizaciones } = await extractIncomeFactsNative(docs, {
    log: (m) => console.log(`    ${C.dim}${m}${C.reset}`),
    error: (m, e) => console.log(`    ${C.red}${m} ${e ?? ''}${C.reset}`),
  });

  console.log(`\n  ${C.cyan}Hechos que LEYÓ el LLM:${C.reset}`);
  for (const d of extracted) {
    console.log(`    • ${d.category} [fuente ${d.source_key ?? '—'}]`);
    for (const p of d.periods ?? []) {
      console.log(`        ${p.period_label}: ${p.liquido_a_pagar != null ? clp(p.liquido_a_pagar) : (p.monto_bruto != null ? clp(p.monto_bruto)+' (bruto)' : '?')}${p.moneda === 'UF' ? ' UF' : ''}${p.dias_trabajados != null ? ` · ${p.dias_trabajados}d` : ''}`);
    }
  }
  console.log(`    cotizaciones: ${cotizaciones ? `${cotizaciones.fecha_emision} rut ${cotizaciones.rut_entidad_pagadora}` : '—'}`);

  const comp = computeIncomes(extracted, cotizaciones);
  console.log(`\n  ${C.cyan}Lo que DECIDE el robot (LLM + motor determinista):${C.reset}`);
  for (const inc of comp.incomes) console.log(`    • [${inc.tipoIngreso}] ${inc.tipoIngresoLabel}: ${C.bold}${clp(inc.monto)}${C.reset} ${C.dim}${inc.detalle}${C.reset}`);
  if (!comp.incomes.length) console.log(`    ${C.yellow}(ninguno)${C.reset}`);
  const alerts = [...comp.alerts, ...comp.incomes.flatMap((i) => i.alerts)];
  if (alerts.length) { console.log(`    ${C.dim}alertas:${C.reset}`); alerts.forEach((a) => console.log(`      ${C.dim}- ${a}${C.reset}`)); }

  const robotMonto = comp.incomes.find((i) => i.tipoIngreso === 1)?.monto ?? 0;
  console.log(`\n  ${C.cyan}COMPARACIÓN vs ABOGADA:${C.reset}`);
  console.log(`    Abogada: ${C.bold}${clp(c.gtMonto)}${C.reset}  ${C.dim}(${c.abogada})${C.reset}`);
  console.log(`    Robot  : ${C.bold}${clp(robotMonto)}${C.reset} (Remuneración)`);
  const diff = robotMonto - c.gtMonto;
  const pct = c.gtMonto ? Math.round((robotMonto / c.gtMonto) * 100) : 0;
  const tag = Math.abs(diff) <= 5 ? `${C.green}IDÉNTICO${C.reset}` : `${C.yellow}Δ ${clp(diff)} (${pct}%)${C.reset}`;
  console.log(`    Δ      : ${tag}`);
}

async function main() {
  const only = process.argv[2]?.toLowerCase();
  const casos = only ? CASOS.filter((c) => c.key === only) : CASOS;
  console.log(`${C.bold}=== FASE 2 — LLM real vs abogada (Paso 5) ===${C.reset}`);
  for (const c of casos) { try { await runCaso(c); } catch (e: any) { console.log(`  ${C.red}error: ${e?.message || e}${C.reset}`); } }
}

main();
