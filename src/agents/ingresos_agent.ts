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
 * Bloques de contenido para Claude de UN SOLO documento (regla #1 del handoff Paso 3:
 * una llamada por documento → atención total → lectura estable). PDF nativo o imagen,
 * con la capa de texto como apoyo cuando existe.
 */
function buildSingleDocBlocks(doc: IncomeDocInput, log: (m: string) => void): ContentBlock[] {
  const stat = fs.statSync(doc.localPath);
  if (stat.size > MAX_DOC_MB * 1024 * 1024) {
    throw new Error(`Documento "${doc.filename}" excede ${MAX_DOC_MB} MB para lectura nativa.`);
  }
  const ext = path.extname(doc.localPath).toLowerCase();
  const b64 = fs.readFileSync(doc.localPath).toString('base64');
  const blocks: ContentBlock[] = [
    { type: 'text', text: `Documento a analizar — filename: "${doc.filename}"` },
  ];
  if (IMAGE_EXT[ext]) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: IMAGE_EXT[ext] as any, data: b64 } });
    log(`🖼️  "${doc.filename}" → imagen nativa (${(stat.size / 1024).toFixed(0)} KB).`);
  } else {
    // PDF nativo SIEMPRE (el layout importa: "Líquido a pagar" vs "Alcance Líquido").
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    const txt = pdfText(doc.localPath).trim();
    if (txt.length >= 50) {
      blocks.push({ type: 'text', text: `Texto digital de apoyo:\n${txt.slice(0, 12000)}` });
      log(`📄 "${doc.filename}" → PDF nativo + texto de apoyo (${txt.length} chars).`);
    } else {
      log(`🖼️  "${doc.filename}" → PDF nativo (escaneo, ${txt.length} chars de texto).`);
    }
  }
  return blocks;
}

/** Prompt para leer UN documento aislado (regla #1). El LLM solo reporta hechos. */
function buildSingleDocPrompt(today: string): string {
  return `Eres un asistente experto en documentos de ingreso chilenos para una solicitud de
Renegociación de la Persona Deudora (Superir). Analiza el ÚNICO documento adjunto y reporta SOLO lo que
dice (NO decidas la estructura: no promedies, no sumes, no clasifiques descuentos — eso lo hace otro
sistema). Hoy es ${today}.

**1) Clasifica el documento:**
- "doc_type": "liquidacion_mensual" | "comprobante_subsidio" | "boleta_honorarios" |
  "certificado_anual_resumen" | "comprobante_pago" | "cartola" | "declaracion_jurada" |
  "certificado_cotizaciones" | "otro".
- "category" (EXACTA): "liquidacion_sueldo" | "comprobante_pension" | "licencia_medica" |
  "aporte_terceros_deudas" | "aporte_terceros_gastos" | "comprobante_arriendo" | "retiro_sociedades" |
  "honorarios" | "esporadico" | "otro" | "certificado_cotizaciones" (este último NO es un ingreso).

**2) Extrae según el tipo:**
- Liquidación de sueldo/pensión/arriendo: por cada período (mes), "liquido_a_pagar" = el líquido que la
  persona RECIBE. El rótulo varía: "Líquido a Pagar", "Líquido a Cobrar", "Líquido a Recibir",
  "Rem. Neta", "Monto Líquido". NUNCA uses "Alcance Líquido" ni "Imponible". Lista TODAS las líneas de
  descuento (etiqueta textual + monto), sin clasificarlas. "rut_pagador" = RUT del empleador/pagador.
- Comprobante de subsidio (licencia médica): un período por pago, "period_label" = el MES cubierto
  (YYYY-MM), "liquido_a_pagar" = el "Monto Líquido" del pago. NO uses el "Promedio mensual" impreso (es
  la base de cálculo, no lo percibido). "rut_pagador" = RUT del pagador (ISAPRE/Compin/Caja).
- Boleta de honorarios: un período por boleta, "period_label" = mes de emisión, "monto_bruto" + "retencion".
- Aporte de terceros / retiro de sociedades / esporádico: "monto_mensual_declarado".
- Certificado de cotizaciones: "cotizaciones" = { "fecha_emision":"YYYY-MM-DD", "rut_entidad_pagadora" }.
- **Resumen global** (solo totales anuales/semestrales, sin desglose mensual): NO inventes períodos
  mensuales; deja "periods" vacío. Un total anual NO es una liquidación mensual.

**3) Reglas:**
- Montos ENTEROS en CLP, sin puntos ni símbolos. Declara "moneda" ("CLP" o "UF") de cada monto.
- Si un valor es > 0, NO lo bajes a 0 ni lo omitas. Ante la duda, repórtalo igual (otro sistema decide).
- "evidence" por período (OBLIGATORIO): "cita_monto" = copia VERBATIM del fragmento del documento de
  donde sacaste la cifra (rótulo + cifra exactos); "confidence" 0..1 (baja si el escaneo está borroso).

**RESPONDE SOLO con este JSON entre <json>:**
<json>
{ "doc_type":"liquidacion_mensual", "category":"liquidacion_sueldo", "rut_pagador":"77612410-9",
  "periods":[ {"period_label":"Mayo 2026","liquido_a_pagar":1990721,"moneda":"CLP",
    "deductions":[{"label":"Cotizacion AFP","amount":236674},{"label":"Seguro Vida","amount":4743}],
    "evidence":{"cita_monto":"Liquido a Pagar 1.990.721","confidence":0.97}} ],
  "monto_mensual_declarado":null, "cotizaciones":null, "notes":"" }
</json>
No incluyas texto fuera de las etiquetas <json>.`;
}

