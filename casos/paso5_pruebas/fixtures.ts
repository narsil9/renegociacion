/**
 * Fixtures del Paso 5 — HECHOS hardcodeados (lo que Claude extraería de los documentos)
 * + el resultado ESPERADO (verdad-terreno del analista, ver PLAN.md).
 *
 * Fase 1 de pruebas: alimenta `computeIncomes` (capa DETERMINISTA, sin API) para verificar
 * que la estructura (líquido, promedio, multi-fuente, descuentos, subsidio) se calcula bien.
 * Fase 2 (Claude): se reemplazan estos hechos por la lectura nativa real del agente.
 *
 * Cifras verificadas contra los documentos de ~/Desktop/casos-paso5 (2026-06-29).
 * NO es código de producción — vive en casos/ (pruebas).
 */
import { ExtractedIncomeDoc, CotizacionesCertFacts } from '../../src/utils/income_extractor';

export interface ExpectedIncome {
  tipoIngreso: number;        // value del portal (1 Remuneración, 3 Licencia Médica, ...)
  label: string;
  montoMin: number;           // rango aceptable (tolerancia de redondeo)
  montoMax: number;
}

export interface Step5Fixture {
  name: string;
  rut: string;
  docs: ExtractedIncomeDoc[];
  cotizaciones: CotizacionesCertFacts | null;
  expectedIncomes: ExpectedIncome[];
  expectAlertSubstrings?: string[]; // subcadenas que DEBEN aparecer en alguna alerta
  notes?: string;
}

// Helper para evidencia auto-consistente (cita contiene el monto → no dispara claudeReadIssues).
const ev = (monto: number, label = 'Líquido a pagar') => ({
  cita_monto: `${label}: $${monto.toLocaleString('es-CL')}`,
  confidence: 0.97,
});
const liq = (period_label: string, liquido: number, deductions: { label: string; amount: number }[] = []) => ({
  period_label,
  liquido_a_pagar: liquido,
  deductions,
  evidence: ev(liquido),
});

