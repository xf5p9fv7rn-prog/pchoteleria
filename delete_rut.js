const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let res = await fetch(`${url}/rest/v1/v2_asignaciones?rut_huesped=ilike.15511682%&fecha_checkout=is.null`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let asignaciones = await res.json();
    console.log(`Encontradas ${asignaciones.length} asignaciones activas para el RUT 15511682K:`);
    console.log(asignaciones);
}
run();
