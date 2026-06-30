# Paso 5 — Ingresos · lecciones para el agente de ingresos

> Consumidor: el **agente de ingresos** (`src/agents/ingresos_agent.ts`) + el extractor determinista
> (`src/utils/income_extractor.ts`). Ver [`README.md`](README.md) para el formato.
> Aplican además los [`principios-generales.md`](principios-generales.md) (cert manda, nunca $0/silencio,
> el LLM extrae hechos y TS blinda la estructura).

## Contexto del paso (verdad-terreno)

El Paso 5 declara los **ingresos** del deudor (alimenta la propuesta de carga financiera). El portal
tiene **3 listas** acopladas y un upload obligatorio aparte:

- **Tipo de ingreso** (`#ingresotipoIngresoSolicitud`): 1 Remuneración · 2 Pensión/jubilación/montepío ·
  3 Licencia Médica · 4 Aporte de terceros para deudas · 5 Aporte de terceros para gastos ·
  6 Retiro de sociedades · 7 Arriendos · 8 Ingresos esporádicos · 9 Otros · 10 Honorarios.
- **Tipo de documento justificativo** (`#tipoAntecedente`): 28 (3 liquidaciones de sueldo) ·
  29 (3 comprobantes pensión/montepío/jubilación) · 30 (licencias médicas) · 31 (declaración jurada
  aporte de terceros) · 32 (3 comprobantes arriendo) · 33 (comprobante retiro de sociedades) ·
  34 (otro comprobante de ingresos) · 45 (documentación justificativa de honorarios).
- **Periodicidad** (`#ingreso.tipoPeriodicidad`): 1 Anual · 2 Semestral · 3 Trimestral · 4 Mensual ·
  5 Quincenal · 6 Semanal · 7 Diario · 8 Única Vez.
- **Certificado de Cotizaciones Previsionales** (`#fileCertificadoCotizaciones`): upload **obligatorio**,
  últimos 12 meses, con el RUT de la entidad pagadora. NO es un ingreso → va en su propio campo.

## Fuentes oficiales (Superir) — verdad normativa, verificada 2026-06-29
> Manual de usuario de la plataforma (`Manual_Ingreso_Solicitudes_Renegociacion_vf.pdf`, Paso 5, págs. 23-26)
> y `Listado_de_antecedentes_2023_vf_2.pdf`. Estas son reglas del ESTADO; mandan sobre cualquier supuesto.

- **Propósito del Paso 5 (textual):** registrar *"todos los ingresos que percibe, los que permitirá
  determinar su **verdadera capacidad de pago** para renegociar sus obligaciones."* → el monto declarado
  alimenta la propuesta. **Regla del 60%**: la propuesta de pago **no puede exceder el 60% de los
  ingresos declarados** (Listado). Sub/sobre-declarar el ingreso impacta directo la propuesta.
- **Concepto** (dropdown, "una o más"): Remuneración · Pensión/jubilación/montepío · Licencia Médica ·
  Aporte de terceros para deudas · Aporte de terceros para gastos · Retiro de sociedades · Arriendos ·
  Ingresos esporádicos · Otros. (= nuestro crosswalk L7.)
- **Monto** (pesos, máx 9 dígitos) + **Periodicidad** (Anual/Semestral/Trimestral/Mensual/Quincenal/
  Semanal/Diario/Única Vez). El portal acepta periodicidad ≠ Mensual; el resumen muestra una fila
  **"Promedio Ingresos"** (promedia las filas declaradas).
- ⚠️ **El manual NO dice cómo CALCULAR el monto mensual** (no manda "promedio de 3 meses"). La
  mensualización/promedio (L3: 3 meses permanentes / 12 honorarios) es **criterio del abogado**, no del
  portal. Lo que el portal/Listado fija son los **DOCUMENTOS** de respaldo (abajo).
