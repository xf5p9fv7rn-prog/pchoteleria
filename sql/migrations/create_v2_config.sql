-- ══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Tabla v2_config — Configuración global sincronizada
-- ══════════════════════════════════════════════════════════════════════════
-- Propósito: Almacenar ajustes de configuración de la app que deben ser
--            iguales en TODOS los dispositivos (ej: % Reserva Técnica).
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v2_config (
  key         text PRIMARY KEY,       -- Identificador del ajuste (ej: 'rt_buffer')
  value       text NOT NULL,          -- Valor del ajuste (siempre string)
  updated_at  timestamptz DEFAULT now() -- Última modificación
);

-- Habilitar RLS
ALTER TABLE v2_config ENABLE ROW LEVEL SECURITY;

-- Lectura pública (anon puede leer todos los ajustes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'v2_config' AND policyname = 'anon_read_v2_config'
  ) THEN
    CREATE POLICY "anon_read_v2_config"
      ON v2_config FOR SELECT TO anon USING (true);
  END IF;
END$$;

-- Escritura pública (anon puede upsert — solo para configuración de display)
-- Seguro porque este ajuste no afecta datos reales, solo presentación visual.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'v2_config' AND policyname = 'anon_write_v2_config'
  ) THEN
    CREATE POLICY "anon_write_v2_config"
      ON v2_config FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Habilitar Realtime para notificaciones en tiempo real a todos los dispositivos
ALTER TABLE v2_config REPLICA IDENTITY FULL;

-- Insertar valor inicial del buffer (0% = sin reserva técnica por defecto)
INSERT INTO v2_config (key, value)
VALUES ('rt_buffer', '0')
ON CONFLICT (key) DO NOTHING;

-- Verificar
SELECT * FROM v2_config;
