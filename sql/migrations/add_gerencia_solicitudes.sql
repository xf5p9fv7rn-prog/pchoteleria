-- ══════════════════════════════════════════════════════════
-- PATCH: Agregar columna gerencia a v2_solicitudes_b2b
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════

-- 1. Agregar columna gerencia (texto libre, opcional)
ALTER TABLE v2_solicitudes_b2b
    ADD COLUMN IF NOT EXISTS gerencia TEXT;

-- 2. Verificar estructura final
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'v2_solicitudes_b2b'
ORDER BY ordinal_position;
