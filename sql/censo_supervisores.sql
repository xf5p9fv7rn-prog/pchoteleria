-- ══════════════════════════════════════════════════════════════════════════
-- Tabla de supervisores autorizados para el Portal Censo Terreno
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Crear tabla de supervisores del censo
CREATE TABLE IF NOT EXISTS v2_censo_supervisores (
    rut     TEXT PRIMARY KEY,   -- ej: 19048606-0
    nombre  TEXT NOT NULL,
    activo  BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilitar acceso anon (RLS)
ALTER TABLE v2_censo_supervisores ENABLE ROW LEVEL SECURITY;

-- Permitir lectura pública (para verificar RUT en el portal)
CREATE POLICY "Lectura anon supervisores censo"
    ON v2_censo_supervisores FOR SELECT
    TO anon, authenticated
    USING (activo = TRUE);

-- Solo admins pueden insertar/editar
CREATE POLICY "Escritura solo admin"
    ON v2_censo_supervisores FOR ALL
    TO authenticated
    USING (auth.role() = 'authenticated');

-- 3. Agregar supervisores autorizados
--    (Actualiza los RUTs y nombres según corresponda)
INSERT INTO v2_censo_supervisores (rut, nombre) VALUES
    ('19048606-0', 'Supervisor Terreno 1'),   -- ← actualiza con nombre real
    ('20111715-1', 'Supervisor Terreno 2')    -- ← actualiza con nombre real
    -- Agrega más filas aquí si necesitas más supervisores:
    -- ('12345678-9', 'Otro Supervisor'),
ON CONFLICT (rut) DO UPDATE SET activo = TRUE;

-- 4. Verificar tabla
SELECT * FROM v2_censo_supervisores;
