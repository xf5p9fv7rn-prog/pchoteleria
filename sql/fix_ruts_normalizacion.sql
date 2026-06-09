-- ════════════════════════════════════════════════════════════════════════════
-- FIX DUPLICADOS DE RUT — Ejecútalo PASO A PASO en Supabase SQL Editor
-- Cada paso es independiente. Lee el resultado antes de continuar.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO PRIMERO (sin modificar nada)
-- ════════════════════════════════════════════════════════════════════════════

-- ── PASO 1A: Ver asignaciones activas duplicadas por RUT normalizado ──────────
-- Si ves el mismo nombre con count > 1, tiene múltiples camas ocupadas
SELECT
    UPPER(REGEXP_REPLACE(rut_huesped, '[.\- ]', '', 'g')) AS rut_norm,
    nombre_huesped,
    COUNT(*) AS total_asignaciones,
    STRING_AGG(id_cama, ', ' ORDER BY id_cama) AS camas,
    STRING_AGG(CAST(id AS TEXT), ', ' ORDER BY id) AS asig_ids
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
GROUP BY UPPER(REGEXP_REPLACE(rut_huesped, '[.\- ]', '', 'g')), nombre_huesped
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, nombre_huesped;


-- ── PASO 1B: Ver duplicados en solicitudes (rut_trabajador con/sin guión) ────
SELECT
    UPPER(REGEXP_REPLACE(rut_trabajador, '[.\- ]', '', 'g')) AS rut_norm,
    nombre_trabajador,
    COUNT(*) AS total_solicitudes,
    STRING_AGG(rut_trabajador, ', ') AS ruts_variantes,
    STRING_AGG(status, ', ') AS estados
FROM v2_solicitudes_b2b
WHERE status NOT IN ('finalizado', 'rechazada')
GROUP BY UPPER(REGEXP_REPLACE(rut_trabajador, '[.\- ]', '', 'g')), nombre_trabajador
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;


-- ════════════════════════════════════════════════════════════════════════════
-- FIX 1: LIMPIAR ASIGNACIONES DUPLICADAS EN v2_asignaciones
-- Conserva la MÁS RECIENTE por RUT normalizado, elimina las demás
-- y libera las camas extra.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PASO 2: Identificar qué asignaciones se van a eliminar (PREVIEW) ────────
WITH ranked AS (
    SELECT
        id,
        id_cama,
        nombre_huesped,
        rut_huesped,
        fecha_checkin,
        UPPER(REGEXP_REPLACE(rut_huesped, '[.\- ]', '', 'g')) AS rut_norm,
        ROW_NUMBER() OVER (
            PARTITION BY UPPER(REGEXP_REPLACE(rut_huesped, '[.\- ]', '', 'g'))
            ORDER BY fecha_checkin DESC, id DESC   -- más reciente primero
        ) AS rn
    FROM v2_asignaciones
    WHERE fecha_checkout IS NULL
)
SELECT id, id_cama, nombre_huesped, rut_huesped, fecha_checkin,
       'SERÁ ELIMINADA' AS accion
FROM ranked
WHERE rn > 1   -- duplicados a borrar
ORDER BY nombre_huesped;


-- ── PASO 3: APLICAR — eliminar asignaciones duplicadas y liberar camas ───────
-- ⚠️ EJECUTA ESTO SOLO DESPUÉS DE REVISAR EL PASO 2
-- Usamos DELETE directo porque UPDATE con fecha_checkout viola el constraint
-- chk_fechas cuando la fecha_checkin es futura (no podemos poner checkout antes)
DO $$
DECLARE
    dup       RECORD;
    n_borradas INT := 0;
    n_camas    INT := 0;
