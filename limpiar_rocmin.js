#!/usr/bin/env node
/**
 * limpiar_rocmin.js
 * Checkout masivo de todas las asignaciones activas de ROCMIN:
 *   1. Obtiene asignaciones activas (fecha_checkout IS NULL) de ROCMIN
 *   2. Libera las camas → Disponible
 *   3. Registra fecha_checkout = GREATEST(NOW(), fecha_checkin)
 *   4. Limpia v2_camas_perdidas de las habitaciones liberadas
 *   5. Verificación final
 */

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    'https://pnkajjduvadcxealodcp.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro'
);

async function limpiarRocmin() {
    console.log('\n🏗️  Checkout masivo ROCMIN\n' + '─'.repeat(50));

    // ── 1. Obtener empresa_id de ROCMIN ──────────────────────────────────────
    console.log('1️⃣  Buscando empresa ROCMIN...');
    const { data: empRows, error: errEmp } = await supabase
        .from('v2_empresas')
        .select('id, nombre')
        .ilike('nombre', '%rocmin%');
    if (errEmp) { console.error('❌ Error empresa:', errEmp.message); process.exit(1); }
    if (!empRows?.length) { console.error('❌ No se encontró empresa ROCMIN'); process.exit(1); }
    const empIds = empRows.map(e => e.id);
    console.log(`   ✅ Empresa(s): ${empRows.map(e => e.nombre).join(', ')}`);

    // ── 2. Obtener asignaciones activas de ROCMIN ─────────────────────────────
    console.log('\n2️⃣  Buscando asignaciones activas de ROCMIN...');
    let asigs = [], pg = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select('id, id_cama, fecha_checkin, nombre_huesped')
            .in('empresa_id', empIds)
            .is('fecha_checkout', null)
            .range(pg * 1000, pg * 1000 + 999);
        if (error) { console.error('❌ Error asigs:', error.message); break; }
        if (!data?.length) break;
        asigs = asigs.concat(data);
        if (data.length < 1000) break;
        pg++;
    }
    console.log(`   ✅ Asignaciones activas: ${asigs.length}`);
    if (!asigs.length) {
        console.log('\n✅ ROCMIN no tiene asignaciones activas — nada que liberar.\n');
        return;
    }

    const camaIds    = [...new Set(asigs.map(a => a.id_cama).filter(Boolean))];
    const asigIds    = asigs.map(a => a.id);

    // ── 3. Liberar camas ──────────────────────────────────────────────────────
    console.log(`\n3️⃣  Liberando ${camaIds.length} camas (→ Disponible)...`);
    let liberadas = 0;
    for (let i = 0; i < camaIds.length; i += 50) {
        const lote = camaIds.slice(i, i + 50);
        const { error } = await supabase
            .from('v2_camas')
            .update({ estado: 'Disponible' })
            .in('id_cama', lote)
            .neq('estado', 'Deshabilitada');
        if (error) console.warn(`   ⚠️ Lote ${i}:`, error.message);
        else liberadas += lote.length;
    }
    console.log(`   ✅ ${liberadas} camas liberadas`);

    // ── 4. Registrar fecha_checkout ───────────────────────────────────────────
    // Usamos RPC o UPDATE por lotes para evitar chk_fechas
    console.log(`\n4️⃣  Registrando checkout en ${asigIds.length} asignaciones...`);
    let checkedOut = 0;
    const ahora = new Date().toISOString();
    for (let i = 0; i < asigIds.length; i += 50) {
        const lote = asigIds.slice(i, i + 50);
        // Para cada asignación en este lote, usamos GREATEST via update con RPC-like approach
        // Supabase JS no soporta GREATEST directamente, así que hacemos una query por asignación
        // para las que tienen fecha_checkin > NOW()
        const asigLote = asigs.slice(i, i + 50);
        for (const a of asigLote) {
            const fechaCheckin = new Date(a.fecha_checkin);
            const ahoraDate   = new Date(ahora);
            const checkout    = fechaCheckin > ahoraDate ? a.fecha_checkin : ahora;
            const { error } = await supabase
                .from('v2_asignaciones')
                .update({ fecha_checkout: checkout })
                .eq('id', a.id)
                .is('fecha_checkout', null);
            if (error) console.warn(`   ⚠️ ${a.nombre_huesped}:`, error.message);
            else checkedOut++;
        }
    }
    console.log(`   ✅ ${checkedOut} checkout registrados`);

    // ── 5. Limpiar v2_camas_perdidas ──────────────────────────────────────────
    console.log('\n5️⃣  Limpiando v2_camas_perdidas...');
    const { data: camasData } = await supabase
        .from('v2_camas')
        .select('id_cama,habitacion_id')
        .in('id_cama', camaIds);
    const habIds = [...new Set((camasData || []).map(c => c.habitacion_id).filter(Boolean))];
    if (habIds.length) {
        const { error: errCP } = await supabase
            .from('v2_camas_perdidas')
            .delete()
            .in('habitacion_id', habIds);
        if (errCP) console.warn('   ⚠️ Error CP:', errCP.message);
        else console.log(`   ✅ v2_camas_perdidas limpiado (${habIds.length} habitaciones)`);
    } else {
        console.log('   ℹ️  Sin registros en v2_camas_perdidas para ROCMIN');
    }

    // ── 6. Verificación final ─────────────────────────────────────────────────
    console.log('\n6️⃣  Verificación final...');
    const { count: restantes } = await supabase
        .from('v2_asignaciones')
        .select('id', { count: 'exact', head: true })
        .in('empresa_id', empIds)
        .is('fecha_checkout', null);

    console.log('\n' + '═'.repeat(50));
    console.log('✅  CHECKOUT ROCMIN COMPLETADO');
    console.log('═'.repeat(50));
    console.log(`   Camas liberadas:              ${liberadas}`);
    console.log(`   Checkout registrados:         ${checkedOut}`);
    console.log(`   Habitaciones CP limpiadas:    ${habIds.length}`);
    console.log(`   Asignaciones activas restantes: ${restantes ?? '?'}`);
    if ((restantes ?? 1) === 0) {
        console.log('\n🎉 ROCMIN totalmente liberado.\n');
    } else {
        console.log(`\n⚠️  Aún quedan ${restantes} asignaciones. Revisar manualmente.\n`);
    }
}

limpiarRocmin().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
