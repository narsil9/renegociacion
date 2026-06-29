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
- **C6 — Honorarios (Fix 2) sin testigo:** ninguno de los 5 casos declara por boletas → divisor fijo 12,
  bruto vs líquido y ventana 6 vs 12 **siguen sin validar**. Conseguir un caso de honorarios. · `pendiente`.
- **Aporte de terceros (tipo 31):** DJ del tercero + cédula — validar con un caso real. · `pendiente`.
- **Vigencia 30 días:** en el lote, varios certs de cotizaciones están **vencidos** (Jorge >13 meses;
  Alejandra ~66 días); Alejandro/Alex/María Elisa vigentes. Operacional: refrescar antes de presentar
  (no afecta el monto, sí la admisibilidad). · `operacional`.
