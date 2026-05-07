/**
 * v2-camas-perdidas.js — Módulo de Camas Perdidas
 *
 * "Cama perdida" = habitación con 2 camas donde 1 está Ocupada y la otra Disponible.
 * Permite registrar el MOTIVO de por qué esa cama no está siendo utilizada.
 * KPIs: Total global | Anglo/AngloAmerican | Otras empresas
 */
import { supabase } from '../../supabaseClient.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const MOTIVOS = {
    sin_motivo:        { label: '— Sin motivo registrado', color: '#94a3b8' },
    acuerdo_anglo:     { label: '📄 Acuerdo Anglo',         color: '#6366f1' },
    impar_mujer:       { label: '♀️ Impar mujer',           color: '#ec4899' },
    impar_hombre:      { label: '♂️ Impar hombre',          color: '#3b82f6' },
    motivos_medicos:   { label: '🏥 Motivos médicos',       color: '#f59e0b' },
    motivos_personales:{ label: '👤 Motivos personales',    color: '#8b5cf6' },
    otros:             { label: '✏️ Otros (especificar)',    color: '#64748b' },
};

const ANGLO_KEYWORDS = ['anglo', 'angloamerican', 'anglo american'];
const isAnglo = (nombre = '') =>
    ANGLO_KEYWORDS.some(k => nombre.toLowerCase().includes(k));

// ── Estado ────────────────────────────────────────────────────────────────────
let _registros = {}; // { id_cama_perdida: registro }
let _perdidas  = []; // lista de camas perdidas detectadas

// ── Helpers ───────────────────────────────────────────────────────────────────
async function cargarRegistros() {
    const { data } = await supabase.from('v2_camas_perdidas').select('*');
    _registros = {};
    (data || []).forEach(r => { _registros[r.id_cama_perdida] = r; });
}

async function guardarMotivo(idCama, habitacionId, motivo, motivoTexto, empresaNombre) {
    const anglo = isAnglo(empresaNombre);
    await supabase.from('v2_camas_perdidas').upsert([{
        id_cama_perdida: idCama,
        habitacion_id:   habitacionId,
        motivo,
        motivo_texto:    motivo === 'otros' ? motivoTexto : null,
        empresa_nombre:  empresaNombre || null,
        es_anglo:        anglo,
        registrado_por:  window._currentUser?.username || 'staff',
        updated_at:      new Date().toISOString(),
    }], { onConflict: 'id_cama_perdida' });
    _registros[idCama] = { id_cama_perdida: idCama, motivo, motivo_texto: motivoTexto, empresa_nombre: empresaNombre, es_anglo: anglo };
}

async function eliminarMotivo(idCama) {
    await supabase.from('v2_camas_perdidas').delete().eq('id_cama_perdida', idCama);
    delete _registros[idCama];
}

// ── Helper: paginar tabla completa ────────────────────────────────────────────
async function _cpFetchAll(tabla, select, filtro = null) {
    let all = [], page = 0;
    while (true) {
        let q = supabase.from(tabla).select(select).range(page * 1000, page * 1000 + 999);
        if (filtro) q = filtro(q);
        const { data, error } = await q;
        if (error) throw error;
        if (data?.length) all = all.concat(data);
        if (!data || data.length < 1000) break;
        page++;
        if (page > 20) break; // safety cap 20.000 filas
    }
    return all;
}

