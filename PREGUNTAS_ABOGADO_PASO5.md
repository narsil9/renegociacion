# Preguntas para el abogado — Paso 5 (Ingresos)

> **Para qué sirve este archivo:** son las decisiones de **criterio** (no de código) que el robot NO
> puede resolver solo y que cambian el **monto de ingreso declarado** (y por lo tanto la propuesta de
> pago, tope 60% de los ingresos). Cada pregunta trae: **cliente + RUT**, **qué documento(s) mostrarle**,
> **las líneas/números exactos** en duda, **el problema explicado**, **qué hace hoy el robot**, el
> **impacto en pesos**, y la **pregunta concreta**. La respuesta del abogado se vuelve regla general
> (lección) y se aplica a todos los clientes en la misma situación.
>
> Carpeta de los documentos: `~/Desktop/renegociacion_docs/<cliente>/documentos/04_Ingresos_y_Sueldos/`
> Lote analizado: 2026-06-29 (lectura nativa de los PDF, sin verdad-terreno del abogado todavía).

---

## P1 — ¿Se suma de vuelta el descuento "COOPEUCH" cuando NO dice "préstamo"?

- **Cliente:** María Paz Bravo Norambuena · **RUT** 16.997.909-K · funcionaria APS Municipalidad de Talca.
- **Documentos a mostrar** (las 3 liquidaciones):
  - `LiqUni_00_09_2025_1202_16997909-K_FGONZ.pdf` (Septiembre 2025)
  - `10 LIQUIDACION OCTUBRE-8.pdf` (Octubre 2025)
  - `11 LIQUIDACION NOVIEMBRE-7.pdf` (Noviembre 2025)
- **Línea/concepto en duda:** en "OTROS DESCUENTOS", la línea **`COOPEUCH`**:
  - Septiembre: **$410.890** · Octubre: **$410.890** · Noviembre: **$3.570**
  - (en la misma sección: `ASOC. GREMIAL APROSAM` $6.700 y `BIENESTAR` $16.400)
- **El problema:** la etiqueta dice solo "COOPEUCH", sin la palabra "préstamo". No sabemos si es **un
  crédito de consumo** que ella paga (sería redirigible → se suma a su capacidad de pago) o un **ahorro /
  cuota social** de la cooperativa (no se suma). La caída brusca de $410.890 a $3.570 en noviembre sugiere
  un crédito casi liquidado, pero no es concluyente.
- **Qué hace hoy el robot:** lo deja como **ambiguo → NO lo suma**, solo alerta (criterio conservador: sin
  la palabra "préstamo" no asumimos crédito). Por eso declara el sueldo "tal cual".
- **Impacto:** si ES préstamo (se suma) → ingreso promedio **≈ $1.893.089**. Si NO → **$1.617.973**.
  Diferencia **≈ +$275.116/mes**.
- **Pregunta concreta:** ¿El descuento "COOPEUCH" de María Paz es un **crédito** (sumar de vuelta al
  ingreso) o un **ahorro/cuota** (no sumar)? Y como regla general: cuando un descuento solo trae el
  **nombre de la cooperativa/caja sin decir "préstamo"**, ¿lo sumamos por defecto o lo dejamos fuera?

---

## P2 — Honorarios + sueldo a la vez: ¿se suman ambos o se declara solo el vigente?

Hay 3 clientes con boletas de honorarios Y liquidaciones de sueldo. La situación difiere:

- **Jaime Cartes** · **RUT** 17.596.599-8 — parece **SECUENCIAL** (dejó las boletas al entrar a planilla).
  - Documentos: `INFORME ANUAL DE BOLETAS DE HONORARIOS ELECTRONICAS.pdf` (boletas **Abril–Julio 2025**) +
    `Liquidación 08/09/10.2025 Jaime Cartes.pdf` (sueldo Lab. Clínico del Norte, **Agosto–Octubre 2025**).
  - Números: honorarios ≈ $640.195 bruto/mes (Abr-Jul); sueldo líquido ≈ $1.25M (Ago-Sep).
  - Las boletas **terminan en julio** y el sueldo **empieza en agosto** → parece que cambió de trabajo.
