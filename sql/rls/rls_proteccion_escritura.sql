-- ══════════════════════════════════════════════════════════════════════════
-- RLS: Protección de operaciones DELETE y UPDATE en tablas críticas
-- Ejecutar en: Supabase → SQL Editor
-- Propósito: Garantizar que solo usuarios autenticados con rol adecuado
--            puedan borrar o modificar asignaciones y registros sensibles.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Función auxiliar: obtener rol del usuario desde app_metadata ──────────
-- (Supabase guarda el rol en auth.users.raw_app_meta_data)
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role',
    ''
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- TABLA: v2_asignaciones
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Habilitar RLS (si no está habilitado)
ALTER TABLE v2_asignaciones ENABLE ROW LEVEL SECURITY;

-- 2. SELECT — cualquier usuario autenticado puede leer
DROP POLICY IF EXISTS "v2_asig_select_auth" ON v2_asignaciones;
CREATE POLICY "v2_asig_select_auth"
  ON v2_asignaciones FOR SELECT
  TO authenticated
  USING (true);

-- 3. INSERT — cualquier usuario autenticado puede insertar (check-in)
DROP POLICY IF EXISTS "v2_asig_insert_auth" ON v2_asignaciones;
CREATE POLICY "v2_asig_insert_auth"
  ON v2_asignaciones FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 4. UPDATE — cualquier usuario autenticado puede actualizar (checkout, extender)
--    Esto permite check-out normal y extender estadía desde cualquier rol
DROP POLICY IF EXISTS "v2_asig_update_auth" ON v2_asignaciones;
CREATE POLICY "v2_asig_update_auth"
  ON v2_asignaciones FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. DELETE — SOLO supervisores y superadmins
--    Previene que usuarios básicos (admin/recepción) borren asignaciones
DROP POLICY IF EXISTS "v2_asig_delete_supervisor" ON v2_asignaciones;
CREATE POLICY "v2_asig_delete_supervisor"
  ON v2_asignaciones FOR DELETE
  TO authenticated
  USING (auth_user_role() IN ('supervisor', 'superadmin'));

-- ════════════════════════════════════════════════════════════════════════════
-- TABLA: v2_camas
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE v2_camas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_camas_select" ON v2_camas;
CREATE POLICY "v2_camas_select"
  ON v2_camas FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "v2_camas_update_auth" ON v2_camas;
CREATE POLICY "v2_camas_update_auth"
  ON v2_camas FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

-- Solo supervisores pueden eliminar/agregar camas
DROP POLICY IF EXISTS "v2_camas_write_supervisor" ON v2_camas;
CREATE POLICY "v2_camas_write_supervisor"
  ON v2_camas FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_role() IN ('supervisor', 'superadmin'));

DROP POLICY IF EXISTS "v2_camas_delete_supervisor" ON v2_camas;
CREATE POLICY "v2_camas_delete_supervisor"
  ON v2_camas FOR DELETE
  TO authenticated
  USING (auth_user_role() IN ('supervisor', 'superadmin'));

-- ════════════════════════════════════════════════════════════════════════════
-- TABLA: v2_empresas
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE v2_empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_empresas_select" ON v2_empresas;
CREATE POLICY "v2_empresas_select"
  ON v2_empresas FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "v2_empresas_write_supervisor" ON v2_empresas;
CREATE POLICY "v2_empresas_write_supervisor"
  ON v2_empresas FOR ALL
  TO authenticated
  USING (auth_user_role() IN ('supervisor', 'superadmin', 'admin'))
  WITH CHECK (auth_user_role() IN ('supervisor', 'superadmin', 'admin'));

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS ANGLO — protección de incidencias
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE v2_incidencias_anglo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v2_incid_select" ON v2_incidencias_anglo;
CREATE POLICY "v2_incid_select"
  ON v2_incidencias_anglo FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "v2_incid_insert" ON v2_incidencias_anglo;
CREATE POLICY "v2_incid_insert"
  ON v2_incidencias_anglo FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "v2_incid_delete_supervisor" ON v2_incidencias_anglo;
CREATE POLICY "v2_incid_delete_supervisor"
  ON v2_incidencias_anglo FOR DELETE
  TO authenticated
  USING (auth_user_role() IN ('supervisor', 'superadmin'));

-- ══════════════════════════════════════════════════════════════════════════
-- ✅ VERIFICACIÓN: Ejecuta esto para confirmar que las políticas están activas
-- ══════════════════════════════════════════════════════════════════════════
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE tablename IN ('v2_asignaciones', 'v2_camas', 'v2_empresas', 'v2_incidencias_anglo')
-- ORDER BY tablename, cmd;
