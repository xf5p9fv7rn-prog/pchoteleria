/**
 * PC Hotelería — Main Application Router
 * Sistema V2 — Todas las rutas conectadas a tablas v2_
 */

import { openDB, getAll, getById, put, remove, seedDemoData, cleanupExpiredAssignments, getExpiredBeds, confirmCheckout, ensureDefaultUsers, ensureAramarkReservations, ensureAllRooms, freeAllRoomRestrictions, procesarColaDeSincronizacion, preloadAllData, initRealtimeSync, startPeriodicCloudRefresh, autoPromoteNextOccupants, purgeSyncQueue } from './db.js';
import { showToast, watchOnlineStatus } from './utils.js';
import { renderV2Infraestructura } from './v2/modules/v2-infraestructura.js';
import { renderV2Anglo }          from './v2/modules/v2-anglo.js';
import { renderV2Dashboard } from './v2/modules/v2-dashboard.js';
import { renderV2Buscador } from './v2/modules/v2-buscador.js';
import { renderV2Checkin } from './v2/modules/v2-checkin.js';
import { renderV2Trabajadores } from './v2/modules/v2-trabajadores.js';
import { renderV2Solicitudes } from './v2/modules/v2-solicitudes.js?v=20260429-5';
import { renderV2CamasPerdidas } from './v2/modules/v2-camas-perdidas.js';
import { renderV2Cupos }      from './v2/modules/v2-cupos.js';
import { renderV2Censo }      from './v2/modules/v2-censo.js';
import { renderV2Distribucion } from './v2/modules/v2-distribucion.js';

// ── Supervisores autorizados (Cupos por Gerencia + Censo Admin) ──────────────
const SUPERVISOR_EMAILS = [
    'garrido-juan2@aramark.cl',
    'vegao-rodrigo@aramark.cl',
    'barrera-guissele@aramark.cl',
    'juan-1154@hotmail.es'  // superadmin también tiene acceso
];
function getRole(email) {
    if (email === 'juan-1154@hotmail.es') return 'superadmin';
    if (SUPERVISOR_EMAILS.includes(email.toLowerCase())) return 'supervisor';
    return 'admin';
}
import { renderUsuarios } from './modules/usuarios.js';
import { renderAsistencia } from './modules/asistencia.js';
import { renderCupos } from './modules/cupos.js';
import { loginApp, logoutApp, checkSession } from './auth.js';

// Exponer globalmente para uso en Dashboard e Infraestructura (después de todos los imports)
window.__getExpiredBeds = getExpiredBeds;
window.__confirmCheckout = confirmCheckout;
window.__autoPromoteRotativo = autoPromoteNextOccupants;

// ── Current route ────────────────────────────────────
let currentRoute = 'v2dashboard';

const ROUTES = {
    // ── V2 (Sistema Principal) ────────────────────────────────
    v2dashboard:      { label: 'Dashboard',               icon: '📊', render: renderV2Dashboard },
    v2anglo:          { label: 'Asignación Anglo',          icon: '⛏️🗝️', render: renderV2Anglo },
    v2infraestructura:{ label: 'Infraestructura',          icon: '🏛️', render: renderV2Infraestructura },
    v2censo:          { label: 'Censo Administrativo',     icon: '📅', render: renderV2Censo },
    v2checkin:        { label: 'Check-in / Check-out',     icon: '🛎️', render: renderV2Checkin },
    v2buscador:       { label: 'Buscar Huésped',           icon: '🔍', render: renderV2Buscador },
    v2trabajadores:   { label: 'Padrón Trabajadores',      icon: '👥', render: renderV2Trabajadores },
    v2solicitudes:    { label: 'Solicitudes Pendientes',   icon: '🔔', render: renderV2Solicitudes, badge: true },
    v2camasperdidas:  { label: 'Camas Perdidas',           icon: '🛏️', render: renderV2CamasPerdidas },
    v2cupos:          { label: 'Cupos por Gerencia',       icon: '📊', render: renderV2Cupos,        supervisorOnly: true },
    v2distribucion:   { label: 'Distribución Habitaciones',icon: '🏨', render: renderV2Distribucion, supervisorOnly: true },
    // ── Superadmin ────────────────────────────────────────────
    cupos:      { label: 'Cupos por Gerencia',          icon: '🎯', render: renderCupos,      superadminOnly: true, hidden: true },
    asistencia: { label: 'Control Asistencia',           icon: '✅', render: renderAsistencia, superadminOnly: true, hidden: true },
    users:      { label: 'Gestión de Administradores', icon: '👥', render: renderUsuarios,  superadminOnly: true },
};



