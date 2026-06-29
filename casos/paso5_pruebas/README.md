# Pruebas del Paso 5 (Ingresos) — lote `casos-paso5`

Pruebas del pipeline del Paso 5 contra 5 casos reales (`~/Desktop/casos-paso5`). **No es
producción** (vive en `casos/`); la lógica de producción está en `src/utils/income_extractor.ts`,
`src/agents/ingresos_agent.ts`, `src/automation/step5_ingresos.ts`.

## Archivos
- **`PLAN.md`** — plan de pruebas, matriz de casos y valores esperados (verdad-terreno del analista).
- **`fixtures.ts`** — HECHOS hardcodeados (lo que Claude extraería de cada documento) + el resultado
  esperado por caso. Cifras verificadas contra los PDFs/imágenes del lote.
- **`unit_tests.ts`** — **batería unitaria** (76 casos: parser de fechas, clasificación de descuentos,
  promedio/Fix1, dedup, honorarios, subsidio, multi-empleador, anti-error, **fuzz 1000×**). Blinda la
  capa determinista para prod. Sin API. Ver `REVISION_Y_PLAN.md` (revisión + criterios "bulletproof").
- **`run_deterministic.ts`** — **Fase 1**: corre `computeIncomes` (capa determinista) sobre los
  fixtures y compara con lo esperado. **Sin API, sin portal, sin Supabase.**
- **`case_files.ts`** — rutas REALES de los documentos de ingreso de cada caso (para la Fase 2).
- **`run_native.ts`** — **Fase 2**: lee los documentos reales con Claude (`extractIncomeFactsNative`,
  una llamada por documento) y corre la MISMA `computeIncomes`, comparando contra lo esperado.
  **Gasta créditos de API.** Vuelca los hechos extraídos a `$TMPDIR/paso5_native/<caso>.json`.

## Fases
1. **Determinista (esta carpeta, `run_deterministic.ts`)** — valida que la ESTRUCTURA se calcula bien
   (líquido, promedio 3 meses, Fix1 de orden, multi-empleador, descuentos legal/voluntario/ambiguo,
   subsidio de licencia médica). ✅ **5/5 OK** (2026-06-29).
2. **Lectura nativa por Claude (pendiente)** — reemplazar los fixtures por `extractIncomeFactsNative`
   leyendo los PDFs/imágenes reales del lote, y verificar que Claude extrae los mismos hechos
   (líquidos, descuentos, períodos, evidence). Acerca la prueba a producción. Gasta créditos de API.

## Correr las pruebas deterministas (sin API)
```bash
# (en un worktree sin node_modules, enlazar desde el repo principal una vez)
[ -e node_modules ] || ln -s ../renegociacion/node_modules node_modules

# atajo: corre unit_tests + run_deterministic
npm test

# o por separado:
OPTS='{"module":"NodeNext","moduleResolution":"NodeNext"}'
TS_NODE_COMPILER_OPTIONS=$OPTS node_modules/.bin/ts-node --transpile-only casos/paso5_pruebas/unit_tests.ts
TS_NODE_COMPILER_OPTIONS=$OPTS node_modules/.bin/ts-node --transpile-only casos/paso5_pruebas/run_deterministic.ts
```
Exit 0 = todo OK.

## Correr la Fase 2 (con API — requiere ANTHROPIC_API_KEY en .env)
```bash
# un caso (recomendado para controlar el gasto):
npx ts-node --transpile-only -r dotenv/config casos/paso5_pruebas/run_native.ts "Jorge Romero"
# todos:
npx ts-node --transpile-only -r dotenv/config casos/paso5_pruebas/run_native.ts
```
Compara la lectura real de Claude (una llamada por documento) contra el esperado del analista.
Sugerencia de orden por costo: Jorge (2 docs) → Alejandro (4) → Alejandra (5) → Alex (7) →
María Elisa (13, incluye duplicados a propósito para probar el dedup).

## Qué valida cada caso (resumen)
| Caso | Estresa | Esperado |
|---|---|---|
| Jorge Romero | baseline, 0 voluntarios | Remuneración $2.162.230 |
| Alejandro Olguín | anticipos + seguro vida NO se suman (L10) | Remuneración $2.061.903 |
| Alejandra Romero | 4 liq → promedio 3 más recientes (Fix1); Caja Los Andes se suma | Remuneración $2.620.869 |
| Alex Llanquitruf | 2 empleadores → 2 ingresos que se suman (L9) | $2.234.126 + $440.525 |
| María Elisa Vargas | subsidio fragmentado + dedup + conflicto sueldo↔licencia (L11) | Remun. $2.535.867 + Lic.Médica $2.647.390 |

Las decisiones de criterio (sumar CCAF, normalizar anticipos, sueldo vs licencia) están marcadas en
`PLAN.md` y `lecciones/paso5-ingresos.md` como pendientes de verdad-terreno del abogado.
