import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

export type TaxCategory = 'primera' | 'segunda' | 'ninguna';

interface SimpleLogger {
  log(msg: string): void;
}

/**
 * Extracts all text from a PDF file using pdftotext.
 */
export async function extractTextFromPdf(pdfPath: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Archivo PDF no encontrado para extracción de texto: ${pdfPath}`);
  }

  const pdftotextPath = '/opt/homebrew/bin/pdftotext';
  try {
    const { stdout } = await execFileAsync(pdftotextPath, [pdfPath, '-'], { 
      encoding: 'utf8', 
    });
    return stdout;
  } catch (err: any) {
    throw new Error(`Error al ejecutar pdftotext en ${pdfPath}: ${err.message || err}`);
  }
}

/**
 * Analyzes the Carpeta Tributaria text to determine the client's tax category.
 */
export async function analyzeTaxCategory(
  pdfPath: string, 
  logger?: SimpleLogger
): Promise<TaxCategory> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  log(`📊 Analizando Carpeta Tributaria en: ${pdfPath}...`);
  const text = await extractTextFromPdf(pdfPath);

  // 1. Search for the specific label "Categoría Tributaria:" under "Datos del Contribuyente"
  const labelRegex = /Categor[íi]a\s+Tributaria\s*:/i;
  const matchIndex = text.search(labelRegex);
  
  if (matchIndex !== -1) {
    // Get a small window of text after the label
    const labelMatch = text.match(labelRegex);
    const startIndex = matchIndex + (labelMatch ? labelMatch[0].length : 0);
    const chunk = text.substring(startIndex, startIndex + 150);
    
    const hasFirst = /Primera\s+Categor[íi]a|1ra\s+Categor[íi]a/i.test(chunk);
    const hasSecond = /Segunda\s+Categor[íi]a|2da\s+Categor[íi]a/i.test(chunk);
    
    log(`🔍 Sección principal de categoría encontrada. Contenido cercano: ${JSON.stringify(chunk.trim().substring(0, 100))}`);
    log(`🔍 Coincidencias en sección principal: Primera: ${hasFirst}, Segunda: ${hasSecond}`);
    
    if (hasFirst && hasSecond) {
      log('⚠️ El contribuyente posee tanto Primera como Segunda categoría tributaria en la sección principal.');
      return 'primera';
    }
    if (hasFirst) {
      log('✓ Categoría tributaria detectada (sección principal): Primera Categoría.');
      return 'primera';
    }
    if (hasSecond) {
      log('✓ Categoría tributaria detectada (sección principal): Segunda Categoría.');
      return 'segunda';
    }
  }

  // 2. Fallback: Search in the economic activities table
  log('⚠️ No se encontró la etiqueta "Categoría Tributaria:" con dos puntos o no fue concluyente. Buscando en la tabla de actividades...');
  
  // We search only in the first part of the document, before Formulario 29/22 declarations
  const docParts = text.split(/Declaraciones\s+de\s+IVA|Declaraciones\s+de\s+Renta|Formulario\s+29|Formulario\s+22/i);
  const firstPart = docParts[0];

  const hasFirstInFirstPart = /Primera\s+Categor[íi]a|1ra\s+Categor[íi]a/i.test(firstPart);
  const hasSecondInFirstPart = /Segunda\s+Categor[íi]a|2da\s+Categor[íi]a/i.test(firstPart);

  log(`🔍 Coincidencias en la primera parte del documento (antes de declaraciones): Primera: ${hasFirstInFirstPart}, Segunda: ${hasSecondInFirstPart}`);

  if (hasFirstInFirstPart && hasSecondInFirstPart) {
    log('✓ Ambas categorías encontradas en la sección de actividades. Retornando Primera Categoría.');
    return 'primera';
  }
  if (hasFirstInFirstPart) {
    log('✓ Categoría tributaria detectada (actividades): Primera Categoría.');
    return 'primera';
  }
  if (hasSecondInFirstPart) {
    log('✓ Categoría tributaria detectada (actividades): Segunda Categoría.');
    return 'segunda';
  }

  // 3. Absolute Fallback: check whole document
  log('⚠️ Buscando en todo el documento...');
  const hasFirstTotal = /Primera\s+Categor[íi]a|1ra\s+Categor[íi]a/i.test(text);
  const hasSecondTotal = /Segunda\s+Categor[íi]a|2da\s+Categor[íi]a/i.test(text);

  if (hasFirstTotal) {
    log('✓ Categoría tributaria detectada (total): Primera Categoría.');
    return 'primera';
  }
  if (hasSecondTotal) {
    log('✓ Categoría tributaria detectada (total): Segunda Categoría.');
    return 'segunda';
  }
  
  log('⚠️ Advertencia: No se pudo identificar de forma unívoca la categoría tributaria (Primera o Segunda) en el archivo de Carpeta Tributaria. Retornando "ninguna".');
  return 'ninguna';
}