// ── Detectar camas perdidas: vista SQL si existe, si no → JS paginado ────────
async function detectarCamasPerdidas() {
    // Intentar primero con la vista SQL unificada (requiere ejecutar create_view_camas_perdidas.sql)
    try {
        const { data: viewData, error: viewErr } = await supabase
            .from('v2_camas_perdidas_view')
            .select('habitacion_id, numero_hab, nivel, pabellon, edificio, total_camas, ocupadas, camas_perdidas, id_cama_perdida, empresa, huesped')
            .limit(1);

        if (!viewErr && viewData !== null) {
            // La vista existe → cargar todo con paginación
            const todos = await _cpFetchAll('v2_camas_perdidas_view',
                'habitacion_id, numero_hab, nivel, pabellon, edificio, total_camas, ocupadas, camas_perdidas, id_cama_perdida, empresa, huesped');
            _perdidas = todos.map(r => ({
                id_cama_perdida: r.id_cama_perdida,
                habitacion_id:   r.habitacion_id,
                numero_hab:      r.numero_hab,
                nivel:           r.nivel    || '—',
                pabellon:        r.pabellon || '—',
                edificio:        r.edificio || '—',
                empresa:         r.empresa  || '—',
                es_anglo:        isAnglo(r.empresa || ''),
                tipo:            'OCUPACION PARCIAL',
                huesped:         r.huesped  || '—',
                total_camas:     r.total_camas,
                ocupadas:        r.ocupadas,
                camas_perdidas:  r.camas_perdidas || (r.total_camas - r.ocupadas), // camas libres reales en esta hab
            }));
            console.log(`[CamasPerdidas] 📊 Vista SQL: ${_perdidas.length} camas perdidas`);
            return;
        }
    } catch (_) { /* vista no existe aún → usar detección JS */ }

    // ── Fallback: detección local paginada ────────────────────────────────────
    console.log('[CamasPerdidas] Vista SQL no disponible → detección JS paginada');
    const [camas, habs, asigs] = await Promise.all([
        _cpFetchAll('v2_camas',       'id_cama, habitacion_id, estado'),
        _cpFetchAll('v2_habitaciones', 'id_custom, numero_hab, nivel, pabellon_id'),
        _cpFetchAll('v2_asignaciones', 'id_cama, nombre_huesped, empresa_id',
                    q => q.is('fecha_checkout', null)),
    ]);
    const { data: pabs }     = await supabase.from('v2_pabellones').select('id, nombre, edificio_id').limit(500);
    const { data: edifs }    = await supabase.from('v2_edificios').select('id, nombre').limit(50);
    const { data: empresas } = await supabase.from('v2_empresas').select('id, nombre').limit(500);

    const habMap  = {}; (habs     || []).forEach(h => { habMap[h.id_custom]   = h; });
    const pabMap  = {}; (pabs     || []).forEach(p => { pabMap[p.id]          = p; });
    const edifMap = {}; (edifs    || []).forEach(e => { edifMap[e.id]         = e; });
    const asigMap = {}; (asigs    || []).forEach(a => { asigMap[a.id_cama]    = a; });
    const empMap  = {}; (empresas || []).forEach(e => { empMap[e.id]          = e; });

    const porHab = {};
    (camas || [])
        .filter(c => c.estado !== 'Deshabilitada')   // cama sin instalar = no existe
        .forEach(c => {
            if (!porHab[c.habitacion_id]) porHab[c.habitacion_id] = [];
            porHab[c.habitacion_id].push(c);
        });

    _perdidas = [];
    Object.entries(porHab).forEach(([habId, cs]) => {
        const hab  = habMap[habId] || {};
        const pab  = pabMap[hab.pabellon_id] || {};
        const edif = edifMap[pab.edificio_id] || {};
        if (!hab.numero_hab || cs.length < 2) return;

        const nTotal      = cs.length;
        const camasOcup   = cs.filter(c => c.estado === 'Ocupada' || !!asigMap[c.id_cama]);
        const camasLibres = cs.filter(c => c.estado !== 'Ocupada' && !asigMap[c.id_cama]);
        const nOcupadas   = camasOcup.length;
        if (nOcupadas === 0 || camasLibres.length === 0) return;

        const asigRef = camasOcup[0] ? (asigMap[camasOcup[0].id_cama] || null) : null;
        const empresa = asigRef ? (empMap[asigRef.empresa_id]?.nombre || '') : '';

        camasLibres.forEach(c => {
            _perdidas.push({
                id_cama_perdida: c.id_cama,
                habitacion_id:   habId,
                numero_hab:      hab.numero_hab,
                nivel:           hab.nivel    || '—',
                pabellon:        pab.nombre   || '—',
                edificio:        edif.nombre  || '—',
                empresa,
                es_anglo:        isAnglo(empresa),
                tipo:            'OCUPACION PARCIAL',
                huesped:         asigRef?.nombre_huesped || '—',
                total_camas:     nTotal,
                ocupadas:        nOcupadas,
            });
        });
    });
    console.log(`[CamasPerdidas] JS paginado: ${_perdidas.length} camas perdidas`);
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function kpi(icon, label, val, color) {
    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:18px;border-top:3px solid ${color}">
      <div style="font-size:22px;margin-bottom:4px">${icon}</div>
      <div style="font-size:30px;font-weight:900;color:${color}">${val}</div>
      <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-top:2px">${label}</div>
    </div>`;
}

// ── Fila de tabla ─────────────────────────────────────────────────────────────
function filaHTML(p) {
    const reg    = _registros[p.id_cama_perdida];
    const motivo = reg?.motivo || 'sin_motivo';
    const mObj   = MOTIVOS[motivo];
    const texto  = reg?.motivo_texto || '';

    const motivoOpts = Object.entries(MOTIVOS).map(([k, v]) =>
        `<option value="${k}" ${motivo === k ? 'selected' : ''}>${v.label}</option>`
    ).join('');

    const textoField = motivo === 'otros'
        ? `<input id="txt-${p.id_cama_perdida}" type="text" value="${texto}"
             placeholder="Describe el motivo…"
             style="width:100%;margin-top:6px;padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;background:var(--bg-card);color:var(--text-primary);outline:none">`
        : `<input id="txt-${p.id_cama_perdida}" type="text" value="${texto}" style="display:none">`;

    return `
    <div id="row-${p.id_cama_perdida}"
      style="background:var(--bg-card);border:1px solid ${p.tipo==='BLOQUEADA'?'#fca5a5':'var(--border)'};border-radius:14px;padding:16px;display:grid;
             grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:start">

      <!-- Habitacion -->
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:3px">Habitación</div>
        <div style="font-weight:800;font-size:16px;color:var(--text-primary)">${p.numero_hab}</div>
        <div style="font-size:11px;color:var(--text-muted)">${p.edificio} · ${p.pabellon} · Nivel ${p.nivel}</div>
        <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">
          ${p.tipo === 'BLOQUEADA'
            ? `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800">🔒 BLOQUEADA</span>`
            : `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800">🟡 PARCIAL ${p.ocupadas}/${p.total_camas}</span>`}
        </div>
        <div style="font-size:10px;font-family:monospace;color:#6366f1;margin-top:3px">🛏️ perdida: ${p.id_cama_perdida}</div>
      </div>

      <!-- Empresa + Huésped (cama ocupada) -->
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:3px">Empresa (cama ocu.)</div>
        <div style="font-weight:700;font-size:13px;color:var(--text-primary)">
          ${p.es_anglo
            ? `<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800">ANGLO</span> `
            : ''}
          ${p.empresa || '—'}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">👤 ${p.huesped}</div>
      </div>

      <!-- Motivo -->
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:3px">Motivo</div>
        <select id="sel-${p.id_cama_perdida}"
          onchange="window._cpMotivo('${p.id_cama_perdida}','${p.habitacion_id}','${p.empresa.replace(/'/g, "\\'")}',this.value)"
          style="width:100%;padding:8px 10px;border:1.5px solid ${mObj.color};border-radius:10px;
                 font-size:12px;font-weight:700;color:${mObj.color};background:var(--bg-card);outline:none;cursor:pointer">
          ${motivoOpts}
        </select>
        ${textoField}
      </div>

      <!-- Acción guardar/limpiar -->
      <div style="display:flex;flex-direction:column;gap:6px;padding-top:16px">
        <button onclick="window._cpGuardar('${p.id_cama_perdida}','${p.habitacion_id}','${p.empresa.replace(/'/g, "\\'")}')"
          style="padding:8px 12px;border:none;border-radius:10px;background:#6366f1;color:white;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">
          💾 Guardar
        </button>
        ${reg ? `<button onclick="window._cpEliminar('${p.id_cama_perdida}')"
          style="padding:8px 12px;border:1.5px solid #ef4444;border-radius:10px;background:transparent;color:#ef4444;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">
          🗑 Limpiar
        </button>` : ''}
      </div>
    </div>`;
}

// ── Render tabla (lista plana) ──────────────────────────────────────────────────────────
let _vistaMode    = 'pabellon'; // 'lista' | 'pabellon'  ← por defecto agrupado
let _pabExpandidos = new Set();

function renderTabla(filtro = 'todos') {
    const lista = document.getElementById('cp-lista');
    if (!lista) return;
    if (_vistaMode === 'pabellon') { renderPorPabellon(filtro); return; }

    let rows = _perdidas;
    if (filtro === 'anglo')  rows = rows.filter(p => p.es_anglo);
    if (filtro === 'otras')  rows = rows.filter(p => !p.es_anglo);
    if (!rows.length) {
        lista.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">
            ✅ Sin camas perdidas${filtro !== 'todos' ? ' en esta categoría' : ''}</div>`;
        return;
    }
    lista.innerHTML = rows.map(p => filaHTML(p)).join('');
}

