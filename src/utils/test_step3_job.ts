import { supabase } from './supabase';

async function testStep3Job() {
  console.log('🚀 Iniciando pruebas de encolamiento de trabajos para Paso 3 (Validación CMF)...');

  // 1. Obtener los IDs de los clientes
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, name, rut');

  if (clientsErr || !clients) {
    console.error('❌ Error al obtener clientes:', clientsErr?.message);
    process.exit(1);
  }

  const pato = clients.find(c => c.rut === '21917363-6');
  const miled = clients.find(c => c.rut === '20285122-3');

  if (!pato || !miled) {
    console.error('❌ No se encontraron los clientes Patricio o Miled en la base de datos.');
    process.exit(1);
  }

  // Limpiar cualquier job previo encolado para estos clientes
  console.log('🧹 Limpiando trabajos anteriores...');
  await supabase
    .from('automation_jobs')
    .delete()
    .in('client_id', [pato.id, miled.id]);

  // --- PRUEBA 1: Patricio Martini (CMF de Vanessa - DEBE CUMPLIR) ---
  console.log(`\n⏳ Encolando Trabajo de Paso 3 para ${pato.name} (RUT: ${pato.rut})...`);
  const { data: jobPato, error: errPato } = await supabase
    .from('automation_jobs')
    .insert({
      client_id: pato.id,
      step: 3,
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

  // Esperar 12 segundos para que el worker de PM2 lo procese
  console.log('⏳ Esperando a que el worker procese el trabajo de Patricio (12 segundos)...');
  await new Promise(r => setTimeout(r, 12000));

  // Verificar resultado de Patricio
  const { data: checkPato, error: errCheckPato } = await supabase
    .from('automation_jobs')
    .select('status, error_log')
    .eq('id', patoJobId);

  if (errCheckPato || !checkPato || checkPato.length === 0) {
    console.error('❌ Error al verificar resultado de Patricio');
  } else {
    const job = checkPato[0];
    console.log(`📊 RESULTADO PATRICIO: [Estado: ${job.status.toUpperCase()}]`);
    if (job.status === 'success') {
      console.log('🎉 ¡Prueba exitosa! Patricio Martini aprobó la validación CMF.');
    } else {
      console.error('❌ Falló la prueba de Patricio. Logs del error:');
      console.log(job.error_log);
    }
  }

  // --- PRUEBA 2: Miled Gassibe (CMF de Miled - DEBE RECHAZARSE) ---
  console.log(`\n⏳ Encolando Trabajo de Paso 3 para ${miled.name} (RUT: ${miled.rut})...`);
  const { data: jobMiled, error: errMiled } = await supabase
    .from('automation_jobs')
    .insert({
      client_id: miled.id,
      step: 3,
      status: 'pending',
      dry_run: true
    })
    .select();

  if (errMiled || !jobMiled || jobMiled.length === 0) {
    console.error('❌ Error al crear trabajo para Miled:', errMiled?.message);
    return;
  }
  const miledJobId = jobMiled[0].id;
  console.log(`✓ Trabajo encolado con ID: ${miledJobId}`);

  // Esperar 12 segundos para que el worker de PM2 lo procese
  console.log('⏳ Esperando a que el worker procese el trabajo de Miled (12 segundos)...');
  await new Promise(r => setTimeout(r, 12000));

  // Verificar resultado de Miled
  const { data: checkMiled, error: errCheckMiled } = await supabase
    .from('automation_jobs')
    .select('status, error_log')
    .eq('id', miledJobId);

  if (errCheckMiled || !checkMiled || checkMiled.length === 0) {
    console.error('❌ Error al verificar resultado de Miled');
  } else {
    const job = checkMiled[0];
    console.log(`📊 RESULTADO MILED: [Estado: ${job.status.toUpperCase()}]`);
    if (job.status === 'failed') {
      console.log('🎉 ¡Prueba exitosa! Miled Gassibe fue rechazado correctamente por no cumplir con los requisitos.');
      console.log('--- Log de validación del error registrado: ---');
      console.log(job.error_log);
    } else {
      console.error('❌ Falló la prueba de Miled (debió fallar la validación CMF pero quedó en: ' + job.status + ').');
    }
  }
}

testStep3Job();
