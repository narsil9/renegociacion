/**
 * Agente de Ingresos — Paso 5. Extrae los HECHOS de los documentos de ingreso
 * (liquidaciones, comprobantes de pensión/arriendo, aportes, retiro de sociedades,
 * honorarios) y del Certificado de Cotizaciones, y deja que `income_extractor.ts`
 * (TS determinista) calcule la ESTRUCTURA a declarar (regla rectora del proyecto).
 *
 * Lectura NATIVA por Claude (lección L5): las liquidaciones suelen ser escaneo/foto
 * (capa de texto vacía) → se adjunta el PDF/imagen NATIVO a Claude, igual que el
 * Centinela del Paso 3. No se usa OCR/Tesseract.
 *
 * El LLM NO decide enums ni montos: devuelve una categoría semántica de un set
 * cerrado + los líquidos por período + las líneas de descuento. TS clasifica
 * descuentos (legal/voluntario), promedia, y mapea a los enums del portal.
 *
 * Idempotencia: SHA-256 del conjunto de documentos de ingreso. Escribe en
 * agent_runs (step=5, agent_type='ingresos').
 */

import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { IngresosOutput } from './types';
import { insertAgentRun, markRunning, completeRun, failRun, getLatestRun } from './agent_runs';
import {
  ExtractedIncomeDoc,
  CotizacionesCertFacts,
  IncomeCategory,
  computeIncomes,
} from '../utils/income_extractor';
import { getCurrentChileDate, parseDateString, getDaysDifference } from '../utils/date_helper';

const MAX_DOC_MB = 30; // límite de la API de Anthropic para documentos base64
const VALID_CATEGORIES: IncomeCategory[] = [
  'liquidacion_sueldo', 'comprobante_pension', 'licencia_medica',
  'aporte_terceros_deudas', 'aporte_terceros_gastos', 'comprobante_arriendo',
  'retiro_sociedades', 'honorarios', 'esporadico', 'otro', 'certificado_cotizaciones',
];

interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/** Documento de ingreso ya descargado localmente. */
export interface IncomeDocInput {
  filename: string;
  localPath: string;
}

function hashFiles(paths: string[]): string {
  const h = crypto.createHash('sha256');
  for (const p of [...paths].sort()) {
    h.update(path.basename(p));
    try { h.update(fs.readFileSync(p)); } catch { /* archivo ausente → hash igual cambia */ }
  }
  return h.digest('hex');
}

function extractJsonFromText(text: string): unknown {
  const match = text.match(/<json>([\s\S]*?)<\/json>/i) || text.match(/```json([\s\S]*?)```/i);
  const raw = match ? match[1].trim() : text.trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('No se encontró un objeto JSON válido en la respuesta de Claude');
  }
  return JSON.parse(raw.substring(first, last + 1));
}

const IMAGE_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

/** Texto de la capa digital del PDF (vacío si es escaneo). Best-effort. */
function pdfText(localPath: string): string {
  try {
    return execFileSync('pdftotext', ['-layout', localPath, '-'], {
      encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

type ContentBlock = Anthropic.Messages.ContentBlockParam;

/**
 * Construye los bloques de contenido para Claude: por cada documento, un bloque
 * `document` (PDF nativo) o `image`, precedido de un texto que lo identifica por
 * índice y filename. Adjunta el texto de la capa digital como apoyo cuando existe.
 */
function buildDocBlocks(docs: IncomeDocInput[], log: (m: string) => void): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  docs.forEach((doc, i) => {
    const stat = fs.statSync(doc.localPath);
    if (stat.size > MAX_DOC_MB * 1024 * 1024) {
      throw new Error(`Documento "${doc.filename}" excede ${MAX_DOC_MB} MB para lectura nativa.`);
    }
    const ext = path.extname(doc.localPath).toLowerCase();
    const b64 = fs.readFileSync(doc.localPath).toString('base64');

    blocks.push({ type: 'text', text: `\n===== DOCUMENTO #${i} — filename: "${doc.filename}" =====` });

    if (IMAGE_EXT[ext]) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: IMAGE_EXT[ext] as any, data: b64 },
      });
      log(`🖼️  Doc #${i} "${doc.filename}" → imagen nativa (${(stat.size / 1024).toFixed(0)} KB).`);
    } else {
      // PDF: adjuntar nativo SIEMPRE (el layout importa: "Líquido a pagar" vs
      // "Alcance Líquido"). Si hay capa de texto, va como apoyo.
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b64 },
      });
      const txt = pdfText(doc.localPath).trim();
      if (txt.length >= 50) {
        blocks.push({ type: 'text', text: `Texto digital del doc #${i} (apoyo):\n${txt.slice(0, 8000)}` });
        log(`📄 Doc #${i} "${doc.filename}" → PDF nativo + texto de apoyo (${txt.length} chars).`);
      } else {
        log(`🖼️  Doc #${i} "${doc.filename}" → PDF nativo (escaneo, ${txt.length} chars de texto).`);
      }
    }
  });
  return blocks;
}

