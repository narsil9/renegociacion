import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RUTS = [
  { label: 'Patricio Martini', rut: '21917363-6' },
  { label: 'Milet Gassibe',    rut: '20285122-3' },
];

async function verify() {
  for (const { label, rut } of RUTS) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 ${label} | RUT: ${rut}`);
    console.log('─'.repeat(60));

    const { data: rows, error } = await supabase
      .from('clients')
      .select(`
        id, name, rut,
        clave_unica_rut, clave_unica_password,
        informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path,
        nacionalidad, fecha_nacimiento, estado_civil, regimen_patrimonial,
        profesion_oficio, ocupacion, direccion, region, comuna,
        email, telefono_prefijo, telefono
      `)
      .eq('rut', rut)
      .limit(1);

    if (error || !rows || rows.length === 0) {
      console.log(`  ❌ Cliente NO encontrado en tabla "clients". Error: ${error?.message}`);
      continue;
    }

    const c = rows[0];
    console.log(`  ✅ Encontrado | ID: ${c.id} | Nombre: ${c.name}`);

    // Check required fields
    const checks: { field: string; value: any; required: boolean }[] = [
      { field: 'clave_unica_rut',         value: c.clave_unica_rut,        required: true },
      { field: 'clave_unica_password',     value: c.clave_unica_password ? '****' : null, required: true },
      { field: 'informe_cmf_path',         value: c.informe_cmf_path,       required: true },
      { field: 'carpeta_tributaria_path',  value: c.carpeta_tributaria_path, required: true },
      { field: 'carpeta_retenedores_path', value: c.carpeta_retenedores_path, required: true },
      { field: 'nacionalidad',             value: c.nacionalidad,           required: true },
      { field: 'fecha_nacimiento',         value: c.fecha_nacimiento,       required: false },
      { field: 'estado_civil',             value: c.estado_civil,           required: true },
      { field: 'profesion_oficio',         value: c.profesion_oficio,       required: true },
      { field: 'ocupacion',                value: c.ocupacion,              required: true },
      { field: 'direccion',                value: c.direccion,              required: true },
      { field: 'region',                   value: c.region,                 required: true },
      { field: 'comuna',                   value: c.comuna,                 required: true },
      { field: 'email',                    value: c.email,                  required: true },
      { field: 'telefono_prefijo',         value: c.telefono_prefijo,       required: true },
      { field: 'telefono',                 value: c.telefono,               required: true },
    ];

    let missingRequired = 0;
    for (const { field, value, required } of checks) {
      const ok = value !== null && value !== undefined && value !== '';
      const icon = ok ? '  ✅' : (required ? '  ❌' : '  ⚠️ ');
      if (!ok && required) missingRequired++;
      console.log(`${icon} ${field}: ${ok ? value : '(VACÍO)'}`);
    }

    // Check client_documents for orchestrator
    const { data: docs, error: docsErr } = await supabase
      .from('client_documents')
      .select('id, document_type, acreditacion_tipo, institucion_cmf, filename, storage_path')
      .eq('client_id', c.id);

    if (docsErr) {
      console.log(`  ⚠️  client_documents: error al consultar — ${docsErr.message}`);
    } else {
      console.log(`\n  📎 client_documents: ${docs?.length ?? 0} certificados de acreditación`);
      (docs ?? []).forEach(d =>
        console.log(`     • tipo ${d.document_type} (${d.acreditacion_tipo}) | ${d.institucion_cmf} | ${d.filename}`)
      );
    }

    if (missingRequired > 0) {
      console.log(`\n  ⚠️  FALTAN ${missingRequired} CAMPO(S) REQUERIDO(S). El test fallará en el paso que los use.`);
    } else {
      console.log(`\n  ✅ Todos los campos requeridos están presentes.`);
    }
  }
  console.log(`\n${'─'.repeat(60)}\n`);
}

verify().catch(console.error);
