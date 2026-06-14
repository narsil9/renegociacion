import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { extractTextFromPdf } from './pdf_analyzer';
import { getCurrentChileDate, getDaysDifference } from './date_helper';
import { analyzeCmfPdf } from './cmf_analyzer';
import {
  fetchAcreedoresCatalog,
  matchAcreedor,
  normalizeRut,
  normalizeText,
  extractRutsFromText,
  findCatalogEntryByRut,
  AcreedorCatalogEntry,
} from './acreedor_matcher';
import * as fs from 'fs';
import * as path from 'path';

export function extractDatesFromText(text: string): Date[] {
  const dates: Date[] = [];
  const lower = text.toLowerCase();
  
  // Regex 1: D(D)/M(M)/YYYY or D(D)-M(M)-YYYY  — allows 1 or 2 digit day/month
  const regex1 = /\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})\b/g;
  let match;
  while ((match = regex1.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) dates.push(d);
  }

  // Regex 2: YYYY-MM-DD
  const regex2 = /\b(\d{4})[/\-](\d{2})[/\-](\d{2})\b/g;
  while ((match = regex2.exec(text)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) dates.push(d);
  }

  // Regex 3: DD de [mes] de YYYY
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const monthRegex = new RegExp(`(\\d{1,2})\\s+de\\s+(${months.join('|')})\\s+de\\s+(\\d{4})`, 'gi');
  while ((match = monthRegex.exec(lower)) !== null) {
    const day = parseInt(match[1], 10);
    const monthName = match[2].toLowerCase();
    const month = months.findIndex(m => monthName.startsWith(m));
    const year = parseInt(match[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) dates.push(d);
  }

  return dates;
}

/**
 * Extracts the most likely emission date from a Chilean financial/banking certificate.
 *
 * Documents vary widely by issuer (Banco Estado, BCI, Scotiabank, Ripley, CAE,
 * cooperativas, etc.) so this function tries multiple patterns in priority order:
 *
 * HIGH confidence — explicitly labelled emission date:
 *   • "Fecha de Emisión / Emision / Generación / Impresión / del Certificado: DD/MM/YYYY"
 *   • "[Chilean city], [a] DD de [mes] de YYYY"   (e.g. "Santiago, 20 de mayo de 2026")
 *   • "Emitido en [place], [a] DD de [mes] de YYYY"
 *   • "Certificado emitido el DD/MM/YYYY"
 *   • "A fecha de hoy, DD de [mes] de YYYY"
 *
 * MEDIUM confidence — generic unlabelled date near the top of the document:
 *   • "Fecha: DD/MM/YYYY" (generic label)
 *   • Any date found in the first 600 characters (header region)
 *
 * LOW confidence — last resort:
 *   • Most recent date ≤ today and ≥ 2020 found anywhere in the document
 *
 * Background: certificates embed many older dates (credit grant date, first overdue
 * payment, account-opening date, etc.). Using Math.min (earliest) or Math.max
 * (latest) on all dates is unreliable — explicit label matching is always preferred.
 */
