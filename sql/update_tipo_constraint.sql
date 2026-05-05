-- Actualiza el CHECK constraint de v2_distribucion_camas
-- para incluir los nuevos tipos: 'anglo' y 'empresa'

-- 1. Eliminar el constraint actual
ALTER TABLE v2_distribucion_camas
  DROP CONSTRAINT IF EXISTS v2_distribucion_camas_tipo_check;

-- 2. Agregar el nuevo constraint con todos los tipos válidos
ALTER TABLE v2_distribucion_camas
  ADD CONSTRAINT v2_distribucion_camas_tipo_check
  CHECK (tipo IN ('noche', '4x3', 'reserva', 'anglo', 'empresa'));

-- 3. Agregar columna etiqueta si no existe (para tipo empresa)
ALTER TABLE v2_distribucion_camas
  ADD COLUMN IF NOT EXISTS etiqueta TEXT DEFAULT '';
