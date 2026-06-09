/**
 * v2-cama3.js — Gestión de Cama 3 por Habitación
 * Solo supervisores. Habilita/deshabilita la cama 3 por habitación.
 * Estado 'Deshabilitada' = excluida de todos los conteos y reportes.
 */
let _sb = null;
async function getSb() {
    if (!_sb) { const m = await import('../../supabaseClient.js'); _sb = m.supabase; }
    return _sb;
}

export async function renderV2Cama3(container) {
    container.innerHTML = `
    <div style="padding:20px;max-width:1100px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">🛏️</div>
        <div>
          <h1 style="font-size:22px;font-weight:800;color:var(--text-primary);margin:0">Gestión Cama 3</h1>
          <p style="font-size:13px;color:var(--text-secondary);margin:0">Habilita o deshabilita la 3ra cama por habitación · Solo supervisores</p>
        </div>
      </div>

      <!-- Info banner -->
      <div style="background:#fffbeb;border:1.5px solid #fde047;border-radius:12px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#854d0e">
        <strong>⚠️ Importante:</strong> Las camas <strong>Deshabilitadas</strong> se excluyen de Dashboard, Historial y todos los reportes. 
        Úsalo para habitaciones que físicamente aún no tienen instalada la 3ra cama.
      </div>

      <!-- Filtros -->
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <select id="c3-filtro-pab" style="padding:9px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;font-weight:600;outline:none">
          <option value="">🏢 Todos los pabellones</option>
        </select>
        <select id="c3-filtro-estado" style="padding:9px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;font-weight:600;outline:none">
          <option value="">Todos los estados</option>
          <option value="Disponible">🟢 Habilitadas</option>
          <option value="Deshabilitada">🔴 Deshabilitadas</option>
        </select>
        <button id="btn-c3-todos-habilitar" style="background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:10px;padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer">
          ✅ Habilitar todas visibles
        </button>
        <button id="btn-c3-todos-deshabilitar" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:10px;padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer">
          🚫 Deshabilitar todas visibles
        </button>
      </div>

      <!-- KPIs -->
      <div id="c3-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px"></div>

      <!-- Tabla -->
      <div id="c3-tabla" style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando...</div>
      </div>
    </div>`;

    await cargarCamas3(container);
}

let _allCamas3 = [];

async function fetchAllCamas3(sb) {
    // Query simple sin joins anidados (evita errores en iOS/Safari)
    const PAGE = 1000;
    let from = 0, camas = [];
    while (true) {
        const { data, error } = await sb
            .from('v2_camas')
            .select('id_cama, habitacion_id, numero_cama, estado')
            .eq('numero_cama', 3)
            .order('id_cama')
            .range(from, from + PAGE - 1);
        if (error) throw error;
        camas = camas.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
    }

    // Traer info de habitaciones
    const habIds = [...new Set(camas.map(c => c.habitacion_id))];
    const habs = {};
    for (let i = 0; i < habIds.length; i += 500) {
        const { data } = await sb
            .from('v2_habitaciones')
            .select('id_custom, numero_hab, pabellon_id')
            .in('id_custom', habIds.slice(i, i + 500));
        (data || []).forEach(h => { habs[h.id_custom] = h; });
    }

    // Traer info de pabellones
    const pabIds = [...new Set(Object.values(habs).map(h => h.pabellon_id).filter(Boolean))];
    const pabs = {};
    if (pabIds.length) {
        const { data } = await sb
            .from('v2_pabellones')
            .select('id, nombre, edificio_id')
            .in('id', pabIds);
        (data || []).forEach(p => { pabs[p.id] = p; });
    }

    // Traer edificios
    const edifIds = [...new Set(Object.values(pabs).map(p => p.edificio_id).filter(Boolean))];
    const edifs = {};
    if (edifIds.length) {
        const { data } = await sb
            .from('v2_edificios')
            .select('id, nombre')
            .in('id', edifIds);
        (data || []).forEach(e => { edifs[e.id] = e; });
    }

    // Unir todo en JavaScript
    return camas.map(c => {
        const h = habs[c.habitacion_id] || {};
        const p = pabs[h.pabellon_id]   || {};
        const e = edifs[p.edificio_id]  || {};
        return {
            id_cama:     c.id_cama,
            habitacion:  c.habitacion_id,
            numero_hab:  h.numero_hab || '?',
            pabellon:    p.nombre     || '?',
            pabellon_id: h.pabellon_id || '',
            edificio:    e.nombre     || '?',
            estado:      c.estado,
        };
    });
}

