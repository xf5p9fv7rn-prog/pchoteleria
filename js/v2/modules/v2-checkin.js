/**
 * v2-checkin.js — Check-in / Check-out + Gestión de Empresas V2
 * Incluye formulario inline para crear Empresas y Gerencias sin esperar Excel.
 */
import {
    getEdificios, getPabellones, getHabitaciones, getCamasDisponibles,
    getEmpresas, getGerencias, getEmpresasConOcupacion,
    crearEmpresa, crearGerencia,
    doCheckin, doCheckout, getAsignacionesActivas, today
} from '../v2-service.js';

let _empresas = [];

export async function renderV2Checkin(container) {
    container.innerHTML = `<div style="padding:20px;max-width:1100px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#10b981,#059669);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">🛎️</div>
        <div>
          <h1 style="font-size:22px;font-weight:800;color:var(--text-primary);margin:0">Check-in / Check-out V2</h1>
          <p style="font-size:13px;color:var(--text-secondary);margin:0">Gestión de estadías — escribe en v2_asignaciones</p>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
        ${tabBtn('ci','✅ Check-in','#10b981',true)}
        ${tabBtn('co','🚪 Check-out','#ef4444',false)}
        ${tabBtn('recepcion','🏨 Recepción','#6366f1',false)}
        ${tabBtn('activos','📋 Activos','#475569',false)}
        ${tabBtn('empresas','🏢 Empresas','#f59e0b',false)}
      </div>
      <div id="panel-ci">${panelCheckin()}</div>
      <div id="panel-co"      style="display:none">${panelCheckout()}</div>
      <div id="panel-recepcion" style="display:none">${panelRecepcion()}</div>
      <div id="panel-activos" style="display:none"><div id="lista-activos" style="text-align:center;padding:40px;color:var(--text-muted)">Cargando…</div></div>
      <div id="panel-empresas" style="display:none">${panelEmpresas()}</div>
    </div>`;

    ['ci','co','recepcion','activos','empresas'].forEach(t =>
        document.getElementById(`tab-${t}`)?.addEventListener('click', () => switchTab(t))
    );

    // Cargar datos iniciales en paralelo
    const [empresas, edificios] = await Promise.all([ getEmpresas(), getEdificios() ]);
    _empresas = empresas;

    fillSelect('ci-empresa', empresas, e => ({ v: e.id, l: `${e.nombre}${e.turno ? ' · ' + e.turno : ''}` }));
    fillSelect('ci-edificio', edificios, e => ({ v: e.id, l: e.nombre }));
    document.getElementById('ci-fecha')?.setAttribute('value', today());

    document.getElementById('ci-edificio')?.addEventListener('change', onEdificioChange);
    document.getElementById('ci-pabellon')?.addEventListener('change', onPabellonChange);
    document.getElementById('ci-habitacion')?.addEventListener('change', onHabitacionChange);
    document.getElementById('btn-buscar-rec')?.addEventListener('click', buscarAutorizacion);
    document.getElementById('btn-autorizar-rapido')?.addEventListener('click', buscarAutorizacion);
    document.getElementById('btn-autorizar-empresa')?.addEventListener('click', autorizarEmpresaCompleta);
    document.getElementById('rec-rut')?.addEventListener('keydown', e => { if(e.key==='Enter') buscarAutorizacion(); });
    document.getElementById('btn-checkin')?.addEventListener('click', handleCheckin);
    document.getElementById('btn-buscar-co')?.addEventListener('click', buscarCheckout);
    document.getElementById('btn-nueva-empresa')?.addEventListener('click', crearNuevaEmpresa);
    document.getElementById('btn-nueva-gerencia')?.addEventListener('click', crearNuevaGerencia);

    // Cargar gerencias en panel empresas
    renderListaEmpresas();
}

// ─── TABS ────────────────────────────────────────────────────────
function tabBtn(id, label, color, active) {
    return `<button id="tab-${id}" style="padding:10px 18px;border-radius:10px;border:1.5px solid ${active ? color : 'var(--border)'};background:${active ? color : 'var(--bg-card)'};color:${active ? '#fff' : 'var(--text-primary)'};font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s">${label}</button>`;
}

