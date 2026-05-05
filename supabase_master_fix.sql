-- ════════════════════════════════════════════════════════════════════════════
-- PC HOTELERÍA — SQL MAESTRO (ÚNICO ARCHIVO A CORRER)
-- Idempotente: se puede ejecutar múltiples veces sin errores
-- Supabase → SQL Editor → New Query → RUN ▶
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: COLUMNAS FALTANTES EN TABLAS EXISTENTES
-- ─────────────────────────────────────────────────────────────────────────────

-- buildings: faltaba mainShift (usado en saveBuilding de infraestructura.js)
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS "mainShift"    TEXT DEFAULT 'mixed';
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS "floorConfigs" JSONB DEFAULT '{}';
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS notes          TEXT DEFAULT '';
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS shifts         JSONB DEFAULT '[]';

-- rooms: columnas de bloqueo y cama perdida
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "lostBedReason" TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "blockReason"   TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "blockedAt"     TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "blockedBed"    TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS notes           TEXT DEFAULT '';

-- b2b_requests: Admin Anglo y fecha de recepción
ALTER TABLE b2b_requests ADD COLUMN IF NOT EXISTS "angloAdmin"     TEXT;
ALTER TABLE b2b_requests ADD COLUMN IF NOT EXISTS "receivedDate"   TEXT;
ALTER TABLE b2b_requests ADD COLUMN IF NOT EXISTS "contractNumber" TEXT;
ALTER TABLE b2b_requests ADD COLUMN IF NOT EXISTS gerencia         TEXT;
ALTER TABLE b2b_requests ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE b2b_requests ADD COLUMN IF NOT EXISTS workers          JSONB DEFAULT '[]';


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: CREAR TABLAS QUE PUEDEN NO EXISTIR
-- ─────────────────────────────────────────────────────────────────────────────

-- censo_locks: bloqueo de piso por RUT (multi-dispositivo)
CREATE TABLE IF NOT EXISTS censo_locks (
    id          TEXT PRIMARY KEY,   -- formato: "buildingId__floor"
    rut         TEXT NOT NULL,
    floor_label TEXT,
    locked_at   TIMESTAMPTZ DEFAULT NOW()
);

-- gerencia_quotas: límites de cupos por gerencia
CREATE TABLE IF NOT EXISTS gerencia_quotas (
    id                TEXT PRIMARY KEY,
    company           TEXT,
    gerencia          TEXT,
    "limit"           INTEGER DEFAULT 0,
    "overrideAllowed" BOOLEAN DEFAULT false,
    "createdAt"       TEXT
);


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3: ROW LEVEL SECURITY (RLS) — todas las tablas
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE rooms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE buildings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE census          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gerencia_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE censo_locks     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all rooms"           ON rooms;
DROP POLICY IF EXISTS "Allow all buildings"       ON buildings;
DROP POLICY IF EXISTS "Allow all b2b_requests"    ON b2b_requests;
DROP POLICY IF EXISTS "Allow all census"          ON census;
DROP POLICY IF EXISTS "Allow all gerencia_quotas" ON gerencia_quotas;
DROP POLICY IF EXISTS "Allow all censo_locks"     ON censo_locks;

CREATE POLICY "Allow all rooms"           ON rooms           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all buildings"       ON buildings       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all b2b_requests"    ON b2b_requests    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all census"          ON census          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all gerencia_quotas" ON gerencia_quotas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all censo_locks"     ON censo_locks     FOR ALL USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 4: REALTIME — Replica Identity + Publication
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE rooms           REPLICA IDENTITY FULL;
ALTER TABLE buildings       REPLICA IDENTITY FULL;
ALTER TABLE b2b_requests    REPLICA IDENTITY FULL;
ALTER TABLE census          REPLICA IDENTITY FULL;
ALTER TABLE gerencia_quotas REPLICA IDENTITY FULL;
ALTER TABLE censo_locks     REPLICA IDENTITY FULL;

DO $$
DECLARE
  tbls TEXT[] := ARRAY[
    'rooms', 'buildings', 'b2b_requests',
    'census', 'gerencia_quotas', 'censo_locks'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
      RAISE NOTICE '✅ Agregado a Realtime: %', t;
    ELSE
      RAISE NOTICE '⏭ Ya estaba en Realtime: %', t;
    END IF;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 5: VERIFICACIÓN FINAL
-- Resultado esperado: 6 filas, todas con políticas y realtime = true
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
    t.table_name                                                        AS "Tabla",
    (SELECT COUNT(*) FROM pg_policies p
     WHERE p.tablename = t.table_name)                                  AS "Políticas RLS",
    EXISTS (
        SELECT 1 FROM pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime'
          AND pt.tablename = t.table_name
    )                                                                   AS "Realtime",
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime'
          AND pt.tablename = t.table_name
    ) THEN '✅' ELSE '❌' END                                            AS "Estado"
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'rooms','buildings','b2b_requests',
    'census','gerencia_quotas','censo_locks'
  )
ORDER BY t.table_name;
