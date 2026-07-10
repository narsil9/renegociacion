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

### L15 — La capa que blinda la estructura debe ser PURA y unit-testeable (sin API) ⭐
La cadena determinista que decide la estructura (reconciliación additional→id261, completitud por
`extractCertLineItems`, gate 260→261 + rescate-chat, promoción de overflow, validación anti-error)
vivía **inline dentro de `runSentinelCheck`**, que llama al LLM → no se podía testear sin gastar API.
**Regla:** extraerla a una función PURA (`applyDeterministicBackstops` en `sentinel_backstops.ts`) que
opera sobre el `raw` (venga del LLM o del ensamblador por-doc) → se valida con `raw` sintético, sin API.
Beneficio: el día que vuelve la cuota solo se confirma la LECTURA del LLM; la estructura ya quedó blindada
con golden tests. Encaja con el principio rector (*el LLM extrae hechos; TS blinda la estructura*) y lo
hace **verificable**. Batería determinista: `tools/paso3_validacion/run_all.ts` (5 suites, exit≠0 si falla).
*(Refactor de movimiento puro, 0 cambio de comportamiento; Miguel sigue 13/13 pre/post. 2026-06-29.)* · **validada**.

### L16 — Dedup determinista por Nº de operación: el MISMO producto en varios documentos ⭐ ✅
Un mismo crédito suele venir en **varios documentos** (estado de cuenta mensual + pantallazo de mora +
certificado de liquidación). Sin dedup, el ensamblador trataba **cada documento como un producto** y el
banco se **sobre-declaraba** (ej. Jaime: op 8004 y 8140 en `Santander creditos.pdf` y en `8004/8140
CREDITO.pdf`; Miguel/Itaú; betzy op 20933). **Fix (`sentinel_per_doc.ts`):** se reúnen todos los productos
y se deduplican por **(banco canónico + `normalizeOperationId`)** conservando uno (prioridad
liquidacion_payoff > desglose > estado_cuenta, luego confianza, luego monto; se hereda la `fecha_mora` de
cualquiera del grupo). Además se endureció `normalizeOperationId` (quita ceros a la izquierda y paréntesis:
`"000060451478"` ≡ `"60451478"` ≡ `"60451478 (Consumo)"`). **Límite:** si el MISMO producto trae números
distintos en cada doc (last-4 `*6620` vs PAN completo; `20933` vs `147…20933`) el dedup exacto NO los une
— un dedup *fuzzy* (por sufijo/monto) podría **tirar un acreedor real** (viola G2) → no se hace; queda la
**alerta `posible_duplicado`** + la lección L20. *(Testigos: Jaime, Miguel, betzy, 2026-06-29.)* · **validada**.

### L17 — Nunca declarar $0 + el monto en UTM debe convertirse a CLP ✅ / ⚠️
El ensamblador ahora **descarta todo producto con monto ≤ 0** (G2: nunca declarar $0; antes la tarjeta CAT
`*1940` con $0 de Cinthia y un Itaú $0 de María Paz se colaban como filas NO-CMF). ⚠️ **Lección de lectura
abierta:** las **multas de tránsito (RMNP)** y algunas deudas fiscales vienen expresadas en **UTM** y el
certificado **no imprime el equivalente en CLP** → el Centinela devuelve `monto 0` y el producto se cae
(correcto: no se declara $0, pero el acreedor se pierde). **Regla:** cuando el documento da el monto en
**UTM/UF**, el lector debe **convertir a CLP** (UTM/UF × valor del mes) y reportar el CLP; si no puede,
emitir el producto con `confidence` baja + alerta, nunca con $0. *(Testigos: William multas RMNP, Nicolás
multas Santiago/Las Condes — quedaron sin declarar por venir en UTM, 2026-06-29.)* · **pendiente (lectura)**.

### L18 — Gate 260→261 multiproducto: no inyectar el TOTAL del CMF si el banco ya está representado ⭐ ✅
**Bug determinista (general) encontrado y corregido.** Cuando un banco con mora 90+d es **multiproducto**
(el cert desglosa N operaciones y el CMF tiene 1 fila), el ensamblador crea **1 override** (con el monto de
UN sub-producto) + el resto en `identified261`. El gate de degradación 260→261 buscaba un override cercano
al **total del CMF**, no lo encontraba (el override vale lo de un sub-producto) y **inyectaba una fila extra
por el total del CMF** → **doble conteo** (Jaime: 3 ops Santander + una 4ª fila fantasma de $7.050.726 = el
total CMF). **Fix (`sentinel_backstops.ts`):** el gate ahora (1) **degrada los override(s) reales** del banco
a su propio monto y los quita de `cmf260DirectOverrides`; (2) si no hay override pero el banco **ya está
representado** por productos del cert (snapshot pre-gate de id261/reclass/additional) → **no inyecta nada**;
(3) **solo** inyecta el total del CMF cuando el banco 90+d **no tiene NINGÚN documento** (G2: no perderlo).
*(Testigo: Jaime Cartes; golden G3a intacto. 2026-06-29.)* · **validada**.

### L19 — Aliases del nombre CORTO del CMF + CAT/Cencosud + nombres compuestos " / " ✅
El CMF imprime la columna institución **sin el prefijo "Banco"** y con abreviaturas que no calzaban con el
nombre del certificado → el producto **no anclaba a su fila CMF** y caía a NO-CMF (doble conteo). Aliases
agregados en `acreedor_matcher.ts`: `"de credito e inversiones"→BCI`, `"internacional"→Banco Internacional`,
`"santander consumer finance"→Santander Consumer`, `"cat"→Cencosud Administradora de Tarjetas` (mismo RUT que
"CAT (ex CENCOSUD)"), `"car s a"→CAR S.A. Tarjeta Ripley`. Y `canonicalInstitutionKey` ahora corta también en
`" / "` (el LLM escribe nombres compuestos: `"CMR Falabella / Banco Falabella"`, `"PRESTO LIDER / Servicios…"`)
quedándose con la institución primaria. *(Testigos: Cinthia CAT, Nicolás/Yoselyn BCI, William Internacional,
María Paz CMR, 2026-06-29.)* · **validada**.

### L20 — Lectura: UN documento autoritativo por producto (no enumerar desde mensuales/mora) ⭐
La causa #1 de sobre-declaración es leer el **mismo producto desde varios documentos** (6 estados de cuenta
mensuales + pantallazo de mora + certificado) y emitir uno por cada uno. **Regla:** por cada producto, elegir
**UN** documento autoritativo (certificado de deuda / liquidación / estado de cuenta más reciente) y NO
enumerar el producto desde los demás (los de mora aportan solo la **fecha**, no un producto nuevo). El dedup
por Nº de operación (L16) solo salva el caso en que el nº coincide exacto; cuando difiere (last-4 vs PAN, op
corta vs larga) **el lector debe no duplicar**. *(Testigos: María Paz Itaú —4 docs, 3 ops—, Alejandra BdCh
—2 tarjetas leídas de la liquidación Y del EECC individual—, betzy op 20933, 2026-06-29.)* · **pendiente (lectura)**.

### L21 — Lectura: sumar sub-cupos de UNA tarjeta; el resumen global NO es producto (refuerza L9) ⭐
Una tarjeta con varios **"Super Avance"/avances en cuotas** es **UN producto**: el monto es la **suma de los
cupos utilizados** del período más reciente, no un producto por avance. El Centinela emitió 3 Super Avances de
la tarjeta CAT de Alejandra como 3 productos → CAT se infló. **Regla:** sumar los sub-cupos de una misma
tarjeta en un solo producto (ya estaba en las reglas; reforzar para "Super Avance"/"Avance en cuotas"). Y un
**Certificado de Deuda "resumen global"** (totales por moneda, sin desglose) NO es un producto (L9): los
`resumen_global` van con `productos` vacío (el ensamblador ya los trata como productless). *(Testigo: Alejandra
CAT; Jaime Tenpo resumen_global. 2026-06-29.)* · **pendiente (lectura)**.

