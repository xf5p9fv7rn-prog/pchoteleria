-- ══════════════════════════════════════════════════════════════════════════════
-- CHECKOUT MASIVO: ROCMIN
-- Libera todas las camas asignadas a trabajadores de ROCMIN
-- Pasos: 1) Preview → 2) Liberar camas → 3) Checkout asignaciones
--
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- ── PASO 0: Preview — cuántas camas/asignaciones se liberarán ─────────────────
SELECT
    e.nombre                          AS empresa,
    COUNT(a.id)                       AS asignaciones_activas,
    COUNT(DISTINCT a.id_cama)         AS camas_a_liberar,
    MIN(a.fecha_checkin)::date        AS primer_checkin,
    MAX(a.fecha_salida_programada)::date AS ultimo_salida
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%rocmin%'
  AND a.fecha_checkout IS NULL
GROUP BY e.nombre;


-- ── PASO 1: Liberar camas (estado → Disponible) ───────────────────────────────
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%rocmin%'
      AND a.fecha_checkout IS NULL
      AND a.id_cama IS NOT NULL
)
AND estado != 'Deshabilitada';   -- no tocar las deshabilitadas


-- ── PASO 2: Registrar Check-Out en asignaciones ────────────────────────────────
-- Usa GREATEST para nunca poner fecha_checkout < fecha_checkin (constraint chk_fechas)
UPDATE v2_asignaciones
SET fecha_checkout = GREATEST(NOW(), fecha_checkin)
WHERE empresa_id IN (
    SELECT id FROM v2_empresas WHERE nombre ILIKE '%rocmin%'
)
AND fecha_checkout IS NULL;


-- ── PASO 3: Limpiar v2_camas_perdidas de habitaciones ROCMIN ──────────────────
DELETE FROM v2_camas_perdidas
WHERE habitacion_id IN (
    SELECT DISTINCT c.habitacion_id
    FROM v2_camas c
    WHERE c.id_cama IN (
        SELECT a.id_cama
        FROM v2_asignaciones a
        JOIN v2_empresas e ON e.id = a.empresa_id
        WHERE e.nombre ILIKE '%rocmin%'
          AND a.id_cama IS NOT NULL
    )
);


-- ── PASO 4: Verificación final ────────────────────────────────────────────────
SELECT
    'Asignaciones activas ROCMIN restantes' AS check_item,
    COUNT(*) AS cantidad
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%rocmin%'
  AND a.fecha_checkout IS NULL

UNION ALL

SELECT
    'Camas ocupadas por ROCMIN restantes',
    COUNT(DISTINCT a.id_cama)
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%rocmin%'
  AND a.fecha_checkout IS NULL;
