import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { extractTextFromPdf, extractTextFromPdfLayout } from './pdf_analyzer';
import { getCurrentChileDate, getDaysDifference, parseDateString } from './date_helper';
import { analyzeCmfPdf, CmfCreditor } from './cmf_analyzer';
import {
  fetchAcreedoresCatalog,
  matchAcreedor,
  normalizeRut,
  normalizeText,
  extractRutsFromText,
  findCatalogEntryByRut,
  canonicalInstitutionKey,
  AcreedorCatalogEntry,
} from './acreedor_matcher';
import { extractDatesFromText, extractEmissionDateFromText } from './cognitive_orchestrator';
import { extractCertLineItems } from './cert_line_items';
import * as fs from 'fs';
import * as path from 'path';

export interface ReclassifiedCreditor {
  bank: string;
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'otro';
  institucion_cmf: string;
  delinquency_start_date: string; // YYYY-MM-DD
  delinquency_days: number;
  total_credito_clp: number;
  new_classification: 'obligaciones_260';
  reason: string;
  document_filename: string;
}

export interface Identified261Creditor {
  bank: string;
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'otro';
  institucion_cmf: string;
  total_credito_clp: number;
  reason: string;
  document_filename: string;
}

export interface DeReclassified261Creditor {
  bank: string;
  institucion_cmf: string;
  total_credito_clp: number;
  reason: string;
  document_filename: string;
}

interface InstitutionSlots {
  total: number;
  credito_consumo: number;
  tarjeta_credito: number;
  otro: number;
}

function emptyInstitutionSlots(): InstitutionSlots {
  return { total: 0, credito_consumo: 0, tarjeta_credito: 0, otro: 0 };
}

function getCmfProductBucket(c: CmfCreditor): keyof Omit<InstitutionSlots, 'total'> {
  if (c.tipoCredito === 'credito_consumo' || c.tipoCredito === 'tarjeta_credito') {
    return c.tipoCredito;
  }
  return 'otro';
}

function getIdentified261ProductBucket(c: Identified261Creditor): keyof Omit<InstitutionSlots, 'total'> {
  if (c.product_type === 'credito_consumo' || c.product_type === 'tarjeta_credito') {
    return c.product_type;
  }
  return 'otro';
}

export function isChatDocument(textContent: string | null | undefined, filename: string): boolean {
  if (!textContent) return false;
  const textLower = textContent.toLowerCase();
  const nameLower = filename.toLowerCase();
  if (
    nameLower.includes('chat') ||
    nameLower.includes('whatsapp') ||
    nameLower.includes('captura') ||
    textLower.includes('[whatsapp]') ||
    textLower.includes('escribió:') ||
    textLower.includes('escribio:') ||
    textLower.includes('mensajes de whatsapp') ||
    /(\[?\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?)?\]?)/i.test(textContent)
  ) {
    return true;
  }
  return false;
}

/**
 * Acreedor que NO aparece en el Informe CMF pero que igual debe declararse en
 * el Paso 3 (Art. 261 obliga a declarar todos los pasivos): TGR, cajas de
 * compensación, fintechs (Mercado Pago, Tenpo), tarjetas no reportadas, etc.
 * Detectado por reconciliación (diff documentos − CMF): TypeScript marca los
 * candidatos y Claude confirma/extrae los campos.
 */
export interface AdditionalCreditor {
  bank: string;
  institucion_cmf: string;              // nombre para matchear contra acreedores_canonicos
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'tgr' | 'caja_compensacion' | 'otro';
  categoria_articulo: 260 | 261;
  total_credito_clp: number;
  delinquency_start_date?: string;      // YYYY-MM-DD, solo si es 260
  delinquency_days?: number;            // solo si es 260
  reason: string;                       // por qué no está en el CMF y por qué se declara
  document_filename: string;
  needs_lawyer_confirmation: boolean;   // flag — siempre true en esta fase
}

/** Fecha clave calculada determinísticamente (sin Claude) para alertar al abogado. */
export interface FechaClave {
  tipo: 'expiracion_cmf' | 'expiracion_certificado' | 'cruce_261_a_260';
  referencia: string;        // nombre del documento o acreedor
  fecha: string;             // YYYY-MM-DD
  diasRestantes: number;     // negativo si ya pasó
  detalle: string;
}

/**
 * Monto y fecha real extraídos por Claude del certificado de acreditación para
 * un acreedor que ya aparece en el CMF con overdue90Days > 0 (Art.260 directo).
 * Reemplaza el monto del CMF (desactualizado) y el placeholder dateDaysAgo(90).
 */
export interface Cmf260DirectOverride {
  institucion_cmf: string;
  monto_clp: number;
  fecha_vencimiento: string;   // YYYY-MM-DD
  document_filename: string;
}

export interface SentinelResult {
  success: boolean;
  errors: string[];
  technicalError?: boolean; // true = API/red/código; false/undefined = semántico (docs deficientes)
  reclassifiedCreditors?: ReclassifiedCreditor[];
  identified261Creditors?: Identified261Creditor[];
  additionalCreditors?: AdditionalCreditor[];
  /** Monto y fecha real desde certificado para Art.260 directos del CMF (overdue90Days > 0). */
  cmf260DirectOverrides?: Cmf260DirectOverride[];
  /** Productos que el CMF marca 90+d pero cuyo certificado los certifica vigentes → 260→261. */
  deReclassified261Creditors?: DeReclassified261Creditor[];
  fechasClave?: FechaClave[];
  details: {
    meets90DaysRequirement: boolean;
    meetsAmountRequirement: boolean;
    totalAmountCLP: number;
    creditorsWith90DaysCount: number;
    documentsAgeValid: boolean;
    requiredCertificatesPresent: boolean;
  };
}

export interface ClientProfile {
  id: string;
  name: string;
  rut: string;
  informe_cmf_path?: string | null;
  acreditacion_documentos_json?: any;
  [key: string]: any;
}

export interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

/**
 * Recorta el texto de un documento para enviarlo a Claude SIN perder el período
 * más reciente. Los estados de cuenta multi-período (varias páginas, un mes por
 * bloque) suelen venir en orden cronológico ASCENDENTE → el período MÁS RECIENTE
 * está al FINAL del PDF. Truncar solo el inicio (`substring(0, N)`) dejaba afuera
 * los meses recientes y el Centinela leía el más viejo (monto y clasificación
 * 260/261 equivocados). Solución: enviar el INICIO (encabezado/emisor + primer
 * período) + el FINAL (período más reciente), con un marcador del corte. Para
 * docs cortos devuelve el texto completo. Robusto al orden: si el más reciente
 * estuviera al inicio, igual queda incluido.
 */
const DOC_HEAD_CHARS = 3500;
const DOC_TAIL_CHARS = 9000;
export function clampDocTextForClaude(text: string): string {
  const t = text ?? '';
  if (t.length <= DOC_HEAD_CHARS + DOC_TAIL_CHARS) return t;
  return (
    t.slice(0, DOC_HEAD_CHARS) +
    '\n\n[…FRAGMENTO INTERMEDIO OMITIDO POR LONGITUD. Arriba: INICIO del documento (emisor/encabezado + período más antiguo). Abajo: FINAL del documento, donde normalmente está el período MÁS RECIENTE — usá ESE para el monto y la clasificación 260/261…]\n\n' +
    t.slice(-DOC_TAIL_CHARS)
  );
}

/**
 * Executes API Key #1 (Sentinel) to analyze the CMF and certificates uploaded by the lawyer.
 * Bypassed only if DISABLE_SENTINEL=true is set explicitly.
 */
