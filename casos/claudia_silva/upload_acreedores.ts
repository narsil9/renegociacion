import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../../src/utils/supabaseWorker';

const CLIENT_ID = 'a9ddf715-3bdf-4377-8cb3-2d467089227d'; // Patricio Martini (Prueba) — usando datos Claudia
const BUCKET = 'documentos';
const STORAGE_PREFIX = 'patricio_martini';

const ACREEDORES_BASE = path.resolve(__dirname, 'documentos', 'Acreedores ');

interface DocToUpload {
  localPath: string;
  storageName: string;
  filename: string;
  institucion_cmf: string;
  document_type: number; // 22=monto, 23=vencimiento, 24=general(ambos)
  acreditacion_tipo: string; // 'monto' | 'vencimiento' | 'general' | 'estado_cuenta'
  nota: string;
}

async function upload() {
  // Identificar el archivo pequeño de BCI (carta de cargo automático) por tamaño
  const bciDir = path.join(ACREEDORES_BASE, 'Banco de Chile');
  const bciFiles = fs.readdirSync(bciDir)
    .filter(f => f.endsWith('.pdf'))
    .map(f => ({ name: f, size: fs.statSync(path.join(bciDir, f)).size }))
    .sort((a, b) => a.size - b.size); // asc por tamaño → el más pequeño es la carta

  console.log('Archivos Banco de Chile encontrados:');
  bciFiles.forEach(f => console.log(`  ${f.name} (${(f.size / 1024).toFixed(0)} KB)`));

  const cartaCargo = bciFiles[0]; // más pequeño = carta de cargo automático
  const estadosCuentaBCI = bciFiles.slice(1); // los más grandes = estados de cuenta

  const docsToUpload: DocToUpload[] = [
    // ── Art. 260: Banco de Chile (Crédito de Consumo) ──────────────────────
    {
      localPath: path.join(bciDir, 'informeCredito.pdf'),
      storageName: 'acreedor_bci_consumo_informe_credito.pdf',
      filename: 'informeCredito.pdf',
      institucion_cmf: 'Banco de Chile',
      document_type: 24, // acredita monto + vencimiento
      acreditacion_tipo: 'general',
      nota: 'Art.260 — Informe oficial crédito de consumo BCI. Acredita monto ($48.236.275) y vencimiento cuota impaga (03/09/2024).'
    },

    // ── Art. 260: Ripley (Tarjeta Mastercard) — estados de cuenta Jul-Nov 2024 ──
    {
      localPath: path.join(ACREEDORES_BASE, 'Ripley', 'RIPLEY JULIO.pdf'),
      storageName: 'acreedor_ripley_tarjeta_julio.pdf',
      filename: 'RIPLEY JULIO.pdf',
      institucion_cmf: 'CAR S.A. (Tarjeta Ripley)',
      document_type: 24,
      acreditacion_tipo: 'estado_cuenta',
      nota: 'Art.260 — Estado de cuenta Ripley Julio 2024. Primer mes sin pago mínimo (vencimiento 25/07/2024).'
    },
    {
      localPath: path.join(ACREEDORES_BASE, 'Ripley', 'RIPLEY AGOSTO.pdf'),
      storageName: 'acreedor_ripley_tarjeta_agosto.pdf',
      filename: 'RIPLEY AGOSTO.pdf',
      institucion_cmf: 'CAR S.A. (Tarjeta Ripley)',
      document_type: 24,
      acreditacion_tipo: 'estado_cuenta',
      nota: 'Art.260 — Estado de cuenta Ripley Agosto 2024. Continúa mora.'
    },
    {
      localPath: path.join(ACREEDORES_BASE, 'Ripley', 'RIPLEY SEPTIEMBRE.pdf'),
      storageName: 'acreedor_ripley_tarjeta_septiembre.pdf',
      filename: 'RIPLEY SEPTIEMBRE.pdf',
      institucion_cmf: 'CAR S.A. (Tarjeta Ripley)',
      document_type: 24,
      acreditacion_tipo: 'estado_cuenta',
      nota: 'Art.260 — Estado de cuenta Ripley Septiembre 2024.'
    },
    {
      localPath: path.join(ACREEDORES_BASE, 'Ripley', 'RIPLEY OCTUBRE.pdf'),
      storageName: 'acreedor_ripley_tarjeta_octubre.pdf',
      filename: 'RIPLEY OCTUBRE.pdf',
      institucion_cmf: 'CAR S.A. (Tarjeta Ripley)',
      document_type: 24,
      acreditacion_tipo: 'estado_cuenta',
      nota: 'Art.260 — Estado de cuenta Ripley Octubre 2024.'
    },
    {
      localPath: path.join(ACREEDORES_BASE, 'Ripley', 'RIPLEY NOVIEMBRE.pdf'),
      storageName: 'acreedor_ripley_tarjeta_noviembre.pdf',
      filename: 'RIPLEY NOVIEMBRE.pdf',
      institucion_cmf: 'CAR S.A. (Tarjeta Ripley)',
      document_type: 24,
      acreditacion_tipo: 'estado_cuenta',
      nota: 'Art.260 — Estado de cuenta Ripley Noviembre 2024. Saldo final: $1.218.565.'
    },

    // ── Art. 261: Banco de Chile (Tarjeta Mastercard) — estados de cuenta ──
    ...estadosCuentaBCI.map((f, i) => ({
      localPath: path.join(bciDir, f.name),
      storageName: `acreedor_bci_tarjeta_ec_${i + 1}.pdf`,
      filename: `BCI Tarjeta EC ${i + 1}.pdf`,
      institucion_cmf: 'Banco de Chile',
      document_type: 22, // solo monto (Art. 261 no requiere vencimiento)
      acreditacion_tipo: 'estado_cuenta',
      nota: `Art.261 — Estado de cuenta BCI Mastercard (${(f.size / 1024).toFixed(0)} KB).`
    })),

    // ── Art. 261: Banco de Chile — carta de cargo automático ──────────────
    {
      localPath: path.join(bciDir, cartaCargo.name),
      storageName: 'acreedor_bci_tarjeta_carta_cargo.pdf',
      filename: 'BCI Carta Cargo Automático.pdf',
      institucion_cmf: 'Banco de Chile',
      document_type: 22,
      acreditacion_tipo: 'estado_cuenta',
      nota: 'Art.261 — Carta de notificación de cargo automático BCI 15/11/2024. Explica por qué la tarjeta está al día.'
    },
  ];

  console.log(`\nSubiendo ${docsToUpload.length} documentos a Supabase Storage...`);

  const insertRows: any[] = [];

  for (const doc of docsToUpload) {
    const storagePath = `${STORAGE_PREFIX}/${doc.storageName}`;
    console.log(`\n⏳ Subiendo: ${doc.filename} → ${storagePath}`);

    if (!fs.existsSync(doc.localPath)) {
      console.error(`  ❌ Archivo no encontrado: ${doc.localPath}`);
      continue;
    }

    const fileBuffer = fs.readFileSync(doc.localPath);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      console.error(`  ❌ Error al subir: ${uploadError.message}`);
      continue;
    }

    console.log(`  ✓ Subido correctamente.`);
    insertRows.push({
      client_id: CLIENT_ID,
      document_type: doc.document_type,
      acreditacion_tipo: doc.acreditacion_tipo,
      institucion_cmf: doc.institucion_cmf,
      storage_path: storagePath,
      filename: doc.filename,
      uploaded_at: new Date().toISOString(),
    });
  }

  // Insertar todos los registros en client_documents
  if (insertRows.length === 0) {
    console.error('\n❌ No se pudo subir ningún archivo. Abortando inserción en BD.');
    process.exit(1);
  }

  console.log(`\n⏳ Insertando ${insertRows.length} registros en client_documents...`);
  const { data, error: insertError } = await supabase
    .from('client_documents')
    .insert(insertRows)
    .select('id, filename, acreditacion_tipo, institucion_cmf');

  if (insertError) {
    console.error('❌ Error al insertar en client_documents:', insertError.message);
    process.exit(1);
  }

  console.log('\n✅ Documentos registrados en client_documents:');
  data?.forEach(r => {
    console.log(`  [${r.id}] ${r.filename} → ${r.institucion_cmf} (${r.acreditacion_tipo})`);
  });

  console.log('\n✅ Carga completa. El perfil de Patricio Martini ahora tiene los documentos de Claudia Silva.');
}

upload().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
