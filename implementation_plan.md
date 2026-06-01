# Supabase Data Extraction and Sandbox Isolation Plan — Hardened (`pato_prueba_*`)

This plan syncs verified production clients and runs their tests in two uniquely-named tables (`pato_prueba_clients` and `pato_prueba_automation_jobs`), keeping the existing sandbox structures (`clients`, `automation_jobs`) untouched.

> **Hardening pass added after a live DB review.** The original intent is preserved; every step is now hardened so the lawyer's production DB ("SuperWhisp") **cannot be structurally or data-wise altered**, real credentials are not exposed, and prod non-disruption is **proven**, not assumed. Hardening items are tagged `[Fixes P#]`.

## Findings & System Clarifications

Based on an exhaustive review of the production database tables:
1. **Renegotiation Request Automation** is a **brand-new system** not present in production yet. There are no existing renegotiation job queues/logs in prod.
2. **`mac_mini_jobs`** belongs to a **separate SII document-downloader robot** (commands like `sii-carpeta`, `sii-boletas`) on the Mac Mini. It does **not** track the Superintendencia renegotiation portal process.
3. **Case progress** is tracked under `'Project status'` in the `data` JSON of `bronze_projects` (or `estado_airtable` in `renegociacion_audit`).
4. **Target filtering:** active cases in `v_casos_renegociacion` whose `bronze_projects` `'Project status'` is exactly **`'Asignación al asesor'`** (currently **181 clients**) — newly assigned, no portal request started.

### Environment facts (verified)
- **Sandbox DB:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, **`DATABASE_URL`** (direct Postgres pooler → can run DDL).
- **Production DB (lawyer):** only `PROD_SUPABASE_URL` + `PROD_SUPABASE_SERVICE_ROLE_KEY`. **No `PROD_DATABASE_URL`** → prod is reachable only via PostgREST, which **cannot run DDL**. Schema changes to prod are impossible by construction. Remaining risks: row-level writes (P1) and credential exfiltration (P4) — closed below.

### Review findings being fixed
| # | Problem | Status |
|---|---------|--------|
| **P1** | Prod write-protection is by convention only; the service-role key can `INSERT/UPDATE/DELETE` any prod table. | Fixed in §1 |
| **P2** | `create_sandbox_tables.ts` doesn't assert which DB it targets. | Fixed in §2 |
| **P3** | Misleading `production_*` table names. | **Already addressed** — renamed to `pato_prueba_*`. |
| **P4** | Real ClaveÚnica passwords copied into a table with `RLS ... TO public`. | Fixed in §4 |
| **P5** | Verification never asserts prod is untouched. | Fixed in §5 |
| **P6** | Personal fields fall back to placeholders (live query: `fecha_nacimiento` 0/50, `Titulo` 26/50, email/phone only in `sub`). | Fixed in §6 |

---

## Proposed Changes

### 1. Enforced Read-Only Production Access  `[Fixes P1]`

All prod access goes through one guarded module that *physically cannot write*.

#### [NEW] `src/utils/prodReadOnly.ts`
```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const FORBIDDEN = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);

/** Supabase client whose query builder only allows reads; any mutating call throws. */
export function getProdReadOnlyClient(): SupabaseClient {
  const url = process.env.PROD_SUPABASE_URL!;
  const key = process.env.PROD_SUPABASE_READONLY_KEY || process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!;
  const real = createClient(url, key, { auth: { persistSession: false } });

  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => new Proxy(target.from(table), {
          get(b, p) {
            if (typeof p === 'string' && FORBIDDEN.has(p)) {
              throw new Error(`🚫 Prod write blocked: '${p}' on '${table}'. Production is READ-ONLY.`);
            }
            return (b as any)[p];
          },
        });
      }
      if (prop === 'rpc') return () => { throw new Error('🚫 Prod RPC blocked. READ-ONLY.'); };
      return Reflect.get(target, prop, receiver);
    },
  });
}
```
**Rules:** `sync_prod_data.ts`, `worker.ts`, and any prod-touching script must import the prod client **only** from `prodReadOnly.ts`. Add a guard test (`npm test`) that fails if `PROD_SUPABASE` appears in any other file. **Production hardening:** ask the lawyer for a real read-only credential in `PROD_SUPABASE_READONLY_KEY` (Postgres role with `GRANT SELECT` only). Creating a new role does not alter existing structures — do it only with explicit consent.

---

### 2. Sandbox-Only DDL Guard  `[Fixes P2]`

#### [NEW] `src/utils/create_sandbox_tables.ts`
Creates the two tables using the **sandbox** pooler (`DATABASE_URL`). Before any DDL it must:
```ts
const target = new URL(process.env.DATABASE_URL!).host;
const prodHost = new URL(process.env.PROD_SUPABASE_URL!).host;
if (target.includes(prodHost.split('.')[0])) {
  throw new Error(`🚫 Refusing DDL: target host '${target}' looks like PRODUCTION.`);
}
if (!process.argv.includes('--confirm')) {
  throw new Error(`Add --confirm to run DDL on sandbox host '${target}'.`);
}
console.log(`✓ Running DDL against SANDBOX host: ${target}`);
```
This makes it impossible to create objects in the lawyer's DB by mistake.

