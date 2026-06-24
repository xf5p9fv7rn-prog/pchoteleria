/**
 * PC Hotelería — Panel de Gestión de Usuarios
 * Solo accesible por rol: 'supervisor'
 *
 * Muestra la lista de todos los usuarios del sistema y permite
 * activar/desactivar cuentas mediante una lista negra en localStorage.
 */

import { showToast } from '../utils.js';
import { supabase } from '../supabaseClient.js';
import { getAllSystemUsers, blacklistUser, restoreUser, getBlacklist } from '../auth.js?v=2';

// ── Colores / badges de estado ────────────────────────────────────────────────
const ROLE_BADGE = {
    supervisor: {
        bg:    'linear-gradient(135deg,#fbbf24,#f59e0b)',
        color: '#78350f',
        icon:  '⭐',
        label: 'Supervisor',
    },
    recepcionista: {
        bg:    'linear-gradient(135deg,#60a5fa,#3b82f6)',
        color: '#1e3a8a',
        icon:  '🛎️',
        label: 'Recepcionista',
    },
};

function roleBadge(role) {
    const r = ROLE_BADGE[role] || { bg: '#e2e8f0', color: '#475569', icon: '👤', label: role };
    return `<span style="background:${r.bg};color:${r.color};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">${r.icon} ${r.label}</span>`;
}

// ── Colores de acciones del audit log ─────────────────────────────────────────
const ACCION_COLORS = {
    LOGIN:             { bg: '#dcfce7', color: '#166534', label: '🔑 LOGIN' },
    ASIGNACION_MASIVA: { bg: '#dbeafe', color: '#1e40af', label: '🏠 ASIGNACIÓN' },
    CHECKOUT_GRUPAL:   { bg: '#fef3c7', color: '#92400e', label: '🚪 CHECKOUT' },
    BORRAR_EMPRESA:    { bg: '#fee2e2', color: '#b91c1c', label: '🗑️ BORRAR' },
    CREAR_USUARIO:     { bg: '#f3e8ff', color: '#7c3aed', label: '👤 CREAR USER' },
    ELIMINAR_USUARIO:  { bg: '#fee2e2', color: '#b91c1c', label: '❌ ELIM. USER' },
};

function badgeAccion(accion) {
    const c = ACCION_COLORS[accion] || { bg: '#f1f5f9', color: '#475569', label: accion };
    return `<span style="background:${c.bg};color:${c.color};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:800;white-space:nowrap">${c.label}</span>`;
}

