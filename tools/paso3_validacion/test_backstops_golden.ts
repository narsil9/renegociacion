/**
 * GOLDEN TEST de la cadena determinista `applyDeterministicBackstops` (sin API).
 *
 * Habilitado por el refactor (Parte A): la cadena de backstops + validación anti-error vive ahora
 * en src/utils/sentinel_backstops.ts como función PURA → testeable con `raw` sintético, sin LLM.
 * Inyecta entradas controladas por backstop y asierta la salida EXACTA (5 listas + claudeReadIssues).
 * Si el refactor (o un cambio futuro) altera el comportamiento, estos asserts lo detectan.
 *
 * Backstops cubiertos: reconciliación additional→id261, completitud (extractCertLineItems),
 * gate 260→261 + rescate-por-chat, y la validación anti-error (Capas 1/2: auto-cita, RUT,
 * confianza, moneda, dedup por nº de operación).
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_backstops_golden.ts
 */
import { applyDeterministicBackstops } from '../../src/utils/sentinel_backstops';
import { AcreedorCatalogEntry } from '../../src/utils/acreedor_matcher';

const TODAY = new Date('2026-06-29T00:00:00');
const silent = () => {};

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function emptyRaw(): any {
  return {
    success: true, errors: [],
    reclassifiedCreditors: [], identified261Creditors: [], additionalCreditors: [],
    cmf260DirectOverrides: [], deReclassified261Creditors: [], fechasClave: [],
    details: { meets90DaysRequirement: true, meetsAmountRequirement: true, totalAmountCLP: 0, creditorsWith90DaysCount: 0, documentsAgeValid: true, requiredCertificatesPresent: true },
  };
}
function mkCat(nombre: string, rut: string): AcreedorCatalogEntry {
  return { id: 1, nombre, nombre_normalizado: nombre.toLowerCase(), tipo: null, rut, direccion: null, comuna: null, email: null, telefono: null, representante_legal: null, rut_representante: null, activo: true };
}
async function run(raw: any, ctx: Partial<{ cmfCreditors: any[]; documents: any[]; certificateAnalyses: any[]; catalog: AcreedorCatalogEntry[]; clientRut: string | null }>) {
  return applyDeterministicBackstops(raw, {
    cmfCreditors: (ctx.cmfCreditors ?? []) as any,
    documents: (ctx.documents ?? []) as any,
    certificateAnalyses: ctx.certificateAnalyses ?? [],
    catalog: ctx.catalog ?? [],
    clientRut: ctx.clientRut ?? '11111111-1',
    todayDate: TODAY,
  }, silent);
}

