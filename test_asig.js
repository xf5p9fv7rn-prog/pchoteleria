const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const urlMatch = js.match(/const supabaseUrl = '([^']+)'/);
const keyMatch = js.match(/const supabaseAnonKey = '([^']+)'/);
const url = urlMatch[1];
const key = keyMatch[1];

async function run() {
    const res = await fetch(`${url}/rest/v1/v2_asignaciones?select=id_cama,numero_contrato,v2_empresas(nombre,v2_gerencias(nombre)),v2_camas(habitacion_id)&fecha_checkin=lte.2026-06-20&or=(fecha_checkout.is.null,fecha_checkout.gte.2026-05-21)`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const data = await res.json();
    console.log("Total active assignments:", data.length || data);
}
run();
