/**
 * PC Hotelería — Módulo Censo de Camas (HÍBRIDO)
 * VISTA HOTELERA: Portal móvil para seleccionar Día/Noche.
 * VISTA ADMIN: Mega Planilla Excel (Del 21 al 20) que se autocompleta.
 */

import { getAll, put, remove } from '../db.js';
import { showToast, formatDate, toChileanDate } from '../utils.js';
import { supabase } from '../supabaseClient.js';

// ============================================================================
// 1. ESTADO GLOBAL (COMPARTIDO)
// ============================================================================
let session = null;   // { rut }
let floorKey = null;   // "buildingId__floor"
let censusMap = {};     // roomId → 'sin_ocupar' | 'dia' | 'noche' | '2dia' | '2noche'
let allRooms = [];
let allBuildings = [];
let _lockRefreshTimer = null; // timer para refrescar el lock cada 2 min

// Utilidad: retrasar la ejecución hasta que el usuario deje de escribir
function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

const STATES_2BEDS = [
    { val: 'sin_ocupar', label: 'Sin Ocupar' },
    { val: 'dia', label: 'Día' },
    { val: 'noche', label: 'Noche' },
    { val: '2dia', label: '2 Día' },
    { val: '2noche', label: '2 Noche' },
];
const STATES_1BED = [
    { val: 'sin_ocupar', label: 'Sin Ocupar' },
    { val: 'dia', label: 'Ocupada' },
];

// ============================================================================
// 2. ENRUTADOR (ADMIN vs HOTELERA)
// ============================================================================
export async function renderCenso(container) {
    const user = window._currentUser || {};
    const isAdmin = ['admin', 'superadmin'].includes(user.role);

    // Si es admin y no ha forzado la vista móvil, cargamos la MEGA PLANILLA
    if (isAdmin && !window._forceHoteleraView) {
        await renderMegaCenso(container);
        return;
    }

    // --- VISTA HOTELERA (TERRENO) ---
    await checkDailyReset();
    [allBuildings, allRooms] = await Promise.all([
        getAll('buildings').catch(() => []),
        getAll('rooms').catch(() => []),
    ]);

    // ☁️ Si IndexedDB está vacío (dispositivo sin datos locales), cargar desde Supabase
    if (allBuildings.length === 0 || allRooms.length === 0) {
        try {
            const [bRes, rRes] = await Promise.all([
                supabase.from('buildings').select('*'),
                supabase.from('rooms').select('*')
            ]);
            if (bRes.data?.length > 0) allBuildings = bRes.data;
            if (rRes.data?.length > 0) allRooms = rRes.data;
        } catch(e) {
            console.warn('[Censo Portal] Supabase fallback failed:', e);
        }
    }

    // ☁️ También cargar el censo de hoy desde Supabase si IndexedDB está vacío
    await loadTodayCensus();
    restoreSession();

    if (!session) renderLogin(container);
    else renderMain(container);
}

// ============================================================================
// 3. VISTA HOTELERA EN TERRENO (ORIGINAL INTACTA)
// ============================================================================

async function checkDailyReset() {
    const today = todayISO();
    const lastDate = localStorage.getItem('cm_census_date');
    if (lastDate !== today) {
        try {
            const db = await openRawDB();
            await clearStore(db, 'census');
        } catch (_) { }
        localStorage.setItem('cm_census_date', today);
        censusMap = {};
    }
}

async function openRawDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('campmanager_db');
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function clearStore(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).clear();
        req.onsuccess = resolve;
        req.onerror = e => reject(e.target.error);
    });
}

// ============================================================================
// 🔒 SISTEMA DE BLOQUEO DE PISO — Evita censos simultáneos en el mismo piso
// ============================================================================
const LOCK_TTL_MIN = 30; // Minutos hasta que un lock se considera "expirado"

async function acquireFloorLock(key, rut, label) {
    try {
        // Limpiar timer anterior
        if (_lockRefreshTimer) clearInterval(_lockRefreshTimer);

        // Verificar si hay lock vigente de OTRO usuario
        const existing = await checkFloorLock(key);
        if (existing && existing.rut !== rut) {
            return { ok: false, lockedBy: existing.rut, since: existing.locked_at, label: existing.floor_label };
        }

        // Adquirir (o renovar) nuestro lock
        await supabase.from('censo_locks').upsert({
            id: key,
            rut,
            floor_label: label,
            locked_at: new Date().toISOString()
        });

        // Renovar el lock cada 2 minutos para que no expire si el usuario tarda
        _lockRefreshTimer = setInterval(async () => {
            await supabase.from('censo_locks').upsert({
                id: key, rut, floor_label: label,
                locked_at: new Date().toISOString()
            });
        }, 2 * 60 * 1000);

        return { ok: true };
    } catch (err) {
        console.warn('[Lock] Error al adquirir lock:', err);
        return { ok: true }; // Si Supabase falla, dejamos pasar (offline mode)
    }
}

async function releaseFloorLock(key, rut) {
    try {
        if (_lockRefreshTimer) { clearInterval(_lockRefreshTimer); _lockRefreshTimer = null; }
        await supabase.from('censo_locks').delete().eq('id', key).eq('rut', rut);
    } catch (err) {
        console.warn('[Lock] Error al liberar lock:', err);
    }
}

