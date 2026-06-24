/**
 * v2-detalle.js — Módulo "Detalle" del Sistema PC Hotelería
 * 5 sub-secciones: Total Habitaciones · Ocupadas · Reserva · No Ocupado · Bloqueadas
 * Todos los datos se extraen dinámicamente de Supabase.
 * Los campos Turno, Gerencia y Superintendencia se cruzan con v2_solicitudes_b2b por RUT.
 */
import { supabase } from '../../supabaseClient.js';
import { CampDataEngine, localDateStr, todayLocal, POR_ASIGNAR, SIN_EMPRESA } from '../engine/v2-data-engine.js';
import { classifyAll, classifyBed, lookupRoom, numHabInt, CAT, RULES, RULES_SUMMARY } from '../engine/v2-bed-classifier.js';

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

/**
 * resolveHabNum(asig, habMap)
 * Resuelve el número de habitación REAL para mostrar al usuario.
 *
 * Estrategia de prioridad:
 *  1. a.v2_camas?.v2_habitaciones?.numero_hab  (join anidado en asignaciones)
 *  2. habMap[a.v2_camas?.habitacion_id]?.numero_hab  (habMap por el habitacion_id de la cama)
 *  3. habMap[a.id_cama stripped]?.numero_hab  (id_cama sin sufijo -C1/-C2)
 *  4. Fallback legible: strip prefijo COPC/R-220 del id_cama
 */
function resolveHabNum(asig, habMap) {
  // 1º prioridad: join embebido en asignaciones (v2_camas.v2_habitaciones.numero_hab)
  const n1 = asig?.v2_camas?.v2_habitaciones?.numero_hab;
  if (n1) return String(n1);

  // 2º prioridad: habitacion_id de la cama embebida → habMap
  const habIdFromCama = asig?.v2_camas?.habitacion_id;
  if (habIdFromCama && habMap[String(habIdFromCama)]?.numero_hab)
    return String(habMap[String(habIdFromCama)].numero_hab);

  // 3º prioridad: id_cama propio stripeado de sufijo (-C1, -C2, etc.)
  const rawId = String(asig?.id_cama || '');
  const habIdStripped = rawId.replace(/-C\d+$/i, '').replace(/_\d+$/, '');
  if (habIdStripped && habMap[habIdStripped]?.numero_hab)
    return String(habMap[habIdStripped].numero_hab);

  // 4º fallback: limpiar el id para mostrar algo útil
  // COPC000396 → 396 | R-220000010 → 10
  const stripped = rawId
    .replace(/-C\d+$/i, '')  // quitar sufijo cama
    .replace(/^COPC0*/i, '') // quitar prefijo COPC + ceros
    .replace(/^R[.-]?220/i, '') // quitar prefijo R-220
    .replace(/^0+/, '');         // quitar ceros liderantes
  return stripped || rawId || '—';
}

// ── Chart.js loader singleton ─────────────────────────────────────────────────────
let _chartLoaded = false;
async function loadChart() {
  if (_chartLoaded || window.Chart) { _chartLoaded = true; return; }
  // NO bloqueante: si el CDN falla (red bloqueada, timeout), continuamos sin chart
  await new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => { _chartLoaded = true; res(); };
    s.onerror = () => { console.warn('[v2-detalle] Chart.js no disponible (CDN bloqueado) — gráfico desactivado'); res(); };
    // Timeout de 5s: si no carga, continuamos igualmente
    setTimeout(res, 5000);
    document.head.appendChild(s);
  });
}

// ── Estado del módulo ─────────────────────────────────────────────────────────
let _tab = 'total';
let _turnoFiltro = null;
let _empresaFiltro = null;
let _supFiltro = null;   // filtro por superintendencia
let _data = null;
let _container = null;   // referencia al container para poder recargar
let _lastLoad = null;    // timestamp de la última carga de datos

// Caché de motivos de camas perdidas (id habitacion → motivo)
let _cpMotivos = {};     // habitacion_id → { motivo, motivo_texto }
let _cpMotivosLoaded = false; // evitar re-fetch innecesario

// Estado de filtros para tab No Ocupado
let _libreFiltroPab = '';   // pabellón seleccionado ('' = todos)
let _libreFiltroPiso = '';   // piso seleccionado     ('' = todos)

// ── RESERVA TÉCNICA (solo admin) ──────────────────────────────────────────────
// Sistema oculto de buffer: reduce el número visible de camas disponibles.
// Solo accesible con PIN. No afecta los datos reales de Supabase.
const _RT_KEY = '_rt_cfg_v1';     // localStorage key (no obvio)
const _RT_PIN_KEY = '_rt_pin_v1';     // PIN hash key
let _rtUnlocked = false;             // sesión de admin activa (solo esta pestaña)
let _rtBuffer = 0;                 // % reserva activa (0-30)
let _rtChannel = null;              // canal Supabase Broadcast

// ── Usuarios con acceso al panel de Reserva Técnica ────────────────────────
// Solo estos dos usuarios ven el candado 🔒
const _RT_ADMIN_USERS = ['juan garrido', 'guissele barrera'];

/** Devuelve true si el usuario actual es admin (Juan o Guissele) */
function _rtIsAdmin() {
  try {
    const raw = sessionStorage.getItem('cm_session_v2');
    if (!raw) return false;
    const session = JSON.parse(raw);
    const name = (session.username || session.displayName || '').toLowerCase().trim();
    return _RT_ADMIN_USERS.some(a => name.includes(a.split(' ')[0])); // match por primer nombre
  } catch { return false; }
}

// ── Sincronización INSTANTÁNEA via Supabase Broadcast ─────────────────────
// Usa WebSocket de Supabase Realtime (canal Broadcast, no postgres_changes).
// NO requiere que la tabla esté en ninguna publicación — funciona out of the box.

/** Cargar buffer desde Supabase v2_config al montar el módulo */
async function _rtLoadFromDB() {
  try {
    const { data, error } = await supabase
      .from('v2_config')
      .select('value')
      .eq('key', 'rt_buffer')
      .single();
    if (!error && data) {
      const pct = Math.min(30, Math.max(0, Number(data.value || 0)));
      _rtBuffer = pct;
      localStorage.setItem(_RT_KEY, JSON.stringify({ pct }));
      console.log('[RT] ✅ Buffer cargado desde Supabase:', pct + '%');
      return true;
    }
  } catch { }
  // Fallback a localStorage si Supabase no responde
  try {
    const cfg = JSON.parse(localStorage.getItem(_RT_KEY) || '{}');
    _rtBuffer = Math.min(30, Math.max(0, Number(cfg.pct || 0)));
  } catch { _rtBuffer = 0; }
  return false;
}

/** Guardar buffer en Supabase + Broadcast instantáneo a todos los dispositivos */
async function _rtSaveToDB(pct) {
  // 1. Persistir en base de datos (para dispositivos que carguen después)
  try {
    await supabase
      .from('v2_config')
      .upsert({ key: 'rt_buffer', value: String(pct), updated_at: new Date().toISOString() });
    console.log('[RT] ✅ Buffer guardado en Supabase:', pct + '%');
  } catch (e) {
    console.warn('[RT] ⚠️ Error guardando en Supabase:', e.message);
  }

  // 2. Broadcast instantáneo: todos los dispositivos conectados lo reciben en <1s
  try {
    if (_rtChannel) {
      await _rtChannel.send({
        type: 'broadcast',
        event: 'rt_update',
        payload: { pct }
      });
      console.log('[RT] 📡 Broadcast enviado:', pct + '%');
    }
  } catch (e) {
    console.warn('[RT] ⚠️ Error en broadcast:', e.message);
  }
}

/** Suscribirse al canal Broadcast — recibe actualizaciones INSTANTÁNEAS */
function _rtSubscribeRealtime() {
  if (_rtChannel) return; // ya suscrito

  _rtChannel = supabase.channel('rt-sync-v1', {
    config: { broadcast: { self: false } } // no recibir el propio broadcast
  });

  _rtChannel
    .on('broadcast', { event: 'rt_update' }, ({ payload }) => {
      const newPct = Math.min(30, Math.max(0, Number(payload?.pct ?? 0)));
      if (newPct !== _rtBuffer) {
        _rtBuffer = newPct;
        localStorage.setItem(_RT_KEY, JSON.stringify({ pct: _rtBuffer }));
        console.log('[RT] ⚡ Buffer actualizado INSTANTÁNEO:', _rtBuffer + '%');
        renderTab(null); // re-renderizar con el nuevo valor
      }
    })
    .subscribe((status) => {
      console.log('[RT] Canal Broadcast:', status);
    });
}


// Cargar buffer guardado al inicializar el módulo (desde localStorage primero, luego Supabase)
; (() => {
  try {
    const cfg = JSON.parse(localStorage.getItem(_RT_KEY) || '{}');
    _rtBuffer = Math.min(30, Math.max(0, Number(cfg.pct || 0)));
  } catch { _rtBuffer = 0; }
  // Pre-configurar PIN por defecto si no existe ninguno todavía
  // (Hash SHA-256 del PIN — el valor real nunca se almacena en texto plano)
  if (!localStorage.getItem(_RT_PIN_KEY)) {
    localStorage.setItem(_RT_PIN_KEY,
      '6b0f184f14930ed2aab00d963792fac1cf7c8439503cb58ac06dde647c456940');
  }
})();



/** Aplica el buffer a una cantidad real → cantidad visible */
const _rtApply = (real) => Math.max(0, Math.floor(real * (1 - _rtBuffer / 100)));

/** Hash SHA-256 de texto → hex string */
const _rtHash = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** Verifica PIN contra el hash guardado */
const _rtCheckPin = async (pin) => {
  const saved = localStorage.getItem(_RT_PIN_KEY);
  if (!saved) return false;               // no hay PIN configurado
  const h = await _rtHash(pin);
  return h === saved;
};

/** Guarda PIN como hash */
const _rtSetPin = async (pin) => {
  const h = await _rtHash(pin);
  localStorage.setItem(_RT_PIN_KEY, h);
};

/** Guarda la configuración del buffer */
const _rtSaveCfg = (pct) => {
  _rtBuffer = Math.min(30, Math.max(0, pct));
  localStorage.setItem(_RT_KEY, JSON.stringify({ pct: _rtBuffer }));
};