function buildPrompt(today: string): string {
  return `Eres un asistente experto en documentos de ingreso chilenos para una solicitud de
Renegociación de la Persona Deudora (Superir). Analiza CADA documento adjunto (numerado por #).

Para CADA documento, determina su **categoría** (una de estas, exactamente):
- "liquidacion_sueldo"        → liquidación de sueldo / remuneración con contrato
- "comprobante_pension"       → comprobante de pensión, jubilación o montepío
- "licencia_medica"           → comprobante de pago por licencia médica
- "aporte_terceros_deudas"    → declaración jurada de aporte de un tercero para PAGAR DEUDAS
- "aporte_terceros_gastos"    → declaración jurada de aporte de un tercero para gastos
- "comprobante_arriendo"      → comprobante de ingreso por arriendo de un inmueble
- "retiro_sociedades"         → comprobante/declaración de retiro de utilidades de una sociedad
- "honorarios"                → documentación de boletas de honorarios
- "esporadico"                → ingreso esporádico/informal puntual
- "otro"                      → ingreso que no encaja en lo anterior
- "certificado_cotizaciones"  → Certificado de Cotizaciones Previsionales (AFP/IPS). NO es un ingreso.

**Extracción de montos (CRÍTICO — reglas exactas):**
1. Para liquidaciones de sueldo / pensión / arriendo: por cada período (mes), extrae el campo
   **"Líquido a pagar"** (lo que efectivamente recibe la persona). Si el documento también muestra
   un "Alcance Líquido" u otra cifra, IGNÓRALA: usa SIEMPRE "Líquido a pagar".
2. Por cada período, lista TODAS las líneas de la columna de **Descuentos** con su etiqueta textual
   y su monto (ej. "Cotizacion AFP", "Salud", "Seguro de Cesantia", "Impuesto", "Préstamo empleador",
   "Cuota Caja de Compensación"). No clasifiques tú: solo transcribe etiqueta + monto.
3. Para aportes de terceros / retiro de sociedades / esporádicos: extrae el **monto mensual**
   declarado en "monto_mensual_declarado" (si el documento lo expresa).
4. Todos los montos como ENTEROS en CLP, sin puntos ni símbolos (ej. 2161887).

**Para el Certificado de Cotizaciones** (si hay uno): extrae su **fecha de emisión** (YYYY-MM-DD) y el
**RUT de la entidad pagadora** (empleador o AFP) en "cotizaciones". Hoy es ${today}.

**RESPONDE ÚNICAMENTE con este bloque JSON entre etiquetas <json>:**
<json>
{
  "documentos": [
    {
      "doc_index": 0,
      "filename": "...",
      "category": "liquidacion_sueldo",
      "periods": [
        { "period_label": "Mayo-2025", "liquido_a_pagar": 2161887,
          "deductions": [ { "label": "Cotizacion AFP", "amount": 319832 }, { "label": "Impuesto", "amount": 57820 } ] }
      ],
      "monto_mensual_declarado": null,
      "notes": ""
    }
  ],
  "cotizaciones": { "filename": "...", "fecha_emision": "2025-05-22", "rut_entidad_pagadora": "59212930-2" }
}
</json>
Si no hay certificado de cotizaciones entre los documentos, "cotizaciones" = null.
No incluyas texto fuera de las etiquetas <json>.`;
}

