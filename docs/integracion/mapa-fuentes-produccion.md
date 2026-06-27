# Mapa de fuentes — Supabase de producción (`ton…`)

> **Qué es.** El mapa de referencia de **dónde vive cada cosa** en la base de datos de
> producción del estudio (Supabase, proyecto `tonrzmlrrcnizamtzqte` = `ton…`). Cuando
> haya que leer un dato o un documento de un cliente, **mirá la tabla de "Índice rápido"
> y andá directo a la tabla correcta** — sin adivinar.
>
> **Verificado en vivo** contra la DB el **2026-06-27** (read-only) con
> `tools/audit_prod_sources.ts`. Los counts son reales a esa fecha.
>
> **⚠️ REGLA DE ORO — SOLO LECTURA.** Sobre `ton…` se hace **únicamente SELECT/GET**.
> NUNCA insert/update/delete. Lo dice CLAUDE.md ("Sandbox-como-producción"): hoy operamos
> sobre el sandbox `fnz…`; `ton…` se lee, no se escribe. Credenciales: `PROD_SUPABASE_URL`
> + `PROD_SUPABASE_SERVICE_ROLE_KEY` en `.env` (es service-role = acceso total → la
> autodisciplina de solo-lectura es nuestra).

---

## 0. La llave para armar un "caso" (join spine)

Un cliente vive partido en dos espacios de identidad:
- Datos **a nivel persona** → se ligan por **`rut`** (formato `XXXXXXXX-X`, con DV; incluye `K`).
- Datos **a nivel caso** → se ligan por **`airtable_id`** (rec-id, ej. `recv4k7Zv8zIR6Jlg`).

La tabla que carga **ambas llaves a la vez** y es el punto de entrada es **`v_casos_renegociacion`**
(vista pública; envuelve a `reports.casos_renegociacion`).

```
v_casos_renegociacion   → airtable_id + rut (+ email, teléfono, drive_link, estado, monto)
  ├─ por rut → core.persona                 (nombre, fecha_nac, estado_civil, profesión, ClaveÚnica)
  │             └─ persona.airtable_main_id → bronze_customers_main  (Domicilio, Comuna, Ciudad)
  ├─ por airtable_id → renegociacion_overrides         (CMF interpretado + claves override + SII json)
  ├─ por airtable_id → renegociacion_documento_match   (calce documento→acreedor)
  ├─ por airtable_id → mac_mini_jobs                   (PDFs SII: Carpeta Tributaria, Agentes Retenedores)
  ├─ por case_airtable_id = airtable_id → cmf_informes (PDF CMF crudo + metadata)
  └─ por rut_norm (rut SIN puntos/guion, ej. 10385026k) → renegociacion_audit_pdf  (PDFs del cliente)
```

⚠️ `cmf_informes.case_airtable_id` = el `airtable_id` del **caso** (NO `project_airtable_id`).
⚠️ `renegociacion_audit_pdf.rut_norm` viene **sin puntos ni guion** → normalizar al cruzar.

---

## 1. Índice rápido — "necesito X → andá a esta tabla"

| Necesito… | Tabla / fuente | Schema | Llave |
|---|---|---|---|
| Encontrar el caso (rut + airtable_id) | `v_casos_renegociacion` | public | `rut` / `airtable_id` |
| Email, teléfono, drive_link, estado, asesor, T0–T90 | `v_casos_renegociacion` | public | `airtable_id` |
| Nombre, fecha nac., estado civil, profesión, nacionalidad | `core.persona` | core | `rut` |
| **ClaveÚnica** | `core.persona.clave_unica` (fallback `renegociacion_overrides.airtable_clave_unica`) | core / public | `rut` / `airtable_id` |
| Domicilio, Comuna, Ciudad | `bronze_customers_main.data` (JSON) | public | `persona.airtable_main_id` |
| **PDF del Informe CMF** | `cmf_informes` (bucket `informes-cmf`) | public | `case_airtable_id` |
| CMF ya interpretado (deudas por institución) | `renegociacion_overrides.cmf_deudas_json` | public | `airtable_id` |
| **PDF Carpeta Tributaria / Agentes Retenedores** | `mac_mini_jobs` (bucket `expedientes-sii`) | public | `airtable_id` |
| Datos SII estructurados (F1887 sueldos, F1879 honorarios…) | `renegociacion_overrides.sii_*_json` | public | `airtable_id` |
| **PDFs de certificados del cliente** | `renegociacion_audit_pdf` (bucket `audit-attachments`) | public | `rut_norm` |
| Qué certificado es de qué acreedor (calce + validación) | `renegociacion_documento_match` | public | `airtable_id` |
| Catálogo de acreedores (nombre canónico + RUT) | `acreedores_canonicos` | public | `nombre` / `rut` |

