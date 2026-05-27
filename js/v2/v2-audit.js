/**
 * v2-audit.js — Logger de Auditoría Global
 * Escribe eventos a v2_audit_log en Supabase para trazabilidad completa.
 * Importar con: import { logAudit } from '../v2-audit.js';
 */
import { supabase } from '../supabaseClient.js';

/**
 * Registra una acción en el log de auditoría.
 * @param {string} accion   - Ej: 'LOGIN', 'ASIGNACION', 'CHECKOUT', 'BORRAR'
 * @param {string} detalle  - Descripción legible de la acción
 * @param {object} metadata - Datos adicionales en JSON (opcional)
 */
export async function logAudit(accion, detalle, metadata = null) {
    try {
        const usuario = window._currentUser?.username
                     || window._currentUser?.email
                     || 'desconocido';
        await supabase.from('v2_audit_log').insert({
            usuario,
            accion,
            detalle,
            metadata: metadata ? metadata : null,
        });
    } catch (e) {
        // Silencioso — el logging nunca debe romper el flujo principal
        console.warn('[Audit] No se pudo registrar acción:', e.message);
    }
}
