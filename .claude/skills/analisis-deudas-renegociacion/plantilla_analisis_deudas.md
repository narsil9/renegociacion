# Plantilla de salida — `analisis_deudas.md`

Copia esta estructura y reemplaza los `[placeholders]`. Es el formato validado en los 6 casos cerrados. Guarda el resultado en `casos/<nombre>/analisis_deudas.md`.

---

```markdown
# Informe de Análisis de Deudas y Soporte de Acreditación — [Nombre Completo Cliente]

Este documento detalla el análisis de elegibilidad y la documentación de respaldo para la postulación al **Procedimiento Concursal de Renegociación de Persona Deudora** (Ley 20.720) ante la Superintendencia de Insolvencia y Reemprendimiento (**Superir**), correspondiente a la clienta/e **[Nombre]** (RUT **[RUT]**)[, integrando la auditoría del Informe de Deudas CMF emitido el [fecha]].

---

## I. Resumen Ejecutivo de Elegibilidad

Para iniciar una renegociación formal ante la Superir, la ley exige cumplir simultáneamente con el **triple requisito**:
1. **Multiproducto (Art. 260):** ≥ 2 deudas/productos distintos con mora ≥ 91 días.
2. **Monto Mínimo (Art. 260):** suma de `totalCredito` de esos productos ≥ 80 UF (~$3.253.000 CLP).
3. **Tributario:** sin boletas de honorarios (2ª cat.) ni giros comerciales con actividad (1ª cat.) en los últimos 24 meses.

### Tabla Resumen de los Productos Calificados (Artículo 260)

| Producto / Acreedor | Monto Declarado (Cupo/Total) | Vencimiento Cuota Impaga | Días de Mora (al [fecha]) | Acreditación | Estado |
| :--- | :---: | :---: | :---: | :--- | :---: |
| [Producto 1] | **$[monto] CLP** | **[DD/MM/YYYY]** | **[XX] días** | Monto + Vencimiento | **CUMPLE** ([archivos]) |
| [Producto 2] | **$[monto] CLP** | **[DD/MM/YYYY]** | **[XX] días** | Monto + Vencimiento | **CUMPLE** ([archivos]) |
| **TOTAL MORA ART. 260** | **$[suma] CLP** | — | — | **80 UF (~$3.253.000)** | **CUMPLE (~[XX] UF)** |

> **Diagnóstico de Elegibilidad:** [¿Califica o no? Fecha exacta en que cruza el umbral si aplica, justificación de reclasificaciones, confirmación tributaria.]

---

## II. Reconciliación: Informe CMF vs. Certificados de Deuda
*(Incluir cuando hay diferencias de monto o consolidaciones del CMF — Patrón A/B.)*

| Acreedor | Tipo CMF | Saldo CMF | Saldo Certificado | Diferencia | Justificación | Artículo |
| :--- | :---: | :---: | :---: | :---: | :--- | :---: |
| [Acreedor] | [tipo] | $[cmf] | $[cert] | [±$] | [intereses / desfase / prepago / agrupación] | Art. [260/261] |

---

## III. Análisis Detallado de Acreditación por Producto (Art. 260)

### 1. [Producto] — [Acreedor] (Deuda Art. 260)
* **Número del Producto:** `[número]`
* **Monto de la Deuda (Saldo Total a Declarar):** **$[monto] CLP**
* **Fecha de Vencimiento de la Cuota más Antigua:** **[DD/MM/YYYY]**
* **Cálculo de Morosidad:** [detalle matemático paso a paso del conteo de días / reconstrucción de cuotas].
* **Idoneidad del Documento de Soporte:** [por qué los PDFs acreditan Monto y Vencimiento; si son tarjetas, los 4 EECC consecutivos + Aviso de Cobranza].

*(Repetir por cada producto Art. 260.)*

---

## IV. Análisis de Deudas del Artículo 261 (Otros Acreedores / Vigentes o Mora < 91d)

> Es obligación legal declarar **todos** los pasivos. Categoría 1 = tarjetas/líneas; Categoría 12 = consumo. Incluir acreedores NO-CMF (TGR, cajas, fintechs) que registren saldo deudor.

### 1. [Producto] — [Acreedor] (Art. 261 / Categoría [1|12][ / No-CMF])
* **Número de Cuenta:** `[número]`
* **Monto de la Deuda:** **$[monto] CLP**
* **Situación de Morosidad:** [por qué es 261].
* **Documento de Acreditación:** [certificado, tipo 22].

*(Repetir. Marcar los NO-CMF explícitamente.)*

---

## V. Auditoría de Bienes (Paso 2)
*(Inmuebles con CDV+HYG+avalúo y % de copropiedad; vehículos con padrón RVM y tasación; inversiones/ahorros; o acreditación de "sin bienes" con screenshots saldo $0. Anotar interdicciones.)*

## VI. Análisis de Ingresos (Paso 4)
*(Empleador, contrato, promedio líquido, descuentos por planilla que se suspenden, cotizaciones AFP, ajustes sector público.)*

---

## VII. Instrucciones Técnicas para el Ingreso en el Portal Superir
*(Por cada acreedor: monto a ingresar, fecha de cuota impaga, y qué archivos van en cada slot — Tipo 22/23/24.)*

---

## VIII. Mapeo de Documentos para `client_documents` (Sandbox)

| filename | storage_path | document_type | acreditacion_tipo | institucion_cmf | artículo |
|---|---|---|---|---|---|
| [archivo] | [ruta en bucket] | [22/23/24] | [monto/vencimiento/general/estado_cuenta] | [nombre canónico catálogo] | [260/261] |

---

## IX. Conclusión del Análisis
*(Viabilidad jurídica, acreditación cubierta, acciones críticas para el abogado.)*
```
