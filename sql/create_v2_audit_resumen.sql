-- ══════════════════════════════════════════════════════════════════════
-- AUDITORÍA v2 — Tabla base + Vista v2_audit_resumen
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════

-- 1. Tabla base de auditoría (si no existe)
CREATE TABLE IF NOT EXISTS public.v2_auditoria (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    fecha_hora      timestamptz DEFAULT now() NOT NULL,
    usuario_email   text,
    usuario_role    text,
    operacion       text CHECK (operacion IN ('INSERT','UPDATE','DELETE')),
    tabla           text,
    registro_id     text,
    cama_afectada   text,
    descripcion     text,
    datos_antes     jsonb,
    datos_despues   jsonb
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_v2_auditoria_fecha    ON public.v2_auditoria(fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_v2_auditoria_usuario  ON public.v2_auditoria(usuario_email);
CREATE INDEX IF NOT EXISTS idx_v2_auditoria_tabla    ON public.v2_auditoria(tabla);
CREATE INDEX IF NOT EXISTS idx_v2_auditoria_cama     ON public.v2_auditoria(cama_afectada);

-- 2. Vista con hora en formato Chile (UTC-4)
CREATE OR REPLACE VIEW public.v2_audit_resumen AS
SELECT
    id,
    (fecha_hora AT TIME ZONE 'America/Santiago') AS fecha_hora_cl,
    usuario_email,
    usuario_role,
    operacion,
    tabla,
    registro_id,
    cama_afectada,
    descripcion,
    datos_antes,
    datos_despues
FROM public.v2_auditoria
ORDER BY fecha_hora DESC;

-- 3. Permisos para que la app pueda leer y escribir
GRANT SELECT, INSERT ON public.v2_auditoria     TO anon, authenticated;
GRANT SELECT         ON public.v2_audit_resumen TO anon, authenticated;

-- 4. Deshabilitar RLS (o habilitar con política permisiva para superadmin)
ALTER TABLE public.v2_auditoria DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════
-- OPCIONAL: Función para insertar auditoría desde el cliente
-- (alternativa a triggers si no tienes acceso a funciones PG)
-- ══════════════════════════════════════════════════════════════════════
-- La app ya inserta directamente en v2_auditoria desde JS.
-- Si quieres triggers automáticos en asignaciones, ejecuta esto:

/*
CREATE OR REPLACE FUNCTION public.fn_audit_asignaciones()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.v2_auditoria(
      operacion, tabla, registro_id, cama_afectada,
      datos_antes, datos_despues, descripcion
  ) VALUES (
      TG_OP,
      'v2_asignaciones',
      COALESCE(NEW.id::text, OLD.id::text),
      COALESCE(NEW.id_cama, OLD.id_cama),
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
      CASE TG_OP
          WHEN 'INSERT' THEN 'Asignación creada: ' || COALESCE(NEW.rut_huesped,'—')
          WHEN 'UPDATE' THEN 'Asignación modificada: ' || COALESCE(NEW.rut_huesped,'—')
          WHEN 'DELETE' THEN 'Asignación eliminada: ' || COALESCE(OLD.rut_huesped,'—')
      END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trig_audit_asignaciones ON public.v2_asignaciones;
CREATE TRIGGER trig_audit_asignaciones
AFTER INSERT OR UPDATE OR DELETE ON public.v2_asignaciones
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_asignaciones();
*/
