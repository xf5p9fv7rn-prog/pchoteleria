/**
 * v2-reagrupacion.js — Reagrupación con Drag & Drop + Registro
 * ─────────────────────────────────────────────────────────────
 * Por empresa muestra:
 *   1. ✅ Confirmados solos → arrastra uno sobre otro para juntarlos
 *   2. 📋 Registro de movimientos (persiste en localStorage)
 *   3. ⏰ No confirmados (solo informativo, abajo)
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://pnkajjduvadcxealodcp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Estado global ────────────────────────────────────────────────────────────
let _state     = { asigs: [], generoMap: {}, solosConf: [], noConf: [] };
let _channel   = null;
let _debTimer  = null;
let _container = null;
let _lastUpdate = null;

// DnD
let _dragIdx  = null;      // índice del card que se está arrastrando
let _soloPpl  = [];        // lista plana de solos confirmados (para DnD por índice)

// Registro de movimientos (localStorage)
const LOG_KEY = 'rg_move_log_v1';
const leerLog  = () => { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; } };
const guardarLog = e  => {
    const log = leerLog();
    log.unshift(e);
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 200)));
};

// ─── Utilidades ───────────────────────────────────────────────────────────────
// RUT normalizado: quita puntos, guiones y espacios → "13.876.194-0" == "138761940"
const normRut  = r => (r || '').toString().replace(/[\.\-\s]/g,'').trim().toUpperCase();
const fmt      = d => d ? new Date(d).toLocaleDateString('es-CL') : '—';
const genLabel = g => g === 'M' ? '♂ Masc.' : g === 'F' ? '♀ Fem.' : '? Género';
const genColor = g => g === 'M' ? '#1d4ed8' : g === 'F' ? '#be185d' : '#92400e';
const turnLabel = t => {
    if (!t) return '? Turno';
    const low = t.toLowerCase();
    if (low.includes('noche') || low.includes('night')) return '🌙 Noche';
    if (low.includes('dia') || low.includes('día') || low.includes('day')) return '☀️ Día';
    return `🔄 ${t}`;
};
const turnColor = t => {
    if (!t) return '#64748b';
    const low = t.toLowerCase();
    if (low.includes('noche') || low.includes('night')) return '#4338ca';
    if (low.includes('dia') || low.includes('día') || low.includes('day')) return '#b45309';
    return '#475569';
};
const toast    = (msg, type='info') => {
    const t = document.createElement('div');
    const c = {success:'#16a34a', error:'#b91c1c', info:'#0369a1', warn:'#92400e'};
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;border-radius:12px;background:${c[type]||c.info};color:#fff;font-weight:700;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,.3)`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
};

// ─── Realtime ─────────────────────────────────────────────────────────────────
function iniciarRealtime() {
    if (_channel) { supabase.removeChannel(_channel); _channel = null; }
    _channel = supabase
        .channel('reagrupacion-live-v2')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'v2_asignaciones' }, () => {
            clearTimeout(_debTimer);
            _debTimer = setTimeout(actualizarSilencioso, 3000);
        })
        .subscribe(status => {
            const dot = document.getElementById('rg-live-dot');
            const txt = document.getElementById('rg-live-txt');
            if (!dot || !txt) return;
            const map = { SUBSCRIBED:['#22c55e','🟢 En vivo'], CHANNEL_ERROR:['#ef4444','🔴 Sin señal'], TIMED_OUT:['#ef4444','🔴 Sin señal'] };
            const [col, lbl] = map[status] || ['#f59e0b', '🟡 Conectando…'];
            dot.style.background = col; txt.textContent = lbl;
        });
}

function detenerRealtime() {
    clearTimeout(_debTimer);
    if (_channel) { supabase.removeChannel(_channel); _channel = null; }
}

async function actualizarSilencioso() {
    if (!_container || !document.body.contains(_container)) { detenerRealtime(); return; }
    try {
        await cargarDatos();
        actualizarKpis();
        actualizarTimestamp();
        const body = document.getElementById('rg-emp-body');
        if (body) { body.innerHTML = buildEmpresasHTML(); bindDnD(); }
    } catch (e) { console.warn('[Reagrupacion]', e.message); }
}

// ─── Carga de datos ───────────────────────────────────────────────────────────
async function cargarDatos() {
    let todas = [], page = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select(`id,rut_huesped,nombre_huesped,huesped_confirmo,id_cama,
                     fecha_checkin,fecha_salida_programada,empresa_id,
                     v2_empresas(nombre),
                     v2_camas(habitacion_id,v2_habitaciones(numero_hab,cantidad_camas))`)
            .is('fecha_checkout', null)
            .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        todas = todas.concat(data);
        if (data.length < 1000) break;
        page++;
    }
    _state.asigs = todas;

    // Géneros y Turno (desde v2_solicitudes_b2b)
    // No usamos v2_asignaciones.genero ni v2_empresas.turno porque esas columnas
    // pueden no existir en la BD actual → los obtenemos de solicitudes.
    _state.generoMap = {};
    _state.turnoMap  = {};

    // Traer todas las solicitudes y mapear por RUT normalizado
    let solPage = 0;
    while (true) {
        const { data: rows } = await supabase
            .from('v2_solicitudes_b2b')
            .select('rut_trabajador,genero,turno')
            .range(solPage * 1000, solPage * 1000 + 999);
        if (!rows?.length) break;
        rows.forEach(r => {
            const key = normRut(r.rut_trabajador);
            if (r.genero) _state.generoMap[key] = r.genero;
            if (r.turno)  _state.turnoMap[key]  = r.turno;
        });
        if (rows.length < 1000) break;
        solPage++;
    }

    // Turno de empresa como fallback (solo si v2_empresas tiene la columna — la evitamos aquí)
    _state.empresaTurnos = {};

    // No confirmados
    _state.noConf = todas.filter(a => !a.huesped_confirmo);

    // Solos confirmados: habitaciones multi-cama con < capacidad de ocupantes, y quien está confirmó
    const porHab = {};
    for (const a of todas) {
        const hab  = a.v2_camas?.habitacion_id;
        const caps = a.v2_camas?.v2_habitaciones?.cantidad_camas || 1;
        if (!hab || caps < 2) continue;
        if (!porHab[hab]) porHab[hab] = { cap: caps, asigs: [] };
        porHab[hab].asigs.push(a);
    }
    _state.solosConf = Object.values(porHab)
        .filter(h => h.asigs.length < h.cap)
        .flatMap(h => h.asigs)
        .filter(a => a.huesped_confirmo);  // solo los que ya confirmaron

    _lastUpdate = new Date();

    // Reconstruir lista plana para DnD
    _soloPpl = _state.solosConf.map(a => {
        const key    = normRut(a.rut_huesped);
        const gen    = _state.generoMap[key] || '?';
        const turno  = _state.turnoMap[key] || _state.empresaTurnos[a.empresa_id] || '?';
        return {
            asigId:   a.id,
            camaId:   a.id_cama,
            habId:    a.v2_camas?.habitacion_id,
            habNum:   a.v2_camas?.v2_habitaciones?.numero_hab || a.v2_camas?.habitacion_id,
            nombre:   a.nombre_huesped || '—',
            rut:      a.rut_huesped || '—',
            empresa:  a.v2_empresas?.nombre || `Empresa ${a.empresa_id}`,
            empId:    a.empresa_id,
            gen, turno,
            llegada:  fmt(a.fecha_checkin),
            salida:   fmt(a.fecha_salida_programada),
        };
    });
}

// ─── Mover persona (ejecuta el movimiento) ────────────────────────────────────
async function ejecutarMover(dragged, target) {
    if (dragged.asigId === target.asigId) return;

    // Mostrar overlay
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `<div style="background:#fff;border-radius:20px;padding:32px;text-align:center;max-width:380px">
        <div style="font-size:32px;margin-bottom:8px">🔀</div>
        <div style="font-weight:800;font-size:15px">Moviendo a ${dragged.nombre}…</div>
        <div style="font-size:12px;color:#64748b;margin-top:6px">Hab.${dragged.habNum} → Hab.${target.habNum}</div>
    </div>`;
    document.body.appendChild(ov);

    try {
        // Encontrar cama libre real en habitación destino
        const { data: camasHab } = await supabase.from('v2_camas')
            .select('id_cama, estado').eq('habitacion_id', target.habId);
        const camaIds = (camasHab || []).map(c => c.id_cama);
        const { data: conReserva } = await supabase.from('v2_asignaciones')
            .select('id_cama').in('id_cama', camaIds).is('fecha_checkout', null);
        const reservadas = new Set((conReserva || []).map(a => a.id_cama));
        const camaLibre  = (camasHab || []).find(c => c.estado === 'Disponible' && !reservadas.has(c.id_cama));
        if (!camaLibre) throw new Error(`No hay cama libre en Hab.${target.habNum} — puede tener pre-asignaciones`);

        // Actualizar asignación
        const { error: eAsig } = await supabase.from('v2_asignaciones')
            .update({ id_cama: camaLibre.id_cama }).eq('id', dragged.asigId);
        if (eAsig) throw new Error(eAsig.message);

        // Marcar nueva cama ocupada
        await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', camaLibre.id_cama);

        // Liberar cama anterior (solo si no quedan asignaciones)
        const { data: otraAsig } = await supabase.from('v2_asignaciones')
            .select('id').eq('id_cama', dragged.camaId).is('fecha_checkout', null).limit(1);
        if (!otraAsig?.length) {
            await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', dragged.camaId).neq('estado', 'Deshabilitada');
        }

        // Guardar en log
        guardarLog({
            ts:         new Date().toLocaleString('es-CL'),
            nombre:     dragged.nombre,
            rut:        dragged.rut,
            empresa:    dragged.empresa,
            habOrigen:  dragged.habNum,
            camaOrigen: dragged.camaId,
            habDestino: target.habNum,
            camaDestino: camaLibre.id_cama,
            juntoCon:   target.nombre,
        });

        ov.remove();
        toast(`✅ ${dragged.nombre} movido a Hab.${target.habNum}`, 'success');

        // Recargar datos y re-render
        await cargarDatos();
        actualizarKpis();
        const body = document.getElementById('rg-emp-body');
        if (body) { body.innerHTML = buildEmpresasHTML(); bindDnD(); }

    } catch (e) {
        ov.remove();
        toast(`❌ ${e.message}`, 'error');
    }
}

// ─── Drag & Drop binding ──────────────────────────────────────────────────────
function bindDnD() {
    const body = document.getElementById('rg-emp-body');
    if (!body) return;

    body.addEventListener('dragstart', e => {
        const card = e.target.closest('[data-solo-idx]');
        if (!card) return;
        _dragIdx = parseInt(card.dataset.soloIdx);
        card.style.opacity = '0.5';
        e.dataTransfer.effectAllowed = 'move';
    }, { capture: true });

    body.addEventListener('dragend', e => {
        const card = e.target.closest('[data-solo-idx]');
        if (card) card.style.opacity = '1';
        // Quitar resaltado de todos
        body.querySelectorAll('[data-solo-idx]').forEach(c => {
            c.style.borderColor = '#e2e8f0';
            c.style.background  = '#fff';
        });
        _dragIdx = null;
    }, { capture: true });

    body.addEventListener('dragover', e => {
        const card = e.target.closest('[data-solo-idx]');
        if (!card) return;
        const tIdx = parseInt(card.dataset.soloIdx);
        const dragged = _soloPpl[_dragIdx];
        const target  = _soloPpl[tIdx];
        if (!dragged || !target) return;
        if (dragged.asigId === target.asigId) return;
        if (dragged.empId !== target.empId) return;
        if (dragged.gen !== target.gen && dragged.gen !== '?' && target.gen !== '?') return;
        // Bloquear si turnos conocidos y distintos
        if (dragged.turno !== '?' && target.turno !== '?' && dragged.turno !== target.turno) return;
        e.preventDefault();
        card.style.borderColor = '#22c55e';
        card.style.background  = '#f0fdf4';
    });

    body.addEventListener('dragleave', e => {
        const card = e.target.closest('[data-solo-idx]');
        if (card) { card.style.borderColor = '#e2e8f0'; card.style.background = '#fff'; }
    });

    body.addEventListener('drop', async e => {
        const card = e.target.closest('[data-solo-idx]');
        if (!card) return;
        e.preventDefault();
        card.style.borderColor = '#e2e8f0';
        card.style.background  = '#fff';
        const tIdx = parseInt(card.dataset.soloIdx);
        const dragged = _soloPpl[_dragIdx];
        const target  = _soloPpl[tIdx];
        if (!dragged || !target || dragged.asigId === target.asigId) return;
        if (dragged.empId !== target.empId) {
            toast('⚠️ No puedes mezclar empresas', 'warn'); return;
        }
        if (dragged.gen !== target.gen && dragged.gen !== '?' && target.gen !== '?') {
            toast(`⚠️ Géneros distintos: ${genLabel(dragged.gen)} ≠ ${genLabel(target.gen)}`, 'warn'); return;
        }
        if (dragged.turno !== '?' && target.turno !== '?' && dragged.turno !== target.turno) {
            toast(`⚠️ Turnos distintos: ${turnLabel(dragged.turno)} ≠ ${turnLabel(target.turno)}`, 'warn'); return;
        }
        _dragIdx = null;
        await ejecutarMover(dragged, target);
    });
}

// ─── Builders HTML ────────────────────────────────────────────────────────────
function buildSolosSection(solosEmp) {
    if (!solosEmp.length) return '';
    const cards = solosEmp.map(p => `
        <div draggable="true" data-solo-idx="${p._idx}"
             style="background:#fff;border:2px solid #e2e8f0;border-radius:12px;padding:12px 14px;cursor:grab;user-select:none;transition:border-color .2s,background .2s;display:flex;align-items:center;gap:10px">
            <div style="font-size:20px;color:#94a3b8;cursor:grab">⠿</div>
            <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px">${p.rut} · ${p.llegada} → ${p.salida}</div>
                <div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap">
                    <span style="font-size:10px;font-weight:700;color:${genColor(p.gen)};background:${p.gen==='M'?'#eff6ff':p.gen==='F'?'#fdf2f8':'#fff7ed'};padding:1px 7px;border-radius:99px;border:1px solid ${p.gen==='M'?'#bfdbfe':p.gen==='F'?'#fbcfe8':'#fed7aa'}">${genLabel(p.gen)}</span>
                    <span style="font-size:10px;font-weight:700;color:${turnColor(p.turno)};background:${p.turno&&p.turno.toLowerCase().includes('noche')?'#eef2ff':p.turno&&(p.turno.toLowerCase().includes('dia')||p.turno.toLowerCase().includes('día'))?'#fffbeb':'#f1f5f9'};padding:1px 7px;border-radius:99px;border:1px solid ${p.turno&&p.turno.toLowerCase().includes('noche')?'#c7d2fe':p.turno&&(p.turno.toLowerCase().includes('dia')||p.turno.toLowerCase().includes('día'))?'#fde68a':'#e2e8f0'}">${turnLabel(p.turno)}</span>
                </div>
            </div>
            <div style="flex-shrink:0">
                <span style="background:#fee2e2;color:#b91c1c;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700">Hab.${p.habNum}</span>
            </div>
        </div>`).join('');

    return `
    <div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:800;color:#15803d;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding:0 2px">
            ✅ Confirmados solos — arrastra uno sobre otro para juntar
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">
            ${cards}
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:6px;text-align:center">
            💡 Puedes juntar personas de la misma empresa, mismo género y mismo turno
        </div>
    </div>`;
}

function buildLogSection(empresa) {
    const log = leerLog().filter(e => e.empresa === empresa);
    if (!log.length) return '';
    const rows = log.slice(0, 10).map(e => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:12px;flex-wrap:wrap">
            <span style="color:#16a34a;font-size:14px">✅</span>
            <span style="font-weight:700">${e.nombre}</span>
            <span style="color:#64748b">·</span>
            <span style="background:#fee2e2;color:#b91c1c;padding:1px 7px;border-radius:5px;font-size:11px">Hab.${e.habOrigen}</span>
            <span style="color:#94a3b8">→</span>
            <span style="background:#dcfce7;color:#15803d;padding:1px 7px;border-radius:5px;font-size:11px">Hab.${e.habDestino}</span>
            <span style="color:#64748b">junto a <b>${e.juntoCon}</b></span>
            <span style="color:#94a3b8;margin-left:auto">${e.ts}</span>
        </div>`).join('');
    return `
    <div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:800;color:#6d28d9;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
            📋 Movimientos realizados
        </div>
        <div style="background:#faf5ff;border-radius:10px;padding:4px 12px;border:1px solid #ede9fe">
            ${rows}
        </div>
    </div>`;
}

// Muestra habitaciones con al menos 1 no-confirmado, ordenadas de menor a mayor
// Cada hab muestra TODOS sus ocupantes: verde=confirmado, rojo=no confirmado
function buildHabsConNcSection(empresa) {
    // Asignaciones de esta empresa
    const asigsEmp = _state.asigs.filter(a =>
        (a.v2_empresas?.nombre || `Empresa ${a.empresa_id}`) === empresa
    );

    // Agrupar por habitación
    const porHab = {};
    asigsEmp.forEach(a => {
        const habNum = String(a.v2_camas?.v2_habitaciones?.numero_hab || a.v2_camas?.habitacion_id || '?');
        if (!porHab[habNum]) porHab[habNum] = [];
        porHab[habNum].push(a);
    });

    // Solo habs que tienen al menos 1 no-confirmado
    const habsConNc = Object.entries(porHab)
        .filter(([, personas]) => personas.some(p => !p.huesped_confirmo))
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    if (!habsConNc.length) return '';

    const filas = habsConNc.map(([habNum, personas]) => {
        // Ordenar: confirmados primero, luego no confirmados
        const sorted = [...personas].sort((a, b) => (b.huesped_confirmo ? 1 : 0) - (a.huesped_confirmo ? 1 : 0));
        return sorted.map(p => {
            const conf  = !!p.huesped_confirmo;
            const bg    = conf ? '#f0fdf4' : '#fef2f2';
            const icon  = conf ? '\u2705' : '\u23f0';
            const color = conf ? '#15803d' : '#b91c1c';
            const key   = normRut(p.rut_huesped);
            const gen   = _state.generoMap[key] || '?';
            const turn  = _state.turnoMap[key]  || '?';
            return `
            <tr style="background:${bg};border-bottom:1px solid ${conf?'#dcfce7':'#fee2e2'}">
                <td style="padding:7px 12px;width:60px;text-align:center;font-size:16px">${icon}</td>
                <td style="padding:7px 12px;font-weight:700;font-size:12px;color:${color}">${p.nombre_huesped||'\u2014'}</td>
                <td style="padding:7px 12px;font-family:monospace;font-size:10px;color:#6366f1">${p.rut_huesped||'\u2014'}</td>
                <td style="padding:7px 12px">
                    <span style="background:${conf?'#dcfce7':'#fee2e2'};color:${color};border-radius:5px;padding:2px 8px;font-size:11px;font-weight:700">Hab.${habNum}</span>
                </td>
                <td style="padding:7px 12px;font-size:10px;font-family:monospace;color:#64748b">${p.id_cama||'\u2014'}</td>
                <td style="padding:7px 12px;font-size:10px;color:#94a3b8">${fmt(p.fecha_checkin)} \u2192 ${fmt(p.fecha_salida_programada)}</td>
                <td style="padding:7px 12px">
                    <span style="font-size:9px;font-weight:700;color:${genColor(gen)};background:${gen==='M'?'#eff6ff':gen==='F'?'#fdf2f8':'#fff7ed'};padding:1px 6px;border-radius:99px">${genLabel(gen)}</span>
                    <span style="font-size:9px;font-weight:700;color:${turnColor(turn)};background:#f1f5f9;padding:1px 6px;border-radius:99px;margin-left:3px">${turnLabel(turn)}</span>
                </td>
            </tr>`;
        }).join('');
    }).join('');

    const ncTotal = habsConNc.reduce((n, [, p]) => n + p.filter(x => !x.huesped_confirmo).length, 0);

    return `
    <div>
        <div style="font-size:11px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
            \u23f0 Sin confirmar llegada (${ncTotal}) \u2014 solo informativo \u00b7 ordenado hab. menor \u2192 mayor
        </div>
        <div style="font-size:10px;color:#64748b;margin-bottom:6px">
            <span style="color:#15803d;font-weight:700">\u2705 Verde</span> = confirm\u00f3 llegada &nbsp;|&nbsp;
            <span style="color:#b91c1c;font-weight:700">\u23f0 Rojo</span> = no confirm\u00f3
        </div>
        <div style="border-radius:10px;overflow:hidden;border:1px solid #fde68a">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead><tr style="background:#fffbeb">
                    <th style="padding:7px 12px;font-size:10px;color:#92400e;font-weight:700;text-transform:uppercase">\u2713</th>
                    <th style="padding:7px 12px;text-align:left;font-size:10px;color:#92400e;font-weight:700;text-transform:uppercase">Nombre</th>
                    <th style="padding:7px 12px;text-align:left;font-size:10px;color:#92400e;font-weight:700;text-transform:uppercase">RUT</th>
                    <th style="padding:7px 12px;text-align:left;font-size:10px;color:#92400e;font-weight:700;text-transform:uppercase">Hab.</th>
                    <th style="padding:7px 12px;text-align:left;font-size:10px;color:#92400e;font-weight:700;text-transform:uppercase">Cama</th>
                    <th style="padding:7px 12px;text-align:left;font-size:10px;color:#92400e;font-weight:700;text-transform:uppercase">Per\u00edodo</th>
                    <th style="padding:7px 12px;text-align:left;font-size:10px;color:#92400e;font-weight:700;text-transform:uppercase">G\u00e9n./Turno</th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>
    </div>`;
}


function buildEmpresasHTML() {
    // Asignar índices globales a los solos para DnD
    _soloPpl.forEach((p, i) => p._idx = i);

    // Recolectar todas las empresas que tienen solos o no-confirmados
    const empSet = new Set();
    _state.solosConf.forEach(a => empSet.add(a.v2_empresas?.nombre || `Empresa ${a.empresa_id}`));
    _state.noConf.forEach(a => empSet.add(a.v2_empresas?.nombre || `Empresa ${a.empresa_id}`));
    const empresas = [...empSet].sort();

    if (!empresas.length) return `<div style="text-align:center;padding:40px;color:#64748b">
        <div style="font-size:36px;margin-bottom:12px">✅</div>
        <div style="font-weight:700">Todo optimizado</div>
    </div>`;

    return empresas.map(emp => {
        const solosEmp = _soloPpl.filter(p => p.empresa === emp);
        const ncEmp    = _state.noConf.filter(a => (a.v2_empresas?.nombre || `Empresa ${a.empresa_id}`) === emp);

        const badges = [];
        if (solosEmp.length) badges.push(`<span style="background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700">✅ ${solosEmp.length} solo${solosEmp.length>1?'s':''} confirmado${solosEmp.length>1?'s':''}</span>`);
        if (ncEmp.length)    badges.push(`<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700">⏰ ${ncEmp.length} sin confirmar</span>`);

        const empId   = 'emp_' + emp.replace(/[^a-zA-Z0-9]/g, '_');
        const hasSolo = solosEmp.length > 0;
        const hasAny  = solosEmp.length > 0 || ncEmp.length > 0;
        // Click en empresa → toggle cuerpo; click en botón Excel → exportar solo esa empresa
        const empB64  = btoa(encodeURIComponent(emp));

        return `
        <div style="background:#fff;border-radius:16px;border:${hasSolo?'2px solid #bbf7d0':'1.5px solid #e2e8f0'};margin-bottom:16px;overflow:hidden">
            <div style="padding:14px 18px;background:${hasSolo?'linear-gradient(135deg,#f0fdf4,#dcfce7)':'linear-gradient(135deg,#f8fafc,#f1f5f9)'};border-bottom:1px solid ${hasSolo?'#bbf7d0':'#e2e8f0'};display:flex;align-items:center;gap:12px">
                <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#c0392b,#e74c3c);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px;flex-shrink:0">${emp.charAt(0).toUpperCase()}</div>
                <div style="flex:1;cursor:pointer" onclick="(function(id){var el=document.getElementById(id);el.style.display=el.style.display==='none'?'block':'none'}('${empId}'))">
                    <div style="font-weight:800;font-size:15px;color:#0f172a">${emp}</div>
                    <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">${badges.join('')}</div>
                </div>
                <button onclick="event.stopPropagation();window._rgExportarEmp('${empB64}')" title="Descargar Excel de ${emp}"
                    style="padding:6px 12px;border:none;border-radius:8px;background:#1d4ed8;color:#fff;font-weight:700;font-size:11px;cursor:pointer;flex-shrink:0">📊</button>
                <div style="color:#94a3b8;font-size:18px;cursor:pointer" onclick="(function(id){var el=document.getElementById(id);el.style.display=el.style.display==='none'?'block':'none'}('${empId}'))">▾</div>
            </div>
            <div id="${empId}" style="padding:16px 18px;display:${hasAny?'block':'none'}">
                ${buildSolosSection(solosEmp)}
                ${buildLogSection(emp)}
                ${buildHabsConNcSection(emp)}
            </div>
        </div>`;
    }).join('');
}

function buildKpisHTML() {
    const { asigs, noConf, solosConf } = _state;
    const log = leerLog();
    const kpis = [
        { id:'rg-kpi-0', icon:'🏠', val:asigs.length,      lbl:'Asignaciones activas', color:'#0369a1' },
        { id:'rg-kpi-1', icon:'✅', val:solosConf.length,  lbl:'Solos confirmados',    color:'#15803d' },
        { id:'rg-kpi-2', icon:'⏰', val:noConf.length,     lbl:'Sin confirmar',        color:'#d97706' },
        { id:'rg-kpi-3', icon:'📋', val:log.length,        lbl:'Movimientos hoy',      color:'#6d28d9' },
        { id:'rg-kpi-4', icon:'🏨', val:Math.floor(solosConf.length/2), lbl:'Habs. recuperables', color:'#c0392b' },
    ];
    return kpis.map(k => `
        <div style="background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 6px rgba(0,0,0,.06);border:1px solid #e2e8f0;text-align:center">
            <div style="font-size:20px;margin-bottom:4px">${k.icon}</div>
            <div id="${k.id}" style="font-size:24px;font-weight:900;color:${k.color};transition:transform .25s">${k.val}</div>
            <div style="font-size:10px;color:#64748b;font-weight:700;margin-top:2px;text-transform:uppercase;letter-spacing:.04em">${k.lbl}</div>
        </div>`).join('');
}

function actualizarKpis() {
    const { asigs, noConf, solosConf } = _state;
    const log = leerLog();
    [[`rg-kpi-0`,asigs.length],[`rg-kpi-1`,solosConf.length],[`rg-kpi-2`,noConf.length],
     [`rg-kpi-3`,log.length],[`rg-kpi-4`,Math.floor(solosConf.length/2)]].forEach(([id,val]) => {
        const el = document.getElementById(id);
        if (el && el.textContent !== String(val)) {
            el.style.transform = 'scale(1.3)';
            el.textContent     = val;
            setTimeout(() => el.style.transform = 'scale(1)', 250);
        }
    });
}

function actualizarTimestamp() {
    const el = document.getElementById('rg-last-update');
    if (el && _lastUpdate) el.textContent = `Actualizado: ${_lastUpdate.toLocaleTimeString('es-CL')}`;
}

// ─── Exportar Excel por empresa ──────────────────────────────────────────────
async function asegurarXLSX() {
    if (!window.XLSX) {
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
        await new Promise((r, j) => { s.onload = r; s.onerror = j; document.head.appendChild(s); });
    }
}

// Helper: filas de asignaciones ordenadas por hab y cama
function filasAsignaciones(lista) {
    return [...lista]
        .sort((a, b) => {
            const ha = String(a.v2_camas?.v2_habitaciones?.numero_hab || '').padStart(6,'0');
            const hb = String(b.v2_camas?.v2_habitaciones?.numero_hab || '').padStart(6,'0');
            if (ha !== hb) return ha.localeCompare(hb);
            return String(a.id_cama||'').localeCompare(String(b.id_cama||''));
        })
        .map(a => {
            const key = normRut(a.rut_huesped);
            return [
                a.v2_empresas?.nombre||'—',
                a.nombre_huesped||'—',
                a.rut_huesped||'—',
                a.v2_camas?.v2_habitaciones?.numero_hab||'—',
                a.id_cama||'—',
                fmt(a.fecha_checkin),
                fmt(a.fecha_salida_programada),
                _state.generoMap[key]||'?',
                _state.turnoMap[key]||'?',
                a.huesped_confirmo ? '✅ Confirmado' : '⏰ Sin confirmar',
            ];
        });
}

const HDR_ASIG = ['EMPRESA','NOMBRE','RUT','HAB.','CAMA','LLEGADA','SALIDA','GÉNERO','TURNO','ESTADO'];

async function exportarPorEmpresa(empB64) {
    await asegurarXLSX();
    const emp = decodeURIComponent(atob(empB64));
    const wb  = XLSX.utils.book_new();

    // 1. Solos confirmados de esta empresa
    const solosEmp = _state.solosConf.filter(a => (a.v2_empresas?.nombre||`Empresa ${a.empresa_id}`) === emp);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [`INFORME ${emp.toUpperCase()} — ${new Date().toLocaleString('es-CL')}`],
        [],
        ['Solos confirmados', solosEmp.length],
        ['Sin confirmar',      _state.noConf.filter(a => (a.v2_empresas?.nombre||`Empresa ${a.empresa_id}`) === emp).length],
    ]), 'Resumen');

    // 2. Solos confirmados (ordenados hab ↑ cama ↑)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [`✅ SOLOS CONFIRMADOS — ${emp}`],
        HDR_ASIG,
        ...filasAsignaciones(solosEmp),
    ]), 'Solos Confirmados');

    // 3. Habitaciones con no-confirmados (pares: confirmado verde / no confirmado rojo)
    const asigsEmp = _state.asigs.filter(a => (a.v2_empresas?.nombre||`Empresa ${a.empresa_id}`) === emp);
    const porHab = {};
    asigsEmp.forEach(a => {
        const h = String(a.v2_camas?.v2_habitaciones?.numero_hab || a.v2_camas?.habitacion_id || '?');
        if (!porHab[h]) porHab[h] = [];
        porHab[h].push(a);
    });
    const habsConNc = Object.entries(porHab)
        .filter(([, ps]) => ps.some(p => !p.huesped_confirmo))
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    const paresRows = [];
    habsConNc.forEach(([habNum, personas]) => {
        [...personas]
            .sort((a, b) => (b.huesped_confirmo ? 1 : 0) - (a.huesped_confirmo ? 1 : 0))
            .forEach(p => {
                const key = normRut(p.rut_huesped);
                paresRows.push([
                    habNum, p.id_cama||'—', p.nombre_huesped||'—', p.rut_huesped||'—',
                    fmt(p.fecha_checkin), fmt(p.fecha_salida_programada),
                    _state.generoMap[key]||'?', _state.turnoMap[key]||'?',
                    p.huesped_confirmo ? '✅ Confirmado' : '⏰ Sin confirmar',
                ]);
            });
        paresRows.push(['---']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [`⏰ HABITACIONES CON NO-CONFIRMADOS — ${emp} · Ordenado hab. menor→mayor`],
        ['HAB.','CAMA','NOMBRE','RUT','LLEGADA','SALIDA','GÉNERO','TURNO','ESTADO'],
        ...paresRows,
    ]), 'Habs No Confirmados');

    // 4. Registro de movimientos de esta empresa
    const log = leerLog().filter(e => e.empresa === emp);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['FECHA','NOMBRE','RUT','HAB. ORIGEN','CAMA ORIGEN','HAB. DESTINO','CAMA DESTINO','JUNTO A'],
        ...log.map(e => [e.ts,e.nombre,e.rut,e.habOrigen,e.camaOrigen,e.habDestino,e.camaDestino,e.juntoCon]),
    ]), 'Movimientos');

    const safe = emp.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
    XLSX.writeFile(wb, `Reagrupacion_${safe}_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast(`📥 Excel de ${emp} descargado`, 'success');
}

async function exportarInforme() {
    await asegurarXLSX();
    const wb  = XLSX.utils.book_new();
    const log = leerLog();

    // Resumen
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['INFORME REAGRUPACIÓN GENERAL — PC HOTELERÍA', '', new Date().toLocaleString('es-CL')],
        [],
        ['Asignaciones activas',        _state.asigs.length],
        ['Solos confirmados',            _state.solosConf.length],
        ['Sin confirmar llegada',         _state.noConf.length],
        ['Habs. recuperables (estimado)', Math.floor(_state.solosConf.length/2)],
        ['Movimientos realizados',        log.length],
    ]), 'Resumen');

    // Solos confirmados (todas las empresas, ordenados hab↑ cama↑)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['✅ SOLOS CONFIRMADOS — TODAS LAS EMPRESAS'],
        HDR_ASIG,
        ...filasAsignaciones(_state.solosConf),
    ]), 'Solos Confirmados');

    // Sin confirmar (ordenados hab↑ cama↑)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['⏰ SIN CONFIRMAR — TODAS LAS EMPRESAS'],
        HDR_ASIG,
        ...filasAsignaciones(_state.noConf),
    ]), 'Sin Confirmar');

    // Registro movimientos
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['FECHA','NOMBRE','RUT','EMPRESA','HAB. ORIGEN','CAMA ORIGEN','HAB. DESTINO','CAMA DESTINO','JUNTO A'],
        ...log.map(e => [e.ts,e.nombre,e.rut,e.empresa,e.habOrigen,e.camaOrigen,e.habDestino,e.camaDestino,e.juntoCon]),
    ]), 'Registro Movimientos');

    XLSX.writeFile(wb, `Reagrupacion_General_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast('📥 Informe general descargado', 'success');
}

// ─── Render Principal ─────────────────────────────────────────────────────────
export async function renderReagrupacion(container) {
    _container = container;
    detenerRealtime();

    container.innerHTML = `
    <div style="padding:22px 18px;max-width:1100px;margin:0 auto">
        <!-- Cabecera -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
            <div>
                <h2 style="font-size:20px;font-weight:900;margin:0;color:var(--text-primary)">🔀 Reagrupación por Empresa</h2>
                <p style="font-size:12px;color:#64748b;margin:3px 0 0">Arrastra solos confirmados para juntarlos · No confirmados abajo · En vivo</p>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:6px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:99px;padding:5px 14px">
                    <div id="rg-live-dot" style="width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:rgPulse 1.4s infinite"></div>
                    <span id="rg-live-txt" style="font-size:12px;font-weight:700;color:#15803d">Conectando…</span>
                </div>
                <span id="rg-last-update" style="font-size:11px;color:#94a3b8"></span>
                <button onclick="window._rgExportar()" style="padding:8px 18px;border:none;border-radius:10px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#fff;font-weight:700;font-size:13px;cursor:pointer">📊 Excel</button>
                <button onclick="window._rgRecargar()" style="padding:8px 14px;border:1.5px solid #e2e8f0;border-radius:10px;background:#fff;color:#374151;font-weight:700;font-size:13px;cursor:pointer">🔄</button>
            </div>
        </div>
        <!-- KPIs -->
        <div id="rg-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:20px">
            <div style="grid-column:1/-1;text-align:center;padding:30px;color:#94a3b8"><div style="font-size:28px;margin-bottom:6px">⏳</div>Cargando…</div>
        </div>
        <!-- Cuerpo -->
        <div id="rg-emp-body">
            <div style="text-align:center;padding:30px;color:#94a3b8"><div style="font-size:28px;margin-bottom:6px">⏳</div></div>
        </div>
    </div>
    <style>
        @keyframes rgPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}
        [data-solo-idx]:hover{border-color:#94a3b8!important;cursor:grab}
        [data-solo-idx]:active{cursor:grabbing;opacity:.7}
    </style>`;

    window._rgExportar    = exportarInforme;
    window._rgExportarEmp = exportarPorEmpresa;
    window._rgRecargar    = () => renderReagrupacion(container);

    try {
        await cargarDatos();
        document.getElementById('rg-kpis').innerHTML   = buildKpisHTML();
        document.getElementById('rg-emp-body').innerHTML = buildEmpresasHTML();
        actualizarTimestamp();
        bindDnD();
        iniciarRealtime();
    } catch (e) {
        document.getElementById('rg-emp-body').innerHTML = `
            <div style="background:#fef2f2;border:2px solid #fecaca;border-radius:16px;padding:32px;text-align:center">
                <div style="font-size:32px;margin-bottom:10px">❌</div>
                <div style="font-weight:800;color:#b91c1c;margin-bottom:6px">Error al cargar</div>
                <div style="font-size:13px;color:#64748b">${e.message}</div>
            </div>`;
    }
}
