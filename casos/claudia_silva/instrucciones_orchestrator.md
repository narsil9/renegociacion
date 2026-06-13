# Instrucciones API Key #2 — Cognitive Orchestrator (Orquestador Cognitivo)
## Caso: Claudia Andrea Silva Inalaf — RUT 18.810.379-0

Este archivo documenta las instrucciones exactas enviadas al Orchestrator y las decisiones de mapeo específicas de los documentos de Claudia. El Orchestrator corre **después** del Sentinel y su trabajo es asignar los certificados descargados de Supabase Storage a los acreedores correspondientes, verificar su validez, y producir la lista `mappedDocs` que Playwright usa para adjuntarlos en el portal.

---

## Rol del Orchestrator en este caso

El Orchestrator actúa como **segunda línea de control (Auditor Cognitivo Experto / Mente Pensante)**. Corre después del Sentinel y resuelve:

1. **¿Cuál certificado corresponde a cuál acreedor?** — Hay dos acreedores "Banco de Chile" (consumo + tarjeta): el Orchestrator los distingue por tipo de producto y los datos del Sentinel.
2. **¿Qué archivo acredita monto y cuál acredita vencimiento?** — Retorna solo los **nombres de archivo** (`monto_file`, `vencimiento_file`). No conoce storage paths — eso lo agrega TypeScript en post-proceso.
3. **¿Están frescos los documentos?** — Verifica los 30 días salvo estados de cuenta (exentos).
4. **¿El RUT del emisor coincide con el banco asignado?** — Validación final de identidad.

**Flujo de dos etapas:**
```
Claude retorna: documentMapping (monto_file / vencimiento_file por acreedor)
     ↓
TypeScript enriquece: busca storage_path y local_path de cada filename en la BD
     ↓
Resultado final: mappedDocs (con storage_path + local_path) → Playwright adjunta
```
Claude no puede conocer ni generar storage paths — eso es responsabilidad del código TypeScript post-llamada.

---

## Decisiones de mapeo en este caso

### Acreedor 1 — Banco de Chile (crédito consumo, Art. 260)

**Documento:** `Banco de Chile Crédito Consumo - Informe Crédito.pdf`
**¿Por qué un solo PDF cubre monto Y vencimiento?**
El informe de crédito formal emitido por el banco incluye simultáneamente:
- El **saldo insoluto** ($48.236.275) → acredita el monto (tipo 22)
- Las **cuotas vencidas con fechas exactas** → acredita el vencimiento (tipo 23)

Por eso el mismo archivo aparece dos veces en `mappedDocs`: una vez con `tipo_documento: 22` y otra con `tipo_documento: 23`. El portal acepta el mismo PDF subido dos veces para los dos tipos de acreditación.

**Antigüedad:** El informe es del 20/11/2024. Si la fecha de análisis es 03/12/2024 → 13 días. ✅ Dentro de 30 días.

**RUT del emisor:** Banco de Chile → RUT 97.004.000-5. Verificar que aparezca en el texto del PDF.

**Nota sobre la ambigüedad de dos Banco de Chile:**
El CMF lista dos entradas con `institucion: "Banco de Chile"`. El Orchestrator las distingue así:
- La entrada con `tipoCredito: "Crédito de Consumo"` (o product_type del Sentinel = `credito_consumo`) → recibe el informe de crédito (tipo 22 + 23)
- La entrada con `tipoCredito: "Tarjeta de Crédito"` (o product_type del Sentinel = `tarjeta_credito`) → recibe el EC de octubre (tipo 22 solo)
- Regla de desempate: el Sentinel es fuente autoritativa. El `product_type` en `reclassifiedCreditors` / `identified261Creditors` define cuál documento va a cuál producto.

---

### Acreedor 2 — CAR - Ripley (tarjeta de crédito, Art. 260)

**Documentos (4 estados de cuenta mensuales):**
- `RIPLEY AGOSTO.pdf` → tipo 23 (vencimiento: primer mes con mora 25/08/2024)
- `RIPLEY SEPTIEMBRE.pdf` → tipo 23 (cadena de mora: confirma mora continuada)
- `RIPLEY OCTUBRE.pdf` → tipo 23 (cadena de mora: confirma mora continuada)
- `RIPLEY NOVIEMBRE.pdf` → tipo 22 (monto: saldo $1.218.565 más reciente)