async function cargarCamas3(container) {
    const sb = await getSb();
    document.getElementById('c3-tabla').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando todas las habitaciones…</div>`;
    try {
        _allCamas3 = await fetchAllCamas3(sb);
    } catch(e) {
        document.getElementById('c3-tabla').innerHTML = `<div style="color:#ef4444;padding:20px">❌ ${e.message}</div>`;
        return;
    }

    // Llenar selector de pabellones
    const pabsArr = [...new Set(_allCamas3.map(c => c.pabellon))].sort();
    const selPab = document.getElementById('c3-filtro-pab');
    pabsArr.forEach(p => {
        const o = document.createElement('option'); o.value = p; o.textContent = `🏢 ${p}`;
        selPab.appendChild(o);
    });

    // Listeners
    selPab.addEventListener('change', () => renderTabla());
    document.getElementById('c3-filtro-estado').addEventListener('change', () => renderTabla());
    document.getElementById('btn-c3-todos-habilitar').addEventListener('click', () => toggleVisibles('Disponible'));
    document.getElementById('btn-c3-todos-deshabilitar').addEventListener('click', () => toggleVisibles('Deshabilitada'));

    renderTabla();
}

function getVisible() {
    const pab    = document.getElementById('c3-filtro-pab')?.value || '';
    const estado = document.getElementById('c3-filtro-estado')?.value || '';
    return _allCamas3.filter(c =>
        (!pab    || c.pabellon === pab) &&
        (!estado || c.estado   === estado)
    );
}

function renderKPIs() {
    const visible  = getVisible();
    document.getElementById('c3-kpis').innerHTML = [
        kpi('🛏️', 'Camas 3 totales',      _allCamas3.length,   '#6366f1'),
        kpi('✅',  'Habilitadas',           _allCamas3.filter(c=>c.estado!=='Deshabilitada').length, '#10b981'),
        kpi('🚫',  'Deshabilitadas',        _allCamas3.filter(c=>c.estado==='Deshabilitada').length, '#ef4444'),
        kpi('👁️',  'Visibles en filtro',   visible.length,      '#f59e0b'),
    ].join('');
}

function renderTabla() {
    const visible  = getVisible();
    const habilitadas    = visible.filter(c => c.estado !== 'Deshabilitada').length;
    const deshabilitadas = visible.filter(c => c.estado === 'Deshabilitada').length;

    renderKPIs();

    if (!visible.length) {
        document.getElementById('c3-tabla').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin resultados para el filtro seleccionado</div>`;
        return;
    }

    document.getElementById('c3-tabla').innerHTML = `
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:14px;font-weight:800;color:var(--text-primary)">🛏️ Cama 3 por Habitación</span>
      <span style="font-size:12px;color:var(--text-muted)">${visible.length} habitaciones · ${habilitadas} ✅ · ${deshabilitadas} 🚫</span>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:550px">
        <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
          ${['Edificio','Pabellón','N° Hab','ID Cama','Estado','Acción'].map(h=>
            `<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`
          ).join('')}
        </tr></thead>
        <tbody>
        ${visible.map((c,i) => {
            const activa  = c.estado !== 'Deshabilitada';
            const estadoColor = activa ? '#10b981' : '#ef4444';
            const estadoLabel = activa ? '✅ Habilitada' : '🚫 Deshabilitada';
            return `<tr style="border-bottom:1px solid var(--border);background:${i%2?'var(--bg)':'transparent'}">
              <td style="padding:10px 14px;font-size:12px;color:var(--text-secondary)">${c.edificio}</td>
              <td style="padding:10px 14px;font-size:12px;color:var(--text-secondary)">${c.pabellon}</td>
              <td style="padding:10px 14px;font-size:14px;font-weight:800;color:var(--text-primary)">${c.numero_hab}</td>
              <td style="padding:10px 14px;font-size:11px;font-family:monospace;color:#6366f1">${c.id_cama}</td>
              <td style="padding:10px 14px">
                <span style="background:${estadoColor}22;color:${estadoColor};font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px">${estadoLabel}</span>
              </td>
              <td style="padding:10px 14px">
                <button data-id="${c.id_cama}" data-action="${activa?'deshabilitar':'habilitar'}"
                  style="background:${activa?'#fee2e2':'#dcfce7'};color:${activa?'#c53030':'#15803d'};border:1.5px solid ${activa?'#fca5a5':'#86efac'};border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer">
                  ${activa ? '🚫 Deshabilitar' : '✅ Habilitar'}
                </button>
              </td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;

    // Event delegation para botones
    document.getElementById('c3-tabla').addEventListener('click', async e => {
        const btn = e.target.closest('button[data-id]');
        if (!btn) return;
        const id     = btn.dataset.id;
        const action = btn.dataset.action;
        await toggleCama(id, action === 'habilitar' ? 'Disponible' : 'Deshabilitada');
    });
}