- **Irene Arévalo** · **RUT** 16.143.425-6 — parece **CONCURRENTE** (consultoría en paralelo al empleo).
  - Documentos: `liquidaciones_historicas 3 (1)_organized.pdf` (sueldo ECOS Sep–Nov 2025, full-time) +
    `INFORME ANUAL DE BOLETAS... .pdf` (2 boletas: **Nov $2.300.000** y **Dic $3.910.000** brutas).
  - Las boletas se emiten **mientras** está empleada full-time → ingresos paralelos.
- **Noelia Lorca** · **RUT** 15.121.553-K — parece **CONCURRENTE**.
  - Documentos: `liq-15121553-*-2025-08/09/10/11.pdf` (sueldo ACAM, ingresó 21/07/2025) +
    `INFORME ANUAL... .pdf` (boletas **Sep $877.193, Oct $701.754, Nov $1.052.631** brutas, entre otras).
  - Boletas Sep/Oct/Nov **coinciden** con los meses de sueldo → ingresos paralelos.
- **Qué hace hoy el robot:** declara **ambos** ingresos (Remuneración + Honorarios) y emite una **alerta de
  coexistencia** pidiendo confirmación. No sabe distinguir solo si son simultáneos o secuenciales.
- **Impacto:** Jaime $1.301.969 (solo sueldo) vs $1.515.368 (sueldo+honorarios). Irene $2.448.378 vs
  $2.965.878. Noelia $1.744.855 vs $2.042.126.
- **Pregunta concreta:** ¿La regla es **sumar ambos cuando son concurrentes** (Irene/Noelia) y declarar
  **solo el vigente cuando hubo transición** (Jaime: honorarios → sueldo)? ¿Cómo determinamos "vigente" —
  por el último período con movimiento? ¿Para Jaime declaramos solo el sueldo?

---

## P3 — Honorarios: ¿se declara el BRUTO o el LÍQUIDO? ¿se promedia sobre 12 meses o sobre los meses con emisión?

- **Clientes:** Jaime Cartes, Irene Arévalo, Noelia Lorca (cualquiera con boletas).
- **Documento a mostrar:** `INFORME ANUAL DE BOLETAS DE HONORARIOS ELECTRONICAS.pdf` (SII) de cada uno.
  - Ejemplo **Noelia**: por mes — Bruto / Retención / Líquido:
    Ene 350.877/50.877/300.000 · Abr 584.795/84.795/500.000 · Sep 877.193/127.193/750.000 ·
    Oct 701.754/101.754/600.000 · Nov 1.052.631/152.631/900.000. (resto de meses en 0)
- **El problema:** tres dudas acopladas:
  1. **¿Bruto o líquido?** El bruto incluye la retención de impuesto (que se le devuelve/imputa); el
     líquido es lo que recibe en mano. Hoy declaramos el **bruto** (criterio L3).
  2. **¿Ventana 12 o 6 meses?** El portal/Listado Superir dice **12 meses** (3 años tributarios de
     respaldo). Una nota interna nuestra mencionaba 6. Hoy usamos **12** (divisor fijo).
  3. **¿Divisor = 12 o = meses con boletas?** Como hay meses en 0, dividir por 12 da un promedio bajo.
- **Impacto (Noelia):** bruto/12 = **$297.271** · bruto/(5 meses con boletas) = **$713.450** ·
  líquido/12 = **$254.167**. Son montos muy distintos.
- **Pregunta concreta:** Para honorarios, ¿declaramos **bruto o líquido**, **dividido por 12** o por los
  **meses efectivamente emitidos**? (Esto fija la regla para todos los honorarios.)

---

## P4 — Mes con licencia médica parcial: ¿se excluye del promedio, se incluye, o se declara la licencia aparte?

