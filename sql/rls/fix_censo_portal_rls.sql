-- ══════════════════════════════════════════════════════════════
-- FIX: Permitir lectura anónima para el Portal Censo Terreno
-- El portal usa la anon key de Supabase (sin login de usuario)
-- ══════════════════════════════════════════════════════════════

-- 1. Edificios (para el selector de edificio)
DROP POLICY IF EXISTS "censo_portal_read_edificios" ON v2_edificios;
CREATE POLICY "censo_portal_read_edificios"
  ON v2_edificios FOR SELECT
  TO anon
  USING (true);

-- 2. Pabellones (para el selector de pabellón)
DROP POLICY IF EXISTS "censo_portal_read_pabellones" ON v2_pabellones;
CREATE POLICY "censo_portal_read_pabellones"
  ON v2_pabellones FOR SELECT
  TO anon
  USING (true);

-- 3. Habitaciones (para cargar las habitaciones del piso)
DROP POLICY IF EXISTS "censo_portal_read_habitaciones" ON v2_habitaciones;
CREATE POLICY "censo_portal_read_habitaciones"
  ON v2_habitaciones FOR SELECT
  TO anon
  USING (true);

-- 4. Asignaciones — solo lectura de campos no sensibles (sin nombre ni RUT)
--    El portal solo necesita fecha_salida_programada y cama_id para las bajadas
DROP POLICY IF EXISTS "censo_portal_read_asignaciones" ON v2_asignaciones;
CREATE POLICY "censo_portal_read_asignaciones"
  ON v2_asignaciones FOR SELECT
  TO anon
  USING (fecha_checkout IS NULL);  -- solo asignaciones activas

-- 5. Censo registros — lectura y escritura para el personal de censo
DROP POLICY IF EXISTS "censo_portal_read_censo" ON v2_censo_registros;
CREATE POLICY "censo_portal_read_censo"
  ON v2_censo_registros FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "censo_portal_write_censo" ON v2_censo_registros;
CREATE POLICY "censo_portal_write_censo"
  ON v2_censo_registros FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "censo_portal_upsert_censo" ON v2_censo_registros;
CREATE POLICY "censo_portal_upsert_censo"
  ON v2_censo_registros FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