**¿Por qué 4 documentos para un solo acreedor?**
El portal Art. 260 requiere monto + vencimiento para tarjetas en mora. Para una tarjeta de crédito NO hay un solo documento que certifique ambos como lo hace el informe de crédito bancario. La estrategia es:
- El **EC del primer mes impago** (agosto) prueba la **fecha de vencimiento** incumplida.
- Los ECs intermedios (sept + oct) son la **cadena de mora**: prueban que la mora no se interrumpió.
- El **EC más reciente** (noviembre) prueba el **monto vigente** de la deuda.

**Antigüedad y exención:**
Estados de cuenta mensuales históricos → EXENTOS del límite de 30 días. El Orchestrator NO debe reportar `expired_certificate` para ninguno de estos 4 documentos.

**Nombre del emisor en texto:** "CAR S.A." o "Tarjeta Ripley" o "Mastercard Ripley". RUT del emisor: CAR S.A. → RUT 76.350.771-9.

---

### Acreedor 3 — Banco de Chile (tarjeta Mastercard, Art. 261)

**Documento:** `Banco de Chile Tarjeta Mastercard EC Octubre 2024.pdf`
**Tipo:** Solo monto (tipo 22). Art. 261 no requiere vencimiento.
**Monto declarado:** $65.864

**Antigüedad y exención:**
Estado de cuenta mensual → EXENTO del límite de 30 días.

**¿Por qué solo un tipo 22?**
Deudas Art. 261 solo necesitan acreditar que existe la deuda y su monto. No hay requisito de probar vencimiento porque no están en mora ≥91 días.

---

## Regla especial: Sentinel como fuente autoritativa

El Orchestrator usa el resultado del Sentinel para:

1. **Resolver discrepancias CMF/banco**: Si el Sentinel reporta `total_credito_clp: 48.236.275` para BCI Consumo, ese es el monto a declarar en el portal — **no** el `totalCredito` del CMF ($38.901.386). El monto del banco es siempre más reciente.

2. **Clasificar correctamente**: Si el Sentinel dice que BCI Consumo es `obligaciones_260`, el Orchestrator le asigna tipo 22 + tipo 23. Si dice Art. 261, solo tipo 22.

3. **Identificar productos con mismo banco**: El campo `product_type` del Sentinel (`credito_consumo` vs `tarjeta_credito`) es el desambiguador cuando dos líneas del CMF tienen la misma `institucion`.

---

## Cómo funciona técnicamente: estructura del mensaje enviado a Claude

El Orchestrator envía a Claude un mensaje multipart con este contenido en orden:

1. **TypeScript pre-análisis JSON** (`localAnalysis`): incluye por cada certificado:
   - `filename`, `document_type`, `acreditacion_tipo`, `institucion_cmf`, `uploaded_at`
   - `rutCheckTypeScript`: resultado del chequeo de RUT determinista (si tiene texto)
   - `cumpleRequisitosAcreditacion`: si el doc satisface los requisitos para su acreedor
   - `sentinelEnrichment`: si `enabled: true`, contiene `reclassifiedTo260` e `identified261` del Sentinel

2. **Texto del CMF** (hasta 15.000 chars)

3. **Certificados con texto** (JSON array con `text` de cada uno)

4. **Certificados imagen** (base64 inline): para cada PDF escaneado/imagen, Claude recibe:
   - Un bloque de texto con metadatos del abogado (filename, acreedor asignado, tipo)
   - Un bloque `image` con el base64 del PDF/imagen para análisis visual directo

Los valores de `monto_file` y `vencimiento_file` que Claude retorna deben coincidir **exactamente** con el campo `filename` de los certificados tal como aparecen en el array. Claude no puede inventar ni modificar nombres de archivo.

---

## Sistema prompt enviado al Orchestrator (versión genérica)

