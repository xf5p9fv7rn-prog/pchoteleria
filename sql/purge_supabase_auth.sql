-- ============================================================================
-- SCRIPT: Purgar cuentas viejas de Supabase Auth
-- PROPÓSITO: Eliminar todos los usuarios del sistema anterior y cerrar
--            todas las sesiones activas, antes de migrar a auth local.
-- ============================================================================
-- ⚠️  ADVERTENCIA: Este script es IRREVERSIBLE.
--     Ejecutar SOLO en Supabase SQL Editor con acceso de servicio.
--     Esto NO afecta la base de datos de la aplicación (v2_*), solo las
--     cuentas de autenticación (auth.users).
-- ============================================================================
-- INSTRUCCIONES:
--   1. Ve a tu proyecto en https://supabase.com/dashboard
--   2. Abre: Database → SQL Editor
--   3. Pega y ejecuta este script completo
--   4. Verifica en Authentication → Users que la lista quedó vacía
-- ============================================================================

-- Paso 1: Eliminar TODAS las sesiones activas (tokens JWT, refresh tokens)
DELETE FROM auth.sessions;

-- Paso 2: Eliminar todos los refresh tokens
DELETE FROM auth.refresh_tokens;

-- Paso 3: Eliminar todas las identidades vinculadas (OAuth, etc.)
DELETE FROM auth.identities;

-- Paso 4: Eliminar todos los usuarios de auth
DELETE FROM auth.users;

-- Paso 5: Verificación final — debe retornar 0 filas
SELECT 
    'usuarios_restantes' AS check_item,
    COUNT(*) AS cantidad
FROM auth.users
UNION ALL
SELECT 
    'sesiones_activas',
    COUNT(*)
FROM auth.sessions
UNION ALL
SELECT 
    'refresh_tokens',
    COUNT(*)
FROM auth.refresh_tokens;

-- ============================================================================
-- RESULTADO ESPERADO:
--   check_item            | cantidad
--   ----------------------+---------
--   usuarios_restantes    |        0
--   sesiones_activas      |        0
--   refresh_tokens        |        0
--
-- Si todos los valores son 0, la purga fue exitosa.
-- La aplicación ahora usará autenticación local (js/auth.js) con
-- credenciales SHA-256, sin depender de Supabase Auth.
-- ============================================================================
