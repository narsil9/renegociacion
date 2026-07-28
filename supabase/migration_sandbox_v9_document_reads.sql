-- ─────────────────────────────────────────────────────────────────────────────
-- v9 — Lecturas por documento.
--
-- ⚠️ El prefijo `sandbox_` es HISTÓRICO y miente: esta migración se aplica a la
-- Supabase de PRODUCCIÓN (tonrzmlrrcnizamtzqte), que es la única que existe. Se
-- conserva el nombre por consistencia con las v4–v8.
--
-- Qué resuelve: hoy el mismo PDF se manda al modelo en cada corrida, y lo que el
-- modelo leyó no queda en ningún lado (solo el resultado ya ensamblado, en
-- agent_runs.output_json). Esta tabla guarda los HECHOS CRUDOS por documento:
-- reutilizables como caché y consultables cuando una declaración sale mal.
--
-- Qué NO guarda: la clasificación Art. 260/261, ni nada relativo a "hoy". Eso se
-- recalcula determinísticamente en cada corrida. Se guarda lo que dice el papel.
--
-- Aplicar: pegar en el SQL Editor de Supabase. Es idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1. El eslabón que falta: client_documents no sabe qué contenido tiene.
--    Su identidad hoy es la RUTA, y el proyector del panel genera dos rutas
--    distintas para el mismo PDF según venga del correo o de Drive.
alter table public.client_documents
  add column if not exists sha256 text;

comment on column public.client_documents.sha256 is
  'sha256 (64 hex) de los bytes tal como están en el bucket `documentos`. Lo calcula el worker al descargar. Es la identidad de CONTENIDO del documento: dos filas con el mismo sha256 son el mismo papel aunque su storage_path difiera.';

create index if not exists client_documents_sha256_idx
  on public.client_documents (sha256) where sha256 is not null;

-- 2. Una fila por LECTURA de un documento con un propósito dado.
--    Append-only: nunca se hace UPDATE ni DELETE sobre esta tabla.
create table if not exists public.document_reads (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),

  -- QUÉ documento (identidad de contenido, no de ruta ni de cliente)
  doc_sha256        text not null,
  filename          text,

  -- QUÉ lectura: una lectura del Paso 3 NO sirve para el Paso 5. Distinto prompt,
  -- distinto esquema de salida, distintas lecciones.
  reader            text not null,
  prompt_version    text not null,
  lessons_version   text not null,
  model             text not null,
  -- Hash del contexto del caso que viaja DENTRO del prompt: la institución asignada
  -- al documento y las filas del CMF de ese banco. Sin esto, la lectura de un cliente
  -- se serviría a otro con el ancla de CMF equivocada.
  context_hash      text not null,

  -- EL RESULTADO
  status            text not null check (status in ('completed','failed')),
  facts_json        jsonb,
  error             text,
  duration_ms       integer,

  -- Trazabilidad de la corrida que la produjo (no es parte de la identidad)
  automation_job_id uuid,
  llm_calls         integer not null default 1
);

comment on table public.document_reads is
  'Append-only: una fila por cada lectura con LLM de un documento, con los hechos crudos que extrajo. Llave de reutilización = (doc_sha256, reader, prompt_version, lessons_version, model, context_hash). No lleva client_id a propósito: la lectura es propiedad del documento y su contexto, no del cliente — para saber qué se leyó de un caso se hace join contra client_documents.sha256. El consumo de tokens va aparte, en herramientas_uso.';

comment on column public.document_reads.context_hash is
  'sha256 de institución asignada + tipo de acreditación + filas del CMF de ese banco. Es lo que hace que dos clientes con el mismo PDF y el mismo contexto compartan lectura, y que con contextos distintos NO la compartan.';

comment on column public.document_reads.facts_json is
  'Hechos crudos del papel (DocFacts): doc_type, emisor, RUT del emisor, fecha de emisión, productos con monto, moneda, fecha de mora y CITA TEXTUAL. Nunca la clasificación 260/261 ni valores relativos a hoy.';

-- 3. El invariante lo garantiza la BASE, no una convención del código.
--    Mismo patrón que comercial.propuesta (`unique … where activa`): consultar la
--    lectura vigente es una igualdad, sin ORDER BY … LIMIT 1 ni desempates.
create unique index if not exists document_reads_vigente
  on public.document_reads (doc_sha256, reader, prompt_version, lessons_version, model, context_hash)
  where status = 'completed';

create index if not exists document_reads_sha_idx  on public.document_reads (doc_sha256, created_at desc);
create index if not exists document_reads_job_idx  on public.document_reads (automation_job_id) where automation_job_id is not null;

-- 4. RLS: solo service_role. Igual que las tablas del worker y que herramientas_uso.
--    RLS activa SIN policies = denegado para cualquier rol que no bypassee RLS.
alter table public.document_reads enable row level security;
revoke all on public.document_reads from anon, authenticated;

commit;

-- Verificación (correr aparte, debe devolver una fila con el índice único):
--   select indexname from pg_indexes
--    where tablename = 'document_reads' and indexname = 'document_reads_vigente';
