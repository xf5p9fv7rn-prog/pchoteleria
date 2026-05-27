-- ══════════════════════════════════════════════════════════════════════════════
-- FIX COMPLETO: Alertas de Seguridad Supabase — Mayo 2026
-- Proyecto: Sistema Censo Campamento (pnkajjduvadcxealodcp)
--
-- Resuelve:
--   [1] rls_disabled_in_public      → tablas sin RLS
--   [2] sensitive_columns_exposed   → datos sensibles sin restricción
--   [3] Data API grants (30 Mayo)   → GRANTs explícitos para nuevas tablas
--
-- Ejecutar en: Supabase → SQL Editor → New Query → RUN ▶
-- ══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1: Habilitar RLS en TODAS las tablas del schema public
--           (Resuelve: rls_disabled_in_public + sensitive_columns_exposed)
-- ─────────────────────────────────────────────────────────────────────────────

-- Tablas heredadas (schema antiguo)
ALTER TABLE IF EXISTS rooms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS buildings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS b2b_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS census              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS gerencia_quotas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS censo_locks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS census_records      ENABLE ROW LEVEL SECURITY;

-- Tablas v2_
ALTER TABLE IF EXISTS v2_edificios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_pabellones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_habitaciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_camas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_gerencias           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_empresas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_asignaciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_solicitudes_b2b     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_distribucion_camas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_camas_perdidas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_cupos_gerencia      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_incidencias_anglo   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_censo_locks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS v2_trabajadores        ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2: Políticas RLS para tablas heredadas sin políticas
--           El rol anon puede LEER (necesario para el censo-portal.html público)
--           Solo authenticated puede ESCRIBIR
-- ─────────────────────────────────────────────────────────────────────────────

-- rooms
DROP POLICY IF EXISTS "rooms_anon_select"   ON rooms;
DROP POLICY IF EXISTS "rooms_auth_write"    ON rooms;
CREATE POLICY "rooms_anon_select"   ON rooms FOR SELECT TO anon          USING (true);
CREATE POLICY "rooms_auth_write"    ON rooms FOR ALL    TO authenticated  USING (true) WITH CHECK (true);

-- buildings
DROP POLICY IF EXISTS "buildings_anon_select"  ON buildings;
DROP POLICY IF EXISTS "buildings_auth_write"   ON buildings;
CREATE POLICY "buildings_anon_select"  ON buildings FOR SELECT TO anon          USING (true);
CREATE POLICY "buildings_auth_write"   ON buildings FOR ALL    TO authenticated  USING (true) WITH CHECK (true);

-- b2b_requests
DROP POLICY IF EXISTS "b2b_anon_insert"   ON b2b_requests;
DROP POLICY IF EXISTS "b2b_anon_select"   ON b2b_requests;
DROP POLICY IF EXISTS "b2b_auth_write"    ON b2b_requests;
CREATE POLICY "b2b_anon_insert"   ON b2b_requests FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "b2b_anon_select"   ON b2b_requests FOR SELECT TO anon          USING (true);
CREATE POLICY "b2b_auth_write"    ON b2b_requests FOR ALL    TO authenticated  USING (true) WITH CHECK (true);

-- census (datos de huéspedes — sensible)
DROP POLICY IF EXISTS "census_auth_only"  ON census;
CREATE POLICY "census_auth_only"  ON census FOR ALL TO authenticated  USING (true) WITH CHECK (true);
-- NOTA: census NO permite acceso anon — datos sensibles de trabajadores

-- gerencia_quotas
DROP POLICY IF EXISTS "quotas_auth_only"  ON gerencia_quotas;
CREATE POLICY "quotas_auth_only"  ON gerencia_quotas FOR ALL TO authenticated  USING (true) WITH CHECK (true);

-- censo_locks
DROP POLICY IF EXISTS "locks_anon_select"  ON censo_locks;
DROP POLICY IF EXISTS "locks_anon_write"   ON censo_locks;
CREATE POLICY "locks_anon_select"  ON censo_locks FOR SELECT TO anon  USING (true);
CREATE POLICY "locks_anon_write"   ON censo_locks FOR ALL    TO anon  USING (true) WITH CHECK (true);

-- census_records
DROP POLICY IF EXISTS "census_rec_auth_only"  ON census_records;
CREATE POLICY "census_rec_auth_only" ON census_records FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 3: GRANTs explícitos (Mensaje 3 — cambio efectivo 30 Mayo 2026)
--           Sin estos GRANTs, las nuevas tablas no serán accesibles via API
-- ─────────────────────────────────────────────────────────────────────────────

-- Tablas de infraestructura — acceso de lectura para anon, full para authenticated
GRANT SELECT                       ON v2_edificios          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_edificios          TO authenticated;

GRANT SELECT                       ON v2_pabellones         TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_pabellones         TO authenticated;

GRANT SELECT                       ON v2_habitaciones       TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_habitaciones       TO authenticated;

GRANT SELECT                       ON v2_camas              TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_camas              TO authenticated;

-- Tablas de negocio — solo authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_gerencias          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_empresas           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_asignaciones       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_distribucion_camas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_camas_perdidas     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_incidencias_anglo  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_cupos_gerencia     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_trabajadores       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_censo_locks        TO authenticated;

-- Tabla solicitudes B2B — anon puede insertar (formulario público)
GRANT SELECT, INSERT               ON v2_solicitudes_b2b    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_solicitudes_b2b    TO authenticated;

-- Tablas heredadas
GRANT SELECT                       ON rooms                 TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON rooms                 TO authenticated;
GRANT SELECT                       ON buildings             TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON buildings             TO authenticated;
GRANT SELECT, INSERT               ON b2b_requests          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON b2b_requests          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON census               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON gerencia_quotas      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON censo_locks          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON census_records       TO authenticated;

-- service_role siempre tiene acceso total (por diseño de Supabase)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 4: VERIFICACIÓN FINAL
--           Debe mostrar todas las tablas con rls_enabled = true
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
    t.tablename                                                          AS "Tabla",
    t.rowsecurity                                                        AS "RLS ON",
    COUNT(p.policyname)                                                  AS "Nº Políticas",
    CASE WHEN COUNT(p.policyname) = 0 THEN '⚠️ SIN POLÍTICAS' 
         ELSE '✅ OK' END                                                AS "Estado"
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = 'public'
WHERE t.schemaname = 'public'
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.rowsecurity ASC, t.tablename;
