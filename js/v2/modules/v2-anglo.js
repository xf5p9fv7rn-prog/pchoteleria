/**
 * v2-anglo.js — Asignación Anglo con cola de carga masiva
 */
import { supabase } from '../../supabaseClient.js';
import { doCheckin, checkRutDuplicado, checkGeneroHabitacion } from '../v2-service.js';


const F4 = () => { const d=new Date(); d.setDate(d.getDate()+4); return d.toISOString().split('T')[0]; };
const colorLlave = (t='') => (t.toLowerCase().includes('adm')||t.toLowerCase().includes('5x2')) ? 'verde' : 'rojo';

let _timer=null, _rut=null, _nombre='', _turno='', _cola=[], _registro=[], _incidencias=[], _tab='registro', _modo='dia';

export async function renderV2Anglo(container) {
    container.innerHTML = `<div style="max-width:920px;margin:0 auto">

  <!-- FORMULARIO ENTRADA -->
  <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <label style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">⛏️ Asignación Rápida Anglo</label>
      <div style="display:flex;border-radius:10px;overflow:hidden;border:2px solid var(--border);flex-shrink:0">
        <button id="btn-modo-dia" onclick="window._aSetModo('dia')"
          style="padding:7px 18px;border:none;font-weight:800;font-size:13px;cursor:pointer;background:#22c55e;color:#fff;transition:all .15s">
          ☀️ Día
        </button>
        <button id="btn-modo-noche" onclick="window._aSetModo('noche')"
          style="padding:7px 18px;border:none;font-weight:800;font-size:13px;cursor:pointer;background:var(--bg-card);color:var(--text-muted);transition:all .15s">
          🌙 Noche
        </button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end">
      <div>
        <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">RUT Trabajador</label>
        <input id="ar" type="text" placeholder="ej: 12345678" autocomplete="off"
          style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:15px;outline:none;box-sizing:border-box"
          oninput="window._aSearch(this.value)" onblur="window._aSearchBlur(this.value)" onkeydown="window._aKey(event,'rut')">

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

    <!-- Buscador por pabellón/piso -->
    <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
      <button onclick="window._aBuscarHab()" id="btn-buscar-hab"
        style="padding:7px 14px;border-radius:8px;border:1.5px dashed #6366f1;background:rgba(99,102,241,.07);color:#6366f1;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">
        🔍 Sin habitación? Buscar por pabellón/piso
      </button>
    </div>

    <!-- Panel de búsqueda (oculto por defecto) -->
    <div id="a-buscador-hab" style="display:none;margin-top:12px;padding:14px;background:rgba(99,102,241,.06);border:1.5px solid #6366f1;border-radius:12px">
      <div style="font-size:12px;font-weight:800;color:#6366f1;margin-bottom:10px">🏢 Buscar habitación disponible</div>
      <div style="display:grid;grid-template-columns:2fr 1fr auto;gap:10px;align-items:end">
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:4px">Pabellón</label>
          <select id="ab-pabellon"
            style="width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box">
            <option value="">Cargando pabellones…</option>
          </select>
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:4px">Piso</label>
          <input id="ab-piso" type="number" placeholder="1, 2, 3…" min="1" max="20"
            style="width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box">
        </div>
        <button onclick="window._aBuscarDisponibles()"
          style="padding:9px 16px;border-radius:9px;border:none;background:#6366f1;color:#fff;font-weight:800;font-size:13px;cursor:pointer">
          Buscar
        </button>
      </div>
      <!-- Resultados -->
      <div id="ab-resultados" style="margin-top:12px"></div>
    </div>


    <div id="a-card" style="display:none;margin-top:12px;padding:10px 14px;background:rgba(249,115,22,.06);border:1.5px solid #f97316;border-radius:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div>
        <span id="a-nombre" style="font-weight:800;font-size:15px"></span>
        <span id="a-llave" style="margin-left:10px"></span>
        <div id="a-info" style="font-size:12px;color:var(--text-muted);margin-top:2px"></div>
      </div>
      <div id="a-alertas" style="display:flex;gap:6px;flex-wrap:wrap"></div>
    </div>

    <!-- Nuevo trabajador (RUT no encontrado) -->
    <div id="a-nuevo" style="display:none;margin-top:12px;padding:14px;background:rgba(99,102,241,.06);border:1.5px solid #6366f1;border-radius:12px">
      <div style="font-size:13px;font-weight:700;color:#6366f1;margin-bottom:10px">👤 RUT no encontrado — Registrar nuevo trabajador</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:4px">Nombre completo *</label>
          <input id="an-nombre" type="text" placeholder="Juan Pérez García" autocomplete="off"
            style="width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:4px">Cargo</label>
          <input id="an-cargo" type="text" placeholder="Operador, Supervisor..." autocomplete="off"
            style="width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:4px">Gerencia</label>
          <input id="an-gerencia" type="text" placeholder="Gerencia Mina LB..." autocomplete="off"
            style="width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:4px">Turno</label>
          <select id="an-turno" style="width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box">
            <option value="LB 4x4 Turno AB (puro) G4">4x4 Turno AB (Día)</option>
            <option value="LB 4x4 Turno CD (puro) G4">4x4 Turno CD (Noche)</option>
            <option value="5x2 Administrativo">5x2 Administrativo</option>
            <option value="Otro">Otro</option>
          </select>
        </div>
      </div>
      <button onclick="window._aRegistrarNuevo()"
        style="background:#6366f1;color:#fff;border:none;border-radius:9px;padding:10px 20px;font-weight:800;font-size:13px;cursor:pointer">
        💾 Guardar y continuar
      </button>
    </div>
    <div id="a-msg" style="display:none;margin-top:10px;padding:9px 14px;border-radius:8px;font-size:13px;font-weight:600"></div>
  </div>

  <!-- COLA DE CARGA -->
  <div id="a-cola-wrap" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:800;color:var(--text-primary)">📋 Lista pendiente de carga</div>
      <div style="display:flex;gap:8px">
        <button onclick="window._aDescargarExcel()"
          style="padding:10px 16px;border-radius:10px;border:none;background:#6366f1;color:#fff;font-weight:800;font-size:13px;cursor:pointer">
          📥 Descargar Excel
        </button>
        <button onclick="window._aCargarTodos()"
          style="padding:10px 20px;border-radius:10px;border:none;background:#22c55e;color:#fff;font-weight:800;font-size:13px;cursor:pointer">
          ✅ Cargar todos
        </button>
      </div>
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

    // ── Restaurar la cola desde sessionStorage (sobrevive navegación atrás) ──
    const _colaGuardada = sessionStorage.getItem('_angloCola');
    const colaPrevia = _colaGuardada ? JSON.parse(_colaGuardada) : [];

    document.getElementById('as').value = F4();
    _cola = colaPrevia.length > 0 ? colaPrevia : [];
    _bindGlobals();
    if (_cola.length > 0) _renderCola(); // Restaurar cola visible si había elementos
    await Promise.all([_loadReg(), _loadInc()]);
}

// ── GLOBALS ──────────────────────────────────────────────────────────────────
function _bindGlobals() {
    // Normalizar RUT: quitar puntos/guiones/espacios, conservar K, uppercase
    window._normRut = v => v.replace(/[.\s]/g,'').toUpperCase().replace(/-/g,'').replace(/[^0-9K]/g,'');
    // RUT «completo» = tiene guion, termina en K, o ≥9 chars (cuerpo 8 dígitos + DV)
    window._rutCompleto = v => v.includes('-') || v.toUpperCase().endsWith('K') || window._normRut(v).length >= 9;

    // Validar dígito verificador chileno (módulo 11)
    window._validarDV = rut => {
        if (rut.length < 8) return false;
        const dv   = rut.slice(-1);          // último carácter = DV
        const body = rut.slice(0, -1);       // cuerpo sin DV
        if (!/^\d+$/.test(body)) return false;
        let sum = 0, factor = 2;
        for (let i = body.length - 1; i >= 0; i--) {
            sum += parseInt(body[i]) * factor;
            factor = factor === 7 ? 2 : factor + 1;
        }
        const rem = 11 - (sum % 11);
        const esperado = rem === 11 ? '0' : rem === 10 ? 'K' : String(rem);
        return dv === esperado;
    };

    window._aSearch = v => {
        clearTimeout(_timer);
        if (!window._rutCompleto(v)) { _hideCard(); return; }
        const norm = window._normRut(v);
        // Validar DV antes de buscar
        if (!window._validarDV(norm)) {
            _hideCard();
            const msg = document.getElementById('a-msg');
            msg.style.display='block'; msg.style.background='rgba(239,68,68,.1)';
            msg.style.color='#991b1b'; msg.style.cursor='default'; msg.onclick=null;
            msg.textContent = `❌ RUT ${v.trim()} no es válido — revisa el dígito verificador`;
            return;
        }
        document.getElementById('a-msg').style.display = 'none';
        _timer = setTimeout(() => _buscar(norm), 350);
    };
    // Al salir del campo: buscar si parece completo (≥8 chars normalizados)
    window._aSearchBlur = v => {
        clearTimeout(_timer);
        const r = window._normRut(v);
        if (r.length < 8) return;
        if (!window._validarDV(r)) {
            _hideCard();
            const msg = document.getElementById('a-msg');
            msg.style.display='block'; msg.style.background='rgba(239,68,68,.1)';
            msg.style.color='#991b1b'; msg.style.cursor='default'; msg.onclick=null;
            msg.textContent = `❌ RUT ${v.trim()} no es válido — revisa el dígito verificador`;
            return;
        }
        _buscar(r);
    };


    window._aAgregar = _agregar;
    window._aCargarTodos = _cargarTodos;
    window._aDescargarExcel = _descargarExcel;
    window._aRegistrarNuevo = _registrarNuevo;
    window._aBuscarHab = _buscarHab;
    window._aBuscarDisponibles = _buscarDisponibles;
    window._aSeleccionarHab = _seleccionarHab;


    window._aTab     = _switchTab;
    window._aFiltrar = _filtrar;
    window._aSinLlave= _sinLlave;
    window._aBaja    = _baja;
    window._aDevuelta= _devuelta;
    window._aQuitarCola = _quitarCola;
    window._aSetModo = (modo) => {
        _modo = modo;
        const btnDia   = document.getElementById('btn-modo-dia');
        const btnNoche = document.getElementById('btn-modo-noche');
        if (btnDia)   { btnDia.style.background   = modo==='dia'   ? '#22c55e' : 'var(--bg-card)'; btnDia.style.color   = modo==='dia'   ? '#fff' : 'var(--text-muted)'; }
        if (btnNoche) { btnNoche.style.background = modo==='noche' ? '#4338ca' : 'var(--bg-card)'; btnNoche.style.color = modo==='noche' ? '#fff' : 'var(--text-muted)'; }
    };
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
    const n=document.getElementById('a-nuevo'); if(n)n.style.display='none';
    const b=document.getElementById('a-btn-add'); if(b){b.disabled=true;b.style.background='#ccc';b.style.cursor='not-allowed';}
    _rut=null; _nombre=''; _turno='';
}

// ── REGISTRAR NUEVO TRABAJADOR ────────────────────────────────────────────
async function _registrarNuevo() {
    const rut = window._normRut(document.getElementById('ar').value); // conservar K
    const nombre = document.getElementById('an-nombre').value.trim();
    const cargo = document.getElementById('an-cargo').value.trim();
    const gerencia = document.getElementById('an-gerencia').value.trim();
    const turno = document.getElementById('an-turno').value;
    if (!rut || !nombre) { _msg('⚠️ Completa al menos RUT y Nombre',false); return; }
    const {error} = await supabase.from('v2_usuarios_anglo').insert({rut, nombre, cargo:cargo||null, gerencia:gerencia||null, turno});
    if (error) { _msg('❌ Error al guardar: '+error.message, false); return; }
    document.getElementById('a-nuevo').style.display='none';
    await _buscar(rut);
}

function _msg(t,ok) {
    const el=document.getElementById('a-msg');
    el.textContent=t; el.style.display='block';
    el.style.background=ok?'rgba(34,197,94,.15)':'rgba(239,68,68,.15)';
    el.style.color=ok?'#166534':'#991b1b';
    if(ok) setTimeout(()=>el.style.display='none',4000);
}

// ── BUSCADOR POR PABELLÓN / PISO ──────────────────────────────────────────────
let _pabellanesCache = null;

async function _buscarHab() {
    const panel = document.getElementById('a-buscador-hab');
    const btn   = document.getElementById('btn-buscar-hab');
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    btn.style.background = visible ? 'rgba(99,102,241,.07)' : 'rgba(99,102,241,.18)';
    if (visible) return;

    // Cargar pabellones (una sola vez)
    if (!_pabellanesCache) {
        const { data } = await supabase
            .from('v2_pabellones')
            .select('id, nombre, v2_edificios(nombre)')
            .order('nombre');
        _pabellanesCache = data || [];
    }
    const sel = document.getElementById('ab-pabellon');
    sel.innerHTML = '<option value="">— Selecciona pabellón —</option>' +
        _pabellanesCache.map(p =>
            `<option value="${p.id}">${p.v2_edificios?.nombre ? p.v2_edificios.nombre + ' · ' : ''}${p.nombre}</option>`
        ).join('');
}

async function _buscarDisponibles() {
    const pabId = document.getElementById('ab-pabellon').value;
    const piso  = document.getElementById('ab-piso').value.trim();
    const res   = document.getElementById('ab-resultados');

    if (!pabId) { res.innerHTML = '<p style="color:#991b1b;font-size:12px">⚠️ Selecciona un pabellón</p>'; return; }
    res.innerHTML = '<p style="color:#6366f1;font-size:12px">🔍 Buscando habitaciones disponibles…</p>';

    // Construir query
    let q = supabase
        .from('v2_habitaciones')
        .select('id_custom, numero_hab, nivel, cantidad_camas, v2_camas(id_cama, estado)')
        .eq('pabellon_id', pabId);

    if (piso) q = q.eq('nivel', parseInt(piso));
    const { data: habs, error } = await q.order('numero_hab');

    if (error || !habs) { res.innerHTML = '<p style="color:#991b1b;font-size:12px">❌ Error al buscar habitaciones</p>'; return; }

    // Filtrar: solo las que tienen camas disponibles
    const disponibles = habs
        .map(h => ({
            numero: h.numero_hab,
            nivel:  h.nivel,
            total:  h.cantidad_camas || 2,
            disp:   (h.v2_camas || []).filter(c => c.estado === 'Disponible').length
        }))
        .filter(h => h.disp > 0)
        .sort((a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true }));

    if (disponibles.length === 0) {
        const msg = piso ? `el piso ${piso}` : 'ese pabellón';
        res.innerHTML = `<p style="color:#92400e;font-size:12px;background:#fef3c7;padding:8px 12px;border-radius:8px">⚠️ No hay habitaciones disponibles en ${msg}</p>`;
        return;
    }

    // Agrupar por piso
    const porPiso = {};
    disponibles.forEach(h => {
        const p = h.nivel || '?';
        if (!porPiso[p]) porPiso[p] = [];
        porPiso[p].push(h);
    });

    let html = `<div style="font-size:11px;font-weight:700;color:#6366f1;margin-bottom:8px">${disponibles.length} habitaciones disponibles · Haz clic para seleccionar</div>`;
    Object.entries(porPiso).sort((a,b) => Number(a[0])-Number(b[0])).forEach(([piso, list]) => {
        html += `<div style="font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase;margin:8px 0 4px">Piso ${piso}</div>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px">`;
        list.forEach(h => {
            const col = h.disp === h.total ? '#16a34a' : '#f59e0b';
            const bg  = h.disp === h.total ? '#f0fdf4'  : '#fefce8';
            html += `<button onclick="window._aSeleccionarHab('${h.numero}')"
                style="padding:7px 14px;border-radius:8px;border:1.5px solid ${col};background:${bg};color:${col};font-weight:800;font-size:13px;cursor:pointer;transition:all .15s"
                title="${h.disp} de ${h.total} camas libres">
                Hab. ${h.numero}
                <span style="font-size:10px;font-weight:600;opacity:.8"> · ${h.disp}/${h.total} lib.</span>
            </button>`;
        });
        html += `</div>`;
    });

    res.innerHTML = html;
}

