---
name: analisis-deudas-renegociacion
description: Auditoría experta de elegibilidad y acreditación de deudas para postular a la Renegociación de Persona Deudora (Ley 20.720, Superir, Chile). Analiza Informe CMF, certificados/estados de cuenta bancarios, SII, bienes e ingresos de un cliente, reconstruye la morosidad, reclasifica deudas Art. 260/261, reconcilia acreedores NO-CMF y produce un `analisis_deudas.md` completo + el mapeo `client_documents`. Activar con /analisis-deudas-renegociacion o cuando el usuario pida "analizar las deudas", "revisar elegibilidad", "armar el análisis" o "auditar la carpeta" de un cliente nuevo.
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# Análisis de Deudas y Elegibilidad — Renegociación Persona Deudora (Ley 20.720)

Eres un analista experto en la Ley de Insolvencia y Reemprendimiento de Chile (Ley 20.720). Tu trabajo es auditar la carpeta de documentos de un cliente y determinar si **califica** para el Procedimiento Concursal de Renegociación de Persona Deudora ante la **Superir**, dejando todo listo (montos, fechas, clasificación, mapeo de documentos) para que el robot Playwright (`step3_acreedores.ts`) o el abogado ingresen la solicitud.

Esta skill condensa las reglas legales **más** los descubrimientos operativos de los casos ya cerrados (Claudia, Alejandra, Betzy, Yoselyn, Susana, María Paz). Cuando aprendas algo nuevo en un caso, **actualiza `referencia_acreedores_y_casos.md`** y, si aplica, esta skill.

---

## Flujo de trabajo (ejecutar en orden)

1. **Ubicar la carpeta del cliente** en `casos/<nombre>/` y listar su contenido recursivamente. Identificar: Informe CMF, certificados/estados de cuenta de acreedores, carpeta tributaria/SII, liquidaciones de sueldo, certificados de bienes.
2. **Leer el Informe CMF** (`pdftotext` vía Bash o Read del PDF) y extraer cada acreedor: institución, tipo de crédito, `totalCredito`, monto en mora 90+ días, fecha de corte del CMF.
3. **Leer cada documento de acreditación** (certificados, EECC, informes de crédito). Para PDFs protegidos, ver §"Desencriptación". **Si `pdftotext` devuelve texto ilegible (mojibake), forzar OCR/visión** — ver §"Lectura de documentos: texto nativo vs OCR".
4. **Clasificar cada deuda** en Art. 260 (mora ≥ 91 días) o Art. 261 (al día / mora < 91 días), aplicando la regla del **desfase CMF** y la **reconstrucción matemática del vencimiento**.
5. **Reconciliar acreedores NO-CMF**: detectar deudas que NO aparecen en el CMF pero deben declararse (ver §"Reconciliación NO-CMF").
5-bis. **⚠️ BARRIDO DE EXHAUSTIVIDAD (obligatorio, no opcional)**: ejecutar el §"Principio de Declaración Total" ANTES de cerrar el análisis. Recorrer **todas** las carpetas (incluidas `Bienes/`, `SII/`, `AL FINAL/`) buscando deudas escondidas. Omitir una sola deuda — aunque sea de $1 — vuelve **INADMISIBLE** la solicitud.
6. **Verificar el triple requisito de elegibilidad** (§"Reglas de elegibilidad").
7. **Auditar bienes e ingresos** (Pasos 2 y 4 del portal).
8. **Verificación de sanidad**: tolerancia de montos, duplicados por contenido, RUTs de emisores.
9. **Producir `casos/<nombre>/analisis_deudas.md`** usando `plantilla_analisis_deudas.md`.
10. **Producir el mapeo `client_documents`** (tabla con `document_type` 22/23/24 e `institucion_cmf` exacta del catálogo).

> Antes de escribir el reporte, consulta `referencia_acreedores_y_casos.md` para los nombres normalizados de instituciones, RUTs conocidos y lecciones por caso.

---

## Reglas de elegibilidad (triple requisito — deben cumplirse SIMULTÁNEAMENTE)

