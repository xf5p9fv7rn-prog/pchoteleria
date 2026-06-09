const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let res = await fetch(`${url}/rest/v1/v2_empresas?nombre=ilike.*HUALPEN*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let empresas = await res.json();
    let empIds = empresas.map(e => e.id);
    
    // 2. Get active assignments for 08
    let res2 = await fetch(`${url}/rest/v1/v2_asignaciones?empresa_id=in.(${empIds.join(',')})&fecha_checkin=eq.2026-06-08&fecha_checkout=is.null`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let asignaciones = await res2.json();
    console.log(`Encontradas ${asignaciones.length} asignaciones del día 8.`);
}
run();
