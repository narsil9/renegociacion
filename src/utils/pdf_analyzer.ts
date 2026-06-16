import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { getCurrentChileDate } from './date_helper';

const execFileAsync = promisify(execFile);

export type TaxCategory = 'primera' | 'segunda' | 'ninguna';

export interface F29ActivityResult {
  /** true si se encontraron declaraciones F29 con actividad en los últimos 24 meses */
  hasActivityLast24Months: boolean;
  /** Meses con actividad detectada, ej. ["2024-03", "2024-02"] */
  activeMonths: string[];
  /** Descripción concisa para log/alerta */
  summary: string;
}

export interface ContribucionProperty {
  /** Rol catastral, ej. "BD 20", "DP 1009" */
  rol: string;
  /** Comuna, ej. "Ñuñoa" */
  comuna: string;
  /** Destino/tipo de propiedad, ej. "Bodega / Almacenaje" */
  destino: string;
  /** Línea original del PDF para debugging */
  lineaOriginal: string;
}

export interface ContribucionesDeudaResult {
  /** Propiedades con Condición=AFECTO y Cuotas vencidas=SI → deuda por contribuciones */
  propiedadesMorosas: ContribucionProperty[];
  /** Descripción concisa para log/alerta */
  summary: string;
}

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
 * Extracts text preserving the original column layout (pdftotext -layout).
 * Required to parse tabular sections like the CMF creditor tables, where each
 * row (institution + tipo + amounts) must stay on a single aligned line.
 */
