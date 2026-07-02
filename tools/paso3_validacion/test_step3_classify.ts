/**
 * TEST de la CLASIFICACIÓN PURA de step3 (`planStep3Rows`) — sin Playwright, sin API.
 * Corre con el OUTPUT YA OBTENIDO del Centinela/ensamblador para Alfonso (3 override + 6 id261 +
 * 9 filas CMF) y comprueba que step3 declara 3×260 + 6×261 = 9, montos de cert, SIN doble conteo.
 * Más casos sintéticos: multiproducto-261, single-id261 mapeado, y el fallback CMF.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_step3_classify.ts
 */
import { planStep3Rows, ClassifyInput } from '../../src/automation/step3_classify';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const montos = (rows: any[], art: number) => rows.filter((r) => r.art === art).map((r) => r.monto).sort((a, b) => a - b);

console.log('═══ planStep3Rows ═══');

// 1) ALFONSO (output real obtenido): 3 override BdCh (260) + 6 id261 (5 BCI + BdCh $1.149)
{
  const BdCh = 'Banco de Chile', BCI = 'Banco de Crédito e Inversiones';
  const input: ClassifyInput = {
    creditors: [
      { institucion: BCI, tipoCredito: 'Consumo', overdue90Days: 196591, totalCredito: 6637431 },
      { institucion: BCI, tipoCredito: 'Consumo', overdue90Days: 207489, totalCredito: 6542443 },
      { institucion: BdCh, tipoCredito: 'Consumo', overdue90Days: 460272, totalCredito: 18386124 },
      { institucion: BCI, tipoCredito: 'Tarjeta de crédito', overdue90Days: 3631797, totalCredito: 3631797 },
      { institucion: BdCh, tipoCredito: 'Tarjeta de crédito', overdue90Days: 7385844, totalCredito: 7385844 },
      { institucion: BdCh, tipoCredito: 'Tarjeta de crédito', overdue90Days: 5357817, totalCredito: 5357817 },
      { institucion: BCI, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 100834 },
      { institucion: BCI, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 2938656 },
      { institucion: BdCh, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 1000 },
    ],
    overrides: [
      { institucion_cmf: BdCh, monto_clp: 18613834, fecha_vencimiento: '2026-03-05' },
      { institucion_cmf: BdCh, monto_clp: 7896713, fecha_vencimiento: '2026-03-12' },
      { institucion_cmf: BdCh, monto_clp: 5803388, fecha_vencimiento: '2026-03-05' },
    ],
    id261: [
      { institucion_cmf: BCI, total_credito_clp: 6506053 },
      { institucion_cmf: BCI, total_credito_clp: 6581491 },
      { institucion_cmf: BCI, total_credito_clp: 3047485 },
      { institucion_cmf: BCI, total_credito_clp: 199293 },
      { institucion_cmf: BCI, total_credito_clp: 3920329 },
      { institucion_cmf: BdCh, total_credito_clp: 1149 },
    ],
  };
  const rows = planStep3Rows(input);
  check('Alfonso: total 9 filas', rows.length === 9, `got ${rows.length}`);
  check('Alfonso: 3 en 260', rows.filter((r) => r.art === 260).length === 3, `got ${rows.filter((r) => r.art === 260).length}`);
  check('Alfonso: 6 en 261', rows.filter((r) => r.art === 261).length === 6, `got ${rows.filter((r) => r.art === 261).length}`);
  check('Alfonso: 260 = payoff BdCh {5.8M,7.9M,18.6M}', JSON.stringify(montos(rows, 260)) === JSON.stringify([5803388, 7896713, 18613834]));
  check('Alfonso: 261 = cert {1149,199293,3047485,3920329,6506053,6581491}', JSON.stringify(montos(rows, 261)) === JSON.stringify([1149, 199293, 3047485, 3920329, 6506053, 6581491]), JSON.stringify(montos(rows, 261)));
  // Anti doble-conteo: los montos del CMF de los consumos/tarjeta BCI NO deben aparecer
  const declaredMontos = rows.map((r) => r.monto);
  check('Alfonso: SIN doble conteo (no aparecen montos CMF de BCI 6.637.431/6.542.443/3.631.797)',
    ![6637431, 6542443, 3631797].some((m) => declaredMontos.includes(m)), JSON.stringify(declaredMontos));
  check('Alfonso: los 3 de 260 llevan fecha de vencimiento', rows.filter((r) => r.art === 260).every((r) => !!r.fechaVenc));
}

// 2) Multiproducto-261 sintético: 5 id261 vs 2 al-día + 3 90+d → 5×261, 0×260, filas CMF saltadas
{
  const B = 'Banco X';
  const rows = planStep3Rows({
    creditors: [
      { institucion: B, tipoCredito: 'Consumo', overdue90Days: 100, totalCredito: 5000000 },
      { institucion: B, tipoCredito: 'Consumo', overdue90Days: 100, totalCredito: 4000000 },
      { institucion: B, tipoCredito: 'Tarjeta', overdue90Days: 100, totalCredito: 3000000 },
      { institucion: B, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 100000 },
      { institucion: B, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 200000 },
    ],
    id261: [
      { institucion_cmf: B, total_credito_clp: 5100000 }, { institucion_cmf: B, total_credito_clp: 4100000 },
      { institucion_cmf: B, total_credito_clp: 3100000 }, { institucion_cmf: B, total_credito_clp: 110000 },
      { institucion_cmf: B, total_credito_clp: 210000 },
    ],
  });
  check('multiproducto-261: 5 filas, todas 261', rows.length === 5 && rows.every((r) => r.art === 261), `len=${rows.length}`);
  check('multiproducto-261: montos de cert (no CMF)', JSON.stringify(montos(rows, 261)) === JSON.stringify([110000, 210000, 3100000, 4100000, 5100000]));
}

