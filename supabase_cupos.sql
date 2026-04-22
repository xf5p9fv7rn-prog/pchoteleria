-- ============================================================
-- SUPABASE: Tabla para Cupos por Gerencia
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Crear tabla gerencia_quotas
CREATE TABLE IF NOT EXISTS gerencia_quotas (
    id            TEXT PRIMARY KEY,
    company       TEXT NOT NULL,
    gerencia      TEXT NOT NULL,
    "limit"       INTEGER,               -- NULL = sin límite
    "overrideAllowed" BOOLEAN DEFAULT false,
    "updatedAt"   TIMESTAMPTZ DEFAULT NOW(),
    "updatedBy"   TEXT DEFAULT 'sistema'
);

-- 2. Índice para búsquedas rápidas por empresa+gerencia
CREATE UNIQUE INDEX IF NOT EXISTS gerencia_quotas_key_idx
    ON gerencia_quotas (LOWER(company), LOWER(gerencia));

-- 3. Activar Row Level Security
ALTER TABLE gerencia_quotas ENABLE ROW LEVEL SECURITY;

-- 4. Lectura pública (anon puede leer)
CREATE POLICY IF NOT EXISTS "quotas_select"
    ON gerencia_quotas FOR SELECT
    TO anon USING (true);

-- 5. Insert/Update/Delete solo para autenticados
CREATE POLICY IF NOT EXISTS "quotas_insert"
    ON gerencia_quotas FOR INSERT
    TO authenticated WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "quotas_update"
    ON gerencia_quotas FOR UPDATE
    TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "quotas_delete"
    ON gerencia_quotas FOR DELETE
    TO authenticated USING (true);
