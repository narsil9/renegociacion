import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { extractTextFromPdf } from './pdf_analyzer';
import { getCurrentChileDate, getDaysDifference } from './date_helper';
import { analyzeCmfPdf } from './cmf_analyzer';
import * as fs from 'fs';
import * as path from 'path';

function extractDatesFromText(text: string): Date[] {
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

export interface OrchestrationResult {
  status: 'success' | 'error';
  reason?: string;
  documentMapping: CognitiveCreditorMapping[];
  alerts: CognitiveAlert[];
  mappedDocs?: AcreditacionDoc[];
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
  logger: SimpleLogger
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
        logError(`Error al descargar ${doc.filename}:`, err);
        return {
          status: 'error',
          reason: `No se pudo descargar el certificado ${doc.filename} de almacenamiento.`,
          documentMapping: [],
          alerts: [{ type: 'other', message: `Fallo de almacenamiento al descargar ${doc.filename}.` }]
        };
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
  }
  const certificateAnalyses: CertificateAnalysis[] = [];
  let algunCertificadoExpirado = false;
  
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
        checkTypeScript: 'IMAGEN: TypeScript no puede extraer fechas. Claude debe verificar antigüedad directamente en la imagen.'
      });
      // Do NOT set algunCertificadoExpirado here — Claude will determine validity
      log(`🖼️ ${doc.filename}: análisis de fecha delegado a Claude (documento imagen).`);
    } else {
      const dates = extractDatesFromText(doc.textContent || '');
      const formattedDates = dates.map(d => d.toISOString().split('T')[0]);
      
      // Filter valid dates <= Today and >= 2020
      const validDates = dates.filter(d => d.getTime() <= todayDate.getTime() && d.getFullYear() >= 2020);
      
      // BUG-02 FIX: Use the EARLIEST valid date as the likely emission date.
      // Certificates contain multiple dates (cut-off date, next payment, account opening, etc.).
      // The emission date is almost always the oldest date on the document.
      // Using Math.max (most recent) was incorrectly picking internal reference dates.
      let mostLikelyDate: Date | null = null;
      if (validDates.length > 0) {
        mostLikelyDate = new Date(Math.min(...validDates.map(d => d.getTime())));
      }
      
      const mostLikelyStr = mostLikelyDate ? mostLikelyDate.toISOString().split('T')[0] : null;
      const ageDays = mostLikelyDate ? getDaysDifference(todayDate, mostLikelyDate) : null;
      
      // An age is valid only if it's <= 30 days and not null
      const isValidAge = ageDays !== null && ageDays <= 30;
      const isExpiredLocal = !isValidAge;
      
      if (isExpiredLocal) {
        algunCertificadoExpirado = true;
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
        checkTypeScript: isValidAge ? "Cumple (antigüedad <= 30 días)" : (ageDays !== null ? `No cumple (antigüedad de ${ageDays} días > 30)` : "No cumple (no se detectó fecha de emisión)")
      });
    }
  }

  // 5c. Renegotiation requirements check
  const totalOverdue90Days = cmfResult ? cmfResult.overdue90DaysTotal : 0;
  const existenciaDeudasMorosas90Dias = totalOverdue90Days > 0;
  const sumaObligaciones90DiasMayor80UF = totalOverdue90Days >= 3253000;
  const cumpleRequisitosSesion = existenciaDeudasMorosas90Dias && sumaObligaciones90DiasMayor80UF;

  // 5d. CMF validation
  const cmfFechaEmision = cmfResult ? cmfResult.fechaEmision : null;
  const cmfAgeDays = cmfResult ? cmfResult.cmfAgeDays : null;
  const cmfAntiguedadValida = cmfAgeDays !== null && cmfAgeDays <= 30;

  const todoDocumentoValidoTS = cmfAntiguedadValida && !algunCertificadoExpirado;

  // 5e. Classify creditors
  const classifiedCreditors = cmfResult ? cmfResult.classifiedCreditors.map(c => {
    const is260 = c.overdue90Days > 0;
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
    requisitosSesion: {
      existenciaDeudasMorosas90Dias,
      sumaObligaciones90Dias: totalOverdue90Days,
      sumaObligaciones90DiasMayor80UF,
      cumpleRequisitosSesion,
      resultadoCheckTS: cumpleRequisitosSesion ? "CUMPLE REQUISITOS PARA NUEVA SESIÓN" : "NO CUMPLE REQUISITOS (Debe tener deudas morosas >= 90 días y suma de ellas >= 80 UF / $3.253.000)"
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
    checkGlobalTypeScript: todoDocumentoValidoTS ? "Todos los documentos cumplen con antigüedad <= 30 días" : "Existen documentos expirados o sin fecha válida"
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
   - Debes re-verificar en el texto de los documentos (CMF y certificados) que NINGUNO tenga más de 30 días de antigüedad con respecto a Hoy (${todayStr}).
   - Si la antigüedad de algún documento supera los 30 días, debes establecer obligatoriamente el campo 'status' como 'error', detallar el problema en 'reason' y emitir la alerta 'expired_cmf' o 'expired_certificate'.

2. **Doble Verificación de Deudas Art. 260**:
   - Para las deudas clasificadas como Artículo 260 (morosidad >= 90 días en CMF): Corrobora en el CMF que realmente tengan mora mayor a 90 días.
   - Identifica y asocia los nombres de archivo de los certificados correspondientes con los que se debe acreditar tanto Monto como Vencimiento.
   - Re-verifica rigurosamente que las fechas de emisión de estos certificados no superen los 30 días respecto a Hoy (${todayStr}).

3. **Doble Verificación de Deudas Art. 261 (Clasificados como 12 y 1)**:
   - Para las deudas clasificadas como Artículo 261 (morosidad < 90 días o al día en CMF):
     - Reconoce si corresponden a créditos 12 (créditos ordinarios, consumo, comercial, etc.) o créditos 1 (tarjetas y líneas de crédito).
     - Corrobora que para estos solo se requiere acreditar Monto.
     - Identifica el archivo de certificado de monto correspondiente.
     - Re-verifica que la fecha de emisión del certificado de monto no sea mayor a 30 días con respecto a Hoy (${todayStr}).

4. **Validación de RUT y Mapeo**:
   - Asocia cada certificado al acreedor del CMF (ej. "Banco Estado", "PRESTO LIDER", "De Credito e Inversiones").
   - Corrobora que el RUT de la institución emisora en el certificado coincida razonablemente con el acreedor.

5. **Salida y Filenames**:
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

    // Extract JSON block from <json>...</json> tags
    const jsonMatch = contentText.match(/<json>([\s\S]*?)<\/json>/i) || contentText.match(/```json([\s\S]*?)```/i);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : contentText.trim();

    let result: OrchestrationResult;
    try {
      result = JSON.parse(jsonStr) as OrchestrationResult;
    } catch (parseErr: any) {
      // Outermost braces JSON extraction fallback
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const cleanedJson = jsonStr.substring(firstBrace, lastBrace + 1);
        result = JSON.parse(cleanedJson) as OrchestrationResult;
      } else {
        throw parseErr;
      }
    }

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
              local_path: doc.local_path
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
              local_path: doc.local_path
            });
          } else {
            log(`⚠️ vencimiento_file "${vencFile}" de Claude no coincide con ningún filename en client_documents para "${inst}". Certificado de vencimiento NO adjuntado.`);
          }
        }
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
      mappedDocs: []
    };
  }
}
