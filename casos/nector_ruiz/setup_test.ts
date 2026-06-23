/**
 * Crea/actualiza el perfil de Néctor Fernando Ruiz Abaroa en `clients` (sandbox) con
 * los datos personales del Paso 1 (de la solicitud de la abogada) y las credenciales
 * de portal de Patricio Martini (login con la ClaveÚnica de Pato → el borrador cae en
 * la renegociación de prueba de Pato, NO en la solicitud real de Néctor).
 *
 * Caso de comparación contra la abogada (P0.d). SOLO perfil — los documentos los carga
 * el usuario por el dashboard de Vercel (client_documents + Storage + job encolado).
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/nector_ruiz/setup_test.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

// ⚠️ COMPLETAR: RUT real de Néctor (identificador en clients). Formato XX.XXX.XXX-X.
//    Login en el portal usa PORTAL_RUT (ClaveÚnica de Pato), NO este RUT.
const CLIENT_RUT = '15.420.073-8';
const PORTAL_RUT = '21917363-6'; // ClaveÚnica de Patricio Martini (.env: CLAVE_UNICA_PASSWORD)

const CLIENT_NAME = 'Néctor Fernando Ruiz Abaroa';

// Datos personales del Paso 1 (de la solicitud de la abogada). Convención:
// estado_civil = VALUE del <select>; profesion/ocupacion/region/comuna = LABEL exacto
// (comuna en MAYÚSCULA, verificado contra supabase/portal_select_values.json);
// telefono_prefijo = value (= label).
const PERSONAL = {
  nacionalidad: 'Chilena',
  fecha_nacimiento: '24/02/1982',
  estado_civil: '1',                              // Soltero(a)
  regimen_patrimonial: null,                      // no aplica (soltero)
  profesion_oficio: 'Ingenieros civiles informáticos',
  ocupacion: 'Trabajador/a dependiente',
  direccion: 'Gauss 5156 san miguel',
  region: 'Región Metropolitana',                 // value 13
  comuna: 'SAN MIGUEL',                           // value 308
  email: 'benjamin@abogadoricardopuelma.com',
  telefono_prefijo: '56',
  telefono: '935017354',
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

  const { data: profile } = await supabase.from('clients')
    .select('id, name, rut, clave_unica_rut, nacionalidad, fecha_nacimiento, estado_civil, profesion_oficio, ocupacion, direccion, region, comuna, email, telefono_prefijo, telefono')
    .eq('rut', CLIENT_RUT).single();

  console.log('\n✅ Perfil verificado:');
  console.log(JSON.stringify(profile, null, 2));
  console.log(`\n   CLIENT_ID="${clientId}"`);
  console.log('   Ahora cargá la carpeta de documentos por el dashboard de Vercel.');
}

main().catch(err => { console.error('🚨', (err as Error).message); process.exit(1); });
