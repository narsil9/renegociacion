import {
  AdditionalCreditor,
  ReclassifiedCreditor,
} from '../../src/utils/sentinel';
import {
  CmfDocumentOverride,
} from '../../src/automation/step3_acreedores';
import { runStep3Case } from '../_shared/step3_case_helpers';

const SENTINEL_RECLASSIFIED: ReclassifiedCreditor[] = [
  {
    bank: 'Banco de Chile',
    product_type: 'credito_consumo',
    institucion_cmf: 'Banco de Chile',
    delinquency_start_date: '2025-05-12',
    delinquency_days: 183,
    total_credito_clp: 14886035,
    new_classification: 'obligaciones_260',
    reason: 'Certificado Socofin acredita saldo prejudicial y mora desde 12/05/2025 para la operacion 29360.',
    document_filename: 'Estado de Deuda - Power Apps.pdf RUT 187553180.pdf',
  },
];

const SENTINEL_ADDITIONAL: AdditionalCreditor[] = [
  {
    bank: 'CCAF Los Andes',
    institucion_cmf: 'CCAF Los Andes',
    product_type: 'caja_compensacion',
    categoria_articulo: 261,
    total_credito_clp: 4143309,
    reason: 'Credito social por planilla, vigente, no figura en CMF.',
    document_filename: 'c8346617-f01f-49a6-a634-4f51eaedf21e.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'CCAF Los Andes',
    institucion_cmf: 'CCAF Los Andes',
    product_type: 'caja_compensacion',
    categoria_articulo: 261,
    total_credito_clp: 2076625,
    reason: 'Segundo credito social Caja Los Andes, vigente, no figura en CMF.',
    document_filename: '65018458-3412-4998-ae61-16f4474560f2.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'Ilustre Municipalidad de Santiago',
    institucion_cmf: 'Ilustre Municipalidad de Santiago',
    product_type: 'otro',
    categoria_articulo: 261,
    total_credito_clp: 284680,
    reason: 'Multas de transito del RMNP. Acreedor publico no reportado por CMF.',
    document_filename: 'MNP_500664842138_SPLG.21.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'Ilustre Municipalidad de Las Condes',
    institucion_cmf: 'Ilustre Municipalidad de Las Condes',
    product_type: 'otro',
    categoria_articulo: 261,
    total_credito_clp: 104470,
    reason: 'Multa de transito del RMNP. Acreedor publico no reportado por CMF.',
    document_filename: 'MNP_500664842138_SPLG.21.pdf',
    needs_lawyer_confirmation: true,
  },
];

const CMF_OVERRIDES: CmfDocumentOverride[] = [
  {
    institucion_cmf: 'De Credito e Inversiones',
    monto_clp: 6021332,
    fecha_vencimiento: '2025-05-02',
  },
];

runStep3Case({
  label: 'Nicolas',
  cmfStoragePath: 'nicolas_bascunan/informe_cmf.pdf',
  cmfLocalFilename: 'informe_cmf_nicolas.pdf',
  sentinelReclassified: SENTINEL_RECLASSIFIED,
  sentinelAdditional: SENTINEL_ADDITIONAL,
  cmfOverrides: CMF_OVERRIDES,
  mappedDocs: [
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 24,
      storage_path: 'nicolas_bascunan/bch_poder_apps.pdf',
      filename: 'Estado de Deuda - Power Apps.pdf RUT 187553180.pdf',
    },
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 22,
      storage_path: 'nicolas_bascunan/bch_poder_apps.pdf',
      filename: 'Estado de Deuda - Power Apps.pdf RUT 187553180.pdf',
    },
    {
      institucion_cmf: 'De Credito e Inversiones',
      tipo_documento: 22,
      storage_path: 'nicolas_bascunan/bci_prepago.pdf',
      filename: 'BCI-40670058-certificado-prepago_unlocked.pdf',
    },
    {
      institucion_cmf: 'De Credito e Inversiones',
      tipo_documento: 23,
      storage_path: 'nicolas_bascunan/bci_mora.pdf',
      filename: 'Mora BCI.pdf',
    },
    {
      institucion_cmf: 'Santander Consumer',
      tipo_documento: 22,
      storage_path: 'nicolas_bascunan/santander_consumer.pdf',
      filename: '650071881789 (1).pdf',
    },
    {
      institucion_cmf: 'CAR - Ripley',
      tipo_documento: 22,
      storage_path: 'nicolas_bascunan/ripley_octubre.pdf',
      filename: 'Estado Ripley Octubre.pdf',
    },
    {
      institucion_cmf: 'CMR Falabella',
      tipo_documento: 22,
      storage_path: 'nicolas_bascunan/cmr_app.jpeg',
      filename: 'WhatsApp Image 2025-11-04 at 3.36.39 PM.jpeg',
    },
    {
      institucion_cmf: 'CCAF Los Andes',
      tipo_documento: 22,
      storage_path: 'nicolas_bascunan/cla_32032.pdf',
      filename: 'c8346617-f01f-49a6-a634-4f51eaedf21e.pdf',
    },
    {
      institucion_cmf: 'CCAF Los Andes',
      tipo_documento: 22,
      storage_path: 'nicolas_bascunan/cla_51051.pdf',
      filename: '65018458-3412-4998-ae61-16f4474560f2.pdf',
    },
    {
      institucion_cmf: 'Ilustre Municipalidad de Santiago',
      tipo_documento: 22,
      storage_path: 'nicolas_bascunan/rmnp_multas.pdf',
      filename: 'MNP_500664842138_SPLG.21.pdf',
    },
  ],
  planLines: [
    'CMF: 6 acreedores (2 Art.260 + 4 Art.261).',
    'NO-CMF: 2 Caja Los Andes + 2 municipalidades desde RMNP.',
    'Caso con Banco de Chile duplicado en CMF (consumo + vivienda).',
  ],
}).catch((err) => {
  console.error('ERROR FATAL:', (err as Error).message);
  process.exit(1);
});
