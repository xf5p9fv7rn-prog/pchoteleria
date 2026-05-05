import json

with open('/Users/juan/Desktop/PROYECTO CAMPAMENTO/camp-management-pwa/usuarios_anglo.json', encoding='utf-8') as f:
    users = json.load(f)

# Deduplicar por RUT (conservar último)
seen = {}
for u in users:
    seen[u['rut']] = u
unique = list(seen.values())
print(f'Original: {len(users)} | Duplicados: {len(users)-len(unique)} | Únicos: {len(unique)}')

def esc(s):
    return str(s).replace("'", "''") if s else ''

rows = []
for u in unique:
    row = f"  ('{esc(u['rut'])}','{esc(u['nombre'])}','{esc(u['area'])}','{esc(u['cargo'])}','{esc(u['gerencia'])}','{esc(u['turno'])}','{esc(u['email'])}')"
    rows.append(row)

sql = f"-- Usuarios Anglo ({len(unique)} únicos)\n"
sql += "INSERT INTO v2_usuarios_anglo (rut, nombre, area, cargo, gerencia, turno, email) VALUES\n"
sql += ',\n'.join(rows)
sql += "\nON CONFLICT (rut) DO UPDATE SET\n"
sql += "  nombre=EXCLUDED.nombre, area=EXCLUDED.area, cargo=EXCLUDED.cargo,\n"
sql += "  gerencia=EXCLUDED.gerencia, turno=EXCLUDED.turno, email=EXCLUDED.email;\n"

out = '/Users/juan/Desktop/PROYECTO CAMPAMENTO/camp-management-pwa/sql/anglo_import_data.sql'
with open(out, 'w', encoding='utf-8') as f:
    f.write(sql)
print('OK:', out)
