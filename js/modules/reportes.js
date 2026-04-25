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

    <div class="report-grid">
      <div class="report-card" onclick="window.open('dashboard-resumen.html','_blank')"
           style="border:2px solid #3182ce;background:linear-gradient(135deg,#ebf8ff,#fff);cursor:pointer">
        <div class="report-icon">📈</div>
        <h3>Dashboard Resumen</h3>
        <p>Vista ejecutiva en tiempo real: ocupación, presencia, check-ins y estado del campamento</p>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:10px">
          <span class="badge" style="background:#bee3f8;color:#2b6cb0;font-weight:800">⭐ Nuevo</span>
          <span class="report-arrow">→</span>
        </div>
      </div>
      <div class="report-card" onclick="window.showReportDetail('Reporte de Cobro B2B')">
        <div class="report-icon">💰</div>
        <h3>Reporte de Cobro B2B</h3>
        <p>Cálculo de camas-noche por empresa (Periodo 21 al 20) — exporta a Excel</p>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:10px">
          <span class="badge badge-res">Activo</span>
          <span class="report-arrow">→</span>
        </div>
      </div>
      <div class="report-card" onclick="window.showReportDetail('Reporte por Empresa')">
        <div class="report-icon">🏢</div>
        <h3>Reporte por Empresa</h3>
        <p>Ocupación y costos por empresa colaboradora (B2B)</p>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:10px">
          <span class="badge badge-free">Disponible</span>
          <span class="report-arrow">→</span>
        </div>
      </div>
    </div>

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
