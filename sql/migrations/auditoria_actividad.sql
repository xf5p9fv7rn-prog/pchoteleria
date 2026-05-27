-- ══════════════════════════════════════════════════════════════════════════
-- SISTEMA DE AUDITORÍA DE ACTIVIDAD — PC Hotelería
-- Ejecutar en: Supabase → SQL Editor
--
-- Qué hace:
--   1. Crea la tabla v2_audit_log (registro permanente de todas las acciones)
--   2. Crea triggers en las tablas críticas que graban automáticamente
--      QUIÉN hizo QUÉ, CUÁNDO y en QUÉ registro
--   3. La tabla es INSERT-ONLY para usuarios normales (nadie puede borrar)
--      Solo superadmin puede leer y solo Supabase server puede escribir
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Tabla de auditoría ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    tabla           TEXT        NOT NULL,          -- tabla afectada
    operacion       TEXT        NOT NULL,          -- INSERT / UPDATE / DELETE
    registro_id     TEXT,                          -- ID del registro afectado
    datos_antes     JSONB,                         -- fila antes del cambio (UPDATE/DELETE)
    datos_despues   JSONB,                         -- fila después del cambio (INSERT/UPDATE)
    usuario_id      UUID,                          -- auth.uid() del usuario de Supabase
    usuario_email   TEXT,                          -- email del usuario
    usuario_role    TEXT,                          -- rol del usuario (admin/supervisor/etc)
    ip_address      TEXT,                          -- IP (si está disponible)
    created_at      TIMESTAMPTZ DEFAULT NOW()      -- timestamp exacto
);

-- Índices para consultas rápidas en el panel de auditoría
CREATE INDEX IF NOT EXISTS idx_audit_tabla      ON v2_audit_log (tabla);
CREATE INDEX IF NOT EXISTS idx_audit_usuario    ON v2_audit_log (usuario_email);
CREATE INDEX IF NOT EXISTS idx_audit_operacion  ON v2_audit_log (operacion);
CREATE INDEX IF NOT EXISTS idx_audit_created    ON v2_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_registro   ON v2_audit_log (registro_id);

-- ── 2. RLS: INSERT-ONLY vía triggers, SELECT solo para admins ─────────────
ALTER TABLE v2_audit_log ENABLE ROW LEVEL SECURITY;

-- Nadie puede insertar directamente (solo los triggers del servidor pueden)
DROP POLICY IF EXISTS "audit_no_direct_insert" ON v2_audit_log;

-- Solo supervisor/superadmin puede leer el log
DROP POLICY IF EXISTS "audit_select_supervisor" ON v2_audit_log;
CREATE POLICY "audit_select_supervisor"
  ON v2_audit_log FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('supervisor', 'superadmin')
  );

-- NADIE puede actualizar ni borrar el log (es inmutable)
-- (no se crean políticas UPDATE/DELETE → acceso denegado por defecto)

-- ── 3. Función trigger genérica ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- Se ejecuta con permisos del servidor, no del usuario
AS $$
DECLARE
    v_usuario_id    UUID;
    v_usuario_email TEXT;
    v_usuario_role  TEXT;
    v_registro_id   TEXT;
    v_datos_antes   JSONB;
    v_datos_despues JSONB;
