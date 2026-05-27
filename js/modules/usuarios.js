/**
 * PC Hotelería — User Management & Audit Module
 * Only accessible by role: 'superadmin'
 *
 * ⚠️ IMPORTANTE: La creación de cuentas usa Supabase Auth.
 *    Para que funcione sin confirmación de email, deshabilitar en:
 *    Supabase Dashboard → Authentication → Settings → "Enable email confirmations" = OFF
 */

import { getAll, put, remove } from '../db.js';
import { showToast, recordLog } from '../utils.js';
import { supabase } from '../supabaseClient.js';

// Colores por tipo de acción
const ACCION_COLORS = {
    LOGIN:            { bg: '#dcfce7', color: '#166534', label: '🔑 LOGIN' },
    ASIGNACION_MASIVA:{ bg: '#dbeafe', color: '#1e40af', label: '🏠 ASIGNACIÓN' },
    CHECKOUT_GRUPAL:  { bg: '#fef3c7', color: '#92400e', label: '🚪 CHECKOUT' },
    BORRAR_EMPRESA:   { bg: '#fee2e2', color: '#b91c1c', label: '🗑️ BORRAR' },
    CREAR_USUARIO:    { bg: '#f3e8ff', color: '#7c3aed', label: '👤 CREAR USER' },
    ELIMINAR_USUARIO: { bg: '#fee2e2', color: '#b91c1c', label: '❌ ELIM. USER' },
};
function badgeAccion(accion) {
    const c = ACCION_COLORS[accion] || { bg: '#f1f5f9', color: '#475569', label: accion };
    return `<span style="background:${c.bg};color:${c.color};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:800;white-space:nowrap">${c.label}</span>`;
}

