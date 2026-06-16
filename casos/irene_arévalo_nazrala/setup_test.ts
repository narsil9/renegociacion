import * as path from 'path';

import { runSetupProfile } from '../_shared/step3_case_helpers';

runSetupProfile({
  clientName: 'Irene Arevalo Nazrala',
  clientRut: '16.143.425-6',
  storagePrefix: 'irene_arevalo',
  cmfLocalPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe_deudas_16143425-62.pdf'),
  ctLocalPath: path.join(__dirname, 'documentos', 'SII', 'Carpeta_Tributaria_Regular (25).pdf'),
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
