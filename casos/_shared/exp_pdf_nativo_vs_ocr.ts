/**
 * EXPERIMENTO (Paso 0 del plan #1) — NO toca producción.
 * Compara, sobre certs escaneados que nos dieron problemas, la lectura por:
 *   A) Tesseract OCR (lo que hace hoy el Centinela para PDFs sin texto) — `extractTextWithOcrFallback`
 *   B) Claude leyendo el PDF NATIVO (content block `document` base64) — la mejora #1
 * y las contrasta con la verdad-terreno conocida.
 *
 * Uso:
 *   BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/_shared/exp_pdf_nativo_vs_ocr.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import { extractTextWithOcrFallback } from '../../src/utils/ocr_helper';
dotenv.config();

// Certs escaneados (chars=0) que nos dieron problemas + verdad-terreno conocida.
const CASES: Array<{ file: string; truth: string }> = [
  {
    file: 'casos/cristian_mancilla/documentos/certs/Santander_consumo_pago_total.pdf',
    truth: 'payoff $6.985.718 (1ª cuota vencida 05/03/2026). El LLM lo malinterpretó como "pagado→$0".',
  },
  {
    file: 'casos/nector_ruiz/documentos/certs/BancoEstado_certificado_deuda.pdf',
    truth: '3 operaciones: CRE-00039038355 $36.130.323, CRE-00040145148 $389.848, CRE-00040166973 $553.350.',
  },
  {
    file: 'casos/nector_ruiz/documentos/certs/BancoFalabella_certificado_deuda.pdf',
    truth: 'Banco Falabella deuda ~$2.988.488 (mora 90+d).',
  },
];

const PROMPT = `Sos un analista de certificados de deuda chilenos. Te adjunto un certificado en PDF
(puede ser un escaneo/foto). Leelo y devolvé SOLO un bloque <json> con los productos de deuda que
acredita, cada uno con: numero_operacion (si aparece), monto_clp (entero, el SALDO/PAYOFF a pagar —
NO cupo ni monto original), fecha_vencimiento (YYYY-MM-DD si hay 1ª cuota impaga / fecha de mora),
etiqueta (qué campo leíste). Si es un comprobante de pago YA realizado (no una cotización de deuda),
indicá "es_recibo_de_pago": true. Formato:
<json>{"productos":[{"numero_operacion":"...","monto_clp":0,"fecha_vencimiento":"...","etiqueta":"..."}],"es_recibo_de_pago":false}</json>`;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  for (const c of CASES) {
    const abs = path.resolve(c.file);
    const sep = '═'.repeat(78);
    console.log(`\n${sep}\n📄 ${path.basename(c.file)}\n   Verdad-terreno: ${c.truth}\n${sep}`);
    if (!fs.existsSync(abs)) { console.log('   ⚠️ No existe localmente.'); continue; }

    // --- Método A: Tesseract OCR (lo de hoy) ---
    console.log('\n── A) Tesseract OCR (hoy) ──');
    let ocrText = '';
    try {
      const r = await extractTextWithOcrFallback(abs, 50);
      ocrText = r.text || '';
    } catch (e) { console.log('   OCR error:', (e as Error).message); }
    console.log(`   chars OCR: ${ocrText.length}`);
    const moneysOcr = (ocrText.match(/\$\s?[0-9][0-9.\,]*/g) || []).slice(0, 12);
    console.log(`   montos $ detectados por OCR: ${moneysOcr.join('  ') || 'NINGUNO'}`);
    console.log('   --- texto OCR (primeros 800 chars) ---');
    console.log('   ' + ocrText.slice(0, 800).replace(/\n/g, '\n   '));

    // --- Método B: Claude PDF nativo (#1) ---
    console.log('\n── B) Claude PDF nativo (#1) ──');
    try {
      const pdfBase64 = fs.readFileSync(abs).toString('base64');
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: PROMPT },
          ] as any,
        }],
      });
      const txt = resp.content.find((b) => b.type === 'text');
      const out = txt && txt.type === 'text' ? txt.text : '';
      const m = out.match(/<json>([\s\S]*?)<\/json>/);
      console.log('   ' + (m ? m[1].trim().replace(/\n/g, '\n   ') : out.slice(0, 1000)));
    } catch (e) { console.log('   Claude error:', (e as Error).message); }
  }
  console.log('\n✅ Experimento terminado.\n');
}

main().catch((e) => { console.error('🚨', (e as Error).message); process.exit(1); });
