const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let res = await fetch(`${url}/rest/v1/v2_camas?numero_cama=eq.3&select=id_cama`, { headers: { apikey: key, Authorization: `Bearer ${key}`, 'Prefer': 'count=exact' } });
    let data = await res.json();
    let count = res.headers.get('content-range');
    console.log("Total Cama 3 in DB:", count);
}
run();
