# Tareas: Automatización Superir — Estado Actual

---

## 🚀 PRIORIDAD — Camino a Producción

> La cadena completa (Tributario→Centinela→Mapeador→Steps 1→4) fue validada en DRY_RUN con 9 casos el 2026-06-17.
> Flujo E2E **dashboard de Vercel → Supabase sandbox → worker → portal Superir** validado el 2026-06-18 (borrador vivo, sin radicar).
> Falta para el primer envío real (`DRY_RUN=false`): documentos frescos (<30d) + confirmación del abogado.

### P0.b — Cierre de auditoría + producción-ready (2026-06-18/19)

- [x] **Fixes de la auditoría (INFORME_AUDITORIA_2026-06-18.md)** — Aplicados todos menos B3:
  - **renegociacion**: B1 (gate del abogado → `pending_review` en run real), B2 (conteo ≥2 incluye NO-CMF 260), A3 (alarma de flags bypass), A7 (F29 temprano antes del Centinela), M3 (alertas UUID sin tragar error), A1 (matching alias-aware `canonicalInstitutionKey`), A2 (aviso colisión de monto), M5 (aviso fecha placeholder Art.260), M6 (skip comuna no mapeada), M2 (sentinel `success` default), A5 (login waitFor), A6 (step1 .first()).
  - **dashboard** (`rp_carga_documentos`): B4 (índice único + finalize maneja 23505), M8 (updates de path chequean error), A4 (`.limit(1)` en lookups por RUT), CT+Retenedores bloqueantes en el checklist.
  - **DIFERIDOS**: **B3** (DRY_RUN como parámetro — el daemon es secuencial, riesgo nulo hoy) y **M9** (init atómico del dashboard — recuperable con retry). Hacer con re-test si se necesita.
  - Validado: `tsc` limpio (ambos repos) + E2E de regresión `success` (Paso 3 5/5, B1/A3 disparando bien).
- [x] **Reorganización `src/` = solo producción (2026-06-19)** — 52 scripts dev/diagnóstico + CLI legacy `index.ts` movidos de `src/` → **`tools/`** (imports reescritos). `src/utils/` quedó con los 13 módulos del grafo del worker. `tsconfig.build.json` + `npm run build:prod` (artefacto production-only). `.gitignore` y `package.json` actualizados. Producción byte-idéntica (sin regresión).
- [x] **`INSTALL.md`** — guía completa para correr el worker en otra máquina (requisitos de sistema: poppler/tesseract/ghostscript; clone → npm install → playwright → `.env` → `scripts/sistema.sh start` → pm2).
- [x] **`B4` índice único** — pendiente **correr `migration_sandbox_v4.sql`** en el SQL Editor (agrega `uq_active_job_per_client`).
- [x] **Correr `migration_sandbox_v5.sql` en el SQL Editor del sandbox `fnz...`** *(2026-06-19)* — `automation_jobs.lawyer_confirmed` (BOOLEAN, default false) aplicada. Gate del abogado operativo.

### P0.c — Caso Gabriel Santander: paridad con el abogado en Paso 3 (2026-06-19)

> Run real E2E (worker queue, `DRY_RUN=false`, borrador vivo, identidad de prueba 21917363-6 + docs de Gabriel). Resultado **9/9 filas, estructura idéntica a la solicitud manual del abogado**. Cierre en memoria: `project_gabriel_closed.md`.

- [x] **Auto-asociación cert→acreedor por RUT** — `src/utils/cert_institution_resolver.ts` (NUEVO). El worker deriva `institucion_cmf` por RUT (pdftotext → `extractRutsFromText` → `findCatalogEntryByRut`, fallback por keyword del filename) ANTES del Centinela y lo persiste en `client_documents`. El dashboard ya no exige elegir banco. `step3` usa `AcreditacionDoc.catalogInstitucion` (poblado por `deterministic_mapeador`) como fallback cuando el nombre CMF/Centinela no matchea el catálogo (ej. "Tenpo Payments" → "Tenpo Prepago").
- [x] **Adjunción Art.260 = tipo 22 + tipo 23 por separado** — Los 260 suben el MISMO certificado dos veces: una "Acredita Monto" (22) y otra "Acredita Vencimiento" (23), como el abogado. `neededTipos = isOtros ? [22] : [22,23]` en la fase de adjunción de `step3_acreedores.ts`. Los 261 siguen solo tipo 22.
- [x] **Multiproducto: un certificado de liquidación con N créditos → N filas 260** — `step3` agrupa los `cmfDocumentOverrides` por institución base (quitando el sufijo de producto) y crea una fila por producto con su "Monto total a pagar" (no un monto consolidado). Excluye "VARIOS DEUDORES"/codeudor/fiador/aval y montos triviales (<1 UF). Validado con Santander (3 créditos → 3 filas: $12.821.458, $835.106, $588.851).
- [x] **REGLA 9 + Regla Transversal en el prompt del Centinela** (`sentinel.ts`) — (A) usar período MÁS RECIENTE en estados de cuenta multi-período; (B) SUMAR todos los cupos (Compras + Avances/XL); monto_clp = "Monto total a pagar" (no "Saldo del crédito"); fecha_vencimiento = "Cobranza Judicial iniciada"/inicio de mora (no contratación ni próximo pago); un override por producto en certificados multi-crédito.
- [x] **`clampDocTextForClaude` (head 3500 + tail 9000)** (`sentinel.ts`) — reemplaza `substring(0,4000)`, que truncaba el período reciente (al final del PDF) en OCRs largos → el Centinela leía el período viejo. Validado con Hites (22k chars) y La Polar (44k chars).
- [x] **`clearExistingAcreedores` idempotente** — `step3` borra ambas tablas de acreedores al inicio del llenado. Evita acumulación cross-run (montos levemente distintos entre corridas burlaban el dedup por monto).
- [x] **Aliases La Polar** (`acreedor_matcher.ts`) — "lapolar"/"la polar" → "empresas la polar".
- [x] **CMF parte 1 crédito en 2 filas (mora + vigente)** — confirmado: la op ...258302 de Santander aparece como $2.929.423 (mora) + $8.665.385 (vigente), misma fecha de otorgamiento → es UN crédito, se declara UNA vez al payoff total. El abogado confirmó **3 productos Santander en 260** → coincide.
- [ ] **Agregar "Inversiones LP S.A." (emisora Tarjeta La Polar) a `acreedores_canonicos`** — falta el RUT que usó el abogado (el documento solo imprime el RUT del administrador abc Administradora SpA 77.555.730-3). Sin la entidad, La Polar resuelve a "Empresas La Polar S.A." (retailer). Luego alias `la polar`/`tarjeta la polar` → emisora. **No bloqueante** (el adjunto sale bien). Ver memoria `project_inversiones_lp_catalogo.md`.
- [ ] **Redeploy del dashboard `rp_carga_documentos`** — cambios de subida directa a Storage (signed URL, sin límite Vercel 4.5MB) + sin gate de elección de banco (lo resuelve el resolver por RUT). Pendiente import/redeploy en Vercel.

### P0.d — Casos de comparación contra la abogada (2026-06-22)

> Nuevo tipo de validación: clientes cuya **abogada ya completó la solicitud hasta el Paso 5**. Corremos la automatización en paralelo (borrador vivo, sin radicar) y comparamos **fila por fila** lo que produce el robot vs. lo que hizo la abogada. **Primer caso: Miguel Ángel Lugo Acosta** (`casos/miguel_lugo/`). Branch de trabajo: **`pm/casos-comparacion-abogada`**. Setup en memoria `project_comparacion_abogada_setup`.
>
> **Reglas de la prueba** (igual que producción): SIN flags de bypass. Identidad de portal = la de Pato (`21917363-6` + ClaveÚnica del `.env`), NUNCA la del cliente → el borrador cae en la renegociación de prueba de Pato y NO toca la solicitud real del cliente. Datos personales y documentos sí son del cliente.