interface ClaudeDocOut {
  doc_index?: number;
  filename?: string;
  category?: string;
  periods?: unknown;
  monto_mensual_declarado?: number | null;
  notes?: string;
}

function coerceExtractedDocs(parsed: any, docs: IncomeDocInput[]): {
  extracted: ExtractedIncomeDoc[];
  cotizaciones: CotizacionesCertFacts | null;
} {
  const out: ExtractedIncomeDoc[] = [];
  const arr: ClaudeDocOut[] = Array.isArray(parsed?.documentos) ? parsed.documentos : [];

  for (const d of arr) {
    const filename =
      (typeof d.filename === 'string' && d.filename) ||
      (typeof d.doc_index === 'number' && docs[d.doc_index]?.filename) ||
      '';
    const category = (VALID_CATEGORIES as string[]).includes(d.category || '')
      ? (d.category as IncomeCategory)
      : 'otro';

    const periods = Array.isArray(d.periods)
      ? d.periods
          .map((p: any) => ({
            period_label: String(p?.period_label ?? ''),
            liquido_a_pagar:
              typeof p?.liquido_a_pagar === 'number' && isFinite(p.liquido_a_pagar)
                ? p.liquido_a_pagar
                : null,
            deductions: Array.isArray(p?.deductions)
              ? p.deductions
                  .filter((x: any) => x && typeof x.amount === 'number')
                  .map((x: any) => ({ label: String(x.label ?? ''), amount: Math.abs(x.amount) }))
              : [],
          }))
      : undefined;

    out.push({
      filename,
      category,
      periods: periods && periods.length ? periods : undefined,
      monto_mensual_declarado:
        typeof d.monto_mensual_declarado === 'number' ? d.monto_mensual_declarado : null,
      notes: typeof d.notes === 'string' ? d.notes : undefined,
    });
  }

  let cotizaciones: CotizacionesCertFacts | null = null;
  const c = parsed?.cotizaciones;
  if (c && typeof c === 'object') {
    cotizaciones = {
      filename: String(c.filename ?? ''),
      fecha_emision: typeof c.fecha_emision === 'string' ? c.fecha_emision : null,
      rut_entidad_pagadora: typeof c.rut_entidad_pagadora === 'string' ? c.rut_entidad_pagadora : null,
    };
  }
  // Fallback: si el LLM clasificó un doc como certificado_cotizaciones pero no
  // pobló "cotizaciones", sintetizar el registro para no perder el cert.
  if (!cotizaciones) {
    const certDoc = out.find((o) => o.category === 'certificado_cotizaciones');
    if (certDoc) {
      cotizaciones = { filename: certDoc.filename, fecha_emision: null, rut_entidad_pagadora: null };
    }
  }

  return { extracted: out, cotizaciones };
}

/**
 * Lectura NATIVA por Claude: adjunta los documentos de ingreso y extrae los HECHOS
 * (categoría, líquidos por período, descuentos, metadatos del cert de cotizaciones).
 * Sin DB ni persistencia — reusable por el agente y por tests aislados.
 */
export async function extractIncomeFactsNative(
  docs: IncomeDocInput[],
  logger?: SimpleLogger
): Promise<{ extracted: ExtractedIncomeDoc[]; cotizaciones: CotizacionesCertFacts | null }> {
  const log = (msg: string) => (logger ? logger.log(msg) : console.log(msg));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no está configurada en .env');

  const today = getCurrentChileDate().toISOString().slice(0, 10);
  const anthropic = new Anthropic({ apiKey });

  const content: ContentBlock[] = [
    { type: 'text', text: buildPrompt(today) },
    ...buildDocBlocks(docs, log),
  ];

  log('🤖 Enviando documentos de ingreso a Claude (lectura nativa)...');
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error(`Claude no devolvió texto (stop_reason: ${response.stop_reason})`);
  }
  const parsed = extractJsonFromText(textBlock.text);
  return coerceExtractedDocs(parsed, docs);
}

