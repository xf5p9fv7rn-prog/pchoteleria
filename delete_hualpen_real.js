const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let asigRes = await fetch(`${url}/rest/v1/v2_asignaciones?fecha_checkout=is.null`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let todasAsig = await res.json();
    console.log("Total asignaciones activas:", todasAsig.length);
}
// wait, I can just fetch all and filter in JS to be 100% sure!
