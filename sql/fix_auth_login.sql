-- ============================================================
-- FIX: Reparar acceso de usuarios que no pueden iniciar sesión
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- 1. Ver estado actual de todos los usuarios de auth
SELECT 
    id,
    email,
    email_confirmed_at,
    last_sign_in_at,
    created_at,
    banned_until,
    CASE WHEN email_confirmed_at IS NULL THEN '❌ NO CONFIRMADO' ELSE '✅ CONFIRMADO' END AS estado_email
FROM auth.users
ORDER BY created_at DESC;

-- ============================================================
-- 2. Confirmar el email de juan-1154@hotmail.es (si aparece NULL arriba)
-- ============================================================
UPDATE auth.users
SET 
    email_confirmed_at = NOW(),
    updated_at = NOW()
WHERE email = 'juan-1154@hotmail.es'
  AND email_confirmed_at IS NULL;

-- ============================================================
-- 3. Confirmar emails de TODOS los usuarios que están sin confirmar
-- ============================================================
UPDATE auth.users
SET 
    email_confirmed_at = NOW(),
    updated_at = NOW()
WHERE email_confirmed_at IS NULL
  AND email IN (
      'juan-1154@hotmail.es',
      'hoteleriapc@aramark.cl',
      'araya-karin@aramark.cl',
      'barrera-guissele@aramark.cl',
      'castillo-maribel@aramark.cl',
      'vegao-rodrigo@aramark.cl'
  );

-- ============================================================
-- 4. Verificar resultado final
-- ============================================================
SELECT 
    email,
    email_confirmed_at,
    last_sign_in_at,
    banned_until
FROM auth.users
ORDER BY email;
