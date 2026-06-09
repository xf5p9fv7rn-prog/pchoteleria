const fs = require('fs');
const js = fs.readFileSync('js/supabaseClient.js', 'utf8');
const url = js.match(/const supabaseUrl = '([^']+)'/)[1];
const key = js.match(/const supabaseAnonKey = '([^']+)'/)[1];

async function run() {
    let res = await fetch(`${url}/rest/v1/v2_camas?select=id_cama`, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
    console.log("Total rows in v2_camas:", res.headers.get('content-range'));
}
run();
