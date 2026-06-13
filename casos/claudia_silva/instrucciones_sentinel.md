# Instrucciones API Key #1 — Sentinel (Centinela de Carga)
## Caso: Claudia Andrea Silva Inalaf — RUT 18.810.379-0

Este archivo documenta las instrucciones exactas enviadas al Sentinel y las anotaciones específicas de los documentos de este caso. Sirve como referencia para casos con documentos de formato similar (informe de crédito de consumo + estados de cuenta de tarjeta de crédito).

---

## Rol del Sentinel en este caso

El CMF de Claudia (corte 08/11/2024) mostraba **$0 en la columna de mora 90+ días** para Banco de Chile Consumo, porque al 08/11/2024 solo llevaba 66 días de mora. Sin el Sentinel, el sistema habría clasificado ese crédito como Art. 261 y Claudia no hubiera calificado (solo 1 producto en Art. 260 desde CMF).

El Sentinel leyó los documentos bancarios y detectó que al **03/12/2024** (fecha real de análisis):
- Banco de Chile Consumo → 91 días → **reclasificado a Art. 260**
- CAR - Ripley → 100 días → **ya estaba en Art. 260 por CMF, confirmado**
- Banco de Chile Tarjeta → **identificado como Art. 261** (cargo automático liquidó mora)

---

## Documentos del caso y algoritmo aplicado a cada uno

### Documento 1 — Informe de Crédito (Banco de Chile Consumo)
**Archivo:** `Banco de Chile Crédito Consumo - Informe Crédito.pdf`
**Tipo:** Crédito de consumo amortizable en cuotas mensuales
**acreditacion_tipo:** `general` (document_type: 24 — acredita monto Y vencimiento)

**Algoritmo del Sentinel (Regla A — Crédito de Consumo):**
1. Localizar `Número de Cuotas Vencidas no Pagadas` → **3 cuotas**
2. Localizar `Fecha Próximo Pago` → **03/12/2024** (fecha de la cuota 7)
3. Reconstruir hacia atrás (una cuota por mes, mismo día del mes):
   - Cuota 6 venció → **03/11/2024**
   - Cuota 5 venció → **03/10/2024**
   - Cuota 4 venció → **03/09/2024** ← primera cuota impaga
4. `días_mora = 03/12/2024 − 03/09/2024 = 91 días`
5. 91 ≥ 91 → **reclasificar a Art. 260**
6. Monto declarado: campo `Saldo del Crédito` → **$48.236.275**

**Campos relevantes encontrados en el texto del PDF:**
```
Número de Cuotas Vencidas no Pagadas: 3
Número de Cuotas Pagadas: 3
Fecha Próximo Pago: 03/12/2024
Saldo del Crédito: 48.236.275
Valor de la Cuota: 893.265
```

**Por qué el monto difiere del CMF:**
El CMF (corte 08/11/2024) mostraba `totalCredito: $38.901.386`. El informe del banco (20/11/2024) muestra `$48.236.275`. Son documentos de fechas distintas — el monto del banco es el correcto para declarar en el portal.

---

### Documentos 2–5 — Estados de Cuenta Ripley (4 meses consecutivos)
**Archivos:**
- `RIPLEY AGOSTO.pdf` → acreditacion_tipo: `estado_cuenta`
- `RIPLEY SEPTIEMBRE.pdf` → acreditacion_tipo: `estado_cuenta`
- `RIPLEY OCTUBRE.pdf` → acreditacion_tipo: `estado_cuenta`
- `RIPLEY NOVIEMBRE.pdf` → acreditacion_tipo: `estado_cuenta`

**Tipo:** Tarjeta de crédito rotativa (Mastercard Ripley / CAR S.A.)
**Exentos del límite de 30 días** (son estados de cuenta mensuales históricos)

**Algoritmo del Sentinel (Regla B — Tarjeta de Crédito):**
1. Analizar mes a mes buscando el PRIMER período donde `Pago Realizado < Monto Mínimo a Pagar` (incluye $0 Y pagos parciales insuficientes).
   - Ejemplo de pago parcial: vence 09/10/2024, mínimo = $16.213, pagó = $15.361 → entra en mora el 09/10/2024.
   - En el caso Ripley: pago realizado = $0 desde agosto → inicio de mora inequívoco.
2. AGOSTO: `PAGAR HASTA 25/AGO/2024` — pago realizado = $0 → **inicio de mora: 25/08/2024**
3. SEPTIEMBRE: sin pago → confirma mora continua
4. OCTUBRE: sin pago → confirma mora continua
5. NOVIEMBRE: sin pago → **monto actual: $1.218.565** (saldo más reciente)
6. `días_mora = 03/12/2024 − 25/08/2024 = 100 días`
7. 100 ≥ 91 → **acreedor ya estaba en Art. 260 por CMF ($479.941 en 90+d), confirmado**

