-- =========================================================================
-- setup.sql — Esquema COMPLETO de la base de datos de la automatización.
--
-- Corré este archivo UNA vez en el SQL Editor de tu proyecto Supabase para
-- dejar la base lista para el worker y para que tu dashboard escriba en ella.
-- Es idempotente (re-ejecutable sin romper nada) y consolida todo lo que el
-- worker necesita (equivale a schema.sql + migraciones v4–v8).
--
-- Crea: clients, automation_jobs, automation_alerts, agent_runs,
--       client_documents, acreedores_canonicos + los buckets de Storage
--       'documentos' y 'screenshots', con RLS abierto (sandbox).
--
-- ⚠️ RLS abierto = cualquiera con la anon key puede leer/escribir. Sirve para
--    un proyecto dedicado/privado. Antes de exponerlo, endurecé las policies.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. clients — datos del Paso 1 + credenciales ClaveÚnica + rutas de documentos
--    Tu dashboard hace UPSERT aquí (por `rut`, que es UNIQUE).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    airtable_id              TEXT UNIQUE,          -- opcional: llave a un sistema externo
    rut                      TEXT UNIQUE NOT NULL, -- identificador del cliente en el portal
    name                     TEXT NOT NULL,
    clave_unica_rut          TEXT NOT NULL,        -- RUT de la ClaveÚnica (login del portal)
    clave_unica_password     TEXT,                 -- clave del cliente (la escribe el dashboard)
    -- Paso 1 (info personal). Valores = enums del portal (ver supabase/portal_select_values.json)
    nacionalidad             TEXT,
    fecha_nacimiento         TEXT,                 -- DD/MM/AAAA — obligatorio para un envío real
    estado_civil             TEXT,
    regimen_patrimonial      TEXT,
    profesion_oficio         TEXT,
    ocupacion                TEXT,
    direccion                TEXT,
    region                   TEXT,
    comuna                   TEXT,
    email                    TEXT,
    telefono_prefijo         TEXT,
    telefono                 TEXT,
    -- Rutas en el bucket de Storage 'documentos' (las escribe el dashboard)
    carpeta_tributaria_path  TEXT,                 -- Carpeta Tributaria (SII) — Paso 2
    carpeta_retenedores_path TEXT,                 -- Agentes Retenedores (SII) — Paso 5
    informe_cmf_path         TEXT,                 -- Informe de Deudas CMF — Paso 3 (obligatorio)
    -- Estado / metadata
    credential_error         TEXT,                 -- lo escribe el worker si falla la ClaveÚnica
    acreditacion_documentos_json JSONB,            -- LEGACY (reemplazado por client_documents)
    created_at               TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 2. automation_jobs — la COLA. Tu dashboard inserta una fila para disparar
--    una corrida; el worker la pollea cada 5s y actualiza status/progreso.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
    step                INTEGER NOT NULL DEFAULT 0,  -- 0 = flujo completo (Pasos 1→5); 1..5 = un paso
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','success','failed','blocked','pending_review')),
    dry_run             BOOLEAN NOT NULL DEFAULT true, -- true = llena el borrador sin enviar (prueba)
    needs_lawyer_review BOOLEAN NOT NULL DEFAULT false, -- lo pone el worker si algo requiere revisión
    lawyer_confirmed    BOOLEAN NOT NULL DEFAULT false, -- lo pone el dashboard al reanudar un pending_review
    error_log           TEXT,                          -- log completo (al terminar)
    error_message       TEXT,                          -- mensaje legible del fallo/bloqueo
    screenshot_url      TEXT,                          -- captura del portal (bucket 'screenshots')
    progress_message    TEXT,                          -- fase actual, en lenguaje claro (en vivo)
    progress_updated_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_jobs_poll ON automation_jobs (status, created_at)
    WHERE status = 'pending';

-- -------------------------------------------------------------------------
-- 3. automation_alerts — lo que el worker no pudo resolver solo y el abogado
--    debe revisar (acreedor sin declarar, bloqueo F29, no califica, etc.).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_alerts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID REFERENCES automation_jobs(id) ON DELETE CASCADE,
    client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
    step        INTEGER,
    alert_type  TEXT NOT NULL,   -- 'blocked' | 'needs_review'
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 4. agent_runs — bitácora de la cadena de agentes (idempotencia por hash).
--    La usa el worker internamente; el dashboard no escribe acá.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
    step                INTEGER NOT NULL,
    agent_type          TEXT NOT NULL
                        CHECK (agent_type IN ('cmf_parser','tributario','centinela','mapeador','ingresos')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed')),
    input_hash          TEXT,        -- SHA-256 del set de PDFs de entrada
    output_json         JSONB,       -- output tipado (ver src/agents/types.ts)
    errors              TEXT[],
    needs_lawyer_review BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_runs_client_agent ON agent_runs (client_id, agent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_status ON agent_runs (status) WHERE status IN ('pending','running');

-- -------------------------------------------------------------------------
-- 5. client_documents — certificados de acreditación (Paso 3) y documentos de
--    ingreso (Paso 5). Tu dashboard inserta una fila por documento subido.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
    document_type     INTEGER,   -- 22=acredita monto, 23=acredita vencimiento, 24=general
    acreditacion_tipo TEXT,      -- 'monto' | 'vencimiento' | 'general'
    institucion_cmf   TEXT,      -- opcional; el worker lo deriva por RUT si viene vacío
    storage_path      TEXT,      -- ruta en el bucket 'documentos' (única por documento)
    filename          TEXT,
    uploaded_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_documents_client ON client_documents (client_id);

-- -------------------------------------------------------------------------
-- 6. acreedores_canonicos — catálogo maestro de acreedores (normalización de
--    nombres CMF → RUT). Cargalo con tus acreedores conocidos. El worker lo lee
--    (activo=true). `nombres_alternativos` = variantes del nombre en CMF/certs.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acreedores_canonicos (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre               TEXT NOT NULL,
    nombre_normalizado   TEXT,
    tipo                 TEXT,          -- 'empresa' | 'persona'
    rut                  TEXT,          -- llave dura de identidad del acreedor
    direccion            TEXT,
    comuna               TEXT,
    email                TEXT,
    telefono             TEXT,
    representante_legal  TEXT,
    rut_representante    TEXT,
    activo               BOOLEAN NOT NULL DEFAULT true,
    nombres_alternativos TEXT[] NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acreedores_canonicos_activo ON acreedores_canonicos (activo);

-- -------------------------------------------------------------------------
-- 7. Storage buckets — 'documentos' (PDFs del cliente, lo llena el dashboard)
--    y 'screenshots' (capturas del portal, las sube el worker).
-- -------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false), ('screenshots', 'screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------------
-- 8. RLS abierto (sandbox / proyecto dedicado). Endurecer antes de exponer.
-- -------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','automation_jobs','automation_alerts','agent_runs','client_documents','acreedores_canonicos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "open_all" ON %I;', t);
    EXECUTE format('CREATE POLICY "open_all" ON %I FOR ALL TO public USING (true) WITH CHECK (true);', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role;', t);
  END LOOP;
END $$;

-- Acceso abierto a los buckets de Storage (sandbox).
DROP POLICY IF EXISTS "open_storage" ON storage.objects;
CREATE POLICY "open_storage" ON storage.objects FOR ALL TO public
  USING (bucket_id IN ('documentos','screenshots'))
  WITH CHECK (bucket_id IN ('documentos','screenshots'));
