-- ══════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO: Asignaciones activas SIN empresa_id
-- Objetivo: identificar de dónde vienen y qué empresa asignarles
-- ══════════════════════════════════════════════════════════════════

-- PASO 1: Ver cuántas hay y qué camas son
SELECT 
    a.id,
    a.id_cama,
    c.estado          AS estado_cama,
    c.habitacion_id,
    h.numero          AS habitacion_numero,
    h.pabellon,
    a.fecha_checkin,
    a.fecha_salida_programada
FROM v2_asignaciones a
LEFT JOIN v2_camas c        ON c.id_cama = a.id_cama
LEFT JOIN v2_habitaciones h ON h.id = c.habitacion_id
WHERE a.fecha_checkout IS NULL
  AND a.empresa_id IS NULL
ORDER BY h.pabellon, h.numero
LIMIT 200;

-- ══════════════════════════════════════════════════════════════════
-- PASO 2: Ver si esas mismas habitaciones tienen OTRAS camas
--         asignadas con empresa → inferir la empresa correcta
-- ══════════════════════════════════════════════════════════════════

SELECT
    a_sin.id                                  AS asig_sin_empresa,
    a_sin.id_cama                             AS cama_sin_empresa,
    h.numero                                  AS habitacion,
    h.pabellon,
    a_con.empresa_id                          AS empresa_inferida,
    e.nombre                                  AS nombre_empresa
FROM v2_asignaciones a_sin
LEFT JOIN v2_camas c         ON c.id_cama = a_sin.id_cama
LEFT JOIN v2_habitaciones h  ON h.id = c.habitacion_id
-- buscar compañeros de habitación que SÍ tienen empresa
LEFT JOIN v2_camas c2        ON c2.habitacion_id = c.habitacion_id
                              AND c2.id_cama <> a_sin.id_cama
LEFT JOIN v2_asignaciones a_con ON a_con.id_cama = c2.id_cama
                                 AND a_con.fecha_checkout IS NULL
                                 AND a_con.empresa_id IS NOT NULL
LEFT JOIN v2_empresas e      ON e.id = a_con.empresa_id
WHERE a_sin.fecha_checkout IS NULL
  AND a_sin.empresa_id IS NULL
ORDER BY h.pabellon, h.numero
LIMIT 200;

-- ══════════════════════════════════════════════════════════════════
-- PASO 3 (ejecutar DESPUÉS de revisar los resultados):
-- UPDATE automático: asigna la empresa del compañero de habitación
-- ══════════════════════════════════════════════════════════════════
/*  ← Descomenta esto solo cuando estés seguro

UPDATE v2_asignaciones a_sin
SET empresa_id = (
    SELECT a_con.empresa_id
    FROM v2_camas c
    JOIN v2_camas c2         ON c2.habitacion_id = c.habitacion_id
                              AND c2.id_cama <> a_sin.id_cama
    JOIN v2_asignaciones a_con ON a_con.id_cama = c2.id_cama
                               AND a_con.fecha_checkout IS NULL
                               AND a_con.empresa_id IS NOT NULL
    WHERE c.id_cama = a_sin.id_cama
    LIMIT 1
)
WHERE a_sin.fecha_checkout IS NULL
  AND a_sin.empresa_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM v2_camas c
    JOIN v2_camas c2         ON c2.habitacion_id = c.habitacion_id
                              AND c2.id_cama <> a_sin.id_cama
    JOIN v2_asignaciones a_con ON a_con.id_cama = c2.id_cama
                               AND a_con.fecha_checkout IS NULL
                               AND a_con.empresa_id IS NOT NULL
    WHERE c.id_cama = a_sin.id_cama
  );

-- Verificar cuántos quedaron sin empresa después del UPDATE:
SELECT COUNT(*) AS sin_empresa_restantes
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
  AND empresa_id IS NULL;

*/
