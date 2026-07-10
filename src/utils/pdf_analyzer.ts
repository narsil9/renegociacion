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

export interface BHEPeriod {
  /** Período en formato "Mes YYYY", ej. "Mayo 2025" */
  periodo: string;
  /** Honorario bruto en CLP */
  honorarioBruto: number;
}

export interface CarpetaTributariaMetadata {
  /** Fecha de generación de la CT, ej. "02/06/2026" */
  fechaGeneracion: string | null;
  /** Ingreso mensual promedio (últimos 6 meses de boletas) en CLP. null si no hay boletas. */
  ingresoMensualPromedio: number | null;
  /** Detalle de boletas de los últimos 12 meses */
  boletasUltimos12Meses: BHEPeriod[];
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
  logger?: SimpleLogger,
  preExtractedText?: string
): Promise<TaxCategory> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  log(`📊 Analizando Carpeta Tributaria en: ${pdfPath}...`);
  const text = preExtractedText ?? await extractTextFromPdf(pdfPath);

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

  // 3. Absolute Fallback: check whole document — BUT exclude F22 section.
  // The new CT format embeds the full F22 form which contains field labels like
  // "CRÉDITO POR IMPUESTO DE PRIMERA CATEGORÍA" that are NOT indicators of
  // primera categoría taxation. Splitting on F22/F29 anchors prevents false positives.
  log('⚠️ Buscando en todo el documento (excluyendo sección F22)...');
  const f22AnchorIdx = text.search(/Declaraciones\s+de\s+Renta\s*[-–]\s*Formulario\s+22|Formulario\s+22\s*\(F22\)|A[Ññ]O\s+TRIBUTARIO\s+\d{4}\s+IMPUESTOS\s+ANUALES/i);
  const safeText = f22AnchorIdx !== -1 ? text.substring(0, f22AnchorIdx) : text;

  const hasFirstTotal = /Primera\s+Categor[íi]a|1ra\s+Categor[íi]a/i.test(safeText);
  const hasSecondTotal = /Segunda\s+Categor[íi]a|2da\s+Categor[íi]a/i.test(safeText);

  if (hasFirstTotal) {
    log('✓ Categoría tributaria detectada (total, pre-F22): Primera Categoría.');
    return 'primera';
  }
  if (hasSecondTotal) {
    log('✓ Categoría tributaria detectada (total, pre-F22): Segunda Categoría.');
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
  logger?: SimpleLogger,
  preExtractedText?: string
): Promise<F29ActivityResult> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  log(`📋 Detectando actividad F29 en los últimos 24 meses: ${pdfPath}...`);
  const text = preExtractedText ?? await extractTextFromPdf(pdfPath);

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

  // Work only with the F29 section, stopping before the F22 (annual income tax) section.
  // The new CT format includes the full F22 form after F29, which contains date references
  // like "04/2026" (declaration period) that would trigger false-positive activity detection.
  const f22BoundaryIdx = text.search(
    /Declaraciones\s+de\s+Renta\s*[-–]\s*Formulario\s+22|Formulario\s+22\s*\(F22\)/i
  );
  const f29EndIdx = f22BoundaryIdx !== -1 && f22BoundaryIdx > f29StartIdx
    ? f22BoundaryIdx
    : text.length;
  const f29Section = text.substring(f29StartIdx, f29EndIdx);

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

  // New CT format (2025+) lists ALL 36 F29 periods as headers even when there
  // is no declaration ("No se registra declaración para este período.").
  // A period is only "active" if the ~200 chars following its header do NOT
  // contain that phrase. This prevents false-positive blocks for segunda categoría
  // clients whose CT happens to show an empty F29 history.
  const NO_DECLARATION_PHRASE = /no\s+se\s+registra\s+declaraci[oó]n\s+para\s+este\s+per[ií]odo/i;

  // Pattern 1: "Marzo 2024" / "marzo de 2024"
  const p1 = /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = p1.exec(f29Section)) !== null) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (month !== undefined && !isNaN(year)) {
      const d = new Date(year, month, 1);
      if (d >= cutoff && d <= today) {
        // Skip if the immediately following context says "no se registra declaración"
        const context = f29Section.substring(m.index + m[0].length, m.index + m[0].length + 200);
        if (NO_DECLARATION_PHRASE.test(context)) continue;
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
  logger?: SimpleLogger,
  preExtractedText?: string
): Promise<ContribucionesDeudaResult> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  log(`🏠 Detectando deudas por contribuciones en: ${pdfPath}...`);

  // If a caller passes preExtractedText it is used as-is; otherwise use pdftotext -layout
  // to preserve the column alignment needed for the property table (no OCR: Tesseract eliminado).
  const text = preExtractedText ?? await extractTextFromPdfLayout(pdfPath);
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

/**
 * Extracts the CT generation date and boletas de honorarios from a Carpeta Tributaria.
 *
 * New CT format (2025+) includes:
 * - "Fecha de generación de la Carpeta: DD/MM/YYYY HH:MM"
 * - Table: "Períodos | Honorario bruto ($) | Retención..."
 *
 * Returns ingresoMensualPromedio as the average of the most recent 6 months of boletas,
 * which is the figure used for Step 5 (Ingresos) in the portal.
 */
export async function extractCarpetaTributariaMetadata(
  pdfPath: string,
  logger?: SimpleLogger,
  preExtractedText?: string
): Promise<CarpetaTributariaMetadata> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  const text = preExtractedText ?? await extractTextFromPdf(pdfPath);

  // 1. Extract CT generation date
  const dateMatch = text.match(/Fecha\s+de\s+generaci[oó]n\s+de\s+la\s+Carpeta\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const fechaGeneracion = dateMatch ? dateMatch[1] : null;
  if (fechaGeneracion) {
    log(`📅 Fecha de generación CT: ${fechaGeneracion}`);
  } else {
    log('⚠️ No se encontró "Fecha de generación de la Carpeta" en la CT.');
  }

  // 2. Extract boletas de honorarios table
  // Header: "Boletas de Honorarios electrónicas emitidas (N): Últimos 12 meses"
  // Row pattern: "Mes YYYY  <honorario>  <retención>  <ppm>"
  const boletasAnchorIdx = text.search(/Boletas\s+de\s+Honorarios\s+electr[oó]nicas\s+emitidas/i);
  const boletasUltimos12Meses: BHEPeriod[] = [];

  if (boletasAnchorIdx !== -1) {
    // Work until next major section (Boletas recibidas or F29)
    const endAnchorIdx = text.search(/Boleta\s+de\s+prestaci[oó]n\s+de\s+servicios|Declaraciones\s+de\s+IVA|Formulario\s+29/i);
    const boletasSection = text.substring(
      boletasAnchorIdx,
      endAnchorIdx !== -1 && endAnchorIdx > boletasAnchorIdx ? endAnchorIdx : boletasAnchorIdx + 3000
    );

    // Match rows: "Mes YYYY  1.145.000  166.025  0"
    // Amount format: digits with dots (Chilean thousands separator)
    const rowRegex = /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(\d{4})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/gim;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(boletasSection)) !== null) {
      const periodo = `${rowMatch[1].charAt(0).toUpperCase() + rowMatch[1].slice(1).toLowerCase()} ${rowMatch[2]}`;
      const honorarioBruto = parseInt(rowMatch[3].replace(/\./g, ''), 10);
      if (!isNaN(honorarioBruto) && honorarioBruto > 0) {
        boletasUltimos12Meses.push({ periodo, honorarioBruto });
      }
    }

    log(`📊 Boletas detectadas: ${boletasUltimos12Meses.length} período(s)`);
    boletasUltimos12Meses.forEach(b => log(`   ${b.periodo}: $${b.honorarioBruto.toLocaleString('es-CL')}`));
  } else {
    log('ℹ️ No se encontró sección de Boletas de Honorarios en la CT.');
  }

  // 3. Calculate monthly average from last 6 months (Step 5 income)
  let ingresoMensualPromedio: number | null = null;
  if (boletasUltimos12Meses.length > 0) {
    const last6 = boletasUltimos12Meses.slice(-6);
    const total = last6.reduce((sum, b) => sum + b.honorarioBruto, 0);
    ingresoMensualPromedio = Math.round(total / last6.length);
    log(`💰 Ingreso mensual promedio (últimos ${last6.length} meses): $${ingresoMensualPromedio.toLocaleString('es-CL')}`);
  }

  return { fechaGeneracion, ingresoMensualPromedio, boletasUltimos12Meses };
}
