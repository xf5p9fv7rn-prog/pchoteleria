-- ══════════════════════════════════════════════════════════════
-- CONVERSIÓN NOCTURNA: pre_asignado → activa
-- Se ejecuta automáticamente a las 00:00:01 de cada día.
-- Convierte SOLO los registros cuya fecha_checkin = HOY.
-- ══════════════════════════════════════════════════════════════

-- 1. Convertir pre_asignados cuya fecha_checkin = hoy → activa
UPDATE v2_asignaciones
SET estado_asignacion = 'activa'
WHERE estado_asignacion = 'pre_asignado'
  AND fecha_checkout IS NULL
  AND fecha_checkin = CURRENT_DATE;

-- 2. Liberar camas sin asignación activa (limpieza de fantasmas)
UPDATE v2_camas SET estado = 'Disponible'
WHERE estado = 'Ocupada'
  AND NOT EXISTS (
      SELECT 1 FROM v2_asignaciones a
      WHERE a.id_cama = v2_camas.id_cama AND a.fecha_checkout IS NULL
  );

-- 3. Verificación
SELECT
    estado_asignacion,
    COUNT(*) AS cantidad
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
GROUP BY estado_asignacion
ORDER BY estado_asignacion;
