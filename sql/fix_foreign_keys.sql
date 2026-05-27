-- ══════════════════════════════════════════════════════════════════════════
-- FIX FK: Declarar claves foráneas que Supabase necesita para joins anidados
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════
-- Si estas FKs ya existen, los comandos darán error que puedes ignorar.

-- FK: v2_camas → v2_habitaciones
ALTER TABLE v2_camas
  ADD CONSTRAINT fk_camas_habitacion
  FOREIGN KEY (habitacion_id) REFERENCES v2_habitaciones(id_custom)
  ON DELETE CASCADE;

-- FK: v2_habitaciones → v2_pabellones
ALTER TABLE v2_habitaciones
  ADD CONSTRAINT fk_habitaciones_pabellon
  FOREIGN KEY (pabellon_id) REFERENCES v2_pabellones(id)
  ON DELETE CASCADE;

-- FK: v2_pabellones → v2_edificios
ALTER TABLE v2_pabellones
  ADD CONSTRAINT fk_pabellones_edificio
  FOREIGN KEY (edificio_id) REFERENCES v2_edificios(id)
  ON DELETE CASCADE;

-- FK: v2_asignaciones → v2_camas
ALTER TABLE v2_asignaciones
  ADD CONSTRAINT fk_asignaciones_cama
  FOREIGN KEY (id_cama) REFERENCES v2_camas(id_cama)
  ON DELETE RESTRICT;

-- FK: v2_asignaciones → v2_empresas
ALTER TABLE v2_asignaciones
  ADD CONSTRAINT fk_asignaciones_empresa
  FOREIGN KEY (empresa_id) REFERENCES v2_empresas(id)
  ON DELETE RESTRICT;

-- Verificar FKs creadas
SELECT
    conname AS constraint_name,
    conrelid::regclass AS tabla,
    a.attname AS columna,
    confrelid::regclass AS tabla_referenciada
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND conrelid::regclass::text LIKE 'v2_%'
ORDER BY tabla, columna;
