-- ═══════════════════════════════════════════════════════════════
-- LIMPIEZA SELECTIVA: Hualpén — solo registros "por llegar"
-- Fecha de ejecución: 2026-05-25
-- QUÉ HACE:
--   1. Muestra preview de lo que se borrará (solo lectura)
--   2. Libera las camas que estaban PreAsignadas/Ocupadas
--   3. Borra asignaciones futuras de Hualpén
--   4. Borra solicitudes futuras de Hualpén (pendientes y duplicadas)
-- QUÉ NO TOCA:
--   ✅ Aramark (activos)
--   ✅ Artículos de Seguridad Wilug (activos)
--   ✅ Cualquier empresa que NO sea Hualpén
--   ✅ Personas ya en campamento (fecha_llegada < hoy)
-- ═══════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════
-- PASO 0 — SOLO LECTURA: Ver qué se borrará
-- Ejecuta esto primero para verificar
-- ══════════════════════════════════════════
SELECT
    'SOLICITUDES A BORRAR' AS tabla,
    empresa,
    status,
    COUNT(*) AS registros,
    MIN(fecha_llegada) AS desde,
    MAX(fecha_salida) AS hasta
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%hualpen%'
  AND fecha_llegada >= CURRENT_DATE
GROUP BY empresa, status
ORDER BY empresa, status;


-- ══════════════════════════════════════════
-- PASO 1 — Liberar camas de Hualpén futuras
-- ══════════════════════════════════════════
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT DISTINCT a.id_cama
    FROM v2_asignaciones a
    WHERE a.rut_huesped IN (
        SELECT rut_trabajador
        FROM v2_solicitudes_b2b
        WHERE empresa ILIKE '%hualpen%'
          AND fecha_llegada >= CURRENT_DATE
    )
);


-- ══════════════════════════════════════════
-- PASO 2 — Borrar asignaciones futuras de Hualpén
-- ══════════════════════════════════════════
DELETE FROM v2_asignaciones
WHERE rut_huesped IN (
    SELECT rut_trabajador
    FROM v2_solicitudes_b2b
    WHERE empresa ILIKE '%hualpen%'
      AND fecha_llegada >= CURRENT_DATE
);


-- ══════════════════════════════════════════
-- PASO 3 — Borrar solicitudes futuras de Hualpén
--           (borra TODOS los status: pendiente, aceptada, rechazada)
--           Solo las con fecha_llegada >= hoy
-- ══════════════════════════════════════════
DELETE FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%hualpen%'
  AND fecha_llegada >= CURRENT_DATE;


-- ══════════════════════════════════════════
-- VERIFICACIÓN FINAL
-- ══════════════════════════════════════════
SELECT
    empresa,
    status,
    COUNT(*) AS registros_restantes
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%hualpen%'
GROUP BY empresa, status
ORDER BY empresa, status;