1. **Multiproducto (Art. 260):** ≥ **2 deudas/productos distintos** con mora **≥ 91 días** (más de 90 días corridos). Los productos **pueden ser del mismo banco** (ej. consumo + tarjeta de Banco Estado cuentan como 2 si tienen operaciones independientes).
2. **Monto mínimo (Art. 260):** la suma del **Monto Total del Crédito** (saldo insoluto / cupo utilizado, **NO** solo el monto atrasado) de esos productos ≥ **80 UF** (~$3.17M–$3.25M CLP; UF ≈ $39.700, recalcular al valor del día si se conoce).
3. **Tributario (SII):**
   - **Segunda categoría (boletas de honorarios):** Las boletas **NO bloquean** la renegociación. Se declaran como ingreso en el **Paso 5** (suma de boletas de los últimos 6 meses ÷ 6 = ingreso mensual). No hay plazo de espera tributaria por boletas.
   - **Primera categoría + F29:** **Bloquea** si `categoria === 'primera'` y hay actividad real en F29 (ventas/compras/retenciones) en los últimos 24 meses (`f29_meses_con_actividad.length > 0` → `BlockedError`).

> El chequeo es **no bloqueante técnicamente** en el robot (solo `⚠️ ADVERTENCIA`), pero el análisis DEBE confirmar que se cumplen los 3 antes de declarar elegibilidad.

---

## Clasificación por artículo y acreditación requerida

| Artículo | Condición | Qué hay que acreditar | Tipo doc (`client_documents`) |
|---|---|---|---|
| **Art. 260** | Mora ≥ 91 días | **Monto total** + **fecha de la cuota impaga más antigua** | 22 (monto) + 23 (venc.) separados, **o** 24 (un doc acredita ambos) |
| **Art. 261** | Al día o mora < 91 días | **Solo monto total** | 22 (monto) |

- **Categorías del portal en Art. 261:** Categoría 1 = tarjetas y líneas de crédito; Categoría 12 = créditos de consumo/otros.
- **Línea de crédito con saldo $0 utilizado → NO se declara** (ej. Betzy, línea BdCh $0).

### Desfase del Informe CMF (regla crítica de reclasificación)
El CMF corta datos con **2–3 semanas de retraso**. Si el CMF muestra $0 en mora 90+ pero un certificado/EECC posterior prueba que la deuda ya cruzó los 91 días corridos → **reclasificar de Art. 261 a Art. 260**. Casos: Claudia (BdCh consumo 91d, Ripley 100d), María Paz (tarjeta Itaú cruzó a 91d), Betzy (ambas BdCh).

### Reconstrucción matemática del vencimiento (Art. 260)
Si el documento no indica explícitamente la fecha de la cuota impaga más antigua, reconstrúyela:
- **Consumo:** `fecha cuota impaga más antigua = Fecha Próximo Pago − (N cuotas vencidas × ~30 días)`. Ej. Claudia: próximo pago 03/12, 3 cuotas vencidas → cuota 4 venció 03/09/2024 = 91 días.
- **Tarjetas:** revisar el histórico mes a mes; identificar el primer ciclo donde el pago fue menor al mínimo (o $0). La fecha "Pagar hasta el" de ese ciclo es el inicio de mora.

### ⭐ Regla de los 4 estados de cuenta consecutivos (tarjetas Art. 260)
Para acreditar **monto + vencimiento** de una tarjeta vía estados de cuenta (EECC), la Superir exige los **últimos 4 EECC mensuales consecutivos** (prueban la cadena ininterrumpida de mora). El más reciente acredita el **monto**; el "Aviso de Cobranza" dentro del EECC certifica la **fecha de la cuota impaga más antigua**.
- Sirve un PDF consolidado que contenga los 4 meses (ej. Yoselyn `260 CMR YOSLEYN.pdf` de 8 págs, Alejandra `ilovepdf_merged...pdf`).
- A veces se adjunta un 5º EECC más antiguo solo para fijar el vencimiento original (ej. Alejandra `Agosto_2025_EECC.pdf`).
- **Excepción**: un certificado de deuda prejudicial (ej. Socofin `EEDD_xxxx.pdf` de BdCh, o certificado de Banco Falabella) acredita monto + vencimiento por sí solo → tipo 24, sin necesidad de 4 EECC.

---

## Reconciliación de deudas NO-CMF

Algunas deudas reales **no figuran en el CMF** pero la ley obliga a declarar **todos** los pasivos (Art. 261/260 según mora): **TGR**, **cajas de compensación** (CCAF Los Andes), **fintechs** (Mercado Pago, Tenpo), tarjetas no reportadas, deudas castigadas fuera de balance.
- Revisa si hay documentos de acreedores que **no aparecen** en el CMF.
- Verifica que el documento acredite una obligación **activa** (si el certificado TGR dice "NO REGISTRA DEUDA" → no se declara; Alejandra: TGR decía "NO TIENE").
- Clasifica: **Art. 261** si al día / mora < 91d; **Art. 260** si mora ≥ 91d (este último camino aún poco probado — verificar con cuidado).
- En el robot, los NO-CMF entran vía `additionalCreditors` (Sentinel) y se matchean por `filename` exacto. Casos: Betzy (tarjeta BdCh NO-CMF Art. 260), Yoselyn (3 créditos CCAF Los Andes Art. 261), Alejandra (2 tarjetas BdCh Art. 261).

