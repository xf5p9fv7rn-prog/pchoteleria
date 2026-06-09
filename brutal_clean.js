const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    console.log("Descargando todas las asignaciones activas...");
    let res = await fetch(`${url}/rest/v1/v2_asignaciones?fecha_checkout=is.null`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let asignaciones = await res.json();
    
    let resEmp = await fetch(`${url}/rest/v1/v2_empresas`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let empresas = await resEmp.json();
    let empMap = {};
    empresas.forEach(e => empMap[e.id] = e.nombre);

    // Filtrar Hualpen
    let hualpenAsigs = asignaciones.filter(a => {
        let n = empMap[a.empresa_id] || '';
        return n.toUpperCase().includes('HUALP'); // atrapa HUALPEN y HUALPÉN
    });
    
    // Filtramos las fechas 08, 09, 10
    let target = hualpenAsigs.filter(a => {
        let d = a.fecha_checkin || '';
        return d.includes('2026-06-08') || d.includes('2026-06-09') || d.includes('2026-06-10');
    });

    console.log(`Encontradas ${target.length} asignaciones a eliminar.`);
    
    if (target.length > 0) {
        let camasIds = [...new Set(target.map(a => a.id_cama).filter(Boolean))];
        let asigIds = target.map(a => a.id);
        
        console.log("Borrando asignaciones...");
        for(let id of asigIds) {
            await fetch(`${url}/rest/v1/v2_asignaciones?id=eq.${id}`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` }});
        }
        
        console.log("Liberando camas...");
        for(let cid of camasIds) {
            await fetch(`${url}/rest/v1/v2_camas?id_cama=eq.${cid}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
                body: JSON.stringify({ estado: 'Disponible' })
            });
        }
        console.log("Camas liberadas.");
    }

    // Limpiar solicitudes
    let resSol = await fetch(`${url}/rest/v1/v2_solicitudes_b2b`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    let sol = await resSol.json();
    let targetSol = sol.filter(s => {
        let n = (s.empresa||'').toUpperCase();
        let d = s.fecha_llegada || '';
        return n.includes('HUALP') && (d.includes('2026-06-08') || d.includes('2026-06-09') || d.includes('2026-06-10'));
    });
    console.log(`Borrando ${targetSol.length} solicitudes...`);
    for(let t of targetSol) {
        await fetch(`${url}/rest/v1/v2_solicitudes_b2b?id=eq.${t.id}`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` }});
    }

    console.log("Limpieza completada exitosamente.");
}
run();