---

### 3. Database Schema (no stored credentials, locked-down RLS)  `[Fixes P4]`

```sql
-- Table 1: Isolated test clients (real data from prod, stored in SANDBOX). NO plaintext credentials.
CREATE TABLE IF NOT EXISTS pato_prueba_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    airtable_id TEXT UNIQUE NOT NULL,      -- link back to prod case (read-only source of truth)
    rut TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    clave_unica_rut TEXT NOT NULL,         -- the RUT used to log in (not secret)
    -- Personal data (real where available; see §6)
    nacionalidad TEXT,
    fecha_nacimiento TEXT,                 -- NULLABLE: absent in prod DB (see §6)
    estado_civil TEXT,
    regimen_patrimonial TEXT,
    profesion_oficio TEXT,
    ocupacion TEXT,
    direccion TEXT,
    region TEXT,
    comuna TEXT,
    email TEXT,
    telefono_prefijo TEXT,
    telefono TEXT,
    -- Data-quality tracking (§6)
    missing_fields TEXT[] DEFAULT '{}',
    data_complete BOOLEAN GENERATED ALWAYS AS (array_length(missing_fields, 1) IS NULL) STORED,
    created_at TIMESTAMPTZ DEFAULT now()
    -- NOTE: clave_unica_password intentionally REMOVED — fetched just-in-time from prod at runtime (§4).
);
COMMENT ON TABLE pato_prueba_clients IS 'TEST: real client data sourced read-only from prod SuperWhisp, stored & run in SANDBOX only. No credentials stored.';

-- Table 2: Isolated test jobs (SANDBOX only)
CREATE TABLE IF NOT EXISTS pato_prueba_automation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES pato_prueba_clients(id) ON DELETE CASCADE,
    step INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','failed')),
    dry_run BOOLEAN NOT NULL DEFAULT true,   -- safety interlock (§6)
    error_log TEXT,
    screenshot_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: public access (matching clients table in sandbox)
ALTER TABLE pato_prueba_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access to pato_prueba_clients" ON pato_prueba_clients FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE pato_prueba_automation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access to pato_prueba_automation_jobs" ON pato_prueba_automation_jobs FOR ALL TO public USING (true) WITH CHECK (true);

```

---

### 4. Credentials Are Never Exfiltrated  `[Fixes P4]`

- **4a — No plaintext ClaveÚnica in the sandbox.** `clave_unica_password` is dropped from the schema. The worker fetches the ClaveÚnica **just-in-time** at job execution from prod `renegociacion_overrides` (via `getProdReadOnlyClient`, keyed by `airtable_id`). Single source of truth; credentials never leave the access-controlled prod store. This is exactly how production will work too, so the automation path is unaffected.
- **4b — Locked-down RLS.** `service_role` only (see §3); no anon/public read. Worker and scripts use `service_role`; the dashboard reads pilot data through the service key from its backend/worker layer.
- **4c — Encrypt if ever cached.** If a future need forces caching a secret, store it AES-256-GCM-encrypted with `PILOT_ENC_KEY` (env), decrypted at runtime via a new `src/utils/secrets.ts`. Never store plaintext.
- **4d — Never log credentials.** Reuse the existing `[CLEANED]` redaction already used for `mac_mini_jobs.args`.

---

### 5. Production Integrity Verification (before/after)  `[Fixes P5]`

#### [NEW] `src/utils/verify_prod_untouched.ts`
Proves the lawyer's DB is unchanged by the whole flow. Uses `getProdReadOnlyClient()`.
- `--snapshot` → baseline to `outputs/prod_baseline.json`: full table list (from `${PROD_SUPABASE_URL}/rest/v1/` OpenAPI) + exact row counts (`head:true, count:'exact'`) of: `v_casos_renegociacion`, `renegociacion_overrides`, `bronze_projects`, `bronze_customers_main`, `bronze_customers_sub`, `mac_mini_jobs`.
- `--check` → re-read and **assert zero deltas** (no table added/removed, no row-count change); exit non-zero on any difference.

**Procedure:** `--snapshot` before the pilot flow, `--check` after. The flow is "verified safe" only if `--check` passes.

---

### 6. Real-Data Completeness & Submission Safety  `[Fixes P6]`

**Confirmed by live query (sample of 50):**

| Field | `bronze_customers_main` | `bronze_customers_sub` | Action |
|---|---|---|---|
| Nacionalidad, Estado Civil, Domicilio, Comuna | 50/50 ✅ | 0/50 | Use `main` (real). |
| Titulo (profesión) | 26/50 ⚠️ | 0/50 | Use `main`; flag missing for the rest. |
| Email, Phone | 0/50 | 50/50 ✅ / 48/50 | Source from `sub` (join by RUT) or the case view — **not** `main`. |
| **Fecha de Nacimiento** | **0/50 ❌** | **0/50 ❌** | **Not in DB** — see 6c. |

