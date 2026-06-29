# Mejoras a importar desde el flujo del supervisor

> **Origen:** análisis del repo `rp_renegociaciones-auth-admin` (dashboard del supervisor, prod `ton…`),
> que es la capa **aguas arriba** de la nuestra (recopila + clasifica documentos antes de que
> nuestro worker declare en el portal Superir).
> **Objetivo:** traer SOLO lo que aporta valor real a **nuestro** flujo (análisis de documentos +
> clasificación). Cada ítem dice qué hace su flujo, por qué nos sirve, dónde se conecta en nuestro
> código y cómo respeta la regla rectora **"el LLM extrae hechos; TypeScript blinda la estructura"**.
> **Lo descartado** (y por qué) está al final, para no reabrir la discusión.

---

## Contexto: cómo analiza documentos su IA vs la nuestra

| | **Su IA** (dashboard) | **Nuestra IA** (worker) |
|---|---|---|
| Patrón | Clasificador one-shot, stateless, 1 llamada Claude por PDF | Cadena multi-agente (tributario→centinela→mapeador) + backstops TS |
| Lectura del doc | Claude lee el **PDF nativo** (sin OCR), prompt grande | **OCR local (Tesseract)** + `pdftotext -layout` → texto a LLM y a reglas TS |
| Quién decide la estructura | **El LLM** (clasifica, matchea, asigna confianza) | **TypeScript** (260/261, multiproducto, override, split) |
| Lenguaje | TypeScript (`@anthropic-ai/sdk`) | TypeScript |
| Propósito | Recolectar + clasificar → checklist | Declarar en el portal |

Las mejoras de abajo importan **capacidades puntuales** de su lado (sobre todo la lectura nativa de
PDF y la metadata estructurada por certificado) **sin** mover la decisión estructural fuera de TS.

---

## ALTO VALOR — Análisis de documentos

### 1. ⭐ Lectura nativa del PDF por Claude como **rescate de extracción de monto/vencimiento**

**Qué hace su flujo.**
En `lib/skills/match-documents.ts` mandan el PDF en bruto a Claude (`callClaudeWithPdf`,
content block `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } }`).
**Claude lee el PDF nativamente** (incluye tablas, escaneos, layout) sin OCR ni `pdftotext`
del lado de ellos, guiado por un system prompt con orden de inspección (título → institución →
cliente → nº operación → monto).

**Por qué nos aporta.**
Nuestro punto débil documentado es exactamente la **extracción de monto en certificados messy**
(casos testigo: BCI cuenta corriente **$615**, línea BancoEstado **$389.848**). Hoy dependemos de
`extractCertLineItems` (regex sobre texto `-layout`) + OCR Tesseract para imágenes. Tesseract+regex
falla en:
- tablas de liquidación multicolumna,
- escaneos torcidos / fotos de baja calidad,
- PDFs donde el monto vive en una celda que el OCR desordena.

La lectura nativa de Claude es **otro sensor**, fuerte justo donde el nuestro es débil.

**Cómo encaja sin romper la regla rectora.**
NO reemplaza nuestra lógica determinista. Es un **fallback acotado**: solo se invoca cuando
`extractCertLineItems` + OCR **no** devuelven un payoff limpio (o el cert es imagen ilegible).
El LLM extrae un **hecho puntual** (monto / fecha de vencimiento / nº de operación); TypeScript
sigue dueño de la estructura (260 vs 261, split multiproducto, override de monto, adjunción 22/23).
Es el mismo principio que ya aplicamos: *el LLM extrae, TS decide*.

**Dónde se conecta.**
- Nueva función `extractCertFactsFromPdf(pdfPath, logger): Promise<{ monto_clp?, fecha_venc?, numero_operacion?, moneda? }>`
  en `src/utils/cert_line_items.ts` (o `ocr_helper.ts`), usando un helper estilo `callClaudeWithPdf`.