---

## 2. Detalle por tabla

> Para cada tabla: **qué guarda**, **columnas reales** (introspección 2026-06-27),
> **cobertura** y **qué lee/leería nuestra automatización**.

### `v_casos_renegociacion` — vista principal del caso · **1.201 filas**
Vista pública (envuelve `reports.casos_renegociacion`, idéntica). **Punto de entrada.**
- **Columnas (31):** `airtable_id, at_record_id, rut, nombre, email, telefono, t0_airtable, t0_override, t0, t60, t89, t90, documentos_md, drive_link, monto, prioridad, fecha_audiencia_adp, fecha_audiencia_ar, fecha_cmf, cmf_log, asesor, project_status, project_airtable_id, bronze_updated_at, documentos_drive, checklist_sii, checklist_extras, checklist_overrides, notas, estado, override_updated_at`
- **Nosotros leemos:** `rut`, `airtable_id` (spine), `email`, `telefono`, `nombre`, `drive_link`.

### `core.persona` — identidad de la persona · **1.494 filas**
- **Columnas (13):** `id, rut, nombre_completo, fecha_nacimiento, nacionalidad, estado_civil, profesion, clave_unica, airtable_main_id, is_deleted, created_at, updated_at, clave_unica_comprometida`
- **Cobertura real:** `clave_unica` **1.407/1.494** · `estado_civil` **1.404** · `profesion` **946** · `fecha_nacimiento` **0** (🔴 columna existe pero vacía).
- **Nosotros leemos:** `clave_unica` (login), `nombre_completo`, `estado_civil`, `profesion`, `nacionalidad` (Paso 1).
- ⚠️ `estado_civil`/`profesion` son **texto libre** → hay que mapearlos a los enums del portal (`portal_select_values.json`).

### `renegociacion_overrides` — CMF interpretado + credenciales + SII · **1.135 filas**
- **Columnas (27):** `airtable_id, documentos_drive, checklist_sii, notas, estado_override, updated_at, updated_by, t0_override, checklist_extras, checklist_overrides, clave_cu_override, clave_ct_override, credenciales_updated_at, credenciales_updated_by, airtable_clave_unica, airtable_clave_ct, airtable_creds_synced_at, cmf_deudas_json, checklist_generated_at, checklist_generated_from, sii_carpeta_json, sii_boletas_json, sii_agente_json, sii_carpeta_generated_at, sii_boletas_generated_at, sii_agente_generated_at, cmf_etapa_mora`
- **Cobertura:** `cmf_deudas_json` **39/1.135** (🔴 interpretación CMF escasa — pero ver nota).
- **Nosotros leemos:** `airtable_clave_unica`/`clave_cu_override` (fallback de ClaveÚnica). El resto es **opcional**.
- 📌 **Nota clave:** NO dependemos de `cmf_deudas_json` — nuestro worker **parsea el PDF crudo del CMF** (`cmf_analyzer.ts`). Para el CMF nuestra cobertura real es **1.641** (los PDF en `cmf_informes`), no 39.

### `cmf_informes` — PDF crudo del Informe CMF · **1.641 filas** · bucket `informes-cmf`
- **Columnas (15):** `id, airtable_id, airtable_attachment_id, filename, storage_path, pdf_size_bytes, fecha_emision, log_descarga, source, synced_at, case_airtable_id, fecha_emision_pdf, fecha_informacion_pdf, pdf_extracted_at, pdf_extract_error`
- **Nosotros leemos:** `storage_path` (descargar el PDF), `fecha_emision` (regla 30d), `case_airtable_id` (join).
- ⚠️ Frescura <30d NO garantizada → filtrar por `fecha_emision` o re-pedir cerca del envío.

### `mac_mini_jobs` — cola del robot SII (Mac Mini) · **1.668 filas** · bucket `expedientes-sii`
- **Columnas (18):** `id, command, args, requested_by, source, airtable_id, status, result, result_text, error, exit_code, duration_ms, created_at, started_at, completed_at, not_before, retry_count, retry_reason`
- **Nosotros leemos:** filas con `command='sii-carpeta'`/`'sii-agente-retenedor'` y `status='done'` → path del PDF en `result`.
- ⚠️ Es el robot de **descarga SII** del estudio (separado del nuestro). `args` puede contener la ClaveÚnica → no loguear.

