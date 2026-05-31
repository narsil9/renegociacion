import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load .env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function insertClient() {
  console.log('🤖 Leyendo datos de prueba del .env...');

  const clientData = {
    rut: process.env.CLAVE_UNICA_RUT,
    name: 'Patricio Martini (Prueba)',
    clave_unica_rut: process.env.CLAVE_UNICA_RUT,
    clave_unica_password: process.env.CLAVE_UNICA_PASSWORD,
    nacionalidad: process.env.PERSONA_NACIONALIDAD,
    fecha_nacimiento: process.env.PERSONA_FECHA_NACIMIENTO,
    estado_civil: process.env.PERSONA_ESTADO_CIVIL,
    regimen_patrimonial: process.env.PERSONA_REGIMEN_PATRIMONIAL || null,
    profesion_oficio: process.env.PERSONA_PROFESION_OFICIO,
    ocupacion: process.env.PERSONA_OCUPACION,
    direccion: process.env.PERSONA_DIRECCION,
    region: process.env.PERSONA_REGION,
    comuna: process.env.PERSONA_COMUNA,
    email: process.env.PERSONA_EMAIL,
    telefono_prefijo: process.env.PERSONA_TELEFONO_PREFIJO,
    telefono: process.env.PERSONA_TELEFONO,
  };

  if (!clientData.rut || !clientData.clave_unica_password) {
    console.error('❌ Error: Faltan credenciales de ClaveÚnica en el .env');
    process.exit(1);
  }

  console.log(`→ Insertando cliente con RUT: ${clientData.rut} en Supabase...`);

  // Insertar o actualizar (upsert) basado en la columna única 'rut'
  const { data, error } = await supabase
    .from('clients')
    .upsert(clientData, { onConflict: 'rut' })
    .select();

  if (error) {
    console.error('❌ Error al insertar cliente:', error.message);
  } else {
    console.log('✓ Cliente insertado/actualizado con éxito en la tabla "clients":', data[0].id);
  }
}

insertClient();
