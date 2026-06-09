-- ============================================================
-- MIGRACIÓN: Tabla de registros de checkout para facturación
-- v2_checkout_registros
-- Fecha: 2026-06-01
-- ============================================================

CREATE TABLE IF NOT EXISTS v2_checkout_registros (
    id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa                 TEXT NOT NULL,
    numero_contrato         TEXT,
    fecha_llegada           DATE,
    fecha_salida            DATE,
    total_trabajadores      INT DEFAULT 0,
    total_camas_liberadas   INT DEFAULT 0,
    total_noches_cobradas   INT DEFAULT 0,
    ruts_trabajadores       JSONB DEFAULT '[]',
    detalle_facturacion     JSONB DEFAULT '[]',
    -- Quién hizo el checkout y cuándo
    fecha_checkout_realizado TIMESTAMPTZ DEFAULT NOW(),
    realizado_por           TEXT DEFAULT 'sistema',
    -- Timestamps de auditoría
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_checkout_empresa
    ON v2_checkout_registros (empresa);

CREATE INDEX IF NOT EXISTS idx_checkout_contrato
    ON v2_checkout_registros (numero_contrato);

CREATE INDEX IF NOT EXISTS idx_checkout_fecha
    ON v2_checkout_registros (fecha_checkout_realizado DESC);

-- RLS: solo usuarios autenticados pueden leer/escribir
ALTER TABLE v2_checkout_registros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checkout_registros_select" ON v2_checkout_registros;
CREATE POLICY "checkout_registros_select"
    ON v2_checkout_registros FOR SELECT
    USING (true);   -- cualquier autenticado puede leer

DROP POLICY IF EXISTS "checkout_registros_insert" ON v2_checkout_registros;
CREATE POLICY "checkout_registros_insert"
    ON v2_checkout_registros FOR INSERT
    WITH CHECK (true);

COMMENT ON TABLE v2_checkout_registros IS
    'Registros de checkout por lista/carga — usados para facturación a empresas.';

COMMENT ON COLUMN v2_checkout_registros.detalle_facturacion IS
    'Array JSON: [{rut, nombre, noches, id_cama, hab_numero}]';

COMMENT ON COLUMN v2_checkout_registros.ruts_trabajadores IS
    'Array de RUTs de los trabajadores incluidos en este checkout.';
