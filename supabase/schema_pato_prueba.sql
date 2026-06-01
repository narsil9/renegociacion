-- =========================================================================
-- SQL Schema Definition for Isolated Production Testing (pato_prueba_*)
-- Execute this script in the Supabase SQL Editor to create the tables.
-- =========================================================================

-- Table 1: Isolated Production Clients
CREATE TABLE IF NOT EXISTS pato_prueba_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    airtable_id TEXT UNIQUE NOT NULL,
    rut TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    clave_unica_rut TEXT NOT NULL,
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
    missing_fields TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE pato_prueba_clients IS 'TEST: real client data sourced read-only from prod SuperWhisp, stored & run in SANDBOX only. No credentials stored.';

-- Table 2: Isolated Production Jobs
CREATE TABLE IF NOT EXISTS pato_prueba_automation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES pato_prueba_clients(id) ON DELETE CASCADE,
    step INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed')),
    dry_run BOOLEAN NOT NULL DEFAULT true,
    error_log TEXT,
    screenshot_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE pato_prueba_automation_jobs IS 'TEST: isolated test job runs in sandbox over pato_prueba_clients.';

-- Enable RLS & Allow public access on both new tables
ALTER TABLE pato_prueba_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public access to pato_prueba_clients" ON pato_prueba_clients;
CREATE POLICY "Allow public access to pato_prueba_clients" ON pato_prueba_clients FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE pato_prueba_automation_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public access to pato_prueba_automation_jobs" ON pato_prueba_automation_jobs;
CREATE POLICY "Allow public access to pato_prueba_automation_jobs" ON pato_prueba_automation_jobs FOR ALL TO public USING (true) WITH CHECK (true);
