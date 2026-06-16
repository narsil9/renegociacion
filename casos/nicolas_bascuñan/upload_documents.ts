import * as path from 'path';

import { runUploadDocuments } from '../_shared/step3_case_helpers';

runUploadDocuments({
  label: 'Nicolas Bascunan',
  files: [
    {
      localPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-11-27T090800.971.pdf'),
      storagePath: 'nicolas_bascunan/informe_cmf.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_de_Chile', 'Estado de Deuda - Power Apps.pdf RUT 187553180.pdf'),
      storagePath: 'nicolas_bascunan/bch_poder_apps.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_de_Crédito_e_Inversiones', 'BCI-40670058-certificado-prepago_unlocked.pdf'),
      storagePath: 'nicolas_bascunan/bci_prepago.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', '06_Acreedores_Art260_Mora', 'Banco_de_Crédito_e_Inversiones', 'Mora BCI.pdf'),
      storagePath: 'nicolas_bascunan/bci_mora.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Banco_Santander', '650071881789 (1).pdf'),
      storagePath: 'nicolas_bascunan/santander_consumer.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Banco_Ripley', 'Estado Ripley Octubre.pdf'),
      storagePath: 'nicolas_bascunan/ripley_octubre.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Banco_Falabella', 'WhatsApp Image 2025-11-04 at 3.36.39 PM.jpeg'),
      storagePath: 'nicolas_bascunan/cmr_app.jpeg',
      contentType: 'image/jpeg',
    },
    {
      localPath: path.join(__dirname, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Caja_Los_Andes', 'c8346617-f01f-49a6-a634-4f51eaedf21e.pdf'),
      storagePath: 'nicolas_bascunan/cla_32032.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Caja_Los_Andes', '65018458-3412-4998-ae61-16f4474560f2.pdf'),
      storagePath: 'nicolas_bascunan/cla_51051.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', '07_Acreedores_Art261_Al_Dia', 'Multas_Transito', 'MNP_500664842138_SPLG.21.pdf'),
      storagePath: 'nicolas_bascunan/rmnp_multas.pdf',
      contentType: 'application/pdf',
    },
  ],
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
