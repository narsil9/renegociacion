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
import { extractDatesFromText, extractEmissionDateFromText } from './cognitive_orchestrator';
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

export interface SentinelResult {
  success: boolean;
  errors: string[];
  reclassifiedCreditors?: ReclassifiedCreditor[];
  identified261Creditors?: Identified261Creditor[];
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
 * Executes API Key #1 (Sentinel) to analyze the CMF and certificates uploaded by the lawyer.
 * Bypassed by default if ENABLE_SENTINEL is not 'true'.
 */
export async function runSentinelCheck(
  client: ClientProfile,
  supabase: SupabaseClient,
  logger: SimpleLogger
): Promise<SentinelResult> {
  const isEnabled = process.env.ENABLE_SENTINEL === 'true';
  const log = (msg: string) => logger.log(`🛡️ [Centinela] ${msg}`);
  const logError = (msg: string, err?: any) => logger.error(`🛡️ [Centinela] ${msg}`, err);

  if (!isEnabled) {
    log('🛡️ Modo Bypass activo (ENABLE_SENTINEL !== true). Omitiendo validación preventiva.');
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
          doc.isImageDoc = true;
          doc.imageMimeType = 'image/jpeg';
          // Convertir primera página con GS si existe
          const jpgPath = localPath.replace(/\.pdf$/i, '_p1.jpg');
          if (!fs.existsSync(jpgPath)) {
            try {
              const { execFile: execFileCb } = await import('child_process');
              const { promisify: prom } = await import('util');
              const execFileAsync = prom(execFileCb);
              await execFileAsync('/opt/homebrew/bin/gs', [
                '-dNOPAUSE', '-dBATCH', '-sDEVICE=jpeg', '-r150',
                `-sOutputFile=${jpgPath}`, '-dFirstPage=1', '-dLastPage=1',
                localPath
              ]);
            } catch {}
          }
          doc.imageBase64 = fs.existsSync(jpgPath)
            ? fs.readFileSync(jpgPath).toString('base64')
            : fs.readFileSync(localPath).toString('base64');
          doc.textContent = '[PDF ESCANEADO: Claude analizará la imagen directamente]';
        } else {
          doc.isImageDoc = false;
          doc.textContent = fullText.substring(0, 12000);
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
**REGLA 7 — Identificar deudas Art. 261 (deudas vigentes, sin mora ≥91d)**
Para CADA documento adjunto cuyo acreedor NO fue reclasificado a Art. 260, analiza si corresponde a una deuda vigente (al día o con mora <91d). Si es así, agrégalo a "identified261Creditors" con:
- bank: nombre del banco
- product_type: tipo de producto ("credito_consumo", "tarjeta_credito", u "otro")
- institucion_cmf: nombre según CMF (usa el campo "institucion_cmf" del documento)
- total_credito_clp: monto total de la deuda según el documento
- reason: explicación breve de por qué es Art. 261 (ej. "Cargo automático liquidó mora; deuda vigente sin mora ≥91d")
- document_filename: nombre del archivo que acredita la deuda

Esta información permite al Orquestador Cognitivo (API Key #2) mapear correctamente los documentos de los Otros Acreedores (Art. 261).

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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      thinking: {
        type: 'adaptive'
      },
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessageParts }]
    });

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
    const result: SentinelResult = {
      success: raw.success,
      errors: raw.errors || [],
      reclassifiedCreditors: raw.reclassifiedCreditors || [],
      identified261Creditors: raw.identified261Creditors || [],
      details: raw.details,
    };

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
    return result;

  } catch (err: any) {
    logError('Error en verificación del Centinela:', err);
    return {
      success: false,
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
