import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
// El portal declara 20 MB como tamaño máximo ("Formato soportado: .jpg, .docx, .pdf.
// Tamaño máximo 20 MB" en verDeclaraciones/verAcreedores). Con el umbral en 10 MB se
// recomprimía a 150 DPI documentos que el portal aceptaba tal cual, degradando escaneos
// que después tiene que leer la Superintendencia.
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB (límite real del portal)

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

/**
 * Busca el ejecutable de Ghostscript (gs) en rutas conocidas de forma robusta.
 */
function findGhostscript(): string | null {
  const knownPaths = [
    '/opt/homebrew/bin/gs',  // Mac ARM
    '/usr/local/bin/gs',      // Mac Intel
    '/usr/bin/gs',            // Linux
  ];
  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Obtiene la ruta del ejecutable de Ghostscript usando rutas conocidas o which.
 */
async function getGhostscriptPath(): Promise<string> {
  const localGs = findGhostscript();
  if (localGs) return localGs;

  try {
    const { stdout } = await execAsync('which gs');
    if (stdout.trim()) return stdout.trim();
  } catch {
    // ignore
  }

  throw new Error('Ejecutable gs (Ghostscript) no encontrado. Asegúrate de instalarlo con: brew install ghostscript');
}

/**
 * Comprime un archivo PDF si excede el límite de peso especificado de 10 MB.
 * Retorna la ruta del archivo final a utilizar.
 */
export async function getOptimizedPdfPath(
  localPath: string,
  outputPath: string,
  logger: SimpleLogger
): Promise<string> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`El archivo de entrada no existe: ${localPath}`);
  }

  const stats = fs.statSync(localPath);
  logger.log(`→ Tamaño de archivo: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);

  if (stats.size <= MAX_FILE_SIZE_BYTES) {
    logger.log(`✓ El archivo pesa 20 MB o menos. No requiere compresión.`);
    return localPath;
  }

  logger.log(`⚠️  El archivo excede los 20 MB (${(stats.size / (1024 * 1024)).toFixed(2)} MB). Iniciando compresión con Ghostscript...`);
  try {
    // 1. Obtener ruta ejecutable gs
    const gsPath = await getGhostscriptPath();
    logger.log(`🔍 Usando ejecutable de Ghostscript en: ${gsPath}`);

    // 2. Ejecutar la compresión con perfil /ebook (150 DPI)
    const command = `"${gsPath}" -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${localPath}"`;
    await execAsync(command);

    if (fs.existsSync(outputPath)) {
      const compStats = fs.statSync(outputPath);
      logger.log(`✓ Archivo comprimido con éxito: ${(compStats.size / (1024 * 1024)).toFixed(2)} MB`);
      // Si SIGUE por encima del límite del portal, fallar con un mensaje claro: subirlo termina
      // en un timeout opaco ("Timeout waiting for #descargaCarpetaTributaria") que no dice nada.
      if (compStats.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(
          `El PDF sigue pesando ${(compStats.size / (1024 * 1024)).toFixed(2)} MB después de comprimir, por encima del máximo de 20 MB del portal. Hay que reducirlo o dividirlo a mano.`
        );
      }
      return outputPath;
    }
    logger.error('❌ Ghostscript terminó sin error pero no generó el archivo comprimido. Se procederá con el original (el portal puede rechazarlo).');
  } catch (err: any) {
    if (/sigue pesando/.test(err?.message ?? '')) throw err; // límite del portal: no silenciar
    logger.error(`❌ Falló la compresión con Ghostscript: ${err.message || err}. Se procederá con el archivo original (el portal puede rechazarlo por tamaño).`);
  }

  return localPath; // Fallback al original en caso de error o falta de gs
}
