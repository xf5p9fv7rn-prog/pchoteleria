/**
 * v2-camas-perdidas.js — Módulo Camas Perdidas (Rediseño v2)
 *
 * MODOS:
 *   · Invitado / Recepcionista → Solo lectura
 *   · Lavandería / Supervisor  → Edición de motivos
 *
 * TIPOS DE PÉRDIDA:
 *   · BLOQUEADA       → hab en mantención O empresa contiene "bloqueada/bloqueado"
 *   · OCUPACION PARCIAL → 2+ camas, 0 < ocupadas < total
 *
 * LÓGICA: Solo aparecen habitaciones con ≥1 cama perdida.
 */
import { supabase } from '../../supabaseClient.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const MOTIVOS = {
    sin_motivo:        { label: '— Sin motivo registrado', color: '#94a3b8', emoji: '⬜' },
    acuerdo_anglo:     { label: '📄 Acuerdo Anglo',         color: '#6366f1', emoji: '📄' },
    impar_mujer:       { label: '♀️ Impar mujer',           color: '#ec4899', emoji: '♀️' },
    impar_hombre:      { label: '♂️ Impar hombre',          color: '#3b82f6', emoji: '♂️' },
    motivos_medicos:   { label: '🏥 Motivos médicos',       color: '#f59e0b', emoji: '🏥' },
    motivos_personales:{ label: '👤 Motivos personales',    color: '#8b5cf6', emoji: '👤' },
    mantencion:        { label: '🔧 Mantenimiento',          color: '#ef4444', emoji: '🔧' },
    otros:             { label: '✏️ Otros (especificar)',    color: '#64748b', emoji: '✏️' },
};

// ── Estado global del módulo ──────────────────────────────────────────────────
let _perdidas   = [];   // [{habitacion_id, numero_hab, nivel, pabellon, edificio, empresa, tipo, total_camas, ocupadas, camas_perdidas, huesped, id_cama_perdida}]
let _registros  = {};   // { id_cama_perdida: registro_motivo }
let _canEdit    = false;
let _filtroEmp  = 'todos';
let _expandidos = new Set();
let _container  = null;

// ── Helpers de rol ─────────────────────────────────────────────────────────────
function getRoleMode() {
    const role = window._currentUser?.role || 'invitado';
    _canEdit = ['supervisor', 'superadmin', 'lavanderia'].includes(role);
    return _canEdit ? 'lavanderia' : 'invitado';
}

// ── Paginador universal ───────────────────────────────────────────────────────
async function fetchAll(tabla, select, filtro = null) {
    let all = [], page = 0;
    while (true) {
        let q = supabase.from(tabla).select(select).range(page * 1000, page * 1000 + 999);
        if (filtro) q = filtro(q);
        const { data, error } = await q;
        if (error) throw error;
        if (data?.length) all = all.concat(data);
        if (!data || data.length < 1000) break;
        if (++page > 20) break;
    }
    return all;
}

// ── Carga motivos guardados ───────────────────────────────────────────────────
async function cargarRegistros() {
    const { data } = await supabase.from('v2_camas_perdidas').select('*');
    _registros = {};
    (data || []).forEach(r => { _registros[r.id_cama_perdida] = r; });
}