- [x] **🔴 [BLOQUEANTE] Recargar créditos/tokens de la API de Anthropic** — Resuelto. El saldo de la cuenta fue recargado y la API responde correctamente.
- [x] **Perfil de Miguel creado + decisión de perfil resuelta** *(2026-06-22)* — Se usó `casos/miguel_lugo/setup_test.ts` (upsert directo a `clients`, no vía dashboard): `rut=26.625.555-1` (identificador), `clave_unica_rut=21917363-6` + ClaveÚnica de Pato, `airtable_id=null`. Verificado en código que `resolveClaveUnica` cae al fallback `clients.clave_unica_password` y devuelve `claveUnicaRut=21917363-6` → login con credenciales de Pato (confirmado en el run: `✓ ClaveÚnica obtenida de clients.clave_unica_password (fallback)`). Datos Paso 1 mapeados a los enums del portal.
- [x] **Carpeta molde de Miguel armada + subida a Vercel** *(2026-06-22)* — `casos/miguel_lugo/documentos/` deduplicada (8 únicos: CMF + CT + AR + 5 certs) con estructura molde (`02_Informe_CMF`/`03_Tributaria_y_SII`/`acreedores_cmf`/`acreedores_no_cmf`) validada contra el `classify()` real del dashboard. El usuario la subió por Vercel → `client_documents` + Storage + job encolado. Gemini produjo `casos/miguel_lugo/analisis_deudas.md` (línea base, 13 filas esperadas: 4 BdCh + 3 Itaú en 260; 2 BCI + 3 CCAF + 1 Tenpo en 261). Sin NO-CMF.
- [x] **Miguel Lugo — comparación CERRADA** *(2026-06-23)* — Run real E2E vía worker queue (`DRY_RUN=false`, borrador vivo). Resultado **12/13 filas, paridad funcional con la abogada** (job `7d705442`). **260 (4 filas):** BdCh Consumo $34.170.587, Tarjeta $750.944, Línea $606.175 y **VARIOS DEUDORES $45.798** (los 4 con monto+venc). **261 (8 filas):** BCI $14.830.069, Itaú $6.756.287, Itaú $9.511.066, Itaú línea $500.000, 3× CCAF, Tenpo $6.180. El robot quedó **más completo que la abogada** en 260 (ella dejó Línea+Varios en 261 por atajo). **Única diferencia:** falta BCI cuenta corriente $615 (variabilidad de Claude con productos chicos solo-en-cert — ver pendiente abajo). Cierre en memoria `project_miguel_lugo_closed` + `feedback_260_declarar_todos_acreditables`.
- [x] **Néctor Ruiz — comparación CERRADA** *(otra sesión de Claude Code, 2026-06-22/23)* — `casos/nector_ruiz/`. Run real E2E (`DRY_RUN=false`, job success). Caso testigo de 3 patrones nuevos: (a) **chat/WhatsApp** (`Falabella_CMR_whatsapp_mora.pdf`) acredita el **vencimiento** de Banco Falabella + CMR (chat→260, venc 18/09/2025) sin crear acreedor ni monto; (b) **de-reclasificación 260→261 (REGLA 10)**: Banco Estado consumo ($389.848, "Certificado de Deudas Vigentes" → Art. 261 aunque el CMF lo marcaba 90+d); (c) **multiproducto Falabella** (2 filas 260). Estos patrones están en el código de esta rama (sentinel.ts/step3/mapeador).
- [x] **Cristian Mancilla — caso ARMADO** *(otra sesión, 2026-06-22/23)* — `casos/cristian_mancilla/` con carpeta molde completa (CMF + CT + AR + 9 certs + 2 TGR contribuciones NO-CMF) + `analisis_deudas.md` (línea base) + screenshots de la solicitud del abogado (260 y 261). **Pendiente: encolar el run E2E y comparar** (incluye TGR contribuciones como NO-CMF — primer caso de comparación con deuda fiscal).
- [x] **Cristian Mancilla — comparación CERRADA** *(2026-06-23)* — Run real E2E vía worker queue (`DRY_RUN=false`, borrador vivo, identidad Pato), corrido SIN dashboard (`casos/cristian_mancilla/setup_test.ts` + `enqueue.ts` + `wait_job.ts`). **Paridad 260/261 con la abogada**: 260 = Santander Consumo $6.985.718 + CMR $4.168.214 (monto+venc, tipo 22+23); 261 = BdCh hipotec./consumo/línea + CCAF×2 + Santander tarjeta + **TGR×2 ($18.537 + $19.049, <91d → 261)**. Validó: (a) **deuda fiscal TGR contribuciones NO-CMF** (1er caso); (b) **Paso 1 fuera de RM** (Valdivia/Los Ríos) funciona con label match. **BUG corregido (general):** el Centinela sumaba la cuota *no vencida* a la morosa en la TGR ($36.481 vs $18.537) → regla "contribuciones solo morosa" en `sentinel.ts` + bump `CENTINELA_LOGIC_VERSION` v10→v11. El robot quedó más completo que la abogada en 261 (5 productos chicos al día que ella omitió). Memoria `project_cristian_mancilla` + `feedback_contribuciones_solo_morosa`. ⚠️ Cambios sin commitear en la rama.
- [ ] **Preparar más casos de comparación** — Por cada caso: (1) `casos/<cliente>/documentos/` molde; (2) `analisis_deudas.md` (Gemini) como línea base; (3) perfil en sandbox vía `setup_test.ts` (rut real + `clave_unica_rut=21917363-6` + ClaveÚnica de Pato); (4) solicitud del abogado. **Pendiente: el usuario entrega las carpetas + nombres.**

- [x] **Prueba del procedimiento REAL del abogado en el dashboard Vercel — Cristian + Néctor + Miguel** *(2026-06-23)* — Driver Playwright `casos/cristian_mancilla/drive_dashboard.ts` (env `CASE_RUT`/`CASE_DIR`) contra `rp-carga-documentos.vercel.app` (sin auth): RUT→guardar→subir carpeta (`webkitdirectory`)→finalize→worker→`success` los 3. **Subida real: 0 errores** (signed-URL evita límite 4.5MB; nombres con espacios OK; `webkitRelativePath` se puebla). Memoria `project_dashboard_real_test`. **Bug destapado y corregido (Néctor):** Falabella/CMR (chat→260) se PERDÍAN en step3. **3 fixes generales en `step3_acreedores.ts`:** (1) backstop degradar-a-261 en vez de descartar un 260 sin venc; (2) `getCmfOverride` prefiere el override CON fecha; (3) match por `canonicalInstitutionKey` (nombres CMF mangleados "Tarjet…crédit"). Resultado: ambos Falabella en 260 con venc (paridad abogada). Miguel sin regresión. Memoria `feedback_step3_260_nunca_perder`. ⚠️ Sin commitear.
  - [ ] **(menor) CCAF Los Andes nombre largo** — "Caja de Compensación de Asignación Familiar Los Andes" no matchea `acreedores_canonicos` (warning no fatal; se agrega igual como NO-CMF). Agregar alias → "CCAF Los Andes". Ver `project_catalog_name_gaps`.
  - [ ] **(infra) Auth en el dashboard de Vercel** — confirmado SIN auth en producción (cualquiera con el link). P0 antes de producción pública.
- [x] **Script Playwright que maneja el dashboard de Vercel** *(2026-06-23)* — `casos/cristian_mancilla/drive_dashboard.ts` conduce el procedimiento real del abogado contra el deploy live (`rp-carga-documentos.vercel.app`, **sin auth**): datos-personales (buscar RUT → guardar) → subir-caso (seleccionar carpeta → subir → finalizar). **Hallazgo clave**: Playwright **SÍ puebla `webkitRelativePath`** con `setInputFiles(directorio)` → `classify()` funciona perfecto (14 archivos, 2 TGR como no-CMF). **Subida real impecable**: `init`→(`sign`→`PUT`→`record`)×14→`finalize`, todos 200 (signed-URL directo a Storage evita el límite 4.5MB de Vercel). Job encolado por `finalize` → worker → `success`, mismo resultado que el run por scripts. **Bug detectado y aclarado**: el guardado de datos-personales 400ea solo si la DOB es el placeholder `01/01/1990` (rechazo correcto); con DOB válida guarda `complete:true`. Comuna fuera de RM (Valdivia) NO bloquea (cae a texto libre). Ver backlog de mejoras del dashboard abajo (auth, comunas no-RM, recarga atómica).

### P0.e — Fixes de clasificación 260/261 y robustez (2026-06-23)

