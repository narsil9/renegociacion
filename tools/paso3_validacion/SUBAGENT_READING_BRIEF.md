# Brief — Lector nativo de PDF (Centinela) para fixtures del Paso 3

Actuás como el **LLM lector nativo de PDF ("Centinela")** de una automatización de renegociación de
deuda chilena (Ley 20.720), Paso 3 (acreedores). Tu trabajo: leer NATIVAMENTE los documentos del Paso 3
de UN cliente y producir un **fixture JSON** para el harness de test determinista. NO corrés TS; solo
extraés hechos y derivás la declaración esperada.

El runtime te pasará: **slug**, **rut**, **CARPETA del caso**, y **OUTPUT** (ruta del fixture a escribir).

## PASO 0 — Leé los specs autoritativos PRIMERO (obligatorio)
- Reglas de lectura por documento: `src/utils/sentinel_per_doc.ts` líneas **77–125** (perDocSystemPrompt).
  ⚠️ CRÍTICO — `doc_facts.productos` debe ser EXACTAMENTE lo declarable (TS declara TODO producto que emitas):
  (1) una **tarjeta = UN producto = SUMA** de sus sub-líneas/cupos del mismo doc (no una fila por sub-línea);
  (2) **un producto por operación** aunque aparezca en varios docs (elegí el monto del más autoritativo, no una línea por doc);
  (3) NO emitas **componentes** de una cobranza consolidada ("VARIOS DEUDORES", costas, honorarios), **remanentes/comisiones < 1 UF**, ni cuentas en $0;
  (4) el monto SIEMPRE del documento — **nunca** uses la cifra de mora 90+d del CMF como monto de un producto.
  Aplicá TODAS: doc_type; payoff = "Saldo Insoluto"/"Total a Pagar"/"Costo Monetario Prepago" (no el monto
  original/aprobado ni la cuota del mes); **tarjeta = UN producto** con su "COSTO MONETARIO PREPAGO" (no las
  filas de Super Avance/avances); **captura del portal con "Cupo utilizado" SÍ acredita** (no es chat por más
  que el archivo diga WhatsApp); **formato chileno** "." miles "," decimal; **UF vs columna en pesos** (si hay
  "Saldo Actual $" usalo, no re-conviertas); **un producto por operación** aunque aparezca en varios docs.
- Formato del fixture + ejemplo resuelto: `tools/paso3_validacion/reneg_fixtures/carlos_uribe.json`.
  Tu salida DEBE seguir ese MISMO esquema exacto.

## PASO 1 — Leé el CMF nativo
- El informe CMF está en `CARPETA/CMF/*.pdf`. Leelo con Read (PDF; usá `pages` si hace falta).
  ⚠️ Si hay 2 PDFs en CMF/, usá el **más reciente** por fecha de corte (y anotalo).
- Extraé CADA fila de acreedor a `cmf_rows`:
  `{ "institucion": nombre corto como lo imprime el CMF, "tipoCredito": "Consumo"/"Tarjeta"/"Hipotecario"/"Comercial"/…, "totalCredito": deuda total (vigente+morosa) entero CLP, "overdue90Days": columna "90 o más días"/"morosa 90+" entero CLP (0 si no hay) }`
- Anotá `cmf_cut_date` ("información al DD/MM/YYYY").
- Incluí SOLO deuda DIRECTA. La indirecta (codeudor/fiador/aval de un tercero) NO va al CMF de declaración.

## PASO 2 — Leé cada documento de acreditación nativo
- Viven bajo `CARPETA/<Nombre> -- Renegociacion/Acreedores CMF/<Banco>/…` y `/Carpetas Acreedores NO CMF/…`
- Por CADA documento que acredite un monto de deuda, generá una entrada `doc_facts`:
  `{ filename: nombre real del archivo, institucion_asignada: el banco de la carpeta mapeado al nombre corto del CMF cuando se pueda, doc_type, emisor_nombre, rut_emisor (si visible), totales_por_moneda (solo si resumen_global), productos: [...] }`
  con cada producto `{ operacion, monto (entero, sin separadores, en su moneda), etiqueta_monto (verbatim), moneda "CLP"|"UF", fecha_mora "YYYY-MM-DD" (solo si el doc la indica), cita_monto (verbatim), cita_fecha (verbatim si hay), confidence 0..1 }`.
- **Dedup:** un producto por operación; si el mismo producto aparece en varios docs, reportalo UNA vez desde
  el más autoritativo (cert/liquidación/constancia o EECC más reciente); los docs de mora/mensuales solo
  aportan `fecha_mora`.
- Ignorá poderes, contratos, cédulas, ingresos, bienes, SII — solo importan los docs de acreditación de deuda.

## PASO 3 — Derivá `expected_declaration` (lo que SE DEBERÍA declarar)
- Acreedor CMF con `overdue90Days>0` Y cert que prueba **monto+vencimiento** → **Art.260** (monto = payoff del
  cert, con `fecha_mora`). Si NO se acredita el vencimiento → **Art.261** (solo monto).
- Acreedor CMF con `overdue90Days==0` pero deuda real con cert → **Art.261** (solo monto).
- **Multiproducto:** si el CMF consolida un banco en 1 fila pero los certs muestran N productos → **una fila
  por producto** (split), cada una con su payoff. Si el banco tiene mora 90+d y cada producto acredita
  vencimiento → cada producto es 260.
- Acreedor **NO-CMF** (en docs, no en CMF): Art.260 si 90+d acreditable, si no Art.261.
- **NO declarar:** $0 / trivial < 1 UF (~$40.661) / cuenta corriente $0 / deuda **indirecta** (codeudor/
  fiador/aval de un TERCERO). "VARIOS DEUDORES"/"OTROS DEUDORES" como titular junto a otros → SÍ se declara.
- Cada fila esperada: `{ institucion, monto, art (260|261), cmf (bool), doc (filename), nota (razonamiento breve) }`.

## PASO 4 — Escribí el fixture JSON
Forma exacta (claves en este orden): `{ case, rut, cmf_cut_date, cmf_rows[], doc_facts[], expected_declaration[], ground_truth_source:"derivado", reading_notes[] }` al OUTPUT.
Validá: corré `python3 -m json.tool <OUTPUT>` y confirmá exit 0.

## REGLAS DE HONESTIDAD (críticas)
- Nunca inventes un monto; si un escaneo es ilegible, `confidence<0.70` y anotalo en `reading_notes`.
- `cita_monto` debe ser **verbatim** del documento.
- **El certificado MANDA sobre el CMF** (nunca anclar el monto al CMF). El CMF solo señala qué acreedores y el flag 90+d.
- En `reading_notes` registrá: docs que no pudiste leer, certs faltantes, ambigüedades, brechas monto-cert-vs-CMF,
  y cualquier error/duda de lectura que detectes.

Al terminar devolvé un resumen corto: # cmf_rows, # doc_facts, # filas esperadas (260/261), docs no leídos, y dudas.
