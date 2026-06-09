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

    // ── Botón X: cerrar popover ───────────────────────────────────────────────
    document.getElementById(ID + '-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        cerrarPopover();
    });



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
    // renderCheckout maneja PRE / ACTUAL / SALIENTES para cualquier estado de cama
    if (estado === 'Mantencion') {
        renderMantencion(pop, idCama, onSuccess);
    } else {
        // Ocupada, Disponible: siempre mostrar las 3 secciones completas
        await renderCheckout(pop, idCama, onSuccess);
    }

}

// ════════════════════════════════════════════════════════════════════════════
//  CHECKOUT VIEW  — muestra ocupante actual + saliendo hoy + por llegar
// ════════════════════════════════════════════════════════════════════════════
async function renderCheckout(pop, idCama, onSuccess) {
    const body = document.getElementById(ID + '-body');
    const hoy  = new Date().toISOString().split('T')[0];

    // ── 1. Traer TODAS las asignaciones activas de esta cama ────────────────
    //    ⚠️ NO usar .maybeSingle() — si hay 2+ filas falla silenciosamente
    const { data: todasAsig = [], error } = await supabase
        .from('v2_asignaciones')
        .select('id, rut_huesped, nombre_huesped, fecha_checkin, fecha_salida_programada, numero_contrato, telefono, empresa_id, huesped_confirmo, estado_asignacion, v2_empresas(nombre, turno, v2_gerencias(nombre))')
        .eq('id_cama', idCama)
        .is('fecha_checkout', null)
        .order('fecha_checkin');

    // ── 2. Categorizar ───────────────────────────────────────────────────
    // 'actuales' = quienes ESTÁN o ESTABAN en la cama (activa o pre_asignado que ya llegó)
    // 'preAsig'  = quienes LLEGARÁN (pre_asignado con fecha_checkin futura)
    const actuales = todasAsig.filter(a => {
        if (a.fecha_checkout) return false; // ya hizo checkout
        if (a.estado_asignacion === 'pre_asignado' && a.fecha_checkin > hoy) return false; // futuro
        return true;
    });
    const preAsig  = todasAsig.filter(a => !a.fecha_checkout && a.estado_asignacion === 'pre_asignado' && a.fecha_checkin > hoy);
    const saliendo = todasAsig.filter(a => a.fecha_salida_programada === hoy && !a.fecha_checkout);

    // ── 3. Solicitudes B2B pendientes (pre-asig que aún no son asignaciones) ─
    let solicPreAsig = [];
    try {
        const { data: camaRow } = await supabase
            .from('v2_camas').select('habitacion_id').eq('id_cama', idCama).maybeSingle();
        if (camaRow?.habitacion_id) {
            const { data: habRow } = await supabase
                .from('v2_habitaciones').select('numero_hab').eq('id_custom', camaRow.habitacion_id).maybeSingle();
            if (habRow?.numero_hab) {
                const { data: solics } = await supabase
                    .from('v2_solicitudes_b2b')
                    .select('id, nombre_trabajador, rut_trabajador, empresa, fecha_llegada, fecha_salida')
                    .eq('hab_solicitada', String(habRow.numero_hab))
                    .in('status', ['aceptada', 'pendiente'])
                    .gt('fecha_llegada', hoy)
                    .order('fecha_llegada');
                solicPreAsig = solics || [];
            }
        }
    } catch(_) {}

    // ── 4. Deduplicar solicPreAsig ───────────────────────────────────────────
    const preAsigRuts  = new Set(preAsig.map(a => (a.rut_huesped||'').toLowerCase()).filter(Boolean));
    const preAsigNames = new Set(preAsig.map(a => (a.nombre_huesped||'').toLowerCase()).filter(Boolean));
    const solicFiltrada = solicPreAsig.filter(s =>
        !preAsigRuts.has((s.rut_trabajador||'').toLowerCase()) &&
        !preAsigNames.has((s.nombre_trabajador||'').toLowerCase())
    );

    // ── 5. Helper de formato fecha DD/MM ────────────────────────────────────
    const dd = f => f ? f.substring(8,10)+'/'+f.substring(5,7) : '—';

    // ── 6. Construir HTML — orden: PRE → ACTUALES → SALIENTES ───────────────
    let html = '';

    // ══ SECCIÓN PRE-ASIGNADOS (ARRIBA) ══════════════════════════════════════
    const todosPre = [
        ...preAsig.map(a => ({ tipo:'asig', id: a.id, nombre: a.nombre_huesped, rut: a.rut_huesped,
            empresa: a.v2_empresas?.nombre, turno: a.v2_empresas?.turno,
            gerencia: a.v2_empresas?.v2_gerencias?.nombre, contrato: a.numero_contrato,
            llegada: a.fecha_checkin, salida: a.fecha_salida_programada })),
        ...solicFiltrada.map(s => ({ tipo:'solic', id: s.id, nombre: s.nombre_trabajador, rut: s.rut_trabajador,
            empresa: s.empresa, llegada: s.fecha_llegada, salida: s.fecha_salida }))
    ];

    if (todosPre.length > 0) {
        html += `
        <div style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1.5px solid #c4b5fd;border-radius:14px;padding:14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">
            <span style="background:#7c3aed;color:#fff;border-radius:8px;padding:3px 10px;font-size:10px;font-weight:900;letter-spacing:.6px">PRE-ASIGNADOS</span>
            <span style="font-size:10px;color:#7c3aed;font-weight:700">📅 Por llegar · ${todosPre.length} persona(s)</span>
          </div>
          ${todosPre.map((p, pidx) => `
          <div style="background:#fff;border:1px solid #ddd6fe;border-radius:10px;padding:11px;margin-bottom:8px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px">
              <div style="font-size:14px;font-weight:800;color:#4c1d95">${p.nombre || '—'}</div>
              ${p.tipo==='solic' ? `<span style="font-size:9px;background:#ede9fe;color:#6d28d9;border-radius:5px;padding:1px 6px;font-weight:700">B2B</span>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:11px">
              ${field('RUT', `<span style="font-family:monospace">${p.rut||'—'}</span>`)}
              ${field('Empresa', p.empresa||'—')}
              ${p.turno ? field('Turno', p.turno) : ''}
              ${p.gerencia ? field('Gerencia', p.gerencia) : ''}
              ${p.contrato ? field('Contrato', p.contrato) : ''}
              ${field('Llega', dd(p.llegada))}
              ${field('Sale', dd(p.salida))}
            </div>
            <!-- Acciones para este pre-asignado -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-top:10px">
              <button data-pre-action="delete" data-pre-idx="${pidx}"
                style="background:#ef4444;color:white;border:none;border-radius:8px;padding:7px 4px;font-size:11px;font-weight:700;cursor:pointer">
                🗑️ Eliminar
              </button>
              ${p.tipo==='asig' ? `
              <button data-pre-action="transfer" data-pre-idx="${pidx}"
                style="background:#6366f1;color:white;border:none;border-radius:8px;padding:7px 4px;font-size:11px;font-weight:700;cursor:pointer">
                🔀 Transferir
              </button>` : '<div></div>'}
              <button data-pre-action="cambiar" data-pre-idx="${pidx}"
                style="background:linear-gradient(135deg,#0ea5e9,#0284c7);color:white;border:none;border-radius:8px;padding:7px 4px;font-size:11px;font-weight:700;cursor:pointer">
                👤 Cambiar
              </button>
            </div>
            ${p.tipo==='asig' ? `
            <div id="pre-tr-panel-${pidx}" style="display:none;margin-top:8px;background:#f5f3ff;border:1px solid #c4b5fd;border-radius:10px;padding:10px">
              <input type="text" placeholder="Nº habitación destino…" id="pre-tr-inp-${pidx}"
                style="width:100%;padding:8px 12px;border-radius:8px;border:1.5px solid #a78bfa;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:6px">
              <div id="pre-tr-res-${pidx}" style="font-size:11px;color:#6b7280;min-height:14px;margin-bottom:6px"></div>
              <select id="pre-tr-sel-${pidx}" style="display:none;width:100%;padding:8px;border:1.5px solid #a78bfa;border-radius:8px;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:6px">
                <option value="">— Elige cama libre —</option>
              </select>
              <button id="pre-tr-btn-${pidx}" style="display:none;width:100%;background:#6366f1;color:white;border:none;border-radius:8px;padding:9px;font-size:12px;font-weight:700;cursor:pointer">
                ✅ Confirmar transferencia
              </button>
            </div>` : ''}
            <!-- Panel Cambiar Usuario -->
            <div id="pre-cambiar-panel-${pidx}" style="display:none;margin-top:8px;background:#f0f9ff;border:1px solid #7dd3fc;border-radius:10px;padding:10px">
              <div style="font-size:11px;font-weight:800;color:#0369a1;margin-bottom:8px">👤 Cambiar persona asignada</div>
              <input type="text" id="pre-cambiar-rut-${pidx}" placeholder="Nuevo RUT (12345678-9)"
                style="width:100%;padding:8px 10px;border-radius:7px;border:1.5px solid #7dd3fc;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:6px;font-family:monospace">
              <input type="text" id="pre-cambiar-nombre-${pidx}" placeholder="Nombre completo"
                style="width:100%;padding:8px 10px;border-radius:7px;border:1.5px solid #7dd3fc;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:6px">
              <select id="pre-cambiar-emp-${pidx}"
                style="width:100%;padding:8px 10px;border-radius:7px;border:1.5px solid #7dd3fc;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:8px">
                <option value="">— Cargando empresas… —</option>
              </select>
              <div id="pre-cambiar-msg-${pidx}" style="min-height:14px;font-size:11px;font-weight:700;color:#0369a1;margin-bottom:6px"></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <button data-pre-action="cambiar-cancel" data-pre-idx="${pidx}"
                  style="padding:8px;border:1.5px solid #e2e8f0;border-radius:8px;background:#f9fafb;font-size:11px;font-weight:700;cursor:pointer">✕ Cancelar</button>
                <button data-pre-action="cambiar-confirm" data-pre-idx="${pidx}"
                  style="padding:8px;border:none;border-radius:8px;background:#0ea5e9;color:white;font-size:11px;font-weight:700;cursor:pointer">✅ Confirmar</button>
              </div>
            </div>

          </div>`).join('')}
        </div>`;
    }

    // ══ SECCIÓN ACTUALES (MEDIO) ═════════════════════════════════════════════
    // Solo registros activa (no pre_asignado)
    const actualesActivos = actuales.filter(a => a.estado_asignacion !== 'pre_asignado');
    if (actualesActivos.length > 0) {
        html += `
        <div style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border:1.5px solid #fca5a5;border-radius:14px;padding:14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">
            <span style="background:#dc2626;color:#fff;border-radius:8px;padding:3px 10px;font-size:10px;font-weight:900;letter-spacing:.6px">ACTUALES</span>
            <span style="font-size:10px;color:#b91c1c;font-weight:700">👤 En cama ahora · ${actualesActivos.length} persona(s)</span>
          </div>
          ${actualesActivos.map(a => `
          <div style="background:#fff;border:1px solid #fecaca;border-radius:10px;padding:11px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
              <div style="font-size:14px;font-weight:800;color:#991b1b;flex:1">${a.nombre_huesped || '—'}</div>
              ${a.huesped_confirmo ? `<span style="background:#dcfce7;color:#15803d;border-radius:6px;padding:2px 7px;font-size:10px;font-weight:800">✅ Confirmado</span>` : `<span style="background:#fef9c3;color:#92400e;border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700">Sin confirmar</span>`}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:11px">
              ${field('RUT', `<span style="font-family:monospace">${a.rut_huesped||'—'}</span>`)}
              ${field('Empresa', a.v2_empresas?.nombre||'—')}
              ${field('Turno', a.v2_empresas?.turno||'—')}
              ${field('Gerencia', a.v2_empresas?.v2_gerencias?.nombre||'—')}
              ${field('Contrato', a.numero_contrato||'—')}
              ${field('Ingresó', dd(a.fecha_checkin))}
              ${field('Sale', dd(a.fecha_salida_programada))}
            </div>
          </div>`).join('')}
        </div>`;
    } else {
        html += `<div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:12px;margin-bottom:10px;text-align:center;color:#94a3b8;font-size:12px">Sin ocupante activo en este momento</div>`;
    }

    // ══ SECCIÓN SALIENTES (ABAJO) ════════════════════════════════════════════
    if (saliendo.length > 0) {
        html += `
        <div style="background:linear-gradient(135deg,#fffbeb,#fef3c7);border:1.5px solid #fcd34d;border-radius:14px;padding:14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">
            <span style="background:#d97706;color:#fff;border-radius:8px;padding:3px 10px;font-size:10px;font-weight:900;letter-spacing:.6px">SALIENTES</span>
            <span style="font-size:10px;color:#92400e;font-weight:700">🧳 Sale hoy · ${saliendo.length} persona(s)</span>
          </div>
          ${saliendo.map(s => `
          <div style="background:#fff;border:1px solid #fde68a;border-radius:10px;padding:11px;margin-bottom:8px">
            <div style="font-size:14px;font-weight:800;color:#78350f;margin-bottom:6px">${s.nombre_huesped || '—'}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:11px">
              ${field('RUT', `<span style="font-family:monospace">${s.rut_huesped||'—'}</span>`)}
              ${field('Empresa', s.v2_empresas?.nombre||'—')}
              ${field('Turno', s.v2_empresas?.turno||'—')}
              ${field('Contrato', s.numero_contrato||'—')}
              ${field('Ingresó', dd(s.fecha_checkin))}
              ${field('Sale', dd(s.fecha_salida_programada))}
            </div>
            <div style="margin-top:8px;background:#fef9c3;border-radius:7px;padding:6px 9px;font-size:11px;font-weight:800;color:#92400e">
              🕐 Check-out automático a las 22:00
            </div>
          </div>`).join('')}
        </div>`;
    }

    // ── ACCIONES ─────────────────────────────────────────────────────────────
    // El "main" para acciones es el primer activo real (no pre_asignado)
    const main    = actualesActivos[0] || actuales[0];
    const mainPre = !actualesActivos.length && main?.estado_asignacion === 'pre_asignado';
    html += `<div id="${ID}-msg" style="min-height:16px;font-size:12px;font-weight:600;margin:8px 0"></div>`;

    if (main) {
        html += `
          <div style="display:grid;grid-template-columns:${['supervisor','superadmin'].includes(window._currentUser?.role) ? '1fr 1fr' : '1fr'};gap:8px;margin-bottom:8px">
            <button id="${ID}-btn-transferir" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;border-radius:12px;padding:11px;font-size:13px;font-weight:700;cursor:pointer">🔄 Transferir</button>
            ${['supervisor','superadmin'].includes(window._currentUser?.role) ? `
            <button id="${ID}-btn-eliminar" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border:none;border-radius:12px;padding:11px;font-size:13px;font-weight:700;cursor:pointer">🗑️ Eliminar</button>` : ''}
          </div>
          ${mainPre ? `
          <button id="${ID}-btn-confirmar-checkin" style="width:100%;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(16,185,129,0.35)">
            ✅ Confirmar Llegada → Activar Asignación
          </button>` : `
          <button id="${ID}-btn-checkout" style="width:100%;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">🚩 Registrar Check-out</button>
          <button id="${ID}-btn-extender" style="width:100%;background:transparent;border:1.5px solid #6366f1;color:#6366f1;border-radius:12px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;margin-top:8px">📅 Extender estadía</button>
          <div id="${ID}-extender-panel" style="display:none;margin-top:8px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:14px">
            <div style="font-size:12px;font-weight:700;color:#4c1d95;margin-bottom:8px">Nueva fecha de salida programada</div>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="date" id="${ID}-ext-fecha" value="${main.fecha_salida_programada || ''}"
                style="flex:1;padding:9px 12px;border-radius:9px;border:1.5px solid #a78bfa;font-size:14px;outline:none;color:#1e293b">
              <button id="${ID}-btn-ext-confirmar" style="padding:9px 18px;border:none;border-radius:9px;background:#6366f1;color:#fff;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap">✓ Guardar</button>
            </div>
            <div id="${ID}-ext-msg" style="min-height:14px;font-size:12px;font-weight:700;margin-top:6px;color:#4c1d95"></div>
          </div>
          ${!main.huesped_confirmo ? `
          <button id="${ID}-btn-confirmar-llegada" style="width:100%;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px">✅ Confirmar Llegada</button>` : ''}
          ${ (main.v2_empresas?.nombre || '').toLowerCase().includes('anglo') ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
            <button id="${ID}-btn-sinllave" style="background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;border:none;border-radius:12px;padding:10px;font-size:12px;font-weight:700;cursor:pointer">🔑 No entregó llave</button>
            <button id="${ID}-btn-baja" style="background:linear-gradient(135deg,#d97706,#b45309);color:white;border:none;border-radius:12px;padding:10px;font-size:12px;font-weight:700;cursor:pointer">🏃 Bajada anticipada</button>
          </div>` : ''}`}
          <!-- Panel de transferencia -->
          <div id="${ID}-transfer-panel" style="display:none;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:12px">
            <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:10px">📦 Seleccionar cama destino</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <div style="position:relative">
                <input id="${ID}-tr-numhab" type="text" placeholder="Ej: 4501, 7606…" autocomplete="off"
                  style="width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid #6366f1;font-size:14px;outline:none;color:#111827;box-sizing:border-box;font-weight:600"
                  oninput="window._trBuscarHab(this.value)">
                <span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:14px">🔍</span>
              </div>
              <div id="${ID}-tr-resultado" style="font-size:12px;color:#6b7280;min-height:18px;font-style:italic"></div>
              <select id="${ID}-tr-cama" style="padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;outline:none;display:none">
                <option value="">— Cama libre —</option>
              </select>
              <button id="${ID}-btn-confirmar-transfer" style="width:100%;background:#6366f1;color:white;border:none;border-radius:10px;padding:12px;font-size:13px;font-weight:700;cursor:pointer;opacity:.5" disabled>✅ Confirmar transferencia</button>
            </div>
          </div>
          <!-- Panel eliminar -->
          <div id="${ID}-delete-panel" style="display:none;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:12px">
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;font-size:13px;color:#92400e;margin-bottom:10px">
              ⚠️ ¿Eliminar la asignación de <strong>${main.nombre_huesped}</strong>?<br>
              <span style="font-size:11px">La cama quedará disponible. Esta acción no registra check-out.</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <button id="${ID}-btn-cancelar-delete" style="padding:10px;border:1.5px solid #e2e8f0;border-radius:10px;background:#f9fafb;font-weight:700;font-size:13px;cursor:pointer">Cancelar</button>
              <button id="${ID}-btn-confirmar-delete" style="padding:10px;border:none;border-radius:10px;background:#ef4444;color:white;font-weight:700;font-size:13px;cursor:pointer">Sí, eliminar</button>
            </div>
          </div>`;
    }

    // ── FOOTER: acciones secundarias siempre visibles ─────────────────────────
    html += `
    <div style="border-top:1px solid #f1f5f9;margin-top:12px;padding-top:12px;display:flex;flex-direction:column;gap:7px">
      <button id="${ID}-btn-ir-checkin"
        style="width:100%;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:11px;padding:11px;font-size:13px;font-weight:700;cursor:pointer">
        ➕ Check-in manual
      </button>
      <button id="${ID}-btn-mant-footer"
        style="width:100%;background:transparent;border:1.5px solid #64748b;color:#64748b;border-radius:11px;padding:10px;font-size:12px;font-weight:600;cursor:pointer">
        🔧 Poner en Mantención
      </button>
    </div>`;

    body.innerHTML = html;

    // ── Acciones para cada PRE-ASIGNADO (Cancelar / Transferir) ─────────────
    todosPre.forEach((p, pidx) => {
        // ── Cancelar ──────────────────────────────────────────────────────────
        body.querySelector(`[data-pre-action="cancel"][data-pre-idx="${pidx}"]`)?.addEventListener('click', async () => {
            const nombre = p.nombre || 'este trabajador';
            if (!confirm(`¿Cancelar la pre-asignación de ${nombre}?\nLa cama quedará disponible.`)) return;
            try {
                if (p.tipo === 'asig' && p.id) {
                    const { error } = await supabase.from('v2_asignaciones').delete().eq('id', p.id);
                    if (error) throw error;
                    // Verificar si quedan más asignaciones activas
                    const { count } = await supabase.from('v2_asignaciones')
                        .select('id', { count: 'exact', head: true })
                        .eq('id_cama', idCama).is('fecha_checkout', null);
                    if (!count) {
                        await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', idCama).neq('estado', 'Deshabilitada');
                    }
                } else if (p.tipo === 'solic' && p.id) {
                    await supabase.from('v2_solicitudes_b2b').update({ status: 'cancelada' }).eq('id', p.id);
                }
                setMsg('✅ Pre-asignación cancelada — cama libre', '#10b981');
                setTimeout(() => { cerrarPopover(); onSuccess?.('cancelar_pre', idCama); }, 800);
            } catch(e) { setMsg('❌ ' + e.message, '#ef4444'); }
        });

        // ── Transferir ────────────────────────────────────────────────────────
        if (p.tipo === 'asig') {
            body.querySelector(`[data-pre-action="transfer"][data-pre-idx="${pidx}"]`)?.addEventListener('click', () => {
                const panel = document.getElementById(`pre-tr-panel-${pidx}`);
                if (!panel) return;
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                if (panel.style.display === 'block') {
                    document.getElementById(`pre-tr-inp-${pidx}`)?.focus();
                }
            });

            // Buscar habitación destino
            document.getElementById(`pre-tr-inp-${pidx}`)?.addEventListener('input', async (e) => {
                const num = e.target.value.trim();
                const res = document.getElementById(`pre-tr-res-${pidx}`);
                const sel = document.getElementById(`pre-tr-sel-${pidx}`);
                const btn = document.getElementById(`pre-tr-btn-${pidx}`);
                sel.style.display = 'none'; btn.style.display = 'none';
                sel.innerHTML = '<option value="">— Elige cama libre —</option>';
                if (num.length < 2) { if (res) res.textContent = 'Escribe el número de habitación…'; return; }
                if (res) res.textContent = '🔍 Buscando…';

                let { data: habs } = await supabase.from('v2_habitaciones')
                    .select('id_custom, numero_hab').eq('numero_hab', num).limit(5);
                if (!habs?.length) {
                    const { data: hl } = await supabase.from('v2_habitaciones')
                        .select('id_custom, numero_hab').ilike('numero_hab', `%${num}%`).limit(20);
                    habs = hl;
                }
                if (!habs?.length) { if (res) res.textContent = `❌ Habitación "${num}" no encontrada`; return; }

                const { data: camas } = await supabase.from('v2_camas')
                    .select('id_cama, habitacion_id')
                    .in('habitacion_id', habs.map(h => h.id_custom))
                    .eq('estado', 'Disponible').neq('id_cama', idCama).order('id_cama');

                if (!camas?.length) { if (res) res.textContent = `⚠️ Sin camas libres en hab. ${num}`; return; }

                const habNums = {};
                habs.forEach(h => { habNums[h.id_custom] = h.numero_hab; });
                if (res) res.textContent = `✅ ${camas.length} cama(s) disponible(s)`;
                sel.innerHTML = '<option value="">— Elige cama —</option>' +
                    camas.map(c => `<option value="${c.id_cama}">🛏 ${c.id_cama} · Hab.${habNums[c.habitacion_id]||''}</option>`).join('');
                sel.style.display = 'block';
                btn.style.display = 'block';
                sel.onchange = () => { btn.style.opacity = sel.value ? '1' : '.5'; };
            });

            // Confirmar transferencia
            document.getElementById(`pre-tr-btn-${pidx}`)?.addEventListener('click', async () => {
                const sel    = document.getElementById(`pre-tr-sel-${pidx}`);
                const newCama = sel?.value;
                if (!newCama || !p.id) { setMsg('⚠️ Selecciona una cama destino', '#d97706'); return; }
                setMsg('Transfiriendo pre-asignación…', '#6b7280');
                // Mover la asignación a la nueva cama (ambas quedan Disponibles hasta que llegue)
                const { error } = await supabase.from('v2_asignaciones')
                    .update({ id_cama: newCama }).eq('id', p.id);
                if (error) { setMsg('❌ ' + error.message, '#ef4444'); return; }
                setMsg('✅ Pre-asignación transferida a ' + newCama, '#10b981');
                setTimeout(() => { cerrarPopover(); onSuccess?.('transfer_pre', idCama); }, 900);
            });
        }

        // ── Eliminar (hard delete con confirmación) ────────────────────────────
        body.querySelector(`[data-pre-action="delete"][data-pre-idx="${pidx}"]`)?.addEventListener('click', async () => {
            const nombre = p.nombre || 'este trabajador';
            if (!confirm(`¿ELIMINAR definitivamente la asignación de ${nombre}?\n\nLa cama quedará disponible. Esta acción no se puede deshacer.`)) return;
            try {
                if (p.tipo === 'asig' && p.id) {
                    const { error } = await supabase.from('v2_asignaciones').delete().eq('id', p.id);
                    if (error) throw error;
                    const { count } = await supabase.from('v2_asignaciones')
                        .select('id', { count: 'exact', head: true })
                        .eq('id_cama', idCama).is('fecha_checkout', null);
                    if (!count) {
                        await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', idCama).neq('estado', 'Deshabilitada');
                    }
                } else if (p.tipo === 'solic' && p.id) {
                    await supabase.from('v2_solicitudes_b2b').update({ status: 'cancelada' }).eq('id', p.id);
                }
                setMsg('🗑️ Asignación eliminada — cama libre', '#10b981');
                setTimeout(() => { cerrarPopover(); onSuccess?.('eliminar_pre', idCama); }, 800);
            } catch(e) { setMsg('❌ ' + e.message, '#ef4444'); }
        });

        // ── Cambiar Usuario — abrir/cerrar panel ──────────────────────────────
        body.querySelector(`[data-pre-action="cambiar"][data-pre-idx="${pidx}"]`)?.addEventListener('click', async () => {
            const panel = document.getElementById(`pre-cambiar-panel-${pidx}`);
            if (!panel) return;
            const isOpen = panel.style.display !== 'none';
            panel.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) {
                // Cargar lista de empresas al abrir por primera vez
                const sel = document.getElementById(`pre-cambiar-emp-${pidx}`);
                if (sel && sel.options.length <= 1) {
                    const { data: emps } = await supabase.from('v2_empresas').select('id, nombre, turno').order('nombre');
                    if (emps?.length) {
                        sel.innerHTML = '<option value="">— Seleccionar empresa —</option>' +
                            emps.map(e => `<option value="${e.id}">${e.nombre}${e.turno ? ' · ' + e.turno : ''}</option>`).join('');
                        if (p.empresa_id) sel.value = p.empresa_id;
                    }
                }
                document.getElementById(`pre-cambiar-rut-${pidx}`)?.focus();
            }
        });

        // ── Cambiar Usuario — cancelar ─────────────────────────────────────────
        body.querySelector(`[data-pre-action="cambiar-cancel"][data-pre-idx="${pidx}"]`)?.addEventListener('click', () => {
            const panel = document.getElementById(`pre-cambiar-panel-${pidx}`);
            if (panel) panel.style.display = 'none';
        });

        // ── Cambiar Usuario — confirmar ────────────────────────────────────────
        body.querySelector(`[data-pre-action="cambiar-confirm"][data-pre-idx="${pidx}"]`)?.addEventListener('click', async () => {
            const nuevoRut    = document.getElementById(`pre-cambiar-rut-${pidx}`)?.value?.trim();
            const nuevoNombre = document.getElementById(`pre-cambiar-nombre-${pidx}`)?.value?.trim();
            const nuevaEmp    = document.getElementById(`pre-cambiar-emp-${pidx}`)?.value;
            const msgEl       = document.getElementById(`pre-cambiar-msg-${pidx}`);
            if (!nuevoRut || !nuevoNombre) {
                if (msgEl) { msgEl.textContent = '⚠️ RUT y Nombre son obligatorios'; msgEl.style.color = '#d97706'; }
                return;
            }
            if (msgEl) { msgEl.textContent = '⏳ Guardando cambio…'; msgEl.style.color = '#0369a1'; }
            try {
                if (!p.id) throw new Error('Sin ID de asignación');
                const { error } = await supabase.from('v2_asignaciones').update({
                    rut_huesped:    nuevoRut.toUpperCase(),
                    nombre_huesped: nuevoNombre,
                    empresa_id:     nuevaEmp || null,
                }).eq('id', p.id);
                if (error) throw error;
                setMsg(`✅ Usuario cambiado a ${nuevoNombre}`, '#10b981');
                setTimeout(() => { cerrarPopover(); onSuccess?.('cambiar_usuario', idCama); }, 900);
            } catch(e) {
                if (msgEl) { msgEl.textContent = '❌ ' + e.message; msgEl.style.color = '#ef4444'; }
            }
        });
    });


    // Botón check-in manual → cambiar a renderCheckin
    document.getElementById(ID + '-btn-ir-checkin')?.addEventListener('click', () => {
        renderCheckin(pop, idCama, onSuccess);
    });

    // Botón Poner en Mantención (siempre disponible)
    document.getElementById(ID + '-btn-mant-footer')?.addEventListener('click', async () => {
        if (!confirm(`¿Poner la cama ${idCama} en Mantención?`)) return;
        const { error } = await supabase.from('v2_camas')
            .update({ estado: 'Mantencion' }).eq('id_cama', idCama);
        if (error) { setMsg('❌ ' + error.message, '#ef4444'); return; }
        setMsg('🔧 Cama en mantención', '#64748b');
        setTimeout(() => { cerrarPopover(); onSuccess?.('mantencion', idCama); }, 800);
    });

    if (!main) return; // Sin ocupante activo → resto de event listeners no aplica

    document.getElementById(ID + '-btn-confirmar-checkin')?.addEventListener('click', async () => {
        setMsg('Activando asignación…', '#6b7280');
        const { error } = await supabase.from('v2_asignaciones')
            .update({ estado_asignacion: 'activa', huesped_confirmo: true, fecha_checkin: hoy }).eq('id', main.id);
        if (error) { setMsg('❌ ' + error.message, '#ef4444'); return; }
        await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', idCama);
        setMsg('✅ Asignación activada — huésped en cama', '#10b981');
        setTimeout(() => { cerrarPopover(); onSuccess?.('checkin', idCama); }, 900);
    });

    document.getElementById(ID + '-btn-confirmar-llegada')?.addEventListener('click', async () => {
        setMsg('Confirmando llegada…', '#6b7280');
        const { error } = await supabase.from('v2_asignaciones')
            .update({ huesped_confirmo: true }).eq('id', main.id);
        if (error) { setMsg('❌ ' + error.message, '#ef4444'); return; }
        setMsg('✅ Llegada confirmada', '#10b981');
        setTimeout(() => { cerrarPopover(); onSuccess?.('confirmar', idCama); }, 800);
    });


    // ── Checkout (solo para activos, no pre-asignados)
    document.getElementById(ID + '-btn-checkout')?.addEventListener('click', async () => {
        setMsg('Registrando check-out…', '#6b7280');
        const { error } = await supabase.from('v2_asignaciones')
            .update({ fecha_checkout: hoy }).eq('id', main.id);
        if (error) { setMsg('❌ ' + error.message, '#ef4444'); return; }
        await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', idCama).neq('estado', 'Deshabilitada');
        setMsg('✅ Check-out registrado', '#10b981');
        setTimeout(() => { cerrarPopover(); onSuccess?.('checkout', idCama); }, 900);
    });

    document.getElementById(ID + '-btn-extender')?.addEventListener('click', () => {
        const panel = document.getElementById(ID + '-extender-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById(ID + '-btn-ext-confirmar')?.addEventListener('click', async () => {
        const nuevaFecha = document.getElementById(ID + '-ext-fecha')?.value;
        const extMsg = document.getElementById(ID + '-ext-msg');
        if (!nuevaFecha) { if (extMsg) { extMsg.textContent = '⚠️ Ingresa una fecha'; extMsg.style.color = '#d97706'; } return; }
        const { error } = await supabase.from('v2_asignaciones')
            .update({ fecha_salida_programada: nuevaFecha }).eq('id', main.id);
        if (error) { if (extMsg) { extMsg.textContent = '❌ ' + error.message; extMsg.style.color = '#ef4444'; } return; }
        if (extMsg) { extMsg.textContent = '✅ Estadía extendida al ' + nuevaFecha; extMsg.style.color = '#10b981'; }
        setTimeout(() => { cerrarPopover(); onSuccess?.('extender', idCama); }, 900);
    });

    document.getElementById(ID + '-btn-eliminar')?.addEventListener('click', () => {
        document.getElementById(ID + '-transfer-panel').style.display = 'none';
        const panel = document.getElementById(ID + '-delete-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById(ID + '-btn-cancelar-delete')?.addEventListener('click', () => {
        const panel = document.getElementById(ID + '-delete-panel');
        if (panel) panel.style.display = 'none';
    });
    document.getElementById(ID + '-btn-confirmar-delete')?.addEventListener('click', async () => {
        setMsg('Eliminando asignación…', '#6b7280');
        const { error } = await supabase.from('v2_asignaciones').delete().eq('id', main.id);
        if (error) { setMsg('❌ ' + error.message, '#ef4444'); return; }
        await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', idCama).neq('estado', 'Deshabilitada');
        setMsg('🗑️ Asignación eliminada', '#10b981');
        setTimeout(() => { cerrarPopover(); onSuccess?.('eliminar', idCama); }, 800);
    });

    document.getElementById(ID + '-btn-transferir').addEventListener('click', async () => {
        document.getElementById(ID + '-delete-panel').style.display = 'none';
        const panel = document.getElementById(ID + '-transfer-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') {
            setTimeout(() => document.getElementById(ID + '-tr-numhab')?.focus(), 100);
        }
        window._trBuscarHab = async (val) => {
            const num = val.trim();
            const res  = document.getElementById(ID + '-tr-resultado');
            const sel  = document.getElementById(ID + '-tr-cama');
            const btn  = document.getElementById(ID + '-btn-confirmar-transfer');
            sel.style.display = 'none';
            sel.innerHTML = '<option value="">— Cama libre —</option>';
            btn.disabled = true; btn.style.opacity = '.5';
            if (num.length < 2) { res.textContent = 'Escribe el número de habitación…'; return; }
            res.textContent = '🔍 Buscando…';

            // Fase 1: coincidencia EXACTA → prioriza R-220 ("420") sobre COPC ("2420","3420"…)
            let { data: habs } = await supabase.from('v2_habitaciones')
                .select('id_custom,numero_hab').eq('numero_hab', num).limit(5);

            // Fase 2: si no hay exacta, búsqueda parcial con límite generoso
            if (!habs?.length) {
                const { data: habsLike } = await supabase.from('v2_habitaciones')
                    .select('id_custom,numero_hab').ilike('numero_hab', `%${num}%`).limit(20);
                habs = habsLike;
            }

            if (!habs?.length) { res.textContent = `❌ No se encontró habitación "${num}"`; return; }
            const habIds = habs.map(h => h.id_custom);
            const { data: camas } = await supabase.from('v2_camas')
                .select('id_cama,habitacion_id').in('habitacion_id', habIds)
                .eq('estado', 'Disponible').neq('id_cama', idCama).order('id_cama');
            if (!camas?.length) { res.textContent = `⚠️ Hab. ${num} encontrada pero sin camas libres`; return; }
            const habNums = {};
            for (const h of habs) habNums[h.id_custom] = h.numero_hab;
            res.textContent = `✅ ${camas.length} cama(s) disponible(s) en hab. ${habs.map(h=>h.numero_hab).join(', ')}`;
            sel.innerHTML = '<option value="">— Elige cama —</option>' +
                camas.map(c => `<option value="${c.id_cama}">🛏 ${c.id_cama} · Hab.${habNums[c.habitacion_id]||''}</option>`).join('');
            sel.style.display = 'block';
            sel.onchange = () => { const ok = !!sel.value; btn.disabled = !ok; btn.style.opacity = ok ? '1' : '.5'; };
        };
        document.getElementById(ID + '-btn-confirmar-transfer').addEventListener('click', async () => {
            const newCama = document.getElementById(ID + '-tr-cama').value;
            if (!newCama) return;
            setMsg('Transfiriendo…', '#6b7280');
            const { error: errMove } = await supabase.from('v2_asignaciones')
                .update({ id_cama: newCama }).eq('id', main.id);
            if (errMove) { setMsg('❌ ' + errMove.message, '#ef4444'); return; }
            await supabase.from('v2_camas').update({ estado: 'Disponible' }).eq('id_cama', idCama).neq('estado', 'Deshabilitada');
            await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', newCama);
            // Limpiar pre_asignados duplicados del mismo RUT que quedaron de la asignación anterior
            if (main.rut_huesped) {
                await supabase.from('v2_asignaciones')
                    .delete()
                    .eq('rut_huesped', main.rut_huesped)
                    .eq('estado_asignacion', 'pre_asignado')
                    .is('fecha_checkout', null)
                    .neq('id', main.id);
            }
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

        <!-- Botón Mantención: solo si el supervisor puede usarlo -->
        <button id="${ID}-btn-mant"
          style="width:100%;background:transparent;border:1.5px solid #64748b;color:#64748b;border-radius:12px;padding:10px;font-size:13px;font-weight:600;cursor:pointer;margin-top:6px">
          🔧 Poner en Mantención
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

    // ── Poner en Mantención ──────────────────────────────────────────────────
    document.getElementById(ID + '-btn-mant')?.addEventListener('click', async () => {
        if (!confirm(`¿Poner la cama ${idCama} en Mantención?`)) return;
        const { error } = await supabase.from('v2_camas')
            .update({ estado: 'Mantencion' }).eq('id_cama', idCama);
        if (error) { setMsg('❌ ' + error.message, '#ef4444'); return; }
        setMsg('🔧 Cama en mantención', '#64748b');
        setTimeout(() => { cerrarPopover(); onSuccess?.('mantencion', idCama); }, 800);
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

        // ── Verificar si ya existe una asignación activa para esta cama ──────
        // (puede haber sido creada por el SQL fix o el motor automático)
        const { data: asigExistente } = await supabase
            .from('v2_asignaciones')
            .select('id, rut_huesped, estado_asignacion')
            .eq('id_cama', idCama)
            .is('fecha_checkout', null)
            .limit(1)
            .maybeSingle();

        let err = null;

        if (asigExistente) {
            // ── Caso A: Ya existe asignación → UPDATE (confirmar check-in) ────
            setMsg('Confirmando asignación existente…', '#6b7280');
            const { error: errUpd } = await supabase
                .from('v2_asignaciones')
                .update({
                    empresa_id:              empId,
                    rut_huesped:             rut,
                    nombre_huesped:          nombre,
                    fecha_checkin:           llegada,
                    fecha_salida_programada: salida   || null,
                    numero_contrato:         contrato || null,
                    telefono:                tel      || null,
                    estado_asignacion:       'activa',
                    huesped_confirmo:        true,
                })
                .eq('id', asigExistente.id);
            err = errUpd;
            // Asegurar cama como Ocupada
            if (!errUpd) {
                await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', idCama);
            }
        } else {
            // ── Caso B: No existe asignación → INSERT normal ────────────────
            const { error: errIns } = await supabase
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
                    estado_asignacion:       'activa',
                    huesped_confirmo:        true,
                }]);
            err = errIns;
            if (!errIns) {
                await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', idCama);
            }
        }

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

// ════════════════════════════════════════════════════════════════════════════
//  MANTENCION VIEW
// ════════════════════════════════════════════════════════════════════════════
function renderMantencion(pop, idCama, onSuccess) {
    const body = document.getElementById(ID + '-body');
    body.innerHTML = `
      <div style="text-align:center;padding:8px 0 16px">
        <div style="width:56px;height:56px;border-radius:16px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px">🔧</div>
        <div style="font-size:15px;font-weight:800;color:#334155;margin-bottom:4px">Cama en Mantención</div>
        <div style="font-size:12px;color:#64748b">${idCama}</div>
      </div>

      <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:16px;font-size:13px;color:#475569;text-align:center">
        Esta cama no está disponible para check-in.<br>
        <span style="font-size:11px;color:#94a3b8">Quítala de mantención para habilitarla.</span>
      </div>

      <div id="${ID}-msg" style="min-height:16px;font-size:13px;font-weight:600;margin-bottom:8px"></div>

      <button id="${ID}-btn-quitar-mant"
        style="width:100%;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer">
        ✅ Quitar Mantención — Dejar Disponible
      </button>`;

    document.getElementById(ID + '-btn-quitar-mant').addEventListener('click', async () => {
        const btn = document.getElementById(ID + '-btn-quitar-mant');
        btn.textContent = '⏳ Actualizando…';
        btn.disabled = true;
        const { error } = await supabase.from('v2_camas')
            .update({ estado: 'Disponible' }).eq('id_cama', idCama).neq('estado', 'Deshabilitada');
        if (error) {
            const msg = document.getElementById(ID + '-msg');
            if (msg) { msg.textContent = '❌ ' + error.message; msg.style.color = '#ef4444'; }
            btn.textContent = '✅ Quitar Mantención — Dejar Disponible';
            btn.disabled = false;
            return;
        }
        const msg = document.getElementById(ID + '-msg');
        if (msg) { msg.textContent = '✅ Cama disponible'; msg.style.color = '#10b981'; }
        setTimeout(() => { cerrarPopover(); onSuccess?.('disponible', idCama); }, 800);
    });
}