export function extractEmissionDateFromText(
  text: string,
  todayDate: Date
): { date: Date | null; confidence: 'high' | 'medium' | 'low' } {

  const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const MONTHS_JOINED = MONTHS.join('|');
  const lower = text.toLowerCase();

  /** Parse and validate a candidate date; returns null if invalid or out of range. */
  function buildDate(day: number, month0: number, year: number): Date | null {
    const d = new Date(year, month0, day);
    return (!isNaN(d.getTime()) && d <= todayDate && d.getFullYear() >= 2020) ? d : null;
  }

  /** Resolve a Spanish month name to 0-based index. */
  function monthIdx(name: string): number {
    return MONTHS.findIndex(m => name.toLowerCase().startsWith(m));
  }

  // ── TIER 1: HIGH CONFIDENCE ─────────────────────────────────────────────────

  // Tier 1-A: Explicit emission/generation/print/certificate date labels with DD/MM/YYYY
  // Covers: "Fecha de Emisión", "Fecha Emisión", "Fecha Emision", "Fecha de Generación",
  //         "Fecha Generación", "Fecha de Impresión", "Fecha Impresión",
  //         "Fecha del Certificado", "Fecha de certificado", "Fecha de vigencia"
  const labeledNumericPatterns: RegExp[] = [
    /fecha\s+de?\s*emisi[oó]n\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /fecha\s+de?\s*generaci[oó]n\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /fecha\s+de?\s*impresi[oó]n\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /fecha\s+del?\s*certificado\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /fecha\s+de?\s*vigencia\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /certificado\s+emitido\s+el\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /emitido\s+(?:el|con\s+fecha)\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /generado\s+el\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /impreso\s+el\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
    /fecha\s+de?\s*consulta\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i,
  ];
  for (const re of labeledNumericPatterns) {
    const m = lower.match(re);
    if (m) {
      const d = buildDate(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      if (d) return { date: d, confidence: 'high' };
    }
  }

  // Tier 1-A (ISO variant): same labels with YYYY-MM-DD
  const labeledIsoPatterns: RegExp[] = [
    /fecha\s+de?\s*emisi[oó]n\s*:?\s*(\d{4})[/\-.](\d{2})[/\-.](\d{2})/i,
    /fecha\s+de?\s*generaci[oó]n\s*:?\s*(\d{4})[/\-.](\d{2})[/\-.](\d{2})/i,
    /fecha\s+del?\s*certificado\s*:?\s*(\d{4})[/\-.](\d{2})[/\-.](\d{2})/i,
    /emitido\s+(?:el|con\s+fecha)\s*:?\s*(\d{4})[/\-.](\d{2})[/\-.](\d{2})/i,
  ];
  for (const re of labeledIsoPatterns) {
    const m = lower.match(re);
    if (m) {
      const d = buildDate(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      if (d) return { date: d, confidence: 'high' };
    }
  }

  // Tier 1-B: Explicit emission labels with Spanish month name
  // "Fecha de Emisión: 20 de mayo de 2026"
  const labeledSpanishPatterns: RegExp[] = [
    new RegExp(`fecha\\s+de?\\s*emisi[oó]n\\s*:?\\s*(\\d{1,2})\\s+de\\s+(${MONTHS_JOINED})\\s+de\\s+(\\d{4})`, 'i'),
    new RegExp(`fecha\\s+del?\\s*certificado\\s*:?\\s*(\\d{1,2})\\s+de\\s+(${MONTHS_JOINED})\\s+de\\s+(\\d{4})`, 'i'),
    new RegExp(`certificado\\s+emitido\\s+el\\s*:?\\s*(\\d{1,2})\\s+de\\s+(${MONTHS_JOINED})\\s+de\\s+(\\d{4})`, 'i'),
    new RegExp(`emitido\\s+(?:el|con\\s+fecha)\\s*:?\\s*(\\d{1,2})\\s+de\\s+(${MONTHS_JOINED})\\s+de\\s+(\\d{4})`, 'i'),
    new RegExp(`a\\s+fecha\\s+de\\s+hoy[,\\s]+(\\d{1,2})\\s+de\\s+(${MONTHS_JOINED})\\s+de\\s+(\\d{4})`, 'i'),
  ];
  for (const re of labeledSpanishPatterns) {
    const m = lower.match(re);
    if (m) {
      const idx = monthIdx(m[2]);
      if (idx >= 0) {
        const d = buildDate(parseInt(m[1], 10), idx, parseInt(m[3], 10));
        if (d) return { date: d, confidence: 'high' };
      }
    }
  }

  // Tier 1-C: City header — "[city], [a] DD de [mes] de YYYY"
  // Covers Santiago and all major Chilean cities
  const CITIES = [
    'santiago', 'valparaíso', 'valparaiso', 'concepción', 'concepcion',
    'viña del mar', 'vina del mar', 'antofagasta', 'temuco', 'talca',
    'rancagua', 'iquique', 'la serena', 'puerto montt', 'arica',
    'chillán', 'chillan', 'copiapó', 'copiapo', 'coquimbo',
    'osorno', 'punta arenas', 'puerto varas', 'valdivia', 'curicó', 'curico',
  ];
  const cityAlt = CITIES.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const cityRe = new RegExp(
    `(?:${cityAlt})\\s*,\\s*(?:a\\s+)?(\\d{1,2})\\s+de\\s+(${MONTHS_JOINED})\\s+de\\s+(\\d{4})`,
    'i'
  );
  const mc = lower.match(cityRe);
  if (mc) {
    const idx = monthIdx(mc[2]);
    if (idx >= 0) {
      const d = buildDate(parseInt(mc[1], 10), idx, parseInt(mc[3], 10));
      if (d) return { date: d, confidence: 'high' };
    }
  }

  // Tier 1-D: "Emitido en [place], [a] DD de [mes] de YYYY"
  const emitidoEnRe = new RegExp(
    `emitido\\s+en\\s+[\\w\\s]+,\\s*(?:a\\s+)?(\\d{1,2})\\s+de\\s+(${MONTHS_JOINED})\\s+de\\s+(\\d{4})`,
    'i'
  );
  const me = lower.match(emitidoEnRe);
  if (me) {
    const idx = monthIdx(me[2]);
    if (idx >= 0) {
      const d = buildDate(parseInt(me[1], 10), idx, parseInt(me[3], 10));
      if (d) return { date: d, confidence: 'high' };
    }
  }

  // ── TIER 2: MEDIUM CONFIDENCE ───────────────────────────────────────────────

  // Tier 2-A: "Fecha: DD/MM/YYYY" (generic, unlabelled as emission)
  const fechaSimpleRe = /\bfecha\s*:?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i;
  const mf = lower.match(fechaSimpleRe);
  if (mf) {
    const d = buildDate(parseInt(mf[1], 10), parseInt(mf[2], 10) - 1, parseInt(mf[3], 10));
    if (d) return { date: d, confidence: 'medium' };
  }

  // Tier 2-B: Most recent date found in the first 600 chars (document header area)
  const headerDates = extractDatesFromText(text.substring(0, 600))
    .filter(d => d.getTime() <= todayDate.getTime() && d.getFullYear() >= 2020);
  if (headerDates.length > 0) {
    const newest = new Date(Math.max(...headerDates.map(d => d.getTime())));
    return { date: newest, confidence: 'medium' };
  }

  // ── TIER 3: LOW CONFIDENCE ──────────────────────────────────────────────────

  // Most recent date ≤ today and ≥ 2020 anywhere in the full document
  const allDates = extractDatesFromText(text)
    .filter(d => d.getTime() <= todayDate.getTime() && d.getFullYear() >= 2020);
  if (allDates.length > 0) {
    const newest = new Date(Math.max(...allDates.map(d => d.getTime())));
    return { date: newest, confidence: 'low' };
  }

  return { date: null, confidence: 'low' };
}

export interface ClientDocument {
  id: string;
  client_id: string;
  document_type: number;
  acreditacion_tipo: string;
  institucion_cmf: string | null;
  storage_path: string;
  filename: string;
  uploaded_at: string;
  local_path?: string;
  textContent?: string;
  /** true when the file is a JPG/PNG/GIF or a PDF whose text extraction returned < 50 chars */
  isImageDoc?: boolean;
  /** base64-encoded image data (only set when isImageDoc = true) */
  imageBase64?: string;
  /** MIME type for the image (image/jpeg | image/png | image/gif | image/webp) */
  imageMimeType?: string;
  /** true when the file could not be downloaded from Supabase Storage */
  downloadFailed?: boolean;
}

export interface ClientProfile {
  id: string;
  name: string;
  rut: string;
  informe_cmf_path?: string;
  acreditacion_documentos_json?: any;
  [key: string]: any;
}

export interface CognitiveCreditorMapping {
  institucion: string;
  monto_file: string | null;
  vencimiento_file: string | null;
}

export interface CognitiveAlert {
  type: 'expired_cmf' | 'expired_certificate' | 'missing_document' | 'rut_mismatch' | 'amount_mismatch' | 'other';
  message: string;
}

import { AcreditacionDoc } from '../automation/step3_acreedores';

// Local mirrors of sentinel interfaces — avoid circular import (sentinel → cognitive_orchestrator)
interface SentinelReclassifiedCreditor {
  institucion_cmf: string;
  bank: string;
  product_type: string;
  delinquency_days: number;
  total_credito_clp: number;
  reason: string;
  document_filename: string;
}
interface SentinelIdentified261Creditor {
  bank: string;
  product_type: string;
  institucion_cmf: string;
  total_credito_clp: number;
  reason: string;
  document_filename: string;
}
interface SentinelAdditionalCreditor {
  bank: string;
  institucion_cmf: string;
  product_type: string;
  categoria_articulo: 260 | 261;
  total_credito_clp: number;
  reason: string;
  document_filename: string;
}

export interface OrchestrationResult {
  status: 'success' | 'error';
  reason?: string;
  documentMapping: CognitiveCreditorMapping[];
  alerts: CognitiveAlert[];
  mappedDocs?: AcreditacionDoc[];
  technicalError?: boolean;
}

function extractJsonCandidate(contentText: string): string {
  const jsonMatch = contentText.match(/<json>([\s\S]*?)<\/json>/i) || contentText.match(/```json([\s\S]*?)```/i);
  const raw = jsonMatch ? jsonMatch[1].trim() : contentText.trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.substring(firstBrace, lastBrace + 1);
  }
  return raw;
}

function repairJsonCandidate(json: string): string {
  return json
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/}\s*{/g, '},{')
    .replace(/]\s*"/g, '],"')
    .replace(/"\s*\n\s*"/g, '",\n"');
}

function parseOrchestrationJson(contentText: string): OrchestrationResult {
  const candidate = extractJsonCandidate(contentText);
  try {
    return JSON.parse(candidate) as OrchestrationResult;
  } catch (firstErr) {
    const repaired = repairJsonCandidate(candidate);
    try {
      return JSON.parse(repaired) as OrchestrationResult;
    } catch {
      throw firstErr;
    }
  }
}

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

/**
 * Executes the AI cognitive orchestrator (Claude 3.5 Sonnet) to:
 * 1. Read CMF creditor classification and required documents.
 * 2. Scan and read uploaded certificates.
 * 3. Match certificates to creditors, check RUTs/names.
 * 4. Verify age limit (< 30 days) dynamically on CMF and certificates.
 * 5. Return JSON mapping or alerts/rejection reasons.
 */
