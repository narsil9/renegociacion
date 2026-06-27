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

### Etapa 2 — Proyector de caso 🎯 **PRÓXIMA TAREA**
- [ ] **Escribir el proyector `ton… → sandbox` (READ-ONLY)** — Dado un RUT: lee el caso de prod
  (`v_casos_renegociacion` + `core.persona` + `bronze_customers_main` + `cmf_informes` +
  `renegociacion_audit_pdf`), lo **upserta en el sandbox** (`clients` + `client_documents`) y
  **descarga los PDFs** (CMF + certs). Mapea `estado_civil`/`profesion` a los enums del portal.
  Reusa el mapa `docs/integracion/mapa-fuentes-produccion.md`. Base de código: `tools/spike_case_assembly.ts`.
  Join de bronze por `persona.airtable_main_id` (no por filtro de clave JSON). **Nunca escribir en `ton…`.**
- [ ] **Probar con 1 caso COMPLETO** (CMF + certs + ClaveÚnica — como el que halló el spike).
  **Convenciones de prueba (seguras, NO producción real):**
    - **Campos faltantes** (`fecha_nacimiento`, a veces `profesion`) → **placeholder inventado** por ahora.
    - **Login al portal con las credenciales de PATO** (RUT `21917363-6` + su ClaveÚnica del `.env`),
      **NUNCA la del cliente** → el borrador cae en la renegociación de prueba de Pato y no toca nada real.
    - **`DRY_RUN=true`** (no radicar). Disparado **a mano por nosotros**, sin dashboard, sin nada automático.
- [ ] **Purga del caso del sandbox al terminar** (no acumular PII).

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
