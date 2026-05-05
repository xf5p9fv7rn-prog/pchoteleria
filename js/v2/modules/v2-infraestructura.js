/**
 * v2-infraestructura.js — Infraestructura V2
 * Usa CheckinPopoverV2 para check-in/out sin fondos oscuros
 */
import {
    getEdificios, getPabellones, getHabitaciones, getCamas,
    getEmpresas, getAsignacionByCama, doCheckin, doCheckout,
    buscarTrabajadorPorRut, today
} from '../v2-service.js';
import { abrirPopover, cerrarPopover } from './CheckinPopoverV2.js';
import { supabase } from '../../supabaseClient.js';

let _edificios = [], _pabellones = [], _habitaciones = [], _empresas = [];
let _selEdificio = null, _selPabellon = null;
let _camaData  = {};
let _busqueda  = '';
let _filtEmpresa = '', _filtNombre = '', _filtGerencia = '';

export async function renderV2Infraestructura(container) {
    container.innerHTML = `
    <div style="padding:20px;max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <div style="background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">🏕️</div>
        <div>
          <h1 style="font-size:22px;font-weight:800;color:var(--text-primary);margin:0">Infraestructura V2</h1>
          <p style="font-size:13px;color:var(--text-secondary);margin:0">Edificio → Pabellón → Camas · Clic en cama para Check-in o Check-out</p>
        </div>
        <button onclick="window.navigate('v2infraestructura')" style="margin-left:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary)">🔄 Actualizar</button>
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        ${leg('#10b981','L','Libre — clic para Check-in')}
        ${leg('#ef4444','O','Ocupada — llegada pendiente de confirmar')}
        ${leg('#22c55e','✓','Ocupada — huésped confirmó llegada')}
        ${leg('#f59e0b','M','Mantención')}
      </div>

      <div id="v2i-loading" style="text-align:center;padding:40px;color:var(--text-muted)">Cargando edificios…</div>
      <div id="v2i-edif-row" style="display:none;flex-wrap:wrap;gap:8px;margin-bottom:12px"></div>
      <div id="v2i-pab-row"  style="display:none;flex-wrap:wrap;gap:8px;margin-bottom:14px"></div>
      <div id="v2i-stats"    style="display:none;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px"></div>
      <!-- Barra de filtros (oculta hasta que se seleccione pabellón) -->
      <div id="v2i-filters" style="display:none;margin-bottom:14px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <input id="v2i-search" type="text" placeholder="🏠 Número o ID hab…"
            style="padding:11px 14px;border-radius:12px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;outline:none">
          <input id="v2i-f-empresa" type="text" placeholder="🏢 Empresa…"
            style="padding:11px 14px;border-radius:12px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;outline:none">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <input id="v2i-f-nombre" type="text" placeholder="👤 Nombre huésped…"
            style="padding:11px 14px;border-radius:12px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;outline:none">
          <input id="v2i-f-gerencia" type="text" placeholder="🏛 Gerencia…"
            style="padding:11px 14px;border-radius:12px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;outline:none">
        </div>
      </div>
      <div id="v2i-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px"></div>
    </div>
    <!-- Overlay invisible: solo cierra popover al hacer clic fuera -->
    <div id="cama-overlay" onclick="window._v2iCloseModal()"
         style="display:none;position:fixed;inset:0;z-index:9990;background:transparent">
    </div>`;

    // Globales
    window._v2iCloseModal      = cerrarPopover;
    window._v2iSelectEdificio  = id => selectEdificio(id);
    window._v2iSelectPabellon  = id => selectPabellon(id);
    window._v2iOpenCama        = (ev, id) => openCamaModal(ev, id);
    window._v2iDoCheckin       = id => handleCheckin(id);
    window._v2iDoCheckout      = (asigId, camaId) => handleCheckout(asigId, camaId);
    window._v2iOnEmpresaChange = () => {
        const empId = document.getElementById('ci-emp')?.value;
        const emp   = _empresas.find(e => e.id === empId);
        const el    = document.getElementById('ci-gerencia-display');
        if (el) el.textContent = emp?.v2_gerencias?.nombre || '—';
    };
    window._v2iAutoFillRut = async () => {
        const rutEl    = document.getElementById('ci-rut');
        const nombreEl = document.getElementById('ci-nombre');
        if (!rutEl || !nombreEl || nombreEl.value.trim()) return; // no sobreescribir si ya hay nombre
        const rut = rutEl.value.trim();
        if (!rut) return;
        const t = await buscarTrabajadorPorRut(rut);
        if (t) {
            nombreEl.value = t.nombre;
            // Pequeño feedback visual
            nombreEl.style.borderColor = '#10b981';
            setTimeout(() => nombreEl.style.borderColor = 'var(--border)', 2000);
        }
    };

    try {
        [_edificios, _empresas] = await Promise.all([getEdificios(), getEmpresas()]);
        document.getElementById('v2i-loading').style.display = 'none';
        renderEdificios();
        if (_edificios.length > 0) await selectEdificio(_edificios[0].id);
    } catch(e) {
        document.getElementById('v2i-loading').innerHTML = `<div style="color:#ef4444">❌ ${e.message}</div>`;
    }

    const refilter = () => renderGrid();
    document.getElementById('v2i-search')   ?.addEventListener('input', e => { _busqueda    = e.target.value; refilter(); });
    document.getElementById('v2i-f-empresa') ?.addEventListener('input', e => { _filtEmpresa = e.target.value; refilter(); });
    document.getElementById('v2i-f-nombre')  ?.addEventListener('input', e => { _filtNombre  = e.target.value; refilter(); });
    document.getElementById('v2i-f-gerencia')?.addEventListener('input', e => { _filtGerencia= e.target.value; refilter(); });
}

