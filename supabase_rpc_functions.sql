-- ════════════════════════════════════════════════════════════════════════════
-- PC HOTELERÍA — FUNCIONES RPC SERVIDOR (Ultra-eficientes)
-- Ejecuta en: Supabase → SQL Editor → New Query → RUN ▶
--
-- SIN estas funciones: cada consulta descarga hasta 1416 filas completas (~700KB)
-- CON estas funciones: cada consulta retorna solo lo necesario (1-5 filas ≈ 2KB)
--
-- Reducción de bandwidth: hasta 99.7%
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. BÚSQUEDA POR RUT — Portal mi-habitacion.html
--    Uso: cada trabajador busca su habitación al hacer check-in
--    Sin función: descarga 1416 habitaciones (~700 KB)
--    Con función: devuelve 1 habitación (~500 bytes) = 99.9% menos datos
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION find_room_by_rut(p_rut TEXT)
RETURNS SETOF rooms AS $$
DECLARE
  v_rut_clean TEXT;
  v_rut_base  TEXT;
BEGIN
  -- Normalizar el RUT de entrada (quitar puntos, guion, espacios)
  v_rut_clean := upper(regexp_replace(p_rut, '[^0-9Kk]', '', 'g'));
  -- Base sin verifier (últimos 8 dígitos base)
  v_rut_base  := left(v_rut_clean, length(v_rut_clean) - 1);

  -- Buscar en las 3 camas normalizando también el valor almacenado
  RETURN QUERY
  SELECT * FROM rooms
  WHERE (
    -- Cama día
    (beds->'day'->>'rut' IS NOT NULL AND
      upper(regexp_replace(beds->'day'->>'rut', '[^0-9Kk]', '', 'g'))
        LIKE '%' || v_rut_base || '%')
    OR
    -- Cama noche
    (beds->'night'->>'rut' IS NOT NULL AND
      upper(regexp_replace(beds->'night'->>'rut', '[^0-9Kk]', '', 'g'))
        LIKE '%' || v_rut_base || '%')
    OR
    -- Cama extra
    (beds->'extra'->>'rut' IS NOT NULL AND
      upper(regexp_replace(beds->'extra'->>'rut', '[^0-9Kk]', '', 'g'))
        LIKE '%' || v_rut_base || '%')
  )
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Permisos públicos (portal sin login)
GRANT EXECUTE ON FUNCTION find_room_by_rut(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION find_room_by_rut(TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. RESUMEN DEL CAMPAMENTO — Constanza IA / Dashboard
--    Uso: cuando se pide el "estado general" del campamento
--    Sin función: descarga 1416 filas completas con todos los datos JSONB
--    Con función: devuelve 5 números (#libres, ocupadas, bloqueadas, camas, trabajadores)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_camp_summary()
RETURNS JSON AS $$
DECLARE
  v_total       INT;
  v_libres      INT;
  v_ocupadas    INT;
  v_bloqueadas  INT;
  v_trabajadores INT;
BEGIN
  SELECT
    COUNT(*)                                                          INTO v_total
  FROM rooms;

  SELECT
    COUNT(*) FILTER (WHERE status = 'free')                           INTO v_libres
  FROM rooms;

  SELECT
    COUNT(*) FILTER (WHERE status = 'occupied')                       INTO v_ocupadas
  FROM rooms;

  SELECT
    COUNT(*) FILTER (WHERE status IN ('blocked','bed-blocked'))       INTO v_bloqueadas
  FROM rooms;

  -- Contar trabajadores sumando camas ocupadas (day + night + extra)
  SELECT
    COUNT(*) FILTER (WHERE beds->'day'->>'occupant' IS NOT NULL AND beds->'day'->>'occupant' != '')
    +
    COUNT(*) FILTER (WHERE beds->'night'->>'occupant' IS NOT NULL AND beds->'night'->>'occupant' != '')
    +
    COUNT(*) FILTER (WHERE beds->'extra'->>'occupant' IS NOT NULL AND beds->'extra'->>'occupant' != '')
    INTO v_trabajadores
  FROM rooms;

  RETURN json_build_object(
    'total',        v_total,
    'libres',       v_libres,
    'ocupadas',     v_ocupadas,
    'bloqueadas',   v_bloqueadas,
    'trabajadores', v_trabajadores
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_camp_summary() TO anon;
GRANT EXECUTE ON FUNCTION get_camp_summary() TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. CHECK-IN DE TRABAJADOR — Actualizar solo el campo `beds` de 1 habitación
--    Sin función: el cliente descarga la habitación, modifica en JS, y envía todo de vuelta
--    Con función: el servidor modifica solo el JSONB internamente (0 descarga extra)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION checkin_by_rut(
  p_rut       TEXT,
  p_action    TEXT DEFAULT 'checkin',  -- 'checkin' o 'checkout'
  p_timestamp TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_room      rooms%ROWTYPE;
  v_bed_key   TEXT;
  v_now       TEXT;
  v_updated   BOOL := FALSE;
BEGIN
  v_now := COALESCE(p_timestamp, to_char(NOW() AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD"T"HH24:MI:SS'));

  -- Buscar la habitación que tiene este RUT
  SELECT * INTO v_room FROM rooms
  WHERE
    (beds->'day'->>'rut'   ILIKE '%' || p_rut || '%') OR
    (beds->'night'->>'rut' ILIKE '%' || p_rut || '%') OR
    (beds->'extra'->>'rut' ILIKE '%' || p_rut || '%')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'RUT no encontrado');
  END IF;

  -- Determinar en qué cama está
  IF v_room.beds->'day'->>'rut' ILIKE '%' || p_rut || '%' THEN
    v_bed_key := 'day';
  ELSIF v_room.beds->'night'->>'rut' ILIKE '%' || p_rut || '%' THEN
    v_bed_key := 'night';
  ELSE
    v_bed_key := 'extra';
  END IF;

  -- Aplicar la acción
  IF p_action = 'checkin' THEN
    UPDATE rooms SET
      beds = jsonb_set(
        jsonb_set(
          jsonb_set(beds, ARRAY[v_bed_key, 'present'], 'true'),
          ARRAY[v_bed_key, 'lastCheckIn'], to_jsonb(v_now)
        ),
        ARRAY[v_bed_key, 'checkoutPending'], 'false'
      )
    WHERE id = v_room.id;
    v_updated := TRUE;

  ELSIF p_action = 'checkout' THEN
    UPDATE rooms SET
      beds = jsonb_set(
        jsonb_set(beds, ARRAY[v_bed_key, 'checkoutPending'], 'true'),
        ARRAY[v_bed_key, 'checkoutRequestedAt'], to_jsonb(v_now)
      )
    WHERE id = v_room.id;
    v_updated := TRUE;
  END IF;

  RETURN json_build_object(
    'success',    v_updated,
    'roomId',     v_room.id,
    'roomNumber', v_room.number,
    'bedKey',     v_bed_key,
    'action',     p_action,
    'timestamp',  v_now
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION checkin_by_rut(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION checkin_by_rut(TEXT, TEXT, TEXT) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN: Confirmar que las 3 funciones fueron creadas
-- ════════════════════════════════════════════════════════════════════════════
SELECT
  routine_name       AS "Función",
  routine_type       AS "Tipo",
  '✅ Creada'        AS "Estado"
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('find_room_by_rut', 'get_camp_summary', 'checkin_by_rut')
ORDER BY routine_name;
