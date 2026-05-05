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

      <!-- Tabs -->
      <div style="display:flex;gap:8px;margin-bottom:16px">
        ${['grid','billing','bajadas'].map(t => `
          <button id="ctab-${t}" onclick="window._censoTab('${t}')"
            style="padding:9px 18px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">
            ${{grid:'📋 Cuadrícula',billing:'💰 Facturación',bajadas:'📤 Bajadas'}[t]}
          </button>`).join('')}
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

    activarTab('grid');
    await renderTab();
}

function activarTab(t) {
    ['grid','billing','bajadas'].forEach(x => {
        const b = document.getElementById(`ctab-${x}`);
        if (!b) return;
        const on = x === t;
        b.style.background    = on ? '#6366f1' : 'var(--bg-card)';
        b.style.color         = on ? '#fff'     : 'var(--text-secondary)';
        b.style.borderColor   = on ? '#6366f1'  : 'var(--border)';
    });
}

async function renderTab() {
    activarTab(_activeTab);
    if      (_activeTab === 'grid')    await renderGrid();
    else if (_activeTab === 'billing') await renderBilling();
    else if (_activeTab === 'bajadas') await renderBajadas();
}

// ── GRID: cuadrícula habitaciones × días ───────────────────────────────
async function renderGrid() {
    const body = document.getElementById('censo-body');
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ Cargando…</div>';

    // Habitaciones — filtro por edificio usando pabellon IDs (evita nested filter)
    let habQ = supabase.from('v2_habitaciones')
        .select('id_custom,numero_hab,nivel,pabellon_id,v2_pabellones(nombre,edificio_id,v2_edificios(nombre))')
        .order('numero_hab');
    if (_pabellonFil) {
        habQ = habQ.eq('pabellon_id', _pabellonFil);
    } else if (_edificioFil) {
        // Obtener IDs de pabellones del edificio seleccionado
        const { data: pabIds } = await supabase.from('v2_pabellones')
            .select('id').eq('edificio_id', _edificioFil);
        const ids = (pabIds || []).map(p => p.id);
        if (ids.length) habQ = habQ.in('pabellon_id', ids);
    }
    const { data: habs } = await habQ;

    // Asignaciones activas en el período para mostrar empresa en el grid
    const { data: asigActivas } = await supabase.from('v2_asignaciones')
        .select('id_cama,numero_contrato,v2_empresas(nombre,v2_gerencias(nombre)),v2_camas(habitacion_id)')
        .lte('fecha_checkin', fmtISO(_periodo.fin))
        .or(`fecha_checkout.is.null,fecha_checkout.gte.${fmtISO(_periodo.ini)}`);
    // Map: habitacion_id → {empresa, gerencia, contrato}
    const asigMap = {};
    (asigActivas || []).forEach(a => {
        const hid = a.v2_camas?.habitacion_id;
        if (hid && !asigMap[hid]) asigMap[hid] = {
            emp:  a.v2_empresas?.nombre || '—',
            ger:  a.v2_empresas?.v2_gerencias?.nombre || '—',
            cont: a.numero_contrato || '—'
        };
    });

    // Registros censo
    const { data: regs } = await supabase.from('v2_censo_registros')
        .select('habitacion_id,fecha,estado')
        .gte('fecha', fmtISO(_periodo.ini))
        .lte('fecha', fmtISO(_periodo.fin));

    const regMap = {}; // habitacion_id+fecha → estado
    (regs || []).forEach(r => { regMap[r.habitacion_id + '|' + r.fecha] = r.estado; });

    const dias    = _periodo.dias;
    const habList = habs || [];

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
            const iso   = fmtISO(d);
            const est   = regMap[h.id_custom + '|' + iso] || '';
            const cfg   = ESTADO_CONF[est] || { lbl: '', bg: 'var(--bg)', c: 'transparent' };
            return `<td style="padding:2px;text-align:center">
              <div title="${est}" style="width:28px;height:22px;border-radius:4px;background:${cfg.bg};color:${cfg.c};font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:auto">${cfg.lbl}</div>
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
          ${celdas}
        </tr>`;
    }).join('');

    body.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
        ${habList.length} habitaciones · ${dias.length} días · Período ${_periodo.label}
      </div>
      <div style="font-size:11px;display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap">
        ${Object.entries(ESTADO_CONF).map(([k,v]) => `<span style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:14px;border-radius:3px;background:${v.bg};color:${v.c};font-size:9px;font-weight:800;display:inline-flex;align-items:center;justify-content:center">${v.lbl||'—'}</span><span style="color:var(--text-muted)">${k.replace('_',' ')}</span></span>`).join('')}
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
          ${thDias}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
}

