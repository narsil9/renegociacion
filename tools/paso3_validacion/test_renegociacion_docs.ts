/**
 * VALIDACIÓN sobre los casos reales de `renegociacion_docs/` (13 clientes previos).
 *
 * Claude actuó como el Centinela (lectura nativa de los PDFs del Paso 3) y volcó, por caso, un JSON
 * con: filas del CMF, DocFacts por certificado, y la declaración ESPERADA.
 * ⚠️ NO hay verdad-terreno del abogado. El "esperado" es un set DERIVADO (CMF + carpetas 260/261/NO-CMF +
 * lectura); los `analisis_deudas.md` de algunas carpetas los generó una IA en sesiones previas, NO el abogado.
 * Por eso el conteo "N/13" es CONSISTENCIA INTERNA, no concordancia con lo que el abogado cargó. Lo válido
 * sin verdad-terreno: los bugs de TS (lógica/aritmética, golden tests) y las reglas de lectura (texto del PDF).
 *
 * Este arnés toma esos JSON y corre la capa DETERMINISTA REAL de producción:
 *    assembleRawFromDocFacts (ancla al CMF)  →  applyDeterministicBackstops (refina)
 * y compara la declaración resultante contra la esperada (conteo por institución + total + 260/261).
 * Objetivo: cazar bugs del lado TS y discrepancias de lectura → lecciones para el Centinela.
 *
 * Los JSON viven en el scratchpad de la sesión (no se commitean): REPORTS_DIR abajo.
 * Para congelarlos en el repo, copialos a tools/paso3_validacion/reneg_fixtures/.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_renegociacion_docs.ts [caso]
 */
import * as fs from 'fs';
import * as path from 'path';
import { assembleRawFromDocFacts, DocFacts } from '../../src/utils/sentinel_per_doc';
import { applyDeterministicBackstops } from '../../src/utils/sentinel_backstops';
import { canonicalInstitutionKey } from '../../src/utils/acreedor_matcher';

const TODAY = '2026-06-29';
const UF = 40661;

// Directorio de reportes. Preferí una copia congelada en el repo si existe; si no, el scratchpad.
const FIXTURE_DIR = path.join(__dirname, 'reneg_fixtures');
const SCRATCH_DIR =
  '/private/tmp/claude-501/-Users-patomartini-Desktop-renegociacion-paso3/bf085935-7b51-44be-838a-b75c1283acb8/scratchpad/reneg_reports';
const REPORTS_DIR = fs.existsSync(FIXTURE_DIR) ? FIXTURE_DIR : SCRATCH_DIR;

// ---- Tipos del reporte del Centinela (lo que escribieron los lectores) ----
interface RepProduct {
  operacion?: string; monto: number; etiqueta_monto?: string; moneda?: 'CLP' | 'UF';
  fecha_mora?: string | null; dias_mora_doc?: number; cita_monto?: string; cita_fecha?: string; confidence?: number;
}
interface RepDocFacts {
  filename: string; institucion_asignada?: string | null; doc_type?: string;
  rut_emisor?: string; emisor_nombre?: string;
  totales_por_moneda?: { moneda: string; monto: number; cita: string }[];
  productos: RepProduct[];
}
interface RepExpected { institucion: string; monto: number; art: 260 | 261; cmf: boolean; doc?: string; nota?: string; }
interface RepCmfRow { institucion: string; tipoCredito: string; totalCredito: number; overdue90Days: number; }
interface CaseReport {
  case: string; rut?: string; cmf_cut_date?: string | null;
  cmf_rows: RepCmfRow[]; doc_facts: RepDocFacts[]; expected_declaration: RepExpected[];
  ground_truth_source?: string; reading_notes?: string[];
}

const log = (m: string) => {}; // silencioso (los backstops loguean mucho); cambiá a console.log para depurar
const logger = { log: () => {}, error: (m: string) => console.error(m) };

/** tipoCredito humano del CMF → enum interno que usan los backstops (bucket/gate). */
function tipoToEnum(t: string): 'credito_consumo' | 'tarjeta_credito' | 'otro' {
  const s = (t || '').toLowerCase();
  if (/tarjeta|visa|master|cmr|cat\b|car\b/.test(s)) return 'tarjeta_credito';
  if (/consumo|cuota/.test(s)) return 'credito_consumo';
  return 'otro';
}

/** DocFacts del reporte → DocFacts del ensamblador (rellena cita/confidence faltantes). */
function toDocFacts(d: RepDocFacts): DocFacts {
  return {
    filename: d.filename,
    institucion_asignada: d.institucion_asignada ?? null,
    doc_type: (d.doc_type as any) ?? 'otro',
    emisor_nombre: d.emisor_nombre,
    rut_emisor: d.rut_emisor,
    totales_por_moneda: d.totales_por_moneda as any,
    productos: (d.productos ?? []).map((p) => ({
      operacion: p.operacion,
      monto: Number(p.monto) || 0,
      etiqueta_monto: p.etiqueta_monto ?? '',
      moneda: p.moneda === 'UF' ? 'UF' : 'CLP',
      fecha_mora: p.fecha_mora ?? undefined,
      cita_monto: p.cita_monto ?? `${p.etiqueta_monto ?? ''}: ${p.monto}`,
      cita_fecha: p.cita_fecha,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.9,
    })),
  };
}

