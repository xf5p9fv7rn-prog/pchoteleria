const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let res = await fetch(`${url}/rest/v1/v2_empresas?nombre=ilike.*HUALPEN*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let empresas = await res.json();
    console.log("Empresas HUALPEN:", empresas.map(e => e.id + ' ' + e.nombre));
    let empIds = empresas.map(e => e.id);
    
    let res2 = await fetch(`${url}/rest/v1/v2_asignaciones?empresa_id=in.(${empIds.join(',')})&fecha_checkin=in.(2026-06-08,2026-06-09,2026-06-10)&fecha_checkout=is.null`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let asignaciones = await res2.json();
    console.log(`Encontradas ${asignaciones.length} asignaciones activas de Hualpen con checkin 8,9,10`);

    let res3 = await fetch(`${url}/rest/v1/v2_solicitudes?empresa=ilike.*HUALPEN*&fecha_llegada=in.(2026-06-08,2026-06-09,2026-06-10)`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let solicitudes = await res3.json();
    console.log(`Encontradas ${solicitudes.length} solicitudes de Hualpen llegando el 8,9,10. Status:`, [...new Set(solicitudes.map(s=>s.status))]);
}
run();
