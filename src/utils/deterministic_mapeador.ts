/**
 * Mapeador determinista — construye MapeadorOutput desde el output del Centinela
 * + client_documents sin llamar a Claude.
 *
 * Reemplaza la segunda llamada LLM del Mapeador (cognitive_orchestrator.ts).
 * El Centinela ya resolvió qué documento corresponde a qué acreedor via
 * `document_filename`. Aquí solo hacemos los lookups en memoria.
 *
 * Cobertura:
 *   1. Reclassified (261→260) — match por `document_filename` + doc complementario
 *   2. Identified261 — match por `document_filename`, fallback por institución
 *   3. No-CMF (additionalCreditors) — match por `document_filename`
 *   4. Direct 260 del CMF (overdue90Days > 0) — match por institución
 *   5. 261 del CMF sin Centinela — match por institución (fallback DISABLE_SENTINEL=true)
 */

import { CentinelaOutput, MapeadorOutput } from '../agents/types';
import { ClientDocument, CognitiveAlert } from './cognitive_orchestrator';
import { AcreditacionDoc } from '../automation/step3_acreedores';
import { CmfCreditor } from './cmf_analyzer';
import { canonicalInstitutionKey } from './acreedor_matcher';

interface SimpleLogger {
  log(msg: string): void;
}

