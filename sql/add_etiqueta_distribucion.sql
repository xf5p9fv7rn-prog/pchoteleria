-- Agrega columna etiqueta a v2_distribucion_camas
-- Usada para el tipo 'empresa' (guarda el nombre de la empresa asignada)
ALTER TABLE v2_distribucion_camas
  ADD COLUMN IF NOT EXISTS etiqueta TEXT DEFAULT '';