- **Documentos justificativos por tipo (Listado):**
  - Sueldo/pensión → **3 últimas liquidaciones** (o **contrato** si aún no hay liquidaciones).
  - Licencia médica / seguro de cesantía → **comprobante de pago** de la licencia/seguro.
  - Trabajo informal → **DJ simple** (actividad + monto mensual; no notarial).
  - Aporte de terceros → **DJ del tercero + copia de su cédula** (monto que aporta).
  - **Retiro de sociedades → certificado del CONTADOR + carpeta tributaria de la(s) sociedad(es)**
    (una DJ simple del propio deudor NO es el documento que pide Superir).
  - Honorarios → **Informe de Boletas Emitidas del SII, 3 últimos años tributarios**.
- **Certificado de Cotizaciones Previsionales:** **obligatorio**, últimos **12 meses**, con **RUT de la
  entidad pagadora**. Upload aparte (`#fileCertificadoCotizaciones`).
- **Vigencia 30 días** para todos los documentos (misma regla que CMF/certs del Paso 3).
- **Formatos aceptados por el portal en el Paso 5:** **JPG, PDF y Word (.docx)** (justificativos y cert
  de cotizaciones). *(Nuestro pipeline lee nativo solo PDF/imagen → un `.docx` se sube tal cual al portal
  pero hay que CONVERTIRLO para que el agente lo lea y extraiga el monto.)*

## Cómo ANALIZAR los documentos — playbook de extracción para el LLM (lectura nativa)

> Esto es lo que aprendí leyendo nativo 60+ PDF reales actuando como el LLM. El agente
> (`ingresos_agent.ts`, respaldado por la API de Anthropic) debe leer cada documento con
> esta guía para que TS pueda rellenar bien el Paso 5. **Regla madre: el LLM extrae HECHOS
> fieles al documento (cifras, etiquetas, fechas, días, RUT) — NO calcula promedios ni decide
> estructura; eso lo hace TS.** Una llamada por documento (L14).

**0) Antes de extraer, clasifica el documento.** No todo lo que está en la carpeta de ingresos es
ingreso. Por CONTENIDO, no por nombre de archivo, decide qué es:
- **Liquidación de sueldo** → `liquidacion_sueldo` (un mes de remuneración).
- **Informe Anual de Boletas de Honorarios (SII)** o boletas sueltas → `honorarios`.
- **Liquidación de subsidio por licencia médica** (Compin/ISAPRE) → `licencia_medica`.
- **Comprobante de depósito/transferencia de un arrendatario** → `comprobante_arriendo`.
- **Comprobante de pensión/jubilación/montepío** → `comprobante_pension`.
- **Certificado de cotizaciones previsionales** → `certificado_cotizaciones` (NO es ingreso; va en su
  campo aparte; igual extrae fecha de emisión + RUT entidad pagadora).
- **NO es ingreso (ignorar):** cédula de identidad, capturas del SII (agente retenedor), **hoja resumen
  de crédito hipotecario / contrato de crédito** (¡y ojo si el titular es OTRA persona!), contrato de
  trabajo (solo respalda si no hay liquidaciones), anexos de contrato, padrón/dominio de vehículos.

**1) Liquidación de sueldo — qué leer (en este orden):**
- **Período (mes/año):** del CONTENIDO ("Mes: Octubre 2025", "PERIODO: SEPTIEMBRE 2025", "Fecha Inicio
  Periodo 2025-12-01"), **NUNCA del nombre del archivo** (un `Liquidacion Julio (3).pdf` puede contener
  Agosto — caso real). Devuélvelo como `period_label`.
- **Líquido a pagar** (`liquido_a_pagar`): la cifra NETA que la persona recibe. Sus nombres varían
  (L8/L19): "Líquido a Pagar", "Líquido a Recibir", "Líquido a Cobrar", "Total a Pagar", "Rem. Neta",
  "Monto Líquido". **Reglas para elegir bien:**
  - Si coexisten **"Alcance Líquido"** y un **"Líquido a pagar"/"Líq. a Pago" MENOR** → usa el menor
    (el Alcance es intermedio, antes de los descuentos varios). *(SAESA: ALC. LIQUIDO 1.648.974 vs LIQ.
    A PAGO 1.378.264 → usa 1.378.264.)*
  - Si la ÚNICA cifra de neto es **"Alcance Líquido"** (formatos Buk simples, = Total Haberes − Total
    Descuentos) → ESE es el líquido final, úsalo. *(William: solo "Alcance Líquido $2.429.517".)*
  - NUNCA uses "Imponible", "Tributable", "Total Haberes" ni "Sueldo Base".