(async () => {
  // ── G1: reconciliación additional→id261 (anti doble conteo) ──
  console.log('═══ G1 — reconciliación additional→id261 ═══');
  {
    const raw = emptyRaw();
    raw.additionalCreditors = [
      { bank: 'Banco X', institucion_cmf: 'Banco X', product_type: 'tarjeta_credito', categoria_articulo: 261, total_credito_clp: 1_000_000, reason: 'LLM lo puso NO-CMF', document_filename: 'x.pdf', needs_lawyer_confirmation: true },
      { bank: 'TGR', institucion_cmf: 'Tesorería General de la República', product_type: 'otro', categoria_articulo: 261, total_credito_clp: 18_000, reason: 'NO-CMF genuino', document_filename: 'tgr.pdf', needs_lawyer_confirmation: true },
    ];
    const { result } = await run(raw, { cmfCreditors: [{ institucion: 'Banco X', tipoCredito: 'Tarjeta de crédito', totalCredito: 1_100_000, overdue90Days: 0 }] });
    check('Banco X (cercano a fila CMF sin reclamar) → movido a id261', result.identified261Creditors.length === 1 && result.identified261Creditors[0].institucion_cmf === 'Banco X');
    check('TGR (NO-CMF genuino) → permanece en additional', result.additionalCreditors.length === 1 && result.additionalCreditors[0].institucion_cmf.includes('Tesorería'));
  }

  // ── G2: completitud (extractCertLineItems agrega lo que el LLM omitió) ──
  console.log('═══ G2 — completitud vía extractCertLineItems ═══');
  {
    // G2a: hay slot CMF libre → override/id261
    const raw = emptyRaw();
    const { result } = await run(raw, {
      cmfCreditors: [{ institucion: 'Banco del Estado de Chile', tipoCredito: 'Consumo', totalCredito: 400_000, overdue90Days: 0 }],
      documents: [{ filename: 'be.pdf', institucion_cmf: 'Banco del Estado de Chile', isImageDoc: false, textContent: 'Certificado de deuda. Saldo Insoluto: $389.848 al día de hoy.' }],
    });
    const hit = result.identified261Creditors.find((r: any) => r.total_credito_clp === 389_848);
    check('cert con ítem omitido (slot CMF libre) → +id261 $389.848', !!hit, `id261=${JSON.stringify(result.identified261Creditors.map((r:any)=>r.total_credito_clp))}`);
  }
  {
    // G2b: sin slot CMF libre (fila ya reclamada) → producto solo-en-cert va a additional (NO-CMF)
    const raw = emptyRaw();
    raw.identified261Creditors = [{ bank: 'Banco Z', product_type: 'otro', institucion_cmf: 'Banco Z', total_credito_clp: 10_000_000, reason: 'ya reclamado', document_filename: 'z.pdf' }];
    const { result } = await run(raw, {
      cmfCreditors: [{ institucion: 'Banco Z', tipoCredito: 'Consumo', totalCredito: 10_000_000, overdue90Days: 0 }],
      documents: [{ filename: 'z.pdf', institucion_cmf: 'Banco Z', isImageDoc: false, textContent: 'Saldo Insoluto: $10.000.000\nSaldo Deuda cuenta corriente: $1.234.567' }],
    });
    const extra = result.additionalCreditors.find((a: any) => a.total_credito_clp === 1_234_567);
    check('cert con producto solo-en-cert (sin slot) → +additional NO-CMF $1.234.567', !!extra, `additional=${JSON.stringify(result.additionalCreditors.map((a:any)=>a.total_credito_clp))}`);
  }

  // ── G3: gate 260→261 + rescate-por-chat ──
  console.log('═══ G3 — gate 260→261 + rescate-chat ═══');
  {
    // G3a: 90+d sin vencimiento acreditable (ni cert ni chat) → degrada a 261
    const raw = emptyRaw();
    const { result } = await run(raw, { cmfCreditors: [{ institucion: 'Banco Mora', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 5_000_000 }] });
    check('90+d sin vencimiento → degradado (deReclassified + id261)', result.deReclassified261Creditors.length === 1 && result.identified261Creditors.length === 1);
  }
  {
    // G3b: chat con "120 días de mora" → rescate a 260 con vencimiento estimado (no degrada)
    const raw = emptyRaw();
    const { result } = await run(raw, {
      cmfCreditors: [{ institucion: 'Banco Falabella', tipoCredito: 'Tarjeta de crédito', totalCredito: 2_000_000, overdue90Days: 2_000_000 }],
      documents: [{ filename: 'chat_falabella.txt', isImageDoc: false, textContent: 'Cliente Banco Falabella: registra 120 días de mora al 15/06/2026.' }],
    });
    check('chat con 120 días → rescate a 260 (override con fecha)', result.cmf260DirectOverrides.length === 1 && !!result.cmf260DirectOverrides[0].fecha_vencimiento);
    check('chat-rescate NO degrada (deReclassified vacío)', result.deReclassified261Creditors.length === 0);
  }

  // ── G4: validación anti-error (Capas 1/2) → claudeReadIssues ──
  console.log('═══ G4 — validación anti-error (claudeReadIssues) ═══');
  {
    const raw = emptyRaw();
    raw.additionalCreditors = [
      // monto NO aparece en la cita → monto_sin_respaldo_en_cita
      { bank: 'Banco Falabella', institucion_cmf: 'Banco Falabella', product_type: 'otro', categoria_articulo: 261, total_credito_clp: 1_000_000, reason: '', document_filename: 'a.pdf', needs_lawyer_confirmation: true, evidence: { cita_monto: 'saldo cero pesos', moneda: 'CLP', confidence: 0.95 } },
      // RUT del emisor pertenece a otra institución → rut_no_coincide
      { bank: 'Banco Falabella', institucion_cmf: 'Banco Falabella', product_type: 'otro', categoria_articulo: 261, total_credito_clp: 2_000_000, reason: '', document_filename: 'b.pdf', needs_lawyer_confirmation: true, evidence: { rut_emisor: '99999999-9', cita_monto: '$2.000.000', moneda: 'CLP', confidence: 0.95 } },
      // confianza < 0.70 → baja_confianza
      { bank: 'Banco Conf', institucion_cmf: 'Banco Conf', product_type: 'otro', categoria_articulo: 261, total_credito_clp: 3_000_000, reason: '', document_filename: 'c.pdf', needs_lawyer_confirmation: true, evidence: { cita_monto: '$3.000.000', moneda: 'CLP', confidence: 0.50 } },
      // moneda CLP pero el documento está en UF → moneda_inconsistente
      { bank: 'Banco Mon', institucion_cmf: 'Banco Mon', product_type: 'otro', categoria_articulo: 261, total_credito_clp: 4_000_000, reason: '', document_filename: 'uf.pdf', needs_lawyer_confirmation: true, evidence: { cita_monto: '$4.000.000', moneda: 'CLP', confidence: 0.95 } },
      // dos veces el mismo nº de operación (normalizado) → posible_duplicado
      { bank: 'Banco Dup', institucion_cmf: 'Banco Dup', product_type: 'otro', categoria_articulo: 261, total_credito_clp: 5_000_000, reason: '', document_filename: 'd1.pdf', needs_lawyer_confirmation: true, evidence: { numero_operacion: '5546-1234-9558', cita_monto: '$5.000.000', moneda: 'CLP', confidence: 0.95 } },
      { bank: 'Banco Dup', institucion_cmf: 'Banco Dup', product_type: 'otro', categoria_articulo: 261, total_credito_clp: 5_000_000, reason: '', document_filename: 'd2.pdf', needs_lawyer_confirmation: true, evidence: { numero_operacion: '55461234 9558', cita_monto: '$5.000.000', moneda: 'CLP', confidence: 0.95 } },
    ];
    const { result, claudeReadIssues } = await run(raw, {
      catalog: [mkCat('Banco Otro', '99999999-9')],
      documents: [{ filename: 'uf.pdf', isImageDoc: false, textContent: 'Saldo del Crédito (UF): 1.234,567 — expresado en unidad de fomento.' }],
    });
    const tipos = new Set(claudeReadIssues.map((i: any) => i.tipo));
    check('detecta monto_sin_respaldo_en_cita', tipos.has('monto_sin_respaldo_en_cita'), [...tipos].join(','));
    check('detecta rut_no_coincide', tipos.has('rut_no_coincide'), [...tipos].join(','));
    check('detecta baja_confianza', tipos.has('baja_confianza'), [...tipos].join(','));
    check('detecta moneda_inconsistente', tipos.has('moneda_inconsistente'), [...tipos].join(','));
    check('detecta posible_duplicado', tipos.has('posible_duplicado'), [...tipos].join(','));
    check('claudeReadIssues propagado a result.claudeReadIssues', (result.claudeReadIssues?.length ?? 0) === claudeReadIssues.length);
  }

  // ── G0: raw realista limpio → sin transformación espuria ni issues ──
  console.log('═══ G0 — raw limpio (sin cambios espurios) ═══');
  {
    const raw = emptyRaw();
    raw.cmf260DirectOverrides = [{ institucion_cmf: 'Banco Limpio', monto_clp: 5_000_000, fecha_vencimiento: '2026-01-01', document_filename: 'l.pdf', evidence: { cita_monto: '$5.000.000', moneda: 'CLP', confidence: 0.95 } }];
    const { result, claudeReadIssues } = await run(raw, { cmfCreditors: [{ institucion: 'Banco Limpio', tipoCredito: 'Consumo', totalCredito: 5_000_000, overdue90Days: 5_000_000 }] });
    check('override con fecha → NO se degrada (sigue en 260)', result.cmf260DirectOverrides.length === 1 && result.deReclassified261Creditors.length === 0);
    check('raw limpio → 0 claudeReadIssues', claudeReadIssues.length === 0, `got ${claudeReadIssues.length}`);
  }

  console.log(`\nGolden backstops: ${ok} OK, ${fail} fallidos`);
  if (fail > 0) process.exit(1);
})();