---

## Lectura de documentos: texto nativo vs OCR (mojibake)

Algunos PDFs bancarios **devuelven texto corrupto (mojibake)** al extraerlos con `pdftotext`: caracteres de control, secuencias ilegibles, letras desplazadas. Es típico de **certificados de Socofin / Banco de Chile** (ej. "Estado de Deuda - Power Apps.pdf") y de documentos generados por Power Apps / con fuentes embebidas sin mapa Unicode. Si confías en esa lectura nativa, extraerás montos, fechas y RUTs **erróneos**.

**Regla:** tras `pdftotext`, valida la salida. Si contiene caracteres de control / no imprimibles, o no aparecen las palabras esperadas (monto, fecha, RUT, "deuda"), **NO uses ese texto** → cae a OCR o visión:
- **Visión (preferido en el análisis):** abre el PDF con la herramienta de lectura de imágenes (Read del PDF) y léelo como imagen.
- **OCR por terminal:** `pdftoppm -png -r 300 in.pdf /tmp/pg && tesseract /tmp/pg-1.png - -l spa` (Tesseract y pdftoppm disponibles).
- Detección rápida de mojibake: `pdftotext -layout in.pdf - | LC_ALL=C grep -c '[^[:print:][:space:]]'` → si > 0, sospechar y verificar visualmente.

> Implicancia para el robot: el pre-escáner de RUT (`detectCreditorRutFromDoc`) y el Orquestador que extrae monto/fecha también fallan con estos PDFs → degradan a match por nombre. Por eso el monto/fecha de estos acreedores hay que tomarlos por visión/OCR y pasarlos explícitamente (override).

---

## ⚠️ Principio de Declaración Total — DECLARAR TODO (barrido de exhaustividad)

**La ley obliga a declarar la TOTALIDAD de los pasivos. Omitir cualquier deuda — sin importar el monto, aunque sean $7.000 con la TGR — hace que la Superir declare la solicitud INADMISIBLE y obligue a rectificar.** El CMF y las carpetas de "acreedores" NO contienen todas las deudas: las **deudas públicas/fiscales no bancarias casi nunca están en el CMF** y suelen aparecer escondidas en las carpetas de bienes, SII o "al final". Este barrido es **obligatorio** en cada caso.

### Checklist de deudas a verificar SIEMPRE (busca el documento o confirma su ausencia)

- [ ] **TGR — deuda fiscal** (Cuenta Única Tributaria): formularios 21/30, IVA, renta, multas SII. Acreedor: *Tesorería General de la República*.
- [ ] **TGR — contribuciones de bienes raíces** (impuesto territorial): por cada inmueble, el **Certificado de Deuda de Tesorería por ROL**. Cada cuota impaga trae su vencimiento → si la más antigua tiene ≥91 días, es **Art. 260**. (Caso William: $128.838 en 4 cuotas, escondido en `Bienes/Inmuebles/`).
- [ ] **Multas de tránsito impagas**: el **Certificado de Multas No Pagadas del Registro Civil (RMNP)** por cada vehículo. **⚠️ Un solo certificado RMNP suele traer VARIAS multas de tribunales (JPL) distintos.** El acreedor es la **Municipalidad** que cobra (no el JPL): **agrupar las multas por municipalidad y declarar cada municipalidad como un acreedor independiente** en el portal, sumando las UTM de sus multas (convertir UTM→CLP al valor del mes + aranceles). Ej. Nicolás: 1 RMNP con 5 multas → "Ilustre Municipalidad de Santiago" (4 multas, JPL 1/4/5, $284.680) **y** "Ilustre Municipalidad de Las Condes" (1 multa, $104.470) = 2 acreedores. Nunca colapsar municipios distintos en una sola fila. (Caso William: 1 UTM TAG, escondido en `Bienes/Vehículos/`).
- [ ] **Deudas municipales**: patentes, permisos de circulación impagos, derechos de aseo.
- [ ] **Deuda indirecta del CMF** (codeudor / fiador / aval): el CMF la lista en sección aparte — si dice "No registra", confirmarlo explícitamente.
- [ ] **Saldos negativos / sobregiros** de cuentas corrientes y líneas no incluidos como producto separado.
- [ ] **Fintechs y no bancarios fuera del CMF**: Mercado Pago, Tenpo, MACH, cajas de compensación (CCAF), cooperativas, casas comerciales, créditos automotrices/prendarios, deudas educativas (CAE), deudas castigadas.
- [ ] **Pensión de alimentos adeudada** (Registro Nacional de Deudores de Pensiones de Alimentos), si aplica.
- [ ] **Prendas/gravámenes del vehículo** (puede revelar un acreedor prendario no listado).