**Campos clave por documento:**
| Archivo | Campo clave | Valor |
|---|---|---|
| RIPLEY AGOSTO | PAGAR HASTA / Fecha de vencimiento | 25/AGO/2024 → código VCTO_2508 |
| RIPLEY AGOSTO | Monto Mínimo = Monto Total | 100% vencido desde inicio |
| RIPLEY SEPTIEMBRE | Código vencimiento | VCTO_2509 |
| RIPLEY OCTUBRE | Código vencimiento | VCTO_2510 |
| RIPLEY NOVIEMBRE | Monto Total Facturado | $1.218.565 |
| RIPLEY NOVIEMBRE | Código vencimiento | VCTO_2511 |

**Nota importante:** El primer vencimiento impago real fue julio 2024 (25/07/2024), pero el abogado decidió presentar desde agosto (4 ECs) para declarar 100 días en lugar de 130+. El portal acepta cualquier fecha ≥91 días. No es necesario subir el 5.º EC (julio).

---

### Documento 6 — Estado de Cuenta Tarjeta Mastercard Banco de Chile
**Archivo:** `Banco de Chile Tarjeta Mastercard EC Octubre 2024.pdf`
**Tipo:** Tarjeta de crédito rotativa (Art. 261 — deuda vigente)
**acreditacion_tipo:** `estado_cuenta` (exento del límite de 30 días)

**Por qué es Art. 261 (no Art. 260):**
La tarjeta registraba mora vencida de $14.210. Sin embargo, el **15/11/2024** Banco de Chile ejecutó un **cargo automático en cuenta corriente** por ese monto, liquidando la mora. Al 03/12/2024 la deuda está **vigente y al día** — no acumula 91 días continuos de mora.

**Algoritmo del Sentinel (identificación Art. 261):**
1. EC de octubre: saldo $65.864, monto mínimo pendiente.
2. Buscar en texto del documento referencia a pago/cargo posterior.
3. Encontrado: `MONTO PAGADO PERÍODO ANTERIOR: $0` + notificación de cargo automático.
4. El cargo automático del 15/11/2024 liquidó los $14.210 vencidos.
5. → No hay mora continua ≥91d → **Art. 261**

**Campos relevantes:**
```
Monto Total Facturado: 65.864
Cupo total tarjeta: $50.000 (nota: saldo > cupo por cargos acumulados)
Fecha del EC: 22/10/2024
MONTO PAGADO PERÍODO ANTERIOR: $0
```

---

## Cómo funciona técnicamente: estructura del mensaje enviado a Claude

El Sentinel envía a Claude un único mensaje multipart con este contenido en orden:

1. **TypeScript pre-análisis JSON** (`localAnalysis`): resultado del análisis determinista local. Incluye:
   - `requiresReclassificationAnalysis`: `true` si el CMF tiene <2 productos con 90+d y hay documentos para analizar
   - `documentsForReclassification`: lista de documentos marcados para que Claude analice mora
   - `cmfResult`: conteo de productos calificados según CMF
   - `documentsAgeValid`: resultado del chequeo de antigüedad TypeScript

2. **Texto del CMF** (extraído con `extractTextFromPdf`, hasta 15.000 chars)

3. **Cada documento** (uno por uno):
   - Si tiene texto extraíble → bloque de texto con el contenido (`textContent`)
   - Si es imagen/escaneado → bloque de imagen base64 (`isImageDoc: true`, `imageBase64`, `imageMimeType`)

Claude no toma decisiones de reclasificación por presunción. Si un acreedor tiene mora=0 en CMF y **no hay** documento adjunto de ese acreedor, permanece en `otros_acreedores` sin reclasificar.

---

## Sistema prompt enviado al Sentinel (transcripción exacta — simplificada)

