import * as path from 'path';

import { runUploadDocuments } from '../_shared/step3_case_helpers';

runUploadDocuments({
  label: 'Noelia Lorca',
  files: [
    {
      localPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-12-09T161825.883.pdf'),
      storagePath: 'noelia_lorca/informe_cmf.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', '1136 Bco Chile Cred.pdf'),
      storagePath: 'noelia_lorca/bch_1136_cred.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', '1136 MORA CONSUMO 5-8.jpg'),
      storagePath: 'noelia_lorca/bch_1136_mora.jpg',
      contentType: 'image/jpeg',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco Estado', '3350 CONSUMO.pdf'),
      storagePath: 'noelia_lorca/bde_3350.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco Ripley', 'noviembre.pdf'),
      storagePath: 'noelia_lorca/ripley_noviembre.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco Falabella', '7379 11_25.pdf'),
      storagePath: 'noelia_lorca/cmr_7379_1125.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', '3570 Bco Chile LC.pdf'),
      storagePath: 'noelia_lorca/bch_3570.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', '9782 TARJETA DE CREDITO MORA 7-8.pdf'),
      storagePath: 'noelia_lorca/bch_9782.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Carpetas Acreedores NO CMF', 'LA ARAUCANA', 'certificado_detalle_credito_vigente (1).pdf'),
      storagePath: 'noelia_lorca/la_araucana_vigente.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Carpetas Acreedores NO CMF', 'Forum', 'document (9) (2).pdf'),
      storagePath: 'noelia_lorca/forum_documento.pdf',
      contentType: 'application/pdf',
    },
  ],
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