/**
 * Corre el Agente de Ingresos para un cliente y persiste el resultado en agent_runs.
 *
 * @param supabase  cliente Supabase del sandbox
 * @param clientId  UUID del cliente
 * @param docs      documentos de ingreso ya descargados localmente
 * @param logger    logger opcional
 */
export async function runIngresosAgent(
  supabase: SupabaseClient,
  clientId: string,
  docs: IncomeDocInput[],
  logger?: SimpleLogger
): Promise<IngresosOutput> {
  const log = (msg: string) => (logger ? logger.log(msg) : console.log(msg));
  const logErr = (msg: string, err?: unknown) => (logger ? logger.error(msg, err) : console.error(msg, err));

  if (docs.length === 0) {
    throw new Error('runIngresosAgent: no hay documentos de ingreso para analizar.');
  }
  for (const d of docs) {
    if (!fs.existsSync(d.localPath)) throw new Error(`Documento de ingreso no encontrado: ${d.localPath}`);
  }

  // --- Idempotencia ---
  const inputHash = hashFiles(docs.map((d) => d.localPath));
  const existing = await getLatestRun<IngresosOutput>(supabase, clientId, 'ingresos');
  if (existing?.input_hash === inputHash && existing.output_json) {
    log(`♻️  Reutilizando run de ingresos existente (${existing.id}) — documentos sin cambios.`);
    return existing.output_json;
  }

  const runId = await insertAgentRun(supabase, clientId, 5, 'ingresos', inputHash);
  await markRunning(supabase, runId);
  log(`🚀 Run de ingresos iniciado (runId: ${runId}, ${docs.length} documento(s))`);

  try {
    const { extracted, cotizaciones } = await extractIncomeFactsNative(docs, logger);

    // --- Cálculo DETERMINISTA de la estructura a declarar ---
    const computation = computeIncomes(extracted, cotizaciones);
    const alerts = [...computation.alerts];

    // --- Regla de 30 días del cert de cotizaciones (L6), bypaseable en pruebas ---
    let cotizacionesAgeDays: number | null = null;
    const bypassDate = process.env.BYPASS_DATE_CHECK === 'true' || process.env.BYPASS_DATE_VALIDATION === 'true';
    if (computation.cotizacionesCert?.fecha_emision) {
      const emis = parseDateString(computation.cotizacionesCert.fecha_emision);
      if (emis) {
        cotizacionesAgeDays = getDaysDifference(getCurrentChileDate(), emis);
        if (cotizacionesAgeDays > 30 && !bypassDate) {
          alerts.push(
            `Certificado de Cotizaciones vencido: emitido hace ${cotizacionesAgeDays} días ` +
            `(máx 30). Solicitar uno nuevo.`
          );
        }
      }
    }

    // Alertas propias de cada ingreso → al pool global (para el dashboard).
    for (const inc of computation.incomes) {
      for (const a of inc.alerts) alerts.push(`[${inc.tipoIngresoLabel}] ${a}`);
    }

    const output: IngresosOutput = {
      incomes: computation.incomes,
      cotizacionesCert: computation.cotizacionesCert,
      extractedDocs: extracted,
      alerts,
      cotizacionesAgeDays,
    };

    // Revisión del abogado si hay alertas estructurales (faltantes, dudas de descuento).
    const needsLawyerReview = alerts.length > 0;
    await completeRun(supabase, runId, output, needsLawyerReview);

    log(
      `✅ Run de ingresos completado — ${output.incomes.length} ingreso(s) declarable(s): ` +
      output.incomes.map((i) => `${i.tipoIngresoLabel} $${i.monto.toLocaleString('es-CL')}`).join(', ') +
      (output.cotizacionesCert ? ' | cert cotizaciones ✓' : ' | ⚠️ SIN cert cotizaciones')
    );
    if (alerts.length) log(`⚠️ Alertas de ingresos:\n - ${alerts.join('\n - ')}`);

    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logErr(`❌ Error en agente de ingresos (runId: ${runId}):`, err);
    await failRun(supabase, runId, [msg]);
    throw err;
  }
}
