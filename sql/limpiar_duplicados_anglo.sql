-- ============================================================
-- LIMPIAR DUPLICADOS ANGLO — Elimina asignaciones repetidas
-- Conserva solo la MÁS RECIENTE por RUT (1 persona = 1 cama)
-- Fecha: 2026-06-10
-- ============================================================

-- ── DIAGNÓSTICO: Ver cuántos duplicados hay ──────────────────────────────────
SELECT rut_huesped, nombre_huesped, id_cama, COUNT(*) AS repeticiones
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
GROUP BY rut_huesped, nombre_huesped, id_cama
HAVING COUNT(*) > 1
ORDER BY repeticiones DESC;

-- ── CONTAR total de duplicados a eliminar ────────────────────────────────────
SELECT COUNT(*) AS registros_a_eliminar
FROM v2_asignaciones a
WHERE a.fecha_checkout IS NULL
  AND a.id NOT IN (
    SELECT DISTINCT ON (rut_huesped) id
    FROM v2_asignaciones
    WHERE fecha_checkout IS NULL
    ORDER BY rut_huesped, id DESC   -- conservar el más reciente (id mayor)
);

-- ── ELIMINAR DUPLICADOS: mantener solo 1 por RUT activo ─────────────────────
-- Conserva el registro con id mayor (el más reciente) por cada RUT
DELETE FROM v2_asignaciones
WHERE fecha_checkout IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (rut_huesped) id
    FROM v2_asignaciones
    WHERE fecha_checkout IS NULL
    ORDER BY rut_huesped, id DESC
);

-- ── VERIFICACIÓN: debe quedar 0 duplicados ───────────────────────────────────
SELECT rut_huesped, COUNT(*) AS repeticiones
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
GROUP BY rut_huesped
HAVING COUNT(*) > 1
ORDER BY repeticiones DESC;

-- Si el resultado está vacío = ✅ sin duplicados

-- ── PREVENIR FUTUROS DUPLICADOS: índice único ────────────────────────────────
-- Esto hace que Supabase RECHACE automáticamente una 2da asignación activa
-- para el mismo RUT
CREATE UNIQUE INDEX IF NOT EXISTS idx_asig_rut_unico_activo
ON v2_asignaciones(rut_huesped)
WHERE fecha_checkout IS NULL;
