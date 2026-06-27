# Mapeo del contrato Superir → nuestro esquema Supabase

> **Qué es esto.** Respuesta al "Contrato de integración — Inputs de la automatización Superir".
> Para cada input que su robot necesita (§3 y §6 de su doc), acá está **dónde vive en NUESTRO
> Supabase**: schema, tabla, columna, cobertura real (medida en prod `tonrzmlrrcnizamtzqte`,
> 2026-06-24) y notas de formato/brecha.
>
> Proyecto Supabase: `tonrzmlrrcnizamtzqte`. Schemas relevantes: `core`, `reports`, `public`, `airtable_raw`.

---

## 0. La llave para armar un "caso" (join spine)

Un cliente vive partido en dos espacios de identidad. **Esta es la parte crítica del merge:**

- Datos **a nivel persona** se ligan por **`rut`** (formato `XXXXXXXX-X`).
- Datos **a nivel caso** se ligan por **`airtable_id`** del caso (id rec-based, ej. `recv4k7Zv8zIR6Jlg`).
- La tabla que carga **ambas llaves a la vez** y es el punto de entrada natural es **`reports.casos_renegociacion`**.

Cadena verificada con un caso real (Estela Farías, RUT `10385026-6`):

```
reports.casos_renegociacion   → airtable_id = recv4k7Zv8zIR6Jlg, project_airtable_id = recA1RQyBqhTKORo7, rut = 10385026-6
  ├─ por rut → core.persona            (nombre, nacionalidad, estado_civil, profesion, clave_unica)
  │             └─ persona.airtable_main_id → bronze_customers_main  (Domicilio, Comuna, Ciudad)
  ├─ por airtable_id → renegociacion_overrides   (CMF interpretado + checklist + claves override)
  ├─ por airtable_id → renegociacion_documento_match   (calce documento→acreedor)
  ├─ por airtable_id → mac_mini_jobs   (PDFs SII: Carpeta Tributaria, Agentes Retenedores)
  ├─ por case_airtable_id = airtable_id → cmf_informes   (PDF CMF crudo + metadata)
  └─ por rut_norm (rut sin puntos/guion) → renegociacion_audit_pdf   (PDFs del cliente, interpretados)
```

⚠️ Confirmado: `cmf_informes.case_airtable_id` = `reports.casos_renegociacion.airtable_id` (el id del **caso**, NO el `project_airtable_id`).

---

## A. Identidad y credenciales — [OBLIGATORIO]

| Su input | Nuestra fuente (schema.tabla.columna) | Cobertura | Notas |
|---|---|---|---|
| **RUT** `XXXXXXXX-X` | `core.persona.rut` · `reports.casos_renegociacion.rut` · `bronze_customers_main.data->>'RUT (individual)'` | total | Ya en formato con guion + DV (incluye `K`). `renegociacion_audit_pdf.rut_norm` lo guarda **sin** puntos/guion (ej. `10385026k`) — ojo al normalizar. |
| **ClaveÚnica** | `core.persona.clave_unica` | **1.407 / 1.494** | Texto plano. Resolución robusta con fallbacks en `dashboard/lib/sii-credentials.ts`: override manual → `renegociacion_overrides.airtable_clave_unica` → `bronze_customers_main.data->>'Clave Unica'`. ⚠️ **Sensible: hoy en plaintext, sin encriptar** (pendiente de seguridad de nuestro lado). |

---

## B. Datos personales (formulario Paso 1)

| Su campo | Nuestra fuente | Cobertura | Estado / brecha |
|---|---|---|---|
| `nombre` completo | `core.persona.nombre_completo` · `bronze_customers_main.data->>'Full name'` | total | ✅ Directo. |
| `nacionalidad` | `core.persona.nacionalidad` · `bronze…->>'Nacionalidad'` | alta | ✅ Texto (`Chilena`/`Chileno`). |
| **`fecha_nacimiento`** | — | **0 / 1.494** | 🔴 **BRECHA DURA. No la tenemos en ningún lado** (ni `core` ni `bronze`). Es OBLIGATORIA. Hay que obtenerla (de la Carpeta Tributaria SII, o pedirla al cliente). |
| `estado_civil` (código `1`–`7`) | `core.persona.estado_civil` · `bronze…->>'Estado Civil'` | **1.404 / 1.494** | 🟡 Lo tenemos como **texto libre** (`"soltera"`, `"casada con participación gananciales"`). Su portal quiere **código 1–7** → necesita tabla de mapeo texto→código (la armamos nosotros o ustedes). |
| `regimen_patrimonial` (si casado) | embebido en el texto de `estado_civil` | — | 🟡 Derivable del mismo texto (`"sociedad conyugal"` / `"participación gananciales"` / `"separación de bienes"`), no es campo aparte. |
| `profesion_oficio` | `core.persona.profesion` | **946 / 1.494** | 🟡 Texto libre. Su portal quiere **etiqueta exacta** → mapear contra `portal_select_values.json`. |
| `ocupacion` | — | 0 | 🔴 No tenemos campo de ocupación separado. |
| `direccion` | `bronze_customers_main.data->>'Domicilio'` | **1.240 / 1.325** | 🟡 Existe en **bronze**, pero `core.cliente.domicilio` está en **0** (nunca se mapeó). Hay que leerlo de bronze o exponerlo en core. |
| `comuna` (MAYÚSCULAS) | `bronze_customers_main.data->>'Comuna'` | alta | 🟡 En bronze (ej. `"Padre Hurtado"`). Hay que pasar a MAYÚSCULAS + validar contra el catálogo del portal. |
| `region` | — | 0 | 🔴 **No la tenemos.** Bronze tiene Comuna/Ciudad pero no Región. Derivable de comuna vía tabla comuna→región. |
| `email` | `reports.casos_renegociacion.email` | **1.200 / 1.201** | ✅ |
| `telefono` (+ prefijo) | `reports.casos_renegociacion.telefono` | **1.050 / 1.201** | ✅ Guardado como `+56 9 …`; separar prefijo del número. |