/**
 * Conjunto declarado final = lo que step3 efectivamente ingresaría:
 *   cmf260DirectOverrides (260) + reclassifiedCreditors (260) + identified261Creditors (261) + additionalCreditors (NO-CMF).
 * El gate determinista, al degradar un 260 sin vencimiento, AGREGA el creditor a identified261 + deReclassified261
 * SIN quitar su override → para no contarlo doble, se EXCLUYE el override cuyo (banco, monto~5%) aparece en
 * deReclassified261 (ese override quedó degradado; se cuenta una vez vía identified261). deReclassified NO se
 * cuenta (es un marcador). NO se hace dedup por (banco, monto) global: dos productos distintos del mismo banco
 * pueden tener el MISMO monto (ej. 2 créditos BCI de $200.255 con operaciones distintas) y son 2 filas reales.
 */
function declaredSet(raw: any): { key: string; monto: number; src: string; art: number }[] {
  const near5 = (a: number, b: number) => b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.05;
  const degraded = (raw.deReclassified261Creditors ?? []).map((d: any) => ({ key: canonicalInstitutionKey(d.institucion_cmf), monto: d.total_credito_clp }));
  const out: { key: string; monto: number; src: string; art: number }[] = [];
  for (const o of raw.cmf260DirectOverrides ?? []) {
    const key = canonicalInstitutionKey(o.institucion_cmf);
    if (degraded.some((d: any) => d.key === key && near5(d.monto, o.monto_clp))) continue; // override degradado → se cuenta vía id261
    out.push({ key, monto: o.monto_clp, src: '260', art: 260 });
  }
  for (const r of raw.reclassifiedCreditors ?? []) out.push({ key: canonicalInstitutionKey(r.institucion_cmf), monto: r.total_credito_clp, src: 'reclass', art: 260 });
  for (const r of raw.identified261Creditors ?? []) out.push({ key: canonicalInstitutionKey(r.institucion_cmf), monto: r.total_credito_clp, src: 'id261', art: 261 });
  for (const a of raw.additionalCreditors ?? []) out.push({ key: canonicalInstitutionKey(a.institucion_cmf), monto: a.total_credito_clp, src: `NOCMF${a.categoria_articulo}`, art: a.categoria_articulo });
  return out;
}

function countByKey<T extends { key?: string; institucion?: string }>(rows: T[], getKey: (r: T) => string): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of rows) { const k = getKey(r); acc[k] = (acc[k] ?? 0) + 1; }
  return acc;
}

async function runCase(rep: CaseReport): Promise<{ ok: boolean; detail: string }> {
  const lines: string[] = [];
  lines.push(`\n══════════ ${rep.case}  (esperado ${rep.expected_declaration.length}, fuente: ${rep.ground_truth_source ?? '?'}) ══════════`);

  // CMF fixture para el ensamblador (tipoCredito humano: necesario para detección UF/Vivienda)
  const cmfHuman = rep.cmf_rows.map((c) => ({ institucion: c.institucion, tipoCredito: c.tipoCredito, totalCredito: c.totalCredito, overdue90Days: c.overdue90Days }));
  const q90 = cmfHuman.filter((c) => c.overdue90Days > 0);
  const cmfFixture = {
    ufValueCLP: UF, meets90DaysRequirement: q90.length >= 2, meetsAmountRequirement: true,
    totalCreditoOf90PlusCreditors: q90.reduce((s, c) => s + c.totalCredito, 0), qualifying90PlusCount: q90.length,
    creditors: cmfHuman,
  };
  const facts = (rep.doc_facts ?? []).map(toDocFacts);

  // 1) Ensamblador (ancla al CMF)
  const raw = assembleRawFromDocFacts(facts, cmfFixture, [], rep.rut ?? null, TODAY, logger);

  // 2) Backstops deterministas (ctx con cmf en enum; documents sin local_path → completitud no re-lee PDF)
  const cmfEnum = rep.cmf_rows.map((c) => ({ institucion: c.institucion, tipoCredito: tipoToEnum(c.tipoCredito), totalCredito: c.totalCredito, overdue90Days: c.overdue90Days })) as any;
  const documents = (rep.doc_facts ?? []).map((d) => ({ filename: d.filename, institucion_cmf: d.institucion_asignada ?? null, textContent: '', isImageDoc: false })) as any;
  const { result, claudeReadIssues } = await applyDeterministicBackstops(raw, { cmfCreditors: cmfEnum, documents, certificateAnalyses: [], catalog: [], clientRut: rep.rut ?? null, todayDate: new Date(TODAY + 'T12:00:00') }, log);

  const declared = declaredSet(result);
  // El "expected" lo escribió un lector y a veces trae nombres compuestos verbosos
  // ("PRESTO LIDER / Servicios Financieros Lider BCI", "CAT (ex CENCOSUD) / CAT Administradora…").
  // Se canoniza la institución PRIMARIA (antes de " / ") para comparar por institución real.
  const expByKey = countByKey(rep.expected_declaration, (r) => canonicalInstitutionKey(r.institucion.split(' / ')[0]));
  const gotByKey = countByKey(declared, (r) => r.key);

  for (const d of declared) lines.push(`   [${d.src}] ${d.key.padEnd(36)} $${d.monto.toLocaleString('es-CL')}`);
  lines.push(`   — conteo por institución —`);
  let ok = declared.length === rep.expected_declaration.length;
  const allKeys = new Set([...Object.keys(expByKey), ...Object.keys(gotByKey)]);
  for (const k of [...allKeys].sort()) {
    const e = expByKey[k] ?? 0, g = gotByKey[k] ?? 0;
    if (e !== g) ok = false;
    lines.push(`     ${k.padEnd(38)} esperado ${e}  declarado ${g}  ${e === g ? '✅' : '⚠️'}`);
  }
  lines.push(`   TOTAL: esperado ${rep.expected_declaration.length}, declarado ${declared.length}  ${ok ? '✅' : '⚠️'}`);
  if (claudeReadIssues.length) lines.push(`   🔎 ${claudeReadIssues.length} señal(es) anti-error: ${[...new Set(claudeReadIssues.map((i: any) => i.tipo))].join(', ')}`);
  return { ok, detail: lines.join('\n') };
}

