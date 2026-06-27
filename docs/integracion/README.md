# docs/integracion/ — Convergencia con el dashboard del supervisor

Documentos de la **integración** entre nuestra automatización Superir (ejecutor, aguas abajo)
y el dashboard del supervisor `rp_renegociaciones-auth-admin` (recolección/clasificación, aguas
arriba, prod Supabase `ton…`). Visión general en `CLAUDE.md` → "🔗 Integración futura".

| Documento | Qué es | Cuándo leerlo |
|---|---|---|
| [`mapa-fuentes-produccion.md`](./mapa-fuentes-produccion.md) | **Mapa verificado** de dónde vive cada dato/documento en la DB de producción `ton…` (tabla por tabla, columnas reales, cobertura, buckets). | **Siempre que haya que leer algo de `ton…`** — andá al "Índice rápido" y vas directo a la tabla correcta. |
| [`contrato-superir-mapeo-inputs.md`](./contrato-superir-mapeo-inputs.md) | El contrato de integración original (su equipo): qué inputs necesita nuestro robot → dónde viven en `ton…`. | Contexto / origen del mapa. |

**Regla de oro:** sobre `ton…` **solo lectura** (SELECT/GET), nunca escritura. Ver CLAUDE.md.

**Re-verificar el mapa:** `npx ts-node --transpile-only -r dotenv/config tools/audit_prod_sources.ts`
