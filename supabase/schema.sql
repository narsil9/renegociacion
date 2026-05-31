-- =========================================================================
-- SQL Schema Definition for Superintendencia de Insolvencia (Superir)
-- Automation Sandbox Database
-- =========================================================================

-- 1. Client Table containing ClaveÚnica credentials and Paso 1 Info
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rut TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    clave_unica_rut TEXT NOT NULL,
    clave_unica_password TEXT NOT NULL,
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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    step INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed')),
    error_log TEXT,
    screenshot_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on automation_jobs
ALTER TABLE automation_jobs ENABLE ROW LEVEL SECURITY;

-- Allow public read/write in sandbox
CREATE POLICY "Allow public read access to jobs" ON automation_jobs FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert access to jobs" ON automation_jobs FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update access to jobs" ON automation_jobs FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete access to jobs" ON automation_jobs FOR DELETE TO public USING (true);