- **Días trabajados** (`dias_trabajados`): búscalos ("Días Trabajados: 30", "DIAS TRAB. 30", "(-) DIAS
  LICENCIA (18)", "Días licencia"). Si el mes tiene licencia/ausencia o ingreso-egreso a mitad de mes
  (días < 28), repórtalo — TS excluirá ese mes parcial del promedio (L16).
- **RUT del empleador** (`source_key`): el RUT de la empresa pagadora ("Empleador: ... (96.808.570-0)",
  "RUT EMPRESA 76947101-4"). Necesario para no fusionar dos empleadores distintos (L9) y para no mezclar
  con la cédula del trabajador.
- **Líneas de "otros descuentos"** (`deductions`): lista cada línea NO legal con su **etiqueta exacta**
  y su monto. No hace falta listar las legales (AFP/salud/cesantía/impuesto ya están netas en el líquido),
  pero si las listas, TS las ignora. TS clasifica legal/voluntario/ambiguo (L2/L10/L17/L20) — tú solo
  transcribe fielmente la etiqueta (ej. "A.P.V.I. EN AFP", "Préstamos CCAF", "COOPEUCH", "Anticipo
  Aguinaldo", "Crédito Personal Caja Los Andes").
- **Evidencia:** por período, devuelve `cita_monto` = fragmento verbatim con la cifra del líquido +
  `confidence`. (TS verifica que la cifra esté en la cita; red anti-error.)

**2) Honorarios — Informe Anual de Boletas (SII):**
- Una fila por mes con emisión: extrae **honorario BRUTO**, **retención** (de terceros o contribuyente) y
  **líquido**. Ignora meses en 0 y las **boletas ANULADAS** (la tabla las separa). `period_label` = mes/año.
- Reporta el bruto en `monto_bruto` y la retención en `retencion` (TS decide bruto vs líquido y promedia).
- Es muy común que el cliente tenga **honorarios Y sueldo a la vez**: extrae ambos por separado (TS emite
  alerta de coexistencia para que el abogado decida si suman o si uno reemplazó al otro — L18).

**3) Subsidio de licencia médica:** muchos pagos parciales por días, con PDFs duplicados y
reliquidaciones. Extrae cada pago con su "Monto Líquido" y su mes; NO uses el "Promedio mensual" impreso
(es base de cálculo). TS deduplica y reconstruye el mes (L11).

**4) Comprobante de arriendo:** monto del depósito + fecha + quién paga (arrendatario). Un solo
comprobante = un período; lo ideal son 3 meses (TS alerta si hay menos).

**5) Multi-pago en un mismo mes:** si un mes trae varias liquidaciones (sueldo + aguinaldo en planilla
aparte + planillas accesorias/retroactivas), extráelas TODAS con el mismo `period_label` del mes; TS las
suma como un solo mes (L15). No las descartes ni las promedies entre sí.

**6) Moneda:** si una cifra viene en **UF** (no en pesos), márcala `moneda: 'UF'` (un monto en UF tratado
como CLP es un error de ~38.000×). El portal declara en CLP.

## Lecciones

### L1 — "Líquido a pagar", NUNCA "Alcance Líquido"
La liquidación de sueldo trae **dos** cifras de líquido: **"Líquido a pagar"** (la grande arriba a la
derecha, ya con impuesto descontado) y **"Alcance Líquido"** (recuadro inferior, mayor). El monto a
declarar es **"Líquido a pagar"**. Tomar el "Alcance Líquido" sobre-declara el ingreso (~$80k/mes en el
testigo). *(Testigo: Jorge Romero — "Líquido a pagar 2.161.887" vs. "Alcance Líquido 2.243.348"; el
abogado usó el primero.)* · **validada** (audio del abogado + lectura nativa, 2026-06-29).

