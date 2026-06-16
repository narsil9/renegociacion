/**
 * Sube el CMF + documentos de acreditación de William Montero a Supabase Storage
 * (bucket `documentos`, prefijo `pato_william/`) para correr test_step3.ts.
 *
 * No registra en client_documents (el test hardcodea las rutas). Solo sube binarios.
 *
 * Uso: npx ts-node -r dotenv/config "casos/William Alexander Montero Romero - 25.656.359-2 -- Renegociacion/upload_documents.ts"
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const BUCKET = 'documentos';
const PREFIX = 'pato_william';
const BASE = __dirname;
const CMF = path.join(BASE, 'documentos', 'Acreedores CMF');

const FILES: { local: string; storage: string; contentType: string }[] = [
  // CMF
  { local: path.join(BASE, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-12-15T153144.200.pdf'), storage: `${PREFIX}/informe_cmf.pdf`, contentType: 'application/pdf' },
  // Art. 260
  { local: path.join(CMF, 'Banco Internacional', 'Liquidacion Judicial..pdf'), storage: `${PREFIX}/internacional_liquidacion.pdf`, contentType: 'application/pdf' },
  { local: path.join(CMF, 'Banco Itaú Corpbanca', 'CreditoConsumoItau.pdf'), storage: `${PREFIX}/itau_constancia.pdf`, contentType: 'application/pdf' },
  { local: path.join(CMF, 'Banco Itaú Corpbanca', 'MORA_.png'), storage: `${PREFIX}/itau_mora.png`, contentType: 'image/png' },
  { local: path.join(CMF, 'Banco Itaú Corpbanca', 'itau_mora.jpg'), storage: `${PREFIX}/itau_mora.jpg`, contentType: 'image/jpeg' },
  { local: path.join(CMF, 'CAT (ex CENCOSUD)', 'Noviembre_2025_EECC.pdf'), storage: `${PREFIX}/cat_noviembre.pdf`, contentType: 'application/pdf' },
  { local: path.join(CMF, 'CAT (ex CENCOSUD)', 'Julio_2025_EECC.pdf'), storage: `${PREFIX}/cat_julio.pdf`, contentType: 'application/pdf' },
  // Art. 261 (representativos)
  { local: path.join(CMF, 'Banco Falabella', 'FallabelaNoviembre.pdf'), storage: `${PREFIX}/falabella_noviembre.pdf`, contentType: 'application/pdf' },
  { local: path.join(CMF, 'SOLVENTA TARJETAS ', 'estado-de-cuenta_Noviembre.pdf'), storage: `${PREFIX}/solventa_noviembre.pdf`, contentType: 'application/pdf' },
  { local: path.join(CMF, 'Banco Santander', 'Tarjetas de Crédito', '3530 11_25.pdf'), storage: `${PREFIX}/santander_3530_nov.pdf`, contentType: 'application/pdf' },
  { local: path.join(CMF, 'Banco Santander CONSUMER', 'DEUDA VIGENTE op 650077179296.pdf'), storage: `${PREFIX}/santander_consumer.pdf`, contentType: 'application/pdf' },
  { local: path.join(CMF, 'Scotiabank CONSUMO', 'ResumenCreditosConsumo.pdf'), storage: `${PREFIX}/scotiabank_consumo.pdf`, contentType: 'application/pdf' },
  { local: path.join(CMF, 'Scotiabank HIPOTECARIO', 'CreditoCasa.PNG'), storage: `${PREFIX}/scotiabank_hipotecario.png`, contentType: 'image/png' },
  // NO-CMF
  { local: path.join(BASE, 'documentos', 'Carpetas Acreedores NO CMF', 'Caja los Andes', 'Certificado de Deuda', 'Certificado 20.130.pdf'), storage: `${PREFIX}/caja_los_andes.pdf`, contentType: 'application/pdf' },
  { local: path.join(BASE, 'documentos', 'Carpetas Acreedores NO CMF', 'TGR', 'descarga (24).pdf'), storage: `${PREFIX}/tgr_contribuciones.pdf`, contentType: 'application/pdf' },
];

async function run() {
  console.log(`🔧 Subiendo ${FILES.length} archivos de William a ${BUCKET}/${PREFIX}/\n`);
  for (const f of FILES) {
    if (!fs.existsSync(f.local)) {
      console.error(`❌ No existe: ${f.local}`);
      process.exit(1);
    }
    const buf = fs.readFileSync(f.local);
    const { error } = await supabase.storage.from(BUCKET).upload(f.storage, buf, { contentType: f.contentType, upsert: true });
    if (error) {
      console.error(`❌ Error subiendo ${path.basename(f.local)}: ${error.message}`);
      process.exit(1);
    }
    console.log(`  ✓ ${path.basename(f.local)} → ${f.storage} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  console.log('\n🎉 Listo. Ahora: BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config "casos/William Alexander Montero Romero - 25.656.359-2 -- Renegociacion/test_step3.ts"');
}
run().catch((e) => { console.error('🚨', (e as Error).message); process.exit(1); });