// ─── NAV ────────────────────────────────────────────────────────────────────
function renderEdificios() {
    const row = document.getElementById('v2i-edif-row');
    row.style.display = 'flex';
    row.innerHTML = _edificios.map(e =>
        `<button onclick="window._v2iSelectEdificio('${e.id}')" id="v2i-e-${e.id}"
          style="padding:10px 18px;border-radius:24px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-weight:700;font-size:13px;cursor:pointer;transition:all 0.2s">
          🏢 ${e.nombre}</button>`).join('');
}

async function selectEdificio(id) {
    _selEdificio = id; _selPabellon = null; _habitaciones = []; _camaData = {};
    markSel('v2i-e', _edificios, id, '#f59e0b');
    document.getElementById('v2i-grid').innerHTML = '';
    document.getElementById('v2i-stats').style.display = 'none';
    try {
        _pabellones = await getPabellones(id);
        renderPabellones();
        if (_pabellones.length > 0) await selectPabellon(_pabellones[0].id);
    } catch(e) { errRow('v2i-pab-row', e.message); }
}

function renderPabellones() {
    const row = document.getElementById('v2i-pab-row');
    row.style.display = 'flex';
    row.innerHTML = _pabellones.map(p =>
        `<button onclick="window._v2iSelectPabellon('${p.id}')" id="v2i-p-${p.id}"
          style="padding:8px 16px;border-radius:20px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-weight:600;font-size:12px;cursor:pointer;transition:all 0.2s">
          ${p.nombre}</button>`).join('');
}

async function selectPabellon(id) {
    _selPabellon = id;
    _busqueda = ''; _filtEmpresa = ''; _filtNombre = ''; _filtGerencia = '';
    const filters = document.getElementById('v2i-filters');
    if (filters) {
        filters.style.display = 'block';
        ['v2i-search','v2i-f-empresa','v2i-f-nombre','v2i-f-gerencia'].forEach(fid => {
            const el = document.getElementById(fid);
            if (el) el.value = '';
        });
    }
    markSel('v2i-p', _pabellones, id, '#6366f1');
    document.getElementById('v2i-grid').innerHTML =
        `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Cargando habitaciones…</div>`;
    try {
        _habitaciones = await getHabitaciones(id);
        await renderGrid();
    } catch(e) {
        document.getElementById('v2i-grid').innerHTML = `<div style="color:#ef4444">${e.message}</div>`;
    }
}

