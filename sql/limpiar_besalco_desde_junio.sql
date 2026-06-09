-- ═══════════════════════════════════════════════════════════════════════════
-- LIMPIEZA BESALCO — Solo llegadas desde 2026-06-01 en adelante
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor)
--
-- SEGURO: NO toca personas que ya hicieron check-in ni llegadas anteriores
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1 (SOLO LECTURA): PREVISUALIZAR qué se va a eliminar
-- Ejecuta este SELECT primero para confirmar antes de borrar nada
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    a.nombre_huesped,
    a.rut_huesped,
    a.fecha_checkin,
    a.fecha_salida_programada,
    h.numero_hab,
    a.id_cama,
    a.huesped_confirmo,
    CASE WHEN a.huesped_confirmo THEN '⚠️ YA CONFIRMADO — NO BORRAR' ELSE '🗑️ Pre-asignado — será eliminado' END AS estado
FROM v2_asignaciones a
JOIN v2_empresas e       ON e.id = a.empresa_id
JOIN v2_camas c          ON c.id_cama = a.id_cama
JOIN v2_habitaciones h   ON h.id_custom = c.habitacion_id
WHERE e.nombre ILIKE '%BESALCO%'
  AND a.fecha_checkout IS NULL
  AND a.fecha_checkin >= '2026-06-01'
ORDER BY a.fecha_checkin, h.numero_hab;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: EJECUTAR LA LIMPIEZA
-- Solo cuando hayas confirmado el SELECT anterior está correcto
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 2a. Liberar camas de los pre-asignados BESALCO desde 01-jun
UPDATE v2_camas
   SET estado = 'Disponible'
 WHERE id_cama IN (
     SELECT a.id_cama
       FROM v2_asignaciones a
       JOIN v2_empresas e ON e.id = a.empresa_id
      WHERE e.nombre ILIKE '%BESALCO%'
        AND a.fecha_checkout IS NULL
        AND a.fecha_checkin  >= '2026-06-01'
        AND (a.huesped_confirmo IS NULL OR a.huesped_confirmo = false)
 );

-- 2b. Eliminar asignaciones
DELETE FROM v2_asignaciones
 WHERE empresa_id = (SELECT id FROM v2_empresas WHERE nombre ILIKE '%BESALCO%' LIMIT 1)
   AND fecha_checkout IS NULL
   AND fecha_checkin  >= '2026-06-01'
   AND (huesped_confirmo IS NULL OR huesped_confirmo = false);

-- 2c. Eliminar solicitudes BESALCO (se recargarán limpias desde el Excel)
DELETE FROM v2_solicitudes_b2b
 WHERE empresa ILIKE '%BESALCO%'
   AND (
       fecha_llegada >= '2026-06-01'
       OR fecha_llegada IS NULL  -- solicitudes sin fecha asignada también limpiar
   );

-- 2d. Verificar resultado (debe mostrar 0 registros si todo limpió bien)
SELECT COUNT(*) AS besalco_activos_restantes
  FROM v2_asignaciones a
  JOIN v2_empresas e ON e.id = a.empresa_id
 WHERE e.nombre ILIKE '%BESALCO%'
   AND a.fecha_checkout IS NULL
   AND a.fecha_checkin >= '2026-06-01'
   AND (a.huesped_confirmo IS NULL OR a.huesped_confirmo = false);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DESPUÉS DE EJECUTAR:
--   1. Recarga el Excel de BESALCO desde la app
--   2. El motor ya está corregido — no habrá más reacciones en cadena
--   3. Si alguna hab está llena al cargar, aparecerá en "Sin asignar"
--      para revisión manual (no se mandará a otro cuarto al azar)
-- ─────────────────────────────────────────────────────────────────────────────
