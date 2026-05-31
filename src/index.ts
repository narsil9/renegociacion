import * as dotenv from 'dotenv';
dotenv.config();

import { launchBrowser } from './utils/browser';
import { loginAndNavigateToStep1 } from './automation/login';
import { fillStep1, ClientData } from './automation/step1_personal';
import { supabase } from './utils/supabase';
import { runDaemon } from './worker';

const args = process.argv.slice(2);
const rutArg = args.find((a) => a.startsWith('--rut='));
const stepArg = args.find((a) => a.startsWith('--step='));
const modeArg = args.find((a) => a.startsWith('--mode='));

const rut = rutArg?.split('=')[1];
const step = stepArg ? parseInt(stepArg.split('=')[1], 10) : 1;
const mode = modeArg?.split('=')[1];

async function main() {
  if (mode === 'worker') {
    runDaemon();
    return;
  }

  if (!rut) {
    console.error('Uso:');
    console.error('  1. Modo Daemon Worker:  npm run automate -- --mode=worker');
    console.error('  2. Modo CLI Directo:    npm run automate -- --rut=<RUT> --step=<PASO>');
    console.error('Ejemplo CLI:             npm run automate -- --rut=21917363-6 --step=1');
    process.exit(1);
  }

  console.log(`\n🤖 Iniciando automatización directa CLI | RUT: ${rut} | Paso: ${step}\n`);

  // 1. Obtener datos del cliente de Supabase
  console.log(`→ Buscando datos del cliente con RUT ${rut} en Supabase...`);
  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('rut', rut)
    .limit(1);

  if (error) {
    console.error(`❌ Error al obtener datos del cliente de Supabase:`, error.message);
    process.exit(1);
  }

  let clientData: any = null;

  if (clients && clients.length > 0) {
    clientData = clients[0];
    console.log(`✓ Datos del cliente encontrados en Supabase.`);
  } else {
    // Intentar fallback a variables de entorno si el RUT en .env coincide
    const envRut = process.env.CLAVE_UNICA_RUT;
    if (envRut === rut) {
      console.log(`⚠️  Cliente no encontrado en Supabase. Cargando fallback de .env...`);
      clientData = {
        rut: process.env.CLAVE_UNICA_RUT,
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
    } else {
      console.error(`❌ Error: No se encontraron datos para el RUT ${rut} en Supabase ni en el .env`);
      process.exit(1);
    }
  }

  if (step !== 1) {
    console.error(`❌ Error: El paso ${step} no está soportado en este script (solo paso 1).`);
    process.exit(1);
  }

  const { browser, page } = await launchBrowser();

  try {
    await loginAndNavigateToStep1(page, clientData.clave_unica_rut, clientData.clave_unica_password);
    
    const clientFormFields: ClientData = {
      nacionalidad: clientData.nacionalidad,
      fecha_nacimiento: clientData.fecha_nacimiento,
      estado_civil: clientData.estado_civil,
      regimen_patrimonial: clientData.regimen_patrimonial,
      profesion_oficio: clientData.profesion_oficio,
      ocupacion: clientData.ocupacion,
      direccion: clientData.direccion,
      region: clientData.region,
      comuna: clientData.comuna,
      email: clientData.email,
      telefono_prefijo: clientData.telefono_prefijo,
      telefono: clientData.telefono,
    };

    await fillStep1(page, clientFormFields);

    console.log('\n✅ Automatización completada exitosamente.\n');
  } catch (error) {
    console.error('\n❌ Automatización fallida:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
