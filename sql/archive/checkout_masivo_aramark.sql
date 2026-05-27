-- ============================================================
-- PASO 0: DIAGNÓSTICO — Verificar cuántos trabajadores de Aramark
--         tienen asignación activa ANTES de ejecutar nada
-- ============================================================
SELECT 
    COUNT(*) AS total_asignaciones_activas,
    e.nombre AS empresa
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE a.fecha_checkout IS NULL
  AND e.nombre ILIKE '%aramark%'
GROUP BY e.nombre;

-- ============================================================
-- PASO 1: Identificar las camas afectadas (solo para revisar)
-- ============================================================
SELECT a.id_cama, a.nombre_huesped, e.nombre AS empresa, a.fecha_checkin
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE a.fecha_checkout IS NULL
  AND e.nombre ILIKE '%aramark%'
ORDER BY a.id_cama;

-- ============================================================
-- PASO 2: Liberar las camas en v2_camas (solo campo 'estado')
-- ============================================================
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE a.fecha_checkout IS NULL
      AND e.nombre ILIKE '%aramark%'
);

-- ============================================================
-- PASO 3: Cerrar las asignaciones de Aramark
-- ============================================================
UPDATE v2_asignaciones
SET fecha_checkout = NOW()
WHERE fecha_checkout IS NULL
  AND empresa_id IN (
    SELECT id FROM v2_empresas
    WHERE nombre ILIKE '%aramark%'
  );

-- ============================================================
-- PASO 4: Verificar resultado final
-- ============================================================
SELECT COUNT(*) AS camas_liberadas
FROM v2_camas
WHERE estado = 'Disponible'
  AND id_cama NOT IN (
    SELECT id_cama FROM v2_asignaciones WHERE fecha_checkout IS NULL
  );
