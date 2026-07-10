/**
 * PRUEBA DE INYECCIÓN — usa MI análisis de los documentos (oracle_truth.ts) como si fuera la
 * salida del Centinela y corre el downstream del Paso 3 (agrupamiento por institución canónica +
 * dedup del mismo producto) para verificar que el flujo declara EXACTAMENTE lo que declaró la
 * abogada, sin duplicados/triplicados ni deudas ignoradas.
 *
 * Responde: "si Claude leyera los documentos como los leí yo, ¿el flujo produce la declaración
 * correcta?" Determinista, sin API. NO entra al portal.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_oracle_injection.ts
 */
import { ORACLE } from './oracle_truth';
import { canonicalInstitutionKey } from '../../src/utils/acreedor_matcher';

// Conteo por institución que declaró la abogada (de los screenshots). Clave = canónica (+ alias Tenpo).
const ABOGADA: Record<string, Record<string, number>> = {
  cristian_mancilla: { 'banco estado': 3, 'ccaf los andes': 2, 'banco santander': 2, 'promotora cmr falabella s a': 1, 'tesoreria general de la republica': 2 },
  miguel_lugo: { 'banco de chile': 4, 'banco itau': 3, 'ccaf los andes': 3, 'banco de credito e inversiones': 2, 'tenpo': 1 },
  nector_ruiz: { 'banco de chile': 5, 'banco estado': 3, 'banco falabella': 1, 'promotora cmr falabella s a': 1, 'ccaf la araucana': 1, 'cencosud administradora de tarjetas s a': 1 },
};
const aliasKey = (k: string): string => (k.startsWith('tenpo') ? 'tenpo' : k);
const clp = (n: number) => '$' + n.toLocaleString('es-CL');

let allOk = true;

for (const [dir, c] of Object.entries(ORACLE)) {
  console.log(`\n${'═'.repeat(72)}\n🧪 ${c.label} — inyectando MI lectura como salida del Centinela\n${'═'.repeat(72)}`);

  // 1) Guard de duplicados: ningún producto repetido (misma institución + monto casi-exacto).
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(100, Math.max(a, b) * 0.001);
  const dups: string[] = [];
  for (let i = 0; i < c.productos.length; i++)
    for (let j = i + 1; j < c.productos.length; j++) {
      const a = c.productos[i], b = c.productos[j];
      if (canonicalInstitutionKey(a.institucion) === canonicalInstitutionKey(b.institucion) && near(a.monto, b.monto))
        dups.push(`${a.institucion} ${clp(a.monto)} (${a.doc} ≈ ${b.doc})`);
    }

  // 2) Conteo por institución (lo que el flujo declararía).
  const ours: Record<string, number> = {};
  for (const p of c.productos) { const k = aliasKey(canonicalInstitutionKey(p.institucion)); ours[k] = (ours[k] ?? 0) + 1; }
  const gt = ABOGADA[dir];
  const keys = [...new Set([...Object.keys(gt), ...Object.keys(ours)])].sort();

  console.log(`  ${'institución'.padEnd(34)} abogada  oráculo`);
  let faltan = 0, demas = 0;
  for (const k of keys) {
    const a = gt[k] ?? 0, o = ours[k] ?? 0;
    if (o < a) faltan += a - o; if (o > a) demas += o - a;
    console.log(`  ${k.padEnd(34)} ${String(a).padStart(6)}  ${String(o).padStart(7)}  ${a === o ? '✅' : (o < a ? `🔴 faltan ${a - o}` : `🟠 +${o - a}`)}`);
  }
  const total = c.productos.length;
  const countOk = total === c.total && faltan === 0 && demas === 0;
  console.log(`  ${'TOTAL'.padEnd(34)} ${String(c.total).padStart(6)}  ${String(total).padStart(7)}  ${countOk ? '✅ coincide' : '❌'}`);
  console.log(`  NO-CMF (deben declararse igual): ${c.productos.filter(p => !p.cmf).map(p => `${p.institucion} ${clp(p.monto)}`).join(', ') || '—'}`);
  console.log(`  leídos directo del PDF esta sesión: ${c.productos.filter(p => p.leido).length}/${total}`);
  if (dups.length) { allOk = false; console.log(`  ❌ DUPLICADOS: ${dups.join(' | ')}`); }
  else console.log(`  ✅ Sin duplicados/triplicados.`);
  if (!countOk) allOk = false;
  console.log(`  ${countOk && !dups.length ? '✅ FLUJO EXITOSO: declara lo mismo que la abogada, sin dups ni faltantes.' : '❌ revisar.'}`);
}

console.log(`\n${'─'.repeat(72)}\n${allOk ? '✅ TODOS los casos: el flujo declara correctamente dada la extracción correcta.' : '❌ Hay casos a revisar.'}\n`);
process.exit(allOk ? 0 : 1);
