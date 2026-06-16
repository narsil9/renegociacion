# Referencia de Acreedores y Lecciones por Caso

Fuente de verdad operativa para el análisis. **Actualizar con cada caso nuevo.** El catálogo maestro vive en la tabla `acreedores_canonicos` (Supabase) y los alias en `src/utils/acreedor_matcher.ts`.

---

## Nombres normalizados de instituciones (`institucion_cmf`)

Usa el nombre **exacto** del catálogo en la columna `institucion_cmf` del mapeo `client_documents`. El robot normaliza vía alias, pero conviene escribir el canónico.

| Como aparece (CMF / documento / habla común) | Nombre canónico catálogo | RUT conocido | Notas |
|---|---|---|---|
| CAR - Ripley / Banco Ripley / Tarjeta Ripley | `CAR S.A. (Tarjeta Ripley)` | — | Alias `car ripley`, `car`. CMF escribe "CAR - Ripley". |
| CAT / Cencosud / Cencosud Scotiabank / Banco Paris | `CAT (ex CENCOSUD)` | — | Tarjeta Mastercard Cencosud. |
| CMR / CMR Falabella / Banco Falabella | `CMR Falabella` (o `Banco Falabella`) | — | Tarjeta CMR Mastercard. Distinguir banco vs tarjeta según producto. |
| Presto / Presto Lider / Tarjeta Lider / Lider | `Tarjeta Lider` (BCI) | — | Alias `presto lider`, `presto`, `tarjeta presto`, `lider`. |
| BCI / Banco BCI | `Banco de Crédito e Inversiones` | — | Alias `bci`. |
| Santander | `Banco Santander` | — | OJO: distinguir de "Santander Consumer" por RUT del certificado. |
| Itaú / Banco Itaú / Itaú Corpbanca | `Banco Itaú` | **97023000-9** | Comuna Las Condes. Suele consolidar varios productos en 1 fila CMF "Consumo". |
| Banco de Chile / Banchile / Socofin | `Banco de Chile` | — | Socofin es su filial de cobranza (certificados `EEDD_xxxx.pdf` tipo 24). |
| Banco Estado / BancoEstado | `Banco Estado` | — | Separa Vivienda vs Consumo en filas CMF distintas. |
| Coopeuch | `Coopeuch` | — | Certificado de liquidación de portabilidad acredita monto. |
| Caja Los Andes / Caja los andes | `CCAF Los Andes` | **81826800-9** | NO-CMF típico. En docs dice "Caja Los Andes"; catálogo "CCAF Los Andes". Crédito social Ley 20.130, por planilla. |
| TGR / Tesorería | `Tesorería General de la República` | — | NO-CMF. Solo declarar si registra saldo deudor (no si dice "NO TIENE"). |
| Banco Internacional / Internacional | `Banco Internacional` | — | Consumo. Emite "Liquidación de Crédito para Cobranza Judicial" (tipo 24: declara fecha de mora + saldo total). |
| Solventa / Solventa Tarjetas | `Solventa Tarjetas` | — | Fintech/tarjeta (cupo bajo ~$100k línea rotativa). Verificar si está en `acreedores_canonicos`; si no, agregar. |
| Santander Consumer / Santander Consumer Finance | `Santander Consumer` | — | **Entidad DISTINTA de Banco Santander-Chile** (otro RUT). El CMF las lista por separado: "Santander-Chile" (banco) vs "Santander Consumer". No confundir. |
| Forum / Forum Servicios Financieros | `Forum Servicios Financieros` | — | Crédito automotriz/prendario NO-CMF. Suele aparecer además en la prenda del padrón/RVM. Verificar si existe exacto en `acreedores_canonicos`. |
| La Araucana / Caja La Araucana | `La Araucana C.C.A.F.` | — | Crédito social / caja de compensación NO-CMF. Verificar nombre exacto en catálogo antes de cargar al sandbox. |

> Si un certificado tiene un RUT que no calza con el banco asignado, **el RUT manda** (`detectCreditorRutFromDoc` / `findCatalogEntryByRut`). Agrega el alias/RUT nuevo a `acreedor_matcher.ts` y a esta tabla.

---

## Tipos de documento (`document_type` en `client_documents`)

| Código | Significado | Cuándo usarlo |
|---|---|---|
| **22** | Acredita **monto** | Art. 261 (al día), y monto de Art. 260 cuando va separado del vencimiento. |
| **23** | Acredita **vencimiento** | Art. 260, cuando el vencimiento va en un documento aparte (ej. captura del portal con la cuota impaga). |
| **24** | Acredita **monto + vencimiento** (genérico) | Art. 260 cuando UN documento prueba ambos: certificado prejudicial (Socofin/Falabella), o secuencia de 4 EECC consolidados. |

---

## Lecciones por caso (casos cerrados, E2E ✅)

