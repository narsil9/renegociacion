/**
 * Resolver de institución por certificado — asocia cada documento de
 * `client_documents` a un acreedor de `acreedores_canonicos` SIN intervención
 * manual del abogado. Corre en el worker ANTES del Centinela.
 *
 * Estrategia (en orden de prioridad):
 *   1. **Por RUT** (lo más exacto): `pdftotext` del cert → `extractRutsFromText`
 *      → `findCatalogEntryByRut`. Si hay match, sobrescribe `institucion_cmf`
 *      (el RUT manda sobre cualquier valor previo del dashboard).
 *   2. **Por nombre de archivo** (fallback para escaneados sin RUT extraíble):
 *      keyword map → `matchAcreedor`. Solo RELLENA cuando `institucion_cmf` está
 *      vacío (no pisa un valor existente).
 *
 * El valor derivado se PERSISTE en `client_documents.institucion_cmf`, de modo
 * que tanto el Centinela (que lee la tabla) como el Mapeador determinista
 * (que la recarga) usan la asociación correcta, y el panel /automatizacion la
 * muestra. Best-effort: cualquier fallo por cert se loguea y se omite sin
 * interrumpir el flujo (el Centinela igual identifica por contenido/imagen).
 *
 * Diseño deliberado: NO hace OCR (Tesseract). El OCR es caro y es trabajo del
 * Centinela; acá solo `pdftotext` (rápido). Los certs escaneados sin texto caen
 * al fallback por nombre de archivo, y si tampoco resuelven, los identifica
 * Claude en el Centinela (por imagen) y se adjuntan por `document_filename`.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { extractTextFromPdf } from './pdf_analyzer';
import {
  fetchAcreedoresCatalog,
  extractRutsFromText,
  findCatalogEntryByRut,
  matchAcreedor,
  AcreedorCatalogEntry,
} from './acreedor_matcher';

export interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/**
 * Fallback por nombre de archivo → fragmento de nombre canónico (se resuelve
 * con `matchAcreedor`, que es alias-aware y tolera variaciones del catálogo).
 * Orden importante: las reglas más específicas van primero (ej. "banco
 * falabella" antes que "falabella"/"cmr") para desambiguar Banco Falabella vs.
 * la tarjeta CMR Falabella.
 */
const FILENAME_KEYWORDS: { keys: string[]; target: string }[] = [
  { keys: ['bancoestado', 'banco estado', 'bancodelestado'], target: 'BANCO DEL ESTADO DE CHILE' },
  { keys: ['bancodechile', 'banco de chile', 'bancochile'], target: 'BANCO DE CHILE' },
  { keys: ['bancofalabella', 'banco falabella'], target: 'BANCO FALABELLA' },
  { keys: ['santanderconsumer'], target: 'SANTANDER CONSUMER' },
  { keys: ['santander'], target: 'BANCO SANTANDER' },
  { keys: ['scotiabank', 'scotia'], target: 'SCOTIABANK CHILE' },
  { keys: ['itau', 'itaú'], target: 'BANCO ITAU' },
  { keys: ['bci'], target: 'BANCO CREDITO E INVERSIONES' },
  { keys: ['ripley'], target: 'CAR RIPLEY' },
  { keys: ['cmr'], target: 'CMR FALABELLA' },
  { keys: ['falabella'], target: 'CMR FALABELLA' },
  { keys: ['cencosud', 'tarjeta cat', 'cat '], target: 'CAT (ex CENCOSUD)' },
  { keys: ['tenpo'], target: 'TENPO' },
  { keys: ['tricard', 'tricot', 'solucard'], target: 'TRICARD' },
  // Hites: el catálogo tiene 3 entradas "Hites" (dos comparten RUT 85325100-3 y
  // "Empresas Hites S.A." con otro RUT). Apuntamos a la EMISORA de la tarjeta que
  // usa el abogado — "INVERSIONES Y TARJETAS S.A (HITES)" (RUT 85325100-3) — que
  // matchea único por Tier-1 exacto. (Antes 'HITES' daba ambiguo y se saltaba.)
  { keys: ['hites'], target: 'INVERSIONES Y TARJETAS S.A (HITES)' },
  { keys: ['la polar', 'lapolar'], target: 'Empresas La Polar S.A.' },
  // OJO: NO mapear el genérico 'abc' → COFISA: el archivo "ESTADO_CTA_ABC" del caso
  // Gabriel resultó ser de La Polar (no ABCDIN). El emisor real lo decide el Centinela
  // por el CONTENIDO (marca de la tarjeta). Solo keywords inequívocas de ABCDIN acá.
  { keys: ['abcdin', 'abc din', 'cofisa'], target: 'COFISA' },
  { keys: ['mercadopago', 'mercado pago'], target: 'MERCADO PAGO' },
  { keys: ['coopeuch'], target: 'COOPEUCH' },
  { keys: ['los andes'], target: 'CCAF LOS ANDES' },
  { keys: ['la araucana'], target: 'CCAF LA ARAUCANA' },
  { keys: ['los heroes', 'los héroes'], target: 'CCAF LOS HEROES' },
  { keys: ['18 de septiembre'], target: 'CCAF 18 DE SEPTIEMBRE' },
  { keys: ['presto', 'lider', 'líder'], target: 'TARJETA LIDER' },
];