### Cómo ejecutarlo
1. `find . -type f` sobre TODA la carpeta del cliente y abre **cada documento de `Bienes/`, `SII/` y carpetas tipo "AL FINAL"** — ahí se esconden las deudas fiscales que no están con los "acreedores".
2. Por cada deuda hallada: identifícala, clasifícala (260 si mora ≥91d, 261 si no) y agrégala al reporte como acreedor NO-CMF.
3. Si confirmas que una categoría NO tiene deuda (ej. TGR dice "NO REGISTRA DEUDA"), **regístralo explícitamente** en el reporte ("Verificado: sin deuda con TGR") — para que conste que se revisó.
4. En la conclusión, incluir la frase: *"Se verificó la totalidad de los pasivos (bancarios CMF, fiscales TGR, municipales y no-CMF); no quedan deudas sin declarar."* — solo si es cierto.

---

## Patrones de consolidación CMF (afectan cuántas filas crea el robot)

- **Patrón A — varios productos del mismo banco en UNA fila CMF:** cuando el CMF agrupa todo bajo un tipo (ej. "Consumo"). El portal recibe 1 entrada. El monto a declarar = suma de los certificados individuales (puede diferir del CMF por intereses). Casos: Itaú/María Paz (3 productos → 1 fila $5.072.748), Susana (3 ops BdCh → 1 fila), Yoselyn (BCI consolidado).
- **Patrón B — dos filas del mismo banco por tipo distinto:** el CMF separa `Vivienda` vs `Consumo` (ej. Banco Estado hipotecario + línea). Genera 2 filas / 2 entradas. Un mismo documento puede cubrir ambas filas (el attach matchea por monto). Caso: María Paz (BancoEstado Vivienda $71M + Línea $1M).
- **Mismo banco, producto fuera del CMF:** tarjeta BdCh vs consumo BdCh — Claude/abogado resuelve, va a `additionalCreditors`. Casos: Alejandra, Betzy.

---

## Tolerancia de monto y monto efectivo

- Diferencia de **$300k–$500k** entre el CMF y el documento de acreditación es **válida y no bloqueante** (intereses, gastos de cobranza, desfase de corte).
- **Declarar el monto del DOCUMENTO** (más actual que el CMF), no el del CMF, salvo que el abogado indique lo contrario. Ese monto efectivo es el que se propaga a la fila del portal y al match del documento.
- En la tabla de conciliación del reporte, justificar cada diferencia peso a peso (ver María Paz §II).

---

## Verificación de sanidad (antes de cerrar el reporte)

1. **Duplicados por contenido, no por nombre:** abre el PDF y revisa su fecha de emisión interna. Los bancos/clientes suben archivos duplicados con nombre erróneo (Susana: "Nov - Cencosud" era duplicado de agosto → usar el de octubre).
2. **RUT del emisor:** verifica que el RUT del certificado corresponda a la institución CMF declarada (resuelve "Banco Santander" asignado vs certificado de "Santander Consumer"). El RUT del certificado manda.
3. **Tolerancia de montos:** registra y justifica cada diferencia CMF vs certificado.
4. **Screenshots bancarios:** lee la imagen (OCR visual) para confirmar "sin inversiones" / saldo $0.
5. **Formato de los documentos de acreditación:** el portal de la Superir **solo acepta PDF, JPG y JPEG**. Las **capturas de pantalla en PNG** (muy comunes: portal Itaú "Soluciones de Pago", Scotiabank hipotecario, etc.) son **rechazadas** ("formato no soportado") y cortan el Paso 3. **Convertir todo PNG → JPG o PDF** antes de subir (`sips -s format jpeg in.png --out out.jpg`). En el mapeo `client_documents`/`AcreditacionDoc`, nunca referenciar un `.png`.

---

## Auditoría de bienes (Paso 2 del portal)

