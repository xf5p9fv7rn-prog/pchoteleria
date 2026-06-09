#!/usr/bin/env node
/**
 * generar_2000_usuarios_prueba.js
 * Genera un Excel con 2000 trabajadores de prueba usando:
 * - Habitaciones REALES del sistema
 * - Empresas REALES del sistema
 * - Fechas 2030
 * - Nombres y RUTs de prueba realistas
 */

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = 'https://pnkajjduvadcxealodcp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TOTAL_USUARIOS = 2000;
const FECHA_LLEGADA  = '2030-01-01';
const FECHA_SALIDA   = '2030-01-31';
const N_CONTRATO     = 'TEST-2030';

// ── Pool de nombres chilenos ──────────────────────────────────────────────────
const NOMBRES_M = ['JUAN','PEDRO','CARLOS','MIGUEL','ANTONIO','FRANCISCO','JORGE','RAFAEL',
'ROBERTO','MARIO','LUIS','GABRIEL','PABLO','RODRIGO','DIEGO','FELIPE','SERGIO','ANDRES',
'CRISTIAN','ALEJANDRO','NICOLAS','MATIAS','MANUEL','JOSE','DANIEL','VICTOR','FERNANDO',
'IGNACIO','CLAUDIO','PATRICIO','MARCELO','EDUARDO','GONZALO','HECTOR','OSCAR','JAVIER'];

const NOMBRES_F = ['MARIA','ANA','CAROLINA','JESSICA','CLAUDIA','PATRICIA','SANDRA','ANDREA',
'VALENTINA','CAMILA','DANIELA','FERNANDA','CONSTANZA','JAVIERA','PAOLA','MONICA','LUCIA',
'ROSA','VERONICA','ISABEL','ALEJANDRA','MARCELA','BARBARA','CARMEN','ELENA','LORENA',
'NATALIA','PILAR','RAQUEL','SILVIA','TERESA','XIMENA','YASMIN','CARLA','DIANA','FABIOLA'];

const APELLIDOS = ['GONZALEZ','RODRIGUEZ','MUÑOZ','LOPEZ','HERNANDEZ','GARCIA','MARTINEZ',
'PEREZ','SANCHEZ','RAMIREZ','FLORES','TORRES','DIAZ','GUTIERREZ','VARGAS','CASTRO','ROMERO',
'MORALES','FUENTES','SILVA','SOTO','ROJAS','RAMOS','REYES','MEDINA','MOYA','VEGA','NUNEZ',
'NAVARRO','CONTRERAS','ESPINOZA','TAPIA','CORTEZ','BRAVO','VALENZUELA','SEPULVEDA','FIGUEROA',
'PIZARRO','PARRA','ORTIZ','MENDEZ','MORA','HERRERA','ALARCON','PACHECO','ARAYA','ALVAREZ'];

// ── Empresas reales con turno ─────────────────────────────────────────────────
const EMPRESAS = [
    { nombre: 'ARAMARK',                   turno: 'Día',   contrato: 'TEST-ARAMARK-2030',  cuota: 600 },
    { nombre: 'VERTICE',                   turno: 'Día',   contrato: 'TEST-VERTICE-2030',  cuota: 300 },
    { nombre: 'BESALCO',                   turno: 'Noche', contrato: 'TEST-BESALCO-2030',  cuota: 250 },
    { nombre: 'MAESTRANZA ALEMANIA LTDA',  turno: 'Día',   contrato: 'TEST-MAESTRANZA-2030', cuota: 200 },
    { nombre: 'MAPER LTDA',                turno: 'Noche', contrato: 'TEST-MAPER-2030',    cuota: 150 },
    { nombre: 'GEOBARRA EXINS',            turno: 'Día',   contrato: 'TEST-GEOBARRA-2030', cuota: 150 },
    { nombre: 'ROCMIN',                    turno: 'Noche', contrato: 'TEST-ROCMIN-2030',   cuota: 100 },
    { nombre: 'BURGER',                    turno: 'Día',   contrato: 'TEST-BURGER-2030',   cuota: 100 },
    { nombre: 'TÁNDEM',                    turno: 'Noche', contrato: 'TEST-TANDEM-2030',   cuota:  80 },
    { nombre: 'ARTICULOS DE SEGURIDAD WILUG LTD', turno: 'Día', contrato: 'TEST-WILUG-2030', cuota: 70 },
];