- **Clientes y documentos:**
  - **Betzy Lee** · **RUT** 26.199.806-8 · `liquidaciones de sueldo.pdf` (**página 4 = Octubre 2025**):
    dice "**LICENCIA MEDICA (14 Días)**", Días Trabajados **17**, líquido **$1.061.904** (vs ≈ $1.72M en
    Jul/Ago/Sep).
  - **Jaime Cartes** · `Liquidación 10.2025 JAIME CARTES.pdf` (**Octubre 2025**): "**(-) DIAS LICENCIA
    (18)**", 12 días trabajados, líquido **$491.120** (vs ≈ $1.25M en Ago/Sep).
- **El problema:** ese mes está incompleto por la licencia, así que su líquido NO representa el ingreso
  mensual normal. El subsidio por los días de licencia se paga aparte (no está en estos documentos).
- **Qué hace hoy el robot:** **excluye** el mes parcial y promedia los meses completos (+ alerta).
- **Impacto:** Betzy $1.723.507 (excluyendo Oct) vs $1.502.977 (incluyéndolo). Jaime $1.301.969
  (excluyendo Oct) vs $1.055.019 (incluyéndolo).
- **Pregunta concreta:** ¿Está bien **excluir** el mes con licencia y promediar los meses completos? ¿O
  prefieres (a) incluirlo igual, (b) pedir el comprobante del **subsidio** y declararlo como "Licencia
  Médica", (c) otro criterio?

---

## P5 — Anticipos (de sueldo/aguinaldo/gift card): ¿se "normalizan" (suman de vuelta) o se dejan como están?

- **Clientes y líneas (en "otros descuentos"):**
  - Nicolás Bascuñán (18.755.318-0): `liquidacion Septiembre.pdf` → "**Anticipo Aguinaldo $150.000**".
  - William Montero (25.656.359-2): `liquidacion-...-2025-09.pdf` → "**Descuento Anticipo (Anticipo
    Aguinaldo) $47.383**".
  - Yoselyn Reyes (16.563.374-1): `LIQ YOSELYN.pdf` (pág. Dic 2025) → "**Anticipo Aguinaldo $77.000**".
  - Alejandra Espinoza (18.738.680-2): liquidación Dic 2025 → "**Anticipo Gift Card Navidad $37.583**" +
    "**Anticipo De Aguinaldo $90.201**".
  - Irene (16.143.425-6): liquidación Sep 2025 → "**Anticipo $160.000**".
  - Jaime: `Liquidación 09.2025` → "**Anticipo 1 $40.480**". Noelia: Sep → "**Anticipo Aguinaldo $50.000**".
- **El problema:** un "anticipo" es la **devolución de dinero ya entregado antes** (no un gasto recurrente
  ni un préstamo a un tercero). Baja el líquido del mes pero ese dinero ya lo recibió en el mes anterior.
- **Qué hace hoy el robot:** lo deja **ambiguo → NO lo suma** (no infla el ingreso) y alerta.
- **Impacto:** chico mes a mes, mayor en meses con aguinaldo.
- **Pregunta concreta:** ¿Los anticipos se dejan **sin sumar** (criterio actual) o quieres **"normalizar"
  el mes** sumándolos de vuelta para que el mes sea comparable? Regla general para todos.

---

## P6 — Aguinaldos / bonos de una sola vez DENTRO del líquido: ¿se incluyen en el promedio o se excluyen?

- **Clientes y bonos (están sumados en los haberes, dentro del líquido del mes):**
  - Nicolás: "Aguinaldo Fiestas Patrias $185.382" (Sep), "Bono Vacaciones $123.588" (Jul), "Beca De
    Estudios $206.000" (Ago).
  - William: "Aguinaldo Fiestas Patrias $59.228" (Sep). Irene: "Aguinaldo $200.000" (Sep).
  - Noelia: "Aguinaldo $61.629" (Sep). Alejandra Espinoza: "Gift Card $46.979" + "Aguinaldo $112.751" (Dic).
- **El problema:** son ingresos **reales pero irregulares** (una o dos veces al año). Como están dentro del
  líquido del mes, hoy entran al promedio tal cual e **inflan** los meses que los contienen.
