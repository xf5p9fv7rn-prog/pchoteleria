/**
 * v2-anglo.js — Módulo Asignación Anglo
 * Búsqueda por RUT → datos trabajador → asignar hab + llave
 * Registro de incidencias: sin llave / bajó anticipado
 */
import { supabase } from '../../supabaseClient.js';

// Determina color de llave según turno
function colorLlave(turno = '') {
    const t = turno.toLowerCase();
    // Turno administrativo o 5x2 = día = verde
    if (t.includes('adm') || t.includes('5x2') || t.includes('día') || t.includes('dia')) return 'verde';
    return 'rojo'; // Rotativo 4x4, 7x7, 4x3 = noche = rojo
}

function llaveBadge(turno) {
    const c = colorLlave(turno);
    return c === 'verde'
        ? `<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🗝️ Llave VERDE (Día)</span>`
        : `<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🗝️ Llave ROJA (Noche)</span>`;
}

let _timer = null;

export async function renderV2Anglo(container) {
    container.innerHTML = `
    <div style="max-width:900px;margin:0 auto;padding:0 4px">

      <!-- BÚSQUEDA RUT -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:8px">
          🔍 Buscar trabajador Anglo por RUT
        </label>
        <input id="anglo-rut-input" type="text" placeholder="Ingresa el RUT (solo números, ej: 12345678)"
          style="width:100%;padding:12px 16px;border-radius:12px;border:1.5px solid var(--border);
                 background:var(--bg);color:var(--text-primary);font-size:16px;outline:none;
                 transition:border-color .2s;box-sizing:border-box"
          oninput="window._angloSearch(this.value)">

        <!-- Card del trabajador -->
        <div id="anglo-user-card" style="display:none;margin-top:14px;padding:16px;
             background:linear-gradient(135deg,rgba(249,115,22,.08),rgba(249,115,22,.04));
             border:1.5px solid #f97316;border-radius:14px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
            <div>
              <div id="anglo-nombre" style="font-size:18px;font-weight:800;color:var(--text-primary)"></div>
              <div id="anglo-cargo" style="font-size:13px;color:#f97316;font-weight:600;margin-top:2px"></div>
              <div id="anglo-gerencia" style="font-size:12px;color:var(--text-muted);margin-top:2px"></div>
              <div id="anglo-turno-txt" style="font-size:12px;color:var(--text-muted);margin-top:2px"></div>
            </div>
            <div id="anglo-llave-badge"></div>
          </div>
          <!-- Alertas de incidencias históricas -->
          <div id="anglo-alertas" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"></div>
        </div>

        <!-- FORM ASIGNACIÓN -->
        <div id="anglo-form" style="display:none;margin-top:14px;padding:16px;
             background:var(--bg-card);border:1px solid var(--border);border-radius:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div>
              <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">N° Habitación</label>
              <input id="anglo-hab" type="text" placeholder="Ej: 4119"
                style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid var(--border);
                       background:var(--bg);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Fecha Salida Programada</label>
              <input id="anglo-salida" type="date"
                style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid var(--border);
                       background:var(--bg);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box">
            </div>
          </div>
          <button onclick="window._angloAsignar()"
            style="background:#f97316;color:#fff;border:none;border-radius:10px;padding:12px 24px;
                   font-weight:800;font-size:14px;cursor:pointer;width:100%;transition:.15s"
            onmouseover="this.style.background='#ea6c10'" onmouseout="this.style.background='#f97316'">
            ✅ Registrar Asignación
          </button>
          <div id="anglo-msg" style="display:none;margin-top:10px;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600"></div>
        </div>
      </div>

      <!-- TABS: Registro / Incidencias -->
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button id="tab-reg-btn" onclick="window._angloTab('registro')"
          style="padding:9px 18px;border-radius:10px;border:1.5px solid #f97316;background:rgba(249,115,22,.12);
                 color:#f97316;font-weight:800;font-size:13px;cursor:pointer">
          📋 Registro Activo
        </button>
        <button id="tab-inc-btn" onclick="window._angloTab('incidencias')"
          style="padding:9px 18px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);
                 color:var(--text-muted);font-weight:700;font-size:13px;cursor:pointer">
          ⚠️ Incidencias
        </button>
        <input id="anglo-search" type="text" placeholder="🔍 Filtrar lista…"
          style="flex:1;padding:9px 14px;border-radius:10px;border:1.5px solid var(--border);
                 background:var(--bg);color:var(--text-primary);font-size:13px;outline:none"
          oninput="window._angloFiltrar(this.value)">
      </div>

      <!-- LISTA REGISTRO -->
      <div id="anglo-tab-registro">
        <div id="anglo-lista" style="display:flex;flex-direction:column;gap:10px">
          <div style="color:var(--text-muted);text-align:center;padding:30px">Cargando…</div>
        </div>
      </div>

      <!-- LISTA INCIDENCIAS -->
      <div id="anglo-tab-incidencias" style="display:none">
        <div id="anglo-incid-lista" style="display:flex;flex-direction:column;gap:10px">
          <div style="color:var(--text-muted);text-align:center;padding:30px">Cargando…</div>
        </div>
      </div>

    </div>`;

    // Inicializar datos
    await _cargarRegistro();
    await _cargarIncidencias();
    _bindGlobals();
}