async function boot() {
    // ── Diagnostic UI ──────────────────────────────────────
    const status = document.getElementById('engine-status-text');
    if (status) {
        status.textContent = 'LISTO (v33 - Pro Cloud)';
        status.parentElement.style.background = '#f0fff4';
        status.parentElement.style.color = '#276749';
        status.parentElement.style.borderColor = '#c6f6d5';
        status.parentElement.style.opacity = '1';
    }

    // ── CRITICAL: Maintenance & Data Setup ───────────
    try {
        await openDB();

        // 👇 PASO PARA QUITAR LETRAS ROJAS 👇
        // Esta línea borrará la etiqueta "ARA" de todas las habitaciones.
        // await freeAllRoomRestrictions(); 
        // 👆 CUANDO TERMINE, PONLE BARRAS // A LA LÍNEA DE ARRIBA 👆

        // 👇 PASO 1: Quita las // de la línea de abajo para crear los Edificios
        // await seedDemoData(); 

        // ⚠️ Revisar camas vencidas (ya NO borra — solo notifica)
        cleanupExpiredAssignments().then(count => {
            if (count > 0) {
                showToast(`⚠️ Hay ${count} cama${count !== 1 ? 's' : ''} con salida pendiente de confirmación`, 'warn', 6000);
            }
        });

        // 🔄 MODO ROTATIVO: promover nextOccupant → occupant cuando la fecha ya llegó
        autoPromoteNextOccupants().then(n => {
            if (n > 0) showToast(`🔄 ${n} trabajador${n !== 1 ? 'es' : ''} del turno entrante promovidos automáticamente`, 'success', 5000);
        }).catch(() => { });

    } catch (e) { console.warn('[Boot] Maintenance failed', e); }

    // ── SEGURIDAD: VERIFICACIÓN CON SUPABASE ──────────
    const userSession = await checkSession();

    if (!userSession) {
        showLoginOverlay();
    } else {
        window._currentUser = {
            username: userSession.email,
            name: userSession.email.split('@')[0],
            role: getRole(userSession.email)
        };
        initApp();
    }
}

