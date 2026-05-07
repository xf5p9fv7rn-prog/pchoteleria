-- Ejecutar en Supabase → SQL Editor
-- Tabla para guardar cierres de período de facturación

CREATE TABLE IF NOT EXISTS v2_facturacion_cierres (
    id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    periodo_ini     date        NOT NULL,
    periodo_fin     date        NOT NULL,
    periodo_label   text        NOT NULL,
    total_camas_dia integer     NOT NULL DEFAULT 0,
    total_contratos integer     NOT NULL DEFAULT 0,
    total_trab      integer     NOT NULL DEFAULT 0,
    detalle_json    jsonb       NOT NULL DEFAULT '[]',
    cerrado_por     text        NOT NULL,
    cerrado_en      timestamptz DEFAULT now(),
    estado          text        NOT NULL DEFAULT 'guardado',  -- guardado / facturado / anulado
    notas           text
);

-- Índice para consulta rápida por período
CREATE INDEX IF NOT EXISTS idx_fc_periodo ON v2_facturacion_cierres (periodo_ini DESC);

-- RLS: solo usuarios autenticados pueden leer/escribir
ALTER TABLE v2_facturacion_cierres ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_only" ON v2_facturacion_cierres
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
