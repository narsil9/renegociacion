# Test Mapping — Claudia Silva (perfil Patricio Martini)

Datos técnicos exactos para el script de prueba hardcodeado (`test_step3_claudia.ts`).
Todos los valores fueron verificados contra el texto real de los PDFs en Supabase Storage.

---

## Datos del cliente (tabla `clients`)

```
client_id:           a9ddf715-3bdf-4377-8cb3-2d467089227d
name:                Patricio Martini (Prueba)
rut:                 21917363-6
informe_cmf_path:    patricio_martini/informe_cmf.pdf
```

---

## Resultado simulado del Sentinel (API Key #1)

### `reclassifiedCreditors` — Art. 260 detectado desde documentos

**1. Banco de Chile — Crédito de Consumo**
```json
{
  "bank": "Banco de Chile",
  "product_type": "credito_consumo",
  "institucion_cmf": "Banco de Chile",
  "delinquency_start_date": "2024-09-03",
  "delinquency_days": 91,
  "total_credito_clp": 48236275,
  "new_classification": "obligaciones_260",
  "reason": "Informe Crédito 20/11/2024: 3 cuotas vencidas no pagadas. Cuota 7 vence 03/12/2024 → reconstrucción: cuota 4 venció 03/09/2024 = 91 días al 03/12/2024.",
  "document_filename": "Banco de Chile Crédito Consumo - Informe Crédito.pdf"
}
```

**2. CAR - Ripley — Tarjeta Mastercard**
```json
{
  "bank": "CAR - Ripley",
  "product_type": "tarjeta_credito",
  "institucion_cmf": "CAR - Ripley",
  "delinquency_start_date": "2024-08-25",
  "delinquency_days": 100,
  "total_credito_clp": 1218565,
  "new_classification": "obligaciones_260",
  "reason": "EC Agosto 2024: PAGAR HASTA 25/08/2024. 4 ECs consecutivos sin pago (Ago-Nov, VCTO_2508→2511). Monto mínimo = monto total en todos los períodos. Al 03/12/2024 = 100 días de mora.",
  "document_filename": "RIPLEY AGOSTO.pdf"
}
```

### `identified261Creditors` — Art. 261 detectado desde documentos

**1. Banco de Chile — Tarjeta Mastercard**
```json
{
  "bank": "Banco de Chile",
  "product_type": "tarjeta_credito",
  "institucion_cmf": "Banco de Chile",
  "total_credito_clp": 65864,
  "reason": "EC Octubre 2024 (22/10/2024): saldo total $65.864. Cargo automático 15/11/2024 liquidó mora vencida ($14.210). Deuda vigente sin mora ≥91d continuada. Categoría portal: 1.",
  "document_filename": "Banco de Chile Tarjeta Mastercard EC Octubre 2024.pdf"
}
```

---

## Resultado simulado del Orchestrator (API Key #2)

### `documentMapping` — por institución

```json
[
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
]
```

> Nota: Hay dos entradas para "Banco de Chile" — la primera corresponde al Consumo (Art. 260,
> tipo 12) y la segunda a la Tarjeta Mastercard (Art. 261, tipo 1). El script los construye
> como `mappedDocs` directamente usando `storage_path` para evitar ambigüedad de nombre.

### `mappedDocs` — lista final para Playwright (`AcreditacionDoc[]`)

Construidos directamente con `storage_path` reales. Orden de adjunto en portal:

