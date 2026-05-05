/**
 * v2-anglo.js — Asignación Anglo con cola de carga masiva
 */
import { supabase } from '../../supabaseClient.js';
import { doCheckin } from '../v2-service.js';

const F4 = () => { const d=new Date(); d.setDate(d.getDate()+4); return d.toISOString().split('T')[0]; };
const colorLlave = (t='') => (t.toLowerCase().includes('adm')||t.toLowerCase().includes('5x2')) ? 'verde' : 'rojo';

let _timer=null, _rut=null, _nombre='', _turno='', _cola=[], _registro=[], _incidencias=[], _tab='registro';

export async function renderV2Anglo(container) {
    container.innerHTML = `<div style="max-width:920px;margin:0 auto">

  <!-- FORMULARIO ENTRADA -->
  <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px">
    <label style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:10px">⛏️ Asignación Rápida Anglo</label>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end">
      <div>
        <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">RUT Trabajador</label>
        <input id="ar" type="text" placeholder="ej: 12345678" autocomplete="off"
          style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:15px;outline:none;box-sizing:border-box"
          oninput="window._aSearch(this.value)" onkeydown="window._aKey(event,'rut')">
      </div>
      <div>
        <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">N° Habitación</label>
        <input id="ah" type="text" placeholder="Ej: 4119" autocomplete="off"
          style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:15px;outline:none;box-sizing:border-box"
          onkeydown="window._aKey(event,'hab')">
      </div>
      <div>
        <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Salida</label>
        <input id="as" type="date"
          style="width:100%;padding:11px 10px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box"
          onkeydown="window._aKey(event,'salida')">
      </div>
      <button id="a-btn-add" onclick="window._aAgregar()" disabled
        style="padding:11px 16px;border-radius:10px;border:none;background:#ccc;color:#fff;font-weight:800;font-size:13px;cursor:not-allowed;white-space:nowrap">
        ➕ Agregar
      </button>
    </div>

    <!-- Info trabajador -->
    <div id="a-card" style="display:none;margin-top:12px;padding:10px 14px;background:rgba(249,115,22,.06);border:1.5px solid #f97316;border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div>
        <span id="a-nombre" style="font-weight:800;font-size:15px"></span>
        <span id="a-llave" style="margin-left:10px"></span>
        <div id="a-info" style="font-size:12px;color:var(--text-muted);margin-top:2px"></div>
      </div>
      <div id="a-alertas" style="display:flex;gap:6px;flex-wrap:wrap"></div>
    </div>
    <div id="a-msg" style="display:none;margin-top:10px;padding:9px 14px;border-radius:8px;font-size:13px;font-weight:600"></div>
  </div>

  <!-- COLA DE CARGA -->
  <div id="a-cola-wrap" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:800;color:var(--text-primary)">📋 Lista pendiente de carga</div>
      <button onclick="window._aCargarTodos()"
        style="padding:10px 20px;border-radius:10px;border:none;background:#22c55e;color:#fff;font-weight:800;font-size:13px;cursor:pointer">
        ✅ Cargar todos
      </button>
    </div>
    <div id="a-cola-lista" style="display:flex;flex-direction:column;gap:8px"></div>
  </div>

  <!-- TABS -->
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button id="tb-reg" onclick="window._aTab('registro')"
      style="padding:9px 16px;border-radius:10px;border:1.5px solid #f97316;background:rgba(249,115,22,.12);color:#f97316;font-weight:800;font-size:13px;cursor:pointer">📋 Registro Activo</button>
    <button id="tb-inc" onclick="window._aTab('incidencias')"
      style="padding:9px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-muted);font-weight:700;font-size:13px;cursor:pointer">⚠️ Incidencias</button>
    <input placeholder="🔍 Filtrar..." oninput="window._aFiltrar(this.value)"
      style="flex:1;min-width:150px;padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none">
  </div>
  <div id="t-reg"><div id="a-lista" style="display:flex;flex-direction:column;gap:10px"><p style="color:var(--text-muted);text-align:center;padding:30px">Cargando…</p></div></div>
  <div id="t-inc" style="display:none"><div id="a-incid" style="display:flex;flex-direction:column;gap:10px"><p style="color:var(--text-muted);text-align:center;padding:30px">Cargando…</p></div></div>
</div>`;

    document.getElementById('as').value = F4();
    _cola = [];
    _bindGlobals();
    await Promise.all([_loadReg(), _loadInc()]);
}

