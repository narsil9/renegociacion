/**
 * Fixtures del Paso 5 — carpeta REAL ~/Desktop/renegociacion_docs (13 clientes; 11 con
 * documentos de ingreso). HECHOS extraídos actuando como el LLM (lectura nativa de los
 * PDF de 04_Ingresos_y_Sueldos) + resultado ESPERADO del analista.
 *
 * Igual que fixtures.ts pero con casos NUEVOS y más adversarios (multi-pago en un mes,
 * licencia médica que parte el mes, honorarios+sueldo, arriendo, certs de cotizaciones
 * encriptados, filename engañoso, "Alcance Líquido" vs "Líquido a pagar", Coopeuch).
 *
 * Sin verdad-terreno del abogado: el ESPERADO es el cálculo del analista según las reglas
 * (L1–L14). NO es producción (vive en casos/). Cifras leídas de los PDF el 2026-06-29.
 */
import { ExtractedIncomeDoc, CotizacionesCertFacts } from '../../src/utils/income_extractor';
import { Step5Fixture } from './fixtures';

// Helpers de evidencia auto-consistente (la cita contiene la cifra cruda → 0 claudeReadIssues).
const ev = (monto: number, label = 'Líquido a Pagar') => ({
  cita_monto: `${label}: $${monto.toLocaleString('es-CL')}`,
  confidence: 0.97,
});
const D = (label: string, amount: number) => ({ label, amount });
// liquidación: un mes con su "Líquido a Pagar" + descuentos (+ días trabajados opcionales).
const liq = (
  period_label: string,
  liquido: number,
  deductions: { label: string; amount: number }[] = [],
  dias_trabajados?: number,
) => ({ period_label, liquido_a_pagar: liquido, deductions, dias_trabajados, evidence: ev(liquido) });
// boleta de honorarios: bruto + retención (el monto a declarar es el BRUTO).
const bol = (period_label: string, bruto: number, retencion: number) => ({
  period_label,
  liquido_a_pagar: bruto - retencion,
  monto_bruto: bruto,
  retencion,
  evidence: ev(bruto, 'Honorario Bruto'),
});