async function toggleCama(id_cama, nuevoEstado) {
    const btn = document.querySelector(`button[data-id="${id_cama}"]`);
    const c = _allCamas3.find(x => x.id_cama === id_cama);
    if (!c) return;

    // Actualización Optimista del UI
    const estadoAnterior = c.estado;
    c.estado = nuevoEstado;
    const activa = nuevoEstado !== 'Deshabilitada';
    
    if (btn) {
        btn.dataset.action = activa ? 'deshabilitar' : 'habilitar';
        btn.style.background = activa ? '#fee2e2' : '#dcfce7';
        btn.style.color = activa ? '#c53030' : '#15803d';
        btn.style.borderColor = activa ? '#fca5a5' : '#86efac';
        btn.innerHTML = activa ? '🚫 Deshabilitar' : '✅ Habilitar';
        
        const tr = btn.closest('tr');
        if (tr) {
            const span = tr.querySelector('td:nth-child(5) span');
            if (span) {
                const estadoColor = activa ? '#10b981' : '#ef4444';
                span.style.background = `${estadoColor}22`;
                span.style.color = estadoColor;
                span.innerHTML = activa ? '✅ Habilitada' : '🚫 Deshabilitada';
            }
        }
    }
    renderKPIs();

    // Guardado en background
    const sb = await getSb();
    const { error } = await sb.from('v2_camas').update({ estado: nuevoEstado }).eq('id_cama', id_cama);
    
    if (error) { 
        alert('Error: ' + error.message); 
        c.estado = estadoAnterior; 
        renderTabla(); // rollback 
    }
}

async function toggleVisibles(nuevoEstado) {
    const visible = getVisible();
    const aActualizar = visible.filter(c => c.estado !== nuevoEstado);
    if (!aActualizar.length) return;

    const accion = nuevoEstado === 'Disponible' ? 'habilitar' : 'deshabilitar';
    if (!confirm(`¿${accion.charAt(0).toUpperCase()+accion.slice(1)} ${aActualizar.length} camas?`)) return;

    const sb = await getSb();
    const ids = aActualizar.map(c => c.id_cama);

    // Por lotes de 100
    for (let i = 0; i < ids.length; i += 100) {
        await sb.from('v2_camas').update({ estado: nuevoEstado }).in('id_cama', ids.slice(i, i+100));
    }

    aActualizar.forEach(c => { c.estado = nuevoEstado; });
    renderTabla();
}

function kpi(icon, label, value, color) {
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px;display:flex;align-items:center;gap:10px">
      <div style="width:38px;height:38px;border-radius:10px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:16px">${icon}</div>
      <div><div style="font-size:20px;font-weight:900;color:${color};line-height:1">${value.toLocaleString('es-CL')}</div>
      <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-top:2px">${label}</div></div>
    </div>`;
}
