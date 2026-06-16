/**
 * Setup perfil Supabase — María Paz Bravo Norambuena (RUT 16.997.909-K).
 *
 * Crea (o actualiza) la fila en `clients`, sube el CMF y la Carpeta Tributaria
 * a Supabase Storage. Usa la ClaveÚnica de Patricio Martini como portal de prueba.
 *
 * Uso: npx ts-node -r dotenv/config casos/maria_paz_bravo/setup_test.ts
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
const CLIENT_RUT = '16.997.909-K';
const STORAGE_PREFIX = 'maria_paz_bravo';

const DOCS_DIR = path.resolve(__dirname);

async function run() {
  console.log('🔧 Setup perfil Supabase — María Paz Bravo Norambuena\n');

  // 1. Crear o actualizar fila en clients
  const { data: existing } = await supabase
    .from('clients')
    .select('id, name')
    .eq('rut', CLIENT_RUT)
    .single();

  let clientId: string;

  if (existing) {
    console.log(`ℹ️  Perfil ya existe: ${existing.name} (${existing.id})`);
    clientId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from('clients')
      .insert({
        name: 'María Paz Bravo Norambuena',
        rut: CLIENT_RUT,
        clave_unica_rut: '21917363-6',                 // Pato Martini (portal de prueba)
        clave_unica_password: process.env.CLAVE_UNICA_PASSWORD,
        carpeta_tributaria_path: null,                  // se actualiza abajo
        carpeta_retenedores_path: null,                 // pendiente
        informe_cmf_path: null,                         // se actualiza abajo
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

  // 2. Subir CMF
  const cmfLocal = path.join(DOCS_DIR, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-12-09T162053.838.pdf');
  const cmfStorage = `${STORAGE_PREFIX}/informe_cmf.pdf`;

  if (!fs.existsSync(cmfLocal)) { console.error(`❌ CMF no encontrado: ${cmfLocal}`); process.exit(1); }

  const { error: cmfUploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(cmfStorage, fs.readFileSync(cmfLocal), { contentType: 'application/pdf', upsert: true });
  if (cmfUploadErr) { console.error('❌ Error subiendo CMF:', cmfUploadErr.message); process.exit(1); }

  const { error: cmfUpdateErr } = await supabase
    .from('clients').update({ informe_cmf_path: cmfStorage }).eq('rut', CLIENT_RUT);
  if (cmfUpdateErr) { console.error('❌ Error actualizando informe_cmf_path:', cmfUpdateErr.message); process.exit(1); }
  console.log(`✓ CMF subido → ${BUCKET}/${cmfStorage}`);

  // 3. Subir Carpeta Tributaria
  const ctLocal = path.join(DOCS_DIR, 'documentos', '03_Tributaria_y_SII', 'Carpeta_Tributaria_Regular (29).pdf');
  const ctStorage = `${STORAGE_PREFIX}/carpeta_tributaria.pdf`;

  if (!fs.existsSync(ctLocal)) {
    console.warn(`⚠️  Carpeta Tributaria no encontrada: ${ctLocal}. Usando la de Patricio Martini.`);
    // Fallback a la CT de Pato si la de María Paz no está (no aplica aquí pues sí existe)
  } else {
    const { error: ctUploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(ctStorage, fs.readFileSync(ctLocal), { contentType: 'application/pdf', upsert: true });
    if (ctUploadErr) { console.error('❌ Error subiendo CT:', ctUploadErr.message); process.exit(1); }

    const { error: ctUpdateErr } = await supabase
      .from('clients').update({ carpeta_tributaria_path: ctStorage }).eq('rut', CLIENT_RUT);
    if (ctUpdateErr) { console.error('❌ Error actualizando carpeta_tributaria_path:', ctUpdateErr.message); process.exit(1); }
    console.log(`✓ Carpeta Tributaria subida → ${BUCKET}/${ctStorage}`);
  }

  // 4. Verificar perfil final
  const { data: profile } = await supabase
    .from('clients')
    .select('id, name, rut, informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path')
    .eq('rut', CLIENT_RUT)
    .single();

  console.log('\n✅ Perfil verificado:');
  console.log(JSON.stringify(profile, null, 2));

  const paths = [profile?.informe_cmf_path, profile?.carpeta_tributaria_path, profile?.carpeta_retenedores_path].filter(Boolean);
  const contaminado = paths.some(p => !p!.startsWith(STORAGE_PREFIX));
  if (contaminado) {
    console.error(`\n🚨 CONTAMINACIÓN detectada — algún path no usa prefijo "${STORAGE_PREFIX}"`);
    process.exit(1);
  }
  console.log(`\n✓ Sin contaminación — todos los paths usan prefijo "${STORAGE_PREFIX}"`);
  console.log(`   CLIENT_ID="${clientId}"`);
}

run().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
