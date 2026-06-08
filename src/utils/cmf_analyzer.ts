import { extractTextFromPdf, extractTextFromPdfLayout } from './pdf_analyzer';
import * as fs from 'fs';
import { getCurrentChileDate, parseDateString, getDaysDifference } from './date_helper';

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

function parseAmount(val: string): number {
  // Remove $, dots, and any non-numeric characters except optionally minus
  const clean = val.replace(/[^\d-]/g, '');
  return parseInt(clean, 10) || 0;
}

export interface ClassifiedCreditor extends CmfCreditor {
  categoriaArticulo: 260 | 261;
  documentosRequeridos: ('monto' | 'vencimiento')[];
}

export interface CmfAnalysisResult {
  rut: string | null;
  name: string | null;
  totalDebt: number;
  overdue90DaysTotal: number; // Total overdue debt in CMF summary (90+ days)
  directOverdue90Days: number; // Overdue debt in Deuda Directa (90+ days)
  meets90DaysRequirement: boolean; // Has 90+ days of overdue debt
  meetsAmountRequirement: boolean; // Overdue debt >= 80 UF (approx $3,253,000 CLP)
  ufValueCLP: number;
  requiredAmountCLP: number;
  fechaEmision: string | null;
  cmfAgeDays: number;
  isExpired: boolean;
  creditors: CmfCreditor[];
  classifiedCreditors: ClassifiedCreditor[];
}

function getOverdue90DaysFromTableBlock(blockText: string, log: (m: string) => void): number {
  // Capturar fila de Totales con regex de 5 grupos
  const match5 = blockText.match(/(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+Total/i) ||
                 blockText.match(/Total\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)/i);
                 
  if (match5) {
    const v1 = parseAmount(match5[1]);
    const v2 = parseAmount(match5[2]);
    const v3 = parseAmount(match5[3]);
    const v4 = parseAmount(match5[4]);
    const v5 = parseAmount(match5[5]);
    
    // Check de sanidad de la suma:
    const sumFirst4 = v1 + v2 + v3 + v4;
    const sumLast4 = v2 + v3 + v4 + v5;
    
    const diff1 = Math.abs(v1 - sumLast4);
    const diff5 = Math.abs(v5 - sumFirst4);
    
    if (v1 === 0 && v5 === 0) {
      return 0;
    }
    
    // Si v1 es el Total (deuda total = suma de vigentes y moras)
    if (v1 > 0 && (diff1 / v1) <= 0.01) {
      log(`   🔍 Check sanidad CMF: v1 ($${v1.toLocaleString('es-CL')}) es la suma de los otros grupos ($${sumLast4.toLocaleString('es-CL')}). Asumiendo Columna 90+d en v5 ($${v5.toLocaleString('es-CL')}).`);
      return v5;
    }
    // Si v5 es el Total (deuda total = suma al final de la fila)
    if (v5 > 0 && (diff5 / v5) <= 0.01) {
      log(`   🔍 Check sanidad CMF: v5 ($${v5.toLocaleString('es-CL')}) es la suma de los otros grupos ($${sumFirst4.toLocaleString('es-CL')}). Asumiendo Columna 90+d en v4 ($${v4.toLocaleString('es-CL')}).`);
      return v4;
    }
    
    // Si hay discrepancia mayor al 1%
    log(`   ⚠️ Discrepancia en suma de validación de la fila de Total (v1: ${v1}, v5: ${v5}, sumFirst4: ${sumFirst4}, sumLast4: ${sumLast4}).`);
    log(`   🔍 Usando grupo 4 ($${v4.toLocaleString('es-CL')}) como Columna 90+d por defecto según plan.`);
    return v4;
  }
  
  // Si no hay 5 grupos, probamos con 4 grupos
  const match4 = blockText.match(/(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+Total/i) ||
                 blockText.match(/Total\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)/i);
  if (match4) {
    const v4 = parseAmount(match4[4]);
    log(`   🔍 Encontrados 4 grupos en fila de Total. Usando Columna 90+d en v4 ($${v4.toLocaleString('es-CL')}).`);
    return v4;
  }
  
  // Fallback a buscar línea de "Total" y extraer montos
  const lines = blockText.split('\n');
  const totalLine = lines.find(l => l.includes('Total') && l.includes('$'));
  if (totalLine) {
    const amounts = totalLine.match(/\$[\d.]+/g);
    if (amounts) {
      if (amounts.length >= 5) {
        const v5 = parseAmount(amounts[4]);
        log(`   🔍 Fallback línea Total (5+ montos): Usando último monto como 90+ ($${v5.toLocaleString('es-CL')}).`);
        return v5;
      } else if (amounts.length >= 4) {
        const v4 = parseAmount(amounts[3]);
        log(`   🔍 Fallback línea Total (4 montos): Usando 4to monto como 90+ ($${v4.toLocaleString('es-CL')}).`);
        return v4;
      }
    }
  }
  return 0;
}