- **Qué hace hoy el robot:** los **incluye** (no los separa del líquido).
- **Pregunta concreta:** ¿El aguinaldo/bono que viene dentro del líquido se **incluye** en el promedio
  mensual (criterio actual) o se **excluye** por ser irregular? (Si se excluye, habría que prorratearlo
  anualmente o ignorarlo.)

---

## P7 — Pagos retroactivos / trimestrales (sector público): ¿se prorratean al ingreso mensual?

- **Cliente:** Susana Matamala · **RUT** 16.983.419-9 · Hospital de Mulchén.
- **Documentos a mostrar** (las 3 liquidaciones de septiembre):
  - `SEPTIEMBRE0.-.pdf` (sueldo normal Sep, líquido $1.470.022)
  - `SEPTIEMBRE1.-.pdf` ("CANCELA PAGO TRIMESTRAL **LEY 19.937**", retroactivo 07–09/2025, líquido **$230.300**)
  - `SEPTIEMBRE2.-.pdf` ("CANCELA PAGO TRIMESTRAL **LEY 19.490**", retroactivo 07–09/2025, líquido **$38.379**)
- **El problema:** son asignaciones que se pagan **cada 3 meses** (no todos los meses). El robot las suma
  al mes de septiembre (correcto como hecho), pero septiembre queda **fuera** de la ventana de 3 meses más
  recientes (usa Oct/Nov/Dic), así que esos pagos trimestrales **no entran** al ingreso declarado.
- **Qué hace hoy el robot:** declara **$1.472.881** (promedio Oct/Nov/Dic), sin los trimestrales.
- **Impacto:** si los pagos trimestrales se prorratean ($268.679 ÷ 3 ≈ **$89.560/mes** extra), el ingreso
  sube a ≈ $1.562.441.
- **Pregunta concreta:** Las asignaciones **trimestrales** del sector público (leyes 19.937 / 19.490),
  ¿se **prorratean** al ingreso mensual (porque son recurrentes cada trimestre) o se **omiten** del
  promedio mensual de los 3 últimos meses?

---

## P8 — "Ahorro Caja Los Andes" que luego se devuelve: ¿se suma?

- **Cliente:** Claudia Silva · **RUT** 18.810.379-0 · Empresa Eléctrica de la Frontera (SAESA).
- **Documentos:** `Liquidación Septiembre.pdf` (descuento "**Ahorro Caja Los Andes $37.945**" en DESC.
  VARIOS) y `Liquidación Noviembre.pdf` (aparece como haber "**Dev. Descuentos $37.945**" = se lo
  devolvieron).
- **El problema:** lo tratamos como ahorro voluntario redirigible y lo **sumamos** de vuelta; pero como se
  lo **devolvieron** en noviembre, podría no corresponder sumarlo.
- **Qué hace hoy el robot:** lo **suma** (solo afecta septiembre, +$37.945 → +$12.648 al promedio de 3).
- **Impacto:** mínimo (≈ +$12.648/mes). Con: $1.496.676 · Sin: $1.484.028.
- **Pregunta concreta:** Un **ahorro** voluntario (no préstamo) que el empleador descuenta y **devuelve**
  después, ¿se suma al ingreso o no? (Define el criterio para "ahorro" vs "préstamo".)

---

## Anexo operacional (no es duda de criterio, pero conviene avisar)

- **Susana Matamala — certificado de cotizaciones ENCRIPTADO:** `CertificadoCotizaciones_23012026193503.pdf`
  y `..._25112025161540.pdf` están protegidos con contraseña (probé el RUT y no abrió). Sin abrirlo no se
  verifica fecha de emisión ni RUT de la entidad pagadora (requisito del Paso 5). **Acción:** pedirle a la
  clienta el certificado **sin contraseña** (o la clave) antes de presentar.
- **Vigencia 30 días:** revisar que las liquidaciones y el certificado de cotizaciones estén dentro de los
  30 días al momento de presentar (varios certificados del lote son de fechas anteriores).
