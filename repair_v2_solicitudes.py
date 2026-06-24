#!/usr/bin/env python3
"""
repair_v2_solicitudes.py
Reemplaza las líneas 1502-1685 de v2-solicitudes.js (sección corrupta)
con las funciones _solSetHabManual, _limpiarCamasPerdidas y _solBorrarLista limpias.
"""
import sys

filepath = 'js/v2/modules/v2-solicitudes.js'

# Líneas a reemplazar (1-indexed, inclusive)
START_LINE = 1502
END_LINE   = 1685

clean_code = r"""window._solSetHabManual = async function(solicitudId, gKey, numHab) {
    numHab = (numHab || '').toString().trim();
    if (!numHab) {
        const inp = document.getElementById('inp-hab-' + solicitudId);
        if (inp) {
            inp.style.borderColor = '#ef4444';
            inp.focus();
            setTimeout(() => { inp.style.borderColor = '#c4b5fd'; }, 1500);
        }
        return;
    }
    const inp = document.getElementById('inp-hab-' + solicitudId);
    if (inp) { inp.disabled = true; inp.style.opacity = '0.5'; }
    try {
        const { error } = await supabase
            .from('v2_solicitudes_b2b')
            .update({ hab_solicitada: numHab })
            .eq('id', solicitudId);
        if (error) throw new Error(error.message);
        window._renderV2Solicitudes?.();
    } catch(e) {
        if (inp) { inp.disabled = false; inp.style.opacity = '1'; }
        alert('\u274c Error al guardar habitaci\u00f3n: ' + e.message);
    }
};

/**
 * _limpiarCamasPerdidas(camaIds)
 * Dado un array de IDs de cama liberadas, elimina sus registros en v2_camas_perdidas.
 * Se llama siempre que se borra una lista, un trabajador o una asignaci\u00f3n.
 */
async function _limpiarCamasPerdidas(camaIds) {
    if (!camaIds?.length) return;
    try {
        const { data: camasData } = await supabase
            .from('v2_camas')
            .select('id_cama,habitacion_id')
            .in('id_cama', camaIds);
        const habIds = [...new Set((camasData || []).map(c => c.habitacion_id).filter(Boolean))];
        if (!habIds.length) return;
        const { error } = await supabase
            .from('v2_camas_perdidas')
            .delete()
            .in('habitacion_id', habIds);
        if (error) console.warn('[CP] Error limpiando v2_camas_perdidas:', error.message);
        else console.log(`[CP] \u2705 v2_camas_perdidas limpiado: ${habIds.length} habitaciones`);
    } catch(e) {
        console.warn('[CP] Excepci\u00f3n en _limpiarCamasPerdidas:', e.message);
    }
}

// \u2500\u2500 Borrar lista de solicitudes (\u00e1lias de compatibilidad) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
window._solBorrarListaEmpresa = function(empresa) {
    const meta = window._gruposMetadata || {};
    const key = Object.keys(meta).find(k => meta[k].empresa === empresa);
    if(key != null) { window._solBorrarLista(parseInt(key)); }
    else { toast('\u26a0\ufe0f Recarga la p\u00e1gina antes de borrar', 'warn'); }
};

/**
 * _solBorrarLista(gKey)
 * Borra \u00danICAMENTE los registros de la lista seleccionada.
 * Libera camas, hace checkout, limpia v2_camas_perdidas y borra solicitudes.
 */
window._solBorrarLista = async function(gKey) {
    const data = window._gruposData[gKey];
    const rows = Array.isArray(data) ? data : (data?.allRows || data?.rows || []);
    const meta = (window._gruposMetadata || {})[gKey] || {};
    const empresa = meta.empresa || rows[0]?.empresa || 'esta empresa';
    const ids = (meta.ids?.length ? meta.ids : rows.map(r => r.id)).filter(Boolean);

    if(!ids.length) { toast('No hay registros en esta lista', 'warn'); return; }
    if(!await _solConfirm(
        `\u00bfBorrar esta lista de ${ids.length} solicitudes de "${empresa}"?\n\n` +
        `Per\u00edodo: ${meta.fechaIn||'\u2014'} \u2192 ${meta.fechaOut||'\u2014'}\n` +
        `N\u00b0 Contrato: ${meta.contrato||'\u2014'}\n\n` +
        `\u2022 Se har\u00e1 Check-Out de los trabajadores asignados\n` +
        `\u2022 Las camas quedar\u00e1n libres\n` +
        `\u2022 Desaparecer\u00e1n de Control de Asistencia e Infraestructura\n` +
        `Solo se elimina ESTA lista \u2014 otras listas no se ven afectadas.`,
        {confirmText:'\ud83d\uddd1\ufe0f Borrar y liberar', danger:true}
    )) return;

    // \u2500\u2500 Overlay de progreso \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `<div style="background:#fff;border-radius:20px;padding:32px 40px;text-align:center;min-width:340px">
        <div style="font-size:36px;margin-bottom:10px">\ud83d\uddd1\ufe0f</div>
        <div style="font-weight:900;font-size:15px;margin-bottom:6px">Borrando lista: ${empresa}</div>
        <div id="_bl_txt" style="font-size:13px;color:#64748b;min-height:20px;margin-bottom:12px">Preparando\u2026</div>
        <div style="height:7px;background:#f1f5f9;border-radius:99px;overflow:hidden">
            <div id="_bl_prog" style="height:100%;width:0%;background:linear-gradient(90deg,#b91c1c,#ef4444);transition:width .4s;border-radius:99px"></div>
        </div></div>`;
    document.body.appendChild(overlay);
    const setStep = (txt, pct) => {
        const el = document.getElementById('_bl_txt');
        const pr = document.getElementById('_bl_prog');
        if(el) el.textContent = txt;
        if(pr && pct !== undefined) pr.style.width = pct + '%';
    };

    try {
        // PASO 1: Obtener detalles de solicitudes, empresa y contrato
        const {data:sols} = await supabase
            .from('v2_solicitudes_b2b')
            .select('rut_trabajador,nombre_trabajador,n_contrato')
            .in('id', ids);
        const rutsNorm    = [...new Set((sols||[]).map(s => String(s.rut_trabajador||'').replace(/[\.\-\s]/g,'').toUpperCase().slice(0,12)).filter(Boolean))];
        const nombresNorm = [...new Set((sols||[]).map(s => s.nombre_trabajador).filter(Boolean))];
        const contratos   = [...new Set((sols||[]).map(s => String(s.n_contrato||meta.contrato||'')).filter(Boolean))];

        const {data:empRows} = await supabase.from('v2_empresas').select('id').ilike('nombre', empresa).limit(1);
        const empId = empRows?.[0]?.id;

        setStep('Buscando asignaciones activas\u2026', 20);
        let asigIds = [], camaIds = [];

        // PASO 2: 3 estrategias en paralelo \u2014 RUT + Nombre + N\u00b0 Contrato
        if (empId) {
            const queries = [];
            if (rutsNorm.length > 0 || nombresNorm.length > 0) {
                let q = supabase.from('v2_asignaciones').select('id,id_cama').is('fecha_checkout', null).eq('empresa_id', empId);
                let orFiltros = [];
                if (rutsNorm.length > 0)    orFiltros.push(`rut_huesped.in.(${rutsNorm.join(',')})`);
                if (nombresNorm.length > 0) orFiltros.push(`nombre_huesped.in.(${nombresNorm.map(n=>`"${n}"`).join(',')})`);
                queries.push(q.or(orFiltros.join(',')));
            }
            if (contratos.length > 0) {
                queries.push(
                    supabase.from('v2_asignaciones')
                        .select('id,id_cama')
                        .is('fecha_checkout', null)
                        .in('numero_contrato', contratos)
                );
            }
            const results = await Promise.all(queries);
            const asigMap = {};
            results.flatMap(r => r.data || []).forEach(a => { asigMap[a.id] = a; });
            const dedupAsigs = Object.values(asigMap);
            asigIds = dedupAsigs.map(a => a.id);
            camaIds = [...new Set(dedupAsigs.map(a => a.id_cama).filter(Boolean))];
            console.log(`[BorrarLista] ${asigIds.length} asignaciones / ${camaIds.length} camas`);
        }

        // PASO 3: Liberar camas
        setStep(`Liberando ${camaIds.length} camas\u2026`, 45);
        if(camaIds.length) {
            for(let i = 0; i < camaIds.length; i += 50) {
                await supabase.from('v2_camas')
                    .update({ estado: 'Disponible' })
                    .in('id_cama', camaIds.slice(i, i + 50))
                    .neq('estado', 'Deshabilitada');
            }
        }

        // PASO 3.5: Limpiar v2_camas_perdidas de las habitaciones liberadas
        setStep('Limpiando camas perdidas\u2026', 55);
        await _limpiarCamasPerdidas(camaIds);

        // PASO 4: Eliminar asignaciones
        setStep(`Borrando ${asigIds.length} asignaciones\u2026`, 65);
        if(asigIds.length) {
            for(let i = 0; i < asigIds.length; i += 50) {
                await supabase.from('v2_asignaciones')
                    .delete()
                    .in('id', asigIds.slice(i, i + 50));
            }
        }

        // PASO 5: Eliminar solicitudes de B2B
        setStep('Eliminando solicitudes\u2026', 85);
        const {error} = await supabase.from('v2_solicitudes_b2b').delete().in('id', ids);
        if(error) throw new Error(error.message);

        setStep('\u2705 Lista borrada', 100);
        await new Promise(r => setTimeout(r, 700));
        overlay.remove();
        toast(
            `\u2705 Lista de "${empresa}" borrada \u00b7 ${asigIds.length} checkout \u00b7 ${camaIds.length} camas liberadas`,
            'success'
        );
        window._renderV2Solicitudes?.();
        refreshBadge();
    } catch(e) {
        overlay.remove();
        alert('\u274c Error al borrar lista:\n'+e.message);
    }
};

"""

with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

total = len(lines)
print(f'Total lines before: {total}')
print(f'Replacing lines {START_LINE}-{END_LINE}')

# Lines are 1-indexed; slice is 0-indexed
before = lines[:START_LINE - 1]
after  = lines[END_LINE:]  # lines after END_LINE (END_LINE is inclusive, so skip it)

new_lines = before + [clean_code] + after

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

with open(filepath, 'r', encoding='utf-8') as f:
    result = f.readlines()

print(f'Total lines after: {len(result)}')
print('DONE - repair_v2_solicitudes.py completed successfully')
