-- ════════════════════════════════════════════════════════════════════════════
-- PASO OBLIGATORIO: Políticas RLS para sincronización de datos
-- Ejecuta esto en: Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ROOMS ─────────────────────────────────────────────────────────────
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all rooms" ON rooms;
CREATE POLICY "Allow all rooms"
  ON rooms FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 2. B2B_REQUESTS ──────────────────────────────────────────────────────
ALTER TABLE b2b_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all b2b_requests" ON b2b_requests;
CREATE POLICY "Allow all b2b_requests"
  ON b2b_requests FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 3. BUILDINGS ─────────────────────────────────────────────────────────
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all buildings" ON buildings;
CREATE POLICY "Allow all buildings"
  ON buildings FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 4. CENSUS ────────────────────────────────────────────────────────────
ALTER TABLE census ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all census" ON census;
CREATE POLICY "Allow all census"
  ON census FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 5. GERENCIA_QUOTAS ───────────────────────────────────────────────────
ALTER TABLE gerencia_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all gerencia_quotas" ON gerencia_quotas;
CREATE POLICY "Allow all gerencia_quotas"
  ON gerencia_quotas FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 6. Habilitar Realtime (si no lo hiciste antes) ───────────────────────
ALTER TABLE rooms           REPLICA IDENTITY FULL;
ALTER TABLE b2b_requests    REPLICA IDENTITY FULL;
ALTER TABLE buildings       REPLICA IDENTITY FULL;
ALTER TABLE census          REPLICA IDENTITY FULL;
ALTER TABLE gerencia_quotas REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'rooms') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'b2b_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE b2b_requests;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'buildings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE buildings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'census') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE census;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'gerencia_quotas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE gerencia_quotas;
  END IF;
END $$;

-- ── Verificar que quedó bien ──────────────────────────────────────────────
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('rooms','b2b_requests','buildings','census','gerencia_quotas')
ORDER BY tablename;
