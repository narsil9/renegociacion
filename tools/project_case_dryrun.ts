/**
 * PASO 2a — Proyección EN SECO de un caso de ton… al formato del portal.
 *
 * Lee el caso conocido (read-only ton…), TRADUCE los datos a los enums del
 * portal (estado_civil→código, profesión→etiqueta, comuna→región), marca
 * placeholders de lo faltante, y REPORTA qué quedaría. NO escribe en el sandbox,
 * NO copia PDFs, NO corre Playwright, NO toca prod (solo lee).
 *
 * PII-SAFE: en los campos categóricos muestra el RESULTADO-portal (no
 * identificante); el texto crudo se muestra SOLO cuando NO mapea (para
 * corregir). Campos identificantes (nombre, RUT, fecha nac., domicilio) →
 * solo presencia.
 *
 * Uso: npx ts-node --transpile-only -r dotenv/config tools/project_case_dryrun.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv'; dotenv.config();

const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Enum = { value: string; label: string };
const enums = JSON.parse(fs.readFileSync(path.join(__dirname, '../supabase/portal_select_values.json'), 'utf8')) as Record<string, Enum[]>;

const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const rutNorm = (rut: string) => rut.replace(/[.\-]/g, '').toLowerCase();
const has = (v: unknown) => (v ? '✅' : '🔴');

// ── Traductores texto → enum del portal ──────────────────────────────────────
function mapEstadoCivil(txt: string | null): { value: string | null; label: string; ok: boolean } {
  const t = norm(txt ?? '');
  if (!t) return { value: null, label: '(vacío)', ok: false };
  const rules: Array<[RegExp, string]> = [
    [/solter/, '1'], [/casad/, '2'], [/divorc/, '3'], [/viud/, '4'],
    [/separaci.*judicial|separacion judicial/, '5'], [/convivien/, '6'],
  ];
  for (const [re, v] of rules) if (re.test(t)) {
    const e = enums.personaEstadoCivil.find(x => x.value === v)!;
    return { value: v, label: e.label, ok: true };
  }
  return { value: null, label: txt!, ok: false };
}

function mapProfesion(txt: string | null): { value: string | null; label: string; ok: boolean } {
  const t = norm(txt ?? '');
  if (!t) return { value: null, label: '(vacío)', ok: false };
  const list = enums.personaProfesionOficio;
  let hit = list.find(x => norm(x.label) === t);                       // exacto
  if (!hit) hit = list.find(x => norm(x.label).includes(t) || t.includes(norm(x.label))); // contains
  return hit ? { value: hit.value, label: hit.label, ok: true } : { value: null, label: txt!, ok: false };
}

function comunaToRegion(comuna: string | null): { comunaValue: string | null; regionLabel: string | null; ok: boolean } {
  const c = norm(comuna ?? '');
  if (!c) return { comunaValue: null, regionLabel: null, ok: false };
  const hit = enums.personaComuna.find(x => norm(x.label) === c);
  if (!hit) return { comunaValue: null, regionLabel: null, ok: false };
  // Las 52 comunas cargadas son todas de la RM.
  const rm = enums.personaRegion.find(x => /metropolitana/.test(norm(x.label)));
  return { comunaValue: hit.value, regionLabel: rm?.label ?? 'Región Metropolitana', ok: true };
}

async function findKnownCase(): Promise<{ airtable_id: string; rut: string } | null> {
  const { data: cmfs } = await sb.from('cmf_informes')
    .select('case_airtable_id, fecha_emision').not('case_airtable_id', 'is', null)
    .not('fecha_emision', 'is', null).order('fecha_emision', { ascending: false }).limit(40);
  const seen = new Set<string>();
  for (const c of cmfs ?? []) {
    if (seen.has(c.case_airtable_id)) continue; seen.add(c.case_airtable_id);
    const caso = await sb.from('v_casos_renegociacion').select('rut').eq('airtable_id', c.case_airtable_id).maybeSingle();
    if (!caso.data?.rut) continue;
    const certs = await sb.from('renegociacion_audit_pdf').select('id', { count: 'exact', head: true })
      .eq('rut_norm', rutNorm(caso.data.rut)).eq('tipo_documento', 'documento_checklist');
    const cu = await sb.schema('core').from('persona').select('clave_unica').eq('rut', caso.data.rut).maybeSingle();
    if ((certs.count ?? 0) >= 1 && cu.data?.clave_unica) return { airtable_id: c.case_airtable_id, rut: caso.data.rut };
  }
  return null;
}

async function main() {
  console.log('🧪 PASO 2a — proyección EN SECO (read-only, no escribe nada)\n');
  const kase = await findKnownCase();
  if (!kase) { console.log('⚠️ No se encontró el caso conocido.'); return; }
  const rn = rutNorm(kase.rut);
  console.log('Caso: Candidato conocido del spike (identidad omitida)\n');

  const p = await sb.schema('core').from('persona')
    .select('nombre_completo, fecha_nacimiento, nacionalidad, estado_civil, profesion, clave_unica, airtable_main_id')
    .eq('rut', kase.rut).maybeSingle();
  const pd = p.data!;

  // domicilio/comuna por el join correcto (airtable_main_id)
  let comuna: string | null = null, domicilioPresente = false;
  if (pd.airtable_main_id) {
    // bronze se liga por su columna airtable_id (= persona.airtable_main_id), NO por "id".
    const bm = await sb.from('bronze_customers_main').select('data').eq('airtable_id', pd.airtable_main_id).maybeSingle();
    const d = (bm.data?.data ?? {}) as Record<string, unknown>;
    comuna = (d['Comuna'] as string) ?? null;
    domicilioPresente = !!d['Domicilio'];
  }

  // Traducciones
  const ec = mapEstadoCivil(pd.estado_civil);
  const pr = mapProfesion(pd.profesion);
  const re = comunaToRegion(comuna);

  console.log('═══ [Paso 1] traducción a formato-portal ═══');
  console.log('  nombre_completo:', has(pd.nombre_completo), '(identificante → solo presencia)');
  console.log('  ClaveÚnica (origen):', has(pd.clave_unica), '→ ⚠️ en prueba se IGNORA: login con credenciales de Pato (21917363-6)');
  console.log('  nacionalidad:', has(pd.nacionalidad));
  console.log('  estado_civil:', ec.ok ? `✅ → "${ec.label}" (value ${ec.value})` : `🔴 NO mapeó (crudo: "${ec.label}") → requiere regla`);
  console.log('  profesion:', pr.ok ? `✅ → "${pr.label}" (value ${pr.value})` : `🔴 NO mapeó (crudo: "${pr.label}") → placeholder o agregar al catálogo`);
  console.log('  comuna→region:', re.ok ? `✅ comuna(value ${re.comunaValue}) → "${re.regionLabel}"` : `🔴 comuna no está en el catálogo del portal (¿fuera de RM?) → requiere tabla comuna→región`);
  console.log('  fecha_nacimiento:', pd.fecha_nacimiento ? '✅ presente' : '🟡 VACÍO → PLACEHOLDER en prueba (bloqueante en prod)');
  console.log('  ocupacion:', '🟡 sin fuente en ton… → PLACEHOLDER "Sin Información" (32767)');
  console.log('  domicilio:', domicilioPresente ? '✅ presente (bronze)' : '🟡 ausente → revisar');

  // Documentos que se copiarían (conteo + tipo, sin nombres personales)
  console.log('\n═══ [Documentos] que se copiarían al sandbox ═══');
  const cmf = await sb.from('cmf_informes').select('storage_path, fecha_emision').eq('case_airtable_id', kase.airtable_id)
    .order('fecha_emision', { ascending: false }).limit(1).maybeSingle();
  console.log('  CMF:', cmf.data ? '✅ 1 PDF (bucket informes-cmf)' : '🔴 falta');
  const certs = await sb.from('renegociacion_audit_pdf').select('id', { count: 'exact', head: true })
    .eq('rut_norm', rn).eq('tipo_documento', 'documento_checklist');
  console.log('  Certificados:', `${certs.count ?? 0} PDFs (bucket audit-attachments)`);
  const sii = await sb.from('mac_mini_jobs').select('command, status').eq('airtable_id', kase.airtable_id)
    .in('command', ['sii-carpeta', 'sii-agente-retenedor']).eq('status', 'done');
  const cmds = new Set((sii.data ?? []).map(j => j.command));
  console.log('  Carpeta Tributaria:', cmds.has('sii-carpeta') ? '✅ done' : '🟡 no done');
  console.log('  Agentes Retenedores:', cmds.has('sii-agente-retenedor') ? '✅ done' : '🟡 no done');

  console.log('\n✔ 2a terminado. NADA se escribió (ni sandbox ni prod ni archivos).');
  console.log('  → Si las traducciones de arriba están OK, sigo con 2b (escribir al sandbox + copiar PDFs).');
}

main().catch(e => { console.error('🚨', e instanceof Error ? e.message : e); process.exit(1); });
