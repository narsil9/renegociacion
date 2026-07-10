# Plan de pruebas — Paso 5 (Ingresos)

> Objetivo: estresar el pipeline del Paso 5 (`runIngresosAgent` → `income_extractor.ts` →
> `fillStep5`) contra **5 casos reales** de `~/Desktop/casos-paso5`, derivar la salida esperada
> por lectura experta, y convertir cada hallazgo en una **lección general** en
> `lecciones/paso5-ingresos.md` (RAG para el prompt del agente). Regla rectora: el LLM extrae
> hechos, TS blinda la estructura; los fixes son **generales**, no parches por caso.

## Estado del pipeline al iniciar (branch `paso-5`)
Ya aplicados 3 fixes (esta sesión): (1) ordenamiento de períodos por fecha; (2) honorarios=boletas
(divisor fijo de meses); (3) red anti-error `evidence`/`claudeReadIssues` (espejo Paso 3).

## Cómo se corre cada prueba (2 fases)
- **Fase 1 — determinista (HECHA ✅ 5/5, 2026-06-29):** `run_deterministic.ts` corre `computeIncomes`
  sobre los HECHOS hardcodeados de `fixtures.ts` y compara con el esperado. Sin API/portal/Supabase.
  Valida la estructura (líquido, promedio, Fix1, multi-empleador, descuentos, subsidio). Ver `README.md`.
- **Fase 2 — lectura nativa por Claude (pendiente):** reemplazar los fixtures por
  `extractIncomeFactsNative` leyendo los PDFs/imágenes reales del lote → verificar que Claude extrae los
  mismos hechos (líquidos, descuentos, períodos, `rut_pagador`, evidence) que hardcodeé. Acerca a
  producción. Gasta créditos de API. **El agente ya lee UNA LLAMADA POR DOCUMENTO** (regla #1 del handoff
  del Paso 3, `mejoras-centinela-lector-pdf.md`) + retry + doc_type + moneda + nunca-$0 (ver lección L14).

## ⚠️ Verdad-terreno
Estas carpetas son la **carpeta cruda del cliente** (input), no la solicitud del abogado en el
portal. El "esperado" de abajo es **derivado por lectura experta** (analista). Donde hay ambigüedad
real de criterio (sumar/no descuento, bruto/líquido, doble conteo) se marca **[NECESITA ABOGADO]**.

---

## Matriz de casos (orden de ejecución: fácil → difícil)

### 1) Jorge Romero (15842968-3) — REGRESIÓN / baseline ✅ ya validado
- **Archivos P5**: `Ingresos/.../LIQUIDACIONES JORGE ROMERO.pdf` (escaneo multipágina),
  `Ingresos/.../Cotizaciones.pdf` (AFP ProVida, texto). (Tiene Sociedades + Agentes Retenedores
  pero declaró por **remuneración**.)
- **Estresa**: lectura nativa de escaneo; "Líquido a pagar" vs "Alcance Líquido".
- **Esperado**: Remuneración **$2.162.230** (3 meses), tipo 1/doc 28, cert cotizaciones ✓.
- **Objetivo**: confirmar que los 3 fixes **no rompieron** el baseline.

### 2) Alejandro Olguín (15842976-4) — asalariado, TEXTO limpio, 1 empleador
- **Archivos P5**: `Ingresos/Contrato de Trabajo/15842976_2026{0331,0430,0531}.pdf` (3 liquidaciones,
  **capa de texto**, empleador FALABELLA TEC.CORPORATIVA 77612410-9);
  `Ingresos/.../cotizaciones.pdf` (AFP Cuprum, texto, emit. 10/06/2026);
  `Captura...pdf` + `1000256982/3.jpg` (por identificar — ¿cédula/otro? probablemente NO ingreso).
- **Estresa**: lectura de **capa de texto**; promedio 3 meses; orden de períodos; descuento
  **ambiguo "Seguro Vida $4.743"** (Otros Descuentos).
- **Datos leídos**: liq 31.05.2026 → **Líquido a Pagar 1.990.721** (Total Desc. 505.845;
  legales 501.102 + Otros: Seguro Vida 4.743). Sin "Alcance Líquido".