export async function runSentinelCheck(
  client: ClientProfile,
  supabase: SupabaseClient,
  logger: SimpleLogger
): Promise<SentinelResult> {
  const isDisabled = process.env.DISABLE_SENTINEL === 'true';
  const log = (msg: string) => logger.log(`🛡️ [Centinela] ${msg}`);
  const logError = (msg: string, err?: any) => logger.error(`🛡️ [Centinela] ${msg}`, err);

  if (isDisabled) {
    log('🛡️ Modo Bypass activo (DISABLE_SENTINEL=true). Omitiendo validación preventiva.');
    return {
      success: true,
      errors: [],
      details: {
        meets90DaysRequirement: true,
        meetsAmountRequirement: true,
        totalAmountCLP: 0,
        creditorsWith90DaysCount: 2,
        documentsAgeValid: true,
        requiredCertificatesPresent: true,
      },
    };
  }

  log('Iniciando análisis preventivo por IA...');

  if (!client.informe_cmf_path) {
    return {
      success: false,
      errors: ['No se ha registrado la ruta del Informe CMF en el perfil del cliente.'],
      details: {
        meets90DaysRequirement: false,
        meetsAmountRequirement: false,
        totalAmountCLP: 0,
        creditorsWith90DaysCount: 0,
        documentsAgeValid: false,
        requiredCertificatesPresent: false,
      },
    };
  }

  const tempDir = path.join(process.cwd(), 'outputs');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const cmfLocalPath = path.join(tempDir, `sentinel_cmf_${client.id}.pdf`);
  const tmpDir = path.join(process.cwd(), 'outputs', 'acreditaciones_tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. Descargar e inspeccionar CMF
    log(`Descargando CMF de Supabase Storage: ${client.informe_cmf_path}...`);
    const { data: cmfBlob, error: cmfError } = await supabase.storage
      .from('documentos')
      .download(client.informe_cmf_path);

    if (cmfError || !cmfBlob) {
      throw new Error(`Error al descargar CMF: ${cmfError?.message || 'Blob vacío'}`);
    }
    fs.writeFileSync(cmfLocalPath, Buffer.from(await cmfBlob.arrayBuffer()));
    log('CMF descargado.');

    const cmfResult = await analyzeCmfPdf(cmfLocalPath, logger);
    const cmfText = (await extractTextFromPdf(cmfLocalPath)).substring(0, 15000);

    // 2. Obtener y descargar certificados
    log('Obteniendo certificados de acreditación desde Supabase...');
    let documents: any[] = [];
    const { data: dbDocs, error: dbErr } = await supabase
      .from('client_documents')
      .select('*')
      .eq('client_id', client.id);

    if (dbErr) {
      log(`⚠️ Tabla client_documents no disponible, usando fallback desde client.acreditacion_documentos_json. Detalle: ${dbErr.message}`);
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

    if (documents.length === 0 && client.acreditacion_documentos_json && Array.isArray(client.acreditacion_documentos_json)) {
      log(`Utilizando fallback desde client.acreditacion_documentos_json (${client.acreditacion_documentos_json.length} encontrados)...`);
      documents = client.acreditacion_documentos_json.map((doc: any, index: number) => {
        const docType = doc.tipo_documento;
        let acreditacionTipo = 'general';
        if (docType === 22) acreditacionTipo = 'monto';
        else if (docType === 23) acreditacionTipo = 'vencimiento';
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

    if (documents.length === 0) {
      return {
        success: false,
        errors: ['El cliente no tiene certificados de acreditación de deuda ni de vencimiento registrados.'],
        details: {
          meets90DaysRequirement: cmfResult.meets90DaysRequirement,
          meetsAmountRequirement: cmfResult.meetsAmountRequirement,
          totalAmountCLP: cmfResult.totalCreditoOf90PlusCreditors,
          creditorsWith90DaysCount: cmfResult.qualifying90PlusCount,
          documentsAgeValid: false,
          requiredCertificatesPresent: false,
        },
      };
    }

    // Descargar cada certificado y extraer texto/imagen
    for (const doc of documents) {
      const ext = path.extname(doc.storage_path) || '.pdf';
      const slug = path.basename(doc.storage_path, ext);
      const localPath = path.join(tmpDir, `sentinel_${slug}${ext}`);
      doc.local_path = localPath;

      if (!fs.existsSync(localPath)) {
        log(`Descargando "${doc.filename}"...`);
        const { data, error } = await supabase.storage.from('documentos').download(doc.storage_path);
        if (error || !data) throw new Error(`Error al descargar ${doc.filename}: ${error?.message || 'vacío'}`);
        fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
      }

      // Determinar si es PDF de texto, PDF escaneado o Imagen
      const extLower = ext.toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extLower);

      if (isImage) {
        doc.isImageDoc = true;
        doc.imageMimeType = extLower === '.png' ? 'image/png' : 'image/jpeg';
        doc.imageBase64 = fs.readFileSync(localPath).toString('base64');
        doc.textContent = '[IMAGEN: Claude analizará la imagen directamente]';
      } else {
        const fullText = await extractTextFromPdf(localPath).catch(() => '');
        if (fullText.trim().length < 50) {
          // OCR multi-página (Tesseract) reemplaza GS+Vision: lee todas las páginas
          const { extractTextWithOcrFallback } = await import('./ocr_helper');
          const { text: ocrText } = await extractTextWithOcrFallback(localPath, 50);
          if (ocrText.trim().length > 30) {
            doc.isImageDoc = false;
            doc.textContent = clampDocTextForClaude(ocrText);
            log(`📄 OCR: ${doc.filename} (${ocrText.length} chars OCR → ${doc.textContent.length} enviados: inicio+final, todas las páginas)`);
          } else {
            // OCR también falló — sin contenido útil
            doc.isImageDoc = false;
            doc.textContent = '[PDF PROTEGIDO O NO CONVERTIBLE: sin texto extraíble. Verificar contraseña o calidad del archivo.]';
            log(`⚠️ ${doc.filename}: OCR no produjo texto suficiente. Placeholder enviado a Claude.`);
          }
        } else {
          doc.isImageDoc = false;
          doc.textContent = clampDocTextForClaude(fullText);
        }
      }
    }

    // 3. Ejecutar pre-análisis TypeScript determinista
    const todayDate = getCurrentChileDate();
    const todayStr = todayDate.toISOString().split('T')[0];

    let catalog: AcreedorCatalogEntry[] = [];
    try {
      catalog = await fetchAcreedoresCatalog(supabase);
    } catch {}

    const clientRutForCerts = client.rut ?? null;

    // Helper de RUT check
    const computeRutCheckLocal = (assignedInst: string | null, certText: string) => {
      const result = { rutEmisorDetectado: null as string | null, bancoSegunRut: null as string | null, rutMismatch: false, rutCheckTypeScript: '' };
      if (catalog.length === 0) return result;

      const certRuts = extractRutsFromText(certText);
      const certNorm = normalizeText(certText);
      const assignedMatch = assignedInst ? matchAcreedor(assignedInst, catalog) : null;
      const assignedEntry = assignedMatch && assignedMatch.status === 'matched' ? assignedMatch.entry! : null;
      const assignedRutNorm = assignedEntry ? normalizeRut(assignedEntry.rut) : null;

      if (assignedRutNorm && certRuts.includes(assignedRutNorm)) {
        result.rutEmisorDetectado = assignedRutNorm;
        result.bancoSegunRut = assignedEntry!.nombre;
        result.rutCheckTypeScript = `RUT coincide con banco asignado: ${assignedRutNorm}`;
        return result;
      }

      const detected = findCatalogEntryByRut(certRuts, catalog, clientRutForCerts);
      if (detected) {
        result.rutEmisorDetectado = normalizeRut(detected.rut);
        result.bancoSegunRut = detected.nombre;
      }

      if (assignedRutNorm && detected && normalizeRut(detected.rut) !== assignedRutNorm) {
        result.rutMismatch = true;
        result.rutCheckTypeScript = `POSIBLE BANCO INCORRECTO: el RUT ${result.rutEmisorDetectado} pertenece a "${detected.nombre}" y el asignado es "${assignedInst}" (${assignedRutNorm}).`;
        return result;
      }

      return result;
    };

    const certificateAnalyses: any[] = [];
    let algunCertificadoExpirado = false;

    for (const doc of documents) {
      if (doc.isImageDoc) {
        certificateAnalyses.push({
          filename: doc.filename,
          document_type: doc.document_type,
          acreditacion_tipo: doc.acreditacion_tipo,
          isImageDoc: true,
          antiguedadValida: false,
          rutMismatch: false,
          checkTypeScript: 'IMAGEN: Delegado a Claude Vision.'
        });
      } else {
        const { date: mostLikelyDate } = extractEmissionDateFromText(doc.textContent || '', todayDate);
        const ageDays = mostLikelyDate ? getDaysDifference(todayDate, mostLikelyDate) : null;

        // Determinar si es un estado de cuenta (exento)
        const isStatement = doc.acreditacion_tipo === 'estado_cuenta' ||
          /estado\s+de\s+cuenta|cartola|factura|boleta/i.test(doc.filename) ||
          /estado\s+de\s+cuenta|cartola/i.test(doc.textContent || '');

        const isValidAge = isStatement || (ageDays !== null && ageDays <= 30);
        if (!isValidAge) algunCertificadoExpirado = true;

        const rutCheck = computeRutCheckLocal(doc.institucion_cmf, doc.textContent || '');

        certificateAnalyses.push({
          filename: doc.filename,
          document_type: doc.document_type,
          acreditacion_tipo: doc.acreditacion_tipo,
          isImageDoc: false,
          mostLikelyDate: mostLikelyDate ? mostLikelyDate.toISOString().split('T')[0] : null,
          ageDays,
          antiguedadValida: isValidAge,
          isStatement,
          rutMismatch: rutCheck.rutMismatch,
          rutEmisorDetectado: rutCheck.rutEmisorDetectado,
          bancoSegunRut: rutCheck.bancoSegunRut,
          checkTypeScript: isStatement ? 'Exento de límite por ser Estado de Cuenta' : (isValidAge ? 'Vigente' : 'Expirado (>30 días)')
        });
      }
    }

    const cmfAgeDays = cmfResult.cmfAgeDays;
    const cmfAntiguedadValida = cmfAgeDays !== null && cmfAgeDays <= 30;
    const documentsAgeValid = cmfAntiguedadValida && !algunCertificadoExpirado;

    // Verificar presencia de certificados por acreedor
    const classifiedCreditors = cmfResult.classifiedCreditors.map(c => {
      const is260 = c.overdue90Days > 0;
      const associated = documents.filter(d => {
        const normD = d.institucion_cmf ? d.institucion_cmf.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
        const normC = c.institucion.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normD === normC || normD.includes(normC) || normC.includes(normD);
      });

      const hasMonto = associated.some(d => d.document_type === 22 || d.document_type === 24);
      const hasVencimiento = associated.some(d => d.document_type === 23 || d.document_type === 24);
      const ok = is260 ? (hasMonto && hasVencimiento) : hasMonto;

      return {
        institucion: c.institucion,
        overdue90Days: c.overdue90Days,
        categoriaArticulo: c.categoriaArticulo,
        documentosAsociadosCount: associated.length,
        hasMontoCertificate: hasMonto,
        hasVencimientoCertificate: hasVencimiento,
        cumpleAcreditacion: ok
      };
    });

    const requiredCertificatesPresent = classifiedCreditors.every(c => c.cumpleAcreditacion);

    // --- Pre-pase determinista de reconciliación NO-CMF (diff documentos − CMF) ---
    // TS marca candidatos; Claude confirma/extrae. Match por RUT del emisor primero,
    // luego por nombre de institución (bidireccional). El caso "mismo banco, producto
    // distinto" (ej. tarjeta vs consumo de Banco de Chile) lo resuelve Claude.
    const cmfRutSet = new Set<string>();
    const cmfNameNorms: string[] = [];
    for (const c of cmfResult.creditors) {
      cmfNameNorms.push(normalizeText(c.institucion));
      const m = matchAcreedor(c.institucion, catalog);
      if (m.status === 'matched' && m.entry?.rut) {
        const r = normalizeRut(m.entry.rut);
        if (r) cmfRutSet.add(r);
      }
    }

    const nonCmfReconciliation = documents.map(doc => {
      const docText = doc.textContent || '';
      const docRuts = doc.isImageDoc ? [] : extractRutsFromText(docText);
      const detected = findCatalogEntryByRut(docRuts, catalog, clientRutForCerts);
      const issuerRutNorm = detected?.rut ? normalizeRut(detected.rut) : null;
      const issuerName = detected?.nombre ?? doc.institucion_cmf ?? null;
      const assignedNorm = doc.institucion_cmf ? normalizeText(doc.institucion_cmf) : '';
      const issuerNorm = issuerName ? normalizeText(issuerName) : '';
      const nameInCmf = cmfNameNorms.some(n =>
        (!!assignedNorm && (n.includes(assignedNorm) || assignedNorm.includes(n))) ||
        (!!issuerNorm && (n.includes(issuerNorm) || issuerNorm.includes(n)))
      );
      const rutInCmf = issuerRutNorm ? cmfRutSet.has(issuerRutNorm) : false;
      const issuerInCmf = nameInCmf || rutInCmf;
      return {
        filename: doc.filename,
        institucion_cmf_asignada: doc.institucion_cmf,
        rutEmisorDetectado: issuerRutNorm,
        bancoSegunRut: detected?.nombre ?? null,
        issuerInCmf,
        isImageDoc: !!doc.isImageDoc,
        acreditacion_tipo: doc.acreditacion_tipo,
        instruccion: issuerInCmf
          ? 'El emisor SÍ aparece en el CMF. Solo es acreedor NO-CMF si representa un PRODUCTO DISTINTO no listado en el CMF para esa institución (ej. una tarjeta cuando el CMF solo tiene un crédito de consumo del mismo banco). Si solo respalda una línea que ya está en el CMF, NO lo agregues a additionalCreditors.'
          : 'El emisor NO aparece en el CMF. Candidato fuerte a acreedor NO-CMF (ej. TGR, caja de compensación, fintech). Confirma que es una deuda real a declarar (NO un documento que dice "no tiene deuda") antes de agregarlo.'
      };
    });

    // --- Fechas clave deterministas (sin Claude): expiración CMF/certificados ---
    const fechasClave: FechaClave[] = [];
    const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const cmfEmis = cmfResult.fechaEmision ? parseDateString(cmfResult.fechaEmision) : null;
    if (cmfEmis) {
      const exp = addDays(cmfEmis, 30);
      fechasClave.push({
        tipo: 'expiracion_cmf',
        referencia: 'Informe CMF',
        fecha: fmt(exp),
        diasRestantes: getDaysDifference(exp, todayDate),
        detalle: `CMF emitido ${cmfResult.fechaEmision}; vence a los 30 días.`,
      });
    }
    for (const ca of certificateAnalyses) {
      if (ca.isImageDoc || ca.isStatement || !ca.mostLikelyDate) continue;
      const emis = parseDateString(ca.mostLikelyDate);
      if (!emis) continue;
      const exp = addDays(emis, 30);
      fechasClave.push({
        tipo: 'expiracion_certificado',
        referencia: ca.filename,
        fecha: fmt(exp),
        diasRestantes: getDaysDifference(exp, todayDate),
        detalle: `Certificado emitido ${ca.mostLikelyDate}; vence a los 30 días.`,
      });
    }

    const localAnalysis = {
      todayReference: todayStr,
      cmf: {
        filename: path.basename(cmfLocalPath),
        fechaEmision: cmfResult.fechaEmision,
        ageDays: cmfAgeDays,
        antiguedadValida: cmfAntiguedadValida
      },
      requisitosSesion: {
        qualifying90PlusCount: cmfResult.qualifying90PlusCount,
        meets90DaysRequirement: cmfResult.meets90DaysRequirement,
        totalCreditoOf90Plus: cmfResult.totalCreditoOf90PlusCreditors,
        meetsAmountRequirement: cmfResult.meetsAmountRequirement
      },
      requiresReclassificationAnalysis: !cmfResult.meets90DaysRequirement,
      documentsForReclassification: !cmfResult.meets90DaysRequirement
        ? documents
            .filter(d => d.acreditacion_tipo === 'estado_cuenta' || d.acreditacion_tipo === 'general')
            .map(d => ({
              filename: d.filename,
              institucion_cmf: d.institucion_cmf,
              acreditacion_tipo: d.acreditacion_tipo,
              instruccion: d.acreditacion_tipo === 'estado_cuenta'
                ? 'Estado de cuenta: buscar primer mes donde Pago Realizado < Monto Mínimo (o $0). Ese vencimiento inicia la mora.'
                : 'Informe/certificado de crédito: localizar cuotas vencidas + fecha próximo pago, reconstruir hacia atrás para hallar cuota más antigua.'
            }))
        : [],
      creditors: classifiedCreditors,
      certificates: certificateAnalyses,
      nonCmfReconciliation,
      documentsAgeValid,
      requiredCertificatesPresent
    };

    // 4. Llamar a Claude (API Key #1)
    if (!process.env.ANTHROPIC_API_KEY) {
      log('⚠️ ANTHROPIC_API_KEY no encontrada en .env. Se retorna error de configuración del Centinela.');
      return {
        success: false,
        errors: ['Falta ANTHROPIC_API_KEY en el archivo de configuración (.env).'],
        details: {
          meets90DaysRequirement: cmfResult.meets90DaysRequirement,
          meetsAmountRequirement: cmfResult.meetsAmountRequirement,
          totalAmountCLP: cmfResult.totalCreditoOf90PlusCreditors,
          creditorsWith90DaysCount: cmfResult.qualifying90PlusCount,
          documentsAgeValid,
          requiredCertificatesPresent
        }
      };
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `Eres el Centinela de Carga preventivo (API Key #1) para el estudio de renegociaciones de deuda en Chile (Ley 20.720 — Superir).

**FECHA DE REFERENCIA HOY: ${todayStr}** — usa esta fecha para todos los cálculos de días de mora y antigüedad.

**CONTEXTO CRÍTICO:** El Informe CMF puede estar desactualizado. Si muestra $0 en la columna de mora 90+ días para un acreedor, pero los documentos adjuntos (estados de cuenta, informes de crédito) demuestran mora real ≥ 91 días desde hoy, debes detectarlo y registrarlo en "reclassifiedCreditors". El pre-análisis TypeScript te indica cuándo esto es necesario (campo "requiresReclassificationAnalysis").

---
**REGLA 1 — Antigüedad de documentos (referencia: ${todayStr})**
- CMF y certificados de acreditación: ≤30 días. Si superan este límite → error.
- EXCEPCIÓN: Los estados de cuenta mensuales (bancarios o de tarjeta) están EXENTOS del límite de 30 días, sin importar su antigüedad.

---
**REGLA 2 — Reclasificación por documentos (aplica cuando "requiresReclassificationAnalysis" es true)**
Cuando el CMF no muestra suficientes productos con mora ≥91d, analiza CADA documento de los indicados en "documentsForReclassification":

A) **Crédito de Consumo** (informe de crédito o certificado):
   1. Localiza "Cuotas Vencidas no Pagadas" (N = cantidad de cuotas impagas).
   2. Localiza "Fecha Próximo Pago" o "Próxima Cuota de Vencimiento" (la fecha futura de pago, ej. 03/12/2024).
   3. Reconstruye hacia atrás: la cuota más antigua vencida = próxima_fecha − (N × ~30 días).
      Ejemplo: próxima=03/12/2024, N=3 cuotas → cuota 4 venció 03/09/2024.
   4. Calcula días_mora = ${todayStr} − fecha_cuota_mas_antigua.
   5. Si días_mora ≥ 91 → agregar a reclassifiedCreditors.
   6. El monto declarado = "Saldo Total", "Saldo Insoluto" o "Capital Vigente".

B) **Tarjeta de Crédito** (estados de cuenta mensuales):
   1. Analiza mes a mes buscando el PRIMER período donde Pago Realizado < Monto Mínimo a Pagar (incluyendo $0).
   2. La fecha "PAGAR HASTA" o "VENCE EL" de ese período es el inicio de la mora.
   3. Calcula días_mora = ${todayStr} − fecha_primer_vencimiento_incumplido.
   4. Si días_mora ≥ 91 → agregar a reclassifiedCreditors.
   5. El monto declarado = "CUPO TOTAL" o "Límite de Crédito Autorizado".

---
**REGLA 3 — Requisito multiproducto (≥2 productos con mora ≥91d)**
Suma los productos calificados por CMF + los reclasificados por documentos.
- Si total ≥ 2 → meets90DaysRequirement = true.
- Si total < 2 → meets90DaysRequirement = false → incluir en errors.

---
**REGLA 4 — Monto mínimo (≥80 UF = $3.253.000 CLP)**
Suma los montos de todos los productos calificados (CMF + reclasificados).
- Si suma ≥ $3.253.000 → meetsAmountRequirement = true.
- Si suma < $3.253.000 → meetsAmountRequirement = false → incluir en errors.

---
**REGLA 5 — Documentos de acreditación por acreedor**
- Art. 260 (mora ≥91d, por CMF o reclasificado): necesita acreditar monto Y vencimiento.
- Art. 261 (<91d, no reclasificado): necesita solo monto.
Verifica que cada acreedor calificado tenga los documentos necesarios.

---
**REGLA 6 — RUT del emisor**
Si el documento tiene texto extraíble, verifica que el RUT del emisor corresponda al banco asignado.

---
**⚠️ REGLA TRANSVERSAL — Cómo leer el MONTO de un estado de cuenta (aplica a Reglas 2B, 7, 8 y 9)**

(A) **VARIOS PERÍODOS en un mismo PDF**: muchos estados de cuenta traen varios meses de facturación (a veces en cualquier orden — no necesariamente el más nuevo primero). **Usa SIEMPRE el período MÁS RECIENTE** (el de la fecha "PAGAR HASTA" / "Período Facturado" / "VENCE EL" más nueva), NO el primero que aparece ni el más viejo. Revisa TODAS las páginas e identifica el período con la fecha más reciente. (Ej.: un PDF con 4 estados de cuenta enero→abril → usa el de abril aunque enero esté en la página 1.) ⚠️ Si el texto del documento viene cortado con el marcador "[…FRAGMENTO INTERMEDIO OMITIDO…]", el período MÁS RECIENTE está en la parte de ABAJO (después del marcador) — leé ahí el monto, la fecha "PAGAR HASTA" y la clasificación 260/261.

(B) **VARIOS CUPOS / LÍNEAS en la misma tarjeta**: una tarjeta puede tener MÁS DE UN cupo o línea de crédito (ej. "Cupo Compras" + "Cupo Avances en Efectivo" / "Avances XL" / "Súper Avance" / "Avance NN"). El monto a declarar es la **SUMA de los "Cupo Utilizado" de TODOS los componentes** del período más reciente, no solo el primero/principal. ⚠️ Es un error frecuente declarar solo el cupo de Compras y omitir el de Avances. (Ej. real La Polar: Cupo Compras utilizado $258.543 + Cupo Avances XL utilizado $495.755 = **$754.298** a declarar — NO $258.543.)

---
**REGLA 7 — Identificar deudas Art. 261 (deudas vigentes, sin mora ≥91d)**
Para CADA documento adjunto cuyo acreedor NO fue reclasificado a Art. 260, analiza si corresponde a una deuda vigente (al día o con mora <91d). Si es así, agrégalo a "identified261Creditors" con:
- bank: nombre del banco
- product_type: tipo de producto ("credito_consumo", "tarjeta_credito", u "otro")
- institucion_cmf: nombre según CMF (usa el campo "institucion_cmf" del documento)
- total_credito_clp: monto total de la deuda según el documento — **del período MÁS RECIENTE** (Regla Transversal): el saldo/cupo utilizado/deuda total facturada del último estado de cuenta del PDF.
- reason: explicación breve de por qué es Art. 261 (ej. "Cargo automático liquidó mora; deuda vigente sin mora ≥91d")
- document_filename: nombre del archivo que acredita la deuda

Esta información permite al Orquestador Cognitivo (API Key #2) mapear correctamente los documentos de los Otros Acreedores (Art. 261).

---
**REGLA 8 — Acreedores NO-CMF (reconciliación documentos − CMF)**
Algunas deudas reales NO aparecen en el Informe CMF pero IGUAL deben declararse en el Paso 3 (Art. 261 obliga a declarar todos los pasivos): deudas con TGR (Tesorería General de la República), cajas de compensación, fintechs (Mercado Pago, Tenpo), tarjetas no reportadas, deudas castigadas, etc. Omitir un pasivo invalida el escrito; declararlo dos veces también es un error grave.

El pre-análisis TypeScript te entrega "nonCmfReconciliation": una fila por documento con el flag determinista "issuerInCmf" (¿el emisor aparece en el CMF?) y una "instruccion". Tu trabajo:

1. Para cada documento, decide si representa un acreedor NO-CMF a declarar:
   - **issuerInCmf = false** → el emisor no está en el CMF (ej. TGR, caja, fintech). Es candidato fuerte. Confírmalo leyendo el documento: ¿prueba una deuda real? Si el documento dice explícitamente que NO existe deuda (ej. "DEUDA TGR ... NO TIENE"), NO lo agregues.
   - **issuerInCmf = true** → el emisor SÍ está en el CMF. Solo agrégalo si el documento prueba un PRODUCTO DISTINTO que NO está representado por ninguna línea del CMF de esa institución (ej. el CMF tiene solo el crédito de consumo de Banco de Chile, pero el documento es de una tarjeta de crédito de Banco de Chile con cupo propio). Si el documento solo respalda una deuda que YA está en el CMF, NO lo agregues (sería duplicado).

2. Para cada acreedor NO-CMF confirmado, clasifícalo:
   - Si tiene mora ≥91 días (calculada con las reglas A/B de la Regla 2) → categoria_articulo = 260, e incluye delinquency_start_date y delinquency_days.
   - Si está al día o con mora <91 días → categoria_articulo = 261 (acredita solo monto).

3. **bank / institucion_cmf = el emisor REAL según el CONTENIDO del documento** (la marca de la tarjeta o el nombre en el encabezado y en las transacciones), NO el nombre del archivo ni una etiqueta genérica. El nombre del archivo puede engañar. Ejemplos: si las transacciones dicen "Lapolar"/"Avance XL" → el emisor es **La Polar** (aunque el archivo se llame "ESTADO_CTA_ABC"); "ABCDIN"/"Dijon" → ABCDIN/COFISA; "Ripley" → Ripley; "Hites" → Hites. Da el nombre comercial claro y ÚNICO del emisor (no una lista de candidatos ni "X / Y / Z").

4. **monto_clp**: aplica la REGLA TRANSVERSAL (período más reciente + SUMA de todos los cupos: Compras + Avances/Avances XL/etc.).
   - ⚠️ **Deudas fiscales / impuestos / contribuciones en cuotas (TGR, impuesto territorial, patentes municipales, permisos de circulación)** — regla general, cualquier organismo: declara SOLO la **deuda morosa / vencida** (la(s) cuota(s) ya exigible(s) e impaga(s) — rótulos "Total Deuda Morosa", "Deuda Vencida", "Monto Vencido", "Cuotas vencidas"). **NUNCA sumes las cuotas "no vencidas" / "por vencer" / "deuda no vencida"** (cuotas con fecha de vencimiento POSTERIOR a hoy): aún no son exigibles y NO se declaran como pasivo. A diferencia de un crédito (donde el payoff acelera todo el capital a hoy), cada cuota de un tributo es una obligación periódica independiente que solo nace al vencer. Ej.: certificado TGR que separa "deuda morosa (vencida 30-Abr): $18.537" + "deuda no vencida (vence 30-Jun): $17.944" → declara **$18.537**, NO $36.481.

5. Devuélvelos en "additionalCreditors". NO los repitas en reclassifiedCreditors ni identified261Creditors (esos son SOLO para acreedores que ya están en el CMF). additionalCreditors es exclusivamente para los que NO están en el CMF.

6. **RECONCILIA POR OPERACIÓN, no por institución (regla general — aplica aunque el banco ya esté en el CMF).** Un MISMO certificado puede listar VARIAS operaciones de un banco (cada una con su N° de Operación / N° CRE / N° de crédito y su propio saldo a pagar), mientras que el CMF lista MENOS líneas de esa institución. El CMF puede estar incompleto: una operación real puede no figurar. Procede así:
   a. Enumera TODAS las operaciones DISTINTAS que el certificado muestra para esa institución (identifícalas por su número de operación/CRE; si no hay número, por su monto).
   b. Empareja cada operación del certificado con una línea del CMF de esa institución (por número de operación si está; si no, por monto aproximado).
   c. Por CADA operación del certificado que NO quede emparejada con ninguna línea del CMF → **declárala como producto adicional** en "additionalCreditors", con su artículo 260/261 según su mora (260 si mora ≥91d con vencimiento acreditable; 261 si está al día o sin vencimiento acreditable). Es deuda real que el CMF no reportó. Pon en "reason" que es una operación adicional del banco no representada por ninguna línea del CMF.
   ⚠️ **NO confundir con CONSOLIDACIÓN (no dividir).** Si el certificado descompone UN ÚNICO crédito del CMF en varias sub-partidas (cuotas, capital + intereses + seguros, abonos parciales) cuya SUMA ≈ el monto de esa única línea del CMF, es UN solo producto → NO crees varias filas. El criterio de decisión: ¿cada operación del certificado es un crédito INDEPENDIENTE con su propio saldo a liquidar (→ filas separadas), o son COMPONENTES de un mismo payoff que ya está en una línea del CMF (→ una sola fila)? Ej. de consolidación (NO dividir): el CMF trae 1 crédito de consumo de $11.6M y el certificado lo detalla en 3 operaciones que suman ~$11.6M → 1 fila.
   Ej. de operación adicional (SÍ declarar): el certificado de BancoEstado lista 3 operaciones — CRE-00039038355 $36.130.323, CRE-00040145148 $389.848 y CRE-00040166973 $553.350 — pero el CMF solo trae 2 líneas de BancoEstado. La 3ª (CRE-00040166973 $553.350) no está en el CMF → va a "additionalCreditors" (Art. 261 si está al día), creando una fila extra en el portal.

---
**REGLA 9 — Monto y fecha real para acreedores Art.260 directos del CMF**
Algunos acreedores ya aparecen en el CMF con "overdue90Days > 0" (campo en el array "creditors" del pre-análisis). Estos NO requieren reclasificación. Sin embargo, el certificado de acreditación tiene el monto más actualizado y la fecha real de la primera cuota impaga — el portal debe recibir ese dato del documento, NO el del CMF.

Para cada acreedor en el array "creditors" donde "overdue90Days > 0" Y cuyo nombre NO aparece en el array "reclassifiedCreditors" que acabas de construir:
1. Localiza el certificado asociado (busca en el texto de los certificados por nombre de institución).
2. Del documento, extrae:
   - "monto_clp": la **DEUDA ACTUAL del producto** (lo que el deudor debe declarar). Elige el campo con esta PRIORIDAD (regla general — vale para CUALQUIER banco/institución, no un caso puntual):
       1. **PAYOFF / monto para liquidar** (el MEJOR dato si existe): rótulos "Monto total a pagar", "Total a pagar", "Deuda total", "Monto de prepago", "Saldo total a pagar", "Es la suma de:". Incluye capital + intereses + seguros/recargos.
       2. Si NO hay payoff: **"Saldo Insoluto" / "Saldo deudor" / "Saldo de la deuda" / "Capital adeudado"** (lo que queda debiendo HOY). Para tarjetas: cupo utilizado / deuda total facturada del período más reciente.
       ⛔ **NUNCA uses el MONTO ORIGINAL del crédito**: los rótulos "Monto", "Monto Aprobado", "Monto Cursado", "Monto Otorgado", "Monto Contratado", "Monto Inicial/Original" (o la cifra junto a "Inicio / Término / Moneda") son el capital prestado al ORIGEN, NO la deuda actual → SOBRE-declaran. En un crédito amortizado el monto original es MAYOR que la deuda vigente; si ves dos cifras y una es claramente "lo aprobado/otorgado" y otra "lo que se debe", declara la segunda.
       🎯 **ANCLA OBLIGATORIA EN EL CMF**: el campo "totalCredito" del CMF para ese producto (está en el pre-análisis "creditors") es la deuda VIGENTE que la institución reporta hoy. Tu "monto_clp" debe ser COHERENTE con ese valor: difiere solo por intereses de mora / costas de cobranza (lo sube un poco) o por pagos recientes (lo baja). Si tu candidato es claramente MAYOR que el "totalCredito" del CMF y el documento NO muestra cobranza judicial/recargos que lo expliquen, casi seguro tomaste el MONTO ORIGINAL → descártalo, busca el Saldo Insoluto / payoff y corrige. Ejemplo del modo de fallo a evitar: cert con "Monto" $8.183.872 (original) y "Saldo Insoluto" $6.756.287 (deuda real), CMF $7.263.340 → declara **$6.756.287** (coherente con el CMF), NUNCA $8.183.872.
   - "fecha_vencimiento": la fecha en que la deuda entró en mora / se hizo exigible, en formato YYYY-MM-DD. PRIORIDAD de la fuente en el documento:
     1. Si el certificado trae una fecha explícita de inicio de mora/cobranza — rótulos como **"Cobranza Judicial iniciada"**, "Fecha inicio mora", "Fecha de mora", "Fecha primera cuota impaga", "En cobranza desde" — **usa ESA** (es la que usa el abogado). En liquidaciones con varios productos suele ser la MISMA fecha para todos.
     • Crédito de consumo (si no hay rótulo de mora): fecha de la cuota más antigua vencida (misma lógica Regla 2A).
     • Tarjeta de crédito (si no hay rótulo de mora): fecha "PAGAR HASTA" del primer período incumplido.
     ⚠️ NO uses la "Fecha de Contratación"/"Fecha de inicio del crédito" ni el "Próximo Pago" como vencimiento — esos NO son la fecha de mora.
3. **Un certificado que cubre VARIOS productos de la misma institución** (ej. un certificado de liquidación Santander con 3 créditos de consumo) → emite **un override POR CADA producto**, cada uno con el "Monto total a pagar" y la fecha de ESE producto. Distingue cada uno en "institucion_cmf" agregando el identificador del producto entre paréntesis (tipo + fecha + N° de operación), ej. "Banco Santander-Chile (Consumo 05/06/2025 — Op. 650052258302)". Es CRÍTICO: cada producto se declara como una fila separada en el portal, así que NO consolides los montos en uno solo ni repitas el mismo monto en varios productos.
   ✅ **DECLARA las deudas rotuladas "VARIOS DEUDORES" / "OTROS DEUDORES"**: son deuda DIRECTA del deudor (figura como titular junto a otras personas) y SIEMPRE se declaran (regla del abogado, 2026-06-23). Emite su override igual que cualquier otro producto, con su "Monto total a pagar" y su fecha. ⚠️ **EXCLUYE solo**: (a) la deuda INDIRECTA donde el deudor es **codeudor / fiador / aval de un TERCERO** (garantía de deuda ajena — el CMF la lista en su sección "Deuda Indirecta" aparte), y (b) los **montos triviales (< 1 UF ≈ $40.000)** que son remanentes/comisiones residuales, NO un producto real. Ej.: si el certificado lista 3 consumos + 1 "VARIOS DEUDORES" de $45.798, emite **4 overrides** (incluido el varios deudores). Solo omitirías un "VARIOS DEUDORES" si su monto fuera trivial (< 1 UF, ej. $11).
4. Si no hay certificado asociado, o el documento no contiene esta información, omite ese acreedor de "cmf260DirectOverrides".

Devuelve los resultados en "cmf260DirectOverrides". NO repitas en reclassifiedCreditors a los acreedores que ya estaban en el CMF como Art.260 — solo van aquí.

---
**IMPORTANTE:** Si los documentos demuestran que los requisitos se cumplen aunque el CMF no lo refleje, el resultado puede ser "success": true con reclassifiedCreditors no vacío.

Responde ÚNICAMENTE con un bloque JSON encerrado en <json>...</json>. Nada de texto fuera de esas etiquetas.

Esquema JSON esperado:
\`\`\`json
{
  "success": true,
  "errors": [],
  "reclassifiedCreditors": [
    {
      "bank": "Banco de Chile",
      "product_type": "credito_consumo",
      "institucion_cmf": "Banco de Chile",
      "delinquency_start_date": "2024-09-03",
      "delinquency_days": 91,
      "total_credito_clp": 48236275,
      "new_classification": "obligaciones_260",
      "reason": "informeCredito.pdf: 3 cuotas impagas, próximo pago 03/12/2024. Cuota más antigua venció 03/09/2024 = 91 días de mora al 03/12/2024.",
      "document_filename": "informeCredito.pdf"
    }
  ],
  "identified261Creditors": [
    {
      "bank": "Banco de Chile",
      "product_type": "tarjeta_credito",
      "institucion_cmf": "Banco de Chile",
      "total_credito_clp": 65864,
      "reason": "Estado de cuenta Oct 2024: cargo automático de $14.210 liquidó mora vencida. Deuda vigente al día sin mora ≥91d.",
      "document_filename": "Banco de Chile Tarjeta Mastercard EC Octubre 2024.pdf"
    }
  ],
  "additionalCreditors": [
    {
      "bank": "Banco de Chile",
      "institucion_cmf": "Banco de Chile",
      "product_type": "tarjeta_credito",
      "categoria_articulo": 261,
      "total_credito_clp": 517442,
      "reason": "CPF de portabilidad: tarjeta Visa Platinium con cupo propio, NO listada en el CMF (el CMF solo trae el crédito de consumo de Banco de Chile). Sin morosidad → Art. 261.",
      "document_filename": "CPF-1767634532-649919-cl-REDBANC-ICL 6.pdf",
      "needs_lawyer_confirmation": true
    }
  ],
  "cmf260DirectOverrides": [
    {
      "institucion_cmf": "CAT S.A.",
      "monto_clp": 11275392,
      "fecha_vencimiento": "2025-09-05",
      "document_filename": "cert_cat.pdf"
    }
  ],
  "details": {
    "meets90DaysRequirement": true,
    "meetsAmountRequirement": true,
    "totalAmountCLP": 49454840,
    "creditorsWith90DaysCount": 2,
    "documentsAgeValid": true,
    "requiredCertificatesPresent": true
  }
}
\`\`\`
`;

    const userMessageParts: any[] = [];
    userMessageParts.push({
      type: 'text',
      text: `Análisis estructurado pre-calculado local:\n${JSON.stringify(localAnalysis, null, 2)}`
    });

    userMessageParts.push({
      type: 'text',
      text: `\nContenido de CMF:\n${cmfText}`
    });

    for (const doc of documents) {
      if (doc.isImageDoc && doc.imageBase64) {
        userMessageParts.push({
          type: 'text',
          text: `\n=== CERTIFICADO IMAGEN: ${doc.filename} (Acreedor asignado: ${doc.institucion_cmf}, Tipo: ${doc.acreditacion_tipo}) ===`
        });
        userMessageParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: doc.imageMimeType || 'image/jpeg',
            data: doc.imageBase64
          }
        });
      } else {
        userMessageParts.push({
          type: 'text',
          text: `\n=== CERTIFICADO TEXTO: ${doc.filename} (Acreedor asignado: ${doc.institucion_cmf}, Tipo: ${doc.acreditacion_tipo}) ===\n${doc.textContent}`
        });
      }
    }

    userMessageParts.push({
      type: 'text',
      text: `\nPor favor realiza el análisis preventivo (Centinela de Carga) y retorna el JSON encerrado en <json> y </json>.`
    });

    log(`Enviando consulta a Claude Sonnet 4.6 (${documents.length} certificado(s))...`);

    // Usar streaming — requerido cuando la respuesta supera los 10 min (muchos docs + thinking).
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 8000,
      },
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessageParts }]
    });
    const response = await stream.finalMessage();

    const respText = response.content.find(b => b.type === 'text');
    const contentText = respText?.type === 'text' ? respText.text : '';

    // Extraer y parsear JSON
    const jsonMatch = contentText.match(/<json>([\s\S]*?)<\/json>/);
    if (!jsonMatch) {
      log(`⚠️ Respuesta cruda de Claude (sin etiquetas <json>):\n${contentText}`);
      log(`⚠️ Estructura completa de response.content:\n${JSON.stringify(response.content, null, 2)}`);
      throw new Error('No se encontró el bloque XML <json> en la respuesta de Claude.');
    }

    const raw = JSON.parse(jsonMatch[1].trim());
    const docTextByName = new Map<string, string | undefined>(
      documents.map((d) => [d.filename, d.textContent])
    );
    const additionalCreditors: AdditionalCreditor[] = (raw.additionalCreditors || [])
      .filter((a: any) => {
        const isChat = isChatDocument(docTextByName.get(a.document_filename), a.document_filename);
        if (isChat) {
          log(
            `⚠️ Ignorando acreedor NO-CMF "${a.bank}" ($${(a.total_credito_clp ?? a.monto_clp ?? 0).toLocaleString('es-CL')}) ` +
            `extraído de un CHAT (${a.document_filename}): un WhatsApp/conversación NO acredita monto ni crea ` +
            `producto — solo aporta la fecha de mora (vencimiento) de productos ya existentes.`
          );
        }
        return !isChat;
      })
      .map((a: any) => ({
        ...a,
        total_credito_clp: a.total_credito_clp ?? a.monto_clp ?? 0,
        needs_lawyer_confirmation: true,
      }));

    // Fecha clave: cruce 261 → 260 (mora alcanza 91 días). Solo futuros (útiles para el abogado).
    const crossoverSources: { ref: string; start?: string }[] = [
      ...(raw.reclassifiedCreditors || []).map((r: any) => ({ ref: r.bank, start: r.delinquency_start_date })),
      ...additionalCreditors.map((a) => ({ ref: a.bank, start: a.delinquency_start_date })),
    ];
    for (const src of crossoverSources) {
      if (!src.start) continue;
      const start = parseDateString(src.start);
      if (!start) continue;
      const cross = addDays(start, 91);
      const dias = getDaysDifference(cross, todayDate);
      if (dias < 0) continue; // ya cruzó (ya habilita Art. 260)
      fechasClave.push({
        tipo: 'cruce_261_a_260',
        referencia: src.ref,
        fecha: fmt(cross),
        diasRestantes: dias,
        detalle: `Mora iniciada ${src.start}; alcanza 91 días (habilita Art. 260) en esta fecha.`,
      });
    }

    const reclassifiedCreditors = (raw.reclassifiedCreditors || []).map((r: any) => ({
      ...r,
      total_credito_clp: r.total_credito_clp ?? r.monto_clp ?? 0,
    }));
    const identified261Creditors = (raw.identified261Creditors || []).map((i: any) => ({
      ...i,
      total_credito_clp: i.total_credito_clp ?? i.monto_clp ?? 0,
    }));
    const deReclassified261Creditors = (raw.deReclassified261Creditors || []).map((r: any) => ({
      ...r,
      total_credito_clp: r.total_credito_clp ?? r.monto_clp ?? 0,
    }));

    const result: SentinelResult = {
      // M2: no confiar ciego en raw.success. Si Claude omite el campo, inferir del
      // shape (hay errores → false; sin errores → true) en vez de bloquear un caso válido.
      success: typeof raw.success === 'boolean'
        ? raw.success
        : !(Array.isArray(raw.errors) && raw.errors.length > 0),
      errors: raw.errors || [],
      reclassifiedCreditors,
      identified261Creditors,
      additionalCreditors,
      cmf260DirectOverrides: raw.cmf260DirectOverrides || [],
      deReclassified261Creditors,
      fechasClave,
      details: raw.details,
    };

    // --- Backstop determinista de COMPLETITUD (ítems del certificado) ---
    // El LLM puede OMITIR productos que un certificado certifica: una operación de un cert
    // multi-operación cuyo saldo difiere del cupo del CMF (no emite el override), o un
    // producto solo-en-cert de monto chico (lo emite de forma inconsistente). Para CUALQUIER
    // cliente, extraemos deterministamente los ítems con saldo de cada cert (cert_line_items)
    // y agregamos los que el LLM no representó: si el banco tiene una fila CMF sin reclamar →
    // identified261 (el saldo del cert sobrescribe el cupo del CMF); si no → additionalCreditor
    // (producto solo-en-cert / NO-CMF). Conservador (solo etiquetas de payoff inequívocas;
    // ver cert_line_items.ts) y aditivo (nunca quita/modifica lo que emitió el LLM). Caso
    // testigo: BancoEstado CRE-00040145148 $389.848 (override de la línea) y BCI cuenta
    // corriente $615 (solo-en-cert). NO se salta con BYPASS_DATE_CHECK (es regla de fondo).
    {
      const COVERED_TOL = 0.05; // 5%: "ya cubierto" por una entrada del LLM (absorbe payoff≈cupo)
      const near = (a: number, b: number) => b > 0 && Math.abs(a - b) / Math.max(a, b) <= COVERED_TOL;
      const cmfMappedAmounts = (key: string): number[] => {
        const acc: number[] = [];
        for (const r of result.reclassifiedCreditors ?? []) if (canonicalInstitutionKey(r.institucion_cmf) === key) acc.push(r.total_credito_clp);
        for (const r of result.identified261Creditors ?? []) if (canonicalInstitutionKey(r.institucion_cmf) === key) acc.push(r.total_credito_clp);
        for (const r of result.deReclassified261Creditors ?? []) if (canonicalInstitutionKey(r.institucion_cmf) === key) acc.push(r.total_credito_clp);
        for (const o of result.cmf260DirectOverrides ?? []) if (canonicalInstitutionKey(o.institucion_cmf) === key) acc.push(o.monto_clp);
        return acc;
      };
      const cmfCountByBank = new Map<string, number>();
      for (const c of cmfResult.creditors) {
        const k = canonicalInstitutionKey(c.institucion);
        if (k) cmfCountByBank.set(k, (cmfCountByBank.get(k) ?? 0) + 1);
      }

      // --- Reconciliación: additionalCreditors mal clasificados → identified261 ---
      // El LLM es no-determinista al partir productos entre identified261 (productos del
      // CMF) y additionalCreditors (NO-CMF): una corrida pone una tarjeta del CMF como
      // identified261 (override → 1 fila) y otra la pone como additionalCreditor (→ step3
      // declara la fila del CMF + una fila NO-CMF = DOBLE CONTEO). Backstop determinista: si
      // un additionalCreditor es del MISMO banco que una fila del CMF AÚN SIN RECLAMAR y su
      // monto es cercano a esa fila (≤30% o ≤$500k, tolerancia cert vs CMF), entonces NO es
      // un NO-CMF: es ese producto del CMF → se mueve a identified261 (override). Un NO-CMF
      // genuino (CCAF, TGR, fintech, o un producto cuyo banco ya tiene todas sus filas CMF
      // reclamadas, ej. BCI cuenta corriente $615) NO matchea y queda como additional.
      if (result.additionalCreditors?.length) {
        const claimedCount = new Map<string, number>();
        for (const [k, amts] of [...cmfCountByBank.keys()].map((k) => [k, cmfMappedAmounts(k)] as const)) {
          // deduplicar montos reclamados (mismo producto emitido 2 veces, ej. id261 + deRecl)
          claimedCount.set(k, amts.filter((a, i) => amts.findIndex((b) => near(a, b)) === i).length);
        }
        const closeToCmf = (key: string, amount: number): boolean =>
          cmfResult.creditors.some(
            (c) => canonicalInstitutionKey(c.institucion) === key &&
              (Math.abs(c.totalCredito - amount) / Math.max(c.totalCredito, amount) <= 0.30 ||
               Math.abs(c.totalCredito - amount) <= 500_000)
          );
        const stillAdditional: AdditionalCreditor[] = [];
        for (const a of result.additionalCreditors) {
          const k = canonicalInstitutionKey(a.institucion_cmf);
          const cmfN = cmfCountByBank.get(k) ?? 0;
          const claimedN = claimedCount.get(k) ?? 0;
          if (k && cmfN > claimedN && closeToCmf(k, a.total_credito_clp)) {
            (result.identified261Creditors = result.identified261Creditors ?? []).push({
              bank: a.bank,
              product_type: a.product_type === 'tarjeta_credito' ? 'tarjeta_credito' : 'otro',
              institucion_cmf: a.institucion_cmf,
              total_credito_clp: a.total_credito_clp,
              reason: `Reconciliación determinista: el LLM lo emitió como NO-CMF, pero corresponde a una línea del CMF de ${a.bank} aún sin reclamar y de monto cercano → es ese producto del CMF (override de monto), NO un acreedor extra (evita doble conteo). ${a.reason}`,
              document_filename: a.document_filename,
            });
            claimedCount.set(k, claimedN + 1);
            log(`🔁 Reconciliación: additional→identified261 ${a.bank} $${a.total_credito_clp.toLocaleString('es-CL')} (fila CMF del mismo banco sin reclamar) — evita doble conteo.`);
          } else {
            stillAdditional.push(a);
          }
        }
        result.additionalCreditors = stillAdditional;
      }

      // ¿Ya emitió el LLM una entrada por este monto, DESDE ESTE MISMO documento? El match por
      // document_filename es el más robusto: no depende de cómo el LLM escriba la institución
      // (mismatch "Tenpo Prepago SA" vs "Tenpo Payments" → el match por nombre fallaba y el
      // backstop duplicaba el producto). Se complementa con el match por banco canónico + monto.
      const coveredByFilename = (filename: string, amount: number): boolean => {
        const pairs: Array<[string | undefined, number | undefined]> = [
          ...(result.reclassifiedCreditors ?? []).map((r) => [r.document_filename, r.total_credito_clp] as [string | undefined, number]),
          ...(result.identified261Creditors ?? []).map((r) => [r.document_filename, r.total_credito_clp] as [string | undefined, number]),
          ...(result.additionalCreditors ?? []).map((r) => [r.document_filename, r.total_credito_clp] as [string | undefined, number]),
          ...(result.deReclassified261Creditors ?? []).map((r) => [r.document_filename, r.total_credito_clp] as [string | undefined, number]),
          ...(result.cmf260DirectOverrides ?? []).map((o) => [o.document_filename, o.monto_clp] as [string | undefined, number]),
        ];
        return pairs.some(([fn, amt]) => !!fn && fn === filename && amt !== undefined && near(amt, amount));
      };
      const isCovered = (key: string, amount: number, filename: string): boolean => {
        if (coveredByFilename(filename, amount)) return true;
        if (cmfMappedAmounts(key).some((a) => near(a, amount))) return true;
        return (result.additionalCreditors ?? []).some(
          (a) => canonicalInstitutionKey(a.institucion_cmf) === key && near(a.total_credito_clp, amount)
        );
      };
      for (const doc of documents) {
        if (!doc.institucion_cmf) continue;
        if (isChatDocument(doc.textContent, doc.filename)) continue;
        const key = canonicalInstitutionKey(doc.institucion_cmf);
        if (!key) continue;
        // El texto que ve Claude (doc.textContent) viene de pdftotext SIN -layout y clampeado:
        // colapsa las TABLAS de los certificados de liquidación/portabilidad (el Nº de
        // operación, la fecha y el monto quedan en líneas separadas) → el extractor por-fila
        // no las reconoce y se pierde, por ejemplo, "CUENTA CORRIENTE … $615" de BCI. Para la
        // extracción determinista re-leemos el PDF con -layout (preserva columnas). Para docs
        // imagen usamos su OCR (doc.textContent), que ya conserva "CRE-… Saldo Deuda $X".
        let certText = doc.textContent || '';
        if (!doc.isImageDoc && doc.local_path) {
          const layout = await extractTextFromPdfLayout(doc.local_path).catch(() => '');
          if (layout.trim().length > 40) certText = layout;
        }
        const items = extractCertLineItems(certText);
        if (items.length === 0) continue;
        const cmfRows = cmfResult.creditors.filter((c) => canonicalInstitutionKey(c.institucion) === key);
        const claimed = cmfMappedAmounts(key);
        const dedupClaimed = claimed.filter((a, i) => claimed.findIndex((b) => near(a, b)) === i);
        let availableCmfSlots = Math.max(0, cmfRows.length - dedupClaimed.length);
        for (const it of items) {
          if (it.amount <= 0) continue;
          if (isCovered(key, it.amount, doc.filename)) continue;
          const productType: 'tarjeta_credito' | 'otro' =
            /tarjet|visa|master|cmr|cencosud|cat\b/i.test(it.rawLine) ? 'tarjeta_credito' : 'otro';
          if (availableCmfSlots > 0) {
            result.identified261Creditors = result.identified261Creditors ?? [];
            result.identified261Creditors.push({
              bank: doc.institucion_cmf,
              product_type: productType,
              institucion_cmf: doc.institucion_cmf,
              total_credito_clp: it.amount,
              reason: `Backstop determinista de completitud: el certificado ${doc.filename} certifica esta operación (${it.operationId ?? 's/op'}, "${it.label}") por $${it.amount.toLocaleString('es-CL')} y el LLM no la emitió. Mapeada a una línea del CMF de ${doc.institucion_cmf} (el saldo del cert sobrescribe el cupo del CMF). Art.261.`,
              document_filename: doc.filename,
            });
            availableCmfSlots--;
            log(`🧩 Backstop completitud: +identified261 ${doc.institucion_cmf} $${it.amount.toLocaleString('es-CL')} (op ${it.operationId ?? 's/op'}) — el LLM lo omitió.`);
          } else {
            result.additionalCreditors = result.additionalCreditors ?? [];
            result.additionalCreditors.push({
              bank: doc.institucion_cmf,
              institucion_cmf: doc.institucion_cmf,
              product_type: productType,
              categoria_articulo: 261,
              total_credito_clp: it.amount,
              reason: `Backstop determinista de completitud: producto solo-en-cert no representado por el CMF. El certificado ${doc.filename} certifica la operación ${it.operationId ?? 's/op'} ("${it.label}") por $${it.amount.toLocaleString('es-CL')} y el LLM no la emitió. Art.261.`,
              document_filename: doc.filename,
              needs_lawyer_confirmation: true,
            });
            log(`🧩 Backstop completitud: +additionalCreditor NO-CMF ${doc.institucion_cmf} $${it.amount.toLocaleString('es-CL')} (op ${it.operationId ?? 's/op'}) — el LLM lo omitió.`);
          }
        }
      }
    }

    // --- Backstop determinista: gate de acreditación Art. 260 (degradar 260→261) ---
    // Regla de fondo (abogado 2026-06-22): una deuda con mora 90+d va a Obligaciones 260
    // SOLO si se acredita MONTO Y VENCIMIENTO. La señal de "vencimiento acreditado" es que
    // el Centinela emitió un cmf260DirectOverride CON fecha_vencimiento (solo lo hace si leyó
    // una fecha de mora/cobranza real en el documento). Si un acreedor del CMF con
    // overdue90Days>0 NO tiene override-con-fecha, y no fue reclasificado (261→260) ni ya
    // de-reclasificado (REGLA 10), se DEGRADA a Art. 261 con su monto del CMF + alerta.
    // Es DETERMINISTA: garantiza la regla aunque el LLM no dispare la de-reclasificación.
    // NO se salta con BYPASS_DATE_CHECK (es regla de fondo, no de antigüedad de 30 días).
    {
      const keysWithVenc = (result.cmf260DirectOverrides ?? [])
        .filter((o) => o.fecha_vencimiento && String(o.fecha_vencimiento).trim().length > 0)
        .map((o) => canonicalInstitutionKey(o.institucion_cmf));
      const reclassKeys = (result.reclassifiedCreditors ?? []).map((r) => canonicalInstitutionKey(r.institucion_cmf));
      const deReclKeys = (result.deReclassified261Creditors ?? []).map((r) => canonicalInstitutionKey(r.institucion_cmf));
      for (const c of cmfResult.creditors) {
        if (c.overdue90Days <= 0) continue;
        const k = canonicalInstitutionKey(c.institucion);
        if (!k) continue;
        if (keysWithVenc.includes(k) || reclassKeys.includes(k) || deReclKeys.includes(k)) continue;
        const assocDoc = documents.find((d) => d.institucion_cmf && canonicalInstitutionKey(d.institucion_cmf) === k);

        // --- Rescate por CHAT (acepta WhatsApp como acreditación de vencimiento) ---
        // Si un CHAT adjunto menciona ESE banco (token distintivo del nombre) y "N días de
        // mora" (≥91), el producto SÍ tiene mora acreditada → se mantiene en Art. 260 con
        // un vencimiento ESTIMADO (fecha del chat − N días). El monto sigue siendo el del
        // CMF/cert. Determinista (no depende del LLM). ⚠️ La fecha es estimada: el chat
        // puede traer varios "N días" para distintos productos del mismo banco; usamos el
        // mayor (mora más antigua) y SIEMPRE alertamos para que el abogado fije la exacta.
        const distinctiveTokens = k.split(' ').filter((tok) => tok.length >= 7);
        if (distinctiveTokens.length > 0) {
          let bestN = 0;
          let chatFile = '';
          let chatRef: Date | null = null;
          for (const d of documents) {
            if (!isChatDocument(d.textContent, d.filename)) continue;
            const ct = (d.textContent || '').toLowerCase();
            if (!distinctiveTokens.some((tok) => ct.includes(tok))) continue;
            const matches = [...ct.matchAll(/(\d{2,4})\s*d[ií]as?\s+(?:de\s+)?(?:mora|demora|atraso)/g)];
            for (const m of matches) {
              const n = parseInt(m[1], 10);
              if (Number.isFinite(n) && n >= 91 && n > bestN) { bestN = n; chatFile = d.filename; }
            }
            if (bestN > 0) {
              const dm = ct.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
              if (dm) chatRef = new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]));
            }
          }
          if (bestN > 0) {
            const ref = chatRef ?? todayDate;
            const fechaEstimada = fmt(addDays(ref, -bestN));
            result.cmf260DirectOverrides!.push({
              institucion_cmf: c.institucion,
              monto_clp: c.totalCredito,
              fecha_vencimiento: fechaEstimada,
              document_filename: assocDoc?.filename ?? chatFile,
            });
            log(
              `🛡️ [Chat→260] "${c.institucion}" (mora 90+d $${c.overdue90Days.toLocaleString('es-CL')}): el chat ` +
              `${chatFile} indica ${bestN} días de mora → se mantiene en Art. 260 con vencimiento ESTIMADO ` +
              `${fechaEstimada}. ⚠️ Fecha estimada desde un chat — el abogado DEBE verificar la fecha exacta de mora.`
            );
            continue;
          }
        }

        // Mora 90+d sin vencimiento acreditable (ni cert ni chat) → degradar a Art. 261.
        const motivo =
          'Mora 90+d en el CMF SIN documento que acredite el VENCIMIENTO → declarada en ' +
          'Otros Acreedores (Art. 261) por el backstop determinista. Revisar antes de presentar.';
        
        const matches = (result.cmf260DirectOverrides ?? []).filter(o => {
          const ok = canonicalInstitutionKey(o.institucion_cmf);
          return ok === k && Math.abs((o.monto_clp ?? 0) - c.totalCredito) / Math.max(o.monto_clp ?? 1, c.totalCredito) <= 0.30;
        });
        const assocOverride = matches.length > 0
          ? matches.reduce((best, o) => Math.abs((o.monto_clp ?? 0) - c.totalCredito) < Math.abs((best.monto_clp ?? 0) - c.totalCredito) ? o : best)
          : undefined;
        const montoDegradado = assocOverride ? assocOverride.monto_clp : c.totalCredito;
        const filenameDegradado = assocOverride?.document_filename ?? assocDoc?.filename ?? '';

        result.deReclassified261Creditors!.push({
          bank: c.institucion,
          institucion_cmf: c.institucion,
          total_credito_clp: montoDegradado,
          reason: motivo,
          document_filename: filenameDegradado,
        });
        result.identified261Creditors!.push({
          bank: c.institucion,
          product_type: c.tipoCredito === 'tarjeta_credito' || c.tipoCredito === 'credito_consumo' ? c.tipoCredito : 'otro',
          institucion_cmf: c.institucion,
          total_credito_clp: montoDegradado,
          reason: motivo,
          document_filename: filenameDegradado,
        });
        log(
          `🛡️ [Backstop 260→261] "${c.institucion}" (mora 90+d $${c.overdue90Days.toLocaleString('es-CL')}) ` +
          `sin vencimiento acreditable → Art. 261 ($${montoDegradado.toLocaleString('es-CL')}).`
        );
      }
    }

    // Si un mismo certificado de una institución genera MÁS productos 261 que las
    // líneas que esa institución tiene en el CMF, los excedentes deben viajar como
    // NO-CMF para que step3 cree filas extra. Sin esta promoción, step3 solo ajusta
    // montos de filas CMF existentes y el producto extra se pierde.
    promoteOverflowIdentified261ToAdditional(result, cmfResult.creditors, documents, log);

    log(`Centinela de Carga completó la verificación. Resultado: ${result.success ? '✅ PASÓ' : '❌ RECHAZADO'}`);
    if (result.reclassifiedCreditors && result.reclassifiedCreditors.length > 0) {
      log(`📋 ${result.reclassifiedCreditors.length} acreedor(es) reclasificado(s) a Obligaciones 260 por análisis de documentos:`);
      result.reclassifiedCreditors.forEach(r =>
        log(`   - ${r.bank} (${r.product_type}): ${r.delinquency_days}d mora desde ${r.delinquency_start_date} — $${r.total_credito_clp.toLocaleString('es-CL')}`)
      );
    }
    if (result.identified261Creditors && result.identified261Creditors.length > 0) {
      log(`📋 ${result.identified261Creditors.length} deuda(s) Art. 261 identificada(s) desde documentos:`);
      result.identified261Creditors.forEach(r =>
        log(`   - ${r.bank} (${r.product_type}): $${r.total_credito_clp.toLocaleString('es-CL')} — ${r.reason}`)
      );
    }
    if (result.additionalCreditors && result.additionalCreditors.length > 0) {
      log(`📋 ${result.additionalCreditors.length} acreedor(es) NO-CMF detectado(s) (requieren confirmación del abogado):`);
      result.additionalCreditors.forEach(a =>
        log(`   - ${a.bank} (${a.product_type}) [Art. ${a.categoria_articulo}]: $${a.total_credito_clp.toLocaleString('es-CL')} — ${a.reason}`)
      );
    }
    if (result.deReclassified261Creditors && result.deReclassified261Creditors.length > 0) {
      log(`📋 ${result.deReclassified261Creditors.length} producto(s) de-reclasificado(s) 260→261 (certificado vigente sobre CMF):`);
      result.deReclassified261Creditors.forEach(r =>
        log(`   - ${r.bank}: $${r.total_credito_clp.toLocaleString('es-CL')} — ${r.reason}`)
      );
    }
    if (result.fechasClave && result.fechasClave.length > 0) {
      log(`🗓️  Fechas clave (no bloqueante):`);
      result.fechasClave.forEach(f => {
        const estado = f.diasRestantes < 0 ? `VENCIDO hace ${Math.abs(f.diasRestantes)}d` : `en ${f.diasRestantes}d`;
        log(`   - [${f.tipo}] ${f.referencia}: ${f.fecha} (${estado}) — ${f.detalle}`);
      });
    }
    return result;

  } catch (err: any) {
    logError('Error en verificación del Centinela:', err);
    return {
      success: false,
      technicalError: true,
      errors: [`Error interno durante la validación del Centinela: ${err.message || err}`],
      details: {
        meets90DaysRequirement: false,
        meetsAmountRequirement: false,
        totalAmountCLP: 0,
        creditorsWith90DaysCount: 0,
        documentsAgeValid: false,
        requiredCertificatesPresent: false,
      },
    };
  } finally {
    // Limpieza de archivos CMF locales temporales
    try {
      if (fs.existsSync(cmfLocalPath)) fs.unlinkSync(cmfLocalPath);
    } catch {}
  }
}

