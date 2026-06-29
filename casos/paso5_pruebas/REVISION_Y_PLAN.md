# Revisión de la capa determinista del Paso 5 + plan para dejarla BULLETPROOF

> Objetivo: que `src/utils/income_extractor.ts` sea **digno de producción**: salida correcta y
> predecible ante documentos reales messy, sin perder datos en silencio. Revisión del 2026-06-29.
> El LLM extrae hechos (puede equivocarse/variar); **esta capa es el blindaje** y debe ser sólida como roca.

---

## A. Revisión del código

### Fortalezas (mantener)
- Arquitectura LLM-hechos / TS-estructura clara. Funciones puras y testeables (`computeIncomes`,
  `computeDeclaredIncomeForDoc`, `classifyDeduction`, `parsePeriodKey`, `validateIncomeReads`).
- Modos por tipo (`liquido`/`boletas`/`subsidio`/`directo`) bien separados.
- Multi-fuente (L9), ordenamiento por fecha (Fix1), red anti-error (cita+confianza), conflicto
  sueldo↔licencia, alerta UF: todos correctos en el camino feliz (validados 5/5 en Fase 1).

### Hallazgos (priorizados) — cada uno tiene su prueba en la sección B

| # | Sev | Hallazgo | Dónde |
|---|-----|----------|-------|
| H1 | **P1** | **No deduplica liquidaciones repetidas.** Subsidio sí dedup; el camino `liquido` NO. Un PDF de liquidación subido 2× duplica el mes → el promedio de "últimos 3" toma Mayo,Mayo,Abril y descarta Marzo → monto erróneo. | `computeIncomes` merge (641) + camino `liquido` (530-578) |
| H2 | **P1** | **Pérdida silenciosa en subsidio.** `sinMes` se calcula pero NUNCA se usa ni se alerta (470-473): pagos con `period_label` no parseable se descartan sin avisar. Viola "nunca omitir en silencio". | `computeSubsidioIncome` 470-475 |
| H3 | **P2** | **Boletas sin fecha parseable** (`anchor==null`): divide igual por 12 SIN alertar (la alerta de "<window" sólo corre con anchor!=null, 385). Under-declara en silencio. | `computeBoletasIncome` 358-393 |
| H4 | **P2** | **`parsePeriodKey` frágil:** (a) no parsea fechas verbosas "1 de diciembre de 2025"; (b) falso positivo: "abril 03" → 200003 (año 2000). El orden/ventana dependen de esto. | `parsePeriodKey` 212-224 |
| H5 | **P2** | **Sin guardas de finitud/negativos.** Montos `NaN`/`Infinity`/negativos no se filtran en el cálculo (se confía en el agente). Un negativo se excluye del promedio sin alerta explícita. | varios cálculos |
| H6 | **P3** | **`monto_mensual_declarado` se pierde** si un grupo `directo` tiene 2 docs con monto: el merge toma solo el primero (642-643). | `computeIncomes` 642 |
| H7 | **P3** | **Dedup de subsidio puede borrar pagos legítimos** con mismo mes+monto idéntico (coincidencia). | `computeSubsidioIncome` 457-464 |
| H8 | **P3** | **`validateIncomeReads` ignora docs `directo`** (sin períodos): aporte/retiro no tienen verificación de cita. | `validateIncomeReads` 303 |
| H9 | **P3** | **UF sólo se detecta vía `period.moneda`**; un `monto_mensual_declarado` en UF (aporte/retiro) no se alerta. | `computeIncomes` 615-622 |

**Fixes recomendados antes de prod:** H1 y H2 (P1) sí o sí; H3, H4, H5 (P2) recomendados. P3 = backlog.
- H1: deduplicar períodos por `(period_label + liquido_a_pagar)` también en el camino `liquido`
  (mismo criterio que subsidio), dentro de cada grupo (categoría+fuente).
- H2: alertar (y no descartar en silencio) los pagos de subsidio sin mes parseable.
- H3: alertar también cuando `anchor==null` (boletas sin fecha).
- H4: endurecer `parsePeriodKey` (fechas verbosas; evitar el falso positivo de 2 dígitos pegado a día).
- H5: filtrar `!isFinite` y negativos con alerta explícita.

---

## B. Plan de pruebas (unit, deterministas, sin API)

Implementar `casos/paso5_pruebas/unit_tests.ts` (assert puro, estilo `run_deterministic.ts`, sin
framework). Cada caso = entrada mínima → salida esperada. **Meta: cada hallazgo H# tiene ≥1 prueba que
falla hoy y pasa tras el fix.** Agrupado por función.

