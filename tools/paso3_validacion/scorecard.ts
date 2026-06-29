/**
 * SCORECARD contra verdad-terreno + ESTABILIDAD.
 *
 * Métrica (definida con el usuario, 2026-06-29): NO comparar montos exactos contra
 * `analisis_deudas.md` (puede estar desactualizado). Comparar el **número de deudas
 * declaradas vs la abogada**, detectar **duplicados/triplicados** y **deudas ignoradas**.
 * La sección 260/261 NO penaliza (declarar en 260 está bien si cumple requisitos).
 *
 * Verdad-terreno = lo que la abogada declaró en el portal (contado de los screenshots
 * `casos/<caso>/screenshots/`), codificado abajo como conteo de productos por institución.
 *
 * Modelo del "conjunto declarado" por NOSOTROS (sin portal): `fillStep3` declara UN producto
 * por fila; en el volcado crudo del Centinela el MISMO producto aparece en varias listas
 * (cmf260Override + identified261 + deReclassified). Por eso se COLAPSA por
 * (institución canónica + monto con tolerancia) → set de productos DISTINTOS = lo que se declara.
 *
 * Corre el Centinela N veces (default 3) para medir estabilidad. Gasta créditos.
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/_shared/scorecard.ts [N] [caso]
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { runSentinelCheck, SentinelResult } from '../../src/utils/sentinel';
import { canonicalInstitutionKey } from '../../src/utils/acreedor_matcher';
dotenv.config();

interface Caso { dir: string; rut: string; label: string; total: number; perInst: Record<string, number>; }

// Verdad-terreno: conteo de productos por institución canónica (de los screenshots de la abogada).
// La clave usa canonicalInstitutionKey() para alinear con el modelo. total = suma (sanidad).
const CASES: Caso[] = [
  {
    dir: 'cristian_mancilla', rut: '16.587.870-1', label: 'Cristian Mancilla', total: 10,
    perInst: { 'banco estado': 3, 'ccaf los andes': 2, 'banco santander': 2, 'promotora cmr falabella s a': 1, 'tesoreria general de la republica': 2 },
  },
  {
    dir: 'miguel_lugo', rut: '26.625.555-1', label: 'Miguel Lugo', total: 13,
    perInst: { 'banco de chile': 4, 'banco itau chile': 3, 'ccaf los andes': 3, 'banco de credito e inversiones': 2, 'tenpo payments s a': 1 },
  },
  {
    dir: 'nector_ruiz', rut: '15.420.073-8', label: 'Néctor Ruiz', total: 12,
    perInst: { 'banco de chile': 5, 'banco estado': 3, 'banco falabella': 1, 'promotora cmr falabella s a': 1, 'ccaf la araucana': 1, 'cencosud administradora de tarjetas s a': 1 },
  },
];

function reqEnv(n: string): string { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
const clp = (n: number) => '$' + n.toLocaleString('es-CL');

// Unifica variantes de la MISMA entidad cuyo nombre difiere entre el screenshot de la abogada
// y el catálogo (alias conocidos, pendientes en la columna nombres_alternativos / migración v7).
// No es la lógica del sistema; es para que el scorecard cuente la misma deuda como una.
const SCORECARD_ALIASES: Record<string, string> = {
  'tenpo payments s a': 'tenpo',
  'tenpo prepago sa': 'tenpo',
  'tenpo prepago s a': 'tenpo',
};
const aliasKey = (k: string): string => SCORECARD_ALIASES[k] ?? k;

interface DeclaredProduct { inst: string; key: string; monto: number; fuentes: string[]; }

/** Filas crudas del SentinelResult (todas las listas), como las vería el volcado. */
function rawRows(r: SentinelResult): { inst: string; monto: number; fuente: string }[] {
  const out: { inst: string; monto: number; fuente: string }[] = [];
  for (const x of r.reclassifiedCreditors ?? []) out.push({ inst: x.institucion_cmf, monto: x.total_credito_clp, fuente: 'reclassified' });
  for (const o of r.cmf260DirectOverrides ?? []) out.push({ inst: o.institucion_cmf, monto: o.monto_clp, fuente: 'cmf260Override' });
  for (const x of r.identified261Creditors ?? []) out.push({ inst: x.institucion_cmf, monto: x.total_credito_clp, fuente: 'identified261' });
  for (const a of r.additionalCreditors ?? []) out.push({ inst: a.institucion_cmf || (a as any).bank || '', monto: a.total_credito_clp, fuente: 'additional' });
  for (const x of r.deReclassified261Creditors ?? []) out.push({ inst: x.institucion_cmf ?? (x as any).bank, monto: x.total_credito_clp, fuente: 'deReclassified' });
  return out;
}

/**
 * Colapsa las filas crudas al set de productos DISTINTOS que se declararían: mismo
 * (institución canónica + monto con tolerancia) = el mismo producto repetido en varias listas.
 */
function declaredProducts(r: SentinelResult): DeclaredProduct[] {
  // Tolerancia ESTRICTA: solo colapsa el MISMO producto repetido entre listas (override +
  // identified261 + deReclassified), que lleva el monto IDÉNTICO. Dos deudas distintas de monto
  // parecido (ej. 2 contribuciones TGR $18.537 y $19.049) NO deben colapsar.
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(100, Math.max(a, b) * 0.001);
  const products: DeclaredProduct[] = [];
  for (const row of rawRows(r)) {
    if (!row.monto || row.monto <= 0) continue;
    const key = aliasKey(canonicalInstitutionKey(row.inst));
    const existing = products.find((p) => p.key === key && near(p.monto, row.monto));
    if (existing) { existing.fuentes.push(row.fuente); existing.monto = Math.max(existing.monto, row.monto); }
    else products.push({ inst: row.inst, key, monto: row.monto, fuentes: [row.fuente] });
  }
  return products;
}

