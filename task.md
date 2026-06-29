# Tareas: Automatización Superir — Estado Actual

> **Acá viven SOLO las tareas vigentes.** El historial de tareas cerradas está en **git**
> (commits) y en las **memorias** de Claude (`memory/`, casos cerrados `project_*_closed`,
> arquitectura, reglas). No se acumulan planes ya cumplidos.

---

## 🔗 NORTE — Convergencia con el dashboard del supervisor

Pipeline objetivo: **su dashboard** (`rp_renegociaciones-auth-admin`, prod Supabase `ton…`)
recopila/clasifica docs → marca **"cliente listo"** → el abogado aprieta **Ejecutar** (encola un job)
→ **nuestro worker** corre Pasos 1→4 en el portal. Él = aguas arriba; nosotros = ejecutor aguas abajo.
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

### Etapa 3 — Conectar el botón "Ejecutar" (ÚLTIMO, con el supervisor)
- [ ] Acordar el mecanismo de trigger (su patrón `mac_mini_jobs` o tabla nueva) → job con RUT/airtable_id.
- [ ] Darle la **definición de "cliente listo"** (precondiciones del portal: ≥2 deudas 90+d, ≥80 UF,
      sin Primera Categoría F29, CMF/certs <30d, certs presentes) para que el botón no rebote en el worker.

---

## 🚧 Bloqueante real para producción (Frente B — producto, con el supervisor)

- [ ] **Fuente de `fecha_nacimiento`** — vacía en `core.persona` (0/1.494); **obligatoria** en el Paso 1.
  Decidir de dónde sale: extraer de la Carpeta Tributaria / pedirla al cliente en el flujo de él /
  cargarla el abogado. *(En pruebas la inventamos; para un envío real hay que resolverla.)*
- [ ] **`region`** (derivable de comuna vía tabla comuna→región) y **`ocupacion`** (sin fuente hoy).

---

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
