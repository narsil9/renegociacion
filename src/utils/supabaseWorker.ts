import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

// Las tablas de automatización (clients, automation_jobs, agent_runs, client_documents,
// automation_alerts) viven en el sandbox (SUPABASE_URL). El worker SIEMPRE escribe/lee
// el flujo de automatización en el sandbox.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    '❌ Error: Faltan variables de entorno Supabase.\n' +
    '   Producción : PROD_SUPABASE_URL + PROD_SUPABASE_SERVICE_ROLE_KEY\n' +
    '   Sandbox    : SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
  },
});

// `renegociacion_overrides` (credenciales ClaveÚnica / Clave CT de clientes reales) vive
// SOLO en producción (PROD_SUPABASE_URL), no en el sandbox. Para resolver credenciales de
// un cliente real hay que consultarla con una conexión a producción, separada del cliente
// sandbox. Es opcional: si no hay credenciales PROD en el .env (entorno de dev sandbox-only),
// queda `null` y el worker cae al fallback de `clients.clave_unica_password`.
const prodUrl = process.env.PROD_SUPABASE_URL;
const prodServiceKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;

export const prodSupabase: SupabaseClient | null =
  prodUrl && prodServiceKey
    ? createClient(prodUrl, prodServiceKey, { auth: { persistSession: false } })
    : null;
