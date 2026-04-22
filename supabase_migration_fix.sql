-- ════════════════════════════════════════════════════════════════════════════
-- PC HOTELERÍA — MIGRACIÓN: Columnas faltantes en Supabase
-- Ejecuta en: Supabase → SQL Editor → New Query → RUN ▶
-- ════════════════════════════════════════════════════════════════════════════

-- ── FIX 1: rooms → campos de bloqueo ──────────────────────────────────────
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "blockReason"  TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "blockedAt"    TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "blockedBed"   TEXT;

-- ── FIX 2: b2b_requests → campos de admin Anglo y fecha ───────────────────
ALTER TABLE b2b_requests ADD COLUMN IF NOT EXISTS "angloAdmin"    TEXT;
ALTER TABLE b2b_requests ADD COLUMN IF NOT EXISTS "receivedDate"  TEXT;

-- ── Verificación ──────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('rooms', 'b2b_requests')
  AND column_name IN ('blockReason','blockedAt','blockedBed','angloAdmin','receivedDate')
ORDER BY table_name, column_name;
