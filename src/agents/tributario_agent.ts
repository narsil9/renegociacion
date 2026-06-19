/**
 * Agente Tributario — extrae categoría tributaria y actividad F29 de la Carpeta Tributaria.
 *
 * Estrategia dual:
 *  1. Determinista (sin costo): pdftotext → regex → analyzeTaxCategory + detectF29.
 *     Funciona en PDFs de texto digitales (>500 chars extraídos).
 *  2. Visión Claude Opus 4.8: para PDFs escaneados donde pdftotext devuelve texto vacío.
 *     Envía el PDF como documento base64, extrae JSON tipado con <json>...</json>.
 *
 * Idempotencia: si ya existe un run completed con el mismo SHA-256 del PDF,
 * se devuelve el output guardado sin gastar créditos de API.
 *
 * Escribe en agent_runs (step=2). Llama a failRun() antes de lanzar si la
 * validación falla, para que el worker pueda inspeccionar el estado en Supabase.
 */

import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { TributarioOutput } from './types';
import { insertAgentRun, markRunning, completeRun, failRun, getLatestRun } from './agent_runs';
import { validateTributarioOutput, isTributarioOutput, logValidationResult } from './validator';
import {
  analyzeTaxCategory,
  detectF29ActivityLast24Months,
  detectContribucionesDeuda,
  extractCarpetaTributariaMetadata,
  extractTextFromPdf,
} from '../utils/pdf_analyzer';
import { extractTextWithOcrFallback } from '../utils/ocr_helper';

// PDFs escaneados devuelven <500 chars de texto útil con pdftotext
const SCANNED_THRESHOLD = 500;
// Límite de la API de Anthropic para documentos base64
const MAX_PDF_MB = 30;

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: unknown): void;
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function extractJsonFromText(text: string): unknown {
  const match =
    text.match(/<json>([\s\S]*?)<\/json>/i) ||
    text.match(/```json([\s\S]*?)```/i);
  const raw = match ? match[1].trim() : text.trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`No se encontró un objeto JSON válido en la respuesta de Claude`);
  }
  return JSON.parse(raw.substring(first, last + 1));
}

/**
 * Envía el PDF a Claude Opus 4.8 y extrae TributarioOutput vía visión.
 * Solo se invoca cuando pdftotext devuelve texto insuficiente (PDF escaneado).
 */
async function extractViaVision(
  pdfPath: string,
  log: (m: string) => void
): Promise<TributarioOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no está configurada en .env');

  const fileSizeBytes = fs.statSync(pdfPath).size;
  if (fileSizeBytes > MAX_PDF_MB * 1024 * 1024) {
    throw new Error(
      `Carpeta Tributaria demasiado grande para visión: ` +
      `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB (máx ${MAX_PDF_MB} MB)`
    );
  }

  log('🤖 PDF escaneado — enviando a Claude Opus 4.8 para extracción por visión...');

  const anthropic = new Anthropic({ apiKey });
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Eres un asistente especializado en documentos tributarios chilenos.

Analiza esta Carpeta Tributaria del SII (Servicio de Impuestos Internos de Chile).

**Extrae exactamente tres datos:**

1. **Categoría Tributaria del contribuyente**:
   - Busca la etiqueta "Categoría Tributaria:" en la sección "Datos del Contribuyente".
   - Si dice "Primera Categoría" → categoria = "primera"
   - Si dice "Segunda Categoría" → categoria = "segunda"
   - Si no aparece o no se puede leer con certeza → categoria = "ninguna"

2. **Meses con actividad económica en Formulario 29 (últimos 24 meses)**:
   - Busca la sección "Formulario 29", "Declaraciones de IVA", o "IVA - Débito".
   - Identifica los períodos (meses) con valores numéricos **distintos de cero** en columnas de débito, crédito u otros montos declarados.
   - Incluye SOLO los períodos dentro de los últimos 24 meses desde hoy (${today}).
   - Devuelve los meses en formato YYYY-MM, del más reciente al más antiguo.
   - Si no hay sección F29 o no hay actividad → lista vacía.

3. **Propiedades con contribuciones (Impuesto Territorial) vencidas**:
   - Busca la sección "Propiedades y Bienes Raíces".
   - Para cada fila de la tabla, verifica: Condición = AFECTO **Y** Cuotas vencidas por pagar = SI.
   - Si ambas condiciones se cumplen, incluye la propiedad con: rol (ej. "BD 20"), comuna (ej. "Ñuñoa"), destino (ej. "Bodega / Almacenaje").
   - Si no hay propiedades morosas o no existe la sección → lista vacía.

**RESPONDE ÚNICAMENTE con este bloque JSON entre etiquetas <json>:**
<json>
{
  "categoria": "segunda",
  "f29_meses_con_actividad": [],
  "contribuciones_deuda": [
    { "rol": "BD 20", "comuna": "Ñuñoa", "destino": "Bodega / Almacenaje", "lineaOriginal": "" }
  ]
}
</json>

