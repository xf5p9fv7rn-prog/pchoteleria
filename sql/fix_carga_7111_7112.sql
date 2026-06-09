-- ══════════════════════════════════════════════════════════════════
-- FIX: Cargar DANIEL MALLEA, DIEGO ZUÑIGA, TOMAS CUEVAS
--      a Habitaciones 7111 / 7112
-- ══════════════════════════════════════════════════════════════════

-- PASO 1 ▶ Ver si los 3 RUTs tienen asignaciones activas en OTRO lugar
SELECT
    a.id,
    a.id_cama,
    a.empresa_id,
    e.nombre          AS empresa,
    a.huesped_rut,
    a.huesped_nombre,
    a.fecha_checkin,
    c.habitacion_id
FROM v2_asignaciones a
LEFT JOIN v2_empresas e ON e.id = a.empresa_id
LEFT JOIN v2_camas c    ON c.id_cama = a.id_cama
WHERE a.fecha_checkout IS NULL
  AND a.huesped_rut IN (
      '17134431',  '17134431K',   -- DANIEL MALLEA
      '19601434',  '196014349',   -- DIEGO ZUÑIGA (ajusta si el rut es otro)
      '17469989',  '174699895'    -- TOMAS CUEVAS
  )
ORDER BY a.huesped_rut;

-- ══════════════════════════════════════════════════════════════════
-- PASO 2 ▶ Ver solicitudes pendientes (duplicados) de los 3 RUTs
-- ══════════════════════════════════════════════════════════════════
SELECT
    id,
    huesped_rut,
    huesped_nombre,
    habitacion_solicitada,
    estado,
    created_at
FROM v2_solicitudes          -- ajusta el nombre si la tabla es distinta
WHERE huesped_rut IN (
      '17134431', '17134431K',
      '19601434', '196014349',
      '17469989', '174699895'
  )
ORDER BY huesped_rut, created_at;

-- ══════════════════════════════════════════════════════════════════
-- PASO 3 ▶ LIMPIAR (descomenta según lo que veas en PASO 1 y 2)
-- ══════════════════════════════════════════════════════════════════
/*

-- 3a. Hacer checkout de TOMAS CUEVAS (y cualquier otro que bloquee)
--     Esto libera el RUT para poder asignarlo de nuevo
UPDATE v2_asignaciones
SET fecha_checkout = NOW()
WHERE fecha_checkout IS NULL
  AND huesped_rut IN ('17469989', '174699895')  -- TOMAS CUEVAS
  AND id_cama NOT IN (
    -- excluir si ya está correctamente en 7112 con la empresa nueva
    -- (deja este IN vacío para hacer checkout de todos)
    SELECT c.id_cama
    FROM v2_camas c
    WHERE c.habitacion_id IN (
        SELECT habitacion_id FROM v2_habitaciones WHERE numero IN ('7111','7112')
    )
  );

-- 3b. Borrar solicitudes DUPLICADAS — conserva solo la más reciente de cada RUT
DELETE FROM v2_solicitudes
WHERE id NOT IN (
    SELECT MAX(id)
    FROM v2_solicitudes
    WHERE huesped_rut IN (
        '17134431', '17134431K',
        '19601434', '196014349',
        '17469989', '174699895'
    )
    GROUP BY huesped_rut
)
AND huesped_rut IN (
    '17134431', '17134431K',
    '19601434', '196014349',
    '17469989', '174699895'
);

-- 3c. Verificar que los RUTs ya no tienen asignaciones activas bloqueantes
SELECT huesped_rut, COUNT(*) AS asig_activas
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
  AND huesped_rut IN ('17134431','17134431K','19601434','196014349','17469989','174699895')
GROUP BY huesped_rut;

*/