```json
[
  {
    "comment": "BCI Consumo — Art. 260 — MONTO",
    "institucion_cmf": "Banco de Chile",
    "tipo_documento": 22,
    "storage_path": "patricio_martini/banco_de_chile_consumo_report.pdf",
    "local_path": "outputs/acreditaciones_tmp/banco_de_chile_consumo_report.pdf"
  },
  {
    "comment": "BCI Consumo — Art. 260 — VENCIMIENTO (mismo archivo, tipo 24)",
    "institucion_cmf": "Banco de Chile",
    "tipo_documento": 23,
    "storage_path": "patricio_martini/banco_de_chile_consumo_report.pdf",
    "local_path": "outputs/acreditaciones_tmp/banco_de_chile_consumo_report.pdf"
  },
  {
    "comment": "Ripley — Art. 260 — VENCIMIENTO (primer mes impago 25/08/2024)",
    "institucion_cmf": "CAR - Ripley",
    "tipo_documento": 23,
    "storage_path": "patricio_martini/ripley_estado_cuenta_agosto_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/ripley_estado_cuenta_agosto_2024.pdf"
  },
  {
    "comment": "Ripley — Art. 260 — VENCIMIENTO cadena (sept)",
    "institucion_cmf": "CAR - Ripley",
    "tipo_documento": 23,
    "storage_path": "patricio_martini/ripley_estado_cuenta_septiembre_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/ripley_estado_cuenta_septiembre_2024.pdf"
  },
  {
    "comment": "Ripley — Art. 260 — VENCIMIENTO cadena (oct)",
    "institucion_cmf": "CAR - Ripley",
    "tipo_documento": 23,
    "storage_path": "patricio_martini/ripley_estado_cuenta_octubre_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/ripley_estado_cuenta_octubre_2024.pdf"
  },
  {
    "comment": "Ripley — Art. 260 — MONTO (saldo más reciente $1.218.565 al 10/11/2024)",
    "institucion_cmf": "CAR - Ripley",
    "tipo_documento": 22,
    "storage_path": "patricio_martini/ripley_estado_cuenta_noviembre_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/ripley_estado_cuenta_noviembre_2024.pdf"
  },
  {
    "comment": "BdChile Tarjeta — Art. 261 — MONTO (saldo $65.864 al 22/10/2024)",
    "institucion_cmf": "Banco de Chile",
    "tipo_documento": 22,
    "storage_path": "patricio_martini/banco_de_chile_tarjeta_octubre_2024.pdf",
    "local_path": "outputs/acreditaciones_tmp/banco_de_chile_tarjeta_octubre_2024.pdf"
  }
]
```

---

## Resumen de clasificación para `fillStep3`

| Institución | Art. | Cat. portal | Monto a ingresar | Fecha cuota impaga | Acredita |
|---|---|---|---|---|---|
| Banco de Chile (consumo) | 260 | 12 | $48.236.275 | 03/09/2024 | monto + vencimiento |
| CAR - Ripley (tarjeta) | 260 | 1 | $1.218.565 | 25/08/2024 | monto + vencimiento |
| Banco de Chile (tarjeta) | 261 | 1 | $65.864 | — | solo monto |

---

## Valores verificados en PDFs

| Documento | Campo verificado | Valor en PDF |
|---|---|---|
| Informe Crédito BCI | Saldo del Crédito | 48.236.275 ✅ |
| Informe Crédito BCI | Cuotas Vencidas no Pagadas | 3 ✅ |
| Informe Crédito BCI | Fecha Próximo Pago | 03/12/2024 ✅ |
| Informe Crédito BCI | Cuotas Pagadas | 3 ✅ |
| RIPLEY AGOSTO | Vencimiento (PAGAR HASTA) | 25/AGO/2024 ✅ |
| RIPLEY AGOSTO | Código vencimiento | VCTO_2508 ✅ |
| RIPLEY SEPTIEMBRE | Código vencimiento | VCTO_2509 ✅ |
| RIPLEY OCTUBRE | Código vencimiento | VCTO_2510 ✅ |
| RIPLEY NOVIEMBRE | Monto Total Facturado | 1.218.565 ✅ |
| RIPLEY NOVIEMBRE | Monto Mínimo = Total | 1.218.565 ✅ (100% vencido) |
| RIPLEY NOVIEMBRE | Código vencimiento | VCTO_2511 ✅ |
| EC BdChile Tarjeta | Monto Total Facturado | 65.864 ✅ |
| EC BdChile Tarjeta | Fecha EC | 22/10/2024 ✅ |
| EC BdChile Tarjeta | Cupo total / utilizado | $50.000 / $65.864 (sobre límite por cargos) |
