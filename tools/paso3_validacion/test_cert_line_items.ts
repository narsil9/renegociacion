/**
 * TEST de `extractCertLineItems` (no tenía ninguno propio, solo cobertura indirecta por el
 * golden de los backstops).
 *
 * El caso que importa: la línea de TOTAL GLOBAL de un certificado de liquidación tiene un
 * número de contrato de ≥7 dígitos y un monto, así que el detector de tabla la tomaba como un
 * producto más y el backstop de completitud la inyectaba ENCIMA de los productos individuales
 * → el banco completo contado dos veces (L9 / regla transversal D).
 */
import { extractCertLineItems } from '../../src/utils/cert_line_items';

let ok = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};

console.log('═══ extractCertLineItems ═══');

// --- Certificado de liquidación con 2 productos + línea de total global ---
const certLiquidacion = `
CERTIFICADO DE LIQUIDACION
Nº Operación   Producto        Monto total a Pagar
40567931       Consumo         $ 7.500.000
40567932       Consumo         $ 6.200.000
Monto total a Pagar al 17-06-2026 para poner término a todos los productos, contrato 40567938  $ 20.254.651
`;
const items = extractCertLineItems(certLiquidacion);
check('los 2 productos de la tabla se extraen',
  items.filter((i) => i.amount === 7_500_000 || i.amount === 6_200_000).length === 2,
  JSON.stringify(items.map((i) => i.amount)));
check('la línea de TOTAL GLOBAL no se emite como producto',
  !items.some((i) => i.amount === 20_254_651),
  JSON.stringify(items.map((i) => i.amount)));

// --- Etiqueta de payoff inequívoca (detector 1) ---
const certSaldo = `
Estado de cuenta
Saldo Insoluto: $ 3.362.375
Cupo autorizado: $ 5.000.000
`;
const itemsSaldo = extractCertLineItems(certSaldo);
check('"Saldo Insoluto" se extrae', itemsSaldo.some((i) => i.amount === 3_362_375),
  JSON.stringify(itemsSaldo.map((i) => i.amount)));
check('"Cupo autorizado" NO se extrae (no es deuda)', !itemsSaldo.some((i) => i.amount === 5_000_000),
  JSON.stringify(itemsSaldo.map((i) => i.amount)));

// --- Un documento cualquiera no activa el detector de tabla ---
const otroDoc = `
Comprobante de pago
Folio 40567931   Monto pagado $ 1.000.000
`;
check('sin encabezado de certificado de liquidación no se emiten filas de tabla',
  !extractCertLineItems(otroDoc).some((i) => i.label === 'tabla-portabilidad'));

console.log(`\n${fail === 0 ? '✅' : '❌'} extractCertLineItems: ${ok} OK, ${fail} fallos.`);
if (fail > 0) process.exit(1);