### `renegociacion_audit_pdf` — PDFs del cliente (correos) · **5.001 filas** · bucket `audit-attachments`
- **Columnas (15):** `id, rut_norm, filename, filename_safe, size_bytes, content_hash, storage_path, email_date, email_subject, email_from, in_drive_too, created_at, direccion, tipo_documento, descripcion_detectada`
- **Nosotros leemos:** `tipo_documento='documento_checklist'` + `storage_path` (los certificados). `descripcion_detectada` = texto del tipo de doc.
- ⚠️ Llave por `rut_norm` (sin puntos/guion). **No trae el RUT del emisor** del cert (brecha #5; nosotros lo extraemos con `cert_institution_resolver.ts`).

### `renegociacion_documento_match` — calce certificado→acreedor · **395 filas**
- **Columnas (20):** `id, airtable_id, drive_file_id, acreedor, documento_descripcion, confidence, reasoning, is_match, overridden_by_human, overridden_by_email, llm_model, created_at, updated_at, candidates_json, candidates_computed_at, validation_status, validation_reason, validation_note, validated_by_email, validated_at`
- **Qué guarda:** el resultado del agente del dashboard (lee cada PDF, lo asocia a un acreedor con `confidence`; el abogado valida con `validation_status`).
- **Nosotros leeríamos (futuro):** `acreedor` + `documento_descripcion` + `is_match` como **input** del Paso 3 — pero re-verificamos el monto determinísticamente (no confiamos en la extracción LLM como estructura).

### `acreedores_canonicos` — catálogo de acreedores · **501 filas**
- **Columnas (16):** `id, nombre, nombre_normalizado, tipo, rut, direccion, comuna, email, telefono, representante_legal, rut_representante, observaciones, is_administrativo, activo, created_at, updated_at`
- **Nota:** nuestro sandbox tiene su **propia** copia de `acreedores_canonicos` (la que usa `acreedor_matcher.ts`). Comparar para no divergir.

### `bronze_customers_main` — datos crudos de Airtable · **1.325 filas**
- Domicilio/Comuna/Ciudad viven en el **JSON `data`**. Claves confirmadas:
  `Ciudad, Comuna, Titulo, Domicilio, Full name, Created on, First name, Needs push, Clave Unica, Modified on, origRecIDRN, Estado Civil, Nacionalidad, Customers_sub, Last Modified, Customer_main ID, RUT (individual)`
- **Nosotros leemos (Paso 1):** `data->>'Domicilio'`, `data->>'Comuna'`, `data->>'Ciudad'`.

---

## 3. Storage (buckets, todos privados → signed URL)

| Bucket | Contenido | Tabla índice |
|---|---|---|
| `informes-cmf` | PDF del Informe CMF | `cmf_informes.storage_path` |
| `expedientes-sii` | PDFs SII (Carpeta Tributaria, Agentes Retenedores, boletas, avalúos) | `mac_mini_jobs.result` |
| `audit-attachments` | PDFs que el cliente mandó por correo (certificados, cédula, etc.) | `renegociacion_audit_pdf.storage_path` |

---

## 4. Brechas conocidas (lo que falta de su lado para el Paso 1 del portal)

| # | Brecha | Severidad | Detalle |
|---|---|---|---|
| 1 | **`fecha_nacimiento`** — columna existe en `core.persona` pero **0/1.494 poblada** | 🔴 Bloqueante | Obligatoria en el portal. Obtener de la Carpeta Tributaria o pedir al cliente. (Ojo: la CT NO trae DOB.) |
| 2 | **`region`** y **`ocupacion`** no existen en ningún lado | 🔴 | `region` derivable de comuna (tabla comuna→región); `ocupacion` sin fuente. |
| 3 | `domicilio`/`comuna`/`ciudad` solo en `bronze` (JSON), no en `core` | 🟡 | Leer de `bronze_customers_main.data`. |
| 4 | `estado_civil`/`profesion` en texto libre, no en código/etiqueta del portal | 🟡 | Mapear con `portal_select_values.json`. |
| 5 | Certificados NO traen el RUT del emisor extraído | 🟡 | Nosotros ya lo resolvemos con `cert_institution_resolver.ts`. |
| 6 | Frescura <30d del CMF/certificados no garantizada | 🟡 | Filtrar por `fecha_emision` / re-descargar cerca del envío. |

> El CMF interpretado escaso (39 casos) **NO es brecha para nosotros**: parseamos el PDF crudo (1.641).

---

## 5. Cómo re-verificar este mapa

```bash
npx ts-node --transpile-only -r dotenv/config tools/audit_prod_sources.ts
```
(Read-only. Imprime existencia + cobertura de cada fuente. Requiere `PROD_SUPABASE_*` en `.env`.)
