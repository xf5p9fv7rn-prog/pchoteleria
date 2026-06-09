-- ════════════════════════════════════════════════════════════════════════════
-- FIX: Asignaciones sin empresa_id para ACHS / ESACHS
-- ════════════════════════════════════════════════════════════════════════════

-- ── PASO 1: Ver si las empresas existen en v2_empresas ───────────────────────
SELECT id, nombre, turno
FROM v2_empresas
WHERE nombre ILIKE '%achs%'
   OR nombre ILIKE '%esah%'
ORDER BY nombre;

-- ── PASO 2: Ver asignaciones con empresa_id NULL para estos trabajadores ──────
SELECT
    a.id,
    a.rut_huesped,
    a.nombre_huesped,
    a.empresa_id,
    a.estado_asignacion,
    a.fecha_checkin,
    a.fecha_salida_programada,
    -- Empresa según solicitud (texto libre):
    s.empresa AS empresa_en_solicitud
FROM v2_asignaciones a
LEFT JOIN v2_solicitudes_b2b s
    ON UPPER(REGEXP_REPLACE(a.rut_huesped, '[.\- ]', '', 'g'))
     = UPPER(REGEXP_REPLACE(s.rut_trabajador, '[.\- ]', '', 'g'))
  AND s.status NOT IN ('rechazada', 'finalizado')
WHERE a.fecha_checkout IS NULL
  AND (
      s.empresa ILIKE '%achs%'
   OR s.empresa ILIKE '%esah%'
  )
ORDER BY s.empresa, a.nombre_huesped;

-- ── PASO 3: Actualizar empresa_id usando el nombre de la empresa ─────────────
-- Esto vincula las asignaciones a la empresa correcta en v2_empresas

-- Primero revisa que el PASO 1 devolvió las empresas correctas y copia sus IDs.
-- Luego ejecuta esto (reemplaza los IDs por los reales del PASO 1):

UPDATE v2_asignaciones a
SET empresa_id = e.id
FROM v2_empresas e
JOIN v2_solicitudes_b2b s
    ON s.empresa ILIKE '%' || SPLIT_PART(e.nombre, ' ', 1) || '%'
WHERE UPPER(REGEXP_REPLACE(a.rut_huesped, '[.\- ]', '', 'g'))
    = UPPER(REGEXP_REPLACE(s.rut_trabajador, '[.\- ]', '', 'g'))
  AND a.empresa_id IS NULL
  AND a.fecha_checkout IS NULL
  AND (e.nombre ILIKE '%achs%' OR e.nombre ILIKE '%esah%')
  AND s.status NOT IN ('rechazada', 'finalizado');

-- ── VERIFICAR resultado ───────────────────────────────────────────────────────
SELECT
    e.nombre AS empresa,
    COUNT(*) AS asignaciones_activas
FROM v2_asignaciones a
JOIN v2_empresas e ON e.id = a.empresa_id
WHERE a.fecha_checkout IS NULL
  AND (e.nombre ILIKE '%achs%' OR e.nombre ILIKE '%esah%')
GROUP BY e.nombre
ORDER BY e.nombre;