No incluyas texto ni explicaciones fuera de las etiquetas <json>.`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          } as Parameters<typeof anthropic.messages.create>[0]['messages'][0]['content'] extends (infer T)[] ? T : never,
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error(`Claude no devolvió un bloque de texto (stop_reason: ${response.stop_reason})`);
  }

  log(`📄 Respuesta de Claude recibida (stop_reason: ${response.stop_reason})`);

  const parsed = extractJsonFromText(textBlock.text);
  if (!isTributarioOutput(parsed)) {
    throw new Error(
      `El JSON de Claude no tiene el shape esperado de TributarioOutput: ${JSON.stringify(parsed)}`
    );
  }
  return parsed;
}

/**
 * Corre el Agente Tributario para un cliente y persiste el resultado en agent_runs.
 *
 * @param supabase           — cliente Supabase del sandbox (SUPABASE_URL + SERVICE_ROLE_KEY)
 * @param clientId           — UUID del cliente en la tabla clients del sandbox
 * @param tributariaPdfPath  — ruta local al PDF de la Carpeta Tributaria (ya descargado)
 * @param logger             — logger opcional (interfaz compatible con RunnerLogger del worker)
 * @returns TributarioOutput persistido en agent_runs
 */
export async function runTributarioAgent(
  supabase: SupabaseClient,
  clientId: string,
  tributariaPdfPath: string,
  logger?: SimpleLogger
): Promise<TributarioOutput> {
  const log = (msg: string) => {
    if (logger) logger.log(msg);
    else console.log(msg);
  };
  const logErr = (msg: string, err?: unknown) => {
    if (logger) logger.error(msg, err);
    else console.error(msg, err);
  };

  // --- Idempotencia: reusar output si el PDF no cambió ---
  const inputHash = hashFile(tributariaPdfPath);
  const existing = await getLatestRun<TributarioOutput>(supabase, clientId, 'tributario');
  if (existing?.input_hash === inputHash && existing.output_json) {
    log(`♻️  Reutilizando run tributario existente (${existing.id}) — PDF sin cambios.`);
    return existing.output_json;
  }

  // --- Nuevo run ---
  const runId = await insertAgentRun(supabase, clientId, 2, 'tributario', inputHash);
  await markRunning(supabase, runId);
  log(`🚀 Run tributario iniciado (runId: ${runId})`);

  try {
    let output: TributarioOutput;

    const text = await extractTextFromPdf(tributariaPdfPath);
    const textLen = text.trim().length;
    const isScanned = textLen < SCANNED_THRESHOLD;

    if (isScanned) {
      log(`⚠️  Texto insuficiente (${textLen} chars) — intentando OCR local (Tesseract)...`);
      const { text: ocrText, usedOcr } = await extractTextWithOcrFallback(tributariaPdfPath, 500);

      if (usedOcr && ocrText.trim().length > 100) {
        log(`📄 OCR exitoso (${ocrText.trim().length} chars) — usando análisis determinista sobre texto OCR.`);
        const categoria = await analyzeTaxCategory(tributariaPdfPath, logger, ocrText);
        let f29Meses: string[] = [];
        if (categoria === 'primera') {
          const f29 = await detectF29ActivityLast24Months(tributariaPdfPath, logger, ocrText);
          f29Meses = f29.activeMonths;
        }
        const contribuciones = await detectContribucionesDeuda(tributariaPdfPath, logger, ocrText);
        const ctMeta = await extractCarpetaTributariaMetadata(tributariaPdfPath, logger, ocrText);
        output = {
          categoria,
          f29_meses_con_actividad: f29Meses,
          contribuciones_deuda: contribuciones.propiedadesMorosas,
          fecha_generacion_ct: ctMeta.fechaGeneracion,
          ingreso_mensual_boletas: ctMeta.ingresoMensualPromedio,
          boletas_ultimos_12_meses: ctMeta.boletasUltimos12Meses,
        };
      } else {
        log(`⚠️  OCR insuficiente (${ocrText.trim().length} chars) — fallback a Claude Opus Vision.`);
        output = await extractViaVision(tributariaPdfPath, log);
      }
    } else {
      log(`📝 PDF de texto (${textLen} chars) — usando análisis determinista.`);
      const categoria = await analyzeTaxCategory(tributariaPdfPath, logger);
      let f29Meses: string[] = [];
      if (categoria === 'primera') {
        const f29 = await detectF29ActivityLast24Months(tributariaPdfPath, logger);
        f29Meses = f29.activeMonths;
      }
      const contribuciones = await detectContribucionesDeuda(tributariaPdfPath, logger);
      const ctMeta = await extractCarpetaTributariaMetadata(tributariaPdfPath, logger);
      output = {
        categoria,
        f29_meses_con_actividad: f29Meses,
        contribuciones_deuda: contribuciones.propiedadesMorosas,
        fecha_generacion_ct: ctMeta.fechaGeneracion,
        ingreso_mensual_boletas: ctMeta.ingresoMensualPromedio,
        boletas_ultimos_12_meses: ctMeta.boletasUltimos12Meses,
      };
    }

    // Validar antes de persistir
    const validation = validateTributarioOutput(output);
    logValidationResult(validation, 'tributario', log);

    if (!validation.valid) {
      await failRun(supabase, runId, validation.errors);
      throw new Error(`Validación tributaria fallida: ${validation.errors.join('; ')}`);
    }

    await completeRun(supabase, runId, output, validation.needsLawyerReview);
    log(
      `✅ Run tributario completado — ` +
      `categoria: ${output.categoria}, ` +
      `F29 meses activos: ${output.f29_meses_con_actividad.length}`
    );
    return output;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logErr(`❌ Error en agente tributario (runId: ${runId}):`, err);
    await failRun(supabase, runId, [msg]);
    throw err;
  }
}
