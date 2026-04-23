import { getAll, confirmCheckout, getExpiredBeds } from '../db.js';
import { showToast, formatDate, toChileanDate } from '../utils.js';

export async function renderDashboard(container) {
    const [buildings, rooms, expiredBeds, quotas] = await Promise.all([
        getAll('buildings').catch(() => []),
        getAll('rooms').catch(() => []),
        (window.__getExpiredBeds || getExpiredBeds)().catch(() => []),
        getAll('gerencia_quotas').catch(() => []),
    ]);

    // Map buildingId → name for alerts section
    const buildMap = Object.fromEntries(buildings.map(b => [b.id, b.name]));

    const free = rooms.filter(r => r.status === 'free').length;
    const occupied = rooms.filter(r => r.status === 'occupied').length;
    const reserved = rooms.filter(r => r.status === 'reserved').length;
    const blocked = rooms.filter(r => r.status === 'blocked' || r.status === 'bed-blocked').length;
    const total = rooms.length;
    const occPct = total ? Math.round((occupied / total) * 100) : 0;

    // Contar camas individuales ocupadas (da el total real de huéspedes)
    let totalWorkers = 0;
    rooms.forEach(r => {
        ['day', 'night', 'extra'].forEach(k => {
            if (r.beds?.[k]?.occupant) totalWorkers++;
        });
    });

    // Normalizar nombre de empresa: Title Case para agrupar sin importar mayúsculas
    const normalizeCompany = (name) => {
        if (!name) return 'Sin Empresa';
        return name.trim().toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());
    };

    // Estadísticas por empresa: contar todas las camas (día, noche, extra)
    const companyStats = {};
    const checkoutsByDate = {};
    const totalBeds = rooms.reduce((s, r) => s + (r.bedCount || 2), 0);

    rooms.forEach(r => {
        ['day', 'night', 'extra'].forEach(shift => {
            const bed = r.beds && r.beds[shift];
            if (bed && bed.occupant && bed.company) {
                const cName = normalizeCompany(bed.company);
                if (!companyStats[cName]) companyStats[cName] = { beds: 0, workers: 0 };
                companyStats[cName].beds++;
                companyStats[cName].workers++;
            }
            if (bed && bed.occupant && bed.departureDate) {
                const dDate = bed.departureDate;
                const company = normalizeCompany(bed.company || r.reservedCompany || 'Sin Empresa');
                if (!checkoutsByDate[dDate]) checkoutsByDate[dDate] = { totalPeople: 0, byCompany: {} };
                checkoutsByDate[dDate].totalPeople++;
                if (!checkoutsByDate[dDate].byCompany[company]) checkoutsByDate[dDate].byCompany[company] = { people: 0, rooms: new Set() };
                checkoutsByDate[dDate].byCompany[company].people++;
                checkoutsByDate[dDate].byCompany[company].rooms.add(r.number);
            }
        });
    });
    const sortedCompanies = Object.entries(companyStats).sort((a, b) => b[1].beds - a[1].beds);
    const maxCompanyBeds = sortedCompanies.length > 0 ? sortedCompanies[0][1].beds : 1;

    // ── Helper: detectar si una habitación es de turno NOCHE ─────────────────
    // Una habitación es "de noche" si su pabellón fue reservado con turno Noche.
    // La detección es flexible: acepta "Noche", "noche", "NOCHE", "Night", etc.
    const isNocheRoom = (r) => r.reservedShift && /noche|night/i.test(r.reservedShift);
    const is4x3Room   = (r) => r.reservedShift === '4x3';

    // ── Camas por turno Día / Noche / Extra / 4x3 ────────────────────────────
    // REGLA: Noche = pabellón reservado "Noche" | 4x3 = hab. marcada "4x3"
    //        Día   = todo lo demás
    let totalDia = 0, usadaDia = 0;
    let totalNoche = 0, usadaNoche = 0;
    let totalExtra = 0, usadaExtra = 0;
    let total4x3 = 0, usado4x3 = 0;
    rooms.forEach(r => {
        const cap = r.bedCount || 2;
        const esNoche = isNocheRoom(r);
        const es4x3   = is4x3Room(r);

        // Cama extra (C) — siempre se cuenta aparte
        if (cap >= 3) {
            totalExtra++;
            if (r.beds?.extra?.occupant) usadaExtra++;
        }

        // Camas A y B: clasificar según tipo
        const mainBeds = Math.min(cap, 2);
        const mainOcupadas = ['day','night'].filter(k => r.beds?.[k]?.occupant).length;

        if (esNoche) {
            totalNoche  += mainBeds;
            usadaNoche  += Math.min(mainOcupadas, mainBeds);
        } else if (es4x3) {
            total4x3    += mainBeds;
            usado4x3    += Math.min(mainOcupadas, mainBeds);
        } else {
            totalDia    += mainBeds;
            usadaDia    += Math.min(mainOcupadas, mainBeds);
        }
    });
    const libreDia   = totalDia   - usadaDia;
    const libreNoche = totalNoche - usadaNoche;
    const libreExtra = totalExtra - usadaExtra;
    const libre4x3   = total4x3   - usado4x3;
    const pctDia   = totalDia   > 0 ? Math.round((usadaDia   / totalDia)   * 100) : 0;
    const pctNoche = totalNoche > 0 ? Math.round((usadaNoche / totalNoche) * 100) : 0;
    const pct4x3   = total4x3   > 0 ? Math.round((usado4x3   / total4x3)   * 100) : 0;

    // ── Cupos por Gerencia ───────────────────────────────────────────────────
    const usageGer = {};
    rooms.forEach(r => {
        ['day', 'night', 'extra'].forEach(bk => {
            const bed = r.beds?.[bk];
            if (!bed?.occupant) return;
            const company  = (bed.company  || '').trim().toLowerCase();
            const gerencia = (bed.management || bed.gerencia || '').trim().toLowerCase();
            if (!gerencia) return;
            const key = `${company}||${gerencia}`;
            usageGer[key] = (usageGer[key] || 0) + 1;
        });
    });
    const gerenciasSet = new Set();
    rooms.forEach(r => {
        ['day','night','extra'].forEach(bk => {
            const bed = r.beds?.[bk];
            if (!bed?.occupant) return;
            const c = (bed.company||'').trim(), g = (bed.management||bed.gerencia||'').trim();
            if (c && g) gerenciasSet.add(`${c}||${g}`);
        });
    });
    quotas.forEach(q => { if (q.company && q.gerencia) gerenciasSet.add(`${q.company}||${q.gerencia}`); });
    const quotaMap = {};
    quotas.forEach(q => {
        const key = `${(q.company||'').trim().toLowerCase()}||${(q.gerencia||'').trim().toLowerCase()}`;
        quotaMap[key] = q;
    });
    const sortedGerencias = [...gerenciasSet].sort();

    const sortedCheckouts = Object.keys(checkoutsByDate).sort().map(date => {
        const companiesInfo = Object.entries(checkoutsByDate[date].byCompany).map(([company, data]) => ({
            company, people: data.people, rooms: Array.from(data.rooms).sort()
        })).sort((a, b) => b.people - a.people);
        let totalRoomsSet = new Set();
        companiesInfo.forEach(c => c.rooms.forEach(rm => totalRoomsSet.add(rm)));
        return { date, totalPeople: checkoutsByDate[date].totalPeople, totalRooms: totalRoomsSet.size, companies: companiesInfo };
    });

    // ── Separar alertas: hoy y vencidas ──
    const todayStr = new Date().toLocaleDateString('en-CA');
    const alertasHoy = expiredBeds.filter(e => e.departureDate === todayStr);
    const alertasVencidas = expiredBeds.filter(e => e.departureDate < todayStr);

    // ── HTML de la sección de alertas ──
    const renderAlertRow = (e) => {
        const label = e.isOverdue
            ? `<span style="background:#fed7d7;color:#c53030;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;margin-right:6px">VENCIDA</span>`
            : `<span style="background:#fefcbf;color:#744210;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;margin-right:6px">HOY</span>`;
        const [y, m, d] = e.departureDate.split('-');
        const pabellon = buildMap[e.buildingId] || `Edificio ${e.buildingId}`;
        return `
        <div class="dash-alert-row" id="alert-row-${e.roomId}-${e.bedKey}">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
                <div style="width:36px;height:36px;border-radius:10px;background:${e.isOverdue ? 'linear-gradient(135deg,#c53030,#e53e3e)' : 'linear-gradient(135deg,#d69e2e,#f6e05e)'};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">
                    ${e.isOverdue ? '🔴' : '⏰'}
                </div>
                <div style="min-width:0">
                    <div style="font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.occupant}</div>
                    <div style="font-size:11px;color:var(--text-secondary)">${label}Hab. ${e.roomNumber} · ${pabellon} · ${e.company} · Sale: ${d}/${m}/${y}</div>
                </div>
            </div>
            <button class="btn btn-primary btn-sm dash-checkout-btn"
                style="background:#276749;border-color:#276749;white-space:nowrap;flex-shrink:0"
                onclick="window.dashConfirmCheckout('${e.roomId}','${e.bedKey}')">
                ✅ Confirmar Salida
            </button>
        </div>`;
    };

    const alertsHTML = expiredBeds.length === 0 ? '' : `
    <div class="card mb-4" style="border:2px solid ${alertasVencidas.length > 0 ? '#fc8181' : '#f6e05e'};box-shadow:0 4px 20px rgba(${alertasVencidas.length > 0 ? '197,48,48' : '214,158,46'},0.15)">
        <div class="card-header" style="background:${alertasVencidas.length > 0 ? 'linear-gradient(135deg,#fff5f5,#fed7d7)' : 'linear-gradient(135deg,#fffff0,#fefcbf)'}">
            <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:20px">${alertasVencidas.length > 0 ? '🚨' : '⏰'}</span>
                <div>
                    <h3 style="margin:0;color:${alertasVencidas.length > 0 ? '#c53030' : '#744210'}">Alertas de Salida</h3>
                    <p style="margin:0;font-size:11px;color:var(--text-secondary)">
                        ${alertasVencidas.length > 0 ? `${alertasVencidas.length} vencida${alertasVencidas.length !== 1 ? 's' : ''} · ` : ''}${alertasHoy.length > 0 ? `${alertasHoy.length} salen hoy` : ''}
                    </p>
                </div>
            </div>
            ${expiredBeds.length > 1 ? `
            <button class="btn btn-sm" style="background:#c53030;color:white;border:none;font-weight:700"
                onclick="window.dashConfirmAllCheckouts()">
                ✅ Confirmar Todas las Salidas
            </button>` : ''}
        </div>
        <div class="card-body" style="padding:0;display:flex;flex-direction:column;gap:0">
            <style>
                .dash-alert-row { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--border);transition:background 0.15s; }
                .dash-alert-row:last-child { border-bottom:none; }
                .dash-alert-row:hover { background:#fafafa; }
                .dash-checkout-btn:hover { background:#276749 !important;transform:scale(1.02); }
            </style>
            ${alertasVencidas.map(renderAlertRow).join('')}
            ${alertasHoy.map(renderAlertRow).join('')}
        </div>
    </div>`;

    container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Panel <span>Principal</span></h2>
        <p class="section-subtitle">Resumen general del sistema · ${toChileanDate(new Date().toISOString().split('T')[0])}</p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window.refreshDashboard()">
        🔄 Actualizar
      </button>
    </div>

    ${alertsHTML}

    <!-- KPIs -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon red">🏠</div>
        <div class="kpi-value">${total}</div>
        <div class="kpi-label">Total Habitaciones</div>
        <div class="kpi-change">${buildings.length} pabellones/edificios</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon red">🔴</div>
        <div class="kpi-value" style="color:var(--red-600)">${occupied}</div>
        <div class="kpi-label">Ocupadas</div>
        <div class="kpi-change down">${occPct}% de ocupación</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green">🟢</div>
        <div class="kpi-value" style="color:#276749">${free}</div>
        <div class="kpi-label">Disponibles</div>
        <div class="kpi-change up">${total ? Math.round((free / total) * 100) : 0}% libre</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon yellow">🟡</div>
        <div class="kpi-value" style="color:#92400e">${reserved}</div>
        <div class="kpi-label">Reservadas</div>
        <div class="kpi-change">Para llegadas inminentes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon blue">🔒</div>
        <div class="kpi-value" style="color:#2b6cb0">${blocked}</div>
        <div class="kpi-label">Bloqueadas</div>
        <div class="kpi-change">Total/Parcial</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple">👥</div>
        <div style="font-size:28px;font-weight:900;color:var(--text-primary)">${totalWorkers}</div>
        <div class="kpi-label">Trabajadores Alojados</div>
        <div class="kpi-change up">camas reales ocupadas</div>
      </div>
    </div>

    <!-- Occupancy bar -->
    <div class="card mb-4">
      <div class="card-header">
        <h3>Ocupación General</h3>
        <span class="badge" style="background:var(--red-50);color:var(--red-700);border:1px solid var(--red-200)">${occPct}%</span>
      </div>
      <div class="card-body">
        <div style="height:12px;background:var(--border);border-radius:6px;overflow:hidden;margin-bottom:12px">
          <div style="width:${occPct}%;height:100%;background:var(--grad-red);border-radius:6px;transition:width 1s ease"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center">
          <div>
            <div style="font-size:18px;font-weight:800;color:var(--red-600)">${occupied}</div>
            <div style="font-size:11px;color:var(--text-secondary)">Ocupadas</div>
          </div>
          <div>
            <div style="font-size:18px;font-weight:800;color:#276749">${free}</div>
            <div style="font-size:11px;color:var(--text-secondary)">Libres</div>
          </div>
          <div>
            <div style="font-size:18px;font-weight:800;color:#92400e">${reserved}</div>
            <div style="font-size:11px;color:var(--text-secondary)">Reservadas</div>
          </div>
          <div>
            <div style="font-size:18px;font-weight:800;color:#2b6cb0">${blocked}</div>
            <div style="font-size:11px;color:var(--text-secondary)">Bloqueadas</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Proyecciones de Salida -->
    <div class="card mb-4">
      <div class="card-header">
        <h3>Proyecciones de Salidas</h3>
        <span class="badge" style="background:var(--red-50);color:var(--red-700);border:1px solid var(--red-200)">Por Día</span>
      </div>
      <div class="card-body" style="padding:0">
        ${sortedCheckouts.length === 0
            ? `<div style="padding:24px;text-align:center;color:var(--text-muted)">No hay salidas programadas</div>`
            : sortedCheckouts.map(item => `
              <div style="padding:14px 20px;border-bottom:1px solid var(--border)">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:32px;height:32px;border-radius:8px;background:var(--red-50);color:var(--red-600);display:flex;align-items:center;justify-content:center;font-size:14px">📅</div>
                        <div style="font-size:15px;font-weight:700">${toChileanDate(item.date)}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:16px;font-weight:800;color:var(--red-600)">${item.totalRooms} hab totales</div>
                        <div style="font-size:11px;color:var(--text-secondary)">${item.totalPeople} personas</div>
                    </div>
                </div>
                ${item.companies.map(c => `
                  <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <strong style="font-size:13px;color:var(--text-primary)">🏢 ${c.company}</strong>
                        <span style="font-size:11px;color:var(--text-secondary)">${c.rooms.length} hab / ${c.people} pers.</span>
                    </div>
                    <div style="font-size:12px;display:flex;flex-wrap:wrap;gap:4px">
                         ${c.rooms.map(r => `<span style="background:var(--red-50);color:var(--red-800);border:1px solid var(--red-200);border-radius:4px;padding:2px 6px;font-weight:600">${r}</span>`).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
            `).join('')
        }
      </div>
    </div>

    <!-- Buildings summary -->
    <div class="card mb-4">
      <div class="card-header"><h3>Pabellones y Edificios</h3></div>
      <div class="card-body" style="padding:0">
        ${buildings.length === 0
            ? `<div style="padding:24px;text-align:center;color:var(--text-muted)">No hay edificios registrados</div>`
            : buildings.map(b => {
                const bRooms = rooms.filter(r => r.buildingId === b.id);
                const bOcc = bRooms.filter(r => r.status === 'occupied').length;
                const bPct = bRooms.length ? Math.round((bOcc / bRooms.length) * 100) : 0;
                return `
              <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border)">
                <div style="width:40px;height:40px;border-radius:10px;background:var(--grad-red);display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;flex-shrink:0">🏢</div>
                <div style="flex:1">
                  <div style="font-weight:700;font-size:14px">${b.name}</div>
                  <div style="font-size:12px;color:var(--text-secondary)">${bRooms.length} hab. · Turnos: ${(b.shifts || []).join(', ')}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:18px;font-weight:800;color:var(--red-600)">${bPct}%</div>
                  <div style="font-size:11px;color:var(--text-secondary)">${bOcc}/${bRooms.length} occ.</div>
                </div>
              </div>`;
            }).join('')
        }
      </div>
    </div>

    <!-- Company occupancy -->
    <div class="card mb-4">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:8px">
          <h3 style="margin:0">Ocupación por Empresa</h3>
        </div>
        <span class="badge badge-free" style="font-size:11px;padding:4px 10px">${sortedCompanies.length} empresa${sortedCompanies.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:14px;">
        ${sortedCompanies.length === 0
            ? `<div style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">Sin datos de ocupación por empresa</div>`
            : sortedCompanies.map(([name, stats], idx) => {
                const pct = Math.round((stats.beds / Math.max(maxCompanyBeds, 1)) * 100);
                const colors = [
                    { bg: 'linear-gradient(135deg,#c53030,#e53e3e)', light: '#fff5f5', border: '#fc8181', text: '#c53030' },
                    { bg: 'linear-gradient(135deg,#2b6cb0,#3182ce)', light: '#ebf8ff', border: '#90cdf4', text: '#2b6cb0' },
                    { bg: 'linear-gradient(135deg,#276749,#38a169)', light: '#f0fff4', border: '#9ae6b4', text: '#276749' },
                    { bg: 'linear-gradient(135deg,#744210,#d69e2e)', light: '#fffff0', border: '#faf089', text: '#744210' },
                    { bg: 'linear-gradient(135deg,#553c9a,#805ad5)', light: '#faf5ff', border: '#d6bcfa', text: '#553c9a' },
                ];
                const c = colors[idx % colors.length];
                const initial = name.substring(0, 2).toUpperCase();
                return `
                <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:${c.light};border:1px solid ${c.border};border-radius:14px;transition:transform 0.15s ease" onmouseover="this.style.transform='translateX(4px)'" onmouseout="this.style.transform='none'">
                  <div style="width:44px;height:44px;border-radius:12px;background:${c.bg};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:#fff;flex-shrink:0;box-shadow:0 4px 12px rgba(0,0,0,0.15);letter-spacing:0.5px">${initial}</div>
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                      <div style="font-weight:800;font-size:14px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
                      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:12px">
                        <span style="font-size:18px;font-weight:900;color:${c.text}">${stats.beds}</span>
                        <span style="font-size:10px;color:var(--text-secondary);line-height:1.2;text-align:right">camas<br>activas</span>
                      </div>
                    </div>
                    <div style="height:6px;background:rgba(0,0,0,0.08);border-radius:99px;overflow:hidden">
                      <div style="height:100%;width:${pct}%;background:${c.bg};border-radius:99px;transition:width 0.6s ease"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-top:5px">
                      <span style="font-size:10px;color:var(--text-secondary)">👷 ${stats.workers} trabajadores alojados</span>
                      <span style="font-size:10px;font-weight:700;color:${c.text}">${pct}% del total</span>
                    </div>
                  </div>
                </div>
                `;
            }).join('')
        }
      </div>
    </div>


    <!-- Buscador rápido de habitación -->
    <div class="card mb-4" style="border:1.5px solid #e2e8f0">
      <div class="card-header" style="background:linear-gradient(135deg,#f0fff4,#dcfce7)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">🔍</span>
          <h3 style="margin:0;color:#166534">Buscar Habitación</h3>
        </div>
      </div>
      <div class="card-body">
        <div style="display:flex;gap:10px;align-items:center">
          <input id="dash-room-search" type="text" placeholder="Ej: 2223, hab 102…" class="form-input" style="flex:1;"
            oninput="window.dashRoomSearch()" onkeydown="if(event.key==='Enter') window.dashRoomSearch()">
          <button class="btn btn-primary" onclick="window.dashRoomSearch()" style="white-space:nowrap">🔍 Buscar</button>
        </div>
        <div id="dash-room-result" style="margin-top:14px"></div>
      </div>
    </div>

    <!-- Camas por Turno Día / Noche -->
    <div class="card mb-4" style="border:1.5px solid #ddd6fe">
      <div class="card-header" style="background:linear-gradient(135deg,#faf5ff,#ede9fe)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">☀️🌙</span>
          <h3 style="margin:0;color:#6d28d9">Camas por Turno</h3>
        </div>
        <span class="badge" style="background:#ede9fe;color:#6d28d9;border:1px solid #ddd6fe">Día · Noche</span>
      </div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px">
          <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:14px;text-align:center">
            <div style="font-size:22px;margin-bottom:4px">☀️</div>
            <div style="font-size:28px;font-weight:900;color:#b45309">${libreDia}<span style="font-size:14px;opacity:.6">/${totalDia}</span></div>
            <div style="font-size:11px;font-weight:700;color:#92400e">Camas Día libres</div>
            <div style="margin-top:8px;height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${pctDia}%;background:#d97706;border-radius:99px;transition:width 0.8s ease"></div>
            </div>
            <div style="font-size:10px;color:#b45309;margin-top:3px">${pctDia}% ocupado</div>
          </div>
          <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:14px;padding:14px;text-align:center">
            <div style="font-size:22px;margin-bottom:4px">🌙</div>
            <div style="font-size:28px;font-weight:900;color:#1d4ed8">${libreNoche}<span style="font-size:14px;opacity:.6">/${totalNoche}</span></div>
            <div style="font-size:11px;font-weight:700;color:#1e40af">Camas Noche libres</div>
            <div style="margin-top:8px;height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${pctNoche}%;background:#2563eb;border-radius:99px;transition:width 0.8s ease"></div>
            </div>
            <div style="font-size:10px;color:#1d4ed8;margin-top:3px">${pctNoche}% ocupado</div>
          </div>
          ${totalExtra > 0 ? `
          <div style="background:#faf5ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;text-align:center">
            <div style="font-size:22px;margin-bottom:4px">⭐</div>
            <div style="font-size:28px;font-weight:900;color:#7c3aed">${libreExtra}<span style="font-size:14px;opacity:.6">/${totalExtra}</span></div>
            <div style="font-size:11px;font-weight:700;color:#6d28d9">Camas Extra libres</div>
          </div>` : ''}
          ${total4x3 > 0 ? `
          <div style="background:#fdf4ff;border:1.5px solid #e9d5ff;border-radius:14px;padding:14px;text-align:center">
            <div style="font-size:22px;margin-bottom:4px">4️⃣</div>
            <div style="font-size:28px;font-weight:900;color:#7e22ce">${libre4x3}<span style="font-size:14px;opacity:.6">/${total4x3}</span></div>
            <div style="font-size:11px;font-weight:700;color:#6b21a8">Camas 4x3 libres</div>
            <div style="margin-top:8px;height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${pct4x3}%;background:#7c3aed;border-radius:99px;transition:width 0.8s ease"></div>
            </div>
            <div style="font-size:10px;color:#7e22ce;margin-top:3px">${pct4x3}% ocupado</div>
          </div>` : ''}
        </div>
      </div>
    </div>

    <!-- Cupos por Gerencia -->
    ${sortedGerencias.length > 0 ? `
    <div class="card mb-4" style="border:1.5px solid #bfdbfe">
      <div class="card-header" style="background:linear-gradient(135deg,#eff6ff,#dbeafe)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">🎯</span>
          <h3 style="margin:0;color:#1d4ed8">Cupos por Gerencia</h3>
        </div>
        <span class="badge" style="background:#dbeafe;color:#1d4ed8;border:1px solid #bfdbfe">${sortedGerencias.length} gerencias</span>
      </div>
      <div class="card-body" style="padding:0">
        ${sortedGerencias.map(fullKey => {
            const [company, gerencia] = fullKey.split('||');
            const lookupKey = `${company.toLowerCase()}||${gerencia.toLowerCase()}`;
            const quota = quotaMap[lookupKey];
            const usado = usageGer[lookupKey] || 0;
            const limite = quota?.limit ?? null;
            const disp = limite !== null ? Math.max(0, limite - usado) : null;
            const pct  = limite !== null ? Math.min(100, Math.round((usado / limite) * 100)) : 0;
            const barColor = pct >= 100 ? '#e53e3e' : pct >= 80 ? '#dd6b20' : '#38a169';
            const bgRow   = pct >= 100 ? '#fff5f5' : pct >= 80 ? '#fffbeb' : '#f0fff4';
            const txtColor = pct >= 100 ? '#c0392b' : pct >= 80 ? '#92400e' : '#16a34a';
            const dot = pct >= 100 ? '🔴' : pct >= 80 ? '🟠' : '🟢';
            return `
            <div style="display:flex;align-items:center;gap:14px;padding:14px 20px;
                        border-bottom:1px solid var(--border);background:${bgRow}">
              <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);
                          display:flex;align-items:center;justify-content:center;font-size:16px;
                          color:#fff;flex-shrink:0;font-weight:900">
                ${gerencia.charAt(0).toUpperCase()}
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <div>
                    <div style="font-weight:800;font-size:13px;color:#1a202c">${gerencia}</div>
                    <div style="font-size:11px;color:#64748b">${company}</div>
                  </div>
                  <div style="text-align:right;flex-shrink:0;margin-left:12px">
                    <div style="font-size:18px;font-weight:900;color:${txtColor}">${usado}${limite !== null ? `<span style="font-size:12px;opacity:.6">/${limite}</span>` : ''}</div>
                    <div style="font-size:10px;color:${txtColor}">${dot} ${disp !== null ? disp + ' disponibles' : 'Sin límite'}</div>
                  </div>
                </div>
                ${limite !== null ? `
                <div style="height:6px;background:rgba(0,0,0,0.07);border-radius:99px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${barColor};border-radius:99px;transition:width 0.8s ease"></div>
                </div>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>` : ''}

  `;

    // ── Handlers de checkout desde Dashboard ──
    window.dashConfirmCheckout = async (roomId, bedKey) => {
        const btn = document.getElementById(`alert-row-${roomId}-${bedKey}`)?.querySelector('.dash-checkout-btn');
        if (btn) { btn.textContent = '⏳ Procesando...'; btn.disabled = true; }

        const ok = await (window.__confirmCheckout || confirmCheckout)(roomId, bedKey);
        if (ok) {
            document.getElementById(`alert-row-${roomId}-${bedKey}`)?.remove();
            showToast('✅ Salida confirmada — cama disponible para nuevo ocupante', 'success');
            // Si no quedan más alertas, quitar la tarjeta entera
            if (document.querySelectorAll('.dash-alert-row').length === 0) {
                document.querySelector('.card[style*="border:2px solid"]')?.remove();
            }
        } else {
            showToast('Error al confirmar salida', 'error');
            if (btn) { btn.textContent = '✅ Confirmar Salida'; btn.disabled = false; }
        }
    };

    window.dashConfirmAllCheckouts = async () => {
        if (!confirm(`⚠️ ¿Confirmar la salida de TODOS los trabajadores con fecha vencida? Las camas quedarán libres para nuevos ingresos.`)) return;
        const rows = document.querySelectorAll('.dash-alert-row');
        let count = 0;
        for (const row of rows) {
            const id = row.id; // "alert-row-ROOMID-BEDKEY"
            const parts = id.replace('alert-row-', '').split('-');
            const bedKey = parts.pop();
            const roomId = parts.join('-');
            const ok = await (window.__confirmCheckout || confirmCheckout)(roomId, bedKey);
            if (ok) { row.remove(); count++; }
        }
        showToast(`✅ ${count} salida${count !== 1 ? 's' : ''} confirmada${count !== 1 ? 's' : ''} — camas disponibles`, 'success');
        if (document.querySelectorAll('.dash-alert-row').length === 0) {
            document.querySelector('.card[style*="border:2px solid"]')?.remove();
        }
    };

    window.refreshDashboard = () => renderDashboard(container).then(() => showToast('Dashboard actualizado', 'success'));

    // ── Buscador rápido de habitación ──
    window.dashRoomSearch = () => {
        const input = document.getElementById('dash-room-search')?.value?.trim();
        const resultEl = document.getElementById('dash-room-result');
        if (!resultEl) return;
        if (!input) { resultEl.innerHTML = ''; return; }

        const room = rooms.find(r => String(r.number) === String(input));
        if (!room) {
            resultEl.innerHTML = `<div style="padding:12px;background:#fff5f5;border:1px solid #fecaca;border-radius:10px;color:#c0392b;font-weight:600">❌ Habitación "${input}" no encontrada</div>`;
            return;
        }

        const edificio = buildMap[room.buildingId] || `Edificio ${room.buildingId}`;
        const cap = room.bedCount || 2;
        const keys = ['day', 'night', 'extra'].slice(0, cap);
        const turnoIcon = { day: '☀️', night: '🌙', extra: '⭐' };
        const turnoLabel = { day: 'Día', night: 'Noche', extra: 'Extra' };
        const ocupantes = keys.filter(k => room.beds?.[k]?.occupant).length;
        const estadoBg = room.status === 'free' ? '#f0fff4' : room.status === 'occupied' ? '#fff5f5' : '#f1f5f9';
        const estadoColor = room.status === 'free' ? '#16a34a' : room.status === 'occupied' ? '#c0392b' : '#64748b';
        const estadoLabel = room.status === 'free' ? '✅ Disponible' : room.status === 'occupied' ? '🔴 Ocupada' : '🔒 Bloqueada';

        const bedsHTML = keys.map(k => {
            const bed = room.beds?.[k];
            const occ = !!bed?.occupant;
            return `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:10px;
                        background:${occ?'#fff5f5':'#f0fff4'};border:1px solid ${occ?'#fecaca':'#bbf7d0'};margin-bottom:6px">
              <span style="font-size:18px">${turnoIcon[k]}</span>
              <div style="flex:1">
                <div style="font-size:11px;font-weight:700;color:${occ?'#c0392b':'#16a34a'};text-transform:uppercase">
                  Cama ${turnoLabel[k]} — ${occ ? 'Ocupada' : 'Libre'}
                </div>
                ${occ ? `
                <div style="font-size:13px;font-weight:800;color:#1a202c;margin-top:2px">${bed.occupant}</div>
                <div style="font-size:11px;color:#64748b;margin-top:1px">
                  🏢 ${bed.company||'—'} · 🎯 ${bed.management||bed.gerencia||'—'} · ${bed.gender==='F'?'♀️':'♂️'}
                </div>
                <div style="font-size:10px;color:#94a3b8">RUT: ${bed.rut||'—'} · Salida: ${bed.departureDate||'—'}</div>` :
                `<div style="font-size:12px;color:#16a34a;font-weight:600;margin-top:2px">Cama libre para asignar</div>`}
              </div>
            </div>`;
        }).join('');

        resultEl.innerHTML = `
        <div style="background:${estadoBg};border:1.5px solid ${estadoColor};border-radius:12px;overflow:hidden">
          <div style="padding:12px 16px;border-bottom:1px solid ${estadoColor}22;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#94a3b8">${edificio}</div>
              <div style="font-size:20px;font-weight:900;color:${estadoColor}">Habitación ${room.number}</div>
            </div>
            <div style="text-align:right">
              <span style="background:${estadoColor};color:#fff;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700">${estadoLabel}</span>
              <div style="font-size:11px;color:#64748b;margin-top:4px">Piso ${room.floor||1} · ${cap} camas · ${ocupantes} ocupadas</div>
            </div>
          </div>
          <div style="padding:12px 16px">${bedsHTML}</div>
        </div>`;
    };

    // 🚀 AUTO-REFRESH: KPIs se actualizan solos cuando cambian datos en cualquier módulo
    if (window._dashboardDbHandler) window.removeEventListener('db:changed', window._dashboardDbHandler);
    let _dashRefreshTimer = null;
    window._dashboardDbHandler = (e) => {
        // 🔒 CRÍTICO: Solo re-renderizar si el dashboard SIGUE siendo la vista activa
        // Sin esto, el dashboard pisaba Infraestructura/Censo/Reservas cada vez que se guardaba
        if (window._currentRoute !== 'dashboard') return;
        if (!['rooms', 'b2b_requests', 'buildings'].includes(e.detail?.storeName)) return;
        if (e.detail?.source === 'cloud') return;
        clearTimeout(_dashRefreshTimer);
        _dashRefreshTimer = setTimeout(() => renderDashboard(container), 500);
    };
    window.addEventListener('db:changed', window._dashboardDbHandler);
}


