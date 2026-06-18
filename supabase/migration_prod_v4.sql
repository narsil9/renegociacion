-- =========================================================================
-- Production Migration V4 — CONSOLIDADA (Problemas 1, 2 y 3)
-- Ejecutar en el SQL Editor de PRODUCCIÓN (PROD_SUPABASE_URL = ton...).
-- Idempotente / re-ejecutable.
--
-- SUPERSEDE a migration_prod_v1.sql, _v2.sql y _v3.sql:
--   - v2 y v3 creaban `renegociacion_clientes`, una dirección ABANDONADA
--     (la sesión de limpieza del sandbox la declaró "tabla fantasma").
--   - La decisión canónica es usar `clients` en sandbox Y en producción,
--     igual que worker.ts (CLIENTS_TABLE = 'clients').
--
-- Estado real de producción al crear esta migración:
--   Solo existen `acreedores_canonicos` y `renegociacion_overrides`.
--   NINGUNA tabla de automatización existe todavía → se crean todas aquí,
--   con las FK correctas hacia `clients` desde el inicio (Problemas 1 y 3).
-- NO se toca `acreedores_canonicos` ni `renegociacion_overrides`.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. clients — espejo exacto del sandbox (incluye airtable_id + rutas docs)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    airtable_id               TEXT UNIQUE,
    rut                       TEXT UNIQUE NOT NULL,
    name                      TEXT NOT NULL,
    clave_unica_rut           TEXT NOT NULL,
    clave_unica_password      TEXT,
    nacionalidad              TEXT,
    fecha_nacimiento          TEXT,
    estado_civil              TEXT,
    regimen_patrimonial       TEXT,
    profesion_oficio          TEXT,
    ocupacion                 TEXT,
    direccion                 TEXT,
    region                    TEXT,
    comuna                    TEXT,
    email                     TEXT,
    telefono_prefijo          TEXT,
    telefono                  TEXT,
    carpeta_tributaria_path   TEXT,
    carpeta_retenedores_path  TEXT,
    informe_cmf_path          TEXT,
    credential_error          TEXT,
    acreditacion_documentos_json JSONB,
    created_at                TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE clients IS 'Clientes de la automatización Superir (producción). Credenciales reales se resuelven contra renegociacion_overrides por airtable_id.';

-- Por si la tabla ya existía sin alguna columna (no-op si ya están):
ALTER TABLE clients ADD COLUMN IF NOT EXISTS airtable_id                  TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS carpeta_tributaria_path      TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS carpeta_retenedores_path     TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS informe_cmf_path             TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credential_error             TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS acreditacion_documentos_json JSONB;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'clients'::regclass AND conname = 'clients_airtable_id_key'
    ) THEN
        ALTER TABLE clients ADD CONSTRAINT clients_airtable_id_key UNIQUE (airtable_id);
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. automation_jobs — FK → clients(id)  (Problema 1)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_jobs (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID REFERENCES clients(id) ON DELETE CASCADE,
    step                 INTEGER NOT NULL DEFAULT 1,
    status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'running', 'success', 'failed', 'blocked', 'pending_review')),
    dry_run              BOOLEAN NOT NULL DEFAULT true,
    needs_lawyer_review  BOOLEAN NOT NULL DEFAULT false,
    error_log            TEXT,
    error_message        TEXT,
    screenshot_url       TEXT,
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 3. automation_alerts — client_id uuid + FK → clients(id)  (Problema 6 desde el inicio)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_alerts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID REFERENCES automation_jobs(id) ON DELETE CASCADE,
    client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
    step        INTEGER,
    alert_type  TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE automation_alerts IS 'Alertas de bloqueo por job: F29 Primera Categoría, Centinela bloqueante, Paso 3 sin requisitos.';

-- -------------------------------------------------------------------------
-- 4. agent_runs — FK → clients(id)  (Problema 3)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
    step                INTEGER NOT NULL,
    agent_type          TEXT NOT NULL
                        CHECK (agent_type IN ('cmf_parser', 'tributario', 'centinela', 'mapeador')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    input_hash          TEXT,
    output_json         JSONB,
    errors              TEXT[],
    needs_lawyer_review BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

COMMENT ON TABLE agent_runs IS 'Runs de la cadena multi-agente (tributario → centinela → mapeador). FK: clients.id (producción).';

CREATE INDEX IF NOT EXISTS agent_runs_client_agent ON agent_runs (client_id, agent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_status ON agent_runs (status) WHERE status IN ('pending', 'running');

-- -------------------------------------------------------------------------
-- 5. client_documents — FK → clients(id)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_documents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        UUID REFERENCES clients(id) ON DELETE CASCADE,
    document_type    INTEGER,
    acreditacion_tipo TEXT,
    institucion_cmf  TEXT,
    storage_path     TEXT,
    filename         TEXT,
    uploaded_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE client_documents IS 'Documentos de acreditación por cliente (Paso 3). FK: clients.id (producción).';

-- -------------------------------------------------------------------------
-- 6. Grants + RLS (mismo patrón open que el sandbox; endurecer al ir a prod real)
-- -------------------------------------------------------------------------
GRANT ALL ON public.clients          TO anon, authenticated, service_role;
GRANT ALL ON public.automation_jobs  TO anon, authenticated, service_role;
GRANT ALL ON public.automation_alerts TO anon, authenticated, service_role;
GRANT ALL ON public.agent_runs       TO anon, authenticated, service_role;
GRANT ALL ON public.client_documents TO anon, authenticated, service_role;

ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_documents  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access to clients" ON clients;
CREATE POLICY "Allow public access to clients" ON clients FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public access to automation_jobs" ON automation_jobs;
CREATE POLICY "Allow public access to automation_jobs" ON automation_jobs FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public access to automation_alerts" ON automation_alerts;
CREATE POLICY "Allow public access to automation_alerts" ON automation_alerts FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public access to agent_runs" ON agent_runs;
CREATE POLICY "Allow public access to agent_runs" ON agent_runs FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public access to client_documents" ON client_documents;
CREATE POLICY "Allow public access to client_documents" ON client_documents FOR ALL TO public USING (true) WITH CHECK (true);
