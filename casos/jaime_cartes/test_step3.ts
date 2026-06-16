import { CmfDocumentOverride } from '../../src/automation/step3_acreedores';
import { runStep3Case } from '../_shared/step3_case_helpers';

const CMF_OVERRIDES: CmfDocumentOverride[] = [
  {
    institucion_cmf: 'Santander-Chile',
    monto_clp: 2730267,
    fecha_vencimiento: '2025-10-09',
  },
  {
    institucion_cmf: 'Tenpo Payments S.A.',
    monto_clp: 298964,
    fecha_vencimiento: '2025-08-14',
  },
];

runStep3Case({
  label: 'Jaime',
  cmfStoragePath: 'jaime_cartes/informe_cmf.pdf',
  cmfLocalFilename: 'informe_cmf_jaime.pdf',
  cmfOverrides: CMF_OVERRIDES,
  mappedDocs: [
    {
      institucion_cmf: 'Santander-Chile',
      tipo_documento: 24,
      storage_path: 'jaime_cartes/santander_2982_historial.pdf',
      filename: '2982 TC ESTADOS DE CUENTA MORA 8_8.pdf',
    },
    {
      institucion_cmf: 'Santander-Chile',
      tipo_documento: 22,
      storage_path: 'jaime_cartes/santander_2982_noviembre.pdf',
      filename: 'estado-de-cuenta (13).pdf',
    },
    {
      institucion_cmf: 'Tenpo Payments S.A.',
      tipo_documento: 24,
      storage_path: 'jaime_cartes/tenpo_constancia.pdf',
      filename: 'Constancia de Deuda 17596599-8 .pdf',
    },
    {
      institucion_cmf: 'Coopeuch',
      tipo_documento: 22,
      storage_path: 'jaime_cartes/coopeuch_hipotecario.pdf',
      filename: 'Hoja Resumen - 2025-06-27T151837.177.pdf',
    },
  ],
  planLines: [
    'CMF: Santander-Chile + Tenpo Payments + Coopeuch indirecto.',
    'Santander-Chile se recorta al saldo real de la tarjeta 2982.',
    'El caso sigue bloqueado por boletas y monto historico, pero se prueba el Paso 3.',
  ],
}).catch((err) => {
  console.error('ERROR FATAL:', (err as Error).message);
  process.exit(1);
});