// ─── Estado módulo ────────────────────────────────────────────────
let _rut = null, _turno = null, _registro = [], _incidencias = [], _tabActual = 'registro';

function _bindGlobals() {
    window._angloSearch = (val) => {
        clearTimeout(_timer);
        const rut = val.replace(/\D/g, '');
        if (rut.length < 6) {
            document.getElementById('anglo-user-card').style.display = 'none';
            document.getElementById('anglo-form').style.display = 'none';
            _rut = null; return;
        }
        _timer = setTimeout(() => _buscarRut(rut), 350);
    };
    window._angloAsignar = _registrarAsignacion;
    window._angloTab = _switchTab;
    window._angloFiltrar = _filtrar;
    window._angloMarcarSinLlave = _marcarSinLlave;
    window._angloMarcarBaja = _marcarBajaAnticipada;
    window._angloMarcarDevuelta = _marcarDevuelta;
}

// ─── BÚSQUEDA RUT ─────────────────────────────────────────────────
async function _buscarRut(rut) {
    const { data } = await supabase
        .from('v2_usuarios_anglo').select('*').eq('rut', rut).maybeSingle();

    const card = document.getElementById('anglo-user-card');
    const form = document.getElementById('anglo-form');
    if (!data) { card.style.display = 'none'; form.style.display = 'none'; _rut = null; return; }

    _rut = data.rut; _turno = data.turno || '';
    document.getElementById('anglo-nombre').textContent = data.nombre;
    document.getElementById('anglo-cargo').textContent = '💼 ' + (data.cargo || '—');
    document.getElementById('anglo-gerencia').textContent = '🏢 ' + (data.gerencia || '—');
    document.getElementById('anglo-turno-txt').textContent = '🔄 ' + (_turno || '—');
    document.getElementById('anglo-llave-badge').innerHTML = llaveBadge(_turno);
    card.style.display = 'block';
    form.style.display = 'block';

    // Alertas históricas
    const [{ count: sl }, { count: ba }] = await Promise.all([
        supabase.from('v2_incidencias_anglo').select('*', { count: 'exact', head: true }).eq('rut', rut).eq('tipo', 'sin_llave'),
        supabase.from('v2_incidencias_anglo').select('*', { count: 'exact', head: true }).eq('rut', rut).eq('tipo', 'bajo_anticipado'),
    ]);
    const alertDiv = document.getElementById('anglo-alertas');
    alertDiv.innerHTML = '';
    if (sl > 0) alertDiv.innerHTML += `<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">🔑 ${sl} vez${sl > 1 ? 'es' : ''} sin devolver llave</span>`;
    if (ba > 0) alertDiv.innerHTML += `<span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">🏃 ${ba} vez${ba > 1 ? 'es' : ''} bajó anticipado</span>`;
    if (!sl && !ba) alertDiv.innerHTML = '<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700">✅ Sin incidencias previas</span>';
}

