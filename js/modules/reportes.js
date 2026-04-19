import { getAll } from '../db.js';
import { formatDate } from '../utils.js';

export async function renderReportes(container) {
    const rooms = await getAll('rooms').catch(() => []);
    const census = await getAll('census').catch(() => []);

    container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Reportes <span>e Historial</span></h2>
        <p class="section-subtitle">Análisis y trazabilidad histórica de hasta 12 meses</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window.exportReport()">📥 Exportar Excel</button>
    </div>

    <!-- Report cards -->
    <div class="report-grid">
      ${[
            { icon: '📊', title: 'Reporte de Ocupación', desc: 'Tasas de ocupación diaria, semanal y mensual por pabellón', tag: 'Disponible' },
            { icon: '📋', title: 'Historial de Censos', desc: `${census.length} registros de censos guardados localmente`, tag: 'Disponible' },
            { icon: '👥', title: 'Informe de Trabajadores', desc: 'Listado de trabajadores asignados, empresa y turno', tag: 'Disponible' },
            { icon: '🔒', title: 'Bloqueos y Mantenimiento', desc: 'Historial de bloqueos de habitaciones y camas', tag: 'Disponible' },
            { icon: '💰', title: 'Reporte de Cobro B2B', desc: 'Cálculo de camas-noche por empresa (Periodo 21 al 20)', tag: 'Nuevo' },
            { icon: '🏢', title: 'Reporte por Empresa', desc: 'Ocupación y costos por empresa colaboradora (B2B)', tag: 'Disponible' },
            { icon: '📅', title: 'Reporte Anual', desc: 'Balance anual completo de ocupación y solicitudes', tag: 'Próximamente' },
        ].map(r => `
        <div class="report-card" onclick="window.showReportDetail('${r.title}')">
          <div class="report-icon">${r.icon}</div>
          <h3>${r.title}</h3>
          <p>${r.desc}</p>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:10px">
            <span class="badge ${r.tag === 'Disponible' ? 'badge-free' : r.tag === 'Nuevo' ? 'badge-res' : 'badge-block'}">${r.tag}</span>
            <span class="report-arrow">→</span>
          </div>
        </div>`).join('')}
    </div>

    <!-- Occupancy mini chart -->
    <div class="card mb-4">
      <div class="card-header">
        <h3>📈 Ocupación — Últimos 7 días</h3>
        <select class="form-select" style="max-width:140px;padding:6px 10px;font-size:13px">
          <option>Todos los edificios</option>
          <option>Pabellón A</option>
          <option>Pabellón B</option>
        </select>
      </div>
      <div class="card-body">
        <div style="display:flex;align-items:flex-end;gap:8px;height:140px">
          ${[68, 72, 75, 71, 80, 78, 83].map((v, i) => {
            const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
            return `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%">
                <div style="font-size:11px;color:var(--text-muted)">${v}%</div>
                <div style="flex:1;width:100%;display:flex;align-items:flex-end">
                  <div style="width:100%;height:${v}%;background:var(--grad-red-soft);border-radius:6px 6px 0 0;min-height:4px;transition:height 0.8s ease"></div>
                </div>
                <div style="font-size:11px;color:var(--text-secondary);font-weight:600">${days[i]}</div>
              </div>`;
        }).join('')}
        </div>
      </div>
    </div>

    <!-- Census history table -->
    <div class="card">
      <div class="card-header">
        <h3>📋 Últimos Censos Registrados</h3>
        <span class="badge badge-free">${census.length} registros</span>
      </div>
      <div style="overflow-x:auto">
        <table class="worker-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Habitación</th>
              <th>Cama Día</th>
              <th>Cama Noche</th>
              <th>Notas</th>
              <th>Guardado</th>
            </tr>
          </thead>
          <tbody>
            ${census.length === 0
            ? `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">Sin censos registrados aún</td></tr>`
            : census.slice().reverse().slice(0, 15).map(c => {
                const stateEmoji = { occupied: '🔴', empty: '🟢', belongings: '🟡' };
                return `<tr>
                    <td>${c.date}</td>
                    <td><strong>Hab. ${c.roomId}</strong></td>
                    <td>${stateEmoji[c.dayState] || '—'} ${c.dayState || '—'}</td>
                    <td>${stateEmoji[c.nightState] || '—'} ${c.nightState || '—'}</td>
                    <td style="color:var(--text-secondary);font-size:12px">${c.notes || '—'}</td>
                    <td style="font-size:11px;color:var(--text-muted)">${new Date(c.savedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>`;
            }).join('')
        }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Report detail modal -->
    <div class="modal-overlay" id="report-modal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-header-icon">📊</div>
          <div>
            <h3 style="font-size:16px;font-weight:700" id="report-modal-title">Reporte</h3>
          </div>
          <button class="modal-close btn" onclick="document.getElementById('report-modal').classList.remove('visible')">✕</button>
        </div>
        <div class="modal-body" id="report-modal-body"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('report-modal').classList.remove('visible')">Cerrar</button>
          <button class="btn btn-primary" onclick="window.exportReport()">📥 Exportar Excel Aramark</button>
        </div>
      </div>
    </div>
  `;

    window.showReportDetail = (title) => {
        if (title === 'Reporte de Cobro B2B') {
            renderBillingForm();
            return;
        }
        document.getElementById('report-modal-title').textContent = title;
        document.getElementById('report-modal-body').innerHTML = `
      <div style="text-align:center;padding:24px 0">
        <div style="font-size:48px;margin-bottom:12px">📊</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:8px">${title}</div>
        <div style="font-size:13px;color:var(--text-secondary)">
          El reporte se generará conectando con el backend en producción.<br>
          En modo offline, se usa la data local de IndexedDB.
        </div>
        <div style="margin-top:20px;padding:14px;background:var(--bg-page);border-radius:var(--radius-md);font-size:12px;color:var(--text-secondary)">
          📅 Rango disponible: últimos 12 meses<br>
          💾 ${rooms.length} habitaciones · ${census.length} censos guardados
        </div>
      </div>`;
        document.getElementById('report-modal').classList.add('visible');
    };

    function renderBillingForm() {
        const body = document.getElementById('report-modal-body');
        document.getElementById('report-modal-title').textContent = 'Reporte de Cobro Mensual (21-20)';
        
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        body.innerHTML = `
            <div style="padding:10px">
                <p style="margin-bottom:15px; font-size:13px; color:var(--text-secondary)">
                    Este reporte calcula las <strong>Camas-Noche</strong> por empresa entre el día <strong>21 del mes anterior</strong> y el <strong>20 del mes seleccionado</strong>.
                </p>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Mes Final</label>
                        <select class="form-select" id="billing-month">
                            ${['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => 
                                `<option value="${i+1}" ${i+1 === currentMonth ? 'selected' : ''}>${m}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Año</label>
                        <select class="form-select" id="billing-year">
                            <option value="${currentYear}">${currentYear}</option>
                            <option value="${currentYear-1}">${currentYear-1}</option>
                        </select>
                    </div>
                </div>
                <div style="margin-top:20px; padding:15px; background:var(--bg-page); border-radius:12px; border:1px solid var(--border)">
                    <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px">PERIODO DE CÁLCULO</div>
                    <div id="billing-period-display" style="font-size:14px; font-weight:700; color:var(--red-600)">—</div>
                </div>
            </div>
        `;
        
        const updatePeriod = () => {
            const m = parseInt(document.getElementById('billing-month').value);
            const y = parseInt(document.getElementById('billing-year').value);
            const pm = m === 1 ? 12 : m - 1;
            const py = m === 1 ? y - 1 : y;
            document.getElementById('billing-period-display').textContent = `📅 21/${String(pm).padStart(2,'0')}/${py} al 20/${String(m).padStart(2,'0')}/${y}`;
        };

        document.getElementById('billing-month').onchange = updatePeriod;
        document.getElementById('billing-year').onchange = updatePeriod;
        updatePeriod();
        
        document.getElementById('report-modal').classList.add('visible');
    }

    window.exportReport = async () => {
        const title = document.getElementById('report-modal-title').textContent;
        if (title.includes('Cobro')) {
            await generateBillingExcel();
        } else {
            alert('Función de exportación estándar en mantenimiento. Use el Reporte de Cobro B2B.');
        }
    };

    async function generateBillingExcel() {
        const rooms = await getAll('rooms');
        const m = parseInt(document.getElementById('billing-month').value);
        const y = parseInt(document.getElementById('billing-year').value);
        
        const pm = m === 1 ? 12 : m - 1;
        const py = m === 1 ? y - 1 : y;
        const startDate = new Date(py, pm - 1, 21);
        const endDate = new Date(y, m - 1, 20);

        const billingData = {}; // { company: { totalNights: 0, details: [] } }

        rooms.forEach(r => {
            ['day', 'night'].forEach(bedKey => {
                const bed = r.beds[bedKey];
                if (bed && bed.occupant && bed.arrivalDate && bed.departureDate) {
                    const company = bed.company || 'Sin Empresa';
                    const arr = new Date(bed.arrivalDate);
                    const dep = new Date(bed.departureDate);

                    // Overlap between [arr, dep] and [startDate, endDate]
                    const actualStart = arr > startDate ? arr : startDate;
                    const actualEnd = dep < endDate ? dep : endDate;

                    if (actualStart <= actualEnd) {
                        const nights = Math.ceil((actualEnd - actualStart) / (1000 * 60 * 60 * 24)) + 1;
                        if (!billingData[company]) billingData[company] = { totalNights: 0, details: [] };
                        billingData[company].totalNights += nights;
                        billingData[company].details.push({
                            'TRABAJADOR': bed.occupant,
                            'RUT': bed.rut || 'N/A',
                            'HABITACIÓN': r.number,
                            'TURNO': bedKey === 'day' ? 'Día' : 'Noche',
                            'DESDE': actualStart.toLocaleDateString(),
                            'HASTA': actualEnd.toLocaleDateString(),
                            'NOCHES': nights
                        });
                    }
                }
            });
        });

        if (Object.keys(billingData).length === 0) {
            alert('No hay datos de ocupación para el periodo seleccionado.');
            return;
        }

        // SheetJS generation
        const wb = XLSX.utils.book_new();
        
        // Consolidated Summary
        const summary = Object.keys(billingData).map(c => ({
            'EMPRESA': c,
            'TOTAL CAMAS-NOCHE': billingData[c].totalNights,
            'VALOR UNITARIO': '$0',
            'TOTAL A COBRAR': '$0'
        }));
        const wsSummary = XLSX.utils.json_to_sheet(summary);
        XLSX.utils.book_append_sheet(wb, wsSummary, "RESUMEN CONSOLIDADO");

        // Details per company
        Object.keys(billingData).forEach(c => {
            const wsDetail = XLSX.utils.json_to_sheet(billingData[c].details);
            XLSX.utils.book_append_sheet(wb, wsDetail, c.substring(0, 31));
        });

        XLSX.writeFile(wb, `Reporte_Cobro_Aramark_${y}_${m}.xlsx`);
        showToast('Excel generado correctamente', 'success');
        document.getElementById('report-modal').classList.remove('visible');
    }
}