// ── Render por pabellón (expandible) ────────────────────────────────────────────────
function renderPorPabellon(filtro = 'todos') {
    const lista = document.getElementById('cp-lista');
    if (!lista) return;

    let rows = _perdidas;
    if (filtro === 'anglo') rows = rows.filter(p => p.es_anglo);
    if (filtro === 'otras') rows = rows.filter(p => !p.es_anglo);

    if (!rows.length) {
        lista.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">✅ Sin camas perdidas</div>`;
        return;
    }

    // Agrupar por pabellon
    const grupos = {};
    rows.forEach(p => {
        const key = `${p.edificio} · ${p.pabellon}`;
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(p);
    });

    lista.innerHTML = Object.entries(grupos)
        .sort(([a],[b]) => a.localeCompare(b, 'es', {numeric:true}))
        .map(([pabKey, rooms]) => {
            const expanded = _pabExpandidos.has(pabKey);
            const safeId   = 'pab-' + pabKey.replace(/[^a-zA-Z0-9]/g,'_');
            return `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:2px">
              <div onclick="window._cpTogglePab('${pabKey.replace(/'/g,"\\'")}')"
                style="padding:14px 18px;display:flex;justify-content:space-between;align-items:center;
                       cursor:pointer;border-left:4px solid #ef4444"
                onmouseover="this.style.background='rgba(239,68,68,0.05)'" onmouseout="this.style.background='transparent'">
                <div>
                  <div style="font-weight:800;font-size:14px;color:var(--text-primary)">🏢 ${pabKey}</div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:3px">
                    ${rooms.length} habitación${rooms.length>1?'es':''}
                    &nbsp;·&nbsp;
                    <span style="color:#ef4444;font-weight:700">${rooms.length} cama${rooms.length>1?'s':''} perdida${rooms.length>1?'s':''}</span>
                  </div>
                </div>
                <div style="font-size:18px;transition:transform 0.25s;
                            transform:rotate(${expanded?'90':'0'}deg);color:#ef4444">&#9654;</div>
              </div>
              <div id="${safeId}"
                   style="padding:${expanded?'12px':'0'};display:flex;flex-direction:column;
                          gap:10px;transition:padding 0.2s;">
                ${expanded ? rooms.map(p => filaHTML(p)).join('') : ''}
              </div>
            </div>`;
        }).join('');
}

