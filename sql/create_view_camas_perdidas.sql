-- ══════════════════════════════════════════════════════════════════════════
-- VISTA UNIFICADA: v2_camas_perdidas_view
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v2_camas_perdidas_view AS
WITH conteo AS (
    SELECT
        c.habitacion_id,
        h.numero_hab,
        h.nivel,
        p.nombre        AS pabellon,
        p.id            AS pabellon_id,
        e.nombre        AS edificio,

        COUNT(c.id_cama)  AS total_camas,

        -- Ocupada: estado='Ocupada' O tiene asignación activa
        COUNT(CASE
            WHEN c.estado = 'Ocupada'
              OR EXISTS (
                  SELECT 1 FROM v2_asignaciones a
                  WHERE a.id_cama = c.id_cama
                    AND a.fecha_checkout IS NULL
              )
            THEN 1
        END) AS ocupadas,

        -- Primera cama LIBRE (la perdida)
        MIN(CASE
            WHEN c.estado != 'Ocupada'
             AND NOT EXISTS (
                  SELECT 1 FROM v2_asignaciones a
                  WHERE a.id_cama = c.id_cama
                    AND a.fecha_checkout IS NULL
             )
            THEN c.id_cama
        END) AS id_cama_perdida,

        -- Empresa de la cama ocupada (via asignacion activa)
        MIN(CASE WHEN c.estado = 'Ocupada' THEN
            (SELECT emp.nombre FROM v2_asignaciones aa
             JOIN v2_empresas emp ON emp.id = aa.empresa_id
             WHERE aa.id_cama = c.id_cama AND aa.fecha_checkout IS NULL
             LIMIT 1)
        END) AS empresa,

        -- Huésped de la cama ocupada
        MIN(CASE WHEN c.estado = 'Ocupada' THEN
            (SELECT aa.nombre_huesped FROM v2_asignaciones aa
             WHERE aa.id_cama = c.id_cama AND aa.fecha_checkout IS NULL
             LIMIT 1)
        END) AS huesped

    FROM v2_camas c
    JOIN v2_habitaciones h ON h.id_custom = c.habitacion_id
    JOIN v2_pabellones   p ON p.id = h.pabellon_id
    JOIN v2_edificios    e ON e.id = p.edificio_id
    WHERE h.pabellon_id IS NOT NULL
      AND h.numero_hab IS NOT NULL
    GROUP BY
        c.habitacion_id, h.numero_hab, h.nivel,
        p.nombre, p.id, e.nombre
)
SELECT
    habitacion_id,
    numero_hab,
    nivel,
    pabellon,
    pabellon_id,
    edificio,
    total_camas,
    ocupadas,
    (total_camas - ocupadas)      AS camas_perdidas,
    id_cama_perdida,
    COALESCE(empresa, '—')        AS empresa,
    COALESCE(huesped, '—')        AS huesped
FROM conteo
WHERE total_camas >= 2
  AND ocupadas > 0
  AND (total_camas - ocupadas) > 0;

-- Verificar
SELECT COUNT(*) AS total_camas_perdidas FROM v2_camas_perdidas_view;
