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

- **Archivos nuevos**: `src/utils/income_extractor.ts`, `src/agents/ingresos_agent.ts`,
  `src/automation/step5_ingresos.ts`; integrados en `all_steps.ts` (paso 5 tras paso 4) y
  `worker.ts` (step:0 y nuevo step:5). Lecciones en `lecciones/paso5-ingresos.md` (L1–L7).
- **Validado** (testigo Jorge Romero, asalariado): extractor exacto $2.162.230 + lectura
  nativa real por Claude (extrajo bien los líquidos del escaneo, ignoró "Alcance Líquido") +
  **E2E contra el portal** (ingreso + justificativo tipo 28 + cert cotizaciones cargados).
- [ ] **CORRER `supabase/migration_sandbox_v8_ingresos.sql`** en el SQL Editor del sandbox
  (agrega `'ingresos'` al CHECK de `agent_runs.agent_type`). DDL → lo corre el usuario.
- [ ] **Fuente de docs de ingreso en producción**: hoy `gatherStep5Input` los busca en
  `client_documents` por keyword de filename; el dashboard/integración debe subirlos ahí
  (liquidaciones + cert cotizaciones). Sin eso, el Paso 5 se omite (no rompe el flujo 1→4).
- [ ] **`fillStep5` DRY_RUN no limpia el borrador** (deja filas/archivos del Paso 5). Agregar
  auto-cleanup como en Paso 2/3 cuando se vea el markup de borrado en una tabla poblada.
- [ ] **Pendientes de validar con otros casos**: honorarios (6 vs 12 meses), aporte de terceros
  (DJ), retiro de sociedades, multi-ingreso. Ver candidatas en `lecciones/paso5-ingresos.md`.

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

## 📋 Backlog acotado (no bloqueante)

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