```
Eres el Orquestador Cognitivo (API Key #2) para el sistema de
renegociaciones de deuda en Chile (Ley 20.720 — Superir).

Tu tarea: auditar los certificados de acreditación del cliente y
asignarlos correctamente a los acreedores del CMF.

FECHA DE REFERENCIA HOY: [FECHA_ACTUAL_CHILE]

INFORMACIÓN PREVIA (Sentinel — fuente autoritativa):
[JSON del Sentinel insertado aquí: reclassifiedCreditors + identified261Creditors]

ANÁLISIS LOCAL PREVIO (TypeScript determinista):
[localAnalysis con cumpleRequisitosAcreditacion, rutCheck por certificado]

REGLA 1 — Antigüedad de documentos (segunda verificación):
- CMF: máximo 30 días.
- Certificados con texto extraíble: máximo 30 días desde fecha del documento.
- EXCEPCIÓN: Estados de cuenta mensuales → EXENTOS (acreditacion_tipo: 'estado_cuenta').
- Si es imagen/escaneado (0 chars): Claude debe verificar visualmente fecha y RUT.
  No generar falso positivo por falta de texto.

REGLA 2 — Verificar mora Art. 260 desde CMF:
- Para acreedores Art. 260, confirmar que CMF o Sentinel documenta mora ≥91d.
- Los reclasificados por Sentinel tienen prioridad sobre CMF.

REGLA 3 — Categorías Art. 261 del CMF:
- Tipo 12 (consumo), tipo 1 (tarjetas) vigentes → Art. 261 si overdue90Days === 0.

REGLA 4 — Validación de RUT del emisor:
- El análisis TypeScript (rutCheckTypeScript) ya extrajo RUTs del texto.
- Si rutMismatch: true → confirmar o refutar viendo el texto/imagen del PDF.
- Un mismatch confirmado → alerta 'rut_mismatch' (bloqueante).
- Si el texto no tiene RUT visible → no generar falso positivo.

REGLA 5 — Enriquecimiento Sentinel (fuente autoritativa):
- Los montos del Sentinel (de documentos bancarios) prevalecen sobre el CMF.
- La clasificación del Sentinel (260 vs 261) prevalece sobre el CMF.
- No marcar 'inconsistency' si la diferencia se explica por el lag del CMF.

REGLA 6 — Requisito 80 UF / 2 productos (no bloqueante para auditoría):
- Calcular pero reportar solo como advertencia, nunca bloquear la carga.

REGLA 7 — Nombres de archivos exactos:
- Los nombres en documentMapping deben coincidir EXACTAMENTE con los nombres
  en el array de certificados recibido. No inventar ni cambiar extensiones.

Responde ÚNICAMENTE con JSON dentro de <json>...</json>.
```

---

## JSON de salida real de Claude (lo que retorna el modelo)

Este es el JSON que Claude efectivamente devuelve. Contiene solo **nombres de archivo** — no storage paths ni local paths.

```json
{
  "status": "success",
  "reason": null,
  "documentMapping": [
    {
      "institucion": "Banco de Chile",
      "monto_file": "Banco de Chile Crédito Consumo - Informe Crédito.pdf",
      "vencimiento_file": "Banco de Chile Crédito Consumo - Informe Crédito.pdf"
    },
    {
      "institucion": "CAR - Ripley",
      "monto_file": "RIPLEY NOVIEMBRE.pdf",
      "vencimiento_file": "RIPLEY AGOSTO.pdf"
    },
    {
      "institucion": "Banco de Chile",
      "monto_file": "Banco de Chile Tarjeta Mastercard EC Octubre 2024.pdf",
      "vencimiento_file": null
    }
  ],
  "alerts": []
}
```

**Nota:** Para Ripley, `vencimiento_file` apunta solo al primer EC (agosto) porque es el que tiene la fecha de vencimiento incumplida. Los ECs de cadena (sept, oct) no tienen un campo único `vencimiento_file` en el esquema — son documentos adicionales que Playwright adjunta como tipo 23 también, pero Claude solo retorna uno por campo.

---

## Cómo TypeScript transforma el output de Claude en `mappedDocs`

