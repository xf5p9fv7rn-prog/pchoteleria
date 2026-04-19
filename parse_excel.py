import zipfile
import xml.etree.ElementTree as ET
import json
import re

def parse_xlsx(filename):
    with zipfile.ZipFile(filename) as z:
        # Get shared strings
        strings = []
        try:
            with z.open('xl/sharedStrings.xml') as f:
                tree = ET.parse(f)
                root = tree.getroot()
                namespace = {'ns': root.tag.split('}')[0].strip('{')}
                for t in root.findall('.//ns:t', namespace):
                    strings.append(t.text)
        except:
            pass

        # Get sheet 1
        rooms = []
        with z.open('xl/worksheets/sheet1.xml') as f:
            tree = ET.parse(f)
            root = tree.getroot()
            namespace = {'ns': root.tag.split('}')[0].strip('{')}
            for row in root.findall('.//ns:row', namespace):
                row_data = []
                for c in row.findall('ns:c', namespace):
                    v = c.find('ns:v', namespace)
                    if v is not None:
                        val = v.text
                        if c.get('t') == 's':
                            val = strings[int(val)]
                        row_data.append(val)
                if len(row_data) >= 4 and row_data[0] != 'Pabellon      ':
                    try:
                        pab = str(row_data[0]).strip()
                        nivel = str(row_data[1]).strip()
                        bedCount = int(float(row_data[3]))
                        # Ensure we get the raw room number properly (might be string or int)
                        room = str(row_data[2]).strip()
                        rooms.append({"p": pab, "f": nivel, "r": room, "b": bedCount})
                    except Exception as e:
                        pass
        return rooms

rooms = parse_xlsx('11.xlsx')
print(f"Total rooms found: {len(rooms)}")
with open('extracted_rooms.json', 'w') as f:
    json.dump(rooms, f)
