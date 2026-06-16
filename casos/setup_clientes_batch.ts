/**
 * Setup masivo: crea perfiles en Supabase para los 5 clientes pendientes.
 * - Cada cliente usa su RUT real como PK en `clients`.
 * - Las credenciales del portal (clave_unica_rut / password) son de Pato Martini (.env).
 * - CMF y CT son de cada cliente. AR es propia si existe; si no, se reutiliza la de Pato.
 *
 * Uso: npx ts-node --transpile-only -r dotenv/config casos/setup_clientes_batch.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const BUCKET = 'documentos';
const CASOS = path.resolve(__dirname);
const PATO_CT  = 'patricio_martini/carpeta_tributaria.pdf';
const PATO_AR  = 'patricio_martini/agente_retenedor_2026.pdf';

interface ClientSetup {
  rut:        string;
  name:       string;
  prefix:     string;          // storage prefix
  cmfLocal:   string;          // ruta local al CMF
  ctLocal?:   string;          // ruta local a Carpeta Tributaria (undefined → usa Pato)
  arLocal?:   string;          // ruta local a Agente Retenedor (undefined → usa Pato)
}

const CLIENTES: ClientSetup[] = [
  {
    rut:      '18.755.318-0',
    name:     'Nicolás Ignacio Bascuñán Quiroga',
    prefix:   'pato_nicolas',
    cmfLocal: path.join(CASOS, 'nicolas_bascuñan/02_Informe_CMF/informe-deudas-pdf-2025-11-27T090800.971.pdf'),
    ctLocal:  path.join(CASOS, 'nicolas_bascuñan/03_Tributaria_y_SII/Carpeta_Tributaria_Regular (18).pdf'),
    // AR: no tiene → usará PATO_AR
  },
  {
    rut:      '25.656.359-2',
    name:     'William Alexander Montero Romero',
    prefix:   'pato_william',
    cmfLocal: path.join(CASOS, 'william_montero /informe-deudas-pdf-2025-12-15T153144.200.pdf'),
    ctLocal:  path.join(CASOS, 'william_montero /SII/Carpeta_Tributaria_Regular (31).pdf'),
    arLocal:  path.join(CASOS, 'william_montero /SII/Agentes Retenedores.pdf'),
  },
  {
    rut:      '17.596.599-8',
    name:     'Jaime Hernán Cartes Fuentes',
    prefix:   'pato_jaime',
    cmfLocal: path.join(CASOS, 'jaime_cartes/informe-deudas-pdf-2025-11-27T084950.380.pdf'),
    ctLocal:  path.join(CASOS, 'jaime_cartes/SII/Carpeta_Tributaria_Regular (22).pdf'),
    arLocal:  path.join(CASOS, 'jaime_cartes/SII/Agentes Retenedores.pdf'),
  },
  {
    rut:      '15.121.553-K',
    name:     'Noelia Pilar Lorca Guerrero',
    prefix:   'pato_noelia',
    cmfLocal: path.join(CASOS, 'noelia_lorca/informe-deudas-pdf-2025-12-09T161825.883.pdf'),
    ctLocal:  path.join(CASOS, 'noelia_lorca/SII/Carpeta_Tributaria_Regular (24).pdf'),
    arLocal:  path.join(CASOS, 'noelia_lorca/SII/Agentes Retenedores.pdf'),
  },
  {
    rut:      '16.143.425-6',
    name:     'Irene Arévalo Nazrala',
    prefix:   'pato_irene',
    cmfLocal: path.join(CASOS, 'irene_arévalo_nazrala/informe_deudas_16143425-62.pdf'),
    ctLocal:  path.join(CASOS, 'irene_arévalo_nazrala/SII/Carpeta_Tributaria_Regular (25).pdf'),
    arLocal:  path.join(CASOS, 'irene_arévalo_nazrala/SII/ilovepdf_merged - 2025-12-03T121101.000.pdf'),
  },
];

async function uploadFile(localPath: string, storagePath: string, label: string): Promise<void> {
  if (!fs.existsSync(localPath)) throw new Error(`Archivo no encontrado: ${localPath}`);
  const buffer = fs.readFileSync(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const mime = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
  const { error } = await sb.storage.from(BUCKET).upload(storagePath, buffer, { contentType: mime, upsert: true });
  if (error) throw new Error(`Storage upload (${label}): ${error.message}`);
  console.log(`    ✓ ${label} → ${storagePath}`);
}

async function setupCliente(c: ClientSetup): Promise<void> {
  console.log(`\n━━━ ${c.name} (${c.rut}) ━━━`);

  const cmfPath  = `${c.prefix}/informe_cmf.pdf`;
  const ctPath   = c.ctLocal  ? `${c.prefix}/carpeta_tributaria.pdf` : PATO_CT;
  const arPath   = c.arLocal  ? `${c.prefix}/agente_retenedor.pdf`   : PATO_AR;

  // 1. Subir archivos al storage
  console.log('  ⏳ Subiendo documentos...');
  await uploadFile(c.cmfLocal, cmfPath, 'CMF');
  if (c.ctLocal) await uploadFile(c.ctLocal, ctPath, 'Carpeta Tributaria');
  else console.log(`    ↩ CT: reutilizando ${PATO_CT}`);
  if (c.arLocal) await uploadFile(c.arLocal, arPath, 'Agente Retenedor');
  else console.log(`    ↩ AR: reutilizando ${PATO_AR}`);

  // 2. Upsert en clients
  console.log('  ⏳ Creando/actualizando fila en clients...');
  const { data: row, error: upsertErr } = await sb
    .from('clients')
    .upsert(
      {
        rut: c.rut,
        name: c.name,
        clave_unica_rut:      process.env.CLAVE_UNICA_RUT ?? '21917363-6',
        clave_unica_password: process.env.CLAVE_UNICA_PASSWORD ?? '',
        informe_cmf_path:          cmfPath,
        carpeta_tributaria_path:   ctPath,
        carpeta_retenedores_path:  arPath,
        acreditacion_documentos_json: [],
      },
      { onConflict: 'rut' }
    )
    .select('id, rut, name')
    .single();

  if (upsertErr || !row) throw new Error(`Upsert clients (${c.rut}): ${upsertErr?.message}`);
  console.log(`    ✓ clients.id = ${row.id}`);

  // 3. Limpiar client_documents previos
  const { data: deleted, error: delErr } = await sb
    .from('client_documents')
    .delete()
    .eq('client_id', row.id)
    .select('id');
  if (delErr) throw new Error(`Delete client_documents: ${delErr.message}`);
  if (deleted?.length) console.log(`    ✓ ${deleted.length} client_document(s) previos eliminados`);
  else console.log('    ✓ client_documents vacío (sin registros previos)');

  console.log(`  ✅ Listo — cmf:${cmfPath} | ct:${ctPath} | ar:${arPath}`);
}

async function run() {
  console.log('🔧 Setup masivo — 5 clientes pendientes\n');
  let ok = 0;
  for (const c of CLIENTES) {
    try {
      await setupCliente(c);
      ok++;
    } catch (err) {
      console.error(`  ❌ ERROR en ${c.name}: ${(err as Error).message}`);
    }
  }
  console.log(`\n🎉 Completado: ${ok}/${CLIENTES.length} clientes configurados.`);
  if (ok === CLIENTES.length) {
    console.log('\n📋 Resumen de storage prefixes:');
    CLIENTES.forEach(c => console.log(`   ${c.prefix}/  →  ${c.name}`));
  }
}

run().catch(err => { console.error('🚨', err.message); process.exit(1); });
