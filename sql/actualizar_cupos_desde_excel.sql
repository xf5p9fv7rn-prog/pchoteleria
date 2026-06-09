-- ══════════════════════════════════════════════════════════════════
-- ACTUALIZAR cupos_totales en v2_cupos_gerencias desde CUPO.xlsx
-- 90 registros · generado automáticamente
-- ══════════════════════════════════════════════════════════════════

-- PASO 1 ▶ Ver cuántos coinciden antes de actualizar
SELECT COUNT(*) AS coinciden
FROM v2_cupos_gerencias
WHERE numero_contrato IN (
  '11902281',
  '12001061',
  '12001271',
  '12001331',
  '12001851',
  '12001911',
  '12002001',
  '12100101',
  '12101351',
  '12101421',
  '12101711',
  '12101941',
  '12102121',
  '12113541',
  '12200081',
  '12200661',
  '12200681',
  '12200971',
  '12200991',
  '12201971',
  '12300101',
  '12300251',
  '12300391',
  '12300801',
  '12300971',
  '12301071',
  '12301121',
  '12301181',
  '12301241',
  '12301251',
  '12301371',
  '12301441',
  '12301561',
  '12301641',
  '12301642',
  '12301901',
  '12400431',
  '12400521',
  '12400542',
  '12400551',
  '12400752',
  '12400771',
  '12400781',
  '12400782',
  '12400851',
  '12400991',
  '12401021',
  '12401061',
  '12500031',
  '12500141',
  '12500191',
  '12500201',
  '12500611',
  '12500961',
  '12501261',
  '12501361',
  '14174743',
  '42000021',
  '42000134',
  '42000391',
  '42200051',
  '42200061',
  '42200151',
  '42300031',
  '42300051',
  '42400011'
);