### L2 — Sumar de vuelta los descuentos VOLUNTARIOS al líquido
El ingreso real = **"Líquido a pagar" + descuentos voluntarios**. Un descuento voluntario (préstamo con
el empleador, convenio gimnasio, préstamo/cuota de caja de compensación, ahorro/APV voluntario) baja el
líquido pero **no** reduce la capacidad real de ingreso → se **suma de vuelta**. Los descuentos
**legales** (cotización AFP, salud/Isapre del plan obligatorio, seguro de cesantía, impuesto único de
2ª cat.) **NO** se suman de vuelta. → el LLM extrae las líneas de descuento con su etiqueta; **TS las
clasifica** legal vs. voluntario por keyword; las dudosas se **alertan** al abogado (no se suman solas).
*(Testigo: Jorge Romero — el abogado verificó que NO había descuentos voluntarios y usó el líquido tal
cual.)* · **validada** (audio del abogado, 2026-06-29).

### L3 — Promedio según el tipo de ingreso (regla del portal)
El monto declarado es un **promedio mensualizado**, y la ventana depende del tipo (lo dice el portal):
- **Permanentes** (remuneración, pensión, montepío, arriendo): promedio de los **últimos 3 meses**.
- **Honorarios**: promedio de los **últimos 12 meses** (+ Informe Boletas Emitidas + BTE).
- **Esporádicos / informales / aportes de terceros**: monto mensual o promedio mensual.
TS hace el promedio sobre los líquidos/montos por período que extrae el LLM. *(Testigo: Jorge —
(2.162.761 + 2.162.042 + 2.161.887)/3 = **$2.162.230**, idéntico al del abogado.)* · **validada** (2026-06-29).

### L4 — Periodicidad SIEMPRE Mensual (salvo única vez)
La propuesta de carga financiera es mensual y estable → el ingreso se declara con periodicidad
**Mensual** (value 4), porque ya se mensualizó en L3. Solo un ingreso genuinamente de una sola vez usa
**Única Vez**. No usar Anual/Semestral/etc. aunque el documento venga en otra periodicidad: primero se
mensualiza. *(Testigo: Jorge, regla general del abogado para todos los casos.)* · **validada** (2026-06-29).

### L5 — Liquidaciones suelen ser escaneo/foto → lectura NATIVA por Claude
Las liquidaciones de sueldo frecuentemente vienen como **PDF escaneado o foto** (capa de texto vacía →
`pdftotext` da 0 chars). Igual que los certificados del Paso 3, hay que leerlas **nativamente con Claude**
(`type:'document'` PDF nativo / imagen), no con OCR/Tesseract. *(Testigo: Jorge — LIQUIDACIONES.pdf con
0 chars de texto, 3 páginas de imagen; leídas nativas sin problema.)* · **validada** (2026-06-29).

### L6 — Certificado de Cotizaciones: obligatorio, 30 días, RUT entidad pagadora
Es un upload **separado y obligatorio** (sin él el portal no deja continuar). Debe ser de los **últimos
12 meses**, **vigencia ≤ 30 días** desde su emisión (misma regla que CMF/certs del Paso 3, bypaseable con
`BYPASS_DATE_CHECK`), y debe constar el **RUT de la entidad pagadora** (empleador/AFP). *(Testigo: Jorge
— cert AFP ProVida emitido 22-may-2025, RUT empleador EQUISOFT 59.212.930-2.)* · **validada** (2026-06-29).

### L7 — Mapeo doc → (tipo de ingreso, tipo de documento) es determinista (TS, no el LLM)
El LLM clasifica el documento en una **categoría semántica** de un set cerrado; **TS** la mapea a los
**dos enums** del portal vía un crosswalk fijo (no se le pide al LLM elegir el `value`). Crosswalk:
remuneración→(1,28) · pensión→(2,29) · licencia médica→(3,30) · aporte terceros deudas→(4,31) ·
aporte terceros gastos→(5,31) · retiro sociedades→(6,33) · arriendo→(7,32) · honorarios→(10,45) ·
esporádico→(8,34) · otro→(9,34). · **validada** (estructura del portal, 2026-06-29).

---