export interface CmfCreditor {
  institucion: string; // Raw institution name as printed in the CMF report
  tipoCredito: string; // e.g. "Consumo", "Comercial", "Hipotecario"
  totalCredito: number; // "Total del crédito" — full balance owed to this creditor
  vigente: number;
  overdue30to59: number;
  overdue60to89: number;
  overdue90Days: number;
  esIndirecta: boolean; // true if it comes from the "Deuda Indirecta" table
  fechaOtorgamiento?: string | null;
}

const KNOWN_TYPES = [
  { keywords: ['tarjeta de credito', 'tarjeta de crédito'], value: 'Tarjeta de crédito' },
  { keywords: ['linea de credito', 'línea de crédito'], value: 'Línea de crédito' },
  { keywords: ['otros creditos', 'otros créditos'], value: 'Otros créditos' },
  { keywords: ['tarjeta'], value: 'Tarjeta de crédito' },
  { keywords: ['linea', 'línea'], value: 'Línea de crédito' },
  { keywords: ['consumo'], value: 'Consumo' },
  { keywords: ['vivienda', 'hipotecario'], value: 'Vivienda' },
  { keywords: ['comercial'], value: 'Comercial' },
  { keywords: ['otros'], value: 'Otros créditos' }
];

function cleanTipoCredito(rawTipo: string): string {
  const clean = rawTipo.replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();
  for (const item of KNOWN_TYPES) {
    for (const kw of item.keywords) {
      if (lower.includes(kw)) {
        return item.value;
      }
    }
  }
  return clean || 'Consumo';
}

/**
 * Parses one CMF debt table block (Deuda Directa or Deuda Indirecta) from the
 * layout-preserved text, extracting one row per creditor.
 * Supports both the classic CMF format and the new Ley 21.680 format.
 */
