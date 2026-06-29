-- migration_sandbox_v7.sql
-- Columna `nombres_alternativos` en acreedores_canonicos (catálogo del SANDBOX `fnz…`).
--
-- ⚠️ Aplicar SOLO en el SQL Editor del proyecto SANDBOX (fnz…). NUNCA en prod (ton…).
--    DDL no se puede correr por REST/Claude → pegar este archivo en el SQL Editor.
--
-- Objetivo: que un acreedor tenga UN nombre canónico + el RUT como llave dura, y que
-- las VARIANTES con que aparece en el CMF / certificados vivan como DATO (no en código).
-- El matcher (acreedor_matcher.ts) leerá esta columna para resolver nombres del CMF/cert
-- al RUT correcto, sin depender de aliases hardcodeados.

ALTER TABLE acreedores_canonicos
  ADD COLUMN IF NOT EXISTS nombres_alternativos text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN acreedores_canonicos.nombres_alternativos IS
  'Variantes del nombre como aparecen en el Informe CMF y en los certificados de los bancos. Sirven para matchear esos documentos contra este acreedor. La identidad real/llave dura es el RUT. Se alimenta desde docs/acreedores-crosswalk.md a medida que aparecen nuevas variantes.';

-- ── Seed inicial (caso de prueba R.A.R.D.) — variantes verificadas ──────────────
-- RUTs: CCAF verificado en el propio certificado (81.826.800-9). Tenpo y Santander
-- Consumer = RUT del catálogo del abogado (autoritativo); el cert no imprime el RUT
-- del emisor. La fila/RUT ya existen en el catálogo → solo agregamos la variante CMF.

-- Tenpo: CMF dice "Tenpo Payments S.A." · catálogo "Tenpo Prepago SA" (RUT 76967692-9)
UPDATE acreedores_canonicos
   SET nombres_alternativos = ARRAY['Tenpo Payments S.A.', 'Tenpo Payments']
 WHERE nombre = 'Tenpo Prepago SA';

-- Santander Consumer: CMF dice "Santander Consumer Finance Limitada" · catálogo
-- "Santander Consumer Chile S.A." (RUT 76.002.293-4)
UPDATE acreedores_canonicos
   SET nombres_alternativos = ARRAY['Santander Consumer Finance Limitada', 'Santander Consumer Finance']
 WHERE nombre = 'Santander Consumer Chile S.A.';

-- CCAF Los Andes: CMF usa la forma larga (RUT 81.826.800-9, verificado en el cert)
UPDATE acreedores_canonicos
   SET nombres_alternativos = ARRAY['Caja de Compensación de Asignación Familiar Los Andes', 'Caja Los Andes']
 WHERE nombre = 'CCAF Los Andes';

-- Verificación (opcional, correr aparte):
-- SELECT nombre, rut, nombres_alternativos FROM acreedores_canonicos
--  WHERE nombre IN ('Tenpo Prepago SA','Santander Consumer Chile S.A.','CCAF Los Andes');