---

## C. Documentos (PDFs)

| Su documento | Nuestra fuente | Cobertura | Notas |
|---|---|---|---|
| **Informe CMF** (1, <30d) | **PDF:** `cmf_informes` (`storage_path`, `fecha_emision`, `case_airtable_id`). **Interpretación:** `renegociacion_overrides.cmf_deudas_json`. | 1.641 informes / interpretación en **39 casos** | El PDF crudo está en Storage. La **interpretación estructurada** (deudas por institución, montos, totales) está en `cmf_deudas_json`. 🟡 La frescura <30d NO está garantizada hoy — hay informes viejos; el robot debe filtrar por `fecha_emision` o re-pedirlo cerca del envío. |
| **Carpeta Tributaria SII** (1) | `public.mac_mini_jobs` `command='sii-carpeta'`, `status='done'`. PDF en bucket **`expedientes-sii`** (path en `result`). | **134 done** | ✅ Lo generamos vía nuestra skill SII (Mac Mini). El RUT del cliente está en el job. |
| **Agentes Retenedores SII** (1) | `public.mac_mini_jobs` `command='sii-agente-retenedor'`, `status='done'`. Bucket `expedientes-sii`. | **121 done** | ✅ Idem. |
| **Certificados de acreedores** (1+ por acreedor) | `renegociacion_audit_pdf` `tipo_documento='documento_checklist'` (`storage_path`, `descripcion_detectada`, `direccion='del_cliente'`). **Calce:** `renegociacion_documento_match` (`acreedor`, `documento_descripcion`, `is_match`, `validation_status`). Bucket **`audit-attachments`**. | 47 PDFs checklist / 392 matches | 🟡 **Su regla #3 (vincular por RUT del emisor impreso en el PDF) hoy NO se cumple:** guardamos `descripcion_detectada` (texto, ej. *"certificado de deuda Banco de Chile"*) y el `acreedor` por nombre, **no el RUT del emisor**. Habría que extraer ese RUT, o vincular por nombre de acreedor. |

**Buckets de Storage:** `expedientes-sii` (PDFs SII) · `audit-attachments` (docs del cliente) · bucket CMF (`informes-cmf`). Todos privados → entregar vía signed URL o copia.

---

## 4. Precondiciones de elegibilidad (§4 de su doc)

| Condición | ¿La podemos pre-chequear? | Fuente |
|---|---|---|
| **≥2 deudas mora ≥91 días** | 🟡 Parcial | `cmf_deudas_json`. El extractor nuevo (`lib/skills/cmf-check-prompt.ts`) saca tramos 30-59/60-89/90+; pero filas viejas solo traen `estado='vigente'` sin tramos. Requiere re-extracción para ser confiable. |
| **Pasivo total ≥ 80 UF** | ✅ Derivable | `cmf_deudas_json.total_deuda_directa` + conversión UF (`lib/uf.ts`). |
| **Sin Primera Categoría activa** | 🔴 No estructurado | Vive dentro del PDF de la Carpeta Tributaria (`sii-carpeta`); hoy no se extrae a un campo. |

---

## 5. Resumen de brechas (lo que falta de nuestro lado para cumplir el contrato)

| # | Brecha | Severidad | Acción |
|---|---|---|---|
| 1 | **`fecha_nacimiento`** no existe (0 filas) — OBLIGATORIO | 🔴 Bloqueante | Extraer de Carpeta Tributaria o pedir al cliente. |
| 2 | **`region`** no existe; `ocupacion` no existe | 🔴 | Derivar región de comuna; definir fuente de ocupación. |
| 3 | `direccion`/`comuna`/`ciudad` solo en **bronze**, no en `core` | 🟡 | Leer de `bronze_customers_main.data` o mapear a core. |
| 4 | `estado_civil` y `profesion` en **texto libre**, no en código/etiqueta del portal | 🟡 | Tabla de mapeo contra `portal_select_values.json`. |
| 5 | Certificados de acreedores **no traen RUT del emisor** extraído (su regla #3) | 🟡 | Extraer RUT del PDF, o acordar vínculo por nombre de acreedor. |
| 6 | **Frescura <30d** del CMF/certificados no garantizada | 🟡 | Re-descargar cerca del envío; filtrar por `fecha_emision`. |
| 7 | Cobertura completa (CMF interpretado + checklist) hoy solo en **~39 casos** | 🟡 | Escala pendiente; la plomería existe. |

---

## 6. Lo que SÍ está listo hoy

✅ RUT (total) · ClaveÚnica (1.407) · nombre · nacionalidad · estado_civil (texto) · profesión (texto) · email (1.200) · teléfono (1.050) · dirección+comuna (bronze, 1.240) · PDF CMF + interpretación (39) · Carpeta Tributaria (134) · Agentes Retenedores (121) · certificados del cliente + calce (47/392).

Todo unible por el spine de §0.
