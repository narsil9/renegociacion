import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { getProdReadOnlyClient } from './prodReadOnly';

dotenv.config();

const localUrl = process.env.SUPABASE_URL as string;
const localKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!localUrl || !localKey) {
  console.error('❌ Error: Faltan credenciales en el .env (SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

// Local connection using service_role key to bypass RLS for syncing
const localSupabase = createClient(localUrl, localKey, { auth: { persistSession: false } });

// Read-only prod client proxy
const prodSupabase = getProdReadOnlyClient();

// Parse command line arguments
const isDryRun = process.argv.includes('--dry-run');
const isStrict = process.argv.includes('--strict');
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex !== -1 ? parseInt(process.argv[limitIndex + 1], 10) : null;

function normalizeRut(rut: string): string {
  if (!rut) return '';
  return rut.toLowerCase().replace(/[^0-9k]/g, '');
}

function formatRut(rut: string): string {
  const clean = normalizeRut(rut);
  if (clean.length < 2) return clean;
  const dv = clean.slice(-1);
  const num = clean.slice(0, -1);
  return `${num}-${dv}`;
}

function mapEstadoCivil(statusStr: string | null): string {
  if (!statusStr) return '1'; // Soltero(a) default
  const s = statusStr.toLowerCase();
  if (s.includes('solter')) return '1';
  if (s.includes('casad')) return '2';
  if (s.includes('divorc')) return '3';
  if (s.includes('viud')) return '4';
  if (s.includes('separ')) return '5';
  if (s.includes('conviv')) return '6';
  return '1';
}

function mapProfesion(tituloStr: string | null): string | null {
  if (!tituloStr) return null;
  const t = tituloStr.toLowerCase();
  if (t.includes('abogado') || t.includes('leyes') || t.includes('derecho')) return '1';
  if (t.includes('agronomo') || t.includes('agrónomo') || t.includes('agricola') || t.includes('agrícola')) return '12';
  if (t.includes('medico') || t.includes('médico') || t.includes('doctor') || t.includes('cirujano')) return '15';
  if (t.includes('ingenier') || t.includes('civil') || t.includes('informatica') || t.includes('informática')) return '20';
  return '9999'; // Otros
}

function mapOcupacion(tituloStr: string | null): string {
  if (!tituloStr) return '13'; // Trabajador Dependiente
  const t = tituloStr.toLowerCase();
  if (t.includes('independiente') || t.includes('honorarios') || t.includes('particular') || t.includes('comerciante') || t.includes('empresario')) {
    return '14';
  }
  if (t.includes('jubilad') || t.includes('pensionad') || t.includes('retiro') || t.includes('retirado')) {
    return '12';
  }
  if (t.includes('estudiante') || t.includes('alumno')) {
    return '11';
  }
  if (t.includes('cesante') || t.includes('desemplead') || t.includes('sin empleo')) {
    return '9';
  }
  return '13';
}

function mapComuna(comunaStr: string | null): { region: string | null; comuna: string | null } {
  if (!comunaStr) return { region: null, comuna: null };
  const c = comunaStr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  if (c.includes('providencia')) return { region: '13', comuna: '301' };
  if (c.includes('las condes')) return { region: '13', comuna: '292' };
  if (c.includes('maipu')) return { region: '13', comuna: '274' };
  if (c.includes('santiago') || c.includes('san joaquin') || c.includes('san miguel') || c.includes('cerrillos') || c.includes('renca') || c.includes('independencia') || c.includes('ñuñoa') || c.includes('nunoa') || c.includes('pudahuel') || c.includes('penalolen') || c.includes('peñalolen') || c.includes('la florida') || c.includes('puente alto') || c.includes('estacion central') || c.includes('quilicura') || c.includes('lampa') || c.includes('padre hurtado') || c.includes('talagante') || c.includes('el monte') || c.includes('isla de maipo')) {
    return { region: '13', comuna: '279' };
  }
  if (c.includes('vina') || c.includes('viña') || c.includes('villa alemana') || c.includes('quilpue') || c.includes('concon')) {
    return { region: '5', comuna: '89' };
  }
  if (c.includes('valparaiso') || c.includes('san antonio') || c.includes('quillota') || c.includes('san felipe')) {
    return { region: '5', comuna: '87' };
  }
  if (c.includes('concepcion') || c.includes('coronel') || c.includes('talcahuano') || c.includes('chiguayante') || c.includes('san pedro')) {
    return { region: '8', comuna: '199' };
  }

  return { region: null, comuna: null };
}

function parsePhone(phoneStr: string | null): { prefijo: string | null; numero: string | null } {
  if (!phoneStr) return { prefijo: null, numero: null };
  const clean = phoneStr.replace(/[^0-9]/g, '');
  if (clean.length === 0) return { prefijo: null, numero: null };
  
  if (clean.startsWith('569') && clean.length >= 11) {
    return { prefijo: '9', numero: clean.slice(3) };
  }
  if (clean.startsWith('56') && clean.length >= 10) {
    const rest = clean.slice(2);
    if (rest.startsWith('9')) {
      return { prefijo: '9', numero: rest.slice(1) };
    }
    return { prefijo: '2', numero: rest };
  }
  if (clean.startsWith('9') && clean.length === 9) {
    return { prefijo: '9', numero: clean.slice(1) };
  }
  if (clean.length > 8) {
    return { prefijo: '9', numero: clean.slice(-8) };
  }
  return { prefijo: '9', numero: clean };
}

async function sync() {
  console.log('📡 INICIANDO PROCESO DE SINCRONIZACIÓN DE CLIENTES RECIÉN ASIGNADOS (AISLADO)...');
  console.log(`Dry-run: ${isDryRun ? 'SÍ (Modo lectura)' : 'NO (Guardando en Sandbox: pato_prueba_clients)'}`);
  if (isStrict) console.log('Modo estricto: SÍ (Se omitirán clientes con datos incompletos)');
  if (limit) console.log(`Límite: ${limit} registros`);

  try {
    // 1. Fetch active cases from v_casos_renegociacion
    console.log('⏳ Obteniendo casos activos en producción...');
    const { data: cases, error: errCases } = await prodSupabase
      .from('v_casos_renegociacion')
      .select('rut, nombre, project_airtable_id, airtable_id, email, telefono');

    if (errCases) {
      throw new Error(`Error obteniendo casos: ${errCases.message}`);
    }

    // 2. Fetch projects from bronze_projects to check status
    console.log('⏳ Obteniendo estados de proyecto de bronze_projects...');
    const { data: projects, error: errProjects } = await prodSupabase
      .from('bronze_projects')
      .select('airtable_id, data');

    if (errProjects) {
      throw new Error(`Error obteniendo proyectos: ${errProjects.message}`);
    }

    const projectStatusMap = new Map<string, string>();
    projects?.forEach(p => {
      if (p.data && typeof p.data === 'object') {
        const status = (p.data as any)['Project status'];
        if (status) {
          projectStatusMap.set(p.airtable_id, status);
        }
      }
    });

    // Filter for cases that are 'Asignación al asesor'
    const targetCases = cases.filter(c => {
      if (!c.project_airtable_id) return false;
      const status = projectStatusMap.get(c.project_airtable_id);
      return status === 'Asignación al asesor';
    });

    console.log(`✓ Se identificaron ${targetCases.length} casos en "Asignación al asesor".`);

    if (targetCases.length === 0) {
      console.log('⚠️ No hay casos en "Asignación al asesor" para sincronizar.');
      return;
    }

    const casesToProcess = limit ? targetCases.slice(0, limit) : targetCases;

    // 3. Fetch bronze_customers_main (personal data)
    console.log('⏳ Obteniendo perfiles de clientes maestros de bronze_customers_main...');
    const { data: customers, error: errCust } = await prodSupabase
      .from('bronze_customers_main')
      .select('data');

    if (errCust) {
      throw new Error(`Error obteniendo perfiles de clientes: ${errCust.message}`);
    }

    const customerMap = new Map<string, any>();
    customers?.forEach(c => {
      if (c.data && c.data['RUT (individual)']) {
        const norm = normalizeRut(c.data['RUT (individual)']);
        customerMap.set(norm, c.data);
      }
    });

    // 4. Fetch bronze_customers_sub (email/phone)
    console.log('⏳ Obteniendo contacto de clientes de bronze_customers_sub...');
    const { data: subs, error: errSub } = await prodSupabase
      .from('bronze_customers_sub')
      .select('data');

    if (errSub) {
      throw new Error(`Error obteniendo sub-clientes: ${errSub.message}`);
    }

    const subMap = new Map<string, any>();
    subs?.forEach(s => {
      if (s.data && s.data['RUT (individual)']) {
        const norm = normalizeRut(s.data['RUT (individual)']);
        subMap.set(norm, s.data);
      }
    });

    // 5. Fetch overrides
    console.log('⏳ Obteniendo overrides de renegociacion_overrides...');
    const { data: overrides, error: errOver } = await prodSupabase
      .from('renegociacion_overrides')
      .select('airtable_id, airtable_clave_unica, clave_cu_override');

    if (errOver) {
      throw new Error(`Error obteniendo overrides: ${errOver.message}`);
    }

    const overridesMap = new Map<string, any>();
    overrides?.forEach(o => {
      overridesMap.set(o.airtable_id, o);
    });

    // 6. Map in memory
    const clientsToUpsert: any[] = [];
    const skippedRecords: string[] = [];

    for (const c of casesToProcess) {
      const normRut = normalizeRut(c.rut);
      const customer = customerMap.get(normRut);
      const sub = subMap.get(normRut);
      const override = overridesMap.get(c.airtable_id);

      // JIT Password Exists Verification (we don't store it, just verify it exists)
      const pass = override?.clave_cu_override || override?.airtable_clave_unica || customer?.['Clave Unica'] || '';
      
      const missingFields: string[] = [];

      // Validate critical credentials
      if (!pass) {
        skippedRecords.push(`${c.nombre} (${c.rut}) - Sin contraseña ClaveÚnica`);
        continue; 
      }

      // Check fields and populate missing fields array
      const name = c.nombre.trim();
      const rut = formatRut(c.rut);

      const nacionalidad = customer?.['Nacionalidad'] || null;
      if (!nacionalidad) missingFields.push('nacionalidad');

      // Fecha nacimiento is not in DB (will default to null and be in missing_fields)
      const fechaNacimiento = null;
      missingFields.push('fecha_nacimiento');

      const estadoCivil = customer?.['Estado Civil'] ? mapEstadoCivil(customer['Estado Civil']) : null;
      if (!estadoCivil) missingFields.push('estado_civil');

      const profesion = customer?.['Titulo'] ? mapProfesion(customer['Titulo']) : null;
      if (!profesion) missingFields.push('profesion_oficio');

      const ocupacion = customer?.['Titulo'] ? mapOcupacion(customer['Titulo']) : '13'; // default to worker

      const direccion = customer?.['Domicilio'] || null;
      if (!direccion) missingFields.push('direccion');

      const { region, comuna } = mapComuna(customer?.['Comuna']);
      if (!region) missingFields.push('region');
      if (!comuna) missingFields.push('comuna');

      // Email and Phone from sub-records or case view
      const email = sub?.['Email'] || c.email || null;
      if (!email) missingFields.push('email');

      const { prefijo: telefonoPrefijo, numero: telefono } = parsePhone(sub?.['Phone number'] || c.telefono);
      if (!telefonoPrefijo) missingFields.push('telefono_prefijo');
      if (!telefono) missingFields.push('telefono');

      // Strict check: skip if missing critical fields (except birthdate which is expected missing)
      const criticalMissing = missingFields.filter(f => f !== 'fecha_nacimiento');
      if (isStrict && criticalMissing.length > 0) {
        skippedRecords.push(`${c.nombre} (${c.rut}) - Faltan campos críticos: ${criticalMissing.join(', ')}`);
        continue;
      }

      clientsToUpsert.push({
        airtable_id: c.airtable_id,
        rut,
        name,
        clave_unica_rut: rut,
        nacionalidad,
        fecha_nacimiento: fechaNacimiento,
        estado_civil: estadoCivil,
        regimen_patrimonial: estadoCivil === '2' ? '2' : null,
        profesion_oficio: profesion,
        ocupacion,
        direccion,
        region,
        comuna,
        email,
        telefono_prefijo: telefonoPrefijo,
        telefono,
        missing_fields: missingFields,
      });
    }

    console.log(`\n📊 Resumen de Mapeo (Sincronización Aislada):`);
    console.log(`   - Clientes listos para sincronizar: ${clientsToUpsert.length}`);
    console.log(`   - Clientes omitidos (Falta clave o modo estricto): ${skippedRecords.length}`);
    if (skippedRecords.length > 0) {
      console.log('     Muestra de omitidos (primeros 5):');
      skippedRecords.slice(0, 5).forEach(s => console.log(`       * ${s}`));
    }

    if (clientsToUpsert.length === 0) {
      console.log('⚠️ Ningún cliente califica para sincronización. Finalizando.');
      return;
    }

    if (isDryRun) {
      console.log('\n🔍 MUESTRA DE DATOS MAPEADOS (Modo Dry-Run - NO credentials stored):');
      console.log(JSON.stringify(clientsToUpsert.slice(0, 2), null, 2));
      console.log('\n✓ Dry-run finalizado con éxito.');
      return;
    }

    console.log('\n⏳ Subiendo datos a la tabla pato_prueba_clients...');
    
    const { error: upsertError } = await localSupabase
      .from('pato_prueba_clients')
      .upsert(clientsToUpsert, { onConflict: 'rut' });

    if (upsertError) {
      throw new Error(`Error en el upsert del sandbox: ${upsertError.message}`);
    }

    console.log(`🎉 ¡ÉXITO! Sincronizados ${clientsToUpsert.length} clientes en: pato_prueba_clients.`);
  } catch (err: any) {
    console.error('🚨 Sincronización fallida:', err.message || err);
  }
}

sync();
