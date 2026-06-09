#!/usr/bin/env node
/**
 * generar_2000_camas_llenas.js
 * Genera un Excel en el formato EXACTO de la plantilla del sistema.
 * Asigna UN trabajador por cama → llena TODAS las camas disponibles
 * hasta 2000. Fechas 2030. Empresas reales. Turno Día/Noche respetado.
 */

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = 'https://pnkajjduvadcxealodcp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MAX_USUARIOS    = 999999; // Sin límite → llena TODAS las camas
const FECHA_LLEGADA   = '2030-01-01';
const FECHA_SALIDA    = '2030-01-31';

// ── Nombres chilenos ───────────────────────────────────────────────────────────
const NOM_M = ['JUAN','PEDRO','CARLOS','MIGUEL','ANTONIO','FRANCISCO','JORGE','RAFAEL',
'ROBERTO','MARIO','LUIS','GABRIEL','PABLO','RODRIGO','DIEGO','FELIPE','SERGIO','ANDRES',
'CRISTIAN','ALEJANDRO','NICOLAS','MATIAS','MANUEL','JOSE','DANIEL','VICTOR','FERNANDO',
'IGNACIO','CLAUDIO','PATRICIO','MARCELO','EDUARDO','GONZALO','HECTOR','OSCAR','JAVIER',
'ALBERTO','ARIEL','BORIS','CAMILO','CESAR','DAVID','EMILIO','ESTEBAN','FABIAN','FRANCO'];

const NOM_F = ['MARIA','ANA','CAROLINA','JESSICA','CLAUDIA','PATRICIA','SANDRA','ANDREA',
'VALENTINA','CAMILA','DANIELA','FERNANDA','CONSTANZA','JAVIERA','PAOLA','MONICA','LUCIA',
'ROSA','VERONICA','ISABEL','ALEJANDRA','MARCELA','BARBARA','CARMEN','ELENA','LORENA',
'NATALIA','PILAR','RAQUEL','SILVIA','TERESA','XIMENA','CARLA','DIANA','FABIOLA','GISELA'];

const APELLIDOS = ['GONZALEZ','RODRIGUEZ','MUÑOZ','LOPEZ','HERNANDEZ','GARCIA','MARTINEZ',
'PEREZ','SANCHEZ','RAMIREZ','FLORES','TORRES','DIAZ','GUTIERREZ','VARGAS','CASTRO','ROMERO',
'MORALES','FUENTES','SILVA','SOTO','ROJAS','RAMOS','REYES','MEDINA','MOYA','VEGA','NUNEZ',
'NAVARRO','CONTRERAS','ESPINOZA','TAPIA','CORTEZ','BRAVO','VALENZUELA','SEPULVEDA','FIGUEROA',
'PIZARRO','PARRA','ORTIZ','MENDEZ','MORA','HERRERA','ALARCON','PACHECO','ARAYA','ALVAREZ',
'INOSTROZA','VILLALOBOS','CESPEDES','NAVARRETE','ANDRADE','GUERRERO','PALMA','VALDES'];

// ── Empresas reales con turno ──────────────────────────────────────────────────
// Día → primeras camas / Noche → segundas camas (separación por habitación)
const EMPRESAS_DIA = [
    { nombre:'ARAMARK',                    contrato:'ARA-DIA-2030',  gerencia:'Servicios Generales' },
    { nombre:'VERTICE',                    contrato:'VER-DIA-2030',  gerencia:'Infraestructura y aguas' },
    { nombre:'MAESTRANZA ALEMANIA LTDA',   contrato:'MAE-DIA-2030',  gerencia:'Gerencia Mantención' },
    { nombre:'GEOBARRA EXINS',             contrato:'GEO-DIA-2030',  gerencia:'Infraestructura y aguas' },
    { nombre:'BURGER',                     contrato:'BUR-DIA-2030',  gerencia:'Servicios Generales' },
    { nombre:'ARTICULOS DE SEGURIDAD WILUG LTD', contrato:'WIL-DIA-2030', gerencia:'Servicios Generales' },
];

const EMPRESAS_NOC = [
    { nombre:'BESALCO',        contrato:'BES-NOC-2030', gerencia:'Gerencia Mantención' },
    { nombre:'MAPER LTDA',     contrato:'MAP-NOC-2030', gerencia:'Infraestructura y aguas' },
    { nombre:'ROCMIN',         contrato:'ROC-NOC-2030', gerencia:'Gerencia Mantención' },
    { nombre:'TÁNDEM',         contrato:'TAN-NOC-2030', gerencia:'Servicios Generales' },
];

