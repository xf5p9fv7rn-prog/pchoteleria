-- ══════════════════════════════════════════════════════════════════════════
-- ÍNDICES DE RENDIMIENTO — v2_asignaciones
-- Ejecutar en: Supabase → SQL Editor
-- Propósito: Acelerar las consultas más frecuentes (checkout masivo,
--            búsqueda por empresa, RUT, y rotación de turno)
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Checkout masivo por empresa (la query más crítica en días de rotación)
--    SELECT * FROM v2_asignaciones WHERE empresa_id = $1 AND fecha_checkout IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asig_empresa_activa
ON v2_asignaciones (empresa_id, fecha_checkout)
WHERE fecha_checkout IS NULL;

-- 2. Búsqueda por cama activa (check-out individual)
--    SELECT * FROM v2_asignaciones WHERE id_cama = $1 AND fecha_checkout IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asig_cama_activa
ON v2_asignaciones (id_cama, fecha_checkout)
WHERE fecha_checkout IS NULL;

-- 3. Rotación de turno (ejecutarAutoRotacion busca por estado + fecha)
--    SELECT * FROM v2_asignaciones WHERE estado_asignacion = 'activa'
--      AND fecha_checkout IS NULL AND fecha_salida_programada < hoy
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asig_rotacion
ON v2_asignaciones (estado_asignacion, fecha_salida_programada)
WHERE fecha_checkout IS NULL;

-- 4. Búsqueda por RUT (autorización rápida en Recepción)
--    SELECT * FROM v2_asignaciones WHERE rut_huesped ILIKE '%rut%' AND fecha_checkout IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asig_rut_text
ON v2_asignaciones USING gin (rut_huesped gin_trgm_ops);
-- Requiere: CREATE EXTENSION IF NOT EXISTS pg_trgm; (ya viene en Supabase)

-- 5. Pre-asignados activos (activación automática)
--    SELECT * FROM v2_asignaciones WHERE estado_asignacion = 'pre_asignado'
--      AND fecha_checkin <= hoy AND fecha_checkout IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asig_preasignado
ON v2_asignaciones (estado_asignacion, fecha_checkin)
WHERE fecha_checkout IS NULL AND estado_asignacion = 'pre_asignado';

-- ══════════════════════════════════════════════════════════════════════════
-- ÍNDICES ADICIONALES — tablas relacionadas
-- ══════════════════════════════════════════════════════════════════════════

-- v2_camas: búsqueda por habitación y estado (asignación automática)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_camas_habitacion_estado
ON v2_camas (habitacion_id, estado);

-- v2_solicitudes_b2b: búsqueda por empresa y estado (panel de solicitudes)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sol_empresa_status
ON v2_solicitudes_b2b (empresa, status);

-- ══════════════════════════════════════════════════════════════════════════
-- ✅ VERIFICACIÓN: Confirmar que los índices fueron creados
-- ══════════════════════════════════════════════════════════════════════════
-- SELECT indexname, tablename, indexdef
-- FROM pg_indexes
-- WHERE tablename IN ('v2_asignaciones', 'v2_camas', 'v2_solicitudes_b2b')
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename;
