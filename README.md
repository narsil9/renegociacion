# Automatización — Renegociación Superir

Robot que **llena la solicitud de renegociación de deudas** en el portal de la Superintendencia
de Insolvencia y Reemprendimiento (Superir, Chile) por un cliente. Lee sus documentos
(Informe CMF, Carpeta Tributaria, certificados de deuda, liquidaciones de sueldo), decide qué
declarar y completa los **Pasos 1→5** del portal con Playwright.

Está pensado para conectarse a **tu propio dashboard**: tu UI carga los datos y documentos del
cliente en una base **Supabase** y encola un trabajo; este worker lo toma y ejecuta la
automatización. Este repo **no** trae dashboard — expone un contrato de base de datos para que
conectes el tuyo.

> **Principio rector.** El LLM (Claude) **lee cada documento por separado** y extrae los *hechos*
> (montos, fechas, RUT, morosidad). El **TypeScript determinista** decide la *estructura* de la
> declaración (qué acreedor va en Art. 260 vs 261, cómo se mapea cada certificado, cómo se
> promedian los ingresos). El LLM nunca decide la estructura: así el resultado es reproducible y
> auditable, no depende de la variabilidad del modelo.

---

## Cómo encaja con tu dashboard

```
   TU DASHBOARD (tu UI)                 SUPABASE                  ESTE WORKER (tu Mac/servidor)
 ┌──────────────────────┐        ┌───────────────────┐        ┌───────────────────────────────┐
 │ 1. sube docs + datos │──────▶ │ Storage: documentos│ ◀──────│ pollea automation_jobs cada 5s │
 │    del cliente       │        │ clients            │        │ por cada job:                  │
 │ 2. inserta un job    │──────▶ │ client_documents   │        │  · agentes (Claude lee c/doc)  │
 │    (botón "Ejecutar")│        │ automation_jobs ───┼───────▶│  · Playwright → portal Superir │
 │ 3. lee estado/alertas│ ◀──────│ automation_alerts  │ ◀──────│  · escribe status + capturas   │
 └──────────────────────┘        └───────────────────┘        └───────────────────────────────┘
```

- **Tu dashboard escribe** en Supabase (tabla `clients`, `client_documents`, Storage `documentos`)
  y **encola** insertando una fila en `automation_jobs`.
- **El worker** (este repo) es **un solo proceso daemon**. Pollea la cola y, por cada job, corre
  toda la cadena y el portal. **No hay procesos separados de "centinela" o "mapeador"** — son
  etapas internas del worker (ver abajo).
- **Devuelve** estado (`automation_jobs.status`, `progress_message`), capturas
  (`screenshot_url`) y alertas al abogado (`automation_alerts`), que tu dashboard muestra.

👉 **Contrato exacto (qué tabla/columna escribir, cómo encolar, cómo leer el resultado):**
[`docs/integracion/dashboard-externo.md`](docs/integracion/dashboard-externo.md).

---

## Qué hace el worker por cada job (una sola cadena)

```
Job (client_id, step, dry_run)
  │
  ├─ Agente Tributario  → lee la Carpeta Tributaria (categoría, F29). Bloquea si Primera Categoría activa.
  ├─ Analizador CMF     → extrae las deudas del Informe CMF (determinista).
  ├─ Centinela          → Claude lee CADA certificado y aporta hechos; TS clasifica 260/261,
  │                       detecta acreedores NO-CMF (TGR, cajas, fintechs) y aplica backstops.
  ├─ Mapeador           → asocia cada certificado a su acreedor (determinista).
  ├─ Agente Ingresos    → Claude lee CADA liquidación/documento de ingreso; TS calcula el monto.
  │
  └─ Playwright         → login ClaveÚnica → Pasos 1→5 en el portal → borrador cargado.
```

Con `dry_run=true` el worker **llena el borrador pero nunca envía** (no radica la solicitud) — es
el modo de prueba. Con `dry_run=false` deja el borrador vivo listo para que el abogado lo revise
y envíe manualmente.

---

## Puesta en marcha (resumen)

1. **Base de datos:** creá un proyecto Supabase y corré [`supabase/setup.sql`](supabase/setup.sql)
   en su SQL Editor (crea todas las tablas + buckets, idempotente).
2. **Worker:** cloná el repo, `npm install`, creá el `.env`, y arrancá el daemon.
   Guía completa paso a paso: **[INSTALL.md](INSTALL.md)**.
