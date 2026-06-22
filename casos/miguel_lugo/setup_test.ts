/**
 * Crea/actualiza el perfil de Miguel Ángel Lugo Acosta en `clients` (sandbox) con
 * los datos personales del Paso 1 (extraídos de la solicitud de la abogada) y las
 * credenciales de portal de Patricio Martini (login con la ClaveÚnica de Pato → el
 * borrador cae en la renegociación de prueba de Pato, NO en la solicitud real de Miguel).
 *
 * Caso de comparación contra la abogada (P0.d). Solo perfil; los documentos van con
 * upload_documents.ts (cuando lleguen). Si hay PDFs en documentos/, los sube igual.
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/miguel_lugo/setup_test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const BUCKET = 'documentos';
const PREFIX = 'miguel_lugo';
const D = path.resolve(__dirname, 'documentos');

// ⚠️ COMPLETAR: RUT real de Miguel (no aparece en los screenshots). Formato XX.XXX.XXX-X.
//    Login en el portal usa PORTAL_RUT (ClaveÚnica de Pato), NO este RUT.
const CLIENT_RUT = '26.625.555-1';
const PORTAL_RUT = '21917363-6'; // ClaveÚnica de Patricio Martini (.env: CLAVE_UNICA_PASSWORD)

const CLIENT_NAME = 'Miguel Angel Lugo Acosta';

// Datos personales del Paso 1 (de la solicitud de la abogada). Convención:
// estado_civil = VALUE del <select>; profesion/ocupacion/region/comuna = LABEL exacto
// (comuna en MAYÚSCULA); telefono_prefijo = value (= label).
const PERSONAL = {
  nacionalidad: 'VENEZOLANO',
  fecha_nacimiento: '25/03/1980',
  estado_civil: '1',                       // Soltero(a)
  regimen_patrimonial: null,               // no aplica (soltero)
  profesion_oficio: 'Ingenieros civil civil',   // value 120
  ocupacion: 'Trabajador/a dependiente',        // value 13
  direccion: 'Av Salesianos 1166 dpto 1406',
  region: 'Región Metropolitana',          // value 13
  comuna: 'SAN MIGUEL',                    // value 308
  email: 'benjamin@abogadoricardopuelma.com',
  telefono_prefijo: '56',
  telefono: '952366753',
};

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

  console.log(`🔧 Setup perfil Supabase — ${CLIENT_NAME} (rut ${CLIENT_RUT}, login ${PORTAL_RUT})\n`);

  const row = {
    name: CLIENT_NAME,
    rut: CLIENT_RUT,
    clave_unica_rut: PORTAL_RUT,
    clave_unica_password: claveUnicaPassword,
    ...PERSONAL,
  };

  // Upsert por rut: actualiza si existe, inserta si no.
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

  // Subir documentos si están presentes (opcional en este paso).
  const docs: Array<{ file: string; column: string; label: string }> = [
    { file: 'informe_cmf.pdf',        column: 'informe_cmf_path',        label: 'CMF' },
    { file: 'carpeta_tributaria.pdf', column: 'carpeta_tributaria_path', label: 'Carpeta Tributaria' },
    { file: 'agentes_retenedores.pdf', column: 'carpeta_retenedores_path', label: 'Agentes Retenedores' },
  ];

  const pathUpdates: Record<string, string> = {};
  for (const d of docs) {
    const local = path.join(D, d.file);
    if (!fs.existsSync(local)) {
      console.log(`⏭️  ${d.label}: no presente en documentos/ (se subirá luego)`);
      continue;
    }
    const storagePath = `${PREFIX}/${d.file}`;
    const { error } = await supabase.storage.from(BUCKET)
      .upload(storagePath, fs.readFileSync(local), { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`Error subiendo ${d.label}: ${error.message}`);
    pathUpdates[d.column] = storagePath;
    console.log(`✓ ${d.label} → ${BUCKET}/${storagePath}`);
  }

  if (Object.keys(pathUpdates).length > 0) {
    const { error } = await supabase.from('clients').update(pathUpdates).eq('rut', CLIENT_RUT);
    if (error) throw new Error(`Error actualizando paths: ${error.message}`);
  }

  const { data: profile } = await supabase.from('clients')
    .select('id, name, rut, clave_unica_rut, nacionalidad, fecha_nacimiento, estado_civil, profesion_oficio, ocupacion, region, comuna, email, telefono')
    .eq('rut', CLIENT_RUT).single();

  console.log('\n✅ Perfil verificado:');
  console.log(JSON.stringify(profile, null, 2));
  console.log(`\n   CLIENT_ID="${clientId}"`);
}

main().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
