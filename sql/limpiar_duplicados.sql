-- ══════════════════════════════════════════════════════════════
-- FIX: pre_asignados que llegaron HOY → convertir a 'activa'
-- + eliminar duplicados (mismo RUT, mismas fechas, activa + pre_asig)
-- ══════════════════════════════════════════════════════════════

-- 1. Convertir pre_asignados cuya fecha_checkin <= hoy a 'activa'
UPDATE v2_asignaciones
SET estado_asignacion = 'activa'
WHERE estado_asignacion = 'pre_asignado'
  AND fecha_checkout IS NULL
  AND fecha_checkin <= CURRENT_DATE;

-- 2. Eliminar duplicados: mismo rut + misma fecha, quedarse con el de menor id
DELETE FROM v2_asignaciones
WHERE id IN (
    SELECT a.id
    FROM v2_asignaciones a
    JOIN v2_asignaciones b
        ON a.rut_huesped = b.rut_huesped
       AND a.fecha_checkin = b.fecha_checkin
       AND a.fecha_checkout IS NULL
       AND b.fecha_checkout IS NULL
       AND a.id > b.id  -- mantener el de id menor (más antiguo)
);

-- 3. Liberar camas sin asignación activa
UPDATE v2_camas SET estado = 'Disponible'
WHERE estado = 'Ocupada'
  AND NOT EXISTS (
      SELECT 1 FROM v2_asignaciones a
      WHERE a.id_cama = v2_camas.id_cama AND a.fecha_checkout IS NULL
  );

-- 4. Verificación final
SELECT
    estado_asignacion,
    COUNT(*) AS cantidad
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
GROUP BY estado_asignacion
ORDER BY estado_asignacion;