async function initApp() {
    document.getElementById('app').style.display = 'flex';
    document.getElementById('login-overlay').style.display = 'none';

    // Update Profile UI
    const u = window._currentUser;
    const displayName = u.name.charAt(0).toUpperCase() + u.name.slice(1);

    document.getElementById('sidebar-user-name').textContent = displayName;
    document.getElementById('sidebar-user-role').textContent = u.role === 'superadmin' ? 'Super Visor' : 'Administrador';
    document.getElementById('sidebar-avatar').textContent = displayName.slice(0, 2).toUpperCase();

    // Register service worker
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js');
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateBanner();
                    }
                });
            });
            if (reg.waiting) showUpdateBanner();
        } catch (e) {
            console.warn('[SW] Registration failed:', e);
        }
    }

    function showUpdateBanner() {
        if (document.getElementById('update-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'update-banner';
        banner.className = 'update-banner';
        banner.innerHTML = `
            <div class="update-banner-text">
                <div class="update-banner-icon">✨</div>
                <div class="update-banner-info">
                    <h4>Nueva versión disponible</h4>
                    <p>Se han aplicado mejoras importantes.</p>
                </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="location.reload(true)">Actualizar ahora</button>
        `;
        document.body.appendChild(banner);
    }

    await openDB();
    preloadAllData(); // 🚀 Pre-cargar rooms, buildings y reservas en memoria (fire & forget)
    ensureDefaultUsers(); // 👤 Garantizar usuarios base (Anglo, Admin) — fire & forget
    console.log("¡ALERTA JUAN: EL MOTOR SÍ SE ENCENDIÓ!");

    // ☁️ Sincronización Realtime — Cambios de otros dispositivos llegan automáticamente
    if (navigator.onLine) {
        initRealtimeSync();
    }
    window.addEventListener('online', () => {
        initRealtimeSync(); // Re-suscribir si se recupera la conexión
    });

    // 🧹 Purgar cola offline atascada con peticiones legacy (rooms, buildings, etc.)
    purgeSyncQueue(); // Limpieza de un solo disparo — no bloquea la UI

    // 🔄 Auto-refresh periódico — garantiza convergencia aunque Realtime falle
    startPeriodicCloudRefresh();

    // ══════════════════════════════════════════════════════════════════════════
    // 🔴 TIEMPO REAL — Re-renderizar el módulo activo cuando llegan cambios
    //    de otro dispositivo (Realtime Supabase O auto-refresh cada 20s)
    // ══════════════════════════════════════════════════════════════════════════

    // 🏢 HABITACIONES / INFRAESTRUCTURA
    let _infraRefreshPending = false;
    window.addEventListener('rooms-updated', () => {
        const route = window._currentRoute;
        const content = document.getElementById('page-content');
        if (!content) return;

        // 🔒 Guard: no re-renderizar si hay un modal abierto (carga masiva, Anglo, etc.)
        const modalOpen = document.getElementById('carga-masiva-modal') ||
            document.getElementById('anglo-modal') ||
            document.querySelector('.modal-overlay.visible, .side-drawer-overlay.visible');
        if (modalOpen) return;

        if (route === 'infraestructura') {
            if (_infraRefreshPending) return;
            _infraRefreshPending = true;
            setTimeout(async () => {
                _infraRefreshPending = false;
                if (window._allRooms !== undefined) {
                    const { getAll } = await import('./db.js');
                    window._allRooms = await getAll('rooms').catch(() => window._allRooms);
                    const searchEl = document.getElementById('infra-search');
                    if (searchEl) searchEl.dispatchEvent(new Event('input'));
                }
            }, 800);
        }

        if (route === 'dashboard') {
            import('./modules/dashboard.js').then(m => m.renderDashboard(content)).catch(() => { });
        }

        if (route === 'censo') {
            window.dispatchEvent(new CustomEvent('censo:refresh'));
        }
    });

    // 📩 SOLICITUDES
    window.addEventListener('solicitudes-updated', () => {
        const content = document.getElementById('page-content');
        if (content && window._currentRoute === 'solicitudes') {
            import('./modules/solicitudes.js?v=4').then(m => m.renderSolicitudes(content)).catch(() => { });
        }
    });

    // 🎯 CUPOS POR GERENCIA  
    window.addEventListener('db:changed', (e) => {
        const { storeName, source } = e.detail || {};
        if (storeName === 'gerencia_quotas' && source !== 'local') {
            if (window._currentRoute === 'cupos') {
                const content = document.getElementById('page-content');
                if (content) import('./modules/cupos.js').then(m => m.renderCupos(content)).catch(() => { });
            }
        }
    });

    // 🔔 ALERTA MATUTINA: Mostrar banner si son las 5 AM o más y no se ha mostrado hoy
    checkDailyMorningAlert();
    // 👇 PASO 2: Quita las // de la línea de abajo para crear las Habitaciones
    //await ensureAllRooms();



    buildNav();
    _refreshPendingBadge(); // 🔔 Cargar conteo inicial de pendientes
    setInterval(_refreshPendingBadge, 60_000); // 🔄 Refrescar cada 60 s

    watchOnlineStatus(
        () => {
            document.getElementById('offline-badge')?.classList.remove('visible');
            showToast('Conexión restaurada — sincronizando datos...', 'success');
        },
        () => {
            document.getElementById('offline-badge')?.classList.add('visible');
            showToast('Sin conexión — modo offline activo', 'warn');
        }
    );

    if (!navigator.onLine) {
        document.getElementById('offline-badge')?.classList.add('visible');
    }

    const hash = location.hash.replace('#', '') || 'dashboard';
    await navigate(hash in ROUTES ? hash : 'dashboard');

    // popstate: dispara cuando el usuario presiona el botón Atrás/Adelante del navegador
    window.addEventListener('popstate', (e) => {
        // 🔒 No navegar si hay un modal o drawer abierto
        const anyModalOpen = document.querySelector(
            '.modal-overlay.visible, .side-drawer-overlay.visible, #room-detail-modal.visible'
        );
        if (anyModalOpen) {
            // Cerrar el modal y restaurar hash sin navegar
            document.querySelectorAll('.modal-overlay.visible').forEach(m => m.classList.remove('visible'));
            history.pushState({ route: currentRoute }, '', '#' + currentRoute);
            return;
        }
        const r = e.state?.route || location.hash.replace('#', '') || 'dashboard';
        if (r in ROUTES) navigate(r);
    });
    // Reemplazar el estado inicial para que el primer popstate tenga datos
    history.replaceState({ route: currentRoute }, '', location.hash || '#dashboard');
}

function showLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    const btn = document.getElementById('login-btn');
    const errorMsg = document.getElementById('login-error');

    if (!overlay || !btn) {
        console.error('[Auth] UI elements missing');
        return;
    }

    overlay.style.display = 'flex';
    overlay.style.opacity = '1';

    btn.onclick = async (e) => {
        if (e) e.preventDefault();

        const userVal = document.getElementById('login-user').value.trim();
        const passVal = document.getElementById('login-pass').value.trim();

        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '⏱️ Verificando...';
        errorMsg.style.display = 'none';

        try {
            const result = await loginApp(userVal, passVal);

            if (result.success) {
                btn.textContent = '📥 Conectando...';
                btn.style.background = '#276749';
                btn.style.borderColor = '#276749';

                window._currentUser = {
                    username: result.user.email,
                    name: result.user.email.split('@')[0],
                    role: getRole(result.user.email)
                };

                try { await put('logs', { timestamp: new Date().toISOString(), username: userVal, action: 'LOGIN', details: 'Acceso seguro en la nube' }); } catch (err) { }

                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.style.display = 'none';
                    initApp();
                }, 400);
            } else {
                errorMsg.innerHTML = `⚠️ Error: ${result.message || 'Credenciales inválidas'}`;
                errorMsg.style.display = 'block';
                btn.classList.add('shake');
                setTimeout(() => btn.classList.remove('shake'), 450);
                btn.disabled = false;
                btn.textContent = originalText;
            }
        } catch (err) {
            errorMsg.textContent = '⚠️ Error inesperado al conectar con el servidor.';
            errorMsg.style.display = 'block';
            btn.disabled = false;
            btn.textContent = originalText;
        }
    };

    document.getElementById('login-pass')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btn.click();
    });
}

