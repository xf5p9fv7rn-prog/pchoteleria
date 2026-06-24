/**
 * PC Hotelería — Main Application Router
 * Sistema V2 — Todas las rutas conectadas a tablas v2_
 */

import { openDB, getAll, getById, put, remove, seedDemoData, cleanupExpiredAssignments, getExpiredBeds, confirmCheckout, ensureDefaultUsers, ensureAramarkReservations, ensureAllRooms, freeAllRoomRestrictions, procesarColaDeSincronizacion, preloadAllData, initRealtimeSync, cleanupRealtimeSync, startPeriodicCloudRefresh, autoPromoteNextOccupants, purgeSyncQueue } from './db.js?v=20260615';
import { showToast, watchOnlineStatus } from './utils.js';
import { renderV2Infraestructura } from './v2/modules/v2-infraestructura.js?v=20260622-1730';
import { renderV2Anglo }          from './v2/modules/v2-anglo.js';
import { renderV2Dashboard } from './v2/modules/v2-dashboard.js';
import { renderV2Buscador } from './v2/modules/v2-buscador.js';
import { renderV2Checkin } from './v2/modules/v2-checkin.js?v=20260604-1000';
import { renderV2Trabajadores } from './v2/modules/v2-trabajadores.js';
import { renderV2Solicitudes } from './v2/modules/v2-solicitudes.js?v=20260622-1910';
import { renderV2CamasPerdidas } from './v2/modules/v2-camas-perdidas.js?v=20260623-1630';
import { renderV2Cupos }      from './v2/modules/v2-cupos.js';
import { renderV2Censo }      from './v2/modules/v2-censo.js';
import { renderCensoTrabajadores } from './v2/modules/v2-censo-trabajadores.js';
import { renderV2Distribucion } from './v2/modules/v2-distribucion.js';
import { renderV2Historial }    from './v2/modules/v2-historial.js?v=20260602-1730';
import { renderV2Cama3 }       from './v2/modules/v2-cama3.js';
import { renderV2Backup }      from './v2/modules/v2-backup.js';
import { renderV2Asistencia }  from './v2/modules/v2-asistencia.js?v=20260602-1620';
import { renderReagrupacion }  from './v2/modules/v2-reagrupacion.js';
import { renderV2InformeEjecutivo } from './v2/modules/v2-informe-ejecutivo.js?v=20260603-1820';
import { renderV2Detalle }         from './v2/modules/v2-detalle.js?v=20260623-1640';

// ── Roles basados en nombre de usuario (no email) ────────────────────────────
function getRole(username) {
    if (!username) return 'recepcionista';
    // Los supervisores están definidos por nombre en auth.js
    const SUPERVISORS = ['Juan Garrido', 'Guissele Barrera'];
    if (SUPERVISORS.includes(username)) return 'supervisor';
    // Roles especiales definidos en auth.js (lavanderia, invitado)
    // se preservan tal cual desde la sesión — este fn es sólo fallback para legacy
    return 'recepcionista';
}
import { renderUsuarios } from './modules/usuarios.js';
import { renderAsistencia } from './modules/asistencia.js';
import { renderCupos } from './modules/cupos.js';
import { loginApp, logoutApp, checkSession, refreshActivity, INACTIVITY_MS } from './auth.js?v=2';
import { logAudit } from './v2/v2-audit.js';
import { ejecutarAutoRotacion } from './v2/v2-service.js';

// Exponer globalmente para uso en Dashboard e Infraestructura (después de todos los imports)
window.__getExpiredBeds = getExpiredBeds;
window.__confirmCheckout = confirmCheckout;
window.__autoPromoteRotativo = autoPromoteNextOccupants;

// ── Current route ────────────────────────────────────
let currentRoute = 'v2dashboard';

