/**
 * v2-anglo.js — Asignación Anglo integrada con el sistema de camas
 */
import { supabase } from '../../supabaseClient.js';
import { doCheckin } from '../v2-service.js';

// Llave verde = turno Adm/día, roja = rotativo (4x4, 7x7)
function colorLlave(turno = '') {
    const t = turno.toLowerCase();
    return (t.includes('adm') || t.includes('5x2')) ? 'verde' : 'rojo';
}

let _timer = null, _rut = null, _turno = '', _registro = [], _incidencias = [], _tabActual = 'registro';

export async function renderV2Anglo(container) {
    container.innerHTML = `
    <div style="max-width:900px;margin:0 auto">

      <!-- BÚSQUEDA -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:8px">
          ⛏️ Buscar trabajador Anglo por RUT
        </label>
        <input id="anglo-rut" type="text" placeholder="Ingresa el RUT (solo números)"
          style="width:100%;padding:12px 16px;border-radius:12px;border:1.5px solid var(--border);
                 background:var(--bg);color:var(--text-primary);font-size:16px;outline:none;box-sizing:border-box"
          oninput="window._angloSearch(this.value)">

        <!-- Card trabajador -->
        <div id="anglo-card" style="display:none;margin-top:14px;padding:14px;
             background:rgba(249,115,22,.06);border:1.5px solid #f97316;border-radius:14px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div>
              <div id="ac-nombre" style="font-size:17px;font-weight:800"></div>
              <div id="ac-cargo" style="font-size:13px;color:#f97316;font-weight:600;margin-top:2px"></div>
              <div id="ac-gerencia" style="font-size:12px;color:var(--text-muted)"></div>
              <div id="ac-turno" style="font-size:12px;color:var(--text-muted)"></div>
            </div>
            <div id="ac-llave" style="align-self:center"></div>
          </div>
          <div id="ac-alertas" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"></div>
        </div>

        <!-- Formulario -->
        <div id="anglo-form" style="display:none;margin-top:14px;padding:16px;
             background:var(--bg-card);border:1px solid var(--border);border-radius:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
            <div>
              <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">N° Habitación</label>
              <input id="anglo-hab" type="text" placeholder="Ej: 4119"
                style="width:100%;padding:10px;border-radius:10px;border:1.5px solid var(--border);
                       background:var(--bg);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Fecha salida programada</label>
              <input id="anglo-salida" type="date"
                style="width:100%;padding:10px;border-radius:10px;border:1.5px solid var(--border);
                       background:var(--bg);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box">
            </div>
          </div>
          <button onclick="window._angloAsignar()"
            style="background:#f97316;color:#fff;border:none;border-radius:10px;padding:12px;
                   font-weight:800;font-size:14px;cursor:pointer;width:100%">
            ✅ Cargar en Habitación
          </button>
          <div id="anglo-msg" style="display:none;margin-top:10px;padding:10px;border-radius:8px;font-size:13px;font-weight:600"></div>
        </div>
      </div>

      <!-- TABS -->
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button id="tab-btn-registro" onclick="window._angloTab('registro')"
          style="padding:9px 16px;border-radius:10px;border:1.5px solid #f97316;background:rgba(249,115,22,.12);
                 color:#f97316;font-weight:800;font-size:13px;cursor:pointer">📋 Registro Activo</button>
        <button id="tab-btn-incidencias" onclick="window._angloTab('incidencias')"
          style="padding:9px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);
                 color:var(--text-muted);font-weight:700;font-size:13px;cursor:pointer">⚠️ Incidencias</button>
        <input placeholder="🔍 Filtrar..." oninput="window._angloFiltrar(this.value)"
          style="flex:1;min-width:150px;padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);
                 background:var(--bg);color:var(--text-primary);font-size:13px;outline:none">
      </div>

      <div id="tab-registro"><div id="anglo-lista" style="display:flex;flex-direction:column;gap:10px"><p style="color:var(--text-muted);text-align:center;padding:30px">Cargando…</p></div></div>
      <div id="tab-incidencias" style="display:none"><div id="anglo-incid-lista" style="display:flex;flex-direction:column;gap:10px"><p style="color:var(--text-muted);text-align:center;padding:30px">Cargando…</p></div></div>
    </div>`;

    _bindGlobals();
    await Promise.all([_cargarRegistro(), _cargarIncidencias()]);
}

