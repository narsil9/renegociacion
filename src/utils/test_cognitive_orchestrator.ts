import { supabase } from './supabase';
import { runCognitiveOrchestrator } from './cognitive_orchestrator';
import { RunnerLogger } from './logger';
import * as path from 'path';
import * as fs from 'fs';

async function testOrchestrator() {
  console.log('======================================================');
  console.log('🧪 PROBANDO ORQUESTRADOR COGNITIVO (CLAUDE SONNET 4.5)');
  console.log('======================================================\n');

  // Fetch client Patricio Martini
  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('rut', '21917363-6');

  if (clientErr || !clients || clients.length === 0) {
    console.error('❌ Error al obtener el cliente de prueba Patricio Martini:', clientErr?.message);
    process.exit(1);
  }

  const client = clients[0];
  console.log(`Cliente de prueba: ${client.name} (RUT: ${client.rut})`);

  // Path to local CMF PDF
  const cmfLocalPath = path.join(process.cwd(), 'outputs', 'informe_cmf_pato.pdf');
  if (!fs.existsSync(cmfLocalPath)) {
    // If not found in outputs, try copying from docs_paso3/cmf_pamela.pdf
    const srcCmf = path.join(process.cwd(), 'docs_paso3', 'cmf_pamela.pdf');
    if (fs.existsSync(srcCmf)) {
      const outDir = path.join(process.cwd(), 'outputs');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(srcCmf, cmfLocalPath);
      console.log(`✓ Copiado CMF de prueba desde docs_paso3/cmf_pamela.pdf a outputs/informe_cmf_pato.pdf`);
    } else {
      console.error('❌ Error: No se encontró un CMF de prueba para Patricio Martini.');
      process.exit(1);
    }
  }

  const logger = new RunnerLogger(client.rut, 3);

  try {
    const result = await runCognitiveOrchestrator(client, cmfLocalPath, supabase, logger);
    console.log('\n================ RESULTADO DE ORQUESTRACIÓN ================');
    console.log(JSON.stringify(result, null, 2));
    console.log('===========================================================');
  } catch (err: any) {
    console.error('❌ Error ejecutando runCognitiveOrchestrator:', err.message || err);
  }
}

testOrchestrator();