// ── Detectar camas perdidas (lógica completa) ─────────────────────────────────
async function detectarCamasPerdidas() {
    _perdidas = [];

    // Cargar datos base en paralelo
    const [camas, habs, asigs, pabsRes, edifsRes, empresasRes] = await Promise.all([
        fetchAll('v2_camas',       'id_cama, habitacion_id, estado'),
        fetchAll('v2_habitaciones','id_custom, numero_hab, nivel, pabellon_id, en_mantencion'),
        fetchAll('v2_asignaciones','id_cama, nombre_huesped, empresa_id',
                 q => q.is('fecha_checkout', null).in('estado', ['activo', 'pre_asignado'])),
        supabase.from('v2_pabellones').select('id, nombre, edificio_id').limit(500),
        supabase.from('v2_edificios').select('id, nombre').limit(50),
        supabase.from('v2_empresas').select('id, nombre').limit(500),
    ]);

    const pabs    = pabsRes.data    || [];
    const edifs   = edifsRes.data   || [];
    const empresas = empresasRes.data || [];

    // Mapas de lookup
    const habMap   = Object.fromEntries((habs     || []).map(h => [h.id_custom,   h]));
    const pabMap   = Object.fromEntries((pabs     || []).map(p => [p.id,          p]));
    const edifMap  = Object.fromEntries((edifs    || []).map(e => [e.id,          e]));
    const empMap   = Object.fromEntries((empresas || []).map(e => [e.id,          e]));
    const asigMap  = {};
    (asigs || []).forEach(a => { asigMap[a.id_cama] = a; });

    // Agrupar camas por habitación (excluir Deshabilitadas)
    const porHab = {};
    (camas || [])
        .filter(c => c.estado !== 'Deshabilitada')
        .forEach(c => {
            if (!porHab[c.habitacion_id]) porHab[c.habitacion_id] = [];
            porHab[c.habitacion_id].push(c);
        });

    // Evaluar cada habitación
    Object.entries(porHab).forEach(([habId, cs]) => {
        const hab  = habMap[habId] || {};
        const pab  = pabMap[hab.pabellon_id] || {};
        const edif = edifMap[pab.edificio_id] || {};

        // Regla 2: debe tener número y pabellón
        if (!hab.numero_hab || !pab.nombre) return;
        // Regla 2: al menos 1 cama (ya garantizado por el grupo)
        const nTotal = cs.length;
        if (nTotal === 0) return;

        // Camas con asignación activa
        const camasOcup  = cs.filter(c => c.estado === 'Ocupada' || !!asigMap[c.id_cama]);
        const nOcupadas  = camasOcup.length;

        // Empresa de referencia (primera cama ocupada)
        const asigRef    = camasOcup[0] ? (asigMap[camasOcup[0].id_cama] || null) : null;
        const empresaNombre = asigRef ? (empMap[asigRef.empresa_id]?.nombre || '') : '';
        const huesped    = asigRef?.nombre_huesped || '—';

        // ────────────────────────────────────────────────────────────
        // REGLA 3: Prioridad máxima — BLOQUEADA
        // Caso A: empresa contiene "bloqueada" o "bloqueado"
        // Caso B: habitación en mantención (en_mantencion = true)
        // ────────────────────────────────────────────────────────────
        const esBloqueoEmpresa = ['bloqueada', 'bloqueado'].some(w =>
            empresaNombre.toLowerCase().includes(w)
        );
        const esMantencion = hab.en_mantencion === true;

        if (esBloqueoEmpresa || esMantencion) {
            // Pierde TODAS las camas
            // Usamos id_cama de la primera cama como identificador del registro
            const idReg = cs[0]?.id_cama || habId;
            _perdidas.push({
                id_cama_perdida: idReg,
                habitacion_id:   habId,
                numero_hab:      hab.numero_hab,
                nivel:           hab.nivel   || '—',
                pabellon:        pab.nombre  || '—',
                edificio:        edif.nombre || '—',
                empresa:         esMantencion ? 'MANTENCION' : empresaNombre,
                tipo:            'BLOQUEADA',
                huesped:         esMantencion ? '—' : huesped,
                total_camas:     nTotal,
                ocupadas:        nOcupadas,
                camas_perdidas:  nTotal,
            });
            return;
        }

        // ────────────────────────────────────────────────────────────
        // REGLA 4: OCUPACION PARCIAL
        // Necesita: 2+ camas, 0 < ocupadas < total
        // Regla 5: habitaciones de 1 sola cama NO cuentan
        // ────────────────────────────────────────────────────────────
        if (nTotal < 2) return;            // regla 5: cama única no aplica
        if (nOcupadas === 0) return;       // regla 5: vacía no aplica
        if (nOcupadas >= nTotal) return;   // regla 5: llena no aplica

        const camasLibres = nTotal - nOcupadas;

        // Usar la primera cama libre como id del registro
        const camaLibre = cs.find(c => c.estado !== 'Ocupada' && !asigMap[c.id_cama]);
        const idReg = camaLibre?.id_cama || habId;

        _perdidas.push({
            id_cama_perdida: idReg,
            habitacion_id:   habId,
            numero_hab:      hab.numero_hab,
            nivel:           hab.nivel   || '—',
            pabellon:        pab.nombre  || '—',
            edificio:        edif.nombre || '—',
            empresa:         empresaNombre,
            tipo:            'OCUPACION PARCIAL',
            huesped,
            total_camas:     nTotal,
            ocupadas:        nOcupadas,
            camas_perdidas:  camasLibres,
        });
    });

    console.log(`[CamasPerdidas] Detectadas: ${_perdidas.length} habitaciones con camas perdidas`);
}