// ── RUT válido ────────────────────────────────────────────────────────────────
let _rutBase = 15000000;
const _rutsUsados = new Set();
function genRut() {
    _rutBase += Math.floor(Math.random() * 4) + 1;
    while (_rutsUsados.has(_rutBase)) _rutBase++;
    _rutsUsados.add(_rutBase);
    let suma = 0, mul = 2;
    for (let i = String(_rutBase).length - 1; i >= 0; i--) {
        suma += parseInt(String(_rutBase)[i]) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const res = 11 - (suma % 11);
    const dv  = res === 11 ? '0' : res === 10 ? 'K' : String(res);
    return `${_rutBase}-${dv}`;
}

function genNombre(gen) {
    const pool = gen === 'F' ? NOM_F : NOM_M;
    const nom  = pool[Math.floor(Math.random() * pool.length)];
    const ap1  = APELLIDOS[Math.floor(Math.random() * APELLIDOS.length)];
    const ap2  = APELLIDOS[Math.floor(Math.random() * APELLIDOS.length)];
    return `${nom} ${ap1} ${ap2}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🚀 Generando Excel para llenar TODAS las camas (hasta 2000)...\n');

    // 1. Traer TODAS las camas con número de habitación (paginado)
    console.log('1️⃣  Cargando todas las camas del sistema (paginado)...');
    let todasCamas = [], desde = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_camas')
            .select('id_cama, habitacion_id, v2_habitaciones(numero_hab)')
            .order('habitacion_id')
            .range(desde, desde + 999);
        if (error) { console.error('❌', error.message); process.exit(1); }
        if (!data?.length) break;
        todasCamas = todasCamas.concat(data);
        if (data.length < 1000) break;
        desde += 1000;
    }
    console.log(`   Total camas encontradas: ${todasCamas.length}`);

    // 2. Filtrar camas que tienen número de habitación
    const camasConHab = todasCamas.filter(c => c.v2_habitaciones?.numero_hab);
    console.log(`   Camas con habitación asignada: ${camasConHab.length}`);

    // 3. Agrupar por habitación para separar Día/Noche
    const habsUnicas = [...new Set(camasConHab.map(c => String(c.v2_habitaciones.numero_hab).trim()))];
    habsUnicas.sort();
    const mitad      = Math.floor(habsUnicas.length / 2);
    const habsDia    = new Set(habsUnicas.slice(0, mitad));
    const habsNoche  = new Set(habsUnicas.slice(mitad));

    console.log(`   Habs Día: ${habsDia.size} | Habs Noche: ${habsNoche.size}`);

    // 4. Agrupar camas por habitación
    const habGrupos = {}; // numero_hab → [cama, cama, ...]
    for (const c of camasConHab) {
        const hab = String(c.v2_habitaciones.numero_hab).trim();
        if (!habGrupos[hab]) habGrupos[hab] = [];
        habGrupos[hab].push(c);
    }

    const habitaciones = Object.keys(habGrupos).sort();
    console.log(`   Habitaciones únicas: ${habitaciones.length}`);

    // 5. Asignar UNA empresa y UN género por habitación → misma empresa + mismo género en todas sus camas
    let idxDia = 0, idxNoc = 0, idxHab = 0;
    const filas = [];

    for (const habNum of habitaciones) {
        const esDia   = habsDia.has(habNum);
        const empPool = esDia ? EMPRESAS_DIA : EMPRESAS_NOC;
        const empIdx  = esDia ? (idxDia++ % empPool.length) : (idxNoc++ % empPool.length);
        const emp     = empPool[empIdx];
        const tipo    = esDia ? 'Día' : 'Noche';
        const turno   = '7x7';

        // Género único por habitación: alternar M/F entre habitaciones
        const gen     = idxHab % 4 === 0 ? 'F' : 'M'; // ~25% hab femeninas
        idxHab++;

        // Generar un trabajador por cada cama de esta habitación
        for (const cama of habGrupos[habNum]) {
            if (filas.length >= MAX_USUARIOS) break;
            const nombre = genNombre(gen);
            const rut    = genRut();

            filas.push({
                'FECHA':                   FECHA_LLEGADA,
                'EMPRESA':                 emp.nombre,
                'N° CONTRATO':             emp.contrato,
                'GERENCIA':                emp.gerencia,
                'RAZÓN SOCIAL':            emp.nombre,
                'NOMBRE COMPLETO HUÉSPED': nombre,
                'RUT':                     rut,
                'CONTACTO':                '',
                'HAB.':                    habNum,
                'TURNO':                   turno,
                'SISTEMA':                 '',
                'TIPO':                    tipo,
                'ESTADO':                  'Pendiente',
                'FECHA LLEGADA':           FECHA_LLEGADA,
                'FECHA SALIDA':            FECHA_SALIDA,
            });
        }
        if (filas.length >= MAX_USUARIOS) break;
    }

    const totalDia   = filas.filter(f => f['TIPO'] === 'Día').length;
    const totalNoche = filas.filter(f => f['TIPO'] === 'Noche').length;
    console.log(`   ☀️  Turno Día:   ${totalDia}`);
    console.log(`   🌙  Turno Noche: ${totalNoche}`);
    console.log(`   Total:           ${filas.length}`);

    // Contar por empresa
    const dist = {};
    for (const f of filas) dist[f['EMPRESA']] = (dist[f['EMPRESA']] || 0) + 1;
    console.log('\n   Distribución por empresa:');
    for (const [e, n] of Object.entries(dist).sort((a,b)=>b[1]-a[1])) {
        console.log(`   ${String(n).padStart(5)}  →  ${e}`);
    }

    // 6. Crear Excel con el formato de la plantilla
    console.log('\n3️⃣  Creando Excel en formato plantilla PC HOTELERÍA...');

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([]);  // hoja en blanco

    // Fila 1: Título (merged)
    XLSX.utils.sheet_add_aoa(ws, [
        ['SOLICITUD DE ALOJAMIENTO · PC HOTELERÍA · Turno 7x7, 8x6, 14x14'],
    ], { origin: 'A1' });

    // Fila 2: Admin Anglo
    XLSX.utils.sheet_add_aoa(ws, [
        ['Admins Anglo:', 'PRUEBA TÉCNICA 2030'],
    ], { origin: 'A2' });

    // Fila 3: Cabeceras
    const COLS = [
        'FECHA','EMPRESA','N° CONTRATO','GERENCIA','RAZÓN SOCIAL',
        'NOMBRE COMPLETO HUÉSPED','RUT','CONTACTO',
        'HAB.','TURNO','SISTEMA','TIPO','ESTADO',
        'FECHA LLEGADA','FECHA SALIDA'
    ];
    XLSX.utils.sheet_add_aoa(ws, [COLS], { origin: 'A3' });

    // Filas de datos (desde fila 4)
    const dataRows = filas.map(f => COLS.map(c => f[c] ?? ''));
    XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: 'A4' });

    // Anchos de columna
    ws['!cols'] = [
        {wch:12},{wch:38},{wch:16},{wch:28},{wch:38},
        {wch:40},{wch:14},{wch:14},
        {wch:12},{wch:8},{wch:10},{wch:8},{wch:12},
        {wch:14},{wch:14}
    ];

    // Merge fila 1 (A1:O1)
    ws['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:14} }];

    XLSX.utils.book_append_sheet(wb, ws, 'PRUEBA 2030');

    const outPath = path.join(
        '/Users/juan/Desktop/PROYECTO CAMPAMENTO/camp-management-pwa',
        `PRUEBA_TODAS_CAMAS_3681_2030.xlsx`
    );
    XLSX.writeFile(wb, outPath);

    console.log(`\n✅ ¡Excel listo!`);
    console.log(`   Archivo:   PRUEBA_2000_CAMAS_LLENAS_2030.xlsx`);
    console.log(`   Usuarios:  ${filas.length}`);
    console.log(`   Fechas:    ${FECHA_LLEGADA} → ${FECHA_SALIDA}`);
    console.log(`   Camas q/   ${camasConHab.length > MAX_USUARIOS ? MAX_USUARIOS : camasConHab.length} / ${camasConHab.length} total`);
    console.log(`   Estado:    PRE-ASIGNADO (fecha 2030)`);
    console.log(`\n📌 Carga en: Solicitudes → 📂 Cargas con Habitación\n`);
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