async function checkFloorLock(key) {
    try {
        const { data } = await supabase.from('censo_locks').select('*').eq('id', key).single();
        if (!data) return null;
        // Verificar si el lock expiró (TTL = 30 min)
        const age = (Date.now() - new Date(data.locked_at).getTime()) / 60000;
        if (age > LOCK_TTL_MIN) {
            // Lock expirado — limpiarlo automáticamente
            await supabase.from('censo_locks').delete().eq('id', key);
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

async function loadTodayCensus() {
    const today = todayISO();
    const entries = await getAll('census').catch(() => []);
    censusMap = {};
    entries.filter(e => e.date === today).forEach(e => { censusMap[e.roomId] = e.state; });

    // ☁️ También leer de Supabase si hay poca data local (portal móvil sin sync)
    if (Object.keys(censusMap).length === 0) {
        try {
            const { data } = await supabase.from('census').select('*').eq('date', today);
            if (data?.length > 0) {
                data.forEach(e => { censusMap[e.roomId] = e.state; });
            }
        } catch(e) {
            console.warn('[Censo] Supabase census load failed:', e);
        }
    }
}

function restoreSession() {
    const stored = sessionStorage.getItem('cm_censo_rut');
    if (stored) session = { rut: stored };
}

function startSession(rut) {
    session = { rut };
    sessionStorage.setItem('cm_censo_rut', rut);
}

function logout(container) {
    // Liberar lock al cerrar sesión
    if (floorKey && session?.rut) releaseFloorLock(floorKey, session.rut).catch(() => {});
    session = null;
    floorKey = null;
    sessionStorage.removeItem('cm_censo_rut');
    renderLogin(container);
}

function renderLogin(container) {
    const user = window._currentUser || {};
    const isAdmin = ['admin', 'superadmin'].includes(user.role);

    let extraBtn = '';
    if (isAdmin) {
        extraBtn = `<button class="btn btn-secondary btn-full mt-3" onclick="window._forceHoteleraView=false; window.renderCensoWrapper()">📊 Volver al Mega Censo Admin</button>`;
    }

    container.innerHTML = `
    <div class="censo-login-wrap">
      <div class="censo-login-card">
        <div class="censo-login-logo">🏨</div>
        <h2 class="censo-login-title">Censo de Camas</h2>
        <p class="censo-login-sub">Ingrese su RUT para comenzar</p>

        <div class="form-group">
          <label class="form-label">RUT</label>
          <input class="form-input censo-rut-input" id="censo-rut-input" type="text" maxlength="12" placeholder="(11111111-1)" oninput="window.censoBuildRutInput(this)" onkeydown="if(event.key==='Enter') window.censoLogin()">
          <p class="censo-rut-hint" id="censo-rut-hint"></p>
        </div>

        <button class="btn btn-primary btn-lg btn-full" onclick="window.censoLogin()">Ingresar al Censo ›</button>
        ${extraBtn}
        <p class="censo-login-date">📅 Censo del ${formatDate(new Date())}</p>
      </div>
    </div>`;

    window.censoBuildRutInput = (el) => {
        el.value = formatRutInput(el.value);
        const hint = document.getElementById('censo-rut-hint');
        if (hint) {
            const valid = validateRut(el.value);
            hint.textContent = el.value.length > 3 ? (valid ? '✅ RUT válido' : '❌ RUT inválido') : '';
            hint.className = 'censo-rut-hint ' + (valid ? 'valid' : 'invalid');
        }
    };

    window.censoLogin = () => {
        const rutEl = document.getElementById('censo-rut-input');
        const rut = rutEl?.value?.trim();
        if (!rut) { showToast('Ingrese su RUT', 'warn'); return; }
        if (!validateRut(rut)) { showToast('RUT inválido', 'error'); return; }
        startSession(rut);
        renderMain(container);
    };

    window.renderCensoWrapper = () => renderCenso(container);
}

function renderMain(container) {
    const floorOptions = buildFloorOptions();
    if (!floorKey && floorOptions.length > 0) floorKey = floorOptions[0].key;
    const safeRut = session?.rut || '';
    
    const user = window._currentUser || {};
    const isAdmin = ['admin', 'superadmin'].includes(user.role);

    container.innerHTML = `
    <div class="censo-main">
      <div class="censo-toolbar">
        <div class="censo-toolbar-left">
          <div class="censo-toolbar-date">📅 ${formatDate(new Date())}</div>
          <div class="censo-toolbar-rut">👤 ${safeRut}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.censoLogout()">Cerrar sesión</button>
      </div>

      <div class="section-header" style="padding:0 0 12px; display:flex; justify-content:space-between; flex-wrap:wrap;">
        <div>
          <h2 class="section-title">Censo de <span>Camas</span></h2>
          <p class="section-subtitle">Complete el estado de cada habitación</p>
        </div>
        ${isAdmin ? `<button class="btn btn-secondary btn-sm" onclick="window._forceHoteleraView=false; window.renderCensoWrapper()">📊 Volver al Mega Censo Admin</button>` : ''}
      </div>

      <!-- Botón Cambios de Sábana -->
      <button id="btn-ver-salidas" onclick="window.censoMostrarSalidas()"
              style="width:100%;margin-bottom:14px;padding:12px 16px;
                     background:linear-gradient(135deg,#553c9a,#6b46c1);
                     color:#fff;font-weight:700;font-size:14px;border:none;
                     border-radius:12px;cursor:pointer;display:flex;align-items:center;
                     justify-content:center;gap:8px;box-shadow:0 4px 12px rgba(107,70,193,0.35);
                     transition:transform 0.15s,box-shadow 0.15s"
              onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 18px rgba(107,70,193,0.5)'"
              onmouseout="this.style.transform='';this.style.boxShadow='0 4px 12px rgba(107,70,193,0.35)'">
        🛏️ Cambios de Sábana
      </button>

      <div id="censo-lock-banner" style="display:none;margin-bottom:10px"></div>

      <div class="censo-selector-wrap">
        <label class="form-label">Pabellón / Piso</label>
        <select class="form-select censo-floor-select" id="censo-floor-select" onchange="window.censoCambiarPiso(this.value)">
          ${floorOptions.map(o => `<option value="${o.key}" ${o.key === floorKey ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>

      <div id="censo-rooms-list"></div>

      <div class="censo-submit-bar">
        <button class="btn btn-primary btn-lg btn-full" onclick="window.censoGuardar()">💾 Guardar Censo Diario</button>
        <p class="censo-submit-hint">Los datos se guardarán automáticamente en la Mega Planilla</p>
      </div>
    </div>

    <!-- Modal Cambios de Sábana -->
    <div id="salidas-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;
         backdrop-filter:blur(4px);padding:12px;overflow-y:auto" onclick="if(event.target===this)window.censoCloseSalidas()">
      <div style="background:#fff;border-radius:20px;max-width:520px;margin:0 auto;overflow:hidden;
                  box-shadow:0 24px 64px rgba(0,0,0,0.35)">

        <!-- Header oscuro -->
        <div style="background:linear-gradient(135deg,#1a202c,#2d3748);padding:18px 18px 14px;color:#fff">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div style="font-size:18px;font-weight:800">🛏️ Cambios de Sábana</div>
            <button onclick="window.censoCloseSalidas()"
                    style="background:rgba(255,255,255,0.15);border:none;color:#fff;
                           width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer;
                           display:flex;align-items:center;justify-content:center">✕</button>
          </div>

          <!-- Selector pabón/piso dentro del modal -->
          <div style="margin-bottom:10px">
            <label style="font-size:11px;font-weight:700;opacity:0.7;text-transform:uppercase;
                          letter-spacing:0.5px;display:block;margin-bottom:5px">PABELLÓN / PISO</label>
            <select id="sabana-floor-select"
                    onchange="window.censoFiltrarSabana(this.value)"
                    style="width:100%;padding:9px 12px;border-radius:10px;border:none;
                           background:rgba(255,255,255,0.12);color:#fff;font-size:14px;
                           font-weight:600;outline:none;cursor:pointer">
              <option value="" style="color:#000;background:#fff">— Todos los pabellones —</option>
            </select>
          </div>

          <!-- Leyenda -->
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span style="background:rgba(229,62,62,0.35);border:1px solid #fc8181;color:#fed7d7;
                         padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700">🔴 Vencida</span>
            <span style="background:rgba(214,158,46,0.35);border:1px solid #f6e05e;color:#fefcbf;
                         padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700">🟡 Sale hoy</span>
            <span style="background:rgba(56,161,105,0.35);border:1px solid #68d391;color:#c6f6d5;
                         padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700">🟢 Próxima</span>
          </div>
        </div>

        <!-- Cuerpo con la lista -->
        <div id="salidas-modal-body" style="max-height:60vh;overflow-y:auto"></div>

        <!-- Footer -->
        <div style="padding:12px 16px;border-top:1px solid #e2e8f0;text-align:center">
          <button onclick="window.censoCloseSalidas()"
                  style="background:#e2e8f0;border:none;border-radius:10px;padding:10px 32px;
                         font-weight:700;font-size:14px;cursor:pointer">Cerrar</button>
        </div>
      </div>
    </div>`;

    window.censoLogout = () => logout(container);
    window.censoCambiarPiso = async (key) => {
        if (!key) return;

        // Liberar lock del piso anterior
        if (floorKey && floorKey !== key && session?.rut) {
            await releaseFloorLock(floorKey, session.rut);
        }

        floorKey = key;

        // Buscar nombre del piso para mostrarlo en el lock
        const opts = buildFloorOptions();
        const opt  = opts.find(o => o.key === key);
        const label = opt?.label || key;

        // Mostrar spinner de verificación
        const lockBanner = document.getElementById('censo-lock-banner');
        if (lockBanner) {
            lockBanner.innerHTML = `<div style="background:#ebf8ff;border:1px solid #bee3f8;border-radius:10px;padding:10px 16px;font-size:13px;color:#2b6cb0;font-weight:600">🔍 Verificando disponibilidad del piso...</div>`;
            lockBanner.style.display = 'block';
        }

        // Intentar adquirir lock
        const result = await acquireFloorLock(key, session?.rut || 'desconocido', label);

        if (lockBanner) {
            if (!result.ok) {
                // Piso ocupado por otro usuario
                const since = new Date(result.since).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
                lockBanner.innerHTML = `
                <div style="background:#fff5f5;border:2px solid #fc8181;border-radius:10px;padding:12px 16px;">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
                    <span style="font-size:20px">⚠️</span>
                    <div>
                      <div style="font-size:14px;font-weight:800;color:#c53030">Piso en uso — ${label}</div>
                      <div style="font-size:12px;color:#742a2a">RUT <strong>${result.lockedBy}</strong> está censando este piso desde las ${since}</div>
                    </div>
                  </div>
                  <div style="font-size:11px;color:#c53030;margin-top:4px">⚠️ Si guardas, podrías sobreescribir su trabajo. Coordina con tu compañero antes de continuar.</div>
                </div>`;
            } else {
                // Piso libre — ocultar banner
                lockBanner.innerHTML = `<div style="background:#f0fff4;border:1px solid #68d391;border-radius:10px;padding:8px 16px;font-size:13px;color:#276749;font-weight:600">✅ Piso disponible — ${label}</div>`;
                setTimeout(() => { lockBanner.style.display = 'none'; }, 2000);
            }
        }

        renderRoomList();
    };
    window.censoGuardar = () => guardarCenso(container);
    window.renderCensoWrapper = () => renderCenso(container);

    // ── Cambios de Sábana: cerrar modal ────────────────────────────────
    window.censoCloseSalidas = () => {
        const overlay = document.getElementById('salidas-modal-overlay');
        if (overlay) overlay.style.display = 'none';
    };

    // ── Cambios de Sábana: poblar lista por filtro de piso ───────────────
    window.censoFiltrarSabana = (filterKey) => {
        const body = document.getElementById('salidas-modal-body');
        if (!body) return;
        const todayStr = new Date().toLocaleDateString('en-CA');
        const bMapFull = Object.fromEntries(allBuildings.map(b => [String(b.id), b.name || b.code || `Ed.${b.id}`]));

        // Filtrar habitaciones según pabillón/piso seleccionado
        let rooms;
        if (filterKey) {
            const [bId, floor] = filterKey.split('__');
            rooms = allRooms.filter(r => String(r.buildingId) === String(bId) && String(r.floor) === String(floor));
        } else {
            rooms = allRooms;
        }

        // Recopilar camas con fecha de salida (sin duplicar por habitación)
        // Agrupamos por hab+empresa+fecha para consolidar camas del mismo cuarto
        const habMap = {};
        rooms.forEach(r => {
            ['day', 'night', 'extra'].forEach(k => {
                const bed = r.beds?.[k];
                if (bed?.occupant && bed?.departureDate) {
                    const key = `${r.number}__${(bed.company||'').toLowerCase().trim()}__${bed.departureDate}`;
                    if (!habMap[key]) {
                        habMap[key] = {
                            hab: `Hab. ${r.number}`,
                            pabellon: bMapFull[String(r.buildingId)] || `Ed.${r.buildingId}`,
                            empresa: (bed.company || '—').trim().replace(/\b\w/g, c => c.toUpperCase()),
                            salida: bed.departureDate,
                            count: 0,
                        };
                    }
                    habMap[key].count++;
                }
            });
        });

        const filas = Object.values(habMap).sort((a, b) => a.salida.localeCompare(b.salida));

        if (filas.length === 0) {
            body.innerHTML = `
            <div style="padding:40px 20px;text-align:center;color:#718096">
              <div style="font-size:38px;margin-bottom:10px">🟢</div>
              <div style="font-weight:700;font-size:15px">Sin cambios registrados</div>
              <div style="font-size:12px;margin-top:5px">No hay camas con fecha de salida en este piso</div>
            </div>`;
            return;
        }

        // Agrupar filas por fecha
        const byDate = {};
        filas.forEach(f => {
            if (!byDate[f.salida]) byDate[f.salida] = [];
            byDate[f.salida].push(f);
        });

        let html = '';
        Object.entries(byDate).forEach(([dateStr, group]) => {
            const [y, m, d] = dateStr.split('-');
            const isToday   = dateStr === todayStr;
            const isOverdue = dateStr < todayStr;

            const headerBg    = isOverdue ? '#fff5f5' : isToday ? '#fffff0' : '#f0fff4';
            const headerColor = isOverdue ? '#c53030' : isToday ? '#744210' : '#276749';
            const badge       = isOverdue ? '🔴 VENCIDA' : isToday ? '🟡 HOY' : '🟢';
            const badgeBg     = isOverdue ? '#fed7d7' : isToday ? '#fefcbf' : '#c6f6d5';
            const badgeColor  = isOverdue ? '#c53030' : isToday ? '#744210' : '#276749';

            html += `
            <div>
              <!-- Encabezado de fecha -->
              <div style="background:${headerBg};padding:9px 14px;display:flex;align-items:center;
                          justify-content:space-between;position:sticky;top:0;z-index:2;border-bottom:1px solid #e2e8f0">
                <div style="font-size:14px;font-weight:800;color:${headerColor}">📅 ${d}/${m}/${y}</div>
                <div style="display:flex;align-items:center;gap:7px">
                  <span style="background:${badgeBg};color:${badgeColor};padding:2px 9px;border-radius:99px;
                               font-size:11px;font-weight:800">${badge}</span>
                  <span style="font-size:11px;color:#718096;font-weight:600">${group.length} hab.</span>
                </div>
              </div>
              <!-- Filas: tabla compacta -->
              <table style="width:100%;border-collapse:collapse">
                <thead>
                  <tr style="background:#f8fafc">
                    <th style="padding:7px 14px;font-size:10px;font-weight:800;color:#718096;
                               text-transform:uppercase;text-align:left;letter-spacing:0.4px;width:90px">Hab.</th>
                    <th style="padding:7px 10px;font-size:10px;font-weight:800;color:#718096;
                               text-transform:uppercase;text-align:left;letter-spacing:0.4px">Empresa</th>
                    <th style="padding:7px 14px;font-size:10px;font-weight:800;color:#718096;
                               text-transform:uppercase;text-align:right;letter-spacing:0.4px;width:56px">Salida</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.map((f, i) => `
                  <tr style="background:${i%2===0?(isOverdue?'#fff5f5':isToday?'#fffff0':'#fff'):(isOverdue?'#ffe5e5':isToday?'#fefde0':'#f9fafb')};border-bottom:1px solid #edf2f7">
                    <td style="padding:10px 14px;font-size:14px;font-weight:800;color:#2d3748">${f.hab}</td>
                    <td style="padding:10px;font-size:13px;color:#4a5568;font-weight:600">${f.empresa}</td>
                    <td style="padding:10px 14px;text-align:right">
                      <span style="font-size:12px;font-weight:800;color:${headerColor};
                                   background:${badgeBg};padding:3px 8px;border-radius:7px">${d}/${m}</span>
                    </td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>`;
        });
        body.innerHTML = html;
    };

    // ── Cambios de Sábana: abrir modal y poblar selector ────────────────
    window.censoMostrarSalidas = () => {
        const overlay = document.getElementById('salidas-modal-overlay');
        const sel     = document.getElementById('sabana-floor-select');
        if (!overlay || !sel) return;

        // Poblar opciones del selector dentro del modal
        const opts = buildFloorOptions();
        sel.innerHTML = `<option value="" style="color:#000;background:#fff">— Todos los pabellones —</option>` +
            opts.map(o => `<option value="${o.key}" style="color:#000;background:#fff">${o.label}</option>`).join('');

        // Si ya hay piso seleccionado en el censo, preseleccionarlo
        if (floorKey) sel.value = floorKey;

        overlay.style.display = 'block';
        overlay.scrollTop = 0;

        // Cargar lista con el filtro actual
        window.censoFiltrarSabana(sel.value);
    };

    renderRoomList();
}


function renderRoomList() {
    const list = document.getElementById('censo-rooms-list');
    if (!list) return;

    if (!floorKey) {
        list.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-muted)">Sin pabellón seleccionado</div>`;
        return;
    }

    const [bId, floor] = floorKey.split('__');
    const rooms = allRooms.filter(r => String(r.buildingId) === String(bId) && String(r.floor) === String(floor))
                          .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

    if (rooms.length === 0) {
        list.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">No hay habitaciones en este piso</div>`;
        return;
    }

    list.innerHTML = rooms.map(r => renderRoomCard(r)).join('');

    rooms.forEach(r => {
        const options = r.bedCount === 1 ? STATES_1BED : STATES_2BEDS;
        options.forEach(opt => {
            const el = document.getElementById(`r_${r.id}_${opt.val}`);
            if (el) {
                el.addEventListener('change', () => {
                    censusMap[r.id] = opt.val;
                    document.querySelectorAll(`.censo-room[data-rid="${r.id}"] .censo-radio-label`).forEach(lbl => lbl.classList.remove('selected'));
                    if (el.checked) {
                        const lbl = document.querySelector(`label[for="r_${r.id}_${opt.val}"]`);
                        if (lbl) lbl.classList.add('selected');
                    }
                });
            }
        });
    });
}

function renderRoomCard(r) {
    const currentState = censusMap[r.id] || 'sin_ocupar';
    const blocked = r.status === 'blocked' || r.status === 'bed-blocked';
    const options = r.bedCount === 1 ? STATES_1BED : STATES_2BEDS;

    if (blocked) {
        return `
        <div class="censo-room blocked" data-rid="${r.id}">
          <div class="censo-room-header">
            <span>🔒 Habitación ${r.number}</span>
            <span class="censo-room-badge">Bloqueada</span>
          </div>
          <div class="censo-room-body">
            <p style="color:var(--text-muted);font-size:13px;margin:0">${r.blockReason || 'Habitación fuera de servicio'}</p>
          </div>
        </div>`;
    }

    const radios = options.map(opt => `
        <label class="censo-radio-label ${currentState === opt.val ? 'selected' : ''}" for="r_${r.id}_${opt.val}">
          <input class="censo-radio-input" type="radio" id="r_${r.id}_${opt.val}" name="r_${r.id}" value="${opt.val}" ${currentState === opt.val ? 'checked' : ''}>
          <span class="censo-radio-dot"></span>
          <span class="censo-radio-text">${opt.label}</span>
        </label>`).join('');

    return `
    <div class="censo-room" data-rid="${r.id}">
      <div class="censo-room-header">
        <span>Habitación ${r.number}</span>
        ${r.bedCount === 1 ? '<span class="censo-room-badge single">1 cama</span>' : ''}
      </div>
      <div class="censo-room-body"><div class="censo-radio-group">${radios}</div></div>
    </div>`;
}

async function guardarCenso(container) {
    const today = todayISO();
    const rut = session?.rut || 'desconocido';
    const ts = new Date().toISOString();

    const [bId, floor] = (floorKey || '__').split('__');
    const rooms = allRooms.filter(r => String(r.buildingId) === String(bId) && String(r.floor) === String(floor));

    let saved = 0;
    const supabaseRecords = [];

    for (const r of rooms) {
        const state = censusMap[r.id] || 'sin_ocupar';
        // Guardar en IndexedDB local
        await put('census', { roomId: r.id, date: today, state, rut, timestamp: ts }).catch(() => {});
        // Preparar para Supabase (id compuesto para upsert)
        supabaseRecords.push({ id: `${r.id}_${today}`, roomId: r.id, date: today, state, rut, timestamp: ts });
        saved++;
    }

    // ☁️ Guardar en Supabase para que sea visible en todos los dispositivos
    if (supabaseRecords.length > 0) {
        try {
            await supabase.from('census').upsert(supabaseRecords, { onConflict: 'id' });
        } catch(e) {
            console.warn('[Censo] Error al sincronizar con Supabase:', e);
            showToast('⚠️ Guardado local (sin conexión a la nube)', 'warn');
        }
    }

    // 🔓 Liberar el lock del piso al guardar
    if (floorKey && rut) await releaseFloorLock(floorKey, rut);

    // 🔔 Disparar evento para que MegaCenso actualice en tiempo real (sin refresh)
    window.dispatchEvent(new CustomEvent('census-updated', { detail: { date: today, floor: floorKey } }));

    showToast(`✅ Censo guardado en la nube — ${saved} habitaciones registradas`, 'success');
}

function buildFloorOptions() {
    const buildMap = Object.fromEntries(allBuildings.map(b => [b.id, b]));
    const seen = new Set();
    const options = [];

    const sorted = [...allRooms].sort((a, b) => {
        const bA = buildMap[a.buildingId]?.name || '';
        const bB = buildMap[b.buildingId]?.name || '';
        if (bA !== bB) return bA.localeCompare(bB);
        return a.floor - b.floor;
    });

    for (const r of sorted) {
        const key = `${r.buildingId}__${r.floor}`;
        if (!seen.has(key)) {
            seen.add(key);
            const b = buildMap[r.buildingId];
            options.push({ key, label: `${b?.name || `Edificio ${r.buildingId}`} — Piso ${r.floor}` });
        }
    }
    return options;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function formatRutInput(val) {
    let cleaned = val.replace(/[^0-9kK]/g, '').toUpperCase();
    if (cleaned.length > 9) cleaned = cleaned.slice(0, 9);
    if (cleaned.length <= 1) return cleaned;
    const dv = cleaned.slice(-1);
    const body = cleaned.slice(0, -1);
    let formatted = '';
    for (let i = body.length - 1, j = 0; i >= 0; i--, j++) {
        if (j > 0 && j % 3 === 0) formatted = '.' + formatted;
        formatted = body[i] + formatted;
    }
    return formatted + '-' + dv;
}
function validateRut(rut) {
    if (!rut) return false;
    const cleaned = rut.replace(/[.\-]/g, '').toUpperCase();
    if (cleaned.length < 2) return false;
    const body = cleaned.slice(0, -1);
    const dv = cleaned.slice(-1);
    let sum = 0; let mul = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += parseInt(body[i]) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const rem = 11 - (sum % 11);
    const calc = rem === 11 ? '0' : rem === 10 ? 'K' : String(rem);
    return calc === dv;
}

// ============================================================================
// 4. VISTA ADMIN: MEGA PLANILLA EXCEL (Corte 21 al 20)
// ============================================================================

let censusRecords = []; 
let currentMonthObj = null; 
let gridDays = []; 
let allCensusData = []; // Guardará el censo de las hoteleras

function generateCensusDateRange(baseDateStr) {
    const [year, month] = baseDateStr.split('-').map(Number);
    let startYear = year; let startMonth = month - 1;
    if (startMonth === 0) { startMonth = 12; startYear--; }
    
    const startDate = new Date(startYear, startMonth - 1, 21);
    const endDate = new Date(year, month - 1, 20);
    
    const days = []; let curr = new Date(startDate);
    while (curr <= endDate) {
        days.push(curr.toISOString().split('T')[0]);
        curr.setDate(curr.getDate() + 1);
    }
    return days;
}

function getCurrentCensusMonth() {
    const today = new Date();
    let y = today.getFullYear(); let m = today.getMonth() + 1; let d = today.getDate();
    if (d > 20) { m++; if (m > 12) { m = 1; y++; } }
    return `${y}-${String(m).padStart(2, '0')}`;
}

const numToMonth = { "01": "Enero", "02": "Febrero", "03": "Marzo", "04": "Abril", "05": "Mayo", "06": "Junio", "07": "Julio", "08": "Agosto", "09": "Septiembre", "10": "Octubre", "11": "Noviembre", "12": "Diciembre" };
function formatMonthLabel(isoMonth) { const [y, m] = isoMonth.split('-'); return `${numToMonth[m]} ${y} (21 al 20)`; }

async function renderMegaCenso(container) {
    if (!currentMonthObj) currentMonthObj = getCurrentCensusMonth();
    gridDays = generateCensusDateRange(currentMonthObj);

    showToast('Cargando Mega Planilla...', 'info');

    [allBuildings, allRooms, censusRecords, allCensusData] = await Promise.all([
        getAll('buildings').catch(() => []),
        getAll('rooms').catch(() => []),
        getAll('census_records').catch(() => []),
        getAll('census').catch(() => []) // Trae lo que las hoteleras marcan en su celular
    ]);

    // ☁️ SIEMPRE cargar censo desde Supabase para el periodo actual
    // (el admin puede estar en un dispositivo sin datos locales del censo hotelero)
    try {
        const dateFrom = gridDays[0] || new Date().toLocaleDateString('en-CA');
        const dateTo   = gridDays[gridDays.length - 1] || dateFrom;
        const { data: sbCensus } = await supabase
            .from('census')
            .select('*')
            .gte('date', dateFrom)
            .lte('date', dateTo);
        if (sbCensus?.length > 0) {
            // Merge: datos de Supabase tienen prioridad sobre IDB local
            const sbMap = new Map(sbCensus.map(r => `${r.roomId}_${r.date}`));
            const merged = [
                ...allCensusData.filter(r => !sbMap.has(`${r.roomId}_${r.date}`)),
                ...sbCensus
            ];
            allCensusData = merged;
            console.log(`[MegaCenso] ☁️ ${sbCensus.length} registros de censo cargados desde Supabase`);
        }
    } catch(e) {
        console.warn('[MegaCenso] No se pudo cargar censo de Supabase:', e);
    }

    container.innerHTML = `
    <div class="section-header" style="flex-wrap: wrap;">
      <div>
        <h2 class="section-title">Mega Censo de <span>Camas</span></h2>
        <p class="section-subtitle">Facturación y control (Se autocompleta con el Censo en Terreno)</p>
      </div>
      <div style="display:flex; gap:10px; align-items: center; flex-wrap: wrap;">
        <div style="display:flex; align-items:center; background: white; padding: 4px 12px; border-radius: 8px; border: 1px solid var(--border);">
            <label style="font-weight:700; font-size:12px; margin-right: 8px; color:var(--text-secondary);">PERIODO:</label>
            <input type="month" id="censo-month-picker" class="form-input" style="height:32px; padding:0 8px; border:none;" value="${currentMonthObj}" onchange="window.changeCensusMonth(this.value)">
        </div>
        <button class="btn btn-secondary" onclick="window.downloadCensusExcel()">📥 Exportar a Excel</button>
        <button class="btn btn-primary" onclick="window.saveCensusGrid()">💾 Guardar Manuales</button>
        <button class="btn btn-ghost" onclick="window._forceHoteleraView=true; window.renderCensoWrapper()">📱 Vista Terreno</button>
      </div>
    </div>

    <div style="background: white; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.03);">
        <div style="padding: 12px 16px; border-bottom: 1px solid var(--border); background: #fafafa; display:flex; gap:10px;">
            <input type="text" id="censo-search" class="form-input" placeholder="🔍 Buscar nombre, RUT, empresa..." style="max-width: 300px; height:36px;" onkeyup="window.filterCensusGrid()">
            <select class="form-select" id="censo-building-filter" style="max-width: 200px; height:36px;" onchange="window.filterCensusGrid()">
                <option value="all">Todos los Pabellones</option>
                ${allBuildings.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
            </select>
            <select class="form-select" id="censo-company-filter" style="max-width: 200px; height:36px;" onchange="window.filterCensusGrid()">
                <option value="all">Todas las Empresas</option>
            </select>
            <button class="btn btn-primary btn-sm" style="margin-left: auto; background: var(--red-600); border:none;" onclick="window.startNewMonth()">🔄 Cerrar Mes e Iniciar Nuevo</button>
        </div>

        <div style="overflow-x: auto; max-height: 65vh; overflow-y: auto;" id="excel-scroll-container">
            <table class="worker-table censo-excel-table" id="censo-excel-table" style="min-width: max-content; white-space: nowrap; border-collapse: separate; border-spacing: 0;">
                <thead style="position: sticky; top: 0; z-index: 10; background: var(--bg-page); box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <tr id="censo-thead-row"></tr>
                </thead>
                <tbody id="censo-tbody"></tbody>
            </table>
        </div>
    </div>

    <style>
        .censo-excel-table th, .censo-excel-table td { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 6px 10px; font-size: 11px; text-align: center; vertical-align: middle; }
        .censo-excel-table th { font-weight: 800; background: #f7fafc; color: var(--text-primary); text-transform: uppercase;}
        .sticky-col { position: sticky; left: 0; background: white; z-index: 5; box-shadow: 2px 0 5px rgba(0,0,0,0.05); }
        .sticky-col-2 { position: sticky; left: 80px; background: white; z-index: 5; }
        .sticky-col-3 { position: sticky; left: 160px; background: white; z-index: 5; }
        .sticky-col-4 { position: sticky; left: 240px; background: white; z-index: 5; box-shadow: 2px 0 5px rgba(0,0,0,0.05); }
        th.sticky-col, th.sticky-col-2, th.sticky-col-3, th.sticky-col-4 { background: #edf2f7; z-index: 11; }
        .x-input { width: 24px; height: 24px; text-align: center; font-weight: 800; font-size: 14px; border: 1px solid transparent; border-radius: 4px; text-transform: uppercase; cursor: pointer; transition: all 0.2s; background: transparent; color: #2b6cb0; outline: none; }
        .x-input:hover { border-color: #bee3f8; background: #ebf8ff; }
        .x-input:focus { border-color: #3182ce; background: #ebf8ff; box-shadow: 0 0 0 2px rgba(49,130,206,0.2); }
        .x-input.has-x { background: #e6fffa; border-color: #38a169; color: #276749; }
        .weekend-col { background-color: #fff5f5 !important; }
    </style>`;

    window.changeCensusMonth = async (val) => { if (val) { currentMonthObj = val; await renderCenso(container); } };
    window.filterCensusGrid = debounce(filterExcelGrid, 250); // ⚡ Debounce para no re-renderizar en cada keystroke
    window.renderCensoWrapper = () => renderCenso(container);

    renderExcelGrid();

    // ── 🔴 TIEMPO REAL: Auto-actualización desde el portal de terreno ──
    _setupCensusRealtime(container);

    // ── ⚡ INMEDIATO: Cuando el mismo dispositivo guarda el censo hotelero ──
    // el evento 'census-updated' llega antes que el round-trip de Supabase Realtime
    if (window._megaCensoAbort) window._megaCensoAbort.abort();
    window._megaCensoAbort = new AbortController();
    window.addEventListener('census-updated', async () => {
        if (!document.getElementById('censo-excel-table')) return;
        allCensusData = await getAll('census').catch(() => []);
        renderExcelGrid();
        _showRealtimeBadge('✅ Planilla actualizada al instante');
    }, { signal: window._megaCensoAbort.signal });
}

// Referencia al canal Realtime para evitar suscripciones duplicadas
let _censusRealtimeChannel = null;

function _setupCensusRealtime(container) {
    // Limpiar canal anterior si existe (evita duplicados al cambiar de mes)
    if (_censusRealtimeChannel) {
        supabase.removeChannel(_censusRealtimeChannel);
        _censusRealtimeChannel = null;
    }

    _censusRealtimeChannel = supabase
        .channel('census_live_' + Math.random().toString(36).slice(2, 7))
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'census'
        }, async (payload) => {
            // Mostrar indicador flotante de actualización
            _showRealtimeBadge('🔄 Censo actualizado desde otro dispositivo...');

            // Esperar 800ms para que otros cambios del mismo save lleguen también
            clearTimeout(_censusRealtimeDebounce);
            _censusRealtimeDebounce = setTimeout(async () => {
                // Recargar datos de censo desde Supabase e IndexedDB
                allCensusData = await getAll('census').catch(() => []);
                try {
                    const today = new Date().toLocaleDateString('en-CA');
                    const { data } = await supabase
                        .from('census')
                        .select('*')
                        .gte('date', gridDays[0] || today)
                        .lte('date', gridDays[gridDays.length - 1] || today);
                    if (data?.length > 0) {
                        // Actualizar IndexedDB local con los datos frescos
                        for (const rec of data) {
                            await put('census', rec).catch(() => {});
                        }
                        allCensusData = data;
                    }
                } catch(e) {
                    console.warn('[CensoRT] Error al refrescar:', e);
                }

                // Re-renderizar el grid si la vista sigue activa
                if (document.getElementById('censo-excel-table')) {
                    renderExcelGrid();
                    _showRealtimeBadge('✅ Planilla actualizada');
                } else {
                    // Vista cambió — limpiar suscripción
                    if (_censusRealtimeChannel) {
                        supabase.removeChannel(_censusRealtimeChannel);
                        _censusRealtimeChannel = null;
                    }
                }
            }, 800);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[CensoRT] ✅ Tiempo real activado — actualizaciones automáticas');
                _showRealtimeBadge('📡 Tiempo real activo');
            }
        });
}

let _censusRealtimeDebounce = null;

function _showRealtimeBadge(msg) {
    let badge = document.getElementById('censo-rt-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'censo-rt-badge';
        badge.style.cssText = `
            position:fixed;bottom:80px;right:16px;z-index:9999;
            background:#1a202c;color:#fff;border-radius:10px;
            padding:8px 14px;font-size:12px;font-weight:700;
            box-shadow:0 4px 16px rgba(0,0,0,0.3);
            display:flex;align-items:center;gap:6px;
            transition:opacity 0.3s;
        `;
        document.body.appendChild(badge);
    }
    badge.textContent = msg;
    badge.style.opacity = '1';
    clearTimeout(badge._timeout);
    badge._timeout = setTimeout(() => { badge.style.opacity = '0'; }, 3000);
}

function buildRowsFromInfrastructure() {
    const rows = []; const buildMap = {}; const uniqueCompanies = new Set();
    allBuildings.forEach(b => buildMap[b.id] = b.name);

    // Normalizar empresa a Title Case para evitar duplicados por mayúsculas
    const normalizeCompany = (name) => {
        if (!name) return 'SIN EMPRESA';
        return name.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    };

    // 🔥 FIX: Ordenar habitaciones por nombre de pabellón y luego por número
    const sortedRooms = [...allRooms].sort((a, b) => {
        const bNameA = buildMap[a.buildingId] || '';
        const bNameB = buildMap[b.buildingId] || '';
        if (bNameA !== bNameB) return bNameA.localeCompare(bNameB, 'es', { numeric: true });
        return parseInt(a.number) - parseInt(b.number);
    });

    sortedRooms.forEach(r => {
        const bName = buildMap[r.buildingId] || 'Desconocido';
        const baseRow = { roomId: r.id, building: bName, buildingId: r.buildingId, floor: r.floor, roomNum: r.number, totalBeds: r.bedCount || 2 };
        const beds = ['day', 'night', 'extra']; const bedNames = ['Cama A', 'Cama B', 'Cama C'];

        beds.forEach((bedKey, idx) => {
            if (idx >= baseRow.totalBeds) return; 
            const bedData = r.beds?.[bedKey];
            const rowId = `${r.id}_${bedKey}`; 
            let row = { ...baseRow, rowId, bedKey, bedName: bedNames[idx], isOccupied: false };

            if (bedData && bedData.occupant) {
                row.isOccupied = true; row.rut = bedData.rut || 'S/N'; row.name = bedData.occupant; row.company = normalizeCompany(bedData.company); row.shift = bedData.shift || '-'; row.arrival = bedData.arrivalDate ? bedData.arrivalDate.split('T')[0] : '-'; row.departure = bedData.departureDate ? bedData.departureDate.split('T')[0] : '-';
                uniqueCompanies.add(row.company);
            } else {
                row.rut = '-'; row.name = 'VACÍO'; row.company = '-'; row.shift = '-'; row.arrival = '-'; row.departure = '-';
            }
            rows.push(row);
        });
    });

    const compSelect = document.getElementById('censo-company-filter');
    if (compSelect && compSelect.options.length <= 1) {
        Array.from(uniqueCompanies).sort().forEach(c => { compSelect.innerHTML += `<option value="${c}">${c}</option>`; });
    }
    return rows;
}

function renderExcelGrid() {
    const thead = document.getElementById('censo-thead-row'); if (!thead) return;

    let thHtml = `
        <th class="sticky-col" style="min-width: 150px; left: 0;">Edificio/Pabellón</th>
        <th class="sticky-col-2" style="min-width: 80px; left: 150px;">N° Hab</th>
        <th class="sticky-col-3" style="min-width: 80px; left: 230px;">Cama</th>
        <th class="sticky-col-4" style="min-width: 200px; left: 310px;">Nombre Ocupante</th>
        <th style="min-width: 100px;">RUT</th>
        <th style="min-width: 150px;">Empresa</th>
        <th style="min-width: 80px;">Turno</th>
        <th style="min-width: 100px;">Ingreso</th>
        <th style="min-width: 100px;">Salida</th>
    `;

    gridDays.forEach(dateStr => {
        const d = new Date(dateStr + 'T12:00:00'); 
        const dayName = d.toLocaleDateString('es-CL', { weekday: 'short' });
        const dayNum = d.getDate();
        const isWeekend = d.getDay() === 0 || d.getDay() === 6; 
        thHtml += `<th class="${isWeekend ? 'weekend-col' : ''}" title="${dateStr}" style="min-width: 40px;">${dayName}<br>${dayNum}</th>`;
    });

    thHtml += `<th style="min-width: 60px; background: #ebf8ff; color: #2b6cb0;">Total X</th>`;
    thead.innerHTML = thHtml;

    window._censusRows = buildRowsFromInfrastructure();
    filterExcelGrid();
}

function filterExcelGrid() {
    const tbody = document.getElementById('censo-tbody'); if (!tbody) return;

    const search = (document.getElementById('censo-search')?.value || '').toLowerCase();
    const bId   = document.getElementById('censo-building-filter')?.value || 'all';
    const comp  = document.getElementById('censo-company-filter')?.value  || 'all';

    // ⚡ MODO RESUMEN: si no se filtra por un edificio específico, mostrar
    // solo un resumen rápido (sin inputs) para no congelar el browser.
    if (bId === 'all' && !search) {
        const buildingMap = {};
        allBuildings.forEach(b => buildingMap[b.id] = b.name);

        // Agrupar filas por edificio
        const resumen = {};
        (window._censusRows || []).forEach(row => {
            const bName = row.building || 'Sin edificio';
            if (!resumen[bName]) resumen[bName] = { total: 0, ocupadas: 0, vacias: 0 };
            resumen[bName].total++;
            if (row.isOccupied) resumen[bName].ocupadas++;
            else resumen[bName].vacias++;
        });

        tbody.innerHTML = `
        <tr>
            <td colspan="99" style="padding:0;border:none;">
                <div style="padding:16px;background:#f0f9ff;border-radius:8px;margin:8px;text-align:center;color:#1e40af;font-weight:700;font-size:13px">
                    📊 Vista Resumen — Selecciona un <strong>Pabellón</strong> para editar la planilla
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:12px">
                    <thead>
                        <tr style="background:#f7fafc">
                            <th style="padding:10px 16px;text-align:left;border-bottom:2px solid #e2e8f0;font-weight:800">Edificio / Pabellón</th>
                            <th style="padding:10px 16px;text-align:center;border-bottom:2px solid #e2e8f0;font-weight:800">Total Camas</th>
                            <th style="padding:10px 16px;text-align:center;border-bottom:2px solid #e2e8f0;color:#16a34a;font-weight:800">Ocupadas</th>
                            <th style="padding:10px 16px;text-align:center;border-bottom:2px solid #e2e8f0;color:#dc2626;font-weight:800">Disponibles</th>
                            <th style="padding:10px 16px;text-align:center;border-bottom:2px solid #e2e8f0;font-weight:800">Ocupación</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(resumen).sort((a,b)=>a[0].localeCompare(b[0])).map(([name, d]) => {
                            const pct = d.total ? Math.round((d.ocupadas / d.total) * 100) : 0;
                            const barColor = pct >= 90 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#16a34a';
                            return `<tr style="border-bottom:1px solid #f1f5f9">
                                <td style="padding:10px 16px;font-weight:700">${name}</td>
                                <td style="padding:10px 16px;text-align:center">${d.total}</td>
                                <td style="padding:10px 16px;text-align:center;color:#16a34a;font-weight:700">${d.ocupadas}</td>
                                <td style="padding:10px 16px;text-align:center;color:#dc2626;font-weight:700">${d.vacias}</td>
                                <td style="padding:10px 16px;text-align:center">
                                    <div style="display:flex;align-items:center;gap:8px">
                                        <div style="flex:1;background:#e2e8f0;border-radius:99px;height:8px;overflow:hidden">
                                            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width 0.6s ease"></div>
                                        </div>
                                        <span style="font-weight:800;color:${barColor};min-width:36px">${pct}%</span>
                                    </div>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </td>
        </tr>`;
        return;
    }

    // ⚡ MODO GRILLA DETALLADA: solo para UN edificio o búsqueda específica
    let html = '';
    let rowCount = 0;
    const MAX_ROWS = 150; // seguridad para evitar freeze

    for (const row of (window._censusRows || [])) {
        if (bId !== 'all' && String(row.buildingId) !== String(bId)) continue;
        if (comp !== 'all' && row.company.toLowerCase() !== comp.toLowerCase()) continue;
        if (search && !`${row.building} ${row.roomNum} ${row.name} ${row.rut} ${row.company}`.toLowerCase().includes(search)) continue;
        if (rowCount >= MAX_ROWS) {
            html += `<tr><td colspan="99" style="text-align:center;padding:14px;background:#fffbeb;color:#92400e;font-weight:700">
                ⚠️ Mostrando solo ${MAX_ROWS} filas — filtra por empresa o afina la búsqueda para ver más
            </td></tr>`;
            break;
        }

        const manualRecord = censusRecords.find(x => x.rowId === row.rowId && x.month === currentMonthObj) || { marks: {} };

        html += `<tr class="census-tr" data-rowid="${row.rowId}">
            <td class="sticky-col" style="left: 0;">${row.building}</td>
            <td class="sticky-col-2" style="left: 150px; font-weight:800;">${row.roomNum}</td>
            <td class="sticky-col-3" style="left: 230px;">${row.bedName}</td>
            <td class="sticky-col-4" style="left: 310px; font-weight: ${row.isOccupied ? '700' : '400'}; color: ${row.isOccupied ? 'var(--text-primary)' : 'var(--text-muted)'};">${row.name}</td>
            <td>${row.rut}</td><td>${row.company}</td><td><span class="badge" style="font-size:10px">${row.shift}</span></td>
            <td>${toChileanDate(row.arrival)}</td><td>${toChileanDate(row.departure)}</td>
        `;

        let totalX = 0;
        gridDays.forEach(dateStr => {
            const isWeekend = new Date(dateStr + 'T12:00:00').getDay() === 0 || new Date(dateStr + 'T12:00:00').getDay() === 6;

            // 🔍 Buscar dato hotelero — comparar como String para evitar mismatch number/string
            const hoteleraData = allCensusData.find(c =>
                String(c.roomId) === String(row.roomId) && c.date === dateStr
            );
            let autoX = false;
            if (hoteleraData) {
                const s = hoteleraData.state;
                if (s === 'dia'   && row.bedKey === 'day')   autoX = true;
                if (s === 'noche' && row.bedKey === 'night') autoX = true;
                if ((s === '2dia' || s === '2noche') && (row.bedKey === 'day' || row.bedKey === 'night')) autoX = true;
                if (s === 'dia'   && row.totalBeds === 1) autoX = true;
            }

            let val = '';
            if (manualRecord.marks[dateStr] !== undefined) val = manualRecord.marks[dateStr];
            else if (autoX) val = 'X';

            if (val.toUpperCase() === 'X') totalX++;

            html += `<td class="${isWeekend ? 'weekend-col' : ''}"><input type="text" class="x-input ${val.toUpperCase() === 'X' ? 'has-x' : ''}" data-date="${dateStr}" value="${val}" maxlength="1" onfocus="this.select()" oninput="window.handleXInput(this, '${row.rowId}')"></td>`;
        });

        html += `<td style="font-weight: 800; background: #f0f9ff; color: #2b6cb0;" id="total_${row.rowId}">${totalX}</td></tr>`;
        rowCount++;
    }

    if (rowCount === 0 && !html) {
        html = `<tr><td colspan="99" style="text-align:center;padding:30px;color:var(--text-muted)">
            📭 Ninguna fila coincide con los filtros aplicados
        </td></tr>`;
    }

    tbody.innerHTML = html;
}


window.handleXInput = (input, rowId) => {
    let val = input.value.toUpperCase();
    if (val !== 'X' && val !== '') { input.value = ''; val = ''; }
    input.value = val;
    if (val === 'X') input.classList.add('has-x'); else input.classList.remove('has-x');
    const tr = input.closest('tr'); let total = 0;
    tr.querySelectorAll('.x-input').forEach(inp => { if (inp.value.toUpperCase() === 'X') total++; });
    const totalCell = document.getElementById(`total_${rowId}`);
    if (totalCell) totalCell.textContent = total;
};

window.saveCensusGrid = async () => {
    const btn = document.querySelector('button[onclick="window.saveCensusGrid()"]');
    const originalText = btn.innerHTML; btn.innerHTML = '⏳ Guardando...'; btn.disabled = true;

    try {
        const rows = document.querySelectorAll('.census-tr'); let savedCount = 0;
        for (const tr of rows) {
            const rowId = tr.getAttribute('data-rowid'); const marks = {};
            tr.querySelectorAll('.x-input').forEach(inp => { if (inp.value.toUpperCase() === 'X') marks[inp.getAttribute('data-date')] = 'X'; });

            let record = censusRecords.find(x => x.rowId === rowId && x.month === currentMonthObj);
            if (record) record.marks = marks;
            else { record = { id: `${rowId}_${currentMonthObj}`, rowId: rowId, month: currentMonthObj, marks: marks }; censusRecords.push(record); }
            await put('census_records', record);
            savedCount++;
        }
        showToast(`✅ Se guardaron los ajustes manuales`, 'success');
    } catch (err) { console.error(err); showToast('Error al guardar', 'error'); }
    btn.innerHTML = originalText; btn.disabled = false;
};

window.startNewMonth = async () => {
    if (!confirm(`⚠️ ¿Estás seguro de que deseas CERRAR el periodo actual e iniciar un mes nuevo en blanco?`)) return;
    const [y, m] = currentMonthObj.split('-').map(Number);
    let nextY = y; let nextM = m + 1;
    if (nextM > 12) { nextM = 1; nextY++; }
    currentMonthObj = `${nextY}-${String(nextM).padStart(2, '0')}`;
    await renderCenso(document.getElementById('page-content'));
    showToast(`✅ Mes cerrado. Bienvenido al nuevo periodo`, 'success', 3000);
};

window.downloadCensusExcel = () => {
    if (!window._censusRows || window._censusRows.length === 0) return showToast('No hay datos', 'warn');
    try {
        const wsData = [
            ["ARAMARK - REPORTE DE CENSO DE ALOJAMIENTO"],
            ["Periodo:", formatMonthLabel(currentMonthObj)], ["Generado el:", new Date().toLocaleString()], [],
            ["PABELLÓN", "HABITACIÓN", "CAMA", "TRABAJADOR", "RUT", "EMPRESA", "TURNO", "INGRESO", "SALIDA", ...gridDays, "TOTAL DIAS"]
        ];

        window._censusRows.forEach(row => {
            const record = censusRecords.find(x => x.rowId === row.rowId && x.month === currentMonthObj) || { marks: {} };
            let totalX = 0;
            const daysRow = gridDays.map(dateStr => {
                let val = '';
                const hoteleraData = allCensusData.find(c => c.roomId === row.roomId && c.date === dateStr);
                if (hoteleraData) {
                    const s = hoteleraData.state;
                    if (s === 'dia' && row.bedKey === 'day') val = 'X';
                    if (s === 'noche' && row.bedKey === 'night') val = 'X';
                    if ((s === '2dia' || s === '2noche') && (row.bedKey === 'day' || row.bedKey === 'night')) val = 'X';
                }
                if (record.marks[dateStr] !== undefined) val = record.marks[dateStr];
                if (val === 'X') totalX++;
                return val;
            });
            wsData.push([ row.building, row.roomNum, row.bedName, row.name, row.rut, row.company, row.shift, toChileanDate(row.arrival), toChileanDate(row.departure), ...daysRow, totalX ]);
        });

        const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, "Censo " + currentMonthObj);
        XLSX.writeFile(wb, `Censo_${currentMonthObj}_PC Hotelería.xlsx`);
        showToast('Excel descargado', 'success');
    } catch (error) { console.error(error); showToast('Error al exportar', 'error'); }
};