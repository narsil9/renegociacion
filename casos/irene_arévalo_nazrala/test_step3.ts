import { CmfDocumentOverride } from '../../src/automation/step3_acreedores';
import { ReclassifiedCreditor } from '../../src/utils/sentinel';
import { runStep3Case } from '../_shared/step3_case_helpers';

const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [
  {
    bank: 'Santander-Chile',
    product_type: 'tarjeta_credito',
    institucion_cmf: 'Santander-Chile',
    delinquency_start_date: '2025-09-10',
    delinquency_days: 278,
    total_credito_clp: 2055633,
    new_classification: 'obligaciones_260',
    reason: 'EECC agosto-noviembre y certificado de deuda acreditan mora >= 91 dias.',
    document_filename: 'Certificado de deuda.pdf',
  },
];

const CMF_OVERRIDES: CmfDocumentOverride[] = [
  {
    institucion_cmf: 'Banco de Chile',
    monto_clp: 60333782,
    fecha_vencimiento: '2025-08-10',
  },
];

runStep3Case({
  label: 'Irene',
  cmfStoragePath: 'irene_arevalo/informe_cmf.pdf',
  cmfLocalFilename: 'informe_cmf_irene.pdf',
  sentinelReclassified: SENTINEL_RECLASSIFIED,
  cmfOverrides: CMF_OVERRIDES,
  mappedDocs: [
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 24,
      storage_path: 'irene_arevalo/bch_9774.pdf',
      filename: '9774 Informacion credito consumo.pdf',
    },
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 24,
      storage_path: 'irene_arevalo/bch_7984.pdf',
      filename: '7984 Informacion Credito Consumo.pdf',
    },
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 24,
      storage_path: 'irene_arevalo/bch_3902_mora.pdf',
      filename: '3902 TC MORA 7_8.pdf',
    },
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 22,
      storage_path: 'irene_arevalo/bch_4795.pdf',
      filename: '4795 TC.pdf',
    },
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 23,
      storage_path: 'irene_arevalo/bch_4795_mora.pdf',
      filename: '4795 MORA 8_9.pdf',
    },
    {
      institucion_cmf: 'Santander-Chile',
      tipo_documento: 22,
      storage_path: 'irene_arevalo/santander_certificado.pdf',
      filename: 'Certificado de deuda.pdf',
    },
    {
      institucion_cmf: 'Santander-Chile',
      tipo_documento: 23,
      storage_path: 'irene_arevalo/santander_1702_1125.pdf',
      filename: '1702 11_25.pdf',
    },
  ],
  planLines: [
    'CMF consolidado: Banco de Chile + Santander-Chile.',
    'Santander-Chile se fuerza a Art.260 por reclasificacion hardcodeada.',
    'El caso sigue bloqueado tributariamente, pero se prueba el Paso 3 igual.',
  ],
}).catch((err) => {
  console.error('ERROR FATAL:', (err as Error).message);
  process.exit(1);
});
