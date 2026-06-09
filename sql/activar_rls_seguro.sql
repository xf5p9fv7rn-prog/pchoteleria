-- ═══════════════════════════════════════════════════════════════════════════
-- SEGURIDAD RLS — PC HOTELERÍA
-- Activa Row Level Security en 4 tablas sin romper la lógica de la app.
-- Las políticas permiten exactamente lo mismo que antes, pero de forma explícita.
--
-- ✅ SEGURO: No cambia permisos ni datos. Solo formaliza el acceso.
-- ▶ Ejecutar en: Supabase → SQL Editor → Nuevo script → Pegar → Run
-- ═══════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────
-- 1. public.users  (tabla de administradores — tiene contraseñas y roles)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- La app usa la clave anon para leer esta tabla al hacer login
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='users' AND schemaname='public' AND policyname='users_anon_select'
  ) THEN
    CREATE POLICY "users_anon_select"
      ON public.users FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='users' AND schemaname='public' AND policyname='users_anon_insert'
  ) THEN
    CREATE POLICY "users_anon_insert"
      ON public.users FOR INSERT TO anon WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='users' AND schemaname='public' AND policyname='users_anon_update'
  ) THEN
    CREATE POLICY "users_anon_update"
      ON public.users FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='users' AND schemaname='public' AND policyname='users_anon_delete'
  ) THEN
    CREATE POLICY "users_anon_delete"
      ON public.users FOR DELETE TO anon USING (true);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────
-- 2. public.logs  (auditoría de acciones)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='logs' AND schemaname='public' AND policyname='logs_anon_all'
  ) THEN
    CREATE POLICY "logs_anon_all"
      ON public.logs FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────
-- 3. public.v2_cupos_gerencias  (ya tiene políticas, solo activar RLS)
--    Se agrega política anon amplia PRIMERO para evitar corte de acceso.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='v2_cupos_gerencias' AND schemaname='public' AND policyname='cupos_anon_all'
  ) THEN
    CREATE POLICY "cupos_anon_all"
      ON public.v2_cupos_gerencias FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.v2_cupos_gerencias ENABLE ROW LEVEL SECURITY;


-- ──────────────────────────────────────────────────────────────────────────
-- 4. public.v2_solicitudes_b2b  (ya tiene políticas, solo activar RLS)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='v2_solicitudes_b2b' AND schemaname='public' AND policyname='solicitudes_anon_all'
  ) THEN
    CREATE POLICY "solicitudes_anon_all"
      ON public.v2_solicitudes_b2b FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.v2_solicitudes_b2b ENABLE ROW LEVEL SECURITY;


-- ──────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — Ejecutar después para confirmar que todo quedó bien
-- ──────────────────────────────────────────────────────────────────────────
SELECT
  schemaname,
  tablename,
  rowsecurity AS "RLS activado",
  (SELECT count(*) FROM pg_policies p
   WHERE p.tablename = c.tablename AND p.schemaname = c.schemaname) AS "num políticas"
FROM pg_tables c
WHERE schemaname = 'public'
  AND tablename IN ('users','logs','v2_cupos_gerencias','v2_solicitudes_b2b')
ORDER BY tablename;