// ── Badge: Solicitudes Pendientes ───────────────────────────────────────────
async function _refreshPendingBadge() {
    try {
        const { supabase } = await import('./supabaseClient.js');
        const { count, error } = await supabase
            .from('v2_solicitudes_b2b')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pendiente');
        if (error) return;
        const badge = document.getElementById('badge-v2solicitudes');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    } catch (_) { /* silencioso */ }
}

function buildNav() {
    const navEl = document.getElementById('sidebar-nav');
    const bottomNavEl = document.getElementById('bottom-nav');
    if (!navEl) return;

    navEl.innerHTML = `
    <div class="nav-section-label">Campamentos Perez V2</div>
    ${Object.entries(ROUTES).filter(([k, r]) => !r.superadminOnly && !r.supervisorOnly && !r.hidden).map(([key, r]) => navItemHTML(key, r)).join('')}

    ${(['supervisor','superadmin'].includes(window._currentUser?.role)) ? `
    <div class="nav-section-label">Supervisores</div>
    ${Object.entries(ROUTES).filter(([k, r]) => r.supervisorOnly && !r.hidden).map(([key, r]) => navItemHTML(key, r)).join('')}
    ` : ''}

    ${window._currentUser?.role === 'superadmin' ? `
    <div class="nav-section-label">Super Visor</div>
    ${Object.entries(ROUTES).filter(([k, r]) => r.superadminOnly && !r.hidden).map(([key, r]) => navItemHTML(key, r)).join('')}
    ` : ''}

    <div class="nav-section-label">Portales</div>
    <a href="dashboard-resumen.html" target="_blank" class="nav-item" style="background:linear-gradient(135deg,rgba(99,102,241,0.10),rgba(139,92,246,0.06));border:1px solid rgba(99,102,241,0.22);border-radius:10px;">
      <span class="nav-icon">📈</span>
      <span class="nav-label" style="color:#4f46e5;font-weight:700;">Resumen General</span>
    </a>
    <a href="censo-portal.html" target="_blank" class="nav-item">
      <span class="nav-icon">📋</span>
      <span class="nav-label">Censo Terreno (Portal)</span>
    </a>
    <a href="solicitud-empresa.html" target="_blank" class="nav-item">
      <span class="nav-icon">📩</span>
      <span class="nav-label">Empresas (Link)</span>
    </a>
    <a href="mi-habitacion.html" target="_blank" class="nav-item">
      <span class="nav-icon">🏠</span>
      <span class="nav-label">Residentes (Link)</span>
    </a>
    <a href="consultas.html" target="_blank" class="nav-item" style="background:linear-gradient(135deg,rgba(192,57,43,0.08),rgba(231,76,60,0.05));border:1px solid rgba(192,57,43,0.2);border-radius:10px;">
      <span class="nav-icon" style="display:flex;align-items:center;justify-content:center;"><img src="Mirian.png" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1.5px solid rgba(192,57,43,0.4);" alt="Constanza"></span>
      <span class="nav-label" style="color:var(--red-600,#c0392b);font-weight:700;">Constanza IA</span>
    </a>
  `;

    if (bottomNavEl) {
        bottomNavEl.innerHTML = Object.entries(ROUTES)
            .filter(([k, r]) => !r.superadminOnly || window._currentUser?.role === 'superadmin')
            .map(([key, r]) => `
      <div class="bottom-nav-item ${key === currentRoute ? 'active' : ''}" 
           id="bnav-${key}" onclick="window.navigate('${key}')">
        <div class="bnav-icon-wrap ${key === currentRoute ? '' : ''}">
          <div class="bnav-icon">${r.icon}</div>
        </div>
        <span>${r.label.split(' ')[0]}</span>
      </div>`).join('');
    }

    document.getElementById('sidebar-toggle-btn')?.addEventListener('click', toggleSidebar);
    document.getElementById('header-hamburger')?.addEventListener('click', () => openMobileSidebar());
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);
}

