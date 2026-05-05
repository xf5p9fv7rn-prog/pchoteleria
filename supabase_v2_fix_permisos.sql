-- ═══════════════════════════════════════════════════════════════
--  DIAGNÓSTICO + FIX DE PERMISOS V2
--  Ejecutar en Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Verificar qué tablas v2_ existen
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'v2_%'
ORDER BY table_name;

-- 2. Verificar qué funciones RPC v2_ existen
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE 'v2_%';

-- 3. Contar datos en cada tabla crítica
SELECT 'v2_edificios'    AS tabla, COUNT(*) AS filas FROM v2_edificios    UNION ALL
SELECT 'v2_pabellones',           COUNT(*) FROM v2_pabellones             UNION ALL
SELECT 'v2_habitaciones',         COUNT(*) FROM v2_habitaciones           UNION ALL
SELECT 'v2_camas',                COUNT(*) FROM v2_camas                  UNION ALL
SELECT 'v2_empresas',             COUNT(*) FROM v2_empresas               UNION ALL
SELECT 'v2_gerencias',            COUNT(*) FROM v2_gerencias              UNION ALL
SELECT 'v2_asignaciones',         COUNT(*) FROM v2_asignaciones;

-- 4. FIX: Otorgar permisos de ejecución a usuarios autenticados
GRANT EXECUTE ON FUNCTION v2_reporte_ocupacion()    TO authenticated;
GRANT EXECUTE ON FUNCTION v2_camas_por_empresa()    TO authenticated;
GRANT EXECUTE ON FUNCTION v2_actualizar_estado_cama() TO authenticated;

-- 5. FIX: Asegurar permisos de lectura en todas las tablas v2_
GRANT SELECT ON v2_edificios    TO authenticated;
GRANT SELECT ON v2_pabellones   TO authenticated;
GRANT SELECT ON v2_habitaciones TO authenticated;
GRANT SELECT ON v2_camas        TO authenticated;
GRANT SELECT ON v2_empresas     TO authenticated;
GRANT SELECT ON v2_gerencias    TO authenticated;
GRANT SELECT, INSERT, UPDATE ON v2_asignaciones TO authenticated;

-- 6. Probar el RPC directamente
SELECT * FROM v2_reporte_ocupacion();