/** Coerciona la respuesta de Claude de UN documento a los tipos del extractor. */
function coerceSingleDoc(parsed: any, doc: IncomeDocInput): {
  extracted: ExtractedIncomeDoc | null;
  cotizaciones: CotizacionesCertFacts | null;
} {
  const num = (v: any): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
  const category = (VALID_CATEGORIES as string[]).includes(parsed?.category || '')
    ? (parsed.category as IncomeCategory)
    : 'otro';

  const periods = Array.isArray(parsed?.periods)
    ? parsed.periods.map((p: any) => ({
        period_label: String(p?.period_label ?? ''),
        liquido_a_pagar: num(p?.liquido_a_pagar),
        monto_bruto: num(p?.monto_bruto),
        retencion: num(p?.retencion),
        deductions: Array.isArray(p?.deductions)
          ? p.deductions
              .filter((x: any) => x && typeof x.amount === 'number')
              .map((x: any) => ({ label: String(x.label ?? ''), amount: Math.abs(x.amount) }))
          : [],
        moneda: p?.moneda === 'UF' ? 'UF' : p?.moneda === 'CLP' ? 'CLP' : undefined,
        evidence:
          p?.evidence && typeof p.evidence === 'object'
            ? {
                cita_monto: typeof p.evidence.cita_monto === 'string' ? p.evidence.cita_monto : undefined,
                confidence: num(p.evidence.confidence) ?? undefined,
              }
            : undefined,
      }))
    : undefined;

  // Cotizaciones de ESTE documento (si lo es).
  let cotizaciones: CotizacionesCertFacts | null = null;
  const c = parsed?.cotizaciones;
  if (c && typeof c === 'object') {
    cotizaciones = {
      filename: doc.filename,
      fecha_emision: typeof c.fecha_emision === 'string' ? c.fecha_emision : null,
      rut_entidad_pagadora: typeof c.rut_entidad_pagadora === 'string' ? c.rut_entidad_pagadora : null,
    };
  } else if (category === 'certificado_cotizaciones') {
    cotizaciones = { filename: doc.filename, fecha_emision: null, rut_entidad_pagadora: null };
  }

  // El cert de cotizaciones NO es un ingreso declarable.
  if (category === 'certificado_cotizaciones') return { extracted: null, cotizaciones };

  const rutPagador =
    typeof parsed?.rut_pagador === 'string' && parsed.rut_pagador.trim() ? parsed.rut_pagador.trim() : null;

  const docType = typeof parsed?.doc_type === 'string' ? parsed.doc_type : '';
  const notes = [docType ? `doc_type=${docType}` : '', typeof parsed?.notes === 'string' ? parsed.notes : '']
    .filter(Boolean).join(' | ') || undefined;
  const extracted: ExtractedIncomeDoc = {
    filename: doc.filename,
    category,
    source_key: rutPagador, // L9: separa fuentes por empleador/pagador
    periods: periods && periods.length ? periods : undefined,
    monto_mensual_declarado: num(parsed?.monto_mensual_declarado),
    notes,
  };
  return { extracted, cotizaciones };
}

/**
 * Llama a Claude para UN documento, con reintento ante respuesta vacía (regla #8 del
 * handoff: "vacío" = error reintentable, no "no hay datos" — si no, se pierde el doc).
 */
async function callClaudeForDoc(
  anthropic: Anthropic,
  doc: IncomeDocInput,
  today: string,
  log: (m: string) => void
): Promise<unknown> {
  const content: ContentBlock[] = [
    { type: 'text', text: buildSingleDocPrompt(today) },
    ...buildSingleDocBlocks(doc, log),
  ];
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';
      if (!text) throw new Error(`respuesta vacía (stop_reason: ${response.stop_reason})`);
      return extractJsonFromText(text);
    } catch (err) {
      lastErr = err;
      log(`   ↻ "${doc.filename}" intento ${attempt}/${MAX_ATTEMPTS} falló: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Lectura NATIVA por Claude — UNA LLAMADA POR DOCUMENTO (regla #1 del handoff Paso 3:
 * atención total por doc = lectura estable y completa; la mega-llamada con N documentos
 * era la causa raíz de la inestabilidad entre corridas). Cada doc se lee aislado y TS
 * arma la estructura aguas abajo. Sin DB ni persistencia — reusable por agente y tests.
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

  const extracted: ExtractedIncomeDoc[] = [];
  let cotizaciones: CotizacionesCertFacts | null = null;

  log(`🤖 Leyendo ${docs.length} documento(s) de ingreso con Claude (una llamada por documento)...`);
  for (const doc of docs) {
    const parsed = await callClaudeForDoc(anthropic, doc, today, log);
    const r = coerceSingleDoc(parsed, doc);
    if (r.extracted) extracted.push(r.extracted);
    if (r.cotizaciones && !cotizaciones) cotizaciones = r.cotizaciones;
  }
  return { extracted, cotizaciones };
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

    // Señales anti-error de la lectura de Claude → al pool global (informativo).
    for (const issue of computation.claudeReadIssues) {
      alerts.push(`[lectura:${issue.tipo}] ${issue.filename} (${issue.period_label}): ${issue.detalle}`);
    }

    const output: IngresosOutput = {
      incomes: computation.incomes,
      cotizacionesCert: computation.cotizacionesCert,
      extractedDocs: extracted,
      alerts,
      cotizacionesAgeDays,
      claudeReadIssues: computation.claudeReadIssues,
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