const ROUTES = {
    // ── V2 (Sistema Principal) ────────────────────────────────
    v2dashboard:      { label: 'Dashboard',               icon: '📊', render: renderV2Dashboard, hidden: true },
    v2informeejecutivo:{ label: 'Informe Ejecutivo',       icon: '📈', render: renderV2InformeEjecutivo },
    v2solicitudes:    { label: 'Solicitudes Pendientes',   icon: '🔔', render: renderV2Solicitudes, badge: true },
    v2infraestructura:{ label: 'Infraestructura',          icon: '🏛️', render: renderV2Infraestructura },
    v2checkin:        { label: 'Check-in / Check-out',     icon: '🛎️', render: renderV2Checkin },
    v2buscador:       { label: 'Buscar Huésped',           icon: '🔍', render: renderV2Buscador },
    v2anglo:          { label: 'Asignación Anglo',          icon: '🗝️', render: renderV2Anglo },
    v2censo:          { label: 'Censo Administrativo',     icon: '📅', render: renderV2Censo },
    v2censotrab:      { label: 'Censo Trabajadores QR',    icon: '📲', render: renderCensoTrabajadores },
    v2trabajadores:   { label: 'Padrón Trabajadores',      icon: '👥', render: renderV2Trabajadores },
    v2camasperdidas:  { label: 'Camas Perdidas',           icon: '🛏️', render: renderV2CamasPerdidas },  // ✅ Visible para todos los roles
    v2reagrupacion:   { label: 'Reagrupación de Camas',     icon: '🔀', render: renderReagrupacion,   supervisorOnly: true },
    v2cupos:          { label: 'Cupos por Gerencia',       icon: '📊', render: renderV2Cupos,        supervisorOnly: true },
    v2distribucion:   { label: 'Distribución Habitaciones',icon: '🏨', render: renderV2Distribucion, supervisorOnly: true },
    v2historial:      { label: 'Historial',                 icon: '📋', render: renderV2Historial,   supervisorOnly: true },
    v2cama3:          { label: 'Gestión Cama 3',            icon: '🛏️', render: renderV2Cama3,      supervisorOnly: true },
    v2backup:         { label: 'Respaldo Diario',            icon: '🛡️', render: renderV2Backup,     supervisorOnly: true },
    v2detalle:        { label: 'Detalle',                    icon: '📋', render: renderV2Detalle,   supervisorOnly: true },
    v2asistencia:     { label: 'Control de Asistencia',      icon: '📋', render: renderV2Asistencia }, // ✅ Visible para todos los admins
    // ── Solo Superadmin (legacy — ocultos) ───────────────────────────────────────
    cupos:      { label: 'Cupos por Gerencia',   icon: '🎯', render: renderCupos,      superadminOnly: true, hidden: true },
    asistencia: { label: 'Control Asistencia',    icon: '✅', render: renderAsistencia, superadminOnly: true, hidden: true },
    // ── Gestión de Usuarios — visible para Supervisores ──────────────────────────
    users: { label: 'Gestión de Usuarios', icon: '👥', render: renderUsuarios, supervisorOnly: true },
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

    // ── PASO 1: Abrir la BD primero — garantiza que el schema esté listo ──────
    // CRÍTICO: openDB() DEBE completar antes de cualquier otra operación.
    // Si corre en paralelo con checkSession() pueden ocurrir race conditions
    // donde las tareas de mantenimiento intentan leer una BD que aún no está lista.
    try {
        await openDB();
    } catch (e) {
        console.warn('[Boot] Error abriendo IndexedDB:', e);
    }

    // ── PASO 2: Verificar sesión local (sessionStorage) ──────────────────────
    const userSession = checkSession();

    if (!userSession) {
        showLoginOverlay();
    } else {
        window._currentUser = {
            username:    userSession.username,
            name:        userSession.displayName,
            role:        userSession.role,
            initials:    userSession.initials,
        };
        initApp();

        // ⚡ AUTO-ROTACIÓN AL ARRANCAR LA APP
        // Corre en segundo plano (no bloquea la UI) cada vez que alguien abre la app.
        // Garantiza que los pre-asignados cuya fecha ya llegó se activen automáticamente
        // sin necesidad de que el usuario entre al Dashboard o Infraestructura.
        setTimeout(async () => {
            try {
                const { autoCheckout, activados } = await ejecutarAutoRotacion();
                const total = (autoCheckout?.length || 0) + (activados?.length || 0);
                if (total > 0) {
                    const msgs = [];
                    if (autoCheckout?.length > 0) msgs.push(`${autoCheckout.length} salida${autoCheckout.length > 1 ? 's' : ''} automática${autoCheckout.length > 1 ? 's' : ''}`);
                    if (activados?.length > 0)    msgs.push(`${activados.length} turno${activados.length > 1 ? 's' : ''} entrante${activados.length > 1 ? 's' : ''} activado${activados.length > 1 ? 's' : ''}`);
                    showToast(`⚡ Rotación automática: ${msgs.join(' · ')}`, 'success', 7000);
                    // ✅ Notificar a todos los módulos para que refresquen
                    window.dispatchEvent(new CustomEvent('rotacion-completada', { detail: { autoCheckout, activados } }));
                }
            } catch(e) {
                console.warn('[AutoRotación] Error:', e.message);
            }
        }, 2000); // 2s de retraso para no competir con la carga inicial de la UI

        // ⏰ TICKER DE MEDIANOCHE
        // Dispara ejecutarAutoRotacion exactamente al segundo 1 de cada nuevo día.
        // Garantiza que pre-asignados se activen y salidas se procesen automáticamente
        // aunque la app lleve horas abierta sin recargar (ej: tablet de guardia 24/7).
        (function programarRotacionMedianoche() {
            const ahora     = new Date();
            const manana    = new Date(ahora);
            manana.setDate(manana.getDate() + 1);
            manana.setHours(0, 0, 1, 0); // 00:00:01 del día siguiente
            const msHastaMedianoche = manana - ahora;
            console.log(`[Medianoche] Próxima rotación programada en ${Math.round(msHastaMedianoche/60000)} min`);

            setTimeout(async () => {
                console.log('[Medianoche] ⏰ Disparando rotación automática de medianoche...');
                try {
                    const { autoCheckout, activados } = await ejecutarAutoRotacion();
                    const total = (autoCheckout?.length || 0) + (activados?.length || 0);
                    if (total > 0) {
                        const msgs = [];
                        if (autoCheckout?.length > 0) msgs.push(`🌅 ${autoCheckout.length} checkout${autoCheckout.length > 1 ? 's' : ''} automático${autoCheckout.length > 1 ? 's' : ''}`);
                        if (activados?.length > 0)    msgs.push(`✅ ${activados.length} turno${activados.length > 1 ? 's' : ''} activado${activados.length > 1 ? 's' : ''}`);
                        showToast(`⏰ Rotación medianoche: ${msgs.join(' · ')}`, 'success', 10000);
                    }
                    // ✅ Notificar a todos los módulos abiertos para que refresquen
                    window.dispatchEvent(new CustomEvent('rotacion-completada', {
                        detail: { autoCheckout, activados, medianoche: true }
                    }));
                } catch(e) {
                    console.warn('[Medianoche] Error en rotación:', e.message);
                }
                // Re-programar para la siguiente medianoche (loop infinito de 24h)
                programarRotacionMedianoche();
            }, msHastaMedianoche);
        })();

        // ⏱️ Refresco periódico cada 5 minutos — garantiza consistencia si la app está abierta toda la noche
        setInterval(() => {
            window.dispatchEvent(new CustomEvent('rotacion-completada', { detail: { refresh: true } }));
        }, 5 * 60 * 1000);
    }
}