// ── GLOBALS ──────────────────────────────────────────────────────────────────
function _bindGlobals() {
    window._aSearch  = v => { clearTimeout(_timer); const r=v.replace(/\D/g,''); if(r.length<6){_hideCard();return;} _timer=setTimeout(()=>_buscar(r),350); };
    window._aAgregar = _agregar;
    window._aCargarTodos = _cargarTodos;
    window._aTab     = _switchTab;
    window._aFiltrar = _filtrar;
    window._aSinLlave= _sinLlave;
    window._aBaja    = _baja;
    window._aDevuelta= _devuelta;
    window._aQuitarCola = _quitarCola;
    window._aKey = (e, campo) => {
        if (e.key==='Enter'||e.key==='ArrowDown') { e.preventDefault(); window._aAgregar(); return; }
        const order=['ar','ah','as'], cur=campo==='rut'?'ar':campo==='hab'?'ah':'as';
        const idx=order.indexOf(cur);
        if ((e.key==='ArrowRight'||e.key==='Tab')&&!e.shiftKey) { e.preventDefault(); document.getElementById(order[idx+1])?.focus(); }
        if ((e.key==='ArrowLeft'||(e.key==='Tab'&&e.shiftKey))) { e.preventDefault(); document.getElementById(order[idx-1])?.focus(); }
    };
}

function _hideCard() {
    const c=document.getElementById('a-card'); if(c)c.style.display='none';
    const b=document.getElementById('a-btn-add'); if(b){b.disabled=true;b.style.background='#ccc';b.style.cursor='not-allowed';}
    _rut=null; _nombre=''; _turno='';
}

function _msg(t,ok) {
    const el=document.getElementById('a-msg');
    el.textContent=t; el.style.display='block';
    el.style.background=ok?'rgba(34,197,94,.15)':'rgba(239,68,68,.15)';
    el.style.color=ok?'#166534':'#991b1b';
    if(ok) setTimeout(()=>el.style.display='none',4000);
}

// ── BUSCAR RUT ────────────────────────────────────────────────────────────────
async function _buscar(rut) {
    const {data} = await supabase.from('v2_usuarios_anglo').select('*').eq('rut',rut).maybeSingle();
    if (!data) { _hideCard(); return; }
    _rut=data.rut; _nombre=data.nombre; _turno=data.turno||'';
    const llave=colorLlave(_turno);
    document.getElementById('a-nombre').textContent=data.nombre;
    document.getElementById('a-llave').innerHTML=llave==='verde'
        ?'<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:2px 10px;font-size:12px;font-weight:800">🟢 Día</span>'
        :'<span style="background:#1e293b;color:#94a3b8;border-radius:8px;padding:2px 10px;font-size:12px;font-weight:700">🌙 Noche</span>';
    document.getElementById('a-info').textContent=`${data.cargo||''} · ${data.gerencia||''}`;
    document.getElementById('a-card').style.display='flex';
    const btn=document.getElementById('a-btn-add');
    btn.disabled=false; btn.style.background='#f97316'; btn.style.cursor='pointer';
    setTimeout(()=>document.getElementById('ah')?.focus(),50);
    const [{count:sl},{count:ba}]=await Promise.all([
        supabase.from('v2_incidencias_anglo').select('*',{count:'exact',head:true}).eq('rut',rut).eq('tipo','sin_llave'),
        supabase.from('v2_incidencias_anglo').select('*',{count:'exact',head:true}).eq('rut',rut).eq('tipo','bajo_anticipado'),
    ]);
    const al=document.getElementById('a-alertas'); al.innerHTML='';
    if(sl>0) al.innerHTML+=`<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:2px 10px;font-size:12px;font-weight:800">🔑 ${sl}x sin llave</span>`;
    if(ba>0) al.innerHTML+=`<span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:2px 10px;font-size:12px;font-weight:800">🏃 ${ba}x bajó antes</span>`;
    if(!sl&&!ba) al.innerHTML='<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:2px 10px;font-size:12px;font-weight:700">✅ Sin incidencias</span>';
}

