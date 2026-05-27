/**
 * v2-infraestructura.js — Infraestructura V2
 * Usa CheckinPopoverV2 para check-in/out sin fondos oscuros
 */
import {
    getEdificios, getPabellones, getHabitaciones, getCamas,
    getEmpresas, getAsignacionByCama, doCheckin, doCheckout,
    buscarTrabajadorPorRut, today, checkConflictoFechas,
    checkRutDuplicado, checkGeneroHabitacion
} from '../v2-service.js';

import { abrirPopover, cerrarPopover } from './CheckinPopoverV2.js';
import { supabase } from '../../supabaseClient.js';

let _edificios = [], _pabellones = [], _habitaciones = [], _empresas = [];
let _selEdificio = null, _selPabellon = null;
let _camaData  = {};
let _busqueda  = '';
let _filtEmpresa = '', _filtNombre = '', _filtGerencia = '';
// ⚡ Caché en memoria para no re-consultar Supabase tras cada acción
let _camasCache   = null; // Array<Array<cama>> paralelo a _habitaciones
let _habTagCache  = null; // { habId: { tipo, etiqueta } }
let _solicCache   = null; // { numero_hab: [{nombre, empresa, fecha_llegada}] }

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
        ${leg('#06b6d4','L','Libre — clic para Check-in')}
        ${leg('#a855f7','P','Pre-asignada — llega próximamente')}
        ${leg('#ef4444','O','Ocupada — llegada pendiente de confirmar')}
        ${leg('#22c55e','✓','Ocupada — huésped confirmó llegada')}
        ${leg('#f59e0b','S','Saliendo hoy — checkout automático 22:00')}
        ${leg('#fbbf24','⚠','Salida vencida — sin Check-out')}
        ${leg('#f97316','↻','En rotación — entra nuevo residente')}
        ${leg('#64748b','M','Mantención')}
        <button onclick="window._v2iAutoRotacion()" style="margin-left:auto;padding:8px 16px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px">
          ⚡ Auto-Rotación
        </button>
        <button onclick="window._v2iRepararAsignaciones()" style="padding:8px 16px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px" title="Crea asignaciones formales para solicitudes aceptadas que no aparecen en infraestructura">
          🔧 Reparar
        </button>
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

        // ⚡ Auto-rotación silenciosa en segundo plano al abrir el módulo
        setTimeout(() => window._v2iAutoRotacion(true), 800);

        // 🕐 Timer automático: corre cada hora mientras la app esté abierta
        // Garantiza que PRE → ACTUAL ocurra sin que nadie haga click
        if (!window._v2iRotTimer) {
            window._v2iRotTimer = setInterval(async () => {
                console.log('[Auto-Rot] ⏰ Timer horario — ejecutando rotación…');
                await window._v2iAutoRotacion(true);
                // Si cambia el día (medianoche), también refresca la vista completa
                const hoyNuevo = new Date().toISOString().split('T')[0];
                if (hoyNuevo !== window._v2iUltimoHoy) {
                    window._v2iUltimoHoy = hoyNuevo;
                    console.log('[Auto-Rot] 🌅 Nuevo día detectado — refrescando vista…');
                    if (_selPabellon) await selectPabellon(_selPabellon);
                }
            }, 60 * 60 * 1000); // cada 1 hora
            window._v2iUltimoHoy = new Date().toISOString().split('T')[0];
            console.log('[Auto-Rot] ✅ Timer horario activado (cada 1h)');
        }

        // 🔄 Escuchar evento global de rotación completada → refrescar vista automáticamente
        if (!window._v2iRotListener) {
            window._v2iRotListener = async () => {
                if (!_selPabellon) return;
                _camasCache = null; _habTagCache = null; _solicCache = null;
                const scrollY = window.scrollY;
                await selectPabellon(_selPabellon);
                requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
            };
            window.addEventListener('rotacion-completada', window._v2iRotListener);
        }

    } catch(e) {
        document.getElementById('v2i-loading').innerHTML = `<div style="color:#ef4444">❌ ${e.message}</div>`;
    }

    const refilter = () => renderGrid();
    document.getElementById('v2i-search')   ?.addEventListener('input', e => { _busqueda    = e.target.value; refilter(); });
    document.getElementById('v2i-f-empresa') ?.addEventListener('input', e => { _filtEmpresa = e.target.value; refilter(); });
    document.getElementById('v2i-f-nombre')  ?.addEventListener('input', e => { _filtNombre  = e.target.value; refilter(); });
    document.getElementById('v2i-f-gerencia')?.addEventListener('input', e => { _filtGerencia= e.target.value; refilter(); });
}