// ─── GLOBALS ──────────────────────────────────────────────────────
function _bindGlobals() {
    window._angloSearch = v => { clearTimeout(_timer); const r = v.replace(/\D/g,''); if (r.length < 6) { _hideCard(); return; } _timer = setTimeout(() => _buscar(r), 350); };
    window._angloAsignar = _asignar;
    window._angloTab = _switchTab;
    window._angloFiltrar = _filtrar;
    window._angloSinLlave = _sinLlave;
    window._angloBaja = _bajaAnticipada;
    window._angloDevuelta = _devuelta;
}

function _hideCard() { document.getElementById('anglo-card').style.display='none'; document.getElementById('anglo-form').style.display='none'; _rut=null; }

// ─── BUSCAR RUT ───────────────────────────────────────────────────
async function _buscar(rut) {
    const { data } = await supabase.from('v2_usuarios_anglo').select('*').eq('rut', rut).maybeSingle();
    if (!data) { _hideCard(); return; }
    _rut = data.rut; _turno = data.turno || '';
    document.getElementById('ac-nombre').textContent = data.nombre;
    document.getElementById('ac-cargo').textContent = '💼 ' + (data.cargo || '—');
    document.getElementById('ac-gerencia').textContent = '🏢 ' + (data.gerencia || '—');
    document.getElementById('ac-turno').textContent = '🔄 ' + (_turno || '—');
    const llave = colorLlave(_turno);
    document.getElementById('ac-llave').innerHTML = llave === 'verde'
        ? `<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:5px 12px;font-weight:800;font-size:13px">🟢 Llave Verde · Día</span>`
        : `<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:5px 12px;font-weight:800;font-size:13px">🔴 Llave Roja · Noche</span>`;
    document.getElementById('anglo-card').style.display = 'block';
    document.getElementById('anglo-form').style.display = 'block';

    // Alertas históricas
    const [{ count: sl }, { count: ba }] = await Promise.all([
        supabase.from('v2_incidencias_anglo').select('*',{count:'exact',head:true}).eq('rut',rut).eq('tipo','sin_llave'),
        supabase.from('v2_incidencias_anglo').select('*',{count:'exact',head:true}).eq('rut',rut).eq('tipo','bajo_anticipado'),
    ]);
    const al = document.getElementById('ac-alertas');
    al.innerHTML = '';
    if (sl > 0) al.innerHTML += `<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">🔑 ${sl}x sin devolver llave</span>`;
    if (ba > 0) al.innerHTML += `<span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">🏃 ${ba}x bajó anticipado</span>`;
    if (!sl && !ba) al.innerHTML = '<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700">✅ Sin incidencias</span>';
}