### B1. `parsePeriodKey` (parser de fechas)
- "Mayo 2025"/"mayo-2025"/"MAYO 2025" → 202505 · "2025-05"/"2025/5"/"2025.05" → 202505 ·
  "05/2025"/"5-2025" → 202505 · "abr-25"/"abr 25" → 202504 · "202505" sólo dígitos → (definir: hoy null).
- Verbosa "1 de diciembre de 2025" → 202512 **(H4, falla hoy)**.
- Día pegado "31.05.2026" → 202605 (DD.MM.YYYY) · "abril 03" → **NO** 200003 **(H4, falla hoy)**.
- Basura: "Remuneración", "", undefined, "mes 13 2025", "1999-05" (fuera de rango) → null.
- Idempotencia: mismo label → misma clave siempre.

### B2. `classifyDeduction`
- Legales: "Cotización AFP", "Salud ISAPRE Banmédica", "Seguro de Cesantía", "Impuesto Único", "SIS" → legal.
- Voluntarios: "Crédito Personal Caja Los Andes", "Descto. Ptmo. CCAF Los Andes", "APV", "Ahorro Voluntario" → voluntary.
- Ambiguos: "Anticipos Varios", "Cuota Sindicato", "Seguro Vida", "Aporte 2% Bienestar", "Cta. Cte. Clínica" → ambiguous.
- Prioridad legal sobre voluntario (un label con ambas keywords → legal). Mayúsc/acentos indiferentes.
- Adversarial: label vacío, sólo símbolos, muy largo → ambiguous sin crashear.

### B3. `periodNetIncome` / camino `liquido`
- Sin voluntarios: monto = líquido. · Con 1 voluntario: líquido + voluntario. · Con ambiguo: NO suma + alerta.
- 4 períodos, ventana 3 → usa los 3 más recientes (Fix1); reporta detalle correcto.
- **Duplicado exacto de un mes → NO duplica el promedio (H1, falla hoy).**
- 2 períodos con ventana 3 → divisor 2 + alerta "se esperaban 3". · 1 período → ese monto.
- Período con `liquido_a_pagar=null` entre válidos → se excluye, divisor baja, no rompe.
- Período negativo / `NaN` → excluido + alerta **(H5, falla hoy)**.
- Orden de entrada aleatorio (shuffle) → mismo resultado (determinismo).

### B4. `computeBoletasIncome` (honorarios)
- N boletas en M meses dentro de ventana 12 → Σbruto/12 (divisor fijo). · Declara BRUTO + alerta bruto/líquido.
- Boletas fuera de ventana (>12m del ancla) → ignoradas + alerta "fuera de ventana".
- **Todas sin fecha (anchor null) → alerta (H3, falla hoy)**, no /12 silencioso.
- 0 boletas legibles → monto 0 + alerta.
- monto_bruto+retencion presentes → líquido equivalente correcto en la alerta.

### B5. `computeSubsidioIncome` (licencia médica)
- Pagos fragmentados en 3 meses → declara el mes más completo + alerta de reconstrucción.
- Duplicado exacto (mismo mes+monto) → deduplicado + alerta de duplicado.
- **Pago con `period_label` no parseable → alertado, no descartado en silencio (H2, falla hoy).**
- Todos sin mes parseable → promedio simple + alerta. · 1 solo pago → ese monto.

### B6. `computeIncomes` (orquestación)
- **Multi-empleador** (2 source_key, misma categoría) → 2 ingresos (no fusiona). · Mismo empleador en 3 docs → 1 ingreso.
- **Conflicto** Remuneración + Licencia Médica → alerta de reemplazo.
- Sin cert cotizaciones → alerta. · Cert sin RUT pagador → alerta. · UF en un período → alerta UF.
- `docs=[]` → incomes vacío + alerta "ningún ingreso". · Sólo cert cotizaciones → 0 ingresos + cot ok.
- **`source_key` ausente** en todos → 1 grupo por categoría (compat. hacia atrás).
- Entrada adversarial: `docs` con period vacío, montos 0, categoría desconocida → no crashea, alerta.

### B7. `validateIncomeReads` (anti-error)
- Cita respalda monto → 0 issues. · Cita sin el monto → `monto_sin_respaldo_en_cita`. · Sin evidence → `sin_evidencia`.
- confidence < 0.70 → `baja_confianza`. · Monto con separadores en cita ("$2.161.887") → respaldado.
- (tras H8) doc `directo` con monto declarado → también verificable o explícitamente fuera de alcance.

