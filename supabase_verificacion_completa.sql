-- ════════════════════════════════════════════════════════════════════════════
-- PC HOTELERÍA — VERIFICACIÓN COMPLETA DE BASE DE DATOS
-- Ejecuta en: Supabase → SQL Editor → New Query → RUN ▶
-- Fecha: 2026-04-28
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. CONTEO GENERAL DE TABLAS ───────────────────────────────────────────
SELECT 'buildings'       AS tabla, COUNT(*) AS registros FROM buildings
UNION ALL
SELECT 'rooms',           COUNT(*) FROM rooms
UNION ALL
SELECT 'b2b_requests',    COUNT(*) FROM b2b_requests
UNION ALL
SELECT 'census',          COUNT(*) FROM census
UNION ALL
SELECT 'gerencia_quotas', COUNT(*) FROM gerencia_quotas
UNION ALL
SELECT 'censo_locks',     COUNT(*) FROM censo_locks;


-- ── 2. EDIFICIOS REGISTRADOS ──────────────────────────────────────────────
SELECT id, name, code, type, floor, capacity
FROM buildings
ORDER BY id;


-- ── 3. COLUMNAS DE LA TABLA ROOMS (verificar que no falte ninguna) ────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'rooms' AND table_schema = 'public'
ORDER BY ordinal_position;


-- ── 4. COLUMNAS DE LA TABLA BUILDINGS ────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'buildings' AND table_schema = 'public'
ORDER BY ordinal_position;


-- ── 5. COLUMNAS DE B2B_REQUESTS ───────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'b2b_requests' AND table_schema = 'public'
ORDER BY ordinal_position;


-- ── 6. HABITACIONES POR EDIFICIO (resumen) ────────────────────────────────
SELECT
  b.code     AS codigo,
  b.name     AS edificio,
  COUNT(r.id) AS total_hab,
  COUNT(r.id) FILTER (WHERE r.beds IS NULL OR r.beds = '{}'::jsonb)          AS sin_beds,
  COUNT(r.id) FILTER (WHERE r.status = 'occupied')                            AS ocupadas,
  COUNT(r.id) FILTER (WHERE r.status = 'free')                                AS libres,
  COUNT(r.id) FILTER (WHERE r.status = 'blocked')                             AS bloqueadas,
  COUNT(r.id) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL)     AS cama_dia_ocu,
  COUNT(r.id) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL)     AS cama_noche_ocu
FROM buildings b
LEFT JOIN rooms r ON r."buildingId" = b.id
GROUP BY b.code, b.name
ORDER BY b.code;


-- ── 7. VERIFICAR DUPLICADOS DE NÚMERO DE HABITACIÓN POR EDIFICIO ─────────
SELECT
  b.code     AS edificio,
  r.number   AS numero,
  COUNT(*)   AS duplicados
FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
GROUP BY b.code, r.number
HAVING COUNT(*) > 1
ORDER BY b.code, r.number;


-- ── 8. HABITACIONES CON STATUS INCONSISTENTE (ocupante ≠ status) ──────────
-- Detecta rooms que dicen "free" pero tienen un ocupante en alguna cama
SELECT
  b.code     AS edificio,
  r.id,
  r.number,
  r.status,
  r.beds -> 'day'   ->> 'occupant' AS ocup_dia,
  r.beds -> 'night' ->> 'occupant' AS ocup_noche
FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
WHERE r.status = 'free'
  AND (
    (r.beds -> 'day'   ->> 'occupant' IS NOT NULL AND r.beds -> 'day'   ->> 'occupant' != '') OR
    (r.beds -> 'night' ->> 'occupant' IS NOT NULL AND r.beds -> 'night' ->> 'occupant' != '')
  )
ORDER BY b.code, r.number;


-- ── 9. HABITACIONES STATUS=OCCUPIED PERO SIN NADIE EN CAMAS ──────────────
SELECT
  b.code     AS edificio,
  r.id,
  r.number,
  r.status
FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
WHERE r.status = 'occupied'
  AND (r.beds -> 'day'   ->> 'occupant' IS NULL OR r.beds -> 'day'   ->> 'occupant' = '')
  AND (r.beds -> 'night' ->> 'occupant' IS NULL OR r.beds -> 'night' ->> 'occupant' = '')
  AND (r.beds -> 'extra' ->> 'occupant' IS NULL OR r.beds -> 'extra' ->> 'occupant' = '')
ORDER BY b.code, r.number
LIMIT 20;


-- ── 10. VERIFICAR FUNCIONES RPC INSTALADAS ────────────────────────────────
SELECT
  routine_name     AS funcion,
  routine_type     AS tipo
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('find_room_by_rut', 'get_camp_summary', 'checkin_by_rut', 'buscar_habitacion_por_rut')
ORDER BY routine_name;


-- ── 11. VERIFICAR REALTIME Y RLS POR TABLA ────────────────────────────────
SELECT
  t.table_name                                                               AS tabla,
  (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = t.table_name)     AS politicas_rls,
  EXISTS (
    SELECT 1 FROM pg_publication_tables pt
    WHERE pt.pubname = 'supabase_realtime' AND pt.tablename = t.table_name
  )                                                                           AS realtime_activo
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN ('rooms','buildings','b2b_requests','census','gerencia_quotas','censo_locks')
ORDER BY t.table_name;


-- ── 12. RESUMEN GENERAL DE OCUPACIÓN (la más importante) ─────────────────
SELECT
  COUNT(*)                                                                    AS total_habitaciones,
  SUM(COALESCE(r."bedCount"::int, 2))                                         AS total_camas,
  COUNT(*) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL AND r.beds -> 'day'   ->> 'occupant' != '') AS ocup_dia,
  COUNT(*) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL AND r.beds -> 'night' ->> 'occupant' != '') AS ocup_noche,
  COUNT(*) FILTER (WHERE r.beds -> 'extra' ->> 'occupant' IS NOT NULL AND r.beds -> 'extra' ->> 'occupant' != '') AS ocup_extra,
  COUNT(*) FILTER (WHERE r.status = 'blocked')                                AS bloqueadas,
  ROUND(100.0 * (
    COUNT(*) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL AND r.beds -> 'day'   ->> 'occupant' != '') +
    COUNT(*) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL AND r.beds -> 'night' ->> 'occupant' != '') +
    COUNT(*) FILTER (WHERE r.beds -> 'extra' ->> 'occupant' IS NOT NULL AND r.beds -> 'extra' ->> 'occupant' != '')
  ) / NULLIF(SUM(COALESCE(r."bedCount"::int, 2)), 0), 1)                      AS pct_ocupacion
FROM rooms r;