### L8 — El campo del líquido tiene MUCHOS nombres (no solo "Líquido a pagar")
El rótulo del monto a usar (L1) varía por empleador/documento. Confirmados en el lote `casos-paso5`:
**"Líquido a Pagar"** (Falabella, Siges, Nutrekall), **"Líquido a Cobrar"** (Clínica Alemana),
**"Líquido a Recibir"** (Chilexpress), **"Rem. Neta"** (Nutrekall), **"Monto Líquido"** (liquidación de
subsidio de licencia médica). El prompt debe **enumerar estos sinónimos** y seguir EXCLUYENDO siempre
"Alcance Líquido" / "Imponible". · **validada** por análisis de 5 casos (2026-06-29).

### L9 — Multi-empleador: una fuente por empleador, se SUMAN (no se promedian entre sí)
Si el deudor tiene **dos contratos de remuneración con empleadores de RUT distinto** y concurrentes,
son **dos ingresos "Remuneración"** y los montos mensuales **se suman** (cada uno = promedio de sus 3
liquidaciones). El cert de cotizaciones confirma empleadores cotizando en paralelo. ⚠️ **BUG de código
confirmado:** `computeIncomes` consolida por *categoría* → hoy fusionaría los 2 empleadores en un solo
promedio (subdeclara). Debe agrupar por **(categoría + RUT pagador)**. *(Testigo: Alex — Siges
96.992.160-K $1.747.852 + Nutrekall 77.730.514-K $440.525 = $2.188.377.)* · **validada** (2026-06-29).

### L10 — El add-back voluntario NO es por keyword: hay que CONCILIAR contra el documento del préstamo
Refina L2/C3. Un descuento que "suena" a préstamo de caja **no se suma a ciegas**: hay que conciliar el
monto del descuento con el certificado del préstamo. *(Testigo: Alex — "Descto. Ptmo. CCAF Los Andes"
$465–527k/mes NO concilia con la única cuota documentada $61.969 de un crédito **nuevo** del 03/03/2026;
el doc "préstamo en 0" NO probaba un crédito terminándose. → el descuento queda **DUDOSO → NO sumar +
alertar**, no sumar por regla.)* Además, los **anticipos** (devolución de anticipo de sueldo/aguinaldo/
bono ya percibido) son una **clase aparte**: bajan el líquido pero no son gasto recurrente ni préstamo
redirigible → por defecto NO se suman; "normalizar" el mes es decisión del abogado. *(Testigos: Alejandro
"Anticipos Varios" $89.442 + "Antic. Agui." $57.058 marzo; Alex "Anticipo Bono Vac." $106.000.)*
Gastos reales (**seguro de vida, bienestar, cuota sindicato, cta. cte.**) nunca se suman. · **validada** (2026-06-29).

### L11 — Licencia médica: subsidio fragmentado, duplicados y RELIQUIDACIONES (no doble contar)
El subsidio por incapacidad (Compin/ISAPRE) llega en **muchos pagos parciales por días** de varias
licencias encadenadas, y el cliente suele entregar **PDFs duplicados** y **reliquidaciones** (que
descuentan un "subsidio anterior" ya adelantado). Reglas: (a) **deduplicar** (en el testigo, 9 PDFs =
solo 5 liquidaciones únicas); (b) por folio con reliquidación, **elegir UNA versión**, no sumar la plena
y la reliquidada (doble conteo); (c) **NO** usar el "**Promedio mensual**" impreso (es la BASE de cálculo
del subsidio, no lo percibido); (d) reconstruir el **subsidio devengado por mes calendario** (sumar los
"Monto Líquido" del mismo mes) y mensualizar un mes completo; (e) el subsidio **reemplaza** al sueldo en
el período de licencia → **no se declaran sueldo y subsidio sobre el mismo período**. *(Testigo: María
Elisa — subsidio mensual ≈ $2.700.000; folios 127997776/128273358/128544488.)* · **validada** (2026-06-29).

### L12 — Retiro de sociedades: documento del CONTADOR (no DJ simple) + riesgo de doble conteo + `.docx`
El retiro de sociedades (tipo 6) requiere, según Superir, **certificado del contador + carpeta tributaria
de la sociedad**; una **DJ simple del propio deudor NO acredita**. Además: (a) suele venir en **`.docx`**
→ el pipeline lee nativo solo PDF/imagen, hay que convertirlo para extraer el monto; (b) si el deudor ya
declara **remuneración de la misma sociedad**, declarar también el retiro puede **duplicar** el mismo
flujo → decisión del abogado. *(Testigo: Alex — retiro Nutrekall $4.734.000/2025 en DJ `.docx`, misma
sociedad donde cobra sueldo → NO declarado por falta de respaldo + doble conteo.)* · **validada** (2026-06-29).