```
Eres el Centinela de Carga preventivo (API Key #1) para el estudio de
renegociaciones de deuda en Chile (Ley 20.720 — Superir).

FECHA DE REFERENCIA HOY: [FECHA_ACTUAL_CHILE]

CONTEXTO CRÍTICO: El Informe CMF puede estar desactualizado. Si muestra
$0 en la columna de mora 90+ días para un acreedor, pero los documentos
adjuntos demuestran mora real ≥ 91 días desde hoy, debes detectarlo y
registrarlo en "reclassifiedCreditors". El pre-análisis TypeScript indica
con "requiresReclassificationAnalysis": true cuándo esto es necesario.

REGLA 1 — Antigüedad de documentos:
- CMF y certificados: máximo 30 días.
- EXCEPCIÓN: Estados de cuenta mensuales → EXENTOS del límite de 30 días.

REGLA 2 — Reclasificación por documentos
         (aplica cuando "requiresReclassificationAnalysis" es true):
Analiza CADA documento indicado en "documentsForReclassification":

A) Crédito de Consumo (informe o certificado):
   1. Localiza "Cuotas Vencidas no Pagadas" (N).
   2. Localiza "Fecha Próximo Pago" (fecha futura).
   3. Reconstruye hacia atrás: cuota más antigua = próxima_fecha − (N × ~30d).
      Ejemplo: próxima=03/12/2024, N=3 → cuota 4 venció 03/09/2024.
   4. días_mora = HOY − fecha_cuota_mas_antigua.
   5. Si días_mora ≥ 91 → reclassifiedCreditors.
   6. Monto = "Saldo Total" / "Saldo Insoluto" / "Capital Vigente".

B) Tarjeta de Crédito (estados de cuenta mensuales):
   1. Mes a mes: busca primer período donde Pago Realizado < Monto Mínimo
      (incluye $0 Y pagos parciales insuficientes).
   2. La fecha "PAGAR HASTA" o "VENCE EL" de ese período = inicio de mora.
   3. días_mora = HOY − fecha_primer_vencimiento_incumplido.
   4. Si días_mora ≥ 91 → reclassifiedCreditors.
   5. Monto = "CUPO TOTAL" / "Límite de Crédito Autorizado".

REGLA 3 — Requisito multiproducto (≥2 productos con mora ≥91d):
- Total CMF + reclasificados ≥ 2 → meets90DaysRequirement = true.
- Si < 2 → false, incluir en errors.

REGLA 4 — Monto mínimo (≥80 UF = $3.253.000 CLP):
- Suma montos de todos los productos calificados (CMF + reclasificados).
- Si < $3.253.000 → meetsAmountRequirement = false, incluir en errors.

REGLA 5 — Acreditación por acreedor:
- Art. 260 (mora ≥91d): necesita monto Y vencimiento.
- Art. 261 (<91d, no reclasificado): solo monto.

REGLA 6 — RUT del emisor:
- Si el PDF tiene texto, verificar que el RUT del emisor corresponda al banco.

REGLA 7 — Identificar deudas Art. 261 (deudas vigentes):
- Para cada acreedor NO reclasificado a Art. 260, analizar si es Art. 261.
- Agregar a "identified261Creditors" con bank, product_type, institucion_cmf,
  total_credito_clp, reason, document_filename.

IMPORTANTE: Si los documentos demuestran que los requisitos se cumplen
aunque el CMF no lo refleje, el resultado puede ser "success": true con
reclassifiedCreditors no vacío.

Responde ÚNICAMENTE con JSON dentro de <json>...</json>.
```

---

## Tabla de tipos de alerta y si bloquean el job

| `type` | Cuándo se emite | ¿Bloquea? |
|---|---|---|
| `expired_cmf` | CMF con >30 días de antigüedad | **Sí** |
| `expired_certificate` | Certificado (no EC) con >30 días | **Sí** |
| `insufficient_products` | <2 productos calificados con ≥91d | **Sí** |
| `insufficient_uf` | Suma totalCredito < 80 UF | **Sí** |
| `reclassification_required` | Acreedor reclasificado CMF→documentos | No (informativa) |
| `document_unreadable` | PDF escaneado/ilegible, sin texto | No (advertencia) |

---

## JSON de salida esperado para este caso

```json
{
  "success": true,
  "errors": [],
  "reclassifiedCreditors": [
    {
      "bank": "Banco de Chile",
      "product_type": "credito_consumo",
      "institucion_cmf": "Banco de Chile",
      "delinquency_start_date": "2024-09-03",
      "delinquency_days": 91,
      "total_credito_clp": 48236275,
      "new_classification": "obligaciones_260",
      "reason": "Informe Crédito 20/11/2024: 3 cuotas vencidas no pagadas. Cuota 4 venció 03/09/2024 = 91 días al 03/12/2024.",
      "document_filename": "Banco de Chile Crédito Consumo - Informe Crédito.pdf"
    },
    {
      "bank": "CAR - Ripley",
      "product_type": "tarjeta_credito",
      "institucion_cmf": "CAR - Ripley",
      "delinquency_start_date": "2024-08-25",
      "delinquency_days": 100,
      "total_credito_clp": 1218565,
      "new_classification": "obligaciones_260",
      "reason": "EC Agosto 2024: PAGAR HASTA 25/08/2024. 4 ECs consecutivos sin pago. Al 03/12/2024 = 100 días de mora.",
      "document_filename": "RIPLEY AGOSTO.pdf"
    }
  ],
  "identified261Creditors": [
    {
      "bank": "Banco de Chile",
      "product_type": "tarjeta_credito",
      "institucion_cmf": "Banco de Chile",
      "total_credito_clp": 65864,
      "reason": "EC Octubre 2024: cargo automático 15/11/2024 liquidó mora de $14.210. Deuda vigente sin mora ≥91d continuada.",
      "document_filename": "Banco de Chile Tarjeta Mastercard EC Octubre 2024.pdf"
    }
  ],
  "details": {
    "meets90DaysRequirement": true,
    "meetsAmountRequirement": true,
    "totalAmountCLP": 49454840,
    "creditorsWith90DaysCount": 2,
    "documentsAgeValid": true,
    "requiredCertificatesPresent": true
  }
}
```

---

## Casos de uso similares a este (cuándo reusar estas instrucciones)

Este caso aplica cuando el cliente tiene:
- Un **crédito de consumo** donde el CMF tiene retraso y el banco emite un informe de crédito formal con cuotas
- **Tarjeta(s) de crédito** con estados de cuenta mensuales que demuestran mora acumulada
- Al menos una deuda vigente (Art. 261) que debe declararse aunque no sirva para calificar
- CMF con lag de 2–6 semanas que no refleja la mora real al momento del análisis
