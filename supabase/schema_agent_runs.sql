-- =========================================================================
-- agent_runs: cola de runs de los agentes Claude de la cadena multi-agente.
-- Cada agente guarda su output aquí; el siguiente lee de acá, no de PDFs.
-- Ejecutar en el SQL Editor de Supabase (sandbox).
-- =========================================================================

CREATE TABLE IF NOT EXISTS agent_runs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
    step          INTEGER NOT NULL,            -- 2 = tributario, 3 = cmf_parser/centinela/mapeador
    agent_type    TEXT NOT NULL CHECK (agent_type IN ('cmf_parser', 'tributario', 'centinela', 'mapeador')),
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    input_hash    TEXT,                        -- SHA-256 del set de PDFs de entrada (idempotencia)
    output_json   JSONB,                       -- output tipado según agent_type (ver src/agents/types.ts)
    errors        TEXT[],                      -- mensajes de error acumulados en el run
    needs_lawyer_review BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now(),
    completed_at  TIMESTAMPTZ
);

COMMENT ON TABLE agent_runs IS 'Runs de agentes Claude de la cadena multi-agente (tributario → cmf_parser → centinela → mapeador). FK: clients.id (sandbox).';

-- Índices de consulta frecuente
CREATE INDEX IF NOT EXISTS agent_runs_client_agent ON agent_runs (client_id, agent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_status ON agent_runs (status) WHERE status IN ('pending', 'running');

-- RLS: mismo patrón open que el resto del sandbox
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public access to agent_runs" ON agent_runs;
CREATE POLICY "Allow public access to agent_runs" ON agent_runs FOR ALL TO public USING (true) WITH CHECK (true);
