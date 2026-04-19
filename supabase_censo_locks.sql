-- ══════════════════════════════════════════════════════════════
-- PC Hotelería — Tabla de bloqueos de piso para Censo en Terreno
-- Ejecutar en: Supabase → SQL Editor → New Query → Run
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS censo_locks (
    id          TEXT PRIMARY KEY,
    rut         TEXT NOT NULL,
    floor_label TEXT,
    locked_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE censo_locks ENABLE ROW LEVEL SECURITY;

-- Eliminar policies existentes si las hay (para evitar error de duplicado)
DROP POLICY IF EXISTS "Lectura pública"      ON censo_locks;
DROP POLICY IF EXISTS "Escritura pública"    ON censo_locks;
DROP POLICY IF EXISTS "Actualización pública" ON censo_locks;
DROP POLICY IF EXISTS "Eliminación pública"  ON censo_locks;

-- Crear policies nuevas
CREATE POLICY "Lectura pública"       ON censo_locks FOR SELECT USING (true);
CREATE POLICY "Escritura pública"     ON censo_locks FOR INSERT WITH CHECK (true);
CREATE POLICY "Actualización pública" ON censo_locks FOR UPDATE USING (true);
CREATE POLICY "Eliminación pública"   ON censo_locks FOR DELETE USING (true);

