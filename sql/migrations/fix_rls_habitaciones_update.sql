-- ══════════════════════════════════════════════════════════════════════
-- URGENTE: Política RLS para permitir UPDATE en v2_habitaciones
-- El sistema no puede bloquear habitaciones sin esto
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════

-- 1. Ver políticas actuales (diagnóstico)
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'v2_habitaciones';

-- 2. Agregar política UPDATE para usuarios autenticados
--    (si ya existe una con el mismo nombre, la elimina primero)
DROP POLICY IF EXISTS "Allow authenticated users to update habitaciones" ON v2_habitaciones;

CREATE POLICY "Allow authenticated users to update habitaciones"
  ON v2_habitaciones
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Verificar que RLS está habilitado (si no está, esto no aplica)
ALTER TABLE v2_habitaciones ENABLE ROW LEVEL SECURITY;

-- 4. Confirmar políticas después de crear
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'v2_habitaciones';
