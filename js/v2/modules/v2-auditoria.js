/**
 * v2-auditoria.js — Panel de Auditoría de Actividad
 * Muestra un registro inmutable de QUIÉN hizo QUÉ y CUÁNDO
 * Solo visible para roles: supervisor, superadmin
 */

import { supabase } from '../../supabaseClient.js';

// ─── Paleta de colores por operación ──────────────────────────────────────
const OP_STYLE = {
    INSERT: { bg: '#dcfce7', color: '#15803d', icon: '➕', label: 'Creó' },
    UPDATE: { bg: '#fef9c3', color: '#92400e', icon: '✏️', label: 'Modificó' },
    DELETE: { bg: '#fee2e2', color: '#dc2626', icon: '🗑️', label: 'Eliminó' },
};

const TABLA_LABEL = {
    v2_asignaciones:    '🛏️ Asignación',
    v2_camas:           '🚪 Cama',
    v2_solicitudes_b2b: '📋 Solicitud',
    v2_empresas:        '🏢 Empresa',
    v2_incidencias_anglo: '⚠️ Incidencia',
};

// ─── Estado local ─────────────────────────────────────────────────────────
let _page = 0;
const PAGE_SIZE = 50;

// ─── Render principal ─────────────────────────────────────────────────────
export async function renderAuditoria(container) {
    // Verificar rol
    const role = window._currentUser?.role;
    if (!['supervisor', 'superadmin'].includes(role)) {
        container.innerHTML = `
        <div style="text-align:center;padding:60px 20px">
            <div style="font-size:48px;margin-bottom:16px">🔒</div>
            <div style="font-size:18px;font-weight:700;color:var(--text-primary)">Acceso Restringido</div>
            <div style="color:var(--text-muted);margin-top:8px">Solo supervisores y administradores pueden ver la auditoría</div>
        </div>`;
        return;
    }

    _page = 0;
    container.innerHTML = `
    <div style="max-width:1000px;margin:0 auto;padding:0 4px">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text-primary);margin:0">🔍 Registro de Actividad</h2>
          <p style="font-size:12px;color:var(--text-muted);margin:4px 0 0">Auditoría inmutable — cada acción queda registrada con el usuario que la realizó</p>
        </div>
        <button onclick="window._auditExport()"
          style="padding:8px 16px;border:none;border-radius:10px;background:#dcfce7;color:#15803d;font-weight:700;font-size:12px;cursor:pointer">
          📥 Exportar CSV
        </button>
      </div>

      <!-- Filtros -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div style="flex:1;min-width:160px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px">USUARIO</div>
          <input id="aud-fil-email" type="text" placeholder="email@..."
            style="width:100%;padding:8px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none">
        </div>
        <div style="min-width:130px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px">OPERACIÓN</div>
          <select id="aud-fil-op" style="width:100%;padding:8px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none">
            <option value="">Todas</option>
            <option value="INSERT">➕ Creó</option>
            <option value="UPDATE">✏️ Modificó</option>
            <option value="DELETE">🗑️ Eliminó</option>
          </select>
        </div>
        <div style="min-width:160px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px">TABLA</div>
          <select id="aud-fil-tabla" style="width:100%;padding:8px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none">
            <option value="">Todas</option>
            <option value="v2_asignaciones">🛏️ Asignaciones</option>
            <option value="v2_camas">🚪 Camas</option>
            <option value="v2_solicitudes_b2b">📋 Solicitudes</option>
            <option value="v2_empresas">🏢 Empresas</option>
            <option value="v2_incidencias_anglo">⚠️ Incidencias</option>
          </select>
        </div>
        <div style="min-width:140px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px">DESDE</div>
          <input id="aud-fil-desde" type="date"
            style="width:100%;padding:8px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:13px;outline:none">
        </div>
        <button onclick="window._auditBuscar()"
          style="padding:8px 20px;border:none;border-radius:9px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">
          🔍 Filtrar
        </button>
      </div>

      <!-- Resultados -->
      <div id="aud-tabla" style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">Cargando historial…</div>
      </div>

      <!-- Paginación -->
      <div id="aud-pag" style="display:flex;gap:8px;justify-content:center;margin-top:12px"></div>
    </div>`;

    // Cargar primera página
    await _cargarAuditoria();

    // Event listeners de filtros (Enter en email)
    document.getElementById('aud-fil-email')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { _page = 0; _cargarAuditoria(); }
    });

    // Exportar CSV
    window._auditExport = _exportCSV;
    window._auditBuscar = () => { _page = 0; _cargarAuditoria(); };
    window._auditPag = (dir) => { _page += dir; _cargarAuditoria(); };
}

