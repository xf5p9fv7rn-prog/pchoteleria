-- ══════════════════════════════════════════════════════════════════
--  ACTUALIZAR CONSTRAINT: v2_censo_registros_estado_check
--  Agrega '3_dia' y '3_noche' como valores válidos para el campo estado
--  Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- 1. Eliminar el constraint existente
ALTER TABLE v2_censo_registros
    DROP CONSTRAINT IF EXISTS v2_censo_registros_estado_check;

-- 2. Crear el constraint actualizado con los nuevos valores
ALTER TABLE v2_censo_registros
    ADD CONSTRAINT v2_censo_registros_estado_check
    CHECK (estado IN (
        'sin_ocupar',
        'dia',
        'noche',
        '2_dia',
        '2_noche',
        '3_dia',
        '3_noche'
    ));

-- Verificación: debe mostrar el constraint actualizado
SELECT conname, pg_get_constraintdef(oid)
FROM   pg_constraint
WHERE  conrelid = 'v2_censo_registros'::regclass
  AND  contype  = 'c';
