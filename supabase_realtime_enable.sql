-- ════════════════════════════════════════════════════════════════
-- PASO OBLIGATORIO: Habilitar Realtime en Supabase
-- Ejecuta esto en: Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════

-- Habilitar replicación en las tablas críticas
ALTER TABLE rooms         REPLICA IDENTITY FULL;
ALTER TABLE buildings     REPLICA IDENTITY FULL;
ALTER TABLE b2b_requests  REPLICA IDENTITY FULL;
ALTER TABLE census        REPLICA IDENTITY FULL;

-- Agregar las tablas a la publicación de realtime
-- (correr cada línea por separado si alguna falla)
DO $$
BEGIN
  -- rooms
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
  END IF;

  -- buildings
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'buildings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE buildings;
  END IF;

  -- b2b_requests
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'b2b_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE b2b_requests;
  END IF;

  -- census
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'census'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE census;
  END IF;
END $$;

-- Verificar que quedó habilitado:
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
