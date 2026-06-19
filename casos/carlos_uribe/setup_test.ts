/**
 * Crea el perfil de Carlos Robinson Uribe Ruiz en Supabase y sube CMF + CT.
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/carlos_uribe/setup_test.ts
 */
import * as path from 'path';
import { runSetupProfile } from '../_shared/step3_case_helpers';

runSetupProfile({
  clientName: 'Carlos Robinson Uribe Ruiz',
  clientRut: '16.523.825-7',
  storagePrefix: 'carlos_uribe',
  cmfLocalPath: path.join(__dirname, 'documentos', 'informe_cmf.pdf'),
  ctLocalPath: path.join(__dirname, 'documentos', 'carpeta_tributaria.pdf'),
}).catch((err) => {
  console.error('🚨', (err as Error).message);
  process.exit(1);
});
