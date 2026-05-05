-- ============================================================
-- PARCHE: Completar fechas faltantes en v2_asignaciones
-- Copia fecha_llegada y fecha_salida desde v2_solicitudes_b2b
-- para los registros que tienen fechas null
-- ============================================================

-- 1. Actualizar fecha_checkin y fecha_salida_programada donde son nulos
UPDATE v2_asignaciones a
SET
  fecha_checkin           = COALESCE(a.fecha_checkin,           s.fecha_llegada),
  fecha_salida_programada = COALESCE(a.fecha_salida_programada, s.fecha_salida)
FROM v2_solicitudes_b2b s
WHERE s.rut_trabajador = a.rut_huesped
  AND (a.fecha_checkin IS NULL OR a.fecha_salida_programada IS NULL)
  AND a.fecha_checkout IS NULL;  -- solo asignaciones activas

-- 2. Ver resultado
SELECT id, rut_huesped, fecha_checkin, fecha_salida_programada
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
ORDER BY fecha_checkin DESC
LIMIT 20;
