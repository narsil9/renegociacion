import * as path from 'path';

import { runSetupProfile } from '../_shared/step3_case_helpers';

runSetupProfile({
  clientName: 'Nicolas Ignacio Bascunan Quiroga',
  clientRut: '18.755.318-0',
  storagePrefix: 'nicolas_bascunan',
  cmfLocalPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-11-27T090800.971.pdf'),
  ctLocalPath: path.join(__dirname, 'documentos', '03_Tributaria_y_SII', 'Carpeta_Tributaria_Regular (18).pdf'),
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
