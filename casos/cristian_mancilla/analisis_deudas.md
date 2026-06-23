# Análisis de Deudas — Cristian Alberto Mancilla Medina

> **Caso de comparación contra el abogado (P0.d).** Reconstrucción de la elegibilidad y el mapeo
> de acreedores a partir del CMF + los documentos que **usó el abogado**, y comparación fila por
> fila contra la solicitud real (screenshots `abogado_acreedores_260.png` / `abogado_otros_acreedores_261.png`).

## Identificación

| Campo | Valor |
|---|---|
| Nombre | CRISTIAN ALBERTO MANCILLA MEDINA |
| RUT | 16.587.870-1 |
| Domicilio | Reina Sofía 328, **Valdivia** (Región de Los Ríos) |
| Email | mancillamedina@gmail.com |
| Categoría tributaria | **Segunda Categoría** (boletas de honorarios — Consultor científico/ambiental) → **NO bloquea**; ingreso al Paso 5 |
| CMF | `informe_deudas_16587870-1`, emitido 15/06/2026, **info al 05/06/2026** |
| Deuda total CMF | $156.489.294 |

⚠️ **Caso fuera de Región Metropolitana** (Valdivia / Los Ríos). El dashboard y `portal_select_values.json`
solo tienen comunas RM → la comuna **Valdivia** y la región **Los Ríos** caerían a texto libre / no mapeadas
en el **Paso 1** (`selectBootstrap`). **Riesgo de Paso 1** (ver "Riesgos del run").

---

## CMF — 13 productos (corte 05/06/2026)

| # | Institución | Tipo | Otorg. | Total CMF | Vigente | 30-59 | 60-89 | **90+** |
|---|---|---|---|---|---|---|---|---|
| 1 | Banco del Estado (2)* | Comercial | 06/12/2023 | $136.916.555 | todo vigente | – | – | $0 |
| 2 | CCAF Los Andes | Consumo | 06/10/2025 | $1.227.754 | vigente | – | – | $0 |
| 3 | **Banco Santander** | Consumo | 09/02/2026 | $6.891.901 | $6.424.975 | $155.642 | – | **$311.284** |
| 4 | Banco del Estado | Consumo | 13/10/2023 | $5.456.635 | vigente | – | – | $0 |
| 5 | CCAF Los Andes | Consumo | 09/06/2025 | $973.492 | vigente | – | – | $0 |
| 6 | Banco Santander | Tarjeta | 23/02/2015 | $2.472 | vigente | – | – | $0 |
| 7 | Banco del Estado | Tarjeta | 16/09/2021 | $69.741 | vigente | – | – | $0 |
| 8 | Banco del Estado | Tarjeta | 16/09/2021 | $338.248 | vigente | – | – | $0 |
| 9 | **Promotora CMR Falabella** | Tarjeta | 30/08/2014 | $4.157.931 | $3.917.192 | $86.252 | $77.556 | **$76.931** |
| 10 | Banco del Estado | Tarjeta | 16/09/2021 | $13.373 | vigente | – | – | $0 |
| 11 | Banco Santander | Línea Créd. | 04/03/2026 | $71.636 | $0 | – | $71.636 | $0 |
| 12 | Banco Santander | Línea Créd. | 21/04/2014 | $200.000 | vigente | – | – | $0 |
| 13 | Banco del Estado | Línea Créd. | 30/09/2025 | $169.556 | vigente | – | – | $0 |

\* CMF lo rotula **"Comercial" con garantías (Nota 2)**, pero el documento real es un **crédito hipotecario**
(BancoEstado refinanciamiento UF, op 116725370, garantía hipoteca 1er grado). Mismo artículo (261, al día),
pero el rótulo del CMF engaña.

