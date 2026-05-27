-- ============================================================
-- LIMPIAR ARAMARK — Vacía todas las asignaciones activas
-- y libera las camas para nueva carga con fechas correctas
-- ============================================================

-- PASO 1: Liberar camas ocupadas por Aramark → 'Disponible'
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT DISTINCT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%aramark%'
      AND a.fecha_checkout IS NULL
);

-- PASO 2: Eliminar asignaciones activas de Aramark
DELETE FROM v2_asignaciones
WHERE id IN (
    SELECT a.id
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%aramark%'
      AND a.fecha_checkout IS NULL
);

-- PASO 3: Eliminar solicitudes b2b de Aramark (para poder recargar)
UPDATE v2_solicitudes_b2b
SET status = 'pendiente'
WHERE empresa_id IN (
    SELECT id FROM v2_empresas WHERE nombre ILIKE '%aramark%'
);

-- VERIFICACIÓN: debe devolver 0
SELECT COUNT(*) AS asignaciones_aramark_activas
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%aramark%'
  AND a.fecha_checkout IS NULL;
