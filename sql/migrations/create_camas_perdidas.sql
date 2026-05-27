-- ══════════════════════════════════════════════════════════════
-- Tabla: v2_camas_perdidas
-- Registra camas vacías en habitaciones de doble ocupación
-- "Perdida" = hab con 2 camas donde solo 1 está ocupada
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS v2_camas_perdidas (
    id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    id_cama_perdida  text NOT NULL,          -- la cama vacía (Disponible)
    habitacion_id    text NOT NULL,
    motivo           text NOT NULL DEFAULT 'sin_motivo'
        CHECK (motivo IN (
            'acuerdo_anglo',
            'impar_mujer',
            'impar_hombre',
            'motivos_medicos',
            'motivos_personales',
            'otros',
            'sin_motivo'
        )),
    motivo_texto     text,                   -- campo libre si motivo = 'otros'
    empresa_nombre   text,                   -- empresa de la cama ocupada
    es_anglo         boolean DEFAULT false,  -- true si empresa es Anglo/AngloAmerican
    registrado_por   text,
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now(),
    UNIQUE (id_cama_perdida)                 -- una cama solo puede tener 1 motivo
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_cp_habitacion  ON v2_camas_perdidas (habitacion_id);
CREATE INDEX IF NOT EXISTS idx_cp_es_anglo    ON v2_camas_perdidas (es_anglo);
CREATE INDEX IF NOT EXISTS idx_cp_motivo      ON v2_camas_perdidas (motivo);

-- RLS
ALTER TABLE v2_camas_perdidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "autenticados_leer" ON v2_camas_perdidas
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "autenticados_escribir" ON v2_camas_perdidas
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
