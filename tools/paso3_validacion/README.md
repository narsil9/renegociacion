# tools/paso3_validacion — Herramientas de validación del Paso 3 (Acreedores)

**Diagnóstico/dev, NO producción.** No mezclar con `src/` (automatización de producción).
Verifican la calidad de extracción del Centinela y blindan la capa DETERMINISTA (la que decide la
estructura 260/261, multiproducto, NO-CMF, dedup) contra la verdad-terreno (lo que declaró la abogada).

## Tier 1 — DETERMINISTA (sin API, sin Supabase, sin Playwright)

Corre en milisegundos, no gasta créditos, hermético. **Es la red que debe pasar siempre.**

```bash
npx ts-node --transpile-only tools/paso3_validacion/run_all.ts
```

`run_all.ts` corre toda la batería y sale con **exit ≠ 0 si algo falla** (botón verde para cada cambio
y antes de cualquier commit). Incluye:

| Script | Qué valida |
|---|---|
| `test_reglas_deterministas.ts` | Invariantes del parser CMF + utilidades puras: moneda (#3), nº operación (#2), docs que no acreditan (#4), top-N catálogo (#6), `canonicalInstitutionKey`, `normalizeRut`/`extractRutsFromText`/`findCatalogEntryByRut`, `matchAcreedor`. |
| `test_assembler.ts` | El ensamblador (`assembleRawFromDocFacts`) reproduce la estructura de la abogada en los **3 casos reales** (Cristian 10, Miguel 13, Néctor 12) dada la extracción oráculo. |
| `test_assembler_edge.ts` | Cada **rama** del ensamblador aislada: multiproducto, UF→CLP, NO-CMF 260/261, overflow→id261, gate 260 vs 261, CMF que parte 1 crédito en 2 filas, docs sin productos, tipo por rótulo. |
| `test_backstops_golden.ts` | **Golden** de `applyDeterministicBackstops`: reconciliación additional→id261, completitud (`extractCertLineItems`), gate 260→261 + rescate-chat, y la validación anti-error (auto-cita, RUT, confianza, moneda, dedup op → `claudeReadIssues`). |
| `test_oracle_injection.ts` | Inyecta el oráculo y verifica que la agrupación/dedup declara EXACTO lo de la abogada (sin duplicados/faltantes). |

Verdad-terreno y oráculo: `oracle_truth.ts` (extracción correcta por cliente, leída a mano y corroborada).

## Tier 2 — EN VIVO con API (validación del LLM; requiere cuota Anthropic)

| Script | Qué hace |
|---|---|
| `scorecard.ts` | Corre el Centinela N× por caso, compara el conteo vs la abogada y mide **estabilidad** (objetivo: 10/13/12 estable). `BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config tools/paso3_validacion/scorecard.ts [N] [caso]` |
| `test_e2e_read_issues.ts` | E2E: `runCentinelaAgent` real → `claudeReadIssues` → alerta del worker. |
| `debug_perdoc.ts` | Debug del camino por-documento (`CENTINELA_PER_DOC=true`): qué extrajo cada doc y qué ensambló TS. |
| `diag_routing.ts` | Diagnóstico (sin API) de la decisión nativo-vs-texto (`pdfNativeReason`) por documento. |

Artefactos (documentos descargados, lecturas-oráculo, comparaciones) van al **scratchpad de la sesión**, NO al repo.
