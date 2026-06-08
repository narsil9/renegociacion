import { supabase } from './supabase';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config();

const envPath = path.join(process.cwd(), '.env');

function getEnvValue(key: string): string {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const line = lines.find(l => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}

function setEnvValue(key: string, value: string) {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const index = lines.findIndex(l => l.startsWith(`${key}=`));
  if (index !== -1) {
    lines[index] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
}

async function pollJob(jobId: string, maxTimeoutMs: number = 180000): Promise<any> {
  const start = Date.now();
  console.log(`⏳ Monitoreando estado del job ${jobId}...`);
  while (Date.now() - start < maxTimeoutMs) {
    const { data, error } = await supabase
      .from('automation_jobs')
      .select('status, error_log')
      .eq('id', jobId);
      
    if (data && data.length > 0) {
      const job = data[0];
      if (job.status === 'success' || job.status === 'failed') {
        return job;
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout esperando finalización del trabajo.');
}

async function verifyAndCleanupAlert(clientId: string, expectedType: string): Promise<boolean> {
  // Query sandbox database clients to check credential_error
  const { data, error } = await supabase
    .from('clients')
    .select('credential_error')
    .eq('id', clientId);
    
  if (error || !data || data.length === 0) {
    console.error('❌ Error al buscar credential_error en sandbox:', error?.message);
    return false;
  }
  
  const val = data[0].credential_error;
  if (val && val.startsWith(expectedType)) {
    console.log(`✅ Alerta en columna "credential_error" encontrada en sandbox: "${val}"`);
    
    // Clear it
    const { error: clearErr } = await supabase
      .from('clients')
      .update({ credential_error: null })
      .eq('id', clientId);
      
    if (clearErr) {
      console.error('❌ Error al limpiar credential_error en sandbox:', clearErr.message);
    } else {
      console.log('✓ Columna "credential_error" limpiada con éxito en el Sandbox.');
    }
    return true;
  }
  
  console.log(`❌ Columna "credential_error" esperada: "${expectedType}", encontrada: "${val}"`);
  return false;
}

async function main() {
  console.log('======================================================');
  console.log('🧪 INICIANDO PRUEBAS DE DETECCIÓN DE CREDENCIALES INVÁLIDAS (100% SANDBOX)');
  console.log('======================================================\n');

  // Fetch client Patricio Martini (Prueba)
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, name, rut, clave_unica_rut')
    .eq('rut', '21917363-6');

  if (clientsErr || !clients || clients.length === 0) {
    console.error('❌ Error al obtener cliente Patricio Martini:', clientsErr?.message);
    process.exit(1);
  }

  const pato = clients[0];
  console.log(`Cliente de prueba: ${pato.name} (RUT: ${pato.rut})`);

  // Store original env password and original client fields
  const originalPassword = getEnvValue('CLAVE_UNICA_PASSWORD');
  const originalClaveUnicaRut = pato.clave_unica_rut;

  console.log(`Password original guardado.`);

  try {
    // ==========================================
    // TEST 1: Password Incorrecta (Datos de acceso no válidos)
    // ==========================================
    console.log('\n--- TEST 1: PASSWORD INCORRECTA ---');
    console.log('1. Modificando CLAVE_UNICA_PASSWORD en .env a una contraseña incorrecta...');
    setEnvValue('CLAVE_UNICA_PASSWORD', 'IncorrectPassword123');

    console.log('2. Reiniciando superir-worker en PM2...');
    execSync('pm2 restart superir-worker');
    await new Promise(r => setTimeout(r, 5000));
    
    // Clean any prior jobs
    await supabase.from('automation_jobs').delete().eq('client_id', pato.id).in('status', ['pending', 'success', 'failed']);

    console.log('3. Encolando job Step 1 en Sandbox...');
    const { data: jobData1, error: errJob1 } = await supabase
      .from('automation_jobs')
      .insert({
        client_id: pato.id,
        step: 1,
        status: 'pending',
        dry_run: true
      })
      .select();

    if (errJob1 || !jobData1 || jobData1.length === 0) {
      throw new Error(`Error encolando job 1: ${errJob1?.message}`);
    }

    const job1 = await pollJob(jobData1[0].id);
    console.log(`Job finalizado. Estado: ${job1.status}`);

    if (job1.status !== 'failed') {
      throw new Error('Se esperaba que el job fallara, pero fue exitoso.');
    }

    console.log('4. Verificando que se haya actualizado "credential_error" en Sandbox...');
    const alert1Created = await verifyAndCleanupAlert(pato.id, 'clave_unica_incorrecta');
    if (!alert1Created) {
      throw new Error('La columna credential_error no fue actualizada a clave_unica_incorrecta.');
    }
    console.log('✓ TEST 1 COMPLETADO CON ÉXITO! 🎯');

    // ==========================================
    // TEST 2: RUN Incorrecto (Formato inválido)
    // ==========================================
    console.log('\n--- TEST 2: RUN INCORRECTO ---');
    console.log('1. Restaurando contraseña original en .env...');
    setEnvValue('CLAVE_UNICA_PASSWORD', originalPassword);

    console.log('2. Modificando clave_unica_rut del cliente en Sandbox a un RUN inválido...');
    const { error: updateRutErr } = await supabase
      .from('clients')
      .update({ clave_unica_rut: '1234' })
      .eq('id', pato.id);

    if (updateRutErr) {
      throw new Error(`Error actualizando rut del cliente: ${updateRutErr.message}`);
    }

    console.log('3. Reiniciando superir-worker en PM2...');
    execSync('pm2 restart superir-worker');
    await new Promise(r => setTimeout(r, 5000));

    // Clean prior jobs
    await supabase.from('automation_jobs').delete().eq('client_id', pato.id).in('status', ['pending', 'success', 'failed']);

    console.log('4. Encolando job Step 1 en Sandbox...');
    const { data: jobData2, error: errJob2 } = await supabase
      .from('automation_jobs')
      .insert({
        client_id: pato.id,
        step: 1,
        status: 'pending',
        dry_run: true
      })
      .select();

    if (errJob2 || !jobData2 || jobData2.length === 0) {
      throw new Error(`Error encolando job 2: ${errJob2?.message}`);
    }

    const job2 = await pollJob(jobData2[0].id);
    console.log(`Job finalizado. Estado: ${job2.status}`);

    if (job2.status !== 'failed') {
      throw new Error('Se esperaba que el job fallara, pero fue exitoso.');
    }

    console.log('5. Verificando que se haya actualizado "credential_error" en Sandbox...');
    const alert2Created = await verifyAndCleanupAlert(pato.id, 'rut_incorrecto');
    if (!alert2Created) {
      throw new Error('La columna credential_error no fue actualizada a rut_incorrecto.');
    }
    console.log('✓ TEST 2 COMPLETADO CON ÉXITO! 🎯');

  } catch (err: any) {
    console.error(`\n❌ Error durante las pruebas: ${err.message || err}`);
  } finally {
    // Cleanup
    console.log('\n🧹 Restaurando estado original...');
    setEnvValue('CLAVE_UNICA_PASSWORD', originalPassword);
    
    const { error: restoreRutErr } = await supabase
      .from('clients')
      .update({
        clave_unica_rut: originalClaveUnicaRut,
        credential_error: null
      })
      .eq('id', pato.id);

    if (restoreRutErr) {
      console.error('❌ Error restaurando cliente:', restoreRutErr.message);
    } else {
      console.log('✓ Cliente restaurado.');
    }

    console.log('🔄 Reiniciando worker por última vez...');
    execSync('pm2 restart superir-worker');
    await new Promise(r => setTimeout(r, 5000));
    console.log('🏁 Finalizado.');
  }
}

main();
