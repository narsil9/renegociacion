# Contrato de conexión — botón "Ejecutar" (su dashboard) → nuestro worker

> **Qué es.** El contrato técnico de la **Etapa 3** de la convergencia: cómo el botón **"Ejecutar"**
> del dashboard del supervisor (`rp_renegociaciones-auth-admin`, prod `ton…`) dispara nuestra
> automatización del portal Superir. Define el **trigger**, el **gate "cliente listo"** (precondiciones
> que su gate debe codificar para que el botón no rebote) y las **brechas de datos** con su resolución.
> Es el artefacto para acordar con el supervisor.
>
> **Estado:** propuesta nuestra (aguas abajo). Las decisiones marcadas 🤝 requieren acuerdo con él.

---

## 1. Arquitectura (recap): proyección por-caso on-demand

```
[Ejecutar] (su dashboard, por caso)
   → inserta un JOB con la llave del caso (rut / airtable_id)
        ▼
[NUESTRO WORKER — daemon Mac Mini]
   1. PROYECTA el caso: read-only de ton… → materializa SOLO ese caso al sandbox
      (clients + client_documents + descarga de PDFs)        ← tools/project_case.ts (a productizar)
   2. Corre la cadena (tributario→centinela→mapeador) + Playwright Pasos 1→4 en el portal
   3. Purga el caso del sandbox al terminar
```

**Principio:** prod `ton…` intacto (solo lectura); el worker no cambia su forma de correr (lee del
sandbox). Validado E2E con un caso real (proyector + worker + portal, Paso 3 declarando 11 acreedores).

---

## 2. El trigger "Ejecutar" — qué hace exactamente

Son **dos acciones**; la decisión es **quién corre la proyección**:

- **Recomendado (🤝):** "Ejecutar" **solo inserta el job** con `rut`/`airtable_id`; **nuestro worker
  proyecta on-demand** al tomar el job (centraliza la lógica de proyección en nuestro lado; él solo
  aprieta el botón, igual que hoy encola las skills SII a `mac_mini_jobs`).
- Alternativa: el dashboard proyecta antes de encolar (más acoplamiento de su lado).

**Mecanismo de encolado (🤝 — elegir uno):**
- **(a) Insert directo en nuestra `automation_jobs`** (sandbox `fnz…`): él inserta `{ rut/airtable_id, step:0, dry_run, source:'dashboard' }`. Es lo más simple — espejo de su patrón `mac_mini_jobs`.
- (b) Endpoint/tabla puente nueva. Más control, más trabajo.

**Contrato mínimo del job (propuesto):**
| Campo | Valor |
|---|---|
| `airtable_id` (o `rut`) | llave del caso en `ton…` (join spine `reports.casos_renegociacion`) |
| `step` | `0` (Pasos 1→4) |
| `dry_run` | `false` = borrador vivo (no radica); `true` = prueba con auto-limpieza |
| `source` | `'dashboard'` (trazabilidad) |

⚠️ **Hoy** `automation_jobs.client_id` apunta a `clients` (sandbox). Con el trigger por `airtable_id`/`rut`,
el worker primero proyecta (crea/actualiza la fila `clients`) y luego resuelve `client_id`. Ajuste menor de plomería.

---

## 3. Gate "cliente listo" — precondiciones del PORTAL (su gate debe codificarlas)

Si su gate marca "listo" sin cumplir estas, **el botón rebota en nuestro worker** (es el juez final).
Tomadas de la lógica real del worker:

### 🔴 Bloqueantes (el worker NO declara / bloquea)
1. **≥2 productos con mora ≥91 días** — `totalQualifyingCount = CMF 90+d + reclasificados Centinela + NO-CMF Art.260`. Si <2 → no califica (requisito de fondo).
2. **Sin Primera Categoría con actividad F29** en los últimos 24 meses (de la Carpeta Tributaria). Si hay actividad → bloquea. *(Boletas de honorarios NO bloquean.)*
3. **CMF presente y fresco (<30 días)** — `expired_cmf` bloquea (bypassable solo en pruebas con `BYPASS_DATE_CHECK`).
4. **Certificados sin RUT mal atribuido** (`rut_mismatch`): un cert cuyo RUT de emisor ≠ el acreedor asignado bloquea ese caso.
5. **Datos del Paso 1 completos** (ver §4) — sobre todo **`fecha_nacimiento`** (obligatoria en el portal).

