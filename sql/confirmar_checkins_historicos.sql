-- ══════════════════════════════════════════════════════════════════════════
-- FIX MASIVO: Marcar como confirmados todos los check-ins activos históricos
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════
-- Problema: Los check-ins hechos antes de implementar el botón
--           "Confirmar Llegada" quedaron con huesped_confirmo = false.
-- Solución: Marcar como confirmados todos los que tienen fecha_checkin < hoy
-- ══════════════════════════════════════════════════════════════════════════

-- PASO 1: Ver cuántos registros serán actualizados (preview)
SELECT COUNT(*) AS total_a_confirmar,
       MIN(fecha_checkin) AS check_in_mas_antiguo,
       MAX(fecha_checkin) AS check_in_mas_reciente
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
  AND (huesped_confirmo IS NULL OR huesped_confirmo = false)
  AND fecha_checkin < CURRENT_DATE;

-- PASO 2: Ejecutar la actualización masiva
UPDATE v2_asignaciones
SET huesped_confirmo = true
WHERE fecha_checkout IS NULL
  AND (huesped_confirmo IS NULL OR huesped_confirmo = false)
  AND fecha_checkin < CURRENT_DATE;

-- Resultado esperado: todos los residentes que ingresaron antes de hoy
-- quedarán marcados como confirmados → botones VERDES en el mapa

-- PASO 3: Verificación post-update
SELECT
    estado_asignacion,
    huesped_confirmo,
    COUNT(*) as total
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
GROUP BY estado_asignacion, huesped_confirmo
ORDER BY estado_asignacion, huesped_confirmo;
