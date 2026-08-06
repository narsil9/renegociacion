/**
 * Pruebas unitarias DETERMINISTAS de `registrarConsumo` (src/utils/document_reads.ts).
 * Sin API, sin framework, sin red: el cliente Supabase es un doble de prueba en memoria.
 * Instrumentado en 873d719 en los 4 call sites del worker que llaman a Anthropic; este es
 * el único test permanente del mecanismo compartido.
 *
 * Uso: TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' \
 *        node_modules/.bin/ts-node --transpile-only casos/costos_telemetria/unit_tests.ts
 */
import { registrarConsumo, resolverServicioIdPorRut, limpiarCacheServicioIdWorker, LlmCallRecord } from '../../src/utils/document_reads';
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

// --------------------------------------------------------------------------- api_key_hint (T11-T14)
// `API_KEY_HINT` se calcula UNA vez al cargar `document_reads.ts` (a nivel de módulo, no por
// llamada) — por diseño, para no leer `process.env` en cada insert. Eso significa que el
// `import` estático de arriba de este archivo ya fijó su propio valor y no se puede cambiar
// desde acá. Para probar la derivación con distintos valores de env, se fuerza un módulo
// NUEVO: se pisa `ANTHROPIC_API_KEY`, se borra la entrada de `require.cache` y se vuelve a
// pedir el módulo — mismo mecanismo de Node, sin mocks ni librerías nuevas.
function reloadDocumentReads(envValue: string | undefined): typeof import('../../src/utils/document_reads') {
  const antes = process.env.ANTHROPIC_API_KEY;
  if (envValue === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = envValue;

  const modPath = require.resolve('../../src/utils/document_reads');
  delete require.cache[modPath];
  const mod = require('../../src/utils/document_reads');

  if (antes === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = antes;

  return mod;
}

// --------------------------------------------------------------------------- doble de Supabase (I1)
// Simula `core.servicio` join `core.cliente` para probar la resolución rut → servicio_id
// sin tocar producción. `capturedRows` (herramientas_uso) se comparte con `fakeSupabase`
// de arriba para que un mismo doble sirva las dos tablas que `registrarConsumo` toca.
type ServicioFixture = { id: string; rut: string; tipo?: string; servicioDeleted?: boolean; clienteDeleted?: boolean };

function fakeSupabaseConServicios(
  servicios: ServicioFixture[],
  capturedRows: { rows?: any[] },
  opts: { indiceFalla?: boolean } = {}
): SupabaseClient {
  return {
    schema(schemaName: string) {
      if (schemaName !== 'core') throw new Error(`schema inesperado: ${schemaName}`);
      return {
        from(table: string) {
          if (table !== 'servicio') throw new Error(`tabla inesperada: ${table}`);
          const filtros: Record<string, unknown> = {};
          const builder: any = {
            select() { return builder; },
            eq(col: string, val: unknown) { filtros[col] = val; return builder; },
            then(resolve: (v: any) => void) {
              if (opts.indiceFalla) return resolve({ data: null, error: { message: 'conexión caída' } });
              const rows = servicios
                .filter((s) => filtros.tipo === undefined || (s.tipo ?? 'RN') === filtros.tipo)
                .filter((s) => filtros.is_deleted === undefined || (s.servicioDeleted ?? false) === filtros.is_deleted)
                .filter((s) => filtros['cliente.is_deleted'] === undefined || (s.clienteDeleted ?? false) === filtros['cliente.is_deleted'])
                .map((s) => ({ id: s.id, cliente: { rut: s.rut } }));
              return resolve({ data: rows, error: null });
            },
          };
          return builder;
        },
      };
    },
    from(table: string) {
      if (table !== 'herramientas_uso') throw new Error(`tabla inesperada: ${table}`);
      return {
        async insert(rows: any[]) {
          capturedRows.rows = rows;
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
}

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

  // ========================================================================= T5 rut resuelve a un solo servicio RN
  section('T5 — rut que resuelve a un único servicio RN: servicio_id se completa solo');
  {
    limpiarCacheServicioIdWorker();
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabaseConServicios(
      [{ id: 'svc-jorge', rut: '12345678-9' }],
      captured
    );
    await registrarConsumo(supabase, [call()], { rut: '12345678-9', automationJobId: 'job-t5' }, loggerMudo);
    eq('servicio_id resuelto', captured.rows?.[0]?.servicio_id, 'svc-jorge');
  }

  // ========================================================================= T6 rut ambiguo
  section('T6 — rut con dos servicios RN: servicio_id NULL + warning (adivinar prohibido)');
  {
    limpiarCacheServicioIdWorker();
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabaseConServicios(
      [
        { id: 'svc-a', rut: '11111111-1' },
        { id: 'svc-b', rut: '11111111-1' },
      ],
      captured
    );
    let warned = false;
    const loggerEspia = { log: () => {}, error: (m: string) => { if (/ambigu|resuelve a 2/.test(m)) warned = true; } };
    await registrarConsumo(supabase, [call()], { rut: '11111111-1', automationJobId: 'job-t6' }, loggerEspia);
    eq('servicio_id queda NULL', captured.rows?.[0]?.servicio_id, null);
    ok('se logueó warning de ambigüedad', warned);
  }

  // ========================================================================= T7 formato de rut distinto
  section('T7 — rut con y sin guion resuelve igual (comparación normalizada)');
  {
    limpiarCacheServicioIdWorker();
    const captured: { rows?: any[] } = {};
    // cliente.rut CON guion en la base; herramientas_uso.rut llega SIN guion (caso medido en prod).
    const supabase = fakeSupabaseConServicios([{ id: 'svc-sin-guion', rut: '19122124-9' }], captured);
    await registrarConsumo(supabase, [call()], { rut: '191221249', automationJobId: 'job-t7' }, loggerMudo);
    eq('resuelve pese al formato distinto', captured.rows?.[0]?.servicio_id, 'svc-sin-guion');
  }
  {
    limpiarCacheServicioIdWorker();
    const captured: { rows?: any[] } = {};
    // Caso inverso: cliente.rut sin guion, herramientas_uso.rut con guion.
    const supabase = fakeSupabaseConServicios([{ id: 'svc-con-guion', rut: '191221249' }], captured);
    await registrarConsumo(supabase, [call()], { rut: '19.122.124-9', automationJobId: 'job-t7b' }, loggerMudo);
    eq('resuelve en el sentido inverso', captured.rows?.[0]?.servicio_id, 'svc-con-guion');
  }

  // ========================================================================= T8 búsqueda que falla
  section('T8 — la resolución de servicio_id falla (red/permisos): fila huérfana, sin excepción');
  {
    limpiarCacheServicioIdWorker();
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabaseConServicios([], captured, { indiceFalla: true });
    let lanzo = false;
    try {
      await registrarConsumo(supabase, [call()], { rut: '12345678-9', automationJobId: 'job-t8' }, loggerMudo);
    } catch {
      lanzo = true;
    }
    ok('no propaga la excepción', !lanzo);
    ok('la fila se insertó igual', captured.rows?.length === 1);
    eq('servicio_id queda NULL (huérfana, no desaparece)', captured.rows?.[0]?.servicio_id, null);
  }

  // ========================================================================= T9 usage sin input_tokens (I3)
  section('T9 — usage sin input_tokens: se loguea, la fila igual se inserta (en 0, no invisible)');
  {
    limpiarCacheServicioIdWorker();
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabaseConServicios([{ id: 'svc-x', rut: '12345678-9' }], captured);
    let avisoUsageAusente = false;
    const loggerEspia = {
      log: () => {},
      error: (m: string) => { if (/usage sin input_tokens/.test(m)) avisoUsageAusente = true; },
    };
    await registrarConsumo(
      supabase,
      [{ skill: 's', model: 'm', usage: {} }],
      { rut: '12345678-9', automationJobId: 'job-t9' },
      loggerEspia
    );
    ok('se logueó el usage ausente', avisoUsageAusente);
    eq('la fila se insertó igual con tokens en 0', captured.rows?.[0]?.input_tokens, 0);
  }

  // ========================================================================= T10 el finally de I2
  section('T10 — el patrón "registrar en finally" no pierde el consumo de documentos anteriores');
  {
    // No se puede mockear Anthropic acá (prohibido llamar la API real en tests), así que
    // se prueba el MISMO patrón que runIngresosAgent aplica alrededor de
    // extractIncomeFactsNative: array declarado afuera, llenado por un loop que lanza a
    // mitad de camino, registrado en un `finally` que corre pase lo que pase.
    limpiarCacheServicioIdWorker();
    const captured: { rows?: any[] } = {};
    const supabase = fakeSupabaseConServicios([{ id: 'svc-y', rut: '12345678-9' }], captured);

    const llmCalls: LlmCallRecord[] = [];
    async function loopQueFalla(docs: string[]) {
      for (const d of docs) {
        if (d === 'doc-malo') throw new Error(`falló ${d}`);
        llmCalls.push(call());
      }
    }

    let lanzo = false;
    try {
      try {
        await loopQueFalla(['doc-1', 'doc-2', 'doc-malo', 'doc-3']);
      } finally {
        await registrarConsumo(supabase, llmCalls, { rut: '12345678-9', automationJobId: 'job-t10' }, loggerMudo);
      }
    } catch {
      lanzo = true;
    }
    ok('el error del loop sigue propagando (no se traga)', lanzo);
    eq('se registraron los 2 documentos previos al que falló', captured.rows?.length, 2);
  }

  // ========================================================================= T11 api_key_hint derivado
  section('T11 — api_key_hint: derivado de ANTHROPIC_API_KEY (últimos 4), calculado al cargar el módulo');
  {
    const captured: { rows?: any[] } = {};
    const mod = reloadDocumentReads('sk-ant-api03-abcXYZ9988');
    const supabase = fakeSupabase('ok', captured);
    await mod.registrarConsumo(supabase, [call()], { rut: '1-9', automationJobId: 'job-t11' }, loggerMudo);
    eq('api_key_hint son los últimos 4', captured.rows?.[0]?.api_key_hint, '9988');
  }

  // ========================================================================= T12 explícito gana
  section('T12 — un apiKeyHint explícito del llamador gana sobre el derivado del módulo');
  {
    const captured: { rows?: any[] } = {};
    const mod = reloadDocumentReads('sk-ant-api03-abcXYZ9988');
    const supabase = fakeSupabase('ok', captured);
    await mod.registrarConsumo(
      supabase,
      [call()],
      { rut: '1-9', automationJobId: 'job-t12', apiKeyHint: 'ZZZZ' },
      loggerMudo
    );
    eq('gana el hint explícito', captured.rows?.[0]?.api_key_hint, 'ZZZZ');
  }

  // ========================================================================= T13 sin env var
  section('T13 — sin ANTHROPIC_API_KEY: api_key_hint queda null, la fila se inserta igual');
  {
    const captured: { rows?: any[] } = {};
    const mod = reloadDocumentReads(undefined);
    const supabase = fakeSupabase('ok', captured);
    await mod.registrarConsumo(supabase, [call()], { rut: '1-9', automationJobId: 'job-t13' }, loggerMudo);
    ok('la fila se insertó igual (nada desaparece)', captured.rows?.length === 1);
    eq('api_key_hint es null', captured.rows?.[0]?.api_key_hint, null);
  }

  // ========================================================================= T14 nunca más de 4 caracteres
  section('T14 — api_key_hint nunca tiene más de 4 caracteres, aunque cambie el slice');
  {
    const captured: { rows?: any[] } = {};
    const mod = reloadDocumentReads('sk-ant-api03-unaKeyMuchoMasLarga1234');
    const supabase = fakeSupabase('ok', captured);
    await mod.registrarConsumo(supabase, [call()], { rut: '1-9', automationJobId: 'job-t14' }, loggerMudo);
    const hint = captured.rows?.[0]?.api_key_hint as string;
    ok('largo <= 4', typeof hint === 'string' && hint.length <= 4, `largo real ${hint?.length}`);
    eq('exactamente los últimos 4', hint, '1234');
  }

  // --------------------------------------------------------------------------- salida
  console.log(`\n${pass} aserción(es) OK, ${fails.length} fallo(s).`);
  if (fails.length > 0) { fails.forEach((f) => console.error(`  ✗ ${f}`)); process.exit(1); }
}

run();
