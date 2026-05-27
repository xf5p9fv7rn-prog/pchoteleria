-- ══════════════════════════════════════════════════════════════════
-- LIMPIAR ARAMARK — Eliminar asignaciones y resetear solicitudes
-- Ejecutar en: Supabase → SQL Editor → Run ▶
-- ══════════════════════════════════════════════════════════════════

-- PASO 1: Ver cuánto hay antes de limpiar (verificación)
SELECT
    'asignaciones' AS tipo,
    COUNT(*) AS total
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE UPPER(e.nombre) LIKE '%ARAMARK%'
  AND a.fecha_checkout IS NULL

UNION ALL

SELECT
    'solicitudes pendientes/aceptadas',
    COUNT(*)
FROM v2_solicitudes_b2b
WHERE UPPER(empresa) LIKE '%ARAMARK%'
  AND status IN ('pendiente', 'aceptada');

-- ──────────────────────────────────────────────────────────────────
-- PASO 2: Liberar camas de Aramark (estado → Disponible)
-- ──────────────────────────────────────────────────────────────────
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE UPPER(e.nombre) LIKE '%ARAMARK%'
      AND a.fecha_checkout IS NULL
);

-- ──────────────────────────────────────────────────────────────────
-- PASO 3: Eliminar asignaciones activas de Aramark
-- ──────────────────────────────────────────────────────────────────
DELETE FROM v2_asignaciones
WHERE empresa_id IN (
    SELECT id FROM v2_empresas WHERE UPPER(nombre) LIKE '%ARAMARK%'
)
AND fecha_checkout IS NULL;

-- ──────────────────────────────────────────────────────────────────
-- PASO 4: Resetear solicitudes de Aramark a 'pendiente'
-- ──────────────────────────────────────────────────────────────────
UPDATE v2_solicitudes_b2b
SET status = 'pendiente'
WHERE UPPER(empresa) LIKE '%ARAMARK%'
  AND status IN ('aceptada', 'rechazada');

-- ──────────────────────────────────────────────────────────────────
-- PASO 5: Verificación final — debe quedar en 0 asignaciones activas
-- ──────────────────────────────────────────────────────────────────
SELECT
    'asignaciones activas restantes' AS check_,
    COUNT(*) AS total
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE UPPER(e.nombre) LIKE '%ARAMARK%'
  AND a.fecha_checkout IS NULL

UNION ALL

SELECT
    'solicitudes en pendiente',
    COUNT(*)
FROM v2_solicitudes_b2b
WHERE UPPER(empresa) LIKE '%ARAMARK%'
  AND status = 'pendiente';