- **Esperado**: Remuneración ≈ promedio de los 3 "Líquido a Pagar" (mar/abr/may), tipo 1/doc 28.
  Seguro Vida → **alerta de descuento ambiguo** (NO sumar de vuelta sin confirmar). cert ✓.
- **[NECESITA ABOGADO]**: ¿el "Seguro Vida" se suma de vuelta? (esperado: NO — es gasto real, no préstamo).

### 3) Alejandra Romero (16486888-5) — asalariada, ESCANEO, 4 liquidaciones sueltas
- **Archivos P5**: `Ingresos/Contrato de Trabajo/liq {enero,febrero,marzo}.pdf` + `Liq abril 26.pdf`
  (4 liquidaciones escaneadas, ene–abr 2026); `Ingresos/.../cotizaciones previsionales(1).pdf`.
- **Estresa**: **Fix 1** (4 períodos → promedio de los **3 más recientes**: feb+mar+abr, NO enero) sobre
  **lectura nativa**; consolidación de **PDFs sueltos** del mismo empleador en 1 ingreso.
- **Esperado**: Remuneración = promedio(feb,mar,abr) — verificar que NO incluya enero. tipo 1/doc 28.
- **A leer al ejecutar**: las 4 liquidaciones (montos), nombre del campo de líquido, descuentos.

### 4) Alex Llanquitruf (13925593-3) — 🔴 DIFÍCIL: multi-empleador + voluntario + retiro sociedad
- **Archivos P5**:
  - `Ingresos/Liq {marzo,abril,mayo}.pdf` → **empleador Siges Chile SPA** (96992160-K), Jefe Alimentación.
    Mayo: **LÍQUIDO A PAGAR 1.723.469**; Otros Descuentos incl. **Descto. Ptmo. CCAF Los Andes 527.586**,
    Cuota Sindicato 6.000, Seguro BICE Vida 10.002.
  - `Ingresos/202603/04/05 - ALEX...pdf` → **empleador NUTREKALL SPA** (su sociedad, "Socio/Gerente"),
    Líquido 440.525; líneas voluntarias (APV, Préstamo Caja, Anticipos) en $0.
  - `Ingresos/CertificadoAfpHabitat-2.pdf` (cotizaciones).
  - `prestamo en 0 caja los andes .pdf` → prueba que el préstamo CCAF quedó en **$0** (se está terminando).
  - `Declaración simple retiro Sociedad.docx` → **retiro de NUTREKALL $4.734.000 en 2025** (tipo 6).
- **Estresa (varios frentes a la vez)**:
  1. **Multi-empleador** → `computeIncomes` fusiona por categoría: **BUG predicho** (mezcla Siges+Nutrekall
     en un promedio). Esperado correcto: **2 fuentes** (o suma de sueldos concurrentes ≈ 1.72M + 0.44M).
  2. **L2 add-back**: ¿se suma el **CCAF Los Andes 527.586**? El "préstamo en 0" sugiere que termina →
     justifica sumarlo. Cuota Sindicato/Seguro Vida → ambiguos. **[NECESITA ABOGADO]**.
  3. **Retiro de sociedad** $4.734.000/2025 (tipo 6 = 394.500/mes). Está en **.docx** → el pipeline
     **no lee docx** (solo PDF/imagen): hallazgo. Y posible **doble conteo** con el sueldo Nutrekall. **[NECESITA ABOGADO]**.
- **Esperado**: definir con abogado; documentar el comportamiento actual vs el correcto.

### 5) María Elisa Vargas (18464784-2) — 🔴 MÁS DIFÍCIL: sueldo + licencia médica (subsidios)
- **Archivos P5**: `.../Liquidación {febrero,marzo}.pdf` (sueldo **Clínica Alemana**, enfermera;
  feb **Líquido a Cobrar 2.395.383**); `.../Liquidación-de-Subsidios 1..9.pdf` (subsidio por
  **incapacidad laboral** = licencia médica, Banmédica, Folio 127997776, pagos **fragmentados** por días);
  cotizaciones (en jpeg `IMG_7945/46`).
