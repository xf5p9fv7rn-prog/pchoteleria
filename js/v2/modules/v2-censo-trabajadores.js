/**
 * v2-censo-trabajadores.js
 * Censo Trabajadores QR — mismo formato exacto que v2-censo.js
 * Cuadrícula: EDIF · PAB · HAB · PISO · EMPRESA · GERENCIA · CONTRATO | días →
 * Cada celda = número de personas que confirmaron presencia ese día en esa hab.
 */
import { supabase } from '../../supabaseClient.js';

// ── Período: mismo que censo admin (21 del mes pasado → 20 del actual) ───────
function calcularPeriodo(offset = 0) {
    const hoy = new Date();
    hoy.setMonth(hoy.getMonth() + offset);
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const esSegundaMitad = hoy.getDate() >= 21;
    const ini = new Date(y, esSegundaMitad ? m : m - 1, 21);
    const fin = new Date(y, esSegundaMitad ? m + 1 : m,  20);
    return { ini, fin, label: `${fmtD(ini)} → ${fmtD(fin)}`, dias: getDias(ini, fin) };
}
function getDias(ini, fin) {
    const dias = []; let d = new Date(ini);
    while (d <= fin) { dias.push(new Date(d)); d.setDate(d.getDate()+1); }
    return dias;
}
function fmtD(d)   { return d.toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtISO(d) { return d instanceof Date ? d.toLocaleDateString('en-CA') : String(d); }

let _offset    = 0;
let _periodo   = null;
let _activeTab = 'grid';
let _ctData    = [];
let _habData   = [];
let _asigMap   = {};
let _edifFil   = '';
let _pabFil    = '';

export async function renderCensoTrabajadores(container) {
    _periodo = calcularPeriodo(_offset);
    container.innerHTML = `
    <div style="padding:20px;max-width:1400px;margin:0 auto">

      <!-- Header — mismo estilo que censo admin pero verde -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
        <div style="background:linear-gradient(135deg,#10b981,#059669);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">📲</div>
        <div>
          <h1 style="font-size:20px;font-weight:800;color:var(--text-primary);margin:0">Censo Trabajadores QR</h1>
          <p style="font-size:12px;color:var(--text-secondary);margin:0">Confirmaciones de presencia vía escaneo QR · 1 registro por persona/hab/día</p>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button onclick="window._ctOffset(-1)" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-weight:700">◀</button>
          <span id="ct-period-lbl" style="font-size:13px;font-weight:700;color:var(--text-primary);white-space:nowrap">${_periodo.label}</span>
          <button onclick="window._ctOffset(1)"  style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-weight:700">▶</button>
        </div>
      </div>

      <!-- Filtros — idénticos al censo admin -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <select id="ct-fil-edif" onchange="window._ctFiltroEdif()" style="padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px">
          <option value="">Todos los edificios</option>
        </select>
        <select id="ct-fil-pab" onchange="window._ctFiltroPab()" style="padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px">
          <option value="">Todos los pabellones</option>
        </select>
        <button onclick="window._ctExportExcel()" style="padding:9px 16px;border-radius:10px;border:none;background:#dcfce7;color:#15803d;font-weight:700;font-size:12px;cursor:pointer">📥 Excel</button>
        <button onclick="window._ctReporteEmpresas && window._ctReporteEmpresas()" style="padding:9px 16px;border-radius:10px;border:none;background:#ede9fe;color:#7c3aed;font-weight:700;font-size:12px;cursor:pointer" title="Reporte QR por empresa, habitación y detalle">📊 Reporte</button>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <button id="ctab-grid"    onclick="window._ctTab('grid')"    style="padding:9px 18px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">📋 Cuadrícula</button>
        <button id="ctab-resumen" onclick="window._ctTab('resumen')" style="padding:9px 18px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">📊 Por Habitación</button>
        <button id="ctab-detalle" onclick="window._ctTab('detalle')" style="padding:9px 18px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-weight:700;font-size:12px;cursor:pointer;transition:all .15s">📋 Detalle Completo</button>
      </div>

      <div id="ct-body" style="overflow-x:auto">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando…</div>
      </div>
    </div>`;

    // Cargar edificios
    const { data: edifs } = await supabase.from('v2_edificios').select('id,nombre').order('nombre');
    const selEdif = document.getElementById('ct-fil-edif');
    (edifs || []).forEach(e => { selEdif.innerHTML += `<option value="${e.id}">${e.nombre}</option>`; });

    // Globals
    window._ctOffset = async (d) => {
        _offset += d; _periodo = calcularPeriodo(_offset);
        document.getElementById('ct-period-lbl').textContent = _periodo.label;
        await _ctCargar();
    };
    window._ctFiltroEdif = async () => {
        _edifFil = document.getElementById('ct-fil-edif').value;
        const selPab = document.getElementById('ct-fil-pab');
        selPab.innerHTML = '<option value="">Todos los pabellones</option>';
        _pabFil = '';
        if (_edifFil) {
            const { data: pabs } = await supabase.from('v2_pabellones')
                .select('id,nombre').eq('edificio_id', _edifFil).order('nombre');
            (pabs || []).forEach(p => { selPab.innerHTML += `<option value="${p.id}">${p.nombre}</option>`; });
        }
        _ctRenderTab();
    };
    window._ctFiltroPab  = () => { _pabFil = document.getElementById('ct-fil-pab').value; _ctRenderTab(); };
    window._ctTab        = (t) => { _activeTab = t; _ctRenderTab(); };
    window._ctExportExcel     = ctExportExcel;
    window._ctReporteEmpresas  = ctReporteEmpresas;

    _ctActivarTab('grid');
    await _ctCargar();
}

function _ctActivarTab(t) {
    ['grid','resumen','detalle'].forEach(x => {
        const b = document.getElementById(`ctab-${x}`);
        if (!b) return;
        const on = x === t;
        b.style.background  = on ? '#10b981' : 'var(--bg-card)';
        b.style.color       = on ? '#fff'    : 'var(--text-secondary)';
        b.style.borderColor = on ? '#10b981' : 'var(--border)';
    });
}

function _ctRenderTab() {
    _ctActivarTab(_activeTab);
    if      (_activeTab === 'grid')    ctRenderGrid();
    else if (_activeTab === 'resumen') ctRenderResumen();
    else if (_activeTab === 'detalle') ctRenderDetalle();
}

async function _ctCargar() {
    const body = document.getElementById('ct-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ Cargando…</div>';

    const pIni = fmtISO(_periodo.ini);
    const pFin = fmtISO(_periodo.fin);

    // 1. Datos de confirmaciones QR en el período
    async function fetchAllCensoQR() {
        const PAGE = 900; let offset = 0, all = [];
        while (true) {
            const { data, error } = await supabase
                .from('v2_censo_trabajadores')
                .select('numero_hab,rut_trabajador,nombre_trabajador,empresa,fecha_scan,hora_scan')
                .gte('fecha_scan', pIni)
                .lte('fecha_scan', pFin)
                .order('hora_scan', { ascending: true })
                .range(offset, offset + PAGE - 1);
            if (error) throw error;
            if (!data?.length) break;
            all = all.concat(data);
            if (data.length < PAGE) break;
            offset += PAGE;
        }
        return all;
    }

    try {
        _ctData = await fetchAllCensoQR();
    } catch (error) {
        body.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444">❌ ${error.message}<br><br>
          <span style="font-size:12px">Ejecuta <code>supabase_censo_trabajadores.sql</code> en Supabase si la tabla no existe.</span></div>`;
        return;
    }

    // 2. Habitaciones con pabellón y edificio
    async function fetchAllHabs(filterFn) {
        const PAGE = 900; let offset = 0, all = [];
        while (true) {
            let q = supabase.from('v2_habitaciones')
                .select('id_custom,numero_hab,nivel,pabellon_id,v2_pabellones(id,nombre,edificio_id,v2_edificios(nombre))')
                .range(offset, offset + PAGE - 1);
            if (filterFn) q = filterFn(q);
            const { data: d } = await q;
            if (!d?.length) break;
            all = all.concat(d);
            if (d.length < PAGE) break;
            offset += PAGE;
        }
        return all;
    }

    let filterFn = null;
    if (_pabFil)      filterFn = q => q.eq('pabellon_id', _pabFil);
    else if (_edifFil) {
        const { data: pabIds } = await supabase.from('v2_pabellones').select('id').eq('edificio_id', _edifFil);
        const ids = (pabIds || []).map(p => p.id);
        if (ids.length) filterFn = q => q.in('pabellon_id', ids);
    }

    const rawHabs = await fetchAllHabs(filterFn);

    // Ordenar igual que censo admin
    const naturalNum = s => { const n = parseInt((s||'').replace(/\D/g,''),10); return isNaN(n)?99999:n; };
    _habData = rawHabs.sort((a,b) => {
        const eA = a.v2_pabellones?.v2_edificios?.nombre || '';
        const eB = b.v2_pabellones?.v2_edificios?.nombre || '';
        const rA = eA.toUpperCase().includes('R-220')||eA.toUpperCase().includes('R220');
        const rB = eB.toUpperCase().includes('R-220')||eB.toUpperCase().includes('R220');
        if (rA && !rB) return -1;
        if (!rA && rB) return 1;
        return naturalNum(a.numero_hab) - naturalNum(b.numero_hab);
    });

    // 3. Asignaciones activas (para empresa, gerencia, contrato)
    async function fetchAllAsigActivas() {
        const PAGE = 900; let offset = 0, all = [];
        while (true) {
            const { data } = await supabase.from('v2_asignaciones')
                .select('id_cama,numero_contrato,v2_empresas(nombre,v2_gerencias(nombre)),v2_camas(habitacion_id)')
                .lte('fecha_checkin', pFin)
                .or(`fecha_checkout.is.null,fecha_checkout.gte.${pIni}`)
                .range(offset, offset + PAGE - 1);
            if (!data?.length) break;
            all = all.concat(data);
            if (data.length < PAGE) break;
            offset += PAGE;
        }
        return all;
    }
    const asigActivas = await fetchAllAsigActivas();

    // 4. Etiquetas de distribución para saber si es Noche o Anglo
    const { data: distData } = await supabase.from('v2_distribucion_camas').select('id_cama, tipo, etiqueta').limit(10000);
    const camaToDist = {};
    (distData || []).forEach(d => { camaToDist[d.id_cama] = d; });

    _asigMap = {};
    (asigActivas || []).forEach(a => {
        const hid = a.v2_camas?.habitacion_id;
        const cid = a.id_cama;
        if (hid) {
            if (!_asigMap[hid]) {
                _asigMap[hid] = {
                    emp:  a.v2_empresas?.nombre || '—',
                    ger:  a.v2_empresas?.v2_gerencias?.nombre || '—',
                    cont: a.numero_contrato || '—',
                    cargados: 0,
                    esNoche: false,
                    esAnglo: false
                };
            }
            _asigMap[hid].cargados++;
            const dist = camaToDist[cid];
            if (dist) {
                if (dist.tipo === 'noche' || dist.etiqueta?.toUpperCase() === 'NOCHE') _asigMap[hid].esNoche = true;
                if (dist.tipo === 'anglo' || dist.etiqueta?.toUpperCase() === 'ANGLO') _asigMap[hid].esAnglo = true;
            }
        }
    });

    _ctRenderTab();
}

// ── CUADRÍCULA: EDIF · PAB · HAB · PISO · EMPRESA · GERENCIA · CONTRATO | días ──
function ctRenderGrid() {
    const body = document.getElementById('ct-body');
    if (!_habData.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin habitaciones para este filtro</div>';
        return;
    }

    const dias  = _periodo.dias;
    const hoy   = fmtISO(new Date());

    // Map: numero_hab+fecha → lista de confirmaciones
    const regMap = {};
    _ctData.forEach(r => {
        const key = String(r.numero_hab) + '|' + r.fecha_scan;
        if (!regMap[key]) regMap[key] = [];
        regMap[key].push(r);
    });

    // Mostrar TODAS las habitaciones (igual que censo admin), con o sin datos
    // Cabecera de días
    const thDias = dias.map(d => {
        const iso = fmtISO(d);
        const n   = d.getDate();
        const esH = iso === hoy;
        return `<th style="min-width:32px;padding:4px 2px;font-size:10px;font-weight:700;color:${esH?'#10b981':'#94a3b8'};text-align:center;position:sticky;top:0;background:var(--bg-card)">${n}</th>`;
    }).join('');

    // Filas — TODAS las habitaciones
    const rows = _habData.map(h => {
        const edif = h.v2_pabellones?.v2_edificios?.nombre || '—';
        const pab  = h.v2_pabellones?.nombre || '—';
        const ai   = _asigMap[h.id_custom] || {};

        const celdas = dias.map(d => {
            const iso  = fmtISO(d);
            const regs = regMap[String(h.numero_hab) + '|' + iso] || [];
            const confs= regs.length; // numero de personas que confirmaron
            const esH  = iso === hoy;

            let bg, c, lbl, borde = '';
            if (!confs) { 
                bg = 'var(--bg)';  c = 'transparent'; lbl = ''; 
            } else {
                // Logica de Etiqueta vs Confirmados
                let txt = confs + ' DÍA';
                if (ai.esAnglo) {
                    if (confs >= 2) txt = '1 DÍA 1 NOCHE';
                    else txt = '1 DÍA';
                } else if (ai.esNoche) {
                    txt = confs + ' NOCHE';
                } else {
                    txt = confs + ' DÍA';
                }

                if (confs === 1) { bg = '#d1fae5'; c = '#065f46'; }
                else if (confs === 2) { bg = '#6ee7b7'; c = '#047857'; }
                else { bg = '#10b981'; c = '#fff'; }
                lbl = txt;
            }
            if (esH) borde = ';outline:2px solid #10b981;outline-offset:-1px';

            const tip = regs.map(r => `${r.nombre_trabajador||r.rut_trabajador} (${r.hora_scan ? new Date(r.hora_scan).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}) : ''})`).join('\n');
            return `<td style="padding:2px;text-align:center">
              <div title="${tip.replace(/"/g,"'")}" style="min-width:32px;padding:2px 4px;border-radius:4px;background:${bg};color:${c};font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:auto${borde};white-space:nowrap">${lbl}</div>
            </td>`;
        }).join('');

        return `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg-hover,#f8fafc)'" onmouseout="this.style.background=''">
          <td style="padding:6px 10px;white-space:nowrap;font-size:11px;color:var(--text-muted);position:sticky;left:0;background:var(--bg-card)">${edif}</td>
          <td style="padding:6px 8px;white-space:nowrap;font-size:11px;color:var(--text-muted)">${pab}</td>
          <td style="padding:6px 8px;font-weight:800;font-size:13px;color:var(--text-primary)">${h.numero_hab}</td>
          <td style="padding:6px 8px;font-size:10px;color:#94a3b8;font-family:monospace">${h.nivel||'—'}</td>
          <td style="padding:6px 8px;font-size:11px;font-weight:600;color:#6366f1;white-space:nowrap">${ai.emp||''}</td>
          <td style="padding:6px 8px;font-size:10px;color:var(--text-muted);white-space:nowrap">${ai.ger||''}</td>
          <td style="padding:6px 8px;font-size:10px;color:#10b981;font-family:monospace">${ai.cont||''}</td>
          ${celdas}
        </tr>`;
    }).join('');

    // Leyenda de colores
    const leyenda = [
        { bg:'#d1fae5', c:'#065f46', lbl:'1',  desc:'1 confirmación' },
        { bg:'#6ee7b7', c:'#047857', lbl:'2',  desc:'2 confirmaciones' },
        { bg:'#10b981', c:'#fff',    lbl:'3+', desc:'3+ confirmaciones' },
    ].map(l => `<span style="display:flex;align-items:center;gap:4px">
      <span style="min-width:18px;height:14px;padding:0 4px;border-radius:3px;background:${l.bg};color:${l.c};font-size:9px;font-weight:800;display:inline-flex;align-items:center;justify-content:center">${l.lbl}</span>
      <span style="color:var(--text-muted)">${l.desc}</span>
    </span>`).join('');

    body.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
        ${_habData.length} habitaciones · ${dias.length} días · ${_ctData.length} confirmaciones QR · Período ${_periodo.label}
      </div>
      <div style="font-size:11px;display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap">${leyenda}</div>
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

// ── POR HABITACIÓN ────────────────────────────────────────────────────────────
function ctRenderResumen() {
    const body = document.getElementById('ct-body');
    if (!_ctData.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin confirmaciones en este período</div>';
        return;
    }

    const byHab = {};
    _ctData.forEach(r => {
        if (!byHab[r.numero_hab]) byHab[r.numero_hab] = [];
        byHab[r.numero_hab].push(r);
    });

    const totalScans  = _ctData.length;
    const totalHabs   = Object.keys(byHab).length;
    const totalPerson = new Set(_ctData.map(r=>r.rut_trabajador)).size;
    const totalEmps   = new Set(_ctData.map(r=>r.empresa).filter(Boolean)).size;

    const kpis = [
        { icon:'📲', lbl:'Confirmaciones',      val: totalScans,  c:'#10b981' },
        { icon:'🏠', lbl:'Habitaciones activas', val: totalHabs,   c:'#6366f1' },
        { icon:'👤', lbl:'Personas distintas',   val: totalPerson, c:'#f59e0b' },
        { icon:'🏢', lbl:'Empresas',             val: totalEmps,   c:'#ec4899' },
    ].map(k => `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px 16px;border-top:3px solid ${k.c}">
        <div style="font-size:18px">${k.icon}</div>
        <div style="font-size:22px;font-weight:900;color:${k.c}">${k.val.toLocaleString('es-CL')}</div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase">${k.lbl}</div>
      </div>`).join('');

    const sorted = Object.entries(byHab).sort((a,b) => b[1].length - a[1].length);
    const cards  = sorted.map(([hab, regs]) => {
        const personas = [...new Map(regs.map(r=>[r.rut_trabajador,r])).values()];
        const empresas = [...new Set(regs.map(r=>r.empresa).filter(Boolean))];
        const diasSet  = new Set(regs.map(r=>r.fecha_scan));
        const pct = Math.min(100, Math.round(personas.length/3*100));
        const detId = 'ct-det-' + String(hab).replace(/\D/g,'');

        return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;margin-bottom:10px;overflow:hidden">
          <div onclick="var d=document.getElementById('${detId}');d.style.display=d.style.display==='none'?'block':'none'"
            style="padding:14px 18px;cursor:pointer;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">
              <div style="font-weight:800;font-size:18px;color:var(--text-primary)">HAB ${hab}</div>
              <div style="font-size:11px;color:var(--text-muted)">${diasSet.size} día(s) · ${empresas.join(', ')||'—'}</div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
              <span style="background:#d1fae5;color:#065f46;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">👤 ${personas.length} persona(s)</span>
              <span style="background:#dbeafe;color:#1d4ed8;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">📲 ${regs.length} confir.</span>
            </div>
            <div style="font-size:14px;color:#94a3b8">▼</div>
          </div>
          <div id="${detId}" style="display:none;padding:0 16px 14px;border-top:1px solid var(--border)">
            <div style="display:flex;gap:10px;margin:10px 0 6px">
              <span style="font-size:11px;font-weight:700;color:var(--text-muted)">Ocupación:</span>
              <div style="flex:1;background:var(--border);border-radius:99px;height:8px;margin-top:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:#10b981;border-radius:99px"></div>
              </div>
              <span style="font-size:11px;font-weight:800;color:#10b981">${personas.length}/3</span>
            </div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Trabajadores (${personas.length})</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              ${personas.map(p=>`<span style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:11px">${p.nombre_trabajador||'—'} · <span style="font-family:monospace;font-size:10px;color:var(--text-muted)">${p.rut_trabajador}</span></span>`).join('')}
            </div>
          </div>
        </div>`;
    }).join('');

    body.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:4px">
        📲 Presencia QR · <span style="color:#10b981">${_periodo.label}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0">${kpis}</div>
      <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:14px;padding:14px 20px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <div style="color:rgba(255,255,255,.6);font-size:11px;font-weight:700;text-transform:uppercase">TOTAL CONFIRMACIONES DE PRESENCIA</div>
          <div style="color:rgba(255,255,255,.5);font-size:11px;margin-top:2px">${totalHabs} habitaciones · ${totalPerson} personas · ${_periodo.label}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:36px;font-weight:900;color:#6ee7b7">${totalScans.toLocaleString('es-CL')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.5)">👤 ${totalPerson} personas · 🏠 ${totalHabs} habitaciones</div>
        </div>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px">DESGLOSE POR HABITACIÓN <span style="font-weight:400">(click para expandir)</span></div>
      ${cards}`;
}

