-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO Y FIX DE OCUPACIÓN — PC Hotelería
-- Ejecuta en: Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════════════════

-- ── PASO 1: Ver cuántas habitaciones tienen beds vacíos ───────────────────
SELECT
  COUNT(*) FILTER (WHERE beds IS NULL OR beds = '{}'::jsonb)  AS sin_beds,
  COUNT(*) FILTER (WHERE beds IS NOT NULL AND beds != '{}'::jsonb) AS con_beds,
  COUNT(*) AS total_rooms
FROM rooms;

-- ── PASO 2: Diagnóstico por pabellón ─────────────────────────────────────
SELECT
  b.code    AS pabellon,
  b.name    AS nombre,
  COUNT(r.id) AS habitaciones,
  COUNT(r.id) FILTER (WHERE r.beds IS NULL OR r.beds = '{}'::jsonb) AS sin_datos,
  COUNT(r.id) FILTER (WHERE r.beds IS NOT NULL AND r.beds != '{}'::jsonb) AS con_datos,
  COUNT(r.id) FILTER (WHERE r.beds -> 'day' ->> 'occupant' IS NOT NULL)   AS ocup_dia,
  COUNT(r.id) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL) AS ocup_noche
FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
GROUP BY b.code, b.name
ORDER BY b.code;

-- ── PASO 3: Resumen general de ocupación ─────────────────────────────────
SELECT
  COUNT(*)  AS total_hab,
  SUM(COALESCE((r."bedCount")::int, 2)) AS total_camas,
  COUNT(*)  FILTER (
    WHERE r.beds -> 'day' ->> 'occupant' IS NOT NULL
  )         AS ocupadas_dia,
  COUNT(*)  FILTER (
    WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL
  )         AS ocupadas_noche,
  COUNT(*)  FILTER (
    WHERE r.beds -> 'day' ->> 'occupant' IS NOT NULL
       OR r.beds -> 'night' ->> 'occupant' IS NOT NULL
  )         AS hab_con_al_menos_1_cama,
  ROUND(
    100.0 *
    (
      COUNT(*) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL) +
      COUNT(*) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL)
    )
    / NULLIF(SUM(COALESCE((r."bedCount")::int, 2)), 0)
  , 1) AS pct_ocupacion
FROM rooms r;

-- ── PASO 4: Crear VISTA de ocupación por pabellón (para el Dashboard) ────
-- Esta vista permite consultar los datos de ocupación directamente desde SQL
CREATE OR REPLACE VIEW v_ocupacion_pabellon AS
SELECT
  b.code           AS pabellon,
  b.name           AS nombre,
  COUNT(r.id)      AS habitaciones,
  SUM(COALESCE((r."bedCount")::int, 2))  AS camas_total,

  COUNT(r.id) FILTER (
    WHERE r.beds -> 'day' ->> 'occupant' IS NOT NULL
  )                AS ocup_dia,

  COUNT(r.id) FILTER (
    WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL
  )                AS ocup_noche,

  COUNT(r.id) FILTER (
    WHERE r.status = 'blocked'
  )                AS hab_bloqueadas,

  -- Disponibles = camas - ocupadas día - ocupadas noche - bloqueadas
  GREATEST(0,
    SUM(COALESCE((r."bedCount")::int, 2))
    - COUNT(r.id) FILTER (WHERE r.beds -> 'day'  ->> 'occupant' IS NOT NULL)
    - COUNT(r.id) FILTER (WHERE r.beds -> 'night'->> 'occupant' IS NOT NULL)
    - SUM(CASE WHEN r.status = 'blocked' THEN COALESCE((r."bedCount")::int, 2) ELSE 0 END)
  )                AS disponibles,

  ROUND(100.0 * (
    COUNT(r.id) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL) +
    COUNT(r.id) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL)
  ) / NULLIF(SUM(COALESCE((r."bedCount")::int, 2)), 0), 1) AS pct_ocupacion

FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
GROUP BY b.code, b.name
ORDER BY b.code;

-- ── PASO 5: Consultar la vista creada ────────────────────────────────────
SELECT * FROM v_ocupacion_pabellon;

-- TOTAL:
SELECT
  SUM(habitaciones)  AS total_hab,
  SUM(camas_total)   AS total_camas,
  SUM(ocup_dia)      AS total_ocup_dia,
  SUM(ocup_noche)    AS total_ocup_noche,
  SUM(disponibles)   AS total_disponibles,
  ROUND(AVG(pct_ocupacion), 1) AS pct_promedio
FROM v_ocupacion_pabellon;
