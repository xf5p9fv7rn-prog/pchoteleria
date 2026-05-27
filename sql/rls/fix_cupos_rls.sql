-- ══════════════════════════════════════════════════════════════
-- FIX RLS: Permitir lectura pública en tablas del Check-in
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. v2_cupos_gerencias: el popover de check-in necesita leer los contratos
DROP POLICY IF EXISTS "cupos_anon_leer"   ON v2_cupos_gerencias;
DROP POLICY IF EXISTS "cupos_auth_leer"   ON v2_cupos_gerencias;
DROP POLICY IF EXISTS "cupos_public_leer" ON v2_cupos_gerencias;

CREATE POLICY "cupos_public_leer"
ON v2_cupos_gerencias
FOR SELECT
USING (true);   -- accesible para anon y authenticated

-- 2. v2_empresas: el check-in necesita buscar/crear empresas
DROP POLICY IF EXISTS "emp_anon_leer"   ON v2_empresas;
DROP POLICY IF EXISTS "emp_public_leer" ON v2_empresas;

CREATE POLICY "emp_public_leer"
ON v2_empresas
FOR SELECT
USING (true);

-- Permitir inserción de empresa si no existe (capa 3 del fallback)
DROP POLICY IF EXISTS "emp_anon_insertar" ON v2_empresas;
CREATE POLICY "emp_anon_insertar"
ON v2_empresas
FOR INSERT
TO anon
WITH CHECK (true);

-- 3. v2_gerencias (para mostrar el nombre en el popover)
DROP POLICY IF EXISTS "ger_public_leer" ON v2_gerencias;
CREATE POLICY "ger_public_leer"
ON v2_gerencias
FOR SELECT
USING (true);
