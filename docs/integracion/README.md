# docs/integracion/ — Conectar un dashboard a la automatización

**Empezá acá:**

| Documento | Qué es |
|---|---|
| ⭐ [`dashboard-externo.md`](./dashboard-externo.md) | **El contrato para conectar TU dashboard.** Qué tabla/columna de Supabase escribir, cómo subir documentos, cómo encolar un job y cómo leer el resultado. Es lo único que necesitás para integrar una UI nueva. |

**Referencia (integración específica con el dashboard del abogado, sobre prod `ton…`):**

| Documento | Qué es |
|---|---|
| [`contrato-conexion-ejecutar.md`](./contrato-conexion-ejecutar.md) | Propuesta del trigger "Ejecutar" + gate de precondiciones para el dashboard del supervisor. |
| [`mapa-fuentes-produccion.md`](./mapa-fuentes-produccion.md) | Mapa verificado de dónde vive cada dato/documento en `ton…` (tabla por tabla). |
| [`contrato-superir-mapeo-inputs.md`](./contrato-superir-mapeo-inputs.md) | Contrato de inputs original (qué necesita el robot → dónde vive en `ton…`). |

> Los tres de "Referencia" describen una integración concreta con un sistema externo preexistente
> (`ton…`, solo lectura). Si integrás un dashboard nuevo, seguí `dashboard-externo.md` y usalos
> solo como ejemplo.
