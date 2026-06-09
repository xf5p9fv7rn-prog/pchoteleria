-- ══════════════════════════════════════════════════════════════════
-- MOVER TOMAS CUEVAS (174699895) → Habitación 7111
-- ══════════════════════════════════════════════════════════════════

-- PASO 1 ▶ Verificar: asignación actual de TOMAS + camas libres en 7111
SELECT
    'Asig. actual de TOMAS' AS info,
    a.id                    AS asig_id,
    a.id_cama               AS cama_actual,
    a.empresa_id,
    e.nombre                AS empresa,
    a.huesped_rut
FROM v2_asignaciones a
LEFT JOIN v2_empresas e ON e.id = a.empresa_id
WHERE a.fecha_checkout IS NULL
  AND a.huesped_rut IN ('174699895','17469989','174699895K')

UNION ALL

SELECT
    'Cama libre en 7111' AS info,
    NULL,
    c.id_cama,
    NULL,
    NULL,
    NULL
FROM v2_camas c
WHERE c.habitacion_id = (
    SELECT habitacion_id FROM v2_habitaciones WHERE numero = '7111' LIMIT 1
)
AND c.estado <> 'Deshabilitada'
AND c.id_cama NOT IN (
    SELECT id_cama FROM v2_asignaciones WHERE fecha_checkout IS NULL
)
LIMIT 3;

-- ══════════════════════════════════════════════════════════════════
-- PASO 2 ▶ MOVER: actualiza id_cama al primer lugar libre en 7111
--           Descomenta tras revisar el PASO 1
-- ══════════════════════════════════════════════════════════════════
/*

UPDATE v2_asignaciones
SET id_cama = (
    -- Primera cama libre en habitación 7111
    SELECT c.id_cama
    FROM v2_camas c
    WHERE c.habitacion_id = (
        SELECT habitacion_id FROM v2_habitaciones WHERE numero = '7111' LIMIT 1
    )
    AND c.estado <> 'Deshabilitada'
    AND c.id_cama NOT IN (
        SELECT id_cama FROM v2_asignaciones WHERE fecha_checkout IS NULL
    )
    ORDER BY c.id_cama
    LIMIT 1
)
WHERE fecha_checkout IS NULL
  AND huesped_rut IN ('174699895', '17469989', '174699895K');

-- Verificar resultado
SELECT
    a.id,
    a.id_cama,
    a.huesped_rut,
    a.huesped_nombre,
    h.numero AS habitacion_nueva
FROM v2_asignaciones a
JOIN v2_camas c         ON c.id_cama = a.id_cama
JOIN v2_habitaciones h  ON h.habitacion_id = c.habitacion_id
WHERE a.fecha_checkout IS NULL
  AND a.huesped_rut IN ('174699895', '17469989', '174699895K');

*/
