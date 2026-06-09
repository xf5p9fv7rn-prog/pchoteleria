
CREATE OR REPLACE FUNCTION v2_actualizar_estado_cama()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE v2_camas SET estado = 'Ocupada' WHERE id_cama = NEW.id_cama AND estado != 'Deshabilitada';
  ELSIF TG_OP = 'UPDATE' AND NEW.fecha_checkout IS NOT NULL AND OLD.fecha_checkout IS NULL THEN
    UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = NEW.id_cama AND estado != 'Deshabilitada';
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE v2_camas SET estado = 'Disponible' WHERE id_cama = OLD.id_cama AND estado != 'Deshabilitada';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