> Validados end-to-end vía worker queue real (`DRY_RUN=false`) con Miguel y Néctor. Todos en la rama `pm/casos-comparacion-abogada`, sin commitear aún. `tsc` + `build:prod` limpios.

- [x] **Regla DECISIVA 260 vs 261 (abogado 2026-06-22)** — Una deuda 90+d va a Obligaciones **260 SOLO si se acredita MONTO Y VENCIMIENTO**; si no se puede acreditar el vencimiento → **Art. 261** (solo monto). Implementado como **backstop determinista** en `sentinel.ts` (no depende del LLM): un acreedor CMF 90+d sin `cmf260DirectOverride` con fecha → se degrada a 261 con su monto + alerta `needs_review`. Caso testigo: Itaú cartera vencida (sin fecha de mora) → 261.
- [x] **REGLA 10 — de-reclasificación 260→261** (`sentinel.ts`, `step3`, `deterministic_mapeador`, `worker`) — El CMF puede estar desactualizado: si el cert certifica la deuda **vigente** ("Certificado de Deudas Vigentes"), se declara 261 aunque el CMF la marque 90+d. `DeReclassified261Creditor[]`. Caso testigo: Banco Estado de Néctor.
- [x] **Chat/WhatsApp solo acredita vencimiento** (`sentinel.ts`) — `isChatDocument` (detección por CONTENIDO, no filename). Un chat de cobranza NO crea acreedor ni monto; solo aporta la fecha/días de mora de productos ya existentes (rescate Chat→260 con venc estimado). Filtro de `additionalCreditors` que vienen de un chat. Caso testigo: Falabella+CMR de Néctor.
- [x] **"VARIOS DEUDORES"/"OTROS DEUDORES" SIEMPRE se declaran** (`sentinel.ts` REGLA 9, `step3`) — Es deuda DIRECTA del titular. Antes se excluían. Solo se excluye la deuda **indirecta** (codeudor/fiador/aval de un tercero) y montos triviales <1 UF. Caso testigo: BdCh Op.97000 $45.798 de Miguel → 260. Memoria `feedback_260_declarar_todos_acreditables`.
- [x] **Monto = DEUDA ACTUAL, nunca el MONTO ORIGINAL** (`sentinel.ts` REGLA 9) — Prioridad de campo (payoff → saldo insoluto → ⛔ nunca "Monto Aprobado/Cursado/Otorgado/Contratado/Original") + **ANCLA en el CMF**: el monto debe ser coherente con `totalCredito` del CMF; si lo supera sin cobranza judicial que lo explique, se tomó el original. General (cualquier banco). Caso: Itaú $6.756.287 (saldo) NO $8.183.872 (aprobado). Memoria `feedback_fixes_generales`.
- [x] **Mapeador — fallback de cert compartido** (`deterministic_mapeador`) — Si un cert multiproducto queda reservado por un acreedor NO-CMF del mismo banco, los productos CMF lo reusan en vez de bloquear el Paso 3. Sin esto, el caso "varios deudores NO-CMF + 3 líneas CMF del mismo cert" omitía el Paso 3 entero.
- [x] **`getIdentified261Match` — relajación 1:1** (`step3`) — El guard del 30% (desambigua multiproducto) se saltea cuando el match es inequívoco (1 producto del cert + 1 línea del CMF) → el monto del cert manda aunque difiera mucho (caso "deuda muy pagada": Tenpo $6.180 vs CMF $409.690).
- [x] **`promoteOverflowIdentified261ToAdditional`** (`sentinel.ts`) — Productos 261 de un banco que exceden las líneas del CMF viajan como NO-CMF para crear fila extra en el portal.
- [x] **`stripCreditTypeTokens` + aliases** (`acreedor_matcher`) — El parser CMF pega el tipo de crédito al nombre ("Banco del Estado de Chile Consum"); se limpia antes de matchear. Aliases nuevos: Banco del Estado→Banco Estado, La Araucana, CAT→Cencosud, Banco Santander Chile.
- [x] **Worker — progreso en vivo + concurrencia + screenshot job-scoped** (`worker.ts`) — `reportProgress` escribe `progress_message`/`progress_updated_at` (panel del dashboard, en lenguaje claro por fase). Pool `WORKER_CONCURRENCY` (default 1 = secuencial; **NO usar >1 en modo comparación** — todos comparten la ClaveÚnica de Pato). Screenshot de éxito con `job.id` (evita colisión entre runs).
- [x] **`migration_sandbox_v6.sql` aplicada** — Columnas `automation_jobs.progress_message` + `progress_updated_at`. **Corrida y verificada en el sandbox `fnz…`** (ya en uso por el worker).
- [ ] **BCI cuenta corriente $615 — detección consistente de productos chicos solo-en-cert** — El $615 (BCI, cuenta corriente NO-CMF, monto < 1 UF) lo emite Claude de forma **inconsistente** entre runs (a veces sí, a veces no). La abogada lo declara. Productos que existen SOLO en el cert (no en el CMF) y de monto chico dependen de que Claude los detecte → no es determinista. **Pendiente: extracción determinista de productos del cert (TS) para no depender del LLM.** No bloqueante (deuda mínima).
- [ ] **Itaú "Monto Aprobado" — variabilidad del LLM (mitigada, monitorear)** — Reforzado con el ancla del CMF en el prompt; validado que ahora toma $6.756.287. Pero es prompt-dependiente: si reaparece el monto original en otro caso, evaluar extracción determinista de candidatos + selección por proximidad al CMF.
- [x] **`getIdentified261Match` — match canónico + emparejamiento 1:1 greedy (2026-06-23)** — `step3_acreedores.ts`. Bug destapado en la comparación fila-por-fila de **Néctor** vs. la abogada: el match usaba substring crudo de `normalizeText` (fallaba con los tokens que el parser CMF inyecta DENTRO del nombre: "CAT Administradora de Tarjetas **Tarjet** S.A. **crédit**", "**Linea** Banco de Chile **Crédit**") + un guard del 30% que rechazaba el override del Centinela en bancos multiproducto → declaraba el monto CRUDO del CMF. Resultado: **CAT $816 (debía $105.185), BdCh línea $11.050/$13 (debía $503.808)**. El Centinela estaba bien (extrajo los montos correctos). Fix: (1) emparejamiento 1:1 GLOBAL por `canonicalInstitutionKey` (alias-aware + strippea tokens), greedy de mayor a menor monto, una fila CMF por producto; el monto del cert MANDA para el par asignado (sin guard del 30%); (2) **descarte de filas CMF Art.261 triviales** (<1 UF) sin documento de respaldo (remanentes de líneas casi saldadas, ej. BdCh $13). Validado E2E vía worker queue (`DRY_RUN=false`): **Néctor** → CAT $105.185, BdCh línea $503.808, $13 omitido, CCAF $8.049.440 exacto (job success); **Miguel** sin regresión (Tenpo $6.180 preservado por tener `identified261` pese a <1 UF; 12/13 igual, job success). `tsc` limpio. Memoria `feedback_step3_id261_multiproducto`.
- [ ] **(Centinela) BancoEstado línea $389.848 vs $779.696 — gap del Centinela en Néctor** — Única divergencia restante de Néctor tras el fix de step3. El cert (`BancoEstado_certificado_deuda.pdf`) lista CRE-00040145148 "Saldo Deuda **$389.848**", pero el Centinela mapeó esa operación al cupo del CMF ($779.696) SIN emitir un `identified261`/override con el monto del cert → step3 declara $779.696 (sobre-declaración de $390k en un 261). La abogada usó $389.848. Fix: refinar el prompt del Centinela (REGLA 9) para que, cuando un cert dé un saldo específico (menor) de un producto que el CMF lista a su cupo, emita el override con el saldo del cert. Requiere bump `CENTINELA_LOGIC_VERSION` + re-run con LLM (no determinista). No bloqueante (261 informativo).

### P0 — Desbloqueadores inmediatos

