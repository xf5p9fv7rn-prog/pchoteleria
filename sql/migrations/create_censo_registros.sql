-- ============================================================
-- TABLA: v2_censo_registros
-- Registro diario del censo de camas por las hoteleras
-- Periodo de facturación: 21 al 20 de cada mes
-- ============================================================

CREATE TABLE IF NOT EXISTS v2_censo_registros (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha         DATE         NOT NULL,
  habitacion_id TEXT         NOT NULL,   -- id_custom de v2_habitaciones
  pabellon_id   UUID,
  edificio_id   UUID,
  estado        TEXT         NOT NULL
                             CHECK (estado IN ('sin_ocupar','dia','noche','2_dia','2_noche')),
  registrado_por TEXT        DEFAULT 'Hotelera',
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(fecha, habitacion_id)
);

-- Permisos (portal público sin auth)
ALTER TABLE v2_censo_registros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "censo_public" ON v2_censo_registros;
CREATE POLICY "censo_public" ON v2_censo_registros
  FOR ALL USING (true) WITH CHECK (true);

-- Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_censo_fecha       ON v2_censo_registros(fecha);
CREATE INDEX IF NOT EXISTS idx_censo_fecha_pab   ON v2_censo_registros(fecha, pabellon_id);
CREATE INDEX IF NOT EXISTS idx_censo_habitacion  ON v2_censo_registros(habitacion_id);
