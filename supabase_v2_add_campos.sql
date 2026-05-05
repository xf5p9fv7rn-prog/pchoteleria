-- ═══════════════════════════════════════════════════════════════
--  Agregar campos adicionales a v2_asignaciones
--  Ejecutar en Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE v2_asignaciones
  ADD COLUMN IF NOT EXISTS numero_contrato  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS telefono         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS fecha_salida_programada DATE;

-- Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'v2_asignaciones'
ORDER BY ordinal_position;
