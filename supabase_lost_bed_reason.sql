-- ============================================================
-- SUPABASE: Agregar columna lostBedReason a tabla rooms
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Esto permite que Constanza vea el motivo de las camas perdidas
-- ============================================================

-- Si la tabla rooms tiene un schema estricto, agregar la columna:
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "lostBedReason" TEXT;

-- También asegurarse que la tabla gerencia_quotas permite lectura pública
-- (necesario para que Constanza cargue los cupos)
CREATE POLICY IF NOT EXISTS "quotas_anon_select"
    ON gerencia_quotas FOR SELECT
    TO anon USING (true);