### L13 — Archivos en `Ingresos/` que NO son ingreso (no inventar ingreso) + la cédula aporta DOB
Las carpetas de ingreso traen documentos que **no son ingreso** y no deben declararse: **cédula de
identidad** (jpg anverso/reverso), **capturas del SII** (agente retenedor — respaldo cruzado, no es el
cert de cotizaciones). Bonus: la **cédula aporta la fecha de nacimiento** → dato del **Paso 1**
habitualmente faltante en prod (ver bloqueante `fecha_nacimiento`). *(Testigo: Alejandro —
`1000256982/3.jpg` = cédula, DOB 23-NOV-1984; el 2º "cotizaciones.pdf" era captura del SII.)* · **validada** (2026-06-29).

### L14 — Lectura por LLM: UNA llamada por documento (handoff del Paso 3)
Adoptado del diagnóstico del Centinela (`mejoras-centinela-lector-pdf.md`, 2026-06-29): leer **todos**
los documentos en una sola llamada hace que el modelo reparta atención y **fluctúe entre corridas**
(pierde/mezcla datos). La regla #1: **una llamada por documento** (contexto chico + atención total =
lectura estable y completa). Implementado en `ingresos_agent.ts` (`callClaudeForDoc` por doc). Adoptadas
también: **reconocer el `doc_type`** antes de extraer (liquidación mensual ≠ resumen anual ≠ subsidio ≠
boleta; un total anual NO es un mes); **declarar la moneda** (UF vs CLP, ~38.000×); **reintento ante
respuesta vacía** (vacío = error reintentable, no "sin datos"); **`rut_pagador` por documento** →
`source_key` (habilita L9 multi-empleador en la lectura real); **nunca bajar a $0 ni omitir** por
interpretación (ante la duda, reportar + alertar). Ya teníamos: lectura nativa PDF/imagen, Opus 4.8 para
escaneos, `thinking: adaptive`, y evidence (cita+confianza, L8/Capa anti-error). · **adoptada** (2026-06-29).

---

## Lecciones del lote real `renegociacion_docs` (11 clientes con ingresos, 2026-06-29)

> Lectura nativa actuando como el LLM sobre los PDF reales de cada cliente. Cada hallazgo se blindó con
> un fix **general** en `income_extractor.ts` + prueba pre/post en `unit_tests.ts` (B10) y un caso en
> `run_renegociacion_docs.ts`. 11/11 + 5/5 + 106 unit verdes; **ningún fix rompió otro** (regresión intacta).

### L15 — Varios pagos del MISMO mes calendario se SUMAN (divisor = MESES, no líneas de pago)
Un mismo mes puede traer **varias liquidaciones** (sueldo base + aguinaldo en planilla aparte +
**planillas accesorias retroactivas** de pagos trimestrales). Son **un solo mes** de ingreso: se **suman**
sus líquidos y el promedio divide por **número de meses**, no por número de líneas. Antes el promedio
dividía por líneas → un mes partido en 3 pagos contaba como 3 "meses" y subdeclaraba. Fix general:
agregar por mes calendario (`parsePeriodKey`) **antes** de promediar; alerta si un mes combina ≥2 pagos.
*(Testigo: Susana Matamala — Sept = sueldo $1.470.022 + Ley 19.937 $230.300 + Ley 19.490 $38.379 = $1.738.701
en un mes; quedó fuera de la ventana Oct/Nov/Dic → $1.472.881.)* · **validada + fix** (2026-06-29).

