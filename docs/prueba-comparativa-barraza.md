# Prueba comparativa — sistema actual vs. lectura por documento

**Estado: PARCIAL.** La mecánica está verificada de punta a punta contra producción. La
**medición del ahorro está bloqueada** por cuota de API hasta el 2026-08-01.

El protocolo vive en `docs/superpowers/plans/2026-07-27-lectura-por-documento.md`, Task 7.
El script que lo ejecuta es `renegociacion-cockpit/tools/prueba_abc.js`.

---

## Lo que se corrió (2026-07-28)

Smoke test con el caso chico, `20285122-3` (2 documentos), antes de gastar en Barraza.
Las tres corridas A/B/C se ejecutaron completas.

### Resultado: las tres corridas fallaron al leer, por cuota de API

```
400 {"type":"error","error":{"type":"invalid_request_error",
 "message":"You have reached your specified API usage limits.
            You will regain access on 2026-08-01 at 00:00 UTC."}}
```

No es un defecto del código: pasó igual en `main/` y en el worktree.

### Y por eso mismo probó el fix más importante

Que la API falle era la condición exacta que el hallazgo **Critical 1** de la review
describía. Lo que pasó:

| | Esperado si el fix funciona | Medido |
|---|---|---|
| Las 2 lecturas fallan | `read_failed = true` | ✅ `NO se pudo leer tras 2 intentos → se marca read_failed` |
| Nada se persiste | `document_reads` vacía | ✅ 0 filas |
| La corrida C **no** sirve basura del caché | C vuelve a leer del modelo | ✅ `0 reutilizada(s), 2 leída(s)` |
| El error es técnico, no semántico | se lanza para que el worker reintente | ✅ `error técnico (API/red): se reintenta el job` |

**Sin ese fix, esas dos lecturas fallidas se habrían guardado como `completed` con
`productos: []`, y toda corrida futura de ese caso habría declarado cero acreedores —
permanentemente, y para cualquier cliente que compartiera esos PDFs.** El único remedio
habría sido un DELETE a mano en una tabla append-only.

### El fix I4 también quedó probado contra producción

`client_documents.sha256` se escribió para los 2 documentos, y **se verificó bajando los
bytes del bucket y re-hasheándolos**:

```
✅ 2026-06-09__informe_deudas_20285122-3__1_.pdf
    6aaa90d7b86d5e2f7c9d708c309899d5e987697345a4e1df48677945391b2495   (64 chars)
✅ IMG-20230303-WA0020.jpeg
    3d8e1cb72c7e7ba6ffd0cf519a522d3b74fc4e935f74037f44f755b83004b4be   (64 chars)
→ 2 coinciden con los bytes del bucket, 0 no
```

O sea el join `document_reads.doc_sha256 → client_documents.sha256` funciona: la pregunta
"qué leímos del caso de X" ya se puede contestar en SQL. Antes la columna no la escribía nadie.

### El resto del pipeline corrió sin error

Lectura de Supabase, descarga del bucket, cálculo del hash, filtro de documentos de ingreso,
dedup por contenido, lookup del caché, manejo de error y el `throw` de error técnico: todo
ejecutó en los dos worktrees.

---

## Verificación de la base (Task 8)

**Bloque A — 17/17 ✅.** Ojo: los controles 8-17 pasan trivialmente mientras las tablas estén
vacías. Los verificados de verdad son los estructurales:

- `document_reads` creada con 15 columnas y los tipos correctos (`facts_json` es `jsonb`,
  `automation_job_id` es `uuid`, `id` es `bigint identity`).
- El índice único parcial `document_reads_vigente` con las 6 columnas de la llave **en orden**
  y `WHERE (status = 'completed')` — el invariante lo garantiza la base, no el código.
- `CHECK` de `status` limitado a `completed`/`failed`.
- **RLS activa con CERO policies** y sin grants a `anon`/`authenticated`.
- Los `comment on` en castellano presentes (433 y 230 caracteres).

**Bloque C — 4/4 consultas de depurabilidad ejecutan sin error** contra el esquema real
(devuelven 0 filas porque no hay lecturas todavía, pero el SQL está validado).

**Un hallazgo del Bloque B, ajeno a este plan:** `herramientas_uso`,
`renegociacion_audit_pdf` y `renegociacion_overrides` tienen **14 grants cada una** a
`anon`/`authenticated`. Hoy son inertes porque esas tablas tienen RLS sin policies, pero
quedan a un `CREATE POLICY` de abrirse. `document_reads` nace bien (0 grants) porque su
migración hace el `revoke` explícito. Es el bug #4 de la revisión del 27-jul, sigue vivo.

---

## Lo que falta, y qué lo desbloquea

| Pendiente | Bloqueado por |
|---|---|
| A vs B idénticas sobre datos reales (la prueba de no-regresión) | cuota de API |
| C con 0 lecturas del modelo sobre un caso con volumen | cuota de API |
| El ahorro medido en tokens (`herramientas_uso` con `source='worker'`) | cuota de API |
| Cuántos duplicados del proyector colapsa Barraza (22 documentos) | cuota de API |

La cuota se recupera el **2026-08-01 00:00 UTC**, o antes si se sube el límite de gasto en
la consola de Anthropic. Con eso, todo es un comando:

```bash
cd /Users/patomartini/dev/renegociacion/renegociacion-cockpit
node tools/prueba_abc.js            # Barraza, 22 documentos
```

El script deja `respaldos/corrida_{A,B,C}.txt` y `respaldos/prueba_abc_reporte.txt`.

⚠️ **Antes de correrlo contra Barraza**, tener presente que borra sus `agent_runs` — ya
respaldados en `respaldos/barraza-agent_runs-2026-07-28.json` (7 filas, incluidas las dos
corridas del centinela del 23-jul sobre las que el abogado hizo el análisis de los 7 errores).

## Nota sobre el smoke test

Borró las 2 `agent_runs` del cliente `20285122-3`. Están completas en
`respaldos/agent_runs-COMPLETO-2026-07-28.json` y se pueden reinsertar cuando se quiera.
