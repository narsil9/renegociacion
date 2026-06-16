import * as path from 'path';

import { runUploadDocuments } from '../_shared/step3_case_helpers';

runUploadDocuments({
  label: 'Irene Arevalo',
  files: [
    {
      localPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe_deudas_16143425-62.pdf'),
      storagePath: 'irene_arevalo/informe_cmf.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco Santander', 'Certificado de deuda.pdf'),
      storagePath: 'irene_arevalo/santander_certificado.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco Santander', '1702 11_25.pdf'),
      storagePath: 'irene_arevalo/santander_1702_1125.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', '9774 Informacion credito consumo.pdf'),
      storagePath: 'irene_arevalo/bch_9774.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', '7984 Informacion Credito Consumo.pdf'),
      storagePath: 'irene_arevalo/bch_7984.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', 'TARJETA DE CREDITO', '3902 TC MORA 7_8.pdf'),
      storagePath: 'irene_arevalo/bch_3902_mora.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', '4795 TC.pdf'),
      storagePath: 'irene_arevalo/bch_4795.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco de Chile', 'TARJETA DE CREDITO', '4795 MORA 8_9.pdf'),
      storagePath: 'irene_arevalo/bch_4795_mora.pdf',
      contentType: 'application/pdf',
    },
  ],
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
