import * as path from 'path';

import { runUploadDocuments } from '../_shared/step3_case_helpers';

runUploadDocuments({
  label: 'Jaime Cartes',
  files: [
    {
      localPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-11-27T084950.380.pdf'),
      storagePath: 'jaime_cartes/informe_cmf.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco Santander', '2982 TC ESTADOS DE CUENTA MORA 8_8.pdf'),
      storagePath: 'jaime_cartes/santander_2982_historial.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Banco Santander', 'estado-de-cuenta (13).pdf'),
      storagePath: 'jaime_cartes/santander_2982_noviembre.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'Tenpo Payments S.A.', 'Constancia de Deuda 17596599-8 .pdf'),
      storagePath: 'jaime_cartes/tenpo_constancia.pdf',
      contentType: 'application/pdf',
    },
    {
      localPath: path.join(__dirname, 'documentos', 'Acreedores CMF', 'DEUDA INDIRECTA COOPEUCH ', 'Hoja Resumen - 2025-06-27T151837.177.pdf'),
      storagePath: 'jaime_cartes/coopeuch_hipotecario.pdf',
      contentType: 'application/pdf',
    },
  ],
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
