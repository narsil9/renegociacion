/**
 * AUDITORÍA READ-ONLY de prod (ton…) — ¿dónde viven las cédulas de identidad?
 * Objetivo: medir cobertura de cédulas para extraer fecha_nacimiento + profesión (Paso 1).
 * PII-SAFE: imprime SOLO conteos, etiquetas de clasificación y presencia (✅/🔴). NUNCA valores PII.
 *
 * Correr: npx ts-node --transpile-only -r dotenv/config tools/audit_cedula_source.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.PROD_SUPABASE_URL;
const key = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// Palabras que indican "documento de identidad" (cédula, carnet, identificación).
const IDENTITY_RX = /(c[eé]dula|carnet|identidad|identificaci|\bci\b|run\b)/i;

async function pageAll(table: string, cols: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await db.from(table).select(cols).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]));
    if (data.length < size) break;
  }
  return out;
}

(async () => {
  console.log('═══ AUDITORÍA: fuentes de CÉDULA en prod (ton…) — read-only, PII-safe ═══\n');

  // 1) renegociacion_audit_pdf — clasificación por tipo_documento / descripcion_detectada
  const rows = await pageAll(
    'renegociacion_audit_pdf',
    'rut_norm, tipo_documento, descripcion_detectada, filename'
  );
  console.log(`renegociacion_audit_pdf: ${rows.length} filas totales\n`);

  // Distribución de tipo_documento (etiqueta, no PII)
  const tipoCount: Record<string, number> = {};
  for (const r of rows) {
    const t = String(r.tipo_documento ?? '(null)');
    tipoCount[t] = (tipoCount[t] ?? 0) + 1;
  }
  console.log('── tipo_documento (distribución) ──');
  Object.entries(tipoCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([t, n]) => console.log(`  ${n.toString().padStart(5)}  ${t}`));

  // Filas cuya descripcion/filename/tipo huele a identidad
  const identityRows = rows.filter((r) => {
    const blob = `${r.tipo_documento ?? ''} ${r.descripcion_detectada ?? ''} ${r.filename ?? ''}`;
    return IDENTITY_RX.test(blob);
  });
  console.log(`\n── Filas que parecen CÉDULA/IDENTIDAD (regex contenido): ${identityRows.length} ──`);

  // Qué descripcion_detectada usan (etiquetas distintas, no PII — son tipos de doc)
  const descCount: Record<string, number> = {};
  for (const r of identityRows) {
    const d = String(r.descripcion_detectada ?? '(null)');
    descCount[d] = (descCount[d] ?? 0) + 1;
  }
  console.log('  descripcion_detectada de esas filas:');
  Object.entries(descCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .forEach(([d, n]) => console.log(`    ${n.toString().padStart(4)}  ${d}`));

  // Cobertura: ¿cuántos rut_norm DISTINTOS tienen al menos una cédula?
  const allRuts = new Set(rows.map((r) => String(r.rut_norm ?? '')).filter(Boolean));
  const rutsConCedula = new Set(identityRows.map((r) => String(r.rut_norm ?? '')).filter(Boolean));
  console.log(
    `\n── Cobertura ──\n  RUTs distintos en audit_pdf: ${allRuts.size}\n  RUTs con ≥1 doc de identidad: ${rutsConCedula.size}  (${((rutsConCedula.size / Math.max(allRuts.size, 1)) * 100).toFixed(1)}%)`
  );

  // 2) ¿La cédula podría venir como columna estructurada? Revisar core.persona (ya sabemos fecha_nacimiento=0)
  //    y si hay alguna otra fuente. Solo confirmamos el vacío conocido.
  const { count: personaCount } = await db
    .schema('core')
    .from('persona')
    .select('*', { count: 'exact', head: true });
  const { count: dobCount } = await db
    .schema('core')
    .from('persona')
    .select('*', { count: 'exact', head: true })
    .not('fecha_nacimiento', 'is', null);
  console.log(
    `\n── core.persona ──\n  filas: ${personaCount}\n  con fecha_nacimiento poblada: ${dobCount} (confirma brecha si =0)`
  );

  console.log('\n═══ FIN ═══');
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
