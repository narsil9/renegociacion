# Tareas: Automatización Superir — Estado Actual

> **Acá viven SOLO las tareas vigentes.** El historial de tareas cerradas está en **git**
> (commits) y en las **memorias** de Claude (`memory/`, casos cerrados `project_*_closed`,
> arquitectura, reglas). No se acumulan planes ya cumplidos.

---

## ⏸️ PAUSA (2026-06-29) — esperando al supervisor

**La integración está EN PAUSA hasta hablar con el supervisor.** Motivo: su buzón de documentos
(`renegociacion_audit_pdf`) está **casi sin clasificar** (`tipo_documento` 88% `sin_clasificar`;
`descripcion_detectada` solo 1.5% poblada) → todo mezclado en una sola tabla. Le voy a **proponer
reordenar las tablas** (pocas tablas por destino: CMF / SII / certificados / cédula) para que lo que
nos sirve llegue ya separado y no tengamos que detectar el tipo por contenido cada vez.
Propuesta redactada en `docs/integracion/mapa-fuentes-produccion.md` §7. **No avanzar hasta su respuesta.**

## 🔗 NORTE — Convergencia con el dashboard del supervisor

Pipeline objetivo: **su dashboard** (`rp_renegociaciones-auth-admin`, prod Supabase `ton…`)
recopila/clasifica docs → marca **"cliente listo"** → el abogado aprieta **Ejecutar** (encola un job)
→ **nuestro worker** corre Pasos 1→5 en el portal. Él = aguas arriba; nosotros = ejecutor aguas abajo.
Llave-puente = **RUT**.

- Detalle de arquitectura: `CLAUDE.md` → "🔗 Integración futura".
- Mapa verificado de fuentes de prod: `docs/integracion/mapa-fuentes-produccion.md`.
- Memoria: `project_convergencia_dashboard_supervisor`.

**Arquitectura de conexión DECIDIDA (2026-06-27): proyección por-caso on-demand.**
No clonar ni sincronizar todo. Al ejecutar, un **proyector read-only** de `ton…` materializa
**SOLO ese caso** al sandbox (`clients` + `client_documents` + descarga de PDFs) → el worker corre
como hoy (lee del sandbox) → se purga al terminar. **Prod intacto (solo lectura); el worker no cambia.**

---

## 🎯 EN CURSO — Integración por etapas (probar primero, conectar al final)

### Etapa 1 — Camino del worker SIN tocar prod ✅
Validado: el worker corre 1→4 leyendo del sandbox (casos Miguel/Néctor/Cristian, 3 runs `success`,
2026-06-27). Gate I2 + dedup NO-CMF→CMF commiteados.

### Etapa 2 — Proyector de caso ✅ (probado E2E 2026-06-28)
- [x] **Proyector `ton… → sandbox` (READ-ONLY)** — `tools/project_case.ts` (MODE=stage|write). Selecciona el caso más completo, mapea Paso 1 a los enums del portal (placeholders para DOB/profesión/comuna faltantes, credenciales de Pato, `airtable_id=null`), descarga CMF/CT/AR/certs y upserta `clients` + `client_documents` en el sandbox. **CT/AR salen de `mac_mini_jobs.result.storage_path`** (NO `pdf_path`, que es ruta local). Verificado: materializó el caso de prueba completo (`client_id d5b77dbe…`).
- [x] **Test E2E (worker queue, `dry_run=false`)** — `tools/run_projected_test.ts`. Resultado: job **`success`**, **Pasos 1, 2 y 4 cargados** en el portal. **Probó la arquitectura completa** proyector→sandbox→worker→portal.
- [x] **Bug general corregido — Centinela crasheaba con adjuntos-imagen** — Muchos certs del cliente son **fotos/capturas PNG/JPEG** (en `audit-attachments`). `pdftoppm` fallaba → "Couldn't read xref" → job `failed`. Fix en `src/utils/ocr_helper.ts`: detecta imágenes por **magic bytes** y las OCRea directo con tesseract; los fallos de `pdftoppm` **degradan a vacío** en vez de tumbar el job. (Producción.)
- [ ] **🎯 Paso 3 NO declaró — matching de institución (EN CURSO).** El worker confirmó *"el cliente califica"* pero omitió el Paso 3 porque 3 docs no matchearon su acreedor del CMF:
  - **Tenpo Payments (CMF)** vs "Tenpo Prepago" (resolver) → faltaba alias.
  - **Santander Consumer Finance Limitada** → resolver lo dejó en null (el doc trae el RUT del cliente, no del emisor).
  - **Banco Falabella línea** → el resolver lo mal-etiquetó como "CMR Falabella".
  - **Solución elegida (ordenada):** columna **`nombres_alternativos`** en `acreedores_canonicos` (sandbox) + crosswalk vivo. Ver tareas abajo.