// ── Render KPIs ───────────────────────────────────────────────────────────────
function renderKpis() {
    // Suma camas_perdidas (puede ser >1 por hab cuando viene de vista SQL) o 1 en fallback JS
    const total  = _perdidas.reduce((s, p) => s + (p.camas_perdidas ?? 1), 0);
    const bloq   = _perdidas.filter(p => p.tipo === 'BLOQUEADA').reduce((s, p) => s + (p.camas_perdidas ?? 1), 0);
    const parc   = _perdidas.filter(p => p.tipo === 'OCUPACION PARCIAL').reduce((s, p) => s + (p.camas_perdidas ?? 1), 0);
    const conMot = _perdidas.filter(p => _registros[p.id_cama_perdida]?.motivo &&
                                         _registros[p.id_cama_perdida]?.motivo !== 'sin_motivo').length;

    const el = document.getElementById('cp-kpis');
    if (!el) return;
    el.innerHTML = [
        kpi('🛏️', 'Total Camas Perdidas', total, '#ef4444'),
        kpi('🔒', 'Hab. Bloqueadas',       bloq,  '#b91c1c'),
        kpi('🟡', 'Ocupación Parcial',     parc,  '#f59e0b'),
        kpi('📋', 'Con Motivo Registrado', conMot,'#10b981'),
    ].join('');
}

