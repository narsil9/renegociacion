/**
 * Tests DETERMINISTAS (sin API, sin Playwright, sin Supabase) de los invariantes y las
 * utilidades nuevas del Paso 3. Corre en milisegundos y NO gasta créditos. Sirve de
 * regresión para las reglas duras del parser CMF y las mejoras #2/#3/#4/#6.
 *
 * Uso:
 *   npx ts-node --transpile-only casos/_shared/test_reglas_deterministas.ts
 */
import { sliceCmfDebtBlocks, cleanTipoCredito } from '../../src/utils/cmf_analyzer';
import { detectDocumentCurrency, normalizeOperationId } from '../../src/utils/cert_line_items';
import { classifyNonAccreditingDoc as classifyNADoc } from '../../src/utils/sentinel';
import { topNCandidates, AcreedorCatalogEntry } from '../../src/utils/acreedor_matcher';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('\n═══ Reglas duras del parser CMF ═══');
// Regla 1 — "Créditos Disponibles" (cupo sin usar) NO debe entrar en el parseo de deuda.
{
  const layout = [
    'Deuda Directa',
    'BANCO DE CHILE   Consumo   1.000.000   0   0   0   500.000',
    'Deuda Indirecta',
    'BANCO BICE   Comercial   0   0   0   0   0',
    'Créditos Disponibles',
    'BANCO FALABELLA   Linea de credito   9.999.999',  // <- cupo disponible, NO es deuda
  ].join('\n');
  const { directBlock, indirectBlock } = sliceCmfDebtBlocks(layout);
  ok('Deuda Directa incluye Banco de Chile', directBlock.includes('BANCO DE CHILE'));
  ok('Deuda Directa NO incluye la sección Créditos Disponibles', !directBlock.toLowerCase().includes('créditos disponibles') && !directBlock.includes('BANCO FALABELLA'));
  ok('Deuda Indirecta NO incluye Créditos Disponibles', !indirectBlock.includes('BANCO FALABELLA'));
  ok('El cupo disponible (BANCO FALABELLA $9.999.999) queda FUERA de ambos bloques de deuda',
     !directBlock.includes('9.999.999') && !indirectBlock.includes('9.999.999'));
}

// Regla 2 — Tarjeta de crédito SIEMPRE 'Tarjeta de crédito', NUNCA 'Línea de crédito'.
{
  ok("'Tarjeta de Crédito' → Tarjeta de crédito", cleanTipoCredito('Tarjeta de Crédito') === 'Tarjeta de crédito');
  ok("'Tarjeta de Crédito Línea ...' → Tarjeta (no Línea)", cleanTipoCredito('Tarjeta de Crédito Línea Rotativa') === 'Tarjeta de crédito');
  ok("'tarjeta' suelto → Tarjeta de crédito", cleanTipoCredito('tarjeta') === 'Tarjeta de crédito');
  ok("'Línea de Crédito' → Línea de crédito", cleanTipoCredito('Línea de Crédito') === 'Línea de crédito');
  ok("'Consumo' → Consumo", cleanTipoCredito('Consumo') === 'Consumo');
}

console.log('\n═══ Mejora #3 — moneda UF vs pesos ═══');
{
  ok('Hipotecario en UF → UF', detectDocumentCurrency('Saldo del Crédito (UF): 3.538,959 | Costo Total del Prepago (UF): 3.559,669') === 'UF');
  ok('Consumo en pesos → CLP', detectDocumentCurrency('Saldo Deuda $36.130.323.- Total a pagar en pesos') === 'CLP');
  ok('Texto vacío → null', detectDocumentCurrency('') === null);
  ok('Mención marginal de UF sin montos → no fuerza UF', detectDocumentCurrency('El interés se reajusta. Monto: $1.250.000') === 'CLP');
}

