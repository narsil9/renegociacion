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
