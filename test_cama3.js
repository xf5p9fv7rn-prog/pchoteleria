const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let res = await fetch(`${url}/rest/v1/v2_camas?numero_cama=eq.3&select=habitacion_id`, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
    let camas = await res.json();
    let hIds = [...new Set(camas.map(c=>c.habitacion_id))];
    console.log("Unique habIds:", hIds.length);
    
    let hRes = await fetch(`${url}/rest/v1/v2_habitaciones?select=id_custom,pabellon_id`, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
    let habs = await hRes.json();
    let habMap = {};
    habs.forEach(h => habMap[h.id_custom] = h.pabellon_id);
    
    let pIds = [...new Set(hIds.map(h => habMap[h]).filter(Boolean))];
    
    let pRes = await fetch(`${url}/rest/v1/v2_pabellones?select=id,nombre`, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
    let pabs = await pRes.json();
    let pabMap = {};
    pabs.forEach(p => pabMap[p.id] = p.nombre);
    
    let pNames = [...new Set(pIds.map(p => pabMap[p]).filter(Boolean))];
    console.log("Pabellones with C3:", pNames.sort());
}
run();
