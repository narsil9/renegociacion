---
description: Carga el contexto de producción y muestra el estado del camino a producción
---

# Prime Session Command — Camino a Producción

El objetivo del proyecto AHORA es **llevar la automatización a producción**. El flujo vigente es:

```
Dashboard rp_carga_documentos (abogado: crea cliente en "Datos Personales" + sube la
carpeta en "Cargar Caso")  →  Supabase SANDBOX (clients + client_documents + Storage)
+ encola automation_jobs  →  Worker (npm run worker): cadena de agentes
(tributario → centinela → mapeador)  →  Playwright Pasos 1→4 en el portal Superir.
```
Regla vigente: **sandbox (`fnz…`) se opera COMO producción**; NO se tocan ni importan datos del proyecto del abogado (`ton…`).

## 1. Leé estos archivos (los que REALMENTE usamos hoy)

- [CLAUDE.md](file://./CLAUDE.md) — arquitectura, reglas críticas, tablas de la DB.
- [task.md](file://./task.md) — estado y tareas priorizadas hacia producción.
- [.claude/skills/renegociacion-automation/SKILL.md](file://./.claude/skills/renegociacion-automation/SKILL.md) — reglas de Playwright / Paso 3.
- [supabase/migration_sandbox_v4.sql](file://./supabase/migration_sandbox_v4.sql) — esquema vigente del sandbox (aplicado) + doc de columnas de `clients`.
- [supabase/portal_select_values.json](file://./supabase/portal_select_values.json) — enums reales del portal (Paso 1) que usa el dashboard.

Tené presente la memoria del proyecto que aparezca en los `<system-reminder>` (sobre todo `sandbox-como-produccion` y `supabase-db-state`).

## 2. Repo del dashboard (separado, NO está en este working dir)

`/Users/patomartini/Desktop/rp_carga_documentos` (Next.js). Vistas: **Datos Personales** (`app/datos-personales/`) y **Cargar Caso** (`app/subir-caso/`). Apunta al sandbox `fnz…`. Si vas a trabajar ahí, abrilo aparte.

## 3. Output estructurado

**ARQUITECTURA** (3-4 líneas): stack, flujo dashboard → worker → portal, dónde vive la lógica crítica.

**ESTADO PRODUCCIÓN**: qué está listo y qué falta para el primer envío real (`DRY_RUN=false`). Marcá con **[BLOQUEANTE]** lo que impide avanzar.

**TAREAS PENDIENTES** (de task.md): agrupadas por prioridad (P0/P1/...).

**CASOS** (breve): cuántos cerrados E2E y cuáles bloqueados — sin desglosar cada acreedor salvo que se pida.

## 4. Preguntá

¿Con qué arrancamos hacia producción?