function countByInst(products: DeclaredProduct[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of products) m[p.key] = (m[p.key] ?? 0) + 1;
  return m;
}

async function main() {
  const args = process.argv.slice(2);
  const N = parseInt(args.find((a) => /^\d+$/.test(a)) ?? '3', 10);
  const only = args.find((a) => !/^\d+$/.test(a));
  const cases = only ? CASES.filter((c) => c.dir === only) : CASES;

  const supabase = createClient(reqEnv('SUPABASE_URL'), reqEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const logger = { log: (_m: string) => {}, error: (m: string, e?: unknown) => console.error(m, e ?? '') };

  for (const c of cases) {
    console.log(`\n${'═'.repeat(72)}\n🧪 ${c.label} (${c.rut}) — abogada declaró ${c.total} deudas\n${'═'.repeat(72)}`);
    const { data: client } = await supabase.from('clients').select('*').eq('rut', c.rut).maybeSingle();
    if (!client) { console.log('  ⚠️ Cliente no encontrado'); continue; }

    const perInstRuns: Record<string, number>[] = [];
    const totals: number[] = [];
    let lastProducts: DeclaredProduct[] = [];

    for (let i = 0; i < N; i++) {
      let r: SentinelResult;
      try { r = await runSentinelCheck(client, supabase, logger); }
      catch (e) { console.log(`  🚨 corrida ${i + 1} falló: ${(e as Error).message}`); continue; }
      const prods = declaredProducts(r);
      lastProducts = prods;
      perInstRuns.push(countByInst(prods));
      totals.push(prods.length);
      console.log(`  Corrida ${i + 1}: ${prods.length} deudas declaradas (abogada: ${c.total})`);
    }
    if (perInstRuns.length === 0) continue;

    // --- Scorecard (vs verdad-terreno) usando la 1ª corrida ---
    const ours = perInstRuns[0];
    const gt: Record<string, number> = {};
    for (const [k, v] of Object.entries(c.perInst)) gt[aliasKey(k)] = (gt[aliasKey(k)] ?? 0) + v;
    const allKeys = [...new Set([...Object.keys(gt), ...Object.keys(ours)])].sort();
    console.log(`\n  ── SCORECARD vs abogada (corrida 1) ──`);
    console.log(`  ${'institución'.padEnd(34)} abogada  nuestro`);
    let faltan = 0, demas = 0;
    for (const k of allKeys) {
      const a = gt[k] ?? 0, o = ours[k] ?? 0;
      const flag = a === o ? '✅' : (o < a ? `🔴 faltan ${a - o}` : `🟠 +${o - a} de más`);
      if (o < a) faltan += a - o; if (o > a) demas += o - a;
      console.log(`  ${k.padEnd(34)} ${String(a).padStart(6)}  ${String(o).padStart(6)}  ${flag}`);
    }
    const totalOurs = totals[0];
    console.log(`  ${'TOTAL'.padEnd(34)} ${String(c.total).padStart(6)}  ${String(totalOurs).padStart(6)}  ${c.total === totalOurs ? '✅ coincide' : `❌ dif ${totalOurs - c.total}`}`);
    if (faltan) console.log(`  🔴 ${faltan} deuda(s) que la abogada declaró y nosotros NO.`);
    if (demas) console.log(`  🟠 ${demas} deuda(s) de más (posible duplicado o producto que la abogada no declaró).`);

    // --- Duplicados intra-salida: misma institución+monto que NO colapsó (no debería pasar) ---
    // y detección de instituciones con más productos que la abogada (posible dup/triplicado).
    const dupInst = allKeys.filter((k) => (ours[k] ?? 0) > (gt[k] ?? 0));
    if (dupInst.length) {
      console.log(`  🔎 Revisar duplicados/extra en: ${dupInst.map((k) => `${k} (${ours[k]} vs ${gt[k] ?? 0})`).join(', ')}`);
      for (const k of dupInst) {
        lastProducts.filter((p) => p.key === k).forEach((p) => console.log(`       • ${p.inst} ${clp(p.monto)} [${p.fuentes.join('+')}]`));
      }
    }

    // --- Estabilidad (N corridas) ---
    if (perInstRuns.length > 1) {
      console.log(`\n  ── ESTABILIDAD (${perInstRuns.length} corridas) ──`);
      const tmin = Math.min(...totals), tmax = Math.max(...totals);
      console.log(`  Total declarado por corrida: [${totals.join(', ')}] → ${tmin === tmax ? `ESTABLE en ${tmin}` : `VARÍA ${tmin}–${tmax}`}`);
      const keys = [...new Set(perInstRuns.flatMap((r) => Object.keys(r)))].sort();
      for (const k of keys) {
        const counts = perInstRuns.map((r) => r[k] ?? 0);
        const mn = Math.min(...counts), mx = Math.max(...counts);
        if (mn !== mx) console.log(`  🟠 ${k}: ${counts.join('/')} (VARÍA)`);
      }
      if (keys.every((k) => { const cs = perInstRuns.map((r) => r[k] ?? 0); return Math.min(...cs) === Math.max(...cs); }))
        console.log(`  ✅ Conteo por institución ESTABLE en las ${perInstRuns.length} corridas.`);
    }
  }
  console.log('\n✅ Scorecard listo.\n');
}

main().catch((e) => { console.error('\n🚨', (e as Error).message, e); process.exit(1); });
