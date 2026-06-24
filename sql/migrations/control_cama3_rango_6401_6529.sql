-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Control de Cama 3 (tercera cama extra)
-- Regla: La cama C3 (numero_cama = 3) SOLO está habilitada en hab 6401–6529
--        En TODAS las demás habitaciones, la cama C3 debe estar Deshabilitada.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- ── PASO 0: Preview antes de modificar ────────────────────────────────────────
-- Ejecuta esto primero para ver cuántas camas se verán afectadas.

SELECT
    'DESHABILITAR (fuera 6401-6529)' AS accion,
    COUNT(*) AS cantidad
FROM v2_camas c
JOIN v2_habitaciones h ON h.id_custom = c.habitacion_id
WHERE c.numero_cama = 3
  AND c.estado != 'Deshabilitada'          -- solo las que NO están ya deshabilitadas
  AND (
      h.numero_hab IS NULL
      OR NOT (h.numero_hab::integer BETWEEN 6401 AND 6529)
  )

UNION ALL

SELECT
    'HABILITAR (dentro 6401-6529)' AS accion,
    COUNT(*) AS cantidad
FROM v2_camas c
JOIN v2_habitaciones h ON h.id_custom = c.habitacion_id
WHERE c.numero_cama = 3
  AND c.estado = 'Deshabilitada'           -- solo las que están deshabilitadas (y debieran estar activas)
  AND h.numero_hab::integer BETWEEN 6401 AND 6529;


-- ── PASO 1: Deshabilitar C3 en habitaciones FUERA del rango 6401–6529 ─────────
UPDATE v2_camas c
SET estado = 'Deshabilitada'
FROM v2_habitaciones h
WHERE c.habitacion_id = h.id_custom
  AND c.numero_cama = 3
  AND c.estado != 'Deshabilitada'           -- evitar writes innecesarios
  AND (
      h.numero_hab IS NULL
      OR NOT (h.numero_hab::integer BETWEEN 6401 AND 6529)
  );


-- ── PASO 2: Habilitar C3 (Disponible) en habitaciones 6401–6529 ───────────────
-- Solo cambia las que estén Deshabilitadas (no toca las Ocupadas/PreAsignadas)
UPDATE v2_camas c
SET estado = 'Disponible'
FROM v2_habitaciones h
WHERE c.habitacion_id = h.id_custom
  AND c.numero_cama = 3
  AND c.estado = 'Deshabilitada'            -- solo las que estén deshabilitadas
  AND h.numero_hab::integer BETWEEN 6401 AND 6529;


-- ── PASO 3: Verificación post-actualización ────────────────────────────────────
-- Muestra resumen del resultado final
SELECT
    CASE
        WHEN h.numero_hab::integer BETWEEN 6401 AND 6529
        THEN 'DENTRO del rango (6401-6529)'
        ELSE 'FUERA del rango'
    END AS rango,
    c.estado,
    COUNT(*) AS camas
FROM v2_camas c
JOIN v2_habitaciones h ON h.id_custom = c.habitacion_id
WHERE c.numero_cama = 3
GROUP BY 1, 2
ORDER BY 1, 2;