// ── Filtro activo ─────────────────────────────────────────────────────────────
let _filtro = 'todos';
function setFiltro(f) {
    _filtro = f;
    ['todos', 'anglo', 'otras'].forEach(k => {
        const btn = document.getElementById(`cp-f-${k}`);
        if (btn) {
            const activo = k === f;
            btn.style.background = activo ? '#6366f1' : 'var(--bg-card)';
            btn.style.color      = activo ? '#fff'    : 'var(--text-primary)';
            btn.style.borderColor= activo ? '#6366f1' : 'var(--border)';
        }
    });
    renderTabla(f);
}

// ── Render principal ──────────────────────────────────────────────────────────
export async function renderV2CamasPerdidas(container) {
    container.innerHTML = `
    <div style="padding:20px;max-width:1300px;margin:0 auto">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="background:linear-gradient(135deg,#ef4444,#dc2626);border-radius:14px;width:48px;height:48px;
                    display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🛏️</div>
        <div>
          <h1 style="font-size:20px;font-weight:800;margin:0;color:var(--text-primary)">Camas Perdidas</h1>
          <p style="font-size:12px;color:var(--text-secondary);margin:0">
            Habitaciones dobles con solo una cama ocupada · Registra el motivo de cada cama perdida
          </p>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="window.open('./Camas Perdidas.html','_blank')"
            style="background:linear-gradient(135deg,#dc2626,#b91c1c);border:none;
              border-radius:10px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:700;color:#fff;
              display:flex;align-items:center;gap:6px;white-space:nowrap">
            📊 Análisis Avanzado
          </button>
          <button onclick="window._cpRecargar()"
            style="background:var(--bg-card);border:1px solid var(--border);
              border-radius:10px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary)">
            🔄 Actualizar
          </button>
        </div>
      </div>


      <!-- KPIs -->
      <div id="cp-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
        <div style="height:90px;background:var(--border);border-radius:14px;animation:pulse 1.5s infinite"></div>
        <div style="height:90px;background:var(--border);border-radius:14px;animation:pulse 1.5s infinite"></div>
        <div style="height:90px;background:var(--border);border-radius:14px;animation:pulse 1.5s infinite"></div>
        <div style="height:90px;background:var(--border);border-radius:14px;animation:pulse 1.5s infinite"></div>
      </div>

      <!-- Filtros -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="cp-f-todos" onclick="window._cpFiltro('todos')"
            style="padding:9px 18px;border-radius:12px;border:2px solid #6366f1;background:#6366f1;color:#fff;font-weight:700;font-size:13px;cursor:pointer">
            📊 Todos
          </button>
          <button id="cp-f-anglo" onclick="window._cpFiltro('anglo')"
            style="padding:9px 18px;border-radius:12px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-weight:700;font-size:13px;cursor:pointer">
            🏭 Solo Anglo
          </button>
          <button id="cp-f-otras" onclick="window._cpFiltro('otras')"
            style="padding:9px 18px;border-radius:12px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-weight:700;font-size:13px;cursor:pointer">
            🏢 Otras Empresas
          </button>
        </div>
        <div style="margin-left:auto">
          <button id="cp-vista-btn" onclick="window._cpToggleVista()"
            style="padding:9px 18px;border-radius:12px;border:2px solid #6366f1;background:#6366f1;color:#fff;font-weight:700;font-size:13px;cursor:pointer">
            📋 Lista plana
          </button>
        </div>
      </div>

      <!-- Lista de camas perdidas -->
      <div id="cp-lista" style="display:flex;flex-direction:column;gap:10px">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Detectando camas perdidas…</div>
      </div>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}</style>`;

    // Cargar datos
    try {
        await Promise.all([detectarCamasPerdidas(), cargarRegistros()]);
        renderKpis();
        renderTabla(_filtro);
    } catch (e) {
        document.getElementById('cp-lista').innerHTML =
            `<div style="color:#ef4444;text-align:center;padding:24px">❌ ${e.message}</div>`;
    }

    // ── Globales ───────────────────────────────────────────────────────────────
    window._cpFiltro   = (f) => setFiltro(f);
    window._cpRecargar = () => renderV2CamasPerdidas(container);

    window._cpToggleVista = () => {
        _vistaMode = _vistaMode === 'lista' ? 'pabellon' : 'lista';
        _pabExpandidos.clear();
        const btn = document.getElementById('cp-vista-btn');
        if (btn) {
            const esPab = _vistaMode === 'pabellon';
            btn.style.background  = esPab ? '#6366f1' : 'var(--bg-card)';
            btn.style.color       = esPab ? '#fff'    : 'var(--text-primary)';
            btn.style.borderColor = esPab ? '#6366f1' : 'var(--border)';
            btn.textContent       = esPab ? '📋 Lista plana' : '🏗️ Por Pabellon';
        }
        renderTabla(_filtro);
    };

    window._cpTogglePab = (key) => {
        if (_pabExpandidos.has(key)) _pabExpandidos.delete(key);
        else _pabExpandidos.add(key);
        renderPorPabellon(_filtro);
    };

    window._cpMotivo = (idCama, _habId, _empresa, nuevoMotivo) => {
        const txtEl = document.getElementById(`txt-${idCama}`);
        if (txtEl) txtEl.style.display = nuevoMotivo === 'otros' ? 'block' : 'none';
        // Cambiar color del select
        const selEl = document.getElementById(`sel-${idCama}`);
        if (selEl) {
            const c = MOTIVOS[nuevoMotivo]?.color || '#94a3b8';
            selEl.style.borderColor = c;
            selEl.style.color = c;
        }
    };

    window._cpGuardar = async (idCama, habId, empresa) => {
        const sel = document.getElementById(`sel-${idCama}`);
        const txt = document.getElementById(`txt-${idCama}`);
        const motivo = sel?.value || 'sin_motivo';
        const motivoTexto = txt?.value || '';
        await guardarMotivo(idCama, habId, motivo, motivoTexto, empresa);
        // Feedback visual
        const row = document.getElementById(`row-${idCama}`);
        if (row) {
            row.style.borderColor = '#10b981';
            setTimeout(() => { row.style.borderColor = 'var(--border)'; }, 1500);
        }
        renderKpis();
        // Re-renderizar solo esa fila para mostrar botón "Limpiar"
        const p = _perdidas.find(x => x.id_cama_perdida === idCama);
        if (p && row) row.outerHTML = filaHTML(p);
    };

    window._cpEliminar = async (idCama) => {
        await eliminarMotivo(idCama);
        renderKpis();
        const p = _perdidas.find(x => x.id_cama_perdida === idCama);
        const row = document.getElementById(`row-${idCama}`);
        if (p && row) row.outerHTML = filaHTML(p);
    };
}