- Se llama **solo en el camino de fallo** del backstop de completitud del Centinela
  (`sentinel.ts`), después de que el detector determinista no encontró el ítem.
- El valor que devuelve entra al mismo pipeline (`CmfDocumentOverride` / `AdditionalCreditor`),
  con `needs_lawyer_confirmation: true` para que el monto "rescatado por IA" quede marcado.

**Riesgo / mitigación.**
- Costo/latencia por llamada extra → acotado al fallback (no corre en el caso feliz).
- No-determinismo → el hecho extraído pasa por las mismas validaciones de monto/tolerancia que ya
  tenemos; nunca se declara sin que TS lo acepte.

---

### 2. **Número de operación** — desambiguador de productos del lado del CERTIFICADO (NO llave cert↔CMF)

> ⚠️ **ACLARACIÓN (verificada en nuestras pruebas, 2026-06-28).** El número de operación **está
> impreso en los CERTIFICADOS de los bancos, NO en el Informe CMF.** En los CMF que probamos
> (formato Ley 21.680) el informe solo trae **institución, tipo de crédito, fecha de otorgamiento y
> montos** — **sin** número de operación/contrato. Por eso el nº de operación **NO sirve como llave
> para atar un certificado a una fila del CMF**: un lado (el CMF) no lo tiene. La versión original de
> esta mejora ("llave dura cert↔fila CMF") estaba equivocada en ese encuadre.

**Qué hace su flujo.**
El system prompt de `match-documents` extrae `numero_operacion` por documento (campo de
`extracted_metadata`) y lo usa para "identificar el producto específico (tarjeta, cuenta corriente,
crédito)". También distingue tarjeta vs cuenta corriente del **mismo banco** por ese número.

**Dónde SÍ nos aporta (lado del certificado, no contra el CMF).**
Para **no confundir productos del MISMO banco** — que es el valor real:
- **Multiproducto** (ej. Santander con 3 créditos de consumo): hoy emparejamos 1:1 por **monto**,
  que es frágil y nos dio errores reales (Néctor: CAT $816 cuando debía $105.185; BdCh línea).
  El nº de operación es una **llave por-producto en el cert** → separa los N créditos sin depender
  de que el monto calce.
- **Dedup** de los 4 EECC mensuales de una misma tarjeta (comparten nº de operación/tarjeta) → no
  contarlos como 4 productos.
- **Agrupar** los certs de un banco por producto.

**Dónde NO aporta.**
- No ata cert↔fila CMF (el CMF no tiene el número).
- No habría arreglado las fallas del caso testigo (Rodrigo): Tenpo era de **nombre**, Santander
  Consumer de **falta de RUT del emisor**, Falabella de **mala desambiguación de entidad** — todas
  de *resolución de institución*, no de *confusión de productos*.

**Cómo encaja.**
- Agregar `numero_operacion?: string` a `AcreditacionDoc` (lo puebla el resolver / Centinela leyendo el cert).
- Usarlo en la **agrupación multiproducto** y el **dedup** del lado del cert. Aditivo: si no viene,
  el comportamiento actual (por monto) no cambia.

**Dónde se conecta.**
`sentinel.ts` (split/dedup multiproducto, reconciliación) y `step3_acreedores.ts` (agrupación
multiproducto). El emparejamiento cert↔CMF sigue siendo por institución + monto/tipo.

---

### 3. Señal **UF vs pesos** para clasificar vivienda vs consumo/comercial

**Qué hace su flujo.**
`lib/skills/detect-pdf-type-prompt.ts` obliga al modelo a declarar en `que_es` si los montos del
documento están **en UF** ("certificado … montos en UF — probable crédito hipotecario") o en pesos.
Lo usan para distinguir la sección **vivienda (UF)** de **consumo/comercial (pesos)** cuando un mismo
acreedor aparece en ambas.

