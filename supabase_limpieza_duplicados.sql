-- ════════════════════════════════════════════════════════════════════════════
-- LIMPIEZA SEGURA — Dejar solo las habitaciones correctas por pabellón
-- Las correctas son las MÁS RECIENTES (IDs más altos) dentro de cada edificio
-- Protege siempre habitaciones con ocupantes asignados
-- Ejecuta en orden: primero PREVIEW, luego DELETE si el preview es correcto
-- ════════════════════════════════════════════════════════════════════════════

-- ─── CONFIGURACIÓN: cuántas habitaciones DEBE tener cada pabellón ────────
-- (Basado en los datos reales del sistema)
-- 220  → 127 habitaciones
-- P-1  →  60 habitaciones
-- P-2  → 150 habitaciones
-- P-3  → 176 habitaciones
-- P-4  → 115 habitaciones
-- P-5  → 111 habitaciones
-- P-6  →  79 habitaciones
-- P-7  → 100 habitaciones
-- P-8  →  82 habitaciones

-- ════════════════════════════════════════════════════════════════════════════
-- PASO A — PREVIEW: Ver qué habitaciones se van a BORRAR (sin borrar nada)
-- ════════════════════════════════════════════════════════════════════════════
WITH ranked AS (
  SELECT
    r.id,
    r.number,
    r."buildingId",
    r.status,
    r.beds,
    b.code   AS pabellon,
    -- Prioridad: primero las que tienen ocupantes, luego las más nuevas (ID alto)
    ROW_NUMBER() OVER (
      PARTITION BY r."buildingId"
      ORDER BY
        CASE WHEN r.beds -> 'day'   ->> 'occupant' IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN r.beds -> 'night' ->> 'occupant' IS NOT NULL THEN 0 ELSE 1 END,
        r.id DESC   -- más reciente primero
    ) AS rn,
    CASE
      WHEN r.beds -> 'day'   ->> 'occupant' IS NOT NULL
        OR r.beds -> 'night' ->> 'occupant' IS NOT NULL
      THEN true ELSE false
    END AS tiene_ocupante
  FROM rooms r
  JOIN buildings b ON b.id = r."buildingId"
),
targets AS (
  SELECT b.id AS building_id, b.code,
    CASE b.code
      WHEN '220' THEN 127
      WHEN 'P-1' THEN 60
      WHEN 'P-2' THEN 150
      WHEN 'P-3' THEN 176
      WHEN 'P-4' THEN 115
      WHEN 'P-5' THEN 111
      WHEN 'P-6' THEN 79
      WHEN 'P-7' THEN 100
      WHEN 'P-8' THEN 82
      ELSE 9999   -- edificios desconocidos: no tocar
    END AS target
  FROM buildings b
)
SELECT
  r.pabellon,
  COUNT(*)                              AS a_borrar,
  COUNT(*) FILTER (WHERE r.tiene_ocupante) AS protegidas_con_ocupante,
  MIN(r.id)                             AS id_min_borrar,
  MAX(r.id)                             AS id_max_borrar
FROM ranked r
JOIN targets t ON t.building_id = r."buildingId"
WHERE r.rn > t.target
GROUP BY r.pabellon
ORDER BY r.pabellon;

-- ════════════════════════════════════════════════════════════════════════════
-- PASO B — PREVIEW DETALLADO: Ver las habitaciones a borrar con sus números
-- (ejecutar para verificar que no se borran hab. con ocupantes)
-- ════════════════════════════════════════════════════════════════════════════
WITH ranked AS (
  SELECT
    r.id,
    r.number,
    r."buildingId",
    b.code AS pabellon,
    ROW_NUMBER() OVER (
      PARTITION BY r."buildingId"
      ORDER BY
        CASE WHEN r.beds -> 'day'   ->> 'occupant' IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN r.beds -> 'night' ->> 'occupant' IS NOT NULL THEN 0 ELSE 1 END,
        r.id DESC
    ) AS rn,
    CASE
      WHEN r.beds -> 'day'   ->> 'occupant' IS NOT NULL
        OR r.beds -> 'night' ->> 'occupant' IS NOT NULL
      THEN '⚠️ CON OCUPANTE' ELSE 'vacía'
    END AS estado
  FROM rooms r
  JOIN buildings b ON b.id = r."buildingId"
),
targets AS (
  SELECT b.id AS building_id,
    CASE b.code
      WHEN '220' THEN 127 WHEN 'P-1' THEN 60 WHEN 'P-2' THEN 150
      WHEN 'P-3' THEN 176 WHEN 'P-4' THEN 115 WHEN 'P-5' THEN 111
      WHEN 'P-6' THEN 79  WHEN 'P-7' THEN 100 WHEN 'P-8' THEN 82
      ELSE 9999
    END AS target
  FROM buildings b
)
SELECT r.pabellon, r.id, r.number, r.estado
FROM ranked r
JOIN targets t ON t.building_id = r."buildingId"
WHERE r.rn > t.target
ORDER BY r.pabellon, r.id;

-- ════════════════════════════════════════════════════════════════════════════
-- PASO C — ⚠️ DELETE REAL (ejecutar SOLO si el PASO A muestra 0 protegidas)
-- ════════════════════════════════════════════════════════════════════════════
DELETE FROM rooms
WHERE id IN (
  SELECT r.id
  FROM (
    SELECT
      id,
      "buildingId",
      ROW_NUMBER() OVER (
        PARTITION BY "buildingId"
        ORDER BY
          CASE WHEN beds -> 'day'   ->> 'occupant' IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN beds -> 'night' ->> 'occupant' IS NOT NULL THEN 0 ELSE 1 END,
          id DESC
      ) AS rn,
      CASE
        WHEN beds -> 'day'   ->> 'occupant' IS NOT NULL
          OR beds -> 'night' ->> 'occupant' IS NOT NULL
        THEN true ELSE false
      END AS tiene_ocupante
    FROM rooms
  ) r
  JOIN buildings b ON b.id = r."buildingId"
  WHERE r.tiene_ocupante = false   -- NUNCA borrar hab con ocupantes
    AND r.rn > CASE b.code
      WHEN '220' THEN 127 WHEN 'P-1' THEN 60 WHEN 'P-2' THEN 150
      WHEN 'P-3' THEN 176 WHEN 'P-4' THEN 115 WHEN 'P-5' THEN 111
      WHEN 'P-6' THEN 79  WHEN 'P-7' THEN 100 WHEN 'P-8' THEN 82
      ELSE 9999
    END
);

-- ════════════════════════════════════════════════════════════════════════════
-- PASO D — VERIFICACIÓN FINAL después del DELETE
-- ════════════════════════════════════════════════════════════════════════════
SELECT
  b.code   AS pabellon,
  COUNT(*) AS hab_restantes,
  COUNT(*) FILTER (WHERE r.beds -> 'day'   ->> 'occupant' IS NOT NULL) AS ocup_dia,
  COUNT(*) FILTER (WHERE r.beds -> 'night' ->> 'occupant' IS NOT NULL) AS ocup_noche
FROM rooms r
JOIN buildings b ON b.id = r."buildingId"
GROUP BY b.code
ORDER BY b.code;

-- TOTAL:
SELECT COUNT(*) AS total_rooms_final FROM rooms;
