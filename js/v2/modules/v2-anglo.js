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

// Fecha por defecto: hoy + 4 días
function _fecha4dias() {
    const d = new Date(); d.setDate(d.getDate() + 4);
    return d.toISOString().split('T')[0];
}

export async function renderV2Anglo(container) {
    container.innerHTML = `
    <div style="max-width:900px;margin:0 auto">

      <!-- FILA PRINCIPAL: RUT + HAB + FECHA + BOTÓN todo junto -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px">
        <label style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:10px">
          ⛏️ Asignación Rápida Anglo
        </label>

        <!-- Fila de inputs: RUT | HAB | Fecha | Botón -->
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end">
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">RUT Trabajador</label>
            <input id="anglo-rut" type="text" placeholder="ej: 12345678" autocomplete="off"
              style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid var(--border);
                     background:var(--bg);color:var(--text-primary);font-size:15px;outline:none;box-sizing:border-box"
              oninput="window._angloSearch(this.value)"
              onkeydown="window._angloKey(event,'rut')">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">N° Habitación</label>
            <input id="anglo-hab" type="text" placeholder="Ej: 4119" autocomplete="off"
              style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid var(--border);
                     background:var(--bg);color:var(--text-primary);font-size:15px;outline:none;box-sizing:border-box"
              onkeydown="window._angloKey(event,'hab')">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Salida</label>
            <input id="anglo-salida" type="date"
              style="width:100%;padding:11px 10px;border-radius:10px;border:1.5px solid var(--border);
                     background:var(--bg);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box"
              onkeydown="window._angloKey(event,'salida')">
          </div>
          <button id="anglo-btn" onclick="window._angloAsignar()" disabled
            style="padding:11px 18px;border-radius:10px;border:none;background:#ccc;color:#fff;
                   font-weight:800;font-size:13px;cursor:not-allowed;white-space:nowrap;transition:.15s">
            ✅ Cargar
          </button>
        </div>

        <!-- Info del trabajador encontrado -->
        <div id="anglo-card" style="display:none;margin-top:12px;padding:12px;
             background:rgba(249,115,22,.06);border:1.5px solid #f97316;border-radius:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <span id="ac-nombre" style="font-size:16px;font-weight:800"></span>
              <span id="ac-llave" style="margin-left:10px"></span>
            </div>
            <div id="ac-alertas" style="display:flex;gap:6px;flex-wrap:wrap"></div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">
            <span id="ac-cargo"></span> · <span id="ac-gerencia"></span> · <span id="ac-turno"></span>
          </div>
        </div>

        <div id="anglo-msg" style="display:none;margin-top:10px;padding:10px;border-radius:8px;font-size:13px;font-weight:600"></div>
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

    // Fecha default +4 días
    const salidaEl = document.getElementById('anglo-salida');
    if (salidaEl) salidaEl.value = _fecha4dias();

    _bindGlobals();
    await Promise.all([_cargarRegistro(), _cargarIncidencias()]);
}

// ─── GLOBALS ──────────────────────────────────────────────────────
function _bindGlobals() {
    window._angloSearch = v => {
        clearTimeout(_timer);
        const r = v.replace(/\D/g,'');
        if (r.length < 6) { _hideCard(); return; }
        _timer = setTimeout(() => _buscar(r), 350);
    };
    window._angloAsignar = _asignar;
    window._angloTab = _switchTab;
    window._angloFiltrar = _filtrar;
    window._angloSinLlave = _sinLlave;
    window._angloBaja = _bajaAnticipada;
    window._angloDevuelta = _devuelta;
    // Navegación teclado: Tab/ArrowRight avanza, ArrowLeft retrocede, Enter = Cargar
    window._angloKey = (e, campo) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); window._angloAsignar(); return; }
        if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            const orden = ['anglo-rut','anglo-hab','anglo-salida'];
            const id = campo==='rut'?'anglo-rut':campo==='hab'?'anglo-hab':'anglo-salida';
            const next = document.getElementById(orden[orden.indexOf(id)+1]);
            if (next) next.focus();
        }
        if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
            e.preventDefault();
            const orden = ['anglo-rut','anglo-hab','anglo-salida'];
            const id = campo==='rut'?'anglo-rut':campo==='hab'?'anglo-hab':'anglo-salida';
            const prev = document.getElementById(orden[orden.indexOf(id)-1]);
            if (prev) prev.focus();
        }
    };
}

function _hideCard() {
    const card = document.getElementById('anglo-card');
    if (card) card.style.display='none';
    const btn = document.getElementById('anglo-btn');
    if (btn) { btn.disabled=true; btn.style.background='#ccc'; btn.style.cursor='not-allowed'; }
    _rut=null;
}

// ─── BUSCAR RUT ───────────────────────────────────────────────────
async function _buscar(rut) {
    const { data } = await supabase.from('v2_usuarios_anglo').select('*').eq('rut', rut).maybeSingle();
    if (!data) { _hideCard(); return; }
    _rut = data.rut; _turno = data.turno || '';
    document.getElementById('ac-nombre').textContent = data.nombre;
    document.getElementById('ac-cargo').textContent = data.cargo || '—';
    document.getElementById('ac-gerencia').textContent = data.gerencia || '—';
    document.getElementById('ac-turno').textContent = _turno || '—';
    // Solo mostrar llave si es turno de día (verde)
    const llave = colorLlave(_turno);
    document.getElementById('ac-llave').innerHTML = llave === 'verde'
        ? `<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:3px 10px;font-weight:800;font-size:12px">🟢 Día</span>`
        : `<span style="background:#1e293b;color:#94a3b8;border-radius:8px;padding:3px 10px;font-weight:700;font-size:12px">🌙 Noche</span>`;
    document.getElementById('anglo-card').style.display = 'block';
    // Activar botón
    const btn = document.getElementById('anglo-btn');
    if (btn) { btn.disabled=false; btn.style.background='#f97316'; btn.style.cursor='pointer'; }
    // Fecha por defecto +4 si aún no fue modificada
    const salidaEl = document.getElementById('anglo-salida');
    if (salidaEl && !salidaEl.dataset.modified) salidaEl.value = _fecha4dias();
    // Mover foco al campo habitación
    setTimeout(() => document.getElementById('anglo-hab')?.focus(), 50);

    // Alertas históricas
    const [{ count: sl }, { count: ba }] = await Promise.all([
        supabase.from('v2_incidencias_anglo').select('*',{count:'exact',head:true}).eq('rut',rut).eq('tipo','sin_llave'),
        supabase.from('v2_incidencias_anglo').select('*',{count:'exact',head:true}).eq('rut',rut).eq('tipo','bajo_anticipado'),
    ]);
    const al = document.getElementById('ac-alertas');
    al.innerHTML = '';
    if (sl > 0) al.innerHTML += `<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🔑 ${sl}x sin llave</span>`;
    if (ba > 0) al.innerHTML += `<span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🏃 ${ba}x bajó antes</span>`;
    if (!sl && !ba) al.innerHTML = '<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:700">✅ Sin incidencias</span>';
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

    // 2. Seleccionar cama según turno: CAMA 1 = Día (verde), CAMA 2 = Noche (rojo)
    const esNoche = colorLlave(_turno) === 'rojo';
    // Obtener todas las camas de la habitación ordenadas
    const { data: todasCamas } = await supabase.from('v2_camas').select('id_cama,estado').eq('habitacion_id', habId).order('id_cama');
    if (!todasCamas?.length) { msg('❌ No hay camas en HAB ' + hab, false); return; }
    // Preferir cama 1 (índice 0) para día, cama 2 (índice 1) para noche
    let camaId = null;
    const camaPreferida = todasCamas[esNoche ? 1 : 0] || todasCamas[0]; // fallback a la primera
    if (camaPreferida?.estado === 'Disponible') {
        camaId = camaPreferida.id_cama;
    } else {
        // Si la preferida está ocupada, buscar cualquier disponible
        const libre = todasCamas.find(c => c.estado === 'Disponible');
        if (!libre) { msg('❌ No hay camas disponibles en HAB ' + hab, false); return; }
        camaId = libre.id_cama;
    }

    // 3. Buscar empresa "Anglo American" (o crear si no existe)
    let empresaId = null;
    try {
        const { data: empList } = await supabase.from('v2_empresas').select('id').ilike('nombre','%Anglo%').limit(1);
        if (empList?.length) {
            empresaId = empList[0].id;
        } else {
            // Crear la empresa Anglo American
            const { data: newEmp, error: empErr } = await supabase
                .from('v2_empresas').insert({ nombre: 'Anglo American', turno: '4x4' }).select('id').single();
            if (empErr) throw new Error('No se pudo crear empresa Anglo: ' + empErr.message);
            empresaId = newEmp?.id;
        }
    } catch(e) {
        msg('❌ ' + e.message, false); return;
    }
    if (!empresaId) { msg('❌ No se pudo obtener empresa Anglo American', false); return; }

    // 4. Check-in en el sistema principal (aparece en Infraestructura)
    const hoy = new Date().toISOString().split('T')[0];
    try {
        await doCheckin({ idCama: camaId, rutHuesped: _rut,
            nombreHuesped: document.getElementById('ac-nombre').textContent,
            empresaId, fechaCheckin: hoy, fechaSalidaProgramada: salida || null, esPreAsignacion: false });
        // Marcar como confirmado (verde) inmediatamente
        await supabase.from('v2_asignaciones')
            .update({ huesped_confirmo: true })
            .eq('id_cama', camaId).is('fecha_checkout', null);
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
