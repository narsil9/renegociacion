/**
 * READ-ONLY, PII-safe. ¿Cómo está ESTRUCTURADA la clasificación de docs (cédulas incl.) en prod?
 * Pregunta: ¿tabla dedicada? ¿todo en una tabla sin clasificar? ¿qué campo lleva la etiqueta?
 * Correr: npx ts-node --transpile-only -r dotenv/config tools/audit_cedula_struct.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.PROD_SUPABASE_URL!;
const key = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, key, { auth: { persistSession: false } });
const IDENTITY_RX = /(c[eé]dula|carnet|identidad|identificaci)/i;

async function pageAll(table: string, cols: string) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as Record<string, unknown>[]));
    if (data.length < 1000) break;
  }
  return out;
}

(async () => {
  const rows = await pageAll(
    'renegociacion_audit_pdf',
    'rut_norm, tipo_documento, descripcion_detectada, filename'
  );

  // ¿Está descripcion_detectada poblada en general, o solo a veces?
  const conDesc = rows.filter((r) => r.descripcion_detectada != null && String(r.descripcion_detectada).trim() !== '').length;
  console.log('═══ ESTRUCTURA de clasificación en renegociacion_audit_pdf ═══\n');
  console.log(`Total filas: ${rows.length}`);
  console.log(`Con descripcion_detectada poblada: ${conDesc} (${(conDesc / rows.length * 100).toFixed(1)}%)`);
  console.log(`Con descripcion_detectada VACÍA/null: ${rows.length - conDesc}\n`);

  // Para las filas de cédula: ¿qué par (tipo_documento, descripcion_detectada) tienen?
  const ced = rows.filter((r) => IDENTITY_RX.test(`${r.tipo_documento ?? ''} ${r.descripcion_detectada ?? ''} ${r.filename ?? ''}`));
  console.log(`── Filas de CÉDULA: ${ced.length}. ¿Cómo están etiquetadas? ──`);
  const pares: Record<string, number> = {};
  for (const r of ced) {
    const k = `tipo_documento="${r.tipo_documento ?? '(null)'}"  |  descripcion_detectada="${r.descripcion_detectada ?? '(null)'}"`;
    pares[k] = (pares[k] ?? 0) + 1;
  }
  Object.entries(pares).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n}×  ${k}`));

  // ¿Detectó la cédula por contenido (descripcion) o solo por filename?
  const porFilename = ced.filter((r) => !IDENTITY_RX.test(String(r.descripcion_detectada ?? '')) && IDENTITY_RX.test(String(r.filename ?? ''))).length;
  const porContenido = ced.filter((r) => IDENTITY_RX.test(String(r.descripcion_detectada ?? ''))).length;
  console.log(`\n  Detectadas por descripcion_detectada (contenido): ${porContenido}`);
  console.log(`  Solo por filename (sin descripcion): ${porFilename}`);

  // Universo de descripcion_detectada distintas (¿hay un vocabulario de tipos, o caos?)
  const vocab: Record<string, number> = {};
  for (const r of rows) {
    const d = String(r.descripcion_detectada ?? '').trim();
    if (d) vocab[d] = (vocab[d] ?? 0) + 1;
  }
  console.log(`\n── Vocabulario de descripcion_detectada: ${Object.keys(vocab).length} valores distintos ──`);
  Object.entries(vocab).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([d, n]) => console.log(`  ${n.toString().padStart(4)}  ${d}`));

  console.log('\n═══ FIN ═══');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
