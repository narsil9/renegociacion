---
description: Carga el contexto de producción y muestra el estado del camino a producción (Paso 3 + Paso 5)
---

# Prime Session Command — Camino a Producción

El objetivo del proyecto AHORA es **llevar la automatización a producción**. El flujo vigente es:

```
Dashboard rp_carga_documentos (abogado: crea cliente en "Datos Personales" + sube la
carpeta en "Cargar Caso")  →  Supabase SANDBOX (clients + client_documents + Storage)
+ encola automation_jobs  →  Worker (npm run worker): cadena de agentes
(tributario → centinela → mapeador → ingresos)  →  Playwright Pasos 1→5 en el portal Superir.
```
Regla vigente: **sandbox (`fnz…`) se opera COMO producción**; NO se tocan ni importan datos del proyecto del abogado (`ton…`).

> **Frente activo HOY:** mejorar la **calidad de lectura/extracción** de los agentes (el LLM lee PDF
> NATIVO — Tesseract eliminado; TS blinda la estructura) en **Paso 3 (acreedores)** y **Paso 5 (ingresos)**.
> Se trabaja en 2 branches/worktrees: **`paso-3`** (`../renegociacion-paso3`) y **`paso-5`** (`../renegociacion-paso5`),
> ambas partiendo iguales con todo el trabajo. El dir principal queda en `main` (hub).

## 1. Leé estos archivos (los que REALMENTE usamos hoy)

**Transversal (siempre):**
- [CLAUDE.md](file://./CLAUDE.md) — arquitectura, reglas críticas, tablas de la DB, pipeline 1→5.
- [task.md](file://./task.md) — estado y tareas priorizadas hacia producción.
- [lecciones/README.md](file://./lecciones/README.md) + [lecciones/principios-generales.md](file://./lecciones/principios-generales.md) — base viva de conocimiento (cert manda, nunca $0 en silencio, el LLM extrae / TS blinda). Se inyecta en el prompt de los agentes.

**Paso 3 — Acreedores (Centinela):**
- [src/utils/sentinel.ts](file://./src/utils/sentinel.ts) — Centinela: clasificación 260/261, backstops deterministas, lectura nativa de PDF + validación anti-error (`evidence`/`claudeReadIssues`).
- [lecciones/paso3-acreedores.md](file://./lecciones/paso3-acreedores.md) — lecciones validadas del Paso 3 (errores de lectura de Claude aprendidos).
- [.claude/skills/renegociacion-automation/SKILL.md](file://./.claude/skills/renegociacion-automation/SKILL.md) — reglas de Playwright / Paso 3.

**Paso 5 — Ingresos:**
- [src/agents/ingresos_agent.ts](file://./src/agents/ingresos_agent.ts) — agente de ingresos (Claude lee docs NATIVO).
- [src/utils/income_extractor.ts](file://./src/utils/income_extractor.ts) — TS blinda la estructura (líquido a pagar, descuentos voluntarios, promedio por tipo, crosswalk enums).
- [src/automation/step5_ingresos.ts](file://./src/automation/step5_ingresos.ts) — Playwright del Paso 5.
- [lecciones/paso5-ingresos.md](file://./lecciones/paso5-ingresos.md) — lecciones validadas del Paso 5.

**Integración + DB (cuando aplique):**
- [docs/integracion/mejoras-desde-flujo-supervisor.md](file://./docs/integracion/mejoras-desde-flujo-supervisor.md) — mejoras pendientes a importar del dashboard del supervisor.
- [docs/integracion/mapa-fuentes-produccion.md](file://./docs/integracion/mapa-fuentes-produccion.md) — mapa verificado de fuentes de prod (`ton…`).
- Migraciones del sandbox (`supabase/migration_sandbox_v*.sql`, la más reciente: v8 ingresos) + [supabase/portal_select_values.json](file://./supabase/portal_select_values.json) — enums del portal.

Tené presente la memoria del proyecto que aparezca en los `<system-reminder>` (sobre todo `sandbox-como-produccion`, `lectura-nativa-y-validacion-anti-error`, `paso5-ingresos`).

## 2. Repo del dashboard (separado, NO está en este working dir)

`/Users/patomartini/Desktop/rp_carga_documentos` (Next.js). Vistas: **Datos Personales** (`app/datos-personales/`) y **Cargar Caso** (`app/subir-caso/`). Apunta al sandbox `fnz…`. Si vas a trabajar ahí, abrilo aparte.

## 3. Output estructurado

**ARQUITECTURA** (3-4 líneas): stack, flujo dashboard → worker → portal (1→5), dónde vive la lógica crítica.

**ESTADO PRODUCCIÓN**: qué está listo y qué falta para el primer envío real (`DRY_RUN=false`). Marcá con **[BLOQUEANTE]** lo que impide avanzar.

**PASO 3 / PASO 5** (breve): estado de cada frente (validación anti-error del Centinela; agente de ingresos) y qué falta.

**TAREAS PENDIENTES** (de task.md): agrupadas por prioridad.

## 4. Preguntá

¿Con qué arrancamos? (Paso 3, Paso 5, o el camino a producción.)
