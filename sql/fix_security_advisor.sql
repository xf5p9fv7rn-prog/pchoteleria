-- ═══════════════════════════════════════════════════════════════════════
-- FIX: Security Definer Views restantes
-- Vistas afectadas (nombres exactos del Security Advisor):
--   · public.v2_camas_perdidas_view
--   · public.v2_audit_resumen
-- ═══════════════════════════════════════════════════════════════════════

ALTER VIEW public.v2_camas_perdidas_view SET (security_invoker = on);
ALTER VIEW public.v2_audit_resumen       SET (security_invoker = on);

-- Verificación
SELECT table_name, is_updatable
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN ('v2_camas_perdidas_view', 'v2_audit_resumen');