// ─── ASIGNAR HABITACIÓN (integra con sistema de camas) ─────────────
async function _asignar() {
    const msgEl = document.getElementById('anglo-msg');
    const msg = (t, ok) => { msgEl.textContent=t; msgEl.style.display='block'; msgEl.style.background=ok?'rgba(34,197,94,.15)':'rgba(239,68,68,.15)'; msgEl.style.color=ok?'#166534':'#991b1b'; };
    if (!_rut) { msg('⚠️ Busca un trabajador primero', false); return; }
    const hab = document.getElementById('anglo-hab').value.trim();
    const salida = document.getElementById('anglo-salida').value;
    if (!hab) { msg('⚠️ Ingresa el número de habitación', false); return; }

    msg('⏳ Buscando habitación…', true);

    // 1. Buscar habitación por número
    const { data: habs } = await supabase.from('v2_habitaciones').select('id_custom').ilike('numero_hab', hab);
    if (!habs?.length) { msg('❌ Habitación ' + hab + ' no encontrada en el sistema', false); return; }
    const habId = habs[0].id_custom;

    // 2. Buscar primera cama disponible en esa habitación
    const { data: camas } = await supabase.from('v2_camas').select('id_cama').eq('habitacion_id', habId).eq('estado','Disponible').limit(1);
    if (!camas?.length) { msg('❌ No hay camas disponibles en HAB ' + hab, false); return; }
    const camaId = camas[0].id_cama;

    // 3. Buscar o crear empresa "Anglo American" en el sistema
    let { data: emp } = await supabase.from('v2_empresas').select('id').ilike('nombre','Anglo%').maybeSingle();
    if (!emp) {
        const { data: newEmp } = await supabase.from('v2_empresas').insert({ nombre: 'Anglo American', turno: '4x4' }).select('id').single();
        emp = newEmp;
    }
    const empresaId = emp?.id;

    // 4. Check-in en el sistema principal (aparece en Infraestructura)
    const hoy = new Date().toISOString().split('T')[0];
    try {
        await doCheckin({ idCama: camaId, rutHuesped: _rut, nombreHuesped: document.getElementById('ac-nombre').textContent,
            empresaId, fechaCheckin: hoy, fechaSalidaProgramada: salida || null, esPreAsignacion: false });
    } catch (e) { msg('❌ ' + e.message, false); return; }

    // 5. Actualizar estado cama a Ocupada
    await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', camaId);

    // 6. Registro Anglo (control de llaves)
    const llave = colorLlave(_turno);
    await supabase.from('v2_asignaciones_anglo').upsert({
        rut: _rut, numero_hab: hab, color_llave: llave,
        fecha_asignacion: hoy, fecha_salida_prog: salida || null,
        llave_entregada: true, activa: true
    }, { onConflict: 'rut' });

    msg(`✅ ${document.getElementById('ac-nombre').textContent} → HAB ${hab} · Llave ${llave==='verde'?'🟢':'🔴'}`, true);
    document.getElementById('anglo-hab').value = '';
    document.getElementById('anglo-salida').value = '';
    document.getElementById('anglo-rut').value = '';
    _hideCard();
    await _cargarRegistro();
    setTimeout(() => { msgEl.style.display='none'; }, 5000);
}

// ─── REGISTRO ─────────────────────────────────────────────────────
async function _cargarRegistro() {
    const { data } = await supabase.from('v2_asignaciones_anglo')
        .select('*, v2_usuarios_anglo(nombre,cargo,turno)')
        .eq('activa', true).order('fecha_asignacion', { ascending: false }).limit(300);
    _registro = data || [];
    _renderReg(_registro);
}

