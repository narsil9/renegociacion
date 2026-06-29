# Paso 3 — Acreedores (260/261) · lecciones para el Centinela

> Consumidor: el **Centinela** (`src/utils/sentinel.ts`). Ver [`README.md`](README.md) para el formato.
> Aplican además los [`principios-generales.md`](principios-generales.md) (cert>CMF, nunca $0 en silencio).

### L1 — Cotización de payoff ≠ recibo de pago
Un documento que dice **"Total a Pagar" / "Pago Total del Préstamo" / "Liquidación" / "Costo de
Prepago" / "Saldo para liquidar"** indica **cuánto hay que pagar para saldar el crédito** = es la
**deuda VIGENTE** → se **declara ese monto**. **NO** es prueba de pago. Solo se considera pagado si el
documento dice explícitamente **"pagado/cancelado"** con **fecha y número de transacción/comprobante**.
Ante la duda → **declarar el monto del certificado + alerta**; **nunca** $0 ni bajar la elegibilidad.
*(Testigo: Santander de Cristian — "PAGO TOTAL DEL PRÉSTAMO / TOTAL A PAGAR $6.985.718"; el LLM lo leyó
como "pagado→$0" y rompió la elegibilidad. Verdad-terreno: la abogada lo declaró en 260 por
$6.985.718.)* · **validada** (experimento + screenshots, 2026-06-29).

### L2 — Poblar `evidence` en TODOS los acreedores emitidos, no solo los del Art. 260 ✅ RESUELTO
El Centinela pide un objeto `evidence` (rut_emisor, numero_operacion, moneda, cita_monto, cita_fecha,
confidence) por acreedor para que TypeScript **verifique** la lectura. **Problema observado:** Claude lo
poblaba en `cmf260DirectOverrides` y `additionalCreditors` pero lo **omitía casi siempre** en
`identified261Creditors`/`deReclassified261Creditors` → solo ~40% verificable. **Fix aplicado:** exigir
evidence en las **4 listas** en REGLA 11 + ejemplos de `evidence` en identified261/additional del esquema.
**Resultado:** cobertura subió de ~40% a **~92%** (Miguel: 7/16 → 12/13). **Regla:** la evidencia es
obligatoria en las 4 listas — un 261 vigente también necesita su `cita_monto`.
*(Testigo: Miguel Lugo, re-corrida pre/post-fix, 2026-06-29.)* · **validada**.

### L3 — `rut_emisor` casi nunca se puebla → fallback determinista al texto del cert ✅ RESUELTO (parcial)
El cross-check de RUT (RUT del cert → catálogo → ¿es la institución asignada?) es la red anti-error
**más fuerte**, pero **solo corría si Claude reportaba `rut_emisor`** (lo poblaba ~1 vez en 20; enfatizarlo
en el prompt NO lo movió). **Fix aplicado (2026-06-29):** la Capa 2 ahora usa, cuando Claude NO da
`rut_emisor`, el **RUT extraído determinísticamente del TEXTO del cert** (reusa `computeRutCheckLocal` →
`certificateAnalyses.rutEmisorDetectado/bancoSegunRut`) y corre el mismo cross-check. **Validado: 0 falsos
positivos en los 3 casos** (incluso con instituciones asignadas como "Promotora CMR Falabella" — la
comparación por `canonicalInstitutionKey` es robusta). Límite restante: en **escaneos/imágenes sin capa de
texto** no hay RUT que extraer → ahí Capa 2 sigue dependiendo de que Claude lo reporte. *(Testigo: 3 casos.)*
· **validada** (no-FP) / pendiente solo el caso imagen-sin-texto.

### L4 — Confianza honesta en escaneos/garbled habilita la red de seguridad ✅
Cuando el documento es un escaneo de baja calidad y la lectura nativa sale dudosa, Claude **baja
`confidence`** — eso dispara la alerta de revisión. Confirmado funcionando: Itaú "Cart.Veida" (Cartera
Vencida mal leída) → Claude reportó `confidence` 0.65 en sus 2 productos; con el umbral ajustado a **<0.70**
la validación TS los marcó `baja_confianza` correctamente (2 señales). El monto igual se declara; solo se
alerta para revisión. *(Testigo: Certificado Itaú de Miguel, post-fix.)* · **validada** (2026-06-29).

### L5 — `cita_monto` debe ser VERBATIM, sin razonamiento mezclado
La cita es el respaldo anti-alucinación: TS chequea que el monto aparezca **literal** en ella. Observado:
a veces Claude mete su razonamiento dentro de la cita (ej. "Saldo Insoluto: 6.756.287 (Monto original:
8.183.872 — descartado por ser monto inicial...)"). Funciona (el monto está), pero la regla es: **citar
el fragmento textual del documento**; el razonamiento va en `reason`, no en `cita_monto`.
*(Testigo: Itaú consumo de Miguel.)* · **pendiente** (cosmético; no rompe la validación).