Después de recibir el JSON de Claude, `cognitive_orchestrator.ts` hace un post-proceso:
1. Para cada entrada de `documentMapping`, busca en la lista de `documents` el `storage_path` y `local_path` que corresponden al `monto_file` y `vencimiento_file` por nombre de archivo.
2. Construye la lista `mappedDocs` (tipo `AcreditacionDoc[]`) que Playwright usa directamente.

**`mappedDocs` final (generado por TypeScript, NO por Claude):**
```json
[
  { "institucion_cmf": "Banco de Chile", "tipo_documento": 22,
    "storage_path": "patricio_martini/banco_de_chile_consumo_report.pdf",
    "local_path": "outputs/acreditaciones_tmp/banco_de_chile_consumo_report.pdf" },
  { "institucion_cmf": "Banco de Chile", "tipo_documento": 23,
    "storage_path": "patricio_martini/banco_de_chile_consumo_report.pdf",
    "local_path": "outputs/acreditaciones_tmp/banco_de_chile_consumo_report.pdf" },
  { "institucion_cmf": "CAR - Ripley", "tipo_documento": 23,
    "storage_path": "patricio_martini/ripley_estado_cuenta_agosto_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/ripley_estado_cuenta_agosto_2024.pdf" },
  { "institucion_cmf": "CAR - Ripley", "tipo_documento": 23,
    "storage_path": "patricio_martini/ripley_estado_cuenta_septiembre_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/ripley_estado_cuenta_septiembre_2024.pdf" },
  { "institucion_cmf": "CAR - Ripley", "tipo_documento": 23,
    "storage_path": "patricio_martini/ripley_estado_cuenta_octubre_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/ripley_estado_cuenta_octubre_2024.pdf" },
  { "institucion_cmf": "CAR - Ripley", "tipo_documento": 22,
    "storage_path": "patricio_martini/ripley_estado_cuenta_noviembre_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/ripley_estado_cuenta_noviembre_2024.pdf" },
  { "institucion_cmf": "Banco de Chile", "tipo_documento": 22,
    "storage_path": "patricio_martini/banco_de_chile_tarjeta_octubre_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/banco_de_chile_tarjeta_octubre_2024.pdf" }
]
```

---

## Tabla resumen: qué necesita cada acreedor

| Acreedor | Art. | Documentos | Tipos | Por qué |
|---|---|---|---|---|
| Banco de Chile (consumo) | 260 | Informe Crédito × 1 PDF | 22 + 23 | Mismo PDF prueba monto Y cuotas vencidas |
| CAR - Ripley | 260 | ECs agosto + sept + oct + nov | 23 (×3) + 22 (×1) | EC más antiguo = vencimiento; ECs cadena = mora continua; EC más reciente = monto |
| Banco de Chile (tarjeta) | 261 | EC Octubre 2024 | 22 | Solo monto; sin requisito de vencimiento en Art. 261 |

---

## Patrones de mapeo reutilizables para futuros casos

### Crédito de consumo con informe bancario formal
→ **Un solo PDF cubre tipo 22 + tipo 23** (saldo + fechas de cuotas)
→ Ejemplo: Banco de Chile, BCI, Santander, Scotiabank

### Tarjeta de crédito con ECs mensuales en mora
→ **EC del primer mes impago = tipo 23** (fecha de vencimiento)
→ **ECs intermedios = tipo 23** (cadena de mora)
→ **EC más reciente = tipo 22** (monto vigente)
→ Mínimo: 2 ECs (primero + más reciente). Recomendado: todos los meses consecutivos.
→ Ejemplo: Ripley, Falabella, La Polar, CMR Falabella

### Deuda vigente Art. 261 con EC
→ **Solo tipo 22** (monto)
→ No importa si el EC es de 3 meses atrás: estados de cuenta EXENTOS de 30 días
→ Ejemplo: Banco de Chile Tarjeta, cualquier tarjeta al día

### Crédito hipotecario (formato distinto — pendiente de implementar)
→ El certificado de liquidación/saldo hipotecario incluye tabla de amortización
→ Requiere algoritmo diferente: buscar "cuotas impagas" y "saldo vigente al DD/MM/AAAA"
→ **No usar las reglas de este caso para hipotecarios** — crear `instrucciones_sentinel.md` separado para ese caso
