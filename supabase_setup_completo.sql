-- ════════════════════════════════════════════════════════════════════════════════
-- PC HOTELERÍA — SETUP COMPLETO DE SUPABASE
-- Ejecuta TODO esto en: Supabase → SQL Editor → New Query → RUN ▶
-- ════════════════════════════════════════════════════════════════════════════════

-- 1. TABLE: buildings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buildings (
    id          BIGINT PRIMARY KEY,
    name        TEXT,
    code        TEXT,
    type        TEXT DEFAULT 'building',
    floor       INTEGER DEFAULT 1,
    capacity    INTEGER DEFAULT 0,
    shifts      JSONB DEFAULT '[]',
    notes       TEXT DEFAULT '',
    "floorConfigs" JSONB DEFAULT '{}'
);

ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all buildings" ON buildings;
CREATE POLICY "Allow all buildings" ON buildings FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE buildings REPLICA IDENTITY FULL;


-- 2. TABLE: rooms
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
    id              BIGINT PRIMARY KEY,
    "buildingId"    BIGINT,
    number          TEXT,
    floor           INTEGER DEFAULT 1,
    "bedCount"      INTEGER DEFAULT 2,
    status          TEXT DEFAULT 'free',
    gender          TEXT,
    "reservedCompany" TEXT DEFAULT '',
    "reservedShift"   TEXT DEFAULT '',
    beds            JSONB DEFAULT '{}',
    "lostBedReason" TEXT,
    notes           TEXT DEFAULT ''
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all rooms" ON rooms;
CREATE POLICY "Allow all rooms" ON rooms FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE rooms REPLICA IDENTITY FULL;

-- Agregar columna lostBedReason si no existe (por compatibilidad con tablas previas)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "lostBedReason" TEXT;


-- 3. TABLE: b2b_requests
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_requests (
    id              TEXT PRIMARY KEY,
    company         TEXT,
    "contactName"   TEXT,
    "contactEmail"  TEXT,
    "contactPhone"  TEXT,
    "startDate"     TEXT,
    "endDate"       TEXT,
    "totalPeople"   INTEGER,
    shift           TEXT,
    gender          TEXT,
    "specialNeeds"  TEXT,
    status          TEXT DEFAULT 'pending',
    "createdAt"     TEXT,
    workers         JSONB DEFAULT '[]',
    "contractNumber" TEXT,
    gerencia        TEXT,
    notes           TEXT
);

ALTER TABLE b2b_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all b2b_requests" ON b2b_requests;
CREATE POLICY "Allow all b2b_requests" ON b2b_requests FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE b2b_requests REPLICA IDENTITY FULL;


-- 4. TABLE: census
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS census (
    id          TEXT PRIMARY KEY,
    "roomId"    BIGINT,
    date        TEXT,
    state       TEXT,
    "updatedBy" TEXT,
    "updatedAt" TEXT
);

ALTER TABLE census ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all census" ON census;
CREATE POLICY "Allow all census" ON census FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE census REPLICA IDENTITY FULL;


-- 5. TABLE: gerencia_quotas  ← CRÍTICA: id es TEXT (no entero)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gerencia_quotas (
    id                  TEXT PRIMARY KEY,
    company             TEXT,
    gerencia            TEXT,
    "limit"             INTEGER DEFAULT 0,
    "overrideAllowed"   BOOLEAN DEFAULT false,
    "createdAt"         TEXT
);

ALTER TABLE gerencia_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all gerencia_quotas" ON gerencia_quotas;
CREATE POLICY "Allow all gerencia_quotas" ON gerencia_quotas FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE gerencia_quotas REPLICA IDENTITY FULL;


-- 6. TABLE: censo_locks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS censo_locks (
    id          TEXT PRIMARY KEY,
    rut         TEXT NOT NULL,
    floor_label TEXT,
    locked_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE censo_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all censo_locks" ON censo_locks;
CREATE POLICY "Allow all censo_locks" ON censo_locks FOR ALL USING (true) WITH CHECK (true);


-- 7. Habilitar Realtime en todas las tablas
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tables TEXT[] := ARRAY['rooms','buildings','b2b_requests','census','gerencia_quotas'];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
      RAISE NOTICE 'Added % to realtime', t;
    ELSE
      RAISE NOTICE '% already in realtime', t;
    END IF;
  END LOOP;
END $$;


-- 8. Verificación final
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    t.table_name,
    (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = t.table_name) AS policies,
    EXISTS (
        SELECT 1 FROM pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime' AND pt.tablename = t.table_name
    ) AS realtime_enabled
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN ('rooms','buildings','b2b_requests','census','gerencia_quotas','censo_locks')
ORDER BY t.table_name;
