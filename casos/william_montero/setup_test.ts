import * as path from 'path';

import { runSetupProfile } from '../_shared/step3_case_helpers';

runSetupProfile({
  clientName: 'William Alexander Montero Romero',
  clientRut: '25.656.359-2',
  storagePrefix: 'pato_william',
  cmfLocalPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-12-15T153144.200.pdf'),
  ctLocalPath: path.join(__dirname, 'documentos', 'SII', 'Carpeta_Tributaria_Regular (31).pdf'),
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