// ─── REGISTRAR ASIGNACIÓN ─────────────────────────────────────────
async function _registrarAsignacion() {
    const msg = (t, ok) => {
        const el = document.getElementById('anglo-msg');
        el.textContent = t;
        el.style.display = 'block';
        el.style.background = ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)';
        el.style.color = ok ? '#166534' : '#991b1b';
    };
    if (!_rut) { msg('⚠️ Busca un trabajador primero', false); return; }
    const hab = document.getElementById('anglo-hab').value.trim();
    const salida = document.getElementById('anglo-salida').value;
    if (!hab) { msg('⚠️ Ingresa el número de habitación', false); return; }

    const llave = colorLlave(_turno); // 'verde' o 'rojo'
    // Desactivar asignaciones activas previas
    await supabase.from('v2_asignaciones_anglo').update({ activa: false }).eq('rut', _rut).eq('activa', true);
    const { error } = await supabase.from('v2_asignaciones_anglo').insert({
        rut: _rut, numero_hab: hab,
        fecha_asignacion: new Date().toISOString().split('T')[0],
        fecha_salida_prog: salida || null,
        color_llave: llave,
        llave_entregada: true, activa: true
    });
    if (error) { msg('❌ ' + error.message, false); return; }
    msg(`✅ Asignado HAB ${hab} · Llave ${llave === 'verde' ? '🟢 Verde' : '🔴 Roja'}`, true);
    document.getElementById('anglo-hab').value = '';
    document.getElementById('anglo-salida').value = '';
    await _cargarRegistro();
    setTimeout(() => { const el = document.getElementById('anglo-msg'); if (el) el.style.display = 'none'; }, 4000);
}

// ─── REGISTRO ACTIVO ──────────────────────────────────────────────
async function _cargarRegistro() {
    const { data } = await supabase
        .from('v2_asignaciones_anglo')
        .select('*, v2_usuarios_anglo(nombre, cargo, turno)')
        .eq('activa', true)
        .order('fecha_asignacion', { ascending: false })
        .limit(200);
    _registro = data || [];
    _renderRegistro(_registro);
}

