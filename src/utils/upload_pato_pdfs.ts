import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Faltan credenciales en el .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Paths to the files in project root
const projectDir = process.cwd();
const tributariaFileName = '20260602-182811_carpeta_tributaria.pdf';
const retenedoresFileName = '20260602-183449_agente_retenedor_2026.pdf';

const tributariaPath = path.join(projectDir, tributariaFileName);
const retenedoresPath = path.join(projectDir, retenedoresFileName);

const targetRut = '21917363-6';

async function uploadFile(localPath: string, destPath: string): Promise<string | null> {
  if (!fs.existsSync(localPath)) {
    console.error(`❌ El archivo no existe localmente: ${localPath}`);
    return null;
  }

  console.log(`⏳ Leyendo archivo local: ${path.basename(localPath)}...`);
  const fileBuffer = fs.readFileSync(localPath);

  console.log(`⏳ Subiendo a Supabase Storage: bucket "documentos", ruta "${destPath}"...`);
  const { data, error } = await supabase.storage
    .from('documentos')
    .upload(destPath, fileBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) {
    console.error(`❌ Error al subir ${path.basename(localPath)}:`, error.message);
    return null;
  }

  console.log(`✓ Archivo subido con éxito: ${data.path}`);
  return data.path;
}

async function run() {
  console.log('🏁 Iniciando proceso de carga de PDFs a Supabase...');

  // 1. Upload Carpeta Tributaria
  const tributariaDest = 'patricio_martini/carpeta_tributaria.pdf';
  const uploadedTributariaPath = await uploadFile(tributariaPath, tributariaDest);

  // 2. Upload Agentes Retenedores
  const retenedoresDest = 'patricio_martini/agente_retenedor_2026.pdf';
  const uploadedRetenedoresPath = await uploadFile(retenedoresPath, retenedoresDest);

  if (!uploadedTributariaPath || !uploadedRetenedoresPath) {
    console.error('❌ Proceso cancelado debido a errores en la carga de archivos.');
    process.exit(1);
  }

  // 3. Update columns in 'clients' table
  console.log(`⏳ Actualizando registro del cliente con RUT ${targetRut} en la tabla "clients"...`);
  const { data, error } = await supabase
    .from('clients')
    .update({
      carpeta_tributaria_path: uploadedTributariaPath,
      carpeta_retenedores_path: uploadedRetenedoresPath
    })
    .eq('rut', targetRut)
    .select();

  if (error) {
    console.error('❌ Error al actualizar la tabla clients:', error.message);
  } else {
    console.log('🎉 ¡Proceso completado con éxito!');
    console.log('Registro actualizado en la base de datos:');
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
