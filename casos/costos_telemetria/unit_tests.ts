/**
 * Pruebas unitarias DETERMINISTAS de `registrarConsumo` (src/utils/document_reads.ts).
 * Sin API, sin framework, sin red: el cliente Supabase es un doble de prueba en memoria.
 * Instrumentado en 873d719 en los 4 call sites del worker que llaman a Anthropic; este es
 * el único test permanente del mecanismo compartido.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/costos_telemetria/unit_tests.ts
 */
import { registrarConsumo, LlmCallRecord } from '../../src/utils/document_reads';
import type { SupabaseClient } from '@supabase/supabase-js';

// --------------------------------------------------------------------------- mini-harness
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function section(t: string) { console.log(`\n• ${t}`); }

// --------------------------------------------------------------------------- doble de Supabase
// Nunca toca la red. `insertBehavior` decide qué hace `.from('herramientas_uso').insert(rows)`:
// devolver { error: null } con las filas capturadas, devolver un error de Postgrest, o lanzar.
type InsertBehavior = 'ok' | 'pg_error' | 'throw';

function fakeSupabase(behavior: InsertBehavior, capturedRows: { rows?: any[] }): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'herramientas_uso') throw new Error(`tabla inesperada: ${table}`);
      return {
        async insert(rows: any[]) {
          if (behavior === 'throw') throw new Error('conexión caída');
          capturedRows.rows = rows;
          if (behavior === 'pg_error') return { error: { message: 'insert rechazado', code: '23505' } };
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const call = (over: Partial<LlmCallRecord['usage']> = {}): LlmCallRecord => ({
  skill: 'centinela_per_doc',
  model: 'claude-sonnet-4-5',
  usage: {
    input_tokens: 1234,
    output_tokens: 567,
    cache_creation_input_tokens: 89,
    cache_read_input_tokens: 10,
    ...over,
  },
});

const loggerMudo = { log: () => {}, error: () => {} };

async function run() {
  // ========================================================================= T1 tokens reales
  section('T1 — inserta los tokens REALES que se le pasaron, no ceros');
  {
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabase('ok', captured);
    await registrarConsumo(
      supabase,
      [call({ input_tokens: 4321, output_tokens: 111, cache_creation_input_tokens: 22, cache_read_input_tokens: 33 })],
      { rut: '12345678-9', automationJobId: 'job-1' },
      loggerMudo
    );
    const fila = captured.rows?.[0];
    eq('input_tokens', fila?.input_tokens, 4321);
    eq('output_tokens', fila?.output_tokens, 111);
    eq('cache_creation_tokens', fila?.cache_creation_tokens, 22);
    eq('cache_read_tokens', fila?.cache_read_tokens, 33);
  }

  // ========================================================================= T2 servicio_id
  section('T2 — servicio_id llega a la fila; sin pasarlo, la fila igual se inserta con null');
  {
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabase('ok', captured);
    await registrarConsumo(supabase, [call()], { rut: '1-9', automationJobId: 'job-2', servicioId: 'svc-77' }, loggerMudo);
    eq('servicio_id viaja', captured.rows?.[0]?.servicio_id, 'svc-77');
  }
  {
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabase('ok', captured);
    await registrarConsumo(supabase, [call()], { rut: '1-9', automationJobId: 'job-3' }, loggerMudo);
    ok('sin servicioId la fila se inserta igual (no desaparece)', captured.rows?.length === 1);
    eq('y servicio_id queda null', captured.rows?.[0]?.servicio_id, null);
  }

  // ========================================================================= T3 source
  section("T3 — source es 'worker' (contrato compartido con el panel, que usa 'herramientas')");
  {
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabase('ok', captured);
    await registrarConsumo(supabase, [call()], { rut: '1-9', automationJobId: 'job-4' }, loggerMudo);
    eq('source', captured.rows?.[0]?.source, 'worker');
  }

  // ========================================================================= T4 no propaga
  section('T4 — si el insert falla, registrarConsumo NO propaga (nunca rompe el flujo del worker)');
  {
    const supabase = fakeSupabase('pg_error', {});
    let lanzo = false;
    try {
      await registrarConsumo(supabase, [call()], { rut: '1-9', automationJobId: 'job-5' }, loggerMudo);
    } catch {
      lanzo = true;
    }
    ok('error de Postgrest no propaga', !lanzo);
  }
  {
    const supabase = fakeSupabase('throw', {});
    let lanzo = false;
    try {
      await registrarConsumo(supabase, [call()], { rut: '1-9', automationJobId: 'job-6' }, loggerMudo);
    } catch {
      lanzo = true;
    }
    ok('excepción del cliente no propaga', !lanzo);
  }

  // --------------------------------------------------------------------------- salida
  console.log(`\n${pass} aserción(es) OK, ${fails.length} fallo(s).`);
  if (fails.length > 0) { fails.forEach((f) => console.error(`  ✗ ${f}`)); process.exit(1); }
}

run();