async function main() {
  const only = process.argv[2];
  if (!fs.existsSync(REPORTS_DIR)) { console.error(`No existe el directorio de reportes: ${REPORTS_DIR}`); process.exit(1); }
  const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.json') && (!only || f.includes(only))).sort();
  if (files.length === 0) { console.error(`Sin reportes .json en ${REPORTS_DIR}`); process.exit(1); }

  console.log(`Cargando ${files.length} reporte(s) desde ${REPORTS_DIR}\n`);
  const results: { case: string; ok: boolean }[] = [];
  for (const f of files) {
    let rep: CaseReport;
    try { rep = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8')); }
    catch (e: any) { console.error(`❌ ${f}: JSON inválido — ${e.message}`); results.push({ case: f, ok: false }); continue; }
    try {
      const r = await runCase(rep);
      console.log(r.detail);
      results.push({ case: rep.case, ok: r.ok });
    } catch (e: any) {
      console.error(`❌ ${rep.case}: error al correr — ${e.message}\n${e.stack}`);
      results.push({ case: rep.case, ok: false });
    }
  }

  console.log(`\n${'═'.repeat(60)}\nRESUMEN — renegociacion_docs (capa determinista real)\n${'═'.repeat(60)}`);
  for (const r of results) console.log(`  ${r.ok ? '✅' : '⚠️ '} ${r.case}`);
  const okN = results.filter((r) => r.ok).length;
  console.log(`\n${okN}/${results.length} casos reproducen el SET ESPERADO.`);
  console.log(`⚠️ NO hay verdad-terreno del abogado (ni screenshots del portal, ni registro de lo que cargó).`);
  console.log(`Los 'analisis_deudas.md' (betzy/nicolas/susana) fueron generados por AGENTES DE IA en sesiones`);
  console.log(`previas, NO por el abogado; y el 'esperado' del resto lo derivé yo del CMF + carpetas + lectura.`);
  console.log(`→ El "${okN}/${results.length}" es CONSISTENCIA INTERNA (IA contra IA), no concordancia con el abogado.`);
  console.log(`Lo válido SIN verdad-terreno: (a) los bugs de TS = errores de lógica/aritmética (doble conteo, $0,`);
  console.log(`dedup) verificables por golden tests; (b) las reglas de lectura L23–L26, ancladas en el TEXTO del PDF.`);

  // Guard de regresión: estos casos HOY pasan exacto gracias a los fixes deterministas. Si alguno
  // deja de pasar, un cambio rompió la capa determinista → exit≠0. (Los demás son reading-limited
  // y quedan informativos: su ⚠️ no debe hacer fallar el build.)
  const EXPECTED_PASS = new Set(['alejandra_espinoza', 'carlos_uribe', 'cinthia_rodriguez', 'irene_arevalo', 'jaime_cartes', 'maria_paz_bravo', 'nicolas_bascunan', 'noelia_lorca', 'susana_matamala', 'william_montero']);
  const regressions = results.filter((r) => EXPECTED_PASS.has(r.case) && !r.ok);
  if (regressions.length > 0) {
    console.error(`\n❌ REGRESIÓN: ${regressions.map((r) => r.case).join(', ')} dejó de reproducir la declaración esperada.`);
    process.exit(1);
  }
  console.log(`\n✅ Sin regresiones en los ${EXPECTED_PASS.size} casos-guía deterministas.`);
}

main();