function switchTab(name) {
    const colors = { ci: '#10b981', co: '#ef4444', recepcion: '#6366f1', activos: '#475569', empresas: '#f59e0b' };
    ['ci','co','recepcion','activos','empresas'].forEach(t => {
        const btn   = document.getElementById(`tab-${t}`);
        const panel = document.getElementById(`panel-${t}`);
        const on    = t === name;
        if (btn)   { btn.style.background = on ? colors[t] : 'var(--bg-card)'; btn.style.color = on ? '#fff' : 'var(--text-primary)'; btn.style.borderColor = on ? colors[t] : 'var(--border)'; }
        if (panel) panel.style.display = on ? 'block' : 'none';
    });
    if (name === 'activos') cargarActivos();
    if (name === 'empresas') renderListaEmpresas();
    if (name === 'recepcion') cargarEmpresasRecepcion();
}

// ─── CHECK-IN ────────────────────────────────────────────────────
function panelCheckin() {
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px">
      <h2 style="font-size:15px;font-weight:700;color:var(--text-primary);margin:0 0 20px">✅ Registrar Check-in</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px">
        ${fld('ci-edificio','Edificio','select')}
        ${fld('ci-pabellon','Pabellón','select')}
        ${fld('ci-habitacion','Habitación','select')}
        ${fld('ci-cama','Cama disponible','select')}
      </div>
      <div style="border-top:1px solid var(--border);margin:20px 0"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px">
        ${fld('ci-rut','RUT del huésped','text','12345678-9')}
        ${fld('ci-nombre','Nombre completo','text','Nombre Apellido')}
        ${fld('ci-empresa','Empresa','select')}
        ${fld('ci-fecha','Fecha Check-in','date')}
      </div>
      <div id="ci-msg" style="margin-top:14px;min-height:20px;font-size:13px;font-weight:600"></div>
      <button id="btn-checkin" style="margin-top:16px;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:12px;padding:14px 32px;font-size:15px;font-weight:700;cursor:pointer;width:100%">✅ Confirmar Check-in</button>
    </div>`;
}

async function onEdificioChange() {
    const id = document.getElementById('ci-edificio')?.value;
    resetSel('ci-pabellon'); resetSel('ci-habitacion'); resetSel('ci-cama');
    if (!id) return;
    const pabs = await getPabellones(id);
    fillSelect('ci-pabellon', pabs, p => ({ v: p.id, l: p.nombre }));
}

async function onPabellonChange() {
    const id = document.getElementById('ci-pabellon')?.value;
    resetSel('ci-habitacion'); resetSel('ci-cama');
    if (!id) return;
    const habs = await getHabitaciones(id);
    fillSelect('ci-habitacion', habs, h => ({ v: h.id_custom, l: h.numero_hab || h.id_custom }));
}

async function onHabitacionChange() {
    const id = document.getElementById('ci-habitacion')?.value;
    resetSel('ci-cama');
    if (!id) return;
    const disp = await getCamasDisponibles(id);
    fillSelect('ci-cama', disp, c => ({ v: c.id_cama, l: c.id_cama }),
        disp.length ? '— Seleccionar cama —' : '⛔ Sin camas disponibles');
}

async function handleCheckin() {
    const msg = (t, c) => { const el = document.getElementById('ci-msg'); if (el) { el.textContent = t; el.style.color = c; } };
    const v = id => document.getElementById(id)?.value?.trim();
    const idCama = v('ci-cama'), rut = v('ci-rut'), nombre = v('ci-nombre'),
          empresaId = v('ci-empresa'), fecha = v('ci-fecha');
    if (!idCama || !rut || !nombre || !empresaId || !fecha) { msg('⚠️ Completa todos los campos.', '#f59e0b'); return; }
    msg('Registrando…', 'var(--text-muted)');
    try {
        await doCheckin({ idCama, rutHuesped: rut, nombreHuesped: nombre, empresaId, fechaCheckin: fecha });
        msg(`✅ Check-in OK — Cama ${idCama} ahora OCUPADA.`, '#10b981');
        await onHabitacionChange(); // refresh camas
    } catch(e) { msg('❌ ' + e.message, '#ef4444'); }
}

// ─── RECEPCIÓN: AUTORIZAR LLEGADA ────────────────────────────────
let _sbRec = null;
async function getSbRec() {
    if (!_sbRec) { const m = await import('../../supabaseClient.js'); _sbRec = m.supabase; }
    return _sbRec;
}

function panelRecepcion() {
    return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">

      <!-- Modo rápido individual -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:22px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px">⚡</div>
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--text-primary)">Autorización Rápida</div>
            <div style="font-size:11px;color:var(--text-secondary)">Ingresa RUT → Enter → listo ✅</div>
          </div>
        </div>
        <input id="rec-rut" type="text" placeholder="12345678-9" autocomplete="off" inputmode="numeric"
          style="width:100%;padding:16px 18px;border-radius:12px;border:2px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:20px;font-weight:700;outline:none;box-sizing:border-box;letter-spacing:1px;margin-bottom:10px;transition:border-color 0.2s"
          onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='var(--border)'">
        <button id="btn-autorizar-rapido"
          style="width:100%;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(99,102,241,0.35);display:flex;align-items:center;justify-content:center;gap:8px">
          🏨 Autorizar Llegada
        </button>
        <div id="rec-feedback" style="margin-top:12px;min-height:60px"></div>
      </div>

      <!-- Autorización masiva por empresa -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:22px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px">🚀</div>
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--text-primary)">Autorizar por Empresa</div>
            <div style="font-size:11px;color:var(--text-secondary)">Para llegadas grupales masivas</div>
          </div>
        </div>
        <select id="rec-empresa-sel"
          style="width:100%;padding:13px 14px;border-radius:12px;border:2px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;font-weight:600;outline:none;margin-bottom:10px">
          <option value="">— Seleccionar empresa —</option>
        </select>
        <div id="rec-empresa-preview" style="min-height:36px;margin-bottom:10px;text-align:center"></div>
        <button id="btn-autorizar-empresa"
          style="width:100%;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(245,158,11,0.35);display:flex;align-items:center;justify-content:center;gap:8px">
          🚀 Autorizar toda la empresa
        </button>
        <div id="rec-empresa-msg" style="margin-top:10px;min-height:20px;font-size:13px;font-weight:600"></div>
      </div>
    </div>`;
}