function _renderRegistro(rows) {
    const el = document.getElementById('anglo-lista');
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:30px">Sin asignaciones activas</div>'; return; }
    el.innerHTML = rows.map(r => {
        const u = r.v2_usuarios_anglo || {};
        const llave = r.color_llave || colorLlave(u.turno || '');
        const llaveIcon = llave === 'verde' ? '🟢🗝️' : '🔴🗝️';
        const devuelta = r.llave_devuelta;
        return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-weight:800;font-size:15px">${u.nombre || r.rut}</div>
              <div style="font-size:12px;color:var(--text-muted)">${u.cargo || ''}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                🏠 HAB <b>${r.numero_hab}</b> &nbsp;·&nbsp;
                ${llaveIcon} &nbsp;·&nbsp;
                📅 ${r.fecha_asignacion || ''}
                ${r.fecha_salida_prog ? `&nbsp;→ Sale: <b>${r.fecha_salida_prog}</b>` : ''}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              ${!devuelta ? `<button onclick="window._angloMarcarDevuelta(${r.id})"
                style="background:rgba(34,197,94,.15);color:#166534;border:none;border-radius:8px;
                       padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">
                🗝️ Devolvió llave</button>` :
                `<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700">✅ Llave devuelta</span>`}
              <button onclick="window._angloMarcarSinLlave('${r.rut}')"
                style="background:rgba(239,68,68,.12);color:#991b1b;border:none;border-radius:8px;
                       padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">
                ❌ Sin llave</button>
              <button onclick="window._angloMarcarBaja('${r.rut}')"
                style="background:rgba(245,158,11,.12);color:#92400e;border:none;border-radius:8px;
                       padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">
                🏃 Bajó antes</button>
            </div>
          </div>
        </div>`;
    }).join('');
}

// ─── INCIDENCIAS ──────────────────────────────────────────────────
async function _cargarIncidencias() {
    const { data } = await supabase
        .from('v2_incidencias_anglo')
        .select('*, v2_usuarios_anglo(nombre, cargo)')
        .order('created_at', { ascending: false })
        .limit(300);
    _incidencias = data || [];
    _renderIncidencias(_incidencias);
}

function _renderIncidencias(rows) {
    const el = document.getElementById('anglo-incid-lista');
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:30px">Sin incidencias registradas</div>'; return; }

    // Agrupar por RUT
    const byRut = {};
    rows.forEach(r => { if (!byRut[r.rut]) byRut[r.rut] = []; byRut[r.rut].push(r); });

    el.innerHTML = Object.entries(byRut).map(([rut, items]) => {
        const nombre = items[0].v2_usuarios_anglo?.nombre || rut;
        const cargo = items[0].v2_usuarios_anglo?.cargo || '';
        const sl = items.filter(i => i.tipo === 'sin_llave').length;
        const ba = items.filter(i => i.tipo === 'bajo_anticipado').length;
        return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <div>
              <div style="font-weight:800;font-size:15px">${nombre}</div>
              <div style="font-size:12px;color:var(--text-muted)">${cargo} · ${rut}</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${sl > 0 ? `<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🔑 ${sl} sin llave</span>` : ''}
              ${ba > 0 ? `<span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🏃 ${ba} bajó anticipado</span>` : ''}
            </div>
          </div>
          ${items.map(i => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.04)">
              <span style="font-size:16px;width:24px;text-align:center">${i.tipo === 'sin_llave' ? '🔑' : '🏃'}</span>
              <div style="flex:1">
                <span style="font-size:12px;font-weight:700">${i.tipo === 'sin_llave' ? 'Sin llave' : 'Bajó anticipado'}</span>
                <span style="font-size:11px;color:var(--text-muted);margin-left:8px">📅 ${i.fecha || (i.created_at||'').slice(0,10)}</span>
                ${i.observacion ? `<div style="font-size:11px;color:var(--text-muted)">${i.observacion}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>`;
    }).join('');
}

// ─── ACCIONES INCIDENCIAS ─────────────────────────────────────────
async function _marcarSinLlave(rut) {
    const obs = prompt('Observación (opcional):') || null;
    await supabase.from('v2_incidencias_anglo').insert({
        rut, tipo: 'sin_llave', fecha: new Date().toISOString().split('T')[0], observacion: obs
    });
    await _cargarRegistro();
    await _cargarIncidencias();
    // Actualizar alertas si este RUT está activo en la búsqueda
    if (_rut === rut) _buscarRut(rut);
}

async function _marcarBajaAnticipada(rut) {
    const obs = prompt('Fecha y observación (opcional):') || null;
    await supabase.from('v2_incidencias_anglo').insert({
        rut, tipo: 'bajo_anticipado', fecha: new Date().toISOString().split('T')[0], observacion: obs
    });
    await _cargarRegistro();
    await _cargarIncidencias();
    if (_rut === rut) _buscarRut(rut);
}

async function _marcarDevuelta(id) {
    await supabase.from('v2_asignaciones_anglo')
        .update({ llave_devuelta: true, fecha_devolucion: new Date().toISOString().split('T')[0] })
        .eq('id', id);
    await _cargarRegistro();
}

// ─── TABS y FILTRO ────────────────────────────────────────────────
function _switchTab(tab) {
    _tabActual = tab;
    document.getElementById('anglo-tab-registro').style.display = tab === 'registro' ? 'block' : 'none';
    document.getElementById('anglo-tab-incidencias').style.display = tab === 'incidencias' ? 'block' : 'none';
    const btnR = document.getElementById('tab-reg-btn');
    const btnI = document.getElementById('tab-inc-btn');
    if (tab === 'registro') {
        btnR.style.borderColor = '#f97316'; btnR.style.background = 'rgba(249,115,22,.12)'; btnR.style.color = '#f97316';
        btnI.style.borderColor = 'var(--border)'; btnI.style.background = 'var(--bg-card)'; btnI.style.color = 'var(--text-muted)';
    } else {
        btnI.style.borderColor = '#f97316'; btnI.style.background = 'rgba(249,115,22,.12)'; btnI.style.color = '#f97316';
        btnR.style.borderColor = 'var(--border)'; btnR.style.background = 'var(--bg-card)'; btnR.style.color = 'var(--text-muted)';
    }
}

function _filtrar(q) {
    const ql = q.toLowerCase();
    if (_tabActual === 'registro') {
        _renderRegistro(_registro.filter(r =>
            (r.v2_usuarios_anglo?.nombre || '').toLowerCase().includes(ql) ||
            r.rut.includes(q) || r.numero_hab.includes(q)
        ));
    } else {
        _renderIncidencias(_incidencias.filter(r =>
            (r.v2_usuarios_anglo?.nombre || '').toLowerCase().includes(ql) || r.rut.includes(q)
        ));
    }
}