BEGIN
    -- Iterar sobre todas las asignaciones duplicadas (rn > 1 = las sobrantes)
    FOR dup IN
        WITH ranked AS (
            SELECT
                id,
                id_cama,
                nombre_huesped,
                UPPER(REGEXP_REPLACE(rut_huesped, '[.\- ]', '', 'g')) AS rut_norm,
                ROW_NUMBER() OVER (
                    PARTITION BY UPPER(REGEXP_REPLACE(rut_huesped, '[.\- ]', '', 'g'))
                    ORDER BY fecha_checkin DESC, id DESC  -- conserva la más reciente
                ) AS rn
            FROM v2_asignaciones
            WHERE fecha_checkout IS NULL
        )
        SELECT id, id_cama, nombre_huesped FROM ranked WHERE rn > 1
    LOOP
        -- 1. Borrar la asignación duplicada directamente
        DELETE FROM v2_asignaciones WHERE id = dup.id;
        n_borradas := n_borradas + 1;

        -- 2. Liberar la cama SOLO si ya no tiene otra asignación activa
        IF NOT EXISTS (
            SELECT 1 FROM v2_asignaciones
            WHERE id_cama = dup.id_cama
              AND fecha_checkout IS NULL
        ) THEN
            UPDATE v2_camas
            SET estado = 'Disponible'
            WHERE id_cama = dup.id_cama
              AND estado <> 'Deshabilitada';
            n_camas := n_camas + 1;
            RAISE NOTICE '🛏️ Cama liberada: % (%)', dup.id_cama, dup.nombre_huesped;
        ELSE
            RAISE NOTICE '⏭️ Cama conservada: % (sigue ocupada por otra asig)', dup.id_cama;
        END IF;

        RAISE NOTICE '🗑️ Asignación duplicada eliminada: % → cama %', dup.nombre_huesped, dup.id_cama;
    END LOOP;

    RAISE NOTICE '════════════════════════════════════════';
    RAISE NOTICE 'RESULTADO: % asignaciones duplicadas eliminadas', n_borradas;
    RAISE NOTICE '           % camas liberadas',                    n_camas;
    RAISE NOTICE '════════════════════════════════════════';
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- FIX 2: NORMALIZAR RUTs EN v2_solicitudes_b2b
-- Quitar puntos, guiones y espacios para que coincidan con v2_asignaciones
-- ════════════════════════════════════════════════════════════════════════════

-- ── PASO 4: Normalizar rut_trabajador ────────────────────────────────────────
UPDATE v2_solicitudes_b2b
SET rut_trabajador = UPPER(REGEXP_REPLACE(rut_trabajador, '[.\- ]', '', 'g'))
WHERE rut_trabajador ~ '[.\-]';

-- ── PASO 5: Eliminar solicitudes duplicadas del mismo RUT/turno/empresa ───────
-- Conserva la MÁS RECIENTE, elimina las anteriores
DELETE FROM v2_solicitudes_b2b
WHERE id IN (
    SELECT id FROM (
        SELECT
            id,
            ROW_NUMBER() OVER (
                PARTITION BY
                    UPPER(REGEXP_REPLACE(rut_trabajador, '[.\- ]', '', 'g')),
                    empresa,
                    fecha_llegada,
                    fecha_salida
                ORDER BY created_at DESC, id DESC
            ) AS rn
        FROM v2_solicitudes_b2b
        WHERE status NOT IN ('finalizado', 'rechazada')
    ) ranked
    WHERE rn > 1
);


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN FINAL
-- ════════════════════════════════════════════════════════════════════════════

-- ── PASO 6: Confirmar que ya no hay duplicados en asignaciones activas ────────
SELECT
    UPPER(REGEXP_REPLACE(rut_huesped, '[.\- ]', '', 'g')) AS rut_norm,
    nombre_huesped,
    COUNT(*) AS total
FROM v2_asignaciones
WHERE fecha_checkout IS NULL
GROUP BY UPPER(REGEXP_REPLACE(rut_huesped, '[.\- ]', '', 'g')), nombre_huesped
HAVING COUNT(*) > 1;
-- ✅ Debe devolver 0 filas