export async function runCognitiveOrchestrator(
  client: ClientProfile,
  cmfLocalPath: string,
  supabase: SupabaseClient,
  logger: SimpleLogger,
  sentinelReclassified?: SentinelReclassifiedCreditor[],
  sentinelIdentified261?: SentinelIdentified261Creditor[],
  sentinelAdditional?: SentinelAdditionalCreditor[]
): Promise<OrchestrationResult> {
  const log = (msg: string) => logger.log(`🧠 [Mente Pensante] ${msg}`);
  const logError = (msg: string, err?: any) => logger.error(`🧠 [Mente Pensante] ${msg}`, err);

  if (!process.env.ANTHROPIC_API_KEY) {
    log('⚠️ ANTHROPIC_API_KEY no encontrada en .env. Se omitirá validación por IA y se usará fallback.');
    return {
      status: 'error',
      reason: 'Falta ANTHROPIC_API_KEY en el archivo de configuración (.env).',
      documentMapping: [],
      alerts: [{ type: 'other', message: 'Falta ANTHROPIC_API_KEY para ejecutar la validación por IA.' }]
    };
  }

  // 1. Fetch client documents from the client_documents table
  log(`Obteniendo documentos del cliente ${client.name} desde la tabla client_documents...`);
  
  let documents: ClientDocument[] = [];
  
  try {
    const { data: dbDocs, error: dbErr } = await supabase
      .from('client_documents')
      .select('*')
      .eq('client_id', client.id);

    if (dbErr) {
      log(`⚠️ Tabla client_documents falló o no está disponible, usando fallback desde client.acreditacion_documentos_json. Detalle: ${dbErr.message}`);
    } else if (dbDocs && dbDocs.length > 0) {
      documents = dbDocs.map((d: any) => ({
        id: d.id,
        client_id: d.client_id,
        document_type: d.document_type,
        acreditacion_tipo: d.acreditacion_tipo,
        institucion_cmf: d.institucion_cmf,
        storage_path: d.storage_path,
        filename: d.filename,
        uploaded_at: d.uploaded_at
      }));
    }
  } catch (err: any) {
    log(`⚠️ Error consultando client_documents: ${err.message || err}. Usando fallback.`);
  }

  // Fallback to client.acreditacion_documentos_json if documents is empty
  if (documents.length === 0 && client.acreditacion_documentos_json && Array.isArray(client.acreditacion_documentos_json)) {
    log(`ℹ️ Utilizando fallback de documentos desde client.acreditacion_documentos_json (${client.acreditacion_documentos_json.length} encontrados)...`);
    documents = client.acreditacion_documentos_json.map((doc: any, index: number) => {
      const docType = doc.tipo_documento;
      let acreditacionTipo = 'general';
      if (docType === 22) {
        acreditacionTipo = 'monto';
      } else if (docType === 23) {
        acreditacionTipo = 'vencimiento';
      }
      return {
        id: doc.id || `fallback-${index}`,
        client_id: client.id,
        document_type: docType,
        acreditacion_tipo: acreditacionTipo,
        institucion_cmf: doc.institucion_cmf || null,
        storage_path: doc.storage_path,
        filename: doc.filename || path.basename(doc.storage_path),
        uploaded_at: doc.uploaded_at || new Date().toISOString()
      };
    });
  }

  log(`Se encontraron ${documents.length} documentos registrados.`);

  if (documents.length === 0) {
    return {
      status: 'error',
      reason: 'El cliente no tiene certificados de acreditación de deuda o vencimiento subidos.',
      documentMapping: [],
      alerts: [{ type: 'missing_document', message: 'No hay documentos de acreditación registrados para el cliente.' }]
    };
  }

  // 2. Download and process each certificate (text PDF or image)
  const tmpDir = path.join(process.cwd(), 'outputs', 'acreditaciones_tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  /** Determine MIME type from file extension */
  function getMimeType(filePath: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    const extLower = path.extname(filePath).toLowerCase();
    if (extLower === '.png') return 'image/png';
    if (extLower === '.gif') return 'image/gif';
    if (extLower === '.webp') return 'image/webp';
    return 'image/jpeg'; // .jpg, .jpeg, or unknown → jpeg
  }

  /** Returns true for native image extensions (non-PDF) */
  function isNativeImageExt(filePath: string): boolean {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(filePath).toLowerCase());
  }

  for (const doc of documents) {
    const ext = path.extname(doc.storage_path) || '.pdf';
    const slug = path.basename(doc.storage_path, ext);
    const localPath = path.join(tmpDir, `${slug}${ext}`);

    doc.local_path = localPath;

    if (fs.existsSync(localPath)) {
      log(`Documento en caché local: ${doc.filename}`);
    } else {
      log(`Descargando "${doc.filename}" desde Supabase Storage...`);
      try {
        const { data, error } = await supabase.storage.from('documentos').download(doc.storage_path);
        if (error || !data) throw new Error(error?.message ?? 'blob vacío');
        fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
      } catch (err: any) {
        // BUG-03 FIX: Don't abort the entire function when one cert fails to download.
        // Mark it as failed and continue with remaining documents.
        logError(`Error al descargar ${doc.filename}:`, err);
        doc.textContent = `[Error de descarga: ${err.message}]`;
        doc.isImageDoc = false;
        doc.downloadFailed = true;
        continue;
      }
    }

    // --- Detect whether this is a text-PDF or an image document ---
    if (isNativeImageExt(localPath)) {
      // Native image file (JPG, PNG, etc.) → send to Claude Vision directly
      doc.isImageDoc = true;
      doc.imageMimeType = getMimeType(localPath);
      doc.imageBase64 = fs.readFileSync(localPath).toString('base64');
      doc.textContent = '[IMAGEN: TypeScript no puede extraer texto. Claude analizará la imagen directamente.]';
      log(`🖼️ ${doc.filename} es una imagen (${doc.imageMimeType}). Se enviará a Claude Vision.`);
    } else {
      // PDF → attempt text extraction
      try {
        const fullText = await extractTextFromPdf(localPath);
        const TEXT_THRESHOLD = 50; // chars — below this = scanned/image PDF
        if (fullText.trim().length < TEXT_THRESHOLD) {
          // PDF is actually a scanned image — treat as image (BUG-03 note: non-fatal, continues loop)
          doc.isImageDoc = true;
          doc.imageMimeType = 'image/jpeg'; // Ghostscript renders to JPEG
          // Convert first page of PDF to JPEG using Ghostscript (already installed)
          const jpgPath = localPath.replace(/\.pdf$/i, '_p1.jpg');
          if (!fs.existsSync(jpgPath)) {
            log(`🖼️ ${doc.filename}: PDF escaneado detectado (${fullText.trim().length} chars). Convirtiendo con Ghostscript...`);
            const { execFile: execFileCb } = await import('child_process');
            const { promisify: prom } = await import('util');
            const execFileAsync2 = prom(execFileCb);
            await execFileAsync2('/opt/homebrew/bin/gs', [
              '-dNOPAUSE', '-dBATCH', '-sDEVICE=jpeg', '-r150',
              `-sOutputFile=${jpgPath}`, '-dFirstPage=1', '-dLastPage=1',
              localPath
            ]);
          }
          doc.imageBase64 = fs.existsSync(jpgPath)
            ? fs.readFileSync(jpgPath).toString('base64')
            : fs.readFileSync(localPath).toString('base64'); // raw PDF fallback
          doc.textContent = '[PDF ESCANEADO: TypeScript no pudo extraer texto (<50 chars). Claude analizará la imagen directamente.]';
          log(`🖼️ ${doc.filename} convertido a imagen para Claude Vision.`);
        } else {
          // Normal text PDF
          doc.isImageDoc = false;
          doc.textContent = fullText.substring(0, 20000);
          log(`📄 Texto extraído de ${doc.filename} (${doc.textContent.length} chars).`);
        }
      } catch (err: any) {
        logError(`Error al extraer texto de ${doc.filename}:`, err);
        // BUG-03 FIX: non-fatal — mark as failed but continue loop for remaining docs
        doc.textContent = `[Error de extracción: ${err.message}]`;
        doc.isImageDoc = false;
      }
    }
  }

  // BUG-03 FIX: warn if ANY cert failed to download/process but don't abort
  const failedDocs = documents.filter(d => !d.textContent && !d.imageBase64);
  if (failedDocs.length > 0) {
    log(`⚠️ ${failedDocs.length} certificado(s) no pudieron procesarse: ${failedDocs.map(d => d.filename).join(', ')}. Se continúa con los documentos disponibles.`);
  }

  // 3. Extract text from the CMF PDF (limit to 15,000 characters)
  let cmfText = '';
  try {
    const fullCmfText = await extractTextFromPdf(cmfLocalPath);
    cmfText = fullCmfText.substring(0, 15000);
    log(`Texto extraído exitosamente de CMF local (${cmfText.length} caracteres).`);
  } catch (err: any) {
    logError('Error al extraer texto del CMF local:', err);
    return {
      status: 'error',
      reason: 'No se pudo leer el contenido de texto del CMF.',
      documentMapping: [],
      alerts: [{ type: 'other', message: 'Error al leer el CMF local.' }]
    };
  }

  // 4. Get Chile current date for age reference
  const todayDate = getCurrentChileDate();
  const todayStr = todayDate.toISOString().split('T')[0];
  log(`Fecha de referencia local (Santiago): ${todayStr}`);

  // 5. Execute Local TypeScript pre-analysis and validations
  log('Ejecutando análisis pre-calculado local en TypeScript...');

  // 5.0 Load the canonical creditor catalog once, for the deterministic RUT
  // pre-check (cert issuer RUT vs the bank the lawyer assigned). Degrades
  // gracefully: if it can't load, the RUT pre-check is skipped and Claude
  // still verifies RUTs on its own.
  let catalog: AcreedorCatalogEntry[] = [];
  try {
    catalog = await fetchAcreedoresCatalog(supabase);
    log(`Catálogo cargado para verificación de RUT: ${catalog.length} acreedores.`);
  } catch (err: any) {
    logError('No se pudo cargar el catálogo para la verificación de RUT (se delega a Claude):', err);
  }
  const clientRutForCerts = client.rut ?? null;

  // 5a. Analyze CMF locally
  const cmfResult = await analyzeCmfPdf(cmfLocalPath, logger).catch(err => {
    logError('Error en análisis pre-calculado local de CMF:', err);
    return null;
  });

  // 5b. Analyze certificates locally for issue dates
  interface CertificateAnalysis {
    filename: string;
    document_type: number;
    acreditacion_tipo: string;
    isImageDoc: boolean;
    detectedDates: string[];
    mostLikelyDate: string | null;
    ageDays: number | null;
    antiguedadValida: boolean;
    checkTypeScript: string;
    // Deterministic RUT pre-check (cert issuer RUT vs the bank assigned by the lawyer)
    institucionAsignada: string | null;
    rutEmisorDetectado: string | null;
    bancoSegunRut: string | null;
    rutMismatch: boolean;
    rutCheckTypeScript: string;
  }

  // Deterministic RUT pre-check for one certificate's text. Compares the RUTs
  // found in the certificate against the catalog RUT of the bank the lawyer
  // assigned (doc.institucion_cmf). Returns a structured finding for Claude to
  // corroborate; never blocks on its own.
  const computeRutCheck = (assignedInst: string | null, certText: string) => {
    const result = { rutEmisorDetectado: null as string | null, bancoSegunRut: null as string | null, rutMismatch: false, rutCheckTypeScript: '' };
    if (catalog.length === 0) {
      result.rutCheckTypeScript = 'Catálogo no disponible: RUT no verificado por TypeScript (Claude debe verificar el RUT del emisor).';
      return result;
    }

    const certRuts = extractRutsFromText(certText);
    const certNorm = normalizeText(certText);
    const assignedMatch = assignedInst ? matchAcreedor(assignedInst, catalog) : null;
    // Solo confiamos en el banco asignado cuando el nombre resuelve a UN único
    // acreedor del catálogo (status 'matched'); ambiguo/no_encontrado/texto libre
    // NO habilitan un veredicto de mismatch (lo verifica Claude).
    const assignedEntry = assignedMatch && assignedMatch.status === 'matched' ? assignedMatch.entry! : null;
    const assignedRutNorm = assignedEntry ? normalizeRut(assignedEntry.rut) : null;

    // Caso 1: el RUT del banco asignado SÍ aparece en el certificado → coincide,
    // aunque el cert mencione además otros RUTs de catálogo (p.ej. procesadores de pago).
    if (assignedRutNorm && certRuts.includes(assignedRutNorm)) {
      result.rutEmisorDetectado = assignedRutNorm;
      result.bancoSegunRut = assignedEntry!.nombre;
      result.rutCheckTypeScript = `RUT coincide: el certificado contiene el RUT ${assignedRutNorm} de "${assignedEntry!.nombre}", el banco asignado.`;
      return result;
    }

    // Primer banco de catálogo presente en el cert (referencial).
    const detected = findCatalogEntryByRut(certRuts, catalog, clientRutForCerts);
    if (detected) {
      result.rutEmisorDetectado = normalizeRut(detected.rut);
      result.bancoSegunRut = detected.nombre;
    }

    // Caso 2 (ALTA confianza → único caso que marca mismatch): el banco asignado
    // se resolvió de forma unívoca, su RUT NO está en el certificado, y el cert
    // apunta por RUT a OTRO banco del catálogo.
    if (assignedRutNorm && detected && normalizeRut(detected.rut) !== assignedRutNorm) {
      result.rutMismatch = true;
      result.rutCheckTypeScript = `POSIBLE BANCO INCORRECTO: el certificado contiene el RUT ${result.rutEmisorDetectado} de "${detected.nombre}", y el RUT del banco asignado "${assignedInst}" (${assignedRutNorm}) NO aparece en el documento. Banco correcto probable según RUT: "${detected.nombre}".`;
      return result;
    }

    // Caso 2b: no hay RUT de catálogo, pero el texto del certificado menciona
    // explícitamente otro acreedor canónico distinto del asignado. Esto cubre
    // certificados que omiten RUT, como Santander Consumer Finance Limitada.
    const significantTokens = (value: string): string[] =>
      normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !['banco', 'chile', 'limitada', 'sociedad', 'anonima', 'financiera'].includes(token));

    const issuerByName = catalog
      .filter((entry) => {
        if (!entry.nombre || assignedEntry?.id === entry.id) return false;
        const entryNorm = normalizeText(entry.nombre_normalizado || entry.nombre);
        if (entryNorm.length >= 10 && certNorm.includes(entryNorm)) return true;

        const tokens = significantTokens(entry.nombre_normalizado || entry.nombre);
        return tokens.length >= 2 && tokens.every((token) => certNorm.includes(token));
      })
      .sort((a, b) => normalizeText(b.nombre_normalizado || b.nombre).length - normalizeText(a.nombre_normalizado || a.nombre).length)[0];

    if (assignedRutNorm && issuerByName) {
      result.bancoSegunRut = issuerByName.nombre;
      result.rutMismatch = true;
      result.rutCheckTypeScript = `POSIBLE BANCO INCORRECTO POR NOMBRE: no se detectó RUT de catálogo, pero el certificado menciona explícitamente "${issuerByName.nombre}" y fue asignado a "${assignedInst}". Claude debe corroborar si el emisor real del documento corresponde a "${issuerByName.nombre}" y no al banco asignado.`;
      return result;
    }

    // Caso 3: banco asignado resuelto pero no se pudo confirmar por RUT (su RUT no
    // está y no hay otro RUT de catálogo) → sin veredicto; lo verifica Claude.
    if (assignedRutNorm) {
      result.rutCheckTypeScript = `No se detectó el RUT del banco asignado "${assignedInst}" (${assignedRutNorm}) ni otro RUT de catálogo en el texto. Claude debe verificar el RUT del emisor.`;
      return result;
    }

    // Caso 4: el banco asignado NO resolvió a un único acreedor (ambiguo / no
    // encontrado / texto libre) → NO se marca mismatch; solo se informa. Si el cert
    // apunta por RUT a un banco, se sugiere como dato para que Claude lo verifique.
    result.rutCheckTypeScript = detected
      ? `Banco asignado "${assignedInst ?? 'N/D'}" no resuelto de forma unívoca en el catálogo; el certificado apunta por RUT a "${detected.nombre}" (${result.rutEmisorDetectado}). Claude debe verificar el RUT del emisor.`
      : `Banco asignado "${assignedInst ?? 'N/D'}" no resuelto en el catálogo y sin RUT de catálogo detectado en el texto. Claude debe verificar el RUT del emisor.`;
    return result;
  };

  const certificateAnalyses: CertificateAnalysis[] = [];
  let algunCertificadoExpirado = false;
  const rutMismatchesTS: Array<{ filename: string; asignado: string | null; bancoSegunRut: string | null; rutEmisorDetectado: string | null }> = [];
  
  for (const doc of documents) {
    if (doc.isImageDoc) {
      // Image documents: TypeScript cannot extract dates — delegate entirely to Claude
      certificateAnalyses.push({
        filename: doc.filename,
        document_type: doc.document_type,
        acreditacion_tipo: doc.acreditacion_tipo,
        isImageDoc: true,
        detectedDates: [],
        mostLikelyDate: null,
        ageDays: null,
        antiguedadValida: false, // unknown — Claude must verify
        checkTypeScript: 'IMAGEN: TypeScript no puede extraer fechas. Claude debe verificar antigüedad directamente en la imagen.',
        institucionAsignada: doc.institucion_cmf,
        rutEmisorDetectado: null,
        bancoSegunRut: null,
        rutMismatch: false,
        rutCheckTypeScript: 'IMAGEN: TypeScript no puede leer el RUT. Claude debe verificar el RUT del emisor directamente en la imagen.'
      });
      // Do NOT set algunCertificadoExpirado here — Claude will determine validity
      log(`🖼️ ${doc.filename}: análisis de fecha y RUT delegado a Claude (documento imagen).`);
    } else {
      const dates = extractDatesFromText(doc.textContent || '');
      const formattedDates = dates.map(d => d.toISOString().split('T')[0]);

      // Extract emission date using context-aware logic: looks for "Santiago, DD de [mes] de YYYY"
      // or "Fecha de Emisión:" first (high confidence), then falls back to most recent valid date.
      const { date: mostLikelyDate, confidence: dateConfidence } = extractEmissionDateFromText(
        doc.textContent || '',
        todayDate
      );
      
      const mostLikelyStr = mostLikelyDate ? mostLikelyDate.toISOString().split('T')[0] : null;
      const ageDays = mostLikelyDate ? getDaysDifference(todayDate, mostLikelyDate) : null;
      
      // Estados de cuenta are permanently exempt from the 30-day rule.
      const isEstadoCuenta = doc.acreditacion_tipo === 'estado_cuenta';
      // An age is valid if <= 30 days, OR if the document is an estado de cuenta (exempt).
      const isValidAge = isEstadoCuenta || (ageDays !== null && ageDays <= 30);
      const isExpiredLocal = !isValidAge;

      if (isExpiredLocal) {
        algunCertificadoExpirado = true;
      }

      const rutCheck = computeRutCheck(doc.institucion_cmf, doc.textContent || '');
      if (rutCheck.rutMismatch) {
        rutMismatchesTS.push({
          filename: doc.filename,
          asignado: doc.institucion_cmf,
          bancoSegunRut: rutCheck.bancoSegunRut,
          rutEmisorDetectado: rutCheck.rutEmisorDetectado,
        });
        log(`🪪 ${doc.filename}: ${rutCheck.rutCheckTypeScript}`);
      }

      certificateAnalyses.push({
        filename: doc.filename,
        document_type: doc.document_type,
        acreditacion_tipo: doc.acreditacion_tipo,
        isImageDoc: false,
        detectedDates: Array.from(new Set(formattedDates)),
        mostLikelyDate: mostLikelyStr,
        ageDays,
        antiguedadValida: isValidAge,
        checkTypeScript: isEstadoCuenta
          ? `Exento de límite 30 días (estado de cuenta — puede tener cualquier antigüedad)`
          : (isValidAge
              ? `Cumple (antigüedad <= 30 días, extracción: ${dateConfidence})`
              : (ageDays !== null
                  ? `No cumple (${ageDays} días > 30, extracción: ${dateConfidence})`
                  : 'No cumple (no se detectó fecha de emisión)')),
        institucionAsignada: doc.institucion_cmf,
        rutEmisorDetectado: rutCheck.rutEmisorDetectado,
        bancoSegunRut: rutCheck.bancoSegunRut,
        rutMismatch: rutCheck.rutMismatch,
        rutCheckTypeScript: rutCheck.rutCheckTypeScript,
      });
    }
  }

  // 5c. Renegotiation requirements check
  // The 90-day requirement IS blocking (no creditors with 90+d mora → cannot proceed).
  // The 80 UF threshold is informational ONLY — must never produce status: "error".
  const totalCreditoOf90Plus = cmfResult ? cmfResult.totalCreditoOf90PlusCreditors : 0;
  const qualifying90PlusCount = cmfResult ? cmfResult.qualifying90PlusCount : 0;
  const cumpleRequisito90Dias = cmfResult ? cmfResult.meets90DaysRequirement : false;
  const sumaObligaciones90DiasMayor80UF = totalCreditoOf90Plus >= 3253000;

  // 5d. CMF validation
  const cmfFechaEmision = cmfResult ? cmfResult.fechaEmision : null;
  const cmfAgeDays = cmfResult ? cmfResult.cmfAgeDays : null;
  const cmfAntiguedadValida = cmfAgeDays !== null && cmfAgeDays <= 30;

  const todoDocumentoValidoTS = cmfAntiguedadValida && !algunCertificadoExpirado;

  // 5e. Classify creditors (sentinel enrichment overrides CMF when available)
  const classifiedCreditors = cmfResult ? cmfResult.classifiedCreditors.map(c => {
    const cmfIs260 = c.overdue90Days > 0;

    // Sentinel override: if sentinel reclassified this creditor to Art. 260
    const normInstC = c.institucion.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sentinelRec = (sentinelReclassified || []).find(r => {
      const normR = r.institucion_cmf.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normR === normInstC || normR.includes(normInstC) || normInstC.includes(normR);
    });

    const is260 = cmfIs260 || !!sentinelRec;
    // BUG-07 FIX: cleanTipoCredito() in cmf_analyzer returns 'Tarjeta de crédito' and 'Línea de crédito'
    // as normalized values. The previous check used string literals that never matched.
    const isRevolvingCredit = c.tipoCredito === 'Tarjeta de crédito' || c.tipoCredito === 'Línea de crédito';
    const portalCode = is260 ? "260" : (isRevolvingCredit ? "1" : "12");
    const requisitoAcreditacion = is260 ? "monto y vencimiento" : "solo monto";
    
    // Find documents associated with this creditor
    const associatedDocs = documents.filter(d => {
      const normD = d.institucion_cmf ? d.institucion_cmf.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
      const normC = c.institucion.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normD === normC || normD.includes(normC) || normC.includes(normD);
    }).map(d => d.filename);

    return {
      institucion: c.institucion,
      tipoCreditoOriginal: c.tipoCredito,
      montoTotal: c.totalCredito,
      mora90Mas: c.overdue90Days,
      categoriaArticulo: is260 ? 260 : 261,
      portalCode, // "260", "12", "1"
      requisitoAcreditacion,
      documentosAsociados: associatedDocs,
      cumpleRequisitosAcreditacion: is260 ? 
        (associatedDocs.some(f => {
          const doc = certificateAnalyses.find(ca => ca.filename === f);
          return doc && (doc.document_type === 22 || doc.document_type === 24);
        }) && associatedDocs.some(f => {
          const doc = certificateAnalyses.find(ca => ca.filename === f);
          return doc && (doc.document_type === 23 || doc.document_type === 24);
        })) : 
        associatedDocs.some(f => {
          const doc = certificateAnalyses.find(ca => ca.filename === f);
          return doc && (doc.document_type === 22 || doc.document_type === 24);
        })
    };
  }) : [];

  // 5f. Final local analysis payload package
  const localAnalysis = {
    todayReference: todayStr,
    sentinelEnrichment: {
      enabled: !!(
        (sentinelReclassified && sentinelReclassified.length > 0) ||
        (sentinelIdentified261 && sentinelIdentified261.length > 0)
      ),
      reclassifiedTo260: sentinelReclassified || [],
      identified261: sentinelIdentified261 || [],
      nota: 'Datos del Centinela (API Key #1). Tienen PRIORIDAD sobre la clasificación CMF para los acreedores mencionados. Úsalos para ajustar el documentMapping.'
    },
    requisitosSesion: {
      qualifying90PlusCount,
      cumpleRequisito90Dias,
      resultadoCheck90Dias: cumpleRequisito90Dias
        ? `CUMPLE REQUISITO DE MORA (se detectaron ${qualifying90PlusCount} productos con mora de 90+ días, cumple el mínimo de 2)`
        : `NO CUMPLE REQUISITO DE MORA (se detectaron ${qualifying90PlusCount} productos con mora de 90+ días, se requieren al menos 2) — esto SÍ puede impedir la sesión`,
      alerta80UF: {
        sumaTotalCreditoAcreedores90Dias: totalCreditoOf90Plus,
        supera80UF: sumaObligaciones90DiasMayor80UF,
        nota: sumaObligaciones90DiasMayor80UF
          ? "Suma del total del crédito de acreedores con 90+d supera 80 UF — sin alerta"
          : "Suma del total del crédito de acreedores con 90+d NO supera 80 UF — SOLO ALERTA INFORMATIVA. Esta condición NO debe cambiar 'status' a 'error' ni bloquear el Paso 3."
      }
    },
    cmf: cmfResult ? {
      filename: path.basename(cmfLocalPath),
      fechaEmision: cmfFechaEmision,
      ageDays: cmfAgeDays,
      antiguedadValida: cmfAntiguedadValida,
      checkTypeScript: cmfAntiguedadValida ? "CMF Vigente" : `CMF Expirado (antigüedad de ${cmfAgeDays} días > 30)`
    } : null,
    creditors: classifiedCreditors,
    certificates: certificateAnalyses,
    todoDocumentoValidoTS,
    checkGlobalTypeScript: todoDocumentoValidoTS ? "Todos los documentos cumplen con antigüedad <= 30 días" : "Existen documentos expirados o sin fecha válida",
    rutCheck: {
      verificado: catalog.length > 0,
      posiblesBancosIncorrectos: rutMismatchesTS,
      checkGlobalTypeScript: catalog.length === 0
        ? "Catálogo no disponible: RUT no verificado por TypeScript (Claude debe verificar)."
        : (rutMismatchesTS.length === 0
            ? "Todos los certificados de texto coinciden por RUT con el banco asignado (o requieren verificación de Claude por ser imagen)."
            : `${rutMismatchesTS.length} certificado(s) con posible banco incorrecto según RUT — Claude debe corroborar y, si confirma, emitir 'rut_mismatch'.`)
    }
  };

  // 6. Construct the prompt for Claude with double-verification guidelines
  // Text-only docs go in the JSON payload; image docs get inline image blocks
  const textDocsPayload = documents
    .filter(d => !d.isImageDoc)
    .map(d => ({
      filename: d.filename,
      document_type: d.document_type,
      acreditacion_tipo: d.acreditacion_tipo,
      institucion_cmf: d.institucion_cmf,
      uploaded_at: d.uploaded_at,
      text: d.textContent
    }));

  const imageDocsMetadata = documents
    .filter(d => d.isImageDoc)
    .map(d => ({
      filename: d.filename,
      document_type: d.document_type,
      acreditacion_tipo: d.acreditacion_tipo,
      institucion_cmf: d.institucion_cmf,
      uploaded_at: d.uploaded_at,
      nota: 'IMAGEN — TypeScript no pudo extraer texto. La imagen se adjunta a continuación para que Claude la analice directamente.'
    }));

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const modelName = 'claude-sonnet-4-6';

  const systemPrompt = `Eres el Auditor Cognitivo Experto y Mente Pensante para la automatización del portal de la Superintendencia de Insolvencia y Reemprendimiento (Superir) en Chile.
Tu misión es actuar como la SEGUNDA LÍNEA DE CONTROL (mente pensante), corroborando y re-verificando el análisis local pre-calculado por TypeScript contra el texto crudo de los documentos.

REGLAS DE AUDITORÍA QUE DEBES CORROBORAR RIGUROSAMENTE:
1. **Doble Verificación de Antigüedad (Límite de 30 días)**:
   - Debes re-verificar en el texto de los documentos (CMF y certificados de acreditación) que NINGUNO tenga más de 30 días de antigüedad con respecto a Hoy (${todayStr}).
   - **EXCEPCIÓN — Estados de cuenta** (acreditacion_tipo: "estado_cuenta"): Los estados de cuenta están EXENTOS del límite de 30 días. Pueden tener cualquier antigüedad sin importar cuándo fueron emitidos. NO debes generar alerta de expiración para documentos de este tipo.
   - Si la antigüedad de un documento NO exento supera los 30 días, debes establecer obligatoriamente el campo 'status' como 'error', detallar el problema en 'reason' y emitir la alerta 'expired_cmf' o 'expired_certificate'.

2. **Doble Verificación de Deudas Art. 260**:
   - Para las deudas clasificadas como Artículo 260 (morosidad >= 91 días / mayor a 90 días en CMF): Corrobora en el CMF que realmente tengan mora de 91 días o más.
   - Identifica y asocia los nombres de archivo de los certificados correspondientes con los que se debe acreditar tanto Monto como Vencimiento.
   - Re-verifica rigurosamente que las fechas de emisión de estos certificados no superen los 30 días respecto a Hoy (${todayStr}). Recuerda: si el certificado tiene acreditacion_tipo "estado_cuenta", está exento de este límite.

3. **Doble Verificación de Deudas Art. 261 (Clasificados como 12 y 1)**:
   - Para las deudas clasificadas como Artículo 261 (morosidad < 91 días o al día en CMF):
     - Reconoce si corresponden a créditos 12 (créditos ordinarios, consumo, comercial, etc.) o créditos 1 (tarjetas y líneas de crédito).
     - Corrobora que para estos solo se requiere acreditar Monto.
     - Identifica el archivo de certificado de monto correspondiente.
     - Re-verifica que la fecha de emisión del certificado de monto no sea mayor a 30 días con respecto a Hoy (${todayStr}). Recuerda: si es acreditacion_tipo "estado_cuenta", está exento de este límite.

4. **Validación de RUT y Mapeo**:
   - Asocia cada certificado al acreedor del CMF (ej. "Banco Estado", "PRESTO LIDER", "De Credito e Inversiones").
   - Corrobora que el RUT de la institución emisora en el certificado coincida razonablemente con el acreedor.
   - El análisis local de TypeScript ya hizo un PRE-CHEQUEO determinista de RUT por certificado (campo "rutCheckTypeScript" de cada certificado y el resumen "rutCheck" del payload). Cuando "rutMismatch" sea true, significa que el RUT que TypeScript encontró en el certificado pertenece a un banco DISTINTO ("bancoSegunRut") del que el abogado asignó ("institucionAsignada"). DEBES re-verificar esto leyendo el RUT del emisor en el documento: si confirmas que el RUT del certificado NO corresponde al banco asignado, establece "status" como "error" y emite una alerta "rut_mismatch" indicando el banco correcto según el RUT. Si TypeScript no pudo verificar (certificado imagen o catálogo no disponible), verifica el RUT tú mismo directamente en el documento.

5. **Datos del Centinela (si "sentinelEnrichment.enabled" es true)**:
   Cuando el análisis TypeScript incluye datos del Centinela (API Key #1), úsalos como fuente autoritativa de clasificación:
   - Acreedores en "reclassifiedTo260": tienen mora real ≥91d según documentos (aunque CMF muestre $0) → Art. 260 → mapea monto Y vencimiento en "documentMapping".
   - Acreedores en "identified261": están al día o con mora <91d → Art. 261 → mapea solo monto en "documentMapping".
   - Si un acreedor del Centinela no aparece en el CMF, inclúyelo igual en "documentMapping" usando el nombre "institucion_cmf" del Centinela.
   - Estos datos tienen PRIORIDAD sobre la clasificación CMF cuando haya discrepancia.

6. **Regla de 80 UF y Multiproducto — NO es bloqueante para la auditoría de documentos (Auditor Técnico)**:
   - El campo "alerta80UF" y "cumpleRequisito90Dias" del análisis TypeScript son informativos para ti (aunque sí son evaluados por el orquestador general).
   - "cumpleRequisito90Dias" indica si el cliente tiene al menos 2 productos en mora >= 91 días en el CMF.
   - Si no se cumplen los 80 UF o el mínimo de 2 productos con mora >= 91 días, debes incluir una alerta de tipo "other" con el detalle, pero NUNCA establecer "status" como "error" por esta razón. La auditoría de documentos se enfoca en verificar que los archivos de acreditación provistos sean correctos y vigentes.

7. **Salida y Filenames**:
   - Los valores de "monto_file" y "vencimiento_file" DEBEN ser el campo "filename" EXACTO tal como aparece en el array de certificados entregado (sin modificar capitalización ni extensión). Si no hay certificado para un campo, usa null.
   - Responde únicamente con un bloque JSON bien estructurado encerrado en las etiquetas XML <json>...</json>.
   - No agregues texto explicativo fuera de las etiquetas XML.

Esquema JSON esperado:
\`\`\`json
{
  "status": "success" | "error",
  "reason": "Explicación detallada del por qué falló la corroboración (solo si status es 'error')",
  "documentMapping": [
    {
      "institucion": "Nombre de la institución según CMF",
      "monto_file": "nombre_archivo_monto.pdf" | null,
      "vencimiento_file": "nombre_archivo_vencimiento.pdf" | null
    }
  ],
  "alerts": [
    {
      "type": "expired_cmf" | "expired_certificate" | "missing_document" | "rut_mismatch" | "amount_mismatch" | "other",
      "message": "Detalle descriptivo de la alerta/discrepancia detectada en la corroboración"
    }
  ]
}
\`\`\`
`;

  // Build the user message as a multi-part content array (text + inline images)
  type AnthropicContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

  const userMessageParts: AnthropicContentBlock[] = [];

  // Part 1 — TypeScript pre-analysis JSON
  userMessageParts.push({
    type: 'text',
    text: `Aquí está el análisis local estructurado pre-calculado por TypeScript:\n--- INICIO ANÁLISIS TYPESCRIPT ---\n${JSON.stringify(localAnalysis, null, 2)}\n--- FIN ANÁLISIS TYPESCRIPT ---`
  });

  // Part 2 — CMF text
  userMessageParts.push({
    type: 'text',
    text: `\nAquí está el texto del Informe CMF del cliente:\n--- INICIO CMF ---\n${cmfText}\n--- FIN CMF ---`
  });

  // Part 3 — Text-based certificates JSON
  if (textDocsPayload.length > 0) {
    userMessageParts.push({
      type: 'text',
      text: `\nCertificados de acreditación en formato PDF (texto extraído por TypeScript):\n${JSON.stringify(textDocsPayload, null, 2)}`
    });
  }

  // Part 4 — Image-based certificates: metadata + inline images
  if (imageDocsMetadata.length > 0) {
    userMessageParts.push({
      type: 'text',
      text: `\nCertificados de acreditación en formato IMAGEN (JPG/PNG/PDF-escaneado). TypeScript no pudo extraer texto de estos documentos. A continuación se adjuntan las imágenes para que las analices directamente. Por cada imagen verifica: 1) fecha de emisión ≤ 30 días desde hoy (${todayStr}), 2) RUT del emisor coincide con el acreedor indicado, 3) el monto o vencimiento es legible y válido. Metadatos registrados por el abogado en el sistema:\n${JSON.stringify(imageDocsMetadata, null, 2)}`
    });

    for (const doc of documents.filter(d => d.isImageDoc)) {
      if (doc.imageBase64 && doc.imageMimeType) {
        userMessageParts.push({
          type: 'text',
          text: `\n📎 Imagen del certificado: "${doc.filename}" | Acreedor: ${doc.institucion_cmf ?? 'No especificado'} | Tipo: ${doc.acreditacion_tipo}`
        });
        userMessageParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: doc.imageMimeType,
            data: doc.imageBase64
          }
        });
      } else {
        log(`⚠️ ${doc.filename}: marcado como imagen pero no tiene base64. Se omitirá de la auditoría visual.`);
        userMessageParts.push({
          type: 'text',
          text: `\n⚠️ ADVERTENCIA: El certificado "${doc.filename}" del acreedor "${doc.institucion_cmf}" está marcado como imagen pero no pudo cargarse en base64. No se puede auditar visualmente.`
        });
      }
    }
  }

  // Final instruction
  userMessageParts.push({
    type: 'text',
    text: `\nPor favor realiza la auditoría y doble-verificación de todos los documentos (texto e imagen), y retorna el JSON mapeado dentro de las etiquetas <json> y </json>.\n\nIMPORTANTE para documentos imagen: si la imagen está ilegible o borrosa, incluye una alerta de tipo 'other' con mensaje claro indicando qué certificado no pudo leerse, pero NO bloquees el flujo si los demás documentos del mismo acreedor son válidos.`
  });

  const imageDocs = documents.filter(d => d.isImageDoc);
  log(`Enviando análisis cognitivo a Claude Sonnet 4.6 (${textDocsPayload.length} PDF(s) texto + ${imageDocs.length} imagen(es))...`);
  try {
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: 16000,
      thinking: {
        type: 'adaptive'
      },
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessageParts as any }]
    });

    const respText = response.content.find(b => b.type === 'text');
    const contentText = respText?.type === 'text' ? respText.text : '';

    const result = parseOrchestrationJson(contentText);

    // Bypass ONLY date-expiry alerts (expired_cmf / expired_certificate).
    // Structural alerts (missing_document, rut_mismatch, amount_mismatch) always block.
    // 'other' alerts are informational corroborations from Claude — they do NOT block bypass.
    const bypassCheck = process.env.BYPASS_DATE_CHECK === 'true' || process.env.BYPASS_DATE_VALIDATION === 'true';
    if (result.status === 'error' && bypassCheck) {
      const blockingAlerts = result.alerts.filter(a =>
        a.type === 'missing_document' || a.type === 'rut_mismatch' || a.type === 'amount_mismatch'
      );
      if (blockingAlerts.length === 0) {
        log('⚠️ El orquestador reportó alertas de antigüedad o informativas. Se OMITIRÁ (BYPASS_DATE_CHECK=true). Forzando status a success.');
        result.status = 'success';
      } else {
        const blockingTypes = blockingAlerts.map(a => a.type);
        log(`⚠️ BYPASS_DATE_CHECK=true pero hay alertas estructurales bloqueantes: [${blockingTypes.join(', ')}]. No se puede forzar success.`);
      }
    }

    log(`Auditoría finalizada. Estado: ${result.status.toUpperCase()}`);
    if (result.status === 'error') {
      log(`Motivo del rechazo: ${result.reason}`);
    }
    if (result.alerts && result.alerts.length > 0) {
      log('Alertas encontradas:');
      result.alerts.forEach(a => log(`  ⚠️ [${a.type}] ${a.message}`));
    }

    // Construct mappedDocs for Playwright step 3 execution
    const mappedDocs: AcreditacionDoc[] = [];
    if (result.status === 'success' && result.documentMapping) {
      for (const mapping of result.documentMapping) {
        const inst = mapping.institucion;
        
        // Handle monto_file — case-insensitive match to survive Claude casing variations
        if (mapping.monto_file) {
          const montoFileLower = mapping.monto_file.toLowerCase();
          const doc = documents.find(d => d.filename.toLowerCase() === montoFileLower);
          if (doc) {
            mappedDocs.push({
              institucion_cmf: inst,
              tipo_documento: 22,
              storage_path: doc.storage_path,
              local_path: doc.local_path,
              filename: doc.filename
            });
          } else {
            log(`⚠️ monto_file "${mapping.monto_file}" de Claude no coincide con ningún filename en client_documents para "${inst}". Certificado de monto NO adjuntado.`);
          }
        }

        // Handle vencimiento_file — case-insensitive match
        const vencFile = mapping.vencimiento_file;
        if (vencFile) {
          const vencFileLower = vencFile.toLowerCase();
          const doc = documents.find(d => d.filename.toLowerCase() === vencFileLower);
          if (doc) {
            mappedDocs.push({
              institucion_cmf: inst,
              tipo_documento: 23,
              storage_path: doc.storage_path,
              local_path: doc.local_path,
              filename: doc.filename
            });
          } else {
            log(`⚠️ vencimiento_file "${vencFile}" de Claude no coincide con ningún filename en client_documents para "${inst}". Certificado de vencimiento NO adjuntado.`);
          }
        }
      }
    }

    // Acreedores NO-CMF (del Centinela): generar su AcreditacionDoc desde client_documents.
    // El documentMapping de Claude solo cubre acreedores del CMF, así que estos se agregan aparte.
    // 261 → solo monto (tipo 22). 260 → monto+vencimiento en un solo doc (tipo 24).
    if (result.status === 'success' && sentinelAdditional && sentinelAdditional.length > 0) {
      for (const ac of sentinelAdditional) {
        const wanted = ac.document_filename?.toLowerCase();
        const doc = wanted ? documents.find(d => d.filename.toLowerCase() === wanted) : undefined;
        if (!doc) {
          log(`⚠️ Acreedor NO-CMF "${ac.bank}": documento "${ac.document_filename}" no está en client_documents. Se ingresará el acreedor pero SIN su certificado de monto.`);
          continue;
        }
        mappedDocs.push({
          institucion_cmf: ac.institucion_cmf,
          tipo_documento: ac.categoria_articulo === 260 ? 24 : 22,
          storage_path: doc.storage_path,
          local_path: doc.local_path,
          filename: doc.filename
        });
        log(`📎 Acreedor NO-CMF "${ac.bank}" (Art. ${ac.categoria_articulo}): documento "${doc.filename}" mapeado para adjuntar.`);
      }
    }

    // BUG-04 FIX: Detect empty mappedDocs on a success result — log a warning and
    // demote to error so the job doesn't silently succeed with zero documents attached.
    if (result.status === 'success' && mappedDocs.length === 0 && result.documentMapping && result.documentMapping.length > 0) {
      log('🚫 Claude devolvió status:success pero ningún filename del documentMapping coincide con client_documents. El Paso 3 no tendría nada que adjuntar.');
      log('   Verifica que los filenames en documentMapping coincidan exactamente (case-insensitive) con los registrados en client_documents.');
      result.status = 'error';
      result.reason = 'Mapeo de documentos vacío: los filenames devueltos por Claude no coinciden con ningún archivo registrado en client_documents.';
      result.alerts = result.alerts || [];
      result.alerts.push({ type: 'missing_document', message: 'Ningún certificado del documentMapping coincide con client_documents. Revisar nombres de archivo.' });
    }

    result.mappedDocs = mappedDocs;
    return result;

  } catch (err: any) {
    logError('Error al invocar o parsear la respuesta del orquestador de IA:', err);
	    return {
	      status: 'error',
	      reason: `Error en el procesamiento de IA: ${err.message || err}`,
	      documentMapping: [],
	      alerts: [{ type: 'other', message: `Fallo interno del orquestador de IA: ${err.message}` }],
	      mappedDocs: [],
	      technicalError: true
	    };
  }
}
