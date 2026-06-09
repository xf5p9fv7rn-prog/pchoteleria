-- Este script rellena el Censo QR (v2_censo_trabajadores) 
-- para todos los usuarios activos desde el 21 de mayo de 2026 hasta hoy.
-- Solo inserta si la persona no tenía ya un escaneo ese día.

DO $$
DECLARE
    curr_date DATE := '2026-05-21'::DATE;
    end_date DATE := CURRENT_DATE;
BEGIN
    WHILE curr_date <= end_date LOOP
        
        INSERT INTO v2_censo_trabajadores (
            numero_hab,
            rut_trabajador,
            nombre_trabajador,
            empresa,
            fecha_scan,
            hora_scan
        )
        SELECT 
            h.numero_hab,
            a.rut_huesped,
            a.nombre_huesped,
            e.nombre AS empresa,
            curr_date::TEXT,
            (curr_date::TEXT || ' 08:00:00')::TIMESTAMP
        FROM v2_asignaciones a
        JOIN v2_camas c ON a.id_cama = c.id_cama
        JOIN v2_habitaciones h ON c.habitacion_id = h.id_custom
        LEFT JOIN v2_empresas e ON a.empresa_id = e.id
        WHERE a.fecha_checkin::TEXT <= curr_date::TEXT
          AND (a.fecha_checkout IS NULL OR a.fecha_checkout::TEXT >= curr_date::TEXT)
          -- No insertar si ya existe un registro ese día para ese RUT
          AND NOT EXISTS (
              SELECT 1 FROM v2_censo_trabajadores ct
              WHERE ct.rut_trabajador = a.rut_huesped
                AND ct.fecha_scan::TEXT = curr_date::TEXT
          )
          -- Evitar procesar si rut_huesped está nulo
          AND a.rut_huesped IS NOT NULL;
          
        curr_date := curr_date + INTERVAL '1 day';
    END LOOP;
END $$;
