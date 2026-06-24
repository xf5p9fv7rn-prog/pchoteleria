-- ══════════════════════════════════════════════════════════════════════
-- Migración: Acceso anónimo a v2_config para buffer RT
-- Propósito: El portal público (detalle-portal.html) necesita leer
--            el valor rt_buffer de v2_config para aplicar el mismo
--            buffer que el sistema interno y mostrar los mismos números.
-- ══════════════════════════════════════════════════════════════════════

-- Habilitar RLS si no está habilitado
ALTER TABLE v2_config ENABLE ROW LEVEL SECURITY;

-- Eliminar política anterior si existe
DROP POLICY IF EXISTS "portal_read_rt_buffer" ON v2_config;

-- Crear política: anon puede leer SOLO la fila rt_buffer (no expone datos sensibles)
CREATE POLICY "portal_read_rt_buffer"
  ON v2_config
  FOR SELECT
  TO anon
  USING (key = 'rt_buffer');

-- Nota: Esta política solo permite leer el porcentaje de reserva técnica (ej: "30").
-- No expone ningún dato sensible del sistema.
