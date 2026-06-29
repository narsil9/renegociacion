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

## Pendientes / candidatas (a validar en próximas pruebas del Paso 3)

- *(vacío — agregar acá lo que surja, marcado `pendiente`, hasta validarlo contra la verdad-terreno.)*
