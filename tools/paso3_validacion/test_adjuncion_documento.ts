/**
 * TESTS de la elección del documento que se ADJUNTA a cada fila del Paso 3.
 *
 * Por qué existe: el Centinela deduplica los N estados de cuenta de un producto y sabe cuál
 * copia ganó (`document_filename`), pero ese dato se descartaba al cruzar la frontera hacia el
 * Paso 3, y la adjunción tenía que adivinar el archivo. En el caso María Barraza (feedback del
 * abogado, error 6) se declaró el monto del estado de JUNIO ($3.362.375) con el estado de MAYO
 * adjunto: el documento no acredita el monto declarado.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_adjuncion_documento.ts
 */
import { seleccionarDocsDeLaFila, contarMontosDistintosPorBanco, id261FilasAEmitir } from '../../src/automation/step3_acreedores';
import type { AcreditacionDoc } from '../../src/automation/step3_acreedores';

let ok = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    ok++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const doc = (filename: string, monto?: number, tipo: 22 | 23 | 24 = 22): AcreditacionDoc => ({
  institucion: 'Promotora CMR Falabella S.A.',
  tipo_documento: tipo,
  storage_path: `x/certs/${filename}`,
  local_path: `/tmp/${filename}`,
  filename,
  monto_clp: monto,
});

const nombres = (ds: AcreditacionDoc[]) => ds.map((d) => d.filename).join(', ');

console.log('═══ Adjunción: el archivo acompaña al monto declarado ═══');

// ── CASO BARRAZA / CMR ────────────────────────────────────────────────────────────────────
// El CMF trae CMR con mora 90+d, así que el Mapeador entra por la rama "Art.260 directos del
// CMF" y etiqueta los 5 documentos con el MISMO monto (el total del CMF). El desempate por
// monto se queda sin señal, empatan todos y `pickDoc` toma el primero del array = marzo.
// El Centinela había elegido el consolidado de 4 estados.
{
  const cinco = [
    doc('cmr_marzo.pdf', 3_250_000),
    doc('cmr_abril.pdf', 3_250_000),
    doc('cmr_mayo.pdf', 3_250_000),
    doc('cmr_junio.pdf', 3_250_000),
    doc('cmr_merge_4estados.pdf', 3_250_000),
  ];
  const elegidos = seleccionarDocsDeLaFila(cinco, 3_250_000, 'cmr_merge_4estados.pdf');
  check(
    'con 5 estados del mismo monto, gana el que citó el Centinela (no el primero del array)',
    elegidos.length === 1 && elegidos[0].filename === 'cmr_merge_4estados.pdf',
    `eligió: ${nombres(elegidos)}`
  );
}

// El caso EXACTO del feedback: monto declarado = el del consolidado, y el array empieza por mayo.
{
  const cinco = [
    doc('cmr_mayo.pdf', 3_250_000),
    doc('cmr_junio.pdf', 3_250_000),
    doc('cmr_merge_4estados.pdf', 3_250_000),
  ];
  const elegidos = seleccionarDocsDeLaFila(cinco, 3_362_375, 'cmr_junio.pdf');
  check(
    'el archivo citado manda aunque su monto_clp no sea el más cercano al declarado',
    elegidos.length === 1 && elegidos[0].filename === 'cmr_junio.pdf',
    `eligió: ${nombres(elegidos)}`
  );
}

// ── Las dos copias 22/23 del MISMO archivo tienen que sobrevivir juntas ───────────────────
// Una fila 260 sube el mismo PDF como tipo 22 (monto) y tipo 23 (vencimiento).
{
  const conPar = [
    doc('cmr_merge.pdf', 3_250_000, 22),
    doc('cmr_merge.pdf', 3_250_000, 23),
    doc('cmr_marzo.pdf', 3_250_000, 22),
  ];
  const elegidos = seleccionarDocsDeLaFila(conPar, 3_250_000, 'cmr_merge.pdf');
  check(
    'conserva las copias 22 y 23 del archivo citado',
    elegidos.length === 2 && elegidos.every((d) => d.filename === 'cmr_merge.pdf'),
    `eligió: ${nombres(elegidos)} (tipos ${elegidos.map((d) => d.tipo_documento).join('/')})`
  );
}

// ── Case-insensitive: el filename del JSON del LLM vs el de client_documents ──────────────
{
  const ds = [doc('Cert_Hites.PDF', 500_000), doc('otro.pdf', 500_000)];
  const elegidos = seleccionarDocsDeLaFila(ds, 500_000, 'cert_hites.pdf');
  check(
    'el match por nombre es case-insensitive',
    elegidos.length === 1 && elegidos[0].filename === 'Cert_Hites.PDF',
    `eligió: ${nombres(elegidos)}`
  );
}

// ── SIN archivo citado: se conserva el desempate por monto que ya existía ─────────────────
// Banco multi-producto (BdCh: tarjeta 260 + consumo 261 + línea 261) con certs distintos.
{
  const bdch = [
    doc('cert_tarjeta.pdf', 5_932_768),
    doc('cert_consumo.pdf', 19_077_809),
    doc('cert_linea.pdf', 1_400_000),
  ];
  const elegidos = seleccionarDocsDeLaFila(bdch, 19_000_000, undefined);
  check(
    'sin archivo citado, sigue ganando el monto más cercano (argmin)',
    elegidos.length === 1 && elegidos[0].filename === 'cert_consumo.pdf',
    `eligió: ${nombres(elegidos)}`
  );
}

