-- ════════════════════════════════════════════════════════════════════════════
-- PC HOTELERÍA — Función de búsqueda por RUT (optimizada para alta concurrencia)
-- Ejecuta en: Supabase → SQL Editor → New Query → RUN ▶
-- RESULTADO: En vez de descargar 1000 habitaciones, retorna solo la 1 que corresponde
-- ════════════════════════════════════════════════════════════════════════════

-- Función: busca la habitación de un trabajador por su RUT
-- Busca en todos los slots de cama (day, night, extra) del JSONB
CREATE OR REPLACE FUNCTION find_room_by_rut(p_rut TEXT)
RETURNS SETOF rooms AS $$
  SELECT * FROM rooms
  WHERE 
    (beds->'day'->>'rut'   ILIKE '%' || p_rut || '%') OR
    (beds->'night'->>'rut' ILIKE '%' || p_rut || '%') OR
    (beds->'extra'->>'rut' ILIKE '%' || p_rut || '%')
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Permitir ejecución pública (portal mi-habitacion no tiene login)
GRANT EXECUTE ON FUNCTION find_room_by_rut(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION find_room_by_rut(TEXT) TO authenticated;

-- Verificar que se creó correctamente
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'find_room_by_rut';
