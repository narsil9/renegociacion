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

## Pendientes / candidatas (a validar en próximas pruebas del Paso 5)

- **Honorarios (2ª cat.):** ingreso = promedio de boletas. CLAUDE.md dice "últimos 6 meses / 6"; el
  **portal exige 12 meses** (L3). Resolver la discrepancia 6 vs. 12 contra un caso real de honorarios. · `pendiente`.
- **Aporte de terceros:** requiere **declaración jurada** (tipo 31); ¿la genera el flujo o la sube el
  abogado? Validar con un caso de persona casada / aporte de padres. · `pendiente`.
- **Retiro de sociedades (tipo 6/33):** cómo se determina el monto mensual (¿retiro promedio?). Jorge
  tiene sociedades pero declaró por remuneración — validar con un caso que declare por retiro. · `pendiente`.
- **Múltiples fuentes simultáneas** (sueldo + arriendo + …): una fila por fuente. Validar con un caso
  multi-ingreso. · `pendiente`.
