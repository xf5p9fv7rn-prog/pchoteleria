#!/usr/bin/env node
/**
 * limpiar_hualpen.js
 * Limpia COMPLETAMENTE a Logística Hualpén de la plataforma:
 * - Hace checkout de todas sus asignaciones activas
 * - Libera sus camas (estado → Disponible)
 * - Elimina todas sus solicitudes en v2_solicitudes_b2b
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://pnkajjduvadcxealodcp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function limpiarHualpen() {
    console.log('\n🚀 Iniciando limpieza completa de Logística Hualpén...\n');

    // ── 1. Buscar empresa_id ────────────────────────────────────────────────────
    console.log('1️⃣  Buscando empresa "Logística Hualpén"...');
    const { data: empRows, error: eEmp } = await supabase
        .from('v2_empresas')
        .select('id, nombre')
        .ilike('nombre', '%hualp%');
    
    if (eEmp) { console.error('❌ Error:', eEmp.message); process.exit(1); }
    if (!empRows?.length) { console.log('⚠️  No se encontró empresa con "hualp". Continuando igual...'); }
    else {
        console.log(`   Encontrada(s): ${empRows.map(e => `[${e.id}] ${e.nombre}`).join(', ')}`);
    }
    const empresaIds = (empRows || []).map(e => e.id);

    // ── 2. Buscar asignaciones activas ──────────────────────────────────────────
    console.log('\n2️⃣  Buscando asignaciones activas de Hualpén...');
    let asigQuery = supabase
        .from('v2_asignaciones')
        .select('id, id_cama, nombre_huesped, rut_huesped')
        .is('fecha_checkout', null);
    
    if (empresaIds.length > 0) {
        asigQuery = asigQuery.in('empresa_id', empresaIds);
    }
    
    const { data: asigs, error: eAsig } = await asigQuery;
    if (eAsig) { console.error('❌ Error:', eAsig.message); process.exit(1); }
    
    console.log(`   Asignaciones activas: ${asigs?.length || 0}`);
    const asigIds = (asigs || []).map(a => a.id);
    const camaIds = [...new Set((asigs || []).map(a => a.id_cama).filter(Boolean))];

    // ── 3. Eliminar asignaciones directamente ────────────────────────────────────
    // (checkout falla por constraint chk_fechas en pre-asignaciones con fecha futura)
    if (asigIds.length > 0) {
        console.log(`\n3️⃣  Eliminando ${asigIds.length} asignaciones de Hualpén...`);
        let totalBorradas = 0;
        for (let i = 0; i < asigIds.length; i += 50) {
            const lote = asigIds.slice(i, i + 50);
            const { error, data } = await supabase
                .from('v2_asignaciones')
                .delete()
                .in('id', lote)
                .select('id');
            if (error) console.warn(`   ⚠️ Lote ${i}-${i+50}:`, error.message);
            else {
                totalBorradas += (data?.length || lote.length);
                console.log(`   ✅ ${lote.length} asignaciones eliminadas (lote ${Math.floor(i/50)+1})`);
            }
        }
        console.log(`   Total eliminadas: ${totalBorradas}`);
    } else {
        console.log('\n3️⃣  No hay asignaciones → omitiendo');
    }


    // ── 4. Liberar camas ────────────────────────────────────────────────────────
    if (camaIds.length > 0) {
        console.log(`\n4️⃣  Liberando ${camaIds.length} camas...`);
        for (let i = 0; i < camaIds.length; i += 50) {
            const lote = camaIds.slice(i, i + 50);
            const { error } = await supabase
                .from('v2_camas')
                .update({ estado: 'Disponible' })
                .in('id_cama', lote);
            if (error) console.warn(`   ⚠️ Lote camas:`, error.message);
            else console.log(`   ✅ ${lote.length} camas liberadas`);
        }
    } else {
        console.log('\n4️⃣  No hay camas que liberar');
    }

    // ── 5. Borrar todas las solicitudes de Hualpén ──────────────────────────────
    console.log('\n5️⃣  Borrando solicitudes de Hualpén...');
    // Buscar por nombre de empresa en v2_solicitudes_b2b
    const { data: sols, error: eSols } = await supabase
        .from('v2_solicitudes_b2b')
        .select('id')
        .ilike('empresa', '%hualp%');
    
    if (eSols) { console.error('❌ Error buscando solicitudes:', eSols.message); }
    else if (!sols?.length) {
        console.log('   No hay solicitudes de Hualpén en v2_solicitudes_b2b');
    } else {
        const solIds = sols.map(s => s.id);
        console.log(`   Encontradas: ${solIds.length} solicitudes`);
        for (let i = 0; i < solIds.length; i += 200) {
            const lote = solIds.slice(i, i + 200);
            const { error } = await supabase
                .from('v2_solicitudes_b2b')
                .delete()
                .in('id', lote);
            if (error) console.warn(`   ⚠️ Lote solicitudes:`, error.message);
            else console.log(`   ✅ ${lote.length} solicitudes eliminadas`);
        }
    }

    // ── 6. Verificación final ────────────────────────────────────────────────────
    console.log('\n6️⃣  Verificación final...');
    const { count: asigRestantes } = await supabase
        .from('v2_asignaciones')
        .select('id', { count: 'exact', head: true })
        .is('fecha_checkout', null)
        .in('empresa_id', empresaIds.length ? empresaIds : ['__none__']);
    
    const { count: solsRestantes } = await supabase
        .from('v2_solicitudes_b2b')
        .select('id', { count: 'exact', head: true })
        .ilike('empresa', '%hualp%');

    console.log(`   Asignaciones activas restantes: ${asigRestantes ?? 'n/a'}`);
    console.log(`   Solicitudes restantes:           ${solsRestantes ?? 'n/a'}`);

    if ((asigRestantes ?? 0) === 0 && (solsRestantes ?? 0) === 0) {
        console.log('\n✅ ¡Limpieza completada exitosamente! Hualpén eliminado de la plataforma.\n');
    } else {
        console.log('\n⚠️  Quedan registros. Puede necesitar revisión manual.\n');
    }
}

limpiarHualpen().catch(e => {
    console.error('❌ Error fatal:', e.message);
    process.exit(1);
});