### Claudia Silva — RUT 18.810.379-0 (2/2)
- BdCh Consumo $48.236.275 venc. 03/09/2024 (reclasificado 261→260 por desfase CMF; reconstrucción de cuotas: próximo pago 03/12 − 3 cuotas = cuota 4 el 03/09 = 91d exactos).
- CAR Ripley $1.218.565 venc. 25/08/2024 (100d): **4 EECC separados** (Ago–Nov) bastan, no se necesitan 5.
- Tarjeta BdCh Mastercard Art. 261 $65.864: **mismo `institucion_cmf='Banco de Chile'` que el consumo** → se distinguen por `tipoCredito` + reclasificación del Sentinel.

### Alejandra Espinoza — RUT 18.738.680-2 (5/5)
- CAT ex-Cencosud $11.275.392 venc. 04/09/2025 y CMR $1.781.499 venc. 25/08/2025 → Art. 260 con **últimos 4 EECC consecutivos** (o PDF `ilovepdf_merged`). EECC de Agosto adjunto extra para fijar el vencimiento.
- 3 deudas BdCh Art. 261 NO-CMF (consumo + 2 tarjetas Visa) → un solo `CPF...REDBANC...pdf` certifica las 2 tarjetas. Match por `filename` evita cruce.
- TGR decía "NO TIENE" → no se declara.
- Bienes: copropiedad 25% inmueble + interdicción sobre copropietaria (no bloquea, pero exige autorización judicial a futuro).

### Betzy Lee — RUT 26.199.806-8 (5/5)
- BdCh consumo $18.191.754 reclasificado (261→260) + **tarjeta BdCh $3.716.235 NO-CMF Art. 260** (mismo banco, producto fuera del CMF → `additionalCreditors`). Certificado Socofin = tipo 24.
- 3 Art. 261: CAT $9.262.634, CMR $1.173.246, Presto Lider $682.194 (atraso 62d < 91 → 261).
- Línea de crédito BdCh con saldo $0 → **NO se declara**.

### Yoselyn Reyes — RUT 16.563.374-1 (8/8)
- 4 Art. 260 CMF: Banco Estado, BCI, CAR Ripley, CMR Falabella. BCI consolida operaciones menores; Ripley acreditado con secuencia de 4 EECC.
- 1 Art. 261 CMF (Coopeuch) + **3 créditos NO-CMF CCAF Los Andes** Art. 261. "Caja Los Andes" (docs) = "CCAF Los Andes" (catálogo, RUT 81826800-9).
- Descuentos por planilla (Coopeuch + Caja) $770.893/mes se suspenden al renegociar.

### Susana Matamala — RUT 16.983.419-9 (4/4)
- CMF consolida **3 ops BdCh en 1 fila** ($11.601.044); un solo certificado Socofin `EEDD_7616.pdf` cubre las 3 + la línea (tipo 24). 4º producto CMR Falabella.
- Duplicado detectado: "Nov - Cencosud.pdf" era copia de agosto → usar el de octubre (verificar por contenido/fecha interna).
- Carpeta tributaria pendiente del SII (se usó placeholder).

### María Paz Bravo — RUT 16.997.909-K (5/5)
- CMR Falabella $9.763.965 venc. 05/08/2025 + **Itaú 3 productos en 1 fila CMF** "Consumo" $5.072.748 (consumo $3.219.943 + tarjeta $1.612.453 ambos 260; sobregiro $301.888 → 261).
- **2 filas Banco Estado**: Vivienda (hipotecario $71.189.175) + Línea $1.031.582; un documento (`Captura 2038.pdf`) cubre ambas filas por monto.
- Catálogo Banco Itaú corregido: RUT 97023000-9, comuna Las Condes.
- Conciliación CMF vs certificados peso a peso (diferencias por intereses/prepago).

---

### William Montero — RUT 25.656.359-2 (análisis, no E2E aún)
- **⚠️ LECCIÓN MÁS IMPORTANTE — deudas públicas escondidas en carpetas de bienes:** se omitieron en la primera pasada **2 deudas que vuelven inadmisible la solicitud**: (1) **contribuciones TGR morosas $128.838** (Cert. de Deuda de Tesorería, en `Bienes/Inmuebles/`, 4 cuotas 2025, la más antigua venc. 30/04/2025 → Art. 260 por 229 días) y (2) **multa de tránsito 1 UTM** (Cert. RMNP Registro Civil, en `Bienes/Vehículos/`, JPL Colina → Art. 261). Por esto existe el §"Principio de Declaración Total / Barrido de Exhaustividad" — **ejecutarlo SIEMPRE**. TGR y multas casi nunca están en el CMF y se archivan junto a los bienes, no a los acreedores.
- 9 acreedores CMF + 1 NO-CMF (Caja Los Andes) + 2 públicos (TGR contribuciones, multa tránsito). CMF (corte 05/12) reportaba solo $254.824 en 90+, pero los documentos prueban **3 productos Art. 260**: Banco Internacional (mora 05/09/2025, liquidación judicial), Banco Itaú (91 días por portal Soluciones de Pago, Constancia $13.747.818), CAT ex-Cencosud (primera boleta impaga 11/08/2025, 5 EECC).
- **Productos borde 261→260:** CMR Falabella (primera impaga 10/10) y Solventa (~15/10) cruzan los 91 días en **enero 2026**. **La fecha de postulación decide la clasificación** — dejar la nota explícita en el reporte y avisar al abogado.
- **"Liquidación de Crédito para Cobranza Judicial"** (Banco Internacional) ≠ liquidación concursal del cliente; es el banco calculando la deuda para cobranza. Excelente doc tipo 24 (trae "FECHA MORA" + saldo total).
- **Itaú sin fecha exacta:** el portal Soluciones de Pago da "días mora 91" pero no la fecha de la cuota; se reconstruye y se recomienda pedir certificado con la fecha exacta.
- **Hipotecario bajo el agua:** Scotiabank Vivienda $92M vs avalúo fiscal $68.8M.
- Mismo grupo, dos entidades CMF: "Santander-Chile" (banco, tarjetas+línea consolidadas, Patrón A) y "Santander Consumer" (financiera) son filas separadas.

