#!/usr/bin/env node
/**
 * limpiar_2030.js
 * Elimina TODA la data de prueba cargada con fechas 2030:
 * - v2_asignaciones con fecha_salida_programada en 2030
 * - v2_solicitudes_b2b con fecha_salida en 2030
 * - Libera las camas correspondientes (estado → Disponible)
 */

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    'https://pnkajjduvadcxealodcp.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro'
);

async function limpiar2030() {
    console.log('\n🧹 Limpiando datos de prueba 2030...\n');

    // ── 1. Buscar asignaciones con fecha 2030 ────────────────────────────────
    console.log('1️⃣  Buscando asignaciones 2030...');
    let asig2030 = [], pg = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select('id, id_cama, rut_huesped')
            .gte('fecha_salida_programada', '2030-01-01')
            .range(pg * 1000, pg * 1000 + 999);
        if (error) { console.error('❌ Error:', error.message); break; }
        if (!data?.length) break;
        asig2030 = asig2030.concat(data);
        if (data.length < 1000) break;
        pg++;
    }
    console.log(`   Encontradas: ${asig2030.length} asignaciones`);

    // ── 2. Liberar las camas antes de borrar ──────────────────────────────────
    const camasIds = [...new Set(asig2030.map(a => String(a.id_cama)))];
    if (camasIds.length > 0) {
        console.log(`\n2️⃣  Liberando ${camasIds.length} camas (→ Disponible)...`);
        let liberadas = 0;
        for (let i = 0; i < camasIds.length; i += 50) {
            const lote = camasIds.slice(i, i + 50);
            const { error } = await supabase
                .from('v2_camas')
                .update({ estado: 'Disponible' })
                .in('id_cama', lote);
            if (error) console.warn(`   ⚠️ Error liberando lote ${i}:`, error.message);
            else liberadas += lote.length;
        }
        console.log(`   ✅ ${liberadas} camas liberadas`);
    }

    // ── 3. Borrar asignaciones 2030 ───────────────────────────────────────────
    if (asig2030.length > 0) {
        console.log(`\n3️⃣  Eliminando ${asig2030.length} asignaciones 2030...`);
        const ids = asig2030.map(a => a.id);
        let borradas = 0;
        for (let i = 0; i < ids.length; i += 100) {
            const lote = ids.slice(i, i + 100);
            const { error } = await supabase
                .from('v2_asignaciones')
                .delete()
                .in('id', lote);
            if (error) console.warn(`   ⚠️ Error borrando lote ${i}:`, error.message);
            else borradas += lote.length;
        }
        console.log(`   ✅ ${borradas} asignaciones eliminadas`);
    }

    // ── 4. Borrar solicitudes_b2b con fecha 2030 ─────────────────────────────
    console.log('\n4️⃣  Buscando solicitudes_b2b 2030...');
    let sol2030 = [], pg2 = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_solicitudes_b2b')
            .select('id')
            .gte('fecha_salida', '2030-01-01')
            .range(pg2 * 1000, pg2 * 1000 + 999);
        if (error) { console.error('❌ Error:', error.message); break; }
        if (!data?.length) break;
        sol2030 = sol2030.concat(data);
        if (data.length < 1000) break;
        pg2++;
    }
    console.log(`   Encontradas: ${sol2030.length} solicitudes`);

    if (sol2030.length > 0) {
        const solIds = sol2030.map(s => s.id);
        let borradasSol = 0;
        for (let i = 0; i < solIds.length; i += 100) {
            const lote = solIds.slice(i, i + 100);
            const { error } = await supabase
                .from('v2_solicitudes_b2b')
                .delete()
                .in('id', lote);
            if (error) console.warn(`   ⚠️ Error borrando sol ${i}:`, error.message);
            else borradasSol += lote.length;
        }
        console.log(`   ✅ ${borradasSol} solicitudes eliminadas`);
    }

    // ── 5. Verificación final ─────────────────────────────────────────────────
    console.log('\n5️⃣  Verificando que no quede nada 2030...');
    const { count: c1 } = await supabase
        .from('v2_asignaciones')
        .select('id', { count: 'exact', head: true })
        .gte('fecha_salida_programada', '2030-01-01');
    const { count: c2 } = await supabase
        .from('v2_solicitudes_b2b')
        .select('id', { count: 'exact', head: true })
        .gte('fecha_salida', '2030-01-01');

    console.log(`\n✅ LIMPIEZA COMPLETA`);
    console.log(`   Asignaciones 2030 restantes:  ${c1 ?? '?'}`);
    console.log(`   Solicitudes 2030 restantes:   ${c2 ?? '?'}`);
    console.log(`   Camas liberadas:              ${camasIds.length}`);
    if ((c1 ?? 1) === 0 && (c2 ?? 1) === 0) {
        console.log('\n🎉 Sistema limpio — solo quedan datos reales.\n');
    } else {
        console.log('\n⚠️  Aún quedan registros. Revisa manualmente.\n');
    }
}

limpiar2030().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
