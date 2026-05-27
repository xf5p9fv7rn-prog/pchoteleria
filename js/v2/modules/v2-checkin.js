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
        ${tabBtn('ci', '✅ Check-in', '#10b981', true)}
        ${tabBtn('co', '🚪 Check-out', '#ef4444', false)}
        ${tabBtn('recepcion', '🏨 Recepción', '#6366f1', false)}
        ${tabBtn('activos', '📋 Activos', '#475569', false)}
        ${tabBtn('empresas', '🏢 Empresas', '#f59e0b', false)}
      </div>
      <div id="panel-ci">${panelCheckin()}</div>
      <div id="panel-co"      style="display:none">${panelCheckout()}</div>
      <div id="panel-recepcion" style="display:none">${panelRecepcion()}</div>
      <div id="panel-activos" style="display:none"><div id="lista-activos" style="text-align:center;padding:40px;color:var(--text-muted)">Cargando…</div></div>
      <div id="panel-empresas" style="display:none">${panelEmpresas()}</div>
    </div>`;

  ['ci', 'co', 'recepcion', 'activos', 'empresas'].forEach(t =>
    document.getElementById(`tab-${t}`)?.addEventListener('click', () => switchTab(t))
  );

  // Cargar datos iniciales en paralelo
  const [empresas, edificios] = await Promise.all([getEmpresas(), getEdificios()]);
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
  document.getElementById('btn-revocar-empresa')?.addEventListener('click', revocarEmpresaCompleta);
  document.getElementById('rec-rut')?.addEventListener('keydown', e => { if (e.key === 'Enter') buscarAutorizacion(); });
  document.getElementById('btn-checkin')?.addEventListener('click', handleCheckin);
  document.getElementById('btn-buscar-co')?.addEventListener('click', buscarCheckout);
  document.getElementById('btn-com-previsualizar')?.addEventListener('click', previsualizarCheckoutMasivo);
  document.getElementById('btn-com-ejecutar')?.addEventListener('click', ejecutarCheckoutMasivo);
  document.getElementById('btn-nueva-empresa')?.addEventListener('click', crearNuevaEmpresa);
  document.getElementById('btn-nueva-gerencia')?.addEventListener('click', crearNuevaGerencia);
  // Cargar empresas en el selector de checkout masivo
  cargarEmpresasCheckoutMasivo();

  // Cargar gerencias en panel empresas
  renderListaEmpresas();
}

// ─── TABS ────────────────────────────────────────────────────────
function tabBtn(id, label, color, active) {
  return `<button id="tab-${id}" style="padding:10px 18px;border-radius:10px;border:1.5px solid ${active ? color : 'var(--border)'};background:${active ? color : 'var(--bg-card)'};color:${active ? '#fff' : 'var(--text-primary)'};font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s">${label}</button>`;
}

function switchTab(name) {
  const colors = { ci: '#10b981', co: '#ef4444', recepcion: '#6366f1', activos: '#475569', empresas: '#f59e0b' };
  ['ci', 'co', 'recepcion', 'activos', 'empresas'].forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    const panel = document.getElementById(`panel-${t}`);
    const on = t === name;
    if (btn) { btn.style.background = on ? colors[t] : 'var(--bg-card)'; btn.style.color = on ? '#fff' : 'var(--text-primary)'; btn.style.borderColor = on ? colors[t] : 'var(--border)'; }
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
        ${fld('ci-edificio', 'Edificio', 'select')}
        ${fld('ci-pabellon', 'Pabellón', 'select')}
        ${fld('ci-habitacion', 'Habitación', 'select')}
        ${fld('ci-cama', 'Cama disponible', 'select')}
      </div>
      <div style="border-top:1px solid var(--border);margin:20px 0"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px">
        ${fld('ci-rut', 'RUT del huésped', 'text', '12345678-9')}
        ${fld('ci-nombre', 'Nombre completo', 'text', 'Nombre Apellido')}
        ${fld('ci-empresa', 'Empresa', 'select')}
        ${fld('ci-fecha', 'Fecha Check-in', 'date')}
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
  } catch (e) { msg('❌ ' + e.message, '#ef4444'); }
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
        <div style="display:flex;flex-direction:column;gap:8px">
          <button id="btn-autorizar-empresa"
            style="width:100%;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(245,158,11,0.35);display:flex;align-items:center;justify-content:center;gap:8px">
            🚀 Autorizar toda la empresa
          </button>
          <button id="btn-revocar-empresa"
            style="width:100%;background:transparent;color:#dc2626;border:2px solid #fca5a5;border-radius:12px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .15s"
            onmouseover="this.style.background='rgba(239,68,68,.08)'" onmouseout="this.style.background='transparent'">
            🔒 Revocar autorización de empresa
          </button>
        </div>
        <div id="rec-empresa-msg" style="margin-top:10px;min-height:20px;font-size:13px;font-weight:600"></div>
      </div>
    </div>`;
}