### L16 — Mes PARCIAL (licencia / ingreso-egreso a mitad de mes) se EXCLUYE del promedio
Un mes con **días trabajados < 28** (licencia médica que parte el mes, ingreso/egreso del trabajador a
mitad de mes) tiene un líquido **anormalmente bajo** que NO representa el ingreso mensual → se **excluye**
del promedio a favor de los meses **completos** (si los hay; si TODOS son parciales, se usan igual + alerta).
El LLM debe extraer `dias_trabajados` cuando el documento los expone (o detectar "licencia"/"días licencia").
*(Testigos: Betzy Lee — Oct 17 días licencia $1.06M; con el fix promedia Jul/Ago/Sep = $1.723.507, no
$1.502.977. Jaime Cartes — Oct 12 días (18 licencia) $491k; promedia Ago/Sep = $1.301.969.)* · **validada + fix** (2026-06-29).

### L17 — APV es VOLUNTARIO aunque la etiqueta diga "en AFP" o use puntos ("A.P.V.I.")
El Ahorro Previsional Voluntario (APV/APVC/depósito convenido) es **ahorro redirigible → se suma de vuelta**
(L2), pero su etiqueta suele contener "AFP" (que dispara el match **legal** de cotización) y a veces va
**con puntos** ("A.P.V.I. EN AFP") que no calza con la keyword `apv`. Fix general: detectar APV con
prioridad sobre lo legal y tolerando puntos/espacios (`a.?p.?v`), sin confundir "AFP" (a-f-p) ni "aporte".
*(Testigo: Jaime Cartes — "A.P.V.I. EN AFP" $70.000/mes; antes se trataba como legal y NO se sumaba →
subdeclaraba $70k.)* · **validada + fix** (2026-06-29).

### L18 — Honorarios CON testigo (cierra C6): Informe Anual de Boletas SII + concurrencia con sueldo
El documento canónico de honorarios es el **"Informe Anual de Boletas de Honorarios Electrónicas" del SII**
(da por mes: **honorario bruto**, retención de terceros/contribuyente y líquido; ignora las **anuladas**).
Se declara el **bruto mensualizado** (Σ bruto de la ventana **/ 12**, divisor fijo) + alerta confirmando
bruto-vs-líquido y ventana. Los honorarios son **irregulares** (meses en 0) → /12 da un promedio bajo
aunque los meses activos sean altos (alerta de irregularidad). Muy frecuente: el deudor tiene **honorarios
Y sueldo** → puede ser **concurrente** (boletas en paralelo al empleo → se declaran y suman ambos) o
**secuencial** (dejó de boletear al entrar a planilla → solo el vigente). TS no puede distinguirlo →
**alerta de coexistencia** para que el abogado decida. *(Testigos: Irene Arévalo — sueldo $2.448.378 +
honorarios $517.500, concurrente; Jaime — honorarios Abr-Jul $213.399 LUEGO sueldo Ago-Oct, secuencial;
Noelia — sueldo $1.744.855 + honorarios $297.271 concurrente.)* · **validada + fix** (2026-06-29).

