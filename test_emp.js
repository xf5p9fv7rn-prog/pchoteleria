const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];
async function run() {
    let res = await fetch(`${url}/rest/v1/v2_asignaciones?empresa_id=is.null&fecha_checkout=is.null`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let data = await res.json();
    console.log("Asignaciones con empresa null:", data.length);
}
run();
