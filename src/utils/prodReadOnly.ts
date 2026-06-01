import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const FORBIDDEN = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);

/**
 * Supabase client whose query builder only allows reads; any mutating call throws an error.
 */
export function getProdReadOnlyClient(): SupabaseClient {
  const url = process.env.PROD_SUPABASE_URL;
  const key = process.env.PROD_SUPABASE_READONLY_KEY || process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('❌ Error: Missing PROD_SUPABASE_URL or PROD_SUPABASE_SERVICE_ROLE_KEY in environment.');
  }

  const real = createClient(url, key, {
    auth: { persistSession: false }
  });

  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => new Proxy(target.from(table), {
          get(b, p) {
            if (typeof p === 'string' && FORBIDDEN.has(p)) {
              throw new Error(`🚫 Prod write blocked: '${p}' on '${table}'. Production is READ-ONLY.`);
            }
            return (b as any)[p];
          },
        });
      }
      if (prop === 'rpc') {
        return () => {
          throw new Error('🚫 Prod RPC blocked. Production is READ-ONLY.');
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
