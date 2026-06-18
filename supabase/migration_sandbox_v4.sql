-- =========================================================================
-- Sandbox Migration V4 — Cierre de gaps de esquema (Problemas 4 y 6)
-- Ejecutar en el SQL Editor del proyecto SANDBOX (SUPABASE_URL = fnz...).
-- Idempotente / re-ejecutable.
--
-- Contexto: el sandbox YA tiene en `clients` las columnas de rutas de
-- documentos (carpeta_tributaria_path, carpeta_retenedores_path,
-- informe_cmf_path) y credential_error. Lo único que falta es `airtable_id`
-- (Problema 4) y endurecer la FK de automation_alerts (Problema 6).
-- =========================================================================

-- -------------------------------------------------------------------------
-- Problema 4 — clients.airtable_id
-- Necesario para resolveClaveUnica(): enlaza el cliente con
-- renegociacion_overrides (en PROD) para obtener la ClaveÚnica real.
-- UNIQUE permite múltiples NULL (clientes de prueba sin airtable_id).
-- -------------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS airtable_id TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'clients'::regclass
          AND conname  = 'clients_airtable_id_key'
    ) THEN
        ALTER TABLE clients ADD CONSTRAINT clients_airtable_id_key UNIQUE (airtable_id);
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- Problema 6 — automation_alerts.client_id: TEXT → uuid + FK a clients(id)
-- Los valores existentes ya son UUID válidos (verificado), el cast es seguro.
-- La FK con ON DELETE CASCADE evita alertas huérfanas.
-- -------------------------------------------------------------------------

-- 6a. Eliminar alertas huérfanas (client_id que no existe en clients) para que
--     la FK pueda crearse. En sandbox no hay datos reales que preservar.
-- Comparamos ambos lados como texto: client_id puede estar como text o uuid
-- según el estado de la tabla (en sandbox ya está como uuid).
DELETE FROM automation_alerts
WHERE client_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM clients c WHERE c.id::text = automation_alerts.client_id::text
  );

-- 6b. Convertir el tipo de columna a uuid (no-op si ya es uuid).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'automation_alerts'
          AND column_name = 'client_id'
          AND data_type   = 'text'
    ) THEN
        ALTER TABLE automation_alerts
            ALTER COLUMN client_id TYPE uuid USING client_id::uuid;
    END IF;
END $$;

-- 6c. Agregar la FK a clients(id) si no existe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'automation_alerts'::regclass
          AND conname  = 'automation_alerts_client_id_fkey'
    ) THEN
        ALTER TABLE automation_alerts
            ADD CONSTRAINT automation_alerts_client_id_fkey
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- Problema 7 — automation_jobs: agregar needs_lawyer_review + pending_review
-- La tabla ya existe en sandbox → solo agregar columna y ampliar el CHECK.
-- -------------------------------------------------------------------------

-- 7a. Columna needs_lawyer_review (no-op si ya existe)
ALTER TABLE automation_jobs ADD COLUMN IF NOT EXISTS needs_lawyer_review BOOLEAN NOT NULL DEFAULT false;

-- 7b. Ampliar el CHECK de status para incluir 'pending_review'
--     PostgreSQL no tiene ALTER CONSTRAINT; hay que eliminar y recrear.
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Eliminar el CHECK viejo si existe (cualquier nombre generado por PG)
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'automation_jobs'::regclass
          AND contype   = 'c'
          AND pg_get_constraintdef(oid) LIKE '%pending%review%'
    ) THEN
        RETURN; -- Ya tiene pending_review, nada que hacer
    END IF;

    -- Drop all check constraints on automation_jobs.status
    FOR r IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'automation_jobs'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%status%'
    ) LOOP
        EXECUTE format('ALTER TABLE automation_jobs DROP CONSTRAINT %I', r.conname);
    END LOOP;

    -- Recrear con el conjunto ampliado
    ALTER TABLE automation_jobs
        ADD CONSTRAINT automation_jobs_status_check
        CHECK (status IN ('pending', 'running', 'success', 'failed', 'blocked', 'pending_review'));
END $$;

