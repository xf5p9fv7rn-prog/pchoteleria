CREATE OR REPLACE FUNCTION autocomplete_censo_qr_diario()
RETURNS void AS $$
DECLARE
    curr_date DATE := CURRENT_DATE;
BEGIN
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
        curr_date,
        (curr_date::TEXT || ' 10:00:00')::TIMESTAMP
    FROM v2_asignaciones a
    JOIN v2_camas c ON a.id_cama = c.id_cama
    JOIN v2_habitaciones h ON c.habitacion_id = h.id_custom
    LEFT JOIN v2_empresas e ON a.empresa_id = e.id
    WHERE a.fecha_checkin::TEXT <= curr_date::TEXT
      AND (a.fecha_checkout IS NULL OR a.fecha_checkout::TEXT >= curr_date::TEXT)
      AND a.rut_huesped IS NOT NULL
    -- Si ya existe un registro idéntico (RUT + Fecha + Habitación), simplemente lo ignoramos sin tirar error
    ON CONFLICT (numero_hab, rut_trabajador, fecha_scan) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
