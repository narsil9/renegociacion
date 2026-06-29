# tools/paso3_validacion — Herramientas de validación del Paso 3 (Acreedores)

**Diagnóstico/dev, NO producción.** No mezclar con `src/` (automatización de producción).
Verifican la calidad de extracción del Centinela contra la verdad-terreno (lo que declaró la abogada).

| Script | Qué hace |
|---|---|
| `scorecard.ts` | Corre el Centinela N× por caso y compara el conteo de deudas declaradas vs la abogada (por institución), detecta faltantes/duplicados y mide estabilidad. `BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config tools/paso3_validacion/scorecard.ts [N] [caso]` |
| `test_reglas_deterministas.ts` | Tests unitarios (sin API) de las reglas duras del parser CMF + utilidades #2/#3/#4/#6. |
| `test_e2e_read_issues.ts` | E2E: `runCentinelaAgent` real → `claudeReadIssues` → alerta del worker. |

Artefactos (documentos descargados, lecturas-oráculo, comparaciones) van al **scratchpad de la sesión**, NO al repo.