### 🟡 No bloqueantes (se declara igual + alerta)
6. **≥80 UF** de pasivo — solo advertencia (el abogado confirma).
7. **Certificado por acreedor**: desde 2026-06-28 el Paso 3 **declara lo acreditable y alerta los acreedores sin documento** (no omite todo). Pero para una solicitud COMPLETA conviene tener el cert de cada deuda 90+d (las 260 necesitan monto+vencimiento; las 261, monto).

> **Resumen para su gate:** "listo" = (≥2 deudas 90+d) **y** (sin Primera Categoría F29) **y**
> (CMF <30d) **y** (datos Paso 1 completos, incl. fecha de nacimiento). Lo demás es deseable, no bloqueante.

---

## 4. Brechas de datos del Paso 1 y su resolución

| Dato | Fuente | Estado / resolución |
|---|---|---|
| nombre, nacionalidad | `core.persona` | ✅ |
| estado_civil, profesión | `core.persona` (texto libre) | ✅ dato; mapear a enums del portal (`portal_select_values.json`) — ya lo hacemos |
| domicilio, comuna, ciudad | `bronze_customers_main.data` (join por `persona.airtable_main_id`) | ✅ ~85% |
| **region** | — | 🟡 derivar de comuna (tabla comuna→región; hoy solo RM cargada) |
| **ocupacion** | — | 🟡 sin fuente → placeholder o pedir al cliente |
| **fecha_nacimiento** | **CÉDULA DE IDENTIDAD** del cliente (la sube y su agente la clasifica "Identificación") | 🔴→🟢 **Resolución hallada:** NO es dato inexistente — se **extrae de la cédula** vía OCR/visión. (`core.persona.fecha_nacimiento` está vacío, pero la cédula la trae.) Calidad variable → la mejora #1 (lectura nativa/visión) la lee mejor. |

> **Hallazgo clave (2026-06-28):** el bloqueante histórico "no tenemos la fecha de nacimiento en
> ningún campo" se resuelve leyéndola de la **cédula** (documento que el cliente ya aporta). Pasa de
> "brecha dura" a "campo a extraer". Pendiente: implementar el extractor (encaja con la mejora #1).

---

## 5. El puente doc ↔ clasificación del supervisor (🤝 pendiente)

Su `renegociacion_documento_match` clasifica cada documento → acreedor con **nombres alineados al CMF**
(ej. "Tenpo Payments S.A.") — sería ideal consumirlo. **Pero** está keyeado por `drive_file_id`
(Google Drive) y `documentos_drive` viene vacío → **no hay puente confiable doc-a-doc** hacia los
archivos que bajamos de `renegociacion_audit_pdf` (Storage). Hoy lo usamos como **referencia** para
mejorar el catálogo/aliases, no como input runtime.

**Para consumirlo per-documento** hace falta una **llave compartida** entre los dos espacios de
documento: un **hash de contenido** (sha256 — `renegociacion_audit_pdf.content_hash` ya existe) o un
id de documento común. Acordar con el supervisor exponer esa llave.

---

## 6. Decisiones a acordar con el supervisor (🤝)

1. **Mecanismo del trigger**: insert directo en `automation_jobs` (recomendado) vs tabla/endpoint puente.
2. **Quién proyecta**: nuestro worker on-demand (recomendado) vs su dashboard antes de encolar.
3. **Llave del job**: `airtable_id` o `rut` (la spine carga ambos; usar `rut` normalizado como ancla).
4. **Llave compartida de documentos** (§5) para consumir su clasificación per-doc (futuro).
5. **Gobernanza de lectura de `ton…`**: confirmar acceso read-only estable para el proyector
   (`PROD_SUPABASE_*`), y que su gate "listo" codifique §3.

---

## 7. Qué está LISTO de nuestro lado (no requiere a él)

- ✅ Proyector `ton…`→sandbox (`tools/project_case.ts`) — falta productizarlo (sacar de `tools/` al worker).
- ✅ Worker corre Pasos 1→4 + declara lo acreditable en Paso 3 (validado E2E).
- ✅ Mapa de fuentes verificado (`mapa-fuentes-produccion.md`) + crosswalk de acreedores.
- ✅ Mapeo a enums del portal (`portal_select_values.json`).
- 🔜 Extractor de `fecha_nacimiento` desde la cédula (encaja con la mejora #1, en curso en el worktree).