// ── AUTO-ROTACIÓN: checkout automático + asignación del entrante ───────────────
window._v2iAutoRotacion = async function(silent = false) {
    const hoy = new Date().toISOString().split('T')[0];
    const toast = (m, t='ok') => {
        const d = Object.assign(document.createElement('div'), {
            textContent: m,
            style: `position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;border-radius:12px;font-weight:700;font-size:13px;background:${t==='error'?'#ef4444':'#10b981'};color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.25);transition:opacity .5s`
        });
        document.body.appendChild(d);
        setTimeout(() => { d.style.opacity='0'; setTimeout(() => d.remove(), 500); }, 4000);
    };

    let huboCambios = false;

    // ── 0. Transición automática: pre_asignado con fecha_checkin <= hoy → activa ──
    // Se ejecuta primero e independiente. El día que llega el trabajador (a las 00:00)
    // su asignación pasa de pre_asignado → activa y la cama queda Ocupada.
    try {
        const { data: llegaronHoy } = await supabase
            .from('v2_asignaciones')
            .select('id, id_cama')
            .eq('estado_asignacion', 'pre_asignado')
            .lte('fecha_checkin', hoy)
            .is('fecha_checkout', null);

        if (llegaronHoy?.length) {
            for (const a of llegaronHoy) {
                await supabase.from('v2_asignaciones')
                    .update({ estado_asignacion: 'activa' })
                    .eq('id', a.id);
                await supabase.from('v2_camas')
                    .update({ estado: 'Ocupada' })
                    .eq('id_cama', a.id_cama);
            }
            huboCambios = true;
            if (!silent) toast(`🟢 ${llegaronHoy.length} trabajador(es) activados hoy automáticamente`);
            // ✅ Refrescar vista INMEDIATAMENTE tras activar — no esperar a vencidas
            if (_selPabellon) {
                _camasCache = null; _habTagCache = null; _solicCache = null;
                await selectPabellon(_selPabellon);
            }
        }
    } catch(e) {
        console.warn('[AutoRot] Error en paso 0 (pre→activa):', e.message);
    }

    // ── 1. Rotaciones: asignaciones vencidas (fecha_salida_programada <= hoy) ──
    // Este bloque es independiente — si falla no bloquea el paso 0.
    try {
        const { data: vencidas, error: errV } = await supabase
            .from('v2_asignaciones')
            .select('id, id_cama, rut_huesped, nombre_huesped, fecha_salida_programada, empresa_id, v2_camas!inner(habitacion_id, v2_habitaciones(numero_hab))')
            .lte('fecha_salida_programada', hoy)
            .is('fecha_checkout', null)
            .neq('estado_asignacion', 'pre_asignado');  // excluir pre-asignados (ya manejados arriba)

        if (errV) {
            if (!silent) toast('⚠️ Error al verificar rotaciones: ' + errV.message, 'error');
        } else if (vencidas?.length) {
            let checkouts = 0, reasignaciones = 0;

            for (const asig of vencidas) {
                const { error: errCO } = await supabase
                    .from('v2_asignaciones')
                    .update({ fecha_checkout: hoy })
                    .eq('id', asig.id);
                if (errCO) continue;

                await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', asig.id_cama);
                checkouts++;

                const numHab = String(asig.v2_camas?.v2_habitaciones?.numero_hab || '');
                if (!numHab) continue;

                const { data: entrantes } = await supabase
                    .from('v2_solicitudes_b2b')
                    .select('id, rut_trabajador, nombre_trabajador, empresa, fecha_llegada, fecha_salida, genero')
                    .eq('hab_solicitada', numHab)
                    .in('status', ['aceptada', 'pendiente'])
                    .lte('fecha_llegada', hoy)
                    .gt('fecha_salida', hoy)
                    .order('fecha_llegada')
                    .limit(1);

                if (!entrantes?.length) continue;
                const ent = entrantes[0];

                const { error: errCI } = await supabase.from('v2_asignaciones').insert({
                    id_cama:                 asig.id_cama,
                    rut_huesped:            ent.rut_trabajador,
                    nombre_huesped:         ent.nombre_trabajador,
                    empresa_id:             asig.empresa_id,
                    fecha_checkin:          hoy,
                    fecha_salida_programada: ent.fecha_salida,
                    estado_asignacion:      'activa',
                    huesped_confirmo:       false,
                });
                if (errCI) continue;

                await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', asig.id_cama);
                await supabase.from('v2_solicitudes_b2b').update({ status: 'aceptada_asignada' }).eq('id', ent.id);
                reasignaciones++;
            }

            if (checkouts > 0 || reasignaciones > 0) {
                huboCambios = true;
                toast(`⚡ Rotación: ${checkouts} salida(s) · ${reasignaciones} entrada(s)`);
            }
        } else {
            if (!silent && !huboCambios) toast('✅ Sin rotaciones ni activaciones pendientes hoy');
        }
    } catch(e) {
        console.warn('[AutoRot] Error en paso 1 (vencidas):', e.message);
        if (!silent) toast('⚠️ Error en rotaciones: ' + e.message, 'error');
    }

    // ── Refrescar vista final si hubo cambios en el paso 1 ──
    if (huboCambios && _selPabellon) {
        _camasCache = null; _habTagCache = null; _solicCache = null;
        await selectPabellon(_selPabellon);
    }
};


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
    // Limpiar caché al cambiar de pabellon — fuerza nueva descarga
    _camasCache  = null;
    _habTagCache = null;
    _solicCache  = null;
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

    // ⚡ Usar caché si existe (evita re-consultar Supabase tras checkout/checkin)
    let camasArr, habTagMap;
    if (_camasCache && _habTagCache) {
        // Usar datos en memoria — render instantáneo
        camasArr  = _camasCache;
        habTagMap = _habTagCache;
        // Limpiar el mensaje de carga de inmediato
        grid.innerHTML = '';
    } else {
        // Primera carga o cambio de pabellón — descargar desde Supabase
        camasArr = await Promise.all(habs.map(h => getCamas(h.id_custom)));
        _camasCache = camasArr;

        // Etiquetas de distribucion
        habTagMap = {};
        const allCamaIds = habs.flatMap((h,i) => camasArr[i].map(c => c.id_cama)).slice(0,1000);
        if (allCamaIds.length) {
            const { data: distTags } = await supabase
                .from('v2_distribucion_camas')
                .select('id_cama, tipo, etiqueta')
                .in('id_cama', allCamaIds);
            (distTags || []).forEach(d => {
                for (let i = 0; i < habs.length; i++) {
                    if (camasArr[i].some(c => c.id_cama === d.id_cama)) {
                        if (!habTagMap[habs[i].id_custom]) habTagMap[habs[i].id_custom] = d;
                        break;
                    }
                }
            });
        }
        _habTagCache = habTagMap;

        // 📅 Solicitudes B2B aceptadas — incluye HOY y futuros
        // Usamos gte (>=) para que los trabajadores de HOY que no tienen asignación
        // formal en v2_asignaciones también sean visibles en el panel (pueden ser
        // asignados con ⚡ Asignar). Deduplicamos con los RUTs ya asignados activamente.
        _solicCache = {};
        const hoy2 = new Date().toISOString().split('T')[0];
        const numHabsSet = new Set(habs.map(h => String(h.numero_hab)));

        // Obtener RUTs que ya tienen asignación activa (evita duplicar en panel)
        const rutsConAsignacion = new Set();
        try {
            const { data: asigActivas } = await supabase
                .from('v2_asignaciones')
                .select('rut_huesped')
                .is('fecha_checkout', null)
                .not('rut_huesped', 'is', null);
            (asigActivas || []).forEach(a => rutsConAsignacion.add(
                String(a.rut_huesped || '').toUpperCase().replace(/\./g, '')
            ));
        } catch(_) { /* si falla, no filtramos */ }

        const { data: solics } = await supabase
            .from('v2_solicitudes_b2b')
            .select('id, nombre_trabajador, rut_trabajador, empresa, fecha_llegada, fecha_salida, hab_solicitada')
            .in('status', ['aceptada', 'aceptada_asignada'])
            .gte('fecha_llegada', hoy2)  // ✅ incluye HOY y futuro
            .order('fecha_llegada')
            .limit(500);
        (solics || []).forEach(s => {
            const k = String(s.hab_solicitada);
            if (!numHabsSet.has(k)) return; // solo habs del pabellon actual
            // Excluir si ya tiene asignación activa formal (evita duplicado)
            const rutNorm = String(s.rut_trabajador || '').toUpperCase().replace(/\./g, '');
            if (rutsConAsignacion.has(rutNorm)) return;
            if (!_solicCache[k]) _solicCache[k] = [];
            _solicCache[k].push(s);
        });
    }


    habs.forEach((h, i) => camasArr[i].forEach(c => { _camaData[c.id_cama] = { estado: c.estado, habitacion_id: c.habitacion_id }; }));

    // ⚡ Asignación rápida de pre-asignado a cama libre
    window._v2iAsignarPreAsig = async (numHab, idxSol, btnEl) => {
        const sol = (_solicCache || {})[String(numHab)]?.[idxSol];
        if (!sol) return;
        btnEl.textContent = '⏳'; btnEl.disabled = true;

        // 1. Buscar camas libres en esa habitación
        const { data: habData } = await supabase
            .from('v2_habitaciones').select('id_custom').eq('numero_hab', numHab).maybeSingle();
        if (!habData) { btnEl.textContent = '❌ Hab no encontrada'; return; }

        const { data: camasLibres } = await supabase
            .from('v2_camas').select('id_cama')
            .eq('habitacion_id', habData.id_custom)
            .eq('estado', 'Disponible');

        if (!camasLibres?.length) { btnEl.textContent = '❌ Sin camas libres'; btnEl.disabled = false; return; }

        // ✅ Auto-seleccionar primera cama disponible sin preguntar
        const camaId = camasLibres[0].id_cama;

        // 2. Buscar empresa_id
        let empId = null;
        if (sol.empresa) {
            const palabras = sol.empresa.split(' ').slice(0, 2).join(' ');
            const { data: emp } = await supabase.from('v2_empresas')
                .select('id').ilike('nombre', `%${palabras}%`).limit(1);
            empId = emp?.[0]?.id || null;
        }

        // 3. Crear asignación
        const { error: errA } = await supabase.from('v2_asignaciones').insert({
            id_cama:                camaId,
            rut_huesped:            (sol.rut_trabajador || '').replace(/\./g,'').toUpperCase().slice(0, 12) || null,
            nombre_huesped:         sol.nombre_trabajador,
            empresa_id:             empId,
            fecha_checkin:          sol.fecha_llegada,
            fecha_salida_programada: sol.fecha_salida || null,
            estado_asignacion:      'pre_asignado',
            huesped_confirmo:       false,
            autorizado_checkin:     false,
        });
        if (errA) { btnEl.textContent = '❌ ' + errA.message; btnEl.disabled = false; return; }

        // 4. ✅ FIX: La cama debe quedar Disponible para que se muestre como "Pre-asignada"
        //    getCamas() detecta preAsignado cuando estado='Disponible' + asignación 'pre_asignado'
        await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', camaId);

        // 5. Marcar solicitud como aceptada
        await supabase.from('v2_solicitudes_b2b').update({ status: 'aceptada' }).eq('id', sol.id);

        btnEl.textContent = '✅ Asignado';
        btnEl.style.background = '#10b981';

        if (camasLibres.length > 1) {
            console.info(`[AutoAsign] Se asignó cama ${camaId} (había ${camasLibres.length} libres)`);
        }

        // 6. Refrescar vista
        setTimeout(async () => {
            _camasCache = null; _solicCache = null;
            if (_selPabellon) {
                const scrollY = window.scrollY;
                await selectPabellon(_selPabellon);
                requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
            }
        }, 1200);
    };

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
        if (c.estado === 'Deshabilitada') return; // ← no contar camas sin instalar
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
        const hoyStats = new Date().toISOString().split('T')[0];
        const hs  = cs.filter(c=>c.estado==='Ocupada' && c.fecha_salida_programada===hoyStats && !c.preAsignado).length;
        const ho  = cs.filter(c=>c.estado==='Ocupada' && !c.huesped_confirmo && c.fecha_salida_programada!==hoyStats).length;
        const hc  = cs.filter(c=>c.estado==='Ocupada' &&  c.huesped_confirmo && c.fecha_salida_programada!==hoyStats).length;
        const hd  = cs.filter(c=>c.estado==='Disponible' && !c.preAsignado).length;
        const hp  = cs.filter(c=>c.preAsignado).length;
        const hm  = cs.filter(c=>c.estado==='Mantencion').length;
        const hdis = cs.filter(c=>c.estado==='Deshabilitada').length;
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
            ${(() => {
              const hoy = new Date().toISOString().split('T')[0];
              const saliendo  = cs.filter(c => c.estado==='Ocupada' && c.fecha_salida_programada===hoy);
              const activos   = cs.filter(c => !(c.estado==='Ocupada' && c.fecha_salida_programada===hoy));
              const porLlegar = cs.filter(c => c.preAsignado);

              function getBg(c) {
                const deshabilitada = c.estado === 'Deshabilitada';
                const confirmo  = c.estado==='Ocupada' && c.huesped_confirmo;
                const ocupada   = c.estado==='Ocupada';
                const salidaHoy = ocupada && c.fecha_salida_programada === hoy && !c.preAsignado;
                const vencida   = ocupada && c.fecha_salida_programada && c.fecha_salida_programada < hoy && !salidaHoy;
                const preAsig   = !!c.preAsignado;
                return deshabilitada ? null
                     : salidaHoy  ? '#f59e0b'
                     : vencida    ? '#fbbf24'
                     : ocupada    ? (confirmo ? '#22c55e' : '#ef4444')
                     : preAsig    ? '#a855f7'
                     : c.estado==='Mantencion' ? '#64748b' : '#06b6d4';
              }
              function getLbl(c) {
                const deshabilitada = c.estado === 'Deshabilitada';
                const confirmo  = c.estado==='Ocupada' && c.huesped_confirmo;
                const ocupada   = c.estado==='Ocupada';
                const salidaHoy = ocupada && c.fecha_salida_programada === hoy && !c.preAsignado;
                const vencida   = ocupada && c.fecha_salida_programada && c.fecha_salida_programada < hoy && !salidaHoy;
                return deshabilitada ? 'D'
                     : salidaHoy  ? 'S'
                     : vencida    ? '⚠'
                     : ocupada    ? (confirmo ? '✓' : 'O')
                     : c.preAsignado ? 'P'
                     : c.estado==='Mantencion' ? 'M' : 'L';
              }
              function getTooltip(c) {
                if (c.estado==='Deshabilitada') return `${c.id_cama} — sin instalar`;
                if (c.preAsignado) return `PRE: ${c.preAsignado.nombre||''} · llega ${c.preAsignado.fecha||'?'}`;
                if (c.estado==='Ocupada') return `${c.nombre_huesped||''} · ${c.empresa||''} · sale ${c.fecha_salida_programada||'—'}`;
                if (c.estado==='Mantencion') return `${c.id_cama} — Mantención`;
                return `${c.id_cama} — Disponible`;
              }

              // Render una sección como grid de botones compacta
              function renderSeccion(lista) {
                return `<div style="display:flex;flex-wrap:wrap;gap:5px">
                  ${lista.map(c => {
                    const bg  = getBg(c);
                    const lbl = getLbl(c);
                    const tip = getTooltip(c);
                    if (!bg) {
                      // Deshabilitada
                      return `<button disabled title="${tip}"
                        style="width:30px;height:30px;border-radius:7px;border:2px dashed #94a3b8;background:#f1f5f9;color:#94a3b8;font-size:10px;font-weight:800;cursor:not-allowed;flex-shrink:0">D</button>`;
                    }
                    return `<button onclick="window._v2iOpenCama(event,'${c.id_cama}')" title="${tip}"
                      style="width:30px;height:30px;border-radius:7px;border:none;background:${bg};color:#fff;font-size:11px;font-weight:800;cursor:pointer;transition:transform .1s;flex-shrink:0"
                      onmouseover="this.style.transform='scale(1.18)'" onmouseout="this.style.transform='scale(1)'">${lbl}</button>`;
                  }).join('')}
                </div>`;
              }

              let html = '';

              // ── PRE (fecha futura) ──────────────────────────────────────────
              if (porLlegar.length > 0) {
                html += `<div style="background:#f5f3ff;border:1px solid #e9d5ff;border-radius:8px;padding:6px 8px">
                  <div style="font-size:9px;font-weight:900;color:#7e22ce;letter-spacing:.6px;text-transform:uppercase;margin-bottom:5px">📅 PRE — Por llegar (${porLlegar.length})</div>
                  ${renderSeccion(porLlegar)}
                </div>`;
              }

              // ── LLEGARON HOY sin confirmar (activa + fecha_checkin===hoy + !huesped_confirmo) ──
              const llegaronHoySinConf = activos.filter(c =>
                c.estado === 'Ocupada' &&
                !c.huesped_confirmo &&
                c.fecha_checkin === hoy &&
                c.fecha_salida_programada !== hoy
              );
              // Excluir del bloque "actuales" los que están en llegaronHoySinConf
              const llegaronHoyIds = new Set(llegaronHoySinConf.map(c => c.id_cama));
              const activosFiltrados = activos.filter(c => !llegaronHoyIds.has(c.id_cama));

              if (llegaronHoySinConf.length > 0) {
                html += `<div style="background:#fff1f2;border:1.5px solid #fecaca;border-radius:8px;padding:6px 8px">
                  <div style="font-size:9px;font-weight:900;color:#dc2626;letter-spacing:.6px;text-transform:uppercase;margin-bottom:5px">🔴 Llegaron hoy — Confirmar (${llegaronHoySinConf.length})</div>
                  ${renderSeccion(llegaronHoySinConf)}
                </div>`;
              }

              // ── ACTUALES (confirmados + sin conf que no son de hoy) ─────────
              if (activosFiltrados.length > 0) {
                html += `<div>
                  ${activosFiltrados.length>0&&(porLlegar.length>0||llegaronHoySinConf.length>0)?`<div style="font-size:9px;font-weight:900;color:var(--text-muted);letter-spacing:.6px;text-transform:uppercase;margin-bottom:4px">Actuales</div>`:''}
                  ${renderSeccion(activosFiltrados)}
                </div>`;
              }

              // ── SALIENDO ────────────────────────────────────────────────────
              if (saliendo.length > 0) {
                html += `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 8px">
                  <div style="font-size:9px;font-weight:900;color:#d97706;letter-spacing:.6px;text-transform:uppercase;margin-bottom:5px">🧳 Saliendo hoy (${saliendo.length})</div>
                  ${renderSeccion(saliendo)}
                </div>`;
              }

              return html;

            })()}
          </div>


          <div style="font-size:11px;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap">
            ${hd>0?`<span style="color:#10b981">✅ ${hd}</span>`:''}
            ${hp>0?`<span style="color:#a855f7">🟣 ${hp} pre-asig.</span>`:''}
            ${hc>0?`<span style="color:#22c55e">🟢 ${hc} conf.</span>`:''}
            ${ho>0?`<span style="color:#ef4444">🔴 ${ho} s/conf</span>`:''}
            ${hs>0?`<span style="color:#f59e0b">🧳 ${hs} saliendo</span>`:''}
            ${hm>0?`<span style="color:#f59e0b">🟡 ${hm}</span>`:''}
            ${hdis>0?`<span style="color:#94a3b8">⬜ ${hdis} deshab.</span>`:''}
          </div>
          ${(() => {
            const sol = (_solicCache || {})[String(h.numero_hab)] || [];
            if (!sol.length) return '';
            const proxFecha = sol[0].fecha_llegada;
            const proxD = proxFecha ? proxFecha.substring(8,10)+'/'+proxFecha.substring(5,7) : '?';
            const panelId = 'sol-panel-' + h.id_custom.replace(/[^a-z0-9]/gi,'');
            const filas = sol.map((s, idx) => {
              const llegD = s.fecha_llegada ? s.fecha_llegada.substring(8,10)+'/'+s.fecha_llegada.substring(5,7) : '?';
              const salD  = s.fecha_salida  ? s.fecha_salida.substring(8,10) +'/'+s.fecha_salida.substring(5,7)  : '—';
              return `<div style="padding:6px 0;border-bottom:1px solid #fde68a">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
                  <div style="flex:1;min-width:0">
                    <div style="font-size:11px;font-weight:800;color:#78350f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.nombre_trabajador||'—'}</div>
                    <div style="font-size:10px;color:#92400e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">${s.empresa||'—'}</div>
                    <div style="font-size:10px;color:#b45309;font-weight:700;margin-top:2px">📅 ${llegD} &nbsp;→&nbsp; 🔚 ${salD}</div>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;align-items:flex-end">
                    <span style="display:inline-flex;align-items:center;gap:3px;background:#a855f7;color:white;border-radius:6px;padding:3px 7px;font-size:10px;font-weight:800">P Pre-asig.</span>
                    <button onclick="window._v2iAsignarPreAsig('${h.numero_hab}',${idx},this)"
                      style="background:#f97316;color:white;border:none;border-radius:6px;padding:3px 9px;font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap">
                      ⚡ Asignar
                    </button>
                  </div>
                </div>
              </div>`;
            }).join('');
            return `<div style="margin-top:8px">
              <button onclick="(function(btn){var p=document.getElementById('${panelId}');var open=p.style.display!=='none';p.style.display=open?'none':'block';btn.querySelector('.arr-chevron').textContent=open?'▸':'▾';})(this)"
                style="width:100%;background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:6px 10px;font-size:11px;color:#92400e;font-weight:700;cursor:pointer;display:flex;justify-content:space-between;align-items:center;text-align:left">
                <span>📅 ${sol.length} llegada${sol.length>1?'s':''} el ${proxD}</span>
                <span class="arr-chevron" style="font-size:13px;margin-left:6px">▸</span>
              </button>
              <div id="${panelId}" style="display:none;background:#fffbeb;border:1px solid #fde68a;border-top:none;border-radius:0 0 8px 8px;padding:6px 10px">
                ${filas}
              </div>
            </div>`;
          })()}
        </div>`;

      }).join('')}`;
}