- [x] **Aliases catálogo — CCAF / Coopeuch** ⚡ *(2026-06-17)*
  - Aliases en `ALIASES` de `acreedor_matcher.ts`: "Caja Los Andes", "Caja de Compensación de Los Andes/Los Andes" → "CCAF Los Andes". Ídem para CCAF 18 de Septiembre, Gabriela Mistral, La Araucana, Los Héroes.
  - "Coopeuch" → "Coopeuch Ltda" (alias explícito para Tier 1; token-containment ya lo resolvía).
  - Catálogo ya tenía: Coopeuch Ltda (82878900-7), Municipalidades RM (incluye Santiago y Las Condes).
  - **Pendiente**: Municipalidad de Colina y Registro Civil — RUT no verificado, no insertados. William excluye multa Colina del test; el abogado la declara manual.

- [ ] **Primer run con cliente REAL y docs frescos (<30 días)** 🎯
  - Obtener un cliente nuevo O solicitar docs actualizados para Jaime Cartes (Santander TC 2982 + Tenpo 9924) o Noelia Lorca (La Araucana + Forum)
  - Crear carpeta `casos/nuevo_cliente/` con `analisis_deudas.md` + `setup_test.ts` + `upload_documents.ts`
  - Correr sin flags de bypass: `npx ts-node --transpile-only -r dotenv/config casos/nuevo_cliente/test_full_chain.ts` (Centinela corre por defecto; solo poner `DISABLE_SENTINEL=true` en pruebas sin API)
  - Objetivo: que el Centinela apruebe (APROBADO, no RECHAZADO), que el Mapeador no genere alertas, que Playwright complete los 4 pasos limpiamente

- [ ] **Primer envío real (DRY_RUN=false)** 🎯
  - Una vez que el run con docs frescos pase sin bypass, correr con `DRY_RUN=false` para un cliente confirmado por el abogado
  - Verificar en el portal Superir que los datos quedaron grabados correctamente

### P1 — Infraestructura de producción

- [ ] **🎯 Concurrencia real del worker (correr N jobs a la vez, ej. 3)** — El pool ya existe (`WORKER_CONCURRENCY`, `worker.ts`), hoy en 1 (secuencial). Para producción con **clientes distintos** (ClaveÚnicas distintas → borradores separados en el portal) correr 3 jobs en paralelo es seguro: los temporales ya están aislados por `client.id`/`job.id`. Falta: (1) validar E2E con 3 clientes reales simultáneos (sesiones de portal independientes, sin pisarse cookies/estado de Playwright); (2) confirmar límites de la API de Anthropic y del portal Superir bajo carga; (3) setear `WORKER_CONCURRENCY=3` en `.env` de producción. ⚠️ **NUNCA >1 en modo comparación** (todos comparten la ClaveÚnica de Pato = un solo borrador, se pisarían).

- [x] **Conectar worker al loop real de la cadena** *(2026-06-18)* — `npm run worker` corre la cadena completa (tributario→centinela→mapeador→Steps 1→4) vía la cola `pato_prueba_automation_jobs`. Job `d65d7a9f` (Cinthia Rodríguez, DRY_RUN=true, step=0): ✅ 6/6 acreedores CMF + docs adjuntos, Steps 1→2→3→4 exitosos, `status=success` en Supabase. **Primer run histórico del worker daemon end-to-end vía queue.**
  - ⚠️ Fashion's Park (NO-CMF Art.260 $98.716) **no apareció** — en ese momento el flag era `ENABLE_SENTINEL=true` (ya obsoleto). Hoy el Centinela corre por defecto; para desactivarlo usar `DISABLE_SENTINEL=true`.
  - ⚠️ El worker requiere que `clients` sandbox tenga datos personales completos con **valores exactos del portal** (números de opción: `estado_civil='1'`, `region='Región Metropolitana'`, `comuna='LO BARNECHEA'`). Sin esto, Step 1 falla en `selectBootstrap`.

- [x] **`ENABLE_SENTINEL` → `DISABLE_SENTINEL` (2026-06-18)** — Lógica invertida: el Centinela corre por defecto; para saltarlo usar `DISABLE_SENTINEL=true` en `.env` (solo en pruebas sin API). `.env` actualizado. Workers viejos con bypass matados. **Centinela corre por defecto en producción; ENABLE_SENTINEL ya no existe.**

- [x] **Datos personales en `clients` con valores exactos del portal** *(2026-06-18)* — Resuelto vía el dashboard (ver subsección "Dashboard de carga" abajo). Convención fijada: `estado_civil` = **value** (`'1'`..`'7'`), el resto (`profesion_oficio`, `ocupacion`, `region`, `comuna`) = **label exacto** (comuna en MAYÚSCULA). Enums reales en `supabase/portal_select_values.json`. La fila se crea/edita desde la vista "Datos Personales" del dashboard, validada contra esos enums.

### P1.b — Dashboard de carga (input del abogado) — repo `rp_carga_documentos`

> El abogado NO entra a Supabase: usa el dashboard. Flujo: **Datos Personales** (crea la fila `clients`) → **Cargar Caso** (sube la carpeta) → encola `automation_jobs` → worker. Apunta al sandbox `fnz…`.

- [x] **Vista "Datos Personales"** *(2026-06-18)* — `app/datos-personales/` + `app/api/datos-personales/route.ts` + `lib/portal-values.ts`. Form con los mismos dropdowns del portal (cascada región→comuna, régimen solo si casado), upsert a `clients` por RUT (ilike), validación contra enums, trigger opcional de job (idempotente). Probado E2E contra el dev server.
- [x] **Fixes en "Cargar Caso"** *(2026-06-18)* — `classify()` por nombre de archivo (retenedores ya no se confunde con tributaria), Checklist de requisitos que bloquea si falta CMF, tabla editable (nada se descarta en silencio), `rut.ilike` (RUT con DV "K"), preserva extensión real, tipo de doc por certificado (22/23/24), enqueue idempotente.
- [x] **Enqueue por defecto = `step:0` + `dry_run:false`** *(2026-06-18)* — Ambos puntos (`subir-caso/finalize` y `datos-personales`) encolan la **cadena completa Pasos 1→4** (`step:0`) y dejan el **borrador vivo en Superir sin radicar** (`dry_run:false`; el flujo para en la vista del Paso 5). Antes encolaban `step:1`/`dry_run:true` (solo Paso 1 + limpiaba el borrador). **Validado E2E**: run real dashboard→worker→portal con RUT de prueba 21917363-6 + carpeta Alejandra → `success`, borrador cargado 1→4, 5 acreedores, sin presentar.
- [x] **Primer flujo COMPLETO dashboard→portal con borrador vivo** *(2026-06-18)* — crear cliente (dashboard) → subir carpeta (dashboard) → worker `DRY_RUN=false` → Pasos 1→4 guardados en Superir, no radicado. Todo persiste (clients, client_documents, job success + screenshots). **2ª verificación** con datos reales de Pato + nuevo default (sin parche) → `success`.
- [x] **Datos Personales: sin trigger + guardado parcial** *(2026-06-18)* — Quitado el checkbox de "encolar" (encolaba antes de subir docs → worker fallaba). Ahora la vista SOLO guarda. Guardado **parcial** permitido (solo bloquea valores inválidos; campos vacíos se permiten y se reportan). Prefill por RUT + banner de faltantes + borde ámbar en campos obligatorios vacíos + botón "Guardar avance/datos".
- [x] **Gate "datos personales completos" en Cargar Caso** *(2026-06-18)* — `lib/personal-fields.ts` (lógica compartida). GET de subir-caso devuelve `personal_complete`+`missing_personal` (pill en el banner + ítem rojo en el checklist que bloquea "Iniciar Carga"). `finalize` devuelve **409** si está incompleto (backstop server-side). Así el worker nunca corre con Paso 1 incompleto.
- [x] **Plantilla de carpeta (molde)** *(2026-06-18)* — Card "Formato de la carpeta" en Cargar Caso + botón "Descargar carpeta molde (.zip)" (`public/plantilla_caso_cliente.zip`: subcarpetas 02_Informe_CMF / 03_Tributaria_y_SII / acreedores_cmf / acreedores_no_cmf + LEEME). El abogado la llena y la sube.
- [x] **Encender el sistema (worker daemon) — `scripts/sistema.sh`** *(2026-06-18)* — Script portátil (`start`/`stop`/`status`/`logs`) que instala deps + Playwright y deja el worker corriendo (pm2 si está, sino nohup). Documentado en CLAUDE.md ("🟢 Encender el sistema"): el usuario dice "enciende el sistema" → `bash scripts/sistema.sh start`. **Falta dejarlo persistente al boot en el Mac Mini (`pm2 startup`).**
- [ ] **🎯 Autocompletar Datos Personales por RUT (lookup desde Supabase)** — Conectar al dashboard una tabla de Supabase con la **información personal de los clientes**, de modo que la abogada escriba SOLO el RUT y el form de "Datos Personales" se autocomplete (nombre, fecha nac., estado civil, dirección, comuna, etc.). Hoy la vista prellena desde `clients` (lo ya cargado); falta la fuente con los datos personales de clientes que aún no están en `clients`. Definir: ¿qué tabla/origen tiene esos datos (prod del abogado `ton…`? una tabla nueva en sandbox? import desde Airtable/`renegociacion_overrides`)? + endpoint `GET /api/datos-personales?rut=` que la consulte y mapee a los enums del portal. Trabajo principal en el repo del dashboard `rp_carga_documentos`. **Ahorra tiempo y evita errores de tipeo de la abogada.**
- [ ] **Régimen patrimonial — opciones reales** — `lib/portal-values.ts` usa labels estándar SIN verificar contra el portal (ningún dump tiene la lista; carga dinámica solo con casado). Verificar con un dump de cliente casado antes de un run real con casado. **[BLOQUEANTE para clientes casados]**
- [ ] **Comunas fuera de RM** — `portal_select_values.json` solo trae las 52 comunas de la Región Metropolitana; otras regiones caen a texto libre. Cargar las comunas del resto de regiones cuando aparezca un caso no-RM.
- [ ] **Recarga atómica de carpeta** — `subir-caso action=init` borra `client_documents`+Storage antes de subir; una falla a mitad deja el expediente parcial. Cambiar a subir-y-luego-reemplazar para recargas.
- [ ] **Deploy del dashboard** — `rp_carga_documentos` (Next 16, Vercel) — deployar con los cambios de esta sesión.
- [ ] **Auth en rutas API del dashboard** — hoy sin gate de usuario (service-role del lado server). Agregar antes de producción pública.

