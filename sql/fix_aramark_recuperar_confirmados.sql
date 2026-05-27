-- ============================================================
-- ARAMARK — RECUPERACIÓN SELECTIVA
-- Mantiene confirmados (verde), limpia los no confirmados
-- para que puedas volver a cargar el Excel con fechas correctas
-- ============================================================

-- ── PASO 1: VER quiénes SÍ confirmaron (no se tocarán) ──────
-- Ejecuta esto primero para ver el listado de los que quedan
SELECT
    a.nombre_huesped,
    a.rut_huesped,
    a.id_cama,
    a.fecha_checkin,
    a.fecha_salida_programada,
    a.huesped_confirmo,
    c.estado AS estado_cama
FROM v2_asignaciones a
JOIN v2_camas c ON c.id_cama = a.id_cama
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%aramark%'
  AND a.fecha_checkout IS NULL
  AND a.huesped_confirmo = true
ORDER BY a.nombre_huesped;


-- ── PASO 2: LIMPIAR solo los NO confirmados de Aramark ───────
-- Elimina asignaciones Aramark sin check-in confirmado
DELETE FROM v2_asignaciones
WHERE id IN (
    SELECT a.id
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%aramark%'
      AND a.fecha_checkout IS NULL
      AND (a.huesped_confirmo IS NULL OR a.huesped_confirmo = false)
);


-- ── PASO 3: LIBERAR camas de no-confirmados ──────────────────
-- Marca como Disponible las camas que ya no tienen asignación activa
UPDATE v2_camas
SET estado = 'Disponible'
WHERE estado = 'Ocupada'
  AND id_cama NOT IN (
      SELECT DISTINCT id_cama
      FROM v2_asignaciones
      WHERE fecha_checkout IS NULL
        AND (estado_asignacion = 'activa' OR estado_asignacion IS NULL)
  );


-- ── PASO 4: ASEGURAR verde para los confirmados ──────────────
-- Los que sí confirmaron deben quedar con cama en 'Ocupada'
UPDATE v2_camas
SET estado = 'Ocupada'
WHERE id_cama IN (
    SELECT DISTINCT a.id_cama
    FROM v2_asignaciones a
    WHERE a.fecha_checkout IS NULL
      AND a.huesped_confirmo = true
);


-- ── VERIFICACIÓN FINAL ───────────────────────────────────────
SELECT
    a.nombre_huesped,
    a.id_cama,
    a.fecha_checkin,
    c.estado AS estado_cama,
    a.huesped_confirmo
FROM v2_asignaciones a
JOIN v2_camas c ON c.id_cama = a.id_cama
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%aramark%'
  AND a.fecha_checkout IS NULL
ORDER BY a.nombre_huesped;