function navItemHTML(key, r) {
    const badgeHtml = r.badge
        ? `<span id="badge-${key}" style="margin-left:auto;background:#ef4444;color:#fff;border-radius:99px;font-size:10px;font-weight:800;padding:1px 7px;min-width:18px;text-align:center;display:none;">!</span>`
        : '';
    return `<div class="nav-item ${key === currentRoute ? 'active' : ''}" 
               id="nav-${key}" onclick="window.navigate('${key}')">
    <span class="nav-icon">${r.icon}</span>
    <span class="nav-label">${r.label}</span>
    ${badgeHtml}
  </div>`;
}

async function navigate(route) {
    if (!(route in ROUTES)) return;
    currentRoute = route;
    window._currentRoute = route; // 🔒 Exponer globalmente para guards en módulos

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${route}`)?.classList.add('active');
    document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`bnav-${route}`)?.classList.add('active');

    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
        const r = ROUTES[route];
        headerTitle.innerHTML = `${r.icon} <span>${r.label}</span>`;
    }

    const content = document.getElementById('page-content');
    if (content) {
        content.style.opacity = '0';
        content.style.transform = 'translateY(8px)';
        await ROUTES[route].render(content);
        requestAnimationFrame(() => {
            content.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            content.style.opacity = '1';
            content.style.transform = 'translateY(0)';
        });
    }

    // pushState registra la ruta en el historial del navegador
    // Así el botón Atrás del navegador vuelve a la pestaña anterior (no sale de la app)
    const newHash = '#' + route;
    if (location.hash !== newHash) {
        history.pushState({ route }, '', newHash);
    }
    closeMobileSidebar();
}

function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('collapsed');
}

function openMobileSidebar() {
    document.getElementById('sidebar')?.classList.add('mobile-open');
    document.getElementById('sidebar-overlay')?.classList.add('visible');
}

function closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebar-overlay')?.classList.remove('visible');
}

window.navigate = navigate;

window.handleLogout = async () => {
    if (confirm('¿Seguro que deseas cerrar sesión?')) {
        await logoutApp();
    }
};

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.action === 'PROCESS_SYNC_QUEUE') {
            procesarColaDeSincronizacion();
        }
    });
}

// ============================================================================
// 🔔 ALERTA MATUTINA DIARIA (5 AM) — Habitaciones que cambian hoy
// ============================================================================
async function checkDailyMorningAlert() {
    const now = new Date();
    const hour = now.getHours();
    const todayKey = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const alreadyShown = localStorage.getItem('cm_morning_alert_date');

    // Solo mostrar si son las 5 AM o más, y no se mostró hoy
    if (hour < 5 || alreadyShown === todayKey) return;

    // Esperar que los datos estén cargados (pequeño delay post-boot)
    await new Promise(r => setTimeout(r, 2000));

    const expired = await getExpiredBeds();
    // Solo alertar por las que salen HOY (no las ya vencidas de días anteriores que el admin ya sabe)
    const todayExits = expired.filter(e => e.departureDate === todayKey);

    if (todayExits.length === 0) {
        localStorage.setItem('cm_morning_alert_date', todayKey);
        return;
    }

    // Guardar que ya se mostró hoy
    localStorage.setItem('cm_morning_alert_date', todayKey);

    // Mostrar banner matutino
    showMorningAlertBanner(todayExits, todayKey);
}

function showMorningAlertBanner(exits, todayStr) {
    // Eliminar banner anterior si existe
    document.getElementById('morning-alert-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'morning-alert-banner';
    banner.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: linear-gradient(135deg, #c53030, #e53e3e);
        color: white; padding: 0; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        animation: slideDown 0.4s ease;
    `;

    // Formatear fecha chilena
    const [y, m, d] = todayStr.split('-');
    const dateLabel = `${d}/${m}/${y}`;

    banner.innerHTML = `
        <style>
            @keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }
            #morning-alert-banner .mal-content { display:flex; align-items:center; gap:12px; padding:12px 20px; flex-wrap:wrap; }
            #morning-alert-banner .mal-icon { font-size:24px; flex-shrink:0; }
            #morning-alert-banner .mal-text { flex:1; min-width:200px; }
            #morning-alert-banner .mal-title { font-weight:800; font-size:15px; }
            #morning-alert-banner .mal-sub { font-size:12px; opacity:0.85; margin-top:2px; }
            #morning-alert-banner .mal-actions { display:flex; gap:8px; flex-shrink:0; }
            #morning-alert-banner .mal-btn { padding:8px 16px; border-radius:8px; border:none; font-weight:700; font-size:13px; cursor:pointer; transition: all 0.15s; }
            #morning-alert-banner .mal-btn-primary { background:white; color:#c53030; }
            #morning-alert-banner .mal-btn-primary:hover { background:#f7fafc; }
            #morning-alert-banner .mal-btn-close { background:rgba(255,255,255,0.2); color:white; }
            #morning-alert-banner .mal-btn-close:hover { background:rgba(255,255,255,0.3); }
        </style>
        <div class="mal-content">
            <div class="mal-icon">🔔</div>
            <div class="mal-text">
                <div class="mal-title">⏰ Informe del día ${dateLabel} — ${exits.length} habitación${exits.length !== 1 ? 'es' : ''} con salida programada HOY</div>
                <div class="mal-sub">${exits.map(e => `Hab. ${e.roomNumber}: ${e.occupant} (${e.company})`).slice(0, 3).join(' · ')}${exits.length > 3 ? ` · y ${exits.length - 3} más...` : ''}</div>
            </div>
            <div class="mal-actions">
                <button class="mal-btn mal-btn-primary" onclick="window.navigate('dashboard'); document.getElementById('morning-alert-banner')?.remove();">Ver en Dashboard</button>
                <button class="mal-btn mal-btn-close" onclick="document.getElementById('morning-alert-banner')?.remove();">✕ Cerrar</button>
            </div>
        </div>
    `;

    document.body.prepend(banner);
}

boot().catch(console.error);

