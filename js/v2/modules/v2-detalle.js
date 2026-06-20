/**
 * v2-detalle.js — Módulo "Detalle" del Sistema PC Hotelería
 * 5 sub-secciones: Total Habitaciones · Ocupadas · Reserva · No Ocupado · Bloqueadas
 * Todos los datos se extraen dinámicamente de Supabase.
 * Los campos Turno, Gerencia y Superintendencia se cruzan con v2_solicitudes_b2b por RUT.
 */
import { supabase } from '../../supabaseClient.js';
import { CampDataEngine, localDateStr, todayLocal, POR_ASIGNAR, SIN_EMPRESA } from '../engine/v2-data-engine.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchAll(table, select, filterFn = null) {
  let all = [], pg = 0;
  while (true) {
    let q = supabase.from(table).select(select).range(pg * 1000, pg * 1000 + 999);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) { console.error(`[v2-detalle] ❌ ${table} ERROR:`, error.message, error.details || ''); break; }
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    pg++; if (pg > 30) break;
  }
  return all;
}

// Detecta si una cama/hab pertenece a REF 220
const isR220 = (id) => /^R[.\-]?220/i.test(String(id || ''));

// Turnos disponibles para filtros (todos los del sistema)
const TURNOS = ['4x3', '4x4', '5x2', '7x7', '8x6', '10x10', '14x14'];

