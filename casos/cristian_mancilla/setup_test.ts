/**
 * Crea/actualiza el perfil de Cristian Alberto Mancilla Medina en `clients` (sandbox)
 * con los datos personales del Paso 1 y sube TODOS sus documentos:
 *   - CMF / Carpeta Tributaria / Agentes Retenedores → columnas *_path de clients
 *   - certificados (acreedores_cmf + acreedores_no_cmf) → Storage + client_documents
 *
 * Login en el portal con la ClaveÚnica de Patricio Martini (PORTAL_RUT) → el borrador
 * cae en la renegociación de prueba de Pato, NO en la solicitud real de Cristian.
 *
 * Caso de comparación contra la abogada (P0.d). Corre SIN el dashboard de Vercel
 * (iterable + control total del Paso 1 para un cliente fuera de la RM: Valdivia / Los Ríos).
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/cristian_mancilla/setup_test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const BUCKET = 'documentos';
const PREFIX = 'cristian_mancilla';
const D = path.resolve(__dirname, 'documentos');

const CLIENT_RUT = '16.587.870-1';        // identificador del cliente en clients
const PORTAL_RUT = '21917363-6';          // ClaveÚnica de Patricio Martini (.env: CLAVE_UNICA_PASSWORD)
const CLIENT_NAME = 'Cristian Alberto Mancilla Medina';

// Datos personales del Paso 1. Convención: estado_civil = VALUE del <select>;
// profesion/ocupacion/region/comuna = LABEL exacto (comuna en MAYÚSCULA);
// telefono_prefijo = value. ⚠️ Cristian está FUERA de la RM (Valdivia / Los Ríos):
// region "Región de los Ríos" (value 14, sí está en el JSON); comuna "VALDIVIA"
// (NO está en portal_select_values.json — solo RM — pero el portal sí la tiene;
// selectBootstrap matchea por value O label contra las opciones reales del portal).
// Campos no presentes en el análisis (fecha_nac., estado civil, profesión exacta,
// teléfono) usan defaults seguros: NO afectan la comparación (el foco es el Paso 3,
// acreedores) y el borrador es el de prueba de Pato.
const PERSONAL = {
  nacionalidad: 'Chilena',
  fecha_nacimiento: '01/01/1990',          // placeholder — step1 lo omite (el portal lo autocompleta)
  estado_civil: '1',                       // Soltero(a) — default seguro (no exige régimen)
  regimen_patrimonial: null,
  profesion_oficio: 'Otros',               // value 9999 — consultor científico/ambiental sin match exacto
  ocupacion: 'Trabajador/a independiente', // value 14 — boletas de honorarios (2ª categoría)
  direccion: 'Reina Sofía 328, Valdivia',
  region: 'Región de los Ríos',            // value 14
  comuna: 'VALDIVIA',
  email: 'benjamin@abogadoricardopuelma.com', // email del estudio (no el del cliente real)
  telefono_prefijo: '56',
  telefono: '912345678',                   // placeholder
};

// Certificados → client_documents. Todos tipo 24 (general) / acreditacion_tipo 'general';
// institucion_cmf se deja NULL → lo deriva el resolver por RUT (cert_institution_resolver).
// La fase de adjunción del Paso 3 fuerza tipo 22/23 según corresponda (260 = 22+23, 261 = 22).
const CERT_DIRS = ['acreedores_cmf', 'acreedores_no_cmf'];

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

  console.log(`🔧 Setup — ${CLIENT_NAME} (rut ${CLIENT_RUT}, login ${PORTAL_RUT})\n`);

  const row = {
    name: CLIENT_NAME,
    rut: CLIENT_RUT,
    clave_unica_rut: PORTAL_RUT,
    clave_unica_password: claveUnicaPassword,
    ...PERSONAL,
  };

  // --- Perfil (upsert por rut) ---
  const { data: existing } = await supabase
    .from('clients').select('id, name').eq('rut', CLIENT_RUT).maybeSingle();

  let clientId: string;
  if (existing) {
    const { error } = await supabase.from('clients').update(row).eq('rut', CLIENT_RUT);
    if (error) throw new Error(`Error actualizando perfil: ${error.message}`);
    clientId = existing.id;
    console.log(`ℹ️  Perfil existente actualizado: ${CLIENT_NAME} (${clientId})`);
  } else {
    const { data: inserted, error } = await supabase
      .from('clients').insert(row).select('id, name').single();
    if (error || !inserted) throw new Error(`Error creando perfil: ${error?.message}`);
    clientId = inserted.id;
    console.log(`✓ Perfil creado: ${inserted.name} (${clientId})`);
  }

  // --- Documentos principales → columnas *_path ---
  const mainDocs: Array<{ local: string; column: string; storage: string; label: string }> = [
    { local: path.join(D, '02_Informe_CMF', 'informe_deudas_16587870-1.pdf'), column: 'informe_cmf_path',        storage: `${PREFIX}/informe_cmf.pdf`,        label: 'CMF' },
    { local: path.join(D, '03_Tributaria_y_SII', 'carpeta_tributaria.pdf'),   column: 'carpeta_tributaria_path', storage: `${PREFIX}/carpeta_tributaria.pdf`, label: 'Carpeta Tributaria' },
    { local: path.join(D, '03_Tributaria_y_SII', 'agentes_retenedores.pdf'),  column: 'carpeta_retenedores_path', storage: `${PREFIX}/agentes_retenedores.pdf`, label: 'Agentes Retenedores' },
  ];

  const pathUpdates: Record<string, string> = {};
  for (const d of mainDocs) {
    if (!fs.existsSync(d.local)) {
      console.log(`⏭️  ${d.label}: no presente (${d.local})`);
      continue;
    }
    const { error } = await supabase.storage.from(BUCKET)
      .upload(d.storage, fs.readFileSync(d.local), { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`Error subiendo ${d.label}: ${error.message}`);
    pathUpdates[d.column] = d.storage;
    console.log(`✓ ${d.label} → ${BUCKET}/${d.storage}`);
  }
  if (Object.keys(pathUpdates).length > 0) {
    const { error } = await supabase.from('clients').update(pathUpdates).eq('rut', CLIENT_RUT);
    if (error) throw new Error(`Error actualizando paths: ${error.message}`);
  }

  // --- Certificados → client_documents (idempotente: limpia antes) ---
  const { error: delErr } = await supabase.from('client_documents').delete().eq('client_id', clientId);
  if (delErr) throw new Error(`Error limpiando client_documents: ${delErr.message}`);

  const certRows: Array<Record<string, unknown>> = [];
  for (const dir of CERT_DIRS) {
    const dirPath = path.join(D, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const filename of fs.readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.pdf')).sort()) {
      const local = path.join(dirPath, filename);
      const storagePath = `${PREFIX}/certs/${filename}`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(storagePath, fs.readFileSync(local), { contentType: 'application/pdf', upsert: true });
      if (error) throw new Error(`Error subiendo cert ${filename}: ${error.message}`);
      certRows.push({
        client_id: clientId,
        document_type: 24,
        acreditacion_tipo: 'general',
        institucion_cmf: null,
        storage_path: storagePath,
        filename,
        uploaded_at: new Date().toISOString(),
      });
      console.log(`✓ cert ${dir}/${filename} → ${BUCKET}/${storagePath}`);
    }
  }
  if (certRows.length > 0) {
    const { error } = await supabase.from('client_documents').insert(certRows);
    if (error) throw new Error(`Error insertando client_documents: ${error.message}`);
    console.log(`✓ ${certRows.length} certificados registrados en client_documents`);
  }

  const { data: profile } = await supabase.from('clients')
    .select('id, name, rut, clave_unica_rut, region, comuna, informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path')
    .eq('rut', CLIENT_RUT).single();

  console.log('\n✅ Perfil verificado:');
  console.log(JSON.stringify(profile, null, 2));
  console.log(`\n   CLIENT_ID="${clientId}"  RUT="${CLIENT_RUT}"`);
}

main().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