console.log('\n═══ Mejora #2 — normalización de Nº de operación ═══');
{
  ok('Enmascarado de tarjeta', normalizeOperationId('5546-XXXX-9558') === '5546XXXX9558');
  ok('CRE con espacios/guion', normalizeOperationId('CRE - 00039038355') === 'CRE00039038355');
  ok('Mismo producto, dos formatos → misma clave', normalizeOperationId('CRE-00039038355') === normalizeOperationId('CRE 00039038355'));
  ok('Op muy corta → null (no fiable)', normalizeOperationId('12') === null);
  ok('Vacío → null', normalizeOperationId(undefined) === null);
}

console.log('\n═══ Mejora #4 — documentos que no acreditan ═══');
{
  // Vía cert_line_items (compat) y vía sentinel (la usada en el flujo).
  ok('Comprobante de pago SIN payoff → comprobante_pago',
     classifyNADoc('Comprobante de pago exitoso. Transferencia realizada por $50.000 a tu tarjeta.', 'x.pdf').tipo === 'comprobante_pago');
  ok('Cert con "Saldo Insoluto" NO se marca aunque mencione pago',
     classifyNADoc('Comprobante de pago. Saldo Insoluto a la fecha: $6.756.287', 'x.pdf').tipo === null);
  ok('Cartola de movimientos sin saldo de deuda → cartola',
     classifyNADoc('Cartola Histórica. Detalle de movimientos del período. Cargo 12.000 Abono 5.000', 'x.pdf').tipo === 'cartola');
  ok('Estado de cuenta con Monto Utilizado NO se marca',
     classifyNADoc('Cartola electrónica. Cupo Utilizado: $1.443.974. Costo monetario prepago $1.443.974', 'x.pdf').tipo === null);
  ok('Imagen/placeholder → null (sin texto determinista)',
     classifyNADoc('[IMAGEN: Claude analizará la imagen directamente]', 'x.png').tipo === null);
}

console.log('\n═══ Mejora #6 — top-N candidatos del catálogo ═══');
{
  const cat: AcreedorCatalogEntry[] = [
    { id: 1, nombre: 'BANCO DE CHILE', nombre_normalizado: 'banco de chile', tipo: null, rut: '97004000-5', direccion: null, comuna: null, email: null, telefono: null, representante_legal: null, rut_representante: null, activo: true },
    { id: 2, nombre: 'BANCO FALABELLA', nombre_normalizado: 'banco falabella', tipo: null, rut: '96509660-4', direccion: null, comuna: null, email: null, telefono: null, representante_legal: null, rut_representante: null, activo: true },
    { id: 3, nombre: 'CMR FALABELLA', nombre_normalizado: 'cmr falabella', tipo: null, rut: '76645030-k', direccion: null, comuna: null, email: null, telefono: null, representante_legal: null, rut_representante: null, activo: true },
    { id: 4, nombre: 'COOPEUCH', nombre_normalizado: 'coopeuch', tipo: null, rut: null, direccion: null, comuna: null, email: null, telefono: null, representante_legal: null, rut_representante: null, activo: true },
  ];
  const c1 = topNCandidates('Banco Falabela', cat, 3); // typo
  ok('"Banco Falabela" (typo) → Banco Falabella primero', c1.length > 0 && c1[0].entry.nombre === 'BANCO FALABELLA', JSON.stringify(c1.map(c => c.entry.nombre)));
  const c2 = topNCandidates('Falabella', cat, 3);
  ok('"Falabella" → sugiere ambas Falabella', c2.some(c => c.entry.nombre === 'BANCO FALABELLA') && c2.some(c => c.entry.nombre === 'CMR FALABELLA'));
  const c3 = topNCandidates('Cooperativa XYZ inexistente', cat, 3);
  ok('Nombre sin parecido → lista vacía o score bajo', c3.length === 0 || c3[0].score < 0.3);
}

console.log(`\n${'─'.repeat(50)}\nResultado: ${passed} OK, ${failed} fallidos\n`);
process.exit(failed > 0 ? 1 : 0);