function _renderReg(rows) {
    const el = document.getElementById('anglo-lista');
    if (!el) return;
    if (!rows.length) { el.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:30px">Sin asignaciones activas</p>'; return; }
    el.innerHTML = rows.map(r => {
        const u = r.v2_usuarios_anglo || {};
        const llave = r.color_llave || colorLlave(u.turno||'');
        return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:800;font-size:15px">${u.nombre||r.rut}</div>
            <div style="font-size:12px;color:var(--text-muted)">${u.cargo||''} · RUT ${r.rut}</div>
            <div style="font-size:12px;margin-top:3px">
              🏠 <b>HAB ${r.numero_hab}</b> &nbsp;
              ${llave==='verde'?'🟢 Llave Verde':'🔴 Llave Roja'} &nbsp;
              📅 ${r.fecha_asignacion||''} ${r.fecha_salida_prog?'→ '+r.fecha_salida_prog:''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${!r.llave_devuelta?`<button onclick="window._angloDevuelta(${r.id})" style="background:rgba(34,197,94,.15);color:#166534;border:none;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer">🗝️ Devolvió</button>`:''}
            <button onclick="window._angloSinLlave('${r.rut}')" style="background:rgba(239,68,68,.12);color:#991b1b;border:none;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer">❌ Sin llave</button>
            <button onclick="window._angloBaja('${r.rut}')" style="background:rgba(245,158,11,.12);color:#92400e;border:none;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer">🏃 Bajó antes</button>
          </div>
        </div>`;
    }).join('');
}

// ─── INCIDENCIAS ──────────────────────────────────────────────────
async function _cargarIncidencias() {
    const { data } = await supabase.from('v2_incidencias_anglo')
        .select('*, v2_usuarios_anglo(nombre,cargo)')
        .order('created_at', { ascending: false }).limit(300);
    _incidencias = data || [];
    _renderIncid(_incidencias);
}

function _renderIncid(rows) {
    const el = document.getElementById('anglo-incid-lista');
    if (!el) return;
    if (!rows.length) { el.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:30px">Sin incidencias</p>'; return; }
    const byRut = {};
    rows.forEach(r => { if (!byRut[r.rut]) byRut[r.rut]=[]; byRut[r.rut].push(r); });
    el.innerHTML = Object.entries(byRut).map(([rut, items]) => {
        const u = items[0].v2_usuarios_anglo||{};
        const sl = items.filter(i=>i.tipo==='sin_llave').length;
        const ba = items.filter(i=>i.tipo==='bajo_anticipado').length;
        return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            <div><div style="font-weight:800">${u.nombre||rut}</div><div style="font-size:12px;color:var(--text-muted)">${u.cargo||''}</div></div>
            <div style="display:flex;gap:6px">
              ${sl>0?`<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🔑 ${sl} sin llave</span>`:''}
              ${ba>0?`<span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🏃 ${ba} bajó antes</span>`:''}
            </div>
          </div>
          ${items.map(i=>`<div style="display:flex;gap:8px;padding:5px 0;border-top:1px solid rgba(255,255,255,.04);font-size:12px">
            <span>${i.tipo==='sin_llave'?'🔑':'🏃'}</span>
            <span style="font-weight:700">${i.tipo==='sin_llave'?'Sin llave':'Bajó anticipado'}</span>
            <span style="color:var(--text-muted)">📅 ${i.fecha||i.created_at?.slice(0,10)||''}</span>
            ${i.observacion?`<span style="color:var(--text-muted)">${i.observacion}</span>`:''}
          </div>`).join('')}
        </div>`;
    }).join('');
}

// ─── ACCIONES ─────────────────────────────────────────────────────
async function _sinLlave(rut) {
    const obs = prompt('Observación (opcional):') || null;
    await supabase.from('v2_incidencias_anglo').insert({ rut, tipo:'sin_llave', fecha: new Date().toISOString().split('T')[0], observacion: obs });
    await Promise.all([_cargarRegistro(), _cargarIncidencias()]);
    if (_rut === rut) _buscar(rut);
}
async function _bajaAnticipada(rut) {
    const obs = prompt('Observación (opcional):') || null;
    await supabase.from('v2_incidencias_anglo').insert({ rut, tipo:'bajo_anticipado', fecha: new Date().toISOString().split('T')[0], observacion: obs });
    await Promise.all([_cargarRegistro(), _cargarIncidencias()]);
    if (_rut === rut) _buscar(rut);
}
async function _devuelta(id) {
    await supabase.from('v2_asignaciones_anglo').update({ llave_devuelta:true, fecha_devolucion: new Date().toISOString().split('T')[0] }).eq('id',id);
    await _cargarRegistro();
}

// ─── TABS y FILTRO ────────────────────────────────────────────────
function _switchTab(tab) {
    _tabActual = tab;
    document.getElementById('tab-registro').style.display = tab==='registro'?'block':'none';
    document.getElementById('tab-incidencias').style.display = tab==='incidencias'?'block':'none';
    ['registro','incidencias'].forEach(t => {
        const b = document.getElementById('tab-btn-'+t);
        if (!b) return;
        b.style.borderColor = t===tab ? '#f97316' : 'var(--border)';
        b.style.background = t===tab ? 'rgba(249,115,22,.12)' : 'var(--bg-card)';
        b.style.color = t===tab ? '#f97316' : 'var(--text-muted)';
    });
}

function _filtrar(q) {
    const ql = q.toLowerCase();
    if (_tabActual === 'registro') {
        _renderReg(_registro.filter(r => (r.v2_usuarios_anglo?.nombre||'').toLowerCase().includes(ql) || r.rut.includes(q) || r.numero_hab.includes(q)));
    } else {
        _renderIncid(_incidencias.filter(r => (r.v2_usuarios_anglo?.nombre||'').toLowerCase().includes(ql) || r.rut.includes(q)));
    }
}