- [x] **Correr migration_sandbox_v4.sql en sandbox** *(2026-06-18)* — Aplicada en SQL Editor `fnz...`. `clients.airtable_id` creada, `automation_alerts.client_id` → uuid+FK a clients, `automation_jobs.needs_lawyer_review` + `pending_review` en el CHECK. Verificado (3/3 columnas). Fixes: `DECLARE r RECORD` faltante + comparación `client_id::text` en el DELETE (client_id ya era uuid). Tabla `clients` documentada con `COMMENT ON COLUMN` (valores literales del portal). **Sandbox-como-producción: NO se toca el proyecto del abogado (`ton...`).**

- [ ] **(DIFERIDO) Correr migration_prod_v4.sql en producción** — Solo cuando se decida pasar a la DB real del abogado (`ton...`). HOY operamos sandbox-como-producción y NO se toca `ton...`. Migraciones obsoletas (`_v1/_v2/_v3`, sandbox `_v1`/`_v3_cleanup`) ya eliminadas; queda solo `migration_prod_v4.sql` como referencia futura. **Coordinar con abogado.**

- [x] **Gate del abogado (needsLawyerReview) — detención + reanudación (2026-06-19)** — Implementado en dos partes:
  - **Detención (fix B1)**: cuando hay señales de revisión (acreedores NO-CMF a confirmar o `amount_mismatch` del Mapeador) en un run real (`dry_run=false`), el worker marca el job `pending_review` + `needs_lawyer_review=true`, registra una `automation_alert` (`needs_review`) y **no corre Playwright** (`worker.ts`).
  - **Reanudación (2026-06-19)**: nueva columna `automation_jobs.lawyer_confirmed` (BOOLEAN, default false; `supabase/migration_sandbox_v5.sql`). El dashboard (`/automatizacion`) muestra un botón **"Confirmar y reanudar"** en los casos `pending_review` → `POST /api/automatizacion {job_id, action:'resume'}` setea `status='pending'` + `lawyer_confirmed=true` (idempotente por `.eq('status','pending_review')`, maneja 23505 del índice único de job activo). El poller lo retoma; el worker, al ver `lawyer_confirmed`, **continúa el Paso 3** y limpia `needs_lawyer_review=false` (revisión resuelta).
  - Migración aplicada *(2026-06-19)*: columna `lawyer_confirmed` en sandbox. Gate operativo.
  - Validado: `tsc` limpio en ambos repos (renegociacion + rp_carga_documentos).

- [ ] **(DIFERIDO) Apuntar worker a la DB real** — El worker ya usa `clients` / `automation_jobs` en el sandbox `fnz...` (las tablas `pato_prueba_*` quedaron obsoletas, no se usan). Solo si se pasa a la DB del abogado habría que cambiar `SUPABASE_URL` a `ton...`. Hoy NO.

### P2 — Casos pendientes (necesitan docs del abogado)

- [ ] **Jaime Cartes (RUT 17.596.599-8)** — Solicitar certs frescos: Santander TC 2982 + Tenpo TC 9924 + Coopeuch. Con docs nov/2025 el total era ~76 UF (<80 UF). Tributariamente libre. Scripts listos. `institucion_cmf` Santander corregido a `'Santander-Chile'` (como aparece en CMF). Credenciales sandbox `Udechile.0930` rechazadas — confirmar clave actual.
- [ ] **Noelia Lorca (RUT 15.121.553-K)** — Solicitar docs frescos + cert saldo La Araucana + cert Forum. Scripts listos. Centinela detectó 3 NO-CMF: La Araucana $9.5M (Art.260, 322d), Forum $5.4M (Art.260, 164d), tarjeta 9782 $300k (Art.260, ~254d, emisor sin identificar — probablemente BdCh, confirmar). Credenciales sandbox `Jose1705.` rechazadas — confirmar clave actual.
- [ ] **Alejandra Espinoza** — Obtener su Carpeta Tributaria (SII). El resto de sus docs ya están en `client_documents`.

### P3 — Mejoras post-producción

- [ ] **Worker: idempotencia por hash de PDFs** — Si el CMF y los certs no cambiaron desde el último run `completed`, reusar el output de `agent_runs` sin gastar créditos API.
- [x] **Validación "mínimo 2 productos" en TS** *(2026-06-19)* — Guardia en `worker.ts` (bloque step 3/0): `totalQualifyingCount = CMF 90+d + reclasificados Centinela + NO-CMF Art.260`; si `< 2` el caso no califica. En step 3 individual → `status='blocked'` + `automation_alert` (`blocked`) + `error_message` (antes era `failed` sin alerta → "falló sin alerta registrada" en el panel). En step:0 → omite solo el Paso 3 y guarda 1/2/4, con alerta legible. Mensaje explícito con el conteo por fuente. `tsc` limpio.
- [ ] **CT Jorge Romero con formato 2025+** — Re-testear `detectContribucionesDeuda` cuando aparezca una CT con el nuevo layout del SII.

---

## Completadas (sesiones anteriores)

