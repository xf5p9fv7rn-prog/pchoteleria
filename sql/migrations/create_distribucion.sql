-- ══════════════════════════════════════════════════════════════════
-- Tabla: v2_distribucion_camas
-- Permite a los supervisores marcar camas por tipo de turno
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS v2_distribucion_camas (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    id_cama       text NOT NULL,
    tipo          text NOT NULL CHECK (tipo IN ('noche', '4x3', 'reserva')),
    empresa       text,
    observacion   text,
    asignado_por  text,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now(),
    UNIQUE (id_cama)   -- cada cama solo puede tener UN tipo a la vez
);

-- RLS: solo autenticados pueden leer/escribir
ALTER TABLE v2_distribucion_camas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "autenticados pueden leer" ON v2_distribucion_camas
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "autenticados pueden escribir" ON v2_distribucion_camas
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Vista útil para el dashboard
CREATE OR REPLACE VIEW v2_distribucion_resumen AS
SELECT
    tipo,
    COUNT(*) AS total
FROM v2_distribucion_camas
GROUP BY tipo;
