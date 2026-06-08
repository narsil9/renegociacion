import { supabase } from './supabase';

async function testStep4Job() {
  console.log('🚀 Iniciando pruebas de encolamiento de trabajos para Paso 4 (Apoderado)...');

  // 1. Obtener los IDs de los clientes
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, name, rut');

  if (clientsErr || !clients) {
    console.error('❌ Error al obtener clientes:', clientsErr?.message);
    process.exit(1);
  }

  const pato = clients.find(c => c.rut === '21917363-6');

  if (!pato) {
    console.error('❌ No se encontró al cliente Patricio Martini en la base de datos.');
    process.exit(1);
  }

  // Limpiar cualquier job previo encolado para este cliente
  console.log('🧹 Limpiando trabajos anteriores...');
  await supabase
    .from('automation_jobs')
    .delete()
    .eq('client_id', pato.id);

  // --- Encolar Trabajo de Paso 4 para Patricio ---
  console.log(`\n⏳ Encolando Trabajo de Paso 4 para ${pato.name} (RUT: ${pato.rut})...`);
  const { data: jobPato, error: errPato } = await supabase
    .from('automation_jobs')
    .insert({
      client_id: pato.id,
      step: 4,
      status: 'pending',
      dry_run: true
    })
    .select();

  if (errPato || !jobPato || jobPato.length === 0) {
    console.error('❌ Error al crear trabajo para Patricio:', errPato?.message);
    return;
  }
  const patoJobId = jobPato[0].id;
  console.log(`✓ Trabajo encolado con ID: ${patoJobId}`);

  // Esperar 25 segundos para que el worker de PM2 lo procese completo
  console.log('⏳ Esperando a que el worker procese el trabajo de Patricio (25 segundos)...');
  await new Promise(r => setTimeout(r, 25000));

  // Verificar resultado de Patricio
  const { data: checkPato, error: errCheckPato } = await supabase
    .from('automation_jobs')
    .select('status, error_log')
    .eq('id', patoJobId);

  if (errCheckPato || !checkPato || checkPato.length === 0) {
    console.error('❌ Error al verificar resultado de Patricio');
  } else {
    const job = checkPato[0];
    console.log(`\n📊 RESULTADO PATRICIO: [Estado: ${job.status.toUpperCase()}]`);
    if (job.status === 'success') {
      console.log('🎉 ¡Prueba exitosa! Patricio Martini completó la automatización del Paso 4.');
    } else {
      console.error('❌ Falló la prueba de Patricio. Logs del error:');
      console.log(job.error_log);
    }
  }
}

testStep4Job();
