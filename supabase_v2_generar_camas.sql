-- ════════════════════════════════════════════════════════════════════════════════
-- V2: AUTO-GENERAR CAMAS desde v2_habitaciones
-- Ejecutar DESPUÉS de cargar las habitaciones
-- Este script lee cada habitación y genera sus camas automáticamente
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  hab RECORD;
  i   INT;
BEGIN
  FOR hab IN
    SELECT id_custom, cantidad_camas
    FROM   v2_habitaciones
    WHERE  cantidad_camas > 0
    ORDER BY id_custom
  LOOP
    FOR i IN 1..hab.cantidad_camas LOOP
      INSERT INTO v2_camas (id_cama, habitacion_id, numero_cama, estado)
      VALUES (
        hab.id_custom || '-C' || i,
        hab.id_custom,
        i,
        'Disponible'
      )
      ON CONFLICT (id_cama) DO NOTHING;  -- idempotente: no falla si ya existe
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Camas generadas: %', (SELECT COUNT(*) FROM v2_camas);
END $$;

-- Verificación rápida
SELECT
  e.nombre                    AS edificio,
  COUNT(DISTINCT h.id_custom) AS habitaciones,
  COUNT(c.id_cama)            AS camas
FROM v2_edificios    e
JOIN v2_pabellones   p ON p.edificio_id = e.id
JOIN v2_habitaciones h ON h.pabellon_id = p.id
LEFT JOIN v2_camas   c ON c.habitacion_id = h.id_custom
GROUP BY e.nombre
ORDER BY e.nombre;