// ─── Carga y render de datos ──────────────────────────────────────────────
async function _cargarAuditoria() {
    const el = document.getElementById('aud-tabla');
    if (!el) return;
    el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted)">Cargando…</div>`;

    const sb = supabase;
    const email  = document.getElementById('aud-fil-email')?.value?.trim();
    const op     = document.getElementById('aud-fil-op')?.value;
    const tabla  = document.getElementById('aud-fil-tabla')?.value;
    const desde  = document.getElementById('aud-fil-desde')?.value;

    let q = sb.from('v2_audit_resumen')
        .select('*')
        .order('fecha_hora_cl', { ascending: false })
        .range(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE - 1);

    if (email)  q = q.ilike('usuario_email', `%${email}%`);
    if (op)     q = q.eq('operacion', op);
    if (tabla)  q = q.eq('tabla', tabla);
    if (desde)  q = q.gte('fecha_hora_cl', desde);

    const { data, error } = await q;

    if (error) {
        el.innerHTML = `<div style="padding:20px;color:#dc2626;text-align:center">❌ ${error.message}</div>`;
        return;
    }

    if (!data?.length) {
        el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin registros para los filtros seleccionados</div>`;
        _renderPaginacion(false);
        return;
    }

    el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
        <thead>
          <tr style="background:var(--bg);border-bottom:1px solid var(--border)">
            ${['Fecha/Hora','Usuario','Rol','Acción','Tabla','Detalle'].map(h =>
              `<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;white-space:nowrap">${h}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.map((r, i) => _renderFila(r, i)).join('')}
        </tbody>
      </table>
    </div>`;

    _renderPaginacion(data.length === PAGE_SIZE);
}

function _renderFila(r, i) {
    const op    = OP_STYLE[r.operacion] || OP_STYLE.UPDATE;
    const tabla = TABLA_LABEL[r.tabla] || r.tabla;
    const fecha = r.fecha_hora_cl
        ? new Date(r.fecha_hora_cl).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
        : '—';

    // Construir descripción legible del cambio
    let detalle = r.descripcion || r.registro_id || '—';
    if (r.operacion === 'UPDATE' && r.datos_antes && r.datos_despues) {
        // Detectar campos que cambiaron
        const cambios = [];
        try {
            const antes = r.datos_antes;
            const despues = r.datos_despues;
            for (const k of Object.keys(despues)) {
                if (JSON.stringify(antes[k]) !== JSON.stringify(despues[k])
                    && !['updated_at','created_at'].includes(k)) {
                    cambios.push(`${k}: <span style="color:#dc2626;text-decoration:line-through">${antes[k]??'—'}</span> → <span style="color:#15803d">${despues[k]??'—'}</span>`);
                }
            }
        } catch(_) {}
        if (cambios.length) detalle = cambios.slice(0,2).join(' · ');
    }
    if (r.cama_afectada) detalle = `<strong style="color:#6366f1">${r.cama_afectada}</strong> · ` + detalle;

    return `
    <tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg)'}">
      <td style="padding:10px 14px;white-space:nowrap;color:var(--text-muted);font-size:12px">${fecha}</td>
      <td style="padding:10px 14px;font-weight:600;color:var(--text-primary)">${r.usuario_email || '—'}</td>
      <td style="padding:10px 14px">
        <span style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;color:var(--text-secondary)">${r.usuario_role || '—'}</span>
      </td>
      <td style="padding:10px 14px">
        <span style="background:${op.bg};color:${op.color};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap">${op.icon} ${op.label}</span>
      </td>
      <td style="padding:10px 14px;font-size:12px;color:var(--text-secondary);white-space:nowrap">${tabla}</td>
      <td style="padding:10px 14px;font-size:12px;color:var(--text-primary);max-width:280px">${detalle}</td>
    </tr>`;
}

function _renderPaginacion(hayMas) {
    const el = document.getElementById('aud-pag');
    if (!el) return;
    el.innerHTML = `
    ${_page > 0 ? `<button onclick="window._auditPag(-1)"
      style="padding:7px 18px;border:1.5px solid var(--border);border-radius:9px;background:var(--bg-card);color:var(--text-primary);font-weight:700;cursor:pointer">◀ Anterior</button>` : ''}
    <span style="padding:7px 14px;font-size:13px;color:var(--text-muted);font-weight:600">Página ${_page + 1}</span>
    ${hayMas ? `<button onclick="window._auditPag(1)"
      style="padding:7px 18px;border:1.5px solid var(--border);border-radius:9px;background:var(--bg-card);color:var(--text-primary);font-weight:700;cursor:pointer">Siguiente ▶</button>` : ''}`;
}

// ─── Exportar CSV ──────────────────────────────────────────────────────────
async function _exportCSV() {
    const sb = supabase;
    const email = document.getElementById('aud-fil-email')?.value?.trim();
    const op    = document.getElementById('aud-fil-op')?.value;
    const tabla = document.getElementById('aud-fil-tabla')?.value;
    const desde = document.getElementById('aud-fil-desde')?.value;

    let q = sb.from('v2_audit_resumen').select('fecha_hora_cl,usuario_email,usuario_role,operacion,tabla,descripcion,cama_afectada,registro_id').order('fecha_hora_cl', { ascending: false }).limit(5000);
    if (email) q = q.ilike('usuario_email', `%${email}%`);
    if (op)    q = q.eq('operacion', op);
    if (tabla) q = q.eq('tabla', tabla);
    if (desde) q = q.gte('fecha_hora_cl', desde);

    const { data } = await q;
    if (!data?.length) { alert('Sin datos para exportar'); return; }

    const headers = ['Fecha/Hora','Usuario','Rol','Operacion','Tabla','Descripcion','Cama','ID Registro'];
    const rows = data.map(r => [
        r.fecha_hora_cl, r.usuario_email, r.usuario_role,
        r.operacion, r.tabla, r.descripcion || '', r.cama_afectada || '', r.registro_id || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `auditoria_${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
}