-- ══════════════════════════════════════════════════════════════════
-- PASO 2 ▶ Actualizar cupos_totales por (contrato + gerencia)
-- Descomenta y ejecuta después de verificar el PASO 1
-- ══════════════════════════════════════════════════════════════════
/*

-- BESALCO | ARIDOS | Contrato 12200681
UPDATE v2_cupos_gerencias
SET cupos_totales = 10
WHERE numero_contrato = '12200681'
  AND (gerencia ILIKE '%ARIDOS%' OR gerencia IS NULL);

-- BESALCO | ARIDOS | Contrato 12400991
UPDATE v2_cupos_gerencias
SET cupos_totales = 20
WHERE numero_contrato = '12400991'
  AND (gerencia ILIKE '%ARIDOS%' OR gerencia IS NULL);

-- METSO OUTOTEC | BASE | Contrato 12501361
UPDATE v2_cupos_gerencias
SET cupos_totales = 38
WHERE numero_contrato = '12501361'
  AND (gerencia ILIKE '%BASE%' OR gerencia IS NULL);

-- BUSES HUALPEN | BUSES | Contrato 42000021
UPDATE v2_cupos_gerencias
SET cupos_totales = 44
WHERE numero_contrato = '42000021'
  AND (gerencia ILIKE '%BUSES%' OR gerencia IS NULL);

-- BUSES HUALPEN | CAMIONETAS | Contrato 42000021
UPDATE v2_cupos_gerencias
SET cupos_totales = 10
WHERE numero_contrato = '42000021'
  AND (gerencia ILIKE '%CAMIONETAS%' OR gerencia IS NULL);

-- MAPER LTDA. | CARGAS VARIAS | Contrato 42200151
UPDATE v2_cupos_gerencias
SET cupos_totales = 18
WHERE numero_contrato = '42200151'
  AND (gerencia ILIKE '%CARGAS VARIAS%' OR gerencia IS NULL);

-- FOURTHANE S.A. | CATODOS | Contrato 12301071
UPDATE v2_cupos_gerencias
SET cupos_totales = 12
WHERE numero_contrato = '12301071'
  AND (gerencia ILIKE '%CATODOS%' OR gerencia IS NULL);

-- RELIX | CATODOS | Contrato 12101351
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12101351'
  AND (gerencia ILIKE '%CATODOS%' OR gerencia IS NULL);

-- NETAXION CHILE | Contingente Komatsu Autonomía | Contrato 12300251
UPDATE v2_cupos_gerencias
SET cupos_totales = 36
WHERE numero_contrato = '12300251'
  AND (gerencia ILIKE '%Contingente Komatsu Autonomía%' OR gerencia IS NULL);

-- FOURTHANE S.A. | CORREAS | Contrato 12500201
UPDATE v2_cupos_gerencias
SET cupos_totales = 14
WHERE numero_contrato = '12500201'
  AND (gerencia ILIKE '%CORREAS%' OR gerencia IS NULL);

-- KCC | CUMMINS | Contrato 12101711
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12101711'
  AND (gerencia ILIKE '%CUMMINS%' OR gerencia IS NULL);

-- ESACHS | DESDE 204 | Contrato 42300051
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '42300051'
  AND (gerencia ILIKE '%DESDE 204%' OR gerencia IS NULL);

-- ORBIT | DEWATERING | Contrato 12500031
UPDATE v2_cupos_gerencias
SET cupos_totales = 26
WHERE numero_contrato = '12500031'
  AND (gerencia ILIKE '%DEWATERING%' OR gerencia IS NULL);

-- RELIX | DEWATERING | Contrato 12301121
UPDATE v2_cupos_gerencias
SET cupos_totales = 30
WHERE numero_contrato = '12301121'
  AND (gerencia ILIKE '%DEWATERING%' OR gerencia IS NULL);

-- KUPFER HERMANOS S.A. | EMSESA | Contrato 12301901
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12301901'
  AND (gerencia ILIKE '%EMSESA%' OR gerencia IS NULL);

-- ESACHS | ESPECIALISTAS | Contrato 42300051
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '42300051'
  AND (gerencia ILIKE '%ESPECIALISTAS%' OR gerencia IS NULL);

-- ORBIT | GEOLOGIA | Contrato 12301181
UPDATE v2_cupos_gerencias
SET cupos_totales = 46
WHERE numero_contrato = '12301181'
  AND (gerencia ILIKE '%GEOLOGIA%' OR gerencia IS NULL);

-- KOMATSU CHILE | KOMATSU AUTONOMIA | Contrato 12200081
UPDATE v2_cupos_gerencias
SET cupos_totales = 12
WHERE numero_contrato = '12200081'
  AND (gerencia ILIKE '%KOMATSU AUTONOMIA%' OR gerencia IS NULL);

-- RELIX | LINEA DE ANILLO | Contrato 12301121
UPDATE v2_cupos_gerencias
SET cupos_totales = 8
WHERE numero_contrato = '12301121'
  AND (gerencia ILIKE '%LINEA DE ANILLO%' OR gerencia IS NULL);

-- EQUANS INDUSTRIAL SPA | MANTENCION CHANCADO | Contrato 12500191
UPDATE v2_cupos_gerencias
SET cupos_totales = 12
WHERE numero_contrato = '12500191'
  AND (gerencia ILIKE '%MANTENCION CHANCADO%' OR gerencia IS NULL);

-- KONECRANES | Mantencion Molienda | Contrato 12500961
UPDATE v2_cupos_gerencias
SET cupos_totales = 6
WHERE numero_contrato = '12500961'
  AND (gerencia ILIKE '%Mantencion Molienda%' OR gerencia IS NULL);

-- CESMEC | MEDIOAMBIENTE | Contrato 11902281
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '11902281'
  AND (gerencia ILIKE '%MEDIOAMBIENTE%' OR gerencia IS NULL);

-- DHL GLOBAL FORWARDING (CHILE) S. | OPERACION BODEGA | Contrato 42200051
UPDATE v2_cupos_gerencias
SET cupos_totales = 20
WHERE numero_contrato = '42200051'
  AND (gerencia ILIKE '%OPERACION BODEGA%' OR gerencia IS NULL);

-- CESMEC | OPERACIÓN INVIERNO | Contrato 12200991
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12200991'
  AND (gerencia ILIKE '%OPERACIÓN INVIERNO%' OR gerencia IS NULL);

-- ALTO SUR SPA | OPERACIONES | Contrato 12301641
UPDATE v2_cupos_gerencias
SET cupos_totales = 0
WHERE numero_contrato = '12301641'
  AND (gerencia ILIKE '%OPERACIONES%' OR gerencia IS NULL);

-- ROCMIN | OPERACIONES | Contrato 12500611
UPDATE v2_cupos_gerencias
SET cupos_totales = 12
WHERE numero_contrato = '12500611'
  AND (gerencia ILIKE '%OPERACIONES%' OR gerencia IS NULL);

-- ROCMIN | OPERACIONES | Contrato 12500611
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12500611'
  AND (gerencia ILIKE '%OPERACIONES%' OR gerencia IS NULL);

-- CYG SERVICIOS | PLANTAS | Contrato 12002001
UPDATE v2_cupos_gerencias
SET cupos_totales = 34
WHERE numero_contrato = '12002001'
  AND (gerencia ILIKE '%PLANTAS%' OR gerencia IS NULL);

-- BESALCO | PRECHANCADO | Contrato 12301561
UPDATE v2_cupos_gerencias
SET cupos_totales = 28
WHERE numero_contrato = '12301561'
  AND (gerencia ILIKE '%PRECHANCADO%' OR gerencia IS NULL);

-- BESALCO | Red Vial/Caminos | Contrato 12200681
UPDATE v2_cupos_gerencias
SET cupos_totales = 46
WHERE numero_contrato = '12200681'
  AND (gerencia ILIKE '%Red Vial/Caminos%' OR gerencia IS NULL);

-- BESALCO | Red Vial/Caminos Mina | Contrato 12200681
UPDATE v2_cupos_gerencias
SET cupos_totales = 28
WHERE numero_contrato = '12200681'
  AND (gerencia ILIKE '%Red Vial/Caminos Mina%' OR gerencia IS NULL);

-- BESALCO | Red Vial/Caminos Mina | Contrato 12400991
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12400991'
  AND (gerencia ILIKE '%Red Vial/Caminos Mina%' OR gerencia IS NULL);

-- ALTO SUR SPA | RESERVA ALTO SUR | Contrato 12301641
UPDATE v2_cupos_gerencias
SET cupos_totales = 12
WHERE numero_contrato = '12301641'
  AND (gerencia ILIKE '%RESERVA ALTO SUR%' OR gerencia IS NULL);

-- HK INGENIERIA | RESERVA ARAMARK | Contrato 12401021
UPDATE v2_cupos_gerencias
SET cupos_totales = 6
WHERE numero_contrato = '12401021'
  AND (gerencia ILIKE '%RESERVA ARAMARK%' OR gerencia IS NULL);

-- GEOBARRA EXINS | RESIDUOS | Contrato 12400781
UPDATE v2_cupos_gerencias
SET cupos_totales = 12
WHERE numero_contrato = '12400781'
  AND (gerencia ILIKE '%RESIDUOS%' OR gerencia IS NULL);

-- KUPFER HERMANOS S.A. | SEGURIDAD INDUSTRIAL | Contrato 12400851
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12400851'
  AND (gerencia ILIKE '%SEGURIDAD INDUSTRIAL%' OR gerencia IS NULL);

-- ESACHS | SEL | Contrato 42300051
UPDATE v2_cupos_gerencias
SET cupos_totales = 3
WHERE numero_contrato = '42300051'
  AND (gerencia ILIKE '%SEL%' OR gerencia IS NULL);

-- INDEMIN | SERVICIO APOYO OPERACIONAL PLANTA | Contrato 12200661
UPDATE v2_cupos_gerencias
SET cupos_totales = 16
WHERE numero_contrato = '12200661'
  AND (gerencia ILIKE '%SERVICIO APOYO OPERACIONAL PLANTA%' OR gerencia IS NULL);

-- RELIX | SISTEMA DE TRANSPORTES PULPA(STP) | Contrato 12301241
UPDATE v2_cupos_gerencias
SET cupos_totales = 8
WHERE numero_contrato = '12301241'
  AND (gerencia ILIKE '%SISTEMA DE TRANSPORTES PULPA(STP)%' OR gerencia IS NULL);

-- METSO OUTOTEC | SPOT | Contrato 12501361
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12501361'
  AND (gerencia ILIKE '%SPOT%' OR gerencia IS NULL);

-- GLOBAL ELECTRIC | SSPP | Contrato 12501261
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12501261'
  AND (gerencia ILIKE '%SSPP%' OR gerencia IS NULL);

-- TRANSPORTE OSORIO Y TAPIA | SUBCONTRATO COPEC | Contrato 12300101
UPDATE v2_cupos_gerencias
SET cupos_totales = 0
WHERE numero_contrato = '12300101'
  AND (gerencia ILIKE '%SUBCONTRATO COPEC%' OR gerencia IS NULL);

-- TERMIKA | SUBCONTRATO EQUANS | Contrato 12001331
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12001331'
  AND (gerencia ILIKE '%SUBCONTRATO EQUANS%' OR gerencia IS NULL);

-- GUINEZ ING LTDA | TECNICA | Contrato 12400431
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12400431'
  AND (gerencia ILIKE '%TECNICA%' OR gerencia IS NULL);

-- PUCARA | TECNICA | Contrato 12300801
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12300801'
  AND (gerencia ILIKE '%TECNICA%' OR gerencia IS NULL);

-- ROCMIN | TOMA DE MUESTRA | Contrato 12500611
UPDATE v2_cupos_gerencias
SET cupos_totales = 10
WHERE numero_contrato = '12500611'
  AND (gerencia ILIKE '%TOMA DE MUESTRA%' OR gerencia IS NULL);

-- MAPER LTDA. | TRANSPORTES CAL | Contrato 12201971
UPDATE v2_cupos_gerencias
SET cupos_totales = 14
WHERE numero_contrato = '12201971'
  AND (gerencia ILIKE '%TRANSPORTES CAL%' OR gerencia IS NULL);

-- MAPER LTDA. | TRANSPORTES CAL | Contrato 42200151
UPDATE v2_cupos_gerencias
SET cupos_totales = 0
WHERE numero_contrato = '42200151'
  AND (gerencia ILIKE '%TRANSPORTES CAL%' OR gerencia IS NULL);

-- SAN ISIDRO | VALIDAR HASTA 29-05-2026 | Contrato 12400521
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12400521'
  AND (gerencia ILIKE '%VALIDAR HASTA 29-05-2026%' OR gerencia IS NULL);

-- ALTO SUR SPA | W21 | Contrato 12301641
UPDATE v2_cupos_gerencias
SET cupos_totales = 0
WHERE numero_contrato = '12301641'
  AND (gerencia ILIKE '%W21%' OR gerencia IS NULL);

-- ALMAR WATER SERVICIOS LATAM SA | (en blanco) | Contrato 12400782
UPDATE v2_cupos_gerencias
SET cupos_totales = 19
WHERE numero_contrato = '12400782';

-- ALTO SUR SPA | (en blanco) | Contrato 12301641
UPDATE v2_cupos_gerencias
SET cupos_totales = 28
WHERE numero_contrato = '12301641';

-- AMBIPAR | (en blanco) | Contrato 12001271
UPDATE v2_cupos_gerencias
SET cupos_totales = 14
WHERE numero_contrato = '12001271';

-- ARAMARK | (en blanco) | Contrato 42300031
UPDATE v2_cupos_gerencias
SET cupos_totales = 306
WHERE numero_contrato = '42300031';

-- ARTICULOS DE SEGURIDAD WILUG LTD | (en blanco) | Contrato 12301371
UPDATE v2_cupos_gerencias
SET cupos_totales = 22
WHERE numero_contrato = '12301371';

-- ASITEL | (en blanco) | Contrato 12001061
UPDATE v2_cupos_gerencias
SET cupos_totales = 1
WHERE numero_contrato = '12001061';

-- AUTORENTAS DEL PACIFICO LTDA. | (en blanco) | Contrato 42400011
UPDATE v2_cupos_gerencias
SET cupos_totales = 10
WHERE numero_contrato = '42400011';

-- BAILAC | (en blanco) | Contrato 12401061
UPDATE v2_cupos_gerencias
SET cupos_totales = 38
WHERE numero_contrato = '12401061';

-- BEL-RAY | (en blanco) | Contrato 12400771
UPDATE v2_cupos_gerencias
SET cupos_totales = 8
WHERE numero_contrato = '12400771';

-- BEL-RAY | (en blanco) | Contrato 42000134
UPDATE v2_cupos_gerencias
SET cupos_totales = 8
WHERE numero_contrato = '42000134';

-- BSM | (en blanco) | Contrato 42300031
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '42300031';

-- BURGER LTDA | (en blanco) | Contrato 12001911
UPDATE v2_cupos_gerencias
SET cupos_totales = 10
WHERE numero_contrato = '12001911';

-- BUSES HUALPEN | (en blanco) | Contrato 42000021
UPDATE v2_cupos_gerencias
SET cupos_totales = 5
WHERE numero_contrato = '42000021';

-- CESMEC | (en blanco) | Contrato 12200991
UPDATE v2_cupos_gerencias
SET cupos_totales = 1
WHERE numero_contrato = '12200991';

-- CLONSA INGENIER | (en blanco) | Contrato 12101421
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12101421';

-- COMPROBE | (en blanco) | Contrato 12500141
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12500141';

-- CYG SERVICIOS | (en blanco) | Contrato 12002001
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12002001';

-- DIPERK | (en blanco) | Contrato 14174743
UPDATE v2_cupos_gerencias
SET cupos_totales = 0
WHERE numero_contrato = '14174743';

-- ENAEX SERVICIOS | (en blanco) | Contrato 42000391
UPDATE v2_cupos_gerencias
SET cupos_totales = 36
WHERE numero_contrato = '42000391';

-- ESACHS | (en blanco) | Contrato 12113541
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12113541';

-- ESACHS | (en blanco) | Contrato 42300051
UPDATE v2_cupos_gerencias
SET cupos_totales = 17
WHERE numero_contrato = '42300051';

-- FLUITEK MARCO | (en blanco) | Contrato 12301251
UPDATE v2_cupos_gerencias
SET cupos_totales = 8
WHERE numero_contrato = '12301251';

-- GEOBARRA EXINS | (en blanco) | Contrato 12100101
UPDATE v2_cupos_gerencias
SET cupos_totales = 38
WHERE numero_contrato = '12100101';

-- GUINEZ ING LTDA | (en blanco) | Contrato 12400431
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12400431';

-- IMMERSIVE | (en blanco) | Contrato 12400551
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12400551';

-- INDEMIN | (en blanco) | Contrato 12200661
UPDATE v2_cupos_gerencias
SET cupos_totales = 10
WHERE numero_contrato = '12200661';

-- INGEQUIMICA | (en blanco) | Contrato 42300031
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '42300031';

-- JIA | (en blanco) | Contrato 12400752
UPDATE v2_cupos_gerencias
SET cupos_totales = 8
WHERE numero_contrato = '12400752';

-- MEDS | (en blanco) | Contrato 12300391
UPDATE v2_cupos_gerencias
SET cupos_totales = 2
WHERE numero_contrato = '12300391';

-- METSO OUTOTEC | (en blanco) | Contrato 12501361
UPDATE v2_cupos_gerencias
SET cupos_totales = 26
WHERE numero_contrato = '12501361';

-- MORKEN | (en blanco) | Contrato 12200971
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12200971';

-- MUTUAL ASESORIAS | (en blanco) | Contrato 12102121
UPDATE v2_cupos_gerencias
SET cupos_totales = 1
WHERE numero_contrato = '12102121';

-- NAVARRO | (en blanco) | Contrato 12400542
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12400542';

-- PACOLL | (en blanco) | Contrato 12301642
UPDATE v2_cupos_gerencias
SET cupos_totales = 44
WHERE numero_contrato = '12301642';

-- SAENS | (en blanco) | Contrato 12001851
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12001851';

-- SAN ISIDRO | (en blanco) | Contrato 12400521
UPDATE v2_cupos_gerencias
SET cupos_totales = 4
WHERE numero_contrato = '12400521';

-- SOMACOR S.A. | (en blanco) | Contrato 42200061
UPDATE v2_cupos_gerencias
SET cupos_totales = 10
WHERE numero_contrato = '42200061';

-- TANDEM S.A. | (en blanco) | Contrato 12101941
UPDATE v2_cupos_gerencias
SET cupos_totales = 16
WHERE numero_contrato = '12101941';

-- TRES60 | (en blanco) | Contrato 12300971
UPDATE v2_cupos_gerencias
SET cupos_totales = 6
WHERE numero_contrato = '12300971';

-- TRICONOS | (en blanco) | Contrato 12301441
UPDATE v2_cupos_gerencias
SET cupos_totales = 6
WHERE numero_contrato = '12301441';

*/