async function buscarAutorizacion() {
    const sb  = await getSbRec();
    const rut = document.getElementById('rec-rut')?.value?.trim();
    const fb  = document.getElementById('rec-feedback');
    const btn = document.getElementById('btn-autorizar-rapido');
    if (!rut) { fb.innerHTML = `<p style="color:#f59e0b;font-weight:600">⚠️ Ingresa un RUT</p>`; return; }

    btn.innerHTML = '⏳ Buscando…'; btn.disabled = true;

    const rutBase = rut.replace(/[\.\- ]/g,'').toUpperCase();
    const rutDash = rutBase.length > 1 ? rutBase.slice(0,-1)+'-'+rutBase.slice(-1) : rutBase;

    const { data, error } = await sb
        .from('v2_asignaciones')
        .select('id, rut_huesped, nombre_huesped, id_cama, autorizado_checkin, huesped_confirmo, v2_empresas(nombre,turno)')
        .or(`rut_huesped.eq.${rutBase},rut_huesped.eq.${rutDash}`)
        .is('fecha_checkout', null)
        .order('fecha_checkin', { ascending: false })
        .limit(1);

    btn.innerHTML = '🏨 Autorizar Llegada'; btn.disabled = false;

    if (error || !data?.length) {
        fb.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:12px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px">
            <span style="font-size:20px">❌</span>
            <div><div style="font-weight:700;color:#c53030;font-size:13px">RUT no encontrado</div>
            <div style="font-size:11px;color:#718096">Verifica o registra el check-in primero</div></div>
          </div>`;
        return;
    }

    const a = data[0];

    if (a.huesped_confirmo) {
        fb.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:12px;background:#dcfce7;border:1.5px solid #86efac;border-radius:10px">
            <span style="font-size:20px">✅</span>
            <div><div style="font-weight:800;color:#15803d;font-size:13px">${a.nombre_huesped}</div>
            <div style="font-size:11px;color:#166534">Ya confirmó llegada · Cama ${a.id_cama}</div></div>
          </div>`;
        document.getElementById('rec-rut').value = '';
        document.getElementById('rec-rut').focus();
        return;
    }

    if (a.autorizado_checkin) {
        fb.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:20px">🟡</span>
              <div><div style="font-weight:800;color:#1d4ed8;font-size:13px">${a.nombre_huesped}</div>
              <div style="font-size:11px;color:#1e40af">Ya autorizado · esperando confirmación</div></div>
            </div>
            <button onclick="window._revocarAutorizacion('${a.id}')"
              style="background:transparent;border:1.5px solid #ef4444;color:#ef4444;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">✕ Revocar</button>
          </div>`;
        return;
    }

    // ── Autorizar inmediatamente sin paso extra ───────────────────
    btn.innerHTML = '⏳ Autorizando…'; btn.disabled = true;
    const { error: err } = await sb.from('v2_asignaciones')
        .update({ autorizado_checkin: true }).eq('id', a.id);
    btn.innerHTML = '🏨 Autorizar Llegada'; btn.disabled = false;

    if (err) { fb.innerHTML = `<p style="color:#ef4444;font-weight:700">❌ ${err.message}</p>`; return; }

    fb.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:14px;background:#dcfce7;border:1.5px solid #86efac;border-radius:12px">
        <div style="width:42px;height:42px;border-radius:10px;background:#16a34a;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:900;flex-shrink:0">
          ${a.nombre_huesped?.[0]?.toUpperCase()||'?'}
        </div>
        <div>
          <div style="font-weight:800;color:#15803d;font-size:14px">✅ ${a.nombre_huesped}</div>
          <div style="font-size:12px;color:#166534">Autorizado · Cama <strong>${a.id_cama}</strong> · ${a.v2_empresas?.nombre||'—'}</div>
        </div>
      </div>`;
    // Limpiar y enfocar para el siguiente trabajador
    document.getElementById('rec-rut').value = '';
    setTimeout(() => document.getElementById('rec-rut').focus(), 100);
}

async function cargarEmpresasRecepcion() {
    const sb = await getSbRec();
    const { data } = await sb.from('v2_empresas').select('id, nombre, turno').order('nombre');
    if (!data) return;
    const sel = document.getElementById('rec-empresa-sel');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccionar empresa —</option>' +
        data.map(e => `<option value="${e.id}">${e.nombre}${e.turno?' · '+e.turno:''}</option>`).join('');

    sel.addEventListener('change', async () => {
        const empId = sel.value;
        const prev  = document.getElementById('rec-empresa-preview');
        if (!empId) { prev.innerHTML = ''; return; }
        prev.innerHTML = `<span style="color:var(--text-muted);font-size:12px">Contando pendientes…</span>`;
        const { count } = await sb.from('v2_asignaciones')
            .select('id', { count: 'exact', head: true })
            .eq('empresa_id', empId)
            .is('fecha_checkout', null)
            .eq('autorizado_checkin', false);
        prev.innerHTML = count > 0
            ? `<span style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:6px 16px;font-weight:700;color:#854d0e;font-size:13px">${count} trabajador${count!==1?'es':''} pendiente${count!==1?'s':''}</span>`
            : `<span style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:6px 16px;font-weight:700;color:#15803d;font-size:13px">✅ Todos autorizados</span>`;
    });
}

async function autorizarEmpresaCompleta() {
    const sb    = await getSbRec();
    const empId = document.getElementById('rec-empresa-sel')?.value;
    const msg   = document.getElementById('rec-empresa-msg');
    const btn   = document.getElementById('btn-autorizar-empresa');
    if (!empId) { msg.textContent = '⚠️ Selecciona una empresa'; msg.style.color = '#f59e0b'; return; }
    const empNombre = document.getElementById('rec-empresa-sel')?.selectedOptions[0]?.text || '';
    if (!confirm(`¿Autorizar llegada a TODOS los trabajadores activos de "${empNombre}"?`)) return;
    btn.innerHTML = '⏳ Autorizando…'; btn.disabled = true;
    await sb.from('v2_asignaciones')
        .update({ autorizado_checkin: true })
        .eq('empresa_id', empId)
        .is('fecha_checkout', null);
    btn.innerHTML = '🚀 Autorizar toda la empresa'; btn.disabled = false;
    msg.innerHTML = `<span style="color:#10b981">✅ Empresa autorizada — todos pueden hacer check-in</span>`;
    document.getElementById('rec-empresa-sel').dispatchEvent(new Event('change'));
}

window._revocarAutorizacion = async (id) => {
    if (!confirm('¿Revocar la autorización de llegada?')) return;
    const sb = await getSbRec();
    await sb.from('v2_asignaciones').update({ autorizado_checkin: false }).eq('id', id);
    buscarAutorizacion();
};

// ─── CHECK-OUT ───────────────────────────────────────────────────
function panelCheckout() {
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px">
      <h2 style="font-size:15px;font-weight:700;color:var(--text-primary);margin:0 0 16px">🚪 Registrar Check-out</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <input id="co-q" type="text" placeholder="Buscar por RUT o nombre…"
          style="flex:1;min-width:200px;padding:12px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;outline:none"
          onkeydown="if(event.key==='Enter') document.getElementById('btn-buscar-co').click()">
        <button id="btn-buscar-co" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer">🔍 Buscar</button>
      </div>
      <div id="co-resultados"><p style="text-align:center;color:var(--text-muted);padding:30px">Ingresa un RUT o nombre para buscar estadías activas</p></div>
    </div>`;
}

async function buscarCheckout() {
    const q = document.getElementById('co-q')?.value?.trim();
    const el = document.getElementById('co-resultados');
    if (!q) { el.innerHTML = `<p style="color:#f59e0b;font-weight:600;padding:12px">⚠️ Ingresa un RUT o nombre</p>`; return; }
    el.innerHTML = `<p style="text-align:center;padding:30px;color:var(--text-muted)">Buscando…</p>`;
    try {
        const data = await getAsignacionesActivas({ busqueda: q, limit: 20 });
        if (!data.length) { el.innerHTML = `<p style="text-align:center;padding:30px;color:var(--text-muted)">Sin estadías activas con esos datos</p>`; return; }
        el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
          ${data.map(a => `
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px">
              <div>
                <div style="font-weight:700;color:var(--text-primary)">${a.nombre_huesped}</div>
                <div style="font-size:12px;font-family:monospace;color:var(--text-secondary)">${a.rut_huesped}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">📍 <strong>${a.id_cama}</strong> · ${a.v2_empresas?.nombre||'—'} · Check-in: ${a.fecha_checkin}</div>
              </div>
              <button onclick="window._doCheckout('${a.id}','${a.id_cama}')"
                style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">🚪 Check-out</button>
            </div>`).join('')}
        </div>`;
        window._doCheckout = async (asigId, camaId) => {
            try { await doCheckout(asigId); alert(`✅ Check-out registrado. Cama ${camaId} ahora DISPONIBLE.`); buscarCheckout(); }
            catch(e) { alert('❌ ' + e.message); }
        };
    } catch(e) { el.innerHTML = `<p style="color:#ef4444;padding:12px">❌ ${e.message}</p>`; }
}

