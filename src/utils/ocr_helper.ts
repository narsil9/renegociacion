import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { extractTextFromPdf } from './pdf_analyzer';

const execFileAsync = promisify(execFile);

const PDFTOPPM_PATH = '/opt/homebrew/bin/pdftoppm';
const TESSERACT_PATH = '/opt/homebrew/bin/tesseract';
const OCR_TMP_BASE = path.join('outputs', 'ocr_tmp');

/**
 * Detecta el tipo REAL del archivo por magic bytes (no por extensión). Los
 * clientes suben fotos/capturas con extensión .pdf; tratarlas como PDF rompe
 * `pdftoppm`. Devuelve 'pdf' | 'jpeg' | 'png' | 'other'.
 */
function detectFileKind(filePath: string): 'pdf' | 'jpeg' | 'png' | 'other' {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    if (buf.slice(0, 4).toString('latin1') === '%PDF') return 'pdf';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    return 'other';
  } catch {
    return 'other';
  }
}

/** Corre Tesseract directamente sobre un archivo de imagen (JPEG/PNG). */
async function runTesseractOnImage(imagePath: string, lang = 'spa'): Promise<string> {
  const tmpDir = path.join(OCR_TMP_BASE, `ocrimg_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const outBase = path.join(tmpDir, 'text');
    for (const l of [lang, 'eng']) {
      try {
        await execFileAsync(TESSERACT_PATH, [imagePath, outBase, '-l', l, '--oem', '1', '--psm', '3']);
        const txtPath = `${outBase}.txt`;
        if (fs.existsSync(txtPath)) return fs.readFileSync(txtPath, 'utf8');
      } catch { /* try next lang */ }
    }
    return '';
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Runs OCR on all pages of a PDF using pdftoppm + Tesseract.
 * Returns concatenated text of all pages separated by "--- PÁGINA N ---" markers.
 * Falls back to English if Spanish lang data fails.
 *
 * ROBUSTO a no-PDFs: si el archivo es en realidad una imagen (JPEG/PNG con
 * extensión .pdf — típico de fotos/capturas del cliente), la OCR directamente.
 * Si `pdftoppm` falla por cualquier otra razón, degrada a texto vacío en vez de
 * lanzar (un documento ilegible NO debe tumbar el job entero del Centinela).
 */
export async function runOcrOnPdf(pdfPath: string, lang = 'spa'): Promise<string> {
  // El archivo puede ser una imagen disfrazada de .pdf → OCR directa sin pdftoppm.
  const kind = detectFileKind(pdfPath);
  if (kind === 'jpeg' || kind === 'png') {
    return runTesseractOnImage(pdfPath, lang);
  }

  const tmpDir = path.join(OCR_TMP_BASE, `ocr_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    try {
      await execFileAsync(PDFTOPPM_PATH, ['-r', '150', '-png', pdfPath, path.join(tmpDir, 'page')]);
    } catch (pdftoppmErr: unknown) {
      const msg = String((pdftoppmErr as { stderr?: string }).stderr ?? pdftoppmErr);
      if (msg.includes('Incorrect password') || msg.includes('password')) {
        // Password-protected PDF — return empty text gracefully
        return '';
      }
      // Documento corrupto / formato no soportado → degradar a vacío (no tumbar el job).
      console.warn(`[ocr_helper] pdftoppm falló para ${pdfPath} (degrado a vacío): ${msg.slice(0, 120)}`);
      return '';
    }

    const pngFiles = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .map(f => path.join(tmpDir, f));

    if (pngFiles.length === 0) {
      console.warn(`[ocr_helper] pdftoppm no generó páginas para ${pdfPath} (degrado a vacío)`);
      return '';
    }

    const pageTexts: string[] = [];

    for (let i = 0; i < pngFiles.length; i++) {
      const pngPath = pngFiles[i];
      const outBase = path.join(tmpDir, `text_p${i + 1}`);

      let succeeded = false;
      for (const l of [lang, 'eng']) {
        try {
          await execFileAsync(TESSERACT_PATH, [pngPath, outBase, '-l', l, '--oem', '1', '--psm', '3']);
          succeeded = true;
          break;
        } catch {
          // try next lang
        }
      }

      if (!succeeded) continue;

      const txtPath = `${outBase}.txt`;
      if (fs.existsSync(txtPath)) {
        const pageText = fs.readFileSync(txtPath, 'utf8');
        if (pageText.trim().length > 0) {
          pageTexts.push(`--- PÁGINA ${i + 1} ---\n${pageText}`);
        }
      }
    }

    return pageTexts.join('\n\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Extracts text from a PDF, falling back to OCR if pdftotext yields fewer than `threshold` chars.
 */
export async function extractTextWithOcrFallback(
  pdfPath: string,
  threshold = 50
): Promise<{ text: string; usedOcr: boolean }> {
  const text = await extractTextFromPdf(pdfPath).catch(() => '');

  if (text.trim().length >= threshold) {
    return { text, usedOcr: false };
  }

  const ocrText = await runOcrOnPdf(pdfPath);
  return { text: ocrText, usedOcr: true };
}
