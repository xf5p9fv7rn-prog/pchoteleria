-- ════════════════════════════════════════════════════════════════════════════
-- PASO 1: DIAGNÓSTICO — Ver qué solicitudes aceptadas NO tienen asignación
-- Ejecutar primero para entender el estado actual
-- ════════════════════════════════════════════════════════════════════════════
SELECT
    s.empresa,
    s.nombre_trabajador,
    s.rut_trabajador,
    s.hab_solicitada,
    s.fecha_llegada,
    s.fecha_salida,
    s.status,
    h.id_custom        AS hab_id,
    c.id_cama,
    c.estado           AS estado_cama,
    a.id               AS asig_id,
    a.estado_asignacion
FROM v2_solicitudes_b2b s
LEFT JOIN v2_habitaciones h
       ON h.numero_hab::text = s.hab_solicitada::text
LEFT JOIN v2_camas c
       ON c.habitacion_id = h.id_custom
LEFT JOIN v2_asignaciones a
       ON a.id_cama = c.id_cama AND a.fecha_checkout IS NULL
WHERE s.status IN ('aceptada', 'aceptada_asignada')
ORDER BY s.empresa, s.nombre_trabajador;

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 2: CONTAR cuántos no tienen asignación formal
-- ════════════════════════════════════════════════════════════════════════════
SELECT COUNT(*) AS solicitudes_sin_asignacion
FROM v2_solicitudes_b2b s
WHERE s.status IN ('aceptada', 'aceptada_asignada')
  AND s.hab_solicitada IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM v2_asignaciones a
      WHERE UPPER(REPLACE(a.rut_huesped, '.', '')) =
            UPPER(REPLACE(s.rut_trabajador, '.', ''))
        AND a.fecha_checkout IS NULL
  );

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 3: FIX — Crear asignaciones faltantes
-- EJECUTAR SOLO DESPUÉS DE REVISAR EL PASO 1
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    sol        RECORD;
    hab_id     TEXT;
    cama_id    TEXT;
    estado_a   TEXT;
    hoy        DATE := CURRENT_DATE;
    n_ok       INT  := 0;
    n_sin_hab  INT  := 0;
    n_sin_cama INT  := 0;
BEGIN
    FOR sol IN
        SELECT
            s.id,
            s.rut_trabajador,
            s.nombre_trabajador,
            s.empresa,
            s.hab_solicitada,
            s.fecha_llegada,
            s.fecha_salida,
            e.id AS empresa_id
        FROM v2_solicitudes_b2b s
        LEFT JOIN v2_empresas e
               ON e.nombre ILIKE s.empresa
        WHERE s.status IN ('aceptada', 'aceptada_asignada')
          AND s.hab_solicitada IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM v2_asignaciones a
              WHERE UPPER(REPLACE(a.rut_huesped, '.', '')) =
                    UPPER(REPLACE(s.rut_trabajador, '.', ''))
                AND a.fecha_checkout IS NULL
          )
        ORDER BY s.empresa, s.fecha_llegada
    LOOP
        -- Buscar habitacion_id por numero_hab
        SELECT id_custom INTO hab_id
        FROM v2_habitaciones
        WHERE numero_hab::text = sol.hab_solicitada::text
        LIMIT 1;

        IF hab_id IS NULL THEN
            RAISE NOTICE 'HAB NO ENCONTRADA: % → hab solicitada: %',
                sol.nombre_trabajador, sol.hab_solicitada;
            n_sin_hab := n_sin_hab + 1;
            CONTINUE;
        END IF;

        -- Buscar primera cama libre en esa habitación
        SELECT id_cama INTO cama_id
        FROM v2_camas
        WHERE habitacion_id = hab_id
          AND estado = 'Disponible'
        ORDER BY id_cama
        LIMIT 1;

        IF cama_id IS NULL THEN
            RAISE NOTICE 'SIN CAMA LIBRE: % → hab %',
                sol.nombre_trabajador, sol.hab_solicitada;
            n_sin_cama := n_sin_cama + 1;
            CONTINUE;
        END IF;

        -- Estado de asignación: pre_asignado si llega en el futuro, activa si es hoy o pasado
        estado_a := CASE
            WHEN sol.fecha_llegada IS NOT NULL AND sol.fecha_llegada > hoy THEN 'pre_asignado'
            ELSE 'activa'
        END;

        -- Crear la asignación formal
        INSERT INTO v2_asignaciones (
            id_cama,
            rut_huesped,
            nombre_huesped,
            empresa_id,
            fecha_checkin,
            fecha_salida_programada,
            estado_asignacion,
            huesped_confirmo,
            autorizado_checkin
        ) VALUES (
            cama_id,
            UPPER(REPLACE(COALESCE(sol.rut_trabajador, ''), '.', '')),
            sol.nombre_trabajador,
            sol.empresa_id,
            COALESCE(sol.fecha_llegada, hoy),
            sol.fecha_salida,
            estado_a,
            false,
            false
        )
        ON CONFLICT DO NOTHING;

        -- Marcar cama según estado
        IF estado_a = 'activa' THEN
            UPDATE v2_camas SET estado = 'Ocupada'    WHERE id_cama = cama_id;
        ELSE
            UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = cama_id;
        END IF;

        RAISE NOTICE '✅ % → cama % (%)', sol.nombre_trabajador, cama_id, estado_a;
        n_ok := n_ok + 1;
    END LOOP;

    RAISE NOTICE '════════════════════════════════';
    RAISE NOTICE 'RESULTADO: % asignaciones creadas', n_ok;
    RAISE NOTICE '         % sin habitación en BD',   n_sin_hab;
    RAISE NOTICE '         % sin cama disponible',    n_sin_cama;
    RAISE NOTICE '════════════════════════════════';
END $$;
