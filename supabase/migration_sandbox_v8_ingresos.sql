-- =========================================================================
-- Sandbox Migration V8 — Paso 5 (Ingresos): agente 'ingresos' en agent_runs
-- Ejecutar en el SQL Editor del proyecto SANDBOX (SUPABASE_URL = fnz...).
-- Idempotente / re-ejecutable. DDL → no se puede por REST, lo corre el usuario.
-- NUNCA correr en prod (ton...).
--
-- Agrega 'ingresos' al CHECK de agent_runs.agent_type para que el agente de
-- ingresos del Paso 5 pueda persistir sus runs (idempotencia por SHA-256 de los
-- documentos de ingreso).
-- =========================================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Si ya incluye 'ingresos', no hacer nada.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'agent_runs'::regclass
          AND contype  = 'c'
          AND pg_get_constraintdef(oid) LIKE '%ingresos%'
    ) THEN
        RETURN;
    END IF;

    -- Eliminar el/los CHECK viejos sobre agent_type.
    FOR r IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'agent_runs'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%agent_type%'
    ) LOOP
        EXECUTE format('ALTER TABLE agent_runs DROP CONSTRAINT %I', r.conname);
    END LOOP;

    -- Recrear con el conjunto ampliado.
    ALTER TABLE agent_runs
        ADD CONSTRAINT agent_runs_agent_type_check
        CHECK (agent_type IN ('cmf_parser', 'tributario', 'centinela', 'mapeador', 'ingresos'));
END $$;
