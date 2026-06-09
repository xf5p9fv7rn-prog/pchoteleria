-- ============================================================
-- MIGRACIÓN: Agregar estado 'saliente' a v2_asignaciones
-- ============================================================
-- El estado 'saliente' representa a un trabajador cuya fecha de
-- salida es HOY: es visible en la tarjeta de habitación durante
-- el día (sección SALIDA), y al día siguiente se archiva como
-- 'sin_checkout' automáticamente.
--
-- FLUJO:
--   activa (fecha_salida=hoy)  →  saliente  (visible hoy)
--   saliente (fecha_salida<hoy) →  sin_checkout + fecha_checkout (archivado)
--   pre_asignado (fecha_checkin<=hoy) →  activa (entra a ACTUALES)
-- ============================================================

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- Buscar si existe un CHECK constraint sobre estado_asignacion
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'v2_asignaciones'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%estado_asignacion%'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        -- Eliminar el constraint antiguo y recrear con 'saliente'
        EXECUTE 'ALTER TABLE v2_asignaciones DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name);
        RAISE NOTICE 'Constraint % eliminado. Recreando con saliente...', constraint_name;
    END IF;

    -- Agregar el nuevo constraint que incluye 'saliente'
    BEGIN
        ALTER TABLE v2_asignaciones
            ADD CONSTRAINT v2_asignaciones_estado_asignacion_check
            CHECK (estado_asignacion IN ('activa', 'pre_asignado', 'sin_checkout', 'saliente'));
        RAISE NOTICE 'Constraint creado correctamente con estado saliente.';
    EXCEPTION WHEN duplicate_object THEN
        RAISE NOTICE 'El constraint ya existe — no se modificó.';
    END;

END $$;

-- Verificar resultado
SELECT
    conname AS constraint_nombre,
    pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'v2_asignaciones'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%estado_asignacion%';
