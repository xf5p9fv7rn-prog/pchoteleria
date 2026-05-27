-- ══════════════════════════════════════════════════════════════════════════
-- FIX CONCURRENCIA — Prevenir doble asignación de camas
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Índice único parcial: solo UNA asignación activa por cama a la vez
--    (activa = fecha_checkout es NULL)
--    Si dos recepcionistas intentan asignar la misma cama, el 2do recibirá error.
CREATE UNIQUE INDEX IF NOT EXISTS idx_una_asig_activa_por_cama
    ON v2_asignaciones (id_cama)
    WHERE fecha_checkout IS NULL;

-- 2. Verificar que no haya duplicados ya existentes antes de crear el índice
-- (Si el comando anterior falla, ejecuta esto para ver los conflictos)
SELECT
    id_cama,
    COUNT(*) as total_activas,
    array_agg(id ORDER BY fecha_checkin DESC) as ids_asignaciones,
    array_agg(nombre_huesped ORDER BY fecha_checkin DESC) as huespedes
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
GROUP BY id_cama
HAVING COUNT(*) > 1
ORDER BY total_activas DESC;

-- Si hay duplicados, ejecutar esto para limpiarlos (mantiene el más reciente):
-- DELETE FROM v2_asignaciones
-- WHERE id IN (
--     SELECT id FROM (
--         SELECT id,
--             ROW_NUMBER() OVER (PARTITION BY id_cama ORDER BY fecha_checkin DESC) AS rn
--         FROM v2_asignaciones
--         WHERE fecha_checkout IS NULL
--     ) ranked
--     WHERE rn > 1
-- );
-- Luego volver a ejecutar el CREATE UNIQUE INDEX de arriba.

-- 3. Habilitar Realtime en las tablas críticas (para sincronización entre dispositivos)
-- (En Supabase Dashboard: Database → Replication → enable for v2_camas y v2_asignaciones)
-- O ejecutar esto:
ALTER PUBLICATION supabase_realtime ADD TABLE v2_camas;
ALTER PUBLICATION supabase_realtime ADD TABLE v2_asignaciones;

-- 4. Confirmación
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'v2_asignaciones'
  AND indexname = 'idx_una_asig_activa_por_cama';
