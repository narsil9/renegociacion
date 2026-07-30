-- 2026-07-30 — Contrato de documentos dashboard → worker, PARTE 1 (columnas e índice).
-- Producción: tonrzmlrrcnizamtzqte. Aplicar ANTES del código que las usa.
-- La parte 2 (CHECKs) se aplica DESPUÉS de que el proyector escriba los valores nuevos.
--
-- Estado medido antes de aplicar (2026-07-30): 0 columnas de estas ya existentes,
-- índices previos = pkey + client_documents_client + client_documents_sha256_idx,
-- 0 duplicados de (client_id, storage_path) que bloquearían el índice único.

-- 1. El acreedor del documento deja de ser un string que "ojalá" matchee.
--    Nullable a propósito: un acreedor de deuda real que todavía no está en el catálogo
--    (medidos: Tricard S.A., Solventa Créditos Limitada) debe poder proyectarse igual;
--    lo que NO puede es quedar sin institución (eso lo exige el CHECK de la parte 2).
ALTER TABLE public.client_documents
  ADD COLUMN IF NOT EXISTS acreedor_canonico_id integer
  REFERENCES public.acreedores_canonicos(id);

COMMENT ON COLUMN public.client_documents.acreedor_canonico_id IS
  'Acreedor canónico resuelto por el dashboard al proyectar. El join del worker es por id, no por nombre: un rename en acreedores_canonicos.nombre no rompe documentos ya insertados.';

-- 2. Idempotencia real de la proyección. Hoy el proyector la simula con un SELECT previo
--    + filtro en memoria, así que dos proyecciones concurrentes del mismo cliente insertan
--    duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS client_documents_client_storage_uq
  ON public.client_documents (client_id, storage_path);

-- 3. Lo que el LLM del matcher ya extrae de cada PDF y hoy se descarta en el upsert:
--    institucion_emisora, tipo_documento_real, rut_cliente, numero_operacion, monto_total,
--    fecha_emision, vigencia_alert, requiere_revision_humana.
ALTER TABLE public.renegociacion_documento_match
  ADD COLUMN IF NOT EXISTS extracted_metadata jsonb;

COMMENT ON COLUMN public.renegociacion_documento_match.extracted_metadata IS
  'Metadata que devuelve el matcher (MODEL_FAST) al leer el PDF. SEGUNDA OPINIÓN para cross-check y alertas, NO fuente de verdad: la lectura que declara es la del Centinela.';
