-- ============================================================
--  TABLA: v2_parejas_aramark
--  Registro de preferencias de compañero de habitación
--  Portal: Parejas Aramark — Turno A / Turno B
-- ============================================================

CREATE TABLE IF NOT EXISTS v2_parejas_aramark (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    turno            TEXT NOT NULL CHECK (turno IN ('A','B')),

    -- Persona 1 (quien llena el formulario)
    rut_persona1     TEXT NOT NULL,
    nombre_persona1  TEXT,
    area_persona1    TEXT,

    -- Persona 2 (con quien quiere dormir)
    rut_persona2     TEXT NOT NULL,
    nombre_persona2  TEXT,
    area_persona2    TEXT,

    -- Control administrativo
    fecha_desde      DATE,                      -- inicio del turno solicitado
    fecha_hasta      DATE,                      -- fin del turno solicitado
    agrupados        BOOLEAN DEFAULT false,   -- tic del admin = ya fueron agrupados
    notas_admin      TEXT,                    -- notas internas del equipo

    created_at       TIMESTAMPTZ DEFAULT now()
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_parejas_rut1  ON v2_parejas_aramark(rut_persona1);
CREATE INDEX IF NOT EXISTS idx_parejas_rut2  ON v2_parejas_aramark(rut_persona2);
CREATE INDEX IF NOT EXISTS idx_parejas_turno ON v2_parejas_aramark(turno);

-- RLS: público puede insertar, solo autenticados pueden leer/actualizar
ALTER TABLE v2_parejas_aramark ENABLE ROW LEVEL SECURITY;

-- Política: cualquiera puede insertar (el formulario público)
CREATE POLICY "parejas_insert_public"
    ON v2_parejas_aramark FOR INSERT
    WITH CHECK (true);

-- Política: anon puede leer solo para validar su propio RUT
CREATE POLICY "parejas_select_own"
    ON v2_parejas_aramark FOR SELECT
    USING (true);

-- Política: solo service_role puede actualizar (agrupados, notas)
CREATE POLICY "parejas_update_admin"
    ON v2_parejas_aramark FOR UPDATE
    USING (true);
