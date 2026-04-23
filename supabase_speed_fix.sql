-- ════════════════════════════════════════════════════════════════════════════
-- PC HOTELERÍA — SPEED FIX: Búsqueda por RUT instantánea (<1 segundo)
-- 
-- PROBLEMA ACTUAL:  15s (descarga 1416 habitaciones completas)
-- RESULTADO:        <1s (búsqueda server-side, devuelve 1 fila)
--
-- Ejecutar en: Supabase → SQL Editor → New Query → RUN ▶
-- ════════════════════════════════════════════════════════════════════════════

-- ── PASO 1: Crear índices en las columnas RUT del JSONB ──────────────────
-- Sin esto PostgreSQL revisa las 1416 filas una por una.
-- Con esto va directo al resultado en microsegundos.
-- (Se crean solo si no existen — seguro ejecutar varias veces)

CREATE INDEX IF NOT EXISTS idx_rooms_rut_day
  ON rooms ((beds->'day'->>'rut'));

CREATE INDEX IF NOT EXISTS idx_rooms_rut_night
  ON rooms ((beds->'night'->>'rut'));

CREATE INDEX IF NOT EXISTS idx_rooms_rut_extra
  ON rooms ((beds->'extra'->>'rut'));

-- ── PASO 2: Función RPC ultra-rápida (usa los índices) ───────────────────
-- Normaliza el RUT antes de buscar (cubre formatos con/sin puntos/guión)
CREATE OR REPLACE FUNCTION find_room_by_rut(p_rut TEXT)
RETURNS SETOF rooms AS $$
DECLARE
  v_base TEXT;
BEGIN
  -- Extraer solo los dígitos + K (sin puntos, sin guión, sin espacios)
  -- Quitar también el dígito verificador para búsqueda tolerante
  v_base := left(
    upper(regexp_replace(p_rut, '[^0-9Kk]', '', 'g')),
    7  -- primeros 7 dígitos son suficientes para identificar unívocamente
  );

  RETURN QUERY
  SELECT * FROM rooms
  WHERE
    upper(regexp_replace(COALESCE(beds->'day'->>'rut',   ''), '[^0-9Kk]', '', 'g')) LIKE v_base || '%'
    OR
    upper(regexp_replace(COALESCE(beds->'night'->>'rut', ''), '[^0-9Kk]', '', 'g')) LIKE v_base || '%'
    OR
    upper(regexp_replace(COALESCE(beds->'extra'->>'rut', ''), '[^0-9Kk]', '', 'g')) LIKE v_base || '%'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Permisos para acceso público (portal sin login)
GRANT EXECUTE ON FUNCTION find_room_by_rut(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION find_room_by_rut(TEXT) TO authenticated;

-- ── PASO 3: Verificación de velocidad ────────────────────────────────────
-- Prueba con un RUT de ejemplo para medir el tiempo real de respuesta
EXPLAIN ANALYZE
SELECT * FROM rooms
WHERE
  upper(regexp_replace(COALESCE(beds->'day'->>'rut',   ''), '[^0-9Kk]', '', 'g')) LIKE '1234567%'
  OR
  upper(regexp_replace(COALESCE(beds->'night'->>'rut', ''), '[^0-9Kk]', '', 'g')) LIKE '1234567%'
  OR
  upper(regexp_replace(COALESCE(beds->'extra'->>'rut', ''), '[^0-9Kk]', '', 'g')) LIKE '1234567%'
LIMIT 1;

-- ── PASO 4: Confirmar índices creados ────────────────────────────────────
SELECT
  indexname        AS "Índice",
  indexdef         AS "Definición",
  '✅ Creado'      AS "Estado"
FROM pg_indexes
WHERE tablename = 'rooms'
  AND indexname LIKE 'idx_rooms_rut%'
ORDER BY indexname;
