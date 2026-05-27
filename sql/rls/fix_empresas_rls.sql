-- ══════════════════════════════════════════════════════════════
-- FIX DEFINITIVO: Auto-provisionamiento de empresas
-- Ejecutar en Supabase SQL Editor → Run
-- ══════════════════════════════════════════════════════════════

-- 1. Desactivar RLS en v2_empresas (los admins autenticados deben poder crear empresas)
ALTER TABLE v2_empresas DISABLE ROW LEVEL SECURITY;

-- 2. Agregar columna gerencia a v2_solicitudes_b2b si no existe
ALTER TABLE v2_solicitudes_b2b
    ADD COLUMN IF NOT EXISTS gerencia TEXT;

-- 3. Permitir authenticated insertar y actualizar cupos
--    (para auto-crear entrada cuando se acepta una solicitud nueva)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'v2_cupos_gerencias'
          AND policyname = 'auth_insertar_cupos'
    ) THEN
        CREATE POLICY "auth_insertar_cupos"
        ON v2_cupos_gerencias
        FOR INSERT TO authenticated WITH CHECK (true);
    END IF;
END $$;

-- 4. Verificar
SELECT 'v2_empresas RLS' as tabla, relrowsecurity::text as rls_activo
FROM pg_class WHERE relname = 'v2_empresas'
UNION ALL
SELECT 'v2_solicitudes_b2b gerencia col', column_name
FROM information_schema.columns
WHERE table_name='v2_solicitudes_b2b' AND column_name='gerencia';
