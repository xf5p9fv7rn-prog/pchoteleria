/**
 * limpiar_rocmin_v2.js
 * Libera TODAS las asignaciones de ROCMIN: activas + pre_asignadas
 * Ejecutar: node limpiar_rocmin_v2.js
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pnkajjduvadcxealodcp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjMwNDM3OCwiZXhwIjoyMDYxODgwMzc4fQ.6MdDOp4MbMbqCbKpUBzSAJSbOHlBwKGBvmUUOlqKVWY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function limpiarRocmin() {
    console.log('🔍 Buscando empresa ROCMIN...');
    
    // 1. Obtener empresa ROCMIN
    const { data: empresas } = await supabase
        .from('v2_empresas')
        .select('id, nombre')
        .ilike('nombre', '%ROCMIN%');
    
    console.log('Empresas ROCMIN encontradas:', empresas);
    
    if (!empresas?.length) {
        console.log('❌ No se encontró empresa ROCMIN');
        return;
    }
    
    const empIds = empresas.map(e => e.id);
    
    // 2. Buscar TODAS las asignaciones sin checkout (activas + pre_asignadas)
    const { data: asignaciones } = await supabase
        .from('v2_asignaciones')
        .select('id, id_cama, estado_asignacion, nombre_huesped, rut_huesped')
        .in('empresa_id', empIds)
        .is('fecha_checkout', null);
    
    console.log(`\n📋 Total asignaciones ROCMIN sin checkout: ${asignaciones?.length || 0}`);
    
    if (!asignaciones?.length) {
        console.log('✅ No hay asignaciones pendientes de ROCMIN');
        return;
    }
    
    // Agrupar por estado
    const activas     = asignaciones.filter(a => a.estado_asignacion === 'activa');
    const preAsig     = asignaciones.filter(a => a.estado_asignacion === 'pre_asignado');
    const otras       = asignaciones.filter(a => !['activa', 'pre_asignado'].includes(a.estado_asignacion));
    
    console.log(`  - Activas:      ${activas.length}`);
    console.log(`  - Pre-asignadas: ${preAsig.length}`);
    console.log(`  - Otras:        ${otras.length}`);
    
    const allIds   = asignaciones.map(a => a.id);
    const camaIds  = [...new Set(asignaciones.map(a => a.id_cama).filter(Boolean))];
    
    console.log(`\n🏠 Camas a liberar: ${camaIds.length}`);
    
    const CHUNK = 20;
    const now   = new Date().toISOString();
    
    // 3. Hacer checkout de TODAS (activas + pre_asignadas)
    console.log('\n⏏️  Registrando checkout...');
    let checkoutCount = 0;
    for (let i = 0; i < allIds.length; i += CHUNK) {
        const chunk = allIds.slice(i, i + CHUNK);
        const { error } = await supabase
            .from('v2_asignaciones')
            .update({
                fecha_checkout: now,
                estado_asignacion: 'sin_checkout'
            })
            .in('id', chunk);
        
        if (error) {
            console.warn(`  ⚠️  Error lote ${i}-${i+CHUNK}:`, error.message);
        } else {
            checkoutCount += chunk.length;
            console.log(`  ✅ Lote ${Math.floor(i/CHUNK)+1}: ${chunk.length} asignaciones cerradas`);
        }
    }
    
    // 4. Liberar camas
    console.log('\n🔓 Liberando camas...');
    let camasLiberadas = 0;
    for (let i = 0; i < camaIds.length; i += CHUNK) {
        const chunk = camaIds.slice(i, i + CHUNK);
        const { data: updated, error } = await supabase
            .from('v2_camas')
            .update({ estado: 'Disponible' })
            .in('id_cama', chunk)
            .neq('estado', 'Deshabilitada')
            .select('id_cama');
        
        if (error) {
            console.warn(`  ⚠️  Error lote camas ${i}-${i+CHUNK}:`, error.message);
        } else {
            camasLiberadas += (updated?.length || 0);
            console.log(`  ✅ Lote ${Math.floor(i/CHUNK)+1}: ${updated?.length || 0} camas liberadas`);
        }
    }
    
    // 5. Limpiar v2_camas_perdidas
    console.log('\n🧹 Limpiando camas perdidas...');
    const { data: camasData } = await supabase
        .from('v2_camas')
        .select('id_cama, habitacion_id')
        .in('id_cama', camaIds);
    
    const habIds = [...new Set((camasData || []).map(c => c.habitacion_id).filter(Boolean))];
    
    if (habIds.length) {
        const { error: cpErr } = await supabase
            .from('v2_camas_perdidas')
            .delete()
            .in('habitacion_id', habIds);
        
        if (cpErr) console.warn('  ⚠️  Error limpiando camas_perdidas:', cpErr.message);
        else console.log(`  ✅ ${habIds.length} habitaciones limpiadas de v2_camas_perdidas`);
    }
    
    // 6. Resumen final
    console.log('\n' + '='.repeat(50));
    console.log('✅ LIMPIEZA ROCMIN COMPLETADA');
    console.log(`   Asignaciones cerradas: ${checkoutCount}`);
    console.log(`   Camas liberadas:       ${camasLiberadas}`);
    console.log(`   Habitaciones limpias:  ${habIds.length}`);
    console.log('='.repeat(50));
}

limpiarRocmin().catch(e => {
    console.error('❌ Error fatal:', e.message);
    process.exit(1);
});