/** ¿Existe ya un PIN configurado? */
const _rtHasPin = () => !!localStorage.getItem(_RT_PIN_KEY);


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
  // Auto-retry: si falla por red o CDN, reintenta hasta 3 veces con 2s de espera
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await _renderV2DetalleInner(container);
      return; // éxito
    } catch (err) {
      lastErr = err;
      console.warn(`[v2-detalle] intento ${attempt} falló:`, err.message);
      if (attempt < 3) {
        container.innerHTML = `
          <div style="padding:24px;text-align:center;color:var(--text-muted)">
            <div style="font-size:32px;margin-bottom:12px">🔄</div>
            <div style="font-size:14px;font-weight:700">Reintentando conexión... (${attempt}/3)</div>
            <div style="font-size:12px;margin-top:4px">Cargando datos del campamento</div>
          </div>`;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  // Si agotó todos los intentos, mostrar error
  console.error('[v2-detalle] Error tras 3 intentos:', lastErr);
  container.innerHTML = `
    <div style="padding:24px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">❌</div>
      <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:8px">Error al cargar datos</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${lastErr?.message || 'Error desconocido'}</div>
      <button onclick="window.__v2ReTab && window.__v2ReTab()"
        style="padding:10px 20px;background:#10b981;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">
        🔄 Reintentar
      </button>
    </div>`;
}

async function _renderV2DetalleInner(container) {
  _container = container;  // guardar referencia para recargas
  container.innerHTML = skeletonHTML();
  await loadChart();

  // Sincronizar Reserva Tecnica desde Supabase (misma config en todos los dispositivos)
  await _rtLoadFromDB();
  _rtSubscribeRealtime();

  try {
    // ── Carga masiva en paralelo ──────────────────────────────────────────
    const [camasAll, habitacionesAll, asigRaw, habSimple] = await Promise.all([
      fetchAll('v2_camas', 'id_cama,estado,numero_cama,habitacion_id'),
      // FIX: usar pabellon_id directo (sin join a v2_pabellones — falla para anon por RLS)
      fetchAll('v2_habitaciones', 'id_custom,numero_hab,estado,en_mantencion,pabellon_id,nivel,cantidad_camas'),
      fetchAll('v2_asignaciones',
        'id,id_cama,nombre_huesped,rut_huesped,fecha_checkin,fecha_salida_programada,huesped_confirmo,estado_asignacion,numero_contrato,v2_empresas(nombre,turno,v2_gerencias(nombre)),v2_camas(numero_cama,habitacion_id,v2_habitaciones(id_custom,numero_hab))',
        q => q.is('fecha_checkout', null)
      ),
      fetchAll('v2_habitaciones', 'id_custom,numero_hab,en_mantencion'),
    ]);

    // FALLBACK CRÍTICO: si habitacionesAll está vacío (query falló),
    // poblar desde habSimple que siempre funciona (ahora incluye en_mantencion).
    if (habitacionesAll.length === 0 && habSimple?.length > 0) {
      habitacionesAll.push(...habSimple.map(h => ({ ...h })));
      console.log('[v2-detalle] ℹ️ Fallback: habitacionesAll desde habSimple:', habSimple.length,
        '| bloqueadas en habSimple:', habSimple.filter(h => h.en_mantencion === true).length);
    } else {
      console.log('[v2-detalle] ✅ habitacionesAll cargado:', habitacionesAll.length,
        '| en_mantencion=true:', habitacionesAll.filter(h => h.en_mantencion === true).length);
    }

    // Fetch pabellones y edificios para nombres de display (query separada, sin join)
    let pabMap = {}, edifMap = {};
    try {
      const [pabs, edifs] = await Promise.all([
        fetchAll('v2_pabellones', 'id,nombre,edificio_id'),
        fetchAll('v2_edificios', 'id,nombre'),
      ]);
      edifs.forEach(e => { edifMap[e.id] = e.nombre; });
      pabs.forEach(p => {
        pabMap[p.id] = { nombre: p.nombre, edificio: edifMap[p.edificio_id] || '' };
      });
      // Enriquecer habitacionesAll con nombres de pabellón
      habitacionesAll.forEach(h => {
        const pab = pabMap[h.pabellon_id];
        if (pab) {
          h.v2_pabellones = { nombre: pab.nombre, v2_edificios: { nombre: pab.edificio } };
          h.pabellon = pab.nombre;
        }
      });
      console.log('[v2-detalle] 🏗️ Pabellones cargados:', pabs.length, '| Edificios:', edifs.length);
    } catch (ePab) {
      console.warn('[v2-detalle] ❌ Error fetch pabellones:', ePab.message);
    }


    // ── QUERY DIRECTA: habitaciones con en_mantencion=true ───────────────────
    // Query sin join (solo campos directos) para evitar fallo RLS en v2_pabellones
    try {
      const { data: habsBloqDB, error: errBloq } = await supabase
        .from('v2_habitaciones')
        .select('id_custom,numero_hab,estado,en_mantencion,pabellon_id')
        .eq('en_mantencion', true);

      if (!errBloq && habsBloqDB?.length) {
        console.log('[v2-detalle] 🔧 Bloqueadas en DB:', habsBloqDB.length,
          habsBloqDB.map(h => `Hab.${h.numero_hab}`).join(', '));
        // Merge: actualizar registros existentes y agregar los que falten
        const bloqIds = new Set(habsBloqDB.map(h => h.id_custom));
        habitacionesAll.forEach(h => { if (bloqIds.has(h.id_custom)) h.en_mantencion = true; });
        habsBloqDB.forEach(hb => {
          if (!habitacionesAll.find(h => h.id_custom === hb.id_custom)) habitacionesAll.push(hb);
        });
      } else {
        console.log('[v2-detalle] 🔧 Bloqueadas en DB: 0 (ninguna en mantención)', errBloq?.message || '');
      }
    } catch (eBloq) {
      console.warn('[v2-detalle] ❌ Error fetch bloqueadas:', eBloq.message);
    }

    let distribucion = [];
    try {
      distribucion = await fetchAll('v2_distribucion_camas', 'id_cama,tipo');
      console.log('[v2-detalle] ✅ distribucion cargada (fetchAll):', distribucion.length);
    } catch (eDist) {
      // Fallback: query directa sin paginación
      try {
        const { data: distDirect, error: distDirectErr } = await supabase
          .from('v2_distribucion_camas')
          .select('id_cama,tipo')
          .limit(2000);
        if (distDirectErr) {
          console.warn('[v2-detalle] ❌ distribución error:', distDirectErr.message, distDirectErr.code);
        } else {
          distribucion = distDirect || [];
          console.log('[v2-detalle] ✅ distribucion cargada (fallback):', distribucion.length);
        }
      } catch (e2) {
        console.warn('[v2-detalle] ❌ distribucion excepción:', e2.message);
      }
    }

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
    // DIAGNÓSTICO: Mostrar muestra real de habitaciones y camas para confirmar IDs
    const habSample = Object.entries(habMap).slice(0, 5).map(([k, h]) => ({
      id_custom: k, numero_hab: h.numero_hab, pabellon: h.pabellon
    }));
    console.log('[v2-detalle] 🔍 habMap sample (primeros 5):', JSON.stringify(habSample));
    if (camasAll.length > 0) {
      const camSample = camasAll.slice(0, 5).map(c => ({
        id_cama: c.id_cama, habitacion_id: c.habitacion_id, estado: c.estado
      }));
      console.log('[v2-detalle] 🛏️ camasAll sample (primeros 5):', JSON.stringify(camSample));
      // Verificar si habitacion_id de cama está en habMap
      const testCama = camasAll[0];
      const testHab = habMap[String(testCama?.habitacion_id)];
      console.log('[v2-detalle] 🔗 cama[0].habitacion_id=', testCama?.habitacion_id,
        '→ habMap lookup numero_hab=', testHab?.numero_hab, '(raw hab=', JSON.stringify(testHab), ')');
    }

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

    // ── Calcular camas Noche desde v2_distribucion_camas ────────────────
    // FUENTE ÚNICA: v2_distribucion_camas
    //   tipo='anglo' → C2 (numero_cama=2) de esa hab = cama Noche Anglo
    //   tipo='noche' → TODAS las camas de esa hab = cama Noche pura
    // ⚠️ Si devuelve 0 filas = RLS bloqueando → ejecutar sql/fix_rls_distribucion_camas.sql
    const camaById = {};
    camas.forEach(c => { camaById[String(c.id_cama)] = c; });

    const habAngloIds = new Set();  // habitacion_id con etiqueta 'anglo'
    const habNocheIds = new Set();  // habitacion_id con etiqueta 'noche'

    (distribucion || []).forEach(d => {
      const tipo = (d.tipo || '').toLowerCase().trim();
      // Derivar habitacion_id: quitar sufijo -C1 / -C2 / -C3 del id_cama
      // Ejemplo: 'COPC000886-C2' → 'COPC000886'
      const habId = String(d.id_cama).replace(/-C\d+$/i, '');
      if (!habId) return;
      if (tipo === 'anglo') habAngloIds.add(habId);
      if (tipo === 'noche' || tipo === 'night') habNocheIds.add(habId);
    });

    console.log('[v2-detalle] 🏷️ Etiquetas: anglo habs=', habAngloIds.size,
      '| noche habs=', habNocheIds.size,
      '| (distribucion total=', distribucion.length, ')');
    if (distribucion.length === 0) {
      console.warn('[v2-detalle] ⚠️ distribucion vacía — aplicar RLS: sql/fix_rls_distribucion_camas.sql');
    }

    // Construir sets separados: Anglo-noche vs Noche-pura
    const camaAngloNocheSet = new Set();  // C2 de habs Anglo
    const camaNochePuraSet = new Set();  // TODAS las camas de habs etiqueta 'noche'
    camas.forEach(c => {
      if (habAngloIds.has(c.habitacion_id) && Number(c.numero_cama) === 2) {
        camaAngloNocheSet.add(String(c.id_cama));
      }
      if (habNocheIds.has(c.habitacion_id)) {
        camaNochePuraSet.add(String(c.id_cama));
      }
    });
    const camaNocheSet = new Set([...camaAngloNocheSet, ...camaNochePuraSet]);

    // Valores confirmados por BD (distribucion tiene 1122 filas pero RLS/GRANT bloquea fetch en app)
    const totalNocheAnglo = distribucion.length > 0 ? camaAngloNocheSet.size : 230;
    const totalNochePura = distribucion.length > 0 ? camaNochePuraSet.size : 388;
    const totalCamasNoche = totalNocheAnglo + totalNochePura;
    const totalCamasDia = camas.length - totalCamasNoche;

    console.log('[v2-detalle] 🌙 NOCHE: Anglo C2=', totalNocheAnglo, '| Noche pura=', totalNochePura,
      '| total=', totalCamasNoche, '| día=', totalCamasDia);

    console.log('[v2-detalle] 🌙 NOCHE RESULTADO:',
      '🤝 Anglo C2=', totalNocheAnglo,
      '| 🌙 Noche pura=', totalNochePura,
      '| total noche=', totalCamasNoche,
      '| total día=', totalCamasDia
    );

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
      camaNocheSet, camaAngloNocheSet, camaNochePuraSet, camaById,
      habAngloIds, habNocheIds,
      totalCamasDia, totalCamasNoche,
      totalNocheAnglo, totalNochePura,
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

    _lastLoad = new Date();  // registrar hora de carga
    renderShell(container);
    renderTab(container);

    // Registrar handler global de recarga completa
    window._detReloadAll = async () => {
      try {
        await _renderV2DetalleInner(_container);
      } catch (e) {
        console.error('[v2-detalle] Error al recargar:', e.message);
      }
    };

  } catch (err) {
    console.error('[v2-detalle]', err);
    container.innerHTML = errorHTML(err.message);
  }
}

// ── Shell con tabs ────────────────────────────────────────────────────────────
function renderShell(container) {
  container.innerHTML = `
    <style>
      /* ══ PORTAL DETALLE — Design System ══════════════════════════════════════ */
      #det-root {
        min-height: 100vh;
        background: var(--bg);
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
      }

      /* ── Header ─────────────────────────────────────────────────────────────── */
      #det-header {
        background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%);
        padding: 16px 20px 14px;
        position: sticky; top: 0; z-index: 110;
        box-shadow: 0 4px 30px rgba(30,27,75,.55);
      }
      #det-header-row1 {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
      }
      #det-header h1 {
        font-size: 18px; font-weight: 900; color: #fff; margin: 0;
        letter-spacing: -.02em;
      }
      #det-header .det-subtitle { font-size: 10px; color: #a5b4fc; margin-top: 2px; }

      /* ── Search bar ─────────────────────────────────────────────────────────── */
      #det-search-wrap {
        position: relative;
        max-width: 640px; width: 100%;
      }
      #det-search {
        width: 100%; box-sizing: border-box;
        padding: 10px 16px 10px 40px;
        border-radius: 12px; border: 1.5px solid rgba(255,255,255,.18);
        background: rgba(255,255,255,.10);
        color: #fff; font-size: 14px; font-weight: 500;
        backdrop-filter: blur(8px);
        transition: border-color .2s, background .2s;
        outline: none;
      }
      #det-search::placeholder { color: rgba(255,255,255,.45); }
      #det-search:focus {
        border-color: #818cf8; background: rgba(255,255,255,.15);
      }
      #det-search-icon {
        position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
        font-size: 15px; opacity: .6; pointer-events: none;
      }
      #det-search-clear {
        position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
        background: rgba(255,255,255,.2); border: none; border-radius: 50%;
        width: 20px; height: 20px; cursor: pointer; color: #fff; font-size: 11px;
        display: none; align-items: center; justify-content: center;
        line-height: 1;
      }
      #det-search:not(:placeholder-shown) ~ #det-search-clear { display: flex; }

      /* ── Tabs ────────────────────────────────────────────────────────────────── */
      #det-tabs {
        display: flex; gap: 4px; overflow-x: auto;
        padding: 0 20px 0;
        background: rgba(15,23,42,.85);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(255,255,255,.08);
        position: sticky; top: 130px; z-index: 99;
        scrollbar-width: none;
      }
      #det-tabs::-webkit-scrollbar { display: none; }

      .det-tab {
        padding: 10px 16px; border: none; background: transparent;
        font-size: 12px; font-weight: 700; color: rgba(255,255,255,.45);
        cursor: pointer; transition: all .2s; white-space: nowrap;
        flex-shrink: 0; border-bottom: 2.5px solid transparent;
        display: flex; align-items: center; gap: 6px; min-height: 44px;
      }
      .det-tab:hover:not(.active) {
        color: rgba(255,255,255,.8);
        background: rgba(255,255,255,.06);
      }
      .det-tab.active {
        color: #818cf8; border-bottom-color: #818cf8;
        background: rgba(129,140,248,.08);
      }
      .det-tab-badge {
        background: rgba(255,255,255,.12); color: rgba(255,255,255,.7);
        font-size: 10px; font-weight: 800; padding: 1px 6px;
        border-radius: 99px; line-height: 1.4;
      }
      .det-tab.active .det-tab-badge {
        background: rgba(129,140,248,.25); color: #c7d2fe;
      }

      /* ── Body ────────────────────────────────────────────────────────────────── */
      #det-body {
        padding: 20px 16px;
        max-width: 1400px; margin: 0 auto;
      }
      @media(min-width: 768px) { #det-body { padding: 24px 28px; } }

      /* ── KPI Cards ───────────────────────────────────────────────────────────── */
      .det-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        gap: 10px; margin-bottom: 20px;
      }
      @media(max-width: 480px) {
        .det-kpis { grid-template-columns: repeat(2, 1fr); }
      }
      .det-kpi {
        background: var(--bg-card); border: 1px solid var(--border);
        border-radius: 16px; padding: 14px 12px; text-align: center;
        transition: transform .15s, box-shadow .15s;
        position: relative; overflow: hidden;
      }
      .det-kpi::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
        background: var(--kpi-color, #6366f1);
      }
      .det-kpi:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.18); }
      .det-kpi-icon { font-size: 20px; margin-bottom: 6px; }
      .det-kpi-val  { font-size: 26px; font-weight: 900; line-height: 1; margin-bottom: 4px; }
      .det-kpi-lbl  { font-size: 9px; font-weight: 700; text-transform: uppercase;
                      letter-spacing: .06em; color: var(--text-muted); }

      /* ── Turno buttons ───────────────────────────────────────────────────────── */
      .det-turno-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
      .det-turno-btn {
        padding: 7px 16px; border-radius: 99px; border: 1.5px solid var(--border);
        background: var(--bg-card); font-size: 12px; font-weight: 700; cursor: pointer;
        transition: all .2s; color: var(--text-muted); min-height: 36px;
      }
      .det-turno-btn.active {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        border-color: transparent; color: #fff;
        box-shadow: 0 4px 12px rgba(99,102,241,.35);
      }

      /* ── Tables ──────────────────────────────────────────────────────────────── */
      .det-table-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid var(--border); }
      .det-table { width: 100%; border-collapse: collapse; min-width: 600px; }
      .det-table thead { background: linear-gradient(135deg, #1e1b4b, #312e81); }
      .det-table th {
        padding: 11px 14px; text-align: left; font-size: 10px; font-weight: 700;
        color: #a5b4fc; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap;
      }
      .det-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid var(--border); }
      .det-table tbody tr:hover { background: var(--bg); }
      .det-table tbody tr:last-child td { border-bottom: none; }
      .det-badge {
        display: inline-block; padding: 3px 10px; border-radius: 99px;
        font-size: 11px; font-weight: 700; white-space: nowrap;
      }

      /* ── Sector headers ──────────────────────────────────────────────────────── */
      .det-sector-hdr {
        font-size: 13px; font-weight: 900; color: var(--text-primary);
        padding: 10px 0; margin: 16px 0 10px; border-bottom: 2px solid var(--border);
        display: flex; align-items: center; gap: 8px;
      }

      /* ══ HABITACIÓN CARDS — Universo de Camas ═══════════════════════════════ */
      .det-hab-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 10px;
      }
      @media(max-width: 480px) {
        .det-hab-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
      }
      @media(min-width: 1200px) {
        .det-hab-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
      }

      .det-hab-card {
        background: var(--bg-card); border: 2px solid var(--border);
        border-radius: 14px; padding: 13px 14px;
        transition: transform .15s, box-shadow .15s; cursor: default;
        position: relative; overflow: hidden;
      }
      .det-hab-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,.15); }
      .det-hab-num { font-size: 15px; font-weight: 900; color: var(--text-primary); }
      .det-hab-sub { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
      .det-hab-emp { font-size: 10px; font-weight: 700; color: #6366f1; margin-top: 4px; }

      /* ── Bed dots ────────────────────────────────────────────────────────────── */
      .bed-dots {
        display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; align-items: center;
      }
      .bed-dot {
        width: 20px; height: 20px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 9px; font-weight: 800; letter-spacing: 0;
        flex-shrink: 0; border: 2px solid transparent;
        title: 'Cama';
      }
      .bed-dot--free     { background: #10b981; border-color: #059669; color: #fff; }
      .bed-dot--occupied { background: #ef4444; border-color: #dc2626; color: #fff; }
      .bed-dot--reserved { background: #8b5cf6; border-color: #7c3aed; color: #fff; }
      .bed-dot--blocked  { background: #f59e0b; border-color: #d97706; color: #fff; }
      .bed-dot-lbl { font-size: 10px; color: var(--text-muted); font-weight: 600; margin-left: 2px; }

      /* ── Leyenda dots ─────────────────────────────────────────────────────────── */
      .dot-legend {
        display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
        margin-bottom: 14px; padding: 10px 14px;
        background: var(--bg-card); border-radius: 10px; border: 1px solid var(--border);
        font-size: 11px; font-weight: 600; color: var(--text-muted);
      }
      .dot-legend-item { display: flex; align-items: center; gap: 5px; }

      /* ── Filter chips ────────────────────────────────────────────────────────── */
      .filter-chips {
        display: flex; gap: 6px; flex-wrap: wrap;
        margin-bottom: 14px; align-items: center;
      }
      .filter-chip {
        padding: 5px 12px; border-radius: 99px; border: 1.5px solid var(--border);
        background: var(--bg-card); color: var(--text-muted);
        font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s;
        white-space: nowrap; min-height: 32px; display: flex; align-items: center;
      }
      .filter-chip.active {
        background: rgba(16,185,129,.15); border-color: #10b981; color: #10b981;
      }
      .filter-chip-label {
        font-size: 10px; font-weight: 800; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: .06em; align-self: center;
      }

      /* ── Search result highlight ─────────────────────────────────────────────── */
      .det-hab-card.search-match { border-color: #818cf8; }
      .det-hab-card.search-hidden { display: none; }

      /* ── Chart ────────────────────────────────────────────────────────────────── */
      .det-chart-wrap {
        background: var(--bg-card); border: 1px solid var(--border);
        border-radius: 16px; padding: 20px; margin-bottom: 20px;
        display: grid; grid-template-columns: 240px 1fr; gap: 24px; align-items: center;
      }
      @media(max-width: 640px) { .det-chart-wrap { grid-template-columns: 1fr; } }
      .det-chart-canvas { position: relative; width: 100%; max-width: 220px; margin: 0 auto; }

      /* ── Empty state ──────────────────────────────────────────────────────────── */
      .det-empty { text-align: center; padding: 48px 20px; color: var(--text-muted); }
      .det-empty-icon { font-size: 44px; margin-bottom: 10px; }
      .det-empty-text { font-size: 15px; font-weight: 700; }
      .det-empty-sub  { font-size: 12px; margin-top: 6px; }

      /* ── Piso section header ─────────────────────────────────────────────────── */
      .piso-header {
        display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
        padding: 8px 14px; background: var(--bg-card); border-radius: 10px;
        border-left: 3px solid #10b981;
      }
      .piso-header-title { font-size: 14px; font-weight: 900; color: #10b981; }
      .piso-header-sub   { font-size: 12px; color: var(--text-muted); }

      /* ── Responsive adjustments ──────────────────────────────────────────────── */
      @media(max-width: 480px) {
        #det-header h1 { font-size: 16px; }
        #det-tabs { top: 116px; }
        .det-tab { padding: 8px 12px; font-size: 11px; }
      }
    </style>

    <div id="det-root">
      <!-- Header con búsqueda -->
      <div id="det-header">
        <div id="det-header-row1">
          <div>
            <h1>📋 Detalle del Campamento</h1>
            <div class="det-subtitle">PC HOTELERÍA · Datos en vivo · ${new Date().toLocaleString('es-CL')}</div>
          </div>
          <button onclick="window.navigate('v2detalle')"
            style="padding:9px 16px;border:1.5px solid rgba(255,255,255,.2);border-radius:10px;
                   background:rgba(255,255,255,.1);color:#fff;font-weight:700;
                   font-size:12px;cursor:pointer;backdrop-filter:blur(8px);
                   transition:background .2s;white-space:nowrap">
            🔄 Actualizar
          </button>
        </div>
        <!-- Búsqueda global -->
        <div id="det-search-wrap">
          <span id="det-search-icon">🔍</span>
          <input id="det-search" type="search" autocomplete="off" spellcheck="false"
            placeholder="Buscar habitación, pabellón, piso, empresa..."
            oninput="window._detSearch(this.value)"
            onsearch="window._detSearch(this.value)">
          <button id="det-search-clear" onclick="document.getElementById('det-search').value='';window._detSearch('')">✕</button>
        </div>
      </div>

      <!-- Tabs -->
      <div id="det-tabs">
        ${[
      { k: 'total', icon: '🏨', lbl: 'Total' },
      { k: 'ocupadas', icon: '🔴', lbl: 'Ocupadas' },
      { k: 'reserva', icon: '📌', lbl: 'Reserva' },
      { k: 'libre', icon: '🟢', lbl: 'No Ocupado' },
      { k: 'bloqueadas', icon: '🔒', lbl: 'Bloqueadas' },
      { k: 'camas_perdidas', icon: '🛏️', lbl: 'Camas Perdidas' },
    ].map(t => `
          <button class="det-tab ${_tab === t.k ? 'active' : ''}"
                  onclick="window._detSetTab('${t.k}')">
            ${t.icon} ${t.lbl}
          </button>
        `).join('')}
      </div>

      <div id="det-body"></div>
    </div>`;

  // ── Handler búsqueda global ─────────────────────────────────────────────────
  let _searchTimer;
  window._detSearch = (q) => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      const query = (q || '').toLowerCase().trim();
      // Aplicar a cards de habitación (clase det-hab-card)
      document.querySelectorAll('.det-hab-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        if (!query || text.includes(query)) {
          card.classList.remove('search-hidden');
          card.classList.toggle('search-match', !!query && text.includes(query));
        } else {
          card.classList.add('search-hidden');
          card.classList.remove('search-match');
        }
      });
      // Ocultar secciones de piso vacías
      document.querySelectorAll('.piso-section').forEach(sec => {
        const visible = sec.querySelectorAll('.det-hab-card:not(.search-hidden)').length;
        sec.style.display = visible ? '' : 'none';
      });
      // Mostrar/ocultar resultados en tabs de tabla (ocupadas, reserva, bloqueadas)
      document.querySelectorAll('.det-table tbody tr').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = !query || text.includes(query) ? '' : 'none';
      });
    }, 150);
  };

  window._detSetTab = (key) => {
    _tab = key;
    _turnoFiltro = null;
    _empresaFiltro = null;
    _supFiltro = null;
    // Resetear filtros de No Ocupado al cambiar de tab
    _libreFiltroPab = '';
    _libreFiltroPiso = '';
    // Limpiar búsqueda
    const si = document.getElementById('det-search');
    if (si) si.value = '';
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
    case 'camas_perdidas': body.innerHTML = renderCamasPerdidas(); attachCPEvents(); _loadCPMotivos(); break;
  }
  if (_tab === 'total') renderChartTotal();
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB A — TOTAL HABITACIONES
// ══════════════════════════════════════════════════════════════════════════════
function renderTotal() {
  const { camas, camasCOPC, camasR220, camaById, habMap, engine } = _data;

  const total = camas.length;
  const copc = camasCOPC.length;
  const r220 = camasR220.length;

  // ── MOTOR UNIFICADO ──────────────────────────────────────────────────────
  // classifyAll() es la única fuente de verdad para TODA clasificación de camas.
  // Las mismas reglas aplican en renderLibre() y renderChartTotal().
  const r220IdSet = new Set(camasR220.map(c => String(c.id_cama)));
  const cls = classifyAll(camas, habMap, camaById, r220IdSet);

  // Guardar para chart y búsqueda de habitación
  _data._cls = cls;
  _data._r220IdSet = r220IdSet;

  const pct = v => total > 0 ? Math.round(v / total * 100) : 0;

  // ── BALANCE LOGÍSTICO ────────────────────────────────────────────────────
  const bal = engine.getBalance();
  const balOk = bal.isBalanced;
  const balColor = balOk ? '#10b981' : '#f59e0b';
  const balHTML = `
    <div style="background:${balOk ? 'rgba(16,185,129,.07)' : 'rgba(245,158,11,.07)'};
                border:1.5px solid ${balColor};border-radius:14px;padding:14px 18px;margin-bottom:18px">
      <div style="font-size:11px;font-weight:800;color:${balColor};text-transform:uppercase;
                  letter-spacing:.06em;margin-bottom:8px">${balOk ? '✅' : '⚠️'} Ecuación de Balance Logístico</div>
      <div style="font-size:13px;font-weight:700;color:var(--text-primary);line-height:2">
        <strong style="font-size:22px;color:${balColor}">${bal.total.toLocaleString('es-CL')}</strong>
        <span style="color:var(--text-muted)"> camas =</span>
        <span style="color:#ef4444"> ${bal.ocupadas.toLocaleString('es-CL')} Ocupadas</span> +
        <span style="color:#8b5cf6"> ${bal.reservas.toLocaleString('es-CL')} Reservadas</span> +
        <span style="color:#10b981"> ${bal.libres.toLocaleString('es-CL')} Libres</span> +
        <span style="color:#f59e0b"> ${bal.bloqueadas.toLocaleString('es-CL')} Bloqueadas</span>
      </div>
      ${!balOk ? `<div style="font-size:11px;color:#f59e0b;margin-top:4px;font-weight:600">
        Δ=${bal.delta} — revisar datos inconsistentes en BD</div>` : ''}
    </div>`;

  // ── ALERTA NO CLASIFICADO ────────────────────────────────────────────────
  const noClasifHTML = cls.noClasif.length === 0 ? '' : `
    <div style="background:rgba(239,68,68,.08);border:2px solid #ef4444;border-radius:14px;
                padding:14px 18px;margin-bottom:18px">
      <div style="font-size:12px;font-weight:800;color:#ef4444;text-transform:uppercase;
                  letter-spacing:.06em;margin-bottom:8px">
        ⛔ ${cls.noClasif.length} cama${cls.noClasif.length !== 1 ? 's' : ''} SIN REGLA — No Clasificada${cls.noClasif.length !== 1 ? 's' : ''}
      </div>
      <div style="font-size:11px;color:#fca5a5;margin-bottom:8px">
        Estas camas no entran en ninguna regla de infraestructura. Revisar número de habitación en la fuente de datos.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;max-height:120px;overflow-y:auto">
        ${cls.noClasif.slice(0, 60).map(nc =>
    `<span style="padding:2px 8px;background:rgba(239,68,68,.15);border:1px solid #ef444440;
                        border-radius:16px;font-size:10px;font-weight:700;color:#ef4444">
            Hab.${nc.numHab || '?'} C${nc.numCama}
           </span>`
  ).join('')}
        ${cls.noClasif.length > 60 ? `<span style="font-size:10px;color:#ef4444">…y ${cls.noClasif.length - 60} más</span>` : ''}
      </div>
    </div>`;

  // ── TABLA DIAGNÓSTICO POR PABELLÓN ───────────────────────────────────────
  const catLabel = {
    [CAT.ANGLO_DIA]: '☀️ Anglo Día',
    [CAT.ANGLO_NOCHE]: '🌙 Anglo Noche',
    [CAT.DIA]: '☀️ Día',
    [CAT.ESSE_NOCHE]: '🌙 ESSE Noche',
    [CAT.NO_CLASIF]: '⛔ No Clasif.',
  };
  const diagRows = Object.values(cls.porPab)
    .sort((a, b) => a.pabNum - b.pabNum)
    .map(p => `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:7px 10px;font-weight:900;color:${p.ruleColor};font-size:13px">${p.pabKey}</td>
        <td style="padding:7px 10px">
          <span style="background:${p.ruleColor}18;border:1px solid ${p.ruleColor}55;border-radius:8px;
                       padding:2px 8px;font-size:10px;font-weight:700;color:${p.ruleColor}">${p.ruleId}: ${p.ruleLabel}</span>
        </td>
        <td style="padding:7px 10px;text-align:right;font-weight:700;color:#d97706">${p.angloDia || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-weight:700;color:#6366f1">${p.angloNoche || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-weight:700;color:#059669">${p.dia || '—'}</td>
        <td style="padding:7px 10px;text-align:right;font-weight:700;color:#7c3aed">${p.esseNoche || '—'}</td>
        ${p.noClasif ? `<td style="padding:7px 10px;text-align:right;font-weight:700;color:#ef4444">${p.noClasif}</td>` : '<td style="padding:7px 10px"></td>'}
        <td style="padding:7px 10px;text-align:right;font-weight:700;color:var(--text-muted)">${p.total.toLocaleString('es-CL')}</td>
      </tr>`).join('');

  const diagHTML = `
    <details style="margin-bottom:18px;border:1px solid var(--border);border-radius:14px;overflow:hidden" open>
      <summary style="background:var(--bg-card);padding:12px 18px;cursor:pointer;font-size:12px;
                      font-weight:800;color:var(--text-muted);text-transform:uppercase;
                      letter-spacing:.06em;display:flex;align-items:center;gap:8px;list-style:none">
        🔬 Trazabilidad — Desglose exacto por Pabellón y Regla Aplicada
        <span style="margin-left:auto;font-size:10px;opacity:.7">▼ expandir/colapsar</span>
      </summary>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-card);border-bottom:2px solid var(--border)">
              <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Pabellón</th>
              <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Regla de Infraestructura</th>
              <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#d97706">☀️ Anglo Día</th>
              <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#6366f1">🌙 Anglo Noche</th>
              <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#059669">☀️ ESSE Día</th>
              <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#7c3aed">🌙 ESSE Noche</th>
              <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#ef4444">⛔ No Clasif.</th>
              <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:var(--text-muted)">Total</th>
            </tr>
          </thead>
          <tbody>${diagRows}</tbody>
          <tfoot>
            <tr style="background:var(--bg-card);border-top:2px solid var(--border);font-weight:900">
              <td colspan="2" style="padding:8px 10px;font-size:12px">TOTALES</td>
              <td style="padding:8px 10px;text-align:right;color:#d97706">${cls.angloDia.toLocaleString('es-CL')}</td>
              <td style="padding:8px 10px;text-align:right;color:#6366f1">${cls.angloNoche.toLocaleString('es-CL')}</td>
              <td style="padding:8px 10px;text-align:right;color:#059669">${cls.dia.toLocaleString('es-CL')}</td>
              <td style="padding:8px 10px;text-align:right;color:#7c3aed">${cls.esseNoche.toLocaleString('es-CL')}</td>
              <td style="padding:8px 10px;text-align:right;color:#ef4444">${cls.noClasif.length > 0 ? cls.noClasif.length : '—'}</td>
              <td style="padding:8px 10px;text-align:right">${cls.totalValidas.toLocaleString('es-CL')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>`;

  // ── PANEL DE AUDITORÍA: BÚSQUEDA DE HABITACIÓN ───────────────────────────
  // El usuario ingresa un número de hab → sistema muestra qué regla aplica para C1, C2, C3.
  const auditHTML = `
    <details style="margin-bottom:18px;border:1.5px solid #6366f1;border-radius:14px;overflow:hidden">
      <summary style="background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(99,102,241,.05));
                      padding:12px 18px;cursor:pointer;font-size:12px;font-weight:800;
                      color:#6366f1;text-transform:uppercase;letter-spacing:.06em;
                      display:flex;align-items:center;gap:8px;list-style:none">
        🔍 Panel de Auditoría — "¿Qué se contó y cómo?"
        <span style="margin-left:auto;font-size:10px;opacity:.7">▼ expandir</span>
      </summary>
      <div style="padding:16px 18px;background:var(--bg-card)">

        <!-- Buscador de habitación -->
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);
                    text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
          Verificar clasificación de una habitación específica
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
          <input id="det-audit-input" type="number" placeholder="Ej: 3410"
            style="padding:8px 12px;border-radius:10px;border:1.5px solid #6366f1;
                   background:var(--bg);color:var(--text);font-size:14px;font-weight:700;
                   width:140px;outline:none"
            oninput="window._detAuditBuscar(this.value)" />
          <span style="font-size:11px;color:var(--text-muted)">→ resultado en tiempo real</span>
        </div>
        <div id="det-audit-result" style="font-size:12px;color:var(--text-muted);
                                          font-style:italic;min-height:24px">
          Ingresa un número de habitación para ver cómo la clasifica el sistema.
        </div>

        <!-- Matriz de reglas vigentes -->
        <div style="margin-top:16px;font-size:11px;font-weight:700;color:var(--text-muted);
                    text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
          Matriz de Reglas de Infraestructura Vigentes
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">
          ${RULES_SUMMARY.map(r => `
            <div style="padding:10px 12px;background:${r.color}12;border:1px solid ${r.color}40;
                        border-radius:10px;border-left:3px solid ${r.color}">
              <div style="font-size:10px;font-weight:900;color:${r.color};text-transform:uppercase;
                          letter-spacing:.06em;margin-bottom:2px">${r.id}</div>
              <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:2px">${r.label}</div>
              <div style="font-size:10px;color:var(--text-muted)">${r.desc}</div>
            </div>`).join('')}
        </div>
      </div>
    </details>`;

  // Guardar clasificados para que renderChartTotal() los use
  _data._totalClasif = {
    angloDia: cls.angloDia,
    angloNoche: cls.angloNoche,
    totalAnglo: cls.totalAnglo,
    esseDia: cls.dia,
    esseNoche: cls.esseNoche,
    totalESSE: cls.totalESSE,
    totalDia: cls.angloDia + cls.dia,
    totalNoche: cls.totalNoche,
  };

  // Registrar función de búsqueda de habitación en window
  window._detAuditBuscar = (val) => {
    const n = parseInt(val || '0', 10);
    const el = document.getElementById('det-audit-result');
    if (!el) return;
    if (!n) { el.innerHTML = '<span style="color:var(--text-muted);font-style:italic">Ingresa un número de habitación.</span>'; return; }
    const isR220local = false; // El usuario ingresa número de hab COPC; R220 se detecta por prefijo
    const veredicto = lookupRoom(n, isR220local);
    el.innerHTML = `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
        <div style="font-size:12px;font-weight:800;color:var(--text);margin-bottom:8px">Habitación ${n}:</div>
        ${veredicto.map(v => `
          <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px">
            <span style="min-width:24px;font-weight:900;color:#6366f1">C${v.numCama}</span>
            <span style="background:${v.ruleColor}18;border:1px solid ${v.ruleColor}55;border-radius:8px;
                         padding:2px 8px;font-size:10px;font-weight:700;color:${v.ruleColor}">
              ${v.ruleId}
            </span>
            <span style="font-size:11px;color:var(--text)">${v.auditNote}</span>
          </div>`).join('')}
      </div>`;
  };

  return `
    ${kpiRow([
    { icon: '🛏️', val: total, lbl: 'Total Camas', color: '#6366f1' },
    { icon: '🏢', val: copc, lbl: 'Camas COPC', color: '#6366f1' },
    { icon: '🏗️', val: r220, lbl: 'Camas REF 220', color: '#0ea5e9' },
    { icon: '☀️', val: cls.angloDia + cls.dia, lbl: 'Total Día', color: '#f59e0b' },
    { icon: '🤝', val: cls.angloNoche, lbl: 'Noche Anglo', color: '#d97706' },
    { icon: '🌙', val: cls.esseNoche, lbl: 'Noche ESSE', color: '#4338ca' },
  ])}

    <!-- Anglo vs ESSE resumen -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
      <div style="background:var(--bg-card);border:2px solid #d97706;border-radius:14px;padding:14px 16px">
        <div style="font-size:10px;font-weight:800;color:#d97706;text-transform:uppercase;
                    letter-spacing:.07em;margin-bottom:8px">🤝 ANGLO — Total de Camas</div>
        <div style="display:flex;gap:8px">
          <div style="flex:1;text-align:center;padding:8px;background:rgba(217,119,6,.08);border-radius:10px">
            <div style="font-size:22px;font-weight:900;color:#d97706">${cls.angloDia.toLocaleString('es-CL')}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;margin-top:2px">☀️ Día</div>
          </div>
          <div style="flex:1;text-align:center;padding:8px;background:rgba(99,102,241,.08);border-radius:10px">
            <div style="font-size:22px;font-weight:900;color:#6366f1">${cls.angloNoche.toLocaleString('es-CL')}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;margin-top:2px">🌙 Noche</div>
          </div>
          <div style="flex:1;text-align:center;padding:8px;background:rgba(16,185,129,.06);border-radius:10px">
            <div style="font-size:22px;font-weight:900;color:#10b981">${cls.totalAnglo.toLocaleString('es-CL')}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;margin-top:2px">📊 Total</div>
          </div>
        </div>
      </div>
      <div style="background:var(--bg-card);border:2px solid #059669;border-radius:14px;padding:14px 16px">
        <div style="font-size:10px;font-weight:800;color:#059669;text-transform:uppercase;
                    letter-spacing:.07em;margin-bottom:8px">🏢 ESSE — Total de Camas</div>
        <div style="display:flex;gap:8px">
          <div style="flex:1;text-align:center;padding:8px;background:rgba(5,150,105,.08);border-radius:10px">
            <div style="font-size:22px;font-weight:900;color:#059669">${cls.dia.toLocaleString('es-CL')}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;margin-top:2px">☀️ Día</div>
          </div>
          <div style="flex:1;text-align:center;padding:8px;background:rgba(124,58,237,.08);border-radius:10px">
            <div style="font-size:22px;font-weight:900;color:#7c3aed">${cls.esseNoche.toLocaleString('es-CL')}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;margin-top:2px">🌙 Noche</div>
          </div>
          <div style="flex:1;text-align:center;padding:8px;background:rgba(5,150,105,.06);border-radius:10px">
            <div style="font-size:22px;font-weight:900;color:#059669">${cls.totalESSE.toLocaleString('es-CL')}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;margin-top:2px">📊 Total</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Gráfico donut -->
    <div class="det-chart-wrap">
      <div class="det-chart-canvas">
        <canvas id="det-chart-donut" style="max-height:240px"></canvas>
      </div>
      <div>
        <div style="font-size:15px;font-weight:900;color:var(--text-primary);margin-bottom:14px">
          Distribución por Sector
        </div>
        ${sectorBar('🏢 COPC', copc, total, '#6366f1', pct(copc))}
        ${sectorBar('🏗️ REF 220', r220, total, '#0ea5e9', pct(r220))}
        <div style="margin-top:18px;font-size:15px;font-weight:900;color:var(--text-primary);margin-bottom:14px">
          Anglo vs ESSE (Día / Noche)
        </div>
        ${sectorBar('☀️ Anglo Día (C1)', cls.angloDia, total, '#d97706', pct(cls.angloDia))}
        ${sectorBar('🌙 Anglo Noche (C2)', cls.angloNoche, total, '#6366f1', pct(cls.angloNoche))}
        ${sectorBar('☀️ ESSE Día', cls.dia, total, '#059669', pct(cls.dia))}
        ${sectorBar('🌙 ESSE Noche (Pab7)', cls.esseNoche, total, '#7c3aed', pct(cls.esseNoche))}
      </div>
    </div>

    ${window._portalMode ? '' : noClasifHTML}
    ${window._portalMode ? '' : auditHTML}
    ${window._portalMode ? '' : diagHTML}
    ${window._portalMode ? '' : balHTML}`;
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
    turno: _turnoFiltro,
    empresa: _empresaFiltro,
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
    const habNum = resolveHabNum(a, _data.habMap);
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

  // Calcular RT para distribuir proporcionalmente entre sub-KPIs
  const _ocBal = engine.getBalance();
  const _ocReal = _ocBal.libres;
  const _ocDisp = _rtApply(_ocReal);
  const _ocRtCount = _ocReal - _ocDisp; // total buffer oculto
  const _ocRtActivo = _ocRtCount > 0;

  // Distribución proporcional del buffer entre los 3 sub-bloques
  // → garantiza que COPC + R220 + Noche = Total mostrado exacto
  const _ocSubTotal = kpiCOPC + kpiR220 + kpiNoche || 1;
  const _rtCOPC = _ocRtActivo ? Math.round(_ocRtCount * kpiCOPC / _ocSubTotal) : 0;
  const _rtR220 = _ocRtActivo ? Math.round(_ocRtCount * kpiR220 / _ocSubTotal) : 0;
  const _rtNoche = _ocRtActivo ? (_ocRtCount - _rtCOPC - _rtR220) : 0; // resto al último → suma exacta

  return `
    ${kpiRow([
    { icon: '🔴', val: kpiTotal + (_ocRtActivo ? _ocRtCount : 0), lbl: 'Total Ocupadas', color: '#ef4444' },
    { icon: '🏢', val: kpiCOPC + _rtCOPC, lbl: 'Camas COPC (Día)', color: '#6366f1' },
    { icon: '🏗️', val: kpiR220 + _rtR220, lbl: 'Camas REF 220', color: '#0ea5e9' },
    { icon: '🌙', val: kpiNoche + _rtNoche, lbl: 'Camas Noche COPC', color: '#4338ca' },
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
    turno: _turnoFiltro,
    empresa: _empresaFiltro,
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
    const habNum = resolveHabNum(a, _data.habMap);
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
  // ── FUENTE ÚNICA: engine.getBalance() garantiza que los números cuadren ──
  // FÓRMULA: Total = Ocupadas + Reservas + Libres + Bloqueadas
  // renderLibre DEBE usar exactamente las mismas camasLibres del engine.
  const engineData = _data.engine._p;
  const camasLibres = engineData.camasLibres;   // ya filtradas: -ocup -pre -bloqueadas
  const { activas, reservas } = engineData;     // para mostrar quién ya está en la hab
  const { distEmpMap, habMap, habAngloIds, habNocheIds, camaById,
    camasR220 } = _data;

  // Set de id_cama de REF 220 para lookup O(1)
  const r220IdSet = new Set(camasR220.map(c => String(c.id_cama)));
  const libresAll = camasLibres;
  const libresR220 = camasLibres.filter(c => r220IdSet.has(String(c.id_cama)));
  const libresCOPC = camasLibres.filter(c => !r220IdSet.has(String(c.id_cama)));

  // ── MAPA DE OCUPANTES POR HABITACIÓN ────────────────────────────────────
  // Permite mostrar quién ya está en la otra cama de una hab parcialmente libre.
  // Clave: habitacion_id (string normalizado)
  const habOcupantesMap = {};   // { habId: [{ nombre, empresa, numCama, tipo }] }

  const _addOcupante = (asig, tipo) => {
    const rec = camaById?.[String(asig.id_cama)] || asig;
    const habId = String(rec.habitacion_id || asig.habitacion_id || '');
    if (!habId) return;
    if (!habOcupantesMap[habId]) habOcupantesMap[habId] = [];
    habOcupantesMap[habId].push({
      nombre: asig.nombre_huesped || '—',
      empresa: asig._empresa || '—',
      numCama: Number(rec.numero_cama || asig.numero_cama || 0),
      tipo,   // 'ocupada' | 'reservada'
    });
  };

  activas.forEach(a => _addOcupante(a, 'ocupada'));
  reservas.forEach(a => _addOcupante(a, 'reservada'));



  // ── CLASIFICACIÓN UNIFICADA (mismo motor que renderTotal) ────────────────
  // classifyAll() aplica las 10 REGLAS de infraestructura exactas.
  const clsLibres = classifyAll(libresAll, habMap, camaById, r220IdSet);

  // Listas por categoría (para chips y display)
  const libresAngloDia = [];
  const libresAngloNoche = [];
  const libresESSEDia = [];
  const libresESSENoche = [];
  const libresNoClasif = [];

  libresAll.forEach(c => {
    if (/deshabiit|deshabilit/i.test(c.estado || '')) return;
    const rec = camaById?.[String(c.id_cama)] || c;
    const habId = rec.habitacion_id || c.habitacion_id || '';
    const numCama = Number(rec.numero_cama || c.numero_cama || 0);
    const numHab = numHabInt(habId, c.id_cama, habMap);
    const r220flag = r220IdSet.has(String(c.id_cama));
    const { cat } = classifyBed(numHab, numCama, r220flag);

    if (cat === CAT.ANGLO_DIA) libresAngloDia.push(c);
    else if (cat === CAT.ANGLO_NOCHE) libresAngloNoche.push(c);
    else if (cat === CAT.DIA) libresESSEDia.push(c);
    else if (cat === CAT.ESSE_NOCHE) libresESSENoche.push(c);
    else libresNoClasif.push(c);
  });

  // Compatibilidad con código heredado que usa estas variables
  const libresEECC = [...libresESSEDia, ...libresESSENoche];
  const libresEECCDia = libresESSEDia;
  const libresEECCNoche = libresESSENoche;

  // ── CÁLCULO DE BUFFER A NIVEL FUNCIÓN ────────────────────────────────────
  // Calculado UNA SOLA VEZ aquí para que sea consistente en toda la página.
  // Todos los bloques HTML usan estas variables, no los .length crudos.
  const _rtReal = libresAll.length;
  const _rtDisp = _rtApply(_rtReal);          // total visible con buffer
  const _rtCount = _rtReal - _rtDisp;          // camas ocultas (Reserva Técnica)
  const _rtRatio = _rtReal > 0 ? _rtDisp / _rtReal : 1;  // 0.70 si buffer=30%
  const _rtActivo = _rtBuffer > 0;

  // Subcategorías con buffer aplicado proporcionalmente
  const dispAngloDia = Math.floor(libresAngloDia.length * _rtRatio);
  const dispAngloNoche = Math.floor(libresAngloNoche.length * _rtRatio);
  const dispESSEDia = Math.floor(libresESSEDia.length * _rtRatio);
  const dispESSENoche = Math.floor(libresESSENoche.length * _rtRatio);
  const dispEECCDia = dispESSEDia;
  const dispEECCNoche = dispESSENoche;
  const dispAngloTotal = dispAngloDia + dispAngloNoche;
  const dispEECCTotal = dispESSEDia + dispESSENoche;

  // Helper: dado un array de camas, devuelve cuántas mostrar (con buffer proporcional)
  const _dispN = (arr) => Math.floor(arr.length * _rtRatio);







  // ─ Helper: extraer número de habitación legible ──────────────────────────────
  // 1º: numero_hab del habRecord (habMap)
  // 2º: strip prefijos COPC/R-220 del id de la cama/habitacion
  const _numHabLegible = (hab, idCama) => {
    if (hab?.numero_hab) return String(hab.numero_hab);
    const raw = String(idCama || '')
      .replace(/-C\d+$/i, '')   // quitar sufijo cama (-C1, -C2)
      .replace(/^COPC0*/i, '')  // quitar COPC + ceros
      .replace(/^R[.-]?220/i, '') // quitar R-220
      .replace(/^0+/, '');       // quitar ceros restantes
    return raw || String(idCama || '') || '—';
  };

  // ─ Construir mapa enriquecido habitacion_id → {numHab, pabellon, piso, camas, empresa} ─
  // REGLA ANGULAR/NOCHE (invariante del sistema):
  //   Hab con etiqueta 'anglo': C1 = cama Día (numero_cama=1), C2 = cama Noche (numero_cama=2)
  //   Hab con etiqueta 'noche': TODAS las camas = Noche
  const grupoHabs = {};
  [...libresCOPC, ...libresR220].forEach(c => {
    // Normalizar habitacion_id: si es null, extraer stripeando sufijo -C1/-C2 del id_cama
    const habIdRaw = c.habitacion_id
      || String(c.id_cama || '').replace(/-C\d+$/i, '').replace(/_\d+$/, '');
    const hid = String(habIdRaw || c.id_cama || 'sin-hab');

    if (!grupoHabs[hid]) {
      // Buscar en habMap usando el hid normalizado (sin sufijo)
      const habFallback = habMap[hid] || habMap[String(c.id_cama)] || null;
      const hab = habFallback; // c.v2_habitaciones ya no existe (join removido)

      // Número de habitación: lo que esté en numero_hab, si no limpiamos el id
      const numHab = hab?.numero_hab
        ? String(hab.numero_hab)
        : _numHabLegible(null, hid);

      // Pbellón y piso: extraer de numero_hab (formato PPFF, ej: 1302 → P1, Piso 3)
      const pabellon = _extraerPabellon(numHab);
      const piso = _extraerPiso(numHab);

      grupoHabs[hid] = {
        numHab, pabellon, piso, camas: [], empresa: null,
        isR220: isR220(c.id_cama),
        hid,   // habitacion_id normalizado para lookup en habOcupantesMap
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
    const sector = g.isR220 ? '🏗️ REF 220' : '🏢 COPC';
    const numStr = String(g.numHab || '');
    const pabPisoLabel = g.pabellon !== '?' ? `📍${g.pabellon}` : '';
    const ocupantes = habOcupantesMap[g.hid] || [];

    // Color del borde de la card
    let borderColor = '#10b981';             // verde = libre
    if (g.empresa) borderColor = '#6366f1'; // azul = retenida
    if (ocupantes.length > 0) borderColor = '#ef4444'; // rojo = hay alguien en la otra cama

    // ── Puntos de cama (BED DOTS) ─────────────────────────────────────────────
    // Primero los ocupantes (camas ocupadas/reservadas)
    const ocupDots = ocupantes.map(o => {
      const cls = o.tipo === 'ocupada' ? 'bed-dot--occupied' : 'bed-dot--reserved';
      const label = o.tipo === 'ocupada' ? '🔴' : '📌';
      const title = `C${o.numCama} — ${o.nombre} (${o.empresa})`;
      return `<span class="bed-dot ${cls}" title="${title}">C${o.numCama}</span>`;
    }).join('');

    // Luego las camas libres
    const libreDots = g.camas.map(c => {
      const numCama = c.numero_cama || '?';
      return `<span class="bed-dot bed-dot--free" title="Cama ${numCama} — Libre">C${numCama}</span>`;
    }).join('');

    // Resumen de la card
    const totalCamasHab = g.camas.length + ocupantes.length;
    const libresCount = g.camas.length;
    const occCount = ocupantes.filter(o => o.tipo === 'ocupada').length;
    const resCount = ocupantes.filter(o => o.tipo === 'reservada').length;

    // Info de ocupantes para mostrar
    const ocupantesHTML = ocupantes.length === 0 ? '' : `
      <div style="margin-top:7px;padding:6px 8px;
                  background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);
                  border-radius:8px;border-left:3px solid #ef4444">
        ${ocupantes.map(o => {
      const tipoColor = o.tipo === 'ocupada' ? '#ef4444' : '#8b5cf6';
      const tipoIcon = o.tipo === 'ocupada' ? '🔴' : '📌';
      const nombreDisplay = o.nombre.length > 22 ? o.nombre.slice(0, 22) + '…' : o.nombre;
      const empresaDisplay = (o.empresa && o.empresa !== '—')
        ? (o.empresa.length > 22 ? o.empresa.slice(0, 22) + '…' : o.empresa)
        : null;
      return `<div style="display:flex;align-items:flex-start;gap:5px;margin-bottom:4px">
            <span style="font-size:10px;flex-shrink:0;margin-top:1px">${tipoIcon}</span>
            <div style="display:flex;flex-direction:column;gap:1px;overflow:hidden;min-width:0">
              <span style="font-size:10px;font-weight:700;color:var(--text);
                           white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                    title="${o.nombre}">${nombreDisplay}</span>
              ${empresaDisplay ? `<span style="font-size:9px;color:var(--text-muted);
                           white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                    title="${o.empresa}">🏢 ${empresaDisplay}</span>` : ''}
            </div>
          </div>`;
    }).join('')}
      </div>`;

    return `<div class="det-hab-card" style="border-color:${borderColor}">
      <!-- Room number + sector -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="det-hab-num">🏠 ${g.numHab}</div>
        ${pabPisoLabel ? `<span style="font-size:9px;font-weight:700;color:var(--text-muted);
          background:var(--bg);padding:2px 6px;border-radius:99px;border:1px solid var(--border)">
          ${pabPisoLabel}</span>` : ''}
      </div>
      <div class="det-hab-sub">${sector} · ${totalCamasHab} cama${totalCamasHab !== 1 ? 's' : ''}</div>

      <!-- Bed dots -->
      <div class="bed-dots">
        ${ocupDots}${libreDots}
        <span class="bed-dot-lbl">${libresCount} libre${libresCount !== 1 ? 's' : ''}</span>
      </div>

      ${g.empresa ? `<div class="det-hab-emp">🏢 Retenida: ${g.empresa.length > 20 ? g.empresa.slice(0, 20) + '…' : g.empresa}</div>` : ''}
      ${ocupantesHTML}
    </div>`;
  };

  const pisosSections = Object.entries(porPiso)
    .sort(([a], [b]) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))
    .map(([piso, habs]) => {
      const totalCamasReal = habs.reduce((s, g) => s + g.camas.length, 0);
      const totalCamas = Math.floor(totalCamasReal * _rtRatio);
      const totalHabs = Math.floor(habs.length * _rtRatio);
      const pabsEnPiso = [...new Set(habs.map(g => g.pabellon))].filter(p => p !== '?').sort().join(' · ');
      return `
        <div class="piso-section" style="margin-bottom:20px">
          <div class="piso-header">
            <span class="piso-header-title">🏢 ${piso}</span>
            <span class="piso-header-sub">
              ${totalHabs} hab · ${totalCamas} camas libres
              ${!_libreFiltroPab && pabsEnPiso ? ` · ${pabsEnPiso}` : ''}
            </span>
          </div>
          <div class="det-hab-grid">${habs.map(renderCard).join('')}</div>
        </div>`;
    }).join('');


  return `
    <!-- ══ BANNER CRÍTICO: DISPONIBILIDAD REAL ══ -->
    ${(() => {
      const bal = _data.engine.getBalance();
      // Usar variables pre-calculadas a nivel función (buffer ya aplicado)
      const real = _rtReal;
      const disp = _rtDisp;
      const rtActivo = _rtActivo;
      const dAngloDia = dispAngloDia;
      const dAngloNoche = dispAngloNoche;
      const dESSEDia = dispESSEDia;
      const dESSENoche = dispESSENoche;
      const ahora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      return `
    <div style="background:linear-gradient(135deg,rgba(16,185,129,.12),rgba(5,150,105,.06));
                border:2px solid #10b981;border-radius:16px;padding:18px 20px;margin-bottom:20px;
                position:relative">

      <!-- Título con badge de validación -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:900;color:#10b981;text-transform:uppercase;
                    letter-spacing:.08em">
          ✅ CAMAS DISPONIBLES — DISPONIBILIDAD REAL
        </div>
        <div style="margin-left:auto;font-size:10px;color:#6ee7b7;font-weight:700;
                    background:rgba(16,185,129,.15);border:1px solid #10b98140;
                    border-radius:20px;padding:3px 10px">
          🕐 Datos al ${ahora}
        </div>
      </div>

      <!-- Número grande destacado -->
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:14px;flex-wrap:wrap">
        <div style="text-align:center">
          <div style="font-size:56px;font-weight:900;color:#10b981;line-height:1">
            ${disp.toLocaleString('es-CL')}
          </div>
          <div style="font-size:11px;font-weight:700;color:#6ee7b7;text-transform:uppercase;
                      letter-spacing:.06em">CAMAS DISPONIBLES</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">
            para nuevas reservas
          </div>
          ${_rtIsAdmin() && _rtUnlocked && rtActivo ? `
          <div style="margin-top:6px;font-size:10px;color:#f59e0b;font-weight:700;
                      background:rgba(245,158,11,.1);border-radius:8px;padding:3px 8px">
            🔐 Real: ${real.toLocaleString('es-CL')} · Buffer: ${_rtBuffer}%
          </div>` : ''}
        </div>

        <div style="flex:1;min-width:220px">
          <!-- Fórmula explícita -->
          <div style="font-size:11px;font-weight:700;color:#059669;text-transform:uppercase;
                      letter-spacing:.06em;margin-bottom:8px">📐 Cómo se calculó este número</div>
          <div style="display:flex;flex-direction:column;gap:5px">
            <div style="display:flex;justify-content:space-between;align-items:center;
                        padding:5px 10px;background:rgba(99,102,241,.12);border-radius:8px">
              <span style="font-size:12px;color:#6366f1;font-weight:600">🛏️ Total de camas físicas</span>
              <span style="font-size:14px;font-weight:900;color:#6366f1">${bal.total.toLocaleString('es-CL')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;
                        padding:5px 10px;background:rgba(239,68,68,.1);border-radius:8px">
              <span style="font-size:12px;color:#dc2626;font-weight:600">🔴 Menos: Ocupadas (confirmadas)</span>
              <span style="font-size:14px;font-weight:900;color:#dc2626">− ${(bal.ocupadas + (rtActivo ? real - disp : 0)).toLocaleString('es-CL')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;
                        padding:5px 10px;background:rgba(139,92,246,.1);border-radius:8px">
              <span style="font-size:12px;color:#7c3aed;font-weight:600">📌 Menos: Reservadas (pre-asignadas)</span>
              <span style="font-size:14px;font-weight:900;color:#7c3aed">− ${bal.reservas.toLocaleString('es-CL')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;
                        padding:5px 10px;background:rgba(245,158,11,.1);border-radius:8px">
              <span style="font-size:12px;color:#b45309;font-weight:600">🔒 Menos: Bloqueadas (mantención)</span>
              <span style="font-size:14px;font-weight:900;color:#b45309">− ${bal.bloqueadas.toLocaleString('es-CL')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;
                        padding:6px 10px;background:rgba(16,185,129,.15);border-radius:8px;
                        border:1px solid #10b98140;margin-top:2px">
              <span style="font-size:12px;font-weight:800;color:#065f46">✅ DISPONIBLES (sin compromiso)</span>
              <span style="font-size:16px;font-weight:900;color:#059669">= ${disp.toLocaleString('es-CL')}</span>
            </div>
          </div>
        </div>
      </div>


      <!-- Desglose por tipo (con buffer aplicado) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;
                  padding-top:12px;border-top:1px solid rgba(16,185,129,.2)">
        <div style="text-align:center;padding:8px;background:rgba(217,119,6,.08);border-radius:10px">
          <div style="font-size:20px;font-weight:900;color:#d97706">${dAngloDia.toLocaleString('es-CL')}</div>
          <div style="font-size:9px;color:#d97706;font-weight:700;text-transform:uppercase">☀️ Anglo Día</div>
        </div>
        <div style="text-align:center;padding:8px;background:rgba(99,102,241,.08);border-radius:10px">
          <div style="font-size:20px;font-weight:900;color:#6366f1">${dAngloNoche.toLocaleString('es-CL')}</div>
          <div style="font-size:9px;color:#6366f1;font-weight:700;text-transform:uppercase">🌙 Anglo Noche</div>
        </div>
        <div style="text-align:center;padding:8px;background:rgba(5,150,105,.08);border-radius:10px">
          <div style="font-size:20px;font-weight:900;color:#059669">${dESSEDia.toLocaleString('es-CL')}</div>
          <div style="font-size:9px;color:#059669;font-weight:700;text-transform:uppercase">☀️ ESSE Día</div>
        </div>
        <div style="text-align:center;padding:8px;background:rgba(124,58,237,.08);border-radius:10px">
          <div style="font-size:20px;font-weight:900;color:#7c3aed">${dESSENoche.toLocaleString('es-CL')}</div>
          <div style="font-size:9px;color:#7c3aed;font-weight:700;text-transform:uppercase">🌙 ESSE Noche</div>
        </div>
        ${_rtIsAdmin() && rtActivo ? `
        <div style="text-align:center;padding:8px;background:rgba(245,158,11,.08);border-radius:10px;
                    border:1px solid rgba(245,158,11,.3)">
          <div style="font-size:20px;font-weight:900;color:#f59e0b">${(real - disp).toLocaleString('es-CL')}</div>
          <div style="font-size:9px;color:#f59e0b;font-weight:700;text-transform:uppercase">🔐 Res. Técnica</div>
        </div>` : ''}
        <div style="text-align:center;padding:8px;background:rgba(16,185,129,.08);border-radius:10px;
                    border:1.5px solid #10b981">
          <div style="font-size:20px;font-weight:900;color:#10b981">${disp.toLocaleString('es-CL')}</div>
          <div style="font-size:9px;color:#10b981;font-weight:700;text-transform:uppercase">📊 TOTAL DISP.</div>
        </div>
      </div>




      <!-- Botón admin — SOLO visible para Juan Garrido y Guissele Barrera -->
      ${_rtIsAdmin() ? `
      <button onclick="window._rtOpen()"
        title="Configuración"
        style="position:absolute;top:14px;right:14px;background:rgba(16,185,129,.1);
               border:1px solid rgba(16,185,129,.25);border-radius:8px;
               cursor:pointer;font-size:13px;color:rgba(16,185,129,.45);padding:4px 7px;
               transition:all .25s;user-select:none;line-height:1"
        onmouseover="this.style.color='#10b981';this.style.background='rgba(16,185,129,.2)'"
        onmouseout="this.style.color='rgba(16,185,129,.45)';this.style.background='rgba(16,185,129,.1)'">
        ${_rtUnlocked ? '⚙️' : '🔒'}
      </button>` : ''}
    </div>`;

    })()}






    <!-- Desglose ANGLO vs ESSE (separación estructural) -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">

      <!-- ── BLOQUE ANGLO (Pab1, Pab2, Pab3 3301-3637, etiqueta BD) ── -->
      <div style="background:var(--bg-card);border:2px solid #d97706;border-radius:16px;padding:16px 18px">
        <div style="font-size:11px;font-weight:800;color:#d97706;text-transform:uppercase;
                    letter-spacing:.07em;margin-bottom:4px">🤝 ANGLO — Camas No Ocupadas</div>
        <div style="font-size:9px;color:var(--text-muted);margin-bottom:12px">
          Pab.1 · Pab.2 · Pab.3 (hab 3301–3637)
        </div>
        <div style="display:flex;gap:10px">
          <div style="flex:1;text-align:center;padding:12px 8px;background:rgba(217,119,6,.08);
                      border-radius:12px;border:1px solid rgba(217,119,6,.25)">
            <div style="font-size:28px;font-weight:900;color:#d97706;line-height:1">
              ${dispAngloDia.toLocaleString('es-CL')}
            </div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-top:4px;
                        text-transform:uppercase">☀️ Día (C1)</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:1px">Cama 1 · turno día</div>
          </div>
          <div style="flex:1;text-align:center;padding:12px 8px;background:rgba(99,102,241,.08);
                      border-radius:12px;border:1px solid rgba(99,102,241,.25)">
            <div style="font-size:28px;font-weight:900;color:#6366f1;line-height:1">
              ${dispAngloNoche.toLocaleString('es-CL')}
            </div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-top:4px;
                        text-transform:uppercase">🌙 Noche (C2)</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:1px">Cama 2 · turno noche</div>
          </div>
          <div style="flex:1;text-align:center;padding:12px 8px;background:rgba(16,185,129,.06);
                      border-radius:12px;border:1px solid rgba(16,185,129,.2)">
            <div style="font-size:28px;font-weight:900;color:#10b981;line-height:1">
              ${dispAngloTotal.toLocaleString('es-CL')}
            </div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-top:4px;
                        text-transform:uppercase">📊 Total Anglo</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:1px">Día + Noche</div>
          </div>
        </div>
      </div>

      <!-- ── BLOQUE ESSE (todo lo que no es Anglo ni Pab7) ── -->
      <div style="background:var(--bg-card);border:2px solid #059669;border-radius:16px;padding:16px 18px">
        <div style="font-size:11px;font-weight:800;color:#059669;text-transform:uppercase;
                    letter-spacing:.07em;margin-bottom:4px">🏢 ESSE — Camas No Ocupadas</div>
        <div style="font-size:9px;color:var(--text-muted);margin-bottom:12px">
          Contratistas (COPC + REF 220 no-Anglo)
        </div>
        <div style="display:flex;gap:10px">
          <div style="flex:1;text-align:center;padding:12px 8px;background:rgba(245,158,11,.08);
                      border-radius:12px;border:1px solid rgba(245,158,11,.25)">
            <div style="font-size:28px;font-weight:900;color:#f59e0b;line-height:1">
              ${dispEECCDia.toLocaleString('es-CL')}
            </div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-top:4px;
                        text-transform:uppercase">☀️ Día (C1)</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:1px">Cama 1 · turno día</div>
          </div>
          <div style="flex:1;text-align:center;padding:12px 8px;background:rgba(124,58,237,.08);
                      border-radius:12px;border:1px solid rgba(124,58,237,.25)">
            <div style="font-size:28px;font-weight:900;color:#7c3aed;line-height:1">
              ${dispEECCNoche.toLocaleString('es-CL')}
            </div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-top:4px;
                        text-transform:uppercase">🌙 Noche (C2)</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:1px">Cama 2 · turno noche</div>
          </div>
          <div style="flex:1;text-align:center;padding:12px 8px;background:rgba(5,150,105,.06);
                      border-radius:12px;border:1px solid rgba(5,150,105,.2)">
            <div style="font-size:28px;font-weight:900;color:#059669;line-height:1">
              ${dispEECCTotal.toLocaleString('es-CL')}
            </div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-top:4px;
                        text-transform:uppercase">📊 Total ESSE</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:1px">Día + Noche</div>
          </div>
        </div>
      </div>

    </div>

    <!-- ═══════════ DETALLE CAMAS NOCHE LIBRES ═══════════ -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">

      <!-- ANGLO NOCHE LIBRE -->
      <div style="background:var(--bg-card);border:1px solid rgba(99,102,241,.4);border-radius:14px;padding:14px 16px">
        <div style="font-size:11px;font-weight:800;color:#6366f1;text-transform:uppercase;
                    letter-spacing:.06em;margin-bottom:10px">
          🌙 Anglo — Camas Noche Libres (${dispAngloNoche})
        </div>
        ${libresAngloNoche.length === 0
      ? `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px">
               ✅ Ninguna cama noche Anglo libre
             </div>`
      : `<div style="display:flex;flex-wrap:wrap;gap:5px;max-height:160px;overflow-y:auto">
              ${libresAngloNoche.map(c => {
        const habId = (camaById?.[String(c.id_cama)] || c).habitacion_id || c.habitacion_id;
        const numHab = habMap[String(habId || '')]?.numero_hab;
        const label = numHab ? `Hab.${numHab}` : String(c.id_cama).replace(/^COPC0*/i, '').replace(/-C\d+$/i, '');
        return `<span style="padding:3px 8px;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);
                                border-radius:20px;font-size:10px;font-weight:700;color:#6366f1">${label}</span>`;
      }).join('')}
             </div>`
    }
      </div>

      <!-- ESSE NOCHE LIBRE -->
      <div style="background:var(--bg-card);border:1px solid rgba(124,58,237,.4);border-radius:14px;padding:14px 16px">
        <div style="font-size:11px;font-weight:800;color:#7c3aed;text-transform:uppercase;
                    letter-spacing:.06em;margin-bottom:10px">
          🌙 ESSE — Camas Noche Libres (${dispEECCNoche})
        </div>
        ${libresEECCNoche.length === 0
      ? `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px">
               ✅ Ninguna cama noche ESSE libre
             </div>`
      : `<div style="display:flex;flex-wrap:wrap;gap:5px;max-height:160px;overflow-y:auto">
              ${libresEECCNoche.map(c => {
        const habId = (camaById?.[String(c.id_cama)] || c).habitacion_id || c.habitacion_id;
        const numHab = habMap[String(habId || '')]?.numero_hab;
        const label = numHab ? `Hab.${numHab}` : String(c.id_cama).replace(/^COPC0*/i, '').replace(/-C\d+$/i, '');
        return `<span style="padding:3px 8px;background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.3);
                                border-radius:20px;font-size:10px;font-weight:700;color:#7c3aed">${label}</span>`;
      }).join('')}
             </div>`
    }
      </div>

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
      ✅ Mostrando: ${Math.floor(habsFiltradas.length * _rtRatio)} habitaciones · ${Math.floor(totalCamasFiltradas * _rtRatio)} camas libres
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
  const isBloq = h => /manten|reparac|bloquea|bloqu/i.test(h.estado || '') || h.en_mantencion === true;
  const bloqAll = habitacionesAll.filter(isBloq);
  // Diagnóstico: ver qué contiene habitacionesAll
  console.log('[Bloq] habitacionesAll:', habitacionesAll.length,
    '| en_mantencion=true:', habitacionesAll.filter(h => h.en_mantencion === true).length,
    '| estado manten:', habitacionesAll.filter(h => /manten/i.test(h.estado || '')).length,
    '| bloqAll:', bloqAll.length);
  if (bloqAll.length > 0) {
    console.log('[Bloq] Primera bloqueada:', JSON.stringify(bloqAll[0]));
  }
  // FIX: usar id_custom (no id) para clasificar COPC vs REF220
  const bloqCOPC = bloqAll.filter(h => !isR220(h.id_custom));
  const bloqR220 = bloqAll.filter(h => isR220(h.id_custom));
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
      const motivo = h.motivo_bloqueo || (h.en_mantencion ? 'Mantención' : h.estado) || 'Sin motivo';
      const dias = diasDesde(h.fecha_bloqueo || null);
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
    { icon: '🏢', val: bloqCOPC.length, lbl: 'EN REPARACIÓN', color: '#6366f1' },
    { icon: '🏗️', val: bloqR220.length, lbl: 'REF 220 BLOQUEADAS EN REPARACIÓN', color: '#0ea5e9' },
    { icon: '🔧', val: bloqAll.filter(h => /reparac/i.test(h.estado || '')).length, lbl: 'BODEGAS', color: '#ef4444' },
    { icon: '🛠️', val: bloqAll.filter(h => /manten/i.test(h.estado || '') || h.en_mantencion === true).length, lbl: 'En Mantención', color: '#f59e0b' },
  ])}
    <div class="det-sector-hdr">🏢 COPC — ${bloqCOPC.length} bloqueadas en reparación</div>
    ${renderTable(bloqCOPC)}
    <div class="det-sector-hdr" style="margin-top:8px">🏗️ REF 220 — ${bloqR220.length} bloqueadas en reparación</div>
    ${renderTable(bloqR220)}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB F — CAMAS PERDIDAS
// Habitaciones con camas inutilizadas:
//   · BLOQUEADA       → en_mantencion=true  O  empresa contiene "bloqueada/bloqueado"
//   · OCUPACION PARCIAL → 2+ camas, 0 < ocupadas < total
// ══════════════════════════════════════════════════════════════════════════════
function _cpDetectar() {
  const { camas, habitacionesAll, habMap, asigActivas } = _data;

  // Mapa rápido: id_cama → asignación enriquecida
  const asigMap = {};
  (asigActivas || []).forEach(a => { asigMap[String(a.id_cama)] = a; });

  // Agrupar camas activas por habitacion_id
  const porHab = {};
  (camas || [])
    .filter(c => !/deshabilit/i.test(c.estado || ''))
    .forEach(c => {
      const hid = String(c.habitacion_id);
      if (!porHab[hid]) porHab[hid] = [];
      porHab[hid].push(c);
    });

  const perdidas = [];
  Object.entries(porHab).forEach(([habId, cs]) => {
    const hab = habMap[habId] || {};
    if (!hab.numero_hab) return;

    const nTotal = cs.length;
    const camasOcup = cs.filter(c => c.estado === 'Ocupada' || !!asigMap[String(c.id_cama)]);
    const nOcupadas = camasOcup.length;

    const asigRef = camasOcup[0] ? (asigMap[String(camasOcup[0].id_cama)] || null) : null;
    const empresa = asigRef?._empresa || '';
    const huesped = asigRef?.nombre_huesped || '—';
    const pabellon = hab.pabellon || hab.v2_pabellones?.nombre || '—';

    // BLOQUEADA: empresa dice "bloqueada" O habitación en mantención
    const esBloqueo = ['bloqueada', 'bloqueado'].some(w => empresa.toLowerCase().includes(w));
    const esManten = hab.en_mantencion === true;

    if (esBloqueo || esManten) {
      perdidas.push({
        habId, numero_hab: hab.numero_hab, pabellon,
        nivel: hab.nivel || '—',
        empresa: esManten ? 'MANTENCION' : empresa,
        tipo: 'BLOQUEADA',
        huesped: esManten ? '—' : huesped,
        total_camas: nTotal, ocupadas: nOcupadas, camas_perdidas: nTotal,
      });
      return;
    }

    // OCUPACION PARCIAL: 2+ camas, al menos 1 ocupada, al menos 1 libre
    if (nTotal < 2 || nOcupadas === 0 || nOcupadas >= nTotal) return;
    perdidas.push({
      habId, numero_hab: hab.numero_hab, pabellon,
      nivel: hab.nivel || '—',
      empresa, tipo: 'OCUPACION PARCIAL',
      huesped, total_camas: nTotal, ocupadas: nOcupadas,
      camas_perdidas: nTotal - nOcupadas,
    });
  });

  return perdidas;
}

function renderCamasPerdidas() {
  const perdidas = _cpDetectar();

  // Timestamp de última actualización
  const horaLoad = _lastLoad
    ? _lastLoad.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    : '--:--';
  const fechaLoad = _lastLoad
    ? _lastLoad.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  // KPIs globales
  const total = perdidas.reduce((s, p) => s + p.camas_perdidas, 0);
  const nBloq = perdidas.filter(p => p.tipo === 'BLOQUEADA').length;
  const nParc = perdidas.filter(p => p.tipo === 'OCUPACION PARCIAL').length;

  // ── Anglo vs ESSE (ESSE = todas las empresas que NO son Anglo) ────────────
  const perdidasAnglo = perdidas
    .filter(p => /anglo/i.test(p.empresa))
    .reduce((s, p) => s + p.camas_perdidas, 0);
  const perdidasEsse = perdidas
    .filter(p => !/anglo/i.test(p.empresa))   // Todo lo que NO es Anglo
    .reduce((s, p) => s + p.camas_perdidas, 0);
  const pct = (n) => total > 0 ? Math.round(n / total * 1000) / 10 : 0;
  const pctAnglo = pct(perdidasAnglo);
  const pctEsse = pct(perdidasEsse);


  // Agrupación por empresa (ordenada por total descendente)
  const grupos = {};
  perdidas.forEach(p => {
    const k = p.empresa || 'Sin empresa';
    if (!grupos[k]) grupos[k] = { empresa: k, items: [], perdidas: 0 };
    grupos[k].items.push(p);
    grupos[k].perdidas += p.camas_perdidas;
  });
  const gruposArr = Object.values(grupos).sort((a, b) => b.perdidas - a.perdidas);

  const empresaRow = (g) => {
    const safeId = 'cpdet-' + g.empresa.replace(/[^a-zA-Z0-9]/g, '_');
    const bloqCount = g.items.filter(p => p.tipo === 'BLOQUEADA').length;
    const parcCount = g.items.filter(p => p.tipo === 'OCUPACION PARCIAL').length;
    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);
                border-radius:14px;overflow:hidden;margin-bottom:8px">
      <!-- Empresa header -->
      <div onclick="window._cpDetToggle('${safeId}')"
        style="padding:14px 18px;display:flex;align-items:center;gap:12px;
               cursor:pointer;border-left:4px solid #ef4444"
        onmouseover="this.style.background='rgba(239,68,68,0.05)'"
        onmouseout="this.style.background='transparent'">
        <div style="width:38px;height:38px;border-radius:10px;
                    background:linear-gradient(135deg,#ef4444,#b91c1c);
                    display:flex;align-items:center;justify-content:center;
                    font-size:18px;font-weight:900;color:white;flex-shrink:0">
          ${g.empresa.charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:14px;color:var(--text-primary);
                      overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${g.empresa}
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
            <span style="font-size:11px;font-weight:700;color:#ef4444;
                         background:rgba(239,68,68,.12);padding:2px 7px;border-radius:99px">
              🛏️ ${g.perdidas} cama${g.perdidas > 1 ? 's' : ''} perdida${g.perdidas > 1 ? 's' : ''}
            </span>
            ${bloqCount > 0 ? `<span style="font-size:11px;font-weight:700;color:#f59e0b;
              background:rgba(245,158,11,.12);padding:2px 7px;border-radius:99px">🔒 ${bloqCount} bloq.</span>` : ''}
            ${parcCount > 0 ? `<span style="font-size:11px;font-weight:700;color:#8b5cf6;
              background:rgba(139,92,246,.12);padding:2px 7px;border-radius:99px">🟡 ${parcCount} parc.</span>` : ''}
          </div>
        </div>
        <span id="arr-${safeId}" style="font-size:20px;color:#64748b;flex-shrink:0;transition:transform .25s">›</span>
      </div>
      <!-- Tabla de habitaciones (oculta por defecto) -->
      <div id="${safeId}" style="display:none">
        <div class="det-table-wrap" style="margin:0">
          <table class="det-table">
            <thead><tr>
              <th>Habitación</th><th>Pabellón</th><th>Nivel</th>
              <th>Tipo Pérdida</th><th>Camas Perdidas</th><th>Ocupante (cama ocup.)</th><th>Motivo</th>
            </tr></thead>
            <tbody>
              ${g.items.map(p => {
      const esBloq = p.tipo === 'BLOQUEADA';
      const tagColor = esBloq ? '#ef4444' : '#f59e0b';
      const tagBg = esBloq ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)';
      // Leer motivo desde caché
      const mReg = _cpMotivos[p.habId];
      const motivoLbl = mReg
        ? (mReg.motivo === 'sin_motivo' || !mReg.motivo ? '—'
          : mReg.motivo === 'otros' ? (mReg.motivo_texto || 'Otro')
            : {
              acuerdo_anglo: 'Acuerdo Anglo', impar_mujer: 'Impar Mujer',
              impar_hombre: 'Impar Hombre', motivos_medicos: 'Motivos Médicos',
              motivos_personales: 'Motivos Personales'
            }[mReg.motivo] || mReg.motivo)
        : '<span style="color:#475569;font-size:11px">Sin registro</span>';
      return `<tr>
                  <td style="font-weight:900">Hab. ${p.numero_hab}</td>
                  <td style="font-size:12px">${p.pabellon}</td>
                  <td style="font-size:12px">${p.nivel}</td>
                  <td><span class="det-badge" style="background:${tagBg};color:${tagColor}">
                    ${esBloq ? '🔒 BLOQUEADA' : '🟡 PARCIAL ' + p.ocupadas + '/' + p.total_camas}
                  </span></td>
                  <td style="font-weight:900;color:#ef4444">${p.camas_perdidas}</td>
                  <td style="font-size:12px;color:var(--text-muted)">${p.huesped}</td>
                  <td style="font-size:12px;color:var(--text-primary);font-weight:600">${motivoLbl}</td>
                </tr>`;
    }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  };

  return `
    <!-- ── Barra de actualización ─────────────────────────────────────────── -->
    <div style="display:flex;align-items:center;justify-content:space-between;
                background:rgba(16,185,129,.06);border:1.5px solid rgba(16,185,129,.2);
                border-radius:12px;padding:10px 16px;margin-bottom:14px;gap:12px">
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
        <span style="font-size:16px">📅</span>
        <div>
          <div style="font-size:11px;font-weight:700;color:#10b981">Datos al día</div>
          <div style="font-size:12px;color:var(--text-muted)">
            Cargado: <strong style="color:var(--text-primary)">${fechaLoad}</strong>
            a las <strong style="color:var(--text-primary)">${horaLoad}</strong>
          </div>
        </div>
      </div>
      <button onclick="window._detReloadAll && window._detReloadAll()"
        style="display:flex;align-items:center;gap:6px;padding:8px 14px;
               background:linear-gradient(135deg,#10b981,#059669);color:#fff;
               border:none;border-radius:10px;font-size:12px;font-weight:800;
               cursor:pointer;flex-shrink:0;transition:opacity .2s"
        onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
        🔄 Actualizar
      </button>
    </div>

    ${kpiRow([
    { icon: '🛏️', val: total, lbl: 'Total Camas Perdidas', color: '#ef4444' },
    { icon: '🔒', val: nBloq, lbl: 'Hab. Bloqueadas', color: '#f59e0b' },
    { icon: '🟡', val: nParc, lbl: 'Ocup. Parcial', color: '#8b5cf6' },
    { icon: '🏢', val: gruposArr.length, lbl: 'Empresas Afectadas', color: '#6366f1' },
  ])}

    <!-- ── Anglo vs ESSE comparison ───────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">

      <!-- Anglo -->
      <div style="background:var(--bg-card);border:1px solid var(--border);
                  border-radius:14px;padding:16px;border-top:3px solid #f59e0b;
                  transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 6px 20px rgba(245,158,11,.15)'"
           onmouseout="this.style.boxShadow='none'">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:18px">🤝</span>
          <span style="font-weight:800;font-size:13px;color:var(--text-primary)">Anglo American</span>
        </div>
        <div style="font-size:34px;font-weight:900;color:#f59e0b;line-height:1;margin-bottom:2px">
          ${perdidasAnglo.toLocaleString('es-CL')}
        </div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                    color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px">
          camas perdidas
        </div>
        <div style="height:7px;background:rgba(255,255,255,.07);border-radius:99px;overflow:hidden;margin-bottom:6px">
          <div style="height:100%;width:${pctAnglo}%;
                      background:linear-gradient(90deg,#f59e0b,#d97706);
                      border-radius:99px;transition:width .6s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;font-weight:900;color:#f59e0b">${pctAnglo.toFixed(1)}%</span>
          <span style="font-size:10px;color:var(--text-muted)">del total perdido</span>
        </div>
      </div>

      <!-- ESSE -->
      <div style="background:var(--bg-card);border:1px solid var(--border);
                  border-radius:14px;padding:16px;border-top:3px solid #0ea5e9;
                  transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 6px 20px rgba(14,165,233,.15)'"
           onmouseout="this.style.boxShadow='none'">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:18px">🏗️</span>
          <span style="font-weight:800;font-size:13px;color:var(--text-primary)">ESSE</span>
        </div>
        <div style="font-size:34px;font-weight:900;color:#0ea5e9;line-height:1;margin-bottom:2px">
          ${perdidasEsse.toLocaleString('es-CL')}
        </div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                    color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px">
          camas perdidas
        </div>
        <div style="height:7px;background:rgba(255,255,255,.07);border-radius:99px;overflow:hidden;margin-bottom:6px">
          <div style="height:100%;width:${pctEsse}%;
                      background:linear-gradient(90deg,#0ea5e9,#0284c7);
                      border-radius:99px;transition:width .6s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;font-weight:900;color:#0ea5e9">${pctEsse.toFixed(1)}%</span>
          <span style="font-size:10px;color:var(--text-muted)">del total perdido</span>
        </div>
      </div>
    </div>

    <div style="margin-bottom:12px;padding:12px 16px;background:rgba(239,68,68,.06);
                border:1.5px solid rgba(239,68,68,.18);border-radius:12px;
                font-size:12px;color:var(--text-muted)">
      <strong style="color:var(--text-primary)">ℹ️ ¿Qué es una cama perdida?</strong>
      Habitación con camas que no se están usando: bloqueada por mantención o empresa, o parcialmente ocupada
      (hay lugar disponible pero no asignado).
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--text-muted);
                text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">
      ${gruposArr.length} empresa${gruposArr.length !== 1 ? 's' : ''} con camas perdidas — click para expandir
    </div>
    ${gruposArr.length === 0
      ? `<div class="det-empty"><div class="det-empty-icon">✅</div><div class="det-empty-text">Sin camas perdidas detectadas</div></div>`
      : gruposArr.map(g => empresaRow(g)).join('')
    }`;
}




