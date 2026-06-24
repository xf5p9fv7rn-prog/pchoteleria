#!/usr/bin/env node
/**
 * limpiar_rocmin_full.js
 * Libera TODAS las asignaciones de ROCMIN: activas + pre_asignadas + cualquier estado sin checkout
 */

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    'https://pnkajjduvadcxealodcp.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro'
);

async function limpiarRocmin() {
    console.log('\n🏗️  Checkout masivo ROCMIN (activas + pre-asignadas)\n' + '─'.repeat(60));

    // 1. Obtener empresa ROCMIN
    console.log('1️⃣  Buscando empresa ROCMIN...');
    const { data: empRows, error: errEmp } = await supabase
        .from('v2_empresas')
        .select('id, nombre')
        .ilike('nombre', '%rocmin%');
    
    if (errEmp) { console.error('❌ Error empresa:', errEmp.message); process.exit(1); }
    if (!empRows?.length) { 
        console.error('❌ No se encontró empresa ROCMIN en v2_empresas');
        
        // Intentar buscar directo en asignaciones por nombre de empresa
        console.log('\n🔍 Buscando en solicitudes B2B por nombre ROCMIN...');
        const { data: sols } = await supabase
            .from('v2_solicitudes_b2b')
            .select('empresa, n_contrato')
            .ilike('empresa', '%rocmin%')
            .limit(5);
        console.log('Solicitudes con ROCMIN:', JSON.stringify(sols, null, 2));
        
        // Buscar en asignaciones por nombre_empresa (campo libre)
        const { data: asigDirect } = await supabase
            .from('v2_asignaciones')
            .select('id, id_cama, nombre_huesped, empresa_id, numero_contrato, estado_asignacion')
            .ilike('numero_contrato', '%12500%')  // contrato de ROCMIN
            .is('fecha_checkout', null)
            .limit(10);
        console.log('Asignaciones con contrato 12500xxx:', JSON.stringify(asigDirect, null, 2));
        process.exit(1);
    }
    
    const empIds = empRows.map(e => e.id);
    console.log(`   ✅ Empresa(s): ${empRows.map(e => e.nombre).join(', ')} (IDs: ${empIds.join(', ')})`);

    // 2. Obtener TODAS las asignaciones sin checkout (activas + pre_asignadas + cualquier estado)
    console.log('\n2️⃣  Buscando TODAS las asignaciones sin checkout de ROCMIN...');
    let asigs = [], pg = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select('id, id_cama, fecha_checkin, nombre_huesped, estado_asignacion')
            .in('empresa_id', empIds)
            .is('fecha_checkout', null)
            .range(pg * 1000, pg * 1000 + 999);
        if (error) { console.error('❌ Error asigs:', error.message); break; }
        if (!data?.length) break;
        asigs = asigs.concat(data);
        if (data.length < 1000) break;
        pg++;
    }
    
    const activas    = asigs.filter(a => a.estado_asignacion === 'activa');
    const preAsig    = asigs.filter(a => a.estado_asignacion === 'pre_asignado');
    const otras      = asigs.filter(a => !['activa','pre_asignado'].includes(a.estado_asignacion));
    
    console.log(`   📊 Total sin checkout: ${asigs.length}`);
    console.log(`      - Activas:       ${activas.length}`);
    console.log(`      - Pre-asignadas: ${preAsig.length}`);
    console.log(`      - Otras:         ${otras.length} (${[...new Set(otras.map(a=>a.estado_asignacion))].join(', ')})`);
    
    if (!asigs.length) {
        console.log('\n✅ ROCMIN no tiene asignaciones pendientes.\n');
        return;
    }

    const camaIds = [...new Set(asigs.map(a => a.id_cama).filter(Boolean))];
    const asigIds = asigs.map(a => a.id);
    
    console.log(`   🏠 Camas involucradas: ${camaIds.length}`);

    // 3. Liberar camas PRIMERO
    console.log(`\n3️⃣  Liberando ${camaIds.length} camas → Disponible...`);
    let liberadas = 0;
    for (let i = 0; i < camaIds.length; i += 30) {
        const lote = camaIds.slice(i, i + 30);
        const { data: upd, error } = await supabase
            .from('v2_camas')
            .update({ estado: 'Disponible' })
            .in('id_cama', lote)
            .neq('estado', 'Deshabilitada')
            .select('id_cama');
        if (error) console.warn(`   ⚠️ Lote ${i}:`, error.message);
        else { liberadas += (upd?.length || 0); }
    }
    console.log(`   ✅ ${liberadas} camas liberadas`);

    // 4. Registrar checkout (respetando constraint chk_fechas)
    console.log(`\n4️⃣  Registrando checkout en ${asigIds.length} asignaciones...`);
    let checkedOut = 0;
    const ahora = new Date().toISOString();
    
    for (const a of asigs) {
        const fechaCheckin = a.fecha_checkin ? new Date(a.fecha_checkin) : null;
        const ahoraDate    = new Date(ahora);
        // GREATEST(NOW(), fecha_checkin) — para no violar constraint chk_fechas
        const checkout = (fechaCheckin && fechaCheckin > ahoraDate) ? a.fecha_checkin : ahora;
        
        const { error } = await supabase
            .from('v2_asignaciones')
            .update({ 
                fecha_checkout: checkout,
                estado_asignacion: 'sin_checkout'
            })
            .eq('id', a.id)
            .is('fecha_checkout', null);
        
        if (error) console.warn(`   ⚠️ ${a.nombre_huesped}:`, error.message);
        else checkedOut++;
    }
    console.log(`   ✅ ${checkedOut} checkout registrados`);

    // 5. Limpiar v2_camas_perdidas
    console.log('\n5️⃣  Limpiando v2_camas_perdidas...');
    const { data: camasData } = await supabase
        .from('v2_camas')
        .select('id_cama,habitacion_id')
        .in('id_cama', camaIds);
    
    const habIds = [...new Set((camasData || []).map(c => c.habitacion_id).filter(Boolean))];
    
    if (habIds.length) {
        for (let i = 0; i < habIds.length; i += 50) {
            const { error } = await supabase
                .from('v2_camas_perdidas')
                .delete()
                .in('habitacion_id', habIds.slice(i, i + 50));
            if (error) console.warn('   ⚠️ Error CP:', error.message);
        }
        console.log(`   ✅ v2_camas_perdidas limpiado (${habIds.length} habitaciones)`);
    } else {
        console.log('   ℹ️  Sin registros de camas perdidas para ROCMIN');
    }

    // 6. Verificación final
    console.log('\n6️⃣  Verificación final...');
    const { count: restantes } = await supabase
        .from('v2_asignaciones')
        .select('id', { count: 'exact', head: true })
        .in('empresa_id', empIds)
        .is('fecha_checkout', null);

    console.log('\n' + '═'.repeat(60));
    console.log('✅  CHECKOUT ROCMIN COMPLETADO');
    console.log('═'.repeat(60));
    console.log(`   Asignaciones cerradas:    ${checkedOut}  (de ${asigs.length})`);
    console.log(`   Camas liberadas:          ${liberadas}  (de ${camaIds.length})`);
    console.log(`   Habitaciones CP limpias:  ${habIds.length}`);
    console.log(`   Asignaciones restantes:   ${restantes ?? '?'}`);
    if ((restantes ?? 1) === 0) {
        console.log('\n🎉 ROCMIN totalmente liberado.\n');
    } else {
        console.log(`\n⚠️  Aún quedan ${restantes} asignaciones. Revisar manualmente.\n`);
    }
}

limpiarRocmin().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
