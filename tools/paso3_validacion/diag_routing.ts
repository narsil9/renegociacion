/**
 * DIAGNÓSTICO de ENRUTAMIENTO de lectura (sin API). Para cada documento descargado de un
 * cliente, replica EXACTAMENTE la decisión del Centinela (`pdfNativeReason` en sentinel.ts):
 *   ¿se lee con Claude NATIVO (visión) o se "confía" el texto de pdftotext y se le pasa a TS?
 *
 * Objetivo: encontrar por qué la automatización falla donde mi lectura (siempre nativa) acierta.
 * Hipótesis: docs que la automatización manda a TEXTO (pdftotext) cuando el texto está
 * incompleto/mal extraído (tabla multicolumna, resumen global) → extracción pobre.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/diag_routing.ts <dir_scratchpad_oracle>
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { extractTextFromPdf } from '../../src/utils/pdf_analyzer';

const NATIVE_PDF_MAX_BYTES = 6 * 1024 * 1024;
const MIN_CHARS_PER_PAGE = 200;

function pageCount(p: string): number | null {
  try { const o = execFileSync('pdfinfo', [p], { encoding: 'utf8', timeout: 15000 }); const m = o.match(/^Pages:\s*(\d+)/m); return m ? parseInt(m[1], 10) : null; } catch { return null; }
}
function bigImage(p: string): boolean {
  try {
    const o = execFileSync('pdfimages', ['-list', p], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    for (const line of o.split('\n')) { const m = line.trim().match(/^\d+\s+\d+\s+\w+\s+(\d+)\s+(\d+)\b/); if (m && +m[1] >= 600 && +m[2] >= 600) return true; }
  } catch { /* */ } return false;
}
function nativeReason(p: string, textLen: number): string | null {
  if (textLen < 50) return 'texto casi vacío';
  if (bigImage(p)) return 'imagen grande embebida';
  const pg = pageCount(p);
  if (pg && pg > 0 && textLen / pg < MIN_CHARS_PER_PAGE) return `densidad baja (~${Math.round(textLen / pg)} ch/pág)`;
  return null;
}

async function main() {
  const baseDir = process.argv[2];
  if (!baseDir) throw new Error('Pasar el directorio (scratchpad/paso3_oracle/<cliente>).');
  const ext = ['.pdf'];
  const files = fs.readdirSync(baseDir).filter((f) => ext.includes(path.extname(f).toLowerCase()));
  console.log(`\n📂 ${baseDir} — ${files.length} PDF(s)\n`);
  console.log(`${'documento'.padEnd(42)} ${'chars'.padStart(7)} ${'pág'.padStart(4)}  decisión`);
  let nativo = 0, texto = 0, placeholder = 0;
  for (const f of files.sort()) {
    const p = path.join(baseDir, f);
    const size = fs.statSync(p).size;
    let text = ''; try { text = await extractTextFromPdf(p); } catch { /* */ }
    const len = text.trim().length;
    const reason = nativeReason(p, len);
    let decision: string;
    if (reason && size <= NATIVE_PDF_MAX_BYTES) { decision = `🖼️  NATIVO (Claude visión) — ${reason}`; nativo++; }
    else if (!reason && len >= 50) { decision = `📄 TEXTO (pdftotext → TS/Claude)`; texto++; }
    else { decision = `⚠️ PLACEHOLDER (ilegible/too big)`; placeholder++; }
    console.log(`${f.slice(0, 42).padEnd(42)} ${String(len).padStart(7)} ${String(pageCount(p) ?? '?').padStart(4)}  ${decision}`);
  }
  console.log(`\n  → ${nativo} nativo (visión) · ${texto} texto (pdftotext) · ${placeholder} placeholder`);
}
main().catch((e) => { console.error('🚨', (e as Error).message); process.exit(1); });