-- -------------------------------------------------------------------------
-- Documentación de la tabla `clients` — función de cada columna en el flujo.
-- Hace la tabla autoexplicativa en el SQL Editor para crear filas de clientes
-- nuevos. Los valores de los <select> del portal son LITERALES (selectOption
-- usa el atributo value/texto exacto del <option>); un texto descriptivo causa
-- timeout de 60s en step1_personal.ts (selectBootstrap).
-- -------------------------------------------------------------------------
COMMENT ON TABLE  clients IS 'Fuente única del cliente para la automatización Superir. Una fila por cliente: credenciales + datos personales (Paso 1) + punteros a sus PDFs (Pasos 2/3/5). En sandbox-como-producción airtable_id queda NULL y la ClaveÚnica se lee de clave_unica_password.';

COMMENT ON COLUMN clients.rut                      IS 'Login + identificador en el portal Superir. Formato XXXXXXXX-X. NOT NULL de hecho.';
COMMENT ON COLUMN clients.name                     IS 'Nombre completo del cliente.';
COMMENT ON COLUMN clients.clave_unica_rut          IS 'RUT para login ClaveÚnica (normalmente = rut). login.ts.';
COMMENT ON COLUMN clients.clave_unica_password     IS 'ClaveÚnica del cliente. Fuente directa en sandbox (fallback en worker.ts:resolveClaveUnica). NO reusar la de otro cliente.';
COMMENT ON COLUMN clients.nacionalidad             IS 'Paso 1. Texto, ej. "Chilena". Campo libre #personaNacionalidad.';
COMMENT ON COLUMN clients.fecha_nacimiento         IS 'Paso 1. dd/mm/yyyy. El valor "01/01/1990" es placeholder y NO se escribe (step1_personal.ts).';
COMMENT ON COLUMN clients.estado_civil             IS 'Paso 1. VALOR LITERAL del <select>: 1=Soltero/a, 2=Casado/a (si =2 exige regimen_patrimonial).';
COMMENT ON COLUMN clients.regimen_patrimonial      IS 'Paso 1. VALOR LITERAL del <select>. Solo requerido si estado_civil=2 (casado/a).';
COMMENT ON COLUMN clients.profesion_oficio         IS 'Paso 1. VALOR LITERAL del <select> (ej. 4=Administrativos).';
COMMENT ON COLUMN clients.ocupacion                IS 'Paso 1. VALOR LITERAL del <select> (ej. 13=Trabajador/a dependiente).';
COMMENT ON COLUMN clients.direccion                IS 'Paso 1. Texto libre #personaDireccion.';
COMMENT ON COLUMN clients.region                   IS 'Paso 1. VALOR LITERAL del <select>, ej. "Región Metropolitana" (value 13).';
COMMENT ON COLUMN clients.comuna                   IS 'Paso 1. VALOR LITERAL del <select> EN MAYÚSCULA, ej. "LO BARNECHEA" (value 293). Depende de region.';
COMMENT ON COLUMN clients.email                    IS 'Paso 1. #personaCorreoElectronico.';
COMMENT ON COLUMN clients.telefono_prefijo         IS 'Paso 1. VALOR LITERAL del <select> de prefijo telefónico.';
COMMENT ON COLUMN clients.telefono                 IS 'Paso 1. #personaTelefono.';
COMMENT ON COLUMN clients.carpeta_tributaria_path  IS 'Paso 2. storage_path (bucket documentos) de la Carpeta Tributaria SII. Agente Tributario / F29.';
COMMENT ON COLUMN clients.carpeta_retenedores_path IS 'Paso 5 (ingresos). storage_path del informe de Agentes Retenedores SII.';
COMMENT ON COLUMN clients.informe_cmf_path         IS 'Paso 3. storage_path del Informe de Deudas CMF. CMF parser + Centinela.';
COMMENT ON COLUMN clients.acreditacion_documentos_json IS 'LEGACY. Reemplazado por la tabla client_documents. No usar para clientes nuevos.';
COMMENT ON COLUMN clients.credential_error         IS 'Marca de error de login (la setea el worker/alerts). NULL si OK.';
COMMENT ON COLUMN clients.airtable_id              IS 'SOLO producción: enlaza con renegociacion_overrides (ton...) para resolver ClaveÚnica. En sandbox-como-producción: dejar NULL.';
