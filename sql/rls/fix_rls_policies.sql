-- ══════════════════════════════════════════════════════════════
-- PASO 1: Ejecuta SOLO este bloque primero
-- FIX RLS para v2_solicitudes_b2b (tabla que ya existe)
-- ══════════════════════════════════════════════════════════════

-- Permitir inserción pública (formulario solicitud-empresa.html)
CREATE POLICY "public_puede_insertar"
ON v2_solicitudes_b2b
FOR INSERT
TO anon
WITH CHECK (true);

-- Personal autenticado puede leer
CREATE POLICY "auth_puede_leer"
ON v2_solicitudes_b2b
FOR SELECT
TO authenticated
USING (true);

-- Personal autenticado puede actualizar (aprobar/rechazar)
CREATE POLICY "auth_puede_actualizar"
ON v2_solicitudes_b2b
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Personal autenticado puede eliminar
CREATE POLICY "auth_puede_eliminar"
ON v2_solicitudes_b2b
FOR DELETE
TO authenticated
USING (true);


-- ══════════════════════════════════════════════════════════════
-- PASO 2: Ejecuta este bloque por separado DESPUÉS del paso 1
-- Crea la tabla v2_distribucion_camas y aplica sus políticas
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v2_distribucion_camas (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    id_cama       text NOT NULL,
    tipo          text NOT NULL CHECK (tipo IN ('noche', '4x3', 'reserva')),
    empresa       text,
    observacion   text,
    asignado_por  text,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now(),
    UNIQUE (id_cama)
);

ALTER TABLE v2_distribucion_camas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dist_auth_leer"
ON v2_distribucion_camas
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "dist_auth_escribir"
ON v2_distribucion_camas
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════
-- PASO 3: Ejecuta este bloque por separado DESPUÉS del paso 2
-- Crea la tabla v2_camas_perdidas y aplica sus políticas
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v2_camas_perdidas (
    id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    id_cama_perdida  text NOT NULL,
    habitacion_id    text NOT NULL,
    motivo           text NOT NULL DEFAULT 'sin_motivo'
        CHECK (motivo IN (
            'acuerdo_anglo', 'impar_mujer', 'impar_hombre',
            'motivos_medicos', 'motivos_personales', 'otros', 'sin_motivo'
        )),
    motivo_texto     text,
    empresa_nombre   text,
    es_anglo         boolean DEFAULT false,
    registrado_por   text,
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now(),
    UNIQUE (id_cama_perdida)
);

ALTER TABLE v2_camas_perdidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cp_auth_leer"
ON v2_camas_perdidas
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "cp_auth_escribir"
ON v2_camas_perdidas
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