// ── Chart.js loader singleton ─────────────────────────────────────────────────
let _chartLoaded = false;
async function loadChart() {
  if (_chartLoaded || window.Chart) { _chartLoaded = true; return; }
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => { _chartLoaded = true; res(); };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ── Estado del módulo ─────────────────────────────────────────────────────────
let _tab = 'total';
let _turnoFiltro = null;
let _empresaFiltro = null;
let _supFiltro = null;   // filtro por superintendencia
let _data = null;

// Estado de filtros para tab No Ocupado
let _libreFiltroPab = '';   // pabellón seleccionado ('' = todos)
let _libreFiltroPiso = '';   // piso seleccionado     ('' = todos)

// Formato numero_hab: [Pab][Piso][HH] ej: "1302" → P1, Piso 3, Hab 02
function _extraerPabellon(numHab) {
  const s = String(numHab || '').replace(/\D/g, '');
  return s.length >= 4 ? 'P' + s[0] : '?';
}
function _extraerPiso(numHab) {
  const s = String(numHab || '').replace(/\D/g, '');
  return s.length >= 4 ? 'Piso ' + s[1] : '?';
}

// ── Render principal ──────────────────────────────────────────────────────────
export async function renderV2Detalle(container) {
  container.innerHTML = skeletonHTML();
  await loadChart();

  try {
    // ── Carga masiva en paralelo ──────────────────────────────────────────
    const [camasAll, habitacionesAll, asigRaw, distribucion, habSimple] = await Promise.all([
      fetchAll('v2_camas', 'id_cama,estado,numero_cama,habitacion_id'),
      fetchAll('v2_habitaciones', 'id_custom,numero_hab,estado,pabellon,sector,motivo_bloqueo,fecha_bloqueo,v2_pabellones(nombre,v2_edificios(nombre))'),
      fetchAll('v2_asignaciones',
        'id,id_cama,nombre_huesped,rut_huesped,fecha_checkin,fecha_salida_programada,huesped_confirmo,estado_asignacion,numero_contrato,v2_empresas(nombre,turno,v2_gerencias(nombre)),v2_camas(numero_cama,habitacion_id,v2_habitaciones(id_custom,numero_hab))',
        q => q.is('fecha_checkout', null)
      ),
      fetchAll('v2_distribucion_camas', 'id_cama,tipo,etiqueta'),
      fetchAll('v2_habitaciones', 'id_custom,numero_hab,pabellon,sector'),  // fetch simple sin joins (para habMap números y pabellón)
    ]);

    // ── Fetch PAGINADO de solicitudes B2B (usa fetchAll para superar límite de 1000 filas) ─
    let solsB2B = [];
    try {
      solsB2B = await fetchAll(
        'v2_solicitudes_b2b',
        'rut_trabajador,empresa,turno,gerencia,shift_name,origen,n_contrato,status'
      );
      console.log('[v2-detalle] ✅ B2B OK (paginado):', solsB2B.length, 'registros');
      if (solsB2B.length > 0) {
        const conOrigen = solsB2B.filter(s => s.origen).length;
        console.log('[v2-detalle] registros con origen (superintendencia):', conOrigen);
      }
    } catch (eb) {
      console.error('[v2-detalle] ❌ B2B excepción:', eb.message);
    }

    // Construir mapa RUT -> datos B2B
    const normRut = r => String(r || '').replace(/[.\-\s]/g, '').toUpperCase().trim();
    const solsMap = {};
    (solsB2B || []).forEach(s => {
      const k = normRut(s.rut_trabajador || s.rut || '');
      if (k) solsMap[k] = s;
    });

    // Mapa adicional por Nº Contrato
    const solsByContrato = {};
    (solsB2B || []).forEach(s => {
      const kc = String(s.n_contrato || s.numero_contrato || s.contrato || '').trim();
      if (kc) solsByContrato[kc] = s;
    });





    // Enriquecer asignaciones con datos B2B (RUT primero, contrato como fallback)
    const enrich = (asig) => {
      const k = normRut(asig.rut_huesped);
      const kc = String(asig.numero_contrato || '').trim();
      const sol = solsMap[k] || solsByContrato[kc] || {};
      const turnoEmpresa = Array.isArray(asig.v2_empresas)
        ? asig.v2_empresas[0]?.turno
        : asig.v2_empresas?.turno;
      const gerenciaEmpresa = Array.isArray(asig.v2_empresas)
        ? asig.v2_empresas[0]?.v2_gerencias?.nombre
        : asig.v2_empresas?.v2_gerencias?.nombre;
      const nombreEmpresa = Array.isArray(asig.v2_empresas)
        ? asig.v2_empresas[0]?.nombre
        : asig.v2_empresas?.nombre;
      return {
        ...asig,
        // turno: shift_name tiene el sistema de rotación (7x7/14x14) en imports de panel-dotacion
        // turno: campo turno tiene el sistema en imports de v2-solicitudes.js
        _turno: sol.shift_name || sol.turno || turnoEmpresa || '—',
        _gerencia: sol.gerencia || gerenciaEmpresa || '—',
        _superintendencia: sol.origen || '—',
        _empresa: nombreEmpresa || sol.empresa || 'Sin Empresa',
      };
    };

    // Separar en JS:
    //   activas  = estado != pre_asignado  OR  pre_asignado pero fecha_checkin <= hoy (ya llegó)
    //   pre      = pre_asignado  Y  fecha_checkin > hoy  (todavía no llega)
    const PRE_ESTADOS = new Set(['pre_asignado', 'pre']);
    // ⚠️ TIMEZONE-SAFE: usar medianoche LOCAL (no UTC) para evitar errores de ±1 día en Chile (UTC-4)
    const hoyLocal = localDateStr(todayLocal());

    const asigActRaw = asigRaw.filter(a => {
      if (!PRE_ESTADOS.has(a.estado_asignacion)) return true;  // activa/saliente/etc → activa
      // pre_asignado: si fecha_checkin <= hoy → ya debería ser ocupada → contar como activa
      if (a.fecha_checkin && a.fecha_checkin <= hoyLocal) return true;
      return false;
    });
    const asigPreRaw = asigRaw.filter(a => {
      if (!PRE_ESTADOS.has(a.estado_asignacion)) return false;
      // pre_asignado: solo cuenta como Reserva si fecha_checkin es FUTURA
      return !a.fecha_checkin || a.fecha_checkin > hoyLocal;
    });

    // ─ DIAGNÓSTICO ───────────────────────────────────────────────────────────
    console.log('[v2-detalle] 📦 asigRaw total:', asigRaw.length,
      '| activas (incl. pre vencidos):', asigActRaw.length,
      '| pre futuros:', asigPreRaw.length,
      '| hoy:', hoyLocal);

    const asigActivas = asigActRaw.map(enrich);
    const asigPre = asigPreRaw.map(enrich);

    // --- DIAGNOSTICO POST-ENRICH ---
    const conTurno = asigActivas.filter(a => a._turno && a._turno !== '—').length;
    const sinTurno = asigActivas.filter(a => !a._turno || a._turno === '—').length;
    const conSup = asigActivas.filter(a => a._superintendencia && a._superintendencia !== '—').length;
    console.log('[v2-detalle] CON turno=' + conTurno + ' SIN=' + sinTurno + ' CON sup=' + conSup);
    console.log('[v2-detalle] solsB2B total: ' + (solsB2B || []).length);
    if ((solsB2B || []).length > 0) {
      const b2bSample = (solsB2B || []).slice(0, 3).map(s => ({ rut: s.rut_trabajador, turno: s.turno, shift: s.shift_type, sup: s.superintendencia }));
      console.log('[v2-detalle] B2B sample:', JSON.stringify(b2bSample));
    }
    if (asigActivas.length > 0) {
      const normRutD = r => String(r || '').replace(/[.\\-\\s]/g, '').toUpperCase().trim();
      const matched = asigActivas.filter(a => !!solsMap[normRutD(a.rut_huesped)]).length;
      console.log('[v2-detalle] RUT match: ' + matched + '/' + asigActivas.length);
      const s3 = asigActivas.slice(0, 3).map(a => ({ n: a.nombre_huesped, rut: a.rut_huesped, m: !!solsMap[normRutD(a.rut_huesped)], t: a._turno, sup: a._superintendencia }));
      console.log('[v2-detalle] sample:', JSON.stringify(s3));
    }
    // ---

    const camas = camasAll.filter(c => !/deshabiit|deshabilit/i.test(c.estado || ''));

    // ── Mapas de soporte ──────────────────────────────────────────────────
    // Mapa id_cama → etiqueta empresa (distribución)
    const distEmpMap = {};
    (distribucion || []).forEach(d => {
      if (d.tipo === 'empresa') distEmpMap[String(d.id_cama)] = d.etiqueta || '—';
    });

    // Habitaciones por id_custom.
    // Preferimos habitacionesAll (con datos completos de pabellones).
    // Si está vacío (falla el join complejo), usamos habSimple como fuente base.
    const habSource = habitacionesAll.length > 0 ? habitacionesAll : (habSimple || []);
    const habMap = {};
    habSource.forEach(h => {
      if (h.id_custom) habMap[String(h.id_custom)] = h;
    });
    // Enriquecer habMap con numero_hab desde habSimple si el full fetch falló
    if (habitacionesAll.length === 0 && (habSimple || []).length > 0) {
      console.warn('[v2-detalle] ⚠️ habitacionesAll vacío, usando habSimple:', habSimple.length);
    }
    console.log('[v2-detalle] 🏠 habMap size:', Object.keys(habMap).length,
      '| full:', habitacionesAll.length, '| simple:', (habSimple || []).length,
      '| número COPC000003:', habMap['COPC000003']?.numero_hab);

    // Conjunto de camas ocupadas
    const ocupadosSet = new Set(asigActivas.map(a => String(a.id_cama)));

    // ── Separar camas por sector (por id_cama) ─────────────────────────
    const camasCOPC = camas.filter(c => !isR220(c.id_cama));
    const camasR220 = camas.filter(c => isR220(c.id_cama));

    // Separar habitaciones: habitacion_id en camas referencia id_custom en v2_habitaciones
    const habIdsCOPC = new Set(camasCOPC.filter(c => c.habitacion_id).map(c => String(c.habitacion_id)));
    const habIdsR220 = new Set(camasR220.filter(c => c.habitacion_id).map(c => String(c.habitacion_id)));
    const habsCOPC = habitacionesAll.filter(h => habIdsCOPC.has(String(h.id_custom ?? h.id ?? '')));
    const habsR220 = habitacionesAll.filter(h => habIdsR220.has(String(h.id_custom ?? h.id ?? '')));

    // ── Calcular camas Noche desde distribución de camas ────────────────
    const camaById = {};
    camas.forEach(c => { camaById[String(c.id_cama)] = c; });

    const habAngloIds = new Set();
    const habNocheIds = new Set();
    (distribucion || []).forEach(d => {
      const tipo = (d.tipo || '').toLowerCase().trim();
      const camRec = camaById[String(d.id_cama)];
      if (!camRec) return;
      if (tipo === 'anglo' && camRec.habitacion_id) {
        habAngloIds.add(camRec.habitacion_id);
      }
      if ((tipo === 'noche' || tipo === 'night') && camRec.habitacion_id) {
        habNocheIds.add(camRec.habitacion_id);
      }
    });
    const camaNocheSet = new Set();
    camas.forEach(c => {
      if (habAngloIds.has(c.habitacion_id) && Number(c.numero_cama) === 2) {
        camaNocheSet.add(String(c.id_cama));
      }
      if (habNocheIds.has(c.habitacion_id)) {
        camaNocheSet.add(String(c.id_cama));
      }
    });
    const totalCamasNoche = camaNocheSet.size;
    const totalCamasDia = camas.length - totalCamasNoche;

    // ── Crear motor centralizado (Single Source of Truth) ─────────────────
    const engine = new CampDataEngine({
      camas, camasCOPC, camasR220,
      habitacionesAll, habMap,
      asigActivas, asigPre,
      distribucion, solsB2B: solsB2B || [],
      camaNocheSet,
    });

    // ── Guardar estado global ────────────────────────────────────────
    _data = {
      engine,                        // ← MOTOR CENTRALIZADO
      camas, camasCOPC, camasR220,
      habitacionesAll, habsCOPC, habsR220,
      asigActivas, asigPre,          // mantenidos para renderLibre/renderBloqueadas
      ocupadosSet, distEmpMap, habMap, distribucion,
      camaNocheSet, camaById,
      habAngloIds, habNocheIds,
      totalCamasDia, totalCamasNoche,
      solsMap,
      solsB2B: solsB2B || [],
    };
    // Verificar balance logístico en consola
    const _bal = engine.getBalance();
    console.log(
      `%c[v2-detalle] BALANCE: ${_bal.total} = ${_bal.ocupadas} ocup + ${_bal.reservas} res + ${_bal.libres} lib + ${_bal.bloqueadas} bloq` +
      (_bal.isBalanced ? ' ✅' : ` ⚠️ Δ=${_bal.delta}`),
      _bal.isBalanced ? 'color:#10b981;font-weight:700' : 'color:#ef4444;font-weight:700'
    );

    renderShell(container);
    renderTab(container);

  } catch (err) {
    console.error('[v2-detalle]', err);
    container.innerHTML = errorHTML(err.message);
  }
}

// ── Shell con tabs ────────────────────────────────────────────────────────────
function renderShell(container) {
  container.innerHTML = `
    <style>
      #det-root { min-height:100vh; background:var(--bg); }

      /* Header */
      #det-header {
        background: linear-gradient(135deg,#0f172a,#1e1b4b,#312e81);
        padding: 20px 28px; display:flex; align-items:center; justify-content:space-between;
        flex-wrap:wrap; gap:12px; position:sticky; top:0; z-index:100;
        box-shadow: 0 4px 24px rgba(30,27,75,.5);
      }
      #det-header h1 { font-size:20px; font-weight:900; color:#fff; margin:0; }
      #det-header .det-subtitle { font-size:11px; color:#a5b4fc; margin-top:2px; }

      /* Tabs */
      #det-tabs {
        display: flex; gap:6px; overflow-x:auto;
        padding: 16px 20px 0; background:var(--bg-card);
        border-bottom: 2px solid var(--border);
        scrollbar-width: none;
        position: sticky; top: 72px; z-index: 99;
      }
      #det-tabs::-webkit-scrollbar { display:none; }
      .det-tab {
        padding: 10px 20px; border-radius:10px 10px 0 0;
        border: 2px solid transparent; background:transparent;
        font-size:13px; font-weight:700; color:var(--text-muted);
        cursor:pointer; transition:all .2s; white-space:nowrap;
        flex-shrink:0;
      }
      .det-tab.active {
        background: var(--bg); border-color: var(--border);
        border-bottom-color: var(--bg); color:var(--accent);
        margin-bottom: -2px;
      }
      .det-tab:hover:not(.active) { background:var(--bg); color:var(--text-primary); }

      /* Body */
      #det-body { padding: 24px 20px; max-width:1400px; margin:0 auto; }

      /* KPI cards */
      .det-kpis { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; margin-bottom:20px; }
      .det-kpi {
        background:var(--bg-card); border:1px solid var(--border);
        border-radius:16px; padding:16px; text-align:center;
        transition: transform .15s, box-shadow .15s;
      }
      .det-kpi:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,.15); }
      .det-kpi-icon { font-size:22px; margin-bottom:6px; }
      .det-kpi-val  { font-size:28px; font-weight:900; line-height:1; margin-bottom:4px; }
      .det-kpi-lbl  { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); }

      /* Turnos filtro */
      .det-turno-btns { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
      .det-turno-btn {
        padding: 8px 18px; border-radius:99px; border:2px solid var(--border);
        background:var(--bg-card); font-size:13px; font-weight:700; cursor:pointer;
        transition: all .2s; color:var(--text-secondary);
      }
      .det-turno-btn.active {
        background: linear-gradient(135deg,#6366f1,#8b5cf6);
        border-color: transparent; color:#fff;
        box-shadow: 0 4px 12px rgba(99,102,241,.4);
      }

      /* Tabla */
      .det-table-wrap { overflow-x:auto; border-radius:14px; border:1px solid var(--border); }
      .det-table { width:100%; border-collapse:collapse; min-width:700px; }
      .det-table thead { background:linear-gradient(135deg,#1e1b4b,#312e81); }
      .det-table th {
        padding:12px 14px; text-align:left; font-size:11px; font-weight:700;
        color:#a5b4fc; text-transform:uppercase; letter-spacing:.05em; white-space:nowrap;
      }
      .det-table td { padding:11px 14px; font-size:13px; border-bottom:1px solid var(--border); }
      .det-table tbody tr:hover { background:var(--bg); }
      .det-table tbody tr:last-child td { border-bottom:none; }
      .det-badge {
        display:inline-block; padding:3px 10px; border-radius:99px;
        font-size:11px; font-weight:700; white-space:nowrap;
      }

      /* Sector headers */
      .det-sector-hdr {
        font-size:13px; font-weight:900; color:var(--text-primary);
        padding:10px 0; margin:16px 0 8px; border-bottom:2px solid var(--border);
        display:flex; align-items:center; gap:8px;
      }

      /* Cards de habitación libres */
      .det-hab-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(168px,1fr)); gap:10px; }
      .det-hab-card {
        background:var(--bg-card); border:2px solid var(--border);
        border-radius:12px; padding:12px 14px;
        transition: transform .15s; cursor:default;
      }
      .det-hab-card:hover { transform:translateY(-2px); }
      .det-hab-num { font-size:13px; font-weight:900; color:var(--text-primary); }
      .det-hab-sub { font-size:11px; color:var(--text-muted); margin-top:3px; }
      .det-hab-emp { font-size:11px; font-weight:700; color:#6366f1; margin-top:4px; }

      /* Gráfico */
      .det-chart-wrap {
        background:var(--bg-card); border:1px solid var(--border);
        border-radius:16px; padding:20px; margin-bottom:20px;
        display:grid; grid-template-columns:260px 1fr; gap:24px; align-items:center;
      }
      @media(max-width:640px) { .det-chart-wrap { grid-template-columns:1fr; } }
      .det-chart-canvas { position:relative; width:100%; max-width:240px; margin:0 auto; }

      /* Empty state */
      .det-empty { text-align:center; padding:60px 20px; color:var(--text-muted); }
      .det-empty-icon { font-size:48px; margin-bottom:12px; }
      .det-empty-text { font-size:15px; font-weight:700; }
    </style>

    <div id="det-root">
      <div id="det-header">
        <div>
          <h1>📋 Detalle del Campamento</h1>
          <div class="det-subtitle">PC HOTELERÍA · Datos en vivo · ${new Date().toLocaleString('es-CL')}</div>
        </div>
        <button onclick="window.navigate('v2detalle')"
          style="padding:10px 18px;border:none;border-radius:10px;
                 background:rgba(255,255,255,.15);color:#fff;font-weight:700;
                 font-size:13px;cursor:pointer;">
          🔄 Actualizar
        </button>
      </div>

      <div id="det-tabs">
        ${[
      { k: 'total', icon: '🏨', lbl: 'Total Habitaciones' },
      { k: 'ocupadas', icon: '🔴', lbl: 'Ocupadas' },
      { k: 'reserva', icon: '📌', lbl: 'Reserva' },
      { k: 'libre', icon: '🟢', lbl: 'No Ocupado' },
      { k: 'bloqueadas', icon: '🔒', lbl: 'Bloqueadas' },
    ].map(t => `
          <button class="det-tab ${_tab === t.k ? 'active' : ''}"
                  onclick="window._detSetTab('${t.k}')">
            ${t.icon} ${t.lbl}
          </button>
        `).join('')}
      </div>

      <div id="det-body"></div>
    </div>`;

  window._detSetTab = (key) => {
    _tab = key;
    _turnoFiltro = null;
    _empresaFiltro = null;
    _supFiltro = null;
    // Resetear filtros de No Ocupado al cambiar de tab
    _libreFiltroPab = '';
    _libreFiltroPiso = '';
    document.querySelectorAll('.det-tab').forEach(el => el.classList.remove('active'));
    document.querySelector(`.det-tab[onclick*="'${key}'"]`)?.classList.add('active');
    renderTab(document.getElementById('det-body')?.closest('#page-content') || document.body);
  };

  // Filtros del tab No Ocupado (accesibles desde onclick en HTML generado)
  window.v2DetSetPab = (val) => { _libreFiltroPab = val; };
  window.v2DetSetPiso = (val) => { _libreFiltroPiso = val; };
  window.__v2ReTab = () => {
    renderTab(document.getElementById('det-body')?.closest('#page-content') || document.body);
  };
}

// ── Renderizar tab activo ─────────────────────────────────────────────────────
function renderTab(container) {
  const body = document.getElementById('det-body');
  if (!body || !_data) return;

  switch (_tab) {
    case 'total': body.innerHTML = renderTotal(); break;
    case 'ocupadas': body.innerHTML = renderOcupadas(); break;
    case 'reserva': body.innerHTML = renderReserva(); break;
    case 'libre': body.innerHTML = renderLibre(); break;
    case 'bloqueadas': body.innerHTML = renderBloqueadas(); break;
  }
  if (_tab === 'total') renderChartTotal();
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB A — TOTAL HABITACIONES
// ══════════════════════════════════════════════════════════════════════════════
function renderTotal() {
  const { camas, camasCOPC, camasR220, habsCOPC, habsR220, totalCamasDia, totalCamasNoche, engine } = _data;

  const total = camas.length;
  const copc = camasCOPC.length;
  const r220 = camasR220.length;
  const pctCopc = total > 0 ? Math.round(copc / total * 100) : 0;
  const pctR220 = total > 0 ? Math.round(r220 / total * 100) : 0;

  const pctDia = total > 0 ? Math.round(totalCamasDia / total * 100) : 0;
  const pctNoche = total > 0 ? Math.round(totalCamasNoche / total * 100) : 0;

  // ── ECUACIÓN DE BALANCE LOGÍSTICO ───────────────────────────────────────
  const bal = engine.getBalance();
  const balColor = bal.isBalanced ? '#10b981' : '#f59e0b';
  const balBg    = bal.isBalanced ? 'rgba(16,185,129,.08)' : 'rgba(245,158,11,.08)';
  const balBord  = bal.isBalanced ? '#10b981' : '#f59e0b';
  const balIcon  = bal.isBalanced ? '✅' : '⚠️';
  const balMsg   = bal.isBalanced
    ? `Balance perfecto: ninguna cama sin clasificar`
    : `Δ=${bal.delta} cama${Math.abs(bal.delta)!==1?'s':''} sin clasificar (posible dato inconsistente en BD)`;
  const balHTML = `
    <div style="background:${balBg};border:1.5px solid ${balBord};border-radius:14px;
                padding:14px 18px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:800;color:${balColor};text-transform:uppercase;
                  letter-spacing:.06em;margin-bottom:8px">${balIcon} Ecuación de Balance Logístico</div>
      <div style="font-size:13px;font-weight:700;color:var(--text-primary);line-height:1.8">
        <strong style="font-size:22px;color:${balColor}">${bal.total.toLocaleString('es-CL')}</strong>
        <span style="color:var(--text-muted)"> camas totales =</span>
        <span style="color:#ef4444"> ${bal.ocupadas.toLocaleString('es-CL')} Ocupadas</span>
        <span style="color:var(--text-muted)"> +</span>
        <span style="color:#8b5cf6"> ${bal.reservas.toLocaleString('es-CL')} Reservadas</span>
        <span style="color:var(--text-muted)"> +</span>
        <span style="color:#10b981"> ${bal.libres.toLocaleString('es-CL')} Libres</span>
        <span style="color:var(--text-muted)"> +</span>
        <span style="color:#f59e0b"> ${bal.bloqueadas.toLocaleString('es-CL')} Bloqueadas</span>
      </div>
      <div style="font-size:11px;color:${balColor};margin-top:6px;font-weight:600">${balMsg}</div>
    </div>`;

  return `
    ${kpiRow([
    { icon: '🛏️', val: total, lbl: 'Total Camas', color: '#6366f1' },
    { icon: '🏢', val: camasCOPC.length, lbl: 'Camas COPC', color: '#6366f1' },
    { icon: '🏗️', val: camasR220.length, lbl: 'Camas REF 220', color: '#0ea5e9' },
    { icon: '☀️', val: totalCamasDia, lbl: 'Camas Día', color: '#f59e0b' },
    { icon: '🌙', val: totalCamasNoche, lbl: 'Camas Noche', color: '#4338ca' },
  ])}

    ${balHTML}

    <div class="det-chart-wrap">
      <div class="det-chart-canvas">
        <canvas id="det-chart-donut" style="max-height:240px"></canvas>
      </div>
      <div>
        <div style="font-size:15px;font-weight:900;color:var(--text-primary);margin-bottom:14px">
          Distribución por Sector
        </div>
        ${sectorBar('🏢 COPC', copc, total, '#6366f1', pctCopc)}
        ${sectorBar('🏗️ REF 220', r220, total, '#0ea5e9', pctR220)}
        <div style="margin-top:18px;font-size:15px;font-weight:900;color:var(--text-primary);margin-bottom:14px">
          Día / Noche
        </div>
        ${sectorBar('☀️ Día', totalCamasDia, total, '#f59e0b', pctDia)}
        ${sectorBar('🌙 Noche', totalCamasNoche, total, '#4338ca', pctNoche)}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB B — OCUPADAS
// ══════════════════════════════════════════════════════════════════════════════
function renderOcupadas() {
  const { engine, camaNocheSet } = _data;

  // ── FUENTE ÚNICA: engine garantiza que KPIs === suma de grupos ───────────────
  const {
    data, kpiTotal, kpiCOPC, kpiR220, kpiNoche,
    porEmpresa, porGerencia, porSup, porTurno,
    todasEmpresas, todasSups,
  } = engine.getOcupadas({
    turno:            _turnoFiltro,
    empresa:          _empresaFiltro,
    superintendencia: _supFiltro,
  });

  // Tablas resumen para Gerencia y Sup
  const gerSorted = Object.entries(porGerencia).sort(([, a], [, b]) => b.total - a.total);
  const supSorted = Object.entries(porSup).sort(([, a], [, b]) => b.total - a.total);

  // ── Panel de empresas por SUPERINTENDENCIA (fuente: data filtrado, no B2B raw) ─
  // kpiTotal ya refleja el filtro de sup activo → sum(empresas) === kpiTotal ✅
  const empresasPorSupHTML = _supFiltro
    ? (() => {
      const empRows = Object.entries(porEmpresa).sort(([, a], [, b]) => b.length - a.length);
      return `
          <div style="background:var(--bg-card);border:2px solid #065f46;border-radius:14px;overflow:hidden;margin-bottom:20px">
            <div style="background:linear-gradient(135deg,#064e3b,#065f46);padding:12px 18px;display:flex;align-items:center;justify-content:space-between">
              <div>
                <div style="font-size:10px;color:#6ee7b7;font-weight:700;text-transform:uppercase;letter-spacing:.06em">📋 Superintendencia — Camas Asignadas</div>
                <div style="font-size:14px;font-weight:900;color:#fff;margin-top:2px">${_supFiltro}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:28px;font-weight:900;color:#fff">${kpiTotal}</div>
                <div style="font-size:10px;color:#6ee7b7;font-weight:700">OCUPADOS</div>
              </div>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead><tr style="background:var(--bg)">
                  <th style="padding:8px 14px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Empresa</th>
                  <th style="padding:8px 14px;text-align:center;font-size:10px;color:#6366f1;font-weight:700;text-transform:uppercase">Ocupados</th>
                </tr></thead>
                <tbody>
                  ${empRows.map(([emp, rows]) => `
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:9px 14px;font-weight:600">🏢 ${emp}</td>
                      <td style="padding:9px 14px;text-align:center;font-weight:800;color:#6366f1;font-size:16px">${rows.length}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
    })()
    : '';

  // ── Panel de empresas por TURNO (fuente: data filtrado, no B2B raw) ──────────
  // kpiTotal ya refleja el filtro de turno activo → sum(empresas) === kpiTotal ✅
  const empresasPorTurnoHTML = _turnoFiltro
    ? (() => {
      const empRows = Object.entries(porEmpresa).sort(([, a], [, b]) => b.length - a.length);
      return `
          <div style="background:var(--bg-card);border:2px solid #4338ca;border-radius:14px;overflow:hidden;margin-bottom:20px">
            <div style="background:linear-gradient(135deg,#312e81,#4338ca);padding:12px 18px;display:flex;align-items:center;justify-content:space-between">
              <div>
                <div style="font-size:10px;color:#a5b4fc;font-weight:700;text-transform:uppercase;letter-spacing:.06em">⏰ Turno — Camas Asignadas</div>
                <div style="font-size:22px;font-weight:900;color:#fff;margin-top:2px;letter-spacing:.04em">${_turnoFiltro}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:36px;font-weight:900;color:#fff">${kpiTotal}</div>
                <div style="font-size:10px;color:#a5b4fc;font-weight:700">OCUPADOS</div>
              </div>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead><tr style="background:var(--bg)">
                  <th style="padding:8px 14px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Empresa</th>
                  <th style="padding:8px 14px;text-align:center;font-size:10px;color:#6366f1;font-weight:700;text-transform:uppercase">Ocupados</th>
                  <th style="padding:8px 14px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">% del turno</th>
                </tr></thead>
                <tbody>
                  ${empRows.map(([emp, rows]) => `
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:9px 14px;font-weight:600">🏢 ${emp}</td>
                      <td style="padding:9px 14px;text-align:center;font-weight:800;color:#6366f1;font-size:16px">${rows.length}</td>
                      <td style="padding:9px 14px;text-align:center">
                        <div style="background:var(--bg);border-radius:999px;overflow:hidden;height:8px;width:100%;max-width:80px;margin:0 auto">
                          <div style="background:#6366f1;height:100%;width:${Math.round(rows.length / kpiTotal * 100)}%;border-radius:999px"></div>
                        </div>
                        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${Math.round(rows.length / kpiTotal * 100)}%</div>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
    })()
    : '';

  // ── Tabla interna por empresa ────────────────────────────────────────────────
  const tablaEmpresa = (rows) => `
    <div class="det-table-wrap" style="margin:8px">
      <table class="det-table">
        <thead><tr>
          <th>#</th><th>Trabajador</th><th>RUT</th><th>Gerencia</th><th>Superintendencia</th><th>Contrato</th><th>Hab</th><th>Turno</th><th>Estado</th>
        </tr></thead>
        <tbody>
          ${rows.map((a, i) => {
    const habNum = a.v2_camas?.v2_habitaciones?.numero_hab || '—';
    const isNoche = camaNocheSet?.has(String(a.id_cama));
    const camLbl = isNoche ? '🌙 Noche' : '☀️ Día';
    const conf = a.huesped_confirmo;
    const rowBg = conf ? 'rgba(16,185,129,.07)' : 'rgba(239,68,68,.05)';
    const rowBord = conf ? '3px solid #10b981' : '3px solid #ef4444';
    return `<tr style="background:${rowBg};border-left:${rowBord}">
              <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
              <td style="font-weight:700">${a.nombre_huesped || '—'}</td>
              <td style="font-family:monospace;font-size:12px">${a.rut_huesped || '—'}</td>
              <td style="font-size:12px">${a._gerencia}</td>
              <td style="font-size:12px">${a._superintendencia}</td>
              <td style="font-size:11px;font-family:monospace">${a.numero_contrato || '—'}</td>
              <td style="font-weight:900">Hab. ${habNum} <small style="font-weight:400;color:var(--text-muted)">${camLbl}</small></td>
              <td><span class="det-badge" style="background:#6366f122;color:#6366f1">${a._turno}</span></td>
              <td>${conf
        ? '<span class="det-badge" style="background:#10b98122;color:#059669">✅ Conf.</span>'
        : '<span class="det-badge" style="background:#ef444422;color:#dc2626">⏳ S/Conf.</span>'
      }</td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>`;

  // ── Secciones colapsables por empresa ────────────────────────────────────────
  const empresasHTML = Object.entries(porEmpresa)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([emp, rows], idx) => {
      const c = rows.filter(r => r.huesped_confirmo).length;
      const nc = rows.length - c;
      return `<details style="margin-bottom:10px;border-radius:12px;overflow:hidden;border:1px solid var(--border)" ${idx === 0 ? 'open' : ''}>
        <summary style="list-style:none;display:flex;align-items:center;gap:8px;padding:12px 16px;cursor:pointer;background:var(--bg-card);font-size:13px;font-weight:800">
          <span style="font-size:10px;color:var(--text-muted)">&#9654;</span>
          <span>&#127962; ${emp}</span>
          <span style="color:#10b981;font-size:12px">&#10003; ${c} conf.</span>
          ${nc > 0 ? `<span style="color:#ef4444;font-size:12px">${nc} s/conf.</span>` : ''}
          <span style="color:var(--text-muted);font-size:12px;margin-left:auto">${rows.length} camas</span>
        </summary>
        ${tablaEmpresa(rows)}
      </details>`;
    }).join('');



  // ── Selectores y filtros ─────────────────────────────────────────────────────
  const mkSelect = (val, opts, label, onChange) => `
    <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:200px">
      <label style="font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">${label}</label>
      <select onchange="${onChange}(this.value || null)"
        style="padding:8px 12px;border-radius:8px;border:1.5px solid ${val ? '#6366f1' : 'var(--border)'};
          background:${val ? '#6366f115' : 'var(--bg-card)'};color:var(--text);
          font-size:12px;font-weight:600;cursor:pointer;width:100%">
        <option value="">-- Todos --</option>
        ${opts.map(o => `<option value="${o.replace(/"/g, '&quot;')}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>`;

  const turnosBtns = ['Todos', ...TURNOS].map(t => {
    const activo = t === 'Todos' ? !_turnoFiltro : _turnoFiltro === t;
    return `<button onclick="window._detSetTurno('${t}')"
      style="padding:6px 14px;border-radius:999px;border:none;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;
        background:${activo ? '#6366f1' : 'var(--bg-card)'};
        color:${activo ? '#fff' : 'var(--text)'};
        box-shadow:${activo ? '0 2px 8px #6366f155' : 'none'};
        transition:all .15s">${t}</button>`;
  }).join('');

  // Global handlers
  window._empFiltro = (e) => { _empresaFiltro = e; renderTab(); };
  window._supFiltroFn = (s) => { _supFiltro = s; renderTab(); };

  return `
    ${kpiRow([
    { icon: '🔴', val: kpiTotal, lbl: 'Total Ocupadas', color: '#ef4444' },
    { icon: '🏢', val: kpiCOPC, lbl: 'Camas COPC (Día)', color: '#6366f1' },
    { icon: '🏗️', val: kpiR220, lbl: 'Camas REF 220', color: '#0ea5e9' },
    { icon: '🌙', val: kpiNoche, lbl: 'Camas Noche COPC', color: '#4338ca' },
  ])}

    <!-- Filtros -->
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;padding:16px;background:var(--bg-card);border-radius:14px;border:1px solid var(--border)">
      <div>
        <label style="font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:8px">&#x23F0; Turno</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${turnosBtns}</div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${mkSelect(_empresaFiltro, todasEmpresas, '&#127962; Empresa', 'window._empFiltro')}
        ${mkSelect(_supFiltro, todasSups, '&#x1F4CB; Superintendencia', 'window._supFiltroFn')}
        ${(_empresaFiltro || _supFiltro) ? `<div style="display:flex;align-items:flex-end"><button onclick="_empresaFiltro=null;_supFiltro=null;renderTab()"
          style="padding:8px 16px;border-radius:8px;border:none;cursor:pointer;background:#ef444422;color:#ef4444;font-weight:700;font-size:12px">
          ✕ Limpiar filtros
        </button></div>` : ''}
      </div>
    </div>

    <!-- Resumen Gerencia y Superintendencia lado a lado -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:4px">
      ${tablaResumen('📊 Por Gerencia', 'linear-gradient(135deg,#1e1b4b,#312e81)', gerSorted)}
      ${tablaResumen('📋 Por Superintendencia', 'linear-gradient(135deg,#064e3b,#065f46)', supSorted)}
    </div>

    <!-- Panel Empresas por Superintendencia -->
    ${empresasPorSupHTML}

    <!-- Panel Empresas por Turno -->
    ${empresasPorTurnoHTML}

    <!-- Lista por empresa (asignaciones activas) -->
    ${data.length === 0
      ? `<div class="det-empty"><div class="det-empty-icon">📌</div><div class="det-empty-text">No hay ocupados con ese filtro</div></div>`
      : empresasHTML}
  `;
}






// ══════════════════════════════════════════════════════════════════════════════
// TAB C — RESERVA (PRE-ASIGNADOS)
// ══════════════════════════════════════════════════════════════════════════════
function renderReserva() {
  const { engine } = _data;

  // ── FUENTE ÚNICA: engine garantiza KPIs === suma de grupos ───────────────────
  const {
    data, kpiTotal, kpiCOPC, kpiR220,
    porEmpresa, porGerencia, porSup, porTurno,
    todasEmpresas, todasSups,
  } = engine.getReservas({
    turno:            _turnoFiltro,
    empresa:          _empresaFiltro,
    superintendencia: _supFiltro,
  });

  const preCopc = kpiCOPC;
  const preR220 = kpiR220;

  const gerSorted = Object.entries(porGerencia).sort(([, a], [, b]) => b.total - a.total);
  const supSorted = Object.entries(porSup).sort(([, a], [, b]) => b.total - a.total);

  // Panel de empresas cuando hay filtro de superintendencia seleccionado
  // Fuente: porEmpresa (del engine, filtrado por sup) → sum(empresas) === kpiTotal ✅
  const empresasPorSupHTML = _supFiltro
    ? (() => {
      const empRows = Object.entries(porEmpresa).sort(([, a], [, b]) => b.length - a.length);
      return `
          <div style="background:var(--bg-card);border:2px solid #065f46;border-radius:14px;overflow:hidden;margin-bottom:20px">
            <div style="background:linear-gradient(135deg,#064e3b,#065f46);padding:12px 18px;display:flex;align-items:center;justify-content:space-between">
              <div>
                <div style="font-size:10px;color:#6ee7b7;font-weight:700;text-transform:uppercase;letter-spacing:.06em">📋 Superintendencia (Reservas)</div>
                <div style="font-size:14px;font-weight:900;color:#fff;margin-top:2px">${_supFiltro}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:28px;font-weight:900;color:#fff">${kpiTotal}</div>
                <div style="font-size:10px;color:#6ee7b7;font-weight:700">RESERVADOS</div>
              </div>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead><tr style="background:var(--bg)">
                  <th style="padding:8px 14px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Empresa</th>
                  <th style="padding:8px 14px;text-align:center;font-size:10px;color:#6366f1;font-weight:700;text-transform:uppercase">Reservados</th>
                </tr></thead>
                <tbody>
                  ${empRows.map(([emp, rows]) => `
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:9px 14px;font-weight:600">🏢 ${emp}</td>
                      <td style="padding:9px 14px;text-align:center;font-weight:800;color:#6366f1;font-size:16px">${rows.length}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
    })()
    : '';

  // Panel de empresas cuando hay filtro de turno seleccionado
  // Fuente: porEmpresa (del engine, filtrado por turno) → sum(empresas) === kpiTotal ✅
  const empresasPorTurnoHTML = _turnoFiltro
    ? (() => {
      const empRows = Object.entries(porEmpresa).sort(([, a], [, b]) => b.length - a.length);
      return `
          <div style="background:var(--bg-card);border:2px solid #4338ca;border-radius:14px;overflow:hidden;margin-bottom:20px">
            <div style="background:linear-gradient(135deg,#312e81,#4338ca);padding:12px 18px;display:flex;align-items:center;justify-content:space-between">
              <div>
                <div style="font-size:10px;color:#a5b4fc;font-weight:700;text-transform:uppercase;letter-spacing:.06em">⏰ Turno Seleccionado (Reservas)</div>
                <div style="font-size:22px;font-weight:900;color:#fff;margin-top:2px;letter-spacing:.04em">${_turnoFiltro}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:36px;font-weight:900;color:#fff">${kpiTotal}</div>
                <div style="font-size:10px;color:#a5b4fc;font-weight:700">RESERVADOS</div>
              </div>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead><tr style="background:var(--bg)">
                  <th style="padding:8px 14px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Empresa</th>
                  <th style="padding:8px 14px;text-align:center;font-size:10px;color:#6366f1;font-weight:700;text-transform:uppercase">Reservados</th>
                  <th style="padding:8px 14px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">% del turno</th>
                </tr></thead>
                <tbody>
                  ${empRows.map(([emp, rows]) => `
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:9px 14px;font-weight:600">🏢 ${emp}</td>
                      <td style="padding:9px 14px;text-align:center;font-weight:800;color:#6366f1;font-size:16px">${rows.length}</td>
                      <td style="padding:9px 14px;text-align:center">
                        <div style="background:var(--bg);border-radius:999px;overflow:hidden;height:8px;width:100%;max-width:80px;margin:0 auto">
                          <div style="background:#6366f1;height:100%;width:${Math.round(rows.length / kpiTotal * 100)}%;border-radius:999px"></div>
                        </div>
                        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${Math.round(rows.length / kpiTotal * 100)}%</div>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
    })()
    : '';


  // ── Render HTML de Empresas (Listado interno de trabajadores) ────────────────
  const tablaEmpresa = (rows) => `
    <div class="det-table-wrap" style="margin:8px">
      <table class="det-table">
        <thead><tr>
          <th>#</th><th>Trabajador</th><th>RUT</th><th>Gerencia</th><th>Superintendencia</th><th>Contrato</th><th>Hab</th><th>Turno</th>
        </tr></thead>
        <tbody>
          ${rows.map((a, i) => {
    const habNum = a.v2_camas?.v2_habitaciones?.numero_hab || '—';
    const rowBg = 'rgba(139,92,246,.05)';
    const rowBord = '3px solid #8b5cf6';
    return `<tr style="background:${rowBg};border-left:${rowBord}">
              <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
              <td style="font-weight:700">${a.nombre_huesped || '—'}</td>
              <td style="font-family:monospace;font-size:12px">${a.rut_huesped || '—'}</td>
              <td style="font-size:12px">${a._gerencia}</td>
              <td style="font-size:11px;color:var(--text-muted)">${a._superintendencia}</td>
              <td style="font-family:monospace;font-size:11px">${a.numero_contrato || '—'}</td>
              <td style="font-weight:900">Hab. ${habNum}</td>
              <td><span class="det-badge" style="background:rgba(139,92,246,0.1);color:#8b5cf6">${a._turno}</span></td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>`;

  const empKeys = Object.keys(porEmpresa).sort((a, b) => porEmpresa[b].length - porEmpresa[a].length);
  const empresasHTML = empKeys.map(emp => `
    <details class="det-emp-card">
      <summary class="det-emp-sum">
        <div class="det-emp-sum-left">
          <div class="det-emp-icon">🏢</div>
          <div class="det-emp-name">${emp}</div>
        </div>
        <div class="det-emp-sum-right">
          <div class="det-emp-count">${porEmpresa[emp].length} <span style="font-size:11px;font-weight:600;opacity:.7">reservas</span></div>
        </div>
      </summary>
      ${tablaEmpresa(porEmpresa[emp])}
    </details>
  `).join('');

  // ── Selectores y filtros ─────────────────────────────────────────────────────
  const mkSelect = (val, opts, label, onChange) => `
    <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:200px">
      <label style="font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">${label}</label>
      <select onchange="${onChange}(this.value || null)"
        style="padding:8px 12px;border-radius:8px;border:1.5px solid ${val ? '#8b5cf6' : 'var(--border)'};
          background:${val ? '#8b5cf615' : 'var(--bg-card)'};color:var(--text);
          font-size:12px;font-weight:600;cursor:pointer;width:100%">
        <option value="">-- Todos --</option>
        ${opts.map(o => `<option value="${o.replace(/"/g, '&quot;')}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>`;

  const TURNOS_SYS = ['4x3', '4x4', '5x2', '7x7', '8x6', '10x10', '14x14'];
  const turnosBtns = ['Todos', ...TURNOS_SYS].map(t => {
    const activo = t === 'Todos' ? !_turnoFiltro : _turnoFiltro === t;
    return `<button onclick="window._detSetTurno('${t}')"
      style="padding:6px 14px;border-radius:999px;border:none;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;
        background:${activo ? '#8b5cf6' : 'var(--bg-card)'};
        color:${activo ? '#fff' : 'var(--text)'};
        box-shadow:${activo ? '0 2px 8px #8b5cf655' : 'none'};
        transition:all .15s">${t}</button>`;
  }).join('');

  return `
    ${kpiRow([
    { icon: '📌', val: kpiTotal, lbl: 'Total Pre-asignadas', color: '#8b5cf6' },
    { icon: '🏢', val: preCopc, lbl: 'COPC Reservadas', color: '#6366f1' },
    { icon: '🏗️', val: preR220, lbl: 'REF 220 Reservadas', color: '#0ea5e9' },
  ])}

    <!-- Filtros -->
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;padding:16px;background:var(--bg-card);border-radius:14px;border:1px solid var(--border)">
      <div>
        <label style="font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:8px">&#x23F0; Turno</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${turnosBtns}</div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${mkSelect(_empresaFiltro, todasEmpresas, '&#127962; Empresa', 'window._empFiltro')}
        ${mkSelect(_supFiltro, todasSups, '&#x1F4CB; Superintendencia', 'window._supFiltroFn')}
        ${(_empresaFiltro || _supFiltro) ? `<div style="display:flex;align-items:flex-end"><button onclick="_empresaFiltro=null;_supFiltro=null;renderTab()"
          style="padding:8px 16px;border-radius:8px;border:none;cursor:pointer;background:#ef444422;color:#ef4444;font-weight:700;font-size:12px">
          ✕ Limpiar filtros
        </button></div>` : ''}
      </div>
    </div>

    <!-- Resumen Gerencia y Superintendencia lado a lado -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:4px">
      ${tablaResumen('📊 Por Gerencia (Reservas)', 'linear-gradient(135deg,#1e1b4b,#312e81)', gerSorted)}
      ${tablaResumen('📋 Por Superintendencia (Reservas)', 'linear-gradient(135deg,#064e3b,#065f46)', supSorted)}
    </div>

    <!-- Panel Empresas por Superintendencia -->
    ${empresasPorSupHTML}

    <!-- Panel Empresas por Turno -->
    ${empresasPorTurnoHTML}

    <!-- Lista por empresa (asignaciones en reserva) -->
    ${data.length === 0
      ? `<div class="det-empty"><div class="det-empty-icon">📌</div><div class="det-empty-text">No hay reservas con ese filtro</div></div>`
      : empresasHTML}
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB D — NO OCUPADO
// ══════════════════════════════════════════════════════════════════════════════
function renderLibre() {
  const { camas, camasCOPC, camasR220, ocupadosSet, distEmpMap, habMap, asigPre,
    camaNocheSet, habAngloIds, habNocheIds, camaById } = _data;
  const preSet = new Set(asigPre.map(a => String(a.id_cama)));

  // Una cama es libre si: no está ocupada, no es pre-asignada futura, y no está en mantencion
  const esLibre = c =>
    !ocupadosSet.has(String(c.id_cama)) &&
    !preSet.has(String(c.id_cama)) &&
    !/manten|reparac/i.test(c.estado || '');

  const libresCOPC = camasCOPC.filter(esLibre);
  const libresR220 = camasR220.filter(esLibre);
  const libresAll = [...libresCOPC, ...libresR220];

  // ─ Clasificar camas libres por tipo ────────────────────────────────────
  // Anglo C1 (cama 1 = da) : habitación con etiqueta anglo + numero_cama = 1
  // Anglo C2 (cama 2 = noche): habitación con etiqueta anglo + numero_cama = 2
  // Noche pura : habitación con etiqueta "noche" (sin ser Anglo)
  // EECC : todo lo demás

  const libresAngloDia = [];
  const libresAngloNoche = [];
  const libresNochePura = [];
  const libresEECC = [];

  libresAll.forEach(c => {
    const cRec = camaById?.[String(c.id_cama)] || c;
    const habId = cRec.habitacion_id || c.habitacion_id;
    const numCama = Number(cRec.numero_cama || c.numero_cama || 0);

    if (habAngloIds?.has(habId)) {
      // Habitación Anglo: C1 = día, C2 = noche
      if (numCama === 1) libresAngloDia.push(c);
      else libresAngloNoche.push(c);
    } else if (habNocheIds?.has(habId)) {
      // Habitación con etiqueta Noche pura
      libresNochePura.push(c);
    } else {
      // Todo lo demás = EECC
      libresEECC.push(c);
    }
  });

  // ─ Helper: extraer número de habitación legible desde id_cama R-220 ────────
  // id_cama ejemplo: "R-220000010" → extraemos los últimos dígitos útiles
  // La lógica de naming: R-220[pabellon][piso][hab] pero como son IDs de BD
  // simplemente mostramos el número de habitación que viene de numero_hab en habMap.
  // Si no está disponible, limpiamos el ID para no mostrar el raw de BD.
  const _numHabLegible = (hab, idCama) => {
    if (hab?.numero_hab) return String(hab.numero_hab);
    // Fallback: limpiar el id_cama para mostrar algo útil
    // R-220000010 → 220000010 → intentar extraer últimos dígitos como número de hab
    const raw = String(idCama || '').replace(/^R[.-]?/i, '').trim();
    // Si son puros dígitos, mostrar como número de hab
    if (/^\d+$/.test(raw)) {
      // Quitar ceros a la izquierda excesivos pero preservar el número
      return raw.replace(/^0+/, '') || raw;
    }
    return raw || '—';
  };

  // ─ Construir mapa enriquecido habitacion_id → {numHab, pabellon, piso, camas, empresa} ─
  // La fuente preferida de numero_hab es c.v2_habitaciones (join directo en el fetch).
  // Si no está disponible, se busca en habMap. Si tampoco, se limpia el id_cama.
  const grupoHabs = {};
  [...libresCOPC, ...libresR220].forEach(c => {
    const hid = String(c.habitacion_id || c.id_cama || 'sin-hab');
    if (!grupoHabs[hid]) {
      // 1º prioridad: join embebido en el fetch de camas
      const habEmbed = c.v2_habitaciones || null;
      // 2º prioridad: habMap por habitacion_id o id_cama
      const habFallback = habMap[hid] || habMap[String(c.id_cama)] || null;
      const hab = habEmbed || habFallback;

      // Número de habitación: lo que esté en numero_hab, si no limpiamos el id
      const numHab = hab?.numero_hab
        ? String(hab.numero_hab)
        : _numHabLegible(null, c.id_cama);

      // Pabellón y piso: extraer de numero_hab (formato PPFF, ej: 1302 → P1, Piso 3)
      const pabellon = _extraerPabellon(numHab);
      const piso     = _extraerPiso(numHab);

      grupoHabs[hid] = {
        numHab, pabellon, piso, camas: [], empresa: null,
        isR220: isR220(c.id_cama)
      };
    }
    grupoHabs[hid].camas.push(c);
    const emp = distEmpMap[String(c.id_cama)];
    if (emp) grupoHabs[hid].empresa = emp;
  });

  // ─ Listas únicas para filtros ────────────────────────────────────────────
  const pabellonesUnicos = [...new Set(
    Object.values(grupoHabs).map(g => g.pabellon).filter(p => p !== '?')
  )].sort();
  const pisosUnicos = [...new Set(
    Object.values(grupoHabs).map(g => g.piso).filter(p => p !== '?')
  )].sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));

  // ─ Aplicar filtros activos ───────────────────────────────────────────────
  const habsFiltradas = Object.values(grupoHabs).filter(g => {
    if (_libreFiltroPab && g.pabellon !== _libreFiltroPab) return false;
    if (_libreFiltroPiso && g.piso !== _libreFiltroPiso) return false;
    return true;
  });

  // Total de camas en el filtro
  const totalCamasFiltradas = habsFiltradas.reduce((s, g) => s + g.camas.length, 0);
  const retenidas = Object.values(grupoHabs).filter(g => g.empresa).length;

  // ─ Agrupar por piso (para display) ──────────────────────────────────────
  const porPiso = {};
  habsFiltradas
    .sort((a, b) => parseInt(a.numHab) - parseInt(b.numHab))
    .forEach(g => {
      const pisoKey = g.piso;   // ej: "Piso 3"
      if (!porPiso[pisoKey]) porPiso[pisoKey] = [];
      porPiso[pisoKey].push(g);
    });

  // ─ Helpers de render ────────────────────────────────────────────────────
  const btnFiltro = (label, val, current, setFn) => {
    const active = val === current;
    return `<button onclick="${setFn}('${val.replace(/'/g, "\\'")}');__v2ReTab();"
      style="padding:5px 12px;border-radius:20px;border:1.5px solid ${active ? '#10b981' : 'var(--border)'};
             background:${active ? '#10b98122' : 'transparent'};color:${active ? '#10b981' : 'var(--text-muted)'};
             font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">${label}</button>`;
  };

  const kpiBox = (icon, val, lbl, color, sub = '') => `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-top:3px solid ${color};border-radius:14px;padding:14px 16px;text-align:center;flex:1;min-width:130px">
      <div style="font-size:20px;margin-bottom:4px">${icon}</div>
      <div style="font-size:28px;font-weight:900;color:${color};line-height:1">${val.toLocaleString('es-CL')}</div>
      <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-top:4px">${lbl}</div>
      ${sub ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${sub}</div>` : ''}
    </div>`;

  const renderCard = (g) => {
    const camasLabel = g.camas
      .map(c => `C${c.numero_cama || '?'}`)
      .sort().join(' · ');
    const sector = g.isR220 ? '🏗️ REF 220' : '🏢 COPC';
    // Construir etiqueta de pabellón/piso solo si el número tiene formato PPFF (4 dígitos)
    const numStr = String(g.numHab || '');
    const tienePabPiso = /^\d{4,}$/.test(numStr.replace(/\D/g, ''));
    const pabPisoLabel = tienePabPiso && g.pabellon !== '?'
      ? ` · 📍${g.pabellon}` : '';
    return `<div class="det-hab-card" style="border-color:${g.empresa ? '#6366f1' : '#10b981'}">
      <div class="det-hab-num" style="font-size:20px;font-weight:900">🏠 Hab. ${g.numHab}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:1px">${sector}${pabPisoLabel}</div>
      <div class="det-hab-sub" style="margin-top:4px">— ${g.camas.length} cama${g.camas.length > 1 ? 's' : ''} libre${g.camas.length > 1 ? 's' : ''}</div>
      <div style="font-size:11px;color:#10b981;font-weight:700;margin-top:2px">${camasLabel}</div>
      ${g.empresa ? `<div class="det-hab-emp">🏢 Retenida: ${g.empresa}</div>` : ''}
    </div>`;
  };

  const pisosSections = Object.entries(porPiso)
    .sort(([a], [b]) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))
    .map(([piso, habs]) => {
      const totalCamas = habs.reduce((s, g) => s + g.camas.length, 0);
      const pabsEnPiso = [...new Set(habs.map(g => g.pabellon))].sort().join(', ');
      return `
        <div style="margin-bottom:24px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;
                      padding:8px 14px;background:var(--bg-card);border-radius:10px;border-left:3px solid #10b981">
            <span style="font-size:15px;font-weight:900;color:#10b981">🏢 ${piso}</span>
            <span style="font-size:13px;color:var(--text-muted)">
              ${habs.length} hab libres · ${totalCamas} camas libres
              ${!_libreFiltroPab && pabsEnPiso ? ` · Pabellones: ${pabsEnPiso}` : ''}
            </span>
          </div>
          <div class="det-hab-grid">${habs.map(renderCard).join('')}</div>
        </div>`;
    }).join('');

  return `
    <!-- KPIs principales -->
    ${kpiRow([
    { icon: '🟢', val: libresAll.length, lbl: 'Total Libres', color: '#10b981' },
    { icon: '🏢', val: libresCOPC.length, lbl: 'COPC Libres', color: '#6366f1' },
    { icon: '🏗️', val: libresR220.length, lbl: 'REF 220 Libres', color: '#0ea5e9' },
    { icon: '🏢', val: retenidas, lbl: 'Retenidas Empresa', color: '#8b5cf6' },
  ])}

    <!-- Desglose por tipo -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
      ${kpiBox('☀️', libresAngloDia.length, 'Anglo C1 (Día)', '#d97706', 'Cama 1 — turno día')}
      ${kpiBox('🌙', libresAngloNoche.length, 'Anglo C2 (Noche)', '#4338ca', 'Cama 2 — turno noche')}
      ${libresNochePura.length > 0 ? kpiBox('🌙', libresNochePura.length, 'Camas Noche', '#7c3aed', 'Etiqueta "noche"') : ''}
      ${kpiBox('🏢', libresEECC.length, 'Camas EECC', '#059669', 'Contratistas')}
    </div>

    <!-- Filtros -->
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">🔍 Filtrar por Pabellón</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${pisosUnicos.length ? '12px' : '0'}">
        ${btnFiltro('Todos', '', '_libreFiltroPab' in window ? _libreFiltroPab : '', `v2DetSetPab`)}
        ${pabellonesUnicos.map(p => btnFiltro(p, p, _libreFiltroPab, 'v2DetSetPab')).join('')}
      </div>
      ${pisosUnicos.length ? `
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">🏢 Filtrar por Piso</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${btnFiltro('Todos', '', _libreFiltroPiso, 'v2DetSetPiso')}
      ${pisosUnicos.map(p => btnFiltro(p, p, _libreFiltroPiso, 'v2DetSetPiso')).join('')}
      </div>` : ''}
    </div>

    <!-- Info filtrado -->
    ${_libreFiltroPab || _libreFiltroPiso ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#15803d;font-weight:700">
      ✅ Mostrando: ${habsFiltradas.length} habitaciones · ${totalCamasFiltradas} camas libres
      ${_libreFiltroPab ? ` · Pabellón: ${_libreFiltroPab}` : ''}
      ${_libreFiltroPiso ? ` · Piso: ${_libreFiltroPiso}` : ''}
    </div>` : ''}

    <!-- Info borde -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:10px 16px;margin-bottom:16px;font-size:12px;color:#15803d;font-weight:600">
      ℹ️ Borde <strong>verde</strong> = libre · Borde <strong>azul</strong> = retenida por empresa
    </div>

    <!-- Habitaciones agrupadas por piso -->
    ${Object.keys(porPiso).length
      ? pisosSections
      : `<div class="det-empty"><div class="det-empty-icon">✅</div><div class="det-empty-text">No hay camas libres con ese filtro</div></div>`
    }`;
}


// ══════════════════════════════════════════════════════════════════════════════
// TAB E — BLOQUEADAS
// ══════════════════════════════════════════════════════════════════════════════
function renderBloqueadas() {
  const { habitacionesAll } = _data;
  const isBloq = h => /manten|reparac|bloquea|bloqu/i.test(h.estado || '');
  const bloqAll = habitacionesAll.filter(isBloq);
  const bloqCOPC = bloqAll.filter(h => !isR220(h.id));
  const bloqR220 = bloqAll.filter(h => isR220(h.id));
  const hoy = new Date();
  const diasDesde = f => f ? Math.floor((hoy - new Date(f)) / 86400000) : null;

  const renderTable = (arr) => {
    if (!arr.length) return `<div class="det-empty"><div class="det-empty-icon">✅</div><div class="det-empty-text">No hay habitaciones bloqueadas en este sector</div></div>`;
    return `<div class="det-table-wrap" style="margin-bottom:20px">
          <table class="det-table">
            <thead><tr>
              <th>Habitación</th><th>Pabellón</th><th>Estado / Motivo</th>
              <th>Fecha Bloqueo</th><th>Días Bloqueada</th>
            </tr></thead>
            <tbody>
              ${arr.map(h => {
      const pab = h.v2_pabellones?.nombre || h.pabellon || '—';
      const motivo = h.motivo_bloqueo || h.estado || 'Sin motivo';
      const dias = diasDesde(h.fecha_bloqueo);
      const color = /reparac/i.test(h.estado) ? '#ef4444' : '#f59e0b';
      return `<tr>
                  <td style="font-weight:900">Hab. ${h.numero_hab || h.id}</td>
                  <td>${pab}</td>
                  <td><span class="det-badge" style="background:${color}22;color:${color}">${motivo}</span></td>
                  <td>${h.fecha_bloqueo ? new Date(h.fecha_bloqueo).toLocaleDateString('es-CL') : '—'}</td>
                  <td>${dias !== null
          ? `<span style="font-weight:900;color:${dias > 30 ? '#ef4444' : dias > 7 ? '#f59e0b' : '#64748b'}">${dias} días</span>`
          : '<span style="color:var(--text-muted)">—</span>'}</td>
                </tr>`;
    }).join('')}
            </tbody>
          </table>
        </div>`;
  };

  return `
    ${kpiRow([
    { icon: '🔒', val: bloqAll.length, lbl: 'Total Bloqueadas', color: '#f59e0b' },
    { icon: '🏢', val: bloqCOPC.length, lbl: 'COPC Bloqueadas', color: '#6366f1' },
    { icon: '🏗️', val: bloqR220.length, lbl: 'REF 220 Bloqueadas', color: '#0ea5e9' },
    { icon: '🔧', val: bloqAll.filter(h => /reparac/i.test(h.estado || '')).length, lbl: 'En Reparación', color: '#ef4444' },
    { icon: '🛠️', val: bloqAll.filter(h => /manten/i.test(h.estado || '')).length, lbl: 'En Mantención', color: '#f59e0b' },
  ])}
    <div class="det-sector-hdr">🏢 COPC — ${bloqCOPC.length} habitaciones bloqueadas</div>
    ${renderTable(bloqCOPC)}
    <div class="det-sector-hdr" style="margin-top:8px">🏗️ REF 220 — ${bloqR220.length} habitaciones bloqueadas</div>
    ${renderTable(bloqR220)}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLA DE ASIGNACIONES (compartida Ocupadas y Reserva)
// ══════════════════════════════════════════════════════════════════════════════
function tablaAsignaciones(data, modo) {
  if (!data.length) return `
      <div class="det-empty">
        <div class="det-empty-icon">${modo === 'ocupadas' ? '📌' : '📌'}</div>
        <div class="det-empty-text">No hay ${modo === 'ocupadas' ? 'camas ocupadas' : 'reservas'} con ese filtro</div>
      </div>`;

  // Separar por sector
  const copcData = data.filter(a => !isR220(a.id_cama));
  const r220Data = data.filter(a => isR220(a.id_cama));

  const renderSector = (arr, label) => {
    if (!arr.length) return '';
    return `
        <div class="det-sector-hdr">${label} — ${arr.length} ${modo === 'ocupadas' ? 'ocupadas' : 'reservadas'}</div>
        <div class="det-table-wrap" style="margin-bottom:20px">
          <table class="det-table">
            <thead><tr>
              <th>#</th>
              <th>Trabajador</th>
              <th>RUT</th>
              <th>Empresa</th>
              <th>Gerencia</th>
              <th>Superintendencia</th>
              <th>Habitación</th>
              <th>Cama</th>
              <th>Turno</th>
              ${modo === 'ocupadas'
        ? '<th>Check-in</th><th>Salida</th><th>Contrato</th>'
        : '<th>Ingreso Prev.</th><th>Salida Prev.</th>'}
            </tr></thead>
            <tbody>
              ${arr.map((a, i) => {
          // Número de habitación — priorizar join de camas
          const habNum = a.v2_camas?.v2_habitaciones?.numero_hab || '—';
          const numCam = a.v2_camas?.numero_cama;
          const camLbl = numCam === 1 ? '☀️ Día' : numCam === 2 ? '🌙 Noche' : numCam === 3 ? '➕ Extra' : '—';
          const checkin = a.fecha_checkin ? new Date(a.fecha_checkin).toLocaleDateString('es-CL') : '—';
          const salida = a.fecha_salida_programada ? new Date(a.fecha_salida_programada).toLocaleDateString('es-CL') : '—';
          const turnoColor = '#6366f1';

          return `<tr>
                  <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
                  <td style="font-weight:700">${a.nombre_huesped || '—'}</td>
                  <td style="font-family:monospace;font-size:12px">${a.rut_huesped || '—'}</td>
                  <td style="font-weight:700;color:#6366f1">${a._empresa}</td>
                  <td style="font-size:12px;max-width:180px">${a._gerencia}</td>
                  <td style="font-size:11px;color:var(--text-muted);max-width:180px">${a._superintendencia}</td>
                  <td style="font-weight:900">Hab. ${habNum}</td>
                  <td>${camLbl}</td>
                  <td><span class="det-badge" style="background:${turnoColor}22;color:${turnoColor}">${a._turno}</span></td>
                  ${modo === 'ocupadas'
              ? `<td style="font-size:12px">${checkin}</td><td style="font-size:12px">${salida}</td><td style="font-size:11px;font-family:monospace">${a.numero_contrato || '—'}</td>`
              : `<td style="font-size:12px">${checkin}</td><td style="font-size:12px">${salida}</td>`}
                </tr>`;
        }).join('')}
            </tbody>
          </table>
        </div>`;
  };

  return renderSector(copcData, '🏢 COPC') + renderSector(r220Data, '🏗️ REF 220');
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS COMPARTIDOS
// ══════════════════════════════════════════════════════════════════════════════

/** Tabla resumen genérica (usada en Ocupadas y Reservas) */
function tablaResumen(titulo, color, filas) {
  return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:20px">
      <div style="background:${color};padding:10px 16px;font-size:13px;font-weight:800;color:#fff">
        ${titulo}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--bg)">
            <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Nombre</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#6366f1;font-weight:700;text-transform:uppercase">Total</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#10b981;font-weight:700;text-transform:uppercase">Conf.</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#ef4444;font-weight:700;text-transform:uppercase">S/Conf.</th>
          </tr></thead>
          <tbody>
            ${filas.length ? filas.map(([nombre, d]) => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:8px 12px;font-weight:600">${nombre}</td>
                <td style="padding:8px 12px;text-align:center;font-weight:800;color:#6366f1">${d.total}</td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;color:#10b981">${d.conf}</td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;color:#ef4444">${d.total - d.conf}</td>
              </tr>`).join('')
      : '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text-muted)">Sin datos</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

/** Normaliza turno para comparación robusta: "7x7", "7X7", "7 X 7" → "7X7" */
function normTurno(t) {
  return String(t || '').toUpperCase().replace(/\s/g, '').trim();
}

function kpiRow(items) {
  return `<div class="det-kpis">
      ${items.map(k => `
        <div class="det-kpi" style="border-top:3px solid ${k.color}">
          <div class="det-kpi-icon">${k.icon}</div>
          <div class="det-kpi-val" style="color:${k.color}">${typeof k.val === 'number' ? k.val.toLocaleString('es-CL') : k.val}</div>
          <div class="det-kpi-lbl">${k.lbl}</div>
        </div>`).join('')}
    </div>`;
}

function turnoFiltros() {
  // Turnos dinámicos: los que realmente tienen datos en asigActivas
  const turnos = _data
    ? [...new Set((_data.asigActivas || []).map(a => a._turno || '').filter(Boolean))].sort()
    : TURNOS;

  const selT = _turnoFiltro || '';
  const optsT = turnos.map(t => `<option value="${t}" ${selT === t ? 'selected' : ''}>${t}</option>`).join('');

  return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
    <label style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap">Turno:</label>
    <div style="position:relative;min-width:180px">
      <select onchange="window._detSetTurno(this.value)"
        style="width:100%;padding:8px 32px 8px 12px;border-radius:10px;border:1.5px solid var(--border);
          background:${_turnoFiltro ? '#6366f1' : 'var(--bg-card)'};
          color:${_turnoFiltro ? '#fff' : 'var(--text)'};
          font-size:13px;font-weight:600;cursor:pointer;appearance:none;-webkit-appearance:none;outline:none;
          box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <option value="">-- Todos los turnos (${_data?.asigActivas?.length || 0}) --</option>
        ${optsT}
      </select>
      <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:11px;color:${_turnoFiltro ? '#fff' : 'var(--text-muted)'}">&#9660;</span>
    </div>
    ${_turnoFiltro ? `<button onclick="window._detSetTurno('')" style="padding:7px 14px;border-radius:8px;border:none;cursor:pointer;background:#ef444420;color:#ef4444;font-size:12px;font-weight:700">&#10005; Limpiar</button>` : ''}
  </div>`;
}

window._detSetTurno = (t) => {
  _turnoFiltro = t === 'Todos' || t === '' ? null : t;
  renderTab(null);
};

function sectorBar(label, val, total, color, pct) {
  return `
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-size:13px;font-weight:700;color:var(--text-primary)">${label}</span>
        <span style="font-size:14px;font-weight:900;color:${color}">${val.toLocaleString('es-CL')} <span style="font-size:12px;color:var(--text-muted)">(${pct}%)</span></span>
      </div>
      <div style="height:10px;background:var(--border);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width 1s"></div>
      </div>
    </div>`;
}

function miniStat(label, val, color) {
  return `<div style="text-align:center;background:var(--bg);border-radius:10px;padding:10px;border:1px solid var(--border)">
      <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase">${label}</div>
      <div style="font-size:22px;font-weight:900;color:${color}">${val}</div>
    </div>`;
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" style="text-align:center;color:var(--text-muted);padding:30px">${msg}</td></tr>`;
}

// ── Gráfico Donut Total ───────────────────────────────────────────────────────
function renderChartTotal() {
  const canvas = document.getElementById('det-chart-donut');
  if (!canvas || !window.Chart) return;
  const { camasCOPC, camasR220, camaNocheSet } = _data;

  // Separar en 3 segmentos:
  //   1. COPC Día   (camas COPC no en nocheSet) → morado
  //   2. REF220 Día (camas REF220 no en nocheSet) → azul cian
  //   3. Noche      (todas las camas en nocheSet)  → ámbar dorado
  const copcDia = camasCOPC.filter(c => !camaNocheSet.has(String(c.id_cama))).length;
  const r220Dia = camasR220.filter(c => !camaNocheSet.has(String(c.id_cama))).length;
  const totalNoche = camaNocheSet.size;

  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['🏢 COPC Día', '🏗️ REF 220 Día', '🌙 Noche'],
      datasets: [{
        data: [copcDia, r220Dia, totalNoche],
        backgroundColor: ['#6366f1', '#0ea5e9', '#f59e0b'],
        borderColor: ['#4f46e5', '#0284c7', '#d97706'],
        borderWidth: 2,
        hoverOffset: 8,
      }]
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { family: 'Inter', size: 12 }, color: '#94a3b8', padding: 14 }
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw.toLocaleString('es-CL')} camas` }
        }
      }
    }
  });
}

// ── Skeleton & Error ──────────────────────────────────────────────────────────
function skeletonHTML() {
  return `<div style="padding:28px;max-width:1200px;margin:0 auto">
      <div style="height:72px;background:linear-gradient(135deg,#1e1b4b,#312e81);border-radius:16px;margin-bottom:20px"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px">
        ${[1, 2, 3, 4, 5].map(() => `<div style="height:90px;background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);background-size:400% 100%;animation:_skShimmer 1.2s ease infinite;border-radius:14px"></div>`).join('')}
      </div>
      <div style="height:320px;background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);background-size:400% 100%;animation:_skShimmer 1.2s ease infinite;border-radius:14px"></div>
      <style>@keyframes _skShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}</style>
    </div>`;
}

function errorHTML(msg) {
  return `<div style="padding:60px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">⚠️</div>
      <div style="font-weight:800;font-size:18px;color:var(--text-primary);margin-bottom:8px">Error al cargar el módulo Detalle</div>
      <div style="font-size:13px;color:#ef4444;font-family:monospace;margin-bottom:24px">${msg}</div>
      <button onclick="window.navigate('v2detalle')"
        style="background:#6366f1;color:white;border:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:700;cursor:pointer">
        🔄 Reintentar
      </button>
    </div>`;
}
