# Pruebas del Paso 5 (Ingresos) — lotes `casos-paso5` y `renegociacion_docs`

Pruebas del pipeline del Paso 5 contra **dos lotes** de casos reales: `~/Desktop/casos-paso5` (5 casos)
y `~/Desktop/renegociacion_docs` (11 clientes con ingresos). **No es producción** (vive en `casos/`); la
lógica de producción está en `src/utils/income_extractor.ts`, `src/agents/ingresos_agent.ts`,
`src/automation/step5_ingresos.ts`.

## Archivos
- **`PLAN.md`** — plan de pruebas, matriz de casos y valores esperados (verdad-terreno del analista).
- **`fixtures.ts`** — HECHOS hardcodeados (lo que Claude extraería de cada documento) + el resultado
  esperado por caso. Cifras verificadas contra los PDFs/imágenes del lote.
- **`unit_tests.ts`** — **batería unitaria** (106 casos: parser de fechas, clasificación de descuentos,
  promedio/Fix1, dedup, honorarios, subsidio, multi-empleador, anti-error, **fuzz 1000×**, + **B10**:
  agregación intra-mes L15, mes parcial L16, APV-sobre-AFP L17, coexistencia honorarios↔sueldo L18).
  Blinda la capa determinista para prod. Sin API. Ver `REVISION_Y_PLAN.md`.
- **`run_deterministic.ts`** — **Fase 1** (lote `casos-paso5`): corre `computeIncomes` sobre los
  fixtures y compara con lo esperado. **Sin API, sin portal, sin Supabase.**
- **`fixtures_renegociacion_docs.ts` + `run_renegociacion_docs.ts`** — **Fase 1** del lote
  `renegociacion_docs` (11 clientes): hechos extraídos actuando como el LLM sobre los PDF reales +
  esperado del analista. Casos más adversarios (multi-pago/mes, licencia parcial, honorarios+sueldo,
  arriendo, "Alcance Líquido" vs "Líquido a pagar", APV, Coopeuch, filename engañoso, cert encriptado).
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

## Qué valida el lote `renegociacion_docs` (11 clientes, `run_renegociacion_docs.ts`)
| Caso | Estresa | Esperado |
|---|---|---|
| Claudia Silva | "Alc. Líquido" vs "Liq. a Pago" (L1); Ahorro Caja Los Andes se suma | Remun. $1.496.676 |
| Susana Matamala | 3 pagos en Sept se SUMAN (L15); cert encriptado | Remun. $1.472.881 |
| Nicolás Bascuñán | filename engañoso "Julio (3)"=Agosto → dedup; Caja Los Andes | Remun. $1.899.575 |
| William Montero | "Alcance Líquido" = neto final (L19); Préstamos CCAF | Remun. $2.353.258 |
| Yoselyn Reyes | 3 meses en 1 PDF; PRESTAMO Coopeuch+Caja se suman (L20) | Remun. $1.445.275 |
| María Paz Bravo | sueldo + arriendo; "COOPEUCH" a secas ambiguo (L20) | Remun. $1.617.973 + Arriendo $450.000 |
| Betzy Lee | Oct parcial (licencia 17 días) excluido (L16) | Remun. $1.723.507 |
| Alejandra Espinoza | anticipos ambiguos | Remun. $914.966 |
| Irene Arévalo | sueldo + honorarios concurrentes (L18); coexistencia | Remun. $2.448.378 + Honor. $517.500 |
| Jaime Cartes | honorarios→sueldo secuencial; Oct parcial (L16); APVI (L17); Hoja Resumen NO-ingreso | Remun. $1.301.969 + Honor. $213.399 |
| Noelia Lorca | sueldo + honorarios concurrentes (L18) | Remun. $1.744.855 + Honor. $297.271 |

Las decisiones de criterio (sumar CCAF/Coopeuch, normalizar anticipos, sueldo vs licencia, concurrencia
honorarios↔sueldo, bruto vs líquido) están marcadas en `PLAN.md` y `lecciones/paso5-ingresos.md` como
pendientes de verdad-terreno del abogado. La parte **estructural** (cálculo, agregación, exclusión,
clasificación) es **determinista** y está blindada con tests.
