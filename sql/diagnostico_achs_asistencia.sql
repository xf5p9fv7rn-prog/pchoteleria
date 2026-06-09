-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO: Por qué ACHS / Achs Servicios no aparecen en Asistencia
-- Ejecuta cada SELECT por separado en Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Ver QUÉ STATUS tienen en v2_solicitudes_b2b ───────────────────────────
-- Si status='pendiente' → el motor no pudo asignarles cama (hab. llena)
-- Si status='aceptada'  → motor corrió pero sin cama asignada
-- Si status='aceptada_asignada' → tienen cama en v2_asignaciones
SELECT
    s.empresa,
    s.nombre_trabajador,
    s.rut_trabajador,
    s.hab_solicitada,
    s.fecha_llegada,
    s.fecha_salida,
    s.status,
    s.created_at::date AS fecha_carga
FROM v2_solicitudes_b2b s
WHERE s.empresa ILIKE '%achs%'
   OR s.empresa ILIKE '%esah%'
ORDER BY s.empresa, s.status, s.nombre_trabajador;

-- ── 2. Ver si tienen asignación en v2_asignaciones ───────────────────────────
-- Si aparecen aquí, DEBEN aparecer en Control de Asistencia (con pre_asignado o activa)
SELECT
    a.rut_huesped,
    a.nombre_huesped,
    a.estado_asignacion,
    a.fecha_checkin,
    a.fecha_salida_programada,
    a.fecha_checkout,
    a.id_cama,
    e.nombre AS empresa
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE e.nombre ILIKE '%achs%'
   OR e.nombre ILIKE '%esah%'
ORDER BY a.estado_asignacion, a.nombre_huesped;

-- ── 3. Ver si la empresa existe en v2_empresas ───────────────────────────────
-- Si no existe, los sintéticos aparecen con ID falso y pueden perderse
SELECT id, nombre, turno
FROM v2_empresas
WHERE nombre ILIKE '%achs%'
   OR nombre ILIKE '%esah%'
ORDER BY nombre;

-- ── 4. Resumen cruzado: solicitudes vs asignaciones ──────────────────────────
-- Muestra qué trabajadores de ACHS/ESAH tienen o no tienen asignación
SELECT
    s.empresa,
    s.nombre_trabajador,
    s.rut_trabajador,
    s.status AS status_solicitud,
    s.fecha_llegada,
    s.fecha_salida,
    a.id_cama,
    a.estado_asignacion,
    a.fecha_checkout,
    CASE
        WHEN a.id IS NULL THEN '❌ SIN ASIGNACIÓN'
        WHEN a.fecha_checkout IS NOT NULL THEN '🔒 CON CHECKOUT (cerrada)'
        WHEN a.estado_asignacion = 'pre_asignado' THEN '🔵 PRE-ASIGNADO (futuro)'
        WHEN a.estado_asignacion = 'activa' THEN '✅ ACTIVA'
        ELSE a.estado_asignacion
    END AS situacion
FROM v2_solicitudes_b2b s
LEFT JOIN v2_asignaciones a
    ON UPPER(REGEXP_REPLACE(a.rut_huesped, '[.\- ]', '', 'g'))
     = UPPER(REGEXP_REPLACE(s.rut_trabajador, '[.\- ]', '', 'g'))
WHERE (s.empresa ILIKE '%achs%' OR s.empresa ILIKE '%esah%')
  AND s.status NOT IN ('rechazada', 'finalizado')
ORDER BY s.empresa, s.nombre_trabajador;