// ─── MODAL: delega todo al nuevo CheckinPopoverV2 ───────────────────────────
async function openCamaModal(ev, idCama) {
    const card = ev.target.closest('[data-cama-card]');
    if (!card) return;
    const info   = _camaData[idCama] || {};
    const estado = info.estado || 'Disponible';
    await abrirPopover(card, idCama, estado, async (tipo) => {
        // Refresca la vista después de check-in o checkout SIN perder posición
        if (_selPabellon) {
            const scrollY = window.scrollY;
            await selectPabellon(_selPabellon);
            requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
        }
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

    try {
        // ─ Validar solapamiento de fechas ─
        msg('Verificando disponibilidad…','var(--text-muted)');
        const conflicto = await checkConflictoFechas(idCama, llegada);
        if (!conflicto.ok) {
            msg('❌ ' + conflicto.razon, '#ef4444'); return;
        }

        // ─ REGLA 1: Sin RUT duplicado en fechas solapadas ─
        const dupRut = await checkRutDuplicado(rut, llegada, salida || null);
        if (!dupRut.ok) {

            msg('❌ ' + dupRut.razon, '#ef4444'); return;
        }

        // ─ REGLA 2: Sin mezcla de géneros ─
        // Obtenemos la habitación a partir del id_cama
        const camaInfo = _camaData[idCama];
        const habitacionId = camaInfo?.habitacion_id || null;
        if (habitacionId) {
            const genero = await checkGeneroHabitacion(habitacionId, rut);
            if (!genero.ok) {
                msg('❌ ' + genero.razon, '#ef4444'); return;
            }
        }

        const esPreAsignacion = conflicto.esPreAsignacion || false;
        if (esPreAsignacion) {
            msg('🔄 Pre-asignando (cama en rotación)…','#f97316');
        } else {
            msg('Registrando…','var(--text-muted)');
        }
        await doCheckin({
            idCama, rutHuesped: rut, nombreHuesped: nombre, empresaId: empId,
            fechaCheckin: llegada, fechaSalidaProgramada: salida||null,
            numeroContrato: contrato||null, telefono: tel||null,
            esPreAsignacion
        });
        msg(esPreAsignacion ? '🔄 Pre-asignación registrada (entra el ' + llegada + ')' : '✅ Check-in registrado','#10b981');
        // Actualizar caché en memoria — render instantáneo sin re-consultar Supabase
        _actualizarCamaEnCache(idCama, { estado: 'Ocupada', nombre_huesped: nombre, empresa: _empresas.find(e=>e.id===empId)?.nombre||'', numero_contrato: contrato||null });
        setTimeout(async () => {
            closeModal();
            if (_selPabellon) {
                const scrollY = window.scrollY;
                await renderGrid();
                requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
            }
        }, 1400);
    } catch(e) { msg('❌ '+e.message,'#ef4444'); }
}


async function handleCheckout(asigId, idCama) {
    try {
        await doCheckout(asigId);
        // Actualizar caché en memoria — render instantáneo sin "Cargando camas"
        _actualizarCamaEnCache(idCama, { estado: 'Disponible', nombre_huesped: null, empresa: null, numero_contrato: null });
        closeModal();
        if (_selPabellon) {
            const scrollY = window.scrollY;
            await renderGrid();
            requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
        }
    } catch(e) { alert('❌ '+e.message); }
}

// Actualiza un cama dentro de _camasCache sin limpiar todo el caché
function _actualizarCamaEnCache(idCama, cambios) {
    if (!_camasCache) return;
    if (_camaData[idCama]) _camaData[idCama].estado = cambios.estado;
    for (const arr of _camasCache) {
        const idx = arr.findIndex(c => c.id_cama === idCama);
        if (idx !== -1) { Object.assign(arr[idx], cambios); return; }
    }
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

// ── 🔧 REPARAR ASIGNACIONES ──────────────────────────────────────────────────
// Detecta solicitudes aceptadas sin asignación formal en v2_asignaciones
// y las crea en lote. Resuelve el problema de "trabajadores invisibles".
window._v2iRepararAsignaciones = async function() {
    const toast = (m, t='ok') => {
        const d = Object.assign(document.createElement('div'), {
            textContent: m,
            style: `position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;border-radius:12px;font-weight:700;font-size:13px;background:${t==='error'?'#ef4444':'#6366f1'};color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.25);transition:opacity .5s`
        });
        document.body.appendChild(d);
        setTimeout(() => { d.style.opacity='0'; setTimeout(() => d.remove(), 500); }, 5000);
    };

    const hoy = new Date().toISOString().split('T')[0];

    // Overlay de progreso
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `<div style="background:#fff;border-radius:20px;padding:36px 44px;text-align:center;min-width:340px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
        <div style="font-size:40px;margin-bottom:16px">🔧</div>
        <div style="font-weight:900;font-size:18px;margin-bottom:8px">Reparando Asignaciones</div>
        <div id="_rep_step" style="font-size:13px;color:#64748b;margin-bottom:8px">Iniciando...</div>
        <div style="height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden;margin-top:16px">
            <div id="_rep_bar" style="height:100%;background:#6366f1;border-radius:99px;width:0%;transition:width 0.4s ease"></div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    const step = (txt, pct) => {
        const el = document.getElementById('_rep_step');
        const bar = document.getElementById('_rep_bar');
        if (el) el.textContent = txt;
        if (bar) bar.style.width = (pct||0) + '%';
    };

    try {
        // 1. Cargar solicitudes aceptadas con hab_solicitada y fecha activa
        step('Cargando solicitudes aceptadas...', 10);
        const { data: solicitudes, error: errS } = await supabase
            .from('v2_solicitudes_b2b')
            .select('id, rut_trabajador, nombre_trabajador, empresa, hab_solicitada, fecha_llegada, fecha_salida, genero')
            .in('status', ['aceptada', 'aceptada_asignada'])
            .not('hab_solicitada', 'is', null);
            // ✅ NO filtramos por fecha_salida: si las fechas tienen errores
            // (salida <= llegada) los trabajadores igual deben aparecer en infraestructura.


        if (errS) throw new Error('Error al cargar solicitudes: ' + errS.message);
        if (!solicitudes?.length) { overlay.remove(); toast('✅ No hay solicitudes pendientes de reparar'); return; }

        step(`${solicitudes.length} solicitudes encontradas. Verificando asignaciones...`, 20);

        // 2. Cargar todos los RUTs que ya tienen asignación activa
        const { data: asigActivas } = await supabase
            .from('v2_asignaciones')
            .select('rut_huesped, id_cama')
            .is('fecha_checkout', null);

        const rutsConAsig = new Set(
            (asigActivas || []).map(a => String(a.rut_huesped || '').toUpperCase().replace(/\./g, ''))
        );

        // 3. Filtrar solicitudes sin asignación formal
        const sinAsig = solicitudes.filter(s => {
            const rut = String(s.rut_trabajador || '').toUpperCase().replace(/\./g, '');
            return rut && !rutsConAsig.has(rut);
        });

        if (!sinAsig.length) {
            overlay.remove();
            toast(`✅ Todas las solicitudes ya tienen asignación formal (${solicitudes.length} verificadas)`);
            return;
        }

        step(`${sinAsig.length} trabajadores sin asignación. Cargando habitaciones...`, 35);

        // 4. Cargar habitaciones y camas disponibles (indexar por numero_hab)
        const { data: todasHabs } = await supabase
            .from('v2_habitaciones')
            .select('id_custom, numero_hab');
        const habByNum = {};
        (todasHabs || []).forEach(h => { habByNum[String(h.numero_hab)] = h.id_custom; });

        const { data: todasCamas } = await supabase
            .from('v2_camas')
            .select('id_cama, habitacion_id, estado')
            .eq('estado', 'Disponible');
        // Index: habitacion_id → [id_camas libres]
        const camasLibresPorHab = {};
        (todasCamas || []).forEach(c => {
            if (!camasLibresPorHab[c.habitacion_id]) camasLibresPorHab[c.habitacion_id] = [];
            camasLibresPorHab[c.habitacion_id].push(c.id_cama);
        });

        // 5. Cargar empresas para buscar empresa_id
        const { data: empresas } = await supabase.from('v2_empresas').select('id, nombre');
        const empByNombre = {};
        (empresas || []).forEach(e => { empByNombre[e.nombre.toLowerCase()] = e.id; });
        function findEmpId(nombreEmp) {
            if (!nombreEmp) return null;
            const k = nombreEmp.toLowerCase();
            // Exact match primero
            if (empByNombre[k]) return empByNombre[k];
            // Partial match
            const found = Object.keys(empByNombre).find(n => n.includes(k.split(' ')[0]));
            return found ? empByNombre[found] : null;
        }

        step(`Creando ${sinAsig.length} asignaciones...`, 50);

        let creadas = 0, sinCama = 0;
        const camasYaUsadasEsteRun = new Set(); // evitar asignar la misma cama a 2 trabajadores en este lote

        for (const sol of sinAsig) {
            const habId = habByNum[String(sol.hab_solicitada || '')];
            if (!habId) { sinCama++; continue; }

            const camasDisp = (camasLibresPorHab[habId] || [])
                .filter(cId => !camasYaUsadasEsteRun.has(cId));
            if (!camasDisp.length) { sinCama++; continue; }

            const camaId = camasDisp[0];
            camasYaUsadasEsteRun.add(camaId);

            const rutNorm = String(sol.rut_trabajador || '').toUpperCase().replace(/\./g, '').slice(0, 12);
            const empId = findEmpId(sol.empresa);
            const estadoAsig = sol.fecha_llegada && sol.fecha_llegada > hoy ? 'pre_asignado' : 'activa';

            const { error: errI } = await supabase.from('v2_asignaciones').insert({
                id_cama:                 camaId,
                rut_huesped:            rutNorm || null,
                nombre_huesped:         sol.nombre_trabajador,
                empresa_id:             empId,
                fecha_checkin:          sol.fecha_llegada || hoy,
                fecha_salida_programada: sol.fecha_salida || null,
                estado_asignacion:      estadoAsig,
                huesped_confirmo:       false,
                autorizado_checkin:     false,
            });

            if (!errI) {
                // Marcar cama según estado
                const estadoCama = estadoAsig === 'activa' ? 'Ocupada' : 'Disponible';
                await supabase.from('v2_camas').update({ estado: estadoCama }).eq('id_cama', camaId);
                creadas++;
            } else {
                console.warn('[Reparar] Error insertando', sol.nombre_trabajador, errI.message);
                sinCama++;
            }
        }

        step('✅ Completado. Refrescando vista...', 95);
        overlay.remove();

        const msg = `🔧 Reparación completada:\n✅ ${creadas} asignaciones creadas\n${sinCama > 0 ? `⚠️ ${sinCama} sin cama disponible (habitación llena)` : '🎉 ¡Sin errores!'}`;
        alert(msg);

        // Refrescar la vista completa
        _camasCache = null; _habTagCache = null; _solicCache = null;
        if (_selPabellon) await selectPabellon(_selPabellon);

    } catch(e) {
        overlay.remove();
        console.error('[Reparar]', e);
        toast('❌ Error en reparación: ' + e.message, 'error');
    }
};

