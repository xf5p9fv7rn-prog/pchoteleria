-- ============================================================
-- BORRADO TOTAL ROCMIN - Correr en Supabase SQL Editor
-- https://app.supabase.com → SQL Editor
-- ============================================================

-- 1. Ver cuántos registros hay antes de borrar
SELECT 
    'v2_solicitudes_b2b' as tabla,
    COUNT(*) as total
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%rocmin%'

UNION ALL

SELECT 
    'v2_asignaciones (sin checkout)' as tabla,
    COUNT(*) as total
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%rocmin%'
  AND a.fecha_checkout IS NULL;

-- ============================================================
-- 2. Liberar camas de ROCMIN (activas + pre-asignadas)
-- ============================================================
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%rocmin%'
      AND a.fecha_checkout IS NULL
)
AND estado != 'Deshabilitada';

-- ============================================================
-- 3. Hacer checkout de todas las asignaciones de ROCMIN
-- ============================================================
UPDATE v2_asignaciones
SET 
    fecha_checkout = GREATEST(NOW(), fecha_checkin),
    estado_asignacion = 'sin_checkout'
WHERE empresa_id IN (
    SELECT id FROM v2_empresas WHERE nombre ILIKE '%rocmin%'
)
AND fecha_checkout IS NULL;

-- ============================================================
-- 4. Limpiar v2_camas_perdidas de habitaciones ROCMIN
-- ============================================================
DELETE FROM v2_camas_perdidas
WHERE habitacion_id IN (
    SELECT DISTINCT c.habitacion_id
    FROM v2_camas c
    WHERE c.id_cama IN (
        SELECT a.id_cama
        FROM v2_asignaciones a
        JOIN v2_empresas e ON e.id = a.empresa_id
        WHERE e.nombre ILIKE '%rocmin%'
    )
    AND c.habitacion_id IS NOT NULL
);

-- ============================================================
-- 5. BORRAR TODAS las solicitudes de ROCMIN
-- ============================================================
DELETE FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%rocmin%';

-- ============================================================
-- 6. Verificación final
-- ============================================================
SELECT 
    'Solicitudes restantes' as check,
    COUNT(*) as total
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%rocmin%'

UNION ALL

SELECT 
    'Asignaciones activas restantes',
    COUNT(*)
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%rocmin%'
  AND a.fecha_checkout IS NULL;
-- Si ambas muestran 0 → ROCMIN completamente eliminado ✅
