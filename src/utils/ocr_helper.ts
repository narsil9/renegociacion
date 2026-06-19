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
 * Runs OCR on all pages of a PDF using pdftoppm + Tesseract.
 * Returns concatenated text of all pages separated by "--- PÁGINA N ---" markers.
 * Falls back to English if Spanish lang data fails.
 */
export async function runOcrOnPdf(pdfPath: string, lang = 'spa'): Promise<string> {
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
      throw pdftoppmErr;
    }

    const pngFiles = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .map(f => path.join(tmpDir, f));

    if (pngFiles.length === 0) {
      throw new Error(`pdftoppm no generó páginas PNG para: ${pdfPath}`);
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
