/**
 * PROYECTOR de caso ton… → (staging local | sandbox).
 *
 * Selecciona el caso más completo (CMF + certs + ClaveÚnica), arma el perfil del
 * Paso 1 (mapeando a enums del portal con placeholders para lo faltante) y trae
 * los documentos (CMF + CT + AR + certs).
 *
 * MODE=stage (default): READ-ONLY ton…, descarga a carpeta local, reporta. No escribe.
 * MODE=write: además, ESCRIBE SOLO EN SANDBOX (upsert clients + subir docs +
 *   client_documents). Credenciales = Pato (login con su ClaveÚnica). airtable_id=null.
 *   Reversible/purgeable. NO corre el worker ni toca el portal.
 *
 * ⚠️ ton… SOLO LECTURA. PII: PDFs a disco temporal / sandbox; consola sin valores personales.
 * Uso: [MODE=write] npx ts-node --transpile-only -r dotenv/config tools/mantenimiento/project_case.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs'; import * as path from 'path';
import * as dotenv from 'dotenv'; dotenv.config();

const MODE = (process.env.MODE ?? 'stage') as 'stage' | 'write';
const prod = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const sbx = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const enums = JSON.parse(fs.readFileSync(path.join(__dirname, '../supabase/portal_select_values.json'), 'utf8')) as Record<string, { value: string; label: string }[]>;
const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const rutNorm = (r: string) => r.replace(/[.\-]/g, '').toLowerCase();
const daysAgo = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
const STAGE = path.join('/private/tmp/claude-501/-Users-patomartini-Desktop-renegociacion/03317425-f478-4e18-978c-90904ac91590/scratchpad', 'projected_case');
const PORTAL_RUT = '21917363-6';
const CERT_CAP = Number(process.env.CERT_CAP ?? 40);
const safeComuna = (enums.personaComuna.find(x => norm(x.label) === 'santiago') ?? enums.personaComuna[0]).label;

async function selectTopCase() {
  const certRows: any[] = []; { let f = 0; for (;;) { const { data } = await prod.from('renegociacion_audit_pdf').select('rut_norm, storage_path, filename').eq('tipo_documento', 'documento_checklist').range(f, f + 999); certRows.push(...(data ?? [])); if (!data || data.length < 1000) break; f += 1000; } }
  const certsByRut = new Map<string, any[]>();
  for (const c of certRows) { if (!c.rut_norm) continue; if (!certsByRut.has(c.rut_norm)) certsByRut.set(c.rut_norm, []); certsByRut.get(c.rut_norm)!.push(c); }
  const casos: any[] = []; { let f = 0; for (;;) { const { data } = await prod.from('v_casos_renegociacion').select('airtable_id, rut, email, telefono').range(f, f + 999); casos.push(...(data ?? [])); if (!data || data.length < 1000) break; f += 1000; } }
  const cmf: any[] = []; { let f = 0; for (;;) { const { data } = await prod.from('cmf_informes').select('case_airtable_id, fecha_emision, storage_path').not('case_airtable_id', 'is', null).range(f, f + 999); cmf.push(...(data ?? [])); if (!data || data.length < 1000) break; f += 1000; } }
  const cmfLatest = new Map<string, any>();
  for (const c of cmf) { const p = cmfLatest.get(c.case_airtable_id); if (c.fecha_emision && (!p || c.fecha_emision > p.fecha_emision)) cmfLatest.set(c.case_airtable_id, c); }
  let best: any = null;
  for (const caso of casos) { if (!caso.rut) continue; const rn = rutNorm(caso.rut); const certs = certsByRut.get(rn); const cm = cmfLatest.get(caso.airtable_id); if (!certs || !cm) continue; const score = certs.length + ((daysAgo(cm.fecha_emision) ?? 999) <= 30 ? 3 : 0); if (!best || score > best.score || (score === best.score && caso.airtable_id < best.airtable_id)) best = { ...caso, score, certs, cmf: cm }; }
  return best;
}

function mapField(kind: string, raw: string | null): { value: string; placeholder: boolean } {
  const t = norm(raw ?? '');
  if (kind === 'estado_civil') { const r: [RegExp, string][] = [[/solter/, '1'], [/casad/, '2'], [/divorc/, '3'], [/viud/, '4'], [/separaci/, '5'], [/convivien/, '6']]; for (const [re, v] of r) if (re.test(t)) return { value: v, placeholder: false }; return { value: '7', placeholder: true }; }
  if (kind === 'profesion') { const hit = enums.personaProfesionOficio.find(x => norm(x.label) === t) ?? enums.personaProfesionOficio.find(x => t && (norm(x.label).includes(t) || t.includes(norm(x.label)))); return hit ? { value: hit.label, placeholder: false } : { value: 'Otros', placeholder: true }; }
  if (kind === 'comuna') { const hit = enums.personaComuna.find(x => norm(x.label) === t); return hit ? { value: hit.label, placeholder: false } : { value: safeComuna, placeholder: true }; }
  return { value: raw ?? '', placeholder: !raw };
}

async function dl(bucket: string, p: string, dest: string): Promise<number | null> {
  const { data, error } = await prod.storage.from(bucket).download(p);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer()); fs.writeFileSync(dest, buf); return buf.length;
}
async function up(localFile: string, storagePath: string): Promise<boolean> {
  if (!fs.existsSync(localFile)) return false;
  const { error } = await sbx.storage.from('documentos').upload(storagePath, fs.readFileSync(localFile), { contentType: 'application/pdf', upsert: true });
  return !error;
}

async function main() {
  console.log(`📦 PROYECTOR — modo ${MODE.toUpperCase()}\n`);
  fs.mkdirSync(STAGE, { recursive: true });
  const k = await selectTopCase();
  if (!k) { console.log('Sin caso completo.'); return; }
  console.log(`Caso (identidad omitida): score ${k.score}, ${k.certs.length} certs, CMF hace ${daysAgo(k.cmf.fecha_emision)}d\n`);

  const p = (await prod.schema('core').from('persona').select('nombre_completo, estado_civil, profesion, nacionalidad, airtable_main_id, fecha_nacimiento').eq('rut', k.rut).maybeSingle()).data ?? {} as any;
  let comunaRaw: string | null = null, domicilio: string | null = null;
  if (p.airtable_main_id) { const b = (await prod.from('bronze_customers_main').select('data').eq('airtable_id', p.airtable_main_id).maybeSingle()).data?.data as any; comunaRaw = b?.['Comuna'] ?? null; domicilio = b?.['Domicilio'] ?? null; }
  const ec = mapField('estado_civil', p.estado_civil), pr = mapField('profesion', p.profesion), co = mapField('comuna', comunaRaw);

  // Perfil Paso 1 (con placeholders). Credenciales = Pato; airtable_id=null → fallback ClaveÚnica.
  const profile = {
    rut: k.rut, name: p.nombre_completo ?? 'Cliente Proyectado', clave_unica_rut: PORTAL_RUT,
    clave_unica_password: process.env.CLAVE_UNICA_PASSWORD ?? '',
    nacionalidad: p.nacionalidad ?? 'CHILENA', fecha_nacimiento: p.fecha_nacimiento ?? '01/01/1990',
    estado_civil: ec.value, regimen_patrimonial: null, profesion_oficio: pr.value,
    ocupacion: 'Trabajador/a dependiente', direccion: domicilio ?? 'Sin información',
    region: 'Región Metropolitana', comuna: co.value, email: k.email ?? '',
    telefono_prefijo: '56', telefono: (k.telefono ?? '').replace(/\D/g, '').slice(-9), airtable_id: null,
  };
  console.log('[Paso 1] estado_civil', ec.value, ec.placeholder ? '(PH)' : '✅', '| profesion', pr.placeholder ? 'Otros(PH)' : '✅', '| comuna', co.placeholder ? `${co.value}(PH)` : '✅', '| DOB', p.fecha_nacimiento ? '✅' : '01/01/1990(PH)');

  // Documentos → STAGE
  console.log('\n[Documentos → local]');
  const cmfOk = await dl('informes-cmf', k.cmf.storage_path, path.join(STAGE, 'informe_cmf.pdf'));
  console.log('  CMF:', cmfOk ? `✅ ${cmfOk}b` : '🔴');
  const jobs = (await prod.from('mac_mini_jobs').select('command, result').eq('airtable_id', k.airtable_id).in('command', ['sii-carpeta', 'sii-agente-retenedor']).eq('status', 'done').order('completed_at', { ascending: false })).data ?? [];
  const carpeta = jobs.find((x: any) => x.command === 'sii-carpeta');
  const ctOk = carpeta?.result?.storage_path ? await dl('expedientes-sii', carpeta.result.storage_path, path.join(STAGE, 'carpeta_tributaria.pdf')) : null;
  console.log('  CT:', ctOk ? `✅ ${ctOk}b` : '🔴');
  const pdfs = ((jobs.find((x: any) => x.command === 'sii-agente-retenedor')?.result?.pdfs) ?? []) as any[];
  const latest = pdfs.filter(x => x.storage_path).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
  const arOk = latest ? await dl('expedientes-sii', latest.storage_path, path.join(STAGE, 'agentes_retenedores.pdf')) : null;
  console.log('  AR:', arOk ? `✅ ${arOk}b` : '🔴');
  const cap = Math.min(k.certs.length, CERT_CAP); const certFiles: { local: string; filename: string }[] = [];
  for (let i = 0; i < cap; i++) { const c = k.certs[i]; if (!c.storage_path) continue; const local = path.join(STAGE, `cert_${i + 1}.pdf`); if (await dl('audit-attachments', c.storage_path, local)) certFiles.push({ local, filename: c.filename ?? `cert_${i + 1}.pdf` }); }
  console.log(`  Certs: ${certFiles.length}/${cap} (de ${k.certs.length})`);

  if (MODE === 'stage') { console.log(`\n✔ STAGE en ${STAGE}. (Para escribir: MODE=write)`); return; }

  // ── WRITE: solo sandbox ──────────────────────────────────────────────────
  console.log('\n[WRITE → sandbox]');
  const prefix = `projected/${rutNorm(k.rut)}`;
  const { data: existing } = await sbx.from('clients').select('id').eq('rut', k.rut).maybeSingle();
  let clientId: string;
  if (existing) { await sbx.from('clients').update(profile).eq('rut', k.rut); clientId = existing.id; console.log('  clients: actualizado', clientId); }
  else { const { data, error } = await sbx.from('clients').insert(profile).select('id').single(); if (error) throw new Error('insert clients: ' + error.message); clientId = data!.id; console.log('  clients: creado', clientId); }

  const paths: Record<string, string> = {};
  if (cmfOk && await up(path.join(STAGE, 'informe_cmf.pdf'), `${prefix}/informe_cmf.pdf`)) paths.informe_cmf_path = `${prefix}/informe_cmf.pdf`;
  if (ctOk && await up(path.join(STAGE, 'carpeta_tributaria.pdf'), `${prefix}/carpeta_tributaria.pdf`)) paths.carpeta_tributaria_path = `${prefix}/carpeta_tributaria.pdf`;
  if (arOk && await up(path.join(STAGE, 'agentes_retenedores.pdf'), `${prefix}/agentes_retenedores.pdf`)) paths.carpeta_retenedores_path = `${prefix}/agentes_retenedores.pdf`;
  if (Object.keys(paths).length) await sbx.from('clients').update(paths).eq('rut', k.rut);
  console.log('  docs principales subidos:', Object.keys(paths).join(', '));

  // Certs → documentos + client_documents (tipo 24 general; el worker resuelve institución por RUT)
  await sbx.from('client_documents').delete().eq('client_id', clientId);
  let nDocs = 0;
  for (let i = 0; i < certFiles.length; i++) {
    const sp = `${prefix}/cert_${i + 1}.pdf`;
    if (!await up(certFiles[i].local, sp)) continue;
    const { error } = await sbx.from('client_documents').insert({ client_id: clientId, document_type: 24, acreditacion_tipo: 'general', institucion_cmf: null, storage_path: sp, filename: certFiles[i].filename });
    if (!error) nDocs++;
  }
  console.log(`  client_documents: ${nDocs} filas (certs tipo 24)`);
  console.log(`\n✔ WRITE completo. client_id=${clientId}. Sandbox listo para el worker (DRY_RUN).`);
  console.log('  ⚠️ Próximo paso (CHECKPOINT con el usuario): encolar job + correr worker contra el portal.');
}

main().catch(e => { console.error('🚨', e instanceof Error ? e.message : e); process.exit(1); });
