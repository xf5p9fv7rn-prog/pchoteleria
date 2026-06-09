const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let pRes = await fetch(`${url}/rest/v1/v2_pabellones?select=id,nombre`, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
    let pabs = await pRes.json();
    console.log("All pabellones:", pabs.map(p=>p.nombre).sort());
}
run();