> **Nota de calidad (positiva).** En los 3 casos la **lectura nativa de Claude fue exacta** contra la
> verdad-terreno: payoffs correctos (Cristian Santander $6.985.718, Miguel Itaú $6.756.287 = saldo
> insoluto, NO el original $8.183.872), separadores de miles/UF bien interpretados, y la validación
> anti-cita (Capa 1) dio **cero falsos positivos**. Las brechas (L2/L3) son de **disciplina de campos
> de verificación**, no de mala lectura.

---

### L6 — La auto-cita (Capa 1) atrapa lecturas nativas inconsistentes ✅
La verificación "el monto declarado debe aparecer VERBATIM en `cita_monto`" no es decorativa: en una
corrida real de Néctor, Claude declaró **$35.977.919** para BancoChile Consumo pero citó **$37.700.317**
("Total deudas en PESO CHILENO ($CH) 37.700.317"). TS marcó `monto_sin_respaldo_en_cita` → el abogado lo
verifica. Es la red anti-alucinación funcionando sobre lectura nativa, donde no hay backstop por-texto.
*(Testigo: Néctor BancoChile, 2026-06-29.)* · **validada**.

### L7 — `claudeReadIssues` ahora SÍ llega al dashboard (propagación end-to-end) ✅
Las señales anti-error (auto-cita, RUT, confianza, moneda, doc-no-acredita, duplicado) se **perdían** en
`centinela_agent` (no estaban en `CentinelaOutput`). Fix: se agregaron a `CentinelaOutput.claudeReadIssues`
(+ bump de versión de idempotencia v16) y el worker las consolida en **una** `automation_alert`
(`needs_review`, informativa, no bloquea) vía `buildReadIssuesAlert`. Verificado E2E (agente real → output →
alerta). · **validada** (2026-06-29).

### L8 — Mejoras del flujo del supervisor: detectores conservadores, 0 falsos positivos ✅
Importadas #2 (dedup por nº de operación), #3 (moneda UF vs pesos), #4 (comprobante de pago/cartola no
acreditan), #6 (top-N candidatos del catálogo en la alerta). Diseño: **el LLM extrae hechos; TS marca para
revisión, NUNCA descarta acreedor ni pone $0** (G2). Validadas con 26 tests deterministas + **0 falsos
positivos** sobre los 3 casos reales (disparan solo bajo sus condiciones; los comprobantes de pago reales
de Cristian son escaneos → los cubre la regla del prompt + baja-confianza, no el detector de texto).
· **validada** (2026-06-29).

