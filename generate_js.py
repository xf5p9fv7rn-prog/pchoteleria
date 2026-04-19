import json

with open('extracted_rooms.json', 'r') as f:
    rooms_data = json.load(f)

js_content = "export const MASTER_ROOMS = " + json.dumps(rooms_data) + ";\n"
with open('js/roomsConfig.js', 'w') as f:
    f.write(js_content)
