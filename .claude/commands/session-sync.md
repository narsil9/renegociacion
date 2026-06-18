---
description: Sincroniza la documentación del proyecto con el progreso de la sesión (orientado a producción)
allowed-tools: Read, Glob, Grep, Bash(git:*), Write
---

# Session Synchronization Command

El norte del proyecto es **producción**. Al sincronizar, mantené los docs apuntando al flujo vigente
(dashboard `rp_carga_documentos` → Supabase sandbox → worker → Pasos 1→4) y a lo que falta para el
primer envío real (`DRY_RUN=false`). Bajá ruido: borrá o marcá lo obsoleto, no acumules planes ya cumplidos.

1. **Analizar cambios de la sesión**:
   - `git status` y `git diff src/ .claude/ supabase/ casos/` en este repo.
   - Si se trabajó en el dashboard, recordá que vive en **otro repo** (`/Users/patomartini/Desktop/rp_carga_documentos`): tiene su propio git. Resumí qué archivos se tocaron ahí (no corras git de este repo sobre él).

2. **Actualizar archivos del proyecto** (en orden de importancia):

   a. **`task.md`** — SIEMPRE:
      - Mover a "Completadas" lo terminado; actualizar "En Curso"; agregar pendientes nuevas.
      - Mantener la sección de PRIORIDAD enfocada en el camino a producción (qué falta para `DRY_RUN=false`).

   b. **`CLAUDE.md`** — si cambió la arquitectura:
      - Flujo dashboard ↔ Supabase ↔ worker, reglas críticas, blockers de portal, tablas/columnas de la DB.
      - Comandos frecuentes si se agregaron scripts.
      - Sacar referencias a cosas que ya NO se usan (no dejar instrucciones muertas).

   c. **`.claude/skills/renegociacion-automation/SKILL.md`** — si hubo trabajo de Playwright:
      - Nuevos portal blockers + fix, patrones de selector/retry.

   d. **`supabase/`** — si cambió el esquema o los enums:
      - `migration_sandbox_v4.sql` (esquema vigente), `portal_select_values.json` (enums del portal).

   e. **`casos/[cliente]/`** — si se trabajó un caso: actualizar `analisis_deudas.md` / estado.

3. **Higiene del repo**:
   - `src/utils/`: los scripts diagnóstico (`check_*`, `inspect_*`, `migrate_*`, `scan_*`, `test_*`) están gitignored — no se commitean.
   - Si aparecieron docs/planes ya cumplidos o enfoques descartados, proponé borrarlos.

4. **Actualizar memoria automática** (si aplica):
   - Patrones nuevos, decisiones de arquitectura, restricciones (ej. sandbox-como-producción) →
     `/Users/patomartini/.claude/projects/-Users-patomartini-Desktop-renegociacion/memory/` (+ índice en `MEMORY.md`).

5. **Output final**:
   - Lista de archivos modificados (este repo y, por separado, el dashboard).
   - Resumen del progreso de la sesión (1 párrafo).
   - Preguntar si se quiere hacer commit (y en qué repo).