// ── AGREGAR A COLA ────────────────────────────────────────────────────────────
function _agregar() {
    if (!_rut) { _msg('⚠️ Busca un trabajador primero',false); return; }
    const hab=document.getElementById('ah').value.trim();
    const salida=document.getElementById('as').value;
    if (!hab) { _msg('⚠️ Ingresa el número de habitación',false); return; }
    if (_cola.find(c=>c.rut===_rut)) { _msg('⚠️ Este trabajador ya está en la lista',false); return; }
    _cola.push({ rut:_rut, nombre:_nombre, turno:_turno, llave:colorLlave(_turno), hab, salida });
    _renderCola();
    // Limpiar para el siguiente
    document.getElementById('ar').value='';
    document.getElementById('ah').value='';
    document.getElementById('as').value=F4();
    _hideCard();
    document.getElementById('a-msg').style.display='none';
    document.getElementById('ar').focus();
}

function _quitarCola(rut) {
    _cola=_cola.filter(c=>c.rut!==rut);
    _renderCola();
}

function _renderCola() {
    const wrap=document.getElementById('a-cola-wrap');
    const lista=document.getElementById('a-cola-lista');
    if (!_cola.length) { wrap.style.display='none'; return; }
    wrap.style.display='block';
    lista.innerHTML=_cola.map((c,i)=>`
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
        <div>
          <div style="font-weight:700;font-size:14px">${c.nombre}</div>
          <div style="font-size:11px;color:var(--text-muted)">${c.rut} · ${c.llave==='verde'?'🟢 Día':'🌙 Noche'}</div>
        </div>
        <input value="${c.hab}" onchange="window._aEditHab(${i},this.value)"
          style="padding:8px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:14px;font-weight:700;outline:none;width:100%;box-sizing:border-box"
          placeholder="HAB">
        <div style="font-size:12px;color:var(--text-muted)">📅 ${c.salida}</div>
        <button onclick="window._aQuitarCola('${c.rut}')"
          style="background:rgba(239,68,68,.15);color:#991b1b;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:16px">✕</button>
      </div>`).join('');
}

window._aEditHab = (idx, val) => { if(_cola[idx]) _cola[idx].hab=val.trim(); };

