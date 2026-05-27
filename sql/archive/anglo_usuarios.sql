-- ================================================================
--  Módulo Anglo: Tabla de usuarios y registro de incidencias
--  Ejecutar en Supabase SQL Editor
-- ================================================================

-- 1. Tabla directorio de usuarios Anglo
CREATE TABLE IF NOT EXISTS v2_usuarios_anglo (
    id          BIGSERIAL PRIMARY KEY,
    rut         TEXT NOT NULL UNIQUE,
    nombre      TEXT NOT NULL,
    area        TEXT,
    cargo       TEXT,
    gerencia    TEXT,
    turno       TEXT,
    email       TEXT,
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsqueda rápida por RUT
CREATE INDEX IF NOT EXISTS idx_v2_anglo_rut ON v2_usuarios_anglo(rut);
CREATE INDEX IF NOT EXISTS idx_v2_anglo_nombre ON v2_usuarios_anglo USING GIN (to_tsvector('spanish', nombre));

-- 2. Tabla de asignaciones Anglo (habitación + llave)
CREATE TABLE IF NOT EXISTS v2_asignaciones_anglo (
    id              BIGSERIAL PRIMARY KEY,
    rut             TEXT NOT NULL REFERENCES v2_usuarios_anglo(rut),
    numero_hab      TEXT NOT NULL,
    fecha_asignacion DATE DEFAULT CURRENT_DATE,
    fecha_salida_prog DATE,
    llave_entregada BOOLEAN DEFAULT TRUE,
    llave_devuelta  BOOLEAN DEFAULT FALSE,
    fecha_devolucion DATE,
    activa          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_asig_anglo_rut ON v2_asignaciones_anglo(rut);

-- 3. Tabla de incidencias (sin llave / bajó anticipado)
CREATE TABLE IF NOT EXISTS v2_incidencias_anglo (
    id          BIGSERIAL PRIMARY KEY,
    rut         TEXT NOT NULL REFERENCES v2_usuarios_anglo(rut),
    tipo        TEXT NOT NULL CHECK (tipo IN ('sin_llave','bajo_anticipado')),
    fecha       DATE DEFAULT CURRENT_DATE,
    observacion TEXT,
    resuelto    BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_incid_rut ON v2_incidencias_anglo(rut);

-- 4. Vista resumen por usuario (contador de incidencias)
CREATE OR REPLACE VIEW v2_anglo_resumen AS
SELECT
    u.rut,
    u.nombre,
    u.cargo,
    u.gerencia,
    u.turno,
    a.numero_hab,
    a.llave_devuelta,
    a.fecha_salida_prog,
    COALESCE(sl.total, 0) AS veces_sin_llave,
    COALESCE(ba.total, 0) AS veces_bajo_anticipado
FROM v2_usuarios_anglo u
LEFT JOIN v2_asignaciones_anglo a ON a.rut = u.rut AND a.activa = TRUE
LEFT JOIN (
    SELECT rut, COUNT(*) AS total FROM v2_incidencias_anglo WHERE tipo = 'sin_llave' GROUP BY rut
) sl ON sl.rut = u.rut
LEFT JOIN (
    SELECT rut, COUNT(*) AS total FROM v2_incidencias_anglo WHERE tipo = 'bajo_anticipado' GROUP BY rut
) ba ON ba.rut = u.rut;

-- 5. RLS: acceso público de lectura para búsqueda por RUT
ALTER TABLE v2_usuarios_anglo     ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_asignaciones_anglo ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_incidencias_anglo  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anglo_usuarios_read"  ON v2_usuarios_anglo;
DROP POLICY IF EXISTS "anglo_asig_all"       ON v2_asignaciones_anglo;
DROP POLICY IF EXISTS "anglo_incid_all"      ON v2_incidencias_anglo;

CREATE POLICY "anglo_usuarios_read"  ON v2_usuarios_anglo     FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "anglo_asig_all"       ON v2_asignaciones_anglo FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "anglo_incid_all"      ON v2_incidencias_anglo  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- Agregar columna color_llave (verde/rojo) a asignaciones
ALTER TABLE v2_asignaciones_anglo
  ADD COLUMN IF NOT EXISTS color_llave TEXT DEFAULT 'verde'
    CHECK (color_llave IN ('verde','rojo'));
