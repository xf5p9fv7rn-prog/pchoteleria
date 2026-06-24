-- ══════════════════════════════════════════════════════════════════════
-- Migración: Agregar columnas de bloqueo a v2_habitaciones
-- Propósito: Permitir registrar fecha y motivo cuando una habitación
--            es bloqueada por mantenimiento desde la UI de Infraestructura.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE v2_habitaciones
  ADD COLUMN IF NOT EXISTS fecha_bloqueo   DATE         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS motivo_bloqueo  TEXT         DEFAULT NULL;

-- Comentarios
COMMENT ON COLUMN v2_habitaciones.fecha_bloqueo  IS 'Fecha en que se bloqueó la habitación por mantención';
COMMENT ON COLUMN v2_habitaciones.motivo_bloqueo IS 'Motivo del bloqueo (ej: Mantención, Reparación)';