// ── BILLING: resumen por empresa+contrato ──────────────────────────────
async function renderBilling() {
    const body = document.getElementById('censo-body');
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ Calculando…</div>';

    // Query corregida: asignaciones ACTIVAS en el período
    // (checkin <= fin del período) Y (checkout es null O checkout >= inicio del período)
    const { data: asigs, error: asigErr } = await supabase.from('v2_asignaciones')
        .select('rut_huesped,numero_contrato,fecha_checkin,fecha_salida_programada,fecha_checkout,v2_empresas(nombre,turno,v2_gerencias(nombre))')
        .lte('fecha_checkin', fmtISO(_periodo.fin))
        .or(`fecha_checkout.is.null,fecha_checkout.gte.${fmtISO(_periodo.ini)}`);

    if (asigErr) {
        body.innerHTML = `<div style="color:#ef4444;padding:20px">❌ Error: ${asigErr.message}</div>`;
        return;
    }

    const total = {}; // key → {dias, turno, trabajadores, gerencia, contrato}

    (asigs || []).forEach(a => {
        const empNombre = a.v2_empresas?.nombre || 'Sin empresa';
        const gerNombre = a.v2_empresas?.v2_gerencias?.nombre || '—';
        const cont      = a.numero_contrato || '—';
        const turno     = a.v2_empresas?.turno || '—';
        const key       = [empNombre, gerNombre, cont, turno].join('|||');

        if (!total[key]) total[key] = { camas: 0, trabajadores: new Set() };
        total[key].trabajadores.add(a.rut_huesped);

        // Días solapados con el período (usando ISO strings para evitar TZ)
        const checkin  = a.fecha_checkin;
        const salidaP  = a.fecha_salida_programada || fmtISO(_periodo.fin);
        const checkout = a.fecha_checkout;
        const eIni     = checkin  > fmtISO(_periodo.ini) ? checkin  : fmtISO(_periodo.ini);
        const eFin     = (checkout && checkout < salidaP ? checkout : salidaP) < fmtISO(_periodo.fin)
                         ? (checkout && checkout < salidaP ? checkout : salidaP)
                         : fmtISO(_periodo.fin);
        if (eIni > eFin) return;
        const diffDias = Math.round((new Date(eFin) - new Date(eIni)) / 86400000) + 1;
        total[key].camas += diffDias;
    });

    if (!Object.keys(total).length) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin asignaciones en este período</div>';
        return;
    }

    // Totales por empresa
    const porEmpresa = {};
    Object.entries(total).forEach(([key, v]) => {
        const emp = key.split('|||')[0];
        if (!porEmpresa[emp]) porEmpresa[emp] = 0;
        porEmpresa[emp] += v.camas;
    });
    const grandTotal = Object.values(total).reduce((s, v) => s + v.camas, 0);

    // Tarjetas resumen por empresa
    const summaryCards = Object.entries(porEmpresa).sort().map(([emp, dias]) => `
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;padding:16px 20px;color:white;min-width:200px">
        <div style="font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:.5px">${emp}</div>
        <div style="font-size:32px;font-weight:900;line-height:1.1">${dias.toLocaleString('es-CL')}</div>
        <div style="font-size:11px;opacity:.8">camas-día en el período</div>
      </div>`).join('');

    const rows = Object.entries(total).sort((a,b) => a[0].localeCompare(b[0])).map(([key, v]) => {
        const [emp, ger, cont, turno] = key.split('|||');
        return `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg-hover,#f8fafc)'" onmouseout="this.style.background=''">
          <td style="padding:10px 12px;font-weight:800;color:var(--text-primary);font-size:13px">${emp}</td>
          <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary)">${ger}</td>
          <td style="padding:10px 12px;font-family:monospace;font-size:12px;color:#6366f1;font-weight:700">${cont}</td>
          <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary)">${turno}</td>
          <td style="padding:10px 12px;text-align:right;font-weight:900;font-size:16px;color:#10b981">${v.camas.toLocaleString('es-CL')}</td>
          <td style="padding:10px 12px;text-align:center;color:var(--text-muted);font-size:12px">${v.trabajadores.size}</td>
        </tr>`;
    }).join('');

    body.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:var(--text-secondary);margin-bottom:12px">💰 Facturación · ${_periodo.label}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">${summaryCards}
          <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:14px;padding:16px 20px;color:white;min-width:200px">
            <div style="font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:.5px">TOTAL PERÍODO</div>
            <div style="font-size:32px;font-weight:900;line-height:1.1">${grandTotal.toLocaleString('es-CL')}</div>
            <div style="font-size:11px;opacity:.8">camas-día totales</div>
          </div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--bg-card);border-bottom:2px solid var(--border)">
          ${['Empresa','Gerencia','N° Contrato','Turno','Total Camas-Día','Trabajadores'].map(h =>
            `<th style="padding:9px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
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
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
        await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
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
