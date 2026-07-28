/**
 * TEST de esDocumentoDeIngreso — qué NO tiene que leer el Paso 3.
 *
 * Regla: un documento es "de ingreso" solo si NO tiene ninguna marca de certificado de
 * acreedor. Ante la duda, NO es de ingreso → lo lee el Paso 3. Preferimos pagar una
 * lectura de más a dejar un acreedor sin declarar.
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_doc_scope.ts
 */
import { esDocumentoDeIngreso } from '../../src/utils/doc_scope';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('═══ esDocumentoDeIngreso ═══');

// SÍ son de ingreso: sin institución, sin tipo de acreditación, y con nombre inequívoco.
check('liquidación de sueldo', esDocumentoDeIngreso({ filename: 'liquidacion (2).pdf' }));
check('certificado de cotizaciones', esDocumentoDeIngreso({ filename: 'cotizaciones (2).pdf' }));
check('liquidación con mayúsculas y tilde', esDocumentoDeIngreso({ filename: 'LIQUIDACIÓN Marzo.PDF' }));

// NO son de ingreso: cualquier marca de certificado de acreedor manda.
check('cert con institución asignada NO es ingreso',
  !esDocumentoDeIngreso({ filename: 'liquidacion.pdf', institucion_cmf: 'Banco de Chile' }));
check('acreditacion_tipo=monto NO es ingreso',
  !esDocumentoDeIngreso({ filename: 'liquidacion.pdf', acreditacion_tipo: 'monto' }));
check('acreditacion_tipo=vencimiento NO es ingreso',
  !esDocumentoDeIngreso({ filename: 'liquidacion.pdf', acreditacion_tipo: 'vencimiento' }));
check('document_type=22 NO es ingreso',
  !esDocumentoDeIngreso({ filename: 'liquidacion.pdf', document_type: 22 }));
check('document_type=23 NO es ingreso',
  !esDocumentoDeIngreso({ filename: 'liquidacion.pdf', document_type: 23 }));

// Ante la duda, NO es de ingreso: el Paso 3 lo lee.
check('nombre desconocido NO es ingreso', !esDocumentoDeIngreso({ filename: 'documento.pdf' }));
check('certificado de deuda NO es ingreso', !esDocumentoDeIngreso({ filename: 'Certificado (4)_merged.pdf' }));
check('estado de cuenta NO es ingreso', !esDocumentoDeIngreso({ filename: 'EECC junio.pdf' }));
check('nombre vacío NO es ingreso', !esDocumentoDeIngreso({ filename: '' }));

// Trampa real: "liquidacion_payoff" es un CERTIFICADO DE DEUDA, no una liquidación de
// sueldo. Su nombre suele traer "liquidacion" — por eso la palabra sola no alcanza y
// el desempate lo dan las marcas de acreedor. Sin marcas, se lee en el Paso 3.
check('liquidación de prepago sin marcas se lee en Paso 3',
  !esDocumentoDeIngreso({ filename: 'liquidacion_prepago_credito.pdf' }),
  'debe leerse en Paso 3: puede ser un payoff');

// Variantes REALES de un certificado de liquidación/prepago: la palabra de deuda no está
// pegada a "liquidacion". Antes se colaban como ingreso y el acreedor desaparecía.
check('liquidación final de crédito NO es ingreso',
  !esDocumentoDeIngreso({ filename: 'liquidacion final de credito hipotecario.pdf' }));
check('comprobante de liquidación de crédito entre paréntesis NO es ingreso',
  !esDocumentoDeIngreso({ filename: 'Comprobante de liquidacion (credito hipotecario BancoEstado).pdf' }));
check('liquidación total crédito consumo NO es ingreso',
  !esDocumentoDeIngreso({ filename: 'liquidacion total credito consumo.pdf' }));
check('cualquier mención de deuda desactiva el filtro',
  !esDocumentoDeIngreso({ filename: 'liquidacion 2026 deuda banco.pdf' }));

// Los nombres que EXISTEN hoy en producción tienen que seguir siendo ingreso: si el filtro
// se vuelve tan estricto que no saca nada, la tarea deja de ahorrar.
check('liquidacion.pdf (nombre real de producción) sí es ingreso',
  esDocumentoDeIngreso({ filename: 'liquidacion.pdf' }));
check('liquidacion (1).pdf (nombre real de producción) sí es ingreso',
  esDocumentoDeIngreso({ filename: 'liquidacion (1).pdf' }));
check('cotizaciones (2).pdf (nombre real de producción) sí es ingreso',
  esDocumentoDeIngreso({ filename: 'cotizaciones (2).pdf' }));

console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
