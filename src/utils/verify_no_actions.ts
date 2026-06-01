import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const prodUrl = process.env.PROD_SUPABASE_URL as string;
const prodKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY as string;

if (!prodUrl || !prodKey) {
  console.error('❌ Error: Missing credentials');
  process.exit(1);
}

const supabase = createClient(prodUrl, prodKey, {
  auth: { persistSession: false }
});

function normalizeRut(rut: string): string {
  if (!rut) return '';
  return rut.toLowerCase().replace(/[^0-9k]/g, '');
}

async function run() {
  console.log('🔍 VERIFICANDO HISTORIAL DE AUTOMATIZACIÓN PARA CASOS EN "Asignación al asesor"...\n');

  // 1. Fetch active cases in 'Asignación al asesor' status
  const { data: cases, error: errCases } = await supabase
    .from('v_casos_renegociacion')
    .select('rut, nombre, project_airtable_id')
    .eq('estado', 'activo');

  if (errCases) {
    console.error('Error fetching cases:', errCases.message);
    return;
  }

  const { data: projects, error: errProjects } = await supabase
    .from('bronze_projects')
    .select('airtable_id, data');

  if (errProjects) {
    console.error('Error fetching projects:', errProjects.message);
    return;
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

  const targetCases = cases?.filter(c => {
    if (!c.project_airtable_id) return false;
    return projectStatusMap.get(c.project_airtable_id) === 'Asignación al asesor';
  }) || [];

  console.log(`🔹 Total casos en "Asignación al asesor": ${targetCases.length}`);

  // 2. Fetch all jobs from mac_mini_jobs
  const { data: jobs, error: errJobs } = await supabase
    .from('mac_mini_jobs')
    .select('id, command, args, status, created_at');

  if (errJobs) {
    console.error('Error fetching mac_mini_jobs:', errJobs.message);
    return;
  }

  console.log(`🔹 Total trabajos (jobs) registrados en mac_mini_jobs: ${jobs?.length || 0}`);

  // Map jobs by normalized RUT of the client they belong to
  const jobsByRut = new Map<string, any[]>();
  jobs?.forEach(j => {
    if (j.args && typeof j.args === 'object') {
      const rutVal = (j.args as any).rut || (j.args as any).rut_cliente;
      if (rutVal) {
        const norm = normalizeRut(String(rutVal));
        if (!jobsByRut.has(norm)) {
          jobsByRut.set(norm, []);
        }
        jobsByRut.get(norm)?.push(j);
      }
    }
  });

  // Check how many of our target cases have ever had a job run
  let casesWithJobs = 0;
  let casesWithoutJobs = 0;

  const casesWithJobsList: any[] = [];

  targetCases.forEach(c => {
    const norm = normalizeRut(c.rut);
    const clientJobs = jobsByRut.get(norm);
    if (clientJobs && clientJobs.length > 0) {
      casesWithJobs++;
      casesWithJobsList.push({
        nombre: c.nombre,
        rut: c.rut,
        jobs: clientJobs.map(j => ({ comando: j.command, estado: j.status, fecha: j.created_at }))
      });
    } else {
      casesWithoutJobs++;
    }
  });

  console.log(`\n📊 RESULTADO DE LA VERIFICACIÓN:`);
  console.log(`   - Casos en "Asignación al asesor" que NUNCA han tenido un trabajo de automatización: ${casesWithoutJobs} (${((casesWithoutJobs/targetCases.length)*100).toFixed(1)}%)`);
  console.log(`   - Casos en "Asignación al asesor" que SÍ han tenido algún trabajo previo: ${casesWithJobs} (${((casesWithJobs/targetCases.length)*100).toFixed(1)}%)`);

  if (casesWithJobsList.length > 0) {
    console.log('\nMuestra de casos con trabajos previos (los cuales deberíamos investigar antes de tocar):');
    console.log(JSON.stringify(casesWithJobsList.slice(0, 5), null, 2));
  } else {
    console.log('\n✅ ¡Confirmado! Absolutamente ninguno de los casos en "Asignación al asesor" registra actividad previa en la cola de trabajos (mac_mini_jobs).');
  }
}

run();