-- ══════════════════════════════════════════════════════════════════
-- PASO 3 ▶ Insertar contratos NUEVOS que no existen en el sistema
-- ══════════════════════════════════════════════════════════════════
/*

INSERT INTO v2_cupos_gerencias
    (numero_contrato, empresa, gerencia, cupos_totales, cupos_ocupados)
SELECT v.contrato, v.empresa, v.gerencia, v.cupos, 0
FROM (VALUES
    ('12200681', 'BESALCO MAQUINARIAS S.A.', 'ARIDOS', 10),
    ('12400991', 'BESALCO MAQUINARIAS S.A.', 'ARIDOS', 20),
    ('12501361', 'METSO INDUSTRIAL SERVICE SPA', 'BASE', 38),
    ('42000021', 'EMPRESA DE BUSES HUALPEN LIMITADA', 'BUSES', 44),
    ('42000021', 'EMPRESA DE BUSES HUALPEN LIMITADA', 'CAMIONETAS', 10),
    ('42200151', 'MAPER LTDA.', 'CARGAS VARIAS', 18),
    ('12301071', 'FOURTHANE S.A.', 'CATODOS', 12),
    ('12101351', 'RELIX S.A.', 'CATODOS', 4),
    ('12300251', 'NETAXION CHILE SPA', 'Contingente Komatsu Autonomía', 36),
    ('12500201', 'FOURTHANE S.A.', 'CORREAS', 14),
    ('12101711', 'KOMATSU CHILE S.A', 'CUMMINS', 4),
    ('42300051', 'ESACHS', 'DESDE 204', 2),
    ('12500031', 'ORBIT GARANT CHILE S.A.', 'DEWATERING', 26),
    ('12301121', 'RELIX S.A.', 'DEWATERING', 30),
    ('12301901', 'KUPFER HERMANOS S.A.', 'EMSESA', 4),
    ('42300051', 'ESACHS', 'ESPECIALISTAS', 2),
    ('12301181', 'ORBIT GARANT CHILE S.A.', 'GEOLOGIA', 46),
    ('12200081', 'KOMATSU CHILE S.A', 'KOMATSU AUTONOMIA', 12),
    ('12301121', 'RELIX S.A.', 'LINEA DE ANILLO', 8),
    ('12500191', 'EQUANS INDUSTRIAL SPA', 'MANTENCION CHANCADO', 12),
    ('12500961', 'KONECRANES CHILE SPA', 'Mantencion Molienda', 6),
    ('11902281', 'CESMEC', 'MEDIOAMBIENTE', 2),
    ('42200051', 'DHL GLOBAL FORWARDING (CHILE) S.', 'OPERACION BODEGA', 20),
    ('12200991', 'CESMEC', 'OPERACIÓN INVIERNO', 2),
    ('12301641', 'ALTO SUR SPA', 'OPERACIONES', 0),
    ('12500611', 'ROCMIN SERVICIOS MINEROS SPA', 'OPERACIONES', 12),
    ('12500611', 'ROCMIN SERVICIOS MINEROS SPA', 'OPERACIONES', 2),
    ('12002001', 'CYG SERVICIOS', 'PLANTAS', 34),
    ('12301561', 'BESALCO MAQUINARIAS S.A.', 'PRECHANCADO', 28),
    ('12200681', 'BESALCO MAQUINARIAS S.A.', 'Red Vial/Caminos', 46),
    ('12200681', 'BESALCO MAQUINARIAS S.A.', 'Red Vial/Caminos Mina', 28),
    ('12400991', 'BESALCO MAQUINARIAS S.A.', 'Red Vial/Caminos Mina', 2),
    ('12301641', 'ALTO SUR SPA', 'RESERVA ALTO SUR', 12),
    ('12401021', 'HKN INGENIERIA', 'RESERVA ARAMARK', 6),
    ('12400781', 'GESTION INTEGRAL DE RESIDUOS GEOBAR', 'RESIDUOS', 12),
    ('12400851', 'KUPFER HERMANOS S.A.', 'SEGURIDAD INDUSTRIAL', 4),
    ('42300051', 'ESACHS', 'SEL', 3),
    ('12200661', 'INGENIERIA Y DESARROLLOS MINEROS INDUSTRIALES S.A.', 'SERVICIO APOYO OPERACIONAL PLANTA', 16),
    ('12301241', 'RELIX S.A.', 'SISTEMA DE TRANSPORTES PULPA(STP)', 8),
    ('12501361', 'METSO INDUSTRIAL SERVICE SPA', 'SPOT', 2),
    ('12501261', 'GLOBAL ELECTRIC', 'SSPP', 4),
    ('12300101', 'VIA LIMPIA SPA', 'SUBCONTRATO COPEC', 0),
    ('12001331', 'EQUANS SERVICIOS DE MANTENCION SPA', 'SUBCONTRATO EQUANS', 2),
    ('12400431', 'GUINEZ INGENIERIA LIMITADA', 'TECNICA', 4),
    ('12300801', 'ASESORIA TECNICA EN MONTANA PUCARA', 'TECNICA', 2),
    ('12500611', 'ROCMIN SERVICIOS MINEROS SPA', 'TOMA DE MUESTRA', 10),
    ('12201971', 'MAPER LTDA.', 'TRANSPORTES CAL', 14),
    ('42200151', 'MAPER LTDA.', 'TRANSPORTES CAL', 0),
    ('12400521', 'GRUPO SAN ISIDRO S.A.', 'VALIDAR HASTA 29-05-2026', 4),
    ('12301641', 'ALTO SUR SPA', 'W21', 0),
    ('12400782', 'ALMAR WATER SERVICIOS LATAM SA', '', 19),
    ('12301641', 'ALTO SUR SPA', '', 28),
    ('12001271', 'AMBIPAR RESPONSE CHILE S.A.', '', 14),
    ('42300031', 'ARAMARK SERVICIOS MINEROS Y REMOTOS', '', 306),
    ('12301371', 'ARTICULOS DE SEGURIDAD WILUG LTD', '', 22),
    ('12001061', 'ASITEL', '', 1),
    ('42400011', 'AUTORENTAS DEL PACIFICO LTDA', '', 10),
    ('12401061', 'BAILAC SERVICIOS EN AHORRO DE NEUMÁTICOS LIMITADA', '', 38),
    ('12400771', 'LUBRICANTES Y SERVICIOS BEL-RAY CHILE LIMITADA', '', 8),
    ('42000134', 'LUBRICANTES Y SERVICIOS BEL-RAY CHILE LIMITADA', '', 8),
    ('42300031', 'ARAMARK SERVICIOS MINEROS Y REMOTOS', '', 2),
    ('12001911', 'BURGER LTDA', '', 10),
    ('42000021', 'EMPRESA DE BUSES HUALPEN LIMITADA', '', 5),
    ('12200991', 'CESMEC', '', 1),
    ('12101421', 'CLONSA INGENIERIA LIMITADA', '', 2),
    ('12500141', 'COMPROBE', '', 2),
    ('12002001', 'CYG SERVICIOS', '', 4),
    ('14174743', 'DIPERK', '', 0),
    ('42000391', 'ENAEX SERVICIOS', '', 36),
    ('12113541', 'ACHS SEGURO LABORAL', '', 2),
    ('42300051', 'ESACHS', '', 17),
    ('12301251', 'FLUITEK MARCO SPA', '', 8),
    ('12100101', 'GESTION INTEGRAL DE RESIDUOS GEOBAR', '', 38),
    ('12400431', 'GUINEZ INGENIERIA LIMITADA', '', 4),
    ('12400551', 'IMMERSIVE', '', 2),
    ('12200661', 'INGENIERIA Y DESARROLLOS MINEROS INDUSTRIALES S.A.', '', 10),
    ('42300031', 'INGEQUIMICA', '', 2),
    ('12400752', 'JAIME ILLANES Y ASOCIADOS CONSULTORES S.A.', '', 8),
    ('12300391', 'MEDICINA EJERCICIO DEPORTE Y SALUD S.A.', '', 2),
    ('12501361', 'METSO INDUSTRIAL SERVICE SPA', '', 26),
    ('12200971', 'MORKEN', '', 4),
    ('12102121', 'Mutual de Seguridad Asesorías', '', 1),
    ('12400542', 'TRANSPORTES NAVARRO Y NAVARRO S.A.', '', 4),
    ('12301642', 'SOC.INDUSTRIAL PACOLL INGENIERIA Y', '', 44),
    ('12001851', 'SAENS POLIMEROS Y REVESTIMIENTOS LTDA', '', 4),
    ('12400521', 'GRUPO SAN ISIDRO S.A.', '', 4),
    ('42200061', 'SOC DE MANTENCION CONSERVACIÓN Y RE', '', 10),
    ('12101941', 'TANDEM S.A.', '', 16),
    ('12300971', 'TRES60', '', 6),
    ('12301441', 'TRICONOS MINEROS SOCIEDAD ANONIMA', '', 6)
) AS v(contrato, empresa, gerencia, cupos)
WHERE NOT EXISTS (
    SELECT 1 FROM v2_cupos_gerencias g
    WHERE g.numero_contrato = v.contrato
      AND g.empresa ILIKE v.empresa
);

*/