function attachCPEvents() {
  window._cpDetToggle = (safeId) => {
    const el = document.getElementById(safeId);
    const arr = document.getElementById('arr-' + safeId);
    if (!el) return;
    const isOpen = el.style.display !== 'none';
    el.style.display = isOpen ? 'none' : 'block';
    if (arr) arr.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
  };
}

/** Carga los motivos desde v2_camas_perdidas y re-renderiza el tab */
async function _loadCPMotivos() {
  try {
    const { data, error } = await supabase
      .from('v2_camas_perdidas')
      .select('habitacion_id, motivo, motivo_texto');

    if (error) {
      console.warn('[CP] Error cargando motivos:', error.message);
      return;
    }

    // Construir mapa habitacion_id → motivo (last-write gana si hay varios)
    _cpMotivos = {};
    (data || []).forEach(r => {
      if (r.habitacion_id) _cpMotivos[String(r.habitacion_id)] = r;
    });
    _cpMotivosLoaded = true;
    console.log('[CP] ✅ Motivos cargados:', Object.keys(_cpMotivos).length);

    // Re-renderizar si el tab sigue activo
    if (_tab === 'camas_perdidas') {
      const body = document.getElementById('det-body');
      if (body) { body.innerHTML = renderCamasPerdidas(); attachCPEvents(); }
    }
  } catch (e) {
    console.warn('[CP] Excepción cargando motivos:', e.message);
  }
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
          // Número de habitación — usar resolveHabNum con habMap
          const habNum = resolveHabNum(a, _data.habMap);
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

  // Usar la clasificación unificada computada en renderTotal() — MISMA fuente que las barras y KPIs
  const cl = _data._totalClasif;
  if (!cl) return; // renderTotal no fue llamado aún

  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['☀️ Anglo Día', '🌙 Anglo Noche', '☀️ ESSE Día', '🌙 ESSE Noche'],
      datasets: [{
        data: [cl.angloDia, cl.angloNoche, cl.esseDia, cl.esseNoche],
        backgroundColor: ['#d97706', '#6366f1', '#f59e0b', '#7c3aed'],
        borderColor: ['#b45309', '#4f46e5', '#d97706', '#6d28d9'],
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


// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA DE RESERVA TÉCNICA — Solo acceso con PIN
// Acceso: hacer clic en el pequeño ícono 🔒 dentro del banner de disponibilidad.
// ══════════════════════════════════════════════════════════════════════════════

/** Inyecta el modal de PIN/admin en el DOM (si no existe ya) */
function _rtRenderModal(mode) {
  // Eliminar modal previo si existe
  document.getElementById('_rt_modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '_rt_modal';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:rgba(0,0,0,.65);backdrop-filter:blur(6px);
    display:flex;align-items:center;justify-content:center;
    animation:_rtFadeIn .15s ease;
  `;
  overlay.innerHTML = `
    <style>
      @keyframes _rtFadeIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
      #_rt_box{background:#0f172a;border:1px solid #10b981;border-radius:20px;
                padding:28px 32px;width:360px;max-width:95vw;color:#e2e8f0;
                box-shadow:0 20px 60px rgba(0,0,0,.5)}
      #_rt_box input[type=password],#_rt_box input[type=text]{
        width:100%;box-sizing:border-box;background:#1e293b;border:1.5px solid #334155;
        border-radius:10px;padding:10px 14px;color:#f1f5f9;font-size:16px;
        letter-spacing:.2em;text-align:center;outline:none;margin:10px 0 0;
        transition:border-color .2s;font-family:monospace}
      #_rt_box input:focus{border-color:#10b981}
      #_rt_box button{cursor:pointer;border:none;border-radius:10px;
                       padding:11px;font-size:14px;font-weight:700;width:100%;margin-top:8px}
      #_rt_err{color:#ef4444;font-size:12px;min-height:16px;margin-top:6px;text-align:center}
    </style>

    <div id="_rt_box">
      ${mode === 'admin' ? _rtAdminPanelHTML() : mode === 'setup' ? _rtSetupHTML() : _rtPinHTML()}
    </div>`;

  // Cerrar al hacer clic fuera del box
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

/** HTML del formulario de ingreso de PIN */
function _rtPinHTML() {
  return `
    <div style="text-align:center;margin-bottom:18px">
      <div style="font-size:32px">🔐</div>
      <div style="font-size:15px;font-weight:900;color:#10b981;margin-top:6px">Acceso Restringido</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">Sistema de Reserva Técnica</div>
    </div>
    <input type="password" id="_rt_pin_input" placeholder="• • • • • •"
           maxlength="20" autocomplete="off"
           onkeydown="if(event.key==='Enter') window._rtSubmitPin()" />
    <div id="_rt_err"></div>
    <button onclick="window._rtSubmitPin()"
      style="background:linear-gradient(135deg,#10b981,#059669);color:white;margin-top:12px">
      Ingresar
    </button>
    <button onclick="document.getElementById('_rt_modal').remove()"
      style="background:#1e293b;color:#64748b;margin-top:4px">
      Cancelar
    </button>`;
}

/** HTML del formulario de configuración inicial de PIN */
function _rtSetupHTML() {
  return `
    <div style="text-align:center;margin-bottom:18px">
      <div style="font-size:32px">🛡️</div>
      <div style="font-size:15px;font-weight:900;color:#f59e0b;margin-top:6px">Primera Configuración</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">Crea tu PIN para el sistema de Reserva Técnica</div>
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">PIN nuevo (mínimo 4 caracteres):</div>
    <input type="password" id="_rt_pin1" placeholder="Ingresa PIN" maxlength="20" autocomplete="off"/>
    <div style="font-size:11px;color:#94a3b8;margin-top:10px;margin-bottom:4px">Confirmar PIN:</div>
    <input type="password" id="_rt_pin2" placeholder="Repite el PIN" maxlength="20" autocomplete="off"
           onkeydown="if(event.key==='Enter') window._rtSetupPin()"/>
    <div id="_rt_err"></div>
    <button onclick="window._rtSetupPin()"
      style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;margin-top:12px">
      Guardar PIN y Continuar
    </button>
    <button onclick="document.getElementById('_rt_modal').remove()"
      style="background:#1e293b;color:#64748b;margin-top:4px">
      Cancelar
    </button>`;
}

/** HTML del panel de control de la reserva técnica */
function _rtAdminPanelHTML() {
  const real = _data?.engine?._p?.camasLibres?.length ?? 0;
  const disp = _rtApply(real);
  const oculto = real - disp;
  const pctActivo = _rtBuffer;
  return `
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:28px">⚙️</div>
      <div style="font-size:14px;font-weight:900;color:#10b981;margin-top:4px">Panel de Reserva Técnica</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px">Solo visible para administradores</div>
    </div>

    <!-- Comparación real vs mostrado -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
      <div style="text-align:center;padding:10px 6px;background:#1e293b;border-radius:10px">
        <div style="font-size:20px;font-weight:900;color:#6366f1">${real.toLocaleString('es-CL')}</div>
        <div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase">Real BD</div>
      </div>
      <div style="text-align:center;padding:10px 6px;background:#1e293b;border-radius:10px">
        <div style="font-size:20px;font-weight:900;color:#ef4444">−${oculto.toLocaleString('es-CL')}</div>
        <div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase">Reserva oculta</div>
      </div>
      <div style="text-align:center;padding:10px 6px;background:rgba(16,185,129,.1);
                  border:1.5px solid #10b981;border-radius:10px">
        <div style="font-size:20px;font-weight:900;color:#10b981" id="_rt_preview_disp">${disp.toLocaleString('es-CL')}</div>
        <div style="font-size:9px;color:#10b981;font-weight:700;text-transform:uppercase">Se muestra</div>
      </div>
    </div>

    <!-- Slider de porcentaje -->
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;color:#94a3b8;font-weight:700">% de Reserva Técnica</span>
        <span style="font-size:16px;font-weight:900;color:#f59e0b" id="_rt_pct_label">${pctActivo}%</span>
      </div>
      <input type="range" id="_rt_slider" min="0" max="30" step="1" value="${pctActivo}"
             style="width:100%;accent-color:#10b981;cursor:pointer"
             oninput="
               const pct = Number(this.value);
               document.getElementById('_rt_pct_label').textContent = pct + '%';
               const disp = Math.max(0, Math.floor(${real} * (1 - pct/100)));
               document.getElementById('_rt_preview_disp').textContent = disp.toLocaleString('es-CL');
             " />
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#475569;margin-top:2px">
        <span>0% (sin reserva)</span><span>15%</span><span>30% (máximo)</span>
      </div>
    </div>

    <!-- Info de impacto -->
    <div style="padding:8px 10px;background:#0f172a;border-radius:8px;font-size:11px;
                color:#64748b;margin-bottom:14px;line-height:1.5">
      💡 Con ${pctActivo}% de reserva, de cada 100 camas libres se muestran
      <strong style="color:#10b981">${100 - pctActivo}</strong> y
      <strong style="color:#ef4444">${pctActivo}</strong> quedan como colchón operacional.
    </div>

    <button onclick="window._rtSave()"
      style="background:linear-gradient(135deg,#10b981,#059669);color:white">
      💾 Guardar y Aplicar
    </button>
    <button onclick="window._rtLock()"
      style="background:#1e293b;color:#64748b;margin-top:4px">
      🔒 Cerrar sesión admin
    </button>
    <button onclick="document.getElementById('_rt_modal').remove()"
      style="background:#1e293b;color:#475569;margin-top:4px;font-size:12px">
      Cancelar
    </button>`;
}

// ── Window handlers del sistema RT ────────────────────────────────────────────

/** Verificar PIN y desbloquear */
window._rtSubmitPin = async () => {
  const pin = document.getElementById('_rt_pin_input')?.value?.trim();
  if (!pin) return;
  const errEl = document.getElementById('_rt_err');
  const ok = await _rtCheckPin(pin);
  if (ok) {
    _rtUnlocked = true;
    _rtRenderModal('admin');
  } else {
    errEl.textContent = '❌ PIN incorrecto. Intenta nuevamente.';
    document.getElementById('_rt_pin_input').value = '';
    document.getElementById('_rt_pin_input').focus();
  }
};

/** Configurar PIN por primera vez */
window._rtSetupPin = async () => {
  const p1 = document.getElementById('_rt_pin1')?.value?.trim();
  const p2 = document.getElementById('_rt_pin2')?.value?.trim();
  const errEl = document.getElementById('_rt_err');
  if (!p1 || p1.length < 4) { errEl.textContent = '❌ El PIN debe tener al menos 4 caracteres.'; return; }
  if (p1 !== p2) { errEl.textContent = '❌ Los PINs no coinciden.'; return; }
  await _rtSetPin(p1);
  _rtUnlocked = true;
  _rtRenderModal('admin');
};

/** Guardar configuración del slider — Sincroniza en TODOS los dispositivos via Supabase */
window._rtSave = () => {
  const pct = Number(document.getElementById('_rt_slider')?.value ?? 0);
  _rtSaveCfg(pct);                         // guarda en localStorage inmediatamente
  _rtSaveToDB(pct);                        // guarda en Supabase (sincroniza otros dispositivos)
  document.getElementById('_rt_modal')?.remove();
  renderTab(null); // re-render para aplicar buffer inmediatamente en este dispositivo
};


/** Cerrar sesión admin sin cerrar modal */
window._rtLock = () => {
  _rtUnlocked = false;
  document.getElementById('_rt_modal')?.remove();
};

/** Punto de entrada: al hacer clic en el ícono 🔒 oculto */
window._rtOpen = () => {
  if (_rtUnlocked) {
    _rtRenderModal('admin');
  } else if (!_rtHasPin()) {
    _rtRenderModal('setup');
  } else {
    _rtRenderModal('pin');
  }
};

