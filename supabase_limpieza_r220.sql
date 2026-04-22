-- ════════════════════════════════════════════════════════════════════════════
-- LIMPIEZA DE EMERGENCIA — Eliminar habitaciones duplicadas del R-220
-- El dashboard muestra 1563 habitaciones cuando deberían ser 1416.
-- Las 147 habitaciones sobrantes son el R-220 viejo (números 1-156).
-- Ejecutar en: Supabase → SQL Editor → New Query → RUN ▶
-- ════════════════════════════════════════════════════════════════════════════

-- PASO 1: Ver cuántas habitaciones tiene el R-220 ahora mismo (diagnóstico)
SELECT
  b.name   AS edificio,
  COUNT(*) AS total_hab,
  MIN(r.id) AS id_min,
  MAX(r.id) AS id_max,
  string_agg(r.number::text, ', ' ORDER BY r.number::int) FILTER (WHERE r.id < 22001) AS nums_viejos
FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
WHERE b.name ILIKE '%220%' OR b.code ILIKE '%220%' OR b.name ILIKE '%r-220%'
GROUP BY b.name;

-- ════════════════════════════════════════════════════════════
-- PASO 2: BORRAR las habitaciones viejas del R-220
-- Las nuevas tienen IDs fijos 22001-22145
-- Las viejas tienen IDs menores (auto-generados)
-- ════════════════════════════════════════════════════════════
DELETE FROM rooms
WHERE
  "buildingId" = (
    SELECT id FROM buildings
    WHERE name ILIKE '%220%' OR code ILIKE '%220%' OR name ILIKE '%r-220%'
    LIMIT 1
  )
  AND id < 22001;  -- Solo borra las viejas, no toca las nuevas (22001-22145)

-- PASO 3: Confirmación final
SELECT
  COUNT(*) AS total_habitaciones_sistema,
  COUNT(*) FILTER (
    WHERE "buildingId" = (
      SELECT id FROM buildings
      WHERE name ILIKE '%220%' OR code ILIKE '%220%' OR name ILIKE '%r-220%'
      LIMIT 1
    )
  ) AS hab_r220,
  COUNT(*) FILTER (
    WHERE "buildingId" != (
      SELECT id FROM buildings
      WHERE name ILIKE '%220%' OR code ILIKE '%220%' OR name ILIKE '%r-220%'
      LIMIT 1
    )
  ) AS hab_otros_pabellones
FROM rooms;

-- ✅ Resultado esperado:
-- total_habitaciones_sistema = 1416
-- hab_r220                   = 145
-- hab_otros_pabellones       = 1271
