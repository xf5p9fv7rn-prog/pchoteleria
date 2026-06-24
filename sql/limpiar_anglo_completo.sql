-- ============================================================
-- LIMPIAR ANGLO — Libera todas las habitaciones Anglo
-- y deja las camas Disponibles para nueva carga
-- Fecha: 2026-06-10
-- ============================================================

-- ── PASO 1: Liberar camas ocupadas por Anglo → 'Disponible' ────────────────
-- Busca las camas asignadas a trabajadores Anglo y las pone disponibles
UPDATE v2_camas
SET estado = 'Disponible'
WHERE id_cama IN (
    SELECT DISTINCT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%Anglo%'
      AND a.fecha_checkout IS NULL
);

-- ── PASO 2: Cerrar asignaciones activas de Anglo (checkout hoy) ─────────────
-- Pone fecha_checkout = hoy para conservar historial
UPDATE v2_asignaciones
SET fecha_checkout = CURRENT_DATE
WHERE id IN (
    SELECT a.id
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%Anglo%'
      AND a.fecha_checkout IS NULL
);

-- ── PASO 3: Marcar todas las asignaciones Anglo como inactivas ───────────────
UPDATE v2_asignaciones_anglo
SET activa = false
WHERE activa = true;

-- ── VERIFICACIÓN ─────────────────────────────────────────────────────────────
-- Debe devolver 0 en ambas consultas

SELECT COUNT(*) AS camas_anglo_ocupadas
FROM v2_camas c
WHERE c.id_cama IN (
    SELECT DISTINCT a.id_cama
    FROM v2_asignaciones a
    JOIN v2_empresas e ON e.id = a.empresa_id
    WHERE e.nombre ILIKE '%Anglo%'
      AND a.fecha_checkout IS NULL
);

SELECT COUNT(*) AS asignaciones_anglo_activas
FROM v2_asignaciones_anglo
WHERE activa = true;
