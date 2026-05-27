-- ════════════════════════════════════════════════════════════════
-- v2_censo_trabajadores — versión segura (re-ejecutable)
-- ════════════════════════════════════════════════════════════════

-- Tabla (solo crea si no existe)
CREATE TABLE IF NOT EXISTS v2_censo_trabajadores (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  numero_hab        TEXT NOT NULL,
  rut_trabajador    TEXT NOT NULL,
  nombre_trabajador TEXT,
  empresa           TEXT,
  fecha_scan        DATE NOT NULL DEFAULT CURRENT_DATE,
  hora_scan         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  asignacion_id     UUID REFERENCES v2_asignaciones(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (numero_hab, rut_trabajador, fecha_scan)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_censo_fecha ON v2_censo_trabajadores(fecha_scan);
CREATE INDEX IF NOT EXISTS idx_censo_hab   ON v2_censo_trabajadores(numero_hab);
CREATE INDEX IF NOT EXISTS idx_censo_rut   ON v2_censo_trabajadores(rut_trabajador);

-- RLS
ALTER TABLE v2_censo_trabajadores ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas si ya existen (para re-ejecución segura)
DROP POLICY IF EXISTS "censo_insert_anon" ON v2_censo_trabajadores;
DROP POLICY IF EXISTS "censo_select_anon" ON v2_censo_trabajadores;

-- Cualquiera puede insertar (trabajadores sin login)
CREATE POLICY "censo_insert_anon" ON v2_censo_trabajadores
  FOR INSERT WITH CHECK (true);

-- Cualquiera puede leer (para verificar si ya escaneó hoy)
CREATE POLICY "censo_select_anon" ON v2_censo_trabajadores
  FOR SELECT USING (true);