function parseCreditorTable(
  blockText: string,
  esIndirecta: boolean,
  log: (m: string) => void
): CmfCreditor[] {
  const lines = blockText.split('\n');
  
  // 1. Detect format by checking if any line contains a date pattern
  const hasDates = lines.some(line => /\d{2}\/\d{2}\/\d{4}/.test(line));
  
  // Define dynamic boundaries based on format
  const sliceAEnd = hasDates ? 50 : 38;
  const sliceBEnd = hasDates ? 75 : 65;

  const groups: string[][] = [];
  let currentGroup: string[] = [];

  // Group contiguous non-empty lines
  for (const line of lines) {
    if (line.trim() === '') {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    } else {
      currentGroup.push(line);
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  const creditors: CmfCreditor[] = [];
  const amountsRegex = /(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s+(\$[\d.]+)\s*$/;

  for (const group of groups) {
    let amountLineIndex = -1;
    let match: RegExpMatchArray | null = null;
    for (let i = 0; i < group.length; i++) {
      const m = group[i].match(amountsRegex);
      if (m) {
        amountLineIndex = i;
        match = m;
        break;
      }
    }

    if (amountLineIndex === -1 || !match) {
      continue;
    }

    const amounts = [
      parseAmount(match[1]),
      parseAmount(match[2]),
      parseAmount(match[3]),
      parseAmount(match[4]),
      parseAmount(match[5])
    ];

    if (amounts[0] === 0) {
      continue;
    }

    const colAParts: string[] = [];
    const colBParts: string[] = [];
    const colCParts: string[] = [];

    for (let i = 0; i < group.length; i++) {
      let line = group[i];
      if (i === amountLineIndex) {
        line = line.replace(amountsRegex, '');
      }

      const colA = line.substring(0, sliceAEnd).trim();
      const colB = line.substring(sliceAEnd, sliceBEnd).trim();
      const colC = line.substring(sliceBEnd).trim();

      if (colA) colAParts.push(colA);
      if (colB) colBParts.push(colB);
      if (colC) colCParts.push(colC);
    }

    const institucion = colAParts.join(' ').replace(/\s+/g, ' ').trim();
    const rawTipo = colBParts.join(' ').replace(/\s+/g, ' ').trim();
    const rawDate = colCParts.join(' ').replace(/\s+/g, ' ').trim();

    const dateMatch = rawDate.match(/(\d{2}\/\d{2}\/\d{4})/);
    const fechaOtorgamiento = dateMatch ? dateMatch[1] : null;
    const tipoCredito = cleanTipoCredito(rawTipo);

    if (institucion.toLowerCase() === 'total' || institucion.toLowerCase().includes('institucion financiera')) {
      continue;
    }

    creditors.push({
      institucion,
      tipoCredito,
      fechaOtorgamiento,
      totalCredito: amounts[0],
      vigente: amounts[1],
      overdue30to59: amounts[2],
      overdue60to89: amounts[3],
      overdue90Days: amounts[4],
      esIndirecta
    });
  }

  log(
    `   🔍 ${esIndirecta ? 'Deuda Indirecta' : 'Deuda Directa'}: ${creditors.length} acreedor(es) detectado(s).`
  );
  return creditors;
}

/**
 * Extracts the full list of creditors (acreedores) from the CMF report,
 * covering both Deuda Directa (titular) and Deuda Indirecta (codeudor/aval).
 * This is the source list for Step 3 (Acreedores).
 */
export async function extractCreditors(
  pdfPath: string,
  logger?: SimpleLogger
): Promise<CmfCreditor[]> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  log(`📋 Extrayendo lista de acreedores del Informe CMF: ${pdfPath}...`);
  const layoutText = await extractTextFromPdfLayout(pdfPath);
  const lower = layoutText.toLowerCase();

  const directIdx = lower.indexOf('deuda directa');
  const indirectIdx = lower.indexOf('deuda indirecta');
  const creditosIdx = lower.indexOf('créditos disponibles') !== -1
    ? lower.indexOf('créditos disponibles')
    : lower.indexOf('creditos disponibles');

  const creditors: CmfCreditor[] = [];

  // Deuda Directa block: from "deuda directa" up to "deuda indirecta" (or créditos disponibles)
  if (directIdx !== -1) {
    const directEnd = indirectIdx !== -1 ? indirectIdx : (creditosIdx !== -1 ? creditosIdx : layoutText.length);
    const directBlock = layoutText.substring(directIdx, directEnd);
    creditors.push(...parseCreditorTable(directBlock, false, log));
  } else {
    log('   ⚠️ No se encontró la sección "Deuda Directa".');
  }

  // Deuda Indirecta block: from "deuda indirecta" up to "créditos disponibles"
  if (indirectIdx !== -1) {
    const indirectEnd = creditosIdx !== -1 && creditosIdx > indirectIdx ? creditosIdx : layoutText.length;
    const indirectBlock = layoutText.substring(indirectIdx, indirectEnd);
    creditors.push(...parseCreditorTable(indirectBlock, true, log));
  }

  log(`✅ Total de acreedores extraídos del CMF: ${creditors.length}`);
  creditors.forEach((c) =>
    log(
      `   • ${c.institucion} [${c.tipoCredito}${c.esIndirecta ? ', indirecta' : ''}] — Total: $${c.totalCredito.toLocaleString('es-CL')} (90+d: $${c.overdue90Days.toLocaleString('es-CL')})`
    )
  );

  return creditors;
}

/**
 * Analyzes the CMF debt report PDF to verify legal requirements for renegotiation.
 */
export async function analyzeCmfPdf(
  pdfPath: string,
  logger?: SimpleLogger
): Promise<CmfAnalysisResult> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };

  log(`📊 Analizando Informe de Deudas CMF en: ${pdfPath}...`);
  const text = await extractTextFromPdf(pdfPath);
  
  // Normalize text whitespace
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');

  // 1. Extract name and RUT
  let name: string | null = null;
  let rut: string | null = null;
  
  const rutMatch = normalized.match(/Rut\s*:\s*([\d.kK-]+)/i);
  if (rutMatch) {
    rut = rutMatch[1].trim();
    log(`🔍 RUT detectado en CMF: ${rut}`);
  }

  // Try to find the name (typically on the lines surrounding the RUT)
  const lines = normalized.split('\n');
  const rutLineIdx = lines.findIndex(l => l.toLowerCase().includes('rut:'));
  if (rutLineIdx !== -1) {
    const candidateLines = [];
    if (rutLineIdx > 2) candidateLines.push(lines[rutLineIdx - 3].trim());
    if (rutLineIdx > 1) candidateLines.push(lines[rutLineIdx - 2].trim());
    if (rutLineIdx > 0) candidateLines.push(lines[rutLineIdx - 1].trim());
    name = candidateLines.filter(l => l.length > 3 && !l.toLowerCase().includes('informe') && !l.toLowerCase().includes('deudas')).join(' ').trim();
    log(`🔍 Nombre detectado en CMF: ${name}`);
  }

  // 2. Extract Total Debt
  let totalDebt = 0;
  const totalDebtMatch = normalized.match(/Información actualizada al[^\n]*\n+(\$[\d.]+)/i) || 
                         normalized.match(/Deuda total y estado de pago[^\n]*\n+[^\n]*\n+(\$[\d.]+)/i) ||
                         normalized.match(/emitido el[^\n]*\n+(\$[\d.]+)/i);
  if (totalDebtMatch) {
    totalDebt = parseAmount(totalDebtMatch[1]);
    log(`🔍 Deuda Total detectada: $${totalDebt.toLocaleString('es-CL')}`);
  }

  // Collapsed whitespace text for position matching
  const collapsedText = normalized.replace(/\s+/g, ' ');
  const searchText = collapsedText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // 3. Extract Overdue Summary (Vigente, 30-59, 60-89, 90+)
  let overdue90DaysTotal = 0;
  const startAnchor = 'deuda total y estado de pago';
  const endAnchor = 'como se compone esta deuda';
  
  const startAnchorIdx = searchText.indexOf(startAnchor);
  const endAnchorIdx = searchText.indexOf(endAnchor);
  
  let summaryBlockFound = false;
  if (startAnchorIdx !== -1 && endAnchorIdx !== -1 && endAnchorIdx > startAnchorIdx) {
    // Extraemos la porción correspondiente de la cadena original colapsada
    const summaryBlock = collapsedText.substring(startAnchorIdx, endAnchorIdx);
    const dollarMatches = [...summaryBlock.matchAll(/\$([\d.]+)/g)];
    if (dollarMatches.length > 0) {
      // Tomar el último monto $ del bloque
      const lastMatch = dollarMatches[dollarMatches.length - 1];
      overdue90DaysTotal = parseAmount(lastMatch[0]);
      log(`🔍 Resumen CMF (anclas) - Deuda con 90+ días de atraso: $${overdue90DaysTotal.toLocaleString('es-CL')}`);
      summaryBlockFound = true;
    }
  }
  
  if (!summaryBlockFound) {
    log('⚠️ No se encontró el bloque de resumen delimitado por las anclas. Ejecutando fallback...');
    const overdueSectionIdx = searchText.indexOf('90 o mas dias');
    if (overdueSectionIdx !== -1) {
      const textAfterOverdue = collapsedText.substring(overdueSectionIdx);
      const dollarMatches = [...textAfterOverdue.matchAll(/\$([\d.]+)/g)].slice(0, 5);
      if (dollarMatches.length >= 4) {
        overdue90DaysTotal = parseAmount(dollarMatches[3][0]);
        log(`🔍 Resumen CMF (fallback) - Deuda con 90+ días de atraso: $${overdue90DaysTotal.toLocaleString('es-CL')}`);
      }
    }
  }

  // 4. Extract Deuda Directa - 90+ days
  let directOverdue90Days = 0;
  const directDebtIdx = searchText.indexOf('deuda directa');
  if (directDebtIdx !== -1) {
    const directDebtBlock = normalized.substring(directDebtIdx);
    const nextSectionIdx = directDebtBlock.toLowerCase().indexOf('deuda indirecta');
    const blockToParse = nextSectionIdx !== -1 ? directDebtBlock.substring(0, nextSectionIdx) : directDebtBlock;
    directOverdue90Days = getOverdue90DaysFromTableBlock(blockToParse, log);
    log(`🔍 Deuda Directa - Total 90+ días de atraso: $${directOverdue90Days.toLocaleString('es-CL')}`);
  }

  // Extract Deuda Indirecta - 90+ days
  let indirectOverdue90Days = 0;
  const indirectDebtIdx = searchText.indexOf('deuda indirecta');
  if (indirectDebtIdx !== -1) {
    const indirectDebtBlock = normalized.substring(indirectDebtIdx);
    const nextSectionIdx = indirectDebtBlock.toLowerCase().indexOf('creditos disponibles');
    const blockToParse = nextSectionIdx !== -1 ? indirectDebtBlock.substring(0, nextSectionIdx) : indirectDebtBlock;
    indirectOverdue90Days = getOverdue90DaysFromTableBlock(blockToParse, log);
    log(`🔍 Deuda Indirecta - Total 90+ días de atraso: $${indirectOverdue90Days.toLocaleString('es-CL')}`);
  }

  // 5. Extract emission date and calculate age
  const dateMatch = normalized.match(/INFORME EMITIDO EL\s+(\d{2}\/\d{2}\/\d{4})/i) ||
                    normalized.match(/emitido el\s+(\d{2}\/\d{2}\/\d{4})/i);
  let fechaEmision: string | null = null;
  if (dateMatch) {
    fechaEmision = dateMatch[1];
    log(`🔍 Fecha de Emisión del CMF detectada: ${fechaEmision}`);
  }

  let isExpired = false;
  let cmfAgeDays = 0;
  if (fechaEmision) {
    const today = getCurrentChileDate();
    const emisionDate = parseDateString(fechaEmision);
    if (emisionDate) {
      cmfAgeDays = getDaysDifference(today, emisionDate);
      log(`   🔍 Antigüedad del CMF: ${cmfAgeDays} días.`);
      
      const bypassCheck = process.env.BYPASS_DATE_CHECK === 'true';
      if (cmfAgeDays > 30) {
        if (bypassCheck) {
          log(`⚠️  El CMF tiene una antigüedad de ${cmfAgeDays} días (> 30 días), pero se OMITIRÁ la expiración por variable BYPASS_DATE_CHECK.`);
        } else {
          isExpired = true;
          log(`❌ El CMF está expirado (antigüedad de ${cmfAgeDays} días).`);
        }
      }
    }
  }

  // 6. Extract and classify creditors
  const creditors = await extractCreditors(pdfPath, logger);
  const classifiedCreditors: ClassifiedCreditor[] = creditors.map(c => {
    const is260 = c.overdue90Days > 0;
    return {
      ...c,
      categoriaArticulo: is260 ? 260 : 261,
      documentosRequeridos: is260 ? ['monto', 'vencimiento'] : ['monto']
    };
  });

  // 7. Evaluate requirements
  const requiredAmountCLP = 3253000;
  const ufValueCLP = 40662.5;

  const meets90DaysRequirement = directOverdue90Days > 0 || overdue90DaysTotal > 0 || indirectOverdue90Days > 0;
  
  // Sum direct + indirect overdue 90+ days, fallback to Math.max(directOverdue90Days + indirectOverdue90Days, overdue90DaysTotal)
  const sum90DaysOverdue = directOverdue90Days + indirectOverdue90Days;
  const total90DaysOverdue = Math.max(sum90DaysOverdue, overdue90DaysTotal);
  const meetsAmountRequirement = total90DaysOverdue >= requiredAmountCLP;

  log(`📊 Validación de Requisitos:`);
  log(`   - ¿Tiene atraso >= 90 días?: ${meets90DaysRequirement ? 'SÍ' : 'NO'}`);
  log(`   - Monto 90+ días: $${total90DaysOverdue.toLocaleString('es-CL')} (Requerido: >= $${requiredAmountCLP.toLocaleString('es-CL')} / 80 UF)`);
  log(`   - ¿Cumple monto mínimo?: ${meetsAmountRequirement ? 'SÍ' : 'NO'}`);

  return {
    rut,
    name,
    totalDebt,
    overdue90DaysTotal,
    directOverdue90Days,
    meets90DaysRequirement,
    meetsAmountRequirement,
    ufValueCLP,
    requiredAmountCLP,
    fechaEmision,
    cmfAgeDays,
    isExpired,
    creditors,
    classifiedCreditors
  };
}

