import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { extractTextFromPdf } from './pdf_analyzer';
import { getCurrentChileDate, getDaysDifference, parseDateString } from './date_helper';
import * as fs from 'fs';
import * as path from 'path';

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

  // 2. Download and extract text from each certificate
  const tmpDir = path.join(process.cwd(), 'outputs', 'acreditaciones_tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

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

    // Extract text from the PDF (first 12,000 characters to prevent huge tokens)
    try {
      const fullText = await extractTextFromPdf(localPath);
      doc.textContent = fullText.substring(0, 12000);
      log(`Texto extraído exitosamente de ${doc.filename} (${doc.textContent.length} caracteres).`);
    } catch (err: any) {
      logError(`Error al extraer texto de ${doc.filename}:`, err);
      doc.textContent = `[Error de extracción: ${err.message}]`;
    }
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

  // 5. Construct the payload and prompt for Claude
  const documentsPayload = documents.map(d => ({
    filename: d.filename,
    document_type: d.document_type,
    acreditacion_tipo: d.acreditacion_tipo,
    uploaded_at: d.uploaded_at,
    text: d.textContent
  }));

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const modelName = 'claude-sonnet-4-5-20250929';

  const systemPrompt = `Eres el Auditor Cognitivo Experto y Mente Pensante para la automatización del portal de la Superintendencia de Insolvencia y Reemprendimiento (Superir) en Chile.
Tu misión es auditar y cruzar el Informe de Deudas CMF (Comisión para el Mercado Financiero) con los Certificados de Deuda/Vencimiento presentados por el cliente.

REGLAS DE AUDITORÍA QUE DEBES VERIFICAR RIGUROSAMENTE:
1. **Antigüedad de Documentos (Límite de 30 días)**:
   - Identifica la fecha de emisión del Informe CMF (usualmente aparece arriba/al inicio del documento CMF).
   - Identifica la fecha de emisión de cada certificado de deuda/vencimiento leyendo su texto.
   - Compara las fechas encontradas contra la fecha actual del sistema (Hoy: ${todayStr}).
   - **REGLA CRÍTICA**: Ningún documento (ni el CMF ni ningún certificado) puede tener más de 30 días de antigüedad con respecto a Hoy (${todayStr}). Si la antigüedad supera los 30 días, debes establecer obligatoriamente el campo 'status' como 'error', detallar el problema en el campo 'reason' y emitir la alerta con tipo exacto 'expired_cmf' o 'expired_certificate'. Esto es un requisito legal estricto e inquebrantable. Si hay algún documento vencido, el 'status' NO puede ser 'success'.

2. **Tipos de Créditos y Requisitos Legales (Ley 21.680)**:
   - Para deudas clasificadas como Obligación Artículo 260 (morosidad >= 90 días en el CMF): Se requiere acreditar tanto el monto como la fecha de vencimiento. Por lo tanto, el cliente debe proveer certificados que acrediten:
     - Monto de Deuda.
     - Fecha de Vencimiento.
     - Nota: Un mismo certificado puede acreditar ambos campos si menciona explícitamente el saldo de deuda y la fecha de vencimiento.
   - Para deudas clasificadas como Obligación Artículo 261 (morosidad < 90 días o deuda al día en el CMF): Se requiere acreditar únicamente el monto de deuda.

3. **Mapeo de Archivos**:
   - Asocia cada certificado al acreedor correspondiente en el CMF comparando los nombres de las instituciones (por ejemplo: "BANCO DEL ESTADO DE CHILE" o "BANCO ESTADO" -> "Banco Estado", "LIDER BCI" o "SERVICIOS FINANCIEROS LIDER" -> "Presto Lider / Lider BCI").
   - Identifica cuál archivo representa el certificado de monto y cuál el de vencimiento para cada institución.

4. **Validación de RUT de los Acreedores**:
   - Extrae el RUT del emisor del certificado (la entidad financiera) y verifica que coincida con el RUT del catálogo de acreedores o sea el de la institución correcta.

5. **Salida**:
   - Debes responder únicamente con un bloque JSON bien estructurado encerrado en las etiquetas XML <json>...</json>.
   - No agregues texto explicativo fuera de las etiquetas XML.

Esquema JSON esperado:
\`\`\`json
{
  "status": "success" | "error",
  "reason": "Explicación detallada del por qué falló la auditoría (solo si status es 'error')",
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
      "message": "Detalle descriptivo de la alerta detectada"
    }
  ]
}
\`\`\`

Notas importantes para tu evaluación:
- Si falta algún certificado de monto o vencimiento requerido por las reglas del Artículo 260 / 261, genera una alerta 'missing_document'.
- Si encuentras un certificado cuya fecha de emisión supera los 30 días de antigüedad respecto a la fecha actual (${todayStr}), genera una alerta 'expired_certificate'.
- Si el CMF tiene más de 30 días de antigüedad respecto a Hoy (${todayStr}), genera una alerta 'expired_cmf'.`;

  const userContent = `Aquí está el texto del Informe CMF del cliente:
--- INICIO CMF ---
${cmfText}
--- FIN CMF ---

Aquí están los certificados de acreditación subidos por el cliente (con su tipo registrado inicialmente y el texto extraído):
${JSON.stringify(documentsPayload, null, 2)}

Por favor realiza la auditoría y retorna el JSON mapeado dentro de las etiquetas <json> y </json>.`;

  log('Enviando análisis cognitivo a Claude Sonnet 4.5...');
  try {
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: 8192,
      thinking: {
        type: 'enabled',
        budget_tokens: 2048
      },
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
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
        
        // Handle monto_file
        if (mapping.monto_file) {
          const doc = documents.find(d => d.filename === mapping.monto_file);
          if (doc) {
            mappedDocs.push({
              institucion_cmf: inst,
              tipo_documento: 22,
              storage_path: doc.storage_path,
              local_path: doc.local_path
            });
          }
        }
        
        // Handle vencimiento_file
        const vencFile = mapping.vencimiento_file;
        if (vencFile) {
          const doc = documents.find(d => d.filename === vencFile);
          if (doc) {
            mappedDocs.push({
              institucion_cmf: inst,
              tipo_documento: 23,
              storage_path: doc.storage_path,
              local_path: doc.local_path
            });
          }
        }
      }
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