### L9 — Certificado de Deuda "global/resumen" (totales por moneda) NO es un producto ✅
Un "Certificado de Deuda" que lista solo **TOTALES POR MONEDA** ("Total deudas en PESO CHILENO $X / en
DÓLAR US$Y / en UNIDAD DE FOMENTO Z UF") **sin desglose por operación/producto** es un **resumen**, no un
certificado de un producto. Su total es la **SUMA** de varios créditos. Reglas:
- **NO declarar el total global como un acreedor/producto.** Los productos se declaran por separado desde
  sus certs/EECC individuales (tarjeta, línea, hipotecario, consumo).
- El total global se usa como **chequeo de sanidad** (Σ productos en pesos ≈ total peso; total UF ≈ hipotecario).
- ⚠️ Declarar el total global **+** los productos individuales = **doble conteo**.
*(Testigo: Néctor — BdCh "Certificado de Deuda" $37.700.317 peso = consumo+línea+2 tarjetas; el Centinela
lo leyó como un "Consumo $35.977.919" citando el total global → confundió el resumen con un producto, y de
ahí la inestabilidad 0/3/6 entre corridas. Verdad-terreno leída del documento por Claude, 2026-06-29.)* · **validada**.

### L10 — La MONEDA separa productos: UF = vivienda; pesos = consumo/tarjeta/línea (mejora #3 en vivo) ✅
En un banco multiproducto, el **total en UF** corresponde casi siempre al **hipotecario** (vivienda) y los
**pesos** a consumo/tarjeta/línea. Asignar por moneda: el saldo UF es UN producto vivienda; nunca mezclar la
cifra UF con la de pesos ni convertir y sumar al peso. *(Testigo: Néctor BdCh — 3.539,77 UF = vivienda $145M;
$37.700.317 = productos en pesos.)* · **validada**.

### L11 — Banco multiproducto SIN cert por producto → el CMF fija CUÁNTOS productos, no el LLM ✅
Cuando el banco solo entrega un resumen global y faltan certs individuales (ej. el consumo de BdCh no tiene
cert propio), **el número de productos lo fija el CMF** (lista las operaciones del banco); el monto de cada
uno sale de su cert individual y, si no existe, del CMF. El LLM NO debe inventar ni omitir productos repartiendo
el total global a ojo — esa es la causa raíz de la inestabilidad entre corridas. *(Testigo: Néctor BdCh 0/3/6.)*
· **validada**.

### L12 — Certificado per-producto (con desglose) = lectura estable; el riesgo es el ESCANEO ✅
Cuando el certificado del banco **desglosa por producto** (tabla con Nº operación + monto por línea: ej.
"Estado de Deuda" de BdCh, "Certificado de Deudas Vigentes" de BancoEstado, "Constancia" de Itaú con
secciones), la extracción es **correcta y estable**. El riesgo NO es el formato sino la **calidad del
escaneo**: en fotos/CamScanner de baja resolución el LLM ocasionalmente **omite UNA línea de producto**
(típicamente la de monto chico: la "Línea Preferencial" $500.000 de Itaú, una CRE chica de BancoEstado) →
de ahí el conteo 3/3/2 o 3/2/3 entre corridas. Mitigación: leer sección por sección; anclar el set de
productos del banco a las filas del CMF; modelo más capaz para escaneos.
*(Testigos: Miguel Itaú 3/3/2, Néctor BancoEstado 3/2/3 — ambos docs SÍ desglosan, el drop es del escaneo.)*
· **validada** (lectura directa de los docs, 2026-06-29).

### L13 — Certificado de Liquidación/Prepago: tabla de payoff por FECHA → un solo producto, monto del día ✅
Un "Certificado Liquidación de Crédito - Prepago" trae una **tabla con el monto a pagar para cada fecha**
sucesiva (la deuda crece día a día con interés). Es **UN solo producto**; se declara **un** monto = el del
día relevante (el más reciente / fecha de presentación). No declarar varias filas como productos distintos.
El monto puede diferir levemente entre corridas según qué fila de fecha se elija (mismo producto, ±intereses
de pocos días) — es variación de monto, NO de conteo.
*(Testigo: Cristian BancoEstado consumo — tabla $5.827.472 (29/05) → $5.884.108 (11/06); abogada usó
$5.884.108, robot $5.827.472. Mismo crédito.)* · **validada**.

> **Control positivo (importante).** La lectura nativa de Claude es **correcta** en los certs con desglose:
> Miguel BdCh 4/4 exacto, Itaú saldo insoluto $6.756.287 (no el original $8.183.872), Cristian Santander
> payoff $6.985.718. El problema de estabilidad se concentra en (1) **certificados resumen global** (L9) y
> (2) **escaneos de baja calidad de bancos multiproducto** (L12) — NO en la lógica de declaración.

### L14 — Leer UN documento por llamada, no todos en una mega-llamada ⭐ (causa raíz de la inestabilidad)
La automatización manda **TODOS los certificados + el CMF + el prompt en UNA sola llamada** a Claude
(`sentinel.ts`, un único `messages.stream` con N bloques) y le pide devolver TODO el JSON de una. Con
muchos documentos escaneados/multiproducto, el modelo reparte su atención y **deja caer o mezcla productos**,
distinto en cada corrida → de ahí la inestabilidad (Néctor 11 docs/9 escaneos = 0/9/12; Miguel 5 docs = 13/13/12).
**Evidencia decisiva:** leyendo **un documento a la vez** (como hizo Claude-oráculo esta sesión), la extracción
fue **correcta y completa en los 3 casos** (10/13/12, ver `tools/paso3_validacion/test_oracle_injection.ts`).
**Regla:** extraer hechos **por documento en su propia llamada** (atención total, contexto chico) y **combinar
en TypeScript**. Beneficios: estabilidad, reintento por-doc, menos tokens por llamada, y encaja con "el LLM
extrae hechos / TS arma la estructura". Secundario: usar un modelo más capaz (Opus) en escaneos.
*(Testigo: routing verificado con `diag_routing.ts` + comparación oráculo vs automatización, 2026-06-29.)* · **validada**.

## Pendientes / candidatas (a validar en próximas pruebas del Paso 3)

- **Capa 2 en imágenes/escaneos**: sin capa de texto no hay RUT determinista que extraer (L3). Cubrir con
  el RUT que reporte Claude en visión, o un OCR puntual del encabezado. *(pendiente)*
- **#4 sobre comprobante/cartola con CAPA DE TEXTO**: validado por unit test, aún sin caso real con texto
  (los reales fueron escaneos). Confirmar cuando aparezca uno. *(pendiente)*
- **L5 cosmético**: pedir a Claude que `cita_monto` sea fragmento textual sin razonamiento. *(pendiente)*
