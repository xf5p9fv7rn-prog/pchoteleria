BEGIN;

-- 1. Liberar las camas de vuelta a "Disponible"
UPDATE v2_camas 
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT id_cama FROM v2_asignaciones
    WHERE empresa_id IN (SELECT id FROM v2_empresas WHERE nombre ILIKE '%HUALP%N%')
    AND fecha_checkin::DATE IN ('2026-06-08', '2026-06-09', '2026-06-10')
    AND fecha_checkout IS NULL
);

-- 2. Eliminar asignaciones activas de Hualpén (esos días)
DELETE FROM v2_asignaciones
WHERE empresa_id IN (SELECT id FROM v2_empresas WHERE nombre ILIKE '%HUALP%N%')
AND fecha_checkin::DATE IN ('2026-06-08', '2026-06-09', '2026-06-10')
AND fecha_checkout IS NULL;

-- 3. Eliminar solicitudes/cargas pendientes
DELETE FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%HUALP%N%'
AND fecha_llegada::DATE IN ('2026-06-08', '2026-06-09', '2026-06-10');

COMMIT;
