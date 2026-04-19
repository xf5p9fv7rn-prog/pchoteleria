import { getAll, getById } from '../db.js';
import { showToast, toChileanDate, formatDate } from '../utils.js';

export async function renderAsistencia(container) {
    const todayStr = formatDate(new Date());

    const [rooms, buildings, censos] = await Promise.all([
        getAll('rooms').catch(() => []),
        getAll('buildings').catch(() => []),
        getAll('census').catch(() => [])
    ]);

    // Find the latest census entries for today (if any)
    const todayCensuses = censos.filter(c => c.date === todayStr);
    
    // Create a fast lookup map for today's census results by roomId
    const censusMap = {};
    todayCensuses.forEach(c => {
        if (!censusMap[c.roomId]) censusMap[c.roomId] = { dayCnt: 0, nightCnt: 0 };
        censusMap[c.roomId].dayCnt += parseInt(c.dayOccupied || 0);
        censusMap[c.roomId].nightCnt += parseInt(c.nightOccupied || 0);
    });

    let totalAssigned = 0;
    let totalPresent = 0;
    let totalAbsent = 0;

    let alertsHtml = '';
    let rowsHtml = '';

    const getBuildingName = (id) => {
        const b = buildings.find(x => x.id === id);
        return b ? b.name : 'Desconocido';
    };

    // Sort rooms to be nice
    rooms.sort((a,b) => String(a.number).localeCompare(String(b.number), undefined, {numeric:true}));

    rooms.forEach(r => {
        let assignedInRoom = 0;
        let presentInRoom = 0;
        let occupants = [];

        ['day', 'night'].forEach(shift => {
            const bed = r.beds && r.beds[shift];
            if (bed && bed.occupant) {
                assignedInRoom++;
                totalAssigned++;
                if (bed.present) {
                    presentInRoom++;
                    totalPresent++;
                    occupants.push({ name: bed.occupant, shift, present: true });
                } else {
                    totalAbsent++;
                    occupants.push({ name: bed.occupant, shift, present: false });
                }
            }
        });

        if (assignedInRoom > 0) {
            const censusRec = censusMap[r.id] || { dayCnt: 0, nightCnt: 0 };
            const totalCensusFound = censusRec.dayCnt + censusRec.nightCnt;

            let hasMismatch = false;
            let mismatchMessage = '';
            
            // Si el censo encontró menos personas de las asignadas, o si el número de censados no cuadra con los presentes
            // Note: If no census is performed yet today, the totalCensusFound is 0. 
            // We should only alert if a census entry was actually submitted for this room today.
            const censusWasSubmitted = !!censusMap[r.id];

            if (censusWasSubmitted && totalCensusFound !== assignedInRoom) {
                hasMismatch = true;
                mismatchMessage = `Asignados: ${assignedInRoom} · Censados: ${totalCensusFound}`;
            }

            if (hasMismatch) {
                alertsHtml += `
                  <div style="background:var(--red-50); border:1px solid var(--red-200); border-radius:12px; padding:16px; margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <div style="font-weight:800; color:var(--red-700); display:flex; align-items:center; gap:8px;">
                                ⚠️ Habitación ${r.number} (${getBuildingName(r.buildingId)})
                            </div>
                            <div style="font-size:13px; color:var(--red-800); margin-top:4px;">
                                ${mismatchMessage}. Posible "Habitación Fantasma" o trabajador ausente.
                            </div>
                        </div>
                    </div>
                    <div style="font-size:12px; color:var(--red-600); margin-top:8px; font-weight:600;">
                        ${occupants.map(o => `${o.present ? '🟢' : '🔴'} ${o.name}`).join(' | ')}
                    </div>
                  </div>
                `;
            }

            // Draw row
            rowsHtml += `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--border); ${hasMismatch?'background:#fff5f5;':''}">
                <div style="flex:1;">
                    <strong style="font-size:14px; color:var(--text-primary);">Hab. ${r.number}</strong>
                    <span style="font-size:11px; color:var(--text-muted); margin-left:8px;">${getBuildingName(r.buildingId)}</span>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:6px; display:flex; flex-direction:column; gap:4px;">
                        ${occupants.map(o => `
                            <div>${o.present ? '🟢' : '🔴'} <span style="${o.present ? 'color:#276749; font-weight:600;' : 'opacity:0.7;'}">${o.name} <small>(${o.shift==='day'?'Día':'Noche'})</small></span></div>
                        `).join('')}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:11px; font-weight:700; color:${hasMismatch?'var(--red-600)':'var(--text-muted)'}; margin-bottom:4px;">Censo: ${censusWasSubmitted ? totalCensusFound : '?'}</div>
                    <span class="badge ${assignedInRoom === presentInRoom ? 'badge-reserved' : 'badge-occupied'}" style="${assignedInRoom === presentInRoom ? 'background:#c6f6d5;color:#22543d;' : 'background:#fed7d7;color:#822727;'}">
                        ${presentInRoom}/${assignedInRoom} presentes
                    </span>
                </div>
              </div>
            `;
        }
    });

    const occPct = totalAssigned ? Math.round((totalPresent / totalAssigned) * 100) : 0;

    container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Control de <span>Asistencia</span></h2>
        <p class="section-subtitle">Monitoreo de llegadas y alertas del censo cruzado · ${toChileanDate(todayStr)}</p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window.refreshAsistencia()">
        🔄 Recargar
      </button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card" style="border-top:4px solid #3182ce;">
        <div class="kpi-icon blue">👥</div>
        <div class="kpi-value" style="color:#2b6cb0;">${totalAssigned}</div>
        <div class="kpi-label">Total Asignados</div>
        <div class="kpi-change">Ocupación real</div>
      </div>
      <div class="kpi-card" style="border-top:4px solid #38a169;">
        <div class="kpi-icon green">🟢</div>
        <div class="kpi-value" style="color:#276749;">${totalPresent}</div>
        <div class="kpi-label">Presentes en Campamento</div>
        <div class="kpi-change up">${occPct}% de asistencia</div>
      </div>
      <div class="kpi-card" style="border-top:4px solid #e53e3e;">
        <div class="kpi-icon red">🔴</div>
        <div class="kpi-value" style="color:#c53030;">${totalAbsent}</div>
        <div class="kpi-label">Faltan por Llegar</div>
        <div class="kpi-change down">Requieran consulta</div>
      </div>
    </div>

    ${alertsHtml ? `
    <div class="card mb-4" style="border:2px solid var(--red-300);">
        <div class="card-header" style="background:var(--red-50); border-bottom:1px solid var(--red-100);">
            <h3 style="color:var(--red-800);">⚠️ Alertas Críticas de Inconsistencia (Censo vs Asignaciones)</h3>
        </div>
        <div class="card-body" style="padding:16px;">
            <p style="font-size:12px; color:var(--red-700); margin-bottom:16px;">Las siguientes habitaciones arrojaron diferencias entre el personal asignado en sistema y las personas físicas encontradas por las mucamas hoy.</p>
            ${alertsHtml}
        </div>
    </div>
    ` : `
    <div class="card mb-4" style="background:#f0fff4; border:1px solid #c6f6d5;">
        <div class="card-body" style="text-align:center; color:#276749; font-weight:600;">
            ✅ No hay inconsistencias detectadas con el censo del día de hoy.
        </div>
    </div>
    `}

    <div class="card mb-4">
        <div class="card-header">
            <h3>Listado Detallado de Asistencia</h3>
        </div>
        <div class="card-body" style="padding:0">
            ${rowsHtml || '<div style="padding:20px; text-align:center; color:var(--text-muted);">No hay huéspedes asignados hoy.</div>'}
        </div>
    </div>
    `;

    window.refreshAsistencia = () => {
        container.style.opacity = '0.5';
        renderAsistencia(container).then(() => {
            container.style.opacity = '1';
            showToast('Asistencia actualizada', 'success');
        });
    };
}
