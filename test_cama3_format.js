const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let hRes = await fetch(`${url}/rest/v1/v2_camas?numero_cama=eq.3&limit=5`, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
    let camas = await hRes.json();
    console.log(camas);
}
run();
