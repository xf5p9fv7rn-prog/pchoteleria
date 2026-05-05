/**
 * CheckinPopoverV2.js
 * Componente NUEVO — HARD RESET
 * ─────────────────────────────
 * Popover flotante sin fondos oscuros, 100% conectado a v2_
 * Equivalente vanilla-JS de:
 *   <div className="absolute top-full left-0 mt-3 z-[9999]
 *                   bg-white p-6 rounded-2xl shadow-2xl w-96 border border-gray-100">
 */
import { supabase } from '../../supabaseClient.js';

const ID = 'checkin-popover-v2';

/**
 * Cierra y elimina el popover si existe.
 */
export function cerrarPopover() {
    const pop = document.getElementById(ID);
    if (pop?._outsideListener) {
        document.removeEventListener('mousedown', pop._outsideListener);
    }
    pop?.remove();
    document.getElementById(ID + '-backdrop')?.remove();
}

/**
 * Abre el CheckinPopoverV2 dentro de la tarjeta de habitación clicada.
 * @param {HTMLElement} card       - El div [data-cama-card] de la habitación
 * @param {string}      idCama     - ID de la cama (ej: "COPC000025-C1")
 * @param {'Disponible'|'Ocupada'|'Mantencion'} estado
 * @param {Function}    onSuccess  - Callback cuando se completa check-in / check-out
 */