### Elegibilidad
- **Productos con mora ≥91 días: 2** → Santander Consumo (#3, $311.284 en 90+) y CMR Falabella (#9, $76.931 en 90+). ✅ **Cumple el mínimo de 2**.
- **Suma `totalCredito` de esos 2 = $11.049.832 ≈ 280 UF** ≫ 80 UF. ✅ **Cumple por monto** de sobra.

---

## Lo que hizo el abogado (solicitud real)

### 🟦 Obligaciones 260 (mora ≥91d → Acredita **Monto (22) + Vencimiento (23)**)

| Acreedor | Monto | Vencimiento | UF | Documento usado | Fuente del monto / fecha |
|---|---|---|---|---|---|
| Banco Santander | $6.985.718 | 05/03/2026 | 175,44 | `CamScanner 09.56` (Pago total préstamo Consumo 6690) + `vencimiento 5-3` (pantallazo "Cuota 1/67 — 05/03/2026 — Vencida") | **payoff total** + **1ª cuota vencida** |
| Promotora CMR Falabella | $4.168.214 | 05/03/2026 | 104,68 | `ilovepdf_merged (9)` (EECC CMR multi-período) | **Costo Monetario Prepago** ($4.168.214) + Aviso Cobranza "cuota 05-marzo" |
| **Total** | | | **280,12** | | |

### 🟨 Otros Acreedores 261 (al día → solo Acredita **Monto (22)**)

| Acreedor | Monto | Documento usado | CMF | Fuente del monto |
|---|---|---|---|---|
| Banco del Estado (hipotecario) | $138.932.112 | `CamScanner 09.59` (liquidación hipotecario) + `Comprobante pago` (cuota 22/360 al día) | #1 ($136.9M) | liquidación al 10/06/2026 |
| Banco del Estado (consumo) | $5.884.108 | `CamScanner 09.58` (liquidación consumo) | #4 ($5.456.635) | liquidación al 11/06/2026 |
| Banco del Estado (línea créd.) | $149.465 | `Captura 21.44` (portal: "Línea de crédito — Has usado $149.465") | #13 ($169.556) | **saldo en vivo del portal** |
| CCAF Los Andes | $1.220.547 | `caja los andes` (cert. portabilidad, 2 productos) | #2 ($1.227.754) | "Monto total a pagar" |
| CCAF Los Andes | $967.439 | `caja los andes` (mismo cert.) | #5 ($973.492) | "Monto total a pagar" |
| Banco Santander (tarjeta) | $2.444 | `80_16073…` (EECC Visa Gold 9797) | #6 ($2.472) | Costo Monetario Prepago |
| Tesorería General (TGR) | $18.537 | `descargar (2)` (cert. deuda rol 243-00760-011, Reina Sofía 322) | **NO-CMF** | Total Deuda Morosa |
| Tesorería General (TGR) | $19.049 | `descargar (3)` (cert. deuda rol 243-02454-281, Los Molinos Altos) | **NO-CMF** | Total Deuda Morosa |
| **Total** | | | | **3.696,57 UF** |

**Total solicitud = 10 filas** (2 en 260 + 8 en 261).

---

## Comparación robot (esperado) vs abogado — y divergencias

> ⚖️ **Lente de lectura: la REGLA 260/261 confirmada por el abogado (2026-06-22)** — ver memoria
> `project_requisito_sesion_art260`. Una deuda con mora ≥91d va a **260 SOLO SI hay documento que acredite
> MONTO **y** VENCIMIENTO** (tipo 22 + 23); si no se puede acreditar → **261**. El criterio decisivo NO es el
> flag 90+d del CMF, sino la **acreditabilidad**. Y los abogados ponen el **mínimo (2 productos) en 260** porque
> ese es el piso para calificar; el resto → 261. **El caso de Cristian es una aplicación limpia de esta regla,
> no un patrón nuevo.**

### ✅ Coincidiría (con las reglas actuales)
- **2 en 260**: Santander Consumo + CMR Falabella. Son los únicos con 90+ en CMF **y** los únicos con
  acreditación de **monto (payoff) + vencimiento (1ª cuota impaga)** → ambos califican para 260 por la regla
  (y son justo el mínimo de 2). El Centinela (REGLA 9) extraería `monto = payoff` y `fecha = 1ª cuota impaga`
  → mismos valores que el abogado.
- **Monto 260 = payoff, no saldo CMF** (ya implementado vía `cmfDocumentOverrides`). ✓
- **Adjunción 260 = tipo 22 + 23** (ya implementado). ✓
- **CCAF Los Andes ×2** en 261 (alias "Caja Los Andes" → "CCAF Los Andes", RUT 81.826.800-9, ya en catálogo). ✓
- **261 solo tipo 22, sin vencimiento**. ✓

### ⚠️ Divergencias a vigilar (lo que el robot haría DISTINTO)

1. **Sobre-declaración esperada en 261 (≠ Gabriel, que sub-declaró).** El abogado **omitió 5 productos CMF chicos
   al día** (sin certificado a mano): BancoEstado Tarjeta $69.741 (#7), $338.248 (#8), $13.373 (#10) y Santander
   Línea $71.636 (#11) + $200.000 (#12). Esto **es la regla en acción**: el abogado declara en 261 lo que puede
   acreditar (o lo material); lo trivial al día sin doc lo omite. **El robot, partiendo del CMF, los agregaría a 261.**
   Divergencia a documentar — no es un bug de clasificación, es el "filtro ¿hay documento?" que el robot no tiene.

2. **Montos triviales SÍ se declaran cuando hay documento.** El abogado declaró Santander $2.444 (0,06 UF) y
   TGR $18.537/$19.049 (~0,47 UF) porque tenía el certificado. ⚠️ Nuestra **regla de multiproducto excluye < 1 UF**
   — verificar que esa exclusión **no aplique** a productos 261 individuales con documento (solo al split
   multiproducto de un cert. de liquidación). Acá Santander tarjeta no es multiproducto → el $2.444 debería entrar.

3. **Mismo banco en 260 Y 261 (Santander).** Consumo ($6.98M, acreditado monto+venc) en 260 + Tarjeta ($2.444,
   al día) en 261. El robot debe separar por estado/acreditación del producto, **no colapsar por banco**.

4. **TGR (contribuciones) en 261, no 260.** Dos roles (Reina Sofía 322 + Los Molinos Altos), morosos pero con
   vcto **30-Abr-2026** (≈36 días al corte CMF → **<90d → 261**). 🔑 **A diferencia de William Montero (TGR en 260,
   ≥90d)**: la clasificación 260/261 de la TGR depende de los **días de mora**, igual que cualquier acreedor
   (consistente con la regla). NO-CMF detectado por el Centinela; Claude debe clasificarlo **261**. **A vigilar**:
   que no los mande a 260.

5. **Monto 261 desde documento fresco / portal en vivo** ($149.465 de la línea BancoEstado salió de un pantallazo
   del portal, no del CMF $169.556). El robot usaría el monto del CMF salvo override. Divergencia menor de monto.

6. **CMF rotula el hipotecario como "Comercial".** El #1 ($136.9M) es en realidad un hipotecario. No cambia el
   artículo (261, al día) pero el nombre de producto y el monto (liquidación $138.9M > CMF $136.9M) difieren.

### 📌 Implicancias para la automatización (alineadas con la memoria)
- **[Regla 260/261 — gap conocido]** El criterio es **acreditabilidad (monto+venc) + mínimo 2 para calificar**, no
  el flag 90+d. ⚠️ Hoy el Mapeador, ante un **260-directo SIN documento**, marca "documento faltante" y **OMITE
  todo el Paso 3** — debería **de-reclasificar ese producto a 261 y seguir**. Pendiente (ver
  `project_gabriel_comparacion_gaps` + caso Néctor en `project_requisito_sesion_art260`). En Cristian no debería
  dispararse (los 2 de 260 tienen doc), pero confirmarlo en el run.
- **[Sobre-declaración 261 sin doc]** Productos CMF **al día y sin certificado** podrían marcarse "opcional /
  requiere doc" en vez de declararse a la fuerza — para acercarse al criterio del abogado. (Hallazgo de este caso.)
- **[TGR por días de mora]** Reforzar en el prompt del Centinela que la TGR/contribuciones se clasifican 260/261
  por días de mora (1ª cuota impaga vs corte), no por defecto a 260.
- **[Exclusión <1 UF]** Acotar la exclusión de montos triviales **estrictamente** al split multiproducto; no debe
  descartar productos 261 individuales con documento (el abogado declaró $2.444).
- **[Vencimiento 260]** Confirmar que `delinquency_start_date` = **fecha de la 1ª cuota impaga** (no el corte CMF
  ni un placeholder). Acá ambos 260 dieron 05/03/2026 (1ª cuota vencida) — el robot debe replicarlo.

---

## Riesgos del run (cuando haya tokens de API)
1. 🔴 **API Anthropic sin saldo** (bloqueante global, ver `task.md` P0.d) — el Centinela no corre sin créditos.
2. ⚠️ **Paso 1 fuera de RM** (Valdivia / Los Ríos) — región/comuna no mapeadas; revisar `selectBootstrap`.
3. ⚠️ **Docs ~frescos**: CMF 15/06, liquidaciones 29/05–11/06, TGR 18/06, CCAF emisión 27/05 (vigencia 25/06),
   Visa Santander 28/05 → casi todos < 30 días. Si alguno tira `expired_certificate`, correr la **comparación**
   con `BYPASS_DATE_CHECK=true` (solo para comparar; nunca en envío real).
4. ⚠️ **Sobre-declaración esperada**: el robot probablemente agregue 3-5 filas 261 que el abogado omitió.
   Documentar la diferencia en el cierre del caso.

---

## Inventario de documentos (carpeta del abogado, reorganizada)
Ver `documentos/` tras la reorganización. Mapeo doc → acreedor:

| Doc (nombre final) | Acreedor | Art. | Tipo cert |
|---|---|---|---|
| `acreedores_cmf/Santander_consumo_pago_total.pdf` | Santander Consumo | 260 | monto (22) |
| `acreedores_cmf/Santander_consumo_vencimiento.pdf` | Santander Consumo | 260 | vencimiento (23) |
| `acreedores_cmf/CMR_Falabella_eecc.pdf` | CMR Falabella | 260 | monto + venc |
| `acreedores_cmf/BancoEstado_hipotecario_liquidacion.pdf` | BancoEstado (hipotecario) | 261 | monto |
| `acreedores_cmf/BancoEstado_hipotecario_comprobante_pago.pdf` | BancoEstado (hipotecario, respaldo al día) | 261 | respaldo |
| `acreedores_cmf/BancoEstado_consumo_liquidacion.pdf` | BancoEstado (consumo) | 261 | monto |
| `acreedores_cmf/BancoEstado_linea_credito_portal.pdf` | BancoEstado (línea) | 261 | monto |
| `acreedores_cmf/CCAF_LosAndes_certificado.pdf` | CCAF Los Andes (×2) | 261 | monto |
| `acreedores_cmf/Santander_tarjeta_visa_eecc.pdf` | Santander Tarjeta | 261 | monto |
| `acreedores_no_cmf/TGR_contribuciones_rol_00760.pdf` | TGR (Reina Sofía 322) | 261 | monto |
| `acreedores_no_cmf/TGR_contribuciones_rol_02454.pdf` | TGR (Los Molinos Altos) | 261 | monto |
</content>