// ── Guardar motivo ────────────────────────────────────────────────────────────
async function guardarMotivo(idCama, habitacionId, motivo, motivoTexto, empresa) {
    if (!_canEdit) return;
    const isAnglo = ['anglo', 'angloamerican', 'anglo american'].some(k =>
        (empresa || '').toLowerCase().includes(k));
    await supabase.from('v2_camas_perdidas').upsert([{
        id_cama_perdida: idCama,
        habitacion_id:   habitacionId,
        motivo,
        motivo_texto:    motivo === 'otros' ? motivoTexto : null,
        empresa_nombre:  empresa || null,
        es_anglo:        isAnglo,
        registrado_por:  window._currentUser?.username || 'lavanderia',
        updated_at:      new Date().toISOString(),
    }], { onConflict: 'id_cama_perdida' });
    _registros[idCama] = { id_cama_perdida: idCama, motivo, motivo_texto: motivoTexto, empresa_nombre: empresa, es_anglo: isAnglo };
}

async function eliminarMotivo(idCama) {
    if (!_canEdit) return;
    await supabase.from('v2_camas_perdidas').delete().eq('id_cama_perdida', idCama);
    delete _registros[idCama];
}

// ── Agrupación por empresa ────────────────────────────────────────────────────
function agruparPorEmpresa(rows) {
    const grupos = {};
    rows.forEach(p => {
        const key = p.empresa || 'Sin empresa';
        if (!grupos[key]) grupos[key] = { empresa: key, items: [], totalPerdidas: 0 };
        grupos[key].items.push(p);
        grupos[key].totalPerdidas += (p.camas_perdidas ?? 1);
    });
    // Ordenar por total perdidas descendente
    return Object.values(grupos).sort((a, b) => b.totalPerdidas - a.totalPerdidas);
}