// ─── ACTIVOS ─────────────────────────────────────────────────────
async function cargarActivos() {
    const el = document.getElementById('lista-activos');
    el.innerHTML = `<p style="text-align:center;padding:30px;color:var(--text-muted)">Cargando…</p>`;
    try {
        const data = await getAsignacionesActivas({ limit: 200 });
        if (!data.length) { el.innerHTML = `<p style="text-align:center;padding:40px;color:var(--text-muted)">Sin estadías activas</p>`; return; }
        el.innerHTML = `
          <p style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:10px">${data.length} huéspedes activos</p>
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;min-width:550px">
              <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
                ${['Huésped','RUT','Cama','Empresa','Check-in'].map(h=>`<th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`).join('')}
              </tr></thead>
              <tbody>
                ${data.map((a,i)=>`<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg)'}">
                  <td style="padding:11px 14px;font-weight:600;font-size:13px;color:var(--text-primary)">${a.nombre_huesped}</td>
                  <td style="padding:11px 14px;font-size:12px;font-family:monospace;color:var(--text-secondary)">${a.rut_huesped}</td>
                  <td style="padding:11px 14px;font-size:12px;font-family:monospace;color:#6366f1;font-weight:700">${a.id_cama}</td>
                  <td style="padding:11px 14px;font-size:12px;color:var(--text-secondary)">${a.v2_empresas?.nombre||'—'}</td>
                  <td style="padding:11px 14px;font-size:12px;color:var(--text-muted)">${a.fecha_checkin}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
    } catch(e) { el.innerHTML = `<p style="color:#ef4444;padding:12px">❌ ${e.message}</p>`; }
}