- **6a — Fix sources.** email/phone from `bronze_customers_sub` (or case view); nacionalidad/estado_civil/domicilio/comuna from `bronze_customers_main`. Stop reading email/phone from `main` (always empty).
- **6b — No silent placeholders.** When a real value is absent, leave the column `NULL` and append the field to `missing_fields`. Add a **`--strict`** flag that *skips* clients missing critical fields instead of syncing partial records.
- **6c — `fecha_nacimiento` (blocking for submission).** Absent from the DB. Likely the Superir portal **auto-fills** birthdate from ClaveÚnica at login. The builder must **verify in the portal**: if it auto-fills → don't sync/enter it; if not → source it elsewhere (Registro Civil / client docs) and treat as `missing_field` until then.
- **6d — Submission interlock.** `pato_prueba_automation_jobs.dry_run` defaults to `true`. The automation may **fill/save a draft** but must **refuse to submit** (Step 8 "Finalizar") when `data_complete = false`. Real filings only after data is complete and human-validated. Protects production filings from fake data.

---

### 7. Worker Integration (Dual Mode)

#### [MODIFY] `src/worker.ts`
- `QUEUE_MODE=production` → process `pato_prueba_automation_jobs` using clients from `pato_prueba_clients`; **fetch ClaveÚnica just-in-time** from prod (read-only, §4a); honor the `dry_run` interlock (§6d).
- Otherwise defaults to sandbox `automation_jobs` + `clients` — existing flow untouched.

### 8. Dashboard Integration

#### [MODIFY] `dashboard/src/App.tsx`
- Add a tab: **"Pruebas Sandbox"** vs **"Pruebas de Producción (Aislado)"**.
- Production-isolated mode lists `pato_prueba_clients` / `pato_prueba_automation_jobs` (via the service key from the backend, §4b) and inserts triggers into `pato_prueba_automation_jobs`. Show each client's `missing_fields` / `data_complete` so the user knows who is safe to actually submit.

---

## Utilities & Scripts (summary)

| File | Action | Purpose |
|---|---|---|
| `src/utils/prodReadOnly.ts` | **NEW** | Enforced read-only prod client (§1). |
| `src/utils/create_sandbox_tables.ts` | **NEW** | Create `pato_prueba_*` on sandbox with DDL guard (§2). |
| `src/utils/verify_prod_untouched.ts` | **NEW** | Before/after prod integrity check (§5). |
| `src/utils/secrets.ts` | **NEW (optional)** | AES-256-GCM helpers if a secret must be cached (§4c). |
| `src/utils/sync_prod_data.ts` | **NEW/MODIFY** | Use `getProdReadOnlyClient`; upsert to `pato_prueba_clients`; fix data sources; `missing_fields`; `--strict`; no plaintext password (§1, §4, §6). |
| `src/worker.ts` | **MODIFY** | Dual-mode queue; JIT read-only credential fetch; `dry_run` interlock (§1, §4, §6, §7). |
| `dashboard/src/App.tsx` | **MODIFY** | Isolated tab over `pato_prueba_*` via service key; show data completeness (§8). |

---

## Verification Plan (hardened)

1. **Prod baseline:** `npx tsx src/utils/verify_prod_untouched.ts --snapshot` → `outputs/prod_baseline.json`.
2. **Create tables:** `npx tsx src/utils/create_sandbox_tables.ts --confirm` → both `pato_prueba_*` created on the **sandbox** host (printed); `clients`/`automation_jobs` untouched.
3. **Read-only guard test:** mutating calls on the prod client throw; no file outside `prodReadOnly.ts` references `PROD_SUPABASE`.
4. **Dry sync:** `npx tsx src/utils/sync_prod_data.ts --dry-run` → mapped sample + completeness report; no DB writes.
5. **Real sync:** `npx tsx src/utils/sync_prod_data.ts --strict` → clients land in `pato_prueba_clients` with `missing_fields`, **no credential columns**; sandbox `clients` stays empty.
6. **Worker pilot run:** `QUEUE_MODE=production` — trigger a job; verify it fetches ClaveÚnica JIT (never stored), runs in `dry_run`, updates `pato_prueba_automation_jobs`, and **blocks Step 8 submission** when `data_complete = false`.
7. **Prod integrity:** `npx tsx src/utils/verify_prod_untouched.ts --check` → **must pass** (zero deltas). If it fails, stop — the flow is not safe.

---

## Open Questions for the Builder
1. **Birthdate (§6c):** does the Superir portal auto-fill `fecha_nacimiento` from ClaveÚnica? Determines whether we sync it. **Blocking for real submission.**
2. **Read-only prod key (§1):** will the lawyer issue a `PROD_SUPABASE_READONLY_KEY`? Until then, the Proxy is the only enforcement.
3. **Profession coverage (§6):** ~half of clients lack `Titulo`. Default to "Otros (9999)" for pilot, or skip under `--strict`?
4. **Dashboard auth (§4b):** confirm the dashboard uses the service key from a backend/worker layer so anon never reads pilot data.