### L22 — El robot puede declarar MÁS productos que el abogado (no es error) ✅
En varios casos el robot declara un producto **real** que el abogado omitió por atajo: una tarjeta BdCh de
$65.864 (Claudia), la Cuenta Vista CTAVIS $300.091 de Coopeuch (Yoselyn), operaciones BdCh con mora reciente
que el abogado dejó fuera del 260 (betzy). Declarar la deuda real **acreditada** es **más completo = correcto**
(regla del proyecto: el robot declara TODO lo acreditable). El "conteo del abogado" es referencia, no verdad
absoluta cuando el robot tiene el documento que respalda el producto extra. *(Testigos: Claudia, Yoselyn, betzy.)*
· **validada**.

> **Notas de lectura sueltas (validadas en esta tanda, 2026-06-29):**
> - **`doc_type` por CONTENIDO, no por filename:** un archivo `WhatsApp Image*.pdf` de Irene resultó ser una
>   **cartola de línea de crédito** (no un chat); el monto coincidía con la captura del portal. No clasificar
>   chat solo por el nombre.
> - **Depósito a plazo / fondo mutuo = ACTIVO, no deuda** (Claudia `Certificado_Vigente_Deposito_a_Plazo`): no declarar.
> - **Crédito cancelado tras el corte CMF** (Noelia BancoEstado, liquidación de cancelación saldo $0): decisión
>   del abogado (no declarar o declarar como cancelado) — no inflar con el saldo viejo del CMF.
> - **RUT del emisor a verificar contra catálogo** (Yoselyn: Caja Los Andes imprime RUT 71.551.500-8; el catálogo
>   tiene CCAF Los Andes 81.826.800-9): confirmar misma entidad antes de fiarse del nombre.

### L23 — Tarjeta: el payoff es "COSTO MONETARIO PREPAGO", NO las filas de la tabla de operaciones ⭐ ✅
**Impedimento (alejandra CAT):** el estado de cuenta de una tarjeta (CAT/Cencosud, CMR, Ripley) trae en
"II. DETALLE" una tabla de operaciones — p.ej. **3 "Super Avance"** ($4.689.696 / $2.816.604 / $9.800.400) en
dos numeraciones de la MISMA tarjeta (***1741 y ***6580). Leí cada fila como un producto → declaré 3 donde
había **1**. **Solución (en el prompt):** el payoff de UNA tarjeta es el **único** número
**"COSTO MONETARIO PREPAGO"** (sección "III. Información de Pago"): para Alejandra = **$11.275.392** (= lo que
declaró el abogado). La tabla de operaciones (Super Avances, compras en cuotas) son **componentes** de esa
tarjeta, no deudas separadas. Tampoco usar "Monto Total Facturado a Pagar"/"Monto Mínimo" (= cuota del mes).
Una tarjeta = un item con su COSTO MONETARIO PREPAGO. *(Testigo: Alejandra `Diciembre_2025_EECC.pdf`, releído
nativo 2026-06-29.)* · **validada** (regla agregada a `perDocSystemPrompt`).

### L24 — Captura del PORTAL bancario ≠ chat: si muestra "Cupo utilizado", acredita el saldo ⭐ ✅
**Impedimento (nicolas CMR):** el archivo `WhatsApp Image 2025-11-04….jpeg` resultó ser una **captura del home
de Banco Falabella** ("Mis Productos") que muestra **CMR Mastercard Elite ••2104, Cupo utilizado $558.113**.
Lo descarté por clasificarlo como "chat/captura" por el **nombre del archivo** → omití un acreedor real
($558.113, justo lo que declaró el abogado). **Solución:** un pantallazo del portal/app con "Cupo utilizado /
Saldo utilizado / Saldo adeudado / Monto adeudado" **SÍ acredita** el saldo → reportar el producto. `doc_type`
"chat" es SOLO una **conversación entre personas** (aporta fecha, no monto). **Clasificar por CONTENIDO, no por
el nombre del archivo** (refuerza la nota de Irene: un "WhatsApp*.pdf" era una cartola de línea de crédito).
*(Testigo: Nicolás, jpeg releído nativo 2026-06-29.)* · **validada** (regla agregada al prompt).

### L25 — UF: usar la columna en PESOS si existe; formato chileno "." = miles, "," = decimal ⭐ ✅
**Impedimento (william Scotiabank):** el "Reporte de Deuda" trae el saldo **ya convertido a pesos** en la
columna **"Saldo Actual $"** ($88.956.698 / $1.743.982 / $1.761.281 / $16.615.586), pero leí la columna UF
("Saldo MND origen" = `2.243,9113 UF`) y **mangleé la conversión** (interpreté "2.243,9113" como 22.439.113 y
multipliqué por la UF) → saldos de **billones** ($3.617.068.297.378). **Solución:** (1) si el reporte trae el
saldo en pesos ("Saldo Actual $"/"Capital $"/"Saldo $"), **usar ESE valor en CLP**, no re-convertir; (2) en
**formato chileno el "." es separador de MILES y la "," es DECIMAL** → `2.243,9113 UF` = 2243,9113 UF
(≈ $88,9M a $39.643/UF), NO 22.439.113; confundirlos infla la cifra ×1000 o más. *(Testigo: William
`ResumenCreditosConsumo.pdf`, releído nativo 2026-06-29.)* · **validada** (regla agregada al prompt).

