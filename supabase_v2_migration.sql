-- ════════════════════════════════════════════════════════════════════════════════
-- CAMPAMENTOS PEREZ — MÓDULO V2: MIGRACIÓN COMPLETA
-- Arquitectura: Infraestructura → Empresas/Gerencias → Ocupación
--
-- REGLA DE AISLAMIENTO: Este script SOLO crea tablas con prefijo v2_.
-- Las tablas del sistema antiguo (buildings, rooms, b2b_requests, census,
-- gerencia_quotas, censo_locks) NO son tocadas en ningún momento.
--
-- Cómo ejecutar: Supabase → SQL Editor → New Query → pegar TODO → RUN ▶
-- ════════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1: MÓDULO DE INFRAESTRUCTURA
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1  v2_edificios
-- Representa cada edificio/campamento físico (ej: "Campamento Perez", "Edificio 220")
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_edificios (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  v2_edificios         IS 'Edificios o campamentos físicos (ej: Campamento Perez, Edificio 220).';
COMMENT ON COLUMN v2_edificios.nombre  IS 'Nombre descriptivo del edificio.';

-- Índice de búsqueda por nombre
CREATE INDEX IF NOT EXISTS idx_v2_edificios_nombre ON v2_edificios (nombre);

-- RLS
ALTER TABLE v2_edificios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_edificios_crud_authenticated" ON v2_edificios;
CREATE POLICY "v2_edificios_crud_authenticated"
    ON v2_edificios
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);


-- 1.2  v2_pabellones
-- Pabellón dentro de un edificio (ej: P-1, P-2)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_pabellones (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edificio_id  UUID NOT NULL REFERENCES v2_edificios (id)
                     ON UPDATE CASCADE
                     ON DELETE RESTRICT,
    nombre       VARCHAR(100) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  v2_pabellones              IS 'Pabellones dentro de un edificio.';
COMMENT ON COLUMN v2_pabellones.edificio_id  IS 'FK → v2_edificios.id';
COMMENT ON COLUMN v2_pabellones.nombre       IS 'Nombre del pabellón (ej: P-1).';

CREATE INDEX IF NOT EXISTS idx_v2_pabellones_edificio ON v2_pabellones (edificio_id);

-- RLS
ALTER TABLE v2_pabellones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_pabellones_crud_authenticated" ON v2_pabellones;
CREATE POLICY "v2_pabellones_crud_authenticated"
    ON v2_pabellones
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);


-- 1.3  v2_habitaciones
-- Habitación dentro de un pabellón. PK = código custom (ej: 'COPC000001')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_habitaciones (
    id_custom      VARCHAR(20) PRIMARY KEY,          -- ej: 'COPC000001'
    pabellon_id    UUID        NOT NULL REFERENCES v2_pabellones (id)
                                   ON UPDATE CASCADE
                                   ON DELETE RESTRICT,
    nivel          VARCHAR(20) NOT NULL,              -- ej: 'Nivel 1', 'Piso 2'
    numero_hab     VARCHAR(20) NOT NULL,              -- ej: '101', 'A-5'
    cantidad_camas INT         NOT NULL DEFAULT 2 CHECK (cantidad_camas >= 0), -- 0 = bloqueada/sin camas
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  v2_habitaciones               IS 'Habitaciones dentro de un pabellón.';
COMMENT ON COLUMN v2_habitaciones.id_custom     IS 'Código único de habitación (ej: COPC000001).';
COMMENT ON COLUMN v2_habitaciones.pabellon_id   IS 'FK → v2_pabellones.id';
COMMENT ON COLUMN v2_habitaciones.nivel         IS 'Nivel o piso de la habitación.';
COMMENT ON COLUMN v2_habitaciones.numero_hab    IS 'Número o código de la habitación.';
COMMENT ON COLUMN v2_habitaciones.cantidad_camas IS 'Cantidad total de camas en la habitación.';

CREATE INDEX IF NOT EXISTS idx_v2_habitaciones_pabellon ON v2_habitaciones (pabellon_id);

-- RLS
ALTER TABLE v2_habitaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_habitaciones_crud_authenticated" ON v2_habitaciones;
CREATE POLICY "v2_habitaciones_crud_authenticated"
    ON v2_habitaciones
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);


