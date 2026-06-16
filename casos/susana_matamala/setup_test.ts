/**
 * Setup de perfil Supabase para Susana Valeria Matamala Fuica (RUT 16.983.419-9).
 *
 * Crea (o actualiza) la fila en `clients` usando las credenciales de Patricio Martini
 * (portal de prueba). Sube el CMF a Supabase Storage y actualiza `informe_cmf_path`.
 * La Carpeta Tributaria está pendiente de descarga del SII (ver analisis_deudas.md § VI).
 *
 * Uso: npx ts-node -r dotenv/config casos/susana_matamala/setup_test.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const BUCKET = 'documentos';
const SUSANA_RUT = '16.983.419-9';
const STORAGE_PREFIX = 'susana_matamala';
const CASE_DIR = path.resolve(__dirname);

async function run() {
  console.log('🔧 Setup perfil Supabase — Susana Valeria Matamala Fuica\n');

  // 1. Crear o actualizar fila en clients
  const { data: existing } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', SUSANA_RUT)
    .single();

  let clientId: string;

  if (existing) {
    console.log(`ℹ️  Perfil ya existe: ${existing.name} (${existing.id})`);
    clientId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from('clients')
      .insert({
        name: 'Susana Valeria Matamala Fuica',
        rut: SUSANA_RUT,
        clave_unica_rut: '21917363-6',                   // RUT de Pato Martini (portal de prueba)
        clave_unica_password: process.env.CLAVE_UNICA_PASSWORD,
        carpeta_tributaria_path: null,                    // pendiente — SII no descargado aún
        carpeta_retenedores_path: null,                   // pendiente
        informe_cmf_path: null,                           // se actualiza abajo
      })
      .select('id, name')
      .single();

    if (error || !inserted) {
      console.error('❌ Error creando perfil:', error?.message);
      process.exit(1);
    }
    console.log(`✓ Perfil creado: ${inserted.name} (${inserted.id})`);
    clientId = inserted.id;
  }

  // 2. Subir CMF y actualizar informe_cmf_path
  const cmfLocal = path.join(CASE_DIR, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf.pdf');
  const cmfStoragePath = `${STORAGE_PREFIX}/informe_cmf.pdf`;

  if (!fs.existsSync(cmfLocal)) {
    console.error(`❌ CMF no encontrado: ${cmfLocal}`);
    process.exit(1);
  }

  const cmfBuffer = fs.readFileSync(cmfLocal);
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(cmfStoragePath, cmfBuffer, { contentType: 'application/pdf', upsert: true });

  if (uploadErr) {
    console.error('❌ Error subiendo CMF:', uploadErr.message);
    process.exit(1);
  }

  const { error: updateErr } = await supabase
    .from('clients')
    .update({ informe_cmf_path: cmfStoragePath })
    .eq('rut', SUSANA_RUT);

  if (updateErr) {
    console.error('❌ Error actualizando informe_cmf_path:', updateErr.message);
    process.exit(1);
  }
  console.log(`✓ CMF subido → ${BUCKET}/${cmfStoragePath}`);

  // 3. Verificar aislamiento (sin paths cruzados)
  const { data: profile } = await supabase
    .from('clients')
    .select('id, name, rut, informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path')
    .eq('rut', SUSANA_RUT)
    .single();

  console.log('\n✅ Perfil verificado:');
  console.log(JSON.stringify(profile, null, 2));

  const paths = [
    profile?.informe_cmf_path,
    profile?.carpeta_tributaria_path,
    profile?.carpeta_retenedores_path,
  ].filter(Boolean);

  const contaminado = paths.some(p => !p!.startsWith(STORAGE_PREFIX));
  if (contaminado) {
    console.error('\n🚨 CONTAMINACIÓN DETECTADA: algún path no empieza con', STORAGE_PREFIX);
    process.exit(1);
  }
  console.log(`\n✓ Sin contaminación — todos los paths usan prefijo "${STORAGE_PREFIX}"`);
  console.log(`\n⚠️  Carpeta Tributaria: pendiente de descarga del SII.`);
  console.log(`   CLIENT_ID="${clientId}"`);
}

run().catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
