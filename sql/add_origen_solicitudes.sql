-- ═══════════════════════════════════════════════════════════
-- MIGRACIÓN: Agregar columnas a v2_solicitudes_b2b
-- Ejecutar UNA VEZ en el panel SQL de Supabase.
-- ═══════════════════════════════════════════════════════════

-- Columna "origen": distingue solicitudes normales vs. cargadas con habitación
ALTER TABLE v2_solicitudes_b2b
  ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT NULL;

COMMENT ON COLUMN v2_solicitudes_b2b.origen IS
  'Origen de la solicitud. NULL = flujo normal B2B. ''con_habitacion'' = cargada por admin con hab. ya asignada.';

-- Columna "turno": jornada del trabajador (Turno Día / Turno Noche)
ALTER TABLE v2_solicitudes_b2b
  ADD COLUMN IF NOT EXISTS turno TEXT DEFAULT NULL;

COMMENT ON COLUMN v2_solicitudes_b2b.turno IS
  'Jornada del trabajador según columna TIPO del Excel: ''Turno Día'' o ''Turno Noche''.';