async function initApp() {
    document.getElementById('app').style.display = 'flex';
    document.getElementById('login-overlay').style.display = 'none';

    // ── Inactividad: iniciar timer global de 10 horas ────────────────────────
    _startInactivityWatcher();

    // Update Profile UI
    const u = window._currentUser;
    const displayName = u.name || u.username;
    const roleLabel   = u.role === 'supervisor' ? 'Supervisor' : 'Recepcionista';
    const initials    = u.initials || displayName.slice(0, 2).toUpperCase();

    document.getElementById('sidebar-user-name').textContent = displayName;
    document.getElementById('sidebar-user-role').textContent = roleLabel;
    document.getElementById('sidebar-avatar').textContent = initials;

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
            import('./modules/solicitudes.js?v=82').then(m => m.renderSolicitudes(content)).catch(() => { });
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

    const hash = location.hash.replace('#', '') || 'v2dashboard';
    navigate(hash in ROUTES ? hash : 'v2dashboard'); // fire-and-forget — UI responde al instante

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
    const overlay  = document.getElementById('login-overlay');
    const btn      = document.getElementById('login-btn');
    const btnText  = document.getElementById('login-btn-text');
    const btnSpinner = document.getElementById('login-btn-spinner');
    const errorMsg = document.getElementById('login-error');
    const userInput = document.getElementById('login-user');
    const passInput = document.getElementById('login-pass');

    if (!overlay || !btn) { console.error('[Auth] UI elements missing'); return; }

    overlay.classList.remove('opacity-0');
    overlay.style.display = 'flex';

    // Mostrar aviso de sesión expirada por inactividad
    const logoutReason = localStorage.getItem('cm_logout_reason');
    if (logoutReason === 'inactivity') {
        const alert = document.getElementById('inactivity-alert');
        if (alert) alert.classList.remove('hidden');
        localStorage.removeItem('cm_logout_reason');
    }

    // Toggle visibilidad contraseña
    window.togglePasswordVisibility = () => {
        const eyeOpen   = document.getElementById('eye-open');
        const eyeClosed = document.getElementById('eye-closed');
        if (passInput.type === 'password') {
            passInput.type = 'text';
            eyeOpen.classList.add('hidden');
            eyeClosed.classList.remove('hidden');
        } else {
            passInput.type = 'password';
            eyeOpen.classList.remove('hidden');
            eyeClosed.classList.add('hidden');
        }
    };

    // Limpiar errores de borde al escribir
    userInput?.addEventListener('input', () => userInput.classList.remove('border-red-500'));
    passInput?.addEventListener('input', () => passInput.classList.remove('border-red-500'));

    const doLogin = async () => {
        const userVal = userInput.value.trim();
        const passVal = passInput.value;

        // Validación visual de campos vacíos
        let hasError = false;
        if (!userVal) { userInput.classList.add('border-red-500'); hasError = true; }
        if (!passVal) { passInput.classList.add('border-red-500'); hasError = true; }
        if (hasError) {
            errorMsg.textContent = 'Complete todos los campos para continuar.';
            errorMsg.classList.remove('hidden');
            return;
        }

        // Estado de carga
        btn.disabled = true;
        if (btnText)   btnText.textContent = 'Verificando...';
        if (btnSpinner) btnSpinner.classList.remove('hidden');
        errorMsg.classList.add('hidden');

        try {
            const result = await loginApp(userVal, passVal);

            if (result.success) {
                if (btnText) btnText.textContent = 'Conectando...';
                btn.classList.remove('bg-red-600', 'hover:bg-red-700');
                btn.classList.add('bg-emerald-600');

                window._currentUser = {
                    username: result.user.username,
                    name:     result.user.displayName,
                    role:     result.user.role,
                    initials: result.user.initials,
                };

                try {
                    await put('logs', { timestamp: new Date().toISOString(), username: userVal, action: 'LOGIN', details: 'Acceso local seguro' });
                    await logAudit('LOGIN', `Ingreso al sistema · ${userVal} · Rol: ${result.user.role}`, { username: userVal, role: result.user.role });
                } catch (_) { }

                overlay.style.transition = 'opacity 0.4s ease';
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.style.display = 'none';
                    initApp();
                }, 400);
            } else {
                errorMsg.textContent = `⚠️ ${result.message || 'Credenciales inválidas'}`;
                errorMsg.classList.remove('hidden');
                userInput.classList.add('border-red-500');
                passInput.classList.add('border-red-500');
                btn.classList.add('animate-shake');
                setTimeout(() => btn.classList.remove('animate-shake'), 450);
                btn.disabled = false;
                if (btnText)   btnText.textContent = 'Iniciar Sesión';
                if (btnSpinner) btnSpinner.classList.add('hidden');
            }
        } catch (err) {
            errorMsg.textContent = '⚠️ Error inesperado. Verifique su conexión.';
            errorMsg.classList.remove('hidden');
            btn.disabled = false;
            if (btnText)   btnText.textContent = 'Iniciar Sesión';
            if (btnSpinner) btnSpinner.classList.add('hidden');
        }
    };

    btn.onclick = doLogin;
    passInput?.addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });
    userInput?.addEventListener('keypress', e => { if (e.key === 'Enter') passInput?.focus(); });
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

    const isSupervisor = ['supervisor', 'superadmin'].includes(window._currentUser?.role);

    navEl.innerHTML = `
    <div class="nav-section-label">Campamentos Perez V2</div>
    ${Object.entries(ROUTES).filter(([k, r]) => !r.superadminOnly && !r.supervisorOnly && !r.hidden).map(([key, r]) => navItemHTML(key, r)).join('')}

    ${isSupervisor ? `
    <div class="nav-section-label">Supervisores</div>
    ${Object.entries(ROUTES).filter(([k, r]) => r.supervisorOnly && !r.hidden).map(([key, r]) => navItemHTML(key, r)).join('')}
    ` : ''}

    <div class="nav-section-label">Portales</div>
    <a href="panel-dotacion.html" target="_blank" class="nav-item" style="background:linear-gradient(135deg,rgba(16,185,129,0.12),rgba(5,150,105,0.06));border:1px solid rgba(16,185,129,0.28);border-radius:10px;">
      <span class="nav-icon">👥</span>
      <span class="nav-label" style="color:#059669;font-weight:700;">Panel Dotación Excel</span>
    </a>
    <a href="dashboard-resumen.html" target="_blank" class="nav-item" style="background:linear-gradient(135deg,rgba(99,102,241,0.10),rgba(139,92,246,0.06));border:1px solid rgba(99,102,241,0.22);border-radius:10px;">
      <span class="nav-icon">📈</span>
      <span class="nav-label" style="color:#4f46e5;font-weight:700;">Resumen General</span>
    </a>
    <a href="detalle-portal.html" target="_blank" class="nav-item" style="background:linear-gradient(135deg,rgba(129,140,248,0.12),rgba(99,102,241,0.06));border:1px solid rgba(129,140,248,0.28);border-radius:10px;">
      <span class="nav-icon">📋</span>
      <span class="nav-label" style="color:#818cf8;font-weight:700;">Portal Detalle (QR)</span>
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
    <a href="parejas-aramark.html" target="_blank" class="nav-item" style="background:linear-gradient(135deg,rgba(200,16,46,0.10),rgba(200,16,46,0.05));border:1px solid rgba(200,16,46,0.25);border-radius:10px;">
      <span class="nav-icon">👫</span>
      <span class="nav-label" style="color:#C8102E;font-weight:700;">Parejas Aramark</span>
    </a>
    <a href="parejas-aramark-admin.html" target="_blank" class="nav-item" style="background:linear-gradient(135deg,rgba(200,16,46,0.06),rgba(26,26,26,0.04));border:1px solid rgba(200,16,46,0.18);border-radius:10px;">
      <span class="nav-icon">🔒</span>
      <span class="nav-label" style="color:#7f1d1d;font-weight:700;">Parejas — Admin</span>
    </a>
    <a href="consultas.html" target="_blank" class="nav-item" style="background:linear-gradient(135deg,rgba(192,57,43,0.08),rgba(231,76,60,0.05));border:1px solid rgba(192,57,43,0.2);border-radius:10px;">
      <span class="nav-icon" style="display:flex;align-items:center;justify-content:center;"><img src="Mirian.png" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1.5px solid rgba(192,57,43,0.4);" alt="Constanza"></span>
      <span class="nav-label" style="color:var(--red-600,#c0392b);font-weight:700;">Constanza IA</span>
    </a>
  `;

    if (bottomNavEl) {
        const role  = window._currentUser?.role;
        const isSup = ['supervisor', 'superadmin'].includes(role);
        bottomNavEl.innerHTML = Object.entries(ROUTES)
            .filter(([k, r]) => {
                if (r.hidden)           return false; // nunca en bottom-nav
                if (r.superadminOnly)   return role === 'superadmin';
                if (r.supervisorOnly)   return isSup;
                return true; // visible para todos
            })
            .map(([key, r]) => `
      <div class="bottom-nav-item ${key === currentRoute ? 'active' : ''}" 
           id="bnav-${key}" onclick="window.navigate('${key}')">
        <div class="bnav-icon-wrap">
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

    // ── Guard de ruta: recepcionistas bloqueados de zonas de supervisor ────────
    const routeDef = ROUTES[route];
    const userRole = window._currentUser?.role;
    const canAccessSupervisor = ['supervisor', 'superadmin'].includes(userRole);
    if (routeDef.superadminOnly && userRole !== 'superadmin') {
        import('./utils.js').then(m => m.showToast('⛔ Acceso restringido — Solo superadmin', 'error'));
        route = 'v2dashboard';
    } else if (routeDef.supervisorOnly && !canAccessSupervisor) {
        import('./utils.js').then(m => m.showToast('⛔ Acceso restringido — Solo supervisores', 'error'));
        route = 'v2dashboard';
    }

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
        // Mostrar esqueleto inmediato — el usuario ve respuesta al instante
        content.style.opacity = '1';
        content.style.transform = 'none';
        content.style.transition = 'none';
        content.innerHTML = `
          <div style="padding:28px;max-width:1200px;margin:0 auto">
            <div style="height:36px;width:220px;background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);
                        background-size:400% 100%;animation:_skShimmer 1.2s ease infinite;border-radius:10px;margin-bottom:24px"></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
              ${[1,2,3,4].map(()=>`<div style="height:90px;background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);
                background-size:400% 100%;animation:_skShimmer 1.2s ease infinite;border-radius:14px"></div>`).join('')}
            </div>
            <div style="height:320px;background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);
                        background-size:400% 100%;animation:_skShimmer 1.2s ease infinite;border-radius:14px"></div>
          </div>
          <style>@keyframes _skShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}</style>`;

        await ROUTES[route].render(content);

        // Fade in suave al terminar
        content.style.transition = 'opacity 0.2s ease';
        content.style.opacity = '0.1';
        requestAnimationFrame(() => {
            content.style.opacity = '1';
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
        cleanupRealtimeSync();
        logoutApp('manual');
    }
};

// ── Timer de Inactividad — se arranca en initApp() ──────────────────────────
function _startInactivityWatcher() {
    // Eventos que cuentan como actividad del usuario
    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart', 'click', 'pointermove'];
    ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, refreshActivity, { passive: true }));

    // Verificar cada minuto si el usuario lleva más de 10h inactivo
    setInterval(() => {
        const lastActivity = parseInt(localStorage.getItem('cm_last_activity') || '0', 10);
        if (Date.now() - lastActivity > INACTIVITY_MS) {
            console.warn('[Auth] Sesión expirada por inactividad. Cerrando sesión...');
            cleanupRealtimeSync();
            logoutApp('inactivity');
        }
    }, 60_000); // Revisar cada 60 segundos

    console.log('[Auth] ⏰ Timer de inactividad activo — sesión expira tras 10h sin actividad.');
}

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

