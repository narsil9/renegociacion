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
| `test_renegociacion_docs.ts` | **13 casos reales** de `renegociacion_docs/` (fixtures congelados en `reneg_fixtures/`). Claude leyó nativo los PDF del Paso 3 de cada cliente → CMF + DocFacts + declaración esperada (verdad-terreno: `analisis_deudas.md` donde existe, o derivada). Corre el ensamblador + backstops REALES y compara la declaración. **Guard de regresión:** falla (exit≠0) solo si un caso-guía determinista deja de pasar; los ⚠️ reading-limited quedan informativos. |

Verdad-terreno y oráculo: `oracle_truth.ts` (extracción correcta por cliente, leída a mano y corroborada).
Fixtures de los 13 casos: `reneg_fixtures/*.json` (un JSON por cliente: `cmf_rows`, `doc_facts`, `expected_declaration`).

> **Resultado de la tanda de los 13 (2026-06-29):** **10/13** reproducen el SET ESPERADO (6 directo + 4 tras
> meter las reglas de lectura L23–L26 en el prompt). ⚠️ **NO hay verdad-terreno del abogado** (ni screenshots
> del portal ni registro de lo que cargó). Los `analisis_deudas.md` (betzy/nicolas/susana) fueron **generados por
> agentes de IA en sesiones previas, NO por el abogado**; y el "esperado" del resto lo derivé del CMF + carpetas +
> lectura. Por eso el "10/13" es **consistencia interna (IA contra IA)**, NO concordancia con el abogado. Lo
> válido sin verdad-terreno: (a) los **bugs de TS** = errores de lógica/aritmética (doble conteo, $0, dedup),
> verificables por golden tests; (b) las **reglas de lectura L23–L26**, ancladas en el TEXTO del PDF. Los 3 ⚠️ restantes NO son
> ni lectura ni TS: **betzy** (faltan los certificados formales en la carpeta), **claudia/yoselyn** (el robot
> declara un producto real que el abogado omitió → más completo). De esta tanda salieron **5 fixes deterministas
> generales** (drop $0, dedup por operación, gate multiproducto sin total-CMF, aliases del nombre corto del CMF
> + CAT/Cencosud + " / ") **+ 4 reglas de lectura** en `perDocSystemPrompt` (L23–L26 en `lecciones/paso3-acreedores.md`).
> Los fixtures `reneg_fixtures/` de los 4 casos de lectura reflejan la extracción CORRECTA (lo que el Centinela
> debe producir con esas reglas) — el arnés prueba que con lectura correcta la capa determinista declara exacto.

## Tier 2 — EN VIVO con API (validación del LLM; requiere cuota Anthropic)

| Script | Qué hace |
|---|---|
| `scorecard.ts` | Corre el Centinela N× por caso, compara el conteo vs la abogada y mide **estabilidad** (objetivo: 10/13/12 estable). `BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config tools/paso3_validacion/scorecard.ts [N] [caso]` |
| `test_e2e_read_issues.ts` | E2E: `runCentinelaAgent` real → `claudeReadIssues` → alerta del worker. |
| `debug_perdoc.ts` | Debug del camino por-documento (`CENTINELA_PER_DOC=true`): qué extrajo cada doc y qué ensambló TS. |
| `diag_routing.ts` | Diagnóstico (sin API) de la decisión nativo-vs-texto (`pdfNativeReason`) por documento. |

Artefactos (documentos descargados, lecturas-oráculo, comparaciones) van al **scratchpad de la sesión**, NO al repo.
