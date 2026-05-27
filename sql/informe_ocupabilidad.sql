-- ═══════════════════════════════════════════════════════════════
-- INFORME DE OCUPABILIDAD POR EMPRESA
-- Campamento — Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── RESUMEN GENERAL ──────────────────────────────────────────
SELECT
    COUNT(DISTINCT id_cama)                                    AS total_camas,
    SUM(CASE WHEN estado = 'Ocupada'     THEN 1 ELSE 0 END)   AS camas_ocupadas,
    SUM(CASE WHEN estado = 'Disponible'  THEN 1 ELSE 0 END)   AS camas_disponibles,
    SUM(CASE WHEN estado = 'Mantencion'  THEN 1 ELSE 0 END)   AS camas_mantencion,
    ROUND(
        100.0 * SUM(CASE WHEN estado = 'Ocupada' THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0), 1
    )                                                          AS pct_ocupacion
FROM v2_camas;

-- ── OCUPABILIDAD POR EMPRESA (turno activo) ───────────────────
SELECT
    COALESCE(e.nombre, '— Sin empresa —')              AS empresa,
    COUNT(*)                                            AS trabajadores_activos,
    SUM(CASE WHEN a.huesped_confirmo THEN 1 ELSE 0 END) AS confirmados,
    SUM(CASE WHEN NOT a.huesped_confirmo THEN 1 ELSE 0 END) AS pendientes,
    ROUND(
        100.0 * SUM(CASE WHEN a.huesped_confirmo THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0), 1
    )                                                   AS pct_confirmacion,
    MIN(a.fecha_checkin)                                AS inicio_turno,
    MAX(a.fecha_salida_programada)                      AS fin_turno
FROM v2_asignaciones a
LEFT JOIN v2_empresas e ON e.id = a.empresa_id
WHERE a.fecha_checkout IS NULL
  AND (a.fecha_salida_programada IS NULL OR a.fecha_salida_programada >= CURRENT_DATE)
GROUP BY e.nombre
ORDER BY trabajadores_activos DESC;

-- ── DETALLE TRABAJADORES POR EMPRESA ─────────────────────────
SELECT
    COALESCE(e.nombre, '— Sin empresa —')  AS empresa,
    a.nombre_huesped,
    a.rut_huesped,
    a.fecha_checkin                         AS llegada,
    a.fecha_salida_programada               AS salida,
    a.estado_asignacion,
    CASE WHEN a.huesped_confirmo THEN '✅ Confirmado' ELSE '⏳ Pendiente' END AS estado,
    c.id_cama                               AS cama,
    h.numero_hab                            AS habitacion
FROM v2_asignaciones a
LEFT JOIN v2_empresas e   ON e.id = a.empresa_id
LEFT JOIN v2_camas c      ON c.id_cama = a.id_cama
LEFT JOIN v2_habitaciones h ON h.id_custom = c.habitacion_id
WHERE a.fecha_checkout IS NULL
  AND (a.fecha_salida_programada IS NULL OR a.fecha_salida_programada >= CURRENT_DATE)
ORDER BY e.nombre, a.huesped_confirmo, a.nombre_huesped;

-- ── HISTORIAL DE CHECKOUT (últimas 72 horas) ─────────────────
SELECT
    COALESCE(e.nombre, '— Sin empresa —')  AS empresa,
    a.nombre_huesped,
    a.rut_huesped,
    a.fecha_checkin,
    a.fecha_checkout,
    a.fecha_checkout - a.fecha_checkin      AS dias_en_camp,
    a.estado_asignacion
FROM v2_asignaciones a
LEFT JOIN v2_empresas e ON e.id = a.empresa_id
WHERE a.fecha_checkout >= CURRENT_DATE - INTERVAL '3 days'
ORDER BY a.fecha_checkout DESC;