async function buscarAutorizacion() {
  const sb = await getSbRec();
  const rut = document.getElementById('rec-rut')?.value?.trim();
  const fb = document.getElementById('rec-feedback');
  const btn = document.getElementById('btn-autorizar-rapido');
  if (!rut) { fb.innerHTML = `<p style="color:#f59e0b;font-weight:600">⚠️ Ingresa un RUT</p>`; return; }

  btn.innerHTML = '⏳ Buscando…'; btn.disabled = true;

  const rutBase    = rut.replace(/[\.\-\s]/g, '').toUpperCase();
  const rutDash    = rutBase.length > 1 ? rutBase.slice(0, -1) + '-' + rutBase.slice(-1) : rutBase;
  const rutPattern = rutBase.slice(0, -1); // prefijo sin dígito verificador — tolerante a puntos/guiones

  // ── 1. Buscar en v2_asignaciones activas ──────────────────────────────────
  const { data, error } = await sb
    .from('v2_asignaciones')
    .select('id, rut_huesped, nombre_huesped, id_cama, autorizado_checkin, huesped_confirmo, v2_empresas(nombre,turno)')
    .or(`rut_huesped.ilike.%${rutPattern}%`)
    .is('fecha_checkout', null)
    .order('fecha_checkin', { ascending: false })
    .limit(5);

  const match = data?.find(r =>
    r.rut_huesped?.replace(/[\.\-\s]/g,'').toUpperCase() === rutBase ||
    r.rut_huesped?.replace(/[\.\-\s]/g,'').toUpperCase() === rutDash.replace('-','')
  ) || data?.[0];

  // ── 2. Si ya tiene asignación → flujo normal ──────────────────────────────
  if (!error && match) {
    btn.innerHTML = '🏨 Autorizar Llegada'; btn.disabled = false;

    if (match.huesped_confirmo) {
      fb.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:12px;background:#dcfce7;border:1.5px solid #86efac;border-radius:10px">
          <span style="font-size:20px">✅</span>
          <div><div style="font-weight:800;color:#15803d;font-size:13px">${match.nombre_huesped}</div>
          <div style="font-size:11px;color:#166534">Ya confirmó llegada · Cama ${match.id_cama}</div></div>
        </div>`;
      document.getElementById('rec-rut').value = '';
      document.getElementById('rec-rut').focus();
      return;
    }

    if (match.autorizado_checkin) {
      fb.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:20px">🟡</span>
            <div><div style="font-weight:800;color:#1d4ed8;font-size:13px">${match.nombre_huesped}</div>
            <div style="font-size:11px;color:#1e40af">Ya autorizado · esperando confirmación</div></div>
          </div>
          <button onclick="window._revocarAutorizacion('${match.id}')"
            style="background:transparent;border:1.5px solid #ef4444;color:#ef4444;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">✕ Revocar</button>
        </div>`;
      return;
    }

    // Autorizar
    btn.innerHTML = '⏳ Autorizando…'; btn.disabled = true;
    await sb.from('v2_asignaciones').update({ autorizado_checkin: true, huesped_confirmo: true }).eq('id', match.id);
    btn.innerHTML = '🏨 Autorizar Llegada'; btn.disabled = false;
    _mostrarAutorizado(fb, match.nombre_huesped, match.id_cama, match.v2_empresas?.nombre);
    document.getElementById('rec-rut').value = '';
    setTimeout(() => document.getElementById('rec-rut').focus(), 100);
    return;
  }

  // ── 3. Sin asignación formal → buscar en solicitudes y CREAR automáticamente ──
  btn.innerHTML = '⏳ Verificando solicitud…'; btn.disabled = true;

  const { data: solList } = await sb
    .from('v2_solicitudes_b2b')
    .select('id, nombre_trabajador, rut_trabajador, empresa, hab_solicitada, fecha_llegada, fecha_salida, status')
    .or(`rut_trabajador.ilike.%${rutPattern}%`)
    .in('status', ['aceptada', 'aceptada_asignada'])
    .limit(5);

  const sol = solList?.find(s =>
    s.rut_trabajador?.replace(/[\.\-\s]/g,'').toUpperCase().includes(rutPattern)
  );

  if (!sol) {
    btn.innerHTML = '🏨 Autorizar Llegada'; btn.disabled = false;
    fb.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px">
        <span style="font-size:20px">❌</span>
        <div>
          <div style="font-weight:700;color:#c53030;font-size:13px">RUT no encontrado</div>
          <div style="font-size:11px;color:#718096">Verifica el RUT · El trabajador debe tener solicitud aceptada</div>
        </div>
      </div>`;
    return;
  }

  // Encontrado en solicitudes — crear asignación automáticamente
  btn.innerHTML = '⏳ Creando asignación…'; btn.disabled = true;
  fb.innerHTML = `<div style="padding:10px;color:#6b7280;font-size:12px">⚙️ Asignando cama a ${sol.nombre_trabajador}…</div>`;

  try {
    const hoy = new Date().toISOString().split('T')[0];

    // Buscar habitacion_id por numero_hab
    const { data: habRow } = await sb
      .from('v2_habitaciones')
      .select('id_custom')
      .eq('numero_hab', sol.hab_solicitada)
      .maybeSingle();

    if (!habRow?.id_custom) throw new Error(`Hab. ${sol.hab_solicitada} no existe en la BD`);

    // Buscar cama libre en esa habitación
    const { data: camasDisp } = await sb
      .from('v2_camas')
      .select('id_cama')
      .eq('habitacion_id', habRow.id_custom)
      .eq('estado', 'Disponible')
      .limit(1);

    if (!camasDisp?.length) throw new Error(`Sin camas libres en hab. ${sol.hab_solicitada}`);
    const camaId = camasDisp[0].id_cama;

    // Buscar empresa_id
    const { data: empRow } = await sb
      .from('v2_empresas')
      .select('id')
      .ilike('nombre', `%${(sol.empresa || '').split(' ')[0]}%`)
      .limit(1)
      .maybeSingle();

    const rutNorm = String(sol.rut_trabajador || '').replace(/\./g,'').toUpperCase().slice(0,12);
    const estadoAsig = sol.fecha_llegada && sol.fecha_llegada > hoy ? 'pre_asignado' : 'activa';

    // Insertar asignación
    const { error: errI } = await sb.from('v2_asignaciones').insert({
      id_cama:                 camaId,
      rut_huesped:             rutNorm,
      nombre_huesped:          sol.nombre_trabajador,
      empresa_id:              empRow?.id || null,
      fecha_checkin:           sol.fecha_llegada || hoy,
      fecha_salida_programada: sol.fecha_salida  || null,
      estado_asignacion:       estadoAsig,
      huesped_confirmo:        true,
      autorizado_checkin:      true,
    });
    if (errI) throw new Error(errI.message);

    // Marcar cama
    await sb.from('v2_camas').update({ estado: estadoAsig === 'activa' ? 'Ocupada' : 'Disponible' }).eq('id_cama', camaId);

    btn.innerHTML = '🏨 Autorizar Llegada'; btn.disabled = false;
    _mostrarAutorizado(fb, sol.nombre_trabajador, camaId, sol.empresa);
    document.getElementById('rec-rut').value = '';
    setTimeout(() => document.getElementById('rec-rut').focus(), 100);

  } catch(e) {
    btn.innerHTML = '🏨 Autorizar Llegada'; btn.disabled = false;
    fb.innerHTML = `
      <div style="padding:12px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:10px">
        <div style="font-weight:700;color:#c53030;font-size:13px">❌ ${sol.nombre_trabajador}</div>
        <div style="font-size:11px;color:#718096;margin-top:4px">${e.message}</div>
      </div>`;
  }
}

function _mostrarAutorizado(fb, nombre, cama, empresa) {
  fb.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:14px;background:#dcfce7;border:1.5px solid #86efac;border-radius:12px">
      <div style="width:42px;height:42px;border-radius:10px;background:#16a34a;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:900;flex-shrink:0">
        ${nombre?.[0]?.toUpperCase() || '?'}
      </div>
      <div>
        <div style="font-weight:800;color:#15803d;font-size:14px">✅ ${nombre}</div>
        <div style="font-size:12px;color:#166534">Autorizado · Cama <strong>${cama}</strong>${empresa ? ' · ' + empresa : ''}</div>
      </div>
    </div>`;
}



async function cargarEmpresasRecepcion() {
  const sb = await getSbRec();
  const { data } = await sb.from('v2_empresas').select('id, nombre, turno').order('nombre');
  if (!data) return;
  const sel = document.getElementById('rec-empresa-sel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Seleccionar empresa —</option>' +
    data.map(e => `<option value="${e.id}">${e.nombre}${e.turno ? ' · ' + e.turno : ''}</option>`).join('');

  sel.addEventListener('change', async () => {
    const empId = sel.value;
    const prev = document.getElementById('rec-empresa-preview');
    if (!empId) { prev.innerHTML = ''; return; }
    prev.innerHTML = `<span style="color:var(--text-muted);font-size:12px">Contando…</span>`;
    const [{ count: pendientes }, { count: autorizados }] = await Promise.all([
      sb.from('v2_asignaciones')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', empId).is('fecha_checkout', null).eq('autorizado_checkin', false),
      sb.from('v2_asignaciones')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', empId).is('fecha_checkout', null).eq('autorizado_checkin', true)
    ]);
    const total = (pendientes || 0) + (autorizados || 0);
    prev.innerHTML = total === 0
      ? `<span style="background:#f1f5f9;border-radius:8px;padding:6px 16px;font-weight:700;color:#64748b;font-size:12px">Sin asignaciones activas</span>`
      : `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
                ${autorizados > 0 ? `<span style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:5px 14px;font-weight:700;color:#15803d;font-size:12px">✅ ${autorizados} autorizado${autorizados !== 1 ? 's' : ''}</span>` : ''}
                ${pendientes > 0 ? `<span style="background:#fef3c7;border:1px solid #fde047;border-radius:8px;padding:5px 14px;font-weight:700;color:#854d0e;font-size:12px">⏳ ${pendientes} pendiente${pendientes !== 1 ? 's' : ''}</span>` : ''}
               </div>`;
  });
}

async function autorizarEmpresaCompleta() {
  const sb = await getSbRec();
  const empId = document.getElementById('rec-empresa-sel')?.value;
  const msg = document.getElementById('rec-empresa-msg');
  const btn = document.getElementById('btn-autorizar-empresa');
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

async function revocarEmpresaCompleta() {
  const sb = await getSbRec();
  const empId = document.getElementById('rec-empresa-sel')?.value;
  const msg = document.getElementById('rec-empresa-msg');
  const btn = document.getElementById('btn-revocar-empresa');
  if (!empId) { msg.textContent = '⚠️ Selecciona una empresa'; msg.style.color = '#f59e0b'; return; }
  const empNombre = document.getElementById('rec-empresa-sel')?.selectedOptions[0]?.text || '';
  if (!confirm(`¿Revocar la autorización de TODOS los trabajadores de "${empNombre}"?\n\nDeberán pasar por Administración para que se les habilite manualmente.`)) return;
  btn.textContent = '⏳ Revocando…'; btn.disabled = true;
  const { error } = await sb.from('v2_asignaciones')
    .update({ autorizado_checkin: false })
    .eq('empresa_id', empId)
    .is('fecha_checkout', null);
  btn.textContent = '🔒 Revocar autorización de empresa'; btn.disabled = false;
  if (error) { msg.innerHTML = `<span style="color:#dc2626">❌ ${error.message}</span>`; return; }
  msg.innerHTML = `<span style="color:#dc2626">🔒 Autorización revocada — deben pasar por Administración</span>`;
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
  return `<div style="display:flex;flex-direction:column;gap:16px">

      <!-- Individual -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:22px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="background:linear-gradient(135deg,#ef4444,#dc2626);border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px">🔍</div>
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--text-primary)">Check-out Individual</div>
            <div style="font-size:11px;color:var(--text-secondary)">Buscar por RUT o nombre</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <input id="co-q" type="text" placeholder="Buscar por RUT o nombre…"
            style="flex:1;min-width:200px;padding:12px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;outline:none"
            onkeydown="if(event.key==='Enter') document.getElementById('btn-buscar-co').click()">
          <button id="btn-buscar-co" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer">🔍 Buscar</button>
        </div>
        <div id="co-resultados"><p style="text-align:center;color:var(--text-muted);padding:20px">Ingresa un RUT o nombre para buscar estadías activas</p></div>
      </div>

      <!-- Masivo por empresa -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:22px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="background:linear-gradient(135deg,#dc2626,#991b1b);border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px">🚨</div>
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--text-primary)">Check-out Masivo por Empresa</div>
            <div style="font-size:11px;color:var(--text-secondary)">Selecciona empresa, revisa la lista y extiende quien lo necesite</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px">
          <div style="flex:1;min-width:180px">
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Empresa</label>
            <select id="com-empresa-sel"
              style="width:100%;padding:11px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;outline:none">
              <option value="">— Seleccionar empresa —</option>
            </select>
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Fecha checkout</label>
            <input id="com-fecha" type="date"
              style="padding:11px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;outline:none">
          </div>
          <button id="btn-com-previsualizar"
            style="padding:11px 20px;border-radius:10px;border:none;background:#ef4444;color:#fff;font-weight:800;font-size:14px;cursor:pointer;white-space:nowrap">
            🔍 Ver trabajadores
          </button>
        </div>
        <div id="com-lista" style="margin-bottom:12px"></div>
        <div id="com-msg" style="min-height:18px;font-size:13px;font-weight:600"></div>
        <div id="com-btn-wrap" style="display:none;margin-top:12px">
          <button id="btn-com-ejecutar"
            style="width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;font-weight:900;font-size:15px;cursor:pointer;box-shadow:0 4px 14px rgba(220,38,38,0.35)">
            🚨 Ejecutar Check-out Masivo
          </button>
        </div>
      </div>
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
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">📍 <strong>${a.id_cama}</strong> · ${a.v2_empresas?.nombre || '—'} · Check-in: ${a.fecha_checkin}</div>
              </div>
              <button onclick="window._doCheckout('${a.id}','${a.id_cama}')"
                style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">🚪 Check-out</button>
            </div>`).join('')}
        </div>`;
    window._doCheckout = async (asigId, camaId) => {
      try { await doCheckout(asigId); alert(`✅ Check-out registrado. Cama ${camaId} ahora DISPONIBLE.`); buscarCheckout(); }
      catch (e) { alert('❌ ' + e.message); }
    };
  } catch (e) { el.innerHTML = `<p style="color:#ef4444;padding:12px">❌ ${e.message}</p>`; }
}

// ─── CHECKOUT MASIVO — Estado del módulo ─────────────────────────
let _comAsignaciones = [];
const _comExtendidos = new Map();

async function cargarEmpresasCheckoutMasivo() {
  const sb = await getSbRec();
  const { data } = await sb.from('v2_empresas').select('id,nombre,turno').order('nombre');
  if (!data) return;
  const sel = document.getElementById('com-empresa-sel');
  if (!sel) return;
  const fechaEl = document.getElementById('com-fecha');
  if (fechaEl) fechaEl.value = today();
  sel.innerHTML = '<option value="">— Seleccionar empresa —</option>' +
    data.map(e => `<option value="${e.id}">${e.nombre}${e.turno ? ' · ' + e.turno : ''}</option>`).join('');
}

async function previsualizarCheckoutMasivo() {
  const sb = await getSbRec();
  const empId = document.getElementById('com-empresa-sel')?.value;
  const fecha = document.getElementById('com-fecha')?.value;
  const lista = document.getElementById('com-lista');
  const msg = document.getElementById('com-msg');
  const btnW = document.getElementById('com-btn-wrap');
  if (!empId) { msg.textContent = '⚠️ Selecciona una empresa'; msg.style.color = '#f59e0b'; return; }

  msg.textContent = '🔍 Cargando...'; msg.style.color = 'var(--text-muted)';
  lista.innerHTML = ''; btnW.style.display = 'none';
  _comAsignaciones = []; _comExtendidos.clear();

  let q = sb.from('v2_asignaciones')
    .select('id,rut_huesped,nombre_huesped,id_cama,fecha_checkin,fecha_salida_programada')
    .eq('empresa_id', empId).is('fecha_checkout', null).order('nombre_huesped');
  if (fecha) q = q.lte('fecha_salida_programada', fecha);
  const { data, error } = await q.limit(500);

  if (error) { msg.innerHTML = `<span style="color:#dc2626">❌ ${error.message}</span>`; return; }
  if (!data?.length) { msg.textContent = `⚠️ Sin asignaciones activas${fecha ? ' con salida hasta ' + fecha : ''}`; msg.style.color = '#f59e0b'; return; }

  _comAsignaciones = data;
  msg.textContent = `${data.length} trabajadores encontrados`; msg.style.color = '#64748b';
  btnW.style.display = 'block';

  lista.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;max-height:360px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border);position:sticky;top:0">
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted)">Nombre</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted)">Cama</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted)">Salida prog.</th>
          <th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text-muted)">Acción</th>
        </tr></thead>
        <tbody>
          ${data.map((a, i) => `
          <tr id="com-row-${a.id}" style="border-bottom:1px solid var(--border);background:${i % 2 === 0 ? 'transparent' : 'var(--bg)'}">
            <td style="padding:9px 12px;font-weight:600;color:var(--text-primary)">${a.nombre_huesped}</td>
            <td style="padding:9px 12px;font-family:monospace;color:#6366f1;font-weight:700">${a.id_cama}</td>
            <td style="padding:9px 12px;color:var(--text-muted)">${a.fecha_salida_programada || '—'}</td>
            <td style="padding:9px 12px;text-align:right">
              <div id="com-ext-${a.id}" style="display:flex;justify-content:flex-end;align-items:center;gap:6px">
                <span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">✅ checkout</span>
                <button onclick="window._comToggleExtender('${a.id}','${a.fecha_salida_programada || ''}')"
                  style="padding:4px 10px;border:1.5px solid #6366f1;background:transparent;color:#6366f1;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer">
                  📅 Extender
                </button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  window._comToggleExtender = (asigId, fechaActual) => {
    const extDiv = document.getElementById('com-ext-' + asigId);
    if (_comExtendidos.has(asigId)) {
      _comExtendidos.delete(asigId);
      const row = document.getElementById('com-row-' + asigId);
      if (row) row.style.opacity = '1';
      extDiv.innerHTML = `
                <span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">✅ checkout</span>
                <button onclick="window._comToggleExtender('${asigId}','${fechaActual}')"
                  style="padding:4px 10px;border:1.5px solid #6366f1;background:transparent;color:#6366f1;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer">📅 Extender</button>`;
    } else {
      extDiv.innerHTML = `
                <input type="date" id="com-nuevafecha-${asigId}" value="${fechaActual}"
                  style="padding:4px 8px;border-radius:7px;border:1.5px solid #6366f1;font-size:12px;outline:none;color:#1e293b">
                <button onclick="window._comConfirmarExtender('${asigId}')"
                  style="padding:4px 10px;border:none;background:#6366f1;color:#fff;border-radius:7px;font-size:11px;font-weight:800;cursor:pointer">✓ OK</button>
                <button onclick="window._comToggleExtender('${asigId}','${fechaActual}')"
                  style="padding:4px 8px;border:none;background:#e2e8f0;color:#64748b;border-radius:7px;font-size:11px;cursor:pointer">✕</button>`;
    }
  };
  window._comConfirmarExtender = (asigId) => {
    const nuevaFecha = document.getElementById('com-nuevafecha-' + asigId)?.value;
    if (!nuevaFecha) return;
    _comExtendidos.set(asigId, nuevaFecha);
    const row = document.getElementById('com-row-' + asigId);
    if (row) row.style.opacity = '0.45';
    document.getElementById('com-ext-' + asigId).innerHTML = `
            <span style="background:#ede9fe;color:#4c1d95;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">📅 hasta ${nuevaFecha}</span>
            <button onclick="window._comToggleExtender('${asigId}','')"
              style="padding:4px 8px;border:none;background:#e2e8f0;color:#64748b;border-radius:7px;font-size:11px;cursor:pointer">Quitar</button>`;
  };
}



async function ejecutarCheckoutMasivo() {
  if (!_comAsignaciones.length) return;
  const sb = await getSbRec();
  const msg = document.getElementById('com-msg');
  const btn = document.getElementById('btn-com-ejecutar');
  const hoy = today();

  const aCheckout = _comAsignaciones.filter(a => !_comExtendidos.has(a.id));
  const aExtendidos = _comAsignaciones.filter(a => _comExtendidos.has(a.id));

  if (!aCheckout.length && !aExtendidos.length) { msg.textContent = '⚠️ Sin trabajadores a procesar'; return; }
  const nomEmp = document.getElementById('com-empresa-sel')?.selectedOptions[0]?.text || '';
  if (!confirm(`Se realizara checkout a ${aCheckout.length} trabajadores de "${nomEmp}"\n${aExtendidos.length > 0 ? `y se extenderan ${aExtendidos.length} trabajadores.` : ''}`)) return;

  btn.textContent = '⏳ Procesando...'; btn.disabled = true;
  let okCo = 0, okEx = 0, errores = [];

  // 1. Extender estadias
  for (const a of aExtendidos) {
    const nuevaFecha = _comExtendidos.get(a.id);
    const { error } = await sb.from('v2_asignaciones')
      .update({ fecha_salida_programada: nuevaFecha }).eq('id', a.id);
    if (error) errores.push(`${a.nombre_huesped}: ${error.message}`);
    else okEx++;
  }

  // 2. Checkout masivo
  for (const a of aCheckout) {
    try {
      const { error: eCo } = await sb.from('v2_asignaciones')
        .update({ fecha_checkout: hoy }).eq('id', a.id);
      if (eCo) throw new Error(eCo.message);
      await sb.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', a.id_cama);
      okCo++;
    } catch (e) { errores.push(`${a.nombre_huesped}: ${e.message}`); }
  }

  btn.textContent = '🚨 Ejecutar Check-out Masivo'; btn.disabled = false;
  _comAsignaciones = []; _comExtendidos.clear();

  if (errores.length === 0) {
    msg.innerHTML = `<span style="color:#16a34a">✅ ${okCo} checkout${okCo !== 1 ? 's' : ''} realizados${okEx > 0 ? ' · 📅 ' + okEx + ' extendidos' : ''}. Camas liberadas.</span>`;
    document.getElementById('com-lista').innerHTML = '';
    document.getElementById('com-btn-wrap').style.display = 'none';
  } else {
    msg.innerHTML = `<span style="color:#f59e0b">⚠️ ${okCo} ok, ${errores.length} errores:<br>${errores.map(e => `<small style="color:#dc2626">• ${e}</small>`).join('<br>')}</span>`;
  }
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
                ${['Huésped', 'RUT', 'Cama', 'Empresa', 'Check-in'].map(h => `<th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`).join('')}
              </tr></thead>
              <tbody>
                ${data.map((a, i) => `<tr style="border-bottom:1px solid var(--border);background:${i % 2 === 0 ? 'transparent' : 'var(--bg)'}">
                  <td style="padding:11px 14px;font-weight:600;font-size:13px;color:var(--text-primary)">${a.nombre_huesped}</td>
                  <td style="padding:11px 14px;font-size:12px;font-family:monospace;color:var(--text-secondary)">${a.rut_huesped}</td>
                  <td style="padding:11px 14px;font-size:12px;font-family:monospace;color:#6366f1;font-weight:700">${a.id_cama}</td>
                  <td style="padding:11px 14px;font-size:12px;color:var(--text-secondary)">${a.v2_empresas?.nombre || '—'}</td>
                  <td style="padding:11px 14px;font-size:12px;color:var(--text-muted)">${a.fecha_checkin}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
  } catch (e) { el.innerHTML = `<p style="color:#ef4444;padding:12px">❌ ${e.message}</p>`; }
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
              <tbody>${empresas.map((e, i) => `<tr style="border-bottom:1px solid var(--border);background:${i % 2 === 0 ? 'transparent' : 'var(--bg-card)'}">
                <td style="padding:10px 14px;font-weight:600;font-size:13px;color:var(--text-primary)">${e.nombre}</td>
                <td style="padding:10px 14px;font-size:13px;color:var(--text-secondary)">${e.turno || '—'}</td>
                <td style="padding:10px 14px;font-size:13px;color:var(--text-secondary)">${e.v2_gerencias?.nombre || '—'}</td>
                <td style="padding:10px 14px;text-align:right">
                  <span style="background:${e.camas_activas > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'};color:${e.camas_activas > 0 ? '#ef4444' : '#10b981'};font-weight:700;font-size:13px;padding:3px 10px;border-radius:20px">
                    ${e.camas_activas > 0 ? `🔴 ${e.camas_activas} ocup.` : '✅ 0'}
                  </span>
                </td>
              </tr>`).join('')}</tbody>
            </table>
          </div>`;
  } catch (e) {
    const el = document.getElementById('lista-empresas');
    if (el) el.innerHTML = `<p style="color:#ef4444">❌ ${e.message}</p>`;
  }
}

async function crearNuevaGerencia() {
  const nombre = document.getElementById('nueva-gerencia-nombre')?.value?.trim();
  const msg = (t, c) => { const el = document.getElementById('msg-gerencia'); if (el) { el.textContent = t; el.style.color = c; } };
  if (!nombre) { msg('⚠️ Ingresa un nombre', '#f59e0b'); return; }
  try {
    await crearGerencia(nombre);
    document.getElementById('nueva-gerencia-nombre').value = '';
    msg('✅ Gerencia creada', '#10b981');
    await renderListaEmpresas();
  } catch (e) { msg('❌ ' + e.message, '#ef4444'); }
}

async function crearNuevaEmpresa() {
  const nombre = document.getElementById('nueva-emp-nombre')?.value?.trim();
  const turno = document.getElementById('nueva-emp-turno')?.value;
  const gerenciaId = document.getElementById('nueva-emp-gerencia')?.value;
  const msg = (t, c) => { const el = document.getElementById('msg-empresa'); if (el) { el.textContent = t; el.style.color = c; } };
  if (!nombre || !gerenciaId) { msg('⚠️ Nombre y gerencia son obligatorios', '#f59e0b'); return; }
  try {
    await crearEmpresa({ nombre, turno: turno || null, gerenciaId });
    document.getElementById('nueva-emp-nombre').value = '';
    msg('✅ Empresa creada', '#10b981');
    await renderListaEmpresas();
  } catch (e) { msg('❌ ' + e.message, '#ef4444'); }
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