BEGIN
    -- Obtener información del usuario autenticado desde el JWT
    v_usuario_id    := auth.uid();
    v_usuario_email := COALESCE(auth.jwt() ->> 'email', 'sistema');
    v_usuario_role  := COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', 'sin_rol');

    -- ✅ FIX: Usar to_jsonb() y extraer el ID como texto — funciona para
    --    cualquier tabla sin importar el nombre de la PK ('id', 'id_cama', etc.)
    IF TG_OP = 'INSERT' THEN
        v_datos_despues := to_jsonb(NEW);
        v_datos_antes   := NULL;
        v_registro_id   := COALESCE(
            v_datos_despues->>'id',
            v_datos_despues->>'id_cama',
            v_datos_despues->>'registro_id',
            'sin-id'
        );

    ELSIF TG_OP = 'UPDATE' THEN
        v_datos_antes   := to_jsonb(OLD);
        v_datos_despues := to_jsonb(NEW);
        v_registro_id   := COALESCE(
            v_datos_despues->>'id',
            v_datos_despues->>'id_cama',
            v_datos_despues->>'registro_id',
            'sin-id'
        );

    ELSIF TG_OP = 'DELETE' THEN
        v_datos_antes   := to_jsonb(OLD);
        v_datos_despues := NULL;
        v_registro_id   := COALESCE(
            v_datos_antes->>'id',
            v_datos_antes->>'id_cama',
            v_datos_antes->>'registro_id',
            'sin-id'
        );
    END IF;

    -- Insertar en el log (el trigger tiene permisos SECURITY DEFINER)
    INSERT INTO v2_audit_log (
        tabla, operacion, registro_id,
        datos_antes, datos_despues,
        usuario_id, usuario_email, usuario_role
    ) VALUES (
        TG_TABLE_NAME, TG_OP, v_registro_id,
        v_datos_antes, v_datos_despues,
        v_usuario_id, v_usuario_email, v_usuario_role
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;

EXCEPTION WHEN OTHERS THEN
    -- ✅ Si algo falla en el log, NO bloquear la operación real
    RAISE WARNING '[audit_log] Error al registrar en %: %', TG_TABLE_NAME, SQLERRM;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- ── 4. Aplicar trigger a las tablas críticas ──────────────────────────────

-- v2_asignaciones (check-ins, checkouts, extensiones)
DROP TRIGGER IF EXISTS trg_audit_asignaciones ON v2_asignaciones;
CREATE TRIGGER trg_audit_asignaciones
    AFTER INSERT OR UPDATE OR DELETE ON v2_asignaciones
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- v2_camas (cambios de estado: Ocupada/Disponible/Mantencion)
DROP TRIGGER IF EXISTS trg_audit_camas ON v2_camas;
CREATE TRIGGER trg_audit_camas
    AFTER UPDATE OR DELETE ON v2_camas
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- v2_solicitudes_b2b (carga y procesamiento de solicitudes)
DROP TRIGGER IF EXISTS trg_audit_solicitudes ON v2_solicitudes_b2b;
CREATE TRIGGER trg_audit_solicitudes
    AFTER INSERT OR UPDATE OR DELETE ON v2_solicitudes_b2b
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- v2_empresas (creación/modificación de empresas)
DROP TRIGGER IF EXISTS trg_audit_empresas ON v2_empresas;
CREATE TRIGGER trg_audit_empresas
    AFTER INSERT OR UPDATE OR DELETE ON v2_empresas
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- v2_incidencias_anglo (resolución de incidencias)
DROP TRIGGER IF EXISTS trg_audit_incidencias ON v2_incidencias_anglo;
CREATE TRIGGER trg_audit_incidencias
    AFTER INSERT OR UPDATE OR DELETE ON v2_incidencias_anglo
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 5. Vista conveniente para el panel de administración ──────────────────
CREATE OR REPLACE VIEW v2_audit_resumen AS
SELECT
    id,
    created_at AT TIME ZONE 'America/Santiago' AS fecha_hora_cl,
    usuario_email,
    usuario_role,
    operacion,
    tabla,
    registro_id,
    -- Campos clave según la tabla (para lectura rápida)
    CASE tabla
        WHEN 'v2_asignaciones' THEN
            COALESCE(datos_despues->>'nombre_huesped', datos_antes->>'nombre_huesped')
        WHEN 'v2_solicitudes_b2b' THEN
            COALESCE(datos_despues->>'nombre_trabajador', datos_antes->>'nombre_trabajador')
        WHEN 'v2_camas' THEN
            COALESCE(datos_despues->>'id_cama', datos_antes->>'id_cama')
        ELSE registro_id
    END AS descripcion,
    CASE tabla
        WHEN 'v2_asignaciones' THEN
            COALESCE(datos_despues->>'id_cama', datos_antes->>'id_cama')
        ELSE NULL
    END AS cama_afectada,
    datos_antes,
    datos_despues
FROM v2_audit_log
ORDER BY created_at DESC;

-- ── 6. VERIFICACIÓN ───────────────────────────────────────────────────────
-- Ejecuta esto para confirmar que los triggers están activos:
-- SELECT trigger_name, event_object_table, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_name LIKE 'trg_audit_%'
-- ORDER BY event_object_table;