export async function renderUsuarios(container) {
    const [users, auditRes] = await Promise.all([
        getAll('users'),
        supabase.from('v2_audit_log')
            .select('id,created_at,usuario,accion,detalle,metadata')
            .order('created_at', { ascending: false })
            .limit(100)
    ]);

    const auditLogs = auditRes.data || [];

    // También leer logs legacy de IndexedDB (login antiguo)
    const localLogs = await getAll('logs').catch(() => []);
    // Fusionar y ordenar
    const legacyMapped = localLogs.map(l => ({
        created_at: l.timestamp,
        usuario: l.username,
        accion: l.action,
        detalle: l.details,
        metadata: null,
    }));
    const allLogs = [...auditLogs, ...legacyMapped]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 100);

    container.innerHTML = `
        <div class="section-header">
          <div>
            <h2 class="section-title">Control de <span>Seguridad y Auditoría</span></h2>
            <p class="section-subtitle">Gestión de cuentas y registro histórico de acciones</p>
          </div>
          <button class="btn btn-primary" onclick="window.openUserModal()">
            ➕ Nuevo Administrador
          </button>
        </div>

        <!-- Aviso de configuración Supabase -->
        <div id="supabase-auth-notice" style="background:#fffbeb;border:1px solid #f6d860;border-radius:12px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#92400e;display:flex;align-items:flex-start;gap:10px">
          <span style="font-size:20px">⚙️</span>
          <div>
            <strong>Requisito único:</strong> Para que los administradores creados puedan iniciar sesión sin confirmar email,
            ve a <strong>Supabase Dashboard → Authentication → Settings</strong> y desactiva
            <strong>"Enable email confirmations"</strong>. Solo se hace una vez.
            <button onclick="document.getElementById('supabase-auth-notice').style.display='none'"
              style="float:right;background:none;border:none;cursor:pointer;color:#92400e;font-size:16px;margin-top:-2px">✕</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 2fr; gap:24px; align-items:start">
            
            <!-- User List -->
            <div class="card" style="padding:20px">
                <h3 style="font-size:16px; font-weight:800; margin-bottom:16px">Cuentas Activas</h3>
                <div id="users-list">
                    ${users.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">No hay administradores registrados</p>' : users.map(u => `
                        <div style="display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--border)">
                            <div style="width:36px; height:36px; border-radius:50%; background:var(--grad-red); color:white; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:12px">
                                ${(u.name || u.username || '?').slice(0, 2).toUpperCase()}
                            </div>
                            <div style="flex:1">
                                <div style="font-size:13px; font-weight:700">${u.name || u.username}</div>
                                <div style="font-size:11px; color:var(--text-muted)">${u.username} · ${u.role}</div>
                            </div>
                            ${u.role !== 'superadmin' ? `<button class="btn btn-ghost btn-sm" onclick="window.eliminarUsuario('${u.username}')">🗑️</button>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Audit Logs -->
                <div class="card" style="padding:20px">
                <h3 style="font-size:16px; font-weight:800; margin-bottom:4px">Historial de Acciones</h3>
                <p style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Últimos 100 eventos · Todos los dispositivos · Tiempo real</p>
                <div class="table-container" style="max-height:600px; overflow-y:auto">
                    <table class="table" style="font-size:12px;width:100%">
                        <thead>
                            <tr>
                                <th style="white-space:nowrap">Fecha/Hora (local)</th>
                                <th>Usuario</th>
                                <th>Acción</th>
                                <th>Descripción</th>
                                <th>Detalle exacto</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allLogs.length === 0
                                ? `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">Sin registros aún — los eventos aparecerán aquí en tiempo real</td></tr>`
                                : allLogs.map(l => {
                                    // Convertir UTC a hora local legible
                                    const fechaLocal = l.created_at
                                        ? new Date(l.created_at).toLocaleString('es-CL', {
                                            day:'2-digit', month:'2-digit', year:'numeric',
                                            hour:'2-digit', minute:'2-digit', second:'2-digit'
                                          })
                                        : '—';

                                    // Construir detalle fino del metadata
                                    let metaHtml = '—';
                                    const m = l.metadata;
                                    if (m && typeof m === 'object') {
                                        const items = [];
                                        if (m.empresa)               items.push(`🏢 <strong>${m.empresa}</strong>`);
                                        if (m.rut)                   items.push(`👤 RUT: <strong>${m.rut}</strong>`);
                                        if (m.cama_liberada)         items.push(`🛏️ Cama: <strong>${m.cama_liberada}</strong>`);
                                        if (m.total != null)         items.push(`📋 Registros: <strong>${m.total}</strong>`);
                                        if (m.asignaciones_borradas != null) items.push(`🗑️ Asignaciones eliminadas: <strong>${m.asignaciones_borradas}</strong>`);
                                        if (m.camas_liberadas != null)       items.push(`🛏️ Camas liberadas: <strong>${m.camas_liberadas}</strong>`);
                                        if (m.camas_liberadas != null && m.empresa) items.push(`🏢 Empresa: <strong>${m.empresa}</strong>`);
                                        if (m.total != null && m.empresa)           items.push(`📋 Total solicitudes: <strong>${m.total}</strong>`);
                                        if (m.email)                 items.push(`📧 Email: <strong>${m.email}</strong>`);
                                        if (m.role)                  items.push(`🎭 Rol: <strong>${m.role}</strong>`);
                                        if (m.contrato)              items.push(`📄 Contrato: <strong>${m.contrato}</strong>`);
                                        if (items.length) metaHtml = items.join(' &nbsp;·&nbsp; ');
                                    }

                                    // Fondo rojo para acciones destructivas
                                    const esDestructiva = ['BORRAR_EMPRESA_COMPLETA','BORRAR_ASIGNACION','BORRAR_LISTA_EMPRESA'].includes(l.accion);
                                    const rowBg = esDestructiva ? 'background:#fff5f5' : '';

                                    return `<tr style="${rowBg}">
                                        <td style="white-space:nowrap;color:var(--text-muted);font-family:monospace;font-size:11px">${fechaLocal}</td>
                                        <td><strong style="color:${esDestructiva?'#b91c1c':'inherit'}">${l.usuario||'—'}</strong></td>
                                        <td>${badgeAccion(l.accion)}</td>
                                        <td style="font-size:11px;color:#475569">${l.detalle||'—'}</td>
                                        <td style="font-size:11px">${metaHtml}</td>
                                    </tr>`;
                                }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- NEW USER MODAL -->
        <div class="modal-overlay" id="user-modal">
            <div class="modal" style="max-width:420px">
                <div class="modal-header">
                    <div class="modal-header-icon">👤</div>
                    <div>
                        <h3 style="font-size:16px; font-weight:700">Nuevo Administrador</h3>
                        <p style="font-size:12px; color:var(--text-secondary)">Se crea la cuenta en Supabase Auth</p>
                    </div>
                    <button class="modal-close btn" onclick="window.closeUserModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label">Nombre Completo</label>
                        <input type="text" id="new-user-name" class="form-input" placeholder="ej: María Paz">
                    </div>
                    <div class="form-group" style="margin-top:12px">
                        <label class="form-label">Email (será el usuario de inicio de sesión)</label>
                        <input type="email" id="new-user-id" class="form-input" placeholder="ej: maria.paz@aramark.cl">
                    </div>
                    <div class="form-group" style="margin-top:12px">
                        <label class="form-label">Contraseña (mínimo 6 caracteres)</label>
                        <input type="password" id="new-user-pass" class="form-input" placeholder="••••••••">
                    </div>
                    <div id="user-create-error" style="display:none;margin-top:10px;padding:10px;background:#fff5f5;border:1px solid #fc8181;border-radius:8px;font-size:12px;color:#c53030"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="window.closeUserModal()">Cancelar</button>
                    <button class="btn btn-primary" id="crear-cuenta-btn" onclick="window.guardarUsuario()">✅ Crear Cuenta</button>
                </div>
            </div>
        </div>
    `;

    window.openUserModal  = () => {
        document.getElementById('user-modal').classList.add('visible');
        document.getElementById('user-create-error').style.display = 'none';
        document.getElementById('new-user-name').value = '';
        document.getElementById('new-user-id').value = '';
        document.getElementById('new-user-pass').value = '';
    };
    window.closeUserModal = () => document.getElementById('user-modal').classList.remove('visible');

    window.guardarUsuario = async () => {
        const name     = document.getElementById('new-user-name').value.trim();
        const email    = document.getElementById('new-user-id').value.trim();
        const password = document.getElementById('new-user-pass').value;
        const errDiv   = document.getElementById('user-create-error');
        const btn      = document.getElementById('crear-cuenta-btn');

        errDiv.style.display = 'none';

        if (!name || !email || !password) {
            errDiv.textContent = 'Complete todos los campos';
            errDiv.style.display = 'block';
            return;
        }
        if (password.length < 6) {
            errDiv.textContent = 'La contraseña debe tener al menos 6 caracteres';
            errDiv.style.display = 'block';
            return;
        }
        if (!email.includes('@')) {
            errDiv.textContent = 'Ingrese un email válido (será el usuario de inicio de sesión)';
            errDiv.style.display = 'block';
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ Creando...';

        try {
            // 1. Crear en Supabase Auth (el sistema real de login)
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { name, role: 'admin' }  // metadata
                }
            });

            if (error) {
                errDiv.textContent = `❌ Error de Supabase: ${error.message}`;
                errDiv.style.display = 'block';
                btn.disabled = false;
                btn.textContent = '✅ Crear Cuenta';
                return;
            }

            // 2. También guardar en IndexedDB local para mostrar en lista + roles
            await put('users', {
                id:        email,
                username:  email,
                name,
                role:      'admin',
                createdAt: new Date().toISOString()
            });

            await recordLog('CREAR_USUARIO', `Se creó el administrador: ${email} (${name})`);
            showToast(`✅ Cuenta creada: ${name}`, 'success');
            window.closeUserModal();
            renderUsuarios(container);

        } catch(err) {
            errDiv.textContent = `❌ Error inesperado: ${err.message}`;
            errDiv.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '✅ Crear Cuenta';
        }
    };

    window.eliminarUsuario = async (username) => {
        if (!confirm(`¿Está seguro de eliminar al usuario ${username}?\n\nNota: Esto lo elimina de la lista local. Para revocar el acceso completamente, también eliminarlo en Supabase Dashboard → Authentication → Users.`)) return;
        await remove('users', username);
        await recordLog('ELIMINAR_USUARIO', `Se eliminó al usuario: ${username}`);
        showToast('Usuario eliminado de la lista local', 'success');
        renderUsuarios(container);
    };
}
