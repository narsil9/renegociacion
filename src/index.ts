import * as dotenv from 'dotenv';
dotenv.config();

import { launchBrowser } from './utils/browser';
import { loginAndNavigateToStep1 } from './automation/login';
import { fillStep1 } from './automation/step1_personal';

const args = process.argv.slice(2);
const rutArg = args.find((a) => a.startsWith('--rut='));
const stepArg = args.find((a) => a.startsWith('--step='));

const rut = rutArg?.split('=')[1];
const step = stepArg ? parseInt(stepArg.split('=')[1], 10) : 1;

async function main() {
  if (!rut) {
    console.error('Uso: npm run automate -- --rut=<RUT> --step=<PASO>');
    console.error('Ejemplo: npm run automate -- --rut=21917363-6 --step=1');
    process.exit(1);
  }

  console.log(`\n🤖 Iniciando automatización | RUT: ${rut} | Paso: ${step}\n`);

  const { browser, page } = await launchBrowser();

  try {
    await loginAndNavigateToStep1(page);

    if (step === 1) {
      await fillStep1(page);
    }

    console.log('\n✅ Automatización completada exitosamente.\n');
  } catch (error) {
    console.error('\n❌ Automatización fallida:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
