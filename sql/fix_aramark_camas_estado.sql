-- ============================================================
-- PASO 1: DIAGNÓSTICO — ¿Existen asignaciones de Aramark?
-- Corre esto primero para saber si los datos están en BD
-- ============================================================
SELECT
    a.nombre_huesped,
    a.id_cama,
    a.fecha_checkin,
    a.fecha_salida_programada,
    a.estado_asignacion,
    c.estado AS estado_cama,
    e.nombre AS empresa
FROM v2_asignaciones a
JOIN v2_camas c ON c.id_cama = a.id_cama
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%aramark%'
  AND a.fecha_checkout IS NULL
ORDER BY a.nombre_huesped
LIMIT 100;

-- ============================================================
-- PASO 2: FIX — Marcar camas con asignaciones activas como 'Ocupada'
-- Corre esto SI el PASO 1 devolvió filas con estado_cama = 'Disponible'
-- ============================================================
UPDATE v2_camas
SET estado = 'Ocupada'
WHERE id_cama IN (
    SELECT DISTINCT a.id_cama
    FROM v2_asignaciones a
    WHERE a.fecha_checkout IS NULL
      AND (
          a.estado_asignacion = 'activa'
          OR a.estado_asignacion IS NULL   -- compatibilidad con imports sin estado
      )
);

-- Verifica cuántas camas se actualizaron
SELECT COUNT(*) as camas_actualizadas
FROM v2_camas
WHERE estado = 'Ocupada';
