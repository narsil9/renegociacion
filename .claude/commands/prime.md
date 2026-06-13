---
description: Load key files and print the task list status
---

# Prime Session Command

1. Read these files to align your context:
   - [CLAUDE.md](file://./CLAUDE.md)
   - [.claude/skills/renegociacion-automation/SKILL.md](file://./.claude/skills/renegociacion-automation/SKILL.md)
   - [task.md](file://./task.md)
   - [casos/claudia_silva/analisis_deudas.md](file://./casos/claudia_silva/analisis_deudas.md)
   - [casos/alejandra_espinoza/analisis_deudas.md](file://./casos/alejandra_espinoza/analisis_deudas.md)

2. Output a structured summary with these sections:

   **ARQUITECTURA** (3 líneas máx):
   - Stack, comando de ejecución, dónde vive la lógica crítica.

   **CASOS ACTIVOS**:
   Para cada cliente en `casos/`:
   - Nombre, RUT, BD client_id (si está disponible en analisis_deudas.md)
   - Acreedores Art. 260 y 261 + estado de acreditación
   - Scripts disponibles: cuáles existen en su carpeta (setup_test, upload_documents, test_step3, etc.)

   **TAREAS PENDIENTES** (de task.md):
   - Listar las tareas "En Curso" y "Pendientes" agrupadas por prioridad.
   - Marcar con [BLOQUEANTE] las que impiden correr el robot.

3. Preguntar: ¿Con qué caso o tarea arrancamos?
