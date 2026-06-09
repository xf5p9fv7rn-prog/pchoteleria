/**
 * v2-distribucion.js — Distribución de Habitaciones (Solo Supervisores)
 * Permite asignar camas a: Turno Noche, Turno 4x3, o Reservas.
 * Tabla: v2_distribucion_camas
 */
import { supabase } from '../../supabaseClient.js';

// ── Tipos de distribución ─────────────────────────────────────────────────────
const TIPOS = {
    noche:       { label: '🌙 Turno Noche',    color: '#4338ca', bg: '#eef2ff',
                   desc: 'Camas de turno noche EECC. Cuentan como camas noche en el dashboard.' },
    colaborador: { label: '👥 Colaboradores',  color: '#0891b2', bg: '#ecfeff',
                   desc: 'Camas de colaboradores (ej: Pabellón 7). Ambas camas cuentan como noche.' },
    '4x3':       { label: '🔄 Turno 4×3',      color: '#7c3aed', bg: '#f5f3ff',
                   desc: 'Rotación 4 días trabajo / 3 días descanso.' },
    reserva:     { label: '📌 Reservas',        color: '#6d28d9', bg: '#f5f3ff',
                   desc: 'Camas reservadas. Se cuentan como ocupadas en el sistema.' },
    anglo:       { label: '🤝 Anglo',           color: '#d97706', bg: '#fffbeb',
                   desc: 'Acuerdo Anglo: 1 cama cuenta como día + 1 cama como noche por habitación. Se asigna aunque esté ocupada.' },
    empresa:     { label: '🏢 Empresa',         color: '#059669', bg: '#ecfdf5',
                   desc: 'Marca pabellones/pisos/hab para una empresa específica. Se asigna aunque estén ocupadas.' },
};


// ── Estado del módulo ─────────────────────────────────────────────────────────
let _tab            = 'noche';
let _distribucion   = [];
let _habs           = [];
let _camasPorHab    = {};
let _selHab         = null;
let _bulkSets       = {};
let _etiquetaEmpresa = ''; // empresa seleccionada en tab empresa
let _empresasLista  = []; // para dropdown empresa

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function _distFetchAll(tabla, select, filtro = null) {
    let all = [], pg = 0;
    while (true) {
        let q = supabase.from(tabla).select(select).range(pg * 1000, pg * 1000 + 999);
        if (filtro) q = filtro(q);
        const { data, error } = await q;
        if (error) throw error;
        if (data?.length) all = all.concat(data);
        if (!data || data.length < 1000) break;
        pg++; if (pg > 20) break;
    }
    return all;
}

async function cargarDistribucion() {
    _distribucion = await _distFetchAll('v2_distribucion_camas', '*');
}

