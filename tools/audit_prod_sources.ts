/**
 * AUDITORÍA SOLO-LECTURA de las fuentes de producción (`ton…`).
 *
 * Verifica, contra la DB viva del abogado, el mapa del contrato
 * `contrato-superir-mapeo-inputs.md`: para cada input que necesita nuestro
 * worker, confirma la tabla/vista, que responde, y la cobertura (count).
 *
 * ⚠️ SOLO LECTURA. Únicamente SELECT vía REST. NUNCA insert/update/delete.
 *    No es producción (vive en tools/). Requiere PROD_SUPABASE_* en .env.
 *
 * Uso: npx ts-node -r dotenv/config tools/audit_prod_sources.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const URL = process.env.PROD_SUPABASE_URL;
const KEY = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!URL || !KEY) {
    console.error('❌ Faltan PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY en .env');
    process.exit(1);
  }
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  console.log(`🔎 Auditoría read-only de ${URL}\n`);

  // [vista/tabla en public, schema (o null=public), columnas de muestra]
  const targets: Array<{ label: string; schema: string | null; rel: string; cols: string }> = [
    { label: 'Join spine (vista pública)', schema: null, rel: 'v_casos_renegociacion', cols: 'airtable_id, rut, nombre, estado' },
    { label: 'Join spine (schema reports)', schema: 'reports', rel: 'casos_renegociacion', cols: 'airtable_id, rut, project_airtable_id' },
    { label: 'Persona (core)', schema: 'core', rel: 'persona', cols: 'rut, nombre_completo, clave_unica, estado_civil, profesion, nacionalidad' },
    { label: 'Overrides (CMF interpretado + claves)', schema: null, rel: 'renegociacion_overrides', cols: 'airtable_id, airtable_clave_unica' },
    { label: 'CMF informes (PDF crudo)', schema: null, rel: 'cmf_informes', cols: 'case_airtable_id, storage_path, fecha_emision' },
    { label: 'Calce documento→acreedor', schema: null, rel: 'renegociacion_documento_match', cols: 'airtable_id, drive_file_id, acreedor, documento_descripcion, is_match, validation_status' },
    { label: 'Certificados del cliente (PDF)', schema: null, rel: 'renegociacion_audit_pdf', cols: 'rut_norm, storage_path, tipo_documento, descripcion_detectada' },
    { label: 'Jobs SII (Mac Mini)', schema: null, rel: 'mac_mini_jobs', cols: 'airtable_id, command, status' },
    { label: 'Catálogo acreedores', schema: null, rel: 'acreedores_canonicos', cols: 'id, nombre, rut' },
    { label: 'Bronze customers (domicilio)', schema: null, rel: 'bronze_customers_main', cols: 'data' },
  ];

  for (const t of targets) {
    const q = t.schema ? sb.schema(t.schema) : sb;
    const { data, error, count } = await q
      .from(t.rel)
      .select(t.cols, { count: 'exact', head: false })
      .limit(1);
    const name = `${t.schema ? t.schema + '.' : ''}${t.rel}`;
    if (error) {
      console.log(`❌ ${t.label}\n     ${name} → ${error.message}`);
    } else {
      const sample = data && data[0] ? Object.keys(data[0]).join(', ') : '(sin filas)';
      console.log(`✅ ${t.label}\n     ${name} → count=${count}; columnas devueltas: ${sample}`);
    }
  }

  // Verificación puntual de las columnas de brecha del Paso 1 (de a una).
  console.log('\n— Brechas Paso 1: ¿existe la columna en core.persona? —');
  const gapCols = ['fecha_nacimiento', 'comuna', 'region', 'ocupacion', 'profesion', 'estado_civil', 'direccion', 'domicilio', 'email', 'telefono'];
  for (const c of gapCols) {
    const r = await sb.schema('core').from('persona').select(c, { head: true, count: 'exact' });
    if (r.error) console.log(`   ❌ ${c} → ${r.error.message.replace(/\n/g, ' ').slice(0, 80)}`);
    else console.log(`   ✅ ${c} → existe (filas no nulas no medidas aquí; count tabla=${r.count})`);
  }

  // Claves del JSON de bronze (domicilio/comuna/región viven acá).
  console.log('\n— bronze_customers_main.data: claves disponibles (muestra 1 fila) —');
  const br = await sb.from('bronze_customers_main').select('data').limit(1);
  if (br.error) console.log(`   ${br.error.message}`);
  else if (br.data && br.data[0] && br.data[0].data && typeof br.data[0].data === 'object') {
    console.log('   ' + Object.keys(br.data[0].data as Record<string, unknown>).join(' | '));
  } else console.log('   (sin filas o data no es objeto)');
}

main().catch((e) => { console.error('🚨', e instanceof Error ? e.message : e); process.exit(1); });
