/**
 * PC Hotelería — User Management & Audit Module
 * Only accessible by role: 'superadmin'
 */

import { getAll, put, remove } from '../db.js';
import { showToast, recordLog } from '../utils.js';

export async function renderUsuarios(container) {
    const [users, logs] = await Promise.all([
        getAll('users'),
        getAll('logs')
    ]);

    // Format logs: most recent first
    const sortedLogs = logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 50);

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

        <div style="display:grid; grid-template-columns: 1fr 2fr; gap:24px; align-items:start">
            
            <!-- User List -->
            <div class="card" style="padding:20px">
                <h3 style="font-size:16px; font-weight:800; margin-bottom:16px">Cuentas Activas</h3>
                <div id="users-list">
                    ${users.map(u => `
                        <div style="display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--border)">
                            <div style="width:36px; height:36px; border-radius:50%; background:var(--grad-red); color:white; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:12px">
                                ${u.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div style="flex:1">
                                <div style="font-size:13px; font-weight:700">${u.name}</div>
                                <div style="font-size:11px; color:var(--text-muted)">${u.username} · ${u.role}</div>
                            </div>
                            ${u.role !== 'superadmin' ? `<button class="btn btn-ghost btn-sm" onclick="window.eliminarUsuario('${u.username}')">🗑️</button>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Audit Logs -->
            <div class="card" style="padding:20px">
                <h3 style="font-size:16px; font-weight:800; margin-bottom:16px">Historial de Acciones (Últimos 50)</h3>
                <div class="table-container" style="max-height:600px; overflow-y:auto">
                    <table class="table" style="font-size:12px">
                        <thead>
                            <tr>
                                <th>Fecha/Hora</th>
                                <th>Usuario</th>
                                <th>Acción</th>
                                <th>Detalle</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedLogs.map(l => `
                                <tr>
                                    <td style="white-space:nowrap; color:var(--text-muted)">${l.timestamp.slice(0, 16).replace('T', ' ')}</td>
                                    <td><strong>${l.username}</strong></td>
                                    <td><span class="status-badge ${l.action.toLowerCase() === 'login' ? 'assigned' : 'pending'}">${l.action}</span></td>
                                    <td>${l.details}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- NEW USER MODAL -->
        <div class="modal-overlay" id="user-modal">
            <div class="modal" style="max-width:400px">
                <div class="modal-header">
                    <div class="modal-header-icon">👤</div>
                    <div>
                        <h3 style="font-size:16px; font-weight:700">Nuevo Administrador</h3>
                        <p style="font-size:12px; color:var(--text-secondary)">Crear acceso estándar</p>
                    </div>
                    <button class="modal-close btn" onclick="window.closeUserModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label">Nombre Completo</label>
                        <input type="text" id="new-user-name" class="form-input" placeholder="ej: Maria Paz">
                    </div>
                    <div class="form-group" style="margin-top:12px">
                        <label class="form-label">Usuario / Email</label>
                        <input type="text" id="new-user-id" class="form-input" placeholder="ej: maria.paz@aramark.cl">
                    </div>
                    <div class="form-group" style="margin-top:12px">
                        <label class="form-label">Contraseña</label>
                        <input type="password" id="new-user-pass" class="form-input" placeholder="••••••••">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="window.closeUserModal()">Cancelar</button>
                    <button class="btn btn-primary" onclick="window.guardarUsuario()">Crear Cuenta</button>
                </div>
            </div>
        </div>
    `;

    window.openUserModal = () => document.getElementById('user-modal').classList.add('visible');
    window.closeUserModal = () => document.getElementById('user-modal').classList.remove('visible');

    window.guardarUsuario = async () => {
        const name = document.getElementById('new-user-name').value;
        const username = document.getElementById('new-user-id').value;
        const password = document.getElementById('new-user-pass').value;

        if(!name || !username || !password) return showToast('Complete todos los campos', 'error');

        await put('users', {
            username,
            password,
            name,
            role: 'admin',
            createdAt: new Date().toISOString()
        });

        await recordLog('CREAR_USUARIO', `Se creó el usuario: ${username}`);
        showToast('Usuario creado correctamente', 'success');
        window.closeUserModal();
        renderUsuarios(container);
    };

    window.eliminarUsuario = async (username) => {
        if(!confirm(`¿Está seguro de eliminar al usuario ${username}?`)) return;
        await remove('users', username);
        await recordLog('ELIMINAR_USUARIO', `Se eliminó al usuario: ${username}`);
        showToast('Usuario eliminado', 'success');
        renderUsuarios(container);
    };
}
