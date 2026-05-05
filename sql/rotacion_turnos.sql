-- ================================================================
--  MIGRACIÓN: Sistema de Rotación de Turno
--  Ejecutar en Supabase SQL Editor
-- ================================================================

-- 1. Agregar columna de estado
ALTER TABLE v2_asignaciones
  ADD COLUMN IF NOT EXISTS estado_asignacion TEXT DEFAULT 'activa';

-- 2. Agregar flag de auto-checkout
ALTER TABLE v2_asignaciones
  ADD COLUMN IF NOT EXISTS auto_checkout BOOLEAN DEFAULT FALSE;

-- 3. Restricción de valores válidos
ALTER TABLE v2_asignaciones
  DROP CONSTRAINT IF EXISTS v2_asig_estado_check;
ALTER TABLE v2_asignaciones
  ADD CONSTRAINT v2_asig_estado_check
    CHECK (estado_asignacion IN ('activa','pre_asignado','completada','sin_checkout'));

-- 4. Índice de performance para rotaciones
CREATE INDEX IF NOT EXISTS idx_v2_asig_rotacion
  ON v2_asignaciones(id_cama, estado_asignacion)
  WHERE fecha_checkout IS NULL;

CREATE INDEX IF NOT EXISTS idx_v2_asig_salida_prog
  ON v2_asignaciones(fecha_salida_programada)
  WHERE fecha_checkout IS NULL;

-- 5. Normalizar datos existentes (todos 'activa' por defecto)
UPDATE v2_asignaciones
  SET estado_asignacion = 'activa'
  WHERE estado_asignacion IS NULL AND fecha_checkout IS NULL;

UPDATE v2_asignaciones
  SET estado_asignacion = 'completada'
  WHERE estado_asignacion IS NULL AND fecha_checkout IS NOT NULL;

-- ================================================================
--  VISTA: rotaciones pendientes de hoy
-- ================================================================
CREATE OR REPLACE VIEW v2_rotaciones_hoy AS
SELECT
  a.id,
  a.id_cama,
  a.nombre_huesped,
  a.rut_huesped,
  a.fecha_salida_programada,
  a.fecha_checkin,
  a.estado_asignacion,
  a.auto_checkout,
  e.nombre AS empresa
FROM v2_asignaciones a
LEFT JOIN v2_empresas e ON e.id = a.empresa_id
WHERE a.fecha_checkout IS NULL
  AND a.estado_asignacion IN ('activa','sin_checkout')
  AND a.fecha_salida_programada <= CURRENT_DATE
ORDER BY a.fecha_salida_programada;
