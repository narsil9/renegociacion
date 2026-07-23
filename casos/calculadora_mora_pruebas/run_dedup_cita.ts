/**
 * Prueba SINTÉTICA (sin PII) del Fix A: la dedup por Nº de operación (`byOp` en
 * `assembleRawFromDocFacts`) debe heredar `cita_fecha` junto con `fecha_mora` cuando el
 * documento GANADOR (mayor docTypeScore) no trae fecha propia.
 *
 * Escenario: MISMO banco + MISMA operación en dos documentos —
 *   - A: `estado_cuenta` con `fecha_mora` + `cita_fecha` (estilo calculadora de mora).
 *   - B: `liquidacion_payoff` (docTypeScore mayor → gana la dedup) SIN fecha.
 * Sin el fix, B gana pero se queda sin `cita_fecha` → `citaCorroboratesVenc` no corrobora →
 * el producto cae a Art. 261. Con el fix, la cita viaja con la fecha → corrobora → Art. 260.
 *
 * Datos 100% sintéticos: banco "Banco Demo", operación "99999999", montos redondos.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/calculadora_mora_pruebas/run_dedup_cita.ts
 */
import { assembleRawFromDocFacts, DocFacts } from '../../src/utils/sentinel_per_doc';

const TODAY = '2026-07-23';
const CLIENT_RUT = '11111111-1';

const cmf = {
  creditors: [
    { institucion: 'Banco Demo', tipoCredito: 'Tarjeta de Crédito', totalCredito: 1_000_000, overdue90Days: 0 },
  ],
  ufValueCLP: 39_000,
};

function docFacts(): DocFacts[] {
  return [
    {
      // A: estado_cuenta (docTypeScore 1) — trae fecha_mora + cita_fecha (estilo calculadora).
      filename: 'DEMO - Banco Demo - estado de cuenta (sintetico).pdf',
      institucion_asignada: 'Banco Demo',
      doc_type: 'estado_cuenta',
      productos: [{
        operacion: '99999999', monto: 1_000_000, etiqueta_monto: 'Costo Monetario Prepago',
        moneda: 'CLP', product_type: 'tarjeta_credito',
        fecha_mora: '2026-02-05',
        cita_fecha: '05/02/2026 — inicio de mora (calculadora Ley 20.720, 168 días de mora al análisis)',
        cita_monto: 'Costo Monetario Prepago (sintético) $1.000.000', confidence: 0.95,
      }],
    },
    {
      // B: liquidacion_payoff (docTypeScore 3) — gana la dedup por operación, SIN fecha.
      filename: 'DEMO - Banco Demo - liquidacion payoff (sintetico).pdf',
      institucion_asignada: 'Banco Demo',
      doc_type: 'liquidacion_payoff',
      productos: [{
        operacion: '99999999', monto: 1_000_000, etiqueta_monto: 'Monto total a Pagar',
        moneda: 'CLP', product_type: 'tarjeta_credito',
        cita_monto: 'Monto total a Pagar (sintético) $1.000.000', confidence: 0.95,
      }],
    },
  ];
}

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m' };
type Raw = { cmf260DirectOverrides: any[]; reclassifiedCreditors: any[]; identified261Creditors: any[] };

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => { console.log(`  ${cond ? C.green + '✓' : C.red + '✗'}${C.reset} ${msg}`); if (!cond) fails.push(msg); };

function main() {
  const raw = assembleRawFromDocFacts(docFacts(), cmf as any, [], CLIENT_RUT, TODAY) as Raw;
  const en260 = [...raw.cmf260DirectOverrides, ...raw.reclassifiedCreditors].filter((x) => /banco demo/i.test(x.institucion_cmf ?? ''));
  const en261 = raw.identified261Creditors.filter((x) => /banco demo/i.test(x.institucion_cmf ?? ''));

  console.log(`\n${C.bold}━━━ Dedup por operación conserva cita_fecha (Fix A) ━━━${C.reset}`);
  console.log(`  ${C.dim}en 260: ${JSON.stringify(en260)}${C.reset}`);
  console.log(`  ${C.dim}en 261: ${JSON.stringify(en261)}${C.reset}`);
  ok(en260.length === 1, 'Banco Demo (op 99999999) aparece en Art. 260 (cmf260DirectOverrides o reclassifiedCreditors)');
  ok(en261.length === 0, 'Banco Demo NO aparece en Art. 261 (identified261Creditors)');

  console.log('');
  if (fails.length) { console.log(`${C.red}${C.bold}✗ FALLARON ${fails.length}${C.reset}`); process.exit(1); }
  console.log(`${C.green}${C.bold}✓ PASS — la cita_fecha sobrevivió a la dedup por operación y corrobora el vencimiento${C.reset}`);
}

main();