### Nicolás Bascuñán — RUT 18.755.318-0 (análisis Gemini; 3 lecciones nuevas)
- **Mojibake / OCR:** el certificado **Socofin de Banco de Chile** ("Estado de Deuda - Power Apps.pdf") devuelve **texto corrupto ilegible** con `pdftotext` → hay que leerlo por **visión u OCR (Tesseract)**, nunca confiar en la extracción nativa. Ver §"Lectura de documentos: texto nativo vs OCR".
- **Multas múltiples por municipio:** un solo RMNP traía **5 multas de 3 tribunales** → se declaran como **2 acreedores** (Ilustre Muni. Santiago $284.680 con 4 multas JPL 1/4/5, e Ilustre Muni. Las Condes $104.470 con 1 multa). El acreedor es la **Municipalidad**, no el JPL. Agrupar por municipio, sumar UTM.
- **Fintechs de inversión:** **VECTOR.pdf = app Racional (Vector Capital)** — cuenta de inversión de ~$2 USD. Es un **activo a declarar** (bienes), fácil de omitir. La skill ahora lista Racional/Fintual/Tenpo/Tyba/Buda como objetivos de búsqueda en inversiones.
- Acreedores 260: 2 consumos reclasificados (BdCh $14.886.035 venc 12/05/2025; BCI $6.021.332 venc 02/05/2025). 261: hipotecario BdCh, Santander Consumer (automotriz prendario), CAR Ripley, CMR Falabella, 2× CCAF Los Andes (NO-CMF), 2 municipios (NO-CMF).
- **CCAF Los Andes** también aquí (2 créditos por planilla, NO-CMF) — patrón recurrente.

### Noelia Lorca Guerrero — RUT 15.121.553-K (análisis, sin E2E)
- **Bloqueo tributario duro:** aunque tenga empleo dependiente estable, la carpeta SII muestra **5 boletas de honorarios emitidas en 2025** (enero, abril, septiembre, octubre y noviembre). Eso basta para declarar **inadmisible hoy** la postulación, aunque el lado financiero sea bueno.
- **Banco de Chile mixto (CMF + NO-CMF):** la fila CMF `Banco de Chile` sí calza con el consumo principal (`1136`, prepago $13.524.920, mora desde 05/08/2025). Además aparecen **dos productos del mismo banco fuera del CMF**: línea de crédito `3570` (saldo a cancelar ~$114.782, mora desde 16/10/2025) y tarjeta `9782` (cupo utilizado ~$377.461, primer impago 08/10/2025). Mismo banco, tres productos distintos.
- **La Araucana como 260 mal acreditado:** el certificado de cuotas vigentes/morosas muestra mora desde **31/07/2025** (3 cuotas morosas), por lo que jurídicamente es **Art. 260 NO-CMF**; pero **no trae saldo liquidado actual**, solo `monto solicitado`, cuotas y estados. Sirve para vencimiento, no para monto. Hay que pedir certificado de liquidación/prepago.
- **Productos borde:** CAR Ripley queda en **Art. 261** al 10/12/2025 (primer impago 15/09/2025, 86 días), pero cruza a **Art. 260 el 15/12/2025**. BancoEstado consumo cruza a 260 recién el **31/12/2025**.
- **Activos pequeños también se declaran:** Mercado Pago/BICE con **$18.734**, BancoEstado con ahorros de **$994 + $5** y saldos líquidos de **$5.610** (CuentaRUT) + **$4.541** (Cuenta Corriente). Banco de Chile inversiones: **$0**. La carpeta de actividad de Mercado Pago muestra movimientos en BTC, pero no acredita un saldo cripto vigente.

## Errores y trampas frecuentes

- **No confiar en el nombre del archivo** — abre el PDF y revisa la fecha de emisión interna (duplicados).
- **CMF con $0 en mora 90+ no significa al día** — reconstruir la mora real desde los documentos (desfase de 2–3 semanas).
- **Monto del CMF ≠ monto a declarar** — usar el del documento (más actual), justificar la diferencia.
- **Mismo banco ≠ misma deuda** — un banco puede tener consumo + tarjeta + línea, cada uno producto independiente; y productos del mismo banco pueden estar dentro y fuera del CMF.
- **Tarjeta Art. 260 sin certificado prejudicial** → exige 4 EECC consecutivos, no basta el último.
- **Copropiedad** → declarar solo el % del cliente, no el bien completo.
