import * as dotenv from 'dotenv';
dotenv.config();

import { launchBrowser } from './utils/browser';
import { loginAndNavigateToStep1 } from './automation/login';
import { fillStep1, ClientData } from './automation/step1_personal';
import { supabase } from './utils/supabase';
import { runDaemon } from './worker';
import { fillAllSteps } from './automation/all_steps';
import { getOptimizedPdfPath } from './utils/pdf_optimizer';
import { analyzeTaxCategory } from './utils/pdf_analyzer';
import { analyzeCmfPdf } from './utils/cmf_analyzer';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const rutArg = args.find((a) => a.startsWith('--rut='));
const stepArg = args.find((a) => a.startsWith('--step='));
const modeArg = args.find((a) => a.startsWith('--mode='));

const rut = rutArg?.split('=')[1];
const step = stepArg ? parseInt(stepArg.split('=')[1], 10) : 1;
const mode = modeArg?.split('=')[1];

async function main() {
  if (mode === 'worker') {
    await runDaemon();
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

  if (step !== 1 && step !== 0) {
    console.error(`❌ Error: El paso ${step} no está soportado en este script (solo paso 1 y todos los pasos con 0).`);
    process.exit(1);
  }

  let tributariaLocalPath = '';
  let retenedoresLocalPath = '';
  let tributariaOptimizedPath = '';
  let retenedoresOptimizedPath = '';
  let cmfLocalPath = '';

  if (step === 0) {
    console.log('⏳ Iniciando preparación de archivos para la ejecución completa...');
    
    const tempDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 1. CMF download & validation
    console.log('⏳ Descargando y validando Informe CMF...');
    if (!clientData.informe_cmf_path) {
      console.error('❌ Error: El cliente no tiene informe CMF registrado en la base de datos.');
      process.exit(1);
    }
    cmfLocalPath = path.join(tempDir, `cmf_raw_cli.pdf`);
    const { data: cmfBlob, error: cmfError } = await supabase.storage
      .from('documentos')
      .download(clientData.informe_cmf_path);
    if (cmfError || !cmfBlob) {
      console.error(`❌ Error al descargar CMF: ${cmfError?.message}`);
      process.exit(1);
    }
    fs.writeFileSync(cmfLocalPath, Buffer.from(await cmfBlob.arrayBuffer()));
    
    const cmfResult = await analyzeCmfPdf(cmfLocalPath);
    if (!cmfResult.meets90DaysRequirement || !cmfResult.meetsAmountRequirement) {
      console.error(`❌ Error: El cliente no cumple los requisitos del CMF. Mora 90+: ${cmfResult.meets90DaysRequirement}, Monto: $${cmfResult.directOverdue90Days}`);
      process.exit(1);
    }
    console.log('✓ CMF validado correctamente.');

    // 2. Step 2 files download & compression
    console.log('⏳ Descargando Carpeta Tributaria y Agentes Retenedores...');
    if (!clientData.carpeta_tributaria_path || !clientData.carpeta_retenedores_path) {
      console.error('❌ Error: Falta registrar la ruta de Carpeta Tributaria o de Agentes Retenedores en la tabla clients.');
      process.exit(1);
    }
    tributariaLocalPath = path.join(tempDir, `tributaria_raw_cli.pdf`);
    retenedoresLocalPath = path.join(tempDir, `retenedores_raw_cli.pdf`);
    tributariaOptimizedPath = path.join(tempDir, `tributaria_opt_cli.pdf`);
    retenedoresOptimizedPath = path.join(tempDir, `retenedores_opt_cli.pdf`);

    const { data: tribBlob, error: tribError } = await supabase.storage
      .from('documentos')
      .download(clientData.carpeta_tributaria_path);
    if (tribError || !tribBlob) {
      console.error(`❌ Error al descargar Carpeta Tributaria: ${tribError?.message}`);
      process.exit(1);
    }
    fs.writeFileSync(tributariaLocalPath, Buffer.from(await tribBlob.arrayBuffer()));

    const { data: retBlob, error: retError } = await supabase.storage
      .from('documentos')
      .download(clientData.carpeta_retenedores_path);
    if (retError || !retBlob) {
      console.error(`❌ Error al descargar Agentes Retenedores: ${retError?.message}`);
      process.exit(1);
    }
    fs.writeFileSync(retenedoresLocalPath, Buffer.from(await retBlob.arrayBuffer()));

    console.log('⚖️  Analizando tamaños de archivos y comprimiendo si es necesario...');
    tributariaOptimizedPath = await getOptimizedPdfPath(tributariaLocalPath, tributariaOptimizedPath, console);
    retenedoresOptimizedPath = await getOptimizedPdfPath(retenedoresLocalPath, retenedoresOptimizedPath, console);
  }

  const { browser, page } = await launchBrowser();

  try {
    await loginAndNavigateToStep1(page, clientData.clave_unica_rut, clientData.clave_unica_password, undefined, {
      region: clientData.region,
      comuna: clientData.comuna,
      email: clientData.email,
      telefono: clientData.telefono,
    });
    
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

    if (step === 1) {
      await fillStep1(page, clientFormFields);
    } else if (step === 0) {
      console.log('🕵️‍♂️ Analizando la Carpeta Tributaria para determinar la categoría tributaria...');
      const categoria = await analyzeTaxCategory(tributariaLocalPath);
      
      await fillAllSteps(
        page,
        clientFormFields,
        tributariaOptimizedPath,
        retenedoresOptimizedPath,
        categoria,
        cmfLocalPath,
        supabase,
        clientData.acreditacion_documentos_json ?? [],
        undefined // logger
      );
    }

    console.log('\n✅ Automatización completada exitosamente.\n');
  } catch (error) {
    console.error('\n❌ Automatización fallida:', error);
    process.exit(1);
  } finally {
    await browser.close();
    // Limpieza de archivos temporales
    try {
      if (fs.existsSync(tributariaLocalPath)) fs.unlinkSync(tributariaLocalPath);
      if (fs.existsSync(retenedoresLocalPath)) fs.unlinkSync(retenedoresLocalPath);
      if (fs.existsSync(tributariaOptimizedPath) && tributariaOptimizedPath !== tributariaLocalPath) {
        fs.unlinkSync(tributariaOptimizedPath);
      }
      if (fs.existsSync(retenedoresOptimizedPath) && retenedoresOptimizedPath !== retenedoresLocalPath) {
        fs.unlinkSync(retenedoresOptimizedPath);
      }
      if (fs.existsSync(cmfLocalPath)) fs.unlinkSync(cmfLocalPath);
    } catch {}
  }
}

main();