-- 1.4  v2_camas
-- Cama individual dentro de una habitación. PK = código custom (ej: 'COPC000001-C1')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_camas (
    id_cama        VARCHAR(30) PRIMARY KEY,          -- ej: 'COPC000001-C1'
    habitacion_id  VARCHAR(20) NOT NULL REFERENCES v2_habitaciones (id_custom)
                                   ON UPDATE CASCADE
                                   ON DELETE RESTRICT,
    numero_cama    INT         NOT NULL CHECK (numero_cama > 0),
    estado         VARCHAR(20) NOT NULL DEFAULT 'Disponible'
                               CHECK (estado IN ('Disponible', 'Ocupada', 'Mantencion')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  v2_camas               IS 'Camas individuales dentro de una habitación.';
COMMENT ON COLUMN v2_camas.id_cama       IS 'Código único de la cama (ej: COPC000001-C1).';
COMMENT ON COLUMN v2_camas.habitacion_id IS 'FK → v2_habitaciones.id_custom';
COMMENT ON COLUMN v2_camas.numero_cama  IS 'Número de la cama dentro de la habitación.';
COMMENT ON COLUMN v2_camas.estado        IS 'Estado actual: Disponible | Ocupada | Mantencion.';

CREATE INDEX IF NOT EXISTS idx_v2_camas_habitacion ON v2_camas (habitacion_id);
CREATE INDEX IF NOT EXISTS idx_v2_camas_estado     ON v2_camas (estado);

-- RLS
ALTER TABLE v2_camas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_camas_crud_authenticated" ON v2_camas;
CREATE POLICY "v2_camas_crud_authenticated"
    ON v2_camas
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2: MÓDULO DE EMPRESAS Y GERENCIAS
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1  v2_gerencias
-- Gerencia contratante (ej: "Gerencia Mina", "Gerencia Planta")
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_gerencias (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre            VARCHAR(255) NOT NULL,
    numero_contrato   VARCHAR(100),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  v2_gerencias                  IS 'Gerencias o unidades de negocio contratantes.';
COMMENT ON COLUMN v2_gerencias.nombre           IS 'Nombre de la gerencia (ej: Gerencia Mina).';
COMMENT ON COLUMN v2_gerencias.numero_contrato  IS 'Número de contrato asociado a la gerencia.';

CREATE INDEX IF NOT EXISTS idx_v2_gerencias_nombre ON v2_gerencias (nombre);

-- RLS
ALTER TABLE v2_gerencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_gerencias_crud_authenticated" ON v2_gerencias;
CREATE POLICY "v2_gerencias_crud_authenticated"
    ON v2_gerencias
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);


-- 2.2  v2_empresas
-- Empresa subcontratista asociada a una gerencia (ej: Aramark, Besalco)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_empresas (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    gerencia_id  UUID        NOT NULL REFERENCES v2_gerencias (id)
                                 ON UPDATE CASCADE
                                 ON DELETE RESTRICT,
    nombre       VARCHAR(255) NOT NULL,
    turno        VARCHAR(20),                        -- ej: '4x3', '7x7', '14x7'
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  v2_empresas             IS 'Empresas subcontratistas vinculadas a una gerencia.';
COMMENT ON COLUMN v2_empresas.gerencia_id IS 'FK → v2_gerencias.id';
COMMENT ON COLUMN v2_empresas.nombre      IS 'Nombre de la empresa (ej: Aramark, Besalco).';
COMMENT ON COLUMN v2_empresas.turno       IS 'Turno operativo de la empresa (ej: 4x3, 7x7).';

CREATE INDEX IF NOT EXISTS idx_v2_empresas_gerencia ON v2_empresas (gerencia_id);

-- RLS
ALTER TABLE v2_empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_empresas_crud_authenticated" ON v2_empresas;
CREATE POLICY "v2_empresas_crud_authenticated"
    ON v2_empresas
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3: MÓDULO DE OCUPACIÓN
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1  v2_asignaciones
-- Registro de check-in / check-out de un huésped en una cama específica
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_asignaciones (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    id_cama          VARCHAR(30) NOT NULL REFERENCES v2_camas (id_cama)
                                     ON UPDATE CASCADE
                                     ON DELETE RESTRICT,
    empresa_id       UUID        NOT NULL REFERENCES v2_empresas (id)
                                     ON UPDATE CASCADE
                                     ON DELETE RESTRICT,
    rut_huesped      VARCHAR(12) NOT NULL,           -- ej: '12345678-9'
    nombre_huesped   VARCHAR(255) NOT NULL,
    fecha_checkin    DATE        NOT NULL,
    fecha_checkout   DATE,                            -- NULL = aún alojado
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Integridad: el checkout no puede ser anterior al checkin
    CONSTRAINT chk_fechas CHECK (fecha_checkout IS NULL OR fecha_checkout >= fecha_checkin)
);

COMMENT ON TABLE  v2_asignaciones                IS 'Asignaciones de huéspedes a camas (check-in / check-out).';
COMMENT ON COLUMN v2_asignaciones.id_cama        IS 'FK → v2_camas.id_cama';
COMMENT ON COLUMN v2_asignaciones.empresa_id     IS 'FK → v2_empresas.id';
COMMENT ON COLUMN v2_asignaciones.rut_huesped    IS 'RUT del huésped (formato: 12345678-9).';
COMMENT ON COLUMN v2_asignaciones.nombre_huesped IS 'Nombre completo del huésped.';
COMMENT ON COLUMN v2_asignaciones.fecha_checkin  IS 'Fecha de ingreso.';
COMMENT ON COLUMN v2_asignaciones.fecha_checkout IS 'Fecha de salida. NULL indica estadía activa.';

CREATE INDEX IF NOT EXISTS idx_v2_asignaciones_cama      ON v2_asignaciones (id_cama);
CREATE INDEX IF NOT EXISTS idx_v2_asignaciones_empresa   ON v2_asignaciones (empresa_id);
CREATE INDEX IF NOT EXISTS idx_v2_asignaciones_rut       ON v2_asignaciones (rut_huesped);
CREATE INDEX IF NOT EXISTS idx_v2_asignaciones_checkin   ON v2_asignaciones (fecha_checkin);
-- Índice parcial para consultas de estadías activas (sin checkout)
CREATE INDEX IF NOT EXISTS idx_v2_asignaciones_activas
    ON v2_asignaciones (id_cama)
    WHERE fecha_checkout IS NULL;

-- RLS
ALTER TABLE v2_asignaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_asignaciones_crud_authenticated" ON v2_asignaciones;
CREATE POLICY "v2_asignaciones_crud_authenticated"
    ON v2_asignaciones
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 4: TRIGGER — updated_at automático en todas las tablas v2_
-- ─────────────────────────────────────────────────────────────────────────────

-- Función genérica reutilizable
CREATE OR REPLACE FUNCTION v2_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Aplicar trigger a cada tabla v2_
DO $$
DECLARE
    tbl TEXT;
    tbls TEXT[] := ARRAY[
        'v2_edificios',
        'v2_pabellones',
        'v2_habitaciones',
        'v2_camas',
        'v2_gerencias',
        'v2_empresas',
        'v2_asignaciones'
    ];
BEGIN
    FOREACH tbl IN ARRAY tbls LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
             CREATE TRIGGER trg_%s_updated_at
                 BEFORE UPDATE ON %I
                 FOR EACH ROW EXECUTE FUNCTION v2_set_updated_at();',
            tbl, tbl, tbl, tbl
        );
        RAISE NOTICE 'Trigger updated_at aplicado a %', tbl;
    END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 5: HABILITAR REALTIME en tablas v2_
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
    tbl  TEXT;
    tbls TEXT[] := ARRAY[
        'v2_edificios',
        'v2_pabellones',
        'v2_habitaciones',
        'v2_camas',
        'v2_gerencias',
        'v2_empresas',
        'v2_asignaciones'
    ];
BEGIN
    FOREACH tbl IN ARRAY tbls LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND tablename = tbl
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
            RAISE NOTICE 'Realtime habilitado para %', tbl;
        ELSE
            RAISE NOTICE '% ya estaba en realtime', tbl;
        END IF;
    END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 6: VERIFICACIÓN FINAL
-- Debe mostrar 7 tablas, cada una con ≥1 policy y realtime = true
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
    t.table_name                                                        AS tabla,
    (SELECT COUNT(*) FROM pg_policies p
     WHERE p.tablename = t.table_name)                                  AS policies,
    EXISTS (
        SELECT 1 FROM pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime'
          AND pt.tablename = t.table_name
    )                                                                   AS realtime
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name LIKE 'v2_%'
ORDER BY t.table_name;