// ── Render principal ──────────────────────────────────────────────────────────
export async function renderUsuarios(container) {
    // Verificar permisos
    const userRole = window._currentUser?.role;
    if (userRole !== 'supervisor' && userRole !== 'superadmin') {
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:16px;color:var(--text-muted)">
                <div style="font-size:48px">⛔</div>
                <div style="font-size:18px;font-weight:700">Acceso Denegado</div>
                <p style="font-size:14px;text-align:center;max-width:300px">Esta sección es exclusiva para supervisores del sistema.</p>
            </div>`;
        return;
    }

    // Cargar audit log desde Supabase
    const auditRes = await supabase
        .from('v2_audit_log')
        .select('id,created_at,usuario,accion,detalle,metadata')
        .order('created_at', { ascending: false })
        .limit(80);

    const auditLogs = auditRes.data || [];
    const users = getAllSystemUsers();
    const blacklist = getBlacklist();
    const currentUsername = window._currentUser?.username;

    container.innerHTML = `
        <div style="padding:24px;max-width:1400px;margin:0 auto;">

            <!-- Encabezado -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:28px;">
                <div>
                    <h2 style="font-size:24px;font-weight:900;color:var(--text-primary);margin-bottom:4px;">
                        👥 Gestión de <span style="color:var(--red-600);">Usuarios del Sistema</span>
                    </h2>
                    <p style="font-size:13px;color:var(--text-muted);">
                        Panel exclusivo de supervisores · ${users.length} cuentas configuradas · ${blacklist.length} desactivadas
                    </p>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="background:linear-gradient(135deg,rgba(16,185,129,0.12),rgba(5,150,105,0.06));border:1px solid rgba(16,185,129,0.28);border-radius:10px;padding:8px 14px;font-size:12px;font-weight:700;color:#059669;">
                        🔒 Sesión: ${currentUsername}
                    </div>
                </div>
            </div>

            <!-- Grid principal -->
            <div style="display:grid;grid-template-columns:380px 1fr;gap:24px;align-items:start;" id="users-grid">

                <!-- ── Lista de usuarios ── -->
                <div class="card" style="padding:0;overflow:hidden;border-radius:16px;">
                    <div style="padding:18px 20px;background:linear-gradient(135deg,#0f172a,#1e1b4b);border-bottom:1px solid var(--border);">
                        <h3 style="font-size:15px;font-weight:800;color:#fff;margin-bottom:2px;">Cuentas del Sistema</h3>
                        <p style="font-size:11px;color:rgba(255,255,255,0.5);">Administre el acceso de cada usuario</p>
                    </div>

                    <div id="users-list" style="padding:8px;">
                        ${_renderUserCards(users, currentUsername)}
                    </div>
                </div>

                <!-- ── Audit Log ── -->
                <div class="card" style="padding:0;overflow:hidden;border-radius:16px;">
                    <div style="padding:18px 20px;background:linear-gradient(135deg,#1e1b4b,#312e81);border-bottom:1px solid var(--border);">
                        <h3 style="font-size:15px;font-weight:800;color:#fff;margin-bottom:2px;">📋 Historial de Acciones</h3>
                        <p style="font-size:11px;color:rgba(255,255,255,0.5);">Últimos 80 eventos · Todos los dispositivos · Tiempo real</p>
                    </div>
                    <div style="max-height:680px;overflow-y:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead>
                                <tr style="background:var(--bg-page);position:sticky;top:0;z-index:2;">
                                    <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-muted);white-space:nowrap;border-bottom:1px solid var(--border);">Fecha/Hora</th>
                                    <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-muted);border-bottom:1px solid var(--border);">Usuario</th>
                                    <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-muted);border-bottom:1px solid var(--border);">Acción</th>
                                    <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-muted);border-bottom:1px solid var(--border);">Descripción</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${auditLogs.length === 0
                                    ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:32px;">Sin registros aún — los eventos aparecerán aquí en tiempo real</td></tr>`
                                    : auditLogs.map(l => {
                                        const fechaLocal = l.created_at
                                            ? new Date(l.created_at).toLocaleString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
                                            : '—';
                                        const esDestructiva = ['BORRAR_EMPRESA_COMPLETA','BORRAR_ASIGNACION','BORRAR_LISTA_EMPRESA','ELIMINAR_USUARIO'].includes(l.accion);
                                        return `<tr style="${esDestructiva ? 'background:#fff5f5' : ''};border-bottom:1px solid var(--border);">
                                            <td style="padding:10px 14px;white-space:nowrap;color:var(--text-muted);font-family:monospace;font-size:11px;">${fechaLocal}</td>
                                            <td style="padding:10px 14px;"><strong style="color:${esDestructiva?'#b91c1c':'inherit'}">${l.usuario || '—'}</strong></td>
                                            <td style="padding:10px 14px;">${badgeAccion(l.accion)}</td>
                                            <td style="padding:10px 14px;font-size:11px;color:#475569;max-width:220px;word-break:break-word;">${l.detalle || '—'}</td>
                                        </tr>`;
                                    }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- ── Modal de confirmación de eliminación ── -->
        <div id="confirm-delete-modal" style="display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);align-items:center;justify-content:center;">
            <div style="background:#fff;border-radius:20px;padding:32px;max-width:420px;width:calc(100% - 48px);box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:modalIn 0.25s ease;">
                <div style="text-align:center;margin-bottom:20px;">
                    <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
                    <h3 style="font-size:20px;font-weight:900;color:#0f172a;margin-bottom:8px;">¿Retirar usuario?</h3>
                    <p style="font-size:14px;color:#64748b;line-height:1.5;">
                        Está a punto de desactivar la cuenta de <br>
                        <strong id="confirm-delete-name" style="color:#b91c1c;font-size:16px;">—</strong>
                    </p>
                    <p style="font-size:12px;color:#94a3b8;margin-top:8px;">El usuario no podrá iniciar sesión hasta que lo reactive. Esta acción es reversible.</p>
                </div>
                <div style="display:flex;gap:12px;">
                    <button onclick="window.closeConfirmModal()" style="flex:1;height:44px;border:2px solid #e2e8f0;background:#fff;border-radius:12px;font-size:14px;font-weight:700;color:#475569;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                        Cancelar
                    </button>
                    <button id="confirm-delete-btn" onclick="window.executeDeleteUser()" style="flex:1;height:44px;border:none;background:linear-gradient(135deg,#dc2626,#b91c1c);border-radius:12px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;transition:all 0.15s;box-shadow:0 4px 12px rgba(220,38,38,0.3);" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='none'">
                        🗑️ Sí, retirar acceso
                    </button>
                </div>
            </div>
        </div>

        <style>
            @keyframes modalIn { from { opacity:0;transform:scale(0.92) translateY(16px); } to { opacity:1;transform:scale(1) translateY(0); } }
            #users-grid { grid-template-columns: 380px 1fr; }
            @media (max-width: 900px) { #users-grid { grid-template-columns: 1fr !important; } }
        </style>
    `;

    // ── Event handlers ────────────────────────────────────────────────────────
    let _pendingDeleteUsername = null;

    window.openConfirmModal = (username, displayName) => {
        _pendingDeleteUsername = username;
        document.getElementById('confirm-delete-name').textContent = displayName;
        const modal = document.getElementById('confirm-delete-modal');
        modal.style.display = 'flex';
    };

    window.closeConfirmModal = () => {
        _pendingDeleteUsername = null;
        document.getElementById('confirm-delete-modal').style.display = 'none';
    };

    window.executeDeleteUser = async () => {
        if (!_pendingDeleteUsername) return;
        const username = _pendingDeleteUsername;

        const btn = document.getElementById('confirm-delete-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Retirando...';

        blacklistUser(username);

        // Registrar en audit log
        try {
            const { logAudit } = await import('../v2/v2-audit.js');
            await logAudit('ELIMINAR_USUARIO', `Acceso desactivado para: ${username}`, { username, action: 'blacklist' });
        } catch (_) { }

        window.closeConfirmModal();
        showToast(`🚫 Acceso de "${username}" desactivado`, 'warn');
        renderUsuarios(container); // Re-renderizar
    };

    window.reactivarUsuario = async (username) => {
        restoreUser(username);

        try {
            const { logAudit } = await import('../v2/v2-audit.js');
            await logAudit('CREAR_USUARIO', `Acceso reactivado para: ${username}`, { username, action: 'restore' });
        } catch (_) { }

        showToast(`✅ Acceso de "${username}" reactivado`, 'success');
        renderUsuarios(container);
    };

    // Cerrar modal al hacer clic fuera
    document.getElementById('confirm-delete-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) window.closeConfirmModal();
    });
}

// ── Helper: renderizar tarjetas de usuario ────────────────────────────────────
function _renderUserCards(users, currentUsername) {
    if (users.length === 0) {
        return '<p style="color:var(--text-muted);text-align:center;padding:24px;font-size:13px;">No hay usuarios configurados</p>';
    }

    return users.map(u => {
        const isCurrentUser = u.username === currentUsername;
        const isSupervisor  = u.role === 'supervisor';
        const statusColor   = u.active ? '#10b981' : '#ef4444';
        const statusLabel   = u.active ? 'Activo' : 'Desactivado';
        const statusIcon    = u.active ? '●' : '○';

        return `
        <div style="display:flex;align-items:center;gap:12px;padding:14px 12px;border-radius:12px;margin-bottom:4px;transition:background 0.15s;${!u.active ? 'opacity:0.55;' : ''}"
             onmouseover="this.style.background='var(--bg-page)'" onmouseout="this.style.background='transparent'">

            <!-- Avatar -->
            <div style="width:42px;height:42px;border-radius:50%;background:${isSupervisor ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#3b82f6,#1d4ed8)'};color:white;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;flex-shrink:0;">
                ${u.initials}
            </div>

            <!-- Info -->
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:13px;font-weight:800;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${u.displayName}</span>
                    ${isCurrentUser ? '<span style="font-size:10px;background:#dbeafe;color:#1e40af;border-radius:99px;padding:1px 7px;font-weight:700;flex-shrink:0;">Tú</span>' : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                    ${roleBadge(u.role)}
                    <span style="font-size:11px;color:${statusColor};font-weight:700;">${statusIcon} ${statusLabel}</span>
                </div>
            </div>

            <!-- Acciones -->
            <div style="flex-shrink:0;">
                ${isCurrentUser || isSupervisor
                    ? `<span style="font-size:11px;color:var(--text-muted);font-style:italic;padding:6px 10px;">${isCurrentUser ? 'Tu sesión' : 'Protegido'}</span>`
                    : u.active
                        ? `<button onclick="window.openConfirmModal('${u.username}', '${u.displayName}')"
                            style="height:34px;padding:0 14px;border:1.5px solid #fca5a5;background:#fff5f5;border-radius:8px;font-size:12px;font-weight:700;color:#b91c1c;cursor:pointer;transition:all 0.15s;white-space:nowrap;"
                            onmouseover="this.style.background='#fee2e2';this.style.borderColor='#ef4444'"
                            onmouseout="this.style.background='#fff5f5';this.style.borderColor='#fca5a5'">
                            🗑️ Retirar
                          </button>`
                        : `<button onclick="window.reactivarUsuario('${u.username}')"
                            style="height:34px;padding:0 14px;border:1.5px solid #6ee7b7;background:#f0fdf4;border-radius:8px;font-size:12px;font-weight:700;color:#047857;cursor:pointer;transition:all 0.15s;white-space:nowrap;"
                            onmouseover="this.style.background='#d1fae5';this.style.borderColor='#34d399'"
                            onmouseout="this.style.background='#f0fdf4';this.style.borderColor='#6ee7b7'">
                            ✅ Reactivar
                          </button>`
                }
            </div>
        </div>`;
    }).join('');
}