export async function extractTextFromPdfLayout(pdfPath: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Archivo PDF no encontrado para extracción de texto: ${pdfPath}`);
  }

  const pdftotextPath = '/opt/homebrew/bin/pdftotext';
  try {
    const { stdout } = await execFileAsync(pdftotextPath, ['-layout', pdfPath, '-'], {
      encoding: 'utf8',
    });
    return stdout;
  } catch (err: any) {
    throw new Error(`Error al ejecutar pdftotext -layout en ${pdfPath}: ${err.message || err}`);
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

/**
 * Detects whether the Carpeta Tributaria contains Formulario 29 (IVA) declarations
 * with actual activity in the last 24 months relative to today.
 *
 * Logic:
 * 1. Locates the F29 / "Declaraciones de IVA" section in the PDF text.
 * 2. Scans for period headers ("Marzo 2024", "03/2024", "2024-03", etc.).
 * 3. Keeps only those within [today - 24 months, today].
 * 4. Returns hasActivityLast24Months = true if any such periods are found.
 */
export async function detectF29ActivityLast24Months(
  pdfPath: string,
  logger?: SimpleLogger
): Promise<F29ActivityResult> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  log(`📋 Detectando actividad F29 en los últimos 24 meses: ${pdfPath}...`);
  const text = await extractTextFromPdf(pdfPath);

  // --- Locate the F29 / IVA section ---
  const lower = text.toLowerCase();
  const f29Anchors = [
    'formulario 29',
    'declaraciones de iva',
    'declaracion de iva',
    'iva - debito',
    'impuesto al valor agregado'
  ];

  let f29StartIdx = -1;
  for (const anchor of f29Anchors) {
    const idx = lower.indexOf(anchor);
    if (idx !== -1) {
      f29StartIdx = idx;
      log(`🔍 Sección F29 encontrada con ancla: "${anchor}" (pos ${idx}).`);
      break;
    }
  }

  if (f29StartIdx === -1) {
    log('ℹ️ No se encontró sección de Formulario 29 / IVA en la Carpeta Tributaria.');
    return {
      hasActivityLast24Months: false,
      activeMonths: [],
      summary: 'No se encontró sección F29/IVA en la Carpeta Tributaria.'
    };
  }

  // Work only with the F29 section onwards to avoid false positives
  const f29Section = text.substring(f29StartIdx);

  // BUG-12 FIX: use getCurrentChileDate() for timezone-correct reference —
  // the rest of the codebase uses this helper to avoid UTC/Chile offset issues.
  const today = getCurrentChileDate();
  const cutoff = new Date(today.getFullYear(), today.getMonth() - 24, 1);

  // BUG-13 FIX: Spanish-only entries (PDF is in Spanish); removed dead English entries.
  // 'may' (English for mayo) was also missing — kept only Spanish keys to avoid confusion.
  const MONTH_NAMES: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11
  };

  const activeMonths: string[] = [];

  // Pattern 1: "Marzo 2024" / "marzo de 2024"
  const p1 = /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = p1.exec(f29Section)) !== null) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (month !== undefined && !isNaN(year)) {
      const d = new Date(year, month, 1);
      if (d >= cutoff && d <= today) {
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (!activeMonths.includes(key)) activeMonths.push(key);
      }
    }
  }

  // Pattern 2: "03/2024" or "2024/03" — BUG-11 FIX: removed space from separator set
  // to prevent false positives like "folio 03 2024" or "artículo 12 2023".
  const p2 = /\b(\d{2})[/\-](\d{4})\b|\b(\d{4})[/\-](\d{2})\b/g;
  while ((m = p2.exec(f29Section)) !== null) {
    let month: number, year: number;
    if (m[1] && m[2]) {
      month = parseInt(m[1], 10) - 1;
      year = parseInt(m[2], 10);
    } else {
      year = parseInt(m[3], 10);
      month = parseInt(m[4], 10) - 1;
    }
    if (month >= 0 && month <= 11 && year >= 2000 && year <= today.getFullYear()) {
      const d = new Date(year, month, 1);
      if (d >= cutoff && d <= today) {
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (!activeMonths.includes(key)) activeMonths.push(key);
      }
    }
  }

  // Pattern 3: "2024-03" ISO style
  const p3 = /\b(\d{4})-(\d{2})\b/g;
  while ((m = p3.exec(f29Section)) !== null) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    if (month >= 0 && month <= 11 && year >= 2000 && year <= today.getFullYear()) {
      const d = new Date(year, month, 1);
      if (d >= cutoff && d <= today) {
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (!activeMonths.includes(key)) activeMonths.push(key);
      }
    }
  }

  activeMonths.sort();
  const hasActivity = activeMonths.length > 0;

  const summary = hasActivity
    ? `Primera categoría con ${activeMonths.length} período(s) F29 en los últimos 24 meses: ${activeMonths.join(', ')}.`
    : 'Primera categoría sin actividad F29 en los últimos 24 meses.';

  log(`📊 Resultado F29: ${summary}`);

  return {
    hasActivityLast24Months: hasActivity,
    activeMonths,
    summary
  };
}

/**
 * Detecta propiedades con cuotas de contribuciones (Impuesto Territorial) vencidas
 * en la sección "Propiedades y Bienes Raíces" de la Carpeta Tributaria.
 *
 * Regla: Condición = AFECTO Y Cuotas vencidas por pagar = SI.
 * El monto NO está en la CT — requiere Certificado de Deuda TGR por separado.
 *
 * Usa pdftotext -layout para preservar la alineación columnar de la tabla.
 */
export async function detectContribucionesDeuda(
  pdfPath: string,
  logger?: SimpleLogger
): Promise<ContribucionesDeudaResult> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  log(`🏠 Detectando deudas por contribuciones en: ${pdfPath}...`);

  const text = await extractTextFromPdfLayout(pdfPath);
  const propSectionIdx = text.search(/propiedades\s+y\s+bienes\s+ra[íi]ces/i);

  if (propSectionIdx === -1) {
    log('ℹ️ No se encontró sección "Propiedades y Bienes Raíces" en la CT.');
    return { propiedadesMorosas: [], summary: 'Sin sección de propiedades en la CT.' };
  }

  const afterSection = text.substring(propSectionIdx);
  const endIdx = afterSection.search(
    /boletas?\s+de\s+honorarios|formulario\s+2[29]|declaracion[ea]s?\s+de\s+(iva|renta)/i
  );
  const propSection = endIdx !== -1 ? afterSection.substring(0, endIdx) : afterSection;

  log(`🔍 Sección de propiedades (${propSection.length} chars) encontrada.`);

  const propiedadesMorosas: ContribucionProperty[] = [];

  for (const line of propSection.split('\n')) {
    const upper = line.toUpperCase();

    // Columns end with: [Cuotas_vencidas] [Cuotas_vigentes] [Condición]
    // Match only when vencidas=SI AND condición=AFECTO.
    // "NO SI AFECTO" (vencidas=NO, vigentes=SI) must NOT match — the pattern
    // requires SI in the vencidas position: SI (SI|NO) AFECTO.
    if (!/\bSI\b\s+(?:SI|NO)\s+AFECTO\b/.test(upper)) continue;

    // Skip header rows that repeat the column labels
    if (/CUOTAS|CONDICI[OÓ]N|AVA[LÚ]/.test(upper)) continue;

    // Rol catastral: 1-3 uppercase letters + space + 1-6 digits (e.g. "BD 20", "DP 1009")
    const rolMatch = line.match(/\b([A-ZÁÉÍÓÚ]{1,3})\s+(\d{1,6})\b/);
    const rol = rolMatch ? `${rolMatch[1]} ${rolMatch[2]}` : 'Desconocido';

    // Comuna: first non-whitespace word(s) at the start of the line
    const comunaMatch = line.match(/^\s*([A-Za-záéíóúñÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ\s]*?)\s{2,}/);
    const comuna = comunaMatch ? comunaMatch[1].trim() : 'Desconocida';

    // Destino: try keyword match first; fall back to Rol-prefix mapping (BD→Bodega, etc.)
    const destinoKeyword = line.match(
      /\b(Habitacional|Casa\s+Habitaci[oó]n|Bodega(?:\s*\/\s*Almacenaje)?|Comercial|Industrial|Sitio|Terreno|Oficina|Local\s+Comercial|Edificio|Departamento|Agr[íi]cola)\b/i
    );
    const ROL_PREFIX_DESTINO: Record<string, string> = {
      BD: 'Bodega / Almacenaje', DP: 'Departamento', LC: 'Local Comercial',
      OF: 'Oficina', GA: 'Garage', ST: 'Sitio', HB: 'Habitacional', CA: 'Casa',
    };
    const destino = destinoKeyword
      ? destinoKeyword[1].trim()
      : (rolMatch ? ROL_PREFIX_DESTINO[rolMatch[1]] ?? 'Desconocido' : 'Desconocido');

    propiedadesMorosas.push({ rol, comuna, destino, lineaOriginal: line.trim() });
    log(`⚠️ Contribuciones morosas: Rol ${rol} — ${destino} (${comuna})`);
  }

  const summary = propiedadesMorosas.length > 0
    ? `${propiedadesMorosas.length} propiedad(es) con contribuciones morosas (AFECTO + cuotas vencidas): ` +
      `${propiedadesMorosas.map(p => `Rol ${p.rol} [${p.destino}]`).join(', ')}. ` +
      'Requiere Certificado de Deuda TGR para declarar.'
    : 'Sin deudas por contribuciones detectadas.';

  log(`📊 ${summary}`);

  return { propiedadesMorosas, summary };
}
