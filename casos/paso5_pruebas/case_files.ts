/**
 * Rutas REALES de los documentos de ingreso de cada caso (lote ~/Desktop/casos-paso5),
 * para la Fase 2 (lectura nativa por Claude). El nombre del caso coincide con `Step5Fixture.name`
 * (fixtures.ts) para poder comparar la lectura real contra el esperado del analista.
 *
 * NO es producción (vive en casos/). Verificado con `ls` el 2026-06-29.
 */
import { IncomeDocInput } from '../../src/agents/ingresos_agent';

const BASE = '/Users/patomartini/Desktop/casos-paso5';
// OJO: 3 carpetas tienen un ESPACIO INICIAL en el nombre.
const D_JORGE = `${BASE}/JORGE ANDRES ROMERO MANUGUIAN`;
const D_ALEJANDRO = `${BASE}/Alejandro Andres Olguin Delgado - 15842976-4 -- Renegociacion`;
const D_ALEJANDRA = `${BASE}/ ALEJANDRA ORFILIA ROMERO MOYA - 16486888-5 -- Renegociacion`;
const D_ALEX = `${BASE}/ Alex Llanquitruf Painiqueo - 13925593-3 -- Renegociacion`;
const D_MARIA = `${BASE}/ María Elisa Vargas Bastidas - 18464784-2 -- Renegociacion`;

const f = (localPath: string): IncomeDocInput => ({ filename: localPath.split('/').pop()!, localPath });

/** Documentos de ingreso (liquidaciones/subsidios/boletas + cert de cotizaciones) por caso. */
export const CASE_DOCS: Record<string, IncomeDocInput[]> = {
  'Jorge Romero': [
    f(`${D_JORGE}/Ingresos/Contrato de trabajo o últimas 3 liquidaciones de sueldo/LIQUIDACIONES JORGE ROMERO.pdf`),
    f(`${D_JORGE}/Ingresos/Certificado de cotizaciones previsionales (12 meses)/Cotizaciones.pdf`),
  ],
  'Alejandro Olguín': [
    f(`${D_ALEJANDRO}/Ingresos/Contrato de Trabajo/15842976_20260331 (1).pdf`),
    f(`${D_ALEJANDRO}/Ingresos/Contrato de Trabajo/15842976_20260430.pdf`),
    f(`${D_ALEJANDRO}/Ingresos/Contrato de Trabajo/15842976_20260531.pdf`),
    f(`${D_ALEJANDRO}/Ingresos/Certificado de cotizaciones previsionales (12 meses)/cotizaciones.pdf`),
    // (Captura SII NO se incluye: es respaldo cruzado, no es el cert ni un ingreso.)
  ],
  'Alejandra Romero': [
    f(`${D_ALEJANDRA}/Ingresos/Contrato de Trabajo/liq enero 26.pdf`),
    f(`${D_ALEJANDRA}/Ingresos/Contrato de Trabajo/liq febrero 26.pdf`),
    f(`${D_ALEJANDRA}/Ingresos/Contrato de Trabajo/liq marzo 26.pdf`),
    f(`${D_ALEJANDRA}/Ingresos/Contrato de Trabajo/Liq abril 26.pdf`),
    f(`${D_ALEJANDRA}/Ingresos/Certificado de cotizaciones previsionales (12 meses)/cotizaciones  previsionales(1).pdf`),
  ],
  'Alex Llanquitruf': [
    // Siges Chile SPA
    f(`${D_ALEX}/Ingresos/Liq marzo.pdf`),
    f(`${D_ALEX}/Ingresos/Liq abril.pdf`),
    f(`${D_ALEX}/Ingresos/Liq mayo.pdf`),
    // Nutrekall SPA (su sociedad)
    f(`${D_ALEX}/Ingresos/202603 - ALEX ABEL LLANQUITRUF PAINIQUEO.pdf`),
    f(`${D_ALEX}/Ingresos/202604 - ALEX ABEL LLANQUITRUF PAINIQUEO.pdf`),
    f(`${D_ALEX}/Ingresos/202605 - ALEX ABEL LLANQUITRUF PAINIQUEO.pdf`),
    f(`${D_ALEX}/Ingresos/CertificadoAfpHabitat-2.pdf`),
    // (Retiro de sociedad .docx NO se incluye: no se lee nativo + decisión del abogado.)
  ],
  'María Elisa Vargas': (() => {
    const dir = `${D_MARIA}/Documentos solicitados/Liquidaciones, Licencia y cotizaciones`;
    const subsidios = Array.from({ length: 9 }, (_, i) => f(`${dir}/Liquidación-de-Subsidios ${i + 1}.pdf`));
    return [
      f(`${dir}/Liquidación febrero.pdf`),
      f(`${dir}/Liquidación marzo.pdf`),
      ...subsidios, // incluye duplicados (3,7,8) a propósito → prueba el dedup de TS
      f(`${dir}/IMG_7945.jpeg`), // cert cotizaciones (imagen, 2 partes)
      f(`${dir}/IMG_7946.jpeg`),
    ];
  })(),
};
