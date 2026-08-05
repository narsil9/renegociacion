import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { extractTextFromPdf } from './pdf_analyzer';
import { getCurrentChileDate, getDaysDifference, parseDateString } from './date_helper';
import { analyzeCmfPdf, CmfCreditor } from './cmf_analyzer';
import {
  fetchAcreedoresCatalog,
  matchAcreedor,
  normalizeRut,
  normalizeText,
  extractRutsFromText,
  findCatalogEntryByRut,
  canonicalInstitutionKey,
  AcreedorCatalogEntry,
} from './acreedor_matcher';
import { extractDatesFromText, extractEmissionDateFromText, ClientDocument } from './cognitive_orchestrator';
import { contentHash } from './document_reads';
import { runPerDocExtraction } from './sentinel_per_doc';
import { loadReaderLessons } from './lessons_loader';
import { applyDeterministicBackstops, isChatDocument, classifyNonAccreditingDoc } from './sentinel_backstops';
import { esDocumentoDeIngreso } from './doc_scope';
// Re-export para compatibilidad (otros módulos/tests importan estos helpers desde sentinel.ts).
export { isChatDocument, classifyNonAccreditingDoc } from './sentinel_backstops';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Tope de tamaño por PDF para adjuntarlo NATIVO a Claude (#1). Acotado para no acercarse
// al límite de ~32MB por request cuando hay varios certificados. Si excede, se alerta.
const NATIVE_PDF_MAX_BYTES = 6 * 1024 * 1024;
// Umbral de densidad: por debajo de esto (chars de texto digital / página) el PDF es
// sospechoso de ser un escaneo con una capa de texto mínima/parcial → leer nativo con Claude.
const MIN_CHARS_PER_PAGE = 200;

/** Nº de páginas del PDF vía `pdfinfo` (poppler). null si no se puede determinar. */
function pdfPageCount(localPath: string): number | null {
  try {
    const out = execFileSync('pdfinfo', [localPath], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const m = out.match(/^Pages:\s*(\d+)/m);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Decide si un PDF debe leerse NATIVAMENTE con Claude (mejora #1) en vez de confiar en el texto
 * extraído por `pdftotext`. Filosofía: el texto SOLO se confía cuando `pdftotext` leyó una capa
 * de texto limpia y completa; ante CUALQUIER duda → Claude lee el PDF nativo (lee mucho mejor que
 * el OCR, comprobado). Tesseract queda ELIMINADO del flujo. Señales de duda (con una basta):
 *   1. Texto casi vacío (< 50 chars)         → PDF-imagen (escaneo/foto).
 *   2. Imagen raster GRANDE embebida (≥600px) → screenshot/foto adentro con el dato.
 *   3. Densidad de texto baja por página      → escaneo con capa de texto mínima/parcial.
 * Devuelve el MOTIVO (para loguear) o null si el texto es confiable. Best-effort ante fallos.
 */
function pdfNativeReason(localPath: string, extractedTextLen: number): string | null {
  if (extractedTextLen < 50) return 'texto casi vacío (escaneo/foto)';
  // Señal 2 — imagen grande embebida (no logos/sellos chicos).
  try {
    const out = execFileSync('pdfimages', ['-list', localPath], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^\d+\s+\d+\s+\w+\s+(\d+)\s+(\d+)\b/);
      if (!m) continue;
      if (parseInt(m[1], 10) >= 600 && parseInt(m[2], 10) >= 600) {
        return 'imagen grande embebida (screenshot/foto adentro)';
      }
    }
  } catch { /* pdfimages ausente/erróneo → seguir con las otras señales */ }
  // Señal 3 — densidad de texto baja por página.
  const pages = pdfPageCount(localPath);
  if (pages && pages > 0 && extractedTextLen / pages < MIN_CHARS_PER_PAGE) {
    return `densidad de texto baja (~${Math.round(extractedTextLen / pages)} chars/página en ${pages} pág.)`;
  }
  return null;
}

/**
 * Evidencia de extracción que Claude reporta por acreedor (Capa 0 de validación anti-error).
 * Son los DATOS VERIFICABLES que permiten a TypeScript chequear lo que Claude leyó del PDF
 * nativo, en vez de confiar a ciegas. NO deciden la estructura (260/261, split): solo se
 * validan contra fuentes deterministas (catálogo de RUT, filas del CMF, la propia cita).
 */
export interface ExtractionEvidence {
  /** RUT del EMISOR del certificado tal como aparece impreso (XXXXXXXX-X). */
  rut_emisor?: string;
  /** Nombre del EMISOR tal como lo leyó el LLM del cert (logo/encabezado). Se usa para resolver
   *  el catálogo cuando el nombre del CMF llega mangleado/truncado (ej. CCAF "Caja Los Andes"). */
  emisor_nombre?: string;
  /** Nº de operación/contrato/tarjeta del producto, para desambiguar multiproducto/dedup. */
  numero_operacion?: string;
  /** Moneda del monto leído: "UF" (probable vivienda) o "CLP". */
  moneda?: 'UF' | 'CLP';
  /** Fragmento VERBATIM del documento de donde Claude leyó el monto (anti-alucinación). */
  cita_monto?: string;
  /** Fragmento VERBATIM de donde leyó la fecha de mora/vencimiento. */
  cita_fecha?: string;
  /** Confianza 0..1 de la lectura de ESTE certificado. */
  confidence?: number;
}

/** Discrepancia detectada por TS entre lo que Claude reportó y las fuentes deterministas. */
export interface ClaudeReadIssue {
  document_filename: string;
  institucion: string;
  monto_clp: number;
  tipo: 'monto_sin_respaldo_en_cita' | 'rut_no_coincide' | 'baja_confianza' | 'sin_evidencia' | 'documento_no_acredita' | 'moneda_inconsistente' | 'posible_duplicado' | 'posible_subdivision_operacion' | 'monto_trivial' | 'fecha_no_acreditada' | 'nombre_de_archivo_repetido' | 'identidad_no_confirmada' | 'institucion_no_resuelta' | 'fecha_mora_discrepante';
  detalle: string;
}

export interface ReclassifiedCreditor {
  bank: string;
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'otro';
  institucion_cmf: string;
  delinquency_start_date: string; // YYYY-MM-DD
  delinquency_days: number;
  total_credito_clp: number;
  new_classification: 'obligaciones_260';
  reason: string;
  document_filename: string;
  evidence?: ExtractionEvidence;
}

export interface Identified261Creditor {
  bank: string;
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'otro';
  institucion_cmf: string;
  total_credito_clp: number;
  reason: string;
  document_filename: string;
  evidence?: ExtractionEvidence;
}

export interface DeReclassified261Creditor {
  bank: string;
  institucion_cmf: string;
  total_credito_clp: number;
  reason: string;
  document_filename: string;
  /**
   * true = NO es una de-reclasificación de la REGLA 10 (el certificado certifica la deuda
   * VIGENTE), sino una DEGRADACIÓN del backstop por no poder acreditar el vencimiento. La
   * distinción importa para el requisito de fondo: si el certificado dice "vigente", la mora
   * del CMF no existe y ese producto NO cuenta; si solo falta el documento del vencimiento,
   * la mora SÍ existe y el producto SIGUE contando para los 2 productos con 91+ días.
   */
  degradedForMissingVenc?: boolean;
  /**
   * Cuál de las tres ramas del backstop degradó esta deuda. Es la respuesta a "¿por qué
   * quedó en 261?", y hasta ahora solo existía en una línea de log:
   *   · BACKSTOP_OVERRIDE_DEGRADADO — había un override 260 pero sin fecha de vencimiento acreditada.
   *   · BACKSTOP_SIN_DOCUMENTO     — mora 90+d en el CMF y ningún documento del acreedor.
   *
   * NO existe un valor para "el banco ya está cubierto por sus productos": esa rama del
   * backstop hace `continue` sin emitir fila, para no duplicar el pasivo con el total del CMF.
   */
  rule_id: 'BACKSTOP_OVERRIDE_DEGRADADO' | 'BACKSTOP_SIN_DOCUMENTO';
  /** La misma evidencia que llevan sus cuatro tipos hermanos: cita textual, confianza, RUT del emisor. */
  evidence?: ExtractionEvidence;
}

/**
 * Acreedor que NO aparece en el Informe CMF pero que igual debe declararse en
 * el Paso 3 (Art. 261 obliga a declarar todos los pasivos): TGR, cajas de
 * compensación, fintechs (Mercado Pago, Tenpo), tarjetas no reportadas, etc.
 * Detectado por reconciliación (diff documentos − CMF): TypeScript marca los
 * candidatos y Claude confirma/extrae los campos.
 */
export interface AdditionalCreditor {
  bank: string;
  institucion_cmf: string;              // nombre para matchear contra acreedores_canonicos
  product_type: 'credito_consumo' | 'tarjeta_credito' | 'tgr' | 'caja_compensacion' | 'otro';
  categoria_articulo: 260 | 261;
  total_credito_clp: number;
  delinquency_start_date?: string;      // YYYY-MM-DD, solo si es 260
  delinquency_days?: number;            // solo si es 260
  reason: string;                       // por qué no está en el CMF y por qué se declara
  document_filename: string;
  needs_lawyer_confirmation: boolean;   // flag — siempre true en esta fase
  evidence?: ExtractionEvidence;
}

/** Fecha clave calculada determinísticamente (sin Claude) para alertar al abogado. */
export interface FechaClave {
  tipo: 'expiracion_cmf' | 'expiracion_certificado' | 'cruce_261_a_260';
  referencia: string;        // nombre del documento o acreedor
  fecha: string;             // YYYY-MM-DD
  diasRestantes: number;     // negativo si ya pasó
  detalle: string;
}

/**
 * Monto y fecha real extraídos por Claude del certificado de acreditación para
 * un acreedor que ya aparece en el CMF con overdue90Days > 0 (Art.260 directo).
 * Reemplaza el monto del CMF (desactualizado) y el placeholder dateDaysAgo(90).
 */
export interface Cmf260DirectOverride {
  institucion_cmf: string;
  monto_clp: number;
  fecha_vencimiento: string;   // YYYY-MM-DD
  document_filename: string;
  evidence?: ExtractionEvidence;
}

export interface SentinelResult {
  success: boolean;
  errors: string[];
  technicalError?: boolean; // true = API/red/código; false/undefined = semántico (docs deficientes)
  reclassifiedCreditors?: ReclassifiedCreditor[];
  identified261Creditors?: Identified261Creditor[];
  additionalCreditors?: AdditionalCreditor[];
  /** Monto y fecha real desde certificado para Art.260 directos del CMF (overdue90Days > 0). */
  cmf260DirectOverrides?: Cmf260DirectOverride[];
  /** Productos que el CMF marca 90+d pero cuyo certificado los certifica vigentes → 260→261. */
  deReclassified261Creditors?: DeReclassified261Creditor[];
  /** Discrepancias entre lo que Claude reportó y las fuentes deterministas (validación anti-error). */
  claudeReadIssues?: ClaudeReadIssue[];
  fechasClave?: FechaClave[];
  details: {
    meets90DaysRequirement: boolean;
    meetsAmountRequirement: boolean;
    totalAmountCLP: number;
    creditorsWith90DaysCount: number;
    documentsAgeValid: boolean;
    requiredCertificatesPresent: boolean;
  };
}

export interface ClientProfile {
  id: string;
  name: string;
  rut: string;
  informe_cmf_path?: string | null;
  acreditacion_documentos_json?: any;
  [key: string]: any;
}

export interface SimpleLogger {
  log(msg: string): void;
  error(msg: string, err?: any): void;
}

/**
 * Recorta el texto de un documento para enviarlo a Claude SIN perder el período
 * más reciente. Los estados de cuenta multi-período (varias páginas, un mes por
 * bloque) suelen venir en orden cronológico ASCENDENTE → el período MÁS RECIENTE
 * está al FINAL del PDF. Truncar solo el inicio (`substring(0, N)`) dejaba afuera
 * los meses recientes y el Centinela leía el más viejo (monto y clasificación
 * 260/261 equivocados). Solución: enviar el INICIO (encabezado/emisor + primer
 * período) + el FINAL (período más reciente), con un marcador del corte. Para
 * docs cortos devuelve el texto completo. Robusto al orden: si el más reciente
 * estuviera al inicio, igual queda incluido.
 */
const DOC_HEAD_CHARS = 3500;
const DOC_TAIL_CHARS = 9000;
export function clampDocTextForClaude(text: string): string {
  const t = text ?? '';
  if (t.length <= DOC_HEAD_CHARS + DOC_TAIL_CHARS) return t;
  return (
    t.slice(0, DOC_HEAD_CHARS) +
    '\n\n[…FRAGMENTO INTERMEDIO OMITIDO POR LONGITUD. Arriba: INICIO del documento (emisor/encabezado + período más antiguo). Abajo: FINAL del documento, donde normalmente está el período MÁS RECIENTE — usá ESE para el monto y la clasificación 260/261…]\n\n' +
    t.slice(-DOC_TAIL_CHARS)
  );
}

/**
 * Colapsa los documentos que son el MISMO papel.
 *
 * Por qué hace falta: el proyector del panel arma el destino como
 * `{rut}/certs/{email-<id>|drive-<id>}_{filename}`, así que un PDF que existe como
 * adjunto de correo Y como archivo de Drive genera dos rutas, dos objetos en el bucket
 * y dos filas en `client_documents`. Su dedup compara `storage_path`, que difiere.
 * Acá se compara el CONTENIDO.
 *
 * Un documento sin `sha256` nunca se agrupa: se le da una clave propia. Es preferible
 * leer de más a colapsar dos papeles distintos.
 *
 * Desempate: gana la copia con MÁS INFORMACIÓN, no cualquiera. Las dos filas del proyector
 * NO son intercambiables — el resolver de instituciones corre por fila y resuelve por RUT o,
 * si falla, por NOMBRE DE ARCHIVO (que difiere entre copias), y el abogado puede haber
 * asignado la institución a mano a una sola de las dos. Si gana la copia sin
 * `institucion_cmf`, se pierde el ancla del CMF en el prompt, el banco queda sin documento
 * asociado y el backstop inyecta el TOTAL DEL CMF en Art. 261 en vez del monto del certificado.
 * Orden: (1) `institucion_cmf` no vacía, (2) `document_type` 22/23 (acredita monto o
 * vencimiento), (3) más períodos (`n_periodos`, el criterio original — misma regla que el
 * dedup del Centinela: un PDF con los últimos 4 estados vale más que el estado suelto).
 */
export function puntajeInfoCopia(
  d: { institucion_cmf?: string | null; document_type?: number | null; n_periodos?: number }
): [number, number, number] {
  return [
    (d.institucion_cmf ?? '').trim() ? 1 : 0,
    d.document_type === 22 || d.document_type === 23 ? 1 : 0,
    d.n_periodos ?? 1,
  ];
}

/**
 * Detecta documentos DISTINTOS que comparten `filename`.
 *
 * Medio pipeline asocia por nombre de archivo: `__docTypeByFilename`, `docsByFilename` y
 * `textByFilename` de los backstops, el `detectedByFilename` del cross-check de RUT, el
 * `document_filename` de cada fila declarada, y —lo más grave— la elección de QUÉ archivo se
 * adjunta al portal para un acreedor NO-CMF (`step3_acreedores.ts:1287,1395`). Todos esos son
 * `Map`/objeto por nombre: con dos documentos homónimos, uno pisa al otro y el caso se declara
 * con los datos mezclados, en silencio.
 *
 * Hoy no pasa (0 nombres repetidos en producción, medido el 2026-07-29), pero se vuelve
 * probable con nombres genéricos —`imagen.jpg`, `documento.pdf`, `Compressed PDF.pdf`— que es
 * justo lo que llega por correo y por Drive.
 *
 * Esto NO lo arregla: lo hace VISIBLE (regla G2). Arreglarlo de raíz es desambiguar el nombre
 * en las DOS listas de documentos que carga el worker por separado —la del Centinela y la que
 * recibe `fillStep3`— y eso toca el camino que adjunta documentos a una presentación judicial;
 * merece su propio ciclo, no un parche al final de una sesión.
 *
 * Se llama DESPUÉS de `dedupPorContenido`: dos copias del MISMO archivo ya colapsaron y no
 * deben alertar.
 */
export function detectarNombresRepetidos(
  docs: Array<{ filename: string; storage_path: string }>
): ClaudeReadIssue[] {
  const porNombre = new Map<string, string[]>();
  for (const d of docs) {
    const k = (d.filename ?? '').trim().toLowerCase();
    if (!k) continue;
    if (!porNombre.has(k)) porNombre.set(k, []);
    porNombre.get(k)!.push(d.storage_path);
  }
  const issues: ClaudeReadIssue[] = [];
  for (const [nombre, rutas] of porNombre) {
    if (rutas.length < 2) continue;
    issues.push({
      document_filename: nombre,
      institucion: '',
      monto_clp: 0,
      tipo: 'nombre_de_archivo_repetido',
      detalle:
        `${rutas.length} documentos distintos del caso se llaman "${nombre}". El robot asocia ` +
        `cada certificado a su acreedor por el nombre del archivo, así que sus datos pueden ` +
        `haberse mezclado y el certificado adjuntado puede no ser el que corresponde. ` +
        `Rutas: ${rutas.join(' | ')}. Verificar a mano y renombrar los archivos.`,
    });
  }
  return issues;
}

/**
 * Certificados de deuda cuya `institucion_cmf` NO resuelve contra el catálogo.
 *
 * Por qué importa: `computeRutCheckLocal` saca el RUT esperado del emisor con
 * `matchAcreedor(institucion_cmf, catalog)`. Si no resuelve, `assignedEntry` queda null y el
 * chequeo de RUT **no puede** marcar `rutMismatch` — la defensa contra adjuntar el certificado
 * de otro banco queda apagada justo en los documentos donde la institución viene mal, que son
 * los más sospechosos. Antes eso pasaba en silencio: el log decía lo mismo que si el
 * certificado estuviera perfecto.
 *
 * Solo mira certificados de deuda (institución poblada): un documento de ingreso no tiene
 * institución y no debe alertar.
 *
 * Sin catálogo cargado devuelve vacío a propósito: ahí el problema no es que la institución no
 * exista, es que no hay con qué comparar — afirmar lo primero sería culpar al dato equivocado.
 */
export function detectarInstitucionesNoResueltas(
  docs: Array<{ filename: string; institucion_cmf?: string | null; document_type?: number | null }>,
  catalog: AcreedorCatalogEntry[]
): ClaudeReadIssue[] {
  if (catalog.length === 0) return [];
  const issues: ClaudeReadIssue[] = [];
  for (const d of docs) {
    const inst = (d.institucion_cmf ?? '').trim();
    if (!inst) continue;
    if (matchAcreedor(inst, catalog).status === 'matched') continue;
    issues.push({
      document_filename: d.filename,
      institucion: inst,
      monto_clp: 0,
      tipo: 'institucion_no_resuelta',
      detalle:
        `"${inst}" no existe en el catálogo de acreedores, así que el robot NO pudo verificar que ` +
        `el RUT del emisor de "${d.filename}" corresponda a ese acreedor: si el certificado fuera ` +
        `de otra institución, no se detectaría. Agregá el acreedor al catálogo (con su RUT) o ` +
        `confirmá el alias en /admin/acreedores, y revisá este documento a mano.`,
    });
  }
  return issues;
}

export function dedupPorContenido<
  T extends {
    sha256?: string;
    storage_path: string;
    filename: string;
    n_periodos?: number;
    institucion_cmf?: string | null;
    document_type?: number | null;
  }
>(docs: T[], log: (m: string) => void): T[] {
  const porClave = new Map<string, T>();
  const masInfo = (a: T, b: T): T => {
    const pa = puntajeInfoCopia(a), pb = puntajeInfoCopia(b);
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? a : b;
    return a; // empate total: gana el primero (el `select` viene con ORDER BY estable)
  };
  for (const doc of docs) {
    const clave = doc.sha256 ? `sha:${doc.sha256}` : `unico:${doc.storage_path}`;
    const previo = porClave.get(clave);
    if (!previo) {
      porClave.set(clave, doc);
      continue;
    }
    const gana = masInfo(previo, doc);
    const pierde = gana === doc ? previo : doc;
    porClave.set(clave, gana);
    log(
      `🧬 Mismo contenido: "${pierde.filename}" (${pierde.storage_path}) ya está como ` +
      `"${gana.filename}" (${gana.storage_path}) — se lee una sola vez.`
    );
  }
  return Array.from(porClave.values());
}

/**
 * Executes API Key #1 (Sentinel) to analyze the CMF and certificates uploaded by the lawyer.
 * Bypassed only if DISABLE_SENTINEL=true is set explicitly.
 */
export async function runSentinelCheck(
  client: ClientProfile,
  supabase: SupabaseClient,
  logger: SimpleLogger
): Promise<SentinelResult> {
  const isDisabled = process.env.DISABLE_SENTINEL === 'true';
  const log = (msg: string) => logger.log(`🛡️ [Centinela] ${msg}`);
  const logError = (msg: string, err?: any) => logger.error(`🛡️ [Centinela] ${msg}`, err);

  if (isDisabled) {
    log('🛡️ Modo Bypass activo (DISABLE_SENTINEL=true). Omitiendo validación preventiva.');
    return {
      success: true,
      errors: [],
      details: {
        meets90DaysRequirement: true,
        meetsAmountRequirement: true,
        totalAmountCLP: 0,
        creditorsWith90DaysCount: 2,
        documentsAgeValid: true,
        requiredCertificatesPresent: true,
      },
    };
  }

  log('Iniciando análisis preventivo por IA...');

  if (!client.informe_cmf_path) {
    return {
      success: false,
      errors: ['No se ha registrado la ruta del Informe CMF en el perfil del cliente.'],
      details: {
        meets90DaysRequirement: false,
        meetsAmountRequirement: false,
        totalAmountCLP: 0,
        creditorsWith90DaysCount: 0,
        documentsAgeValid: false,
        requiredCertificatesPresent: false,
      },
    };
  }

  const tempDir = path.join(process.cwd(), 'outputs');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const cmfLocalPath = path.join(tempDir, `sentinel_cmf_${client.id}.pdf`);
  // Temporales POR CLIENTE. Antes era un directorio compartido y el nombre local era
  // `sentinel_<basename(storage_path)>`: dos clientes con un documento del mismo basename
  // (`cert_1.pdf`, `liquidacion.pdf`) colisionaban y, como el archivo ya existía, NO se
  // descargaba → el Centinela leía el certificado de OTRO cliente y declaraba sus montos
  // (con cita verbatim auto-consistente, imposible de detectar aguas abajo).
  const tmpDir = path.join(process.cwd(), 'outputs', 'acreditaciones_tmp', String(client.id));
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. Descargar e inspeccionar CMF
    log(`Descargando CMF de Supabase Storage: ${client.informe_cmf_path}...`);
    const { data: cmfBlob, error: cmfError } = await supabase.storage
      .from('documentos')
      .download(client.informe_cmf_path);

    if (cmfError || !cmfBlob) {
      throw new Error(`Error al descargar CMF: ${cmfError?.message || 'Blob vacío'}`);
    }
    fs.writeFileSync(cmfLocalPath, Buffer.from(await cmfBlob.arrayBuffer()));
    log('CMF descargado.');

    const cmfResult = await analyzeCmfPdf(cmfLocalPath, logger);
    const cmfText = (await extractTextFromPdf(cmfLocalPath)).substring(0, 15000);

    // 2. Obtener y descargar certificados
    log('Obteniendo certificados de acreditación desde Supabase...');
    let documents: ClientDocument[] = [];
    // sha256 que ya tiene cada fila de `client_documents` (para escribir solo lo que cambió).
    // Solo se puebla con filas REALES de la tabla: los documentos del fallback desde
    // `acreditacion_documentos_json` tienen ids inventados y no se pueden actualizar.
    const shaPrevioPorId = new Map<string, string | null>();
    const { data: dbDocs, error: dbErr } = await supabase
      .from('client_documents')
      .select('*')
      .eq('client_id', client.id)
      // ORDER BY estable: sin él, el ganador del dedup por contenido a igualdad de información
      // dependía del orden que devolviera Postgres (no garantizado) y podía cambiar entre corridas.
      .order('uploaded_at', { ascending: true })
      .order('id', { ascending: true });

    if (dbErr) {
      log(`⚠️ Tabla client_documents no disponible, usando fallback desde client.acreditacion_documentos_json. Detalle: ${dbErr.message}`);
    } else if (dbDocs && dbDocs.length > 0) {
      for (const d of dbDocs as any[]) shaPrevioPorId.set(d.id, d.sha256 ?? null);
      documents = dbDocs.map((d: any) => ({
        id: d.id,
        client_id: d.client_id,
        document_type: d.document_type,
        acreditacion_tipo: d.acreditacion_tipo,
        institucion_cmf: d.institucion_cmf,
        storage_path: d.storage_path,
        filename: d.filename,
        uploaded_at: d.uploaded_at
      }));
    }

    if (documents.length === 0 && client.acreditacion_documentos_json && Array.isArray(client.acreditacion_documentos_json)) {
      log(`Utilizando fallback desde client.acreditacion_documentos_json (${client.acreditacion_documentos_json.length} encontrados)...`);
      documents = client.acreditacion_documentos_json.map((doc: any, index: number) => {
        const docType = doc.tipo_documento;
        let acreditacionTipo = 'general';
        if (docType === 22) acreditacionTipo = 'monto';
        else if (docType === 23) acreditacionTipo = 'vencimiento';
        return {
          id: doc.id || `fallback-${index}`,
          client_id: client.id,
          document_type: docType,
          acreditacion_tipo: acreditacionTipo,
          institucion_cmf: doc.institucion_cmf || null,
          storage_path: doc.storage_path,
          filename: doc.filename || path.basename(doc.storage_path),
          uploaded_at: doc.uploaded_at || new Date().toISOString()
        };
      });
    }

    if (documents.length === 0) {
      return {
        success: false,
        errors: ['El cliente no tiene certificados de acreditación de deuda ni de vencimiento registrados.'],
        details: {
          meets90DaysRequirement: cmfResult.meets90DaysRequirement,
          meetsAmountRequirement: cmfResult.meetsAmountRequirement,
          totalAmountCLP: cmfResult.totalCreditoOf90PlusCreditors,
          creditorsWith90DaysCount: cmfResult.qualifying90PlusCount,
          documentsAgeValid: false,
          requiredCertificatesPresent: false,
        },
      };
    }

    // El Paso 3 no lee documentos de ingreso: no pueden generar un producto declarable,
    // y el agente de Ingresos los lee después con su propio prompt. Leerlos acá es una
    // llamada a Opus por documento, tirada.
    const antesFiltro = documents.length;
    const deIngreso: typeof documents = [];
    const noDeIngreso: typeof documents = [];
    for (const d of documents) {
      (esDocumentoDeIngreso(d) ? deIngreso : noDeIngreso).push(d);
    }
    if (deIngreso.length > 0) {
      documents = noDeIngreso;
      log(
        `💰 ${deIngreso.length} de ${antesFiltro} documento(s) son de ingreso y los lee el Paso 5, ` +
        `no el Paso 3: ${deIngreso.map((d) => d.filename).join(', ')}.`
      );
    }

    // Descargar cada certificado y extraer texto/imagen
    for (const doc of documents) {
      const ext = path.extname(doc.storage_path) || '.pdf';
      const slug = path.basename(doc.storage_path, ext);
      const localPath = path.join(tmpDir, `sentinel_${slug}${ext}`);
      doc.local_path = localPath;

      // Siempre se re-descarga. El `if (!existsSync)` de antes solo servía ENTRE corridas y
      // hacía que un certificado corregido por el abogado (mismo storage_path, upsert en el
      // bucket) se leyera para siempre en su versión vieja. Dentro de una corrida cada
      // documento se baja una sola vez, así que no hay costo extra.
      log(`Descargando "${doc.filename}"...`);
      const { data, error } = await supabase.storage.from('documentos').download(doc.storage_path);
      if (error || !data) throw new Error(`Error al descargar ${doc.filename}: ${error?.message || 'vacío'}`);
      const buf = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(localPath, buf);
      // Identidad de CONTENIDO. Se calcula sobre los bytes recién bajados del bucket,
      // NUNCA sobre lo que haya en outputs/: el resolver de instituciones todavía sirve
      // archivos viejos desde disco, y hashear eso envenenaría el caché de lecturas.
      doc.sha256 = contentHash(buf);

      // Determinar si es PDF de texto, PDF escaneado o Imagen
      const extLower = ext.toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extLower);

      if (isImage) {
        doc.isImageDoc = true;
        doc.imageMimeType = extLower === '.png' ? 'image/png' : 'image/jpeg';
        doc.imageBase64 = fs.readFileSync(localPath).toString('base64');
        doc.textContent = '[IMAGEN: Claude analizará la imagen directamente]';
      } else {
        // --- Mejora #1: Tesseract ELIMINADO; lectura nativa del PDF por Claude ante la duda ---
        // `pdftotext` lee la capa de texto digital. Filosofía: confiar el texto SOLO si esa capa
        // está limpia/completa; si pdftotext + TS notan algo raro (pocos chars, imagen embebida,
        // densidad de texto baja) → mandar el PDF NATIVO a Claude (lo lee mucho mejor que el OCR,
        // comprobado). Cert-first: solo mejora qué LEE el LLM; no toca la estructura (260/261,
        // overrides) ni el CMF.
        doc.isImageDoc = false;
        const fullText = await extractTextFromPdf(localPath).catch(() => '');
        const textLen = fullText.trim().length;
        let stat: fs.Stats | null = null;
        try { stat = fs.statSync(localPath); } catch { /* ignore */ }
        const withinNativeCap = !!stat && stat.size <= NATIVE_PDF_MAX_BYTES;

        if (withinNativeCap) {
          // Default ROBUSTO (2026-07-01): el LLM SIEMPRE lee el PDF NATIVO, con pdftotext como APOYO.
          // pdftotext puede devolver muchos chars y aun así perder datos (imágenes/tablas rasterizadas,
          // columnas mal extraídas, sellos/anotaciones) sin disparar ninguna señal → se nos pasaría el
          // dato. Dándole SIEMPRE el documento nativo, el LLM ve el original y el texto solo lo apoya.
          // `pdfNativeReason` queda solo para enriquecer el log (qué "duda" habría disparado antes).
          const reason = pdfNativeReason(localPath, textLen);
          doc.nativePdfBase64 = fs.readFileSync(localPath).toString('base64');
          doc.textContent = textLen >= 50
            ? clampDocTextForClaude(fullText)
            : '[PDF sin capa de texto útil. Claude lo lee NATIVAMENTE desde el documento adjunto.]';
          log(`🖼️ ${doc.filename} → Claude PDF nativo (${(stat!.size / 1024).toFixed(0)} KB) + texto de apoyo (${textLen} chars)${reason ? ` — ${reason}` : ' — lectura nativa por defecto'}.`);
        } else if (textLen >= 50) {
          // PDF supera el tope de lectura nativa → fallback a SOLO TEXTO, con aviso (no se leyó nativo).
          doc.textContent = clampDocTextForClaude(fullText);
          log(`⚠️ ${doc.filename} → solo texto (pdftotext, ${textLen} chars): el PDF pesa ${(stat!.size / 1024 / 1024).toFixed(1)} MB > tope nativo ${(NATIVE_PDF_MAX_BYTES / 1024 / 1024)} MB, no se pudo leer nativo.`);
        } else {
          // Ni texto útil ni lectura nativa posible → placeholder (no se pierde en silencio).
          doc.textContent = `[PDF ILEGIBLE AUTOMÁTICAMENTE: sin capa de texto confiable${stat ? ' y demasiado grande para lectura nativa' : ''}. Requiere revisión/carga manual.]`;
          log(`⚠️ ${doc.filename}: no legible automáticamente${stat ? ` (${(stat.size / 1024 / 1024).toFixed(1)} MB > tope nativo ${(NATIVE_PDF_MAX_BYTES / 1024 / 1024)} MB)` : ' (sin stat)'} → revisión manual.`);
        }
      }
    }

    // Persistir el sha256 en `client_documents`. Sin esto la columna y su índice nacen muertos
    // y la pregunta "¿qué leímos del caso de X?" no se puede contestar en SQL: `document_reads`
    // no lleva `client_id` a propósito, el join es contra `client_documents.sha256`.
    // Se escriben SOLO las filas cuyo hash cambió o estaba null, y un error NO rompe la corrida
    // (es trazabilidad, no correctitud del cálculo) — pero se loguea, nunca en silencio.
    // ponytail: un UPDATE por fila cambiada (normalmente 0 después de la primera corrida);
    // si algún día son cientos, un upsert con onConflict=id en una sola llamada.
    const shaPorEscribir = documents.filter(
      (d) => d.sha256 && shaPrevioPorId.has(d.id) && shaPrevioPorId.get(d.id) !== d.sha256
    );
    if (shaPorEscribir.length > 0) {
      const resultados = await Promise.all(
        shaPorEscribir.map(async (d) => {
          const { error } = await supabase.from('client_documents').update({ sha256: d.sha256 }).eq('id', d.id);
          return { filename: d.filename, error };
        })
      );
      const fallidos = resultados.filter((r) => r.error);
      if (fallidos.length > 0) {
        logError(
          `⚠️ No se pudo guardar el sha256 de ${fallidos.length}/${shaPorEscribir.length} documento(s) ` +
          `(${fallidos.map((f) => f.filename).join(', ')}) — la corrida sigue; solo se pierde trazabilidad.`,
          fallidos[0].error
        );
      }
      log(`🔗 sha256 registrado en client_documents: ${shaPorEscribir.length - fallidos.length}/${shaPorEscribir.length} fila(s).`);
    }

    // Los duplicados los fabrica el proyector (mismo PDF por correo y por Drive = dos
    // rutas). Se colapsan ACÁ, después de bajar los bytes, porque recién ahí se conoce
    // el contenido. `documents` es `let`, así que la reasignación compila.
    const antesDedup = documents.length;
    documents = dedupPorContenido(documents, log);
    if (documents.length < antesDedup) {
      log(`🧬 ${antesDedup} documentos → ${documents.length} únicos por contenido (${antesDedup - documents.length} duplicado(s) del proyector).`);
    }

    // 3. Ejecutar pre-análisis TypeScript determinista
    const todayDate = getCurrentChileDate();
    const todayStr = todayDate.toISOString().split('T')[0];

    // G2 — el catálogo es load-bearing, NO se traga el error. Un catálogo vacío no degrada
    // una cosa: apaga CINCO, y el síntoma es indistinguible de "el abogado no subió los
    // certificados":
    //   1. `computeRutCheckLocal` devuelve vacío → `rutMismatch` nunca es true → un
    //      certificado del banco equivocado se declara igual (y `rut_mismatch` es BLOQUEANTE).
    //   2. `matchAcreedor` sobre los acreedores del CMF → el set de RUT queda vacío.
    //   3. `findCatalogEntryByRut` → no se detecta el emisor de ningún documento.
    //   4. `runPerDocExtraction` lee cada documento sin el catálogo.
    //   5. `applyDeterministicBackstops` corre sin él.
    // Dejar propagar es lo correcto: el catch de nivel superior de `runSentinelCheck`
    // devuelve `technicalError: true`, y `runCentinelaAgent` lo convierte en un error
    // reintentable (el worker reintenta 3 veces) en vez de bloquear al cliente.
    const catalog: AcreedorCatalogEntry[] = await fetchAcreedoresCatalog(supabase);
    if (catalog.length === 0) {
      // Fetch OK pero 0 filas activas: no es transitorio (reintentar no sirve), pero
      // seguir sería declarar a ciegas. Se corta con un motivo accionable.
      throw new Error(
        'El catálogo acreedores_canonicos cargó vacío (0 filas con activo=true). Sin él no ' +
        'corre el chequeo de RUT del emisor ni la reconciliación NO-CMF: se corta antes de declarar.'
      );
    }
    log(`✓ Catálogo acreedores_canonicos: ${catalog.length} acreedores activos.`);

    const clientRutForCerts = client.rut ?? null;

    // Helper de RUT check
    const computeRutCheckLocal = (assignedInst: string | null, certText: string) => {
      const result = {
        rutEmisorDetectado: null as string | null,
        bancoSegunRut: null as string | null,
        rutMismatch: false,
        rutCheckTypeScript: '',
        // ¿El RUT del acreedor ASIGNADO aparece impreso en el certificado? Es la única
        // confirmación de identidad que tenemos sin volver a leer el papel, y el backstop de
        // completitud la EXIGE antes de crear un acreedor (ver identidadConfirmadaPorElPapel
        // en sentinel_backstops.ts): sin ella, "el banco que tiene cupo libre en el CMF" es el
        // criterio de atribución, y así un estado de cuenta de una tarjeta FORUS se declaró
        // como deuda de Banco de Chile (ANALISIS_BARRAZA.md:52,56).
        // Se marca SOLO en la rama de coincidencia; cualquier otra salida la deja en false.
        identidadAsignadaConfirmada: false,
      };
      if (catalog.length === 0) return result;

      const certRuts = extractRutsFromText(certText);
      const certNorm = normalizeText(certText);
      const assignedMatch = assignedInst ? matchAcreedor(assignedInst, catalog) : null;
      const assignedEntry = assignedMatch && assignedMatch.status === 'matched' ? assignedMatch.entry! : null;
      const assignedRutNorm = assignedEntry ? normalizeRut(assignedEntry.rut) : null;

      if (assignedRutNorm && certRuts.includes(assignedRutNorm)) {
        result.rutEmisorDetectado = assignedRutNorm;
        result.bancoSegunRut = assignedEntry!.nombre;
        result.identidadAsignadaConfirmada = true;
        result.rutCheckTypeScript = `RUT coincide con banco asignado: ${assignedRutNorm}`;
        return result;
      }

      const detected = findCatalogEntryByRut(certRuts, catalog, clientRutForCerts);
      if (detected) {
        result.rutEmisorDetectado = normalizeRut(detected.rut);
        result.bancoSegunRut = detected.nombre;
      }

      if (assignedRutNorm && detected && normalizeRut(detected.rut) !== assignedRutNorm) {
        result.rutMismatch = true;
        result.rutCheckTypeScript = `POSIBLE BANCO INCORRECTO: el RUT ${result.rutEmisorDetectado} pertenece a "${detected.nombre}" y el asignado es "${assignedInst}" (${assignedRutNorm}).`;
        return result;
      }

      return result;
    };

    const certificateAnalyses: any[] = [];
    let algunCertificadoExpirado = false;

    for (const doc of documents) {
      if (doc.isImageDoc) {
        certificateAnalyses.push({
          filename: doc.filename,
          document_type: doc.document_type,
          acreditacion_tipo: doc.acreditacion_tipo,
          isImageDoc: true,
          antiguedadValida: false,
          rutMismatch: false,
          checkTypeScript: 'IMAGEN: Delegado a Claude Vision.'
        });
      } else {
        const { date: mostLikelyDate } = extractEmissionDateFromText(doc.textContent || '', todayDate);
        const ageDays = mostLikelyDate ? getDaysDifference(todayDate, mostLikelyDate) : null;

        // Determinar si es un estado de cuenta (exento)
        const isStatement = doc.acreditacion_tipo === 'estado_cuenta' ||
          /estado\s+de\s+cuenta|cartola|factura|boleta/i.test(doc.filename) ||
          /estado\s+de\s+cuenta|cartola/i.test(doc.textContent || '');

        const isValidAge = isStatement || (ageDays !== null && ageDays <= 30);
        if (!isValidAge) algunCertificadoExpirado = true;

        const rutCheck = computeRutCheckLocal(doc.institucion_cmf, doc.textContent || '');

        certificateAnalyses.push({
          filename: doc.filename,
          document_type: doc.document_type,
          acreditacion_tipo: doc.acreditacion_tipo,
          isImageDoc: false,
          mostLikelyDate: mostLikelyDate ? mostLikelyDate.toISOString().split('T')[0] : null,
          ageDays,
          antiguedadValida: isValidAge,
          isStatement,
          rutMismatch: rutCheck.rutMismatch,
          rutEmisorDetectado: rutCheck.rutEmisorDetectado,
          bancoSegunRut: rutCheck.bancoSegunRut,
          identidadAsignadaConfirmada: rutCheck.identidadAsignadaConfirmada,
          checkTypeScript: isStatement ? 'Exento de límite por ser Estado de Cuenta' : (isValidAge ? 'Vigente' : 'Expirado (>30 días)')
        });
      }
    }

    const cmfAgeDays = cmfResult.cmfAgeDays;
    const cmfAntiguedadValida = cmfAgeDays !== null && cmfAgeDays <= 30;
    const documentsAgeValid = cmfAntiguedadValida && !algunCertificadoExpirado;

    // Verificar presencia de certificados por acreedor
    const classifiedCreditors = cmfResult.classifiedCreditors.map(c => {
      const is260 = c.overdue90Days > 0;
      const associated = documents.filter(d => {
        const normD = d.institucion_cmf ? d.institucion_cmf.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
        const normC = c.institucion.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normD === normC || normD.includes(normC) || normC.includes(normD);
      });

      const hasMonto = associated.some(d => d.document_type === 22 || d.document_type === 24);
      const hasVencimiento = associated.some(d => d.document_type === 23 || d.document_type === 24);
      const ok = is260 ? (hasMonto && hasVencimiento) : hasMonto;

      return {
        institucion: c.institucion,
        overdue90Days: c.overdue90Days,
        categoriaArticulo: c.categoriaArticulo,
        documentosAsociadosCount: associated.length,
        hasMontoCertificate: hasMonto,
        hasVencimientoCertificate: hasVencimiento,
        cumpleAcreditacion: ok
      };
    });

    const requiredCertificatesPresent = classifiedCreditors.every(c => c.cumpleAcreditacion);

    // --- Pre-pase determinista de reconciliación NO-CMF (diff documentos − CMF) ---
    // TS marca candidatos; Claude confirma/extrae. Match por RUT del emisor primero,
    // luego por nombre de institución (bidireccional). El caso "mismo banco, producto
    // distinto" (ej. tarjeta vs consumo de Banco de Chile) lo resuelve Claude.
    const cmfRutSet = new Set<string>();
    const cmfNameNorms: string[] = [];
    for (const c of cmfResult.creditors) {
      cmfNameNorms.push(normalizeText(c.institucion));
      const m = matchAcreedor(c.institucion, catalog);
      if (m.status === 'matched' && m.entry?.rut) {
        const r = normalizeRut(m.entry.rut);
        if (r) cmfRutSet.add(r);
      }
    }

    const nonCmfReconciliation = documents.map(doc => {
      const docText = doc.textContent || '';
      const docRuts = doc.isImageDoc ? [] : extractRutsFromText(docText);
      const detected = findCatalogEntryByRut(docRuts, catalog, clientRutForCerts);
      const issuerRutNorm = detected?.rut ? normalizeRut(detected.rut) : null;
      const issuerName = detected?.nombre ?? doc.institucion_cmf ?? null;
      const assignedNorm = doc.institucion_cmf ? normalizeText(doc.institucion_cmf) : '';
      const issuerNorm = issuerName ? normalizeText(issuerName) : '';
      const nameInCmf = cmfNameNorms.some(n =>
        (!!assignedNorm && (n.includes(assignedNorm) || assignedNorm.includes(n))) ||
        (!!issuerNorm && (n.includes(issuerNorm) || issuerNorm.includes(n)))
      );
      const rutInCmf = issuerRutNorm ? cmfRutSet.has(issuerRutNorm) : false;
      const issuerInCmf = nameInCmf || rutInCmf;
      return {
        filename: doc.filename,
        institucion_cmf_asignada: doc.institucion_cmf,
        rutEmisorDetectado: issuerRutNorm,
        bancoSegunRut: detected?.nombre ?? null,
        issuerInCmf,
        isImageDoc: !!doc.isImageDoc,
        acreditacion_tipo: doc.acreditacion_tipo,
        instruccion: issuerInCmf
          ? 'El emisor SÍ aparece en el CMF. Solo es acreedor NO-CMF si representa un PRODUCTO DISTINTO no listado en el CMF para esa institución (ej. una tarjeta cuando el CMF solo tiene un crédito de consumo del mismo banco). Si solo respalda una línea que ya está en el CMF, NO lo agregues a additionalCreditors.'
          : 'El emisor NO aparece en el CMF. Candidato fuerte a acreedor NO-CMF (ej. TGR, caja de compensación, fintech). Confirma que es una deuda real a declarar (NO un documento que dice "no tiene deuda") antes de agregarlo.'
      };
    });

    // --- Fechas clave deterministas (sin Claude): expiración CMF/certificados ---
    const fechasClave: FechaClave[] = [];
    const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const cmfEmis = cmfResult.fechaEmision ? parseDateString(cmfResult.fechaEmision) : null;
    if (cmfEmis) {
      const exp = addDays(cmfEmis, 30);
      fechasClave.push({
        tipo: 'expiracion_cmf',
        referencia: 'Informe CMF',
        fecha: fmt(exp),
        diasRestantes: getDaysDifference(exp, todayDate),
        detalle: `CMF emitido ${cmfResult.fechaEmision}; vence a los 30 días.`,
      });
    }
    for (const ca of certificateAnalyses) {
      if (ca.isImageDoc || ca.isStatement || !ca.mostLikelyDate) continue;
      const emis = parseDateString(ca.mostLikelyDate);
      if (!emis) continue;
      const exp = addDays(emis, 30);
      fechasClave.push({
        tipo: 'expiracion_certificado',
        referencia: ca.filename,
        fecha: fmt(exp),
        diasRestantes: getDaysDifference(exp, todayDate),
        detalle: `Certificado emitido ${ca.mostLikelyDate}; vence a los 30 días.`,
      });
    }

    const localAnalysis = {
      todayReference: todayStr,
      cmf: {
        filename: path.basename(cmfLocalPath),
        fechaEmision: cmfResult.fechaEmision,
        ageDays: cmfAgeDays,
        antiguedadValida: cmfAntiguedadValida
      },
      requisitosSesion: {
        qualifying90PlusCount: cmfResult.qualifying90PlusCount,
        meets90DaysRequirement: cmfResult.meets90DaysRequirement,
        totalCreditoOf90Plus: cmfResult.totalCreditoOf90PlusCreditors,
        meetsAmountRequirement: cmfResult.meetsAmountRequirement
      },
      requiresReclassificationAnalysis: !cmfResult.meets90DaysRequirement,
      documentsForReclassification: !cmfResult.meets90DaysRequirement
        ? documents
            .filter(d => d.acreditacion_tipo === 'estado_cuenta' || d.acreditacion_tipo === 'general')
            .map(d => ({
              filename: d.filename,
              institucion_cmf: d.institucion_cmf,
              acreditacion_tipo: d.acreditacion_tipo,
              instruccion: d.acreditacion_tipo === 'estado_cuenta'
                ? 'Estado de cuenta: buscar primer mes donde Pago Realizado < Monto Mínimo (o $0). Ese vencimiento inicia la mora.'
                : 'Informe/certificado de crédito: localizar cuotas vencidas + fecha próximo pago, reconstruir hacia atrás para hallar cuota más antigua.'
            }))
        : [],
      creditors: classifiedCreditors,
      certificates: certificateAnalyses,
      nonCmfReconciliation,
      documentsAgeValid,
      requiredCertificatesPresent
    };

    // 4. Llamar a Claude (API Key #1)
    if (!process.env.ANTHROPIC_API_KEY) {
      log('⚠️ ANTHROPIC_API_KEY no encontrada en .env. Se retorna error de configuración del Centinela.');
      return {
        success: false,
        errors: ['Falta ANTHROPIC_API_KEY en el archivo de configuración (.env).'],
        details: {
          meets90DaysRequirement: cmfResult.meets90DaysRequirement,
          meetsAmountRequirement: cmfResult.meetsAmountRequirement,
          totalAmountCLP: cmfResult.totalCreditoOf90PlusCreditors,
          creditorsWith90DaysCount: cmfResult.qualifying90PlusCount,
          documentsAgeValid,
          requiredCertificatesPresent
        }
      };
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `Eres el Centinela de Carga preventivo (API Key #1) para el estudio de renegociaciones de deuda en Chile (Ley 20.720 — Superir).

**FECHA DE REFERENCIA HOY: ${todayStr}** — usa esta fecha para todos los cálculos de días de mora y antigüedad.

**CONTEXTO CRÍTICO:** El Informe CMF puede estar desactualizado. Si muestra $0 en la columna de mora 90+ días para un acreedor, pero los documentos adjuntos (estados de cuenta, informes de crédito) demuestran mora real ≥ 91 días desde hoy, debes detectarlo y registrarlo en "reclassifiedCreditors". El pre-análisis TypeScript te indica cuándo esto es necesario (campo "requiresReclassificationAnalysis").

---
**REGLA 1 — Antigüedad de documentos (referencia: ${todayStr})**
- CMF y certificados de acreditación: ≤30 días. Si superan este límite → error.
- EXCEPCIÓN: Los estados de cuenta mensuales (bancarios o de tarjeta) están EXENTOS del límite de 30 días, sin importar su antigüedad.

---
**REGLA 2 — Reclasificación por documentos (aplica cuando "requiresReclassificationAnalysis" es true)**
Cuando el CMF no muestra suficientes productos con mora ≥91d, analiza CADA documento de los indicados en "documentsForReclassification":

A) **Crédito de Consumo** (informe de crédito o certificado):
   1. Localiza "Cuotas Vencidas no Pagadas" (N = cantidad de cuotas impagas).
   2. Localiza "Fecha Próximo Pago" o "Próxima Cuota de Vencimiento" (la fecha futura de pago, ej. 03/12/2024).
   3. Reconstruye hacia atrás: la cuota más antigua vencida = próxima_fecha − (N × ~30 días).
      Ejemplo: próxima=03/12/2024, N=3 cuotas → cuota 4 venció 03/09/2024.
   4. Calcula días_mora = ${todayStr} − fecha_cuota_mas_antigua.
   5. Si días_mora ≥ 91 → agregar a reclassifiedCreditors.
   6. El monto declarado = "Saldo Total", "Saldo Insoluto" o "Capital Vigente".

B) **Tarjeta de Crédito** (estados de cuenta mensuales):
   1. Analiza mes a mes buscando el PRIMER período donde Pago Realizado < Monto Mínimo a Pagar (incluyendo $0).
   2. La fecha "PAGAR HASTA" o "VENCE EL" de ese período es el inicio de la mora.
   3. Calcula días_mora = ${todayStr} − fecha_primer_vencimiento_incumplido.
   4. Si días_mora ≥ 91 → agregar a reclassifiedCreditors.
   5. El monto declarado = "CUPO TOTAL" o "Límite de Crédito Autorizado".

---
**REGLA 3 — Requisito multiproducto (≥2 productos con mora ≥91d)**
Suma los productos calificados por CMF + los reclasificados por documentos.
- Si total ≥ 2 → meets90DaysRequirement = true.
- Si total < 2 → meets90DaysRequirement = false → incluir en errors.

---
**REGLA 4 — Monto mínimo (≥80 UF = $3.253.000 CLP)**
Suma los montos de todos los productos calificados (CMF + reclasificados).
- Si suma ≥ $3.253.000 → meetsAmountRequirement = true.
- Si suma < $3.253.000 → meetsAmountRequirement = false → incluir en errors.

---
**REGLA 5 — Documentos de acreditación por acreedor**
- Art. 260 (mora ≥91d, por CMF o reclasificado): necesita acreditar monto Y vencimiento.
- Art. 261 (<91d, no reclasificado): necesita solo monto.
Verifica que cada acreedor calificado tenga los documentos necesarios.

---
**REGLA 6 — RUT del emisor**
Si el documento tiene texto extraíble, verifica que el RUT del emisor corresponda al banco asignado.

---
**⚠️ REGLA TRANSVERSAL — Cómo leer el MONTO de un estado de cuenta (aplica a Reglas 2B, 7, 8 y 9)**

(A) **VARIOS PERÍODOS en un mismo PDF**: muchos estados de cuenta traen varios meses de facturación (a veces en cualquier orden — no necesariamente el más nuevo primero). **Usa SIEMPRE el período MÁS RECIENTE** (el de la fecha "PAGAR HASTA" / "Período Facturado" / "VENCE EL" más nueva), NO el primero que aparece ni el más viejo. Revisa TODAS las páginas e identifica el período con la fecha más reciente. (Ej.: un PDF con 4 estados de cuenta enero→abril → usa el de abril aunque enero esté en la página 1.) ⚠️ Si el texto del documento viene cortado con el marcador "[…FRAGMENTO INTERMEDIO OMITIDO…]", el período MÁS RECIENTE está en la parte de ABAJO (después del marcador) — leé ahí el monto, la fecha "PAGAR HASTA" y la clasificación 260/261.

(B) **VARIOS CUPOS / LÍNEAS en la misma tarjeta**: una tarjeta puede tener MÁS DE UN cupo o línea de crédito (ej. "Cupo Compras" + "Cupo Avances en Efectivo" / "Avances XL" / "Súper Avance" / "Avance NN"). El monto a declarar es la **SUMA de los "Cupo Utilizado" de TODOS los componentes** del período más reciente, no solo el primero/principal. ⚠️ Es un error frecuente declarar solo el cupo de Compras y omitir el de Avances. (Ej. real La Polar: Cupo Compras utilizado $258.543 + Cupo Avances XL utilizado $495.755 = **$754.298** a declarar — NO $258.543.)

(C) **DOCUMENTOS QUE NO ACREDITAN el monto de la deuda por sí solos** (no inventes un monto a partir de ellos; si es tu única fuente para un acreedor, BAJA la confianza (<0.70) y dilo en "reason"):
- **Comprobante/voucher de PAGO o transferencia** ("pago exitoso", "transferencia realizada", "comprobante de pago"): prueba un PAGO, NO el saldo adeudado. ⚠️ Un comprobante de pago NUNCA significa que la deuda quedó en $0: la deuda se prueba con un certificado de saldo, no con un pago.
- **Cartola / detalle de movimientos**: lista transacciones, NO certifica el saldo de la deuda (distinto de un "estado de cuenta" con cupo utilizado / deuda total del período).
- **Captura de pantalla** de la app/web banking: úsala solo si muestra claramente un saldo/deuda; ante baja calidad o duda, baja la confianza.
⚠️ Esto NO te autoriza a poner $0 ni a omitir un acreedor: si el documento muestra un valor de deuda > 0, decláralo y baja la confianza para que el abogado lo verifique (regla: nunca bajar un monto en silencio).

(D) **CERTIFICADO DE DEUDA "GLOBAL/RESUMEN" (totales por moneda) — NO es un producto, es la SUMA de varios.**
Algunos bancos emiten un "Certificado de Deuda" que lista SOLO **totales por moneda** (ej. "Total deudas en PESO CHILENO $37.700.317", "Total deudas en DÓLAR USA US$14,80", "Total deudas en UNIDAD DE FOMENTO 3.539,77 UF") **sin desglosar por operación/producto**. Reglas OBLIGATORIAS:
- **NUNCA declares el total global como un acreedor/producto** (ni como "consumo", ni partiéndolo a ojo entre productos). Ese total es la SUMA de TODOS los créditos del banco.
- Los productos individuales se declaran desde SUS certificados/estados de cuenta propios (tarjeta, línea, hipotecario) y desde las filas del **CMF** (que sí lista las operaciones del banco). El número de productos del banco lo fija el **CMF**, no este resumen.
- El total global es solo un **chequeo de sanidad**: la suma de los productos en pesos debe acercarse al "Total en PESO CHILENO"; el "Total en UF" corresponde al **crédito hipotecario/vivienda** (un solo producto en UF), nunca a un producto en pesos.
- ⚠️ Declarar el total global **Y** los productos individuales = **DOBLE CONTEO** (error grave). Si solo tienes el resumen global y ningún cert por producto, NO inventes montos por producto: declara los productos según las filas del CMF (monto del CMF) y baja la confianza.

---
**REGLA 7 — Identificar deudas Art. 261 (deudas vigentes, sin mora ≥91d)**
Para CADA documento adjunto cuyo acreedor NO fue reclasificado a Art. 260, analiza si corresponde a una deuda vigente (al día o con mora <91d). Si es así, agrégalo a "identified261Creditors" con:
- bank: nombre del banco
- product_type: tipo de producto ("credito_consumo", "tarjeta_credito", u "otro")
- institucion_cmf: nombre según CMF (usa el campo "institucion_cmf" del documento)
- total_credito_clp: monto total de la deuda según el documento — **del período MÁS RECIENTE** (Regla Transversal): el saldo/cupo utilizado/deuda total facturada del último estado de cuenta del PDF.
- reason: explicación breve de por qué es Art. 261 (ej. "Cargo automático liquidó mora; deuda vigente sin mora ≥91d")
- document_filename: nombre del archivo que acredita la deuda

Esta información permite al Orquestador Cognitivo (API Key #2) mapear correctamente los documentos de los Otros Acreedores (Art. 261).

---
**REGLA 8 — Acreedores NO-CMF (reconciliación documentos − CMF)**
Algunas deudas reales NO aparecen en el Informe CMF pero IGUAL deben declararse en el Paso 3 (Art. 261 obliga a declarar todos los pasivos): deudas con TGR (Tesorería General de la República), cajas de compensación, fintechs (Mercado Pago, Tenpo), tarjetas no reportadas, deudas castigadas, etc. Omitir un pasivo invalida el escrito; declararlo dos veces también es un error grave.

El pre-análisis TypeScript te entrega "nonCmfReconciliation": una fila por documento con el flag determinista "issuerInCmf" (¿el emisor aparece en el CMF?) y una "instruccion". Tu trabajo:

1. Para cada documento, decide si representa un acreedor NO-CMF a declarar:
   - **issuerInCmf = false** → el emisor no está en el CMF (ej. TGR, caja, fintech). Es candidato fuerte. Confírmalo leyendo el documento: ¿prueba una deuda real? Si el documento dice explícitamente que NO existe deuda (ej. "DEUDA TGR ... NO TIENE"), NO lo agregues.
   - **issuerInCmf = true** → el emisor SÍ está en el CMF. Solo agrégalo si el documento prueba un PRODUCTO DISTINTO que NO está representado por ninguna línea del CMF de esa institución (ej. el CMF tiene solo el crédito de consumo de Banco de Chile, pero el documento es de una tarjeta de crédito de Banco de Chile con cupo propio). Si el documento solo respalda una deuda que YA está en el CMF, NO lo agregues (sería duplicado).

2. Para cada acreedor NO-CMF confirmado, clasifícalo:
   - Si tiene mora ≥91 días (calculada con las reglas A/B de la Regla 2) → categoria_articulo = 260, e incluye delinquency_start_date y delinquency_days.
   - Si está al día o con mora <91 días → categoria_articulo = 261 (acredita solo monto).

3. **bank / institucion_cmf = el emisor REAL según el CONTENIDO del documento** (la marca de la tarjeta o el nombre en el encabezado y en las transacciones), NO el nombre del archivo ni una etiqueta genérica. El nombre del archivo puede engañar. Ejemplos: si las transacciones dicen "Lapolar"/"Avance XL" → el emisor es **La Polar** (aunque el archivo se llame "ESTADO_CTA_ABC"); "ABCDIN"/"Dijon" → ABCDIN/COFISA; "Ripley" → Ripley; "Hites" → Hites. Da el nombre comercial claro y ÚNICO del emisor (no una lista de candidatos ni "X / Y / Z").

4. **monto_clp**: aplica la REGLA TRANSVERSAL (período más reciente + SUMA de todos los cupos: Compras + Avances/Avances XL/etc.).
   - ⚠️ **Deudas fiscales / impuestos / contribuciones en cuotas (TGR, impuesto territorial, patentes municipales, permisos de circulación)** — regla general, cualquier organismo: declara SOLO la **deuda morosa / vencida** (la(s) cuota(s) ya exigible(s) e impaga(s) — rótulos "Total Deuda Morosa", "Deuda Vencida", "Monto Vencido", "Cuotas vencidas"). **NUNCA sumes las cuotas "no vencidas" / "por vencer" / "deuda no vencida"** (cuotas con fecha de vencimiento POSTERIOR a hoy): aún no son exigibles y NO se declaran como pasivo. A diferencia de un crédito (donde el payoff acelera todo el capital a hoy), cada cuota de un tributo es una obligación periódica independiente que solo nace al vencer. Ej.: certificado TGR que separa "deuda morosa (vencida 30-Abr): $18.537" + "deuda no vencida (vence 30-Jun): $17.944" → declara **$18.537**, NO $36.481.

5. Devuélvelos en "additionalCreditors". NO los repitas en reclassifiedCreditors ni identified261Creditors (esos son SOLO para acreedores que ya están en el CMF). additionalCreditors es exclusivamente para los que NO están en el CMF.

6. **RECONCILIA POR OPERACIÓN, no por institución (regla general — aplica aunque el banco ya esté en el CMF).** Un MISMO certificado puede listar VARIAS operaciones de un banco (cada una con su N° de Operación / N° CRE / N° de crédito y su propio saldo a pagar), mientras que el CMF lista MENOS líneas de esa institución. El CMF puede estar incompleto: una operación real puede no figurar. Procede así:
   a. Enumera TODAS las operaciones DISTINTAS que el certificado muestra para esa institución (identifícalas por su número de operación/CRE; si no hay número, por su monto).
   b. Empareja cada operación del certificado con una línea del CMF de esa institución (por número de operación si está; si no, por monto aproximado).
   c. Por CADA operación del certificado que NO quede emparejada con ninguna línea del CMF → **declárala como producto adicional** en "additionalCreditors", con su artículo 260/261 según su mora (260 si mora ≥91d con vencimiento acreditable; 261 si está al día o sin vencimiento acreditable). Es deuda real que el CMF no reportó. Pon en "reason" que es una operación adicional del banco no representada por ninguna línea del CMF.
   ⚠️ **NO confundir con CONSOLIDACIÓN (no dividir).** Si el certificado descompone UN ÚNICO crédito del CMF en varias sub-partidas (cuotas, capital + intereses + seguros, abonos parciales) cuya SUMA ≈ el monto de esa única línea del CMF, es UN solo producto → NO crees varias filas. El criterio de decisión: ¿cada operación del certificado es un crédito INDEPENDIENTE con su propio saldo a liquidar (→ filas separadas), o son COMPONENTES de un mismo payoff que ya está en una línea del CMF (→ una sola fila)? Ej. de consolidación (NO dividir): el CMF trae 1 crédito de consumo de $11.6M y el certificado lo detalla en 3 operaciones que suman ~$11.6M → 1 fila.
   Ej. de operación adicional (SÍ declarar): el certificado de BancoEstado lista 3 operaciones — CRE-00039038355 $36.130.323, CRE-00040145148 $389.848 y CRE-00040166973 $553.350 — pero el CMF solo trae 2 líneas de BancoEstado. La 3ª (CRE-00040166973 $553.350) no está en el CMF → va a "additionalCreditors" (Art. 261 si está al día), creando una fila extra en el portal.

---
**REGLA 9 — Monto y fecha real para acreedores Art.260 directos del CMF**
Algunos acreedores ya aparecen en el CMF con "overdue90Days > 0" (campo en el array "creditors" del pre-análisis). Estos NO requieren reclasificación. Sin embargo, el certificado de acreditación tiene el monto más actualizado y la fecha real de la primera cuota impaga — el portal debe recibir ese dato del documento, NO el del CMF.

Para cada acreedor en el array "creditors" donde "overdue90Days > 0" Y cuyo nombre NO aparece en el array "reclassifiedCreditors" que acabas de construir:
1. Localiza el certificado asociado (busca en el texto de los certificados por nombre de institución).
2. Del documento, extrae:
   - "monto_clp": la **DEUDA ACTUAL del producto** (lo que el deudor debe declarar). Elige el campo con esta PRIORIDAD (regla general — vale para CUALQUIER banco/institución, no un caso puntual):
       1. **PAYOFF / monto para liquidar** (el MEJOR dato si existe): rótulos "Monto total a pagar", "Total a pagar", "Deuda total", "Monto de prepago", "Saldo total a pagar", "Es la suma de:". Incluye capital + intereses + seguros/recargos.
       2. Si NO hay payoff: **"Saldo Insoluto" / "Saldo deudor" / "Saldo de la deuda" / "Capital adeudado"** (lo que queda debiendo HOY). Para tarjetas: cupo utilizado / deuda total facturada del período más reciente.
       ⛔ **NUNCA uses el MONTO ORIGINAL del crédito**: los rótulos "Monto", "Monto Aprobado", "Monto Cursado", "Monto Otorgado", "Monto Contratado", "Monto Inicial/Original" (o la cifra junto a "Inicio / Término / Moneda") son el capital prestado al ORIGEN, NO la deuda actual → SOBRE-declaran. En un crédito amortizado el monto original es MAYOR que la deuda vigente; si ves dos cifras y una es claramente "lo aprobado/otorgado" y otra "lo que se debe", declara la segunda.
       🎯 **ANCLA OBLIGATORIA EN EL CMF**: el campo "totalCredito" del CMF para ese producto (está en el pre-análisis "creditors") es la deuda VIGENTE que la institución reporta hoy. Tu "monto_clp" debe ser COHERENTE con ese valor: difiere solo por intereses de mora / costas de cobranza (lo sube un poco) o por pagos recientes (lo baja). Si tu candidato es claramente MAYOR que el "totalCredito" del CMF y el documento NO muestra cobranza judicial/recargos que lo expliquen, casi seguro tomaste el MONTO ORIGINAL → descártalo, busca el Saldo Insoluto / payoff y corrige. Ejemplo del modo de fallo a evitar: cert con "Monto" $8.183.872 (original) y "Saldo Insoluto" $6.756.287 (deuda real), CMF $7.263.340 → declara **$6.756.287** (coherente con el CMF), NUNCA $8.183.872.
   - "fecha_vencimiento": la fecha en que la deuda entró en mora / se hizo exigible, en formato YYYY-MM-DD. PRIORIDAD de la fuente en el documento:
     1. Si el certificado trae una fecha explícita de inicio de mora/cobranza — rótulos como **"Cobranza Judicial iniciada"**, "Fecha inicio mora", "Fecha de mora", "Fecha primera cuota impaga", "En cobranza desde" — **usa ESA** (es la que usa el abogado). En liquidaciones con varios productos suele ser la MISMA fecha para todos.
     • Crédito de consumo (si no hay rótulo de mora): fecha de la cuota más antigua vencida (misma lógica Regla 2A).
     • Tarjeta de crédito (si no hay rótulo de mora): fecha "PAGAR HASTA" del primer período incumplido.
     ⚠️ NO uses la "Fecha de Contratación"/"Fecha de inicio del crédito" ni el "Próximo Pago" como vencimiento — esos NO son la fecha de mora.
3. **Un certificado que cubre VARIOS productos de la misma institución** (ej. un certificado de liquidación Santander con 3 créditos de consumo) → emite **un override POR CADA producto**, cada uno con el "Monto total a pagar" y la fecha de ESE producto. Distingue cada uno en "institucion_cmf" agregando el identificador del producto entre paréntesis (tipo + fecha + N° de operación), ej. "Banco Santander-Chile (Consumo 05/06/2025 — Op. 650052258302)". Es CRÍTICO: cada producto se declara como una fila separada en el portal, así que NO consolides los montos en uno solo ni repitas el mismo monto en varios productos.
   ✅ **DECLARA las deudas rotuladas "VARIOS DEUDORES" / "OTROS DEUDORES"**: son deuda DIRECTA del deudor (figura como titular junto a otras personas) y SIEMPRE se declaran (regla del abogado, 2026-06-23). Emite su override igual que cualquier otro producto, con su "Monto total a pagar" y su fecha. ⚠️ **EXCLUYE solo**: (a) la deuda INDIRECTA donde el deudor es **codeudor / fiador / aval de un TERCERO** (garantía de deuda ajena — el CMF la lista en su sección "Deuda Indirecta" aparte), y (b) los **montos triviales (< 1 UF ≈ $40.000)** que son remanentes/comisiones residuales, NO un producto real. Ej.: si el certificado lista 3 consumos + 1 "VARIOS DEUDORES" de $45.798, emite **4 overrides** (incluido el varios deudores). Solo omitirías un "VARIOS DEUDORES" si su monto fuera trivial (< 1 UF, ej. $11).
4. Si no hay certificado asociado, o el documento no contiene esta información, omite ese acreedor de "cmf260DirectOverrides".

Devuelve los resultados en "cmf260DirectOverrides". NO repitas en reclassifiedCreditors a los acreedores que ya estaban en el CMF como Art.260 — solo van aquí.

---
**REGLA 11 — EVIDENCIA VERIFICABLE por acreedor (campo "evidence", OBLIGATORIO EN LAS 4 LISTAS)**
Por CADA acreedor que emitas en **reclassifiedCreditors, identified261Creditors, deReclassified261Creditors, additionalCreditors Y cmf260DirectOverrides** —⚠️ SIN EXCEPCIÓN, también los Art. 261 vigentes— agrega un objeto "evidence" con los datos que permiten VERIFICAR tu lectura. TypeScript los cruza contra el catálogo de RUT y las filas del CMF — si no cuadran, se alerta al abogado. Sé HONESTO: si no leíste un dato con certeza, baja la "confidence", NO inventes. Un acreedor SIN "evidence" se marca como no verificable.
- "rut_emisor" ⭐ EL CAMPO MÁS IMPORTANTE: el RUT del EMISOR del certificado (la institución acreedora), tal como está impreso (XXXXXXXX-X). NO el RUT del deudor/cliente. Búscalo SIEMPRE — suele estar en el encabezado/pie del certificado o junto a la razón social del banco. Es la verificación de identidad más fuerte. Si de verdad no aparece en el documento, omítelo y baja la confianza.
- "numero_operacion": Nº de operación / contrato / tarjeta del producto (lo trae el certificado del banco, NO el CMF). Sirve para no confundir productos del mismo banco.
- "moneda": "UF" si los montos del documento están en Unidades de Fomento (probable crédito hipotecario/vivienda) o "CLP" si están en pesos.
- "cita_monto": copia TEXTUAL (verbatim) del fragmento del documento de donde sacaste "monto_clp" — incluí el rótulo y la cifra exactos (ej. 'Saldo Insoluto: $6.756.287'). Es tu respaldo anti-error: si el monto que reportás es una SUMA de varios cupos, citá las cifras sumadas.
- "cita_fecha": copia textual del fragmento de donde sacaste la fecha de mora/vencimiento.
- "confidence": número 0.0–1.0 con tu certeza al leer ESTE certificado (escaneo borroso/tabla ambigua → baja; texto nítido → alta).

---
**IMPORTANTE:** Si los documentos demuestran que los requisitos se cumplen aunque el CMF no lo refleje, el resultado puede ser "success": true con reclassifiedCreditors no vacío.

Responde ÚNICAMENTE con un bloque JSON encerrado en <json>...</json>. Nada de texto fuera de esas etiquetas.

Esquema JSON esperado:
\`\`\`json
{
  "success": true,
  "errors": [],
  "reclassifiedCreditors": [
    {
      "bank": "Banco de Chile",
      "product_type": "credito_consumo",
      "institucion_cmf": "Banco de Chile",
      "delinquency_start_date": "2024-09-03",
      "delinquency_days": 91,
      "total_credito_clp": 48236275,
      "new_classification": "obligaciones_260",
      "reason": "informeCredito.pdf: 3 cuotas impagas, próximo pago 03/12/2024. Cuota más antigua venció 03/09/2024 = 91 días de mora al 03/12/2024.",
      "document_filename": "informeCredito.pdf",
      "evidence": { "rut_emisor": "97004000-5", "numero_operacion": "650052258302", "moneda": "CLP", "cita_monto": "Saldo Insoluto: $48.236.275", "cita_fecha": "Cuota más antigua vencida: 03/09/2024", "confidence": 0.95 }
    }
  ],
  "identified261Creditors": [
    {
      "bank": "Banco de Chile",
      "product_type": "tarjeta_credito",
      "institucion_cmf": "Banco de Chile",
      "total_credito_clp": 65864,
      "reason": "Estado de cuenta Oct 2024: cargo automático de $14.210 liquidó mora vencida. Deuda vigente al día sin mora ≥91d.",
      "document_filename": "Banco de Chile Tarjeta Mastercard EC Octubre 2024.pdf",
      "evidence": { "rut_emisor": "97004000-5", "numero_operacion": "5546-XXXX-9558", "moneda": "CLP", "cita_monto": "Cupo Utilizado: $65.864", "confidence": 0.93 }
    }
  ],
  "additionalCreditors": [
    {
      "bank": "Banco de Chile",
      "institucion_cmf": "Banco de Chile",
      "product_type": "tarjeta_credito",
      "categoria_articulo": 261,
      "total_credito_clp": 517442,
      "reason": "CPF de portabilidad: tarjeta Visa Platinium con cupo propio, NO listada en el CMF (el CMF solo trae el crédito de consumo de Banco de Chile). Sin morosidad → Art. 261.",
      "document_filename": "CPF-1767634532-649919-cl-REDBANC-ICL 6.pdf",
      "needs_lawyer_confirmation": true,
      "evidence": { "rut_emisor": "97004000-5", "numero_operacion": "4561-XXXX-2210", "moneda": "CLP", "cita_monto": "Saldo a la fecha: $517.442", "confidence": 0.88 }
    }
  ],
  "cmf260DirectOverrides": [
    {
      "institucion_cmf": "CAT S.A.",
      "monto_clp": 11275392,
      "fecha_vencimiento": "2025-09-05",
      "document_filename": "cert_cat.pdf",
      "evidence": { "rut_emisor": "99500840-6", "numero_operacion": "5301-XXXX", "moneda": "CLP", "cita_monto": "Monto total a pagar: $11.275.392", "cita_fecha": "Cobranza Judicial iniciada: 05/09/2025", "confidence": 0.9 }
    }
  ],
  "details": {
    "meets90DaysRequirement": true,
    "meetsAmountRequirement": true,
    "totalAmountCLP": 49454840,
    "creditorsWith90DaysCount": 2,
    "documentsAgeValid": true,
    "requiredCertificatesPresent": true
  }
}
\`\`\`
${loadReaderLessons('paso3')}
`;

    // --- Camino POR-DOCUMENTO (default en producción; desactivable con CENTINELA_PER_DOC=false) ---
    // Una llamada por certificado (solo extracción) + ensamblador determinista en TS, en vez de la
    // mega-llamada con todos los docs. Produce el mismo objeto `raw` (5 listas) que el LLM, y los
    // backstops post-LLM de abajo lo refinan igual. Ataca la causa raíz de la inestabilidad (L14):
    // leer un doc a la vez da atención total y lectura estable. La mega-llamada queda como fallback
    // explícito (CENTINELA_PER_DOC=false).
    let raw: any;
    const perDocMode = process.env.CENTINELA_PER_DOC !== 'false';
    if (perDocMode) {
      const perDocModel = process.env.CENTINELA_PER_DOC_MODEL || 'claude-sonnet-5';
      raw = await runPerDocExtraction(
        documents as any,
        cmfResult as any,
        catalog,
        clientRutForCerts,
        todayStr,
        anthropic,
        perDocModel,
        logger,
        supabase,
        { automationJobId: process.env.CURRENT_JOB_ID ?? null, rut: client.rut ?? null }
      );
    } else {
    const userMessageParts: any[] = [];
    userMessageParts.push({
      type: 'text',
      text: `Análisis estructurado pre-calculado local:\n${JSON.stringify(localAnalysis, null, 2)}`
    });

    userMessageParts.push({
      type: 'text',
      text: `\nContenido de CMF:\n${cmfText}`
    });

    for (const doc of documents) {
      if (doc.isImageDoc && doc.imageBase64) {
        userMessageParts.push({
          type: 'text',
          text: `\n=== CERTIFICADO IMAGEN: ${doc.filename} (Acreedor asignado: ${doc.institucion_cmf}, Tipo: ${doc.acreditacion_tipo}) ===`
        });
        userMessageParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: doc.imageMimeType || 'image/jpeg',
            data: doc.imageBase64
          }
        });
      } else if (doc.nativePdfBase64) {
        // Mejora #1: PDF NATIVO (escaneo/imágenes embebidas/baja densidad de texto). Claude lo lee
        // directo desde el documento adjunto; el texto de abajo (si hay) es solo apoyo parcial.
        userMessageParts.push({
          type: 'text',
          text: `\n=== CERTIFICADO PDF NATIVO: ${doc.filename} (Acreedor asignado: ${doc.institucion_cmf}, Tipo: ${doc.acreditacion_tipo}). LEÉ EL PDF ADJUNTO para monto/vencimiento/nº de operación: el texto digital extraíble es pobre o incompleto, así que el documento adjunto es la fuente principal. ===\nTexto de apoyo (parcial, puede faltar el dato):\n${doc.textContent}`
        });
        userMessageParts.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: doc.nativePdfBase64
          }
        });
      } else {
        userMessageParts.push({
          type: 'text',
          text: `\n=== CERTIFICADO TEXTO: ${doc.filename} (Acreedor asignado: ${doc.institucion_cmf}, Tipo: ${doc.acreditacion_tipo}) ===\n${doc.textContent}`
        });
      }
    }

    userMessageParts.push({
      type: 'text',
      text: `\nPor favor realiza el análisis preventivo (Centinela de Carga) y retorna el JSON encerrado en <json> y </json>.`
    });

    log(`Enviando consulta a Claude Sonnet 4.6 (${documents.length} certificado(s))...`);

    // Usar streaming — requerido cuando la respuesta supera los 10 min (muchos docs + thinking).
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessageParts }]
    });
    const response = await stream.finalMessage();

    const respText = response.content.find(b => b.type === 'text');
    const contentText = respText?.type === 'text' ? respText.text : '';

    // Extraer y parsear JSON
    const jsonMatch = contentText.match(/<json>([\s\S]*?)<\/json>/);
    if (!jsonMatch) {
      log(`⚠️ Respuesta cruda de Claude (sin etiquetas <json>):\n${contentText}`);
      log(`⚠️ Estructura completa de response.content:\n${JSON.stringify(response.content, null, 2)}`);
      throw new Error('No se encontró el bloque XML <json> en la respuesta de Claude.');
    }

    raw = JSON.parse(jsonMatch[1].trim());
    } // fin del camino mega-llamada (perDocMode === false)
    // doc_type que el LLM clasificó por documento (solo en el camino per-doc). Las heurísticas
    // deterministas de chat / no-acredita CONFÍAN en él (regex solo como fallback monolítico).
    const docTypeByFilename = new Map<string, string | undefined>(
      Object.entries((raw?.__docTypeByFilename ?? {}) as Record<string, string>)
    );
    // Estamparlo en los documentos para que los backstops (que reciben ctx.documents) lo vean.
    for (const d of documents) d.llmDocType = docTypeByFilename.get(d.filename);
    const docTextByName = new Map<string, string | undefined>(
      documents.map((d) => [d.filename, d.textContent])
    );
    const additionalCreditors: AdditionalCreditor[] = (raw.additionalCreditors || [])
      .filter((a: any) => {
        const isChat = isChatDocument(docTextByName.get(a.document_filename), a.document_filename, docTypeByFilename.get(a.document_filename));
        if (isChat) {
          log(
            `⚠️ Ignorando acreedor NO-CMF "${a.bank}" ($${(a.total_credito_clp ?? a.monto_clp ?? 0).toLocaleString('es-CL')}) ` +
            `extraído de un CHAT (${a.document_filename}): un WhatsApp/conversación NO acredita monto ni crea ` +
            `producto — solo aporta la fecha de mora (vencimiento) de productos ya existentes.`
          );
        }
        return !isChat;
      })
      .map((a: any) => ({
        ...a,
        total_credito_clp: a.total_credito_clp ?? a.monto_clp ?? 0,
        needs_lawyer_confirmation: true,
      }));

    // Fecha clave: cruce 261 → 260 (mora alcanza 91 días). Solo futuros (útiles para el abogado).
    const crossoverSources: { ref: string; start?: string }[] = [
      ...(raw.reclassifiedCreditors || []).map((r: any) => ({ ref: r.bank, start: r.delinquency_start_date })),
      ...additionalCreditors.map((a) => ({ ref: a.bank, start: a.delinquency_start_date })),
    ];
    for (const src of crossoverSources) {
      if (!src.start) continue;
      const start = parseDateString(src.start);
      if (!start) continue;
      const cross = addDays(start, 91);
      const dias = getDaysDifference(cross, todayDate);
      if (dias < 0) continue; // ya cruzó (ya habilita Art. 260)
      fechasClave.push({
        tipo: 'cruce_261_a_260',
        referencia: src.ref,
        fecha: fmt(cross),
        diasRestantes: dias,
        detalle: `Mora iniciada ${src.start}; alcanza 91 días (habilita Art. 260) en esta fecha.`,
      });
    }

    const reclassifiedCreditors = (raw.reclassifiedCreditors || []).map((r: any) => ({
      ...r,
      total_credito_clp: r.total_credito_clp ?? r.monto_clp ?? 0,
    }));
    const identified261Creditors = (raw.identified261Creditors || []).map((i: any) => ({
      ...i,
      total_credito_clp: i.total_credito_clp ?? i.monto_clp ?? 0,
    }));
    const deReclassified261Creditors = (raw.deReclassified261Creditors || []).map((r: any) => ({
      ...r,
      total_credito_clp: r.total_credito_clp ?? r.monto_clp ?? 0,
    }));

    const result: SentinelResult = {
      // M2: no confiar ciego en raw.success. Si Claude omite el campo, inferir del
      // shape (hay errores → false; sin errores → true) en vez de bloquear un caso válido.
      success: typeof raw.success === 'boolean'
        ? raw.success
        : !(Array.isArray(raw.errors) && raw.errors.length > 0),
      errors: raw.errors || [],
      reclassifiedCreditors,
      identified261Creditors,
      additionalCreditors,
      cmf260DirectOverrides: raw.cmf260DirectOverrides || [],
      deReclassified261Creditors,
      fechasClave,
      // Señales que el ensamblador por-documento (assembleRawFromDocFacts) ya trae armadas como
      // ClaudeReadIssue (p.ej. discrepancia de fecha_mora entre el extractor y la calculadora,
      // mora-runner.ts). ⚠️ A diferencia de `_dedupDrops`/`_fechaNoAcreditada` (transitorios sin
      // esta línea, medido: 0 filas en `automation_alerts` los mencionan — nunca llegaron a
      // `result`), este SÍ se copia acá, así que SÍ llega a `applyDeterministicBackstops`
      // (que hace `mergeReadIssues` encima) y de ahí a `centinelaOutput.claudeReadIssues`.
      claudeReadIssues: raw.claudeReadIssues,
      details: raw.details,
    };

    // --- Cadena determinista de backstops + validación anti-error ---
    // Toda la lógica de blindaje (completitud, reconciliación, gate 260→261 + rescate-chat,
    // promoción de overflow, validación anti-error de la lectura de Claude) vive ahora en
    // sentinel_backstops.ts → función PURA y UNIT-TESTEABLE sin API. Muta `result` in place
    // (contrato de salida idéntico al que corría inline).
    await applyDeterministicBackstops(
      result,
      {
        cmfCreditors: cmfResult.creditors,
        documents,
        certificateAnalyses,
        catalog,
        clientRut: clientRutForCerts,
        todayDate,
      },
      log
    );
    return result;

  } catch (err: any) {
    logError('Error en verificación del Centinela:', err);
    return {
      success: false,
      technicalError: true,
      errors: [`Error interno durante la validación del Centinela: ${err.message || err}`],
      details: {
        meets90DaysRequirement: false,
        meetsAmountRequirement: false,
        totalAmountCLP: 0,
        creditorsWith90DaysCount: 0,
        documentsAgeValid: false,
        requiredCertificatesPresent: false,
      },
    };
  } finally {
    // Limpieza de archivos CMF locales temporales
    try {
      if (fs.existsSync(cmfLocalPath)) fs.unlinkSync(cmfLocalPath);
    } catch {}
  }
}
