-- ============================================================
-- LIMPIEZA COMPLETA LOGÍSTICA HUALPÉN
-- Ejecutar en Supabase SQL Editor
-- Fecha: 2026-06-02
-- ============================================================

-- PASO 1: Ver cuántos registros hay (verificación previa)
SELECT 
    'ASIGNACIONES' as tabla,
    COUNT(*) as total
FROM v2_asignaciones a
WHERE a.empresa_id = (SELECT id FROM v2_empresas WHERE nombre ILIKE '%hualp%' LIMIT 1)
  AND a.fecha_checkout IS NULL

UNION ALL

SELECT 
    'SOLICITUDES' as tabla,
    COUNT(*) as total
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%hualp%'
  AND status IN ('aceptada', 'aceptada_asignada', 'pendiente');

-- ──────────────────────────────────────────────────────────────
-- PASO 2: Liberar camas de Hualpén
-- ──────────────────────────────────────────────────────────────
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT a.id_cama
    FROM v2_asignaciones a
    WHERE a.empresa_id = (SELECT id FROM v2_empresas WHERE nombre ILIKE '%hualp%' LIMIT 1)
      AND a.fecha_checkout IS NULL
      AND a.id_cama IS NOT NULL
);

-- ──────────────────────────────────────────────────────────────
-- PASO 3: Borrar asignaciones de Hualpén (sin checkout)
-- ──────────────────────────────────────────────────────────────
DELETE FROM v2_asignaciones
WHERE empresa_id = (SELECT id FROM v2_empresas WHERE nombre ILIKE '%hualp%' LIMIT 1)
  AND fecha_checkout IS NULL;

-- ──────────────────────────────────────────────────────────────
-- PASO 4: Borrar todas las solicitudes de Hualpén
-- (así la carga queda limpia para importar de nuevo)
-- ──────────────────────────────────────────────────────────────
DELETE FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%hualp%';

-- ──────────────────────────────────────────────────────────────
-- VERIFICACIÓN FINAL
-- ──────────────────────────────────────────────────────────────
SELECT 
    'ASIGNACIONES RESTANTES' as check_tabla,
    COUNT(*) as total
FROM v2_asignaciones a
WHERE a.empresa_id = (SELECT id FROM v2_empresas WHERE nombre ILIKE '%hualp%' LIMIT 1)
  AND a.fecha_checkout IS NULL

UNION ALL

SELECT 
    'SOLICITUDES RESTANTES' as check_tabla,
    COUNT(*) as total
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%hualp%';

-- Si ambas filas muestran 0, la limpieza fue exitosa ✅