- [ ] **Purga del caso del sandbox al terminar** (pendiente; hoy queda materializado para depurar).

### Etapa 2b — Matching por alias-como-dato (mejorar el catálogo) 🎯 PRÓXIMO
- [ ] **CORRER `supabase/migration_sandbox_v7.sql` en el SQL Editor del sandbox `fnz…`** — agrega la columna `nombres_alternativos text[]` a `acreedores_canonicos` + siembra las variantes verificadas (Tenpo Payments→Tenpo Prepago 76967692-9; Santander Consumer Finance Limitada→Santander Consumer Chile S.A. 76002293-4; forma larga CCAF→CCAF Los Andes 81826800-9). **DDL no se puede por REST → lo corre el usuario. Nunca en prod.**
- [ ] **`acreedor_matcher.ts` debe LEER `nombres_alternativos`** — plegarlas en la resolución de nombres (hoy usa el mapa `ALIASES` hardcodeado). Es lo que cierra el círculo para que el Paso 3 declare.
- [ ] **Re-correr el test** tras 1+2 → verificar que el Paso 3 declara (Tenpo en 260; los 261 con su monto) contra el baseline (`scratchpad/projected_case/analisis_deudas.md`).
- [ ] **Crosswalk vivo** `docs/acreedores-crosswalk.md` — registrar CMF/cert name → canónico → RUT por caso. **Regla de oro: verificar que el RUT de la fila sea la MISMA empresa que el alias** (cert > catálogo; ojo nombres parecidos de empresas distintas).
- [ ] **(integración) Puente doc↔clasificación rota** — su `renegociacion_documento_match` clasifica bien (nombres alineados al CMF) pero está keyeada por `drive_file_id` y `documentos_drive` viene vacío → no se puede linkear por documento a nuestros archivos. Para consumirla en runtime hace falta una **llave compartida** (hash de contenido / id de doc) — item para el supervisor. Hoy se usa como referencia para el crosswalk.

### Etapa 3 — Conectar el botón "Ejecutar" (con el supervisor)
- [x] **Contrato de conexión redactado** *(2026-06-28)* — `docs/integracion/contrato-conexion-ejecutar.md`: trigger (Ejecutar→job, worker proyecta on-demand), gate "cliente listo" (precondiciones del portal exactas), brechas Paso 1 + resolución, puente doc↔clasificación, decisiones a acordar 🤝. **Artefacto para pasarle al supervisor.**
- [ ] **Acordar con el supervisor** (🤝): mecanismo del trigger (insert directo en `automation_jobs` recomendado), quién proyecta (nuestro worker on-demand), llave del job (`rut`/`airtable_id`), acceso read-only estable a `ton…`, y que su gate "listo" codifique las precondiciones del portal.
- [ ] **Productizar el proyector** — sacar `tools/project_case.ts` a `src/` (módulo del worker) y que el worker proyecte on-demand al tomar un job con `airtable_id`/`rut`.

---

## 🚧 Bloqueante real para producción (Frente B — producto, con el supervisor)