// ── DETALLE COMPLETO ──────────────────────────────────────────────────────────
function ctRenderDetalle() {
    const body = document.getElementById('ct-body');
    if (!_ctData.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin confirmaciones en este período</div>';
        return;
    }

    const filas = [..._ctData].sort((a,b) =>
        a.numero_hab.localeCompare(b.numero_hab) || a.fecha_scan.localeCompare(b.fecha_scan));

    body.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--text-secondary);margin-bottom:12px">
      📋 Detalle completo · ${filas.length} registros · ${_periodo.label}
    </div>
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:600px">
          <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
            ${['Habitación','Nombre','RUT','Empresa','Fecha','Hora'].map(h =>
              `<th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`
            ).join('')}
          </tr></thead>
          <tbody>
          ${filas.map((r,i) => {
            const hora  = r.hora_scan ? new Date(r.hora_scan).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}) : '—';
            const fecha = r.fecha_scan ? r.fecha_scan.substring(8,10)+'/'+r.fecha_scan.substring(5,7) : '—';
            return `<tr style="border-bottom:1px solid var(--border);background:${i%2?'var(--bg)':'transparent'}"
              onmouseover="this.style.background='var(--bg-hover,#f8fafc)'" onmouseout="this.style.background='${i%2?'var(--bg)':'transparent'}'">
              <td style="padding:10px 14px;font-size:16px;font-weight:900;color:#10b981">${r.numero_hab}</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:700;color:var(--text-primary)">${r.nombre_trabajador||'—'}</td>
              <td style="padding:10px 14px;font-size:11px;font-family:monospace;color:var(--text-secondary)">${r.rut_trabajador}</td>
              <td style="padding:10px 14px">
                ${r.empresa?`<span style="background:#6366f122;color:#6366f1;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">${r.empresa}</span>`:'—'}
              </td>
              <td style="padding:10px 14px;font-size:12px;color:var(--text-muted);font-weight:700">${fecha}</td>
              <td style="padding:10px 14px;font-size:12px;color:var(--text-muted)">${hora}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Excel export (CSV detalle básico) ───────────────────────────────────────
async function ctExportExcel() {
    if (!_ctData.length) { alert('Sin datos para exportar.'); return; }

    const pIni = fmtISO(_periodo.ini);
    const pFin = fmtISO(_periodo.fin);
    const hdr  = ['Habitación','Nombre','RUT','Empresa','Fecha','Hora'];
    const rows = _ctData.map(r => [
        r.numero_hab, r.nombre_trabajador||'', r.rut_trabajador, r.empresa||'',
        r.fecha_scan||'', r.hora_scan ? new Date(r.hora_scan).toLocaleTimeString('es-CL') : '',
    ]);
    const csv  = [hdr,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`censo_trabajadores_${pIni}_${pFin}.csv`;
    a.click(); URL.revokeObjectURL(url);
}

// ── Reporte Excel multi-hoja (Por Empresa · Por Habitación · Detalle) ────────
async function ctReporteEmpresas() {
    if (!_ctData.length) { alert('Sin datos para exportar.'); return; }

    // Cargar SheetJS si no está disponible
    if (!window.XLSX) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = '/js/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }

    const pIni = fmtISO(_periodo.ini);
    const pFin = fmtISO(_periodo.fin);

    // ── Hoja 1: Resumen por Empresa ──────────────────────────────────────
    const byEmp = {};
    _ctData.forEach(r => {
        const emp = r.empresa || '(Sin empresa)';
        if (!byEmp[emp]) byEmp[emp] = { conf: 0, personas: new Set(), habs: new Set(), dias: new Set() };
        byEmp[emp].conf++;
        if (r.rut_trabajador) byEmp[emp].personas.add(r.rut_trabajador);
        byEmp[emp].habs.add(String(r.numero_hab));
        if (r.fecha_scan) byEmp[emp].dias.add(r.fecha_scan);
    });

    const hojaEmp = [
        ['Empresa', 'Confirmaciones QR', 'Personas distintas', 'Habitaciones activas', 'Días activos']
    ];
    Object.entries(byEmp)
        .sort(([a], [b]) => a.localeCompare(b, 'es'))
        .forEach(([emp, d]) => {
            hojaEmp.push([emp, d.conf, d.personas.size, d.habs.size, d.dias.size]);
        });
    hojaEmp.push([]);
    hojaEmp.push([
        'TOTAL',
        _ctData.length,
        new Set(_ctData.map(r => r.rut_trabajador)).size,
        new Set(_ctData.map(r => String(r.numero_hab))).size,
        new Set(_ctData.map(r => r.fecha_scan)).size
    ]);

    // ── Hoja 2: Por Habitación ───────────────────────────────────────────
    const byHab = {};
    _ctData.forEach(r => {
        const k = String(r.numero_hab);
        if (!byHab[k]) byHab[k] = { conf: 0, personas: new Set(), dias: new Set() };
        byHab[k].conf++;
        if (r.rut_trabajador) byHab[k].personas.add(r.rut_trabajador);
        if (r.fecha_scan) byHab[k].dias.add(r.fecha_scan);
    });

    // Mapa numero_hab → datos de habitación
    const habNumMap = {};
    _habData.forEach(h => { habNumMap[String(h.numero_hab)] = h; });

    const hojaHab = [
        ['Habitación','Edificio','Pabellón','Piso','Empresa','Gerencia','Contrato','Confirmaciones','Personas distintas','Días activos']
    ];
    Object.entries(byHab)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .forEach(([hab, d]) => {
            const hd = habNumMap[hab];
            const ai = hd ? (_asigMap[hd.id_custom] || {}) : {};
            hojaHab.push([
                hab,
                hd?.v2_pabellones?.v2_edificios?.nombre || '—',
                hd?.v2_pabellones?.nombre || '—',
                hd?.nivel || '—',
                ai.emp  || '—',
                ai.ger  || '—',
                ai.cont || '—',
                d.conf,
                d.personas.size,
                d.dias.size
            ]);
        });

    // ── Hoja 3: Detalle completo ──────────────────────────────────────────
    const hojaDetalle = [['Habitación','Nombre','RUT','Empresa','Fecha','Hora']];
    [..._ctData]
        .sort((a, b) => String(a.numero_hab).localeCompare(String(b.numero_hab)) || (a.fecha_scan||'').localeCompare(b.fecha_scan||''))
        .forEach(r => {
            const hora = r.hora_scan
                ? new Date(r.hora_scan).toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'})
                : '—';
            hojaDetalle.push([r.numero_hab, r.nombre_trabajador||'—', r.rut_trabajador, r.empresa||'—', r.fecha_scan||'—', hora]);
        });

    // ── Armar libro ──────────────────────────────────────────────────────
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(hojaEmp),     'Por Empresa');
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(hojaHab),     'Por Habitación');
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(hojaDetalle), 'Detalle');
    window.XLSX.writeFile(wb, `Reporte_QR_${pIni}_${pFin}.xlsx`);
}
