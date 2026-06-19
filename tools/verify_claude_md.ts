import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const prodUrl = process.env.PROD_SUPABASE_URL as string;
const prodKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY as string;

if (!prodUrl || !prodKey) {
  console.error('❌ Faltan credenciales PROD');
  process.exit(1);
}

const supabase = createClient(prodUrl, prodKey, { auth: { persistSession: false } });

// Tables documented in CLAUDE.md that I need to verify
const documentedTables = [
  'v_casos_renegociacion',
  'renegociacion_overrides',
  'mac_mini_jobs',
  'bronze_project_renegociacion',
  'acreedores_canonicos',     // described from NAME ONLY - verify hard
  'cmf_informes',             // described from NAME ONLY - verify hard
  'renegociacion_hito',
  'alertas_renegociacion',
  'renegociacion_audit',
  'v_correos_renegociacion',
];

// Columns I claimed exist (subset of the most important per table)
const claimedColumns: Record<string, string[]> = {
  v_casos_renegociacion: ['airtable_id', 'rut', 'nombre', 'email', 'telefono', 't0', 't60', 't89', 't90', 'monto', 'asesor', 'estado', 'drive_link', 'documentos_drive'],
  renegociacion_overrides: ['airtable_id', 'airtable_clave_unica', 'airtable_clave_ct', 'clave_cu_override', 'clave_ct_override', 'cmf_deudas_json', 'sii_carpeta_json', 'sii_boletas_json', 'sii_agente_json', 't0_override'],
  mac_mini_jobs: ['id', 'command', 'args', 'airtable_id', 'status', 'result', 'error', 'exit_code', 'duration_ms', 'requested_by', 'source', 'retry_count'],
  bronze_project_renegociacion: ['airtable_id', 'data', 'updated_at'],
  renegociacion_hito: ['airtable_id', 'hito', 'estado', 'marcado_at'],
  alertas_renegociacion: ['id', 'airtable_id', 'tipo', 'mensaje', 'leida', 'fecha'],
};

async function getColumnsAndCount(table: string): Promise<{ ok: boolean; columns: string[]; count: number | null; sample: any; err?: string }> {
  // get a sample row for columns
  const { data, error } = await supabase.from(table).select('*').limit(1);
  if (error) return { ok: false, columns: [], count: null, sample: null, err: error.message };
  // get count
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  const columns = data && data.length > 0 ? Object.keys(data[0]) : [];
  return { ok: true, columns, count: count ?? null, sample: data && data[0] ? data[0] : null };
}

async function main() {
  console.log('\n========== VERIFICACIÓN DE CLAUDE.md CONTRA LA BD EN VIVO ==========\n');

  // 1. Verify each documented table exists, get columns + row count
  for (const table of documentedTables) {
    const r = await getColumnsAndCount(table);
    if (!r.ok) {
      console.log(`❌ ${table}: NO ACCESIBLE — ${r.err}`);
      continue;
    }
    console.log(`✓ ${table}  (filas: ${r.count})`);
    console.log(`   columnas (${r.columns.length}): ${r.columns.join(', ')}`);

    // verify claimed columns
    const claimed = claimedColumns[table];
    if (claimed) {
      const missing = claimed.filter(c => !r.columns.includes(c));
      if (missing.length > 0) {
        console.log(`   ⚠️  COLUMNAS QUE DOCUMENTÉ PERO NO EXISTEN: ${missing.join(', ')}`);
      } else {
        console.log(`   ✅ Todas las columnas documentadas existen.`);
      }
    }
    console.log('');
  }

  // 2. Deep-dive the two tables I described from name only
  console.log('\n========== DEEP DIVE: tablas documentadas SOLO por nombre ==========\n');
  for (const table of ['acreedores_canonicos', 'cmf_informes']) {
    const { data, error } = await supabase.from(table).select('*').limit(2);
    if (error) {
      console.log(`❌ ${table}: ${error.message}\n`);
      continue;
    }
    console.log(`🔎 ${table}:`);
    if (!data || data.length === 0) {
      console.log('   (vacía)\n');
      continue;
    }
    console.log(`   columnas: ${Object.keys(data[0]).join(', ')}`);
    console.log(`   muestra: ${JSON.stringify(data[0], null, 2)}\n`);
  }

  // 3. Verify the join-key claim: does airtable_id actually join these tables?
  console.log('\n========== VERIFICACIÓN DE LA CLAVE DE UNIÓN airtable_id ==========\n');
  const { data: caso } = await supabase
    .from('v_casos_renegociacion')
    .select('airtable_id, rut, nombre')
    .not('airtable_id', 'is', null)
    .limit(1);

  if (caso && caso.length > 0) {
    const aid = caso[0].airtable_id;
    console.log(`Caso de prueba: ${caso[0].nombre} (rut ${caso[0].rut}) airtable_id=${aid}\n`);
    for (const t of ['renegociacion_overrides', 'bronze_project_renegociacion', 'renegociacion_hito', 'alertas_renegociacion']) {
      const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true }).eq('airtable_id', aid);
      if (error) {
        console.log(`   ${t}: error al unir por airtable_id → ${error.message}`);
      } else {
        console.log(`   ${t}: ${count} fila(s) con airtable_id=${aid}`);
      }
    }
  } else {
    console.log('⚠️ No se pudo obtener un caso de prueba.');
  }

  // 4. Verify credentials claim - do overrides actually hold claves?
  console.log('\n========== VERIFICACIÓN: renegociacion_overrides contiene credenciales ==========\n');
  const { count: withCU } = await supabase
    .from('renegociacion_overrides')
    .select('*', { count: 'exact', head: true })
    .not('airtable_clave_unica', 'is', null);
  const { count: totalOv } = await supabase
    .from('renegociacion_overrides')
    .select('*', { count: 'exact', head: true });
  console.log(`   ${withCU}/${totalOv} registros tienen airtable_clave_unica poblada.`);

  console.log('\n========== FIN DE LA VERIFICACIÓN ==========\n');
}

main().catch(e => { console.error('🚨', e); process.exit(1); });
