-- ═══════════════════════════════════════════════════════════════════════════
--  LIMPIAR ARAMARK COMPLETO — Borrar asignaciones y liberar camas
--  Ejecutar en: Supabase Dashboard → SQL Editor
--  EFECTO: Libera todas las camas de Aramark y resetea solicitudes a pendiente
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 0: DIAGNÓSTICO PREVIO — ver qué hay de Aramark antes de borrar
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 
    'EMPRESAS Aramark' AS tipo,
    COUNT(*)::TEXT AS total
FROM v2_empresas
WHERE nombre ILIKE '%aramark%'

UNION ALL

SELECT 
    'ASIGNACIONES activas Aramark' AS tipo,
    COUNT(*)::TEXT AS total
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%aramark%'
  AND a.fecha_checkout IS NULL

UNION ALL

SELECT 
    'SOLICITUDES Aramark (todas)' AS tipo,
    COUNT(*)::TEXT AS total
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%aramark%';


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: LIBERAR CAMAS de Aramark (poner Disponible)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%aramark%'
      AND a.fecha_checkout IS NULL  -- solo asignaciones activas (sin checkout)
);


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: BORRAR ASIGNACIONES activas de Aramark
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM v2_asignaciones
WHERE empresa_id IN (
    SELECT id FROM v2_empresas WHERE nombre ILIKE '%aramark%'
)
AND fecha_checkout IS NULL;  -- solo activas, conserva el historial


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3: RESETEAR SOLICITUDES de Aramark a 'pendiente'
-- (para poder volver a cargar el Excel y reasignar)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE v2_solicitudes_b2b
SET status = 'pendiente'
WHERE empresa ILIKE '%aramark%';


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 4: RESETEAR CUPOS de Aramark a 0 ocupados
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE v2_cupos_gerencias
SET cupos_ocupados = 0
WHERE empresa ILIKE '%aramark%';


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN FINAL — confirmar que quedó limpio
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 
    'Asignaciones activas Aramark RESTANTES' AS check_item,
    COUNT(*)::TEXT AS resultado
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%aramark%'
  AND a.fecha_checkout IS NULL

UNION ALL

SELECT 
    'Solicitudes Aramark pendientes' AS check_item,
    COUNT(*)::TEXT AS resultado
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%aramark%'
  AND status = 'pendiente'

UNION ALL

SELECT 
    'Solicitudes Aramark aún aceptadas (no se resetearon)' AS check_item,
    COUNT(*)::TEXT AS resultado
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%aramark%'
  AND status = 'aceptada';
