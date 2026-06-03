import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
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
    logger.log(`✓ El archivo pesa 10 MB o menos. No requiere compresión.`);
    return localPath;
  }

  logger.log(`⚠️  El archivo excede los 10 MB (${(stats.size / (1024 * 1024)).toFixed(2)} MB). Iniciando compresión con Ghostscript...`);
  try {
    // 1. Verificar si Ghostscript está disponible
    await execAsync('which gs');

    // 2. Ejecutar la compresión con perfil /ebook (150 DPI)
    const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${localPath}"`;
    await execAsync(command);

    if (fs.existsSync(outputPath)) {
      const compStats = fs.statSync(outputPath);
      logger.log(`✓ Archivo comprimido con éxito: ${(compStats.size / (1024 * 1024)).toFixed(2)} MB`);
      return outputPath;
    }
  } catch (err: any) {
    logger.error(`❌ Falló la compresión con Ghostscript: ${err.message || err}. Se procederá con el archivo original.`);
  }

  return localPath; // Fallback al original en caso de error o falta de gs
}