/** Normaliza nombre de institución para comparación fuzzy (mismo algoritmo que step3). */
function normInst(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findDocsByInstitution(
  institucion: string,
  docs: ClientDocument[],
  excludeFilenames: Set<string>
): ClientDocument[] {
  const target = normInst(institucion);
  const targetKey = canonicalInstitutionKey(institucion); // A1: alias-aware
  return docs.filter(d => {
    if (!d.institucion_cmf) return false;
    if (d.filename && excludeFilenames.has(d.filename)) return false;
    const n = normInst(d.institucion_cmf);
    if (n === target || target.includes(n) || n.includes(target)) return true;
    // A1: fallback alias-aware (nombre canónico del dashboard vs nombre del CMF).
    const key = canonicalInstitutionKey(d.institucion_cmf);
    return key !== '' && key === targetKey;
  });
}

function toAcreditacionDoc(
  doc: ClientDocument,
  institucion: string,
  tipoOverride?: 22 | 23 | 24
): AcreditacionDoc {
  return {
    institucion_cmf: institucion,
    tipo_documento: tipoOverride ?? (doc.document_type as 22 | 23 | 24),
    storage_path: doc.storage_path,
    local_path: doc.local_path,
    filename: doc.filename,
  };
}

/**
 * Construye MapeadorOutput determinístico desde el output del Centinela
 * y la tabla client_documents. Sin llamadas a la API de Anthropic.
 */
export async function buildMappedDocsDeterministic(
  centinelaOutput: CentinelaOutput,
  clientDocuments: ClientDocument[],
  cmfCreditors: CmfCreditor[],
  logger: SimpleLogger
): Promise<MapeadorOutput> {
  const log = (msg: string) => logger.log(`[DeterministicMapeador] ${msg}`);

  const mappedDocs: AcreditacionDoc[] = [];
  const alerts: CognitiveAlert[] = [];
  // Dedup: evitar el mismo (storage_path, tipo) dos veces
  const addedKeys = new Set<string>();

  const reservedNonCmfFilenames = new Set(
    centinelaOutput.additionalCreditors.map(a => a.document_filename).filter(Boolean)
  );

  function pushDoc(doc: ClientDocument, institucion: string, tipoOverride?: 22 | 23 | 24): void {
    const tipo = tipoOverride ?? (doc.document_type as 22 | 23 | 24);
    const key = `${doc.storage_path}:${tipo}`;
    if (addedKeys.has(key)) return;
    addedKeys.add(key);
    mappedDocs.push(toAcreditacionDoc(doc, institucion, tipo));
    log(`  ✓ ${doc.filename} → "${institucion}" (tipo ${tipo})`);
  }

  // ─── 1. Reclasificados (261→260) ───────────────────────────────────────────
  log(`Procesando ${centinelaOutput.reclassifiedCreditors.length} acreedores reclasificados...`);
  for (const r of centinelaOutput.reclassifiedCreditors) {
    const primaryDoc = clientDocuments.find(
      d => d.filename?.toLowerCase() === r.document_filename.toLowerCase()
    );
    if (!primaryDoc) {
      alerts.push({
        type: 'missing_document',
        message: `Reclasificado "${r.bank}": "${r.document_filename}" no encontrado en client_documents.`,
      });
      log(`  ⚠️ FALTA "${r.document_filename}" para reclasificado "${r.bank}"`);
      continue;
    }
    pushDoc(primaryDoc, r.institucion_cmf);

    // Buscar documento complementario (monto↔vencimiento) por institución
    const complementary = findDocsByInstitution(r.institucion_cmf, clientDocuments, reservedNonCmfFilenames)
      .filter(d => d.filename !== primaryDoc.filename);

    if (primaryDoc.document_type === 22) {
      const vencDoc = complementary.find(d => d.document_type === 23);
      if (vencDoc) pushDoc(vencDoc, r.institucion_cmf);
    } else if (primaryDoc.document_type === 23) {
      const montoDoc = complementary.find(d => d.document_type === 22);
      if (montoDoc) pushDoc(montoDoc, r.institucion_cmf);
    }
    // tipo 24 cubre monto+vencimiento — no necesita complementario
  }

  // ─── 2. Identificados 261 ──────────────────────────────────────────────────
  log(`Procesando ${centinelaOutput.identified261Creditors.length} acreedores Art.261...`);
  for (const c of centinelaOutput.identified261Creditors) {
    const primaryDoc = clientDocuments.find(
      d => d.filename?.toLowerCase() === c.document_filename.toLowerCase()
    );
    if (primaryDoc) {
      pushDoc(primaryDoc, c.institucion_cmf, 22);
    } else {
      // Fallback: buscar por institución con document_type 22 o 24
      const fallback = findDocsByInstitution(c.institucion_cmf, clientDocuments, reservedNonCmfFilenames)
        .find(d => d.document_type === 22 || d.document_type === 24);
      if (fallback) {
        pushDoc(fallback, c.institucion_cmf, 22);
        log(`  ⚠️ "${c.bank}": "${c.document_filename}" no encontrado — fallback por institución (${fallback.filename})`);
      } else {
        alerts.push({
          type: 'missing_document',
          message: `Art.261 "${c.bank}": "${c.document_filename}" no encontrado en client_documents.`,
        });
        log(`  ⚠️ FALTA "${c.document_filename}" para Art.261 "${c.bank}"`);
      }
    }
  }

  // ─── 3. No-CMF (additionalCreditors) ───────────────────────────────────────
  log(`Procesando ${centinelaOutput.additionalCreditors.length} acreedores NO-CMF...`);
  for (const a of centinelaOutput.additionalCreditors) {
    const doc = clientDocuments.find(
      d => d.filename?.toLowerCase() === a.document_filename.toLowerCase()
    );
    if (doc) {
      const tipo: 22 | 24 = a.categoria_articulo === 260 ? 24 : 22;
      // NO-CMF creditors have no institucion_cmf (null) — use bank name instead
      pushDoc(doc, a.institucion_cmf ?? a.bank, tipo);
    } else {
      alerts.push({
        type: 'missing_document',
        message: `NO-CMF "${a.bank}": "${a.document_filename}" no encontrado en client_documents.`,
      });
      log(`  ⚠️ FALTA "${a.document_filename}" para NO-CMF "${a.bank}"`);
    }
  }

  // ─── 4. Art.260 directos del CMF (overdue90Days > 0, no reclasificados) ───
  const reclassifiedNormSet = new Set(
    centinelaOutput.reclassifiedCreditors.map(r => normInst(r.institucion_cmf))
  );
  // Acreedores ya cubiertos por el Centinela (para no duplicar con la fase 5)
  const centinelaHandledNorm = new Set([
    ...centinelaOutput.reclassifiedCreditors.map(r => normInst(r.institucion_cmf)),
    ...centinelaOutput.identified261Creditors.map(c => normInst(c.institucion_cmf)),
    ...centinelaOutput.additionalCreditors.map(a => normInst(a.institucion_cmf ?? a.bank)),
  ]);

  const direct260 = cmfCreditors.filter(c => c.overdue90Days > 0);
  log(`Procesando ${direct260.length} acreedores Art.260 directos del CMF...`);
  for (const c of direct260) {
    // Saltar si el Centinela ya los cubrió como reclasificados (overdue90Days === 0 en CMF)
    // En la práctica no debería pasar (260 directo ≠ reclasificado), pero por seguridad:
    if (reclassifiedNormSet.has(normInst(c.institucion))) continue;

    const docsForInst = findDocsByInstitution(c.institucion, clientDocuments, reservedNonCmfFilenames);
    if (docsForInst.length === 0) {
      alerts.push({
        type: 'missing_document',
        message: `Art.260 directo "${c.institucion}": no se encontraron documentos en client_documents.`,
      });
      log(`  ⚠️ FALTA documento para Art.260 directo "${c.institucion}"`);
      continue;
    }
    for (const doc of docsForInst) {
      pushDoc(doc, c.institucion);
    }
  }

  // ─── 5. Art.261 del CMF no cubiertos por el Centinela ─────────────────────
  // Aplica cuando DISABLE_SENTINEL=true o cuando el Centinela no cubrió algún acreedor.
  const unhandled261 = cmfCreditors.filter(
    c => c.overdue90Days === 0 && !centinelaHandledNorm.has(normInst(c.institucion))
  );
  if (unhandled261.length > 0) {
    log(`Procesando ${unhandled261.length} acreedores Art.261 no cubiertos por Centinela...`);
    for (const c of unhandled261) {
      const docsForInst = findDocsByInstitution(c.institucion, clientDocuments, reservedNonCmfFilenames);
      for (const doc of docsForInst) {
        pushDoc(doc, c.institucion, 22);
      }
    }
  }

  log(`Mapeo completado: ${mappedDocs.length} docs → ${alerts.length} alertas.`);
  return { mappedDocs, alerts };
}
