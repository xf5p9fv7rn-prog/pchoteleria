-- =========================================================
-- FIX: Política RLS para v2_distribucion_camas
-- PROBLEMA: La tabla no tiene política SELECT para usuarios
--           autenticados → fetchAll devuelve 0 filas.
-- SOLUCIÓN: Permitir lectura a todos los usuarios autenticados.
-- =========================================================

-- 1. Verificar políticas actuales (solo lectura, no modifica nada)
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'v2_distribucion_camas';

-- 2. Agregar política de lectura si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'v2_distribucion_camas'
      AND cmd = 'SELECT'
  ) THEN
    EXECUTE 'CREATE POLICY "allow_authenticated_select_distribucion"
      ON v2_distribucion_camas
      FOR SELECT
      TO authenticated
      USING (true)';
    RAISE NOTICE '✅ Política RLS SELECT creada para v2_distribucion_camas';
  ELSE
    RAISE NOTICE 'ℹ️ Ya existe una política SELECT para v2_distribucion_camas';
  END IF;
END $$;

-- 3. También permitir a anon si se usa en modo público
-- (Descomentar solo si se necesita acceso sin login)
-- CREATE POLICY "allow_anon_select_distribucion"
--   ON v2_distribucion_camas FOR SELECT TO anon USING (true);

-- 4. Verificar que la tabla tenga RLS habilitado
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'v2_distribucion_camas';
-- Si relrowsecurity = false, ejecutar:
-- ALTER TABLE v2_distribucion_camas ENABLE ROW LEVEL SECURITY;
