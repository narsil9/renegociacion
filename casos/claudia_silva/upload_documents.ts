import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const BUCKET = 'documentos';
const CLIENT_ID = 'a9ddf715-3bdf-4377-8cb3-2d467089227d'; // Patricio Martini (Prueba)
const CLAUDIA_DIR = path.resolve(__dirname, 'documentos');

const DOCS_TO_UPLOAD = [
  // 1. Banco de Chile Crédito Consumo
  {
    local: path.join(CLAUDIA_DIR, '06_Acreedores_Art260_Mora', 'Banco_de_Chile', 'informeCredito.pdf'),
    storagePath: 'patricio_martini/banco_de_chile_consumo_report.pdf',
    filename: 'Banco de Chile Crédito Consumo - Informe Crédito.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 24,
    acreditacion_tipo: 'general'
  },
  // 2. Banco Ripley Tarjeta - Últimos 4 estados de cuenta
  {
    local: path.join(CLAUDIA_DIR, '06_Acreedores_Art260_Mora', 'Banco_Ripley','RIPLEY AGOSTO.pdf'),
    storagePath: 'patricio_martini/ripley_estado_cuenta_agosto_2024.pdf',
    filename: 'RIPLEY AGOSTO.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta'
  },
  {
    local: path.join(CLAUDIA_DIR, '06_Acreedores_Art260_Mora', 'Banco_Ripley','RIPLEY SEPTIEMBRE.pdf'),
    storagePath: 'patricio_martini/ripley_estado_cuenta_septiembre_2024.pdf',
    filename: 'RIPLEY SEPTIEMBRE.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta'
  },
  {
    local: path.join(CLAUDIA_DIR, '06_Acreedores_Art260_Mora', 'Banco_Ripley','RIPLEY OCTUBRE.pdf'),
    storagePath: 'patricio_martini/ripley_estado_cuenta_octubre_2024.pdf',
    filename: 'RIPLEY OCTUBRE.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta'
  },
  {
    local: path.join(CLAUDIA_DIR, '06_Acreedores_Art260_Mora', 'Banco_Ripley','RIPLEY NOVIEMBRE.pdf'),
    storagePath: 'patricio_martini/ripley_estado_cuenta_noviembre_2024.pdf',
    filename: 'RIPLEY NOVIEMBRE.pdf',
    institucion_cmf: 'CAR - Ripley',
    document_type: 24,
    acreditacion_tipo: 'estado_cuenta'
  },
  // 3. Banco de Chile Tarjeta de Crédito (solo último estado de cuenta de Octubre para monto)
  {
    local: path.join(CLAUDIA_DIR, '06_Acreedores_Art260_Mora', 'Banco_de_Chile', 'ACFrOgCRplTbZILphaIXMl-X0Ua2g0wtJDuD7QjK9DoxTPMp2OW7aJuVxMK-HlDrRt286GqBAtSc83TWjyopoVfJAxfrfAzoMSNT4zHLyHbxq6vn2nMCBhvBDz_9BdnaVS6WznsLf6Tgj1pc-WgvfzmmgbT-9bp_yvfMhuTlsw==.pdf'),
    storagePath: 'patricio_martini/banco_de_chile_tarjeta_octubre_2024.pdf',
    filename: 'Banco de Chile Tarjeta Mastercard EC Octubre 2024.pdf',
    institucion_cmf: 'Banco de Chile',
    document_type: 22, // Tipo 22: Acredita Monto
    acreditacion_tipo: 'monto'
  }
];

async function run() {
  console.log('🔧 Subiendo y registrando documentos de Claudia en client_documents...\n');

  for (const doc of DOCS_TO_UPLOAD) {
    if (!fs.existsSync(doc.local)) {
      console.error(`❌ Archivo local no encontrado: ${doc.local}`);
      process.exit(1);
    }

    const fileBuffer = fs.readFileSync(doc.local);
    console.log(`⏳ Subiendo a storage: ${doc.filename}...`);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(doc.storagePath, fileBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      console.error(`❌ Error al subir ${doc.filename}:`, uploadError.message);
      process.exit(1);
    }
    console.log(`   ✓ Subido a ${BUCKET}/${doc.storagePath}`);

    console.log(`⏳ Registrando en client_documents: ${doc.filename}...`);
    const { error: dbError } = await supabase
      .from('client_documents')
      .insert({
        client_id: CLIENT_ID,
        filename: doc.filename,
        storage_path: doc.storagePath,
        document_type: doc.document_type,
        acreditacion_tipo: doc.acreditacion_tipo,
        institucion_cmf: doc.institucion_cmf,
        uploaded_at: new Date().toISOString()
      });

    if (dbError) {
      console.error(`❌ Error al registrar en DB ${doc.filename}:`, dbError.message);
      process.exit(1);
    }
    console.log(`   ✓ Registrado en DB.`);
  }

  console.log('\n🎉 Todos los documentos han sido subidos y registrados con éxito.');
}

run().catch(console.error);
