/**
 * v2-buscador.js — Búsqueda de Huéspedes V2
 * Busca en v2_asignaciones por RUT o nombre.
 */
import { getAsignacionesActivas } from '../v2-service.js';

export async function renderV2Buscador(container) {
    container.innerHTML = `<div style="padding:20px;max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">🔍</div>
        <div>
          <h1 style="font-size:22px;font-weight:800;color:var(--text-primary);margin:0">Buscar Huésped V2</h1>
          <p style="font-size:13px;color:var(--text-secondary);margin:0">Busca estadías activas por RUT o nombre completo</p>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
        <input id="buscador-q" type="text" placeholder="🔍 RUT o nombre del huésped…"
          style="flex:1;min-width:220px;padding:14px 18px;border-radius:12px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:15px;outline:none"
          onkeydown="if(event.key==='Enter') document.getElementById('btn-buscar').click()">
        <button id="btn-buscar" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border:none;border-radius:12px;padding:14px 28px;font-size:14px;font-weight:700;cursor:pointer">Buscar</button>
        <button id="btn-ver-todos" style="background:var(--bg-card);color:var(--text-primary);border:1.5px solid var(--border);border-radius:12px;padding:14px 20px;font-size:14px;font-weight:600;cursor:pointer">Ver todos</button>
      </div>

      <div id="buscador-resultados">
        <div style="text-align:center;padding:60px;color:var(--text-muted)">
          <div style="font-size:48px;margin-bottom:12px">🔍</div>
          <div style="font-size:15px">Ingresa un RUT o nombre para buscar estadías activas</div>
        </div>
      </div>
    </div>`;

    document.getElementById('btn-buscar')?.addEventListener('click', () => {
        const q = document.getElementById('buscador-q')?.value?.trim();
        buscar(q);
    });
    document.getElementById('btn-ver-todos')?.addEventListener('click', () => {
        document.getElementById('buscador-q').value = '';
        buscar(null);
    });
}

async function buscar(q) {
    const el = document.getElementById('buscador-resultados');
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">Buscando…</div>`;
    try {
        const data = await getAsignacionesActivas({ busqueda: q, limit: 100 });
        if (!data.length) {
            el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted)">
              <div style="font-size:40px;margin-bottom:12px">🕵️</div>
              <div>${q ? `Sin estadías activas con "${q}"` : 'Sin huéspedes activos en el sistema'}</div>
            </div>`;
            return;
        }

        el.innerHTML = `
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;font-weight:600">${data.length} estadía${data.length>1?'s':''} encontrada${data.length>1?'s':''}</div>
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden;overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;min-width:500px">
              <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
                ${['Huésped','RUT','Cama','Empresa','Turno','Check-in'].map(h =>
                  `<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`
                ).join('')}
              </tr></thead>
              <tbody>
                ${data.map((a, i) => `
                  <tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg)'};transition:background 0.15s" onmouseover="this.style.background='rgba(99,102,241,0.06)'" onmouseout="this.style.background='${i%2===0?'transparent':'var(--bg)'}'">
                    <td style="padding:12px 16px;font-weight:700;font-size:13px;color:var(--text-primary)">${a.nombre_huesped}</td>
                    <td style="padding:12px 16px;font-size:12px;font-family:monospace;color:var(--text-secondary)">${a.rut_huesped}</td>
                    <td style="padding:12px 16px">
                      <span style="background:rgba(99,102,241,0.1);color:#6366f1;font-family:monospace;font-weight:700;font-size:12px;padding:3px 8px;border-radius:6px">${a.id_cama}</span>
                    </td>
                    <td style="padding:12px 16px;font-size:13px;color:var(--text-secondary)">${a.v2_empresas?.nombre||'—'}</td>
                    <td style="padding:12px 16px;font-size:12px;color:var(--text-muted)">${a.v2_empresas?.turno||'—'}</td>
                    <td style="padding:12px 16px;font-size:12px;color:var(--text-muted)">${a.fecha_checkin}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
    } catch(e) {
        el.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444">❌ ${e.message}</div>`;
    }
}
