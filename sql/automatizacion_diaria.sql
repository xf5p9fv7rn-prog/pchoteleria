-- ═══════════════════════════════════════════════════════════════════════
-- AUTOMATIZACIÓN DIARIA: Función de Check-in y Check-out
-- ⚠️  pg_cron NO disponible → La función se llama desde JavaScript (db.js)
--     automáticamente cada 90s cuando la app está abierta.
--
-- EJECUTAR SOLO LAS LÍNEAS DE LA FUNCIÓN (sin la parte de cron)
-- ═══════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- FUNCIÓN: fn_transicion_diaria()
-- Reglas:
--   1. CHECK-IN  → PreAsignada → Ocupada cuando fecha_checkin <= HOY
--   2. CHECK-OUT → Ocupada → Disponible cuando fecha_salida <= AYER
-- Para ejecutar manualmente: SELECT fn_transicion_diaria();
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_transicion_diaria()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_checkins  INTEGER := 0;
    v_checkouts INTEGER := 0;
BEGIN

    -- ── 1. CHECK-IN: PreAsignada → Ocupada ──────────────────────────────
    UPDATE v2_camas
    SET estado = 'Ocupada'
    WHERE estado = 'PreAsignada'
      AND id_cama IN (
          SELECT DISTINCT a.id_cama
          FROM v2_asignaciones a
          WHERE a.fecha_checkin <= CURRENT_DATE
      );
    GET DIAGNOSTICS v_checkins = ROW_COUNT;

    -- ── 2. CHECK-OUT: Ocupada → Disponible ──────────────────────────────
    UPDATE v2_camas
    SET estado = 'Disponible'
    WHERE estado = 'Ocupada'
      AND id_cama IN (
          SELECT DISTINCT a.id_cama
          FROM v2_asignaciones a
          WHERE a.fecha_salida_programada < CURRENT_DATE
      )
      AND id_cama NOT IN (
          -- Proteger camas con otra asignación futura activa
          SELECT DISTINCT a2.id_cama
          FROM v2_asignaciones a2
          WHERE a2.fecha_salida_programada >= CURRENT_DATE
            AND a2.fecha_checkin <= CURRENT_DATE
      );
    GET DIAGNOSTICS v_checkouts = ROW_COUNT;

    RETURN format('✅ check-ins: %s | check-outs: %s', v_checkins, v_checkouts);
END;
$$;

-- ══════════════════════════════════════════════════════════
-- PROBAR AHORA: descomenta la línea siguiente y ejecuta
-- ══════════════════════════════════════════════════════════
SELECT fn_transicion_diaria();
