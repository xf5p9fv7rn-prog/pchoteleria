-- ============================================================
-- SUPABASE: Permitir escritura pública en la tabla census
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Necesario para que el Portal Censo Terreno (móviles sin login)
-- pueda guardar datos en la nube.
-- ============================================================

-- 1. Agregar columna "id" compuesto si no existe (para upsert)
ALTER TABLE census ADD COLUMN IF NOT EXISTS id TEXT;
UPDATE census SET id = CONCAT(CAST("roomId" AS TEXT), '_', date) WHERE id IS NULL;

-- 2. Asegurarse de que la columna id sea PRIMARY KEY o UNIQUE
ALTER TABLE census ADD CONSTRAINT IF NOT EXISTS census_id_unique UNIQUE (id);

-- 3. Dar permisos de lectura pública (anon) a la tabla census
CREATE POLICY IF NOT EXISTS "census_select_public"
  ON census FOR SELECT
  TO anon
  USING (true);

-- 4. Dar permisos de INSERT/UPDATE público (anon) para el portal terreno
CREATE POLICY IF NOT EXISTS "census_insert_public"
  ON census FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "census_update_public"
  ON census FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 5. También asegurarse que buildings y rooms son legibles sin login
CREATE POLICY IF NOT EXISTS "buildings_select_public"
  ON buildings FOR SELECT
  TO anon
  USING (true);

CREATE POLICY IF NOT EXISTS "rooms_select_public"
  ON rooms FOR SELECT
  TO anon
  USING (true);