- [x] **CMF Analyzer** — normalización diacríticos, extracción `overdue90DaysTotal`, mapeo columnas dinámico, validación 80 UF
- [x] **Alerts** — `createAlert`/`clearAlert` con `clientsTable`, formato `credential_error`
- [x] **Login** — `CredentialError` tipada, selectores exactos, fallback error genérico
- [x] **Worker** — `instanceof CredentialError`, `alertType` por `.code`
- [x] **Steps 2 y 4** — URL check antes de `waitForSelector`, `logger?.error()` en catch
- [x] **Step 3 Playwright** — `:not(.hidden)` en CMF, timeouts extendidos, estabilización post-cleanup
- [x] **Datos sandbox** — tabla `client_documents` migrada, registros Patricio Martini
- [x] **Cognitive Orchestrator (API Key #2)** — soporte imágenes (JPG/PNG), extracción fechas, MIME detection, pre-chequeo RUT determinista, exención estados de cuenta (30d), 80 UF no bloqueante
- [x] **F29 Activity Check** — `detectF29ActivityLast24Months` en `pdf_analyzer.ts` + `BlockedError` en `worker.ts`
- [x] **`dateDaysAgo` timezone** — usa `America/Santiago` en `step3_acreedores.ts`
- [x] **Prueba E2E completa** — Pasos 1→2→3→4 para Patricio Martini: ✅ 4/4 exitosos (2026-06-09)
- [x] **Dashboard "Carga de Documentos"** (`dashboard_rene`) — vista `/subir-caso` + `/api/subir-caso` para adjuntar CMF + certificados. Fix cap `/api/acreedores` (50→1000).
- [x] **Fix compilación worker** — campo `downloadFailed` faltante en interfaz `ClientDocument`.
- [x] **Pre-chequeo de RUT determinista** — `extractRutsFromText`/`findCatalogEntryByRut` en `acreedor_matcher.ts`; `computeRutCheck` en el orquestador.
- [x] **Sentinel (API Key #1) — base construida** — `src/utils/sentinel.ts` integrado en el worker. Descarga CMF + certificados, pre-análisis TypeScript (fechas, RUT, 30d/estado_cuenta), llama a Claude, devuelve `SentinelResult`. Activado con `ENABLE_SENTINEL=true`.
- [x] **CMF parser fix (hasDates=false)** — formato clásico sin fechas (Claudia): usa detección por espacios en blanco en lugar de `substring` de posición fija. Evita truncar nombres de institución.
- [x] **`qualifying90PlusCount`** — campo en `CmfAnalysisResult`; `meets90DaysRequirement` exige ≥ 2 productos.
- [x] **80 UF usa `totalCredito`** — corregido en `cmf_analyzer.ts`, `step3_acreedores.ts`, `cognitive_orchestrator.ts`.
- [x] **API1_instructions.md** — instrucciones completas del Centinela (API Key #1): flujo CMF → estados de cuenta, algoritmo mora tarjeta/consumo, reclasificación, formato JSON de salida, regla 30d/exención estados de cuenta.
- [x] **Perfil de Claudia en sandbox** — CMF y Carpeta Tributaria de Claudia Silva enlazados al perfil de Patricio Martini para pruebas. `client_documents` vacío (pendiente carga de estados de cuenta).
- [x] **Módulo de acreedores NO-CMF (núcleo)** — Reconciliación documentos − CMF dentro del Centinela. Detecta deudas que no salen en el CMF pero deben declararse (TGR, cajas, fintechs, tarjetas no reportadas). TS hace el diff determinista (`nonCmfReconciliation`, `issuerInCmf` por RUT+nombre); Claude confirma/extrae y devuelve `additionalCreditors[]`. Nuevo campo en `SentinelResult`; propagado por `worker.ts` → `cognitive_orchestrator.ts` (genera los `AcreditacionDoc` no-CMF) → `fillStep3`/`fillAllSteps`. Paso 3 los ingresa en la sección por artículo (`isOtros = categoria_articulo === 261`).
- [x] **Fechas clave deterministas** — `FechaClave[]` en `SentinelResult` (sin Claude): expiración CMF/certificados (+30d) y cruce 261→260 (+91d). No bloqueante, solo alerta/log.
- [x] **Fix matching documento↔acreedor por filename** — Acreedores NO-CMF asocian su documento por `filename` exacto; los del CMF excluyen los reservados a NO-CMF. Resuelve el cruce "mismo banco, productos distintos" (CPF de tarjetas vs. consultaCredito del consumo BdCh). `AcreditacionDoc.filename` agregado; el orquestador lo puebla.
- [x] **Fix all_steps propagación** — `fillAllSteps` ahora propaga `reclassifiedCreditors` y `additionalCreditors` a `fillStep3` (antes el flujo step:0 no pasaba reclasificaciones).
- [x] **Caso Alejandra Espinoza — perfil + documentos cargados** — Fila propia en `clients` (RUT 18.738.680-2, credenciales de portal de Pato), CMF + 5 certificados en `client_documents`. Scripts: `setup_test.ts`, `upload_documents.ts`, `test_step3.ts` (hardcodeado), `test_reconciliacion.ts` (Centinela aislado).
- [x] **Prueba E2E Paso 3 — Alejandra (2026-06-14)** — `test_step3.ts` ✅ 5/5 acreedores: CAT + CMR (Art. 260) y BdCh consumo + 2 tarjetas NO-CMF (Art. 261), con documentos correctos por filename. DRY_RUN limpió el borrador.
- [x] **Monto y vencimiento "según el documento" (no del CMF)** — El Paso 3 ahora ingresa el monto del documento de acreditación (override del CMF, dentro de tolerancia) y la fecha real de la cuota impaga (reemplaza el placeholder `dateDaysAgo(90)`). Fuentes: `reclassifiedCreditors` (`total_credito_clp` + `delinquency_start_date`), `additionalCreditors` (no-CMF), y `cmfDocumentOverrides` (260 directos del CMF). El **monto efectivo** se propaga a idempotencia y adjunción (que matchean por monto). Verificado E2E con Alejandra: CAT $11.275.392/05-09-2025, CMR $1.781.499/25-08-2025.
- [x] **PR `pm/feat-acreedores-no-cmf` → `main` preparado (2026-06-15)** — Rama limpia (tsc exitoso, git status vacío), 3 commits sobre main (ff5642e → 0697c84), pusheada a origin. Incluye: módulo acreedores no-CMF, monto/vencimiento desde documento, caso Alejandra E2E, .gitignore para scripts de diagnóstico, análisis_deudas.md actualizado. Link: https://github.com/narsil9/renegociacion/compare/main...pm/feat-acreedores-no-cmf
- [x] **Deuda técnica resuelta — commit cambios acumulados** — Todos los archivos pendientes (sentinel.ts, step3, cognitive_orchestrator, cmf_analyzer, pdf_analyzer, worker, step1, API1_instructions.md) están en los commits f71aa39 y ff5642e de la rama.
- [x] **Deuda técnica resuelta — limpiar utils de prueba** — ~50 scripts de diagnóstico en `src/utils/` (inspect_*, check_*, test_*, migrate_*, scan_*, etc.) cubiertos por patrones en `.gitignore`. El árbol queda limpio sin eliminar los archivos.
- [x] **Confirmación E2E Paso 3 Alejandra (2026-06-15)** — Segunda ejecución `test_step3.ts` ✅ 5/5 acreedores, 0 saltados: BdCh consumo $3.125.486 (261), CAT $11.275.392/05-09-2025 (260), CMR $1.781.499/25-08-2025 (260), Visa Platinium $517.442 NO-CMF (261), Visa Entel $1.407.530 NO-CMF (261). Matching por filename perfecto. DRY_RUN limpió. **Caso Alejandra CERRADO.**

- [x] **Prueba E2E Paso 3 — Claudia Silva (2026-06-15)** — `test_step3.ts` ✅ 2/2 acreedores: BdCh Consumo $48.236.275/03-09-2024 (reclasificado 261→260 por Sentinel) y CAR Ripley $1.218.565/25-08-2024 (reclasificado 261→260). Monto y fecha tomados del documento. DRY_RUN limpió. **Caso Claudia CERRADO.**

- [x] **Prueba E2E Paso 3 — Betzy Lee (2026-06-15)** — ✅ 5/5: BdCh consumo $18.191.754 reclasificado (261→260) + BdCh tarjeta $3.716.235 NO-CMF Art.260 + 3 Art.261 (CAT, CMR, PRESTO). Patrón validado: mismo banco, producto fuera del CMF → `additionalCreditors`. `reservedNonCmfFilenames` evita cruce de docs. **Caso Betzy CERRADO.**

- [x] **Prueba E2E Paso 3 — Yoselyn Reyes (2026-06-15)** — ✅ 8/8: 4 Art.260 del CMF (BancoEstado, BCI, CAR Ripley, CMR) + 1 Art.261 (Coopeuch) + 3 NO-CMF Art.261 (CCAF Los Andes). Lección: "Caja Los Andes" en docs = "CCAF Los Andes" en catálogo (RUT 81826800-9). cmfDocumentOverrides con 4 entradas. **Caso Yoselyn CERRADO.**

- [x] **Prueba E2E Paso 3 — Susana Matamala (2026-06-15)** — ✅ 4/4: CMF consolida 3 ops BdCh en 1 fila ($11.601.044) → EEDD_7616.pdf certifica $13.304.962 (c/intereses). CMR, CAT, CAR Ripley. Sin Sentinel. CT usa la de Pato Martini (pendiente SII). **Caso Susana CERRADO.**

- [x] **Prueba E2E Paso 3 — María Paz Bravo (2026-06-15)** — ✅ 5/5: CMR ($9.763.965/05-08-2025) + Itaú ($5.134.284/25-08-2025, 3 productos en 1 fila CMF) + BancoEstado×2 (Vivienda $71.189.175 + Línea $1.031.582, 1 doc cubre ambas filas) + Coopeuch $16.905.601. Catálogo BANCO ITAU corregido (RUT 97023000-9, comuna Las Condes). **Caso María Paz CERRADO.**

- [x] **Fix `getReclassifiedMatch` tiebreaker (2026-06-15)** — Cuando el Sentinel reclasifica múltiples productos del mismo banco (ej. BdCh consumo + BdCh tarjeta), el `find` original siempre devolvía el primero. Ahora usa `filter` + `reduce` por `totalCredito` más cercano como desempate. Validado: la brecha entre productos (millones) siempre supera la brecha CMF/doc ($300–500k).

- [x] **Análisis de deudas Jaime Cartes, Noelia Lorca, Nicolás Bascuñán y William Montero — generados por Codex/Gemini (2026-06-15)** — Los cuatro `analisis_deudas.md` fueron producidos por agentes externos (Codex / Gemini) usando la skill `/analisis-deudas-renegociacion`. Claude los leyó y asimiló en esta sesión. Resumen: Jaime y Noelia **bloqueados** tributariamente (ver Pendientes). Nicolás y William tienen análisis completos y están listos para crear sus scripts de prueba.

---

## En Curso — Arquitectura Multi-Agente (Pasos 2 y 3)

Objetivo: reemplazar los valores hardcodeados de `test_step3.ts` y el análisis manual de docs por agentes Claude que extraen datos, con TS que valida antes de pasarlos a Playwright. En producción los docs deben tener ≤30 días (excepción: estados de cuenta). En pruebas: `BYPASS_DATE_CHECK=true`.

### Flujo objetivo

```
Docs (CMF + certs + carpeta tributaria)
  ├── TS: parse CMF (cmf_analyzer.ts, gratis/determinista) → agent_runs
  ├── Agente Tributario → categoria + F29 → agent_runs       [Step 2]
  ├── Agente Centinela  → reclasif + no-CMF + montos/fechas → agent_runs  [Step 3]
  └── Agente Mapeador   → lee JSONs de agent_runs → step3_config → agent_runs  [Step 3]
        ↓
  TS Validator (regla 30d, RUT, 2 prods, 80 UF, vencimientos 260)
        ↓
  Playwright Step 2 / Step 3
```

### Infraestructura base
- [x] **Tabla `agent_runs` en Supabase** — `supabase/schema_agent_runs.sql` creado y ejecutado en SQL Editor (2026-06-16). `src/agents/agent_runs.ts` con CRUD tipado.
- [x] **Interfaces TypeScript de output** — `TributarioOutput`, `CmfParseOutput`, `CentinelaOutput`, `MapeadorOutput` + `AgentRunRow<T>` en `src/agents/types.ts`.
- [x] **TS Validator (`src/agents/validator.ts`)** — Type guards por output, regla 30d (bypasseable), ≥2 productos, ≥80 UF (advertencia), Art.260 con fecha, filenames únicos por institución, needsLawyerReview propagado. `mergeResults` + `logValidationResult` helpers.

### Agente Tributario (Step 2)
- [x] **`src/agents/tributario_agent.ts`** — Estrategia dual: texto→determinista / escaneado→Claude Opus 4.8 con documento base64. Idempotencia por SHA-256. Valida con `validateTributarioOutput` antes de `completeRun`. F29 con actividad → `needsLawyerReview = true`.
- [x] **Conectar al worker** — `worker.ts` llama a `runTributarioAgent` en step 2 y step 0. Eliminados `analyzeTaxCategory` y `detectF29ActivityLast24Months` del worker. `BlockedError` y alerta en `automation_alerts` preservados.
- [x] **`detectContribucionesDeuda` (2026-06-16)** — Detección determinista de deudas por contribuciones (Impuesto Territorial) en la CT. Sección "Propiedades y Bienes Raíces", regla AFECTO+vencidas=SI. `ContribucionProperty[]` en `TributarioOutput.contribuciones_deuda`. Validator → `needsLawyerReview=true`. Validado con CT Jorge Romero: Rol BD 20 (Bodega/Almacenaje). ⚠️ Re-testear con CT de nuevo formato 2025+.

### Agente Centinela (Step 3)
- [x] **`src/agents/centinela_agent.ts`** — Wrapper de `sentinel.ts` con idempotencia SHA-256, agent_runs (step=3), `validateCentinelaOutput` antes de completeRun, conversión `SentinelResult→CentinelaOutput`. `ENABLE_SENTINEL=false` → bypass sin escribir a agent_runs. `CentinelaBlockedError` para bloqueos semánticos. `cmfDocumentOverrides` vacío (TODO próxima iteración).
- [x] **Worker conectado al centinela_agent** — `runSentinelCheck` eliminado del worker. Centinela se corre dentro del bloque `step===3|0` después del CMF descargado. `orchResult`, `fillStep3` y `fillAllSteps` consumen `centinelaOutput.*`.
- [x] **Fix `technicalError` en sentinel.ts** — Campo `technicalError?: boolean` en `SentinelResult`; catch externo lo marca `true`. `centinela_agent.ts` distingue: técnico → throw Error genérico (reintentable), semántico → `CentinelaBlockedError` (bloquea caso). Antes, API caída o créditos agotados bloqueaban el caso permanentemente.
- [ ] **Probar con Alejandra** — `test_centinela_agent.ts` listo en `casos/alejandra_espinoza/`. Bloqueado: falta CT del SII. Correr cuando llegue la CT: `BYPASS_DATE_CHECK=true npx ts-node --transpile-only -r dotenv/config casos/alejandra_espinoza/test_centinela_agent.ts`

### Agente Mapeador (Step 3)
- [x] **`src/agents/mapeador_agent.ts`** — Wrapper de `cognitive_orchestrator.ts` con idempotencia (hash = centinela run ID), agent_runs (step=3), conversión `OrchestrationResult→MapeadorOutput`. Errores técnicos → failRun+throw (retry). Errores semánticos (missing_document, rut_mismatch) → completeRun con needsLawyerReview. `mapeadorHasBlockers()` helper para el worker.
- [x] **Worker conectado al mapeador_agent** — `runCognitiveOrchestrator` eliminado del worker. Worker llama `runMapeadorAgent` y usa `mapeadorHasBlockers` para decidir si bloquea el Paso 3.
- [x] **`cmfDocumentOverrides` desde el Centinela** — El Centinela extrae monto+fecha de cada cert (260 directos) y los pasa al Mapeador. Implementado y validado con Carlos Uribe (Internacional + CMR Falabella).
- [x] **Fix cognitive_orchestrator — streaming + budget_tokens (2026-06-17)** — `messages.create` → `messages.stream()` + `stream.finalMessage()`. `thinking: { type: 'adaptive' }` → `{ type: 'enabled', budget_tokens: 8000 }`. Resuelve "Unexpected end of JSON input" (Claude consumía todos los tokens en thinking). Texto por cert reducido: 20k→4k chars (orchestrator) y 12k→4k chars (sentinel). Mismo fix ya aplicado a sentinel.ts en sesión anterior.
- [x] **E2E cadena completa (Steps 1→4) — Carlos Uribe (2026-06-17)** — ✅ 5/5: Internacional $19.591.001/02-09-2025 (260), CMR Falabella $1.867.320/05-10-2025 (260), BancoEstado $3.790.012 (261), Santander $5.176.316 (261), Itaú $26.908.918 (261). Primer test con cadena completa tributario→centinela→mapeador→Playwright. DRY_RUN limpió.
- [x] **OCR local multi-página Tesseract (2026-06-17)** — `src/utils/ocr_helper.ts` nuevo con `runOcrOnPdf` (pdftoppm→tesseract spa, todas las páginas) y `extractTextWithOcrFallback`. Reemplaza GS+Vision (página 1 solo) en `sentinel.ts` y `cognitive_orchestrator.ts`. Tributario: OCR-first para CTs escaneadas, Claude Opus solo como fallback. `pdf_analyzer.ts`: 3 funciones aceptan `preExtractedText?` (retrocompatible). Validado con EECC escaneados Cencosud (7432 chars vs 0 antes).
- [x] **Mapeador determinista (2026-06-17)** — `src/utils/deterministic_mapeador.ts` nuevo con `buildMappedDocsDeterministic`. Elimina la segunda llamada LLM (Claude) del Mapeador (~2 min). Mapeo en memoria desde `CentinelaOutput.document_filename` + `client_documents`. 0 tokens de API. `mapeador_agent.ts`: usa determinista por defecto; Claude como fallback con `FORCE_VISION_MAPEADOR=true`. Validado con Carlos Uribe: 10 docs, 0 alertas, milisegundos.
- [x] **E2E cadena completa (Steps 1→4) — Cinthia Rodríguez (2026-06-17)** — ✅ 7/7: Banco Estado $1.290.159 (261), CAR Ripley $1.647.930 (261), CAT/CENCOSUD $6.783.469 (260 CMF), PRESTO LIDER $646.166 (261), CMR Falabella $2.558.037 (260 CMF), Solventa $300.810 (261), Fashion's Park $98.716 (260 NO-CMF). Corregidos 2 bugs: `normInst(null)` en `deterministic_mapeador.ts` y `matchAcreedor(null)` en `step3_acreedores.ts` cuando `AdditionalCreditor.institucion_cmf` es null. CT categoría `ninguna` (escaneada). DRY_RUN limpió.

### Conexión al flujo real
- [x] **Batch completo 10 casos (2026-06-17)** — `casos/run_batch_full_chain.ts` corrió todos los casos no bloqueados. Resultado: ✅ 9 ok, ⏭️ 1 skip (Alejandra sin CT), ❌ 0 errores.
- [x] **Fix parsers nuevos formatos PDF (2026-06-18)**
  - CMF Ley 21.680: columnas a posiciones 0–41 (institución), 42–67 (tipo), 68+ (fecha). Fix `sliceAEnd=42`, `sliceBEnd=68`. Fix stripping de `(N)` global (no solo al final) en nombres de institución.
  - CT 2026 F29: sección F22 aparece después de F29 — `pdf_analyzer.ts` ahora trunca `f29Section` en el límite de F22 para evitar falsos positivos de actividad en `04/2026`.
  - Validados con CT `20260602-232145_carpeta_tributaria.pdf` y CMF `informe_deudas_18680500-3.pdf` (formato nuevo).
- [x] **Worker queue E2E — primer run histórico (2026-06-18)** — Ver P1 completada arriba. Job `d65d7a9f` Cinthia Rodríguez: Steps 1→4, 6/6 acreedores CMF, `status=success`.
- [x] **Test de producción Jaime + Noelia (2026-06-18)** — Pipeline validado sin bypass: Centinela bloqueó en ambos casos por CMF vencido. Jaime: `CMF_EXPIRED` 203d + 2 certs vencidos. Noelia: `CMF_EXPIRED` 191d + 5 certs vencidos + 3 NO-CMF detectados (La Araucana Art.260, Forum Art.260, tarjeta 9782 Art.260). Infra validada: ✅ Anthropic API, ✅ OCR Tesseract, ✅ Centinela por defecto, ✅ upload_documents con client_documents.
- [ ] **Worker + gate + aliases + run real** → ver sección **PRIORIDAD** al inicio del documento.

---

## Completadas (sesiones anteriores)

- [x] **CMF Analyzer** — normalización diacríticos, extracción `overdue90DaysTotal`, mapeo columnas dinámico, validación 80 UF
- [x] **Alerts** — `createAlert`/`clearAlert` con `clientsTable`, formato `credential_error`
- [x] **Login** — `CredentialError` tipada, selectores exactos, fallback error genérico
- [x] **Worker** — `instanceof CredentialError`, `alertType` por `.code`
- [x] **Steps 2 y 4** — URL check antes de `waitForSelector`, `logger?.error()` en catch
- [x] **Step 3 Playwright** — `:not(.hidden)` en CMF, timeouts extendidos, estabilización post-cleanup
- [x] **Datos sandbox** — tabla `client_documents` migrada, registros Patricio Martini
- [x] **Cognitive Orchestrator (API Key #2)** — soporte imágenes, extracción fechas, MIME detection, pre-chequeo RUT determinista, exención estados de cuenta
- [x] **F29 Activity Check** — `detectF29ActivityLast24Months` + `BlockedError`
- [x] **`dateDaysAgo` timezone** — usa `America/Santiago`
- [x] **Prueba E2E Pasos 1→4 Patricio Martini** — ✅ 4/4 (2026-06-09)
- [x] **Dashboard "Carga de Documentos"** — vista `/subir-caso` + `/api/subir-caso`. Fix cap acreedores.
- [x] **Pre-chequeo RUT determinista** — `extractRutsFromText`/`findCatalogEntryByRut`/`computeRutCheck`
- [x] **Sentinel (API Key #1) — base construida** — `sentinel.ts` integrado en worker. `ENABLE_SENTINEL=true`.
- [x] **`qualifying90PlusCount`** + **80 UF usa `totalCredito`** corregidos
- [x] **Módulo no-CMF (núcleo)** — reconciliación doc−CMF, `AdditionalCreditor`, `FechaClave[]`, match por filename
- [x] **Fix `getReclassifiedMatch` tiebreaker** — filter + reduce por `totalCredito` más cercano
- [x] **Monto y vencimiento "según el documento"** — override CMF, `cmfDocumentOverrides`, monto efectivo propagado
- [x] **Fix all_steps propagación** — `reclassifiedCreditors` + `additionalCreditors` a `fillStep3`
- [x] **E2E Step 3 — Alejandra Espinoza** — ✅ 5/5 (2026-06-14 y 2026-06-15). CAT+CMR 260, BdCh consumo+2 tarjetas NO-CMF 261.
- [x] **E2E Step 3 — Claudia Silva** — ✅ 2/2 (2026-06-15). BdCh Consumo+CAR Ripley reclasif. 260.
- [x] **E2E Step 3 — Betzy Lee** — ✅ 5/5 (2026-06-15). BdCh reclasif.+tarjeta NO-CMF 260, 3×261.
- [x] **E2E Step 3 — Yoselyn Reyes** — ✅ 8/8 (2026-06-15). CCAF Los Andes NO-CMF.
- [x] **E2E Step 3 — Susana Matamala** — ✅ 4/4 (2026-06-15). CMF consolida 3 ops BdCh en 1 fila.
- [x] **E2E Step 3 — María Paz Bravo** — ✅ 5/5 (2026-06-15). Itaú RUT corregido.
- [x] **E2E Step 3 — Nicolás Bascuñán** — ✅ 10/10 (2026-06-16). 2×CCAF+2×Muni NO-CMF.
- [x] **E2E Step 3 — William Montero** — ✅ 11/11 (2026-06-16). TGR NO-CMF Art.260 real.
- [x] **Commit rama `pm/feat-acreedores-no-cmf`** + **`.gitignore` utils prueba** — resueltos.

---

## Arquitectura de agentes (objetivo producción)

| Momento | Agente | Input | Output → Supabase |
|---|---|---|---|
| Step 2 | **Agente Tributario** | carpeta_tributaria.pdf | `{ categoria, f29_meses }` |
| Step 3 (TS) | **CMF Parser** | informe_cmf.pdf | `CmfCreditor[]` (determinista) |
| Step 3 | **Agente Centinela** | CMF JSON + certs PDFs | `{ reclasificados, no-CMF, overrides, fechas_emision }` |
| Step 3 | **Agente Mapeador** | JSONs de agent_runs | `{ mappedDocs[], step3_config }` |
| Step 3 | **TS Validator** | MapeadorOutput | Bloquea si regla 30d / RUT / monto falla |
| Steps 2+3 | **Playwright** | step3_config + categoria | Llena portal Superir |