// ─── GESTIÓN DE EMPRESAS ─────────────────────────────────────────
function panelEmpresas() {
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px">
      <h2 style="font-size:15px;font-weight:700;color:var(--text-primary);margin:0 0 16px">🏢 Gestión de Empresas y Gerencias</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:20px">
        <!-- Nueva Gerencia -->
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:12px">➕ Nueva Gerencia</div>
          <input id="nueva-gerencia-nombre" type="text" placeholder="Nombre de gerencia…"
            style="width:100%;padding:10px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box;margin-bottom:10px">
          <button id="btn-nueva-gerencia" style="width:100%;background:#f59e0b;color:white;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer">Crear Gerencia</button>
          <div id="msg-gerencia" style="margin-top:8px;font-size:12px;font-weight:600;min-height:16px"></div>
        </div>
        <!-- Nueva Empresa -->
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:12px">➕ Nueva Empresa</div>
          <input id="nueva-emp-nombre" type="text" placeholder="Nombre empresa…"
            style="width:100%;padding:10px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box;margin-bottom:8px">
          <select id="nueva-emp-turno" style="width:100%;padding:10px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:14px;outline:none;margin-bottom:8px">
            <option value="">— Turno (opcional) —</option>
            <option value="Día">Día</option>
            <option value="Noche">Noche</option>
            <option value="Rotativo">Rotativo</option>
          </select>
          <select id="nueva-emp-gerencia" style="width:100%;padding:10px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:14px;outline:none;margin-bottom:10px">
            <option value="">— Gerencia —</option>
          </select>
          <button id="btn-nueva-empresa" style="width:100%;background:#f59e0b;color:white;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer">Crear Empresa</button>
          <div id="msg-empresa" style="margin-top:8px;font-size:12px;font-weight:600;min-height:16px"></div>
        </div>
      </div>
      <div id="lista-empresas"><p style="text-align:center;color:var(--text-muted)">Cargando…</p></div>
    </div>`;
}

async function renderListaEmpresas() {
    try {
        const [empresas, gerencias] = await Promise.all([
            getEmpresasConOcupacion(),  // v2_empresas JOIN v2_gerencias + count v2_asignaciones
            getGerencias()
        ]);
        _empresas = empresas;

        // Actualizar select de gerencias en el form
        fillSelect('nueva-emp-gerencia', gerencias, g => ({ v: g.id, l: g.nombre }), '— Seleccionar Gerencia —');
        // Actualizar select de empresa en check-in
        fillSelect('ci-empresa', empresas, e => ({ v: e.id, l: `${e.nombre}${e.turno ? ' · ' + e.turno : ''}` }));

        const el = document.getElementById('lista-empresas');
        if (!el) return;
        if (!empresas.length) { el.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:20px">Sin empresas registradas aún</p>`; return; }
        el.innerHTML = `
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${empresas.length} empresas · fuente: <code style="color:#6366f1">v2_empresas ⟶ v2_gerencias</code> · ocupación de <code style="color:#6366f1">v2_asignaciones</code></p>
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden;overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;min-width:480px">
              <thead><tr style="background:var(--bg-card);border-bottom:1px solid var(--border)">
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted)">Empresa</th>
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted)">Turno</th>
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted)">Gerencia</th>
                <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:var(--text-muted)">Camas Activas</th>
              </tr></thead>
              <tbody>${empresas.map((e,i) => `<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg-card)'}">
                <td style="padding:10px 14px;font-weight:600;font-size:13px;color:var(--text-primary)">${e.nombre}</td>
                <td style="padding:10px 14px;font-size:13px;color:var(--text-secondary)">${e.turno||'—'}</td>
                <td style="padding:10px 14px;font-size:13px;color:var(--text-secondary)">${e.v2_gerencias?.nombre||'—'}</td>
                <td style="padding:10px 14px;text-align:right">
                  <span style="background:${e.camas_activas>0?'rgba(239,68,68,0.1)':'rgba(16,185,129,0.1)'};color:${e.camas_activas>0?'#ef4444':'#10b981'};font-weight:700;font-size:13px;padding:3px 10px;border-radius:20px">
                    ${e.camas_activas > 0 ? `🔴 ${e.camas_activas} ocup.` : '✅ 0'}
                  </span>
                </td>
              </tr>`).join('')}</tbody>
            </table>
          </div>`;
    } catch(e) {
        const el = document.getElementById('lista-empresas');
        if (el) el.innerHTML = `<p style="color:#ef4444">❌ ${e.message}</p>`;
    }
}