// ── Generar RUT chileno válido ─────────────────────────────────────────────────
function calcDV(rut) {
    let suma = 0, mul = 2;
    for (let i = String(rut).length - 1; i >= 0; i--) {
        suma += parseInt(String(rut)[i]) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const res = 11 - (suma % 11);
    if (res === 11) return '0';
    if (res === 10) return 'K';
    return String(res);
}

let _rutBase = 10000000;
const _rutsUsados = new Set();
function generarRut() {
    _rutBase += Math.floor(Math.random() * 5) + 1;
    while (_rutsUsados.has(_rutBase)) _rutBase++;
    _rutsUsados.add(_rutBase);
    const dv = calcDV(_rutBase);
    return `${_rutBase}-${dv}`;
}

// ── Nombre aleatorio ──────────────────────────────────────────────────────────
function generarNombre(genero) {
    const pool = genero === 'F' ? NOMBRES_F : NOMBRES_M;
    const nom  = pool[Math.floor(Math.random() * pool.length)];
    const ap1  = APELLIDOS[Math.floor(Math.random() * APELLIDOS.length)];
    const ap2  = APELLIDOS[Math.floor(Math.random() * APELLIDOS.length)];
    return `${nom} ${ap1} ${ap2}`;
}

async function main() {
    console.log('\n🚀 Generando Excel con 2000 usuarios de prueba (2030)...\n');

    // ── 1. Traer habitaciones reales ──────────────────────────────────────────
    console.log('1️⃣  Cargando habitaciones reales del sistema...');
    const { data: camas, error: eCamas } = await supabase
        .from('v2_camas')
        .select('id_cama, habitacion_id, v2_habitaciones(numero_hab)')
        .order('habitacion_id');

    if (eCamas) { console.error('❌', eCamas.message); process.exit(1); }

    // Agrupar camas por habitación (número legible)
    const habMap = {};  // numero_hab → [id_cama, id_cama]
    for (const c of camas || []) {
        const num = c.v2_habitaciones?.numero_hab;
        if (!num) continue;
        const k = String(num).trim();
        if (!habMap[k]) habMap[k] = [];
        habMap[k].push(c.id_cama);
    }
    const todasHabs = Object.keys(habMap);
    console.log(`   Habitaciones disponibles: ${todasHabs.length} (${camas?.length} camas)`);

    // ── 2. Distribuir habitaciones por empresa (Día → primeras habs, Noche → siguientes) ──
    // Anglo American separa turno Día y Noche por habitación
    // Usamos las habitaciones del sistema en orden → primeras mitad = Día, segunda = Noche
    const mitad = Math.floor(todasHabs.length / 2);
    const habsDia   = todasHabs.slice(0, mitad);
    const habsNoche = todasHabs.slice(mitad);
    console.log(`   Habs Día: ${habsDia.length} | Habs Noche: ${habsNoche.length}`);

    // ── 3. Generar trabajadores ───────────────────────────────────────────────
    console.log('\n2️⃣  Generando 2000 trabajadores de prueba...');
    const filas = [];

    for (const emp of EMPRESAS) {
        const habsPool = emp.turno === 'Día' ? habsDia : habsNoche;
        let habIdx = 0;
        let camasEnHabActual = 0;
        const camasPorHab = 2;  // Típicamente 2 camas por habitación

        for (let i = 0; i < emp.cuota && filas.length < TOTAL_USUARIOS; i++) {
            const genero  = Math.random() > 0.25 ? 'M' : 'F';  // ~75% masculino
            const nombre  = generarNombre(genero);
            const rut     = generarRut();
            const hab     = habsPool[habIdx % habsPool.length];

            filas.push({
                'NOMBRE':          nombre,
                'RUT':             rut,
                'EMPRESA':         emp.nombre,
                'GÉNERO':          genero,
                'HAB. SOLICITADA': hab,
                'N° CONTRATO':     emp.contrato,
                'FECHA LLEGADA':   FECHA_LLEGADA,
                'FECHA SALIDA':    FECHA_SALIDA,
            });

            camasEnHabActual++;
            if (camasEnHabActual >= camasPorHab) {
                camasEnHabActual = 0;
                habIdx++;
            }
        }
        console.log(`   ✅ ${emp.nombre}: ${Math.min(emp.cuota, TOTAL_USUARIOS - (filas.length - Math.min(emp.cuota, TOTAL_USUARIOS)))} usuarios — turno ${emp.turno}`);
    }

    // Si quedamos cortos, rellenar con empresa genérica
    while (filas.length < TOTAL_USUARIOS) {
        const genero = 'M';
        filas.push({
            'NOMBRE':          generarNombre(genero),
            'RUT':             generarRut(),
            'EMPRESA':         'ARAMARK',
            'GÉNERO':          genero,
            'HAB. SOLICITADA': todasHabs[filas.length % todasHabs.length],
            'N° CONTRATO':     'TEST-EXTRA-2030',
            'FECHA LLEGADA':   FECHA_LLEGADA,
            'FECHA SALIDA':    FECHA_SALIDA,
        });
    }

    console.log(`\n   Total generados: ${filas.length} trabajadores`);

    // ── 4. Crear Excel ────────────────────────────────────────────────────────
    console.log('\n3️⃣  Creando Excel...');
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [
        { wch: 40 }, // NOMBRE
        { wch: 14 }, // RUT
        { wch: 40 }, // EMPRESA
        { wch: 9  }, // GÉNERO
        { wch: 16 }, // HAB. SOLICITADA
        { wch: 20 }, // N° CONTRATO
        { wch: 14 }, // FECHA LLEGADA
        { wch: 14 }, // FECHA SALIDA
    ];

    // Estilo cabecera (negrita roja)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'C0392B' } } };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PRUEBA 2000');

    const outPath = path.join(
        '/Users/juan/Desktop/PROYECTO CAMPAMENTO/camp-management-pwa',
        `prueba_2000_usuarios_2030.xlsx`
    );
    XLSX.writeFile(wb, outPath);

    // ── 5. Resumen final ──────────────────────────────────────────────────────
    console.log(`\n✅ ¡Excel listo!`);
    console.log(`   Archivo: prueba_2000_usuarios_2030.xlsx`);
    console.log(`   Usuarios: ${filas.length}`);
    console.log(`   Fechas:   ${FECHA_LLEGADA} → ${FECHA_SALIDA}`);
    console.log(`   Estado:   PRE-ASIGNADO (fecha futura 2030)\n`);

    // Mostrar distribución final
    const dist = {};
    for (const f of filas) dist[f['EMPRESA']] = (dist[f['EMPRESA']] || 0) + 1;
    console.log('📊 Distribución final:');
    for (const [emp, cnt] of Object.entries(dist)) {
        console.log(`   ${String(cnt).padStart(4)} → ${emp}`);
    }

    console.log(`\n📌 Sube el archivo en: Solicitudes → 📂 Cargas con Habitación\n`);
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
