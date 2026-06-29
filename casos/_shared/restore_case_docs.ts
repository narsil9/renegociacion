/**
 * Restaura los documentos fuente de los casos de validación desde el Storage del
 * sandbox a `casos/<caso>/documentos/`. READ-ONLY sobre el sandbox (solo SELECT + download
 * del bucket `documentos`; NO escribe nada en la DB ni en Storage).
 *
 * Usa la DB como fuente de verdad (los mismos punteros que lee el worker):
 *   - clients.informe_cmf_path / carpeta_tributaria_path / carpeta_retenedores_path
 *   - client_documents.storage_path / filename  (certificados)
 *
 * Los PDFs viven gitignored (`casos/*\/documentos/`) — este script los repone para poder
 * correr el arnés de validación. Si un objeto ya no está en Storage, lo reporta y sigue.
 *
 * Uso:
 *   npx ts-node -r dotenv/config casos/_shared/restore_case_docs.ts
 *   npx ts-node -r dotenv/config casos/_shared/restore_case_docs.ts cristian_mancilla
 */
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const BUCKET = 'documentos';

// caso (carpeta) → RUT en `clients` (sandbox)
const CASES: Array<{ dir: string; rut: string }> = [
  { dir: 'cristian_mancilla', rut: '16.587.870-1' },
  { dir: 'miguel_lugo',       rut: '26.625.555-1' },
  { dir: 'nector_ruiz',       rut: '15.420.073-8' },
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}

async function main() {
  const only = process.argv[2]; // opcional: restaurar un solo caso
  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );

  const cases = only ? CASES.filter((c) => c.dir === only) : CASES;
  if (cases.length === 0) throw new Error(`Caso desconocido: ${only}`);

  let totalOk = 0;
  let totalMissing = 0;

  for (const c of cases) {
    const baseDir = path.resolve(__dirname, '..', c.dir, 'documentos');
    console.log(`\n=== ${c.dir} (rut ${c.rut}) → ${baseDir} ===`);

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id, informe_cmf_path, carpeta_tributaria_path, carpeta_retenedores_path')
      .eq('rut', c.rut)
      .maybeSingle();
    if (cErr) throw new Error(`Error leyendo clients: ${cErr.message}`);
    if (!client) {
      console.log(`  ⚠️  No existe el cliente ${c.rut} en el sandbox — correr setup_test.ts primero.`);
      continue;
    }

    // Punteros de los 3 documentos principales (van a documentos/ con nombre legible).
    const mainDocs: Array<{ storage: string | null; local: string; label: string }> = [
      { storage: client.informe_cmf_path,        local: path.join(baseDir, 'informe_cmf.pdf'),        label: 'CMF' },
      { storage: client.carpeta_tributaria_path, local: path.join(baseDir, 'carpeta_tributaria.pdf'), label: 'Carpeta Tributaria' },
      { storage: client.carpeta_retenedores_path, local: path.join(baseDir, 'agentes_retenedores.pdf'), label: 'Agentes Retenedores' },
    ];

    // Certificados de client_documents (van a documentos/certs/).
    const { data: certDocs, error: dErr } = await supabase
      .from('client_documents')
      .select('storage_path, filename')
      .eq('client_id', client.id);
    if (dErr) throw new Error(`Error leyendo client_documents: ${dErr.message}`);

    const certTargets = (certDocs ?? []).map((d) => ({
      storage: d.storage_path as string,
      local: path.join(baseDir, 'certs', (d.filename as string) || path.basename(d.storage_path as string)),
      label: `cert ${d.filename ?? d.storage_path}`,
    }));

    const targets = [...mainDocs, ...certTargets].filter((t) => !!t.storage) as Array<{
      storage: string; local: string; label: string;
    }>;

    for (const t of targets) {
      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(t.storage);
      if (dlErr || !blob) {
        console.log(`  ✗ ${t.label}: NO en Storage (${t.storage}) — ${dlErr?.message ?? 'vacío'}`);
        totalMissing++;
        continue;
      }
      fs.mkdirSync(path.dirname(t.local), { recursive: true });
      const buf = Buffer.from(await blob.arrayBuffer());
      fs.writeFileSync(t.local, buf);
      console.log(`  ✓ ${t.label} → ${path.relative(process.cwd(), t.local)} (${buf.length} bytes)`);
      totalOk++;
    }
  }

  console.log(`\n📦 Restaurados: ${totalOk} · Faltantes en Storage: ${totalMissing}`);
  if (totalMissing > 0) {
    console.log('⚠️  Algunos objetos ya no están en el Storage del sandbox. Hay que reponerlos a mano');
    console.log('    en casos/<caso>/documentos/ y volver a correr setup_test.ts para subirlos.');
  }
}

main().catch((err) => { console.error('🚨', (err as Error).message); process.exit(1); });
