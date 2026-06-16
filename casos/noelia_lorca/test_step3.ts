import {
  AdditionalCreditor,
} from '../../src/utils/sentinel';
import { CmfDocumentOverride } from '../../src/automation/step3_acreedores';
import { runStep3Case } from '../_shared/step3_case_helpers';

const SENTINEL_ADDITIONAL: AdditionalCreditor[] = [
  {
    bank: 'La Araucana C.C.A.F.',
    institucion_cmf: 'La Araucana C.C.A.F.',
    product_type: 'caja_compensacion',
    categoria_articulo: 260,
    total_credito_clp: 9536311,
    delinquency_start_date: '2025-07-31',
    delinquency_days: 132,
    reason: 'Credito social moroso. La carpeta acredita vencimiento, pero el monto es referencial y falta liquidacion actual.',
    document_filename: 'certificado_detalle_credito_vigente (1).pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'Banco de Chile',
    institucion_cmf: 'Banco de Chile',
    product_type: 'otro',
    categoria_articulo: 261,
    total_credito_clp: 114782,
    reason: 'Linea de credito 3570 no separada en CMF.',
    document_filename: '3570 Bco Chile LC.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'Banco de Chile',
    institucion_cmf: 'Banco de Chile',
    product_type: 'tarjeta_credito',
    categoria_articulo: 261,
    total_credito_clp: 377461,
    reason: 'Tarjeta 9782 no separada en CMF.',
    document_filename: '9782 TARJETA DE CREDITO MORA 7-8.pdf',
    needs_lawyer_confirmation: true,
  },
  {
    bank: 'Forum Servicios Financieros',
    institucion_cmf: 'Forum Servicios Financieros',
    product_type: 'otro',
    categoria_articulo: 261,
    total_credito_clp: 5851825,
    reason: 'Credito automotriz vigente. La carpeta no trae prepago actual, solo monto financiado referencial.',
    document_filename: 'document (9) (2).pdf',
    needs_lawyer_confirmation: true,
  },
];

const CMF_OVERRIDES: CmfDocumentOverride[] = [
  {
    institucion_cmf: 'Banco de Chile',
    monto_clp: 13524920,
    fecha_vencimiento: '2025-08-05',
  },
];

runStep3Case({
  label: 'Noelia',
  cmfStoragePath: 'noelia_lorca/informe_cmf.pdf',
  cmfLocalFilename: 'informe_cmf_noelia.pdf',
  sentinelAdditional: SENTINEL_ADDITIONAL,
  cmfOverrides: CMF_OVERRIDES,
  mappedDocs: [
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 22,
      storage_path: 'noelia_lorca/bch_1136_cred.pdf',
      filename: '1136 Bco Chile Cred.pdf',
    },
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 23,
      storage_path: 'noelia_lorca/bch_1136_mora.jpg',
      filename: '1136 MORA CONSUMO 5-8.jpg',
    },
    {
      institucion_cmf: 'Banco Estado',
      tipo_documento: 22,
      storage_path: 'noelia_lorca/bde_3350.pdf',
      filename: '3350 CONSUMO.pdf',
    },
    {
      institucion_cmf: 'CAR - Ripley',
      tipo_documento: 22,
      storage_path: 'noelia_lorca/ripley_noviembre.pdf',
      filename: 'noviembre.pdf',
    },
    {
      institucion_cmf: 'CMR Falabella',
      tipo_documento: 22,
      storage_path: 'noelia_lorca/cmr_7379_1125.pdf',
      filename: '7379 11_25.pdf',
    },
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 22,
      storage_path: 'noelia_lorca/bch_3570.pdf',
      filename: '3570 Bco Chile LC.pdf',
    },
    {
      institucion_cmf: 'Banco de Chile',
      tipo_documento: 22,
      storage_path: 'noelia_lorca/bch_9782.pdf',
      filename: '9782 TARJETA DE CREDITO MORA 7-8.pdf',
    },
    {
      institucion_cmf: 'La Araucana C.C.A.F.',
      tipo_documento: 24,
      storage_path: 'noelia_lorca/la_araucana_vigente.pdf',
      filename: 'certificado_detalle_credito_vigente (1).pdf',
    },
    {
      institucion_cmf: 'Forum Servicios Financieros',
      tipo_documento: 22,
      storage_path: 'noelia_lorca/forum_documento.pdf',
      filename: 'document (9) (2).pdf',
    },
  ],
  planLines: [
    'CMF: 1 Art.260 directo y 3 Art.261 directos.',
    'NO-CMF: La Araucana 260 + dos productos Banco de Chile + Forum 261.',
    'El caso sigue bloqueado tributariamente y con docs parciales en La Araucana/Forum.',
  ],
}).catch((err) => {
  console.error('ERROR FATAL:', (err as Error).message);
  process.exit(1);
});
