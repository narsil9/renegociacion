/**
 * DEBUG del camino por-documento: corre runSentinelCheck con CENTINELA_PER_DOC=true y un logger
 * que imprime, para ver qué extrajo cada documento (DocFacts) y qué ensambló TS.
 * Uso: CENTINELA_PER_DOC=true BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config tools/paso3_validacion/debug_perdoc.ts <rut>
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { runSentinelCheck } from '../../src/utils/sentinel';
dotenv.config();

async function main() {
  const rut = process.argv[2] || '26.625.555-1';
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const logger = { log: (m: string) => console.log(m), error: (m: string, e?: unknown) => console.error(m, e ?? '') };
  const { data: client } = await supabase.from('clients').select('*').eq('rut', rut).maybeSingle();
  if (!client) throw new Error('cliente no encontrado');
  const r = await runSentinelCheck(client, supabase, logger);
  console.log('\n=== RESULTADO ENSAMBLADO ===');
  const dump = (name: string, arr?: any[]) => { console.log(`\n${name}: ${arr?.length ?? 0}`); for (const x of arr ?? []) console.log(`  • ${x.institucion_cmf ?? x.bank} $${(x.total_credito_clp ?? x.monto_clp ?? 0).toLocaleString('es-CL')}${x.fecha_vencimiento ? ' venc '+x.fecha_vencimiento : ''}${x.categoria_articulo ? ' art'+x.categoria_articulo : ''} [${x.document_filename ?? ''}]`); };
  dump('cmf260DirectOverrides', r.cmf260DirectOverrides);
  dump('reclassifiedCreditors', r.reclassifiedCreditors);
  dump('identified261Creditors', r.identified261Creditors);
  dump('additionalCreditors', r.additionalCreditors);
  dump('deReclassified261Creditors', r.deReclassified261Creditors);
}
main().catch((e) => { console.error('🚨', e); process.exit(1); });