// ── El archivo citado NO existe entre los candidatos → no se pierde la acreditación ───────
// Puede pasar con un output del Centinela cacheado antes de un rename. Cae al comportamiento
// previo en vez de dejar la fila sin documento.
{
  const ds = [doc('cert_a.pdf', 1_000_000), doc('cert_b.pdf', 9_000_000)];
  const elegidos = seleccionarDocsDeLaFila(ds, 9_000_000, 'no-existe.pdf');
  check(
    'si el archivo citado no está, cae al argmin en vez de devolver vacío',
    elegidos.length === 1 && elegidos[0].filename === 'cert_b.pdf',
    `eligió: ${nombres(elegidos)}`
  );
}

// ── Un cert multiproducto COMPARTIDO (único candidato) sirve a todas las filas ────────────
{
  const compartido = [doc('cert_multiproducto.pdf', undefined)];
  const elegidos = seleccionarDocsDeLaFila(compartido, 615, undefined);
  check(
    'un único cert sin monto_clp sigue sirviendo (retrocompatible)',
    elegidos.length === 1 && elegidos[0].filename === 'cert_multiproducto.pdf',
    `eligió: ${nombres(elegidos)}`
  );
}

// ── Docs sin monto_clp conviven con los que sí lo traen ──────────────────────────────────
{
  const mixto = [doc('con_monto.pdf', 1_000_000), doc('sin_monto.pdf', undefined), doc('otro.pdf', 8_000_000)];
  const elegidos = seleccionarDocsDeLaFila(mixto, 1_000_000, undefined);
  check(
    'el argmin conserva los docs sin monto_clp como candidatos',
    elegidos.some((d) => d.filename === 'con_monto.pdf') && elegidos.some((d) => d.filename === 'sin_monto.pdf'),
    `eligió: ${nombres(elegidos)}`
  );
}

// ── Multiproducto 261 en el camino REAL (fillStep3), no solo en planStep3Rows ────────────
// Hallazgo de session-sync: el fix de la Task 12 (id261 duplicado no dispara multiproducto ni
// duplica la deuda) se aplicó a `planStep3Rows` (step3_classify.ts), que NO tiene ningún
// llamador de producción — solo tests. `fillStep3` (step3_acreedores.ts, el camino que declara
// contra el portal real) mantenía su PROPIA copia de esta lógica sin el fix: un banco con dos
// id261 del mismo monto disparaba multiproducto igual, saltaba la fila del CMF, y declaraba la
// deuda DOS veces por el mismo monto en el portal real. Estas dos funciones son las que
// `fillStep3` usa ahora para el gate y la emisión.
console.log('\n═══ Multiproducto 261 en fillStep3 (contarMontosDistintosPorBanco / id261FilasAEmitir) ═══');
{
  const id261ByBankKey = new Map([
    ['banco falabella', [
      { total_credito_clp: 4_000_000 },
      { total_credito_clp: 4_000_000 },
    ]],
  ]);
  const montos = contarMontosDistintosPorBanco(id261ByBankKey);
  check('dos id261 con el MISMO monto cuentan como 1 (no 2)',
    montos.get('banco falabella') === 1, `montos=${montos.get('banco falabella')}`);
}
{
  const id261ByBankKey = new Map([
    ['banco falabella', [
      { total_credito_clp: 4_000_000 },
      { total_credito_clp: 1_500_000 },
    ]],
  ]);
  const montos = contarMontosDistintosPorBanco(id261ByBankKey);
  check('dos id261 con montos DISTINTOS cuentan como 2 (multiproducto real)',
    montos.get('banco falabella') === 2, `montos=${montos.get('banco falabella')}`);
}
{
  const ids = [
    { total_credito_clp: 4_000_000, ref: 'a.pdf' },
    { total_credito_clp: 4_000_000, ref: 'b.pdf' },
  ];
  const emitir = id261FilasAEmitir(ids);
  check('la emisión real dedupea por monto: 1 fila, no 2 (la deuda no se declara dos veces)',
    emitir.length === 1 && emitir[0].total_credito_clp === 4_000_000,
    `emitir=${JSON.stringify(emitir)}`);
}
{
  const ids = [
    { total_credito_clp: 4_000_000, ref: 'a.pdf' },
    { total_credito_clp: 1_500_000, ref: 'b.pdf' },
  ];
  const emitir = id261FilasAEmitir(ids);
  check('montos distintos: las dos filas se emiten (multiproducto legítimo no se pierde)',
    emitir.length === 2, `emitir=${JSON.stringify(emitir)}`);
}
{
  // Montos en 0/negativos no deben "consumir" el slot de dedup: cada fila sin monto se sigue
  // evaluando (la sube; fillStep3 la descarta después por "sin monto válido").
  const ids = [
    { total_credito_clp: 0, ref: 'a.pdf' },
    { total_credito_clp: 0, ref: 'b.pdf' },
  ];
  const emitir = id261FilasAEmitir(ids);
  check('montos en 0 no se deduplican entre sí (cada fila se evalúa después por su cuenta)',
    emitir.length === 2, `emitir=${JSON.stringify(emitir)}`);
}

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
