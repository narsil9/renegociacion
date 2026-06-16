import * as path from 'path';

import { runSetupProfile } from '../_shared/step3_case_helpers';

runSetupProfile({
  clientName: 'Jaime Hernan Cartes Fuentes',
  clientRut: '17.596.599-8',
  storagePrefix: 'jaime_cartes',
  cmfLocalPath: path.join(__dirname, 'documentos', '02_Informe_CMF', 'informe-deudas-pdf-2025-11-27T084950.380.pdf'),
  ctLocalPath: path.join(__dirname, 'documentos', 'SII', 'Carpeta_Tributaria_Regular (22).pdf'),
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