// ── Render tarjeta individual de habitación ────────────────────────────────────
function cardHab(p) {
    const reg    = _registros[p.id_cama_perdida];
    const motivo = reg?.motivo || 'sin_motivo';
    const mObj   = MOTIVOS[motivo] || MOTIVOS.sin_motivo;
    const texto  = reg?.motivo_texto || '';

    const esBloq = p.tipo === 'BLOQUEADA';
    const borderColor = esBloq ? '#fca5a5' : '#fde68a';
    const tagBloq = esBloq
        ? `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800">🔒 BLOQUEADA</span>`
        : `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800">🟡 PARCIAL ${p.ocupadas}/${p.total_camas}</span>`;

    // Motivo mostrado en modo lectura
    const motivoReadonly = `
        <div style="display:flex;align-items:center;gap:6px;background:var(--bg-page);border:1.5px solid ${mObj.color};
             border-radius:10px;padding:8px 12px">
            <span style="font-size:16px">${mObj.emoji}</span>
            <span style="font-size:12px;font-weight:700;color:${mObj.color}">${mObj.label}</span>
            ${texto ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px">· ${texto}</span>` : ''}
        </div>`;

    // Motivo editable
    const motivoEdit = `
        <select id="sel-${p.id_cama_perdida}"
          onchange="window._cpMotivo('${p.id_cama_perdida}',this.value)"
          style="width:100%;padding:8px 10px;border:1.5px solid ${mObj.color};border-radius:10px;
                 font-size:12px;font-weight:700;color:${mObj.color};background:var(--bg-card);outline:none;cursor:pointer">
          ${Object.entries(MOTIVOS).map(([k, v]) =>
            `<option value="${k}" ${motivo === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        <input id="txt-${p.id_cama_perdida}" type="text" value="${texto}"
          placeholder="Especifica el motivo…"
          style="width:100%;margin-top:6px;padding:6px 10px;border:1.5px solid var(--border);
                 border-radius:8px;font-size:12px;background:var(--bg-card);color:var(--text-primary);
                 outline:none;display:${motivo === 'otros' ? 'block' : 'none'};box-sizing:border-box">
        <div style="display:flex;gap:6px;margin-top:6px">
          <button onclick="window._cpGuardar('${p.id_cama_perdida}','${p.habitacion_id}','${(p.empresa||'').replace(/'/g,"\\'")}')"
            style="flex:1;padding:8px;border:none;border-radius:10px;background:#6366f1;color:white;
                   font-weight:700;font-size:12px;cursor:pointer">💾 Guardar</button>
          ${reg ? `<button onclick="window._cpEliminar('${p.id_cama_perdida}')"
            style="padding:8px 12px;border:1.5px solid #ef4444;border-radius:10px;background:transparent;
                   color:#ef4444;font-weight:700;font-size:12px;cursor:pointer">🗑</button>` : ''}
        </div>`;

    return `
    <div id="row-${p.id_cama_perdida}"
      style="background:var(--bg-card);border:1px solid ${borderColor};border-radius:12px;
             padding:14px;margin-bottom:8px">
      <!-- Fila 1: Habitación + tipo -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <div style="background:linear-gradient(135deg,#ef4444,#dc2626);border-radius:10px;
                    width:42px;height:42px;display:flex;align-items:center;justify-content:center;
                    font-size:20px;flex-shrink:0">🛏️</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:18px;color:var(--text-primary)">Hab. ${p.numero_hab}</div>
          <div style="font-size:11px;color:var(--text-muted)">${p.edificio} · ${p.pabellon} · ${p.nivel}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${tagBloq}
          <div style="margin-top:4px;font-size:11px;font-weight:800;color:#ef4444">
            ${p.camas_perdidas} cama${p.camas_perdidas>1?'s':''} perdida${p.camas_perdidas>1?'s':''}
          </div>
        </div>
      </div>
      <!-- Fila 2: Ocupante -->
      <div style="display:flex;gap:8px;align-items:center;padding:8px 10px;
                  background:var(--bg-page);border-radius:8px;margin-bottom:10px">
        <span style="font-size:14px">👤</span>
        <div>
          <div style="font-size:12px;color:var(--text-muted);font-weight:600">Ocupante</div>
          <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${p.huesped}</div>
        </div>
      </div>
      <!-- Fila 3: Motivo -->
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
                    margin-bottom:5px">Motivo de la cama perdida</div>
        ${_canEdit ? motivoEdit : motivoReadonly}
      </div>
    </div>`;
}

// ── Render por empresa (accordion) ────────────────────────────────────────────
function renderEmpresas(filtro = 'todos') {
    const lista = document.getElementById('cp-lista');
    if (!lista) return;

    let rows = _perdidas;
    if (filtro !== 'todos') rows = rows.filter(p => p.empresa === filtro);

    if (!rows.length) {
        lista.innerHTML = `
        <div style="text-align:center;padding:60px 24px;color:var(--text-muted)">
            <div style="font-size:48px;margin-bottom:12px">✅</div>
            <div style="font-size:16px;font-weight:700">Sin camas perdidas detectadas</div>
            <div style="font-size:13px;margin-top:4px">Todas las habitaciones están correctamente ocupadas</div>
        </div>`;
        return;
    }

    const grupos = agruparPorEmpresa(rows);
    lista.innerHTML = grupos.map(g => {
        const expanded = _expandidos.has(g.empresa);
        const safeId   = 'emp-' + g.empresa.replace(/[^a-zA-Z0-9]/g, '_');
        const bloqCount = g.items.filter(p => p.tipo === 'BLOQUEADA').length;
        const parcCount = g.items.filter(p => p.tipo === 'OCUPACION PARCIAL').length;

        return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;
                    overflow:hidden;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
          <!-- Header de empresa -->
          <div onclick="window._cpToggleEmp('${g.empresa.replace(/'/g, "\\'")}')"
            style="padding:16px 18px;display:flex;align-items:center;gap:12px;
                   cursor:pointer;border-left:4px solid #ef4444;transition:background 0.15s"
            onmouseover="this.style.background='rgba(239,68,68,0.04)'"
            onmouseout="this.style.background='transparent'">
            <!-- Logo empresa o inicial -->
            <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#ef4444,#b91c1c);
                        display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;
                        color:white;flex-shrink:0;text-transform:uppercase">
              ${g.empresa.charAt(0)}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:800;font-size:15px;color:var(--text-primary);
                          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${g.empresa}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
                <span style="font-size:11px;font-weight:700;color:#ef4444;background:#fee2e2;
                             padding:2px 8px;border-radius:99px">
                  🛏️ ${g.totalPerdidas} perdida${g.totalPerdidas>1?'s':''}
                </span>
                ${bloqCount > 0 ? `<span style="font-size:11px;font-weight:700;color:#b91c1c;background:#fecaca;
                  padding:2px 8px;border-radius:99px">🔒 ${bloqCount} bloq.</span>` : ''}
                ${parcCount > 0 ? `<span style="font-size:11px;font-weight:700;color:#92400e;background:#fef3c7;
                  padding:2px 8px;border-radius:99px">🟡 ${parcCount} parc.</span>` : ''}
              </div>
            </div>
            <div style="font-size:20px;transition:transform 0.25s;color:#94a3b8;
                        transform:rotate(${expanded ? '90' : '0'}deg);flex-shrink:0">›</div>
          </div>
          <!-- Cuerpo expandible -->
          <div id="${safeId}" style="padding:${expanded ? '12px 12px 16px' : '0'};
               display:${expanded ? 'block' : 'none'}">
            ${expanded ? g.items.map(p => cardHab(p)).join('') : ''}
          </div>
        </div>`;
    }).join('');
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
function renderKpis() {
    const el = document.getElementById('cp-kpis');
    if (!el) return;

    const total     = _perdidas.reduce((s, p) => s + (p.camas_perdidas ?? 1), 0);
    const bloqHabs  = _perdidas.filter(p => p.tipo === 'BLOQUEADA').length;
    const parcHabs  = _perdidas.filter(p => p.tipo === 'OCUPACION PARCIAL').length;
    const conMotivo = _perdidas.filter(p =>
        _registros[p.id_cama_perdida]?.motivo &&
        _registros[p.id_cama_perdida]?.motivo !== 'sin_motivo').length;

    const kpi = (icon, label, val, color) => `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
                padding:16px;border-top:3px solid ${color};text-align:center">
      <div style="font-size:20px;margin-bottom:4px">${icon}</div>
      <div style="font-size:28px;font-weight:900;color:${color};line-height:1">${val}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;
                  letter-spacing:.4px;margin-top:4px">${label}</div>
    </div>`;

    el.innerHTML = [
        kpi('🛏️', 'Total Perdidas', total,    '#ef4444'),
        kpi('🔒', 'Bloqueadas',     bloqHabs, '#b91c1c'),
        kpi('🟡', 'Parc. Ocupadas', parcHabs, '#f59e0b'),
        kpi('📋', 'Con Motivo',     conMotivo,'#10b981'),
    ].join('');
}

// ── Filtro por empresa ────────────────────────────────────────────────────────
function buildFiltroEmpresas() {
    const bar = document.getElementById('cp-filtro-bar');
    if (!bar) return;

    // Empresas únicas ordenadas por total
    const grupos = agruparPorEmpresa(_perdidas);
    const opciones = [
        `<button onclick="window._cpSetEmpresa('todos')"
          id="cf-todos"
          style="padding:8px 16px;border-radius:10px;border:2px solid #6366f1;background:#6366f1;
                 color:#fff;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">
          📊 Todas (${_perdidas.length})
        </button>`,
        ...grupos.map(g => `
        <button onclick="window._cpSetEmpresa('${g.empresa.replace(/'/g, "\\'")}')"
          id="cf-${g.empresa.replace(/[^a-zA-Z0-9]/g,'_')}"
          style="padding:8px 16px;border-radius:10px;border:2px solid var(--border);
                 background:var(--bg-card);color:var(--text-primary);font-weight:700;
                 font-size:12px;cursor:pointer;white-space:nowrap">
          ${g.empresa.split(' ')[0]} (${g.totalPerdidas})
        </button>`)
    ];
    bar.innerHTML = opciones.join('');
}

// ── Render principal ──────────────────────────────────────────────────────────
export async function renderV2CamasPerdidas(container) {
    _container = container;
    const mode = getRoleMode();
    const modeBg    = mode === 'lavanderia' ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : 'linear-gradient(135deg,#64748b,#475569)';
    const modeLabel = mode === 'lavanderia' ? '🔧 MODO LAVANDERÍA — Edición activa' : '👁️ MODO INVITADO — Solo lectura';
    const modeColor = mode === 'lavanderia' ? '#e0e7ff' : '#f1f5f9';
    const modeText  = mode === 'lavanderia' ? '#3730a3' : '#334155';

    container.innerHTML = `
    <div style="min-height:100%;background:var(--bg-page)">

      <!-- ═══ HEADER MOBILE-FIRST ═══ -->
      <div style="background:linear-gradient(135deg,#ef4444 0%,#b91c1c 100%);
                  padding:env(safe-area-inset-top,12px) 16px 20px;position:relative;overflow:hidden">
        <!-- Fondo decorativo -->
        <div style="position:absolute;width:200px;height:200px;border-radius:50%;
                    background:rgba(255,255,255,0.06);top:-80px;right:-60px"></div>
        <div style="position:absolute;width:120px;height:120px;border-radius:50%;
                    background:rgba(255,255,255,0.05);bottom:-40px;left:-20px"></div>

        <!-- Logos + botón volver -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:20px;position:relative">
          <!-- Logo Aramark (izquierda) -->
          <img src="aramark.png" alt="Aramark"
            style="height:32px;object-fit:contain;filter:brightness(0) invert(1);opacity:0.9">
          <!-- Botón volver (centro-izquierda) -->
          <button onclick="window.navigate('v2dashboard')"
            style="position:absolute;left:50%;transform:translateX(-50%);
                   background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.3);
                   border-radius:10px;padding:7px 14px;color:white;font-size:13px;font-weight:700;
                   cursor:pointer;backdrop-filter:blur(4px);display:flex;align-items:center;gap:6px">
            ‹ Volver
          </button>
          <!-- Logo Anglo (derecha) -->
          <img src="anglo.png" alt="Anglo American"
            style="height:32px;object-fit:contain;filter:brightness(0) invert(1);opacity:0.8">
        </div>

        <!-- Título -->
        <div style="position:relative;text-align:center">
          <div style="font-size:32px;margin-bottom:6px">🛏️</div>
          <h1 style="font-size:22px;font-weight:900;color:white;margin:0;letter-spacing:-0.5px">
            Camas Perdidas
          </h1>
          <p style="font-size:12px;color:rgba(255,255,255,0.75);margin:4px 0 0">
            Ineficiencia de ocupación · ${new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})}
          </p>
        </div>
      </div>

      <!-- ═══ BADGE DE MODO ═══ -->
      <div style="margin:12px 16px 0;background:${modeColor};border:1.5px solid;
                  border-color:${mode==='lavanderia'?'#c7d2fe':'#e2e8f0'};
                  border-radius:12px;padding:10px 14px;
                  display:flex;align-items:center;gap:8px">
        <div style="width:8px;height:8px;border-radius:50%;
                    background:${mode==='lavanderia'?'#6366f1':'#64748b'}"></div>
        <span style="font-size:12px;font-weight:800;color:${modeText}">${modeLabel}</span>
        ${mode === 'invitado' ? `
        <span style="font-size:11px;color:${modeText};opacity:0.7;margin-left:2px">
          · Contacte a Lavandería para editar motivos
        </span>` : ''}
      </div>

      <!-- ═══ KPIs ═══ -->
      <div id="cp-kpis"
        style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:12px 16px">
        ${[1,2,3,4].map(()=>`
        <div style="height:80px;background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);
                    background-size:400% 100%;animation:_cpShimmer 1.2s ease infinite;border-radius:14px"></div>`).join('')}
      </div>

      <!-- ═══ BOTONES DE EMPRESA (scrollable) ═══ -->
      <div style="padding:0 16px 8px">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);
                    text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
          Filtrar por empresa
        </div>
        <div id="cp-filtro-bar"
          style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;
                 scrollbar-width:none;-webkit-overflow-scrolling:touch">
          <div style="height:38px;width:120px;background:var(--border);border-radius:10px;
                      animation:_cpShimmer 1.2s ease infinite;flex-shrink:0"></div>
          <div style="height:38px;width:100px;background:var(--border);border-radius:10px;
                      animation:_cpShimmer 1.2s ease infinite;flex-shrink:0"></div>
          <div style="height:38px;width:100px;background:var(--border);border-radius:10px;
                      animation:_cpShimmer 1.2s ease infinite;flex-shrink:0"></div>
        </div>
      </div>

      <!-- ═══ LISTA POR EMPRESA ═══ -->
      <div id="cp-lista" style="padding:4px 16px 100px">
        <div style="text-align:center;padding:60px;color:var(--text-muted)">
          ⏳ Analizando habitaciones...
        </div>
      </div>

    </div>
    <style>
      @keyframes _cpShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
      #cp-filtro-bar::-webkit-scrollbar{display:none}
    </style>`;

    // ── Cargar datos ──
    try {
        await Promise.all([detectarCamasPerdidas(), cargarRegistros()]);
        renderKpis();
        buildFiltroEmpresas();
        renderEmpresas(_filtroEmp);
    } catch (e) {
        document.getElementById('cp-lista').innerHTML =
            `<div style="color:#ef4444;text-align:center;padding:40px;font-size:14px">
              ❌ Error al cargar datos<br>
              <span style="font-size:12px;color:var(--text-muted)">${e.message}</span>
             </div>`;
        console.error('[CamasPerdidas]', e);
    }

    // ── Globales ──────────────────────────────────────────────────────────────
    window._cpToggleEmp = (empresa) => {
        if (_expandidos.has(empresa)) _expandidos.delete(empresa);
        else _expandidos.add(empresa);
        renderEmpresas(_filtroEmp);
    };

    window._cpSetEmpresa = (empresa) => {
        _filtroEmp = empresa;
        _expandidos.clear();
        // Actualizar estilos de botones
        document.querySelectorAll('#cp-filtro-bar button').forEach(btn => {
            btn.style.background  = 'var(--bg-card)';
            btn.style.color       = 'var(--text-primary)';
            btn.style.borderColor = 'var(--border)';
        });
        const btnId = empresa === 'todos'
            ? 'cf-todos'
            : 'cf-' + empresa.replace(/[^a-zA-Z0-9]/g, '_');
        const activeBtn = document.getElementById(btnId);
        if (activeBtn) {
            activeBtn.style.background  = '#6366f1';
            activeBtn.style.color       = '#fff';
            activeBtn.style.borderColor = '#6366f1';
        }
        renderEmpresas(empresa);
    };

    window._cpMotivo = (idCama, nuevoMotivo) => {
        const txtEl = document.getElementById(`txt-${idCama}`);
        if (txtEl) txtEl.style.display = nuevoMotivo === 'otros' ? 'block' : 'none';
        const selEl = document.getElementById(`sel-${idCama}`);
        if (selEl) {
            const c = MOTIVOS[nuevoMotivo]?.color || '#94a3b8';
            selEl.style.borderColor = c;
            selEl.style.color = c;
        }
    };

    window._cpGuardar = async (idCama, habId, empresa) => {
        if (!_canEdit) return;
        const sel   = document.getElementById(`sel-${idCama}`);
        const txt   = document.getElementById(`txt-${idCama}`);
        const motivo = sel?.value || 'sin_motivo';
        const texto  = txt?.value || '';
        await guardarMotivo(idCama, habId, motivo, texto, empresa);
        // Feedback visual
        const row = document.getElementById(`row-${idCama}`);
        if (row) {
            row.style.transition  = 'border-color 0.3s';
            row.style.borderColor = '#10b981';
            setTimeout(() => { row.style.borderColor = ''; }, 1500);
        }
        renderKpis();
        // Re-render esa empresa para actualizar el botón Limpiar
        renderEmpresas(_filtroEmp);
    };

    window._cpEliminar = async (idCama) => {
        if (!_canEdit) return;
        await eliminarMotivo(idCama);
        renderKpis();
        renderEmpresas(_filtroEmp);
    };

    window._cpRecargar = async () => {
        _expandidos.clear();
        _filtroEmp = 'todos';
        renderV2CamasPerdidas(container);
    };
}
