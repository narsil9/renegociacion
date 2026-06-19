import * as path from 'path';

import { runSetupProfile } from '../_shared/step3_case_helpers';

runSetupProfile({
  clientName: 'Noelia Pilar Lorca Guerrero',
  clientRut: '15.121.553-K',
  storagePrefix: 'noelia_lorca',
  cmfLocalPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-12-09T161825.883.pdf'),
  ctLocalPath: path.join(__dirname, 'documentos', '03_Tributaria_y_SII', 'Carpeta_Tributaria_Regular (24).pdf'),
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
