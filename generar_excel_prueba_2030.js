#!/usr/bin/env node
/**
 * generar_excel_prueba_2030.js
 * Genera un Excel de prueba con trabajadores reales, habitaciones reales,
 * pero con fecha de llegada 2030 → quedarán como pre-asignados.
 * 
 * OJO: Respeta turno Día/Noche para empresas Anglo American.
 */

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = 'https://pnkajjduvadcxealodcp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Fechas de prueba 2030 ────────────────────────────────────────────────────
const FECHA_LLEGADA = '2030-01-01';
const FECHA_SALIDA  = '2030-01-31';

async function generarExcel() {
    console.log('\n🚀 Generando Excel de prueba 2030...\n');

    // 1. Traer todas las asignaciones activas con empresa y habitación
    console.log('1️⃣  Consultando asignaciones activas...');
    let all = [], from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select(`
                id, id_cama, nombre_huesped, rut_huesped,
                fecha_checkin, fecha_salida_programada,
                empresa_id,
                v2_empresas(id, nombre, turno),
                v2_camas(v2_habitaciones(numero_hab))
            `)
            .is('fecha_checkout', null)
            .order('empresa_id')
            .range(from, from + 999);
        
        if (error) { console.error('❌ Error:', error.message); process.exit(1); }
        if (!data?.length) break;
        all = all.concat(data);
        if (data.length < 1000) break;
        from += 1000;
    }
    console.log(`   Asignaciones activas: ${all.length}`);

    if (!all.length) {
        console.log('⚠️  No hay asignaciones activas. ¿Ya fue limpiado el sistema?');
        process.exit(0);
    }

    // 2. Agrupar por empresa para mostrar resumen
    const porEmpresa = {};
    for (const a of all) {
        const nombre = a.v2_empresas?.nombre || 'SIN EMPRESA';
        const turno  = a.v2_empresas?.turno  || '—';
        if (!porEmpresa[nombre]) porEmpresa[nombre] = { count: 0, turno };
        porEmpresa[nombre].count++;
    }

    console.log('\n2️⃣  Resumen por empresa:');
    for (const [emp, info] of Object.entries(porEmpresa)) {
        const esAnglo = emp.toLowerCase().includes('anglo') || emp.toLowerCase().includes('maiq');
        const tag = esAnglo ? ` 🌙☀️ turno: ${info.turno}` : '';
        console.log(`   ${info.count.toString().padStart(4)} trabajadores → ${emp}${tag}`);
    }

    // 3. Construir filas del Excel
    // ── IMPORTANTE: separar Anglo Día / Anglo Noche en grupos distintos ──────
    const filas = [];
    let sinHab = 0;

    for (const a of all) {
        const nombre  = a.nombre_huesped || '';
        const rut     = a.rut_huesped    || '';
        const empresa = a.v2_empresas?.nombre || 'SIN EMPRESA';
        const turno   = a.v2_empresas?.turno  || null;
        const hab     = a.v2_camas?.v2_habitaciones?.numero_hab || null;

        if (!hab) { sinHab++; continue; }  // sin habitación → no incluir

        // Detectar si es empresa tipo Anglo (turno Día o Noche)
        // Para Anglo: el nombre de empresa incluye el turno → ej. "MAESTRANZA - DÍA" / "- NOCHE"
        let empresaLabel = empresa;
        let contrato = '';

        // Género: inferir por nombre (heurística simple) o dejar vacío
        // → el motor no requiere género para asignación con habitación explícita

        filas.push({
            'NOMBRE':          nombre,
            'RUT':             rut,
            'EMPRESA':         empresaLabel,
            'GÉNERO':          '',       // no crítico cuando hay hab. explícita
            'HAB. SOLICITADA': String(hab).trim(),
            'N° CONTRATO':     contrato,
            'FECHA LLEGADA':   FECHA_LLEGADA,
            'FECHA SALIDA':    FECHA_SALIDA,
            'TURNO':           turno || '',
        });
    }

    console.log(`\n3️⃣  Filas generadas: ${filas.length}`);
    if (sinHab > 0) console.log(`   ⚠️  Sin habitación (excluidos): ${sinHab}`);

    // 4. Crear el Excel con XLSX
    console.log('\n4️⃣  Creando archivo Excel...');

    const ws = XLSX.utils.json_to_sheet(filas);

    // Anchos de columna
    ws['!cols'] = [
        { wch: 40 }, // NOMBRE
        { wch: 15 }, // RUT
        { wch: 40 }, // EMPRESA
        { wch: 10 }, // GÉNERO
        { wch: 16 }, // HAB. SOLICITADA
        { wch: 14 }, // N° CONTRATO
        { wch: 14 }, // FECHA LLEGADA
        { wch: 14 }, // FECHA SALIDA
        { wch: 10 }, // TURNO
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PRUEBA 2030');

    const outPath = path.join(
        '/Users/juan/Desktop/PROYECTO CAMPAMENTO/camp-management-pwa',
        `prueba_carga_2030_${new Date().toISOString().slice(0,10)}.xlsx`
    );
    XLSX.writeFile(wb, outPath);

    console.log(`\n✅ Excel generado: ${outPath}`);
    console.log(`\n📋 Resumen final:`);
    console.log(`   Total trabajadores: ${filas.length}`);
    console.log(`   Fecha llegada:      ${FECHA_LLEGADA}`);
    console.log(`   Fecha salida:       ${FECHA_SALIDA}`);
    console.log(`   Estado esperado:    PRE-ASIGNADO (fecha futura)`);
    console.log(`\n📌 Siguiente paso: Sube este Excel en Solicitudes → 📂 Cargas con Habitación\n`);
}

generarExcel().catch(e => {
    console.error('❌ Error fatal:', e.message);
    process.exit(1);
});
