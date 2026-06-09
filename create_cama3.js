const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    // 1. Get all habitacion_id from P-7
    let pRes = await fetch(`${url}/rest/v1/v2_pabellones?nombre=eq.P-7&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
    let pabs = await pRes.json();
    let p7_id = pabs[0].id;
    
    let hRes = await fetch(`${url}/rest/v1/v2_habitaciones?pabellon_id=eq.${p7_id}&select=id_custom`, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
    let habs = await hRes.json();
    console.log(`Found ${habs.length} rooms in P-7`);
    
    let toInsert = habs.map(h => ({
        id_cama: `${h.id_custom}-C3`,
        habitacion_id: h.id_custom,
        numero_cama: 3,
        estado: 'Deshabilitada'
    }));
    
    console.log(`Inserting ${toInsert.length} Cama 3 records...`);
    let res = await fetch(`${url}/rest/v1/v2_camas`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: 'return=minimal'
        },
        body: JSON.stringify(toInsert)
    });
    
    if (res.ok) {
        console.log("Successfully inserted Cama 3 for P-7!");
    } else {
        console.error("Error inserting:", await res.text());
    }
}
run();