function _seleccionarHab(numero) {
    document.getElementById('ah').value = numero;
    // Colapsar el panel
    document.getElementById('a-buscador-hab').style.display = 'none';
    document.getElementById('btn-buscar-hab').style.background = 'rgba(99,102,241,.07)';
    // Resaltar el campo y mover el foco a Salida
    const ah = document.getElementById('ah');
    ah.style.borderColor = '#6366f1';
    ah.style.boxShadow   = '0 0 0 3px rgba(99,102,241,.2)';
    setTimeout(() => { ah.style.borderColor=''; ah.style.boxShadow=''; }, 2000);
    document.getElementById('as').focus();
}

// ── BUSCAR RUT ────────────────────────────────────────────────────────────────

async function _buscar(rut) {
    // Buscar por RUT normalizado (ilike para tolerar distintos formatos en BD)
    const body = rut.replace(/[^0-9]/g, ''); // solo dígitos del cuerpo para búsqueda flexible
    const {data} = await supabase.from('v2_usuarios_anglo').select('*')
        .or(`rut.eq.${rut},rut.ilike.%${body}%`).limit(1).maybeSingle();
    const nuevoEl = document.getElementById('a-nuevo');
    if (!data) {
        _hideCard();
        // ✅ NO auto-abrir: mostrar solo un banner colapsado que requiere clic
        if (nuevoEl) {
            nuevoEl.style.display = 'none'; // ocultar formulario
        }
        // Mostrar aviso pequeño — el usuario hace clic para abrir el formulario
        const msg = document.getElementById('a-msg');
        msg.style.display = 'block';
        msg.style.background = 'rgba(99,102,241,.08)';
        msg.style.color = '#4338ca';
        msg.style.cursor = 'pointer';
        msg.innerHTML = `👤 RUT <b>${rut}</b> no encontrado en el sistema — <u>haz clic aquí para registrarlo</u>`;
        msg.onclick = () => {
            msg.style.display = 'none';
            msg.onclick = null;
            if (nuevoEl) {
                nuevoEl.style.display = 'block';
                document.getElementById('an-nombre').value = '';
                document.getElementById('an-cargo').value = '';
                document.getElementById('an-gerencia').value = '';
                setTimeout(() => document.getElementById('an-nombre')?.focus(), 50);
            }
        };
        return;
    }
    if (nuevoEl) nuevoEl.style.display='none';
    _rut=data.rut; _nombre=data.nombre; _turno=data.turno||'';
    document.getElementById('a-nombre').textContent=data.nombre;
    document.getElementById('a-llave').innerHTML=_modo==='dia'
        ?'<span style="background:#dcfce7;color:#166534;border-radius:8px;padding:2px 10px;font-size:12px;font-weight:800">☀️ Día</span>'
        :'<span style="background:#e0e7ff;color:#3730a3;border-radius:8px;padding:2px 10px;font-size:12px;font-weight:800">🌙 Noche</span>';
    document.getElementById('a-info').innerHTML=`
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px">
          <div><span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Rol</span>
               <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${data.cargo||'—'}</div></div>
          <div><span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Gerencia</span>
               <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${data.gerencia||'—'}</div></div>
          <div><span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Turno</span>
               <div style="font-size:13px;color:var(--text-primary)">${_turno||'—'}</div></div>
        </div>`;

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
    const llaveModo = _modo === 'dia' ? 'verde' : 'rojo';
    _cola.push({ rut:_rut, nombre:_nombre, turno:_turno, llave:llaveModo, modo:_modo, hab, salida });
    _renderCola();
    // Limpiar para el siguiente
    document.getElementById('ar').value='';
    document.getElementById('ah').value='';
    _hideCard();
    document.getElementById('a-msg').style.display='none';
    document.getElementById('ar').focus();
}

