-- ══════════════════════════════════════════════════════════════════
-- VACIAR HABITACIONES 7111 y 7112
-- ══════════════════════════════════════════════════════════════════

-- PASO 0 ▶ Ver columnas reales de v2_habitaciones (ejecutar primero)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name   = 'v2_habitaciones'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ══════════════════════════════════════════════════════════════════
-- PASO 1 ▶ VERIFICAR qué hay (sin depender del pk de habitaciones)
-- ══════════════════════════════════════════════════════════════════
SELECT
    c.id_cama,
    c.estado          AS estado_cama,
    c.habitacion_id,
    a.id              AS asig_id,
    a.empresa_id,
    e.nombre          AS empresa,
    a.fecha_checkin
FROM v2_camas c
LEFT JOIN v2_asignaciones a ON a.id_cama = c.id_cama
                            AND a.fecha_checkout IS NULL
LEFT JOIN v2_empresas e     ON e.id = a.empresa_id
WHERE c.habitacion_id IN (
    SELECT habitacion_id
    FROM v2_habitaciones
    WHERE numero IN ('7111', '7112')
)
ORDER BY c.habitacion_id, c.id_cama;

-- ══════════════════════════════════════════════════════════════════
-- PASO 2 ▶ VACIAR (descomenta tras revisar PASO 1)
-- ══════════════════════════════════════════════════════════════════
/*

-- 2a. Checkout de todas las asignaciones activas
UPDATE v2_asignaciones
SET fecha_checkout = NOW()
WHERE id_cama IN (
    SELECT c.id_cama
    FROM v2_camas c
    WHERE c.habitacion_id IN (
        SELECT habitacion_id
        FROM v2_habitaciones
        WHERE numero IN ('7111', '7112')
    )
)
AND fecha_checkout IS NULL;

-- 2b. Marcar camas como Disponible
UPDATE v2_camas
SET estado = 'Disponible'
WHERE habitacion_id IN (
    SELECT habitacion_id
    FROM v2_habitaciones
    WHERE numero IN ('7111', '7112')
)
AND estado <> 'Deshabilitada';

-- 2c. Verificar que quedaron limpias
SELECT
    c.habitacion_id,
    c.id_cama,
    c.estado,
    COUNT(a.id) AS asig_activas_restantes
FROM v2_camas c
LEFT JOIN v2_asignaciones a ON a.id_cama = c.id_cama
                             AND a.fecha_checkout IS NULL
WHERE c.habitacion_id IN (
    SELECT habitacion_id
    FROM v2_habitaciones
    WHERE numero IN ('7111', '7112')
)
GROUP BY c.habitacion_id, c.id_cama, c.estado
ORDER BY c.habitacion_id, c.id_cama;

*/