// 3) single id261 mapeado a fila al-día (patrón BdCh $1.149) → 261 al monto del cert
{
  const B = 'Banco Y';
  const rows = planStep3Rows({
    creditors: [{ institucion: B, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 1000 }],
    id261: [{ institucion_cmf: B, total_credito_clp: 1149 }],
  });
  check('single id261: 1 fila 261 al monto de cert (1149)', rows.length === 1 && rows[0].art === 261 && rows[0].monto === 1149, JSON.stringify(rows));
}

// 4) fallback CMF: banco 90+d sin doc → main loop, degrada a 261 (la ejecución luego filtra no-doc)
{
  const B = 'Banco Z';
  const rows = planStep3Rows({ creditors: [{ institucion: B, tipoCredito: 'Consumo', overdue90Days: 500000, totalCredito: 5000000 }] });
  check('fallback CMF sin doc: 1 fila, source=cmf, degradada a 261', rows.length === 1 && rows[0].source === 'cmf' && rows[0].art === 261, JSON.stringify(rows));
}

// 5) CRISTIAN con su CMF REAL (13 filas) + output REAL del LLM (corrida en vivo 2026-07-01).
//    Anti doble-conteo de una fila 90+d cuyo payoff está en id261 (Santander consumo: CMF
//    $6.891.901 90+d / payoff $6.985.718). fillStep3 salta las al-día sin cert (Gate I2) → aquí
//    se cuentan las filas con respaldo (source != 'cmf'), que deben ser las 10 de la abogada.
{
  const BE = 'Banco del Estado de Chile', SAN = 'Banco Santander-Chile', CCAF = 'Caja de Compensación de Asignación Familiar Los Andes', CMR = 'Promotora CMR Falabella S.A.', TGR = 'Tesorería General de la República';
  const rows = planStep3Rows({
    creditors: [
      { institucion: BE, tipoCredito: 'Comercial', overdue90Days: 0, totalCredito: 136916555 },
      { institucion: CCAF, tipoCredito: 'Consumo', overdue90Days: 0, totalCredito: 1227754 },
      { institucion: SAN, tipoCredito: 'Consumo', overdue90Days: 311284, totalCredito: 6891901 }, // 90+d, payoff en id261
      { institucion: BE, tipoCredito: 'Consumo', overdue90Days: 0, totalCredito: 5456635 },
      { institucion: CCAF, tipoCredito: 'Consumo', overdue90Days: 0, totalCredito: 973492 },
      { institucion: SAN, tipoCredito: 'Tarjeta de crédito', overdue90Days: 0, totalCredito: 2472 },
      { institucion: BE, tipoCredito: 'Tarjeta de crédito', overdue90Days: 0, totalCredito: 69741 },
      { institucion: BE, tipoCredito: 'Tarjeta de crédito', overdue90Days: 0, totalCredito: 338248 },
      { institucion: CMR, tipoCredito: 'Tarjeta de crédito', overdue90Days: 76931, totalCredito: 4157931 }, // 90+d, multiproducto-261
      { institucion: BE, tipoCredito: 'Tarjeta de crédito', overdue90Days: 0, totalCredito: 13373 },
      { institucion: SAN, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 71636 },
      { institucion: SAN, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 200000 },
      { institucion: BE, tipoCredito: 'Linea de Crédito', overdue90Days: 0, totalCredito: 169556 },
    ],
    id261: [
      { institucion_cmf: BE, total_credito_clp: 138932112 }, { institucion_cmf: CCAF, total_credito_clp: 1277090 },
      { institucion_cmf: SAN, total_credito_clp: 6985718 }, { institucion_cmf: BE, total_credito_clp: 5884108 },
      { institucion_cmf: CCAF, total_credito_clp: 991129 }, { institucion_cmf: SAN, total_credito_clp: 2444 },
      { institucion_cmf: BE, total_credito_clp: 149485 }, { institucion_cmf: CMR, total_credito_clp: 4168214 },
    ],
    additional: [
      { bank: TGR, institucion_cmf: TGR, total_credito_clp: 18537, categoria_articulo: 261 },
      { bank: TGR, institucion_cmf: TGR, total_credito_clp: 19049, categoria_articulo: 261 },
    ],
  });
  const declarados = rows.filter((r) => r.source !== 'cmf'); // fillStep3 salta las 'cmf' al-día sin cert (Gate I2)
  const montos = declarados.map((r) => r.monto);
  check('Cristian real: 10 filas con respaldo (= abogada)', declarados.length === 10, `got ${declarados.length}: ${JSON.stringify(montos)}`);
  check('Cristian real: SIN doble conteo Santander (no aparece $6.891.901)', !rows.some((r) => r.monto === 6891901), JSON.stringify(rows.filter((r) => /santander/i.test(r.institucion)).map((r) => r.monto)));
  check('Cristian real: Santander payoff $6.985.718 declarado (fila 90+d reclamada por id261)', declarados.some((r) => r.monto === 6985718));
  const san = declarados.filter((r) => /santander/i.test(r.institucion));
  check('Cristian real: Santander = 2 filas declaradas ($6.985.718 + $2.444)', san.length === 2 && san.some((r) => r.monto === 2444), JSON.stringify(san.map((r) => r.monto)));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} planStep3Rows: ${ok} OK, ${fail} fallos.`);
process.exit(fail === 0 ? 0 : 1);