- [ ] **`fecha_nacimiento` — fuente: la CÉDULA del cliente** *(2026-06-28/29)*. `core.persona.fecha_nacimiento` vacío (0/1.494), pero la **cédula** la trae (todos los formatos). Es **campo a EXTRAER** vía visión (mejora #1, en el worktree), no dato inexistente.
  - ⚠️ **Cobertura HOY baja** (auditado 2026-06-29 con `tools/audit_cedula_source.ts`): solo **~17 de 426** clientes con docs tienen una cédula identificable, y casi ninguna clasificada por él (su buzón está crudo). → mientras él no clasifique, **detectamos la cédula por contenido de nuestro lado** (sobre los `sin_clasificar` del RUT). En pruebas, placeholder.
- [ ] **`profesion`** — usar **`core.persona.profesion`** (946/1.494 = 63%, texto libre → mapear al enum). **NO la cédula** (la chilena nueva post-2013 NO imprime profesión). **`region`** derivable de comuna; **`ocupacion`** sin fuente hoy (placeholder/pedir).

---

## 🆕 Paso 5 (Ingresos) — construido y validado E2E (2026-06-29)

Pipeline nuevo, general para todos los clientes (no hardcodeado al caso):
`gatherStep5Input` (worker) → `runIngresosAgent` (Claude lee docs NATIVO → hechos) →
`income_extractor.ts` (TS blinda la estructura: líquido a pagar, descuentos voluntarios,
promedio por tipo, crosswalk a los 2 enums del portal) → `fillStep5` (Playwright).

- **Archivos**: `src/utils/income_extractor.ts`, `src/agents/ingresos_agent.ts`,
  `src/automation/step5_ingresos.ts`; integrados en `all_steps.ts` y `worker.ts`. Lecciones en
  `lecciones/paso5-ingresos.md` (L1–L21 + **playbook de extracción para el LLM** + **reglas oficiales
  Superir** verificadas: manual + listado).

### Endurecimiento (sesión 2026-06-29, branch `paso-5`)
- **Capa determinista BULLETPROOF** ✅ — `income_extractor.ts` revisado y blindado: dedup de períodos
  duplicados, multi-empleador (una fuente por RUT pagador, se suman), descuentos legal/voluntario/ambiguo
  (anticipos/sindicato NO se suman; conciliar préstamos), modo `subsidio` (licencia médica fragmentada +
  dedup + reconstrucción por mes), `parsePeriodKey` robusto, guardas de finitud, red anti-error por período,
  alerta UF, conflicto sueldo↔licencia. **Suite de pruebas: 91 unit (incl. fuzz 1000×) + 5 casos reales,
  `npm test` corre todo.** Revisión propia (H1–H5) + adversaria independiente (P1.1/P1.3/P1.4a/P2.1/P2.2/P2.3/P3.1) cerradas.
  Doc: `casos/paso5_pruebas/REVISION_Y_PLAN.md`. **Validado con 5 casos reales** (Jorge $2.162.230, Alejandro,
  Alejandra Fix1, Alex 2-empleadores, María Elisa licencia médica) — análisis del analista en `casos/paso5_pruebas/PLAN.md`.
- **Agente: una llamada por documento** ✅ — `ingresos_agent.ts` refactorizado (handoff del Paso 3,
  `mejoras-centinela-lector-pdf.md`): 1 llamada/doc + retry ante vacío + `doc_type` + `rut_pagador`→`source_key`
  + moneda + nunca-$0. Más estable que la mega-llamada.
- **2º lote `renegociacion_docs` (11 clientes) validado** ✅ — leí nativo actuando como el LLM y corrí toda
  la cadena determinista. **4 fixes GENERALES nuevos (sin romper regresión, verificado):** L15 varios pagos
  del MISMO mes se SUMAN (divisor = meses, no líneas); L16 mes PARCIAL (días<28, licencia) se EXCLUYE a favor
  de meses completos (campo `dias_trabajados`, `PARTIAL_MONTH_DAYS=28`); L17 APV es voluntario aunque la
  etiqueta diga "en AFP"/use puntos ("A.P.V.I.") → gana sobre el match legal; L18 honorarios CON testigo
  (cierra C6) + alerta de coexistencia honorarios↔sueldo. Lecciones L19–L21 ("Alcance Líquido" format-dependent,
  "PRESTAMO X" vs nombre a secas, período del contenido no del filename / filtrar no-ingresos / cert encriptado).
  **Suite ampliada: `npm test` = 106 unit (B10 nuevo) + 5 + 11 casos, exit 0; build prod limpio.** Archivos:
  `casos/paso5_pruebas/{fixtures_renegociacion_docs,run_renegociacion_docs}.ts`.
- **Preguntas de criterio para el abogado** 📋 — `PREGUNTAS_ABOGADO_PASO5.md` (raíz): 8 preguntas con cliente,
  documentos a mostrar, líneas/números exactos, problema, impacto en $ y pregunta concreta (Coopeuch a secas,
  honorarios concurrente/secuencial, bruto/líquido + ventana, mes parcial, anticipos, aguinaldos, trimestrales,
  ahorro devuelto). Las respuestas se vuelven reglas generales (lecciones).
- **3er lote `casos_constanza_mulchi` (30) + 1er caso con VERDAD-TERRENO REAL del abogado** ✅
  (2026-07-01, `6fbe593`) — leí nativo los 30 casos + el caso **Alfonso Martínez** (screenshots del portal
  de la abogada). El motor determinista dio **$2.033.410 idéntico al peso** a lo que declaró la abogada
  (3 liquidaciones Buk, empleador único). **6 fixes generales del lote (L27–L32)** + **L33–L35** (liquidación
  líquido manda sobre resumen SII imponible; "LÍQUIDO A RECIBIR" sinónimo; robustez de detección de docs).
  Arnés `casos/paso5_pruebas/{run_constanza,fixtures_constanza/*.json}` (28/31). **Suite: 132 unit + 5 + 11 + 28/31.**
- **L35 — falso negativo silencioso RESUELTO** ✅ — `gatherStep5Input` ya NO depende del keyword del filename
  (un `ilovepdf_merged.pdf` real se perdía → Paso 5 omitido en silencio). Nueva regla general: candidato a
  ingreso = todo lo que NO es cert de acreedor (por metadata `institucion_cmf`/`acreditacion_tipo`/`document_type`,
  no por nombre); lo que se cuele lo descarta el LLM. + si no hay docs de ingreso, el flujo completo emite
  `automation_alert` (step 5, needs_review) en vez de omitir sin avisar.
- [ ] **Fase 2 (lectura nativa real) PENDIENTE — esperando API.** Runner listo:
  `casos/paso5_pruebas/run_native.ts` (lee los PDFs reales con Claude → mismos hechos → `computeIncomes`).
  Comando en `casos/paso5_pruebas/README.md`. Confirma que la lectura real reproduce los montos hardcodeados.
  **Los fixtures del lote (40+ casos con hechos + esperado) son ahora el test de regresión del prompt.**

### Pendientes Paso 5
- [ ] **CORRER `supabase/migration_sandbox_v8_ingresos.sql`** en el SQL Editor del sandbox
  (agrega `'ingresos'` al CHECK de `agent_runs.agent_type`). DDL → lo corre el usuario.
- [ ] **`fillStep5` DRY_RUN no limpia el borrador** — agregar auto-cleanup como en Paso 2/3.
- [x] ~~Honorarios (Fix 2) sin testigo~~ — **RESUELTO** con 3 testigos reales (Irene/Jaime/Noelia, lote
  `renegociacion_docs`). Camino honorarios validado (Informe Anual SII, bruto/12, coexistencia con sueldo).
  Queda solo el **criterio** del abogado (bruto vs líquido, ventana 6/12, concurrente/secuencial) → P2/P3.
- [ ] **Verdad-terreno del abogado** → responder `PREGUNTAS_ABOGADO_PASO5.md` (8 preguntas de criterio:
  Coopeuch a secas, honorarios concurrente/secuencial + bruto/líquido + ventana, mes parcial por licencia,
  anticipos, aguinaldos en el líquido, pagos trimestrales sector público, ahorro devuelto). Cada respuesta
  → regla general en `lecciones/paso5-ingresos.md` aplicable a todos los clientes.
- [ ] **Aporte de terceros (tipo 31)** — sin testigo aún (DJ del tercero + cédula). Validar con un caso real.

## 🆕 Validación anti-error de la lectura de Claude (Paso 3) — construido (2026-06-29)

Tras eliminar Tesseract (lectura nativa de PDF por Claude), se agregó una red anti-error en
`sentinel.ts` que verifica los HECHOS que Claude reporta contra fuentes deterministas (NO decide la
estructura). El LLM devuelve `evidence` por acreedor (rut_emisor, numero_operacion, moneda,
cita_monto, cita_fecha, confidence) y TS lo valida → `SentinelResult.claudeReadIssues[]`.
- **Capa 0 (contrato `evidence`)** ✅ — exigido en las 4 listas; cobertura subió de ~40% a ~92%.
- **Capa 1 (auto-cita anti-alucinación)** ✅ — el monto debe aparecer verbatim en `cita_monto`; 0 falsos positivos en 3 casos.
- **Capa 2 (cross-check de RUT)** ⚠️ — funciona cuando Claude da `rut_emisor`, pero lo puebla casi nunca → **dormida** (lección L3, abierta).
- **Lecciones** en `lecciones/paso3-acreedores.md` (L2 resuelto, L3 abierto, L4/L5).

**Estado (2026-06-29) — sesión de revisión + mejoras (branch `paso-3`):**
- [x] **Revisión anti-error (Capas 0/1/2)** — validada contra los 3 casos reales: 0 falsos positivos en lecturas limpias; capturó lecturas dudosas reales (Itaú conf 0.62/0.65; Cristian BancoEstado/CCAF/Santander 0.28–0.55; Néctor `monto_sin_respaldo_en_cita` BancoChile $35.977.919 vs cita $37.700.317).
- [x] **Propagación `claudeReadIssues`** por la cadena `sentinel`→`centinela_agent` (`CentinelaOutput.claudeReadIssues`, idempotencia v16)→`worker` (`buildReadIssuesAlert` → **una** `automation_alert` `needs_review`). Verificado E2E con el agente real (`casos/_shared/test_e2e_read_issues.ts`). **Ya no se pierden.**
- [x] **L3 — fallback determinista de `rut_emisor`** desde el texto del cert (reusa `computeRutCheckLocal`). Capa 2 ya no depende de que Claude lo reporte. 0 FP en los 3 casos. Resta solo el caso imagen-sin-texto.
- [x] **Mejoras del supervisor implementadas**: #2 dedup por nº de operación, #3 moneda UF vs pesos (cross-check), #4 documentos que no acreditan (comprobante de pago/cartola, detección por contenido + regla en el prompt), #6 top-N candidatos del catálogo en la alerta de saltados, + #5 (confidence/reasoning ya viajan en las señales). **Verificaciones parser CMF**: `sliceCmfDebtBlocks` (cupo disponible fuera del parseo) + `cleanTipoCredito` (tarjeta siempre tarjeta_credito) confirmadas con tests. Todo en `casos/_shared/test_reglas_deterministas.ts` (**26/26 OK**, sin API).
- [ ] **Pendiente menor**: Capa 2 en imágenes sin texto; validar #4 sobre un comprobante/cartola CON capa de texto real; L5 cosmético (cita verbatim). Ver `lecciones/paso3-acreedores.md` (L3–L8).
- [ ] **Pendiente integración**: merge de `paso-3` a `main` cuando se decida; correr migración v7 (alias) sigue aparte.

## 🆕 Capa determinista del Paso 3 — BULLETPROOF sin API (2026-06-29, branch `paso-3`)

Causa raíz de la inestabilidad (L14): la mega-llamada (todos los docs + CMF en UNA llamada) hace que el
LLM deje caer/mezcle productos. El refactor por-documento (extractor por-doc + `assembleRawFromDocFacts`,
flag `CENTINELA_PER_DOC`, idempotencia `v18-per-doc-extraction`) ya estaba implementado; su validación EN
VIVO (scorecard 3× → 10/13/12 estable) está **bloqueada por cuota API hasta 2026-07-01**.

Mientras tanto se blindó TODA la capa determinista de TS (la que decide la estructura), testeable sin API:
- [x] **Refactor de testeabilidad** — la cadena de backstops + validación anti-error salió de `runSentinelCheck`
  (inline) a **`src/utils/sentinel_backstops.ts`** → `applyDeterministicBackstops(raw, ctx, log)`, función PURA.
  Movimiento sin cambio de comportamiento (import unidireccional, tipos vía `import type` → sin ciclo).
  `runSentinelCheck` la invoca en ambos caminos; contrato idéntico (`step3`/`centinela_agent`/`worker` intactos).
- [x] **Batería determinista** en `tools/paso3_validacion/` (Tier 1, sin API, hermética), corre con **`run_all.ts`**
  (exit≠0 si falla): `test_reglas_deterministas.ts` (**42 OK**), `test_assembler.ts` (3 casos: Cristian 10 /
  Miguel 13 / Néctor 12), `test_assembler_edge.ts` (**13** ramas), `test_backstops_golden.ts` (**15** golden de
  los backstops), `test_oracle_injection.ts`. **5/5 suites verdes** + `build:prod` limpio.
- [ ] **Pendiente (tras cuota 2026-07-01)**: `scorecard.ts 3` con `CENTINELA_PER_DOC=true` → confirmar 10/13/12 ESTABLE.

### 🆕 Validación sobre 13 casos reales (`renegociacion_docs/`) — sin API (2026-06-29)
Claude actuó como Centinela (lectura nativa de los PDF del Paso 3 de 13 clientes previos) → fixtures
`tools/paso3_validacion/reneg_fixtures/*.json` (CMF + DocFacts + declaración esperada). El arnés
`test_renegociacion_docs.ts` corre el **ensamblador + backstops REALES** y compara vs la verdad-terreno.
**10/13 reproducen EXACTO** la declaración del abogado (6 directo + 4 tras meter las reglas de lectura en el
prompt). Los 3 ⚠️ restantes NO son lectura ni TS: betzy (faltan certs formales en la carpeta), claudia/yoselyn
(robot declara un producto real que el abogado omitió). Salieron **5 fixes deterministas GENERALES** (sin
regresión, batería 6/6 + `build:prod` limpio) **+ 4 reglas de lectura en `perDocSystemPrompt`** (L23–L26):
- [x] **Drop $0** en el ensamblador (G2; multas UTM sin convertir → se caen, lección L17).
- [x] **Dedup por Nº de operación** (mismo producto en varios docs) + `normalizeOperationId` quita ceros/paréntesis (L16).
- [x] **Gate 260→261 multiproducto**: degrada el override real, NO inyecta el total del CMF si el banco ya está
      representado → arregla el **doble conteo** (fila fantasma); solo inyecta el total si no hay ningún doc (G2) (L18).
- [x] **Aliases del nombre corto del CMF** ("De Crédito e Inversiones", "Internacional", "Santander Consumer
      Finance", "CAT"→Cencosud) + `canonicalInstitutionKey` corta en `" / "` (L19).
- [x] Arnés integrado en `run_all.ts` como **guard de regresión** (10 casos-guía).
- [x] **4 reglas de lectura en el prompt del Centinela** (`perDocSystemPrompt`) — validadas releyendo los docs nativo:
      **L23** tarjeta = "COSTO MONETARIO PREPAGO" (no las filas de operaciones/Super Avance); **L24** captura del
      portal con "Cupo utilizado" SÍ acredita (no es chat por más que el archivo diga WhatsApp); **L25** usar la
      columna en pesos "Saldo Actual $" (no re-convertir UF) + formato chileno "." miles / "," decimal; **L26** un
      producto por operación/tarjeta aunque venga en varios docs (el de mora solo aporta fecha).
- Lecciones nuevas **L16–L26** en `lecciones/paso3-acreedores.md`.

## 🆕 Prueba del Paso 3 sobre 30 casos reales (Constanza Mulchi) — 2026-07-01 (branch paso-3)

Actué como el LLM lector nativo de los 30 casos → 30 fixtures (`reneg_fixtures/*.json`) → capa determinista
REAL + comparación fila-a-fila nueva (`deep_compare.ts`: art+monto+fuente). Reporte: `tools/paso3_validacion/REPORTE_30_CASOS.md`.
- [x] **Fix TS (L32)**: overflow multiproducto con `fecha_mora`≥91 → Art.260 (antes forzado a 261). Golden en
  `test_assembler_edge.ts`. ART 62→36, FUENTE 81→49. Batería 6/6, `build:prod` limpio, sin regresión (10 guía).
- [x] **Evaluado y REVERTIDO (L30 rev)**: filtro <1 UF en TS rompía el golden TGR $18.000 (deuda real). Lo
  trivial es semántico (del lector), no umbral de TS. TS solo descarta `monto ≤ 0`.
- [x] **Prompt del lector reforzado** (`perDocSystemPrompt`, L27/L29): `doc_facts`=solo lo declarable; tarjeta=
  suma de sub-líneas (L28); un producto por operación multi-doc; nunca usar el 90+d del CMF como monto.
- [x] **5 casos con error de lectura re-leídos** con el prompt corregido (viviana→PORTAL-OK; patricio/paulina/
  rodrigo/matias_garrido mejorados). Lecciones **L27–L34** en `lecciones/paso3-acreedores.md`.
- [x] **Hardening producción (L35)**: 2 redes anti-error nuevas que convierten errores de lectura SILENCIOSOS
  en alertas (→ `claudeReadIssues` → `automation_alert`): **`posible_subdivision_operacion`** (dedup del
  ensamblador descartaba en silencio sub-líneas de la misma op con monto distinto — anti pérdida de deuda) y
  **`monto_trivial`** (producto < 1 UF: se declara igual y se alerta; nunca se descarta — TGR/CCAF real).
  Golden G5 + etiquetas en `read_issues_alert.ts`. Disparan en 3/30 y 3/30 respectivamente. Batería 6/6, build limpio.
- [ ] **DECISIÓN DEL ABOGADO (L31)**: banco 90+d multiproducto → ¿todo a 260 o solo la porción con mora
  acreditada por documento? Cierra la frontera ART (36 discrepancias residuales, no bugs).
- [ ] **Validación EN VIVO** (scorecard.ts) cuando haya cuota API: confirmar que el prompt reforzado genera los
  `doc_facts` correctos sin subagente.

## 📋 Backlog acotado (no bloqueante)
- [ ] **Lectura (Centinela)**: UN doc autoritativo por producto (L20), sumar sub-cupos/Super-Avance (L21),
      convertir UTM/UF→CLP antes de reportar el monto de multas/fiscales (L17). Inyectar L16–L22 al prompt.

- [ ] **Adapter de input formal** en el worker (la Etapa 2 es el primer ladrillo; luego abstraer la fuente).
- [ ] **Régimen patrimonial** — opciones reales del portal (sin verificar; **bloqueante para clientes casados**).
- [ ] **Comunas fuera de RM** en `portal_select_values.json` (hoy caen a texto libre).
- [ ] **Concurrencia del worker** (`WORKER_CONCURRENCY>1`) — solo con clientes distintos; **NUNCA en modo
      prueba** (todos comparten la ClaveÚnica de Pato = un solo borrador).
- [ ] **"Inversiones LP S.A."** (emisora Tarjeta La Polar) al catálogo `acreedores_canonicos` (falta el RUT).
- [ ] **Primer envío REAL (`DRY_RUN=false`)** — meta final, tras resolver `fecha_nacimiento` + confirmación del abogado.

---

## 🧹 `rp_carga_documentos` — TRANSITORIO (se jubila)

Era el input provisional. Su agente cubre la recolección. Se jubila cuando la conexión funcione.
No invertir más ahí salvo brechas que a él le falten. (Repo separado: `~/Desktop/rp_carga_documentos`.)
