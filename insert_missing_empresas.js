// Script para insertar empresas faltantes en v2_empresas
// Ejecutar con: node insert_missing_empresas.js

const SUPABASE_URL = 'https://pnkajjduvadcxealodcp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro';

const MISSING = [
  'ANGLO',
  'AUTORENTAS DEL PACIFICO LTDA',
  'BSM',
  'BURGER LTDA',
  'CAROLINA G.',
  'CLIMBERS OOCC',
  'CLONSA INGENIERIA',
  'CYD INGENIERIA',
  'DHL GLOBAL FORWARDING (CHILE) S.',
  'DSI CHILE SPA',
  'FLUITEK MARCO',
  'FOURTHANE CORREAS S.A',
  'GEODATOS',
  'I.G.R',
  'IMMERSIVE',
  'INGEQUIMICA',
  'RESERVA AMBIPAR',
  'RESERVA ARAMARK',
  'RESERVA ARTICULOS DE SEGURIDAD WILUG LTD',
  'RESERVA BAILAC',
  'RESERVA BESALCO',
  'RESERVA CESMEC',
  'RESERVA CYG',
  'RESERVA EQUANS INDUSTRIAL SPA',
  'RESERVA GERENCIA MANTENCION PLANTA',
  'RESERVA KOMATSU CHILE',
  'RESERVA PROYECTO',
  'RESERVA R Y Q',
  'RESERVA REFINODUCTO',
  'RESERVA RELIX',
  'RESERVA STN',
  'RESERVA TRANSPORTISTAS',
  'RESERVA VERTICE',
  'ROQMIN',
  'SISERCOM',
  'SKAVA',
  'SOMACOR S.A.',
  'SUPEREX',
  'TECNORED',
  'TKE',
  'TRES60',
  'TRICONOS',
  'VERTICE',
  'WSP AMBIENTAL',
];

async function main() {
  // gerencia_id de la gerencia "general" (usado por ALTO SUR SPA y otras)
  const GERENCIA_GENERAL_ID = '72a18a81-98c9-496f-8269-dca7dadd2f8f';
  const rows = MISSING.map(nombre => ({ nombre, gerencia_id: GERENCIA_GENERAL_ID }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/v2_empresas`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(rows),
  });

  const text = await res.text();
  if (res.ok) {
    const data = JSON.parse(text);
    console.log(`✅ Insertadas ${data.length} empresas correctamente`);
    data.forEach(e => console.log(' +', e.nombre));
  } else {
    console.error('❌ Error:', res.status, text);
  }
}

main().catch(console.error);