// ── CARGAR TODOS ──────────────────────────────────────────────────────────────
async function _cargarTodos() {
    if (!_cola.length) return;
    const btn=document.querySelector('[onclick="window._aCargarTodos()"]');
    if(btn){btn.disabled=true;btn.textContent='⏳ Cargando…';}

    // Obtener empresa Anglo
    let empresaId=null;
    const {data:empList}=await supabase.from('v2_empresas').select('id').ilike('nombre','%Anglo%').limit(1);
    if (empList?.length) { empresaId=empList[0].id; }
    else {
        const {data:ne}=await supabase.from('v2_empresas').insert({nombre:'Anglo American',turno:'4x4'}).select('id').single();
        empresaId=ne?.id;
    }
    if (!empresaId) { _msg('❌ No se pudo obtener empresa Anglo',false); if(btn){btn.disabled=false;btn.textContent='✅ Cargar todos';} return; }

    const hoy=new Date().toISOString().split('T')[0];
    let ok=0, err=[];

    for (const item of _cola) {
        try {
            // Buscar habitación
            const {data:habs}=await supabase.from('v2_habitaciones').select('id_custom').ilike('numero_hab',item.hab);
            if (!habs?.length) { err.push(`${item.nombre}: HAB ${item.hab} no encontrada`); continue; }
            const habId=habs[0].id_custom;
            // Camas en orden: el primero que llega a la HAB → cama 1, el segundo → cama 2
            // Se obtienen ordenadas por id_cama, y se toma la primera DISPONIBLE
            const {data:camas}=await supabase.from('v2_camas').select('id_cama,estado').eq('habitacion_id',habId).order('id_cama');
            if (!camas?.length) { err.push(`${item.nombre}: Sin camas en HAB ${item.hab}`); continue; }
            const camaDisp=camas.find(c=>c.estado==='Disponible');
            if (!camaDisp) { err.push(`${item.nombre}: HAB ${item.hab} sin camas disponibles`); continue; }
            const camaId=camaDisp.id_cama;
            // Check-in
            await doCheckin({idCama:camaId,rutHuesped:item.rut,nombreHuesped:item.nombre,empresaId,fechaCheckin:hoy,fechaSalidaProgramada:item.salida||null,esPreAsignacion:false});
            await supabase.from('v2_asignaciones').update({huesped_confirmo:true}).eq('id_cama',camaId).is('fecha_checkout',null);
            await supabase.from('v2_camas').update({estado:'Ocupada'}).eq('id_cama',camaId);
            // Registro Anglo
            await supabase.from('v2_asignaciones_anglo').upsert({rut:item.rut,numero_hab:item.hab,color_llave:item.llave,fecha_asignacion:hoy,fecha_salida_prog:item.salida||null,llave_entregada:true,activa:true},{onConflict:'rut'});
            ok++;
        } catch(e) { err.push(`${item.nombre}: ${e.message}`); }
    }

    _cola=[];
    _renderCola();
    if(btn){btn.disabled=false;btn.textContent='✅ Cargar todos';}
    if(err.length) _msg(`⚠️ ${ok} cargados, ${err.length} errores: ${err.join(' | ')}`,false);
    else _msg(`✅ ${ok} trabajadores cargados exitosamente`,true);
    await _loadReg();
}

// ── REGISTRO ──────────────────────────────────────────────────────────────────
async function _loadReg() {
    try {
        const {data}=await supabase.from('v2_asignaciones_anglo').select('*,v2_usuarios_anglo(nombre,cargo,turno)').eq('activa',true).order('fecha_asignacion',{ascending:false}).limit(300);
        _registro=data||[]; _renderReg(_registro);
    } catch(e) {
        const el=document.getElementById('a-lista');
        if(el) el.innerHTML=`<p style="color:#ef4444;text-align:center;padding:20px">Error cargando registro: ${e.message}</p>`;
    }
}

