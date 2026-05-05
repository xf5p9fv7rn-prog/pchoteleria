-- ════════════════════════════════════════════════════════════════════════════
-- MAPA DE BASE DE DATOS + LIMPIEZA + REORDENAMIENTO
-- PC Hotelería — Ejecuta PASO A PASO en Supabase → SQL Editor
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 📋 PASO 1: MAPA COMPLETO — todas las tablas y cuántos registros tienen
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  relname   AS tabla,
  n_live_tup AS registros_aprox
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;

-- ──────────────────────────────────────────────────────────────────────────
-- 📋 PASO 2: EDIFICIOS actuales en Supabase
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  id,
  name        AS nombre,
  code        AS codigo,
  type        AS tipo,
  "mainShift" AS turno_principal
FROM buildings
ORDER BY code;

-- ──────────────────────────────────────────────────────────────────────────
-- 📋 PASO 3: Habitaciones por edificio (conteo real)
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  b.code           AS codigo,
  b.name           AS pabellon,
  COUNT(r.id)      AS total_hab,
  SUM(COALESCE((r."bedCount")::int, 2)) AS total_camas,
  COUNT(r.id) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL) AS ocup_dia,
  COUNT(r.id) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL) AS ocup_noche,
  COUNT(r.id) FILTER (WHERE r.status = 'blocked') AS bloqueadas,
  MIN(r.id)        AS id_minimo,
  MAX(r.id)        AS id_maximo
FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
GROUP BY b.id, b.code, b.name
ORDER BY b.code;

-- ──────────────────────────────────────────────────────────────────────────
-- 🔍 PASO 4: Detectar habitaciones HUÉRFANAS
--    (tienen buildingId que ya no existe en buildings)
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  r.id,
  r.number,
  r."buildingId",
  r."bedCount",
  r.status
FROM rooms r
LEFT JOIN buildings b ON b.id = r."buildingId"
WHERE b.id IS NULL
ORDER BY r."buildingId", r.id;

-- Si el resultado anterior muestra filas → esas son las hab eliminadas que siguen en Supabase
-- Corre el PASO 5 para borrarlas

-- ──────────────────────────────────────────────────────────────────────────
-- 🗑️ PASO 5: BORRAR habitaciones huérfanas (sin edificio asociado)
--    ⚠️ Solo ejecutar si el PASO 4 mostró resultados
-- ──────────────────────────────────────────────────────────────────────────
DELETE FROM rooms
WHERE "buildingId" NOT IN (SELECT id FROM buildings);

-- Confirmar cuántas se borraron:
SELECT COUNT(*) AS rooms_restantes FROM rooms;

-- ──────────────────────────────────────────────────────────────────────────
-- 🔍 PASO 6: Detectar EDIFICIOS duplicados (mismo nombre/código)
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  LOWER(TRIM(name)) AS nombre_norm,
  COUNT(*)          AS cantidad,
  array_agg(id ORDER BY id) AS ids
FROM buildings
GROUP BY LOWER(TRIM(name))
HAVING COUNT(*) > 1
ORDER BY cantidad DESC;

-- ──────────────────────────────────────────────────────────────────────────
-- 🔍 PASO 7: Verificar si hay habitaciones de edificios que YA borraste
--    (edificios que existen en rooms.buildingId pero no en buildings)
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  r."buildingId"  AS building_id_faltante,
  COUNT(*)        AS hab_sin_edificio
FROM rooms r
WHERE NOT EXISTS (
  SELECT 1 FROM buildings b WHERE b.id = r."buildingId"
)
GROUP BY r."buildingId"
ORDER BY hab_sin_edificio DESC;

-- ──────────────────────────────────────────────────────────────────────────
-- ✅ PASO 8: RESUMEN FINAL LIMPIO después de la limpieza
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  b.code     AS pabellon,
  b.name     AS nombre,
  COUNT(r.id)   AS habitaciones,
  SUM(COALESCE((r."bedCount")::int, 2))   AS camas,
  COUNT(r.id) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL) AS ocup_dia,
  COUNT(r.id) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL) AS ocup_noche,
  GREATEST(0,
    SUM(COALESCE((r."bedCount")::int, 2))
    - COUNT(r.id) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL)
    - COUNT(r.id) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL)
    - SUM(CASE WHEN r.status = 'blocked' THEN COALESCE((r."bedCount")::int, 2) ELSE 0 END)
  ) AS disponibles,
  ROUND(100.0 * (
    COUNT(r.id) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL) +
    COUNT(r.id) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL)
  ) / NULLIF(SUM(COALESCE((r."bedCount")::int, 2)), 0), 1) AS pct_ocup
FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
GROUP BY b.id, b.code, b.name
ORDER BY b.code;

-- TOTALES:
SELECT
  COUNT(r.id)    AS total_hab,
  SUM(COALESCE((r."bedCount")::int, 2)) AS total_camas,
  COUNT(r.id) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL) AS ocup_dia,
  COUNT(r.id) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL) AS ocup_noche
FROM rooms r
JOIN buildings b ON b.id = r."buildingId";