/**
 * en step3 desde el loop CMF. Debe viajar como additionalCreditor para que step3
 * cree una fila extra. Caso testigo: BancoEstado de Néctor (3 CRE en el certificado,
 * pero solo 2 líneas BancoEstado en el CMF).
 */
function promoteOverflowIdentified261ToAdditional(
  result: SentinelResult,
  cmfCreditors: CmfCreditor[],
  documents: Array<{ filename: string; textContent?: string | null }>,
  log: (msg: string) => void
): void {
  if (!result.identified261Creditors || result.identified261Creditors.length === 0) return;

  const slotsByInstitution = new Map<string, InstitutionSlots>();
  for (const creditor of cmfCreditors) {
    const key = canonicalInstitutionKey(creditor.institucion);
    if (!key) continue;
    const slots = slotsByInstitution.get(key) ?? emptyInstitutionSlots();
    slots.total += 1;
    slots[getCmfProductBucket(creditor)] += 1;
    slotsByInstitution.set(key, slots);
  }

  const docsByFilename = new Map(documents.map((d) => [d.filename, d]));
  const usageByInstitution = new Map<string, InstitutionSlots>();
  const existingAdditional = new Set(
    (result.additionalCreditors ?? []).map((a) =>
      `${canonicalInstitutionKey(a.institucion_cmf || a.bank)}|${a.document_filename}|${a.total_credito_clp}|${a.categoria_articulo}`
    )
  );

  const keptIdentified: Identified261Creditor[] = [];
  const promoted: AdditionalCreditor[] = [];

  for (const creditor of result.identified261Creditors) {
    const key = canonicalInstitutionKey(creditor.institucion_cmf || creditor.bank);
    const slots = slotsByInstitution.get(key);
    const usage = usageByInstitution.get(key) ?? emptyInstitutionSlots();
    const bucket = getIdentified261ProductBucket(creditor);
    const sourceDoc = docsByFilename.get(creditor.document_filename);
    const comesFromChat = isChatDocument(sourceDoc?.textContent, creditor.document_filename);

    const hasExactBucketSlot = !!slots && usage[bucket] < slots[bucket];
    const hasAnyInstitutionSlot = !!slots && usage.total < slots.total;

    if (!comesFromChat && (!slots || slots.total === 0 || !hasAnyInstitutionSlot)) {
      const promotedCreditor: AdditionalCreditor = {
        bank: creditor.bank,
        institucion_cmf: creditor.institucion_cmf,
        product_type: creditor.product_type === 'credito_consumo' || creditor.product_type === 'tarjeta_credito'
          ? creditor.product_type
          : 'otro',
        categoria_articulo: 261,
        total_credito_clp: creditor.total_credito_clp,
        reason:
          `${creditor.reason} Producto adicional de una institución que ya aparece en el CMF, ` +
          'pero no está representado por una línea propia del CMF; se promueve a NO-CMF para crear una fila extra en el portal.',
        document_filename: creditor.document_filename,
        needs_lawyer_confirmation: true,
      };
      const dedupeKey =
        `${canonicalInstitutionKey(promotedCreditor.institucion_cmf || promotedCreditor.bank)}|` +
        `${promotedCreditor.document_filename}|${promotedCreditor.total_credito_clp}|261`;
      if (!existingAdditional.has(dedupeKey)) {
        promoted.push(promotedCreditor);
        existingAdditional.add(dedupeKey);
        log(
          `🔀 [Promoción a NO-CMF] "${creditor.bank}" ($${creditor.total_credito_clp.toLocaleString('es-CL')}) ` +
          `sale de identified261 → additionalCreditors: la institución ya agotó sus ${slots?.total ?? 0} línea(s) CMF.`
        );
      }
      continue;
    }

    keptIdentified.push(creditor);
    usage.total += 1;
    if (hasExactBucketSlot) usage[bucket] += 1;
    usageByInstitution.set(key, usage);
  }

  if (promoted.length === 0) return;
  result.identified261Creditors = keptIdentified;
  result.additionalCreditors = [...(result.additionalCreditors ?? []), ...promoted];
}
