#!/usr/bin/env node
/**
 * borrar_rocmin_total.js
 * Elimina COMPLETAMENTE todo rastro de ROCMIN:
 *   - v2_asignaciones (activas + pre_asignadas) → checkout + DELETE
 *   - v2_camas → Disponible
 *   - v2_camas_perdidas → limpia las habitaciones
 *   - v2_solicitudes_b2b → DELETE de todas las solicitudes de ROCMIN
 */

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    'https://pnkajjduvadcxealodcp.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro'
);

async function borrarRocminTotal() {
    console.log('\n💥 BORRADO TOTAL ROCMIN\n' + '═'.repeat(60));

    // ── 1. Obtener empresas ROCMIN ─────────────────────────────────────────
    console.log('1️⃣  Buscando empresas ROCMIN...');
    const { data: empRows, error: errEmp } = await supabase
        .from('v2_empresas').select('id, nombre').ilike('nombre', '%rocmin%');
    if (errEmp) { console.error('❌', errEmp.message); process.exit(1); }
    if (!empRows?.length) { console.error('❌ No encontró ROCMIN'); process.exit(1); }
    
    const empIds   = empRows.map(e => e.id);
    const empNombres = empRows.map(e => e.nombre);
    console.log(`   ✅ ${empNombres.join(' | ')}`);

    // ── 2. Asignaciones sin checkout ───────────────────────────────────────
    console.log('\n2️⃣  Cargando asignaciones sin checkout...');
    let asigs = [], pg = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select('id, id_cama, fecha_checkin, nombre_huesped, estado_asignacion')
            .in('empresa_id', empIds)
            .is('fecha_checkout', null)
            .range(pg * 1000, pg * 1000 + 999);
        if (error || !data?.length) break;
        asigs = asigs.concat(data);
        if (data.length < 1000) break;
        pg++;
    }
    console.log(`   📊 Asignaciones sin checkout: ${asigs.length}`);
    console.log(`      Activas:       ${asigs.filter(a=>a.estado_asignacion==='activa').length}`);
    console.log(`      Pre-asignadas: ${asigs.filter(a=>a.estado_asignacion==='pre_asignado').length}`);
    console.log(`      Otras:         ${asigs.filter(a=>!['activa','pre_asignado'].includes(a.estado_asignacion)).length}`);

    const camaIds = [...new Set(asigs.map(a => a.id_cama).filter(Boolean))];

    // ── 3. Liberar camas ───────────────────────────────────────────────────
    if (camaIds.length) {
        console.log(`\n3️⃣  Liberando ${camaIds.length} camas...`);
        let lib = 0;
        for (let i = 0; i < camaIds.length; i += 20) {
            const { data: upd, error } = await supabase
                .from('v2_camas')
                .update({ estado: 'Disponible' })
                .in('id_cama', camaIds.slice(i, i + 20))
                .neq('estado', 'Deshabilitada')
                .select('id_cama');
            if (error) console.warn(`   ⚠️`, error.message);
            else lib += upd?.length || 0;
        }
        console.log(`   ✅ ${lib} camas liberadas`);
    } else {
        console.log('\n3️⃣  Sin camas para liberar');
    }

    // ── 4. Checkout de asignaciones ────────────────────────────────────────
    if (asigs.length) {
        console.log(`\n4️⃣  Registrando checkout en ${asigs.length} asignaciones...`);
        const ahora = new Date().toISOString();
        let ok = 0;
        for (const a of asigs) {
            const fechaCI = a.fecha_checkin ? new Date(a.fecha_checkin) : null;
            const ahora_d = new Date(ahora);
            const co = (fechaCI && fechaCI > ahora_d) ? a.fecha_checkin : ahora;
            const { error } = await supabase
                .from('v2_asignaciones')
                .update({ fecha_checkout: co, estado_asignacion: 'sin_checkout' })
                .eq('id', a.id).is('fecha_checkout', null);
            if (error) console.warn(`   ⚠️ ${a.nombre_huesped}:`, error.message);
            else ok++;
        }
        console.log(`   ✅ ${ok} checkout registrados`);
    }

    // ── 5. Limpiar v2_camas_perdidas ───────────────────────────────────────
    if (camaIds.length) {
        console.log('\n5️⃣  Limpiando v2_camas_perdidas...');
        const { data: cd } = await supabase.from('v2_camas').select('id_cama,habitacion_id').in('id_cama', camaIds);
        const habIds = [...new Set((cd||[]).map(c=>c.habitacion_id).filter(Boolean))];
        if (habIds.length) {
            for (let i = 0; i < habIds.length; i += 50) {
                await supabase.from('v2_camas_perdidas').delete().in('habitacion_id', habIds.slice(i, i+50));
            }
            console.log(`   ✅ ${habIds.length} habitaciones limpias en v2_camas_perdidas`);
        } else {
            console.log('   ℹ️  Sin registros en v2_camas_perdidas');
        }
    }

    // ── 6. Borrar solicitudes B2B de ROCMIN ───────────────────────────────
    console.log('\n6️⃣  Borrando solicitudes B2B de ROCMIN...');
    let solsTotal = 0;
    for (const empId of empIds) {
        let pg2 = 0;
        while (true) {
            const { data: solPage, error: errSol } = await supabase
                .from('v2_solicitudes_b2b')
                .select('id')
                .eq('empresa_id', empId)
                .range(pg2 * 500, pg2 * 500 + 499);
            if (errSol || !solPage?.length) break;

            const solIds = solPage.map(s => s.id);
            for (let i = 0; i < solIds.length; i += 50) {
                const { error: delErr } = await supabase
                    .from('v2_solicitudes_b2b')
                    .delete()
                    .in('id', solIds.slice(i, i + 50));
                if (delErr) console.warn(`   ⚠️ Error borrando sols:`, delErr.message);
                else solsTotal += Math.min(50, solIds.length - i);
            }
            if (solPage.length < 500) break;
            pg2++;
        }
    }
    
    // Fallback: buscar por nombre de empresa en caso de que empresa_id no matchee
    console.log('   🔍 Buscando solicitudes por nombre empresa...');
    for (const nombre of empNombres) {
        let pg3 = 0;
        while (true) {
            const { data: solPage2 } = await supabase
                .from('v2_solicitudes_b2b')
                .select('id')
                .ilike('empresa', `%${nombre.split(' ')[0]}%`) // primer palabra: ROCMIN
                .range(pg3 * 500, pg3 * 500 + 499);
            if (!solPage2?.length) break;

            const solIds2 = solPage2.map(s => s.id);
            for (let i = 0; i < solIds2.length; i += 50) {
                const { error: delErr } = await supabase
                    .from('v2_solicitudes_b2b')
                    .delete()
                    .in('id', solIds2.slice(i, i + 50));
                if (!delErr) solsTotal += Math.min(50, solIds2.length - i);
            }
            if (solPage2.length < 500) break;
            pg3++;
        }
    }
    console.log(`   ✅ ${solsTotal} solicitudes eliminadas`);

    // ── 7. Verificación final ──────────────────────────────────────────────
    console.log('\n7️⃣  Verificación final...');
    const { count: asigRest } = await supabase
        .from('v2_asignaciones').select('id', { count: 'exact', head: true })
        .in('empresa_id', empIds).is('fecha_checkout', null);
    const { count: solsRest } = await supabase
        .from('v2_solicitudes_b2b').select('id', { count: 'exact', head: true })
        .in('empresa_id', empIds);

    console.log('\n' + '═'.repeat(60));
    console.log('✅  BORRADO TOTAL ROCMIN COMPLETADO');
    console.log('═'.repeat(60));
    console.log(`   Asignaciones restantes:   ${asigRest ?? '?'}`);
    console.log(`   Solicitudes restantes:    ${solsRest ?? '?'}`);
    console.log('═'.repeat(60));

    if ((asigRest ?? 1) === 0 && (solsRest ?? 1) === 0) {
        console.log('\n🎉 ROCMIN completamente eliminado del sistema.\n');
    } else {
        if ((asigRest ?? 0) > 0) console.log(`⚠️  Quedan ${asigRest} asignaciones activas`);
        if ((solsRest ?? 0) > 0) console.log(`⚠️  Quedan ${solsRest} solicitudes — posiblemente sin empresa_id en BD`);
    }
}

borrarRocminTotal().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
