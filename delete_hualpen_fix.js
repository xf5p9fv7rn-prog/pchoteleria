const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let res = await fetch(`${url}/rest/v1/v2_empresas?nombre=ilike.*HUALPEN*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let empresas = await res.json();
    let empIds = empresas.map(e => e.id);
    
    // We can use gte and lte to match timestamps
    let res2 = await fetch(`${url}/rest/v1/v2_asignaciones?empresa_id=in.(${empIds.join(',')})&fecha_checkin=gte.2026-06-09&fecha_checkin=lt.2026-06-11&fecha_checkout=is.null`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let asignaciones = await res2.json();
    console.log(`Encontradas ${asignaciones.length} asignaciones a eliminar.`);

    if (asignaciones.length > 0) {
        let camasIds = [...new Set(asignaciones.map(a => a.id_cama).filter(Boolean))];
        let asigIds = asignaciones.map(a => a.id);
        
        // 3. Free beds
        if (camasIds.length > 0) {
            console.log(`Liberando ${camasIds.length} camas...`);
            await fetch(`${url}/rest/v1/v2_camas?id_cama=in.(${camasIds.join(',')})`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
                body: JSON.stringify({ estado: 'Disponible' })
            });
        }
        
        // 4. Delete assignments
        console.log(`Borrando ${asigIds.length} asignaciones...`);
        await fetch(`${url}/rest/v1/v2_asignaciones?id=in.(${asigIds.join(',')})`, {
            method: 'DELETE',
            headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
    }

    console.log("Done.");
}
run();
