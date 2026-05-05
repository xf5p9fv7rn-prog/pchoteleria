-- ═══════════════════════════════════════════════════════════════════
--  v2_solicitudes_b2b  —  Versión final con columnas en español
--  Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v2_solicitudes_b2b (
    id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    -- Empresa solicitante
    empresa         TEXT        NOT NULL,
    numero_contrato TEXT,
    gerencia        TEXT,
    -- Contacto
    nombre_contacto TEXT,
    email_contacto  TEXT,
    -- Período
    fecha_inicio    DATE,
    fecha_fin       DATE,
    -- Datos del grupo
    total_personas  INT         DEFAULT 0,
    turno           TEXT,
    genero          TEXT,
    -- Nómina completa como JSONB
    trabajadores    JSONB       DEFAULT '[]'::jsonb,
    -- Admin Anglo
    admin_anglo     TEXT,
    notas           TEXT,
    -- Estado del flujo
    status          TEXT        NOT NULL DEFAULT 'pendiente'
                                CHECK (status IN ('pendiente','aceptada','rechazada','parcial')),
    -- Resultados de asignación
    asignados       INT         DEFAULT 0,
    fallidos        INT         DEFAULT 0,
    log_asignacion  JSONB       DEFAULT '[]'::jsonb,
    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_sol_status     ON v2_solicitudes_b2b (status);
CREATE INDEX IF NOT EXISTS idx_v2_sol_created_at ON v2_solicitudes_b2b (created_at DESC);

ALTER TABLE v2_solicitudes_b2b ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_sol_b2b_anon_insert" ON v2_solicitudes_b2b;
CREATE POLICY "v2_sol_b2b_anon_insert"
    ON v2_solicitudes_b2b FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "v2_sol_b2b_auth_all" ON v2_solicitudes_b2b;
CREATE POLICY "v2_sol_b2b_auth_all"
    ON v2_solicitudes_b2b FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_v2_sol_b2b_ts()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_v2_sol_b2b_ts ON v2_solicitudes_b2b;
CREATE TRIGGER trg_v2_sol_b2b_ts
    BEFORE UPDATE ON v2_solicitudes_b2b
    FOR EACH ROW EXECUTE FUNCTION update_v2_sol_b2b_ts();

-- Agregar columna genero a v2_asignaciones si no existe
ALTER TABLE v2_asignaciones ADD COLUMN IF NOT EXISTS genero TEXT CHECK (genero IN ('M','F'));
