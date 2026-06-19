-- =========================================================================
-- SQL Schema Definition for Superintendencia de Insolvencia (Superir)
-- Automation Sandbox Database
-- =========================================================================

-- 1. Client Table containing ClaveÚnica credentials and Paso 1 Info
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    airtable_id TEXT UNIQUE,                 -- enlaza con renegociacion_overrides (PROD) por airtable_id
    rut TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    clave_unica_rut TEXT NOT NULL,
    clave_unica_password TEXT,               -- fallback; en prod las creds vienen de renegociacion_overrides
    nacionalidad TEXT,
    fecha_nacimiento TEXT,
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
    -- Rutas de documentos en Supabase Storage (bucket 'documentos')
    carpeta_tributaria_path TEXT,
    carpeta_retenedores_path TEXT,
    informe_cmf_path TEXT,
    -- Estado y metadata
    credential_error TEXT,                   -- escrito por createAlert/clearAlert (errores ClaveÚnica)
    acreditacion_documentos_json JSONB,      -- legacy; migrado a client_documents
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Allow public read/write in sandbox (for easy lawyer dashboard testing)
CREATE POLICY "Allow public read access to clients" ON clients FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert access to clients" ON clients FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update access to clients" ON clients FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete access to clients" ON clients FOR DELETE TO public USING (true);


-- 2. Automation Jobs Queue Table
CREATE TABLE IF NOT EXISTS automation_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
    step          INTEGER NOT NULL DEFAULT 1,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'success', 'failed', 'blocked')),
    dry_run       BOOLEAN NOT NULL DEFAULT true,
    error_log     TEXT,
    error_message TEXT,
    screenshot_url TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on automation_jobs
ALTER TABLE automation_jobs ENABLE ROW LEVEL SECURITY;

-- Allow public read/write in sandbox
CREATE POLICY "Allow public read access to jobs" ON automation_jobs FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert access to jobs" ON automation_jobs FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update access to jobs" ON automation_jobs FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete access to jobs" ON automation_jobs FOR DELETE TO public USING (true);


-- 3. Automation Alerts Table (bloqueos F29 / Centinela / Paso 3)
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

ALTER TABLE automation_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public access to automation_alerts" ON automation_alerts;
CREATE POLICY "Allow public access to automation_alerts" ON automation_alerts
    FOR ALL TO public USING (true) WITH CHECK (true);
