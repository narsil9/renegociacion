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

### L3 — `rut_emisor` casi nunca se puebla → la verificación de identidad queda dormida ⚠️ ABIERTO
El cross-check de RUT (RUT del cert → catálogo → ¿es la institución asignada?) es la red anti-error
**más fuerte**, pero **solo corre si Claude reporta `rut_emisor`**. Observado: lo pobló **1 vez en ~20**
(BCI `97006000-6`, donde funcionó perfecto, sin falso positivo) — y **enfatizarlo en el prompt NO lo
movió** (post-fix sigue 1/13 en Miguel). Hipótesis: muchos certs no imprimen el RUT del emisor de forma
prominente, o Claude lo deprioriza. **Pendiente de fondo:** un fallback determinista que extraiga el RUT
del **texto** del cert cuando exista (los nativos/imagen no tienen texto → ahí queda sin red). Por ahora
Capa 2 es **oportunista**: protege cuando Claude da el RUT, no siempre. *(Testigo: 3 casos.)* · **pendiente**.

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

## Pendientes / candidatas (a validar en próximas pruebas del Paso 3)

- *(vacío — agregar acá lo que surja, marcado `pendiente`, hasta validarlo contra la verdad-terreno.)*