export async function abrirPopover(card, idCama, estado, onSuccess) {
    cerrarPopover();

    // ── Detectar espacio disponible ──────────────────────────────────────────
    const rect       = card.getBoundingClientRect();
    const openAbove  = (window.innerHeight - rect.bottom) < 420;
    const alignRight = (window.innerWidth  - rect.left)   < 400;

    // ── Crear el popover ─────────────────────────────────────────────────────
    const pop = document.createElement('div');
    pop.id = ID;

    // STOP PROPAGATION en mousedown + pointerdown + click
    // Vital para que los inputs reciban foco sin que el documento cierre el popover
    const stopAll = e => e.stopPropagation();
    pop.addEventListener('mousedown',   stopAll);
    pop.addEventListener('pointerdown', stopAll);
    pop.addEventListener('click',       stopAll);

    Object.assign(pop.style, {
        position:     'absolute',
        zIndex:       '9999',
        width:        '384px',             // w-96
        maxWidth:     'calc(100vw - 16px)',
        background:   '#ffffff',           // bg-white
        padding:      '24px',              // p-6
        borderRadius: '16px',              // rounded-2xl
        boxShadow:    '0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)',
        border:       '1px solid #f3f4f6', // border border-gray-100
        top:          openAbove  ? 'auto' : 'calc(100% + 12px)',
        bottom:       openAbove  ? 'calc(100% + 12px)' : 'auto',
        left:         alignRight ? 'auto' : '0',
        right:        alignRight ? '0'    : 'auto',
        maxHeight:    '65vh',    // max-h-[65vh]
        overflowY:    'auto',    // overflow-y-auto — scroll interno
        overflowX:    'visible',
    });

    pop.innerHTML = loadingHTML(idCama, estado);
    // overflow:visible en la tarjeta padre — evita guillotina del popover
    card.style.position = 'relative';
    card.style.overflow  = 'visible';
    card.appendChild(pop);

    // ── Cerrar al hacer clic FUERA del popover (sin backdrop) ────────────────
    // Usamos mousedown en document para detectar el clic antes de que cambie el foco
    const _outsideClick = (e) => {
        if (!pop.contains(e.target)) {
            cerrarPopover();
        }
    };
    // Guardamos referencia para poder removerla al cerrar
    pop._outsideListener = _outsideClick;
    // Usamos setTimeout para evitar que el mousedown del botón "L" cierre inmediatamente
    setTimeout(() => document.addEventListener('mousedown', _outsideClick), 0);

    // Hace scroll para que el popover sea visible
    setTimeout(() => pop.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);

    // ── Cargar contenido según estado ────────────────────────────────────────
    if (estado === 'Ocupada') {
        await renderCheckout(pop, idCama, onSuccess);
    } else if (estado === 'Disponible') {
        await renderCheckin(pop, idCama, onSuccess);
    } else {
        document.getElementById(ID + '-body').innerHTML =
            '<p style="color:#6b7280;text-align:center;padding:16px">🔧 Cama en mantención.</p>';
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  CHECKOUT VIEW
// ════════════════════════════════════════════════════════════════════════════
async function renderCheckout(pop, idCama, onSuccess) {
    const body = document.getElementById(ID + '-body');

    // Fetch asignación activa desde v2_asignaciones
    const { data: asig, error } = await supabase
        .from('v2_asignaciones')
        .select('id, rut_huesped, nombre_huesped, fecha_checkin, fecha_salida_programada, numero_contrato, telefono, empresa_id, v2_empresas(nombre, turno, v2_gerencias(nombre))')
        .eq('id_cama', idCama)
        .is('fecha_checkout', null)
        .maybeSingle();

    if (error || !asig) {
        body.innerHTML = '<p style="color:#6b7280;text-align:center">Sin asignación activa.</p>';
        return;
    }

    body.innerHTML = `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="font-size:15px;font-weight:800;color:#111827;margin-bottom:10px">${asig.nombre_huesped}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
          ${field('RUT', `<span style="font-family:monospace">${asig.rut_huesped}</span>`)}
          ${field('Tel\u00e9fono', asig.telefono || '\u2014')}
          ${field('Empresa', asig.v2_empresas?.nombre || '\u2014')}
          ${field('Turno', asig.v2_empresas?.turno || '\u2014')}
          ${field('Gerencia', asig.v2_empresas?.v2_gerencias?.nombre || '\u2014')}
          ${field('Contrato', asig.numero_contrato || '\u2014')}
          ${field('Check-in', asig.fecha_checkin)}
          ${field('Salida prog.', asig.fecha_salida_programada || '\u2014')}
        </div>
      </div>
      <div id="${ID}-msg" style="min-height:16px;font-size:12px;font-weight:600;margin-bottom:8px"></div>

      <!-- Botones de acción -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <button id="${ID}-btn-transferir"
          style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;cursor:pointer">
          🔄 Transferir cama
        </button>
        <button id="${ID}-btn-eliminar"
          style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;cursor:pointer">
          🗑️ Eliminar asig.
        </button>
      </div>
      <button id="${ID}-btn-checkout"
        style="width:100%;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer">
        🚪 Registrar Check-out
      </button>

      <!-- Panel de transferencia (oculto) -->
      <div id="${ID}-transfer-panel" style="display:none;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:12px">
        <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:10px">📦 Seleccionar cama destino</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <select id="${ID}-tr-edif" style="padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;outline:none">
            <option value="">\u2014 Edificio \u2014</option>
          </select>
          <select id="${ID}-tr-pab" style="padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;outline:none" disabled>
            <option value="">\u2014 Pabell\u00f3n \u2014</option>
          </select>
          <select id="${ID}-tr-hab" style="padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;outline:none" disabled>
            <option value="">\u2014 Habitaci\u00f3n \u2014</option>
          </select>
          <select id="${ID}-tr-cama" style="padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;outline:none" disabled>
            <option value="">\u2014 Cama libre \u2014</option>
          </select>
          <button id="${ID}-btn-confirmar-transfer"
            style="width:100%;background:#6366f1;color:white;border:none;border-radius:10px;padding:12px;font-size:13px;font-weight:700;cursor:pointer;opacity:.5"
            disabled>✅ Confirmar transferencia</button>
        </div>
      </div>

      <!-- Panel confirmación de eliminar (oculto) -->
      <div id="${ID}-delete-panel" style="display:none;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:12px">
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;font-size:13px;color:#92400e;margin-bottom:10px">
          ⚠️ ¿Eliminar definitivamente la asignación de <strong>${asig.nombre_huesped}</strong>?<br>
          <span style="font-size:11px">La cama quedará disponible. Esta acción no registra check-out.</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button id="${ID}-btn-cancelar-delete"
            style="padding:10px;border:1.5px solid #e2e8f0;border-radius:10px;background:#f9fafb;font-weight:700;font-size:13px;cursor:pointer">
            Cancelar
          </button>
          <button id="${ID}-btn-confirmar-delete"
            style="padding:10px;border:none;border-radius:10px;background:#ef4444;color:white;font-weight:700;font-size:13px;cursor:pointer">
            Sí, eliminar
          </button>
        </div>
      </div>`;

    // ── Check-out ───────────────────────────────────────────────────────────
    document.getElementById(ID + '-btn-checkout').addEventListener('click', async () => {
        setMsg('Procesando…', '#6b7280');
        const { error: err } = await supabase.from('v2_asignaciones')
            .update({ fecha_checkout: new Date().toISOString().split('T')[0] })
            .eq('id', asig.id);
        if (err) { setMsg('❌ ' + err.message, '#ef4444'); return; }
        setMsg('✅ Check-out registrado', '#10b981');
        setTimeout(() => { cerrarPopover(); onSuccess?.('checkout', idCama); }, 1000);
    });

    // ── Eliminar ────────────────────────────────────────────────────────────
    document.getElementById(ID + '-btn-eliminar').addEventListener('click', () => {
        document.getElementById(ID + '-transfer-panel').style.display = 'none';
        document.getElementById(ID + '-delete-panel').style.display = 'block';
    });
    document.getElementById(ID + '-btn-cancelar-delete').addEventListener('click', () => {
        document.getElementById(ID + '-delete-panel').style.display = 'none';
    });
    document.getElementById(ID + '-btn-confirmar-delete').addEventListener('click', async () => {
        setMsg('Eliminando…', '#6b7280');
        const { error: errDel } = await supabase.from('v2_asignaciones').delete().eq('id', asig.id);
        if (errDel) { setMsg('❌ ' + errDel.message, '#ef4444'); return; }
        // Liberar la cama
        await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', idCama);
        setMsg('✅ Asignación eliminada', '#10b981');
        setTimeout(() => { cerrarPopover(); onSuccess?.('delete', idCama); }, 1000);
    });

    // ── Transferir ─────────────────────────────────────────────────────────
    document.getElementById(ID + '-btn-transferir').addEventListener('click', async () => {
        document.getElementById(ID + '-delete-panel').style.display = 'none';
        const panel = document.getElementById(ID + '-transfer-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';

        // Cargar edificios
        const { data: edifs } = await supabase.from('v2_edificios').select('id,nombre').order('nombre');
        const selEdif = document.getElementById(ID + '-tr-edif');
        selEdif.innerHTML = '<option value="">\u2014 Edificio \u2014</option>' +
            (edifs || []).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');

        selEdif.onchange = async () => {
            const eid = selEdif.value;
            const selPab = document.getElementById(ID + '-tr-pab');
            selPab.innerHTML = '<option value="">\u2014 Pabell\u00f3n \u2014</option>';
            selPab.disabled = !eid;
            document.getElementById(ID + '-tr-hab').disabled = true;
            document.getElementById(ID + '-tr-cama').disabled = true;
            if (!eid) return;
            const { data: pabs } = await supabase.from('v2_pabellones').select('id,nombre').eq('edificio_id', eid).order('nombre');
            selPab.innerHTML = '<option value="">\u2014 Pabell\u00f3n \u2014</option>' +
                (pabs || []).map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
            selPab.disabled = false;
        };

        document.getElementById(ID + '-tr-pab').onchange = async () => {
            const pid = document.getElementById(ID + '-tr-pab').value;
            const selHab = document.getElementById(ID + '-tr-hab');
            selHab.innerHTML = '<option value="">\u2014 Habitaci\u00f3n \u2014</option>';
            selHab.disabled = !pid;
            document.getElementById(ID + '-tr-cama').disabled = true;
            if (!pid) return;
            const { data: habs } = await supabase.from('v2_habitaciones').select('id_custom,numero_hab').eq('pabellon_id', pid).order('numero_hab');
            selHab.innerHTML = '<option value="">\u2014 Habitaci\u00f3n \u2014</option>' +
                (habs || []).map(h => `<option value="${h.id_custom}">${h.numero_hab}</option>`).join('');
            selHab.disabled = false;
        };

        document.getElementById(ID + '-tr-hab').onchange = async () => {
            const hid = document.getElementById(ID + '-tr-hab').value;
            const selCama = document.getElementById(ID + '-tr-cama');
            selCama.innerHTML = '<option value="">\u2014 Cama libre \u2014</option>';
            selCama.disabled = !hid;
            const btnConfirm = document.getElementById(ID + '-btn-confirmar-transfer');
            btnConfirm.disabled = true; btnConfirm.style.opacity = '.5';
            if (!hid) return;
            const { data: camas } = await supabase.from('v2_camas')
                .select('id_cama').eq('habitacion_id', hid).eq('estado', 'Disponible').order('id_cama');
            if (!camas?.length) {
                selCama.innerHTML = '<option value="">Sin camas libres en esta hab.</option>';
                return;
            }
            selCama.innerHTML = '<option value="">\u2014 Cama libre \u2014</option>' +
                camas.map(c => `<option value="${c.id_cama}">${c.id_cama}</option>`).join('');
            selCama.disabled = false;
            selCama.onchange = () => {
                const ok = !!selCama.value;
                btnConfirm.disabled = !ok; btnConfirm.style.opacity = ok ? '1' : '.5';
            };
        };

        document.getElementById(ID + '-btn-confirmar-transfer').addEventListener('click', async () => {
            const newCama = document.getElementById(ID + '-tr-cama').value;
            if (!newCama) return;
            setMsg('Transfiriendo…', '#6b7280');
            // 1. Mover asignación a nueva cama
            const { error: errMove } = await supabase.from('v2_asignaciones')
                .update({ id_cama: newCama }).eq('id', asig.id);
            if (errMove) { setMsg('❌ ' + errMove.message, '#ef4444'); return; }
            // 2. Liberar cama origen
            await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', idCama);
            // 3. Marcar cama destino como ocupada
            await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', newCama);
            setMsg('✅ Transferencia completada', '#10b981');
            setTimeout(() => { cerrarPopover(); onSuccess?.('transfer', idCama); }, 1000);
        });
    });
}

// ════════════════════════════════════════════════════════════════════════════
//  CHECKIN VIEW
// ════════════════════════════════════════════════════════════════════════════
async function renderCheckin(pop, idCama, onSuccess) {
    const body = document.getElementById(ID + '-body');

    // Fetch empresas de v2_cupos_gerencias — incluye empresa_id si existe
    const { data: cuposData } = await supabase
        .from('v2_cupos_gerencias')
        .select('id, empresa, gerencia, numero_contrato, empresa_id')
        .order('empresa');

    // Fetch también v2_empresas para tener el empresa_id para el INSERT
    const { data: empresasV2 } = await supabase
        .from('v2_empresas')
        .select('id, nombre, turno, v2_gerencias(nombre)')
        .order('nombre');

    const cupos   = cuposData  || [];
    const empresas = empresasV2 || [];
    const sinEmpresas = cupos.length === 0;
    const today = new Date().toISOString().split('T')[0];

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">

        ${sinEmpresas ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:13px;font-weight:700;color:#d97706;margin-bottom:8px">⚠️ Sin contratos en Cupos por Gerencia</div>
          <button onclick="cerrarPopover();window.navigate('v2cupos')"
            style="background:#f59e0b;color:white;border:none;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">
            📊 Ir a Cupos por Gerencia
          </button>
        </div>` : ''}

        <!-- RUT + Teléfono en la misma fila -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${fld('checkin-rut', 'RUT', 'text', '12345678-9')}
          ${fld('checkin-tel', 'Teléfono', 'text', '+56 9 ...')}
        </div>

        ${fld('checkin-nombre', 'Nombre completo', 'text', 'Nombre Apellido')}

        <div>
          <label style="${labelCSS}">Empresa — <code style="font-size:10px;color:#6366f1">Cupos por Gerencia</code></label>
          <select id="checkin-emp-cupo"
            style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #e5e7eb;font-size:14px;outline:none;color:#111827;background:#fff">
            <option value="">— Seleccionar empresa —</option>
            ${cupos.map(c => `<option value="${c.id}"
              data-empresa="${c.empresa || ''}"
              data-empresa-id="${c.empresa_id || ''}"
              data-gerencia="${c.gerencia || ''}"
              data-contrato="${c.numero_contrato || ''}"
            >${c.empresa || '—'}${c.numero_contrato ? ' · ' + c.numero_contrato : ''}</option>`).join('')}
          </select>
        </div>

        <div style="background:#f9fafb;border-radius:9px;padding:10px 14px;font-size:13px;color:#6b7280">
          Gerencia: <strong id="checkin-gerencia" style="color:#111827">—</strong>
        </div>

        ${fld('checkin-contrato', 'Número de Contrato', 'text', 'CTR-2024-001')}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${fld('checkin-llegada', 'Fecha llegada',      'date', '')}
          ${fld('checkin-salida',  'Salida programada',  'date', '')}
        </div>

        <div id="${ID}-msg" style="min-height:16px;font-size:13px;font-weight:600"></div>

        <button id="${ID}-btn-submit" ${sinEmpresas ? 'disabled' : ''}
          style="width:100%;background:${sinEmpresas ? '#9ca3af' : 'linear-gradient(135deg,#10b981,#059669)'};color:white;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:700;cursor:${sinEmpresas ? 'not-allowed' : 'pointer'};box-shadow:${sinEmpresas ? 'none' : '0 4px 14px rgba(16,185,129,0.35)'}">
          ✅ Confirmar Check-in → v2_asignaciones
        </button>
      </div>`;

    // Set default date
    const el = document.getElementById('checkin-llegada');
    if (el) el.value = today;

    // Auto-fill contrato y gerencia al seleccionar empresa del cupo
    document.getElementById('checkin-emp-cupo')?.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        const gerEl      = document.getElementById('checkin-gerencia');
        const contratoEl = document.getElementById('checkin-contrato');
        if (gerEl)      gerEl.textContent = opt?.dataset?.gerencia || '—';
        if (contratoEl) contratoEl.value  = opt?.dataset?.contrato || '';
    });

    // Auto-fill nombre on RUT blur (busca en v2_asignaciones)
    document.getElementById('checkin-rut')?.addEventListener('blur', async (e) => {
        const rut = e.target.value.trim().replace(/\./g, '').toUpperCase();
        if (!rut) return;
        
        // Aquí también quitamos el .maybeSingle() por si acaso y sacamos el primero del array
        const { data: tList } = await supabase
            .from('v2_asignaciones')
            .select('nombre_huesped')
            .eq('rut_huesped', rut)
            .order('fecha_checkin', { ascending: false })
            .limit(1);
            
        const t = (tList && tList.length > 0) ? tList[0] : null;
            
        if (t?.nombre_huesped) {
            const nameEl = document.getElementById('checkin-nombre');
            if (nameEl && !nameEl.value) {
                nameEl.value = t.nombre_huesped;
                nameEl.style.borderColor = '#10b981';
                setTimeout(() => nameEl.style.borderColor = '#e5e7eb', 2000);
            }
        }
    });

    // Submit — INSERT en v2_asignaciones (EXCLUSIVO V2)
    document.getElementById(`${ID}-btn-submit`).addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.target;
        const msg = document.getElementById(`${ID}-msg`);
        msg.textContent = '';

        const val = id => document.getElementById(id)?.value?.trim();
        const rawRut = document.getElementById('checkin-rut').value;
        const rut = rawRut.trim().replace(/\./g, '').toUpperCase();
        const nombre  = val('checkin-nombre');
        const tel     = val('checkin-tel');
        const llegada = val('checkin-llegada');
        const salida  = val('checkin-salida');
        const contrato= val('checkin-contrato');

        // Resolver empresa_id — 3 capas de fallback
        const cupoOpt       = document.getElementById('checkin-emp-cupo')?.selectedOptions[0];
        const empresaNombre = (cupoOpt?.dataset?.empresa || '').trim();

        if (!rut || !nombre || !cupoOpt?.value || !llegada) {
            setMsg('⚠️ RUT, Nombre, Empresa y Llegada son obligatorios', '#d97706'); return;
        }

        setMsg('Verificando empresa…', '#6b7280');
        let empId = null;

        // Capa 1: empresa_id directo desde v2_cupos_gerencias (si existe la columna)
        const cupoEmpId = cupoOpt?.dataset?.empresaId;
        if (cupoEmpId && cupoEmpId !== 'null' && cupoEmpId !== '') {
            empId = cupoEmpId;
        }

        // Capa 2: búsqueda en v2_empresas con wildcards (contiene)
        if (!empId && empresaNombre) {
            const palabras = empresaNombre.split(' ').slice(0, 2).join(' ');
            const { data: empSearch } = await supabase
                .from('v2_empresas')
                .select('id')
                .ilike('nombre', `%${palabras}%`)
                .limit(1);
            empId = empSearch?.[0]?.id ?? null;
        }

        // Capa 3: crear la empresa si no existe
        if (!empId && empresaNombre) {
            const { data: newEmp, error: errEmp } = await supabase
                .from('v2_empresas')
                .insert([{ nombre: empresaNombre }])
                .select('id')
                .single();
            if (!errEmp) empId = newEmp?.id ?? null;
        }

        if (!empId) {
            setMsg('❌ No se resolvió la empresa. Ve a V2 Empresas y agrega: ' + empresaNombre, '#ef4444');
            return;
        }


        // ── Verificar cupos disponibles ────────────────────────────────────
        const cupoSelId = cupoOpt.value;
        const { data: cupoCheck } = await supabase
            .from('v2_cupos_gerencias')
            .select('cupos_totales, cupos_ocupados, empresa')
            .eq('id', cupoSelId)
            .single();

        if (cupoCheck && cupoCheck.cupos_totales > 0) {
            const ocupados = cupoCheck.cupos_ocupados || 0;
            const totales  = cupoCheck.cupos_totales;
            const isSupervisor = ['supervisor','superadmin'].includes(window._currentUser?.role);

            if (ocupados >= totales) {
                if (!isSupervisor) {
                    setMsg(
                        `🚫 Cupos llenos: ${cupoCheck.empresa} tiene ${ocupados}/${totales} cupos ocupados. ` +
                        `Solo un Supervisor puede ampliar el límite.`,
                        '#dc2626'
                    );
                    return; // Bloqueo total para admins
                }
                // Supervisor: puede pasar pero con aviso
                setMsg(`⚠️ Atención: cupos al límite (${ocupados}/${totales}). Guardando como Supervisor…`, '#f59e0b');
                await new Promise(r => setTimeout(r, 1500)); // Pausa para que vea el aviso
            }
        }

        setMsg('Guardando en v2_asignaciones…', '#6b7280');

        // INSERT obligatorio en v2_asignaciones
        const { error: err } = await supabase
            .from('v2_asignaciones')
            .insert([{
                id_cama:                 idCama,
                empresa_id:              empId,
                rut_huesped:             rut,
                nombre_huesped:          nombre,
                fecha_checkin:           llegada,
                fecha_checkout:          null,
                fecha_salida_programada: salida   || null,
                numero_contrato:         contrato || null,
                telefono:                tel      || null,
            }]);

        if (err) { setMsg('❌ ' + err.message, '#ef4444'); return; }
        setMsg('✅ Check-in registrado correctamente', '#10b981');
        setTimeout(() => { cerrarPopover(); onSuccess?.('checkin', idCama); }, 1200);
    });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const labelCSS = 'font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px';

function loadingHTML(idCama, estado) {
    const color = estado === 'Ocupada' ? '#ef4444' : estado === 'Disponible' ? '#10b981' : '#f59e0b';
    const icon  = estado === 'Ocupada' ? '🔴' : estado === 'Disponible' ? '✅' : '🟡';
    return `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
        <div style="width:38px;height:38px;border-radius:12px;background:${color}18;display:flex;align-items:center;justify-content:center;font-size:18px">${icon}</div>
        <div>
          <div style="font-size:14px;font-weight:800;color:#111827">${idCama}</div>
          <div style="font-size:11px;color:#6b7280">Estado: ${estado}</div>
        </div>
        <button id="${ID}-close" style="margin-left:auto;background:#f9fafb;border:1px solid #e5e7eb;border-radius:50%;width:30px;height:30px;font-size:14px;cursor:pointer;color:#6b7280;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <div id="${ID}-body" style="color:#6b7280;text-align:center;padding:20px">Cargando…</div>`;
}

function field(label, value) {
    return `<div><span style="color:#6b7280">${label}</span><br><strong style="color:#111827">${value}</strong></div>`;
}

function fld(id, label, type, placeholder) {
    return `<div>
      <label style="${labelCSS}">${label}</label>
      <input id="${id}" type="${type}" placeholder="${placeholder}"
        style="width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid #e5e7eb;font-size:14px;outline:none;color:#111827;box-sizing:border-box;transition:border-color 0.2s"
        onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e5e7eb'">
    </div>`;
}

function setMsg(text, color) {
    const el = document.getElementById(ID + '-msg');
    if (el) { el.textContent = text; el.style.color = color; }
}
