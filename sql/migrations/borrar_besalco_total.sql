-- ============================================================
-- BORRADO TOTAL BESALCO - Correr en Supabase SQL Editor
-- https://app.supabase.com → SQL Editor → Run
-- ============================================================

-- ── 0. DIAGNÓSTICO PREVIO ─────────────────────────────────
SELECT 
    'Solicitudes BESALCO' AS tabla, COUNT(*) AS total
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%besalco%'

UNION ALL

SELECT 
    'Asignaciones activas/pre BESALCO', COUNT(*)
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%besalco%'
  AND a.fecha_checkout IS NULL;

-- ── 1. LIBERAR CAMAS (activas + pre-asignadas) ────────────
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%besalco%'
      AND a.fecha_checkout IS NULL
      AND a.id_cama IS NOT NULL
)
AND estado != 'Deshabilitada';

-- ── 2. CHECKOUT DE ASIGNACIONES (activas + pre-asignadas) ─
UPDATE v2_asignaciones
SET 
    fecha_checkout     = GREATEST(NOW(), fecha_checkin),
    estado_asignacion  = 'sin_checkout'
WHERE empresa_id IN (
    SELECT id FROM v2_empresas WHERE nombre ILIKE '%besalco%'
)
AND fecha_checkout IS NULL;

-- ── 3. LIMPIAR v2_camas_perdidas ──────────────────────────
DELETE FROM v2_camas_perdidas
WHERE habitacion_id IN (
    SELECT DISTINCT c.habitacion_id
    FROM v2_camas c
    INNER JOIN v2_asignaciones a ON a.id_cama = c.id_cama
    INNER JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%besalco%'
      AND c.habitacion_id IS NOT NULL
);

-- ── 4. BORRAR TODAS LAS SOLICITUDES DE BESALCO ───────────
DELETE FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%besalco%';

-- ── 5. VERIFICACIÓN FINAL ─────────────────────────────────
SELECT 
    'Solicitudes restantes' AS resultado, COUNT(*) AS total
FROM v2_solicitudes_b2b
WHERE empresa ILIKE '%besalco%'

UNION ALL

SELECT 
    'Asignaciones activas restantes', COUNT(*)
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%besalco%'
  AND a.fecha_checkout IS NULL;

-- Si ambas filas muestran 0 → BESALCO completamente borrado ✅
