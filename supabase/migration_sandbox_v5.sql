-- =========================================================================
-- Sandbox Migration V5 — Reanudación de jobs por confirmación del abogado
-- Ejecutar en el SQL Editor del proyecto SANDBOX (SUPABASE_URL = fnz...).
-- Idempotente / re-ejecutable.
--
-- Contexto: el gate del abogado (worker.ts, fix B1) detiene los run reales en
-- `pending_review` cuando hay señales que requieren confirmación (acreedores
-- NO-CMF, monto divergente). Hasta ahora el job quedaba terminal: el poller
-- solo levanta `status='pending'` y nadie lo retomaba.
--
-- Esta migración agrega `lawyer_confirmed`: cuando el abogado revisa el caso
-- en el dashboard y lo re-encola (pending_review → pending + lawyer_confirmed=true),
-- el worker lo vuelve a tomar y, al ver el flag, continúa con el Paso 3 en
-- lugar de frenar de nuevo en el gate.
-- =========================================================================

-- -------------------------------------------------------------------------
-- automation_jobs.lawyer_confirmed
-- false por defecto. El dashboard lo pone en true al re-encolar un
-- `pending_review`. El worker lo lee en el gate (worker.ts) para saltarse
-- la detención y, al proceder, vuelve a poner needs_lawyer_review=false
-- (la revisión quedó resuelta).
-- -------------------------------------------------------------------------
ALTER TABLE automation_jobs
  ADD COLUMN IF NOT EXISTS lawyer_confirmed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN automation_jobs.lawyer_confirmed IS
  'true = el abogado revisó el caso en el dashboard y lo re-encoló confirmado. El worker, al verlo en el gate, continúa el Paso 3 sin detenerse en pending_review. Lo setea el dashboard (POST /api/automatizacion). Una fila nueva (caso nuevo) nace en false.';
