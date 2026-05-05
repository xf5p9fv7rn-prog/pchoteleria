-- ============================================================
-- MIGRACIÓN: Agregar columna huesped_confirmo a v2_asignaciones
-- Ejecutar en Supabase → SQL Editor
-- ============================================================
ALTER TABLE v2_asignaciones
  ADD COLUMN IF NOT EXISTS huesped_confirmo boolean DEFAULT false;

-- Índice opcional para filtrar rápido
CREATE INDEX IF NOT EXISTS idx_v2_asig_confirmo
  ON v2_asignaciones (huesped_confirmo)
  WHERE fecha_checkout IS NULL;
