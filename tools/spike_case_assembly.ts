/**
 * SPIKE read-only: ¿se puede ARMAR un caso ejecutable solo desde `ton…`?
 *
 * Fase 1 (discovery): encuentra casos candidatos que tengan CMF reciente +
 * certificados + ClaveÚnica. Fase 2 (detalle): para el mejor candidato, ensambla
 * todo lo que el worker necesita y reporta brechas. Fase 3: prueba descargar el
 * PDF del CMF del Storage (verifica que los buckets son alcanzables).
 *
 * ⚠️ SOLO LECTURA sobre ton…. Nada de escribir. No es producción (tools/).
 * ⚠️ PII-SAFE: NUNCA imprime valores personales (nombre, RUT, fecha nac.,
 *    domicilio). Solo reporta PRESENCIA/cobertura (✅/🔴) y datos estructurales.
 * Uso: npx ts-node --transpile-only -r dotenv/config tools/spike_case_assembly.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv'; dotenv.config();

const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const rutNorm = (rut: string) => rut.replace(/[.\-]/g, '').toLowerCase();
const daysAgo = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

async function main() {
  console.log('🔬 SPIKE — armado de caso desde ton… (read-only)\n');

  // ── Fase 1: candidatos con CMF más reciente ──────────────────────────────
  const { data: cmfs, error: e1 } = await sb
    .from('cmf_informes')
    .select('case_airtable_id, storage_path, fecha_emision, filename')
    .not('case_airtable_id', 'is', null)
    .not('fecha_emision', 'is', null)
    .order('fecha_emision', { ascending: false })
    .limit(40);
  if (e1) { console.error('ERR cmf_informes:', e1.message); return; }

  // dedup por caso (quedarnos con el CMF más reciente por caso)
  const byCase = new Map<string, { storage_path: string; fecha_emision: string; filename: string }>();
  for (const c of cmfs ?? []) {
    if (!byCase.has(c.case_airtable_id)) byCase.set(c.case_airtable_id, { storage_path: c.storage_path, fecha_emision: c.fecha_emision, filename: c.filename });
  }

  const candidates: Array<{ airtable_id: string; rut: string; nombre: string | null; cmfDias: number | null; certs: number; tieneCU: boolean; cmfPath: string }> = [];
  for (const [airtable_id, cmf] of byCase) {
    if (candidates.length >= 3) break;
    const caso = await sb.from('v_casos_renegociacion').select('rut, nombre').eq('airtable_id', airtable_id).maybeSingle();
    if (caso.error || !caso.data?.rut) continue;
    const rn = rutNorm(caso.data.rut);
    const certs = await sb.from('renegociacion_audit_pdf').select('id', { count: 'exact', head: true }).eq('rut_norm', rn).eq('tipo_documento', 'documento_checklist');
    const persona = await sb.schema('core').from('persona').select('clave_unica').eq('rut', caso.data.rut).maybeSingle();
    const nCerts = certs.count ?? 0;
    const tieneCU = !!persona.data?.clave_unica;
    if (nCerts >= 1 && tieneCU) {
      candidates.push({ airtable_id, rut: caso.data.rut, nombre: caso.data.nombre, cmfDias: daysAgo(cmf.fecha_emision), certs: nCerts, tieneCU, cmfPath: cmf.storage_path });
    }
  }

  // PII-safe: identificamos los candidatos por índice, no por nombre/RUT.
  const has = (v: unknown) => (v ? '✅' : '🔴');
  console.log(`Candidatos encontrados (CMF + ≥1 cert + ClaveÚnica): ${candidates.length}`);
  candidates.forEach((c, i) => console.log(`  Candidato #${i + 1} · CMF hace ${c.cmfDias}d · ${c.certs} certs · ClaveÚnica ${has(c.tieneCU)}`));
  if (candidates.length === 0) { console.log('\n⚠️ Sin candidatos completos en el top-40 de CMF recientes.'); return; }

  // ── Fase 2: detalle del mejor candidato (sin volcar PII) ──────────────────
  const top = candidates[0];
  console.log(`\n══ DETALLE: Candidato #1 (datos personales OMITIDOS — solo presencia) ══`);
  const rn = rutNorm(top.rut);

  // Paso 1 — datos personales: SOLO presencia, nunca el valor
  const p = await sb.schema('core').from('persona')
    .select('nombre_completo, fecha_nacimiento, nacionalidad, estado_civil, profesion, clave_unica')
    .eq('rut', top.rut).maybeSingle();
  const pd = p.data;
  console.log('\n[Paso 1 — persona] (✅ = presente / 🔴 = vacío)');
  console.log('  nombre_completo:', has(pd?.nombre_completo));
  console.log('  fecha_nacimiento:', has(pd?.fecha_nacimiento), pd?.fecha_nacimiento ? '' : '(bloqueante Paso 1)');
  console.log('  nacionalidad:', has(pd?.nacionalidad));
  console.log('  estado_civil:', has(pd?.estado_civil), '(texto libre → mapear a enum)');
  console.log('  profesion:', has(pd?.profesion), '(texto libre → mapear a enum)');
  console.log('  ClaveÚnica:', has(pd?.clave_unica));

  // domicilio desde bronze: SOLO presencia
  const bm = await sb.from('bronze_customers_main').select('data').eq('data->>RUT (individual)', top.rut).maybeSingle();
  const b = (bm.data?.data ?? {}) as Record<string, unknown>;
  console.log('  domicilio (bronze):', has(b['Domicilio']), '| comuna:', has(b['Comuna']), '| ciudad:', has(b['Ciudad']));
  console.log('  region: 🔴 no existe (derivar de comuna) | ocupacion: 🔴 no existe');

  // Documentos: contamos y clasificamos por TIPO, sin volcar descripciones libres
  console.log('\n[Documentos]');
  console.log(`  CMF: presente ✅ (hace ${top.cmfDias}d ${top.cmfDias !== null && top.cmfDias > 30 ? '⚠️ >30d' : '✅ <30d'})`);
  const certs = await sb.from('renegociacion_audit_pdf')
    .select('email_date')
    .eq('rut_norm', rn).eq('tipo_documento', 'documento_checklist').limit(50);
  const nCerts = certs.data?.length ?? 0;
  const frescos = (certs.data ?? []).filter(c => { const d = daysAgo(c.email_date); return d !== null && d <= 30; }).length;
  console.log(`  Certificados (documento_checklist): ${nCerts} total · ${frescos} con <30d`);

  // SII jobs
  const sii = await sb.from('mac_mini_jobs')
    .select('command, status, completed_at')
    .eq('airtable_id', top.airtable_id).in('command', ['sii-carpeta', 'sii-agente-retenedor']).order('completed_at', { ascending: false }).limit(10);
  console.log('  SII jobs:');
  const seen = new Set<string>();
  (sii.data ?? []).forEach(j => { if (!seen.has(j.command)) { seen.add(j.command); console.log(`    · ${j.command}: ${j.status}`); } });
  if ((sii.data ?? []).length === 0) console.log('    (sin jobs sii-carpeta/agente para este caso)');

  // ── Fase 3: ¿se puede descargar el PDF del CMF del Storage? ───────────────
  console.log('\n[Storage] intento descargar el PDF del CMF…');
  const buckets = ['informes-cmf', 'cmf', 'correos-entrantes'];
  let ok = false;
  for (const bucket of buckets) {
    const dl = await sb.storage.from(bucket).download(top.cmfPath);
    if (!dl.error && dl.data) {
      const size = dl.data.size ?? (await dl.data.arrayBuffer()).byteLength;
      console.log(`  ✅ bucket '${bucket}': ${size} bytes descargados`);
      ok = true; break;
    }
  }
  if (!ok) {
    // probar signed URL como alternativa
    for (const bucket of buckets) {
      const su = await sb.storage.from(bucket).createSignedUrl(top.cmfPath, 60);
      if (!su.error && su.data?.signedUrl) { console.log(`  ✅ signed URL OK en bucket '${bucket}'`); ok = true; break; }
    }
  }
  if (!ok) console.log('  ⚠️ no se pudo descargar de los buckets probados — revisar nombre de bucket / storage_path');

  console.log('\n✔ Spike terminado (solo lectura, nada se modificó).');
}

main().catch(e => { console.error('🚨', e instanceof Error ? e.message : e); process.exit(1); });