function _renderReg(rows) {
    const el=document.getElementById('a-lista'); if(!el)return;
    if(!rows.length){el.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:30px">Sin asignaciones activas</p>';return;}
    el.innerHTML=rows.map(r=>{
        const u=r.v2_usuarios_anglo||{};
        const llave=r.color_llave||colorLlave(u.turno||'');
        return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:800;font-size:15px">${u.nombre||r.rut}</div>
            <div style="font-size:12px;color:var(--text-muted)">${u.cargo||''} · RUT ${r.rut}</div>
            <div style="font-size:12px;margin-top:3px">🏠 <b>HAB ${r.numero_hab}</b> &nbsp;${llave==='verde'?'🟢 Día':'🌙 Noche'}&nbsp; 📅 ${r.fecha_asignacion||''}${r.fecha_salida_prog?' → '+r.fecha_salida_prog:''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${!r.llave_devuelta?`<button onclick="window._aDevuelta(${r.id})" style="background:rgba(34,197,94,.15);color:#166534;border:none;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer">🗝️ Devolvió</button>`:''}
            <button onclick="window._aSinLlave('${r.rut}')" style="background:rgba(239,68,68,.12);color:#991b1b;border:none;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer">❌ Sin llave</button>
            <button onclick="window._aBaja('${r.rut}')" style="background:rgba(245,158,11,.12);color:#92400e;border:none;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer">🏃 Bajó antes</button>
          </div>
        </div>`;
    }).join('');
}

// ── INCIDENCIAS ───────────────────────────────────────────────────────────────
async function _loadInc() {
    try {
        const {data}=await supabase.from('v2_incidencias_anglo').select('*,v2_usuarios_anglo(nombre,cargo)').order('created_at',{ascending:false}).limit(300);
        _incidencias=data||[]; _renderInc(_incidencias);
    } catch(e) {
        const el=document.getElementById('a-incid');
        if(el) el.innerHTML=`<p style="color:#ef4444;text-align:center;padding:20px">Error cargando incidencias: ${e.message}</p>`;
    }
}

function _renderInc(rows) {
    const el=document.getElementById('a-incid'); if(!el)return;
    if(!rows.length){el.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:30px">Sin incidencias</p>';return;}
    const byR={};
    rows.forEach(r=>{if(!byR[r.rut])byR[r.rut]=[];byR[r.rut].push(r);});
    el.innerHTML=Object.entries(byR).map(([rut,items])=>{
        const u=items[0].v2_usuarios_anglo||{};
        const sl=items.filter(i=>i.tipo==='sin_llave').length;
        const ba=items.filter(i=>i.tipo==='bajo_anticipado').length;
        return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            <div><div style="font-weight:800">${u.nombre||rut}</div><div style="font-size:12px;color:var(--text-muted)">${u.cargo||''}</div></div>
            <div style="display:flex;gap:6px">
              ${sl?`<span style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🔑 ${sl} sin llave</span>`:''}
              ${ba?`<span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800">🏃 ${ba} bajó antes</span>`:''}
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

// ── ACCIONES ──────────────────────────────────────────────────────────────────
async function _sinLlave(rut) {
    const obs=prompt('Observación (opcional):')||null;
    await supabase.from('v2_incidencias_anglo').insert({rut,tipo:'sin_llave',fecha:new Date().toISOString().split('T')[0],observacion:obs});
    await Promise.all([_loadReg(),_loadInc()]);
}
async function _baja(rut) {
    const obs=prompt('Observación (opcional):')||null;
    await supabase.from('v2_incidencias_anglo').insert({rut,tipo:'bajo_anticipado',fecha:new Date().toISOString().split('T')[0],observacion:obs});
    await Promise.all([_loadReg(),_loadInc()]);
}
async function _devuelta(id) {
    await supabase.from('v2_asignaciones_anglo').update({llave_devuelta:true,fecha_devolucion:new Date().toISOString().split('T')[0]}).eq('id',id);
    await _loadReg();
}

// ── TABS / FILTRO ─────────────────────────────────────────────────────────────
function _switchTab(tab) {
    _tab=tab;
    document.getElementById('t-reg').style.display=tab==='registro'?'block':'none';
    document.getElementById('t-inc').style.display=tab==='incidencias'?'block':'none';
    ['registro','incidencias'].forEach(t=>{
        const b=document.getElementById('tb-'+(t==='registro'?'reg':'inc'));
        if(!b)return;
        b.style.borderColor=t===tab?'#f97316':'var(--border)';
        b.style.background=t===tab?'rgba(249,115,22,.12)':'var(--bg-card)';
        b.style.color=t===tab?'#f97316':'var(--text-muted)';
    });
}

function _filtrar(q) {
    const ql=q.toLowerCase();
    if (_tab==='registro') _renderReg(_registro.filter(r=>(r.v2_usuarios_anglo?.nombre||'').toLowerCase().includes(ql)||r.rut.includes(q)||r.numero_hab.includes(q)));
    else _renderInc(_incidencias.filter(r=>(r.v2_usuarios_anglo?.nombre||'').toLowerCase().includes(ql)||r.rut.includes(q)));
}