// ─── GRID ───────────────────────────────────────────────────────────────────
async function renderGrid() {
    const grid  = document.getElementById('v2i-grid');
    const stats = document.getElementById('v2i-stats');
    const q  = _busqueda.toLowerCase().trim();
    const qE = _filtEmpresa.toLowerCase().trim();
    const qN = _filtNombre.toLowerCase().trim();
    const qG = _filtGerencia.toLowerCase().trim();

    // Filtro por número/ID hab (sin necesitar datos de cama)
    let habs = q
        ? _habitaciones.filter(h => (h.numero_hab||'').toLowerCase().includes(q) || h.id_custom.toLowerCase().includes(q))
        : _habitaciones;

    if (!habs.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Sin habitaciones con ese filtro</div>`;
        stats.style.display = 'none'; return;
    }

    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">Cargando camas…</div>`;
    const camasArr = await Promise.all(habs.map(h => getCamas(h.id_custom)));
    habs.forEach((h, i) => camasArr[i].forEach(c => { _camaData[c.id_cama] = { estado: c.estado }; }));

    // Cargar etiquetas de distribucion para mostrar badges en tarjetas
    const todosHabIds = habs.map(h => h.id_custom);
    let habTagMap = {}; // habId -> { tipo, etiqueta }
    if (todosHabIds.length) {
        // Obtener todas las camas de estas habs con sus distribuciones
        const { data: distTags } = await supabase
            .from('v2_distribucion_camas')
            .select('id_cama, tipo, etiqueta')
            .in('id_cama', habs.flatMap((h,i) => camasArr[i].map(c => c.id_cama)).slice(0,1000));
        (distTags || []).forEach(d => {
            // Asociar al habId via camasArr
            for (let i = 0; i < habs.length; i++) {
                if (camasArr[i].some(c => c.id_cama === d.id_cama)) {
                    if (!habTagMap[habs[i].id_custom]) habTagMap[habs[i].id_custom] = d;
                    break;
                }
            }
        });
    }

    // Filtros por empresa / nombre / gerencia (sobre datos de camas cargadas)
    let filtIdx = habs.map((_, i) => i); // índices de habs a mostrar
    if (qE || qN || qG) {
        filtIdx = filtIdx.filter(i => {
            const cs = camasArr[i];
            return cs.some(c =>
                (!qE || (c.empresa||'').toLowerCase().includes(qE)) &&
                (!qN || (c.nombre_huesped||'').toLowerCase().includes(qN)) &&
                (!qG || (c.gerencia||'').toLowerCase().includes(qG))
            );
        });
        if (!filtIdx.length) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Sin resultados con ese filtro</div>`;
            stats.style.display = 'none'; return;
        }
    }
    const habsFilt   = filtIdx.map(i => habs[i]);
    const camasFilt  = filtIdx.map(i => camasArr[i]);

    let total = 0, ocup = 0, disp = 0, mant = 0;
    habsFilt.forEach((_, i) => camasFilt[i].forEach(c => {
        total++;
        if (c.estado === 'Ocupada') ocup++;
        else if (c.estado === 'Mantencion') mant++;
        else disp++;
    }));
    const pct = total > 0 ? Math.round((ocup / total) * 100) : 0;

    stats.style.display = 'grid';
    stats.innerHTML = [
        sc('🏠','HABS', habsFilt.length,'#6366f1'),
        sc('🛏️','CAMAS', total,'#6366f1'),
        sc('✅','DISP', disp,'#10b981'),
        sc('🔴','OCUP', ocup,'#ef4444'),
        sc('📊','%', pct+'%', pct>80?'#ef4444':pct>50?'#f59e0b':'#10b981'),
    ].join('');

    const edif = _edificios.find(e => e.id === _selEdificio);
    const pab  = _pabellones.find(p => p.id === _selPabellon);

    grid.innerHTML = `
      <div style="grid-column:1/-1;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:8px">
          <span>${edif?.nombre||''} · ${pab?.nombre||''}</span>
          <span style="color:${pct>80?'#ef4444':pct>50?'#f59e0b':'#10b981'}">${pct}% ocupado</span>
        </div>
        <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${pct>80?'#ef4444':pct>50?'#f59e0b':'#10b981'};border-radius:4px;transition:width 0.6s ease"></div>
        </div>
      </div>
      ${habsFilt.map((h, i) => {
        const cs = camasFilt[i];
        const ho = cs.filter(c=>c.estado==='Ocupada' && !c.huesped_confirmo).length;
        const hc = cs.filter(c=>c.estado==='Ocupada' &&  c.huesped_confirmo).length;
        const hd = cs.filter(c=>c.estado==='Disponible').length;
        const hm = cs.filter(c=>c.estado==='Mantencion').length;
        return `<div data-cama-card style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px;position:relative;overflow:visible">
          <div style="font-size:18px;font-weight:800;color:var(--text-primary)">${h.numero_hab}</div>
          <div style="font-size:10px;font-family:monospace;color:var(--text-muted);margin-bottom:10px">${h.id_custom}</div>
          ${h.nivel?`<div style="position:absolute;top:10px;right:10px;background:var(--bg);border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;color:var(--text-muted)">${h.nivel}</div>`:''}
          ${(() => {
            const tag = habTagMap[h.id_custom];
            if (!tag) return '';
            const colors = { noche:'#4338ca', '4x3':'#0891b2', reserva:'#7c3aed', anglo:'#d97706', empresa:'#059669' };
            const icons  = { noche:'🌙', '4x3':'🔄', reserva:'📌', anglo:'🤝', empresa:'🏢' };
            const lbl = tag.tipo === 'empresa' ? (tag.etiqueta || 'Empresa') : tag.tipo.toUpperCase();
            const c = colors[tag.tipo] || '#64748b';
            return `<div style="position:absolute;bottom:10px;right:10px;background:${c};color:white;border-radius:6px;padding:2px 7px;font-size:9px;font-weight:800;letter-spacing:.3px">${icons[tag.tipo]||''} ${lbl}</div>`;
          })()}
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
            ${cs.map(c => {
              const confirmo = c.estado==='Ocupada' && c.huesped_confirmo;
              const ocupada  = c.estado==='Ocupada';
              const bg  = ocupada ? (confirmo ? '#22c55e' : '#ef4444')
                        : c.estado==='Mantencion' ? '#f59e0b' : '#10b981';
              const lbl = ocupada ? (confirmo ? '✓' : 'O')
                        : c.estado==='Mantencion' ? 'M' : 'L';
              const infoHTML = ocupada && (c.empresa || c.numero_contrato)
                ? `<div style="display:flex;flex-direction:column;line-height:1.3">
                     ${c.empresa ? `<span style="font-size:11px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px">${c.empresa}</span>` : ''}
                     ${c.numero_contrato ? `<span style="font-size:10px;font-family:monospace;color:#6366f1">${c.numero_contrato}</span>` : ''}
                   </div>`
                : '';
              return `<div style="display:flex;align-items:center;gap:8px">
                <button onclick="window._v2iOpenCama(event,'${c.id_cama}')" title="${c.id_cama} — ${c.estado}${confirmo?' · Llegada confirmada':''}"
                  style="width:28px;height:28px;min-width:28px;border-radius:7px;border:none;background:${bg};color:#fff;font-size:11px;font-weight:800;cursor:pointer;transition:transform 0.1s"
                  onmouseover="this.style.transform='scale(1.18)'" onmouseout="this.style.transform='scale(1)'">${lbl}</button>
                ${infoHTML}
              </div>`;
            }).join('')}
          </div>
          <div style="font-size:11px;color:var(--text-muted);display:flex;gap:8px">
            ${hd>0?`<span style="color:#10b981">✅ ${hd}</span>`:''}
            ${hc>0?`<span style="color:#22c55e">🟢 ${hc} conf.</span>`:''}
            ${ho>0?`<span style="color:#ef4444">🔴 ${ho} s/conf</span>`:''}
            ${hm>0?`<span style="color:#f59e0b">🟡 ${hm}</span>`:''}
          </div>
        </div>`;

      }).join('')}`;
}

// ─── MODAL: delega todo al nuevo CheckinPopoverV2 ───────────────────────────
async function openCamaModal(ev, idCama) {
    const card = ev.target.closest('[data-cama-card]');
    if (!card) return;
    const info   = _camaData[idCama] || {};
    const estado = info.estado || 'Disponible';
    await abrirPopover(card, idCama, estado, (tipo) => {
        // Refresca la vista después de check-in o checkout
        if (_selPabellon) selectPabellon(_selPabellon);
    });
}

function closeModal() { cerrarPopover(); }


async function handleCheckin(idCama) {
    const msg  = (t,c) => { const e=document.getElementById('ci-msg'); if(e){e.textContent=t;e.style.color=c;} };
    const v    = id => document.getElementById(id)?.value?.trim();
    const rut     = v('ci-rut');
    const nombre  = v('ci-nombre');
    const tel     = v('ci-tel');
    const contrato= v('ci-contrato');
    const empId   = v('ci-emp');
    const llegada = v('ci-llegada');
    const salida  = v('ci-salida');

    if (!rut || !nombre || !empId || !llegada) {
        msg('⚠️ RUT, Nombre, Empresa y Fecha de llegada son obligatorios','#f59e0b'); return;
    }
    msg('Registrando…','var(--text-muted)');
    try {
        await doCheckin({
            idCama, rutHuesped: rut, nombreHuesped: nombre, empresaId: empId,
            fechaCheckin: llegada, fechaSalidaProgramada: salida||null,
            numeroContrato: contrato||null, telefono: tel||null
        });
        msg('✅ Check-in registrado','#10b981');
        if (_camaData[idCama]) _camaData[idCama].estado = 'Ocupada';
        setTimeout(() => { closeModal(); selectPabellon(_selPabellon); }, 1200);
    } catch(e) { msg('❌ '+e.message,'#ef4444'); }
}

async function handleCheckout(asigId, idCama) {
    try {
        await doCheckout(asigId);
        if (_camaData[idCama]) _camaData[idCama].estado = 'Disponible';
        closeModal();
        selectPabellon(_selPabellon);
    } catch(e) { alert('❌ '+e.message); }
}

// ─── UTILS ──────────────────────────────────────────────────────────────────
function markSel(prefix, items, selId, color) {
    items.forEach(item => {
        const btn = document.getElementById(`${prefix}-${item.id}`);
        if (!btn) return;
        const on = item.id === selId;
        btn.style.background  = on ? color : 'var(--bg-card)';
        btn.style.color       = on ? '#fff' : 'var(--text-primary)';
        btn.style.borderColor = on ? color : 'var(--border)';
    });
}

function errRow(rowId, msg) {
    const el = document.getElementById(rowId);
    if (el) { el.style.display = 'flex'; el.innerHTML = `<div style="color:#ef4444">${msg}</div>`; }
}

function sc(icon, label, value, color) {
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:12px;border-top:3px solid ${color}">
      <div style="font-size:16px;margin-bottom:4px">${icon}</div>
      <div style="font-size:20px;font-weight:800;color:${color}">${value}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px">${label}</div>
    </div>`;
}

function leg(color, lbl, title) {
    return `<div style="display:flex;align-items:center;gap:6px">
      <div style="width:22px;height:22px;border-radius:6px;background:${color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff">${lbl}</div>
      <span style="font-size:12px;color:var(--text-muted)">${title}</span>
    </div>`;
}

function inp(id, label, type, placeholder, extra = '') {
    return `<div>
      <label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">${label}</label>
      <input id="${id}" type="${type}" placeholder="${placeholder}" ${extra}
        style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;outline:none;box-sizing:border-box;transition:border-color 0.3s">
    </div>`;
}
