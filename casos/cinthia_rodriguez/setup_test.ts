/**
 * Crea el perfil de Cinthia Lisbet Rodríguez Vargas en Supabase y sube CMF + CT + Retenedores.
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/cinthia_rodriguez/setup_test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const BUCKET = 'documentos';
const CLIENT_RUT = '24.950.897-7';
const CLIENT_NAME = 'Cinthia Lisbet Rodríguez Vargas';
const PORTAL_RUT = '21917363-6';
const PREFIX = 'cinthia_rodriguez';
const D = path.resolve(__dirname, 'documentos');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}

async function main() {
  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );
  const claveUnicaPassword = requireEnv('CLAVE_UNICA_PASSWORD');

  console.log(`🔧 Setup perfil Supabase — ${CLIENT_NAME}\n`);

  const cmfPath     = path.join(D, 'informe_cmf.pdf');
  const ctPath      = path.join(D, 'carpeta_tributaria.pdf');
  const retPath     = path.join(D, 'agentes_retenedores.pdf');

  for (const p of [cmfPath, ctPath, retPath]) {
    if (!fs.existsSync(p)) throw new Error(`Archivo no encontrado: ${p}`);
  }

  // Perfil
  const { data: existing } = await supabase
    .from('clients').select('id, name').eq('rut', CLIENT_RUT).maybeSingle();

  let clientId: string;
  if (existing) {
    console.log(`ℹ️  Perfil ya existe: ${existing.name} (${existing.id})`);
    clientId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from('clients')
      .insert({
        name: CLIENT_NAME,
        rut: CLIENT_RUT,
        clave_unica_rut: PORTAL_RUT,
        clave_unica_password: claveUnicaPassword,
        carpeta_tributaria_path: null,
        carpeta_retenedores_path: null,
        informe_cmf_path: null,
      })
      .select('id, name').single();
    if (error || !inserted) throw new Error(`Error creando perfil: ${error?.message}`);
    console.log(`✓ Perfil creado: ${inserted.name} (${inserted.id})`);
    clientId = inserted.id;
  }

  // Subir CMF
  const cmfStoragePath = `${PREFIX}/informe_cmf.pdf`;
  const { error: cmfErr } = await supabase.storage.from(BUCKET)
    .upload(cmfStoragePath, fs.readFileSync(cmfPath), { contentType: 'application/pdf', upsert: true });
  if (cmfErr) throw new Error(`Error subiendo CMF: ${cmfErr.message}`);
  console.log(`✓ CMF → ${BUCKET}/${cmfStoragePath}`);

  // Subir CT
  const ctStoragePath = `${PREFIX}/carpeta_tributaria.pdf`;
  const { error: ctErr } = await supabase.storage.from(BUCKET)
    .upload(ctStoragePath, fs.readFileSync(ctPath), { contentType: 'application/pdf', upsert: true });
  if (ctErr) throw new Error(`Error subiendo CT: ${ctErr.message}`);
  console.log(`✓ Carpeta Tributaria → ${BUCKET}/${ctStoragePath}`);

  // Subir Agentes Retenedores
  const retStoragePath = `${PREFIX}/agentes_retenedores.pdf`;
  const { error: retErr } = await supabase.storage.from(BUCKET)
    .upload(retStoragePath, fs.readFileSync(retPath), { contentType: 'application/pdf', upsert: true });
  if (retErr) throw new Error(`Error subiendo Retenedores: ${retErr.message}`);
  console.log(`✓ Agentes Retenedores → ${BUCKET}/${retStoragePath}`);

  // Actualizar perfil
  const { error: updateErr } = await supabase.from('clients').update({
    informe_cmf_path: cmfStoragePath,
    carpeta_tributaria_path: ctStoragePath,
    carpeta_retenedores_path: retStoragePath,
  }).eq('rut', CLIENT_RUT);
  if (updateErr) throw new Error(`Error actualizando perfil: ${updateErr.message}`);

  const { data: profile } = await supabase.from('clients')
    .select('id, name, rut, informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path')
    .eq('rut', CLIENT_RUT).single();

  console.log('\n✅ Perfil verificado:');
  console.log(JSON.stringify(profile, null, 2));
  console.log(`\n   CLIENT_ID="${clientId}"`);
  console.log('\nSiguiente paso:');
  console.log('  npx ts-node -r dotenv/config casos/cinthia_rodriguez/upload_documents.ts');
}

main().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
