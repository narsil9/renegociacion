/**
 * TEST del caché de lecturas por documento (`document_reads`) — invariantes que impiden que
 * el caché CONGELE un resultado degradado. Todo con dobles: sin API, sin Supabase.
 *
 * Cubre:
 *  C1  una lectura cuya sub-etapa de mora falló NO se persiste (pero el gasto sí se registra).
 *  C2  un hit devuelve el `filename` del documento ACTUAL, no el guardado en la fila.
 *  I2  un hit recalcula `emision` (derivación relativa a hoy) y no la sirve congelada.
 *  C3  respuesta AUSENTE (sin `card`, o fecha no parseable) no se persiste; respuesta NEGATIVA
 *      (`card` con fecha vacía = estado de cuenta al día) SÍ se persiste.
 *  REG `cita_fecha` de la calculadora no lleva nada relativo a hoy (ni días, ni "análisis").
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_cache_lectura.ts
 */
import { runPerDocExtraction, type DocFacts, readUnitPromptVersion } from '../../src/utils/sentinel_per_doc';
import { enrichUnDocConMora } from '../../src/utils/calculadora-mora/mora-runner';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const TODAY = '2026-07-28';
const silencioso = { log: () => {}, error: () => {} };

/** Estado de cuenta con un producto: el LLM extractor "devuelve" esto. */
const JSON_EXTRACTOR = JSON.stringify({
  doc_type: 'estado_cuenta',
  emisor_nombre: 'Banco Ejemplo',
  rut_emisor: '11111111-1',
  emision: '2026-06-30',
  n_periodos: 4,
  productos: [{
    operacion: '1234', monto: 5_000_000, etiqueta_monto: 'Monto Total Facturado a Pagar',
    moneda: 'CLP', product_type: 'tarjeta_credito', cita_monto: '$ 5.000.000', confidence: 0.9,
  }],
});

/** Supabase falso: registra los insert y sirve (opcionalmente) una lectura vigente. */
function fakeSupabase(vigente?: unknown) {
  const inserts: { tabla: string; filas: unknown }[] = [];
  const api: any = {
    from(tabla: string) {
      return {
        insert(filas: unknown) { inserts.push({ tabla, filas }); return Promise.resolve({ error: null }); },
        // cadena de `select().eq()...maybeSingle()` del findLecturaVigente
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: vigente ? { facts_json: vigente } : null, error: null }); },
      };
    },
  };
  return { supabase: api, inserts };
}

/**
 * Anthropic falso. `moraFalla` hace que la llamada de la calculadora de mora (la que NO lleva
 * el system del extractor) tire un 529, como en producción.
 */
function fakeAnthropic(opts: { moraFalla: boolean }) {
  let llamadas = 0;
  const anthropic: any = {
    messages: {
      create: async (req: any) => {
        llamadas++;
        const esExtractor = String(req.system?.[0]?.text ?? '').includes('EXTRACTOR');
        if (!esExtractor && opts.moraFalla) throw new Error('529 overloaded_error (simulado)');
        return {
          content: [{ type: 'text', text: esExtractor ? `<json>${JSON_EXTRACTOR}</json>` : '{"estados":[]}' }],
          usage: { input_tokens: 100, output_tokens: 20 },
        };
      },
    },
  };
  return { anthropic, llamadas: () => llamadas };
}

const doc = {
  id: 'doc-1',
  filename: 'estado_cuenta_actual.pdf',
  institucion_cmf: 'Banco Ejemplo',
  acreditacion_tipo: 'monto',
  sha256: 'f'.repeat(64),
  textContent: 'Estado de cuenta. Fecha de Emisión: 30/06/2026. Monto Total Facturado a Pagar $ 5.000.000',
};
const cmfResult = { creditors: [], ufValueCLP: 39_000 };