3. **Dashboard:** conectá tu UI a la misma base siguiendo el contrato
   [`docs/integracion/dashboard-externo.md`](docs/integracion/dashboard-externo.md).

```bash
git clone <URL_DEL_REPO> renegociacion && cd renegociacion
npm install
npx playwright install chromium
cp .env.example .env    # y completá SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
bash scripts/sistema.sh start     # arranca el worker (pm2 si está, si no nohup)
```

---

## Superficie de producción

El **único entrypoint** de producción es **[`src/worker.ts`](src/worker.ts)** (el daemon). Todo
lo que corre en producción es su grafo de imports:

| Área | Ubicación |
|---|---|
| Daemon / cola | `src/worker.ts` |
| Pasos del portal (Playwright) | `src/automation/` (`login.ts`, `step1..step5`, `all_steps.ts`) |
| Cadena de agentes (Claude) | `src/agents/` (`tributario`, `centinela`, `mapeador`, `ingresos`) |
| Lógica determinista | `src/utils/` (CMF, backstops, matcher, income, PDF, etc.) |

```bash
npm run worker        # corre el daemon (ts-node) — igual que scripts/sistema.sh start
npm run build         # compila todo a dist/
npm run build:prod    # compila SOLO el grafo del worker → dist/ (deploy)
npm test              # baterías deterministas (Paso 5 ingresos)
```

`tools/` y `casos/` son **herramientas de desarrollo/validación** (no producción). La batería
determinista del Paso 3 vive en `tools/paso3_validacion/` (`npx ts-node tools/paso3_validacion/run_all.ts`).

---

## Estructura del repo

```
src/                     CÓDIGO DE PRODUCCIÓN (el grafo del worker)
  worker.ts              daemon: pollea automation_jobs y despacha cada job
  automation/            Playwright: login + Pasos 1→5 del portal
  agents/                cadena de agentes Claude (lectura nativa por documento)
  utils/                 lógica determinista (CMF, sentinel/backstops, matcher, income, PDF…)
supabase/
  setup.sql              ⭐ esquema completo (corré esto una vez)
  portal_select_values.json   enums del portal (region/comuna/estado_civil/profesión…)
  migration_*.sql        historial de migraciones (referencia; setup.sql ya las incluye)
scripts/sistema.sh       encender / apagar / estado / logs del worker
docs/integracion/        cómo conectar tu dashboard + mapa de fuentes de datos
lecciones/               conocimiento del dominio (se inyecta en los prompts de los agentes)
tools/, casos/           herramientas de dev y validación (NO producción)
INSTALL.md               instalación completa en una máquina
CLAUDE.md                arquitectura detallada y reglas de negocio (referencia profunda)
```

---

## Variables de entorno (`.env`)

Mínimo de producción:

```
SUPABASE_URL=https://<tu-proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
ANTHROPIC_API_KEY=sk-ant-...        # Claude lee los documentos (Centinela + Ingresos)
HEADLESS=true                        # true en servidor; false para ver el navegador
```

Opcionales: `WORKER_CONCURRENCY` (jobs en paralelo, default 1), `CENTINELA_PER_DOC` (lectura por
documento; **activada por defecto**, `=false` para desactivar), `PROD_SUPABASE_URL` /
`PROD_SUPABASE_SERVICE_ROLE_KEY` (solo si leés credenciales desde un sistema externo).

⚠️ **Nunca en producción** (desactivan validaciones críticas; son solo para pruebas):
`DRY_RUN`, `BYPASS_DATE_CHECK`, `BYPASS_DATE_VALIDATION`, `BYPASS_RUT_CHECK`,
`DISABLE_SENTINEL`, `FORCE_VISION_MAPEADOR`. En producción, `dry_run` se controla **por job**
(columna de `automation_jobs`), no por variable de entorno.

Detalle de todas las variables (incluidos los datos del cliente de prueba) en
[`.env.example`](.env.example).

---

## Requisitos legales del portal (los aplica el worker)

Para que un caso califique, el worker exige: **≥2 productos con mora ≥91 días**, **sin Primera
Categoría con actividad F29** (últimos 24 meses), e **Informe CMF vigente (<30 días)**. Si no
califica, el job queda `blocked` con una alerta explicativa (no `failed`). Detalle y matices en
[CLAUDE.md](CLAUDE.md) y `docs/integracion/dashboard-externo.md`.