### B8. Propiedad / fuzz (determinismo y robustez)
- **Idempotencia:** `computeIncomes(d) === computeIncomes(d)` (mismas cifras siempre).
- **Invariancia al orden:** barajar `docs` y `periods` no cambia los montos.
- **Nunca crashea:** generador aleatorio de docs (campos faltantes, nulls, strings raros, montos extremos
  0/negativos/1e12/NaN) × 1000 → nunca lanza excepción; todo monto resultante es finito y ≥ 0.
- **Nunca $0 en silencio:** si hay algún período con monto > 0, o el ingreso sale > 0 o hay una alerta.

### B9. Regresión (verdad-terreno del analista)
- Los **5 casos reales** (`run_deterministic.ts`) siguen 5/5 tras cada fix. Es el ancla anti-regresión.

### B10. Revisión adversaria independiente
- Un revisor (agente/persona) que NO escribió el código intenta romper cada función (entradas límite,
  supuestos ocultos). Lo que encuentre → nuevas pruebas en B1–B8. (Quien escribe el código tiene puntos ciegos.)

---

## C. Definición de "bulletproof" (criterios de hecho)
1. **0 crashes** ante cualquier entrada (B8 fuzz 1000×).
2. **Determinismo total**: misma entrada → misma salida; orden de docs/períodos irrelevante (B8).
3. **Sin pérdida silenciosa**: todo dato > 0 ignorado/no usado genera una alerta (H1/H2/H3 cerrados).
4. **Todos los H1–H5 con prueba que falla pre-fix y pasa post-fix.**
5. **Regresión 5/5** intacta (B9).
6. **Cobertura**: cada función exportada con casos normal + límite + adversarial (B1–B7).
7. Revisión adversaria independiente sin hallazgos nuevos sin prueba (B10).

## Estado final (2026-06-29) — BULLETPROOF alcanzado
**91/91 unit (incl. fuzz 1000×) + 5/5 regresión + `tsc build:prod` limpio. `npm test` corre todo.**

Cerrado (con prueba pre/post-fix):
- **H1–H5** (revisión propia): dedup liquidaciones, subsidio sin mes alertado, boletas sin fecha alertada,
  `parsePeriodKey` (verbosa + acote 20–40), guardas de finitud/negativos.
- **Ronda adversaria independiente** (agente que no escribió el código):
  - **P1.1** `parsePeriodKey` "13/2025"→marzo (misparse día/mes) → lookbehind `(?<!\d)`.
  - **P1.3** merge perdía `monto_mensual_declarado` de docs hermanos → ahora se **suman** + alerta.
  - **P1.4a** honorarios no deduplicaba boletas idénticas → dedup como las otras ramas.
  - **P2.1** orden del array de salida dependía del orden de entrada → `incomes` ordenado determinista.
  - **P2.2/P2.3** colisiones `sis`/`achs` por substring ("Asistencia"/"Análisis"→legal) → límite de palabra
    IZQUIERDO (mata el falso positivo sin romper stems "cotizaciones"/"previsionales").
  - **P3.1** boletas/subsidio sin períodos ignoraban `monto_mensual_declarado` → fallback + alerta.

Aceptado con alerta / backlog (no son pérdida silenciosa ni cálculo errado):
- **P1.2** subsidio con pago sin mes parseable: no hay mes asignable de forma determinista → se **alerta**
  (criterio 3 cumplido); la mensualización final la confirma el abogado.
- **P1.4b** dos meses reales mal etiquetados igual por el LLM (mismo label+monto) → es error de extracción
  del LLM, indistinguible de un duplicado real; lo cubre la red anti-error (cita) aguas arriba.
- **P1.5** `directo` con N períodos promedia todos (sin ventana); **P3.2** rangos multi-mes en un label;
  **P3.3** `validateIncomeReads` prioriza bruto vs cálculo líquido. Menores, documentados.

## Orden de trabajo sugerido
1. Escribir `unit_tests.ts` con las pruebas B1–B8 (varias fallan a propósito → exponen H1–H5).
2. Aplicar fixes H1, H2 (P1) y H3, H4, H5 (P2) en `income_extractor.ts`.
3. Correr `unit_tests.ts` + `run_deterministic.ts` → todo verde.
4. Revisión adversaria (B10) → iterar.
5. Recién entonces, Fase 2 (lectura nativa) sobre una base determinista sólida.
