-- ══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Agregar campo 'periodo' a v2_censo_registros
-- Permite dos registros por habitación por día: uno para turno Día (antes 12:00)
-- y otro para turno Noche (después 12:00).
--
-- EJECUTAR EN SUPABASE SQL EDITOR
-- ══════════════════════════════════════════════════════════════════════════

-- PASO 1: Agregar columna periodo (si no existe)
ALTER TABLE v2_censo_registros
  ADD COLUMN IF NOT EXISTS periodo TEXT NOT NULL DEFAULT 'dia'
  CHECK (periodo IN ('dia', 'noche'));

-- PASO 2: Eliminar constraint única antigua (fecha, habitacion_id)
ALTER TABLE v2_censo_registros
  DROP CONSTRAINT IF EXISTS v2_censo_registros_habitacion_id_fecha_key;

ALTER TABLE v2_censo_registros
  DROP CONSTRAINT IF EXISTS censo_registros_unique_hab_fecha;

DROP INDEX IF EXISTS v2_censo_registros_habitacion_id_fecha_key;
DROP INDEX IF EXISTS censo_reg_unique_hab_fecha;

-- PASO 3: Crear nueva constraint única que incluye periodo
-- Esto permite 1 registro por habitación por día por período (máx 2 por día)
CREATE UNIQUE INDEX IF NOT EXISTS censo_reg_hab_fecha_periodo
  ON v2_censo_registros (habitacion_id, fecha, periodo);

-- PASO 4: Actualizar registros existentes asignando periodo según el estado guardado
-- Los estados de día van a periodo='dia', los de noche a periodo='noche'
UPDATE v2_censo_registros
  SET periodo = CASE
    WHEN estado IN ('noche', '2_noche', '3_noche') THEN 'noche'
    ELSE 'dia'
  END
WHERE periodo = 'dia';

-- VERIFICACIÓN: debe mostrar solo 'dia' y 'noche' como valores
SELECT periodo, COUNT(*) FROM v2_censo_registros GROUP BY periodo;