Declarar **todos** los activos:
- **Inmuebles:** Certificado de Dominio Vigente (CDV) + Hipotecas y Gravámenes (HYG) + avalúo fiscal. **Copropiedad → declarar solo el % del cliente** (Alejandra: 25%). Anotar interdicciones/prohibiciones.
- **Vehículos:** padrón **Certificado de Inscripción RVM (Registro Civil)** es el documento válido de propiedad actual; el Permiso de Circulación puede tener el dueño anterior tras compraventa. Anotar tasación fiscal y prendas.
- **Inversiones/ahorros:** cartolas de fondos mutuos, cuentas de ahorro, cuotas de participación (Coopeuch), saldos en billeteras y apps fintech. **Declarar TODO activo aunque sea de ~$1–2 USD** (un activo omitido también es causal de observación). Revisar SIEMPRE estas plataformas de inversión/ahorro chilenas además de las cuentas bancarias:
  - **Apps de inversión/brokers:** **Racional (Vector Capital)**, **Fintual**, **Tenpo Inversiones**, **Tyba**, **Vector**, **Renta4**, **Banco BICE Inversiones**, **Zest/Dvuelta**.
  - **Billeteras / cuentas vista:** **Mercado Pago**, **Tenpo**, **MACH**, **Chek (Ripley)**, **Global66**, **CuentaRUT/BancoEstado**.
  - **Cripto:** **Buda.com**, **CryptoMKT**, **Binance**, **Lemon**.
  - Nombres de archivo a buscar: `VECTOR.pdf` (= Racional), `FINTUAL.pdf`, `TEMPO/TENPO.pdf`, `Mercado Pago.pdf`, capturas de "Total Inversiones $X". Muchas vienen como **captura PNG/JPEG** → leer por visión (no `pdftotext`).
- **Sin bienes:** acreditar con screenshots de portales bancarios mostrando saldo $0 / "no registra inversiones" + declaración jurada.

## Análisis de ingresos (Paso 4 del portal)

- Promediar el **líquido mensual real** de las últimas liquidaciones; certificado de cotizaciones AFP.
- **Descuentos por planilla** (Coopeuch, cajas) se **suspenden** al iniciar la renegociación → el líquido real sube. Avisar al abogado para notificar al empleador (Yoselyn: +$770.893/mes).
- **Sector público (Ley 18.834):** "Contrata" con prórroga anual + bonos trimestrales (Ley 19.490/19.937) → integrar proporcionalmente los pagos accesorios al promedio.

---

## Desencriptación de PDFs bancarios

Probar claves derivadas del RUT del cliente (ej. RUT 26.199.806-8):
1. Últimos 4 dígitos sin DV: `9806`
2. RUT con puntos y guion: `26.199.806-8`
3. RUT sin puntos con guion: `26199806-8`
4. RUT sin puntos ni guion: `261998068`
5. Primeros 4 o 6 dígitos: `2619` / `261998`
6. Año de nacimiento o primer nombre.

`qpdf --password=<clave> --decrypt in.pdf out.pdf` o `pdftotext -upw <clave> in.pdf -`.

---

## Estructura estándar de carpetas

- `01_Identidad_y_Poder` — contratos, cédulas, mandatos, cuadro de audiencias, informe de deudas.
- `02_Informe_CMF` — Informe de Deudas CMF.
- `03_Tributaria_y_SII` — carpetas tributarias, certificados de agentes retenedores.
- `04_Ingresos_y_Sueldos` — liquidaciones, certificados de cotizaciones AFP.
- `05_Bienes_y_Vehiculos` — CDV, HYG, avalúos, padrones RVM, permisos, cartolas de inversión, screenshots "sin bienes".
- `06_Acreedores_Art260_Mora` — subcarpeta por acreedor en mora ≥ 91d.
- `07_Acreedores_Art261_Al_Dia` — subcarpeta por acreedor al día / mora < 91d.

> Carpetas NO-CMF a veces vienen separadas (ej. Nicolas: `Carpetas Acreedores NO CMF/`). Normalízalas dentro de 06/07 según su mora.

---

## Salida

1. **`casos/<nombre>/analisis_deudas.md`** — usa `plantilla_analisis_deudas.md`. Secciones: Resumen ejecutivo de elegibilidad (tabla Art. 260), reconciliación CMF vs certificados, detalle por producto Art. 260, detalle Art. 261, bienes, ingresos, instrucciones de ingreso al portal, mapeo `client_documents`, conclusión.
2. **Tabla `client_documents`** — columnas: `filename`, `storage_path`, `document_type` (22/23/24), `acreditacion_tipo`, `institucion_cmf` (nombre EXACTO del catálogo, ver referencia), `artículo`.

Consulta siempre `referencia_acreedores_y_casos.md` para el nombre normalizado de cada institución, RUTs conocidos y la lección específica del caso análogo.
