-- ════════════════════════════════════════════════════════════════════════════════
-- V2: LÓGICA DE NEGOCIO — Triggers + RPC
-- Ejecutar DESPUÉS de supabase_v2_migration.sql y los datos
-- ════════════════════════════════════════════════════════════════════════════════

-- ─── TRIGGER: auto-actualizar v2_camas.estado ────────────────────────────────
CREATE OR REPLACE FUNCTION v2_actualizar_estado_cama()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE v2_camas SET estado = 'Ocupada' WHERE id_cama = NEW.id_cama AND estado != 'Deshabilitada';
  ELSIF TG_OP = 'UPDATE' AND NEW.fecha_checkout IS NOT NULL AND OLD.fecha_checkout IS NULL THEN
    UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = NEW.id_cama AND estado != 'Deshabilitada';
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = OLD.id_cama AND estado != 'Deshabilitada';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_v2_estado_cama ON v2_asignaciones;
CREATE TRIGGER trg_v2_estado_cama
  AFTER INSERT OR UPDATE OR DELETE ON v2_asignaciones
  FOR EACH ROW EXECUTE FUNCTION v2_actualizar_estado_cama();


-- ─── RPC: reporte de ocupación por edificio ──────────────────────────────────
CREATE OR REPLACE FUNCTION v2_reporte_ocupacion()
RETURNS TABLE (
  edificio       VARCHAR,
  total_camas    BIGINT,
  camas_ocupadas BIGINT,
  camas_disponibles BIGINT,
  camas_mantencion  BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.nombre::VARCHAR                                                    AS edificio,
    COUNT(c.id_cama)                                                     AS total_camas,
    COUNT(c.id_cama) FILTER (WHERE c.estado = 'Ocupada')                 AS camas_ocupadas,
    COUNT(c.id_cama) FILTER (WHERE c.estado = 'Disponible')              AS camas_disponibles,
    COUNT(c.id_cama) FILTER (WHERE c.estado = 'Mantencion')              AS camas_mantencion
  FROM v2_edificios e
  JOIN v2_pabellones  p ON e.id         = p.edificio_id
  JOIN v2_habitaciones h ON p.id        = h.pabellon_id
  JOIN v2_camas        c ON h.id_custom = c.habitacion_id
  GROUP BY e.nombre;
END;
$$ LANGUAGE plpgsql;


-- ─── RPC: disponibilidad por empresa ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION v2_camas_por_empresa()
RETURNS TABLE (
  empresa        VARCHAR,
  gerencia       VARCHAR,
  turno          VARCHAR,
  camas_ocupadas BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    emp.nombre::VARCHAR    AS empresa,
    ger.nombre::VARCHAR    AS gerencia,
    emp.turno::VARCHAR,
    COUNT(a.id)            AS camas_ocupadas
  FROM v2_empresas emp
  JOIN v2_gerencias ger ON emp.gerencia_id = ger.id
  LEFT JOIN v2_asignaciones a
    ON a.empresa_id = emp.id AND a.fecha_checkout IS NULL
  GROUP BY emp.nombre, ger.nombre, emp.turno
  ORDER BY emp.nombre;
END;
$$ LANGUAGE plpgsql;


-- ─── CORRECCIÓN de constraint (por si las tablas ya existen con CHECK > 0) ───
ALTER TABLE v2_habitaciones DROP CONSTRAINT IF EXISTS v2_habitaciones_cantidad_camas_check;
ALTER TABLE v2_habitaciones ADD  CONSTRAINT v2_habitaciones_cantidad_camas_check
  CHECK (cantidad_camas >= 0);


-- ─── Verificación ─────────────────────────────────────────────────────────────
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('v2_actualizar_estado_cama','v2_reporte_ocupacion','v2_camas_por_empresa');