export const FIXTURES: Step5Fixture[] = [
  // ---------------------------------------------------------------------------
  // 1) JORGE ROMERO — asalariado, 1 empleador, 0 voluntarios. Baseline.
  // ---------------------------------------------------------------------------
  {
    name: 'Jorge Romero',
    rut: '15842968-3',
    docs: [
      {
        filename: 'LIQUIDACIONES JORGE ROMERO.pdf',
        category: 'liquidacion_sueldo',
        source_key: '59212930-2', // EQUISOFT
        periods: [
          liq('Marzo 2025', 2162761, [
            { label: 'Cotizacion AFP Provida', amount: 319832 }, { label: 'Salud Banmédica', amount: 274904 },
            { label: 'Seguro de Cesantía', amount: 16760 }, { label: 'Impuesto único', amount: 59033 },
          ]),
          liq('Abril 2025', 2162042, [
            { label: 'Cotizacion AFP Provida', amount: 319832 }, { label: 'Salud Banmédica', amount: 276185 },
            { label: 'Seguro de Cesantía', amount: 16760 }, { label: 'Impuesto único', amount: 58471 },
          ]),
          liq('Mayo 2025', 2161887, [
            { label: 'Cotizacion AFP Provida', amount: 319832 }, { label: 'Salud Banmédica', amount: 276991 },
            { label: 'Seguro de Cesantía', amount: 16760 }, { label: 'Impuesto único', amount: 57820 },
          ]),
        ],
      },
    ],
    cotizaciones: { filename: 'Cotizaciones.pdf', fecha_emision: '2025-05-22', rut_entidad_pagadora: '59212930-2' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 2162225, montoMax: 2162235 }],
    notes: 'Promedio limpio de 3 liquidaciones; 0 voluntarios. Esperado $2.162.230.',
  },

  // ---------------------------------------------------------------------------
  // 2) ALEJANDRO OLGUÍN — 1 empleador; anticipos + seguro vida NO se suman (L10).
  // ---------------------------------------------------------------------------
  {
    name: 'Alejandro Olguín',
    rut: '15842976-4',
    docs: [
      {
        filename: '15842976_Falabella.pdf',
        category: 'liquidacion_sueldo',
        source_key: '77612410-9', // Falabella Tec. Corporativa
        periods: [
          liq('Marzo 2026', 2099139, [
            { label: 'Total descuentos legales', amount: 556148 },
            { label: 'Anticipos Varios', amount: 89442 },   // L10: NO se suma (devolución de anticipo)
            { label: 'Seguro Vida', amount: 4653 },          // L10: gasto real, NO se suma
          ]),
          liq('Abril 2026', 2095850, [
            { label: 'Total descuentos legales', amount: 515946 },
            { label: 'Seguro Vida', amount: 4686 },
          ]),
          liq('Mayo 2026', 1990721, [
            { label: 'Total descuentos legales', amount: 501102 },
            { label: 'Seguro Vida', amount: 4743 },
          ]),
        ],
      },
    ],
    cotizaciones: { filename: 'cotizaciones.pdf', fecha_emision: '2026-06-10', rut_entidad_pagadora: '77612410-9' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 2061900, montoMax: 2061906 }],
    expectAlertSubstrings: ['Anticipos Varios', 'Seguro Vida'],
    notes: 'Esperado $2.061.903 (líquido tal cual; anticipos y seguro vida → ambiguos, alertados, NO sumados).',
  },

  // ---------------------------------------------------------------------------
  // 3) ALEJANDRA ROMERO — 4 liquidaciones (ene-abr) → Fix1 (3 más recientes);
  //    préstamo Caja Los Andes SÍ se suma; sindicato/fam NO.
  // ---------------------------------------------------------------------------
  {
    name: 'Alejandra Romero',
    rut: '16486888-5',
    docs: [
      {
        filename: 'liq Chilexpress.pdf',
        category: 'liquidacion_sueldo',
        source_key: '96756430-3', // Chilexpress
        periods: [
          liq('Enero 2026', 2866266, [   // queda FUERA (Fix1)
            { label: 'Cuota Sindical', amount: 17248 }, { label: 'Cuota Fam Ds Trab', amount: 44620 },
            { label: 'Crédito Personal Caja Los Andes', amount: 98956 },
          ]),
          liq('Febrero 2026', 3020334, [
            { label: 'Cuota Sindical', amount: 17248 }, { label: 'Cuota Fam Ds Trab', amount: 44764 },
            { label: 'Crédito Personal Caja Los Andes', amount: 103459 },
          ]),
          liq('Marzo 2026', 2055698, [
            { label: 'Cuota Sindical', amount: 13000 }, { label: 'Cuota Fam Ds Trab', amount: 36800 },
            { label: 'Crédito Personal Caja Los Andes', amount: 211284 },
          ]),
          liq('Abril 2026', 1934871, [
            { label: 'Cuota Sindical', amount: 13000 }, { label: 'Cuota Fam Ds Trab', amount: 39707 },
            { label: 'Crédito Personal Caja Los Andes', amount: 536960 },
          ]),
        ],
      },
    ],
    cotizaciones: { filename: 'cotizaciones previsionales(1).pdf', fecha_emision: '2026-04-24', rut_entidad_pagadora: '96756430-3' },
    expectedIncomes: [{ tipoIngreso: 1, label: 'Remuneración', montoMin: 2620865, montoMax: 2620872 }],
    notes: 'Esperado $2.620.869 (feb+mar+abr, +Caja Los Andes; enero excluido). Sin Fix1 daría ~$2.7-2.8M.',
  },

  // ---------------------------------------------------------------------------
  // 4) ALEX LLANQUITRUF — DOS empleadores (se SUMAN, L9). CCAF Los Andes → voluntario.
  // ---------------------------------------------------------------------------
  {
    name: 'Alex Llanquitruf',
    rut: '13925593-3',
    docs: [
      {
        filename: 'Liq Siges.pdf',
        category: 'liquidacion_sueldo',
        source_key: '96992160-K', // Siges Chile SPA
        periods: [
          liq('Marzo 2026', 1756070, [
            { label: 'Descto. Ptmo. CCAF Los Andes', amount: 465617 },
            { label: 'Cuota Sindicato', amount: 6000 }, { label: 'Seguro BICE Vida', amount: 9813 },
            { label: 'Anticipo Bono Vacaciones', amount: 106000 },
          ]),
          liq('Abril 2026', 1764018, [
            { label: 'Descto. Ptmo. CCAF Los Andes', amount: 465617 },
            { label: 'Cuota Sindicato', amount: 6000 }, { label: 'Seguro BICE Vida', amount: 9882 },
          ]),
          liq('Mayo 2026', 1723469, [
            { label: 'Descto. Ptmo. CCAF Los Andes', amount: 527586 },
            { label: 'Cuota Sindicato', amount: 6000 }, { label: 'Seguro BICE Vida', amount: 10002 },
          ]),
        ],
      },
      {
        filename: '202605 Nutrekall.pdf',
        category: 'liquidacion_sueldo',
        source_key: '77730514-K', // Nutrekall SPA (otra fuente → NO se fusiona con Siges)
        periods: [
          liq('Marzo 2026', 440525, []), liq('Abril 2026', 440525, []), liq('Mayo 2026', 440525, []),
        ],
      },
    ],
    cotizaciones: { filename: 'CertificadoAfpHabitat-2.pdf', fecha_emision: '2026-06-24', rut_entidad_pagadora: '96992160-K' },
    expectedIncomes: [
      { tipoIngreso: 1, label: 'Remuneración (Siges, con CCAF)', montoMin: 2234120, montoMax: 2234130 },
      { tipoIngreso: 1, label: 'Remuneración (Nutrekall)', montoMin: 440523, montoMax: 440527 },
    ],
    notes: 'DOS fuentes (L9). Siges ≈$2.234.126 (CCAF sumado por keyword + alerta), Nutrekall $440.525. Total ≈$2.674.651. Retiro de sociedad NO se modela (falta cert contador + doble conteo).',
  },

  // ---------------------------------------------------------------------------
  // 5) MARÍA ELISA VARGAS — sueldo + licencia médica (subsidio fragmentado, L11).
  // ---------------------------------------------------------------------------
  {
    name: 'María Elisa Vargas',
    rut: '18464784-2',
    docs: [
      {
        filename: 'Liquidación Clínica Alemana.pdf',
        category: 'liquidacion_sueldo',
        source_key: '96770100-9', // Clínica Alemana
        periods: [
          // El campo se llama "Líquido a Cobrar" (no afecta a TS: el monto ya viene extraído).
          liq('Febrero 2026', 2395383, [
            { label: 'Aporte 2% Bienestar', amount: 65430 }, { label: 'Cta. Cte. Clinica UF', amount: 42294 },
            { label: 'Cuota Sindicato', amount: 18970 }, { label: 'Cuota Adic. Sindicato', amount: 10000 },
          ]),
          liq('Marzo 2026', 2676350, [
            { label: 'Aporte 2% Bienestar', amount: 54267 }, { label: 'Cta. Cte. Clinica UF', amount: 42348 },
            { label: 'Cuota Sindicato', amount: 18970 }, { label: 'Cuota Adic. Sindicato', amount: 10000 },
          ]),
        ],
      },
      {
        filename: 'Liquidación-de-Subsidios.pdf',
        category: 'licencia_medica',
        source_key: '96572800-7', // Banmédica (pagador del subsidio)
        periods: [
          // Pagos parciales por días, deduplicados; period_label = MES calendario cubierto.
          { period_label: '2026-03', liquido_a_pagar: 269522, evidence: ev(269522, 'Monto Líquido') },
          { period_label: '2026-03', liquido_a_pagar: 443971, evidence: ev(443971, 'Monto Líquido') },
          { period_label: '2026-04', liquido_a_pagar: 178373, evidence: ev(178373, 'Monto Líquido') },
          { period_label: '2026-04', liquido_a_pagar: 981054, evidence: ev(981054, 'Monto Líquido') },
          { period_label: '2026-04', liquido_a_pagar: 981054, evidence: ev(981054, 'Monto Líquido') }, // DUPLICADO → dedup
          { period_label: '2026-04', liquido_a_pagar: 1487963, evidence: ev(1487963, 'Monto Líquido') },
          { period_label: '2026-05', liquido_a_pagar: 350109, evidence: ev(350109, 'Monto Líquido') },
          { period_label: '2026-05', liquido_a_pagar: 1900967, evidence: ev(1900967, 'Monto Líquido') },
        ],
      },
    ],
    cotizaciones: { filename: 'IMG_7945.jpeg', fecha_emision: '2026-06-17', rut_entidad_pagadora: '96770100-9' },
    expectedIncomes: [
      { tipoIngreso: 1, label: 'Remuneración (sueldo)', montoMin: 2535860, montoMax: 2535870 },
      { tipoIngreso: 3, label: 'Licencia Médica (subsidio, mes más completo abril)', montoMin: 2647385, montoMax: 2647395 },
    ],
    expectAlertSubstrings: ['REEMPLAZA', 'duplicado'],
    notes: 'Subsidio: abril (mes íntegro) = 178373+981054+1487963 = $2.647.390; duplicado deduplicado; conflicto sueldo↔licencia alertado. Decisión final (sueldo vs licencia) = abogado.',
  },
];