- **Estresa**:
  1. **Nombre del campo**: "**Líquido a Cobrar**" (sueldo) y "**Monto Líquido**" (subsidio) ≠ "Líquido a pagar".
  2. **Licencia médica (tipo 3)** fragmentada: muchos "Monto Líquido" parciales (981.054, 269.522, …) para
     una misma licencia → promediar por cantidad de PDFs es **incorrecto**. El doc trae "**Promedio mensual
     2.695.217**" (base, NO ingreso a declarar).
  3. **Sueldo + licencia conviven** (transición) → multi-fuente / cuál declarar. **[NECESITA ABOGADO]**.
- **Esperado**: definir con abogado cómo se declara la licencia médica (¿subsidio mensualizado vs sueldo?).

---

## Lecciones ya visibles (pre-ejecución) → van a `lecciones/paso5-ingresos.md` (candidatas)
1. **Sinónimos del campo de líquido**: "Líquido a Pagar/Cobrar", "Rem. Neta", "Monto Líquido" (subsidio).
2. **Multi-empleador**: una fuente por empleador (no fusionar por categoría); sumar sueldos concurrentes.
3. **Descuento voluntario ≠ todo "Otros Descuentos"**: préstamos/APV/forzosos sí; seguros/gastos reales no.
4. **Licencia médica**: subsidio fragmentado; no usar "Promedio mensual" del doc como ingreso.
5. **Retiro de sociedad** suele venir en `.docx` (pipeline no lee docx) + riesgo de doble conteo con sueldo.
6. **No-ingresos a ignorar**: cédula/capturas/jpg sueltos en `Ingresos/`.

## Resultados del análisis experto (esperados para el harness) — 2026-06-29
> Verdad-terreno **del analista** (no del abogado todavía). Fundamento completo en los informes de los
> 5 sub-análisis. Donde hay rango, lo de la izquierda es la base conservadora recomendada.

| Caso | Ingreso(s) a declarar | Monto mensual esperado | Cert cotizaciones | Notas clave |
|---|---|---|---|---|
| **Jorge Romero** | Remuneración (EQUISOFT) | **$2.162.230** (prom. 3) | ProVida, **vencido** | 0 voluntarios. Confirma baseline. |
| **Alejandro Olguín** | Remuneración (Falabella) | **$2.061.903** (o $2.110.736 si normaliza anticipos mar) | Cuprum, **vigente** (19d) | jpg = cédula→DOB 23-11-1984; 2º "cot" = captura SII |
| **Alejandra Romero** | Remuneración (Chilexpress) | **$2.620.869** (feb+mar+abr, +Caja LA) · sin Caja LA $2.336.968 | Cuprum, **vencido** (~66d) | control bug Fix1: con enero ≈$2.71–2.79M |
| **Alex Llanquitruf** | Remuneración ×2 (Siges+Nutrekall) | **$2.188.377** (suma) · +CCAF→$2.674.650 | Habitat, **vigente** (5d) | retiro sociedad NO declarado (doble conteo + sin cert contador) |
| **María Elisa Vargas** | Licencia Médica (o Remuneración) | **≈$2.700.000** (subsidio) · sueldo $2.395.383 | PlanVital, **vigente** (12d) | 9 PDFs = 5 únicos; reliquidaciones; no usar "Promedio mensual" |

Lecciones derivadas: **L8–L13** en `lecciones/paso5-ingresos.md` (sinónimos del líquido, multi-empleador,
add-back con conciliación, licencia médica, retiro sociedades, no-ingresos). Decisiones de criterio
abiertas (add-back, sueldo vs licencia) → sección "Pendientes" de ese mismo archivo.

## Pendiente de insumo
- **Verdad-terreno del abogado** (qué declaró en el Paso 5 de cada caso): cerraría las decisiones de
  criterio (add-back CCAF/Caja, normalizar anticipos, sueldo vs licencia médica, retiro sociedad).
  Mientras tanto, los **montos mecánicos** (extracción del líquido, promedios, dedup) ya son verdad-terreno del analista.
