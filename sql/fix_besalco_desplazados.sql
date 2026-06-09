-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECCIÓN DE ASIGNACIONES DESPLAZADAS — BESALCO
-- Ejecutar en Supabase SQL Editor
-- IMPORTANTE: Este script usa BEGIN/COMMIT para que sea atómico.
--             Si algo falla, hace ROLLBACK automático.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1: Mireya Ortiz → 5514 (actualmente en 5301)
-- ────────────────────────────────────────────────────────────────────────────
-- 1a. Mover su asignación a la cama correcta en 5514
UPDATE v2_asignaciones
   SET id_cama = 'COPC000688-C1'
 WHERE rut_huesped ILIKE '%137465647%'
   AND fecha_checkout IS NULL;

-- 1b. Liberar cama que deja
UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = 'COPC000617-C1';

-- 1c. Marcar cama de destino
UPDATE v2_camas SET estado = 'Ocupada'    WHERE id_cama = 'COPC000688-C1';

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2: Jaime Ahumada → 5301 (actualmente en 6302)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE v2_asignaciones
   SET id_cama = 'COPC000617-C1'
 WHERE rut_huesped ILIKE '%146255728%'
   AND fecha_checkout IS NULL;

UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = 'COPC000771-C1';
UPDATE v2_camas SET estado = 'Ocupada'    WHERE id_cama = 'COPC000617-C1';

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3: Maximiliano Garrido → 6302 (actualmente en 7520)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE v2_asignaciones
   SET id_cama = 'COPC000771-C1'
 WHERE rut_huesped ILIKE '%20760030%'
   AND fecha_checkout IS NULL;

UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = 'COPC001029-C1';
UPDATE v2_camas SET estado = 'Ocupada'    WHERE id_cama = 'COPC000771-C1';

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 4: Alexis Sandoval → 7520 (actualmente en 7629)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE v2_asignaciones
   SET id_cama = 'COPC001029-C1'
 WHERE rut_huesped ILIKE '%19222943%'
   AND fecha_checkout IS NULL;

UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = 'COPC001073-C1';
UPDATE v2_camas SET estado = 'Ocupada'    WHERE id_cama = 'COPC001029-C1';

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 5: Juan Mena → 7629 (actualmente en 8502)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE v2_asignaciones
   SET id_cama = 'COPC001073-C1'
 WHERE rut_huesped ILIKE '%118909224%'
   AND fecha_checkout IS NULL;

UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = 'COPC001202-C2';
UPDATE v2_camas SET estado = 'Ocupada'    WHERE id_cama = 'COPC001073-C1';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN FINAL — debe mostrar 5 filas con la hab correcta
-- ────────────────────────────────────────────────────────────────────────────
SELECT
    a.nombre_huesped,
    a.rut_huesped,
    h.numero_hab AS hab_actual,
    CASE
        WHEN a.rut_huesped ILIKE '%137465647%' THEN '5514 ✅'
        WHEN a.rut_huesped ILIKE '%146255728%' THEN '5301 ✅'
        WHEN a.rut_huesped ILIKE '%20760030%'  THEN '6302 ✅'
        WHEN a.rut_huesped ILIKE '%19222943%'  THEN '7520 ✅'
        WHEN a.rut_huesped ILIKE '%118909224%' THEN '7629 ✅'
    END AS hab_esperada
FROM v2_asignaciones a
JOIN v2_camas c ON c.id_cama = a.id_cama
JOIN v2_habitaciones h ON h.id_custom = c.habitacion_id
WHERE a.fecha_checkout IS NULL
  AND (
    a.rut_huesped ILIKE '%137465647%' OR
    a.rut_huesped ILIKE '%146255728%' OR
    a.rut_huesped ILIKE '%20760030%'  OR
    a.rut_huesped ILIKE '%19222943%'  OR
    a.rut_huesped ILIKE '%118909224%'
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- CASOS QUE REQUIEREN DECISIÓN MANUAL
-- (Los cuartos target ya tienen 2 personas de carga anterior)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  Valenzuela Gonzalez Felipe   → sol:5301  (5301 ya tiene 2 personas)
-- ⚠️  Diego Rivera Rojas           → sol:7520  (7520 ya tiene 2 personas tras fix)
-- ⚠️  Cristian Fuentes Muñoz       → sol:7629  (7629 ya tiene 2 personas tras fix)
-- ⚠️  Cesar Escobar                → sol:8201  (8201 tiene Michel + Rodolfo Barraza)
-- ⚠️  Rodolfo Barraza Barraza      → sol:7616  (7616 tiene Castillo + Moya de carga anterior)
-- ⚠️  Elias Gonzalez Perez         → sol:7616  (ídem)
-- ⚠️  Diego Sanchez Lopez          → sol:7613  (7613 tiene Corrales + Ruz de carga anterior)
-- ⚠️  Kevin Anabalon Aguilera      → sol:7613  (ídem)
-- ═══════════════════════════════════════════════════════════════════════════