/**
 * TEST de fetchAcreedoresCatalog — el catálogo NO puede fallar en silencio.
 *
 * Contexto: `sentinel.ts` tragaba el error con un `catch {}` vacío. Un catálogo vacío
 * apaga el chequeo de RUT del emisor (que es BLOQUEANTE por `rut_mismatch`), la
 * reconciliación NO-CMF, la detección de emisor y los backstops — y el síntoma es
 * indistinguible de "el abogado no subió los certificados". Este test ancla el contrato
 * del que depende ese fix: la función LANZA ante un error de base, nunca devuelve [].
 *
 * Uso: npx ts-node --transpile-only tools/paso3_validacion/test_catalogo_acreedores.ts
 */
import { fetchAcreedoresCatalog, matchAcreedor } from '../../src/utils/acreedor_matcher';

let ok = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { ok++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

/** Cliente Supabase de mentira: `.from().select().eq()` resuelve a lo que le pasemos. */
function stubClient(respuesta: { data: any; error: any }): any {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve(respuesta),
      }),
    }),
  };
}

const FILA = {
  id: 1,
  nombre: 'Banco de Chile',
  nombre_normalizado: 'banco de chile',
  tipo: 'banco',
  rut: '97.004.000-5',
  direccion: null, comuna: null, email: null, telefono: null,
  representante_legal: null, rut_representante: null,
  activo: true,
  nombres_alternativos: ['Banco de Chile Tarjeta'],
};

async function main() {
  console.log('═══ fetchAcreedoresCatalog ═══');

  // 1) Error de base → LANZA. Es el contrato del que depende el fix de sentinel.ts:
  //    si devolviera [] en vez de lanzar, el `catch` de nivel superior nunca lo vería
  //    y el Centinela seguiría degradado en silencio.
  let lanzo = false;
  let mensaje = '';
  try {
    await fetchAcreedoresCatalog(stubClient({ data: null, error: { message: 'connection reset' } }));
  } catch (e: any) {
    lanzo = true;
    mensaje = String(e?.message ?? e);
  }
  check('error de base LANZA (no devuelve [])', lanzo);
  check('el mensaje nombra la tabla y la causa', mensaje.includes('acreedores_canonicos') && mensaje.includes('connection reset'), mensaje);

  // 2) Tabla vacía → devuelve [] sin lanzar. Es un caso DISTINTO del error de red, y por
  //    eso sentinel.ts lo chequea aparte: reintentar no sirve.
  const vacio = await fetchAcreedoresCatalog(stubClient({ data: [], error: null }));
  check('tabla vacía devuelve [] sin lanzar', Array.isArray(vacio) && vacio.length === 0);

  // 3) data null sin error → [] (defensa contra una respuesta rara de PostgREST)
  const nulo = await fetchAcreedoresCatalog(stubClient({ data: null, error: null }));
  check('data null sin error devuelve []', Array.isArray(nulo) && nulo.length === 0);

  // 4) Camino feliz: se puebla la normalización local y las variantes
  const cat = await fetchAcreedoresCatalog(stubClient({ data: [FILA], error: null }));
  check('carga la fila', cat.length === 1);
  check('puebla nombre_normalizado_local', cat[0].nombre_normalizado_local === 'banco de chile', String(cat[0].nombre_normalizado_local));
  check('puebla nombres_alternativos_norm', (cat[0].nombres_alternativos_norm ?? []).length === 1);

  // 5) Y con el catálogo cargado el matcher resuelve; con el catálogo vacío no puede.
  //    Esto es exactamente lo que se apagaba en silencio.
  check('matchea con catálogo cargado', matchAcreedor('Banco de Chile', cat).status === 'matched');
  check('sin catálogo NO matchea (el chequeo de RUT queda ciego)', matchAcreedor('Banco de Chile', []).status !== 'matched');

  console.log(`\n${fail === 0 ? '✅ TODOS OK' : '❌ ' + fail + ' FALLARON'} (${ok} ok, ${fail} fail)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('❌ Error inesperado en el test:', e); process.exit(1); });