/** Devuelve el fragmento de nombre canónico según el nombre de archivo, o null. */
export function guessTargetFromFilename(filename: string): string | null {
  const norm = filename.toLowerCase().replace(/_/g, ' ');
  for (const { keys, target } of FILENAME_KEYWORDS) {
    if (keys.some((k) => norm.includes(k))) return target;
  }
  return null;
}

interface ResolvedDoc {
  filename: string;
  previous: string | null;
  resolved: string | null;
  source: 'rut' | 'filename' | 'unchanged';
}

export interface ResolveResult {
  resolved: ResolvedDoc[];
  updatedCount: number;
}

/**
 * Resuelve y persiste `institucion_cmf` para cada certificado del cliente.
 * Best-effort: nunca lanza por un cert individual.
 */
export async function resolveCertInstitutions(
  supabase: SupabaseClient,
  client: { id: string; rut?: string | null },
  logger: SimpleLogger
): Promise<ResolveResult> {
  const log = (msg: string) => logger.log(`🔗 [Resolver] ${msg}`);
  const result: ResolveResult = { resolved: [], updatedCount: 0 };

  // 1. Catálogo
  let catalog: AcreedorCatalogEntry[] = [];
  try {
    catalog = await fetchAcreedoresCatalog(supabase);
  } catch (err) {
    logger.error('🔗 [Resolver] No se pudo cargar el catálogo acreedores_canonicos; se omite la auto-asociación.', err);
    return result;
  }
  if (catalog.length === 0) {
    log('Catálogo vacío; se omite la auto-asociación por RUT.');
    return result;
  }

  // 2. Documentos del cliente
  const { data: docs, error: docsErr } = await supabase
    .from('client_documents')
    .select('id, filename, storage_path, institucion_cmf')
    .eq('client_id', client.id);
  if (docsErr) {
    logger.error('🔗 [Resolver] Error consultando client_documents; se omite.', docsErr.message);
    return result;
  }
  if (!docs || docs.length === 0) {
    log('Sin certificados en client_documents; nada que resolver.');
    return result;
  }

  const tmpDir = path.join(process.cwd(), 'outputs', 'acreditaciones_tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  log(`Resolviendo institución de ${docs.length} certificado(s) por RUT (fallback: nombre de archivo)...`);

  for (const doc of docs) {
    let resolvedName: string | null = null;
    let source: 'rut' | 'filename' | 'unchanged' = 'unchanged';

    try {
      // Descargar y extraer texto (pdftotext, sin OCR)
      const ext = path.extname(doc.storage_path) || '.pdf';
      const localPath = path.join(tmpDir, `resolve_${path.basename(doc.storage_path, ext)}${ext}`);
      if (!fs.existsSync(localPath)) {
        const { data, error } = await supabase.storage.from('documentos').download(doc.storage_path);
        if (error || !data) throw new Error(error?.message || 'descarga vacía');
        fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
      }

      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext.toLowerCase());
      const text = isImage ? '' : await extractTextFromPdf(localPath).catch(() => '');

      // Prioridad 1: RUT (lo más exacto). Sobrescribe cualquier valor previo.
      const ruts = text ? extractRutsFromText(text) : [];
      const rutEntry = findCatalogEntryByRut(ruts, catalog, client.rut ?? null);
      if (rutEntry) {
        resolvedName = rutEntry.nombre;
        source = 'rut';
      } else {
        // Prioridad 2: nombre de archivo. Solo RELLENA si está vacío.
        const target = guessTargetFromFilename(doc.filename);
        if (target && !doc.institucion_cmf) {
          const m = matchAcreedor(target, catalog);
          if (m.status === 'matched' && m.entry) {
            resolvedName = m.entry.nombre;
            source = 'filename';
          }
        }
      }
    } catch (err) {
      logger.error(`🔗 [Resolver] No se pudo procesar "${doc.filename}" (se omite):`, err instanceof Error ? err.message : err);
    }

    const shouldWrite =
      resolvedName !== null &&
      // RUT: siempre escribe si difiere del valor actual.
      // Filename: solo cuando estaba vacío (la condición ya se aplicó arriba).
      resolvedName !== doc.institucion_cmf;

    result.resolved.push({
      filename: doc.filename,
      previous: doc.institucion_cmf ?? null,
      resolved: resolvedName,
      source: shouldWrite ? source : 'unchanged',
    });

    if (shouldWrite) {
      const { error: updErr } = await supabase
        .from('client_documents')
        .update({ institucion_cmf: resolvedName })
        .eq('id', doc.id);
      if (updErr) {
        logger.error(`🔗 [Resolver] No se pudo persistir institución de "${doc.filename}":`, updErr.message);
      } else {
        result.updatedCount += 1;
        const via = source === 'rut' ? 'RUT' : 'nombre de archivo';
        const from = doc.institucion_cmf ? `"${doc.institucion_cmf}" → ` : '';
        log(`  ✓ ${doc.filename}: ${from}"${resolvedName}" (por ${via})`);
      }
    } else {
      const keep = doc.institucion_cmf ? `"${doc.institucion_cmf}"` : '∅';
      log(`  · ${doc.filename}: sin cambio (${keep})${resolvedName ? ` — derivado "${resolvedName}" coincide` : ' — no se pudo derivar por RUT/nombre; lo identificará el Centinela'}`);
    }
  }

  log(`Auto-asociación completada: ${result.updatedCount}/${docs.length} certificado(s) actualizado(s).`);
  return result;
}
