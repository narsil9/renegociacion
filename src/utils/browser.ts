import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Stealth plugin oculta huellas digitales de automatización para evitar
// que el reCAPTCHA de ClaveÚnica detecte el script como bot.
chromiumExtra.use(StealthPlugin());

export async function launchBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const headless = process.env.HEADLESS === 'true';

  const browser = await chromiumExtra.launch({
    headless,
    slowMo: 80,
  }) as unknown as Browser;

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
  });

  context.setDefaultTimeout(60000);

  const page = await context.newPage();

  return { browser, context, page };
}

export async function screenshotOnFailure(page: Page, stepName: string): Promise<void> {
  const outputDir = path.join(process.cwd(), 'outputs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshotPath = path.join(outputDir, `failure_${stepName}_${timestamp}.png`);
  const htmlPath = path.join(outputDir, `failure_${stepName}_${timestamp}.html`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    fs.writeFileSync(htmlPath, await page.content());
    console.error(`📸 Screenshot: ${screenshotPath}`);
    console.error(`📄 HTML dump: ${htmlPath}`);
  } catch {
    console.error('Could not save failure artifacts.');
  }
}
