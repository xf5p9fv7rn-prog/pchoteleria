/**
 * v2-censo.js — Censo Administrativo (21→20 de cada mes)
 * Vista cuadrícula: habitaciones × días + resumen de facturación
 */
import { supabase } from '../../supabaseClient.js';

// ── Período activo (21 del mes pasado → 20 del mes actual) ──────────────
function calcularPeriodo(offset = 0) {
    const hoy  = new Date();
    hoy.setMonth(hoy.getMonth() + offset);
    const y    = hoy.getFullYear();
    const m    = hoy.getMonth(); // 0-based
    // Si día >= 21: período actual es 21/m → 20/m+1
    // Si día <= 20: período es 21/m-1 → 20/m
    const esSegundaMitad = hoy.getDate() >= 21;
    const ini = new Date(y, esSegundaMitad ? m : m - 1, 21);
    const fin = new Date(y, esSegundaMitad ? m + 1 : m,  20);
    return { ini, fin,
        label: `${fmtD(ini)} → ${fmtD(fin)}`,
        dias:  getDias(ini, fin)
    };
}

// ── AUTO-SNAPSHOT: guarda ocupación real en v2_censo_registros ─────────────
// Se ejecuta una vez por período (guard en localStorage). Fire & forget.
async function _autoSnapshotPeriodo() {
    if (!_periodo) return;
    const guardKey = `censo_snap_${fmtISO(_periodo.ini)}`;
    if (localStorage.getItem(guardKey)) return; // ya guardado este período

    try {
        const pIni = fmtISO(_periodo.ini);
        const pFin = fmtISO(_periodo.fin);

        // Traer asignaciones activas del período
        const { data: asigs, error } = await supabase.from('v2_asignaciones')
            .select('id_cama,fecha_checkin,fecha_salida_programada,fecha_checkout,v2_camas(numero_cama,habitacion_id)')
            .lte('fecha_checkin', pFin)
            .or(`fecha_checkout.is.null,fecha_checkout.gte.${pIni}`)
            .not('estado_asignacion', 'eq', 'sin_checkout');

        if (error || !asigs?.length) return;

        // Construir mapa: habitacion_id + fecha → estado (dia / noche)
        const registros = [];
        const seen = new Set();

        asigs.forEach(a => {
            const habId  = a.v2_camas?.habitacion_id;
            const numCama = a.v2_camas?.numero_cama; // 1 = dia, 2 = noche
            if (!habId) return;
            const estado = numCama === 2 ? 'noche' : 'dia';

            // Días solapados con el período
            const desde = a.fecha_checkin > pIni ? a.fecha_checkin : pIni;
            const salida = a.fecha_salida_programada || pFin;
            const chk    = a.fecha_checkout;
            const real   = (chk && chk < salida) ? chk : salida;
            const hasta  = real < pFin ? real : pFin;
            if (desde > hasta) return;

            let cur = new Date(desde);
            const end = new Date(hasta);
            while (cur <= end) {
                const fecha = fmtISO(cur);
                const key   = `${habId}|${fecha}|${estado}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    registros.push({ habitacion_id: habId, fecha, estado, periodo_ini: pIni });
                }
                cur.setDate(cur.getDate() + 1);
            }
        });

        if (!registros.length) return;

        // Upsert en lotes de 500 para no sobrepasar límites
        const BATCH = 500;
        for (let i = 0; i < registros.length; i += BATCH) {
            await supabase.from('v2_censo_registros')
                .upsert(registros.slice(i, i + BATCH), { onConflict: 'habitacion_id,fecha' });
        }

        // Marcar como guardado para este período
        localStorage.setItem(guardKey, new Date().toISOString());
        console.log(`[Censo] Snapshot guardado: ${registros.length} registros · período ${pIni}`);

    } catch (e) {
        console.warn('[Censo] Auto-snapshot falló (silencioso):', e.message);
    }
}

function getDias(ini, fin) {
    const dias = []; let d = new Date(ini);
    while (d <= fin) { dias.push(new Date(d)); d.setDate(d.getDate() + 1); }
    return dias;
}
function fmtD(d) { return d.toLocaleDateString('es-CL', { day:'2-digit', month:'short', year:'numeric' }); }
function fmtISO(d) { return d.toLocaleDateString('en-CA'); }

const ESTADO_CONF = {
    sin_ocupar: { lbl: '—',  bg: '#f8fafc', c: '#94a3b8' },
    dia:        { lbl: 'D',  bg: '#dbeafe', c: '#1d4ed8' },
    noche:      { lbl: 'N',  bg: '#ede9fe', c: '#7c3aed' },
    '2_dia':    { lbl: '2D', bg: '#fef3c7', c: '#d97706' },
    '2_noche':  { lbl: '2N', bg: '#fee2e2', c: '#dc2626' },
    '3_dia':    { lbl: '3D', bg: '#cffafe', c: '#0e7490' },  // teal — cama 3 día
    '3_noche':  { lbl: '3N', bg: '#ede9fe', c: '#4a1d96' },  // violeta oscuro — cama 3 noche
};

let _periodoOffset = 0;
let _periodo       = null;
let _edificioFil   = '';
let _pabellonFil   = '';
let _edificios     = [];
let _pabellones    = [];
let _activeTab     = 'grid';

export async function renderV2Censo(container) {
    _periodo = calcularPeriodo(_periodoOffset);
    container.innerHTML = `
    <div style="padding:20px;max-width:1400px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">📅</div>
        <div>
          <h1 style="font-size:20px;font-weight:800;color:var(--text-primary);margin:0">Censo Administrativo</h1>
          <p style="font-size:12px;color:var(--text-secondary);margin:0">Registro diario 21→20 · Facturación por empresa</p>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button onclick="window._censoOffset(-1)" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-weight:700">◀</button>
          <span id="censo-period-lbl" style="font-size:13px;font-weight:700;color:var(--text-primary);white-space:nowrap">${_periodo.label}</span>
          <button onclick="window._censoOffset(1)" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-weight:700">▶</button>
        </div>
      </div>

      <!-- Filtros -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <select id="censo-fil-edif" onchange="window._censoFiltroEdif()" style="padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px">
          <option value="">Todos los edificios</option>
        </select>
        <select id="censo-fil-pab" onchange="window._censoFiltroPab()" style="padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px">
          <option value="">Todos los pabellones</option>
        </select>
        <button onclick="window._censoExportExcel()" style="padding:9px 16px;border-radius:10px;border:none;background:#dcfce7;color:#15803d;font-weight:700;font-size:12px;cursor:pointer">📥 Excel</button>
      </div>

      <!-- Tabs: Facturación, Bajadas e Historial solo para supervisores -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <button id="ctab-grid" onclick="window._censoTab('grid')"
          style="padding:9px 18px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">
          📋 Cuadrícula
        </button>
        ${(['supervisor','superadmin'].includes(window._currentUser?.role)) ? `
        <button id="ctab-billing" onclick="window._censoTab('billing')"
          style="padding:9px 18px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">
          💰 Facturación
        </button>
        <button id="ctab-bajadas" onclick="window._censoTab('bajadas')"
          style="padding:9px 18px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">
          📤 Bajadas
        </button>
        <button id="ctab-historial" onclick="window._censoTab('historial')"
          style="padding:9px 18px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">
          📂 Historial
        </button>
        <button id="btn-guardar-periodo" onclick="window._censoGuardarPeriodo()"
          style="margin-left:auto;padding:9px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:700;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px">
          💾 Guardar Período
        </button>` : ''}
      </div>

      <div id="censo-body" style="overflow-x:auto">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando datos…</div>
      </div>
    </div>`;

    // Cargar edificios para el filtro
    const { data: edifs } = await supabase.from('v2_edificios').select('id,nombre').order('nombre');
    _edificios = edifs || [];
    const selEdif = document.getElementById('censo-fil-edif');
    _edificios.forEach(e => { selEdif.innerHTML += `<option value="${e.id}">${e.nombre}</option>`; });

    // Globals
    window._censoOffset = async (d) => { _periodoOffset += d; _periodo = calcularPeriodo(_periodoOffset);
        document.getElementById('censo-period-lbl').textContent = _periodo.label; await renderTab(); };
    window._censoFiltroEdif = async () => {
        _edificioFil = document.getElementById('censo-fil-edif').value;
        const selPab = document.getElementById('censo-fil-pab');
        selPab.innerHTML = '<option value="">Todos los pabellones</option>';
        _pabellonFil = '';
        if (_edificioFil) {
            const { data: pabs } = await supabase.from('v2_pabellones')
                .select('id,nombre').eq('edificio_id', _edificioFil).order('nombre');
            _pabellones = pabs || [];
            _pabellones.forEach(p => { selPab.innerHTML += `<option value="${p.id}">${p.nombre}</option>`; });
        }
        await renderTab();
    };
    window._censoFiltroPab = async () => { _pabellonFil = document.getElementById('censo-fil-pab').value; await renderTab(); };
    window._censoTab = async (t) => { _activeTab = t; renderTab(); };
    window._censoExportExcel = exportExcel;
    window._censoGuardarPeriodo = censoGuardarPeriodo;

    activarTab('grid');
    await renderTab();
}

function activarTab(t) {
    ['grid','billing','bajadas','historial'].forEach(x => {
        const b = document.getElementById(`ctab-${x}`);
        if (!b) return;
        const on = x === t;
        b.style.background  = on ? '#6366f1' : 'var(--bg-card)';
        b.style.color       = on ? '#fff'    : 'var(--text-secondary)';
        b.style.borderColor = on ? '#6366f1' : 'var(--border)';
    });
}

async function renderTab() {
    activarTab(_activeTab);
    if      (_activeTab === 'grid')    await renderGrid();
    else if (_activeTab === 'billing') {
        if (!['supervisor','superadmin'].includes(window._currentUser?.role)) {
            document.getElementById('censo-body').innerHTML =
                '<div style="text-align:center;padding:40px;color:#ef4444">🔒 Acceso restringido a supervisores</div>';
            return;
        }
        await renderBilling();
    }
    else if (_activeTab === 'bajadas')   await renderBajadas();
    else if (_activeTab === 'historial') {
        if (!['supervisor','superadmin'].includes(window._currentUser?.role)) {
            document.getElementById('censo-body').innerHTML =
                '<div style="text-align:center;padding:40px;color:#ef4444">🔒 Acceso restringido a supervisores</div>';
            return;
        }
        await renderHistorial();
    }
}

// ── GRID: cuadrícula habitaciones × días ───────────────────────────────
async function renderGrid() {
    const body = document.getElementById('censo-body');
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ Cargando…</div>';

    // 🔄 Auto-snapshot: guardar datos de ocupación en Supabase una vez por período
    _autoSnapshotPeriodo(); // fire & forget — no bloquea la UI


    // Habitaciones — paginación completa para traer TODAS (sin límite de 1000)
    async function fetchAllHabs(extraFilter) {
        const PAGE = 900;
        let offset = 0, all = [];
        while (true) {
            let q = supabase.from('v2_habitaciones')
                .select('id_custom,numero_hab,nivel,pabellon_id,v2_pabellones(nombre,edificio_id,v2_edificios(nombre))')
                .range(offset, offset + PAGE - 1);
            if (extraFilter) q = extraFilter(q);
            const { data, error } = await q;
            if (error) break;
            all = all.concat(data || []);
            if (!data || data.length < PAGE) break;
            offset += PAGE;
        }
        return all;
    }

    let filterFn = null;
    if (_pabellonFil) {
        filterFn = q => q.eq('pabellon_id', _pabellonFil);
    } else if (_edificioFil) {
        const { data: pabIds } = await supabase.from('v2_pabellones')
            .select('id').eq('edificio_id', _edificioFil);
        const ids = (pabIds || []).map(p => p.id);
        if (ids.length) filterFn = q => q.in('pabellon_id', ids);
    }

    const rawHabs = await fetchAllHabs(filterFn);

    // Ordenar: R-220 primero, luego el resto; dentro de cada grupo por número natural
    const naturalNum = s => {
        const n = parseInt((s || '').replace(/\D/g, ''), 10);
        return isNaN(n) ? 99999 : n;
    };
    const habList = rawHabs.sort((a, b) => {
        const edifA = a.v2_pabellones?.v2_edificios?.nombre || '';
        const edifB = b.v2_pabellones?.v2_edificios?.nombre || '';
        const isR220A = edifA.toUpperCase().includes('R-220') || edifA.toUpperCase().includes('R220');
        const isR220B = edifB.toUpperCase().includes('R-220') || edifB.toUpperCase().includes('R220');
        if (isR220A && !isR220B) return -1;
        if (!isR220A && isR220B) return 1;
        // Mismo grupo: ordenar por número de habitación natural
        return naturalNum(a.numero_hab) - naturalNum(b.numero_hab);
    });



    // Asignaciones activas en el período para mostrar empresa en el grid
    const { data: asigActivas } = await supabase.from('v2_asignaciones')
        .select('id_cama,numero_contrato,fecha_salida_programada,v2_empresas(nombre,v2_gerencias(nombre)),v2_camas(habitacion_id)')
        .lte('fecha_checkin', fmtISO(_periodo.fin))
        .or(`fecha_checkout.is.null,fecha_checkout.gte.${fmtISO(_periodo.ini)}`);
    // Map: habitacion_id → {empresa, gerencia, contrato, fecha_sal}
    const asigMap = {};
    (asigActivas || []).forEach(a => {
        const hid = a.v2_camas?.habitacion_id;
        if (hid && !asigMap[hid]) asigMap[hid] = {
            emp:      a.v2_empresas?.nombre || '—',
            ger:      a.v2_empresas?.v2_gerencias?.nombre || '—',
            cont:     a.numero_contrato || '—',
            fecha_sal: a.fecha_salida_programada || null
        };
    });

    // Registros censo (incluye periodo dia + noche)
    const { data: regs } = await supabase.from('v2_censo_registros')
        .select('habitacion_id,fecha,estado,periodo')
        .gte('fecha', fmtISO(_periodo.ini))
        .lte('fecha', fmtISO(_periodo.fin));

    // regMap: habitacion_id|fecha|periodo → estado
    const regMap = {};
    (regs || []).forEach(r => {
        const key = r.habitacion_id + '|' + r.fecha + '|' + (r.periodo || 'dia');
        regMap[key] = r.estado;
    });

    const dias = _periodo.dias;

    if (!habList.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin habitaciones para este filtro</div>';
        return;
    }

    const thDias = dias.map(d => {
        const iso = fmtISO(d);
        const n   = d.getDate();
        const hoy = fmtISO(new Date()) === iso;
        return `<th style="min-width:32px;padding:4px 2px;font-size:10px;font-weight:700;color:${hoy?'#6366f1':'#94a3b8'};text-align:center;position:sticky;top:0;background:var(--bg-card)">${n}</th>`;
    }).join('');

    const rows = habList.map(h => {
        const edif = h.v2_pabellones?.v2_edificios?.nombre || '—';
        const pab  = h.v2_pabellones?.nombre || '—';
        const celdas = dias.map(d => {
            const iso = fmtISO(d);
            // Leer ambos períodos para esta habitación en este día
            const estD = regMap[h.id_custom + '|' + iso + '|dia']   || '';
            const estN = regMap[h.id_custom + '|' + iso + '|noche'] || '';
            const cfgD = ESTADO_CONF[estD] || { lbl: '', bg: 'transparent', c: 'transparent' };
            const cfgN = ESTADO_CONF[estN] || { lbl: '', bg: 'transparent', c: 'transparent' };
            const hoyCell = fmtISO(new Date()) === iso;
            return `<td style="padding:2px;text-align:center;${hoyCell ? 'background:#f0f4ff;' : ''}">
              <div style="display:flex;flex-direction:column;gap:1px;align-items:center">
                ${estD ? `<div title="Día: ${estD}" style="width:28px;height:10px;border-radius:3px;background:${cfgD.bg};color:${cfgD.c};font-size:7px;font-weight:800;display:flex;align-items:center;justify-content:center">${cfgD.lbl}</div>` : '<div style="width:28px;height:10px"></div>'}
                ${estN ? `<div title="Noche: ${estN}" style="width:28px;height:10px;border-radius:3px;background:${cfgN.bg};color:${cfgN.c};font-size:7px;font-weight:800;display:flex;align-items:center;justify-content:center">${cfgN.lbl}</div>` : '<div style="width:28px;height:10px"></div>'}
              </div>
            </td>`;
        }).join('');
        const ai = asigMap[h.id_custom];
        return `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg-hover,#f8fafc)'" onmouseout="this.style.background=''">
          <td style="padding:6px 10px;white-space:nowrap;font-size:11px;color:var(--text-muted);position:sticky;left:0;background:var(--bg-card)">${edif}</td>
          <td style="padding:6px 8px;white-space:nowrap;font-size:11px;color:var(--text-muted)">${pab}</td>
          <td style="padding:6px 8px;font-weight:800;font-size:13px;color:var(--text-primary)">${h.numero_hab}</td>
          <td style="padding:6px 8px;font-size:10px;color:#94a3b8;font-family:monospace">${h.nivel || '—'}</td>
          <td style="padding:6px 8px;font-size:11px;font-weight:600;color:#6366f1;white-space:nowrap">${ai?.emp || ''}</td>
          <td style="padding:6px 8px;font-size:10px;color:var(--text-muted);white-space:nowrap">${ai?.ger || ''}</td>
          <td style="padding:6px 8px;font-size:10px;color:#10b981;font-family:monospace">${ai?.cont || ''}</td>
          <td style="padding:6px 8px;font-size:10px;white-space:nowrap;${ai?.fecha_sal ? 'color:#ef4444;font-weight:700' : 'color:#94a3b8'}">
            ${ai?.fecha_sal ? '📅 ' + new Date(ai.fecha_sal + 'T12:00:00').toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'}) : '—'}
          </td>
          ${celdas}
        </tr>`;
    }).join('');

    body.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
        ${habList.length} habitaciones · ${dias.length} días · Período ${_periodo.label}
      </div>
      <div style="font-size:11px;display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:700;color:var(--text-muted)">Referencia:</span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <span style="width:14px;height:10px;border-radius:2px;background:#dbeafe;display:inline-block"></span> D = 1 persona día
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <span style="width:14px;height:10px;border-radius:2px;background:#ede9fe;display:inline-block"></span> N = 1 persona noche
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <span style="width:14px;height:10px;border-radius:2px;background:#fef3c7;display:inline-block"></span> 2D / 2N = 2 personas
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <span style="width:14px;height:10px;border-radius:2px;background:#cffafe;display:inline-block"></span> 3D / 3N = 3 personas
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <span style="width:14px;height:10px;border-radius:2px;background:#f8fafc;border:1px solid #e2e8f0;display:inline-block"></span> — = sin censar
        </span>
      </div>
      <table style="border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--bg-card)">
          <th style="padding:6px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;position:sticky;left:0;background:var(--bg-card)">Edif.</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Pab.</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Hab.</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Piso</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Empresa</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Gerencia</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Contrato</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#ef4444;font-weight:700;text-transform:uppercase;white-space:nowrap">📅 Fecha Salida</th>
          ${thDias}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
}

// ── BILLING: basado en censo real de hoteleras ─────────────────────────
async function renderBilling() {
    const body = document.getElementById('censo-body');
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ Calculando desde censo de hoteleras…</div>';

    const pIni = fmtISO(_periodo.ini);
    const pFin = fmtISO(_periodo.fin);

    // ── 1. Registros del censo (fuente: hoteleras) ────────────────────────
    const { data: registros, error: errReg } = await supabase
        .from('v2_censo_registros')
        .select('habitacion_id, fecha, estado')
        .gte('fecha', pIni)
        .lte('fecha', pFin)
        .neq('estado', 'sin_ocupar');
    if (errReg) { body.innerHTML = `<div style="color:#ef4444;padding:20px">❌ ${errReg.message}</div>`; return; }

    if (!registros?.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">⚠️ Sin registros de censo en este período.<br><span style="font-size:12px">Las hoteleras deben registrar el censo diario desde el portal de terreno.</span></div>';
        return;
    }

    // ── 2. Asignaciones activas en el período (con habitacion_id) ─────────
    const PAGE = 1000; let asigAll = [], pg = 0;
    while (true) {
        const { data } = await supabase
            .from('v2_asignaciones')
            .select('id_cama, rut_huesped, nombre_huesped, numero_contrato, fecha_checkin, fecha_salida_programada, fecha_checkout, v2_empresas(nombre, turno, v2_gerencias(nombre)), v2_camas(numero_cama, habitacion_id, v2_habitaciones(numero_hab))')
            .lte('fecha_checkin', pFin)
            .or(`fecha_checkout.is.null,fecha_checkout.gte.${pIni}`)
            .range(pg * PAGE, pg * PAGE + PAGE - 1);
        if (data?.length) asigAll = asigAll.concat(data);
        if (!data || data.length < PAGE) break;
        pg++; if (pg > 20) break;
    }

    // ── 3. Mapa: habitacion_id → lista de asignaciones ────────────────────
    const asigByHab = {};
    asigAll.forEach(a => {
        const hid = a.v2_camas?.habitacion_id;
        if (!hid) return;
        if (!asigByHab[hid]) asigByHab[hid] = [];
        asigByHab[hid].push(a);
    });

    // ── 4. Cuántas camas por estado ───────────────────────────────────────
    const estadoCamas = { dia:{'dia':1,'2_dia':2,'3_dia':3}, noche:{'noche':1,'2_noche':2,'3_noche':3} };

    // ── 5. Cruzar census × asignaciones ──────────────────────────────────
    // key: empresa|contrato|gerencia → { dia, noche, c3dia, c3noche, diasSet, trabajadoresSet }
    const porEmpresa = {};
    const SIN = 'Sin empresa|(sin contrato)|—';

    registros.forEach(reg => {
        const numDia   = estadoCamas.dia[reg.estado]   || 0;
        const numNoche = estadoCamas.noche[reg.estado] || 0;
        const es3      = reg.estado === '3_dia' || reg.estado === '3_noche';
        if (numDia + numNoche === 0) return;

        // Asignaciones activas en esta habitación en esta fecha
        const activos = (asigByHab[reg.habitacion_id] || []).filter(a =>
            a.fecha_checkin <= reg.fecha &&
            (!a.fecha_checkout || a.fecha_checkout >= reg.fecha)
        );

        const agregar = (key, emp, cont, ger, turno, dia, noche, c3d, c3n, nombre, rut, hab) => {
            if (!porEmpresa[key]) porEmpresa[key] = { emp, cont, ger, turno, dia:0, noche:0, c3dia:0, c3noche:0, total:0, dias: new Set(), trabajadores:{} };
            porEmpresa[key].dia    += dia;
            porEmpresa[key].noche  += noche;
            porEmpresa[key].c3dia  += c3d;
            porEmpresa[key].c3noche+= c3n;
            porEmpresa[key].total  += dia + noche + c3d + c3n;
            porEmpresa[key].dias.add(reg.fecha);
            if (nombre && !porEmpresa[key].trabajadores[rut]) {
                porEmpresa[key].trabajadores[rut] = { nombre, rut, hab };
            }
        };

        if (!activos.length) {
            // Registro sin asignación conocida
            agregar(SIN, 'Sin empresa', '(sin contrato)', '—', '—',
                es3 ? 0 : numDia, es3 ? 0 : numNoche,
                es3 ? numDia : 0, es3 ? numNoche : 0, null, null, null);
            return;
        }

        // Distribuir por cama
        activos.forEach(a => {
            const emp   = a.v2_empresas?.nombre || 'Sin empresa';
            const cont  = a.numero_contrato || '(sin contrato)';
            const ger   = a.v2_empresas?.v2_gerencias?.nombre || '—';
            const turno = a.v2_empresas?.turno || '—';
            const key   = `${emp}|${cont}|${ger}`;
            const nc    = a.v2_camas?.numero_cama;
            const hab   = a.v2_camas?.v2_habitaciones?.numero_hab || '—';
            // cama 1 = día, cama 2 = noche, cama 3 = cama extra
            const d  = nc === 1 ? 1 : 0;
            const n  = nc === 2 ? 1 : 0;
            const c3d = (nc === 3 && numDia > 0)   ? 1 : 0;
            const c3n = (nc === 3 && numNoche > 0) ? 1 : 0;
            agregar(key, emp, cont, ger, turno, d, n, c3d, c3n, a.nombre_huesped, a.rut_huesped, hab);
        });
    });

    if (!Object.keys(porEmpresa).length) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin datos cruzados para este período</div>';
        return;
    }

    // ── 6. Totales generales ──────────────────────────────────────────────
    const vals       = Object.values(porEmpresa);
    const grandTotal = vals.reduce((s, v) => s + v.total, 0);
    const grandDia   = vals.reduce((s, v) => s + v.dia, 0);
    const grandNoche = vals.reduce((s, v) => s + v.noche, 0);
    const grandC3    = vals.reduce((s, v) => s + v.c3dia + v.c3noche, 0);

    // ── 7. Render ─────────────────────────────────────────────────────────
    const kpiHtml = [
        { icon:'🏢', lbl:'Empresas',       val: vals.length,                  c:'#6366f1' },
        { icon:'☀️', lbl:'Camas Día',       val: grandDia.toLocaleString(),    c:'#2563eb' },
        { icon:'🌙', lbl:'Camas Noche',     val: grandNoche.toLocaleString(),  c:'#7c3aed' },
        { icon:'🛏️', lbl:'Cama 3 (extra)',  val: grandC3.toLocaleString(),     c:'#0e7490' },
        { icon:'📊', lbl:'Total Camas-Día', val: grandTotal.toLocaleString(),  c:'#10b981' },
    ].map(k => `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px 16px;border-top:3px solid ${k.c}">
        <div style="font-size:18px">${k.icon}</div>
        <div style="font-size:22px;font-weight:900;color:${k.c}">${k.val}</div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase">${k.lbl}</div>
      </div>`).join('');

    const rows = Object.entries(porEmpresa)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([key, v]) => {
            const pct  = grandTotal > 0 ? Math.round(v.total / grandTotal * 100) : 0;
            const detId = 'bd-' + key.replace(/[^a-zA-Z0-9]/g,'_').slice(0,30);
            const trabs = Object.values(v.trabajadores);
            return `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;margin-bottom:10px;overflow:hidden">
              <div onclick="var d=document.getElementById('${detId}');d.style.display=d.style.display==='none'?'block':'none'"
                style="padding:14px 18px;cursor:pointer;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:160px">
                  <div style="font-weight:800;font-size:14px">${v.emp}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${v.ger} · Contrato: <b>${v.cont}</b> · ${v.dias.size} días censados</div>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                  <span style="background:#dbeafe;color:#1d4ed8;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">☀️ ${v.dia} día</span>
                  <span style="background:#ede9fe;color:#7c3aed;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">🌙 ${v.noche} noche</span>
                  ${(v.c3dia + v.c3noche) > 0 ? `<span style="background:#cffafe;color:#0e7490;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">🛏️ ${v.c3dia + v.c3noche} C3</span>` : ''}
                  <span style="background:#dcfce7;color:#15803d;border-radius:8px;padding:4px 12px;font-size:13px;font-weight:900">= ${v.total}</span>
                </div>
                <div style="font-size:14px;color:#94a3b8">▼</div>
              </div>
              <div id="${detId}" style="display:none;padding:0 16px 14px;border-top:1px solid var(--border)">
                <div style="display:flex;gap:10px;margin:10px 0 6px;flex-wrap:wrap">
                  <span style="font-size:11px;font-weight:700;color:var(--text-muted)">Barra de ocupación:</span>
                  <div style="flex:1;min-width:100px;background:var(--border);border-radius:99px;height:8px;margin-top:3px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:#10b981;border-radius:99px"></div>
                  </div>
                  <span style="font-size:11px;font-weight:800;color:#10b981">${pct}%</span>
                </div>
                ${trabs.length ? `
                <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Trabajadores detectados (${trabs.length})</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px">
                  ${trabs.map(t => `<span style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:11px">${t.nombre} · <span style="font-family:monospace;font-size:10px;color:var(--text-muted)">${t.rut}</span> · HAB ${t.hab}</span>`).join('')}
                </div>` : ''}
              </div>
            </div>`;
        }).join('');

    body.innerHTML = `
      <div style="margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:700;color:var(--text-muted)">
          💰 Facturación por empresa · <span style="color:#6366f1">${_periodo.label}</span>
        </div>
        <span style="background:#fef9c3;color:#854d0e;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700">
          📋 Fuente: Censo diario de hoteleras
        </span>
        <button onclick="window._censoExportBilling()" style="margin-left:auto;padding:8px 16px;border:none;border-radius:9px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:700;font-size:12px;cursor:pointer">📥 Excel</button>
        <button onclick="window._censoExportEstadoPago()" style="padding:8px 16px;border:none;border-radius:9px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:700;font-size:12px;cursor:pointer">📋 Estado de Pago</button>
      </div>
      <input type="hidden" id="billing-desde" value="${pIni}">
      <input type="hidden" id="billing-hasta" value="${pFin}">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0">${kpiHtml}</div>
      <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:14px;padding:14px 20px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <div style="color:rgba(255,255,255,.6);font-size:11px;font-weight:700;text-transform:uppercase">TOTAL GENERAL CAMAS-DÍA (CENSO HOTELERAS)</div>
          <div style="color:rgba(255,255,255,.5);font-size:11px;margin-top:2px">${vals.length} empresas · período ${_periodo.label}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:36px;font-weight:900;color:#a5f3fc">${grandTotal.toLocaleString()}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.5)">☀️ ${grandDia} día · 🌙 ${grandNoche} noche · 🛏️ ${grandC3} C3</div>
        </div>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px">DESGLOSE POR EMPRESA <span style="font-weight:400">(click para expandir)</span></div>
      ${rows}`;
}

// ── BAJADAS: salidas por pabellón y empresa ────────────────────────────

async function renderBajadas() {
    const body = document.getElementById('censo-body');
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ Cargando…</div>';

    const hoy = fmtISO(new Date());
    let q = supabase.from('v2_asignaciones')
        .select('nombre_huesped,rut_huesped,fecha_checkout,numero_contrato,v2_empresas(nombre,v2_gerencias(nombre)),v2_camas(v2_habitaciones(numero_hab,nivel,v2_pabellones(nombre,v2_edificios(nombre))))')
        .gte('fecha_checkout', fmtISO(_periodo.ini))
        .lte('fecha_checkout', fmtISO(_periodo.fin))
        .not('fecha_checkout', 'is', null)
        .order('fecha_checkout', { ascending: false });

    const { data: bajadas } = await q;

    if (!(bajadas?.length)) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin bajadas en este período</div>';
        return;
    }

    // Agrupar por fecha → pabellón → empresa
    const grupos = {};
    bajadas.forEach(b => {
        const fecha = b.fecha_checkout;
        const pab   = b.v2_camas?.v2_habitaciones?.v2_pabellones?.nombre || '—';
        const edif  = b.v2_camas?.v2_habitaciones?.v2_pabellones?.v2_edificios?.nombre || '—';
        const emp   = b.v2_empresas?.nombre || '—';
        const nivel = b.v2_camas?.v2_habitaciones?.nivel || '—';
        const key   = `${fecha}|||${edif}|||${pab}|||${nivel}|||${emp}`;
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(b);
    });

    const cards = Object.entries(grupos).sort((a,b) => b[0].localeCompare(a[0])).map(([key, rows]) => {
        const [fecha, edif, pab, nivel, emp] = key.split('|||');
        const d = new Date(fecha + 'T12:00:00');
        return `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
              <div>
                <div style="font-weight:800;font-size:14px;color:var(--text-primary)">${emp}</div>
                <div style="font-size:11px;color:var(--text-muted)">${edif} · ${pab} · Nivel ${nivel}</div>
                <div style="font-size:11px;color:#6366f1;font-weight:700">${d.toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'})}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:26px;font-weight:900;color:#ef4444;line-height:1">${rows.length}</div>
                <div style="font-size:10px;color:var(--text-muted)">bajadas</div>
              </div>
            </div>
            <div style="max-height:160px;overflow-y:auto;border-top:1px solid var(--border);padding-top:8px">
              ${rows.map(r => `
                <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px">
                  <span style="font-weight:600;color:var(--text-primary)">${r.nombre_huesped}</span>
                  <span style="color:var(--text-muted);font-family:monospace">${r.rut_huesped}</span>
                </div>`).join('')}
            </div>
          </div>`;
    }).join('');

    body.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:var(--text-secondary);margin-bottom:12px">
        📤 Bajadas · ${_periodo.label} · <span style="color:#ef4444">${bajadas.length} total</span>
      </div>${cards}`;
}

// ── Excel export ────────────────────────────────────────────────────────
async function exportExcel() {
    if (!window.XLSX) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = '/js/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }
    const { data: regs } = await supabase.from('v2_censo_registros')
        .select('habitacion_id,fecha,estado,registrado_por,pabellon_id')
        .gte('fecha', fmtISO(_periodo.ini))
        .lte('fecha', fmtISO(_periodo.fin))
        .order('fecha');

    const header = [['Habitación','Fecha','Estado','Registrado por']];
    const rows   = (regs || []).map(r => [r.habitacion_id, r.fecha, r.estado, r.registrado_por]);
    const ws = window.XLSX.utils.aoa_to_sheet([...header, ...rows]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Censo');
    window.XLSX.writeFile(wb, `Censo_${fmtISO(_periodo.ini)}_${fmtISO(_periodo.fin)}.xlsx`);
}

// ── EXPORT BILLING EXCEL ────────────────────────────────────────────────
window._censoExportBilling = async () => {
    const btn = document.getElementById('btn-export-billing');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando…'; }

    const desde = document.getElementById('billing-desde')?.value || fmtISO(_periodo.ini);
    const hasta  = document.getElementById('billing-hasta')?.value  || fmtISO(_periodo.fin);

    try {
        if (!window.XLSX) {
            const s = document.createElement('script');
            s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
            await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
        }

        const { data: asigs, error } = await supabase.from('v2_asignaciones')
            .select('id_cama,rut_huesped,nombre_huesped,numero_contrato,fecha_checkin,fecha_salida_programada,fecha_checkout,v2_empresas(nombre,turno,v2_gerencias(nombre)),v2_camas(numero_cama,v2_habitaciones(numero_hab))')
            .lte('fecha_checkin', hasta)
            .or(`fecha_checkout.is.null,fecha_checkout.gte.${desde}`)
            .not('estado_asignacion', 'eq', 'sin_checkout');

        if (error) throw new Error(error.message);

        // Construir datos por contrato
        const porContrato = {};
        const detalleTodos = [];

        (asigs || []).forEach(a => {
            const cont  = a.numero_contrato || '(sin contrato)';
            const emp   = a.v2_empresas?.nombre || 'Sin empresa';
            const ger   = a.v2_empresas?.v2_gerencias?.nombre || '—';
            const turno = a.v2_empresas?.turno || '—';
            const hab   = a.v2_camas?.v2_habitaciones?.numero_hab || '—';

            if (!porContrato[cont]) porContrato[cont] = { emp, ger, turno, totalDias: 0, nTrab: 0 };

            const ini2  = a.fecha_checkin > desde ? a.fecha_checkin : desde;
            const salida = a.fecha_salida_programada || hasta;
            const chk    = a.fecha_checkout;
            const real   = (chk && chk < salida) ? chk : salida;
            const fin2   = real < hasta ? real : hasta;
            if (ini2 > fin2) return;
            const dias = Math.round((new Date(fin2) - new Date(ini2)) / 86400000) + 1;

            porContrato[cont].totalDias += dias;
            porContrato[cont].nTrab++;

            detalleTodos.push({
                cont, emp, ger, turno,
                nombre: a.nombre_huesped, rut: a.rut_huesped,
                hab, desde: ini2, hasta: fin2, dias
            });
        });

        const grandTotal = Object.values(porContrato).reduce((s, v) => s + v.totalDias, 0);
        const fechaHoy   = new Date().toLocaleDateString('es-CL');

        const { utils, writeFile } = window.XLSX;
        const wb = utils.book_new();

        // ── Hoja 1: RESUMEN POR CONTRATO ──────────────────────────────
        const res = [
            [`FACTURACIÓN PERÍODO: ${desde} → ${hasta}`],
            [`Generado: ${fechaHoy}   |   Total camas-día: ${grandTotal}`],
            [],
            ['N° CONTRATO', 'EMPRESA', 'GERENCIA', 'TURNO', 'TRABAJADORES', 'TOTAL CAMAS-DÍA'],
        ];
        Object.entries(porContrato)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([cont, v]) => {
                res.push([cont, v.emp, v.ger, v.turno, v.nTrab, v.totalDias]);
            });
        res.push([]);
        res.push(['', '', '', '', 'GRAND TOTAL', grandTotal]);

        const ws1 = utils.aoa_to_sheet(res);
        ws1['!cols'] = [
            { wch: 18 }, { wch: 30 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 18 }
        ];
        utils.book_append_sheet(wb, ws1, 'Resumen por Contrato');

        // ── Hoja 2: DETALLE POR TRABAJADOR ────────────────────────────
        const det = [
            [`DETALLE TRABAJADORES · PERÍODO ${desde} → ${hasta}`],
            [`Generado: ${fechaHoy}`],
            [],
            ['N° CONTRATO', 'EMPRESA', 'GERENCIA', 'TURNO', 'TRABAJADOR', 'RUT', 'HAB', 'CHECK-IN PERÍODO', 'CHECK-OUT PERÍODO', 'CAMAS-DÍA'],
        ];
        detalleTodos
            .sort((a, b) => a.cont.localeCompare(b.cont) || a.nombre.localeCompare(b.nombre))
            .forEach(t => {
                det.push([t.cont, t.emp, t.ger, t.turno, t.nombre, t.rut, t.hab, t.desde, t.hasta, t.dias]);
            });

        const ws2 = utils.aoa_to_sheet(det);
        ws2['!cols'] = [
            { wch: 16 }, { wch: 26 }, { wch: 22 }, { wch: 14 },
            { wch: 28 }, { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 12 }
        ];
        utils.book_append_sheet(wb, ws2, 'Detalle Trabajadores');

        const nombre = `Facturacion_${desde}_${hasta}.xlsx`;
        writeFile(wb, nombre);

    } catch (e) {
        alert('Error al exportar: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📥 Descargar Excel'; }
    }
};

// ── EXPORT ESTADO DE PAGO (ExcelJS · estilo Aramark) ────────────────────
window._censoExportEstadoPago = async () => {
    const btn = document.getElementById('btn-export-pago');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando…'; }

    const desde = document.getElementById('billing-desde')?.value || fmtISO(_periodo.ini);
    const hasta  = document.getElementById('billing-hasta')?.value  || fmtISO(_periodo.fin);

    // ── Colores corporativos Aramark (iguales al template de empresas) ──
    const RED       = 'FFEE3124';
    const RED_DARK  = 'FFB71C1C';
    const RED_LITE  = 'FFFFF5F5';
    const WHITE     = 'FFFFFFFF';
    const GRAY      = 'FF424242';
    const GREEN_BG  = 'FFC6EFCE';
    const GREEN_FG  = 'FF276221';
    const BORDER    = { style: 'thin', color: { argb: 'FFDDDDDD' } };
    const ALL_B     = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
    const THICK_B   = { style: 'medium', color: { argb: RED_DARK } };

    const styleHdr = c => {
        c.font      = { name: 'Calibri', bold: true, size: 11, color: { argb: WHITE } };
        c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border    = ALL_B;
    };
    const styleData = (c, alt) => {
        c.font      = { name: 'Calibri', size: 10, color: { argb: GRAY } };
        c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: alt ? 'FFF9F9F9' : RED_LITE } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border    = ALL_B;
    };
    const styleTotal = c => {
        c.font      = { name: 'Calibri', bold: true, size: 11, color: { argb: WHITE } };
        c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_DARK } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border    = { top: THICK_B, bottom: THICK_B, left: BORDER, right: BORDER };
    };

    try {
        // Cargar ExcelJS
        if (typeof ExcelJS === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }

        // Traer datos
        const { data: asigs, error } = await supabase.from('v2_asignaciones')
            .select('rut_huesped,numero_contrato,fecha_checkin,fecha_salida_programada,fecha_checkout,v2_empresas(nombre,turno,v2_gerencias(nombre))')
            .lte('fecha_checkin', hasta)
            .or(`fecha_checkout.is.null,fecha_checkout.gte.${desde}`)
            .not('estado_asignacion', 'eq', 'sin_checkout');
        if (error) throw new Error(error.message);

        const porContrato = {};
        (asigs || []).forEach(a => {
            const cont  = a.numero_contrato || '(sin contrato)';
            const emp   = a.v2_empresas?.nombre || 'Sin empresa';
            const ger   = a.v2_empresas?.v2_gerencias?.nombre || '—';
            const turno = a.v2_empresas?.turno || '—';
            if (!porContrato[cont]) porContrato[cont] = { emp, ger, turno, totalDias: 0, ruts: new Set() };
            const ini2   = a.fecha_checkin > desde ? a.fecha_checkin : desde;
            const salida = a.fecha_salida_programada || hasta;
            const chk    = a.fecha_checkout;
            const real   = (chk && chk < salida) ? chk : salida;
            const fin2   = real < hasta ? real : hasta;
            if (ini2 > fin2) return;
            const dias = Math.round((new Date(fin2) - new Date(ini2)) / 86400000) + 1;
            porContrato[cont].totalDias += dias;
            porContrato[cont].ruts.add(a.rut_huesped);
        });

        const grandTotal  = Object.values(porContrato).reduce((s, v) => s + v.totalDias, 0);
        const totalTrab   = Object.values(porContrato).reduce((s, v) => s + v.ruts.size, 0);
        const nConts      = Object.keys(porContrato).length;
        const fechaHoy    = new Date().toLocaleDateString('es-CL');
        const NCOLS       = 10; // columnas A-J

        // ── Workbook ──────────────────────────────────────────────────────
        const wb = new ExcelJS.Workbook();
        wb.creator = 'PC Hotelería'; wb.created = new Date();

        const ws = wb.addWorksheet('Estado de Pago', {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
            views: [{ showGridLines: true, state: 'frozen', xSplit: 0, ySplit: 6 }]
        });

        ws.columns = [
            { key: 'A', width: 18 }, // N° Contrato
            { key: 'B', width: 30 }, // Empresa
            { key: 'C', width: 24 }, // Gerencia
            { key: 'D', width: 14 }, // Turno
            { key: 'E', width: 14 }, // Trabajadores
            { key: 'F', width: 14 }, // Camas-Día
            { key: 'G', width: 10 }, // %
            { key: 'H', width: 18 }, // Estado Pago
            { key: 'I', width: 20 }, // N° OC / Factura
            { key: 'J', width: 30 }, // Observaciones
        ];

        // ── FILAS 1-3: CABECERA ROJA CON LOGO ────────────────────────────
        for (let r = 1; r <= 3; r++) {
            ws.getRow(r).height = r === 2 ? 50 : 22;
            for (let c = 1; c <= NCOLS; c++) {
                ws.getRow(r).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
            }
        }

        // Logo Aramark
        try {
            const resp   = await fetch('./aramark.png');
            const buffer = await resp.arrayBuffer();
            const imgId  = wb.addImage({ buffer, extension: 'png' });
            ws.addImage(imgId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 175, height: 80 } });
        } catch {
            ws.mergeCells('A1:C3');
            const lc = ws.getCell('A1');
            lc.value = 'ARAMARK';
            lc.font  = { name: 'Calibri', bold: true, size: 22, color: { argb: WHITE } };
            lc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
            lc.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        ws.mergeCells('D1:J3');
        const titleCell    = ws.getCell('D1');
        titleCell.value    = `ESTADO DE PAGO — ALOJAMIENTO ARAMARK\nPC Hotelería  ·  Período ${desde}  →  ${hasta}`;
        titleCell.font     = { name: 'Calibri', bold: true, size: 16, color: { argb: WHITE } };
        titleCell.fill     = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

        // ── FILA 4: RESUMEN PERÍODO ───────────────────────────────────────
        ws.getRow(4).height = 26;
        for (let c = 1; c <= NCOLS; c++) {
            ws.getRow(4).getCell(c).fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_DARK } };
            ws.getRow(4).getCell(c).border = ALL_B;
        }
        ws.mergeCells('A4:D4');
        const r4L    = ws.getCell('A4');
        r4L.value    = `Generado: ${fechaHoy}   ·   ${nConts} contratos   ·   ${totalTrab} trabajadores`;
        r4L.font     = { name: 'Calibri', bold: true, size: 10, color: { argb: WHITE } };
        r4L.alignment = { horizontal: 'left', vertical: 'middle' };

        ws.mergeCells('E4:G4');
        const r4M    = ws.getCell('E4');
        r4M.value    = `TOTAL CAMAS-DÍA: ${grandTotal.toLocaleString('es-CL')}`;
        r4M.font     = { name: 'Calibri', bold: true, size: 12, color: { argb: WHITE } };
        r4M.alignment = { horizontal: 'center', vertical: 'middle' };

        ws.mergeCells('H4:J4');
        const r4R    = ws.getCell('H4');
        r4R.value    = '☐ Pendiente revisión Aramark';
        r4R.font     = { name: 'Calibri', italic: true, size: 10, color: { argb: WHITE } };
        r4R.alignment = { horizontal: 'center', vertical: 'middle' };

        // ── FILA 5: CABECERAS ─────────────────────────────────────────────
        ws.getRow(5).height = 28;
        ['N° CONTRATO','EMPRESA','GERENCIA','TURNO','TRABAJADORES','CAMAS-DÍA','% TOTAL','ESTADO PAGO','N° OC / FACTURA','OBSERVACIONES']
            .forEach((h, i) => styleHdr(ws.getRow(5).getCell(i + 1)));
        ['N° CONTRATO','EMPRESA','GERENCIA','TURNO','TRABAJADORES','CAMAS-DÍA','% TOTAL','ESTADO PAGO','N° OC / FACTURA','OBSERVACIONES']
            .forEach((h, i) => { ws.getRow(5).getCell(i + 1).value = h; });

        // ── FILAS 6+: DATOS POR CONTRATO ─────────────────────────────────
        const sorted = Object.entries(porContrato).sort((a, b) => a[0].localeCompare(b[0]));
        sorted.forEach(([cont, v], idx) => {
            const rowN = 6 + idx;
            const alt  = idx % 2 === 1;
            const pct  = grandTotal > 0 ? ((v.totalDias / grandTotal) * 100).toFixed(1) + '%' : '0%';
            ws.getRow(rowN).height = 20;

            const vals = [cont, v.emp, v.ger, v.turno, v.ruts.size, v.totalDias, pct, 'PENDIENTE', '', ''];
            vals.forEach((val, ci) => {
                const cell = ws.getRow(rowN).getCell(ci + 1);
                cell.value = val;
                styleData(cell, alt);
                // Columna N° Contrato en negrita morada
                if (ci === 0) { cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FF6366f1' } }; }
                // Camas-Día en verde
                if (ci === 5) { cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: GREEN_FG } }; }
            });

            // Dropdown Estado Pago
            ws.getRow(rowN).getCell(8).dataValidation = {
                type: 'list', allowBlank: false, showDropDown: false,
                formulae: ['"PENDIENTE,PAGADO,OBSERVADO,ANULADO"'],
                showErrorMessage: true, errorTitle: 'Estado inválido', error: 'Seleccione de la lista'
            };
        });

        // ── FILA TOTAL ────────────────────────────────────────────────────
        const totalRow = 6 + sorted.length + 1;
        ws.getRow(totalRow).height = 26;
        const totalVals = ['TOTAL GENERAL', '', '', '', totalTrab, grandTotal, '100%', '', '', ''];
        totalVals.forEach((val, ci) => {
            const cell = ws.getRow(totalRow).getCell(ci + 1);
            cell.value = val;
            styleTotal(cell);
        });

        // ── LEYENDA ───────────────────────────────────────────────────────
        const legRow = totalRow + 2;
        ws.mergeCells(`A${legRow}:J${legRow}`);
        const legCell  = ws.getCell(`A${legRow}`);
        legCell.value  = '* Estado de Pago: PENDIENTE (por revisar)  ·  PAGADO (confirmado)  ·  OBSERVADO (requiere revisión)  ·  ANULADO';
        legCell.font   = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF718096' } };
        legCell.alignment = { horizontal: 'left' };

        // ── GENERAR Y DESCARGAR ───────────────────────────────────────────
        const buffer = await wb.xlsx.writeBuffer();
        const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const nombre = `EstadoPago_${desde}_${hasta}.xlsx`;

        if (window.showSaveFilePicker) {
            try {
                const handle   = await window.showSaveFilePicker({ suggestedName: nombre, types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
                const writable  = await handle.createWritable();
                await writable.write(blob); await writable.close(); return;
            } catch (e) { if (e.name === 'AbortError') return; }
        }
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = nombre; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);

    } catch (e) {
        alert('Error al exportar: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📋 Estado de Pago'; }
    }
};

// ── GUARDAR PERÍODO: cierre en v2_facturacion_cierres ─────────────────────
async function censoGuardarPeriodo() {
    const btn = document.getElementById('btn-guardar-periodo');
    if (!_periodo) return;
    if (!confirm(`¿Guardar el período ${_periodo.label}?\n\nSe registrará el resumen de facturación en el historial.`)) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando…'; }
    try {
        const pIni = fmtISO(_periodo.ini);
        const pFin = fmtISO(_periodo.fin);
        const { data: asigs, error } = await supabase.from('v2_asignaciones')
            .select('rut_huesped,nombre_huesped,numero_contrato,fecha_checkin,fecha_salida_programada,fecha_checkout,v2_empresas(nombre,turno,v2_gerencias(nombre)),v2_camas(numero_cama,v2_habitaciones(numero_hab))')
            .lte('fecha_checkin', pFin)
            .or(`fecha_checkout.is.null,fecha_checkout.gte.${pIni}`)
            .not('estado_asignacion', 'eq', 'sin_checkout');
        if (error) throw new Error(error.message);
        const porContrato = {};
        (asigs || []).forEach(a => {
            const cont = a.numero_contrato || '(sin contrato)';
            const emp  = a.v2_empresas?.nombre || 'Sin empresa';
            const ger  = a.v2_empresas?.v2_gerencias?.nombre || '—';
            const turno= a.v2_empresas?.turno || '—';
            const hab  = a.v2_camas?.v2_habitaciones?.numero_hab || '—';
            if (!porContrato[cont]) porContrato[cont] = { cont, emp, ger, turno, totalDias: 0, ruts: new Set(), detTrab: [] };
            const ini2 = a.fecha_checkin > pIni ? a.fecha_checkin : pIni;
            const sal  = a.fecha_salida_programada || pFin;
            const chk  = a.fecha_checkout;
            const real = (chk && chk < sal) ? chk : sal;
            const fin2 = real < pFin ? real : pFin;
            if (ini2 > fin2) return;
            const dias = Math.round((new Date(fin2) - new Date(ini2)) / 86400000) + 1;
            porContrato[cont].totalDias += dias;
            porContrato[cont].ruts.add(a.rut_huesped);
            porContrato[cont].detTrab.push({ nombre: a.nombre_huesped, rut: a.rut_huesped, hab, desde: ini2, hasta: fin2, dias });
        });
        const grandTotal = Object.values(porContrato).reduce((s, v) => s + v.totalDias, 0);
        const detalle    = Object.entries(porContrato).map(([cont, v]) => ({
            cont, emp: v.emp, ger: v.ger, turno: v.turno,
            nTrab: v.ruts.size, totalDias: v.totalDias, trabajadores: v.detTrab
        }));
        const { error: insErr } = await supabase.from('v2_facturacion_cierres').insert({
            periodo_ini: pIni, periodo_fin: pFin, periodo_label: _periodo.label,
            total_camas_dia: grandTotal, total_contratos: detalle.length,
            total_trab: Object.values(porContrato).reduce((s, v) => s + v.ruts.size, 0),
            detalle_json: detalle, cerrado_por: window._currentUser?.username || 'supervisor', estado: 'guardado'
        });
        if (insErr) throw new Error(insErr.message);
        alert(`✅ Período guardado\n${_periodo.label}\n${grandTotal.toLocaleString('es-CL')} camas-día · ${detalle.length} contratos`);
        _activeTab = 'historial'; renderTab();
    } catch (e) {
        alert('Error al guardar: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar Período'; }
    }
}

// ── HISTORIAL: períodos guardados ─────────────────────────────────────────
async function renderHistorial() {
    const body = document.getElementById('censo-body');
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ Cargando historial…</div>';
    const { data: cierres, error } = await supabase.from('v2_facturacion_cierres')
        .select('*').order('periodo_ini', { ascending: false }).limit(36);
    if (error) { body.innerHTML = `<div style="color:#ef4444;padding:20px">❌ ${error.message}<br><small>Ejecuta el SQL sql_crear_facturacion_cierres.sql en Supabase primero.</small></div>`; return; }
    if (!cierres?.length) {
        body.innerHTML = '<div style="text-align:center;padding:60px 20px"><div style="font-size:48px">📂</div><div style="font-size:16px;font-weight:700;margin:12px 0">Sin períodos guardados</div><div style="color:var(--text-muted)">Usa <strong>💾 Guardar Período</strong> para registrar el cierre del mes.</div></div>';
        return;
    }
    const ST = { guardado: { bg:'#dbeafe',c:'#1d4ed8',lbl:'💾 Guardado' }, facturado: { bg:'#dcfce7',c:'#15803d',lbl:'✅ Facturado' }, anulado: { bg:'#fee2e2',c:'#dc2626',lbl:'🚫 Anulado' } };
    const cards = cierres.map(c => {
        const st  = ST[c.estado] || ST.guardado;
        const det = c.detalle_json || [];
        const filas = det.slice(0, 5).map(d =>
            `<tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:5px 10px;font-family:monospace;font-size:11px;color:#6366f1;font-weight:700">${d.cont}</td>
              <td style="padding:5px 10px;font-size:11px;font-weight:600">${d.emp}</td>
              <td style="padding:5px 10px;font-size:11px;color:#64748b">${d.ger}</td>
              <td style="padding:5px 10px;font-size:11px;text-align:center">${d.nTrab}</td>
              <td style="padding:5px 10px;font-size:13px;font-weight:900;color:#10b981;text-align:right">${d.totalDias}</td>
            </tr>`).join('');
        const mas = det.length > 5 ? `<div style="padding:6px 10px;font-size:11px;color:#94a3b8;text-align:center">+ ${det.length-5} contratos más…</div>` : '';
        const fGuard = c.cerrado_en ? new Date(c.cerrado_en).toLocaleString('es-CL') : '—';
        return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;margin-bottom:14px;overflow:hidden">
          <div style="padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:15px;font-weight:900;color:var(--text-primary)">${c.periodo_label}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Por ${c.cerrado_por} · ${fGuard}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span style="padding:4px 12px;border-radius:20px;background:${st.bg};color:${st.c};font-size:11px;font-weight:700">${st.lbl}</span>
              ${c.estado==='guardado' ? `<button onclick="window._censoMarcarFacturado('${c.id}')" style="padding:6px 14px;border-radius:8px;border:none;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;cursor:pointer">✅ Marcar Facturado</button>` : ''}
              <button onclick="window._censoExportHistorialExcel('${c.id}')" style="padding:6px 14px;border-radius:8px;border:none;background:#ede9fe;color:#6366f1;font-size:11px;font-weight:700;cursor:pointer">📥 Excel</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--border)">
            ${[['📄',c.total_contratos,'Contratos','#6366f1'],['🛏️',(c.total_camas_dia||0).toLocaleString('es-CL'),'Camas-Día','#0ea5e9'],['👷',c.total_trab,'Trabajadores','#10b981']].map(([icon,val,lbl,color])=>`
            <div style="padding:12px;text-align:center;border-right:1px solid var(--border)">
              <div style="font-size:18px;font-weight:900;color:${color}">${val}</div>
              <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase">${icon} ${lbl}</div>
            </div>`).join('')}
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f8fafc">
              <th style="padding:6px 10px;font-size:10px;color:#94a3b8;font-weight:700;text-align:left">CONTRATO</th>
              <th style="padding:6px 10px;font-size:10px;color:#94a3b8;font-weight:700;text-align:left">EMPRESA</th>
              <th style="padding:6px 10px;font-size:10px;color:#94a3b8;font-weight:700;text-align:left">GERENCIA</th>
              <th style="padding:6px 10px;font-size:10px;color:#94a3b8;font-weight:700;text-align:center">TRAB.</th>
              <th style="padding:6px 10px;font-size:10px;color:#94a3b8;font-weight:700;text-align:right">CAMAS-DÍA</th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table>${mas}
        </div>`;
    }).join('');
    body.innerHTML = `<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:12px">📂 Historial · ${cierres.length} período${cierres.length!==1?'s':''} guardado${cierres.length!==1?'s':''}</div>${cards}`;
    window._censoMarcarFacturado = async (id) => {
        if (!confirm('¿Marcar como FACTURADO?')) return;
        const { error } = await supabase.from('v2_facturacion_cierres').update({ estado:'facturado' }).eq('id', id);
        if (error) { alert('Error: ' + error.message); return; }
        renderHistorial();
    };
    window._censoExportHistorialExcel = async (id) => {
        const cierre = cierres.find(c => c.id === id);
        if (!cierre) return;
        const elI = document.getElementById('billing-desde');
        const elF = document.getElementById('billing-hasta');
        const pI = elI?.value; const pF = elF?.value;
        if (elI) elI.value = cierre.periodo_ini;
        if (elF) elF.value = cierre.periodo_fin;
        await window._censoExportEstadoPago();
        if (elI && pI) elI.value = pI;
        if (elF && pF) elF.value = pF;
    };
}
