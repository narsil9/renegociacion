-- =========================================================================
-- Sandbox Migration V6 — Progreso en vivo del worker (panel de Automatización)
-- Ejecutar en el SQL Editor del proyecto SANDBOX (SUPABASE_URL = fnz...).
-- Idempotente / re-ejecutable.
--
-- Contexto: hoy el worker solo escribe el `status` (pending→running→success/…)
-- y vuelca el log completo a `error_log` al terminar. NO hay forma de saber,
-- mientras corre, EN QUÉ va el robot. Estas dos columnas guardan, en lenguaje
-- claro para el abogado, qué está haciendo ahora mismo (ej. "Revisando el
-- Informe de Deudas (CMF)…", "Abriendo el portal de la Superintendencia…").
-- El dashboard (/automatizacion) las lee y las muestra bajo cada caso "en proceso".
-- =========================================================================

-- Mensaje de progreso actual, en lenguaje claro (NO técnico). Lo escribe el
-- worker en cada cambio de fase (reportProgress en src/worker.ts).
ALTER TABLE automation_jobs ADD COLUMN IF NOT EXISTS progress_message TEXT;

-- Marca de tiempo de la última actualización de progreso (para mostrar "hace X").
ALTER TABLE automation_jobs ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN automation_jobs.progress_message    IS 'Paso 3/Automatización. Texto en lenguaje claro de lo que el robot hace AHORA (lo escribe el worker en cada fase). Solo informativo; el panel lo muestra para casos en proceso.';
COMMENT ON COLUMN automation_jobs.progress_updated_at IS 'Timestamp de la última actualización de progress_message.';
