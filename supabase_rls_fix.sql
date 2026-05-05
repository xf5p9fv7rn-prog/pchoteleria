-- ════════════════════════════════════════════════════════════════════════════
-- REGLAS RLS + REALTIME COMPLETAS — PC Hotelería
-- Ejecuta esto en: Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ROOMS ─────────────────────────────────────────────────────────────
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all rooms" ON rooms;
CREATE POLICY "Allow all rooms"
  ON rooms FOR ALL USING (true) WITH CHECK (true);

-- ── 2. B2B_REQUESTS ──────────────────────────────────────────────────────
ALTER TABLE b2b_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all b2b_requests" ON b2b_requests;
CREATE POLICY "Allow all b2b_requests"
  ON b2b_requests FOR ALL USING (true) WITH CHECK (true);

-- ── 3. BUILDINGS ─────────────────────────────────────────────────────────
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all buildings" ON buildings;
CREATE POLICY "Allow all buildings"
  ON buildings FOR ALL USING (true) WITH CHECK (true);

-- ── 4. CENSUS ────────────────────────────────────────────────────────────
ALTER TABLE census ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all census" ON census;
CREATE POLICY "Allow all census"
  ON census FOR ALL USING (true) WITH CHECK (true);

-- ── 5. GERENCIA_QUOTAS ───────────────────────────────────────────────────
ALTER TABLE gerencia_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all gerencia_quotas" ON gerencia_quotas;
CREATE POLICY "Allow all gerencia_quotas"
  ON gerencia_quotas FOR ALL USING (true) WITH CHECK (true);

-- ── 6. CENSO_LOCKS (bloqueo de piso por RUT) ─────────────────────────────
CREATE TABLE IF NOT EXISTS censo_locks (
  id          TEXT PRIMARY KEY,   -- buildingId__floor
  rut         TEXT NOT NULL,
  floor_label TEXT,
  locked_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE censo_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all censo_locks" ON censo_locks;
CREATE POLICY "Allow all censo_locks"
  ON censo_locks FOR ALL USING (true) WITH CHECK (true);

-- ── 7. CENSUS_RECORDS (mega planilla histórica) ───────────────────────────
CREATE TABLE IF NOT EXISTS census_records (
  id         TEXT PRIMARY KEY,
  roomId     TEXT,
  date       TEXT,
  state      TEXT,
  rut        TEXT,
  timestamp  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE census_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all census_records" ON census_records;
CREATE POLICY "Allow all census_records"
  ON census_records FOR ALL USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════════
-- REALTIME: Habilitar replicación en todas las tablas
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE rooms           REPLICA IDENTITY FULL;
ALTER TABLE buildings       REPLICA IDENTITY FULL;
ALTER TABLE b2b_requests    REPLICA IDENTITY FULL;
ALTER TABLE census          REPLICA IDENTITY FULL;
ALTER TABLE gerencia_quotas REPLICA IDENTITY FULL;
ALTER TABLE censo_locks     REPLICA IDENTITY FULL;
ALTER TABLE census_records  REPLICA IDENTITY FULL;

DO $$
DECLARE
  tbls TEXT[] := ARRAY[
    'rooms','buildings','b2b_requests',
    'census','gerencia_quotas','censo_locks','census_records'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
      RAISE NOTICE 'Added % to supabase_realtime', t;
    ELSE
      RAISE NOTICE '% already in supabase_realtime — skip', t;
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — Deberías ver 7 tablas en el resultado
-- ════════════════════════════════════════════════════════════════════════════

SELECT
  p.tablename                         AS "Tabla",
  pol.policyname                      AS "Política RLS",
  CASE WHEN rt.tablename IS NOT NULL
       THEN '✅ SÍ' ELSE '❌ NO' END  AS "Realtime"
FROM (
  VALUES
    ('rooms'),('buildings'),('b2b_requests'),('census'),
    ('gerencia_quotas'),('censo_locks'),('census_records')
) AS p(tablename)
LEFT JOIN pg_policies pol
  ON pol.tablename = p.tablename
LEFT JOIN pg_publication_tables rt
  ON rt.pubname = 'supabase_realtime' AND rt.tablename = p.tablename
ORDER BY p.tablename;
