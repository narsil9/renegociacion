-- 2026-07-30 — Un solo almacén de alias de acreedores.
-- Hoy: app_config['acreedores.alias'] (29 alias humanos, lo lee el dashboard) vs
-- acreedores_canonicos.nombres_alternativos (3 filas de 507, lo lee el worker).
-- El worker NUNCA lee app_config → 8 alias fallan de verdad, 2 de ellos por el duplicado
-- de catálogo de Hites. Simulado: tras el backfill, 29/29 resuelven y 0 colisiones.
--
-- Los alias se copian TAL CUAL están en app_config: el worker los renormaliza al cargar el
-- catálogo (stripCreditTypeTokens(normalizeText(a)) en acreedor_matcher.ts:280-282), así que
-- el formato guardado no importa.
--
-- Verificado antes de aplicar (2026-07-30): los 29 alias apuntan a un canónico ACTIVO,
-- ninguno a una fila inexistente o inactiva.

BEGIN;

-- 1. El duplicado que genera `ambiguous` en cualquier variante corta del nombre.
--    Se desactiva la fila 500 y se conserva la 23 (la que apunta el alias humano).
--    Medido: 0 filas de client_documents nombran a Hites, así que nada queda huérfano.
UPDATE public.acreedores_canonicos SET activo = false WHERE id = 500;

-- 2. Backfill de los 29 alias humanos, agrupados por canónico destino.
--    `array_agg(distinct …)` es idempotente: re-correr la migración no duplica entradas.
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['car s.a.','car - ripley']) x)
  WHERE id = 3;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['cat administradora de tarjetas s.a.']) x)
  WHERE id = 9;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['cofisa (abcdin-adretail)','creditos organizacion y finanzas s. a.']) x)
  WHERE id = 11;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['inversiones y tarjetas s.a.']) x)
  WHERE id = 23;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['inversiones kimco s.a.']) x)
  WHERE id = 32;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['matic kard s.a.']) x)
  WHERE id = 36;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['presto lider','operadora de tarjetas lider servicios financieros s.a.','servicios financieros y administracion de creditos comerciales s.a.']) x)
  WHERE id = 45;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['cmr falabella']) x)
  WHERE id = 47;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['solventa tarjetas','solventa tarjetas s.a.']) x)
  WHERE id = 55;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['forum s.a.']) x)
  WHERE id = 67;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['santander consumer finance limitada']) x)
  WHERE id = 75;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['coopeuch','cooperativa de ahorro y credito coopeuch']) x)
  WHERE id = 337;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['bice']) x)
  WHERE id = 475;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['de credito e inversiones']) x)
  WHERE id = 479;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['banco del estado de chile']) x)
  WHERE id = 481;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['falabella']) x)
  WHERE id = 482;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['santander-chile','banco santander-chile']) x)
  WHERE id = 488;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['tenpo payments s.a.']) x)
  WHERE id = 489;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['scotiabank chile']) x)
  WHERE id = 490;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['compania de seguros de vida consorcio nacional de seguros s.a.; cias. de seguros de vida']) x)
  WHERE id = 506;

-- 3. Las CCAF: sus nombres canónicos son abreviados ("CCAF La Araucana") y el CMF imprime el
--    nombre legal largo. `canonicalInstitutionKey` NO tiene el regex caja→ccaf que sí tiene
--    `matchAcreedor`, así que sin estos alias el matching documento↔fila del CMF depende de
--    coincidencia textual. Las 5 CCAF activas del catálogo (308-312).
--
--    Se cargan las DOS grafías del nombre legal, con y sin el "de" antes del nombre propio
--    ("… Familiar de Los Andes" y "… Familiar Los Andes"): las dos aparecen en la práctica y
--    normalizan a claves DISTINTAS, así que una sola no alcanza. Medido: con solo la variante
--    sin "de", `canonicalInstitutionKey('…Familiar de La Araucana') !== canonicalInstitutionKey('CCAF La Araucana')`.
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['caja de compensacion de asignacion familiar 18 de septiembre','caja de compensacion de asignacion familiar de 18 de septiembre']) x)
  WHERE id = 308;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['caja de compensacion de asignacion familiar gabriela mistral','caja de compensacion de asignacion familiar de gabriela mistral']) x)
  WHERE id = 309;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['caja de compensacion de asignacion familiar la araucana','caja de compensacion de asignacion familiar de la araucana']) x)
  WHERE id = 310;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['caja de compensacion de asignacion familiar los andes','caja de compensacion de asignacion familiar de los andes']) x)
  WHERE id = 311;
UPDATE public.acreedores_canonicos SET nombres_alternativos =
  (select array_agg(distinct x) from unnest(nombres_alternativos || ARRAY['caja de compensacion de asignacion familiar los heroes','caja de compensacion de asignacion familiar de los heroes']) x)
  WHERE id = 312;

COMMIT;