async function crearNuevaGerencia() {
    const nombre = document.getElementById('nueva-gerencia-nombre')?.value?.trim();
    const msg = (t, c) => { const el = document.getElementById('msg-gerencia'); if(el){el.textContent=t;el.style.color=c;} };
    if (!nombre) { msg('⚠️ Ingresa un nombre', '#f59e0b'); return; }
    try {
        await crearGerencia(nombre);
        document.getElementById('nueva-gerencia-nombre').value = '';
        msg('✅ Gerencia creada', '#10b981');
        await renderListaEmpresas();
    } catch(e) { msg('❌ ' + e.message, '#ef4444'); }
}

async function crearNuevaEmpresa() {
    const nombre     = document.getElementById('nueva-emp-nombre')?.value?.trim();
    const turno      = document.getElementById('nueva-emp-turno')?.value;
    const gerenciaId = document.getElementById('nueva-emp-gerencia')?.value;
    const msg = (t, c) => { const el = document.getElementById('msg-empresa'); if(el){el.textContent=t;el.style.color=c;} };
    if (!nombre || !gerenciaId) { msg('⚠️ Nombre y gerencia son obligatorios', '#f59e0b'); return; }
    try {
        await crearEmpresa({ nombre, turno: turno || null, gerenciaId });
        document.getElementById('nueva-emp-nombre').value = '';
        msg('✅ Empresa creada', '#10b981');
        await renderListaEmpresas();
    } catch(e) { msg('❌ ' + e.message, '#ef4444'); }
}

// ─── UTILIDADES ──────────────────────────────────────────────────
function fld(id, label, type, placeholder = '') {
    if (type === 'select') return `<div>
      <label style="display:block;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">${label}</label>
      <select id="${id}" style="width:100%;padding:11px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;outline:none">
        <option value="">— Seleccionar —</option>
      </select></div>`;
    return `<div>
      <label style="display:block;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">${label}</label>
      <input id="${id}" type="${type}" placeholder="${placeholder}"
        style="width:100%;padding:11px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box">
    </div>`;
}

function fillSelect(id, items, mapper, emptyLabel = '— Seleccionar —') {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = `<option value="">${emptyLabel}</option>` +
        items.map(i => { const m = mapper(i); return `<option value="${m.v}">${m.l}</option>`; }).join('');
}

function resetSel(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">— Seleccionar —</option>';
}