async function main() {
  console.log('═══ caché de lecturas — invariantes ═══');

  // ── C1: mora fallada → NO se persiste la lectura, pero SÍ se registra el gasto ────────────
  {
    const { supabase, inserts } = fakeSupabase();
    const { anthropic } = fakeAnthropic({ moraFalla: true });
    await runPerDocExtraction([doc], cmfResult as any, [], null, TODAY, anthropic, 'modelo-x', silencioso, supabase, { automationJobId: null, rut: null });
    const lecturas = inserts.filter((i) => i.tabla === 'document_reads');
    const consumos = inserts.filter((i) => i.tabla === 'herramientas_uso');
    check('C1 — mora fallada: NO se inserta en document_reads', lecturas.length === 0, `hubo ${lecturas.length}`);
    check('C1 — mora fallada: el consumo SÍ se registra', consumos.length === 1, JSON.stringify(inserts.map((i) => i.tabla)));
  }

  // ── Control: con la mora OK, la lectura sí se persiste (el test de C1 no pasa por vacuidad) ─
  {
    const { supabase, inserts } = fakeSupabase();
    const anthropic: any = {
      messages: {
        create: async (req: any) => ({
          content: [{
            type: 'text',
            text: String(req.system?.[0]?.text ?? '').includes('EXTRACTOR')
              ? `<json>${JSON_EXTRACTOR}</json>`
              : '{"estados":[{"numero":1,"numero_contrato":"XXXX1234","fecha_inicio_mora":"05/02/2026","dias_mora":173,"monto_adeudado":5000000}]}',
          }],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      },
    };
    await runPerDocExtraction([doc], cmfResult as any, [], null, TODAY, anthropic, 'modelo-x', silencioso, supabase, { automationJobId: null, rut: null });
    const lecturas = inserts.filter((i) => i.tabla === 'document_reads');
    check('control — mora OK: la lectura se persiste', lecturas.length === 1, JSON.stringify(inserts.map((i) => i.tabla)));
    const facts = (lecturas[0]?.filas as any)?.facts_json as DocFacts | undefined;
    check('I2 — lo persistido NO lleva `emision` (derivación relativa a hoy)',
      !!facts && facts.emision === undefined, JSON.stringify(facts?.emision));
    check('I2 — lo persistido SÍ lleva `emision_llm` (función pura del papel)',
      facts?.emision_llm === '2026-06-30', JSON.stringify(facts?.emision_llm));
  }

  // ── C2 + I2: el hit trae el filename del documento actual y la emisión recalculada ────────
  {
    const guardada: DocFacts = {
      filename: 'documento (1).pdf',            // el nombre de OTRA copia del mismo papel
      institucion_asignada: 'Banco Ejemplo',
      doc_type: 'estado_cuenta',
      emision: '2020-01-01',                    // valor viejo: NO debe sobrevivir
      emision_llm: '2026-06-30',
      productos: [{ operacion: '1234', monto: 5_000_000, etiqueta_monto: 'Saldo', moneda: 'CLP', cita_monto: '$ 5.000.000', confidence: 0.9 }],
    };
    const { supabase, inserts } = fakeSupabase(guardada);
    const { anthropic, llamadas } = fakeAnthropic({ moraFalla: false });
    const raw = await runPerDocExtraction([doc], cmfResult as any, [], null, TODAY, anthropic, 'modelo-x', silencioso, supabase, { automationJobId: null, rut: null });
    check('hit — no se llama al modelo', llamadas() === 0);
    check('hit — no se re-inserta nada', inserts.length === 0);
    check('C2 — el hit usa el filename del documento ACTUAL',
      Object.keys(raw.__docTypeByFilename ?? {})[0] === doc.filename,
      JSON.stringify(Object.keys(raw.__docTypeByFilename ?? {})));
    const decl = (raw.identifiedCreditors ?? []).concat(raw.identified261Creditors ?? [], raw.cmf260DirectOverrides ?? [], raw.additionalCreditors ?? []);
    check('C2 — hay filas declaradas que revisar (el check de abajo no pasa por vacuidad)', decl.length > 0, JSON.stringify(raw).slice(0, 300));
    check('C2 — ninguna fila declarada apunta al filename guardado',
      !JSON.stringify(decl).includes('documento (1).pdf'), JSON.stringify(decl).slice(0, 300));
  }

  // ── I1: la llave versiona la unidad completa, no solo el prompt del extractor ─────────────
  {
    const v = readUnitPromptVersion();
    check('I1 — la llave incluye la versión de la unidad de lectura', v.includes('ru-v'), v);
    check('I1 — la llave incluye el hash del prompt de la mora', /mora=[0-9a-f]{16}/.test(v), v);
  }

  // ── REG: `cita_fecha` de la calculadora no lleva nada relativo a hoy ──────────────────────
  {
    const facts: DocFacts = {
      filename: 'ec.pdf', doc_type: 'estado_cuenta',
      productos: [{ operacion: '1234', monto: 1_000_000, etiqueta_monto: 'Saldo', moneda: 'CLP', cita_monto: '$1.000.000', confidence: 0.9 }],
    };
    const res = await enrichUnDocConMora(facts, async () => [
      { numero: 1, numero_contrato: 'XXXX1234', fecha_inicio_mora: '05/02/2026', dias_mora: 999 },
    ]);
    const cita = facts.productos[0].cita_fecha ?? '';
    check('REG — la mora corrió', res === 'ok' && facts.productos[0].fecha_mora === '2026-02-05', JSON.stringify(facts.productos[0]));
    check('REG — `cita_fecha` no contiene los días de mora', !cita.includes('999'), cita);
    check('REG — `cita_fecha` no dice "análisis"', !/an[áa]lisis/i.test(cita), cita);
    check('REG — `cita_fecha` trae la fecha canónica con año', cita.includes('05/02/2026'), cita);
  }

  // ── C1 bis: la calculadora que no devuelve estados también cuenta como fallo ──────────────
  {
    const facts: DocFacts = {
      filename: 'ec.pdf', doc_type: 'estado_cuenta',
      productos: [{ operacion: '1234', monto: 1_000_000, etiqueta_monto: 'Saldo', moneda: 'CLP', cita_monto: '$1.000.000', confidence: 0.9 }],
    };
    check('respuesta de mora no interpretable = fallo', (await enrichUnDocConMora(facts, async () => [])) === 'fallo');
    const sinProductos: DocFacts = { filename: 'cert.pdf', doc_type: 'desglose_por_producto', productos: [] };
    check('documento que no necesita mora = no_aplica', (await enrichUnDocConMora(sinProductos, async () => [])) === 'no_aplica');
  }

  // ── C3: respuesta AUSENTE vs respuesta NEGATIVA de la calculadora ─────────────────────────
  // 'ok' tiene que medir que la calculadora RESPONDIÓ sobre este producto, no que el producto
  // haya quedado con `fecha_mora`. Si midiera lo segundo, un estado de cuenta AL DÍA (respuesta
  // negativa legítima) nunca se cachearía y el ahorro se cae.
  {
    // Multiproducto: con >=2 estados `pickCard` exige los últimos 4 dígitos. El extractor
    // reporta el Nº de operación del crédito y la calculadora la tarjeta enmascarada → no matchea.
    const sinCard: DocFacts = {
      filename: 'ec_multi.pdf', doc_type: 'estado_cuenta',
      productos: [{ operacion: 'D26400005756', monto: 1_000_000, etiqueta_monto: 'Saldo', moneda: 'CLP', cita_monto: '$1.000.000', confidence: 0.9 }],
    };
    const rSinCard = await enrichUnDocConMora(sinCard, async () => [
      { numero: 1, numero_contrato: 'XXXX1111', fecha_inicio_mora: '05/02/2026', dias_mora: 10 },
      { numero: 2, numero_contrato: 'XXXX2222', fecha_inicio_mora: '06/03/2026', dias_mora: 10 },
    ]);
    check('C3 — producto sin `card` (la calculadora no dijo nada de él) = fallo → no se persiste',
      rSinCard === 'fallo', `res=${rSinCard} ${JSON.stringify(sinCard.productos[0])}`);
    check('C3 — y el producto quedó sin fecha_mora', sinCard.productos[0].fecha_mora === undefined);

    // Respuesta NEGATIVA: la calculadora encontró el producto y dice que no está en mora.
    const alDia: DocFacts = {
      filename: 'ec_al_dia.pdf', doc_type: 'estado_cuenta',
      productos: [{ operacion: '1234', monto: 1_000_000, etiqueta_monto: 'Saldo', moneda: 'CLP', cita_monto: '$1.000.000', confidence: 0.9 }],
    };
    const rAlDia = await enrichUnDocConMora(alDia, async () => [
      { numero: 1, numero_contrato: 'XXXX1234', fecha_inicio_mora: null, dias_mora: 0 },
    ]);
    check('C3 — `card` con fecha vacía (estado de cuenta al día) = ok → SÍ se persiste',
      rAlDia === 'ok', `res=${rAlDia}`);
    check('C3 — y no se inventó una fecha_mora', alDia.productos[0].fecha_mora === undefined);

    // Respuesta que se pierde al parsear: año de 2 dígitos.
    const impresentable: DocFacts = {
      filename: 'ec_fecha_rara.pdf', doc_type: 'estado_cuenta',
      productos: [{ operacion: '1234', monto: 1_000_000, etiqueta_monto: 'Saldo', moneda: 'CLP', cita_monto: '$1.000.000', confidence: 0.9 }],
    };
    const logs: string[] = [];
    const rRara = await enrichUnDocConMora(impresentable, async () => [
      { numero: 1, numero_contrato: 'XXXX1234', fecha_inicio_mora: '05/02/26', dias_mora: 10 },
    ], (m) => logs.push(m));
    check('C3 — `card` con fecha que no parsea ("05/02/26") = fallo → no se persiste',
      rRara === 'fallo', `res=${rRara}`);
    check('C3 — el log trae el valor crudo que no se pudo parsear',
      logs.some((m) => m.includes('05/02/26')), JSON.stringify(logs));
  }

  console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
