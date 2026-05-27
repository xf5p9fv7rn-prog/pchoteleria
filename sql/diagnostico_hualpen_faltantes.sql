-- BORRAR a Samuel de la habitación 109 (R-220000005)
-- Elimina cualquier registro pre_asignado de Samuel en esa habitación

-- 1. Borrar de v2_asignaciones (cama R-220000005-C1 o C2)
DELETE FROM v2_asignaciones
WHERE id_cama LIKE 'R-220000005%'
  AND estado_asignacion = 'pre_asignado'
  AND fecha_checkout IS NULL;

-- 2. Borrar de v2_solicitudes_b2b (por si la UI lo lee desde ahí)
DELETE FROM v2_solicitudes_b2b
WHERE (rut_trabajador LIKE '%13351057%' OR nombre_trabajador ILIKE '%samuel contreras%')
  AND hab_solicitada = '109';

-- 3. Liberar la cama si quedó marcada Ocupada sin asignación
UPDATE v2_camas SET estado = 'Disponible'
WHERE id_cama LIKE 'R-220000005%'
  AND NOT EXISTS (
      SELECT 1 FROM v2_asignaciones a
      WHERE a.id_cama = v2_camas.id_cama AND a.fecha_checkout IS NULL
  );

-- 4. Verificar: Samuel debe aparecer SOLO en R-220000122-C2
SELECT id_cama, estado_asignacion, fecha_checkin
FROM v2_asignaciones
WHERE rut_huesped LIKE '%13351057%'
  AND fecha_checkout IS NULL;