// Toast de feedback visual
function toast(msg, ok = true) {
    const id = 'dist-toast-' + Date.now();
    const t = document.createElement('div');
    t.id = id;
    t.textContent = msg;
    Object.assign(t.style, {
        position:'fixed', bottom:'24px', right:'24px', zIndex:9999,
        padding:'12px 20px', borderRadius:'12px', fontWeight:'700', fontSize:'13px',
        background: ok ? '#10b981' : '#ef4444', color:'#fff',
        boxShadow:'0 4px 20px rgba(0,0,0,.25)',
        transition:'opacity .4s', opacity:'1',
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2500);
}

async function toggleCama(idCama, tipo) {
    const existente = _distribucion.find(d => d.id_cama === idCama);
    if (existente && existente.tipo === tipo) {
        // Desasignar (toggle off)
        await supabase.from('v2_distribucion_camas').delete().eq('id_cama', idCama);
        _distribucion = _distribucion.filter(d => d.id_cama !== idCama);
    } else {
        // Asignar o cambiar tipo
        await supabase.from('v2_distribucion_camas').upsert([{
            id_cama:      idCama,
            tipo,
            asignado_por: window._currentUser?.username || 'supervisor',
            updated_at:   new Date().toISOString(),
        }], { onConflict: 'id_cama' });
        if (existente) {
            existente.tipo = tipo;
        } else {
            _distribucion.push({ id_cama: idCama, tipo });
        }
    }
}

// ── Masivo: asignar o quitar múltiples camas de una sola vez ─────────────────
async function asignarMasivo(camaIds, tipo, etiqueta = '') {
    // Al etiquetar masivamente se incluyen TODAS las camas (incluso ocupadas)
    if (!camaIds.length) return 0;

    // Supabase trunca silenciosamente upserts grandes → lotes de 100
    const CHUNK = 100;
    const ts = new Date().toISOString();
    const user = window._currentUser?.username || 'supervisor';
    for (let i = 0; i < camaIds.length; i += CHUNK) {
        const lote = camaIds.slice(i, i + CHUNK);
        const rows = lote.map(id => ({ id_cama: id, tipo, etiqueta, asignado_por: user, updated_at: ts }));
        const { error } = await supabase.from('v2_distribucion_camas')
            .upsert(rows, { onConflict: 'id_cama' });
        if (error) throw error;
    }
    await cargarDistribucion();
    return camaIds.length;
}

async function quitarMasivo(camaIds) {
    if (!camaIds.length) return 0;
    // Supabase puede truncar .in() con muchos IDs → lotes de 500
    const CHUNK = 500;
    for (let i = 0; i < camaIds.length; i += CHUNK) {
        const lote = camaIds.slice(i, i + CHUNK);
        const { error } = await supabase.from('v2_distribucion_camas')
            .delete().in('id_cama', lote);
        if (error) throw error;
    }
    await cargarDistribucion();
    return camaIds.length;
}

// ── Panel de acciones masivas (derecha, cuando se selecciona pabellón) ────────
function renderBulkPanel(pid) {
    const panel = document.getElementById('dist-camas-panel');
    const tip   = TIPOS[_tab];
    const todasCamas = Object.values(_camasPorHab).flat();


    // Pisos únicos
    const pisosSet = new Set();
    _habs.forEach(h => { if (h.nivel) pisosSet.add(h.nivel); });
    const pisos = [...pisosSet].sort();

    // Guardar arrays en _bulkSets con claves simples (NO JSON inline)
    _bulkSets = {};
    const camasPab = todasCamas.map(c => c.id_cama);
    _bulkSets['pab'] = camasPab;
    pisos.forEach(piso => {
        const habsDelPiso  = _habs.filter(h => h.nivel === piso);
        const camasDelPiso = habsDelPiso.flatMap(h => (_camasPorHab[h.id_custom] || []).map(c => c.id_cama));
        _bulkSets[`piso_${piso}`] = camasDelPiso;
    });

    const asigPab = _distribucion.filter(d => camasPab.includes(d.id_cama) && d.tipo === _tab).length;

    const pisoRows = pisos.map(piso => {
        const key          = `piso_${piso}`;
        const camasDelPiso = _bulkSets[key];
        const habsDelPiso  = _habs.filter(h => h.nivel === piso);
        const asig = _distribucion.filter(d => camasDelPiso.includes(d.id_cama) && d.tipo === _tab).length;
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
            background:var(--bg-card);border:1px solid var(--border);border-radius:12px">
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--text-primary)">Piso ${piso}</div>
            <div style="font-size:11px;color:var(--text-muted)">${habsDelPiso.length} hab · ${camasDelPiso.length} camas · <span style="color:${tip.color};font-weight:700">${asig} asig.</span></div>
          </div>
          <div style="display:flex;gap:6px">
            <button onclick="window._distBulkAsig('${key}',this)" title="Asignar todo el piso"
              style="padding:7px 12px;border:none;border-radius:8px;background:${tip.color};color:white;font-weight:700;font-size:12px;cursor:pointer">
              ✅ Asignar
            </button>
            <button onclick="window._distBulkQuitar('${key}',this)" title="Quitar todo el piso"
              style="padding:7px 12px;border:none;border-radius:8px;background:#ef4444;color:white;font-weight:700;font-size:12px;cursor:pointer">
              🗑️ Quitar
            </button>
          </div>
        </div>`;
    }).join('');

    panel.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px">
        <div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:14px">⚡ Acciones Masivas — ${tip.label}</div>

        ${_tab === 'empresa' ? `
        <div style="background:${tip.bg};border:1.5px solid ${tip.color}40;border-radius:10px;padding:12px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase">🏢 Empresa a etiquetar</div>
          <select id="dist-emp-sel"
            style="width:100%;padding:8px 12px;border:1.5px solid ${tip.color};border-radius:8px;font-size:13px;font-weight:700;background:var(--bg-card);color:var(--text-primary);outline:none">
            <option value="">— Selecciona empresa —</option>
            ${_empresasLista.map(e => `<option value="${e.nombre}" ${_etiquetaEmpresa===e.nombre?'selected':''}>${e.nombre}</option>`).join('')}
          </select>
        </div>` : ''}

        <!-- Todo el pabellón -->
        <div style="background:${tip.bg};border:1.5px solid ${tip.color}40;border-radius:12px;padding:14px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase">🏢 Todo el pabellón</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--text-primary)">${todasCamas.length} camas · <strong style="color:${tip.color}">${asigPab} ya asignadas</strong></span>
            <div style="display:flex;gap:8px">
              <button onclick="window._distBulkAsig('pab',this)"
                style="padding:9px 16px;border:none;border-radius:10px;background:${tip.color};color:white;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">
                ✅ Asignar todo
              </button>
              <button onclick="window._distBulkQuitar('pab',this)"
                style="padding:9px 16px;border:none;border-radius:10px;background:#ef4444;color:white;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">
                🗑️ Quitar todo
              </button>
            </div>
          </div>
        </div>

        <!-- Por piso -->
        ${pisos.length ? `
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase">🏗️ Por piso / nivel</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">${pisoRows}</div>
        ` : ''}

        <!-- Habitaciones individuales -->
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase">🚪 Por habitación</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px">
          ${_habs.map(h => {
              const key = 'hab_' + h.id_custom;
              const cs  = (_camasPorHab[h.id_custom] || []).map(c => c.id_cama);
              _bulkSets[key] = cs;
              const asigHab = _distribucion.filter(d => cs.includes(d.id_cama) && d.tipo === _tab).length;
              return `<div id="dist-h-${h.id_custom}"
                style="background:var(--bg-card);border:1.5px solid ${asigHab>0?tip.color:'var(--border)'};
                  border-radius:10px;padding:8px;text-align:center;transition:all .15s">
                <div onclick="window._distHab('${h.id_custom}')" style="cursor:pointer">
                  <div style="font-weight:800;font-size:13px;color:var(--text-primary)">${h.numero_hab}</div>
                  ${asigHab>0?`<div style="font-size:10px;color:${tip.color};font-weight:700">${asigHab}/${cs.length} asig.</div>`
                    :'<div style="font-size:10px;color:var(--text-muted)">Ver camas</div>'}
                </div>
                ${asigHab > 0 ? `
                <button onclick="window._distBulkQuitar('${key}',this)" title="Quitar asignaciones de esta habitación"
                  style="margin-top:5px;width:100%;padding:3px 0;border:1px solid #ef4444;border-radius:6px;
                    background:transparent;color:#ef4444;font-size:10px;font-weight:700;cursor:pointer">
                  🗑 Quitar
                </button>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;

    // Handlers con clave simple
    window._distBulkAsig = async (setKey, btn) => {
        const camaIds = _bulkSets[setKey];
        if (!camaIds?.length) { toast('No hay camas disponibles', false); return; }
        // Para empresa: leer el dropdown
        if (_tab === 'empresa') {
            const sel = document.getElementById('dist-emp-sel');
            _etiquetaEmpresa = sel?.value || '';
            if (!_etiquetaEmpresa) { toast('Selecciona una empresa primero', false); return; }
        }
        btn.disabled = true;
        btn.textContent = '⏳ Guardando…';
        try {
            const n = await asignarMasivo(camaIds, _tab, _etiquetaEmpresa);
            toast(`✅ ${n} camas asignadas`);
        } catch(e) {
            toast('❌ Error: ' + e.message, false);
        }
        renderKpis();
        renderBulkPanel(pid);
    };
    window._distBulkQuitar = async (setKey, btn) => {
        const camaIds = _bulkSets[setKey];
        if (!camaIds?.length) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = '⏳ Quitando…';
        try {
            const n = await quitarMasivo(camaIds);
            toast(`🗑️ ${n} camas removidas`);
        } catch(e) {
            toast('❌ Error al quitar: ' + e.message, false);
        }
        renderKpis();
        renderBulkPanel(pid);
    };
}


// ── KPIs resumen ──────────────────────────────────────────────────────────────
function renderKpis() {
    const el = document.getElementById('dist-kpis');
    if (!el) return;
    const noche   = _distribucion.filter(d => d.tipo === 'noche').length;
    const colab   = _distribucion.filter(d => d.tipo === 'colaborador').length;
    const x4      = _distribucion.filter(d => d.tipo === '4x3').length;
    const reserva = _distribucion.filter(d => d.tipo === 'reserva').length;
    const anglo   = _distribucion.filter(d => d.tipo === 'anglo').length;
    const empresa = _distribucion.filter(d => d.tipo === 'empresa').length;
    const angloNoche = Math.floor(anglo / 2);
    el.innerHTML = [
        { icon: '🌙', lbl: 'Noche EECC',         val: noche,              c: '#4338ca' },
        { icon: '👥', lbl: 'Colaboradores',        val: colab,              c: '#0891b2' },
        { icon: '🔄', lbl: 'Turno 4×3',            val: x4,                c: '#7c3aed' },
        { icon: '📌', lbl: 'Reservas',              val: reserva,            c: '#6d28d9' },
        { icon: '🤝', lbl: 'Anglo (noche)',         val: `${angloNoche}/${anglo}`, c: '#d97706' },
        { icon: '🏢', lbl: 'Camas Empresa',         val: empresa,            c: '#059669' },
    ].map(k => `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px;border-top:3px solid ${k.c}">
          <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
          <div style="font-size:24px;font-weight:900;color:${k.c}">${k.val}</div>
          <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">${k.lbl}</div>
        </div>`).join('');
}


// ── Panel de camas de la habitación seleccionada ──────────────────────────────
async function renderCamasPanel(habId) {
    const panel = document.getElementById('dist-camas-panel');
    const tip   = TIPOS[_tab];
    const hab   = _habs.find(h => h.id_custom === habId);
    panel.innerHTML = `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px;text-align:center;color:var(--text-muted)">⏳ Cargando camas…</div>`;

    const { data: camas } = await supabase.from('v2_camas')
        .select('id_cama,estado').eq('habitacion_id', habId).order('id_cama');

    panel.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <div style="background:${tip.color};border-radius:10px;padding:8px 14px;color:white;font-weight:800;font-size:18px">
            ${hab?.numero_hab || habId}
          </div>
          <div>
            <div style="font-weight:700;color:var(--text-primary)">${tip.label}</div>
            <div style="font-size:11px;color:var(--text-muted)">${tip.desc}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px">
          ${(camas || []).map(c => {
            const distReg  = _distribucion.find(d => d.id_cama === c.id_cama);
            const esMiTipo = distReg?.tipo === _tab;
            const otroTipo = distReg && !esMiTipo ? TIPOS[distReg.tipo] : null;
            const isOcup   = c.estado === 'Ocupada' && !distReg;
            const disabled = isOcup || (otroTipo !== null);
            const bg       = esMiTipo ? tip.color : otroTipo ? otroTipo.color : isOcup ? '#ef4444' : '#10b981';
            const lbl      = esMiTipo ? '✓ ASIGNADA' : otroTipo ? `[${distReg.tipo}]` : isOcup ? 'Ocupada' : 'Libre';
            return `
              <div id="dist-c-${c.id_cama}"
                onclick="${disabled ? '' : `window._distToggle('${c.id_cama}')`}"
                style="border-radius:14px;padding:16px;text-align:center;cursor:${disabled ? 'not-allowed' : 'pointer'};
                  background:${bg};color:white;font-weight:700;font-size:12px;
                  opacity:${disabled && !esMiTipo ? '.45' : '1'};
                  border:3px solid ${esMiTipo ? 'rgba(255,255,255,.8)' : 'transparent'};
                  transition:all .2s;box-shadow:0 2px 8px rgba(0,0,0,.12)"
                onmouseover="${disabled ? '' : `this.style.transform='scale(1.05)'`}"
                onmouseout="this.style.transform='scale(1)'"
                title="${disabled && !esMiTipo ? 'No disponible (' + (isOcup ? 'ocupada' : 'asignada a ' + distReg.tipo) + ')' : 'Clic para ' + (esMiTipo ? 'quitar' : 'asignar')}">
                <div style="font-size:22px;margin-bottom:6px">🛏️</div>
                <div style="font-size:10px;font-family:monospace;opacity:.8;margin-bottom:4px">${c.id_cama}</div>
                <div style="font-size:11px">${lbl}</div>
              </div>`;
          }).join('')}
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap">
          <span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:${tip.color};display:inline-block"></span>Asignada (${_tab})</span>
          <span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:#10b981;display:inline-block"></span>Libre</span>
          <span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:#ef4444;display:inline-block"></span>Ocupada</span>
        </div>
      </div>`;

    window._distToggle = async (idCama) => {
        await toggleCama(idCama, _tab);
        renderKpis();
        await renderCamasPanel(habId);
    };
}

// ── Render principal ──────────────────────────────────────────────────────────
export async function renderV2Distribucion(container) {
    const tip = TIPOS[_tab];

    container.innerHTML = `
    <div style="padding:20px;max-width:1300px;margin:0 auto">

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="background:linear-gradient(135deg,#4338ca,#7c3aed);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏨</div>
        <div>
          <h1 style="font-size:20px;font-weight:800;margin:0;color:var(--text-primary)">Distribución de Habitaciones</h1>
          <p style="font-size:12px;color:var(--text-secondary);margin:0">Solo supervisores · Asigna camas por tipo de turno o reserva</p>
        </div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
        ${Object.entries(TIPOS).map(([k, t]) => `
          <button onclick="window._distTab('${k}')"
            style="padding:11px 20px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer;
              border:2px solid ${_tab === k ? t.color : 'var(--border)'};
              background:${_tab === k ? t.color : 'var(--bg-card)'};
              color:${_tab === k ? '#fff' : 'var(--text-primary)'};
              box-shadow:${_tab === k ? '0 4px 12px rgba(0,0,0,.15)' : 'none'};
              transition:all .2s">
            ${t.label}
          </button>`).join('')}
      </div>

      <!-- KPIs -->
      <div id="dist-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px"></div>

      <!-- Layout principal 2 columnas -->
      <div style="display:grid;grid-template-columns:260px 1fr;gap:16px">

        <!-- Columna izquierda: selectores + lista de habitaciones -->
        <div>
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:12px">
            <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:12px">📍 Zona</div>
            <div style="margin-bottom:10px">
              <label style="font-size:11px;font-weight:700;color:var(--text-muted)">Edificio</label>
              <select id="dist-edif" onchange="window._distEdif()" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;margin-top:4px;background:var(--bg-card);color:var(--text-primary);outline:none">
                <option value="">— Seleccionar —</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--text-muted)">Pabellón</label>
              <select id="dist-pab" onchange="window._distPab()" disabled style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;margin-top:4px;background:var(--bg-card);color:var(--text-primary);outline:none">
                <option value="">— Seleccionar —</option>
              </select>
            </div>
          </div>
          <div id="dist-hab-list" style="display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 420px);overflow-y:auto"></div>
        </div>

        <!-- Columna derecha: camas de la habitación -->
        <div id="dist-camas-panel">
          <div style="background:var(--bg-card);border:2px dashed var(--border);border-radius:14px;padding:40px;text-align:center;color:var(--text-muted)">
            <div style="font-size:36px;margin-bottom:12px">🛏️</div>
            <div style="font-weight:700;font-size:15px;margin-bottom:6px">Selecciona una habitación</div>
            <div style="font-size:13px">Elige edificio → pabellón → habitación para ver sus camas</div>
          </div>
        </div>
      </div>
    </div>`;

    // Cargar datos y KPIs
    await cargarDistribucion();
    // Cargar empresas para el dropdown del tab empresa
    const { data: emps } = await supabase.from('v2_empresas').select('id, nombre').order('nombre').limit(200);
    _empresasLista = emps || [];
    renderKpis();

    // Cargar edificios
    const { data: edifs } = await supabase.from('v2_edificios').select('id,nombre').order('nombre');
    const selEdif = document.getElementById('dist-edif');
    selEdif.innerHTML = '<option value="">— Seleccionar —</option>' +
        (edifs || []).map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');

    // ── Globales ─────────────────────────────────────────────────────────────
    window._distTab = (t) => { _tab = t; _selHab = null; renderV2Distribucion(container); };

    window._distEdif = async () => {
        const eid = document.getElementById('dist-edif').value;
        const selPab = document.getElementById('dist-pab');
        selPab.innerHTML = '<option value="">— Seleccionar —</option>';
        selPab.disabled = !eid;
        document.getElementById('dist-hab-list').innerHTML = '';
        if (!eid) return;
        const { data: pabs } = await supabase.from('v2_pabellones').select('id,nombre').eq('edificio_id', eid).order('nombre');
        selPab.innerHTML = '<option value="">— Seleccionar —</option>' +
            (pabs || []).map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
        selPab.disabled = false;
    };

    window._distPab = async () => {
        const pid = document.getElementById('dist-pab').value;
        const panel = document.getElementById('dist-camas-panel');
        panel.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">⏳ Cargando…</div>';
        document.getElementById('dist-hab-list').innerHTML = '';
        if (!pid) return;

        // 1. Cargar habitaciones (paginado)
        _habs = await _distFetchAll('v2_habitaciones', 'id_custom,numero_hab,nivel',
            q => q.eq('pabellon_id', pid).order('numero_hab'));
        _selHab = null;

        // 2. Cargar todas las camas del pabellón en lotes (evita truncación .in())
        const habIds = _habs.map(h => h.id_custom);
        _camasPorHab = {};
        if (habIds.length) {
            // Dividir habIds en lotes para no superar el límite de la URL en .in()
            const CHUNK = 200;
            for (let i = 0; i < habIds.length; i += CHUNK) {
                const lote = habIds.slice(i, i + CHUNK);
                const { data: loteC } = await supabase.from('v2_camas')
                    .select('id_cama,habitacion_id,estado').in('habitacion_id', lote).order('id_cama');
                (loteC || []).forEach(c => {
                    if (!_camasPorHab[c.habitacion_id]) _camasPorHab[c.habitacion_id] = [];
                    _camasPorHab[c.habitacion_id].push(c);
                });
            }
        }

        // 3. Mostrar panel masivo en la derecha
        renderBulkPanel(pid);
    };

    window._distHab = async (habId) => {
        _selHab = habId;
        const t = TIPOS[_tab];
        document.querySelectorAll('[id^="dist-h-"]').forEach(el => {
            el.style.background = 'var(--bg-card)';
        });
        const selEl = document.getElementById(`dist-h-${habId}`);
        if (selEl) selEl.style.background = t.bg;
        await renderCamasPanel(habId);
    };
}
