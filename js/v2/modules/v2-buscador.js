/**
 * v2-buscador.js — Búsqueda de Huéspedes V2
 * Busca en v2_asignaciones por RUT, nombre o número de habitación.
 */
import { getAsignacionesActivas } from '../v2-service.js';
import { supabase } from '../../supabaseClient.js';

export async function renderV2Buscador(container) {
    container.innerHTML = `<div style="padding:20px;max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">🔍</div>
        <div>
          <h1 style="font-size:22px;font-weight:800;color:var(--text-primary);margin:0">Buscar Huésped V2</h1>
          <p style="font-size:13px;color:var(--text-secondary);margin:0">Busca estadías activas por RUT, nombre completo o N° Habitación</p>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
        <input id="buscador-q" type="text" placeholder="🔍 RUT, nombre o N° Habitación…"
          style="flex:1;min-width:220px;padding:14px 18px;border-radius:12px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:15px;outline:none"
          onkeydown="if(event.key==='Enter') document.getElementById('btn-buscar').click()">
        <button id="btn-buscar" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border:none;border-radius:12px;padding:14px 28px;font-size:14px;font-weight:700;cursor:pointer">Buscar</button>
        <button id="btn-ver-todos" style="background:var(--bg-card);color:var(--text-primary);border:1.5px solid var(--border);border-radius:12px;padding:14px 20px;font-size:14px;font-weight:600;cursor:pointer">Ver todos</button>
      </div>

      <div id="buscador-resultados">
        <div style="text-align:center;padding:60px;color:var(--text-muted)">
          <div style="font-size:48px;margin-bottom:12px">🔍</div>
          <div style="font-size:15px">Ingresa un RUT, nombre o número de habitación</div>
        </div>
      </div>
    </div>`;

    document.getElementById('btn-buscar')?.addEventListener('click', () => {
        const q = document.getElementById('buscador-q')?.value?.trim();
        buscar(q);
    });
    document.getElementById('btn-ver-todos')?.addEventListener('click', () => {
        document.getElementById('buscador-q').value = '';
        buscar(null);
    });
}

// Detecta si el query parece un número de habitación (solo dígitos, 3-6 chars)
function esNumeroHab(q) {
    return q && /^\d{3,6}$/.test(q.trim());
}

async function buscarPorHabitacion(numHab) {
    // 1. Obtener habitación
    const { data: habs } = await supabase
        .from('v2_habitaciones').select('id_custom,numero_hab').ilike('numero_hab', numHab);
    if (!habs?.length) return [];

    // 2. Obtener camas de esas habitaciones
    const habIds = habs.map(h => h.id_custom);
    const habMap  = {};
    habs.forEach(h => habMap[h.id_custom] = h.numero_hab);

    const { data: camas } = await supabase
        .from('v2_camas').select('id_cama,habitacion_id').in('habitacion_id', habIds);
    if (!camas?.length) return [];

    const camaIds  = camas.map(c => c.id_cama);
    const camaHabMap = {};
    camas.forEach(c => camaHabMap[c.id_cama] = habMap[c.habitacion_id]);

    // 3. Asignaciones activas de esas camas
    const { data, error } = await supabase
        .from('v2_asignaciones')
        .select('id,rut_huesped,nombre_huesped,id_cama,fecha_checkin,fecha_salida_programada,estado_asignacion,v2_empresas(nombre,turno)')
        .is('fecha_checkout', null)
        .in('estado_asignacion', ['activa', 'pre_asignado'])
        .in('id_cama', camaIds)
        .order('fecha_checkin', { ascending: false });
    if (error) throw new Error(error.message);

    return (data || []).map(a => ({ ...a, numero_hab: camaHabMap[a.id_cama] || numHab }));
}

async function buscar(q) {
    const el = document.getElementById('buscador-resultados');
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">Buscando…</div>`;
    try {
        let data = [];

        if (esNumeroHab(q)) {
            // Búsqueda por habitación
            data = await buscarPorHabitacion(q);
        } else {
            // Búsqueda por nombre/RUT — enriquecer con numero_hab
            const rows = await getAsignacionesActivas({ busqueda: q, limit: 100 });
            // Resolver número de hab desde id_cama (formato: PREFIJO + numeroHab + sufijo)
            // Alternativa: buscar habitación por id del prefijo del id_cama
            const camaIds = [...new Set(rows.map(r => r.id_cama))];
            let camaHabMap = {};
            if (camaIds.length) {
                const { data: camas } = await supabase
                    .from('v2_camas').select('id_cama,habitacion_id').in('id_cama', camaIds);
                const habIds = [...new Set((camas||[]).map(c => c.habitacion_id))];
                if (habIds.length) {
                    const { data: habs } = await supabase
                        .from('v2_habitaciones').select('id_custom,numero_hab').in('id_custom', habIds);
                    const habMap = {};
                    (habs||[]).forEach(h => habMap[h.id_custom] = h.numero_hab);
                    (camas||[]).forEach(c => camaHabMap[c.id_cama] = habMap[c.habitacion_id]);
                }
            }
            data = rows.map(a => ({ ...a, numero_hab: camaHabMap[a.id_cama] || '—' }));
        }

        if (!data.length) {
            el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted)">
              <div style="font-size:40px;margin-bottom:12px">🕵️</div>
              <div>${q ? `Sin estadías activas con "${q}"` : 'Sin huéspedes activos en el sistema'}</div>
            </div>`;
            return;
        }

        el.innerHTML = `
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;font-weight:600">${data.length} estadía${data.length>1?'s':''} encontrada${data.length>1?'s':''}</div>
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden;overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;min-width:560px">
              <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
                ${['Huésped','RUT','HAB','Cama','Empresa','Turno','Check-in'].map(h =>
                  `<th style="padding:12px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`
                ).join('')}
              </tr></thead>
              <tbody>
                ${data.map((a, i) => `
                  <tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg)'};transition:background 0.15s" onmouseover="this.style.background='rgba(99,102,241,0.06)'" onmouseout="this.style.background='${i%2===0?'transparent':'var(--bg)'}'">
                    <td style="padding:12px 14px;font-weight:700;font-size:13px;color:var(--text-primary)">${a.nombre_huesped}</td>
                    <td style="padding:12px 14px;font-size:12px;font-family:monospace;color:var(--text-secondary)">${a.rut_huesped}</td>
                    <td style="padding:12px 14px">
                      <span style="background:rgba(16,185,129,0.12);color:#059669;font-weight:800;font-size:13px;padding:3px 10px;border-radius:8px">${a.numero_hab||'—'}</span>
                    </td>
                    <td style="padding:12px 14px">
                      <span style="background:rgba(99,102,241,0.1);color:#6366f1;font-family:monospace;font-weight:700;font-size:11px;padding:3px 8px;border-radius:6px">${a.id_cama}</span>
                    </td>
                    <td style="padding:12px 14px;font-size:13px;color:var(--text-secondary)">${a.v2_empresas?.nombre||'—'}</td>
                    <td style="padding:12px 14px;font-size:12px;color:var(--text-muted)">${a.v2_empresas?.turno||'—'}</td>
                    <td style="padding:12px 14px;font-size:12px;color:var(--text-muted)">${a.fecha_checkin}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
    } catch(e) {
        el.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444">❌ ${e.message}</div>`;
    }
}


