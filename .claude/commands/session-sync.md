---
description: Update project documentation with session progress and changes
allowed-tools: Read, Glob, Grep, Bash(git:*), Write
---

# Session Synchronization Command

1. **Analizar cambios de la sesión**:
   - `git status` — ver archivos modificados y no trackeados.
   - `git diff src/ .claude/ casos/` — entender los cambios de código.

2. **Actualizar archivos del proyecto** (en orden de importancia):

   a. **`task.md`** — SIEMPRE actualizar:
      - Mover a "Completadas" las tareas terminadas en esta sesión.
      - Agregar nuevas tareas pendientes descubiertas.
      - Actualizar estado de tareas "En Curso".

   b. **`CLAUDE.md`** — si hubo cambios de arquitectura:
      - Critical Rules (nuevos selectores, workarounds de portal, reglas de negocio).
      - Tablas de DB si cambiaron nombres o estructura.
      - Comandos de uso frecuente si se agregaron nuevos scripts.

   c. **`.claude/skills/renegociacion-automation/SKILL.md`** — si hubo trabajo de Playwright:
      - Nuevos portal blockers y sus fixes.
      - Nuevos patrones de selector o retry.

   d. **`casos/[cliente]/`** — si se trabajó en un caso específico:
      - `analisis_deudas.md`: actualizar estado de acreditación si cambió.
      - `instrucciones_sentinel.md` / `instrucciones_orchestrator.md`: actualizar si se ajustaron los prompts.
      - `test_mapping.md`: actualizar si cambiaron storage_paths o montos.

3. **Verificar higiene de la carpeta `src/utils/`**:
   - Buscar scripts con nombre de cliente (e.g. `*claudia*`, `*alejandra*`, `*pato*`).
   - Si existen, moverlos a `casos/[cliente]/` correspondiente.

4. **Actualizar memoria automática** (si aplica):
   - Si se descubrió un patrón nuevo relevante (alias de acreedor, bug de portal, regla de negocio), guardar en `/Users/patomartini/.claude/projects/-Users-patomartini-Desktop-renegociacion/memory/`.

5. **Output final**:
   - Lista de archivos modificados.
   - Resumen de progreso de la sesión (1 párrafo).
   - Preguntar si se quiere hacer commit de los cambios.
