const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let res = await fetch(`${url}/rest/v1/v2_asignaciones?rut_huesped=ilike.*15511682*&fecha_checkout=is.null`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let text = await res.text();
    console.log("Response:", text);
}
run();