**Por qué nos aporta.**
Es un heurístico **barato y robusto** para desambiguar `tipo_credito` que hoy no tenemos. Mejora la
clasificación cuando una institución tiene un hipotecario (UF) y un consumo (pesos) a la vez.

**Cómo encaja.**
Detector de moneda en el texto del cert (`/UF|Unidad(es)? de Fomento/i` vs `$ / pesos`) usado como
**tie-breaker** del tipo de crédito en el análisis del cert. Determinista, sin LLM.

**Dónde se conecta.**
`cert_line_items.ts` / análisis de cert en `sentinel.ts`.

---

### 4. Catálogo de **falsos positivos** (rechazar documentos que NO acreditan)

**Qué hace su flujo.**
El prompt PDF-aware tiene reglas explícitas de rechazo (`is_match=false`):
- **cartola mensual / histórica ≠ estado de cuenta** → "cartola no es estado de cuenta",
- **captura de pantalla de la app/web banking ≠ certificado oficial**,
- **comprobante de pago de deuda ≠ certificado de deuda**,
- PDF ilegible / corrupto / protegido con clave → rechazo + `requiere_revision_humana`.

**Por qué nos aporta.**
Conecta directo con nuestra regla rectora **"declarar SOLO con documento que acredite"**. Hoy
detectamos chat de cobranza (`isChatDocument`, solo aporta vencimiento) pero **no** cartola /
screenshot / comprobante de pago → riesgo de declarar un monto leído de un documento que no acredita.

**Cómo encaja.**
Sumar detectores deterministas por contenido (no por filename) al pre-pase del Centinela:
- `isCartola(text)`, `isScreenshot(...)` (heurística: muy poco texto + es imagen), `isComprobantePago(text)`.
- Un documento clasificado así **no genera monto** (igual que el chat) y dispara alerta `needs_review`.

**Dónde se conecta.**
`sentinel.ts` (pre-pase determinista) + reflejar las reglas en el prompt del Centinela.

---

## VALOR SECUNDARIO — Clasificación + calidad de alertas

### 5. **Confidence + `requiere_revision_humana` por certificado**, con tope de confianza

**Qué hace su flujo.**
Cada match trae `confidence` (0.0–1.0) + `reasoning`, y **capa la confianza a máx. 0.7** en
doc-types que siempre se revisan a mano (certificado de dominio vigente, hipotecas y gravámenes,
anotaciones vigentes, cotizaciones AFP). Tienen una escala de confianza explícita en el prompt.

**Por qué nos aporta.**
Hoy nuestras `automation_alert` (`needs_review`) son binarias ("sin match" / "falta documento").
Adjuntar **confianza + motivo + flag de revisión** por cert hace el panel del abogado mucho más
accionable: ve *qué tan seguro* está el robot y *por qué*. No cambia la decisión de declarar; solo
enriquece la señal.

**Cómo encaja.**
- Que el Centinela / resolver devuelvan `confidence` + `reasoning` por documento.
- Propagarlo al `Step3Report` y a la `automation_alert` consolidada que ya emite `worker.ts`.
- Lista de doc-types "siempre revisar" que capan la confianza (alineado con la regla de los 30 días
  que ya manejamos para inmuebles).

**Dónde se conecta.**
`sentinel.ts` / `centinela_agent.ts` → `Step3Report` → `worker.ts` (emisión de alertas).

---

### 6. **Top-N candidatos** cuando no hay match confiable (en vez de binario)

**Qué hace su flujo.**
`lib/skills/match-candidates.ts` devuelve los **3 mejores acreedores candidatos** por documento
(ordenados por confianza, cacheados en DB) cuando no hay un match único claro — para que un humano
elija.

**Por qué nos aporta.**
Cuando `cert_institution_resolver` no resuelve la institución por RUT, hoy alertamos "no match" a
secas. Ofrecer los **N candidatos del catálogo** (por similitud de nombre/RUT parcial) convierte la
alerta en una elección de un clic para el abogado.

