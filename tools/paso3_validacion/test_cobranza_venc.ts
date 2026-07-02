/**
 * TEST (L47 + Parte B) — el VENCIMIENTO de un aviso de COBRANZA se transfiere a la MISMA deuda de
 * otro documento (mismo monto exacto): cert formal trae el monto (sin fecha) + cobranza trae el venc
 * → UNA fila con monto+venc (Art.260), sin duplicar. G2-safe: no fusiona montos distintos ni docs no
 * relacionados. Testigo: La Polar de Yasmín (cert Inversiones LP + correo de cobranza 01/12/2025).
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_cobranza_venc.ts
 */
import { assembleRawFromDocFacts, DocFacts, isCollectionNotice } from '../../src/utils/sentinel_per_doc';

const TODAY = '2026-07-02';
const cmf = { ufValueCLP: 40000, creditors: [] as any[] };
const noop = { log: (_: string) => {}, error: (_: string) => {} };
let ok = 0, fail = 0;
const check = (n: string, c: boolean, d = '') => { c ? (ok++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`)); };
const P = (monto: number, etiqueta: string, fecha?: string) => ({
  monto, etiqueta_monto: etiqueta, moneda: 'CLP' as const, fecha_mora: fecha,
  cita_monto: `${etiqueta} $${monto}`, cita_fecha: fecha ? `último pago ${fecha}` : undefined, confidence: 0.9,
});

console.log('═══ isCollectionNotice + Parte B (cobranza aporta venc, no duplica) ═══');

// isCollectionNotice
check('detecta "202 días de mora"', isCollectionNotice('...tiene a la fecha 202 días de mora...') === true);
check('detecta "deuda castigada"', isCollectionNotice('presenta deuda castigada') === true);
check('estado de cuenta normal (solo "Fecha último Pago") NO es cobranza', isCollectionNotice('Fecha último Pago 05/06/2026 Cargo Moratorio') === false);

// 1) La Polar: cert (monto, sin fecha, RUT) + cobranza (mismo monto, con fecha) → 1 fila, 260
{
  const facts: DocFacts[] = [
    { filename: 'cert.pdf', institucion_asignada: 'Inversiones LP S.A.', doc_type: 'estado_cuenta', rut_emisor: '76265724-4', es_cobranza: true, productos: [P(2_364_308, 'MONTO TOTAL DEUDA CASTIGADA')] },
    { filename: 'gmail.pdf', institucion_asignada: 'Empresas La Polar S.A.', doc_type: 'otro', es_cobranza: true, productos: [P(2_364_308, 'deuda castigada', '2025-12-01')] },
  ];
  const add = (assembleRawFromDocFacts(facts, cmf, [], '18424396-2', TODAY, noop).additionalCreditors ?? []);
  check('La Polar: UNA sola fila (no duplica)', add.length === 1, `got ${add.length}`);
  check('La Polar: conserva Inversiones LP (RUT)', /inversiones lp/i.test(add[0]?.institucion_cmf ?? ''));
  check('La Polar: Art.260 (venc del Gmail)', add[0]?.categoria_articulo === 260, `got ${add[0]?.categoria_articulo}`);
  check('La Polar: venc = 2025-12-01', add[0]?.delinquency_start_date === '2025-12-01', `got ${add[0]?.delinquency_start_date}`);
}

// 2) NEGATIVO — dos productos mismo monto, uno con fecha, PERO ninguno es cobranza → NO fusiona
{
  const facts: DocFacts[] = [
    { filename: 'a.pdf', institucion_asignada: 'Fintech A', doc_type: 'estado_cuenta', es_cobranza: false, productos: [P(500_000, 'Saldo Insoluto')] },
    { filename: 'b.pdf', institucion_asignada: 'Fintech B', doc_type: 'estado_cuenta', es_cobranza: false, productos: [P(500_000, 'Saldo Insoluto', '2026-01-10')] },
  ];
  const add = (assembleRawFromDocFacts(facts, cmf, [], '1-9', TODAY, noop).additionalCreditors ?? []);
  check('no-cobranza mismo monto → 2 filas (no fusiona)', add.length === 2, `got ${add.length}`);
}

// 3) NEGATIVO — cobranza cuyo monto no matchea nada → se declara igual (no se pierde deuda, G2)
{
  const facts: DocFacts[] = [
    { filename: 'c.pdf', institucion_asignada: 'X S.A.', doc_type: 'otro', es_cobranza: true, productos: [P(123_456, 'deuda castigada', '2025-10-01')] },
  ];
  const add = (assembleRawFromDocFacts(facts, cmf, [], '1-9', TODAY, noop).additionalCreditors ?? []);
  check('cobranza sola (sin match) → se declara igual', add.length === 1, `got ${add.length}`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} cobranza/venc: ${ok} OK, ${fail} fallos.`);
process.exit(fail === 0 ? 0 : 1);