### L19 — "Alcance Líquido" depende del FORMATO (refina L1)
L1 ("nunca Alcance Líquido") aplica **cuando hay una línea final aparte** ("Líq. a Pago"/"Líquido a Pagar"
menor que el Alcance, tras los descuentos varios) → usar esa. Pero en **formatos simples (ej. Buk)** la
ÚNICA cifra es "Alcance Líquido" = Total Haberes − Total Descuentos = **el neto final** → ahí **sí** es el
monto a usar. Regla para el LLM: declarar **el neto que la persona recibe** (la cifra más abajo, tras TODOS
los descuentos); si coexisten "Alcance Líquido" y un "Líquido a pagar" menor, usar el menor. *(Testigos:
William Montero — solo "Alcance Líquido $2.429.517" = final; Claudia/Irene — "Líquido a pagar" < "Alcance
Líquido", usar el primero.)* · **validada** (2026-06-29).

### L20 — La ETIQUETA del descuento manda: "PRESTAMO X" → voluntario; nombre a secas → ambiguo
Refina L2/L10. Cuando la línea dice explícitamente **"Préstamo <institución>"** (Coopeuch, caja, banco) es
un crédito redirigible → **voluntario, se suma**. Pero el **mismo proveedor a secas** ("COOPEUCH" sin
"préstamo") es **ambiguo** (podría ser ahorro, cuota social, seguro…) → **NO se suma, se alerta**: no se
puede saber del solo nombre si es préstamo o ahorro. Esto evita tanto subdeclarar (caso préstamo explícito)
como sobredeclarar (asumir préstamo sin prueba). *(Testigos: Yoselyn Reyes — "PRESTAMO COOPEUCH" $391.930
+ "Prestamo Caja Los Andes" $399.068 sumados (líquido $642k → capacidad $1.45M); María Paz Bravo —
"COOPEUCH" a secas $410.890 → ambiguo, alertado, NO sumado.)* · **validada** (2026-06-29).

### L21 — El período sale del CONTENIDO (no del filename); filtrar NO-ingresos; cert puede venir ENCRIPTADO
La carpeta de ingresos es ruidosa: (a) **el filename miente** — leer mes/año del **contenido** del PDF, no
del nombre (Nicolás: `Liquidacion Julio (3).pdf` contenía **Agosto**, duplicado de `Agosto (4)` → el dedup
por mes+monto lo absorbe). (b) **Hay documentos que NO son ingreso** y no deben declararse: una **Hoja
Resumen de crédito hipotecario** (Jaime — y peor, ¡del **titular de un TERCERO**, Caroline Tapia, donde
Jaime es solo asegurado!) → se ignora. (c) El **Certificado de Cotizaciones** puede venir **encriptado por
contraseña** (Susana — el RUT del afiliado no abrió) → no se puede verificar fecha/RUT pagador → **alerta**
(no es ingreso, no bloquea el cálculo). · **validada** (2026-06-29).

---

## Pendientes / decisiones abiertas (requieren verdad-terreno del abogado)

> Lo mecánico/estructural quedó en L8–L13 (validado por análisis del lote `casos-paso5`). Acá quedan
> solo las decisiones de **criterio** que no cierra el analista, y los huecos sin testigo.

- **Add-back / normalización (impacto en el monto):** Alex CCAF (+$486k: $2.188.377 vs $2.674.650);
  Alejandra crédito Caja Los Andes ($2.620.869 con vs $2.336.968 sin); Alejandro anticipos marzo
  ($2.061.903 vs $2.110.736). El abogado define si se suman/normalizan. · `abogado`.
- **María Elisa — Remuneración vs Licencia Médica:** en licencia ininterrumpida → recomendado declarar
  **Licencia Médica ≈ $2.700.000**; si reintegrada, **Remuneración $2.395.383**. · `abogado`.
- **"Cta. Cte. Clínica UF"** (María Elisa, ~$42k/mes): ¿préstamo interno redirigible (sumar) o cargo a
  cuenta corriente (no)? El nombre no lo aclara. · `abogado`.
- ~~**C6 — Honorarios (Fix 2) sin testigo**~~ **RESUELTO (L18, 2026-06-29):** 3 testigos reales
  (Irene/Jaime/Noelia) validaron el camino honorarios (Informe Anual SII, bruto/12, irregularidad,
  coexistencia con sueldo). Queda solo la decisión de **criterio** del abogado: declarar **bruto o
  líquido** y **ventana 6 vs 12 meses** (el portal/L3 dice 12; CLAUDE.md mencionaba 6). · `abogado`.
- **Coexistencia honorarios↔sueldo (concurrente vs secuencial):** el abogado define si se suman ambos
  (Irene/Noelia, concurrente) o solo el vigente (Jaime, secuencial honorarios→sueldo). · `abogado`.
- **COOPEUCH / institución a secas (L20):** un descuento "COOPEUCH" (sin "préstamo") queda **ambiguo →
  alertado, no sumado**. Si el abogado confirma que es crédito, lo suma. *(María Paz, $410.890/mes.)* · `abogado`.
- **Aporte de terceros (tipo 31):** DJ del tercero + cédula — validar con un caso real. · `pendiente`.
- **Vigencia 30 días:** en el lote, varios certs de cotizaciones están **vencidos** (Jorge >13 meses;
  Alejandra ~66 días); Alejandro/Alex/María Elisa vigentes. Operacional: refrescar antes de presentar
  (no afecta el monto, sí la admisibilidad). · `operacional`.