**Cómo encaja.**
- En el fallback de `cert_institution_resolver.ts`, en vez de devolver `null`, computar top-N de
  `acreedores_canonicos` por similitud y adjuntarlos a la alerta `needs_review`.
- No requiere su infra de caché (es nuestra fuente, no Drive); se calcula al vuelo.

**Dónde se conecta.**
`cert_institution_resolver.ts` → alerta del `Step3Report`.

---

## Verificaciones (no es código nuevo, es confirmar que respetamos sus reglas duras)

Su parser CMF (`cmf-check-prompt.ts`) codifica dos reglas que **nosotros parseamos en TS**
(`analyzeCmfPdf`) y conviene confirmar que respetamos:

- **"Cupo disponible no es deuda salvo `monto_utilizado > 0`"** — la sección de líneas de crédito
  disponibles es informativa; un cupo sin usar NO debe generar acreedor.
- **"Tarjeta de crédito SIEMPRE `tarjeta_credito`, NUNCA `linea_credito`"** — una tarjeta con cupo
  disponible sigue siendo tarjeta; solo es "línea de crédito" si el informe la rotula explícitamente.

---

## DESCARTADO a propósito (y por qué)

| Ítem de su flujo | Por qué NO lo traemos |
|---|---|
| `compareCmf` / diff de CMF (nuevos/desaparecidos, cambios >10%) | Es **su monitoreo** de evolución de mora; no aplica a declarar en el portal. |
| Máquina de estados, cron 3×/día, toggle por-caso (`caso_agente_config`) | Infra de **recolección aguas arriba**; ya es su capa, no la nuestra. |
| Parser CMF por LLM (`cmf-check`) | Nosotros parseamos el CMF en **TS** (`analyzeCmfPdf`), más determinista. Solo tomamos sus reglas duras (ver Verificaciones). |
| Caché de candidatos en DB, modelo `documentos_drive` / `renegociacion_documento_match` | Acoplado a **su** modelo (Drive + Airtable). Nuestra fuente es el sandbox; el espíritu (#6) sí lo tomamos. |
| Prompt caching del system prompt estático | Optimización de **costo**, no de calidad. Trivial de sumar después si hace falta. |

---

## Orden de implementación sugerido (revisado con la evidencia de las pruebas, 2026-06-28)

1. **#1 — rescate por lectura nativa (PDF + IMAGEN)** — máximo impacto en el dolor real (monto en
   certs messy y **certs-imagen**, recién confirmado: Santander Consumer no resolvió, las EECC de
   Tenpo son PNG). ⚠️ Incluir la variante **`callClaudeWithImage`** (visión), no solo `callClaudeWithPdf`.
2. **#4 — catálogo de falsos positivos** — protege la regla rectora; evidencia directa (en el caso
   Rodrigo venían mezclados poder, liquidaciones y una cartola como certs tipo 24).
3. **#3 — UF vs pesos** — rápido, determinista (en el caso Rodrigo, Santander Vivienda en UF vs
   Comercial en pesos).
4. **#2 — nº de operación** — SOLO como **disambiguador multiproducto / dedup del lado del cert**
   (NO llave cert↔CMF: el CMF no trae el número). Bajo riesgo, aditivo.
5. **#5 — confidence/reasoning en alertas** y **#6 — top-N candidatos** (calidad del panel del abogado).
6. **Verificaciones** del parser CMF (confirmar reglas duras).

> Todas respetan la regla rectora: el LLM (suyo o nuestro) **extrae hechos**; **TypeScript blinda la
> estructura**. Ninguna mueve la decisión 260/261, el split o el override fuera de TS.
>
> **Nota de las pruebas:** las mejoras #1/#4/#3 atacan dolores que VIMOS en vivo; #2 ayuda al
> multiproducto pero NO habría resuelto las fallas de matching del caso testigo (que eran de
> *resolución de institución*: nombre / RUT del emisor / desambiguación de entidad, no de productos).