### L26 — Un producto por operación/tarjeta aunque aparezca en VARIOS documentos ⭐ ✅
**Impedimento (maria_paz Itaú; alejandra BdCh; betzy op 20933):** el mismo crédito/tarjeta viene en varios
archivos (Constancia + "MORA ITAU" + "OP VIGENTE" + estados mensuales; o la liquidación Redbanc Y el estado de
cuenta individual de la misma tarjeta ***8084/***4870) y reporté **uno por archivo** → sobre-declaré (Itaú 3
ops leídas hasta 7 veces; BdCh 2 tarjetas leídas 4 veces). **Solución de lectura:** reportar el producto **UNA
sola vez** desde el documento **más autoritativo** (certificado / liquidación / constancia, o el estado de
cuenta más reciente); los documentos de **mora/mensuales** solo aportan la **fecha**, no un producto nuevo.
Identidad del producto = **Nº de operación o los 4 últimos dígitos de la tarjeta** (no el texto descriptivo).
TS deduplica por Nº de operación EXACTO (L16), pero cuando el número difiere por documento (last-4 vs PAN,
op corta vs larga) **el lector NO debe duplicar** — TS no puede unir por monto sin arriesgar tirar un acreedor
real (G2). *(Testigos: María Paz Itaú, Alejandra BdCh, Betzy. 2026-06-29.)* · **validada** (regla al prompt).

> **Cierre de la tanda de 13 (2026-06-29):** de los 4 casos que fueron error MÍO de lectura, el impedimento y
> su solución quedaron en el prompt (`perDocSystemPrompt`) y acá (L23–L26). Verificado con el arnés: aplicando
> la lectura correcta, la capa determinista (ensamblador + backstops) reproduce el set esperado → el residual
> NO era de TS. ⚠️ **Honestidad metodológica (clave):** NO hay verdad-terreno del abogado. Los `analisis_deudas.md`
> (betzy/nicolas/susana) fueron **generados por agentes de IA en sesiones previas, NO por el abogado**, y el
> "esperado" del resto lo derivé yo del CMF + carpetas + lectura. Por eso el "10/13" es **consistencia interna
> (IA contra IA)**, NO prueba de lo que el abogado cargó (de hecho el análisis IA de Betzy ya tenía errores —
> citaba certs inexistentes). Lo robusto e independiente de toda verdad-terreno: (a) los **bugs de estructura**
> = errores de lógica/aritmética (doble conteo, $0, dedup) verificables por golden tests; (b) estas **reglas de
> lectura**, ancladas en el TEXTO del documento. Los casos con **documentos faltantes/inadecuados** (Betzy certs ausentes,
> multas en UTM sin CLP, Santander Consumer sin payoff) no los arregla ningún lector: el abogado completa la carpeta.

## Pendientes / candidatas (a validar en próximas pruebas del Paso 3)
- **Capa 2 en imágenes/escaneos**: sin capa de texto no hay RUT determinista que extraer (L3). Cubrir con
  el RUT que reporte Claude en visión, o un OCR puntual del encabezado. *(pendiente)*
- **#4 sobre comprobante/cartola con CAPA DE TEXTO**: validado por unit test, aún sin caso real con texto
  (los reales fueron escaneos). Confirmar cuando aparezca uno. *(pendiente)*
- **L5 cosmético**: pedir a Claude que `cita_monto` sea fragmento textual sin razonamiento. *(pendiente)*

---

## Tanda de 30 casos (Constanza Mulchi) — 2026-06-30 · errores de lectura vs TS

> Metodología: Claude (yo) actué como el LLM lector nativo de los 30 casos → 30 fixtures
> (`reneg_fixtures/*.json`) → corrí la capa determinista REAL (`assembleRawFromDocFacts` →
> `applyDeterministicBackstops`) + comparación fila-a-fila `deep_compare.ts` (art + monto + fuente,
> lo que el harness de conteo NO chequea). Agregado: ART 62, MONTO 14, FUENTE(cmf/nocmf) 81, HUÉRFANAS 38.
> ⚠️ Sin verdad-terreno del abogado: el "esperado" lo derivé yo → las discrepancias valen como
> señal de dónde diverge la estructura, no como conteo de aciertos.

### L27 — `doc_facts` debe contener SOLO lo declarable (TS declara TODO producto emitido) ⭐
El ensamblador declara **cada** producto de `doc_facts` (salvo `monto ≤ 0` + dedup). La decisión del
lector de "extraer pero NO declarar" (trivial, pagado, superado por el CMF) **no se expresa** en `doc_facts`
ni la aplica TS → esos productos igual se declaran. **Regla:** si un producto no debe declararse (trivial
< 1 UF, cta cte $0, pagado, superado por un CMF más nuevo), **NO emitirlo como producto**. *(Testigos:
paulina "VARIOS DEUDOR" $60.000/$20.000 + Santander $6.065; rodrigo BancoEstado 4 productos superados por
un CMF más nuevo; matias_garrido Inversiones LP $5.116; viviana Santander $34.610.)* · **validada** (deep_compare).

### L28 — Tarjeta = UN producto = SUMA de sus sub-líneas/cupos DEL MISMO documento (refuerza L21/L23) ⭐
Si un estado de cuenta lista una tarjeta en **varias sub-líneas** (cupos, avances, "Sdo. Total" partido),
el lector debe **sumarlas en UN solo producto**, no emitir una por línea. Si las emite, comparten el Nº de
operación → el dedup determinista las colapsa a 1 quedándose con el monto de UNA (no la suma) → se **pierde
deuda**. *(Testigo: viviana Santander tarjeta op 800060552341 leída como 5 líneas a–e → dedup dejó $11.9M y
perdió $2.9M; correcto = un producto ≈ $14.8M.)* · **validada**.

### L29 — Mismo Nº de operación desde varios documentos → UN producto; NUNCA anclar el monto al overdue del CMF (refuerza L26 + G1) ⭐
Un mismo crédito leído desde varios docs (cert + captura de mora + liquidación) con **etiquetas distintas**
genera varios productos que el dedup EXACTO no une (los strings de `operacion` difieren) → doble/triple
conteo. Peor aún: si el lector toma como "producto" la cifra de **mora 90+d del CMF**, inyecta una fila
fantasma cuyo monto = overdue del CMF (viola G1: el cert manda, el CMF nunca es fuente de monto). **Regla:**
reconocé que es la MISMA operación (por Nº o últimos 4 dígitos) y emití **una sola** desde el doc más
autoritativo; jamás uses el overdue del CMF como monto de un producto. *(Testigo: patricio op 01401 emitida
3× — $8.152.942 / $7.165.935 / $7.124.087, y $7.124.087 = overdue90 del CMF de BdCh → fila fantasma.)* · **validada**.

### L30 — (GAP de TS) No hay filtro de trivial < 1 UF: solo se descarta `monto ≤ 0`
Hoy el ensamblador descarta `monto ≤ 0` (G2) pero **declara** cualquier producto con `0 < monto < 1 UF`
(~$40.661). CLAUDE.md dice excluir "montos triviales (< 1 UF, remanentes/comisiones)", pero esa exclusión
la hace HOY el lector, no TS → si el lector la emite, se declara. **Decisión de estructura (candidata a
fix TS):** descartar `0 < monto < 1 UF` en el ensamblador **con alerta** (nunca en silencio, G2). Pendiente.
*(Testigos: matias_garrido Inversiones LP $5.116; paulina $60.000/$20.000/$6.065; viviana $34.610.)*

### L31 — (TENSIÓN DE DISEÑO, no bug) 260/261 y CMF/NO-CMF en banco multiproducto
El CMF consolida un banco en 1 fila con **un solo** `overdue90Days`. El flujo ancla 1 producto a esa fila
(queda CMF) y **desborda los demás a `additionalCreditors` (NO-CMF)**; el gate degrada 260→261 dejando ~1
producto en 260. Si CADA producto del banco 90+d acredita vencimiento, "deberían" ser todos 260/CMF — pero
**el CMF no expone la mora por-producto**, así que el flujo no puede saber cuáles. Por eso el "esperado"
derivado (que puso todos en 260) diverge sistemáticamente del declarado (FUENTE 81 / ART 62). **No es un
bug claro:** para decidirlo hace falta la mora por-producto del CERT, no del CMF. → **Pregunta para el
abogado:** un banco 90+d multiproducto, ¿va TODO a 260, o solo la porción con mora acreditada por documento?
*(Testigos: fernando BdCh, cristian BdCh, matias_holtheuer Santander, felipe Itaú, etc. — patrón en ~todos.)*

> **Cierre de la tanda de 30 (2026-06-30):** la comparación fila-a-fila confirma la tesis rectora — **TS
> declara fielmente lo que el lector le entrega; la principal fuente de error estructural es la LECTURA**
> (emitir no-declarables L27, no sumar sub-cupos de tarjeta L28, no deduplicar la misma operación multi-doc
> y anclar al overdue del CMF L29). Los únicos ajustes de TS candidatos son defensivos: filtro < 1 UF con
> alerta (L30) y — opcional — un dedup por Nº-de-operación más robusto que tolere etiquetas distintas SIN
> arriesgar G2. La clasificación 260/261 multiproducto (L31) es una definición a cerrar con el abogado, no
> un bug. Arnés nuevo: `tools/paso3_validacion/deep_compare.ts` (comparación art+monto+fuente).

---

## Fixes implementados y validados — 2026-07-01 (tanda de 30, branch paso-3)

### L30 (REVISADA) — NO existe un filtro de trivialidad por MONTO seguro: lo trivial es SEMÁNTICO ⭐ ✅
La idea de "descartar en TS todo producto `0 < monto < 1 UF`" (para atajar remanentes/comisiones) se
**implementó y se REVIRTIÓ**: rompió el golden **G1 (TGR $18.000)** — una deuda fiscal REAL de $18.000
(< 1 UF) quedaba descartada. **Un monto chico NO implica trivial**: TGR, multas, cuotas de CCAF o saldos
fiscales pueden ser < 1 UF y son deuda legítima (viola G2: nunca tirar un acreedor real). **Conclusión:**
la distinción "remanente/comisión trivial" vs "deuda pequeña real" es **semántica, del LECTOR** (por el
rótulo/contexto), NO un umbral que TS pueda aplicar a ciegas. TS sigue descartando SOLO `monto ≤ 0`. El
lector no debe **emitir** remanentes/comisiones como productos (regla agregada al prompt). *(Testigo del
freno: golden G1 TGR $18.000; el fix se revirtió y quedó como regla de lectura.)* · **validada** (golden test).

### L32 — Overflow multiproducto CON `fecha_mora` acreditada → Art. 260 (no forzar a 261) ⭐ ✅ FIX TS
**Bug de TS encontrado y corregido.** El ensamblador ancla 1 producto por fila CMF; el **overflow** (más
productos que filas) iba **siempre a `identified261`** aunque el producto tuviera su propia `fecha_mora`
≥91d → un producto con vencimiento acreditado terminaba en Art. 261 en vez de 260 (sub-declaración del
artículo). **Fix (`sentinel_per_doc.ts`, bloque de overflow):** cada producto sobrante se clasifica por su
PROPIA `fecha_mora` — ≥91d → `cmf260DirectOverride` CON `fecha_vencimiento` (el gate lo mantiene en 260);
sin vencimiento → `identified261` (comportamiento previo intacto). Regla del abogado: 260 si monto Y
vencimiento; el robot declara en 260 TODA deuda acreditable. **Impacto medido:** ART 62→36, FUENTE 81→49
en `deep_compare` sobre los 30 casos, sin regresión (batería 6/6). Golden nuevo en `test_assembler_edge.ts`
("overflow 90+d → 3 overrides Art.260" + control sin fecha). *(Testigos: fernando/cristian/matias BdCh,
felipe Itaú multiproducto.)* · **validada** (golden + batería).

### L33 — CMF vs NO-CMF de un producto multiproducto es routing INTERNO, no material al portal ✅
La `promoteOverflowIdentified261ToAdditional` mueve a **NO-CMF** los productos de un banco del CMF que
exceden sus filas CMF — **por diseño**: en el portal, cada fila CMF se declara sobre su línea y los
productos extra necesitan su propia fila, que se crea vía "Otros Acreedores" (NO-CMF). Por eso, en la
comparación, un producto declarado como NO-CMF-261 en vez de CMF-261 (mismo art + mismo monto) **NO es un
error material**: cae en la misma sección del portal con el mismo monto. La comparación fila-a-fila
(`deep_compare.ts`) ahora separa **MATERIAL** (art 260/261, monto, acreedor de más/menos — cambian la
declaración) de **NO-MATERIAL** (fuente CMF/NO-CMF con igual art+monto). Sobre los 30: 49 discrepancias de
FUENTE son no-materiales (routing por diseño). · **validada** (lectura del código + deep_compare).

### L34 — El "esperado" con juicio holístico del lector diverge de lo que TS declara desde `doc_facts`
Cuando el lector aplica un **juicio que NO queda en `doc_facts`** (consolidar sub-líneas, excluir un
producto "superado por un CMF más nuevo", omitir un componente), TS —que declara fielmente cada producto de
`doc_facts`— no puede reproducir ese juicio → aparece como discrepancia (huérfana/monto). **No es bug de TS
ni siempre error de lectura**: es que el juicio debe estar EN `doc_facts` (el lector emite exactamente lo
declarable) o codificado como regla determinista. Refuerza L27: `doc_facts.productos` = exactamente lo que
se declara. *(Testigos: paulina "VARIOS DEUDOR"; rodrigo BancoEstado superado por CMF nuevo; viviana card-split.)*
· **validada**.

### L35 — Hardening para producción: convertir errores de lectura SILENCIOSOS en ALERTAS (no en silencio) ⭐ ✅
El principio "TS blinda la estructura" no significa que TS *corrija* (arriesga G2), sino que **haga VISIBLE**
lo que el lector pudo equivocar. Dos redes nuevas (additivas, generales, sin tocar montos ni clasificación),
que fluyen a `claudeReadIssues` → `automation_alert` del worker:
- **`posible_subdivision_operacion`**: el dedup del ensamblador conserva 1 producto por (banco+operación) y
  **descartaba en silencio** los demás. Si el descartado tiene monto MATERIALMENTE distinto (>5% y >$100k),
  no es una re-lectura del mismo saldo sino una posible **sub-línea perdida** (tarjeta leída como N líneas con
  la misma op → se perdía deuda, ej. viviana $2.9M). Ahora el ensamblador registra el descarte (`_dedupDrops`)
  y el backstop **alerta** (no suma: sumar arriesga doble conteo de una re-lectura real). Dispara en 3/30
  (betzy, claudia, william).
- **`monto_trivial`**: un producto declarado < 1 UF (~$39.000) se **declara igual** (nunca se descarta —
  L30: un monto chico puede ser TGR/CCAF/multa real) y se **alerta** para que el abogado confirme si es un
  remanente/comisión trivial. Dispara en 3/30 (betzy, john, matias_garrido).
Golden **G5** en `test_backstops_golden.ts` (incluye el control "TGR $18.000 NO se descarta"). Etiquetas de
la alerta en `read_issues_alert.ts`. Batería 6/6, `build:prod` limpio, sin regresión. *(2026-07-01.)* · **validada**.

### L36 — Producto revolvente (línea/cta cte/sobregiro): PONER esa palabra en `etiqueta_monto` ⭐ ✅
Regla del abogado: **línea de crédito / cuenta corriente / sobregiro → SIEMPRE 261** (revolvente, no
acredita vencimiento). TS lo detecta con `isRevolvingLine` sobre **DOS** señales: el `tipoCredito` de la
fila CMF a la que el producto ancló **Y** el `etiqueta_monto` del producto del cert. El anclaje cert↔CMF es
**por monto** (el CMF no trae Nº de operación), y el *payoff* de una línea puede caer más cerca del cupo de
la fila CMF de **tarjeta** que de la de línea → el producto ancla mal y hereda `tipoCredito='Tarjeta'` → se
clasificaría **260 por error**. La red de seguridad es el `etiqueta_monto` del propio cert: si el lector
escribe "LÍNEA DE CRÉDITO / CTA CTE" (o "sobregiro") en la etiqueta, TS lo manda a 261 **aunque el anclaje
por monto haya errado la fila**. → **El lector DEBE nombrar la naturaleza revolvente en `etiqueta_monto`**
(no solo el rótulo del saldo). Testigo: Miguel Lugo, BdCh línea cta cte **$606.175** (payoff $606k más cerca
de la tarjeta CMF $639.943 que de la línea CMF $500.000 → anclaba a tarjeta; sin la palabra "línea" iba a
260; con ella → 261, igual que la abogada). Validado sobre 3 casos reales con verdad-terreno de screenshots
(Cristian 10, Miguel 13, Néctor 12): **conteo exacto Y split 260/261 exacto** vs la abogada
(`test_step3_casos_reales.ts`, batería 8/8). *(2026-07-01.)* · **validada**.

### L37 — Reconciliación cert↔CMF en el LLM REAL (no el oráculo): 4 blindajes de step3 ⭐ ✅
Corridas EN VIVO con el LLM real (Cristian/Miguel/Néctor, comparadas vs screenshots de la abogada)
revelaron que el CMF real trae MÁS filas que las que declara la abogada y que el LLM reparte los
productos de forma ruidosa entre `identified261` y `additionalCreditors`. Cuatro blindajes deterministas
en `fillStep3` (G3: el LLM extrae hechos, TS blinda la estructura), todos additivos y batería-verdes:
1. **Fila 90+d reclamada por su payoff (id261)**: una fila 90+d SIN override cuyo payoff se emitió como
   `identified261` (por no traer venc) es la MISMA deuda. Se incluye en el pool de asignación y, si un
   id261 la reclama, se declara UNA vez como 261 (no se degrada al monto CMF aparte). Sin esto:
   doble conteo (fila 90+d al monto CMF + id261 en una fila al-día). Testigo: Santander consumo de
   Cristian (CMF $6.891.901 / payoff $6.985.718) → 10/10.
2. **Dedup NO-CMF↔id261**: un `additionalCreditor` que DUPLICA un `identified261` ya declarado del
   MISMO banco (misma institución vía `looseKey`, monto ≤10% o casi idéntico) se descarta. El LLM
   emite el mismo producto en 2 listas. Testigo: Itaú $9.511.066 (id261 + NO-CMF) de Miguel.
   ⚠️ **DOS guardas imprescindibles**: (a) exigir misma institución por `institucion_cmf` (no por el
   grupo, que se une también por `bank`) — sin ella, CMR $2.296.733 se descartaba como "dup" de
   Banco Falabella $2.988.488 (**Banco Falabella≠CMR**, regla de oro del catálogo); (b) tolerancia
   ESTRECHA (≤10%) — a 30% descartaba BancoEstado $553.350 como dup de $389.848 (préstamos DISTINTOS).
3. **`looseKey` ignora el sufijo país " chile"** ("BANCO ITAU" vs "Banco Itaú Chile") pero NO
   "de chile" (Banco de Chile) — `canonicalInstitutionKey(s).replace(/(?<!\bde)\s+chile$/, '')`. Sin
   esto el additional "BANCO ITAU" no agrupaba con los id261 "Banco Itaú Chile" → el dedup no veía el
   duplicado.
4. **Multiproducto-261 estrechado**: un banco es multiproducto-261 solo si sus id261 SUPERAN el pool de
   filas CMF reclamables (al-día MÁS 90+d-sin-override), no solo al-día. Con el reclamo de 90+d (fix 1),
   el loop principal ya declara bien esos bancos; el disparo viejo (id261 > al-día) marcaba Itaú de
   Miguel como multiproducto y se COMÍA su línea al-día $500.000. Alfonso (id261 = pool) sigue igual.
Resultado en vivo (cache del Centinela, sin re-llamar al LLM): **Cristian 10/10, Miguel 13/13** exactos
a la abogada, 0 saltados. ⚠️ **Néctor**: la corrida FRESCA del LLM leyó mal (hipoteca BdCh partida en 2
≈$142.5M+$144.7M, faltó el consumo BdCh $37.7M, cross-label Banco Falabella↔CMR con la misma Nº op) →
composición incorrecta pese a contar ~12: es error de LECTURA del LLM en ese run (no de TS; no se
re-corrió el LLM por instrucción). Los blindajes de TS quedan listos para cuando se re-lea. Pendiente
de fondo: dedup de `identified261` por Nº de operación entre instituciones (misma op = misma deuda) para
el cross-label, y evitar que el LLM parta un mismo crédito hipotecario en 2 productos. *(2026-07-01.)*
· **validada (Cristian/Miguel); Néctor limitado por lectura del LLM**.

### L38 — Hipoteca = UN producto · Certificado GLOBAL · misma Nº op = una deuda ⭐ ✅
De la revisión de los documentos REALES de Néctor (leídos directo del PDF), 3 patrones que hacían al LLM
duplicar/omitir deudas — reglas GENERALES para cualquier cliente con esas deudas:
- **Crédito hipotecario/vivienda = UN solo producto.** El cert hipotecario trae varias cifras del MISMO
  crédito: "Saldo del Crédito (UF)", "Valor del Dividendo (UF)", "Costo Total del Prepago (UF)". Son la
  misma casa. Declarar UNA vez, al **payoff** (Costo Total del Prepago; si no, el Saldo). Testigo: Néctor,
  el LLM emitió Saldo 3.538,959 UF (≈$142,5M) **y** Prepago 3.559,669 UF (≈$144,7M) como 2 productos →
  hipoteca contada doble. El Dividendo es la cuota mensual, no la deuda.
- **"Certificado de Deuda GLOBAL"** (solo totales: "Total deudas en PESO $X", "…en UF Y"): es el total del
  banco, NO un producto. El total **en UF** = el hipotecario; el total **en pesos** = suma de los productos
  en pesos (consumo+tarjetas+líneas) → sirve para acreditar el monto de un producto del CMF **sin cert
  propio**, NO se declara como deuda extra. Testigo: Néctor, "Total deudas en peso $37.700.317" de Banco de
  Chile = el consumo de ~$36M del CMF (`Banco de Chile Consumo $35.977.919`); el LLM no lo reconoció y el
  robot sub-declaró ~$36M (le pegó por error el cert de la línea de $503.808 a la fila del consumo).
- **Misma Nº de operación = una sola deuda**, aunque venga en 2 documentos o con 2 nombres de institución.
  Testigo: Néctor, op `29821865337` apareció como "Banco Falabella $2.988.488" **y** "CMR Falabella
  $2.988.488" (la MISMA deuda; el archivo del cert de CMR era una **copia** del de Banco Falabella —
  md5 idéntico → problema de CARGA, no de lectura). El CMR real es otra deuda ($2.296.733, del WhatsApp).
Blindaje TS determinista (no depende del LLM): (a) **dedup de productos por Nº de operación normalizada**
cross-institución; (b) **dedup de id261 casi-idénticos del mismo banco** (ambos grandes, ≤3% → misma
deuda, se queda el payoff) para la hipoteca saldo/prepago. Pendiente aguas arriba: detectar **archivos
duplicados** (hash de contenido) y reconciliar nombre↔RUT en la carga. *(2026-07-01.)* · **validada**.

**Resolución del consumo sin cert propio (2026-07-01, corrida fresca):** el mecanismo YA existía
(`banksWithGlobalSummary` en `sentinel_per_doc.ts`: un banco con `doc_type:'resumen_global'` acredita sus
productos del CMF sin cert propio, AL MONTO DEL CMF por-producto → sin doble conteo). Estaba **bloqueado**
por dos bugs, ahora corregidos: (1) `pickProductForRow` forzaba un match aunque el monto fuera absurdo
(ratio >5×) → el cert de la línea ($503.808) se anclaba al consumo ($35.977.919, 70×), tapando el camino
al resumen global; fix: el fallback rechaza mismatches >5× y devuelve null. (2) La lección decía
`doc_type="certificado_global"` (typo) en vez del `resumen_global` real del schema → el LLM no tageaba;
fix aplicado. Además, un producto <1 UF que SOLO viene del resumen global (sin cert propio) NO se declara
(remanente trivial, ej. la línea del CMF en $13). **Resultado verificado en vivo:** el consumo BdCh de
Néctor **$35.977.919 se declara** ("monto del CMF, banco con certificado resumen global"); batería 9/9,
Cristian 10 / Miguel 13 intactos. Queda como problema de DATO (no de lectura ni de TS) la triplicación
CMR/Banco Falabella por el archivo de CMR duplicado (= copia del cert de Banco Falabella).

---

## Caso Yasmín Silva Switt (18.424.396-2) — 2ª VERDAD-TERRENO REAL de la abogada (2026-07-02)

> 9 acreedores declarados por la abogada (3×260 + 6×261). Análisis hardcodeado (sin API) →
> `test_yasmin.ts`: el robot declara **9 = abogada** (captura TODAS las deudas). Única divergencia:
> La Polar (juicio 260 vs 261, defendible). Lecciones GENERALES de la relectura de los PDFs reales:

### L39 — Cert de CCAF (Crédito Social) se identifica por LOGO, no por texto; anclar por Fecha Otorgamiento ⭐ ✅
El cert "Información de Crédito" de Caja Los Andes **no trae "Caja Los Andes"/CCAF en la capa de texto**
(está solo en el LOGO/imagen del encabezado). El ÚNICO RUT del texto es "**RUT Empresa**" = el RUT del
**EMPLEADOR/agente retenedor** (ej. `65.166.786-0`), **NO** el de la CCAF (`81.826.800-9`). → El resolver
por-RUT-de-texto (`cert_institution_resolver`) **no puede** identificarlo; depende de la lectura NATIVA de
Claude (lee el logo) o del match determinista por **Fecha de Otorgamiento + monto** contra la fila del CMF.
Regla general para certs sin nombre en el texto: anclar por `(fecha_otorgamiento, monto)` a la fila CMF.
Testigo: Yasmín, 2 créditos CCAF cuyas Fechas de Otorgamiento (02/05/2024 y 09/10/2024) coinciden EXACTO
con las filas CMF; ambos con `Cuotas Morosas 0`/Estado Vigente → correctamente 261. *(validada)*

### L40 — 90+d en el CMF SIN vencimiento acreditable → 261 (1ª confirmación con verdad-terreno) ⭐ ✅
Primera vez que la declaración REAL de la abogada confirma la regla decisiva **90+d ≠ 260**. Yasmín:
**Líder BCI** (Serv. Financieros y Adm. Créditos Comerciales, $789.001, cert "deuda total" SIN fecha) y
**Banco Falabella** ($114.492, "Cartera Vencida / Castigada" SIN fecha) están **90+d en el CMF** pero la
abogada los declaró en **261** — exactamente como el ensamblador (`push261` cuando la fila 90+d no trae
venc explícito). Confirma que el flag 90+d del CMF NO basta: sin vencimiento acreditable → 261. *(validada)*

### L41 — "Deuda castigada" NO-CMF: 260 SOLO si el cert trae días de mora/fecha ⭐ ✅
Dos NO-CMF castigadas, mismo tipo de deuda, distinto desenlace por la FECHA:
- **Hites** (Inversiones y Tarjetas S.A.): cert con "**Días Mora: 176**" → venc computable (30/06/2026 −
  176d ≈ 05/01/2026) → **260**. *(el ensamblador da additional 260 por `fecha_mora`≥91d.)*
- **La Polar** (Inversiones LP S.A.): "MONTO TOTAL DEUDA CASTIGADA $2.364.308" **sin días de mora ni
  fecha** → **261** (no se puede acreditar venc; poner una fecha inventada viola la regla anti-fabricación).
  La abogada la puso en 260 con un venc externo (01/12/2025) que el cert NO trae → **divergencia de juicio
  defendible; la deuda se declara igual**. Regla: castigada ⇏ 260 automático; requiere fecha en el cert.

### L42 — Tarjeta partida en 2 filas CMF por moneda (Nota 3 nacional/extranjera) = UN producto ⭐
El CMF puede partir UNA tarjeta en 2 filas (moneda nacional + extranjera; misma fecha de otorgamiento —
Nota 3). El cert (Costo Monetario Prepago) cubre la tarjeta completa → se declara **UNA fila**. La 2ª fila
CMF sin cert propio la descarta el **Gate I2** (`falta_documento`) — no es deuda perdida (misma tarjeta).
Testigo: Yasmín, Santander tarjeta CMF $166.143 + $21.759 (otorg. 10/07/2023), cert prepago $202.061 → 1
fila; la abogada también declaró 1. ⚠️ Genera una alerta de ruido → **mejora futura**: consolidar filas
CMF tarjeta/línea de misma `fecha_otorgamiento` antes del Gate (evita el `falta_documento` cosmético).

### L43 — Trampas de lectura: nombre de comercio ≠ acreedor; 2 RUTs en un cert ⭐ ✅
- **Un nombre de comercio en una línea de transacción de un estado de cuenta NO es un acreedor.** En la
  cartola Santander Visa apareció "HIP **LIDER** INDEPENDENCIA" (una COMPRA en el supermercado Líder) —
  NO es una tarjeta Líder. No inferir un emisor/acreedor separado de las descripciones de movimientos; el
  emisor es la marca de la tarjeta ("TARJETA SANTANDER", card XXXX-8653 VISA PLATINUM). *(error propio
  detectado al releer: había supuesto un "merge Líder+Santander" que no existía.)*
- **Un cert puede traer 2 RUTs**: el del EMISOR/acreedor y el del DESTINO de pago. Hites → acreedor
  "Inversiones y Tarjetas S.A." RUT `85.325.100-3`; "Nominativo a nombre de HITES S.A. RUT `81.675.600-6`"
  es solo el beneficiario del pago. Al resolver por RUT, usar el del **emisor/acreedor**, no el de pago.
- **Monto del cert manda aunque difiera fuerte del CMF (reneg).** Santander consumo: CMF $1.318.621 vs
  cert $2.268.481 (RENEG CONS) → manda el cert (más actual). La abogada declaró $2.268.481. (Refuerza G1.)

### L44 — Resolución de catálogo: el `rut_emisor` del LLM GANA sobre nombre/PDF ⭐ ✅ FIX TS (Tier 2)
Confiar más en el LLM (extiende G3). El LLM ya lee el RUT del emisor por documento (`evidence.rut_emisor`,
incluso en certs IMAGEN leídos nativo). `fillStep3` NO lo usaba: re-extraía el RUT del PDF con `pdftotext`
(falla en imagen) y matcheaba por NOMBRE (que suele no estar en `acreedores_canonicos`) → saltaba el
acreedor. **Fix:** en la resolución institución→catálogo, primero `findCatalogEntryByRut([evidence.rut_emisor])`;
si matchea, gana sobre nombre/PDF/filename. Aplica al loop de filas CMF (vía `getReclassifiedMatch`/
`getIdentified261Match`, que llevan `evidence`) y al path NO-CMF (`ac.evidence.rut_emisor`). Solo agrega una
vía previa: si el RUT no matchea, cae al flujo anterior intacto (no cambia 260/261 ni montos). **Testigo:
Yasmín — "Servicios Financieros y Adm. de Créditos Comerciales" (nombre no está en el catálogo) resolvió por
RUT `77085380-K` → "Tarjeta Lider" y pasó de SALTADO a DECLARADO ($789.001); Hites por RUT `85325100-3`.**
Verificado en vivo (7/9 declarados, antes 6/9); batería 9/9; type-check limpio. (2026-07-02.)
> Pendiente (NO en este tier): CCAF ×2 aún se salta (Tier 1 `isChatDocument` + Tier 3 desambiguación) y La
> Polar sale como "ABC S.A."/"Empresas La Polar" (Tier 3: falta la fila "Inversiones LP S.A." en el catálogo).
> Observación: algunas filas 261 (Tricot/Falabella/Líder) quedan sin doc adjunto ("Acredita: No") pese a que
> el log dice adjuntado — bug de la fase de adjunción, fuera del Tier 2.

### L45 — Batch "confiar más en el LLM" + fix de adjunción → Yasmín 9/9 en vivo ⭐ ✅ (2026-07-02)
Lote de cambios GENERALES para achicar la superficie de fallos de TS (el LLM extrae hechos; TS deja de
re-derivarlos con regex/nombre). Validado con la corrida REAL de Yasmín: **6/9 → 9/9, todas con documento
adjunto** (montos y entidades correctas). Cambios:
- **doc_type del LLM manda** (`isChatDocument`/`classifyNonAccreditingDoc` reciben `doc_type`; regex solo
  fallback y endurecido: un date+time solo no basta, se exige ≥3 timestamps o marcador conversacional). Un
  **timestamp de generación en el pie** de un cert (ej. CCAF "01-07-2026 13:46:42") ya NO lo marca como chat.
- **`product_type` emitido por el LLM** (`tarjeta_credito|credito_consumo|linea_credito|hipotecario|otro`):
  `isRevolvingLine`/`productTypeOf` lo prefieren sobre el regex de la etiqueta (blinda el gate 260/261).
- **Resolución de catálogo por lo que lee el LLM del cert**: 1º `rut_emisor` (L44), 2º `emisor_nombre` (logo/
  encabezado) — gana sobre el nombre del CMF (que llega mangleado/truncado). Testigos: Líder BCI
  `77085380-K`→"Tarjeta Lider"; La Polar `76265724-4`→"Inversiones LP S.A." (fila nueva en el catálogo).
- **Normalización CCAF determinista en `matchAcreedor`** (red si el LLM no da nombre): mapear el prefijo
  largo del CMF "Caja de Compensación de Asignación Familiar <X>" (aunque venga TRUNCADO mid-word por el
  ancho de columna, "…Famili Los Andes") → "ccaf <X>" → calza exacto con "CCAF <X>" del catálogo. General a
  cualquier caja (Los Andes/Los Héroes/La Araucana). Evita tocar el parser del CMF (compartido, frágil).
- **Fix de adjunción (isOtros)**: `addedDocs` ahora guarda el `isOtros` FINAL con que se DECLARÓ la fila
  (post-degradación 90+d→261); la fase de adjunción lo usa en vez de recomputarlo desde `overdue90Days`
  (que mandaba un producto degradado a 261 a buscar su fila en la tabla 260 → el cert no quedaba). Testigos:
  Tricot/Falabella/Líder, que pasaron de "Acredita: No" a "Acredita: Sí". (Invariante del CLAUDE.md.)
- Divergencia de JUICIO restante (no error): Tricot y La Polar quedan en 261 (la abogada 260) porque sus
  certs no acreditan fecha de vencimiento. Se declaran igual con su monto.
- Cosmético pendiente: las 2 filas CMF de CCAF (al día) generan una alerta "sin cargar" aunque la CCAF ya
  quedó declarada vía los certs (NO-CMF) — no hay pérdida ni doble conteo; limpiar la alerta a futuro.
Verificado: `tsc` limpio, batería 10/10 (+ unit test `test_ischat_doctype.ts`), corrida real 9/9 con docs.

### L46 — Cómo leer un ESTADO DE CUENTA de tarjeta para acreditar MONTO y VENCIMIENTO ⭐ ✅
Un **estado de cuenta / cartola de tarjeta de crédito** (tienda o banco: Tricot, Ripley, CMR, Líder, Visa…)
acredita **monto Y vencimiento** — pero hay que saber leerlo. Regla GENERAL:

- **MONTO** = **"Costo Monetario Prepago"** (el payoff para saldar TODA la tarjeta) del estado de cuenta **MÁS
  RECIENTE**. NO uses "Monto Mínimo a Pagar" ni "Monto Total Facturado a Pagar" (son la cuota del mes), ni la
  suma de cupos. Si un doc trae varios meses, el prepago del mes más nuevo es el saldo actual.
- **¿ESTÁ EN MORA?** Señales (cualquiera): **"Cargo Moratorio" / "Costo por Atraso" > $0**, **"Monto Pagado
  Período Anterior: $0"**, o la columna "VENCIMIENTO PRÓXIMOS MESES → ACTUAL" con casi todo el saldo. Si las
  hay, la tarjeta está MOROSA (no al día).
- **VENCIMIENTO (`fecha_mora`)** = el **"Pagar Hasta" del estado de cuenta MÁS ANTIGUO que ya está en mora**
  (el primero, cronológicamente, con "Cargo Moratorio">0 / "Monto Pagado $0"). Un mismo PDF suele ser un
  **merge de varios estados de cuenta mensuales** → ordenalos por su fecha y tomá el "Pagar Hasta" del primero
  en mora. Esa fecha **está impresa** ("Pagar Hasta DD/MM/AAAA") → es un vencimiento ACREDITADO, no inventado.
- ⚠️ **Leé TODAS las páginas del PDF (nativo).** El dato del vencimiento suele estar en el **mes más antiguo**,
  que puede venir como **página imagen/escaneo** (sin capa de texto). El monto está en el mes más nuevo; el
  vencimiento en el más viejo. Si solo miras la primera página perdés el vencimiento.

**Ejemplo REAL (Tricot Visa de Yasmín — el doc es un merge de 5 estados de cuenta mensuales):**
| Estado de cuenta | "Pagar Hasta" | Cargo Moratorio | Costo Monetario Prepago |
|---|---|---|---|
| 21/01–20/02/2026 (más antiguo) | **05/03/2026** | **$967** (1ª mora) | $284.733 |
| 21/02–20/03/2026 | 05/04/2026 | $2.146 | $304.949 |
| 21/03–20/04/2026 | 05/05/2026 | $9.275 | $315.994 |
| 21/04–20/05/2026 | 05/06/2026 | $17.569 | $342.297 |
| 21/05–20/06/2026 (más reciente) | 05/07/2026 | $26.718 | **$355.163** |

Lectura correcta: **monto = $355.163** (Costo Monetario Prepago del mes más reciente); **fecha_mora =
2026-03-05** (el "Pagar Hasta" del estado más antiguo en mora, donde aparece el primer "Cargo Moratorio").

### L47 — Documento de COBRANZA: "último pago" / "N días de mora" SÍ acreditan el vencimiento ⭐ ✅
Un **aviso/mensaje/correo de cobranza** (o un cert que comunica una mora) acredita el **vencimiento** aunque
no diga "vencido desde DD/MM". Cómo reconocerlo y leerlo:
- **¿Es cobranza?** Por CONTENIDO (no por filename): el texto trae señales de mora explícitas —
  **"N días de mora"**, **"deuda castigada"**, **"cartera vencida"**, **"cobranza (judicial/prejudicial)"**,
  o un **"último pago: DD/MM/AAAA"** junto a esas señales.
- **Vencimiento (`fecha_mora`)**: en ESE contexto de cobranza, usá la **fecha del "último pago"** como el
  inicio de la mora (la deuda quedó impaga desde ese pago). Si en vez de fecha hay **"N días de mora"**,
  calculá `fecha_mora = fecha del documento − N días`. Es una fecha/dato **impreso** → NO es fabricar.
- ⚠️ **Acotado**: esto aplica SOLO cuando el doc trae esas señales de mora. Un estado de cuenta o cert normal
  que solo diga "Fecha último Pago" (sin días de mora / castigada / cobranza) **NO** cuenta como venc (la
  regla general se mantiene: "último pago" ≠ vencimiento).
- El **monto** de la cobranza es **referencial**: el monto formal lo acredita el certificado del acreedor.
  (En el TS, un doc de cobranza NO crea una fila nueva; su vencimiento se adjunta a la MISMA deuda —mismo
  monto— que ya trae el cert formal. Igual que "chat solo acredita vencimiento", extendido a NO-CMF.)

**Ejemplo REAL (Gmail de cobranza de La Polar / ABC — Yasmín):**
> *"…presenta la siguiente **deuda castigada**… la deuda castigada al día de hoy es de **$2.364.308** y tiene
> a la fecha **202 días de mora**, su **último pago** se realizó el día **01/12/2025**…"* (de servicio al
> cliente de ABC, sobre "su caso N°…").

Lectura correcta: es cobranza (dice "deuda castigada" + "202 días de mora" + "último pago"). → producto con
**monto = 2.364.308** (referencial), **fecha_mora = 2025-12-01** (último pago), cita_fecha = "su último pago
se realizó el día 01/12/2025". El cert formal de Inversiones LP aporta el monto; este Gmail aporta el venc →
la deuda queda en **Art. 260** (una sola fila). *(Testigo: la abogada declaró La Polar en 260 con venc
01/12/2025, leído justo de este correo.)*
→ productos:[{monto:355163, etiqueta_monto:"Costo Monetario Prepago", moneda:"CLP", **product_type:"tarjeta_credito"**,
**fecha_mora:"2026-03-05"**, cita_monto:"Costo Monetario Prepago $ 355.163", cita_fecha:"Pagar Hasta 05/03/2026",
confidence:0.9}]. Con eso el producto tiene monto+venc → **Art. 260** (y coincide con la mora 90+d del CMF:
del 05/03/2026 a la fecha son >90 días). *(Testigo: en la corrida del 2026-07-02 Claude leyó el PDF NATIVO y
sacó el monto bien, pero dejó `fecha_mora` vacío por no conocer esta regla → el producto cayó a 261. La
abogada lo declaró en 260 con venc 05/03/2026, leído justo de esa página.)*


---

## Lecciones de LECTURA del lote `casos_constanza_mulchi` (30 casos, 2026-07-01)

> Lectura nativa actuando como el Centinela sobre los PDF de Paso 3 de 30 clientes reales (1 CMF + 10–50
> certs c/u). Arnés determinista (`assembleRawFromDocFacts → applyDeterministicBackstops`): 11/30 exacto.
> ⚠️ Sin verdad-terreno del abogado → el resto de las divergencias son **lectura** (estas reglas) o
> **juicio** (declarar-todo-el-cert vs solo-mora). Estas reglas están ancladas al TEXTO del PDF (válidas
> sin verdad-terreno). Numeración local `LC-n` para no colisionar con la rama paso-3.
> **El Paso 3 de este lote lo ejecuta otra sesión (worktree `paso-3`); estas lecciones son mi aporte de lectura.**

### LC-1 — Certs BCI / de liquidación-portabilidad RASTERIZAN EN BLANCO pero tienen capa de texto (CRÍTICO)
El hallazgo más recurrente y de mayor impacto en producción. Muchos "Certificado de Liquidación/prepago"
(sobre todo **BCI**, también algunos Santander/BancoEstado) se renderizan como **páginas en blanco** al
leerlos como imagen nativa (solo el logo + tablas con celdas vacías, 15-17 págs), pero **SÍ tienen capa de
texto extraíble** con `pdftotext -layout`. El lector nativo que solo "mira" el PDF **pierde el payoff**.
Regla: ante un PDF que renderiza vacío, **intentar SIEMPRE la capa de texto antes de darlo por ilegible**.
El sufijo `_unlocked` es señal de esto. *(Testigos: BCI-40567938/40895812/41423808-certificado-prepago
(Geraldine/Alejandro/Juan Pablo G.), Certificado de Deuda BCI (Alejandro/Gabriel), BCI Consumo/Hipotecario
de Camilo, cotizaciones con "cajitas XXXX".)* · **validada** (recurrente en ~8 casos).

### LC-2 — Payoff = "Costo Monetario Prepago" / "Saldo Insoluto", NUNCA "Saldo del Crédito" ni la cuota del mes
Trampa clásica y ubicua. En certs de consumo BdCh coexisten **"Saldo del Crédito"** (mayor, ~15% arriba) y
**"Costo Total de Prepago"** (el payoff real) → usar el prepago. En tarjetas, el payoff es **"Costo
Monetario Prepago"**, NO "Monto Total Facturado a Pagar"/"Monto Mínimo" (cuota del mes). En Santander
Consumer/automotriz a veces solo hay **"Monto Cursado"** (monto original, NO saldo) → confidence baja +
usar CMF. *(Testigos: BdCh consumo de Fernando/Juan Pablo R./Eileen; CMR de casi todos; Santander Consumer
de William.)* · **validada**.

### LC-3 — Capturas de portal "Pagar mi Crédito"/"MORA" = solo FECHA de mora, NO payoff
Un pantallazo del portal que muestra "Monto Total Cuota"/"Total a Pagar" de la **cuota vencida** aporta la
**fecha de mora**, no el saldo total. Casarlo por Nº de operación con el cert de monto; NO emitirlo como
producto (doble conteo) ni tomar esa cifra como payoff (sub-declara). ⚠️ Distinto de una captura de "Mis
Productos"/"Saldo utilizado" que SÍ acredita saldo (LC-3 aplica solo a la vista de pago de cuota).
*(Testigos: BdCh `#### MORA` de Guillermo/Matías Garrido/Fernando; Itaú `MORA_.png` de William/Patricio.)* · **validada**.

### LC-4 — Un producto = una operación, aunque aparezca en cert + estado de cuenta con montos distintos
Fuente principal del sobre-conteo. El mismo crédito/tarjeta suele venir en un **certificado de deuda** Y en
un **estado de cuenta/cartola** con cifras algo distintas (fechas de corte distintas). Emitir **UN** producto
(el del cert/constancia formal, payoff autoritativo) y anotar la discrepancia; **NO** emitir ambos.
*(Testigos: Matías Holtheuer — cert Santander $25.926.800 vs Cartotal $26.187.259 misma Op 650046641668,
emitió ambos → TS declaró 11 en vez de 6; Cinthia CAT; Guillermo SOCOFIN vs tarjetas.)* Mejora de TS
asociada: `normalizeOperationId` ahora extrae el Nº tras "Op."/"N°" para deduplicar el mismo número descrito
distinto (**LC-9**). · **validada** (recurrente).

### LC-5 — El CMF consolida multiproducto en 1 fila por banco; los certs lo desglosan → declarar por producto
Ubicuo (BdCh, Santander, Itaú, Banco Estado). El CMF muestra "Banco X Consumo $N" pero los certs revelan 3-5
productos (consumo + tarjeta + línea). Se declara **una fila por producto** con su payoff; la suma reconcilia
(±tolerancia) con la fila CMF. *(Testigos: Irene BdCh 5 productos, Carlos Itaú 3, Eileen Santander 9.)* · **validada**.

### LC-6 — Documentos de OTRA persona traspapelados en la carpeta → identificar por RUT y descartar
Hazard de producción real y recurrente. Aparecen CMF/constancias/cotizaciones de un tercero mezcladas en la
carpeta del cliente. **Verificar el RUT** de cada documento contra el del cliente antes de usarlo.
*(Testigos: Cristian — `SII/CMF 02-09.pdf` era de CORTÉS CÁCERES 13.253.905-7; Jaime — cotizaciones AFP de
NICOLÁS BASCUÑÁN + hoja hipotecaria de Caroline Tapia; Geraldine/Carlos — `CONSTANCIAS1.pdf` de Itaú mezcla
2 clientes; Alejandro — cert ZOFRI con nombre "Freddy Flores" pero RUT correcto.)* · **validada**.

### LC-7 — Cartera vencida/castigada SIN fecha de mora acreditable → Art. 261 (no 260)
El 260 exige monto **Y** vencimiento acreditables. Muchos certs marcan "cartera vencida"/"castigada"/"Mora 1"
pero NO imprimen la fecha de inicio de mora → clasificar **261** (solo monto) + alerta. Los "Reporte de Deuda"
(Scotiabank) dicen explícitamente "no tiene carácter de certificado de prepago" → 261. *(Testigos: Itaú de
Javiera/Eileen; Scotiabank de Ingrid/Juan Pablo R.; CMR "Vigente" de Cinthia.)* · **validada**.

### LC-8 — UF con columna en pesos → usar la columna $ (no reconvertir); formato chileno "." miles / "," decimal
Los hipotecarios vienen en UF pero el reporte trae **"Saldo Actual $"/"Total a pagar $"** ya convertido →
usar ESE valor en CLP. Solo si está expresado en UF sin columna en pesos, reportar `moneda:"UF"`. "2.243,9113
UF" = 2243.91 UF (no 22.439.113). *(Testigos: Scotiabank de William/Natalia/Rodrigo; Santander/BancoEstado
hipotecarios de Camilo/Felipe.)* · **validada**.

### LC-9 (TS) — `normalizeOperationId` extrae el Nº tras "Op."/"N°" para dedup entre documentos
Mejora de robustez aplicada en `src/utils/cert_line_items.ts` (worktree paso-3, **pasa la batería golden
6/6**): cuando el LLM emite el mismo Nº de operación descrito distinto ("Prestamos de consumo **Op.**
650046641668" vs "Credito de Consumo **Op.** 650046641668"), la clave canónica es el número tras el marcador
"Op."/"N°" → los duplica-por-descripción colapsan. NO toca códigos alfanuméricos (CRE-000..., D06...) ni
tarjetas enmascaradas (*5197). No es dedup por monto (prohibido: 2 créditos distintos pueden tener igual
monto). ⚠️ Reconciliar con la sesión que trabaja el worktree paso-3. · **aplicada + golden 6/6**.

### Hallazgos varios (para el LLM lector)
- **Banco Falabella (LC cuenta corriente) ≠ CMR Falabella (tarjeta)**: 2 acreedores CMF distintos. **MATIC
  KARD** = tarjeta sbpay VISA (Scotiabank), a veces mora 60-89d → 261 (no 260 por venir en carpeta "Acreedores").
- **FORUM: overflow int32** — la tabla "Saldo Capital" muestra `2.147.483.647` (=2³¹−1, dato corrupto) →
  no usar; pedir cert de saldo limpio. *(Viviana.)*
- **rut_emisor casi nunca impreso** en los certs (L3 confirmada en los 30) → NO inventarlo del catálogo
  (algunos lectores lo hicieron = riesgo de cross-check falso). Mejor `null` + fallback por filename/keyword.
- **Préstamo del empleador** (descuento de nómina, DJ de autorización) NO es acreedor del Paso 3 → es
  descuento voluntario del Paso 5. *(Cristian Bonatti, Fernando, Camilo, Alejandro ZOFRI.)*

### Juicio abierto (sin verdad-terreno del abogado)
- **Declarar TODOS los productos acreditados por el cert (261 al día incluidos) vs solo los en mora**: el
  robot es más completo (declara todo lo acreditable, regla `260_declarar_todos_acreditables`); varios
  "esperados" del lector fueron conservadores. Sin la declaración real del abogado no se puede fijar el
  conteo "correcto" — es criterio. Las divergencias `declarado > esperado` del arnés son mayormente esto.
