# Reporte — Prueba del flujo Paso 3 sobre 30 casos (Constanza Mulchi) · 2026-07-01

## Qué se probó
Actué como el **LLM lector nativo (Centinela)** de los 30 casos → **30 fixtures** (`reneg_fixtures/*.json`:
CMF + DocFacts + declaración esperada). Sobre cada uno corrí la **capa determinista REAL de producción**
(`assembleRawFromDocFacts` → `applyDeterministicBackstops`) + una **comparación fila-a-fila** nueva
(`deep_compare.ts`) que verifica **artículo (260/261) + monto + fuente (CMF/NO-CMF)** — lo que el harness de
conteo no chequeaba.

⚠️ **Sin verdad-terreno del abogado**: el "esperado" lo derivé yo. Las discrepancias señalan **dónde diverge
la estructura**, no un conteo de aciertos. Lo robusto e independiente: los **bugs de TS** (golden tests) y las
**reglas de lectura** ancladas al texto del PDF.

## Errores encontrados y estado

### Bugs de TS
- **[CORREGIDO] Overflow multiproducto con `fecha_mora` → forzado a Art.261** (L32). El ensamblador mandaba
  el producto sobrante (más productos que filas CMF) siempre a 261, aunque tuviera vencimiento acreditado.
  **Fix** (`sentinel_per_doc.ts`): clasifica el overflow por su propia `fecha_mora` (≥91d → override 260 con
  fecha; si no → 261). Golden nuevo en `test_assembler_edge.ts`. Impacto: ART 62→36, FUENTE 81→49; batería 6/6.
- **[EVALUADO Y REVERTIDO] Filtro de trivialidad por monto <1 UF** (L30 revisada). Rompió el golden **TGR
  $18.000** (deuda fiscal real < 1 UF). Un monto chico ≠ trivial → viola G2. Lo "trivial" es semántico (del
  lector), no un umbral de TS. TS sigue descartando solo `monto ≤ 0`.

### Errores de LECTURA (del LLM) — corregidos en el prompt + re-lectura
- **[CORREGIDO en prompt + 5 re-lecturas]** `perDocSystemPrompt` reforzado (L27/L29): (a) `doc_facts` = SOLO
  lo declarable; (b) tarjeta = UN producto = SUMA de sub-líneas (L28); (c) un producto por operación multi-doc;
  (d) **nunca** usar la cifra 90+d del CMF como monto de un producto; (e) no emitir componentes de cobranza
  ("VARIOS DEUDORES", costas), remanentes/comisiones < 1 UF, ni cuentas $0.
- **Re-leídos con el prompt corregido** (validación del fix): viviana (tarjeta Santander 5 líneas → 1 producto
  $14.825.960 → **PORTAL-OK**), patricio (op 01401 ×3 + fantasma =90+d CMF → 1 producto), paulina (VARIOS
  DEUDOR $60k/$20k + remanente removidos), rodrigo (productos BancoEstado superados por CMF nuevo removidos),
  matias_garrido (Inversiones LP $5.116 <1 UF removido).

### Tensión de diseño (NO bug) — requiere decisión del abogado (L31)
La mayoría del residual (ART 36 + FUENTE 49) es **multiproducto**: el CMF consolida un banco en 1 fila con un
solo `overdue90`. El flujo (post-fix) clasifica cada producto por su **propia `fecha_mora`** (≥91→260) y
declara los extra vía NO-CMF (routing por diseño para crear la fila en el portal, **no material** — L33).
- **FUENTE (CMF vs NO-CMF)**: NO material (mismo art+monto, misma sección del portal).
- **ART boundary**: un producto con señal de mora parcial puede ir 260 o 261 según se exija vencimiento
  **documentado por producto**. TS hoy: `fecha_mora`≥91 documentada → 260; si no → 261 (regla del abogado).
  **Pregunta abierta:** un banco 90+d multiproducto, ¿va TODO a 260 o solo la porción con mora acreditada?

## Scorecard final (`deep_compare.ts`, 30+5 fixtures)
- **6/35 PORTAL-OK** (0 discrepancias materiales); resto con residual de **frontera ART (L31)** + **juicio
  holístico del lector vs `doc_facts`** (L34) — sin verdad-terreno no son "errores" cerrables.
- Materiales: ART 36 (frontera 260/261), MONTO 13, HUÉRFANAS 27. No-material FUENTE 49 (por diseño).
- Sin **drops de acreedores** ni **inyecciones fantasma** nuevas tras los fixes.

## Estado de la suite
- **Batería determinista `run_all.ts`: 6/6 verde**, **sin regresiones** en los 10 casos-guía. `build:prod` limpio.
- Arnés nuevo: `deep_compare.ts` (material vs no-material) + `SUBAGENT_READING_BRIEF.md` (lector).
- Lecciones nuevas: **L27–L34** en `lecciones/paso3-acreedores.md`.

## Pendiente (abogado / próxima sesión)
1. **Definir política 260/261 multiproducto** (L31) — habilita cerrar la frontera ART.
2. Validación EN VIVO del Centinela (scorecard.ts) cuando haya cuota API — confirmar que el prompt reforzado
   produce estos `doc_facts` correctos sin subagente.