function _quitarCola(rut) {
    _cola=_cola.filter(c=>c.rut!==rut);
    _renderCola();
}

// ── DESCARGAR EXCEL ────────────────────────────────────────────────────────────
async function _descargarExcel() {
    if (_cola.length === 0) { _msg('⚠️ La lista está vacía', false); return; }
    // Cargar SheetJS si no está disponible
    if (!window.XLSX) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }
    const XLSX = window.XLSX;
    const hoy  = new Date().toISOString().split('T')[0];

    // Cabeceras
    const headers = ['RUT', 'Nombre', 'N° Habitación', 'Turno', 'Modo', 'Fecha Salida'];
    const rows = _cola.map(c => [
        c.rut,
        c.nombre,
        c.hab,
        c.turno || '—',
        c.modo === 'dia' ? 'Día' : 'Noche',
        c.salida || '—'
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // Estilo cabecera
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
        if (cell) {
            cell.s = {
                font:    { bold: true, color: { rgb: 'FFFFFF' } },
                fill:    { fgColor: { rgb: 'F97316' } },
                alignment: { horizontal: 'center' }
            };
        }
    }
    // Anchos de columna
    ws['!cols'] = [{ wch: 14 }, { wch: 32 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 14 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asignacion Anglo');
    XLSX.writeFile(wb, `Asignacion_Anglo_${hoy}.xlsx`);
}



function _renderCola() {
    // Guardar la cola en sessionStorage para que sobreviva la navegación
    sessionStorage.setItem('_angloCola', JSON.stringify(_cola));

    const wrap=document.getElementById('a-cola-wrap');
    const lista=document.getElementById('a-cola-lista');
    if (!_cola.length) { wrap.style.display='none'; return; }
    wrap.style.display='block';
    lista.innerHTML=_cola.map((c,i)=>`
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
        <div>
          <div style="font-weight:700;font-size:14px">${c.nombre}</div>
          <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px">${c.rut} · ${c.modo==='dia'?'<span style="background:#dcfce7;color:#166534;border-radius:6px;padding:1px 8px;font-size:11px;font-weight:800">☀️ Día</span>':'<span style="background:#e0e7ff;color:#3730a3;border-radius:6px;padding:1px 8px;font-size:11px;font-weight:800">🌙 Noche</span>'}</div>
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
            const {data:camas}=await supabase.from('v2_camas').select('id_cama,estado,numero_cama').eq('habitacion_id',habId).order('numero_cama');
            if (!camas?.length) { err.push(`${item.nombre}: Sin camas en HAB ${item.hab}`); continue; }
            // Seleccionar cama según modo: día→cama 1, noche→cama 2; si no existe esa cama, tomar la primera disponible
            let camaDisp = null;
            if (item.modo === 'dia') {
                camaDisp = camas.find(c => Number(c.numero_cama) === 1 && c.estado === 'Disponible');
            } else {
                camaDisp = camas.find(c => Number(c.numero_cama) === 2 && c.estado === 'Disponible');
            }
            if (!camaDisp) camaDisp = camas.find(c => c.estado === 'Disponible'); // fallback
            if (!camaDisp) { err.push(`${item.nombre}: HAB ${item.hab} sin camas disponibles (modo ${item.modo})`); continue; }
            const camaId=camaDisp.id_cama;

            // ─ REGLA 1: Sin RUT duplicado en fechas solapadas ─
            const dupRut = await checkRutDuplicado(item.rut, hoy, item.salida || null);
            if (!dupRut.ok) { err.push(`${item.nombre}: ${dupRut.razon}`); continue; }

            // ─ REGLA 2: Sin mezcla de géneros ─
            const genCheck = await checkGeneroHabitacion(habId, item.rut);
            if (!genCheck.ok) { err.push(`${item.nombre}: ${genCheck.razon}`); continue; }

            // Check-in
            await doCheckin({idCama:camaId,rutHuesped:item.rut,nombreHuesped:item.nombre,empresaId,fechaCheckin:hoy,fechaSalidaProgramada:item.salida||null,esPreAsignacion:false});

            // ✅ huesped_confirmo ya viene en true desde doCheckin — solo actualizar estado Anglo
            await supabase.from('v2_camas').update({estado:'Ocupada'}).eq('id_cama',camaId);
            // Registro Anglo
            await supabase.from('v2_asignaciones_anglo').upsert({rut:item.rut,numero_hab:item.hab,color_llave:item.modo==='dia'?'verde':'rojo',fecha_asignacion:hoy,fecha_salida_prog:item.salida||null,llave_entregada:true,activa:true},{onConflict:'rut'});
            ok++;
        } catch(e) { err.push(`${item.nombre}: ${e.message}`); }
    }

    _cola=[];
    sessionStorage.removeItem('_angloCola'); // Limpiar cola guardada al completar
    _renderCola();
    if(btn){btn.disabled=false;btn.textContent='✅ Cargar todos';}

    // Mostrar resultado claro
    const msgEl = document.getElementById('a-msg');
    if (err.length === 0) {
        _msg(`✅ ${ok} trabajadores cargados exitosamente`, true);
    } else {
        // Panel de errores detallado (no ilegible)
        msgEl.style.display = 'block';
        msgEl.style.background = ok > 0 ? 'rgba(234,179,8,.12)' : 'rgba(239,68,68,.12)';
        msgEl.style.color = '#1e293b';
        msgEl.innerHTML = `
            <div style="font-weight:800;font-size:13px;margin-bottom:8px">
                ${ok > 0 ? `✅ ${ok} cargados` : ''}
                ${err.length > 0 ? ` · ⚠️ ${err.length} con problemas` : ''}
            </div>
            <div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
                ${err.map(e => `
                    <div style="background:#fff;border-left:3px solid #ef4444;padding:6px 10px;border-radius:0 6px 6px 0;font-size:12px;color:#7f1d1d">
                        ${e}
                    </div>`).join('')}
            </div>`;
    }
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
            <div style="font-size:12px;margin-top:3px">🏠 <b>HAB ${r.numero_hab}</b> &nbsp;${llave==='verde'?'<span style="background:#dcfce7;color:#166534;border-radius:6px;padding:1px 8px;font-size:11px;font-weight:800">☀️ Día</span>':'<span style="background:#e0e7ff;color:#3730a3;border-radius:6px;padding:1px 8px;font-size:11px;font-weight:800">🌙 Noche</span>'}&nbsp; 📅 ${r.fecha_asignacion||''}${r.fecha_salida_prog?' → '+r.fecha_salida_prog:''}</div>
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
