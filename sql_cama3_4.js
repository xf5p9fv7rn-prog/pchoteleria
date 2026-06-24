const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let hRes = await fetch(`${url}/rest/v1/v2_habitaciones?select=id_custom,pabellon_id,v2_camas(numero_cama)`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let habs = await hRes.json();

    let pRes = await fetch(`${url}/rest/v1/v2_pabellones?select=id,nombre`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let pabs = await pRes.json();
    let pabMap = {};
    pabs.forEach(p => pabMap[p.id] = p.nombre);

    let stats = {};
    pabs.forEach(p => stats[p.nombre] = { totalHabs: 0, withCama3: 0, withCama1: 0 });

    habs.forEach(h => {
        let pName = pabMap[h.pabellon_id];
        if (!pName) return;
        stats[pName].totalHabs++;
        let camas = h.v2_camas.map(c => c.numero_cama);
        if (camas.includes(3)) stats[pName].withCama3++;
        if (camas.includes(1)) stats[pName].withCama1++;
    });

    console.log(stats);
}
run();