export const FIXTURES_REAL: Step5Fixture[] = [
  // ===========================================================================
  // 1) CLAUDIA SILVA — Empresa Eléctrica de la Frontera (SAESA). Formato con DOS
  //    líquidos: "ALC. LIQUIDO" (intermedio) y "LIQ. A PAGO" (final, L1). "Ahorro
  //    Caja Los Andes" (sólo en Sept) es voluntario → se suma; anticipo/bienestar/
  //    sindicato/FENTECH → ambiguos.
  // ===========================================================================
  {
    name: 'Claudia Silva',
    rut: '18810379-0',
    docs: [{
      filename: 'Liquidaciones Claudia Silva.pdf',
      category: 'liquidacion_sueldo',
      source_key: '76073164-1', // Empresa Eléctrica de la Frontera SA
      periods: [
        liq('Julio 2024', 1415994, [D('Antic. Extr. Rem.', 207105), D('Aporte Bienestar', 18177), D('FENTECH', 1069), D('Sindicato FRONTEL', 6415)]),
        liq('Agosto 2024', 1415959, [D('Antic. Extr. Rem.', 207105), D('Aporte Bienestar', 18177), D('FENTECH', 1069), D('Sindicato FRONTEL', 6415)]),
        liq('Septiembre 2024', 1378264, [D('Antic. Extr. Rem.', 207104), D('Aporte Bienestar', 18177), D('FENTECH', 1069), D('Sindicato FRONTEL', 6415), D('Ahorro Caja Los Andes', 37945)]),
        liq('Octubre 2024', 1517919, [D('Antic. Extr. Rem.', 105501), D('Aporte Bienestar', 18177), D('FENTECH', 1069), D('Sindicato FRONTEL', 6415)]),
        liq('Noviembre 2024', 1555900, [D('Antic. Extr. Rem.', 105501), D('Aporte Bienestar', 18177), D('FENTECH', 1069), D('Sindicato FRONTEL', 6415)]),
      ],
    }],
    cotizaciones: { filename: 'Certificado_UNO.pdf', fecha_emision: '2024-11-20', rut_entidad_pagadora: '76073164-1' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 1496674, montoMax: 1496678 }],
    expectAlertSubstrings: ['Antic', 'Bienestar'],
    notes: 'Sep/Oct/Nov. Sep +Ahorro Caja Los Andes 37.945 (voluntario). Esperado $1.496.676.',
  },

  // ===========================================================================
  // 2) SUSANA MATAMALA — Hospital de Mulchén (sector público). SEPTIEMBRE tiene 3
  //    liquidaciones (sueldo + 2 planillas accesorias retroactivas trimestrales) →
  //    se SUMAN en el mes (L12). 3 meses recientes = Oct/Nov/Dic. Cert cotizaciones
  //    ENCRIPTADO → RUT pagador no verificable.
  // ===========================================================================
  {
    name: 'Susana Matamala',
    rut: '16983419-9',
    docs: [{
      filename: 'Liquidaciones Susana Matamala.pdf',
      category: 'liquidacion_sueldo',
      source_key: 'HOSPITAL_MULCHEN',
      periods: [
        liq('08/2025', 1332640, [D('Cod. 20 imponente bienestar', 23106), D('Fundacion Arturo Lopez Perez', 17600)], 30),
        liq('09/2025', 1470022, [D('Cod. 20 imponente bienestar', 23106), D('Fundacion Arturo Lopez Perez', 17600)], 30),
        liq('09/2025', 230300, [D('Cod. 20 imponente bienestar', 4482)]),   // planilla accesoria Ley 19.937 (retroactivo trimestral)
        liq('09/2025', 38379, [D('Cod. 20 imponente bienestar', 747)]),     // planilla accesoria Ley 19.490 (retroactivo trimestral)
        liq('10/2025', 1480611, [D('Cod. 20 imponente bienestar', 23106), D('Fundacion Arturo Lopez Perez', 17600)], 30),
        liq('11/2025', 1474049, [D('Cod. 20 imponente bienestar', 23106), D('Fundacion Arturo Lopez Perez', 17600)], 30),
        liq('12/2025', 1463983, [D('Cod. 20 imponente bienestar', 23106), D('Fundacion Arturo Lopez Perez', 17600)], 30),
      ],
    }],
    cotizaciones: { filename: 'CertificadoCotizaciones_23012026193503.pdf', fecha_emision: '2026-01-23', rut_entidad_pagadora: null },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 1472879, montoMax: 1472883 }],
    expectAlertSubstrings: ['sumaron', 'RUT'],
    notes: 'Sept 3 pagos → $1.738.701 agregado pero fuera de ventana. Oct/Nov/Dic → $1.472.881. Cert encriptado.',
  },

  // ===========================================================================
  // 3) NICOLÁS BASCUÑÁN — Bci Seguros (Buk). "Liquidacion Julio (3).pdf" CONTIENE
  //    Agosto (filename engañoso) y duplica a "Agosto (4)" → dedup. Crédito Personal
  //    Caja Los Andes → voluntario. 3 recientes = Ago/Sep/Oct.
  // ===========================================================================
  {
    name: 'Nicolás Bascuñán',
    rut: '18755318-0',
    docs: [{
      filename: 'Liquidaciones Nicolas Bascunan.pdf',
      category: 'liquidacion_sueldo',
      source_key: '99147000-K', // Bci Seguros Generales
      periods: [
        liq('Julio 2025', 1881746, [D('Estacionamiento', 14531), D('Seguro De Vida', 85398), D('Socio Bienestar', 6000), D('Crédito Personal Caja Los Andes', 164183)], 30),
        liq('Agosto 2025', 1953845, [D('Seguro De Vida Descuento', 85057), D('Estacionamiento', 23334), D('Socio Bienestar', 6000), D('Crédito Personal Caja Los Andes', 164183)], 30),
        liq('Agosto 2025', 1953845, [D('Seguro De Vida Descuento', 85057), D('Estacionamiento', 23334), D('Socio Bienestar', 6000), D('Crédito Personal Caja Los Andes', 164183)], 30), // DUPLICADO (Julio(3) == Agosto(4))
        liq('Septiembre 2025', 1612843, [D('Socio Bienestar', 6000), D('Anticipo Aguinaldo', 150000), D('Seguro De Vida Descuento', 85822), D('Abastible', 138950), D('Estacionamiento', 32928), D('Crédito Personal Caja Los Andes', 164183)], 30),
        liq('Octubre 2025', 1639488, [D('Socio Bienestar', 6000), D('Seguro De Vida Descuento', 85822), D('Abastible', 138040), D('Campaña Solidaria', 30000), D('Estacionamiento', 6530), D('Crédito Personal Caja Los Andes', 164183)], 30),
      ],
    }],
    cotizaciones: { filename: 'Cotizaciones 12 Meses.pdf', fecha_emision: '2025-11-01', rut_entidad_pagadora: '99147000-K' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 1899573, montoMax: 1899577 }],
    expectAlertSubstrings: ['duplicado', 'Abastible'],
    notes: 'Ago duplicada (filename "Julio (3)" trae Agosto) → dedup. +Caja Los Andes 164.183/mes. Esperado $1.899.575.',
  },

  // ===========================================================================
  // 4) WILLIAM MONTERO — BBR SPA (Buk). Formato con SOLO "Alcance Líquido" = neto
  //    final (no hay "Líquido a pagar" aparte) → ese ES el líquido (L1 matizado).
  //    Préstamos CCAF (Nov) → voluntario; anticipo → ambiguo.
  // ===========================================================================
  {
    name: 'William Montero',
    rut: '25656359-2',
    docs: [{
      filename: 'Liquidaciones William Montero.pdf',
      category: 'liquidacion_sueldo',
      source_key: '76416065-7', // BBR SPA
      periods: [
        liq('Septiembre 2025', 2429517, [D('Descuento Anticipo (Anticipo Aguinaldo)', 47383)], 30),
        liq('Octubre 2025', 2296399, [], 30),
        liq('Noviembre 2025', 2239957, [D('Préstamos CCAF', 93902)], 30),
      ],
    }],
    cotizaciones: { filename: 'Cotizaciones.pdf', fecha_emision: '2025-12-01', rut_entidad_pagadora: '76416065-7' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 2353256, montoMax: 2353260 }],
    expectAlertSubstrings: ['Anticipo'],
    notes: 'Nov +Préstamos CCAF 93.902. Esperado $2.353.258 (Alcance Líquido = neto final aquí).',
  },

  // ===========================================================================
  // 5) YOSELYN REYES — Universidad Santo Tomás. UN PDF con 3 páginas = 3 meses
  //    (Feb/Ene 2026, Dic 2025). Líquido bajísimo (~$650k) por DOS préstamos
  //    (Caja Los Andes + Coopeuch, "PRESTAMO COOPEUCH" → voluntario): se suman.
  // ===========================================================================
  {
    name: 'Yoselyn Reyes',
    rut: '16563374-1',
    docs: [{
      filename: 'LIQ YOSELYN.pdf',
      category: 'liquidacion_sueldo',
      source_key: '71551500-8', // Universidad Santo Tomás
      periods: [
        liq('2026-02', 641771, [D('Cuota Sindical SINESAT', 6948), D('Prestamo Caja Los Andes', 399068), D('Prestamo Coopeuch', 391930), D('Cuota Extraordinaria SINESAT', 26698)], 30),
        liq('2026-01', 681701, [D('Cuota Sindical SINESAT', 6948), D('Prestamo Caja Los Andes', 378963), D('Prestamo Coopeuch', 391930), D('Cuota Extraordinaria SINESAT', 6948)], 30),
        liq('2025-12', 679568, [D('Anticipo Aguinaldo', 77000), D('Cuota Sindical SINESAT', 6948), D('Prestamo Caja Los Andes', 378963), D('Prestamo Coopeuch', 391930), D('Cuota Extraordinaria SINESAT', 6948)], 30),
      ],
    }],
    cotizaciones: { filename: 'Cotizaciones 12 meses.pdf', fecha_emision: '2026-02-15', rut_entidad_pagadora: '71551500-8' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 1445273, montoMax: 1445277 }],
    expectAlertSubstrings: ['Sindical'],
    notes: '+Caja Los Andes +Coopeuch (préstamos) cada mes. Esperado $1.445.275 (líquido ~$650k + ~$780k préstamos).',
  },

  // ===========================================================================
  // 6) MARÍA PAZ BRAVO — Muni de Talca (APS) + ARRIENDO. DOS ingresos (tipo 1 + 7).
  //    "COOPEUCH" a secas (sin "préstamo") → AMBIGUO (no se suma), a diferencia de
  //    "PRESTAMO COOPEUCH" de Yoselyn. Arriendo = 1 comprobante BancoEstado $450.000.
  // ===========================================================================
  {
    name: 'María Paz Bravo',
    rut: '16997909-K',
    docs: [
      {
        filename: 'Liquidaciones Maria Paz Bravo.pdf',
        category: 'liquidacion_sueldo',
        source_key: 'MUNI_TALCA_APS',
        periods: [
          liq('Septiembre 2025', 1692645, [D('Asoc. Gremial APROSAM', 6700), D('COOPEUCH', 410890), D('Bienestar', 16400)], 30),
          liq('Octubre 2025', 1376902, [D('Asoc. Gremial APROSAM', 6700), D('COOPEUCH', 410890), D('Bienestar', 16400)], 30),
          liq('Noviembre 2025', 1784371, [D('Asoc. Gremial APROSAM', 6700), D('COOPEUCH', 3570), D('Bienestar', 16400)], 30),
        ],
      },
      {
        filename: 'Comprobante deposito de arrendatario casa Banco estado.pdf',
        category: 'comprobante_arriendo',
        source_key: 'ARRIENDO_CASA',
        periods: [{ period_label: '2025-11', liquido_a_pagar: 450000, evidence: ev(450000, 'Monto') }],
      },
    ],
    cotizaciones: { filename: 'cotizaciones.pdf', fecha_emision: '2025-11-25', rut_entidad_pagadora: 'MUNI_TALCA_APS' },
    expectedIncomes: [
      { tipoIngreso: 1, label: 'Remuneración', montoMin: 1617971, montoMax: 1617975 },
      { tipoIngreso: 7, label: 'Arriendos', montoMin: 449998, montoMax: 450002 },
    ],
    expectAlertSubstrings: ['COOPEUCH', 'esperaban 3'],
    notes: 'Sueldo $1.617.973 (COOPEUCH a secas NO se suma → ambiguo). Arriendo $450.000 (1 de 3 meses → alerta).',
  },

  // ===========================================================================
  // 7) BETZY LEE — Farmacia Economik (escaneo CamScanner, 4 págs). OCTUBRE es PARCIAL
  //    (licencia médica 14 días, 17 trabajados → líquido $1.06M) → se EXCLUYE del
  //    promedio a favor de Jul/Ago/Sep completos (L13).
  // ===========================================================================
  {
    name: 'Betzy Lee',
    rut: '26199806-8',
    docs: [{
      filename: 'liquidaciones de sueldo.pdf',
      category: 'liquidacion_sueldo',
      source_key: '76947101-4', // Farmacia Economik Ltda
      periods: [
        liq('Julio 2025', 1723495, [], 30),
        liq('Agosto 2025', 1723346, [], 30),
        liq('Septiembre 2025', 1723680, [], 30),
        liq('Octubre 2025', 1061904, [], 17), // licencia médica 14 días → PARCIAL
      ],
    }],
    cotizaciones: { filename: 'Certificado_Cotizaciones_RUT_Empleador.pdf', fecha_emision: '2025-11-01', rut_entidad_pagadora: '76947101-4' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 1723505, montoMax: 1723509 }],
    expectAlertSubstrings: ['parcial'],
    notes: 'Oct parcial (17 días licencia) excluido → promedio Jul/Ago/Sep = $1.723.507 (no $1.502.977 con Oct).',
  },

  // ===========================================================================
  // 8) ALEJANDRA ESPINOZA — TW Logística (Buk). Sueldo bajo (~$915k). Anticipos de
  //    Gift Card / Aguinaldo (Dic) y Extensión Benef. Sindical → ambiguos (no se suman).
  // ===========================================================================
  {
    name: 'Alejandra Espinoza',
    rut: '18738680-2',
    docs: [{
      filename: 'Liquidaciones Alejandra Espinoza.pdf',
      category: 'liquidacion_sueldo',
      source_key: '96808570-0', // TW Logística Spa
      periods: [
        liq('Octubre 2025', 909186, [D('Extensión De Benef. Sind. N°2 (Ex Cc)', 4000)], 30),
        liq('Noviembre 2025', 909186, [D('Extensión De Benef. Sind. N°2 (Ex Cc)', 4000)], 30),
        liq('Diciembre 2025', 926525, [D('Extensión De Benef. Sind. N°2 (Ex Cc)', 4000), D('Anticipo Gift Card Navidad', 37583), D('Anticipo De Aguinaldo', 90201)], 30),
      ],
    }],
    cotizaciones: { filename: 'CertificadoAfpHabitat (3).pdf', fecha_emision: '2025-12-15', rut_entidad_pagadora: '96808570-0' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 914964, montoMax: 914968 }],
    expectAlertSubstrings: ['Anticipo'],
    notes: 'Oct/Nov/Dic → $914.966. Anticipos y Extensión Sindical ambiguos (no sumados).',
  },

  // ===========================================================================
  // 9) IRENE ARÉVALO — sueldo (ECOS) + HONORARIOS (2 boletas Nov/Dic). DOS ingresos
  //    (tipo 1 + 10) CONCURRENTES. Formato con "Líquido a pagar" < "Alcance Líquido"
  //    (otros descuentos: Teleton, Compra Computador → ambiguos). Anticipo (Sep) ambiguo.
  // ===========================================================================
  {
    name: 'Irene Arévalo',
    rut: '16143425-6',
    docs: [
      {
        filename: 'liquidaciones_historicas 3 (1)_organized.pdf',
        category: 'liquidacion_sueldo',
        source_key: '76422912-6', // Environmental Compliance Services SpA
        periods: [
          liq('Septiembre 2025', 2456361, [D('Anticipo', 160000)], 30),
          liq('Octubre 2025', 2465812, [], 30),
          liq('Noviembre 2025', 2422961, [D('Descuento aporte Teleton', 10000), D('Descuentos Varios: Compra Computador', 33333)], 30),
        ],
      },
      {
        filename: 'INFORME ANUAL DE BOLETAS DE HONORARIOS ELECTRONICAS.pdf',
        category: 'honorarios',
        source_key: 'BHE_IRENE',
        periods: [
          bol('2025-11', 2300000, 333500),
          bol('2025-12', 3910000, 566950),
        ],
      },
    ],
    cotizaciones: { filename: 'rptcotizaCOTIZA-20251202072607-20705161434256.pdf', fecha_emision: '2025-12-02', rut_entidad_pagadora: '76422912-6' },
    expectedIncomes: [
      { tipoIngreso: 1, label: 'Remuneración', montoMin: 2448376, montoMax: 2448380 },
      { tipoIngreso: 10, label: 'Honorarios', montoMin: 517498, montoMax: 517502 },
    ],
    expectAlertSubstrings: ['Honorarios', 'Anticipo'],
    notes: 'Sueldo $2.448.378 + honorarios Σbruto 6.210.000/12 = $517.500. Coexistencia honorarios↔sueldo alertada.',
  },

  // ===========================================================================
  // 10) JAIME CARTES — honorarios (Abr–Jul) y LUEGO sueldo (Ago–Oct): SECUENCIAL.
  //     Oct sueldo PARCIAL (licencia 18 días, 12 trabajados → $491k) → excluido (L13).
  //     APVI en AFP → voluntario. "Hoja Resumen" es un crédito hipotecario de TERCERO
  //     (Caroline Tapia) mal archivado → NO es ingreso, se ignora.
  // ===========================================================================
  {
    name: 'Jaime Cartes',
    rut: '17596599-8',
    docs: [
      {
        filename: 'Liquidaciones Jaime Cartes.pdf',
        category: 'liquidacion_sueldo',
        source_key: '79943150-5', // Laboratorio Clínico del Norte Ltda
        periods: [
          liq('Agosto 2025', 1253170, [D('A.P.V.I. EN AFP', 70000)], 29),
          liq('Septiembre 2025', 1210767, [D('A.P.V.I. EN AFP', 70000), D('Anticipo 1', 40480)], 30),
          liq('Octubre 2025', 491120, [D('A.P.V.I. EN AFP', 70000)], 12), // licencia 18 días → PARCIAL
        ],
      },
      {
        filename: 'INFORME ANUAL DE BOLETAS DE HONORARIOS ELECTRONICAS.pdf',
        category: 'honorarios',
        source_key: 'BHE_JAIME',
        periods: [
          bol('2025-04', 640195, 92828),
          bol('2025-05', 640195, 92828),
          bol('2025-06', 640196, 92828),
          bol('2025-07', 640196, 92828),
        ],
      },
    ],
    cotizaciones: { filename: 'cotizaciones.pdf', fecha_emision: '2025-11-01', rut_entidad_pagadora: '79943150-5' },
    expectedIncomes: [
      { tipoIngreso: 1, label: 'Remuneración', montoMin: 1301967, montoMax: 1301971 },
      { tipoIngreso: 10, label: 'Honorarios', montoMin: 213397, montoMax: 213401 },
    ],
    expectAlertSubstrings: ['parcial', 'Honorarios'],
    notes: 'Sueldo Ago/Sep (Oct parcial excluido) +APVI = $1.301.969. Honorarios Σbruto 2.560.782/12 = $213.399. Hoja Resumen NO es ingreso.',
  },

  // ===========================================================================
  // 11) NOELIA LORCA — sueldo (ACAM, desde 21/07) + HONORARIOS Sep/Oct/Nov: CONCURRENTE
  //     (boletas en paralelo al empleo). DOS ingresos (tipo 1 + 10) que se suman.
  // ===========================================================================
  {
    name: 'Noelia Lorca',
    rut: '15121553-K',
    docs: [
      {
        filename: 'Liquidaciones Noelia Lorca.pdf',
        category: 'liquidacion_sueldo',
        source_key: '76772450-0', // Prestaciones Médicas e Inversiones ACAM S.A.
        periods: [
          liq('Agosto 2025', 1764282, [], 30),
          liq('Septiembre 2025', 1735343, [D('Anticipo Aguinaldo', 50000)], 30),
          liq('Octubre 2025', 1755935, [], 30),
          liq('Noviembre 2025', 1743286, [], 30),
        ],
      },
      {
        filename: 'INFORME ANUAL DE BOLETAS DE HONORARIOS ELECTRONICAS.pdf',
        category: 'honorarios',
        source_key: 'BHE_NOELIA',
        periods: [
          bol('2025-01', 350877, 50877),
          bol('2025-04', 584795, 84795),
          bol('2025-09', 877193, 127193),
          bol('2025-10', 701754, 101754),
          bol('2025-11', 1052631, 152631),
        ],
      },
    ],
    cotizaciones: { filename: 'Cotizaciones .pdf', fecha_emision: '2025-11-26', rut_entidad_pagadora: '76772450-0' },
    expectedIncomes: [
      { tipoIngreso: 1, label: 'Remuneración', montoMin: 1744853, montoMax: 1744857 },
      { tipoIngreso: 10, label: 'Honorarios', montoMin: 297269, montoMax: 297273 },
    ],
    expectAlertSubstrings: ['Honorarios'],
    notes: 'Sueldo Sep/Oct/Nov = $1.744.855 + honorarios Σbruto 3.567.250/12 = $297.271. Concurrentes → se suman.',
  },
];
