// ─────────────────────────────────────────────────────────────────────────
// Polyfill de WebSocket para Node < 22.
//
// @supabase/realtime-js 2.106+ EXIGE WebSocket nativo (Node 22+) y NO auto-detecta
// el paquete 'ws' — su detectEnvironment() solo mira globalThis.WebSocket y, si no lo
// encuentra, lanza al CONSTRUIR el cliente (supabaseWorker.ts → createClient).
//
// Esta máquina corre Node 20 (node@22 tiene el dylib roto, node@26 es bleeding-edge).
// El worker NO usa realtime (pollea automation_jobs), así que solo necesitamos que el
// cliente se construya sin crashear: inyectamos 'ws' como globalThis.WebSocket.
//
// DEBE importarse ANTES que ./utils/supabaseWorker (primer import de worker.ts).
// Usa require() a propósito: evita depender de @types/ws para el type-check de ts-node.
// ─────────────────────────────────────────────────────────────────────────
const g = globalThis as unknown as { WebSocket?: unknown };
if (typeof g.WebSocket === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  g.WebSocket = require('ws');
}
export {};
