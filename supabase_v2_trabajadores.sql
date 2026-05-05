-- ═══════════════════════════════════════════════════════════════
--  v2_trabajadores — Padrón de trabajadores del campamento
--  Ejecutar en Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v2_trabajadores (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    rut        VARCHAR(12)  NOT NULL UNIQUE,   -- formato: 12345678-9
    nombre     VARCHAR(255) NOT NULL,
    sexo       VARCHAR(10),                    -- 'M' o 'F'
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  v2_trabajadores        IS 'Padrón de trabajadores del campamento.';
COMMENT ON COLUMN v2_trabajadores.rut    IS 'RUT sin puntos, con guión: 12345678-9';
COMMENT ON COLUMN v2_trabajadores.nombre IS 'Nombre completo del trabajador.';
COMMENT ON COLUMN v2_trabajadores.sexo   IS 'M = Masculino, F = Femenino';

-- Índice para búsqueda rápida por RUT
CREATE INDEX IF NOT EXISTS idx_v2_trabajadores_rut ON v2_trabajadores (rut);

-- Índice para búsqueda por nombre (para autocompletado)
CREATE INDEX IF NOT EXISTS idx_v2_trabajadores_nombre ON v2_trabajadores (nombre);

-- RLS
ALTER TABLE v2_trabajadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_trabajadores_auth" ON v2_trabajadores;
CREATE POLICY "v2_trabajadores_auth"
    ON v2_trabajadores
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Función RPC para buscar por RUT (búsqueda parcial, autocomplete)
CREATE OR REPLACE FUNCTION v2_buscar_trabajador(p_rut TEXT)
RETURNS TABLE (rut VARCHAR, nombre VARCHAR, sexo VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT rut, nombre, sexo
    FROM v2_trabajadores
    WHERE rut ILIKE p_rut || '%'
       OR rut = p_rut
    ORDER BY rut
    LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION v2_buscar_trabajador TO authenticated;

-- Verificar
SELECT COUNT(*) AS total_trabajadores FROM v2_trabajadores;
