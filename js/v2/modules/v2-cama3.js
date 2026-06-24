/**
 * v2-cama3.js — Gestión de Cama 3 por Habitación
 * Solo supervisores. Habilita/deshabilita la cama 3 por habitación.
 * Estado 'Deshabilitada' = excluida de todos los conteos y reportes.
 *
 * v2: Botón Guardar explícito + detección REF 220 por prefijo.
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

      <!-- Botón Guardar flotante -->
      <div id="c3-save-bar" style="display:none;position:sticky;top:0;z-index:100;background:linear-gradient(135deg,#1e40af,#1d4ed8);border-radius:12px;padding:12px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 4px 20px rgba(30,64,175,.4)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">💾</span>
          <div>
            <div style="font-size:13px;font-weight:800;color:white" id="c3-save-count">0 cambios pendientes</div>
            <div style="font-size:11px;color:#93c5fd">Presiona Guardar para confirmar en la base de datos</div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button id="btn-c3-descartar" style="background:rgba(255,255,255,.15);color:white;border:1.5px solid rgba(255,255,255,.3);border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer">
            ↩️ Descartar
          </button>
          <button id="btn-c3-guardar" style="background:white;color:#1e40af;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:800;cursor:pointer">
            💾 Guardar cambios
          </button>
        </div>
      </div>

      <!-- Tabla -->
      <div id="c3-tabla" style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando...</div>
      </div>
    </div>`;

    await cargarCamas3(container);
}

let _allCamas3  = [];
let _pendientes = new Map(); // id_cama → nuevoEstado

async function fetchAllCamas3(sb) {
    // Query simple sin joins anidados
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

    // Traer info de habitaciones (por lotes de 500)
    const habIds = [...new Set(camas.map(c => c.habitacion_id).filter(Boolean))];
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

    // Unir — con fallback por prefijo de id_cama para REF 220
    return camas.map(c => {
        const h = habs[c.habitacion_id] || {};
        const p = pabs[h.pabellon_id]   || {};
        const e = edifs[p.edificio_id]  || {};

        // Fallback: si no hay datos del join, detectar por prefijo del id_cama
        const idStr = String(c.id_cama || '');
        const isREF220 = idStr.toUpperCase().startsWith('R-220') || idStr.toUpperCase().startsWith('R220');
        const isCOPC   = idStr.toUpperCase().startsWith('COPC');

        let edificio  = e.nombre  || (isREF220 ? 'REF 220' : isCOPC ? 'COPC' : '?');
        let pabellon  = p.nombre  || '?';
        let numero_hab = h.numero_hab || '?';

        // Para REF 220: extraer numero_hab del id_cama si el join falló
        if (isREF220 && numero_hab === '?') {
            const match = idStr.match(/R-?220[-_]?0*(\d+)[-_]?C3?$/i);
            if (match) numero_hab = match[1];
            pabellon = 'REF 220';
        }

        // Extraer pabellón de numero_hab si el join falló (formato PPFF → P-PP)
        if (pabellon === '?' && numero_hab !== '?') {
            const n = parseInt(numero_hab);
            if (!isNaN(n) && n >= 1000 && n <= 9999) {
                const pNum = Math.floor(n / 100);
                pabellon = `P-${pNum}`;
            }
        }

        return {
            id_cama:     c.id_cama,
            habitacion:  c.habitacion_id,
            numero_hab,
            pabellon,
            pabellon_id: h.pabellon_id || '',
            edificio,
            estado:      c.estado,
        };
    });
}

async function cargarCamas3(container) {
    const sb = await getSb();
    document.getElementById('c3-tabla').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando todas las habitaciones…</div>`;
    try {
        _allCamas3  = await fetchAllCamas3(sb);
        _pendientes = new Map();
    } catch(e) {
        document.getElementById('c3-tabla').innerHTML = `<div style="color:#ef4444;padding:20px">❌ ${e.message}</div>`;
        return;
    }

    // Llenar selector de pabellones (ordenado)
    const pabsArr = [...new Set(_allCamas3.map(c => c.pabellon))].filter(p => p !== '?').sort((a,b) => {
        // Ordenar numérico: P-1 < P-2 < ... < P-8 < REF 220
        const na = parseInt((a.match(/\d+/) || ['999'])[0]);
        const nb = parseInt((b.match(/\d+/) || ['999'])[0]);
        return na - nb || a.localeCompare(b);
    });
    const selPab = document.getElementById('c3-filtro-pab');
    pabsArr.forEach(p => {
        const o = document.createElement('option'); o.value = p; o.textContent = `🏢 ${p}`;
        selPab.appendChild(o);
    });

    // Listeners filtros
    selPab.addEventListener('change', () => renderTabla());
    document.getElementById('c3-filtro-estado').addEventListener('change', () => renderTabla());
    document.getElementById('btn-c3-todos-habilitar').addEventListener('click', () => marcarVisibles('Disponible'));
    document.getElementById('btn-c3-todos-deshabilitar').addEventListener('click', () => marcarVisibles('Deshabilitada'));

    // Listeners barra de guardado
    document.getElementById('btn-c3-guardar').addEventListener('click', () => guardarCambios());
    document.getElementById('btn-c3-descartar').addEventListener('click', () => descartarCambios());

    renderTabla();
}

function getVisible() {
    const pab    = document.getElementById('c3-filtro-pab')?.value || '';
    const estado = document.getElementById('c3-filtro-estado')?.value || '';
    return _allCamas3.filter(c => {
        const estadoEfectivo = _pendientes.has(c.id_cama) ? _pendientes.get(c.id_cama) : c.estado;
        return (!pab    || c.pabellon === pab) &&
               (!estado || estadoEfectivo === estado);
    });
}

// ── Estado efectivo (con pendientes superpuestos) ─────────────────────────────
function estadoEfectivo(c) {
    return _pendientes.has(c.id_cama) ? _pendientes.get(c.id_cama) : (c.estado || 'Disponible');
}

function updateSaveBar() {
    const n = _pendientes.size;
    const bar = document.getElementById('c3-save-bar');
    if (!bar) return;
    if (n === 0) {
        bar.style.display = 'none';
    } else {
        bar.style.display = 'flex';
        const lbl = document.getElementById('c3-save-count');
        if (lbl) lbl.textContent = `${n} cambio${n !== 1 ? 's' : ''} pendiente${n !== 1 ? 's' : ''}`;
    }
}

function renderKPIs() {
    const habilitadas    = _allCamas3.filter(c => estadoEfectivo(c) !== 'Deshabilitada').length;
    const deshabilitadas = _allCamas3.filter(c => estadoEfectivo(c) === 'Deshabilitada').length;
    const visible        = getVisible();
    document.getElementById('c3-kpis').innerHTML = [
        kpi('🛏️', 'Camas 3 totales',     _allCamas3.length,  '#6366f1'),
        kpi('✅',  'Habilitadas',          habilitadas,         '#10b981'),
        kpi('🚫',  'Deshabilitadas',       deshabilitadas,      '#ef4444'),
        kpi('👁️',  'Visibles en filtro',  visible.length,      '#f59e0b'),
        _pendientes.size > 0 ? kpi('💾', 'Sin guardar', _pendientes.size, '#3b82f6') : '',
    ].join('');
}

function renderTabla() {
    const visible       = getVisible();
    const habilitadas   = visible.filter(c => estadoEfectivo(c) !== 'Deshabilitada').length;
    const deshabilitadas = visible.filter(c => estadoEfectivo(c) === 'Deshabilitada').length;

    renderKPIs();
    updateSaveBar();

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
            const est     = estadoEfectivo(c);
            const activa  = est !== 'Deshabilitada';
            const pendiente = _pendientes.has(c.id_cama);
            const estadoColor = activa ? '#10b981' : '#ef4444';
            const estadoLabel = activa ? '✅ Habilitada' : '🚫 Deshabilitada';
            const pendBadge   = pendiente ? `<span style="font-size:9px;background:#3b82f622;color:#3b82f6;border:1px solid #3b82f6;padding:1px 5px;border-radius:99px;margin-left:4px">sin guardar</span>` : '';
            return `<tr style="border-bottom:1px solid var(--border);background:${pendiente ? 'rgba(59,130,246,.04)' : i%2?'var(--bg)':'transparent'}">
              <td style="padding:10px 14px;font-size:12px;color:var(--text-secondary)">${c.edificio}</td>
              <td style="padding:10px 14px;font-size:12px;color:var(--text-secondary)">${c.pabellon}</td>
              <td style="padding:10px 14px;font-size:14px;font-weight:800;color:var(--text-primary)">${c.numero_hab}</td>
              <td style="padding:10px 14px;font-size:11px;font-family:monospace;color:#6366f1">${c.id_cama}</td>
              <td style="padding:10px 14px">
                <span style="background:${estadoColor}22;color:${estadoColor};font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px">${estadoLabel}</span>
                ${pendBadge}
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

    // Event delegation
    document.getElementById('c3-tabla').addEventListener('click', e => {
        const btn = e.target.closest('button[data-id]');
        if (!btn) return;
        const id     = btn.dataset.id;
        const action = btn.dataset.action;
        marcarCama(id, action === 'habilitar' ? 'Disponible' : 'Deshabilitada');
    });
}

// ── Marcar cambio local (sin guardar en DB todavía) ──────────────────────────
function marcarCama(id_cama, nuevoEstado) {
    const c = _allCamas3.find(x => x.id_cama === id_cama);
    if (!c) return;

    if (nuevoEstado === c.estado) {
        // Volvió al estado original → quitar de pendientes
        _pendientes.delete(id_cama);
    } else {
        _pendientes.set(id_cama, nuevoEstado);
    }
    renderTabla();
}

// ── Marcar todas las visibles ─────────────────────────────────────────────────
function marcarVisibles(nuevoEstado) {
    const visible    = getVisible();
    const aMarcar    = visible.filter(c => estadoEfectivo(c) !== nuevoEstado);
    if (!aMarcar.length) return;

    const accion = nuevoEstado === 'Disponible' ? 'habilitar' : 'deshabilitar';
    if (!confirm(`¿${accion.charAt(0).toUpperCase()+accion.slice(1)} ${aMarcar.length} camas visibles?\n\nDeberás presionar "Guardar cambios" para confirmar.`)) return;

    aMarcar.forEach(c => {
        if (nuevoEstado === c.estado) _pendientes.delete(c.id_cama);
        else _pendientes.set(c.id_cama, nuevoEstado);
    });
    renderTabla();
}

// ── Guardar todos los cambios pendientes en Supabase ─────────────────────────
async function guardarCambios() {
    if (_pendientes.size === 0) return;

    const btn = document.getElementById('btn-c3-guardar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando…'; }

    const sb = await getSb();
    let guardados = 0;
    let errores   = [];

    // Agrupar por nuevo estado para batch más eficiente
    const grupos = {};
    _pendientes.forEach((est, id) => {
        if (!grupos[est]) grupos[est] = [];
        grupos[est].push(id);
    });

    for (const [nuevoEstado, ids] of Object.entries(grupos)) {
        // Lotes de 100
        for (let i = 0; i < ids.length; i += 100) {
            const lote = ids.slice(i, i + 100);
            const { error } = await sb.from('v2_camas')
                .update({ estado: nuevoEstado })
                .in('id_cama', lote);
            if (error) {
                errores.push(`Lote ${i}-${i+100}: ${error.message}`);
            } else {
                // Confirmar en memoria
                lote.forEach(id => {
                    const c = _allCamas3.find(x => x.id_cama === id);
                    if (c) c.estado = nuevoEstado;
                    guardados++;
                });
            }
        }
    }

    if (errores.length) {
        alert(`⚠️ Algunos cambios NO se guardaron:\n${errores.join('\n')}\n\nLos cambios sin guardar siguen pendientes.`);
        // Quitar solo los que SÍ se guardaron de pendientes
        _pendientes.forEach((est, id) => {
            const c = _allCamas3.find(x => x.id_cama === id);
            if (c && c.estado === est) _pendientes.delete(id);
        });
    } else {
        _pendientes.clear();
        // Invalidar caché de infraestructura
        window._v2iInvalidarCache?.();
    }

    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar cambios'; }
    renderTabla();

    if (!errores.length && guardados > 0) {
        _mostrarToast(`✅ ${guardados} cama${guardados!==1?'s':''} guardada${guardados!==1?'s':''} correctamente`);
    }
}

// ── Descartar cambios pendientes ──────────────────────────────────────────────
function descartarCambios() {
    if (_pendientes.size === 0) return;
    if (!confirm(`¿Descartar ${_pendientes.size} cambio(s) sin guardar?`)) return;
    _pendientes.clear();
    renderTabla();
}

function _mostrarToast(msg) {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#10b981;color:white;
                       padding:12px 20px;border-radius:12px;font-size:13px;font-weight:700;z-index:9999;
                       box-shadow:0 4px 20px rgba(16,185,129,.4);pointer-events:none;animation:fadeIn .2s ease`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

function kpi(icon, label, value, color) {
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px;display:flex;align-items:center;gap:10px">
      <div style="width:38px;height:38px;border-radius:10px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:16px">${icon}</div>
      <div><div style="font-size:20px;font-weight:900;color:${color};line-height:1">${value.toLocaleString('es-CL')}</div>
      <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-top:2px">${label}</div></div>
    </div>`;
}
