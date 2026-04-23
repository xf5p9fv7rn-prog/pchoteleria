import { getAll, put, remove, getById, addToSyncQueue, autoAsignarTrabajadores } from '../db.js';
import { showToast, formatDate, toChileanDate } from '../utils.js';

let expandedRequests = new Set();
let assignmentRunning = false;

let activeB2BTab = 'pending';

export async function renderSolicitudes(container) {
    const allReqs = await getAll('b2b_requests').catch(() => []);

    // Helper functions for tabs
    window.switchB2BTab = (tab) => {
        activeB2BTab = tab;
        renderSolicitudes(container);
    };

    const pendientes = allReqs.filter(r => r.status === 'pending' || r.status === 'accepted');
    const asignadas = allReqs.filter(r => r.status === 'assigned');
    const rechazadas = allReqs.filter(r => r.status === 'rejected');
    
    let activeList = pendientes;
    if (activeB2BTab === 'assigned') activeList = asignadas;
    if (activeB2BTab === 'rejected') activeList = rechazadas;

    // Dictionary to quickly map room ID to its human-readable Number
    const allRooms = await getAll('rooms').catch(() => []);
    const roomsMap = {};
    allRooms.forEach(r => roomsMap[r.id] = r.number);

    // Calculate total availability
    let freeBedsCount = 0;
    let totalBedsCount = 0;
    allRooms.forEach(r => {
        totalBedsCount += (r.bedCount || 2);
        if (r.status !== 'blocked') {
            if (!r.beds?.day?.occupant) freeBedsCount++;
            if ((r.bedCount || 2) === 2 && !r.beds?.night?.occupant) freeBedsCount++;
            // 🔥 INYECTADO: Cuenta la 3ra cama si existe
            if ((r.bedCount || 2) >= 3 && !r.beds?.extra?.occupant) freeBedsCount++;
        }
    });

    container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Reservas de <span>Alojamiento</span> (v32)</h2>
        <p class="section-subtitle">Gestión y aprobación de solicitudes de empresas colaboradoras</p>
        <div style="margin-top:8px; display:inline-flex; align-items:center; gap:8px; padding:6px 12px; background:#f0fff4; border:1px solid #c6f6d5; border-radius:20px; font-size:12px; font-weight:700; color:#276749;">
            <span style="font-size:14px">🛏️</span> 
            <span>Disponibilidad Global: ${freeBedsCount} Camas Libres</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:15px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="window.runAssignment()">⚡ Asignar Todo</button>
        <button class="btn btn-secondary" onclick="window.forceCleanupMaintenance()">🧹 Limpieza Vencidos</button>
        <button class="btn btn-secondary" onclick="window.abrirModalLimpieza()">🗑️ Limpiar Todo</button>
      </div>
    </div>

    <div class="tab-bar" style="margin-bottom:20px; border-bottom:1px solid var(--border); display:flex; gap:16px;">
        <button class="tab-btn ${activeB2BTab==='pending' ? 'active' : ''}" onclick="window.switchB2BTab('pending')" style="padding:10px 16px; border:none; background:none; cursor:pointer; font-weight:700; color:${activeB2BTab==='pending'?'var(--red-600)':'var(--text-secondary)'}; border-bottom:${activeB2BTab==='pending'?'3px solid var(--red-600)':'3px solid transparent'};">
            📁 Por Asignar (${pendientes.length})
        </button>
        <button class="tab-btn ${activeB2BTab==='assigned' ? 'active' : ''}" onclick="window.switchB2BTab('assigned')" style="padding:10px 16px; border:none; background:none; cursor:pointer; font-weight:700; color:${activeB2BTab==='assigned'?'#276749':'var(--text-secondary)'}; border-bottom:${activeB2BTab==='assigned'?'3px solid #276749':'3px solid transparent'};">
            📁 Asignadas (${asignadas.length})
        </button>
        <button class="tab-btn ${activeB2BTab==='rejected' ? 'active' : ''}" onclick="window.switchB2BTab('rejected')" style="padding:10px 16px; border:none; background:none; cursor:pointer; font-weight:700; color:${activeB2BTab==='rejected'?'#92400e':'var(--text-secondary)'}; border-bottom:${activeB2BTab==='rejected'?'3px solid #92400e':'3px solid transparent'};">
            📁 Historial / Rechazadas (${rechazadas.length})
        </button>
    </div>

    <div class="request-inbox" id="request-inbox">
      ${activeList.length === 0 ? '<div style="text-align:center; padding:40px; color:var(--text-secondary); font-weight:600">No hay solicitudes en esta carpeta.</div>' : activeList.map(r => renderRequestCard(r, roomsMap)).join('')}
    </div>

    <div class="modal-overlay" id="delete-req-modal">
        <div class="modal" style="max-width:480px;">
            <div class="modal-header">
                <div class="modal-header-icon" style="background:var(--red-50); color:var(--red-600)">⚠️</div>
                <div>
                   <h3 style="font-size:16px;font-weight:700">Eliminar Solicitud</h3>
                   <p style="font-size:12px;color:var(--text-secondary)">Seleccione qué hacer con las camas ocupadas</p>
                </div>
                <button class="modal-close btn" onclick="window.cerrarModalBorrarReq()">✕</button>
            </div>
            <div class="modal-body">
                <p style="font-size:13px; color:var(--text-primary); margin-bottom:20px;">
                    ¿Estás seguro de que deseas eliminar esta solicitud B2B?
                </p>
                <div id="delete-req-options" style="display:flex; flex-direction:column; gap:16px;">
                    
                    <div class="premium-card" style="padding:16px; cursor:pointer; transition:transform 0.2s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'" onclick="window.ejecutarBorradoReq(false)">
                        <div style="display:flex; align-items:center; gap:16px;">
                            <div style="width:48px; height:48px; border-radius:14px; background:rgba(0,0,0,0.04); display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0;">📄</div>
                            <div>
                                <div style="font-weight:800; color:var(--text-primary); font-size:15px">1. Solo eliminar la solicitud (B2B)</div>
                                <div style="font-size:12px; color:var(--text-secondary); margin-top:4px; line-height:1.4">Se eliminará la ficha de la vista de reservas, pero las personas conservarán sus camas en la infraestructura.</div>
                            </div>
                        </div>
                    </div>

                    <div class="premium-card" style="padding:16px; cursor:pointer; background:linear-gradient(135deg, rgba(229,62,62,0.05) 0%, rgba(229,62,62,0.15) 100%); border:1px solid rgba(229,62,62,0.3); transition:transform 0.2s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'" onclick="window.ejecutarBorradoReq(true)">
                        <div style="display:flex; align-items:center; gap:16px;">
                            <div style="width:48px; height:48px; border-radius:14px; background:var(--grad-red); display:flex; align-items:center; justify-content:center; font-size:22px; color:white; flex-shrink:0; box-shadow:0 4px 10px rgba(229,62,62,0.3);">🛏️</div>
                            <div>
                                <div style="font-weight:800; color:var(--red-700); font-size:15px">2. Eliminar Solicitud y VACIAR CAMAS</div>
                                <div style="font-size:12px; color:var(--red-800); margin-top:4px; line-height:1.4">Destructivo. Libera las camas que ocupaban estas personas y elimina el registro para siempre.</div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-ghost" onclick="window.cerrarModalBorrarReq()">Cancelar</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="cleanup-modal">
        <div class="modal" style="max-width:400px">
            <div class="modal-header">
                <div class="modal-header-icon">🗑️</div>
                <div>
                   <h3 style="font-size:16px;font-weight:700">Limpiar Asignaciones</h3>
                   <p style="font-size:12px;color:var(--text-secondary)">Seleccione el alcance del borrado</p>
                </div>
                <button class="modal-close btn" onclick="window.cerrarModalLimpieza()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Filtrar por:</label>
                    <select class="form-select" id="cleanup-scope" onchange="window.toggleCleanupFilters()">
                        <option value="all">Todo el Campamento</option>
                        <option value="building">Por Pabellón / Edificio</option>
                        <option value="company">Por Empresa</option>
                        <option value="shift">Por Turno (Día/Noche)</option>
                    </select>
                </div>
                
                <div id="cleanup-filter-wrap" style="margin-top:15px; display:none">
                    <label class="form-label" id="cleanup-filter-label">Seleccionar:</label>
                    <select class="form-select" id="cleanup-filter-val"></select>
                </div>

                <div class="alert alert-warn" style="margin-top:20px; font-size:11px">
                    ⚠️ Esta acción liberará las habitaciones seleccionadas y reactivará las solicitudes de los trabajadores afectados.
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="window.cerrarModalLimpieza()">Cancelar</button>
                <button class="btn btn-primary" style="background:var(--red-600)" onclick="window.ejecutarLimpiezaFiltrada()">Confirmar Borrado</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="assignment-modal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-header-icon">⚡</div>
          <div>
            <h3 style="font-size:16px;font-weight:700">Asignación Automática Inteligente</h3>
            <p style="font-size:12px;color:var(--text-secondary)">Motor de matching multicritério</p>
          </div>
          <button class="modal-close btn" onclick="window.closeAssignmentModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="algo-rule strict">
            <div class="algo-rule-icon">🚫</div>
            <div class="algo-rule-text">
              <h4>Regla ESTRICTA — Mismo Sexo y Anti-Clones</h4>
              <p>Nunca se mezclan géneros y el sistema bloquea a trabajadores que ya están alojados.</p>
            </div>
          </div>
          <div class="algo-rule important">
            <div class="algo-rule-icon">🔄</div>
            <div class="algo-rule-text">
              <h4>Cama Caliente — Mismo Turno Rotativo</h4>
              <p>El Turno A ocupa la cama Día, el Turno B ocupa la cama Noche. El algoritmo busca pares de trabajadores con turnos complementarios para maximizar el uso de camas.</p>
            </div>
          </div>
          <div class="algo-rule secondary">
            <div class="algo-rule-icon">🏢</div>
            <div class="algo-rule-text">
              <h4>Agrupamiento por Empresa</h4>
              <p>Se prioriza colocar trabajadores de la misma empresa en el mismo pabellón o habitaciones contiguas.</p>
            </div>
          </div>
          <div class="algo-rule secondary">
            <div class="algo-rule-icon">🏠</div>
            <div class="algo-rule-text">
              <h4>Prioridad por Disponibilidad</h4>
              <p>Se asignan primero habitaciones con una sola cama libre para evitar mezcla de géneros y maximizar ocupación.</p>
            </div>
          </div>

          <div class="divider"></div>

          <div id="assignment-progress" style="display:none">
            <div class="progress-wrap">
              <div class="progress-label">Validando reglas de género y Anti-Clones...</div>
              <div class="progress-bar"><div class="progress-fill" id="prog-1"></div></div>
            </div>
            <div class="progress-wrap">
              <div class="progress-label">Agrupando por turno rotativo (Cama Caliente)...</div>
              <div class="progress-bar"><div class="progress-fill" id="prog-2"></div></div>
            </div>
            <div class="progress-wrap">
              <div class="progress-label">Asignando habitaciones por empresa...</div>
              <div class="progress-bar"><div class="progress-fill" id="prog-3"></div></div>
            </div>
            <div class="progress-wrap">
              <div class="progress-label">Guardando asignaciones...</div>
              <div class="progress-bar"><div class="progress-fill" id="prog-4"></div></div>
            </div>
            <div id="assignment-result" style="display:none;margin-top:16px;padding:14px;border-radius:var(--radius-md);background:#f0fff4;border:1px solid #c6f6d5;color:#276749;font-weight:600;text-align:center"></div>
          </div>
        </div>
        <div class="modal-footer" id="assignment-footer">
          <button class="btn btn-secondary" onclick="window.closeAssignmentModal()">Cancelar</button>
          <button class="btn btn-primary" id="run-assignment-btn" onclick="window.runAssignment()">
            ⚡ Ejecutar Asignación
          </button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="directed-assignment-modal" style="overflow-y:hidden;">
      <div class="modal" style="max-width:960px;width:98%;height:94vh;max-height:94vh;display:flex;flex-direction:column;overflow:hidden;border-radius:16px;margin:auto;">
        <!-- Header sticky -->
        <div class="modal-header" style="flex-shrink:0;background:#fff;border-bottom:1px solid var(--border);">
          <div class="modal-header-icon" style="background:#edf2f7; color:#2b6cb0">✏️</div>
          <div style="flex:1">
            <h3 style="font-size:16px;font-weight:700">Asignación Manual Dirigida</h3>
            <p style="font-size:12px;color:var(--text-secondary)">Asigne habitaciones libres y modifique fechas manualmente por trabajador</p>
          </div>
          <button onclick="window._resetAllAssignments()" style="background:#fff3cd;border:1.5px solid #f59e0b;color:#92400e;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-right:6px">🔓 Reasignar Todo</button>
          <button class="modal-close btn" onclick="window.closeDirectedAssignmentModal()">✕</button>
        </div>

        <!-- Asignación Mágica — SIEMPRE VISIBLE (flex-shrink:0) -->
        <div style="flex-shrink:0; background:#f7fafc; border-bottom:2px solid #bee3f8; padding:14px 16px;">
          <div style="font-weight:700; color:var(--text-primary); margin-bottom:10px; display:flex; align-items:center; gap:8px;">
              <span>🪄 Asignación Mágica por Rangos</span>
          </div>
          <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
              <div style="flex:1; min-width:130px;">
                  <label class="form-label" style="font-size:11px">Pabellón / Edificio</label>
                  <select class="form-select" id="bulk-range-building" onchange="window.onBuildingChange()"></select>
              </div>
              <div style="flex:0; min-width:86px;">
                  <label class="form-label" style="font-size:11px">Piso</label>
                  <select class="form-select" id="bulk-range-floor" onchange="window.updateMagicSuggestions()">
                      <option value="">Todos</option>
                  </select>
              </div>
              <div style="flex:1; min-width:76px;">
                  <label class="form-label" style="font-size:11px">Hab. Desde</label>
                  <input type="number" class="form-input" id="bulk-range-start" placeholder="Ej: 21">
              </div>
              <div style="flex:1; min-width:76px;">
                  <label class="form-label" style="font-size:11px">Hab. Hasta</label>
                  <input type="number" class="form-input" id="bulk-range-end" placeholder="Ej: 21">
              </div>
              <div style="flex:auto; min-width:130px;">
                  <button class="btn btn-primary btn-full" style="height:40px; white-space:nowrap" onclick="window.applyRangeAssignment()">⚡ Inyectar Marcados</button>
              </div>
          </div>
          <div id="magic-suggestion-box" style="margin-top:10px; padding:10px 12px; border-radius:6px; background:#ebf8ff; border:1px solid #bee3f8; font-size:12px; color:#2b6cb0; display:none; align-items:center; justify-content:space-between;">
            <div id="magic-suggestion-text"></div>
            <button class="btn" id="magic-suggestion-btn" style="background:white; color:#2b6cb0; border:1px solid #bee3f8; font-size:11px; font-weight:700; padding:6px 12px; height:auto; min-width:auto;">💡 Usar Sugerencia</button>
          </div>
        </div>

        <!-- Tabla — SOLO ESTA SECCIÓN HACE SCROLL -->
        <div class="modal-body" style="flex:1;overflow-y:auto;padding:0;">
          <!-- Barra de acción rápida sticky -->
          <div style="position:sticky;top:0;z-index:5;background:#1a202c;color:white;
                      padding:8px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;
                      border-bottom:2px solid #e53e3e;flex-wrap:wrap;">
            <span id="sticky-worker-count" style="font-size:12px;font-weight:700;opacity:0.9">
              Selecciona trabajadores y elige rango ↑
            </span>
            <div style="display:flex;gap:6px;">
              <button class="btn" style="background:#e53e3e;color:white;font-size:12px;padding:6px 12px;font-weight:700"
                onclick="window.applyRangeAssignment()">⚡ Inyectar</button>
              <button class="btn" style="background:#38a169;color:white;font-size:12px;padding:6px 12px;font-weight:700"
                onclick="window.saveDirectedAssignment()">💾 Guardar</button>
            </div>
          </div>
          <div style="padding:12px;">
          <input type="hidden" id="directed-req-id">
          <div style="overflow-x: auto; width: 100%; border: 1px solid var(--border); border-radius: var(--radius-md);">
            <table class="worker-table" style="min-width: 800px;">
              <thead style="position:sticky;top:0;background:white;z-index:2">
                <tr>
                  <th style="width:5%;text-align:center;"><input type="checkbox" onchange="window.toggleAllDirectedWorkers(this.checked)"></th>
                  <th style="width:15%">Trabajador</th>
                  <th style="width:10%">Turno/Sexo</th>
                  <th style="width:25%">Cama Seleccionada</th>
                  <th style="width:15%">Fecha Ingreso</th>
                  <th style="width:15%">Fecha Salida</th>
                </tr>
              </thead>
              <tbody id="directed-workers-tbody">
                </tbody>
            </table>
          </div>
          </div><!-- /padding wrapper -->
        </div>

        <!-- Footer — siempre fijo abajo -->
        <div class="modal-footer" style="flex-shrink:0; border-top:1px solid var(--border); padding:14px 20px;">
          <button class="btn btn-secondary" onclick="window.closeDirectedAssignmentModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="window.saveDirectedAssignment()">💾 Guardar Asignaciones</button>
        </div>
      </div>
    </div>
  `;

    window.abrirModalLimpieza = async () => {
        document.getElementById('cleanup-modal').classList.add('visible');
        window.toggleCleanupFilters(); // Reset filters state
    };
    
    window.cerrarModalLimpieza = () => {
        document.getElementById('cleanup-modal').classList.remove('visible');
    };

    window.toggleCleanupFilters = async () => {
        const scope = document.getElementById('cleanup-scope').value;
        const wrap = document.getElementById('cleanup-filter-wrap');
        const select = document.getElementById('cleanup-filter-val');
        const label = document.getElementById('cleanup-filter-label');
        
        if (scope === 'all') {
            wrap.style.display = 'none';
            return;
        }
        
        wrap.style.display = 'block';
        if (scope === 'building') {
            label.textContent = 'Seleccionar Pabellón:';
            const buildings = await getAll('buildings');
            select.innerHTML = buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
        } else if (scope === 'company') {
            label.textContent = 'Seleccionar Empresa:';
            const rooms = await getAll('rooms');
            const comps = new Set();
            rooms.forEach(r => {
                if(r.beds?.day?.company) comps.add(r.beds.day.company);
                if(r.beds?.night?.company) comps.add(r.beds.night.company);
            });
            select.innerHTML = Array.from(comps).sort().map(c => `<option value="${c}">${c}</option>`).join('');
        } else if (scope === 'shift') {
            label.textContent = 'Seleccionar Turno:';
            select.innerHTML = `
                <option value="day">Camas Día (🌅)</option>
                <option value="night">Camas Noche (🌙)</option>
            `;
        }
    };

    window.ejecutarLimpiezaFiltrada = async () => {
        const scope = document.getElementById('cleanup-scope').value;
        const filterVal = document.getElementById('cleanup-filter-val').value;
        
        if (!confirm('¿Está seguro de realizar este borrado? Los trabajadores afectados volverán a estado PENDIENTE.')) return;
        
        showToast('Procesando limpieza...', 'info');
        window.cerrarModalLimpieza();

        const [rooms, reqs] = await Promise.all([
            getAll('rooms'),
            getAll('b2b_requests')
        ]);

        let affectedCount = 0;
        const affectedWorkers = new Set();
        const roomsToUpdate = [];

        rooms.forEach(r => {
            let changed = false;
            // 🔥 INYECTADO: Asegura borrar la 3ra cama extra
            ['day', 'night', 'extra'].forEach(bedKey => {
                const bed = r.beds?.[bedKey];
                if (!bed || !bed.occupant) return;

                let shouldRemove = false;
                if (scope === 'all') shouldRemove = true;
                else if (scope === 'building' && String(r.buildingId) === String(filterVal)) shouldRemove = true;
                else if (scope === 'company' && bed.company === filterVal) shouldRemove = true;
                else if (scope === 'shift' && bedKey === filterVal) shouldRemove = true;

                if (shouldRemove) {
                    affectedWorkers.add(bed.occupant);
                    r.beds[bedKey] = { occupant: null, arrivalDate: null, departureDate: null, company: null, shift: null, rut: null, gender: null };
                    affectedCount++;
                    changed = true;
                }
            });

            if (changed) {
                if (!r.beds?.day?.occupant && !r.beds?.night?.occupant && !r.beds?.extra?.occupant) {
                    if (r.status !== 'blocked') r.status = 'free';
                    r.gender = null;
                }
                roomsToUpdate.push(r);
            }
        });

        const reqsToUpdate = [];
        reqs.forEach(rq => {
            const hasAffected = rq.workers && rq.workers.some(w => affectedWorkers.has(w.name));
            if (hasAffected) {
                rq.workers.forEach(w => {
                    if (affectedWorkers.has(w.name)) w.assignedRoomStr = null;
                });
                rq.status = 'pending';
                rq.assignedAt = null;
                reqsToUpdate.push(rq);
            }
        });

        const promises = [];
        roomsToUpdate.forEach(r => promises.push(put('rooms', r)));
        reqsToUpdate.forEach(rq => promises.push(put('b2b_requests', rq)));
        await Promise.all(promises);

        showToast(`Limpieza completada: ${affectedCount} camas liberadas`, 'success');
        await renderSolicitudes(container); // 🚀 Re-render directo, sin recarga de página
    };

    window.confirmarEliminarSolicitud = (id) => {
        window._pendingDeleteReqId = id;
        // 🔒 Mover a document.body para que position:fixed funcione correctamente
        // sin importar el contexto de scroll/transform del contenedor padre
        const modalEl = document.getElementById('delete-req-modal');
        if (modalEl && modalEl.parentNode !== document.body) {
            document.body.appendChild(modalEl);
        }
        modalEl.classList.add('visible');
    };

    window.cerrarModalBorrarReq = () => {
        document.getElementById('delete-req-modal')?.classList.remove('visible');
    };

    // 🔥 ESTA ES LA FUNCIÓN BLINDADA CONTRA ERRORES 🔥
    window.ejecutarBorradoReq = async (freeRooms) => {
        try {
            // Ponemos el botón en "Cargando..."
            const btnEliminar = document.querySelector('.premium-card[onclick="window.ejecutarBorradoReq(true)"]');
            if (btnEliminar) btnEliminar.style.opacity = '0.5';

            // 🔒 FIX: Usar el ID original sin parseInt para evitar corrupción de IDs float/timestamp
            const rawId = window._pendingDeleteReqId;
            const id = isNaN(rawId) ? rawId : Number(rawId);
            const req = await getById('b2b_requests', id);
            
            if(!req) {
                alert("⚠️ Error: No se encontró la solicitud en la base de datos.");
                if (btnEliminar) btnEliminar.style.opacity = '1';
                return;
            }

            if (freeRooms) {
                const rooms = await getAll('rooms');
                const workersData = req.workers || []; // Si no hay trabajadores, no crashea
                let freedCount = 0;
                const roomsToUpdate = []; 

                rooms.forEach(r => {
                    let changed = false;
                    
                    const isOccupiedByWorker = (occupant) => {
                        if (!occupant) return false;
                        return workersData.some(w => 
                            occupant === w.name || 
                            occupant.startsWith(w.name + ' (') || 
                            (w.rut && occupant.includes(w.rut))
                        );
                    };

                    // 🔥 Buscar en las 3 camas
                    ['day', 'night', 'extra'].forEach(bk => {
                        if (r.beds && r.beds[bk] && r.beds[bk].occupant && isOccupiedByWorker(r.beds[bk].occupant)) {
                            r.beds[bk] = { occupant: null, shift: null, company: null, gender: null, arrivalDate: null, departureDate: null };
                            freedCount++;
                            changed = true;
                        }
                    });

                    if (changed) {
                        if (!r.beds.day?.occupant && !r.beds.night?.occupant && !r.beds.extra?.occupant) {
                            r.status = 'free';
                            r.gender = null;
                        }
                        roomsToUpdate.push(r);
                    }
                });

                if (freedCount > 0 && roomsToUpdate.length > 0) {
                    await Promise.all(roomsToUpdate.map(r => put('rooms', r)));
                    // 🔄 Actualizar caché de infraestructura
                    if (window._allRooms) {
                        roomsToUpdate.forEach(updated => {
                            const idx = window._allRooms.findIndex(r => String(r.id) === String(updated.id));
                            if (idx !== -1) window._allRooms[idx] = updated;
                        });
                    }
                    window.dispatchEvent(new CustomEvent('rooms-updated'));
                }
            }

            // Borramos la solicitud con el ID correcto
            await remove('b2b_requests', id);
            
            // Log silencioso (si falla, no rompe la app)
            try { 
                await put('logs', { timestamp: new Date().toISOString(), username: window._currentUser?.username || 'Sistema', action: 'BORRAR_RESERVA', details: `Eliminada solicitud de ${req.company}. Liberar camas: ${freeRooms}` }); 
            } catch(err){}
            
            showToast(`Solicitud de ${req.company} eliminada`, 'success');
            window.cerrarModalBorrarReq();
            renderSolicitudes(container);
            
        } catch (error) {
            // Si algo explota, te lo mostrará en pantalla en lugar de quedarse congelado
            console.error("Error crítico:", error);
            alert("🚨 Error en el código al intentar borrar:\n" + error.message + "\n\nPor favor, envíame una foto de este mensaje.");
            window.cerrarModalBorrarReq();
        }
    };

    setupRequestHandlers();
}

function renderRequestCard(req, roomsMap = {}) {
    const isExpanded = expandedRequests.has(req.id);
    const statusMap = {
        pending: { label: '⏳ Pendiente', class: 'badge-res' },
        accepted: { label: '✅ Aceptada', class: 'badge-free' },
        rejected: { label: '❌ Rechazada', class: 'badge-block' },
        assigned: { label: '🚪 Asignada', class: 'badge-occ' }
    };
    const s = statusMap[req.status] || { label: req.status, class: 'badge' };
    const statusBadge = `<span class="badge ${s.class}">${s.label}</span>`;
    const initials = req.company.split(' ').slice(0, 2).map(w => w[0]).join('');

    let cardStyle = '';
    if (req.status === 'rejected') cardStyle = 'border-left: 5px solid var(--red-600); background: #fff5f5;';
    if (req.status === 'accepted') cardStyle = 'border-left: 5px solid #38a169; background: #f0fff4;';
    if (req.status === 'assigned') cardStyle = 'border-left: 5px solid #3182ce; opacity: 0.8;';

    return `
    <div class="request-card" id="req-${req.id}" style="${cardStyle}">
      <div class="request-card-header" onclick="window.toggleRequest('${req.id}')">
        <div class="company-logo">${initials}</div>
        <div class="request-info">
          <h4>${req.company}</h4>
          <p>📅 ${toChileanDate(req.receivedDate)} · 👷 ${req.workers ? req.workers.length : 0} trabajadores · ${req.contactName}${req.contractNumber ? ` · 📄 <strong>${req.contractNumber}</strong>` : ''}${req.gerencia ? ` · 🏢 ${req.gerencia}` : ''}</p>
          ${req.angloAdmin ? `<p style="margin-top:2px;font-size:11px;font-weight:700;color:#6b21a8;display:flex;align-items:center;gap:4px">
            <span style="background:#f3e8ff;border-radius:5px;padding:1px 7px;border:1px solid #d8b4fe">🏭 Admin Anglo: ${req.angloAdmin}</span>
          </p>` : ''}
        </div>
        <div class="request-status" style="display:flex;align-items:center;gap:8px;">
          ${statusBadge}
          ${req.status === 'accepted' ? `
          <button class="btn btn-primary btn-sm"
            style="background:#2b6cb0;color:white;border:none;font-size:12px;padding:5px 10px;white-space:nowrap"
            onclick="event.stopPropagation();window.openDirectedAssignmentModal('${req.id}')">✏️ Asignar</button>` : ''}
          <span style="font-size:18px;color:var(--text-secondary);transition:transform 0.2s;${isExpanded ? 'transform:rotate(180deg)' : ''}" id="req-arrow-${req.id}">▾</span>
        </div>
      </div>
      <div class="accordion-body ${isExpanded ? 'open' : ''}" id="req-body-${req.id}" style="display: ${isExpanded ? 'block' : 'none'};">
        <div class="request-body">
          <div style="overflow-x:auto;width:100%;border:1px solid var(--border);border-radius:var(--radius-md);max-height:280px;overflow-y:auto;">
            <table class="worker-table">
            <thead>
              <tr>
                <th>RUT</th>
                <th>Nombre</th>
                <th>Gerencia / R. Social</th>
                <th>Sexo</th>
                <th>Turno</th>
                <th>Fechas (Ingreso - Salida)</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${(req.workers || []).map(w => `
                <tr style="font-size:13px">
                  <td><code style="font-size:11px">${w.rut}</code></td>
                  <td>
                    <div style="font-weight:700">${w.name}</div>
                    <div style="font-size:10px;color:var(--text-secondary)">${w.observation || ''}</div>
                  </td>
                  <td>
                    <div style="font-weight:600;font-size:12px">${w.management || '-'}</div>
                    <div style="font-size:10px;color:var(--text-muted)">${w.legalName || ''}</div>
                  </td>
                  <td><span class="gender-chip ${w.sex}">${w.sex === 'M' || w.sex === 'm' ? '🔵 M' : '🔴 F'}</span></td>
                  <td>
                    <span class="tag">${w.shiftName || w.shift || 'N/A'}</span>
                    <div style="font-size:9px;color:var(--text-muted)">${w.shiftSystem || ''}</div>
                  </td>
                  <td>
                    <div style="font-size:11px;font-weight:600">${toChileanDate(w.arrivalDate)}</div>
                    <div style="font-size:10px;color:var(--red-600)">hasta ${toChileanDate(w.departureDate)}</div>
                  </td>
                  <td>
                    ${w.assignedRoomStr === 'CLON_RECHAZADO' ? 
                      `<span class="badge" style="font-size:10px; background:var(--red-600); color:white; border:none;">⚠️ CLON DESCARTADO</span>
                       <div style="font-size:9px; color:var(--text-secondary); margin-top:4px; line-height:1.2;">Ya tenía cama en el sistema</div>` 
                    : (req.status === 'assigned' || w.assignedRoomStr ? 
                      `<span class="badge badge-free" style="font-size:10px">✅ Asignado</span>
                       <div style="font-size:10px; color:var(--text-secondary); font-weight:700; margin-top:4px;">
                         ${w.assignedRoomStr ? `🚪 Hab. ${roomsMap[w.assignedRoomStr.split('_')[0]] || '?'}` : ''}
                       </div>` 
                      : '<span class="badge" style="font-size:10px;background:#edf2f7;color:#4a5568">⏳ Pendiente</span>')}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
          </div><!-- /scroll-table wrapper -->
          <div style="margin-top:12px;display:flex;justify-content:flex-start;align-items:center;gap:8px;flex-wrap:wrap;
                      position:sticky;bottom:0;background:white;padding:10px 0 4px;
                      border-top:1px solid var(--border);z-index:10">
            <!-- ✅ Descarga Excel de esta solicitud — siempre visible -->
            <button class="btn btn-secondary btn-sm"
              style="background:linear-gradient(135deg,#f0fff4,#dcfce7);color:#276749;border:1.5px solid #9ae6b4;font-weight:700;margin-right:auto"
              onclick="event.stopPropagation();window.downloadSolicitudExcel('${req.id}')">
              📥 Descargar Excel
            </button>
            ${req.status === 'pending' ? `
              <button class="btn btn-secondary btn-sm" style="background:#fff5f5;color:#c53030;border:1px solid #feb2b2" onclick="window.updateRequestStatus('${req.id}', 'rejected')">❌ Rechazar</button>
              <button class="btn btn-primary btn-sm" style="background:#f0fff4;color:#276749;border:1px solid #c6f6d5" onclick="window.updateRequestStatus('${req.id}', 'accepted')">✅ Aceptar</button>
              <button class="btn btn-secondary btn-sm" style="color:var(--red-600);border-color:var(--red-300)" onclick="window.confirmarEliminarSolicitud('${req.id}')">🗑️ Eliminar</button>
            ` : ''}
            ${req.status === 'accepted' ? `
              <button class="btn btn-secondary btn-sm" onclick="window.updateRequestStatus('${req.id}', 'pending')">↩️ Deshacer Aceptación</button>
              <button class="btn btn-primary btn-sm" style="background:#ebf8ff;color:#2b6cb0;border:1px solid #bee3f8" onclick="window.openDirectedAssignmentModal('${req.id}')">✏️ Asignación Manual Dirigida</button>
              <button class="btn btn-secondary btn-sm" style="color:var(--red-600);border-color:var(--red-300)" onclick="window.confirmarEliminarSolicitud('${req.id}')">🗑️ Eliminar</button>
            ` : ''}
            ${req.status === 'assigned' ? `
              <button class="btn btn-secondary btn-sm" style="color:var(--red-600);border-color:var(--red-600)" onclick="window.confirmarEliminarSolicitud('${req.id}')">🗑️ Eliminar Solicitud y Camas</button>
            ` : ''}
            ${req.status === 'rejected' ? `
              <button class="btn btn-secondary btn-sm" onclick="window.updateRequestStatus('${req.id}', 'pending')">↩️ Restablecer</button>
              <button class="btn btn-secondary btn-sm" style="color:var(--red-600);border-color:var(--red-600)" onclick="window.deleteRequestPermanently('${req.id}')">🗑️ Eliminar Definitivamente</button>
            ` : ''}
          </div>

        </div>
      </div>
    </div>`;
}

function setupRequestHandlers() {
    window.toggleRequest = (id) => {
        if (expandedRequests.has(id)) expandedRequests.delete(id);
        else expandedRequests.add(id);
        const body = document.getElementById(`req-body-${id}`);
        const arrow = document.getElementById(`req-arrow-${id}`);
        if (body) {
            body.classList.toggle('open', expandedRequests.has(id));
            // 🔥 INYECTADO: Asegura forzadamente que se muestre en CSS
            body.style.display = expandedRequests.has(id) ? 'block' : 'none';
        }
        if (arrow) arrow.style.transform = expandedRequests.has(id) ? 'rotate(180deg)' : '';
    };

    window.updateRequestStatus = async (id, status) => {
        const requests = await getAll('b2b_requests');
        const req = requests.find(r => r.id == id);
        if (req) {
            req.status = status;
            await put('b2b_requests', req);
            
            showToast(`Solicitud ${status === 'accepted' ? 'ACEPTADA' : 'RECHAZADA'}`, status === 'accepted' ? 'success' : 'error');
            
            setTimeout(() => {
                showToast(`📧 Notificación enviada a: ${req.contactEmail || 'contacto@empresa.com'}`, 'info');
            }, 800);

            await renderSolicitudes(document.getElementById('page-content'));
        }
    };

    window.deleteRequestPermanently = async (id) => {
        if (!confirm('🛑 ¿Estás totalmente seguro de eliminar esta solicitud PERMANENTEMENTE? Esta acción no se puede deshacer.')) return;
        
        const parsedId = parseInt(id, 10);
        await remove('b2b_requests', parsedId);
        
        showToast('Solicitud eliminada de la base de datos', 'success');
        await renderSolicitudes(document.getElementById('page-content'));
    };

    // 🔥 INYECTADO: MOTOR INTELIGENTE INTEGRADO AL MODAL CON ANTI-CLONES 🔥
    window.openAssignmentModal = async (reqId) => {
        if (!confirm('⚡ ¿Ejecutar Asignación Inteligente?\n\nEl sistema validará que los trabajadores no estén duplicados y luego los asignará a sus camas.')) return;
        
        const [requests, rooms] = await Promise.all([getAll('b2b_requests'), getAll('rooms')]);
        const req = requests.find(x => String(x.id) === String(reqId));
        
        const existingRuts = new Set();
        rooms.forEach(r => {
            ['day', 'night', 'extra'].forEach(k => {
                if (r.beds && r.beds[k] && r.beds[k].occupant && r.beds[k].rut) {
                    existingRuts.add(String(r.beds[k].rut || "").replace(/[^0-9Kk]/g, '').toUpperCase());
                }
            });
        });

        let clonesCount = 0;
        if (req && req.workers) {
            req.workers.forEach(w => {
                if (!w.assignedRoomStr && w.rut) {
                    const cleanRut = String(w.rut || "").replace(/[^0-9Kk]/g, '').toUpperCase();
                    if (existingRuts.has(cleanRut)) {
                        w.assignedRoomStr = 'CLON_RECHAZADO'; 
                        clonesCount++;
                    }
                }
            });
        }

        if (clonesCount > 0) {
            await put('b2b_requests', req); 
            alert(`🛡️ SISTEMA ANTI-CLONES ACTIVADO\n\nSe detectaron ${clonesCount} trabajadores de esta solicitud que YA ESTÁN ALOJADOS en otra habitación.\n\nFueron marcados en rojo y excluidos automáticamente de esta asignación.`);
        }

        showToast('⏳ Analizando y asignando camas libres...', 'info');
        const resultado = await autoAsignarTrabajadores(reqId);
        
        if (resultado.success) {
            if (resultado.fallidos === 0) showToast(`✅ ¡Éxito! Se asignaron los ${resultado.asignados} trabajadores perfectamente.`, 'success');
            else showToast(`⚠️ Se asignaron ${resultado.asignados} camas. Quedaron ${resultado.fallidos} sin espacio disponible.`, 'warn');
            await renderSolicitudes(document.getElementById('page-content'));
        } else {
            showToast('Hubo un error al leer la solicitud.', 'error');
        }
    };

    window.closeAssignmentModal = () => {
        if (assignmentRunning) return;
        document.getElementById('assignment-modal').classList.remove('visible');
    };

    window.openDirectedAssignmentModal = async (reqId) => {
        const [requests, rooms, buildings] = await Promise.all([
            getAll('b2b_requests'),
            getAll('rooms'),
            getAll('buildings')
        ]);
        const req = requests.find(x => x.id == reqId);
        if(!req) return;

        document.getElementById('directed-req-id').value = reqId;
        const tbody = document.getElementById('directed-workers-tbody');
        
        const bMap = {};
        let bOpts = '<option value="">(Seleccione)</option>';
        buildings.forEach(b => {
             bMap[b.id] = b.name;
             bOpts += `<option value="${b.id}">${b.name}</option>`;
        });
        document.getElementById('bulk-range-building').innerHTML = bOpts;
        document.getElementById('bulk-range-start').value = '';
        document.getElementById('bulk-range-end').value = '';
        document.getElementById('bulk-range-floor').innerHTML = '<option value="">Todos los pisos</option>';

        // Poblar el selector de piso cuando cambia el edificio
        window._allRoomsForModal = rooms; // cache para el selector de piso
        window.onBuildingChange = () => {
            const bId = document.getElementById('bulk-range-building').value;
            const floorSel = document.getElementById('bulk-range-floor');
            const floors = [...new Set(
                rooms.filter(r => String(r.buildingId) === String(bId))
                     .map(r => r.floor)
                     .filter(Boolean)
            )].sort((a, b) => a - b);
            floorSel.innerHTML = '<option value="">Todos los pisos</option>' +
                floors.map(f => `<option value="${f}">Piso ${f}</option>`).join('');
            window.updateMagicSuggestions();
        };

        const validRooms = rooms.filter(r => r.status !== 'blocked');
        const optionsCache = {};

        // Convierte cualquier formato de fecha a yyyy-MM-dd para <input type="date">
        function toInputDate(val) {
            if (!val) return '';
            const s = String(val).trim();
            // ISO: 2026-04-16 o 2026-04-16T00:00:00
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
            // Chileno: 16/04/2026
            if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
                const [d, m, y] = s.split('/');
                return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
            }
            // dd-mm-yyyy
            if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
                const [d, m, y] = s.split('-');
                return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
            }
            // Excel serial numérico
            if (/^\d{4,6}$/.test(s)) {
                try {
                    const d = new Date(Date.UTC(1900, 0, parseInt(s) - 1));
                    return d.toISOString().slice(0, 10);
                } catch(e) { return ''; }
            }
            return '';
        }

        let trs = '';
        (req.workers || []).forEach((w, idx) => {
            try {
            const isAssigned = !!w.assignedRoomStr;
            const isClon = w.assignedRoomStr === 'CLON_RECHAZADO';
            const arrival   = toInputDate(w.arrivalDate);
            const departure = toInputDate(w.departureDate);
            const shiftK = (w.shiftSystem || w.shiftName || '').trim();

            let htmlOptions = '<option value="">-- Dejar Pendiente / Ignorar --</option>';
            if (isClon) {
                htmlOptions = `<option value="clon_rejected" selected>-- IGNORADO: Ya tiene cama --</option>`;
            } else if (isAssigned) {
                htmlOptions += `<option value="already_assigned" selected>-- Ya Asignado Manualmente --</option>`;
            } else {
                const cacheKey = `${w.sex}`; // Solo género como cache key — manual ve todo
                if (!optionsCache[cacheKey]) {
                    let opts = '';
                    let optCount = 0;
                    // Ordenar habitaciones por número para que aparezcan en orden
                    const sorted = [...validRooms].sort((a,b) => parseInt(a.number)-parseInt(b.number));
                    for (const r of sorted) {
                        if (optCount >= 300) break; // Límite amplio para asignación manual
                        // 🔒 Solo filtrar por género (regla de oro siempre aplica)
                        if (r.gender && r.gender !== w.sex) continue;
                        // Si hay ocupantes, verificar que el género no choque
                        const occupiedGender = ['day','night','extra']
                            .map(k => r.beds?.[k]?.occupant ? (r.beds[k].gender || null) : null)
                            .find(Boolean);
                        if (occupiedGender && occupiedGender !== w.sex) continue;

                        const bName = bMap[r.buildingId] || '';
                        // ── Etiqueta según tipo de habitación (solo visual, no bloquea) ──
                        let tag = '';
                        if (r.reservedShift === '4x3')                          tag = ' [4x3]';
                        else if (/noche|night/i.test(r.reservedShift || ''))    tag = ' [🌙 NOCHE]';
                        if (r.reservedCompany)                                   tag += ` [🏢 ${r.reservedCompany}]`;

                        if (!r.beds?.day?.occupant) {
                            opts += `<option value="${r.id}_day">${bName} - # ${r.number} (Cama 1)${tag}</option>`;
                            optCount++;
                        }
                        if ((r.bedCount || 2) >= 2 && !r.beds?.night?.occupant) {
                            opts += `<option value="${r.id}_night">${bName} - # ${r.number} (Cama 2)${tag}</option>`;
                            optCount++;

                        }
                        if ((r.bedCount || 2) >= 3 && !r.beds?.extra?.occupant) {
                            opts += `<option value="${r.id}_extra">${bName} - # ${r.number} (Cama 3)</option>`;
                            optCount++;
                        }
                    }
                    optionsCache[cacheKey] = opts;
                }
                htmlOptions += optionsCache[cacheKey];
            }

            trs += `
                <tr data-worker-idx="${idx}" class="directed-worker-row"
                    style="${isClon ? 'opacity:0.4;pointer-events:none;background:#fff5f5;' : isAssigned ? 'background:#fffbeb;' : ''}">
                    <td style="text-align:center;"><input type="checkbox" class="worker-checkbox" value="${idx}"
                        onchange="window.updateMagicSuggestions()" ${isClon ? 'disabled' : ''}></td>
                    <td>
                        <div style="font-weight:700">${w.name}</div>
                        <div style="font-size:10px;color:var(--text-secondary)">RUT: ${w.rut} • <span style="font-weight:600;color:var(--text-primary)">${req.company}</span>
                        ${isAssigned ? '<span style="color:#d97706;font-weight:700;margin-left:4px">↺ Re-asignar</span>' : ''}</div>
                    </td>
                    <td><span class="tag">${w.shiftName || w.shift || 'N/A'}</span> / ${w.sex}</td>
                    <td>
                        <select class="form-select room-picker" style="max-width:250px">
                            ${htmlOptions}
                        </select>
                    </td>
                    <td><input type="date" class="form-input arrival-input" value="${arrival}"></td>
                    <td><input type="date" class="form-input departure-input" value="${departure}"></td>
                </tr>
            `;
            } catch(e) { console.warn('[directed modal] Error renderizando worker', idx, e); }
        });
        tbody.innerHTML = trs;

        document.getElementById('directed-assignment-modal').classList.add('visible');
    };

    // 🔓 REASIGNAR TODO — limpia los assignedRoomStr y re-abre el modal
    window._resetAllAssignments = async () => {
        const reqId = document.getElementById('directed-req-id').value;
        if (!reqId) return;
        const requests = await getAll('b2b_requests').catch(() => []);
        const req = requests.find(x => x.id == reqId);
        if (!req) return;

        const total = (req.workers || []).length;

        // ── Recolectar los IDs de habitaciones que estaban asignados ──────
        const roomSlotsToFree = {}; // { roomId: Set(['day','night','extra']) }
        (req.workers || []).forEach(w => {
            if (w.assignedRoomStr && w.assignedRoomStr !== 'CLON_RECHAZADO' && w.assignedRoomStr !== 'already_assigned') {
                const [rId, slot] = String(w.assignedRoomStr).split('_');
                if (rId && slot) {
                    if (!roomSlotsToFree[rId]) roomSlotsToFree[rId] = new Set();
                    roomSlotsToFree[rId].add(slot);
                }
            }
        });

        // ── Limpiar las camas en las habitaciones ─────────────────────────
        const allRooms = await getAll('rooms').catch(() => []);
        const roomsToSave = [];
        for (const room of allRooms) {
            const slots = roomSlotsToFree[String(room.id)];
            if (!slots) continue;
            if (!room.beds) room.beds = {};
            slots.forEach(slot => { room.beds[slot] = {}; });
            // Si todas las camas quedan vacías, marcar la habitación como libre
            const anyOccupied = ['day','night','extra'].some(k => room.beds[k]?.occupant);
            if (!anyOccupied) { room.status = 'free'; room.gender = null; }
            roomsToSave.push(room);
        }
        if (roomsToSave.length > 0) {
            await Promise.all(roomsToSave.map(r => put('rooms', r)));
        }

        // ── Limpiar asignaciones en la solicitud ──────────────────────────
        req.workers.forEach(w => { w.assignedRoomStr = null; });
        req.status = 'accepted';
        await put('b2b_requests', req);

        showToast(`🔓 ${total} trabajadores listos · ${roomsToSave.length} habitaciones liberadas`, 'success');
        window.closeDirectedAssignmentModal();
        setTimeout(() => window.openDirectedAssignmentModal(reqId), 150);
    };

    window.toggleAllDirectedWorkers = (checked) => {
        const checkboxes = document.querySelectorAll('#directed-workers-tbody .worker-checkbox:not([disabled])');
        checkboxes.forEach(cb => cb.checked = checked);
        window.updateMagicSuggestions();
    };

    window.updateMagicSuggestions = async () => {
        const checkboxes = document.querySelectorAll('#directed-workers-tbody .worker-checkbox:checked:not([disabled])');
        const box = document.getElementById('magic-suggestion-box');
        const textBox = document.getElementById('magic-suggestion-text');

        // ── Actualizar contador en barra sticky ──────────────────────────────
        const stickyCount = document.getElementById('sticky-worker-count');
        if (stickyCount) {
            stickyCount.textContent = checkboxes.length > 0
                ? `✅ ${checkboxes.length} marcados — Elige rango ↑ y presiona ⚡ Inyectar`
                : 'Selecciona trabajadores y elige rango ↑';
        }

        if (checkboxes.length === 0) {
            box.style.display = 'none';
            return;
        }

        const reqId = document.getElementById('directed-req-id').value;
        const requests = await getAll('b2b_requests').catch(() => []);
        const req = requests.find(x => x.id == reqId);
        if (!req) return;

        const selectedWorkers = [];
        checkboxes.forEach(cb => {
            selectedWorkers.push(req.workers[cb.value]);
        });

        const shiftCounts = {};
        let dominantShift = '';
        let maxCount = 0;
        selectedWorkers.forEach(w => {
            const s = (w.shiftSystem || w.shiftName || '').trim();
            shiftCounts[s] = (shiftCounts[s] || 0) + 1;
            if (shiftCounts[s] > maxCount) {
                maxCount = shiftCounts[s];
                dominantShift = s;
            }
        });

        const genderCounts = {};
        let dominantSex = '';
        let maxSCount = 0;
        selectedWorkers.forEach(w => {
            genderCounts[w.sex] = (genderCounts[w.sex] || 0) + 1;
            if (genderCounts[w.sex] > maxSCount) {
                maxSCount = genderCounts[w.sex];
                dominantSex = w.sex;
            }
        });

        const bedsNeeded = selectedWorkers.length;
        const roomsNeeded = Math.ceil(bedsNeeded / 2);

        const roomsData = await getAll('rooms');
        const buildings = await getAll('buildings');
        
        const buildingStats = {};
        buildings.forEach(b => {
             buildingStats[b.id] = { bName: b.name, bId: b.id,  rooms: [] };
        });

        const targetBuildingId = document.getElementById('bulk-range-building').value;
        const targetFloor = document.getElementById('bulk-range-floor')?.value || '';

        roomsData.forEach(r => {
            if (r.status === 'blocked') return;
            if (r.reservedCompany && r.reservedCompany.toLowerCase() !== req.company.toLowerCase()) return;
            if (r.reservedShift && r.reservedShift.toLowerCase() !== dominantShift.toLowerCase()) return;
            if (r.gender && r.gender !== dominantSex) return;
            // Filtrar por edificio si se seleccionó
            if (targetBuildingId && String(r.buildingId) !== String(targetBuildingId)) return;
            // Filtrar por piso si se seleccionó
            if (targetFloor && String(r.floor) !== String(targetFloor)) return;

            const dayOc  = r.beds?.day?.occupant;
            const nightOc = r.beds?.night?.occupant;
            if (dayOc || nightOc) {
                 if (r.gender && r.gender !== dominantSex) return;
                 const comp1 = r.beds?.day?.company || '';
                 const comp2 = r.beds?.night?.company || '';
                 if (comp1 && comp1.toLowerCase() !== req.company.toLowerCase()) return;
                 if (comp2 && comp2.toLowerCase() !== req.company.toLowerCase()) return;
            }
            
            let free = 0;
            if (!r.beds?.day?.occupant) free++;
            if ((r.bedCount || 2) >= 2 && !r.beds?.night?.occupant) free++;
            if ((r.bedCount || 2) >= 3 && !r.beds?.extra?.occupant) free++;
            
            if (free > 0 && buildingStats[r.buildingId]) {
                if (targetBuildingId && String(r.buildingId) !== String(targetBuildingId)) return;
                buildingStats[r.buildingId].rooms.push({ num: parseInt(r.number), free });
            }
        });

        let bestBuilding = null;
        let bestRange = null;

        for (const bId in buildingStats) {
            const b = buildingStats[bId];
            b.rooms.sort((x, y) => x.num - y.num);
            
            for (let i = 0; i < b.rooms.length; i++) {
                let accumulatedBeds = 0;
                let j = i;
                while (j < b.rooms.length && accumulatedBeds < bedsNeeded) {
                    accumulatedBeds += b.rooms[j].free;
                    j++;
                }
                if (accumulatedBeds >= bedsNeeded) {
                   bestBuilding = b;
                   bestRange = { start: b.rooms[i].num, end: b.rooms[j-1].num };
                   break; 
                }
            }
            if (bestRange) break; 
        }

        if (bestRange) {
            textBox.innerHTML = `📌 <b>${selectedWorkers.length} marcados</b> (Mayoritario: <b>${dominantShift || 'Sin Turno'} ${dominantSex}</b>). Necesitas <b>${bedsNeeded} camas</b>.<br>
                                 ¡Hay disponibilidad exacta en el <b>${bestBuilding.bName}</b>!`;
            
            const btn = document.getElementById('magic-suggestion-btn');
            btn.style.display = 'block';
            btn.innerHTML = `💡 Rellenar: ${bestRange.start} a ${bestRange.end}`;
            btn.onclick = () => window.applySuggestion(bestBuilding.bId, bestRange.start, bestRange.end);
            
            box.style.background = '#ebf8ff';
            box.style.borderColor = '#bee3f8';
            textBox.style.color = '#2b6cb0';
        } else {
            textBox.innerHTML = `📌 <b>${selectedWorkers.length} marcados</b> (Mayoritario: <b>${dominantShift || 'Sin Turno'} ${dominantSex}</b>). Necesitas <b>${bedsNeeded} camas</b>.<br>
                                 ⚠️ No se encontró un bloque ideal. Intenta buscar manualmente.`;
            document.getElementById('magic-suggestion-btn').style.display = 'none';
            
            box.style.background = '#fff5f5';
            box.style.borderColor = '#feb2b2';
            textBox.style.color = '#c53030';
        }

        box.style.display = 'flex';
    };

    window.applySuggestion = (bId, start, end) => {
         document.getElementById('bulk-range-building').value = bId;
         document.getElementById('bulk-range-start').value = start;
         document.getElementById('bulk-range-end').value = end;

         ['bulk-range-building', 'bulk-range-start', 'bulk-range-end'].forEach(id => {
             const el = document.getElementById(id);
             if (el) { el.style.boxShadow = '0 0 0 3px rgba(66,153,225,0.5)'; setTimeout(() => el.style.boxShadow = 'none', 1000); }
         });
    };

    window.applyRangeAssignment = async () => {
        const bId   = document.getElementById('bulk-range-building').value;
        const start = parseInt(document.getElementById('bulk-range-start').value);
        const end   = parseInt(document.getElementById('bulk-range-end').value);
        const rangeOk = bId && !isNaN(start) && !isNaN(end) && start <= end;

        const checkboxes = document.querySelectorAll('#directed-workers-tbody .worker-checkbox:checked:not([disabled])');
        if (checkboxes.length === 0) {
            showToast('No ha marcado a ningún trabajador en la tabla.', 'warn');
            return;
        }

        const reqId    = document.getElementById('directed-req-id').value;
        const requests = await getAll('b2b_requests').catch(() => []);
        const req      = requests.find(x => x.id == reqId);
        if (!req) return;

        // Verificar si los marcados tienen habitación del Excel
        const workerIdxs = Array.from(checkboxes).map(cb => parseInt(cb.value));
        const selectedWorkers = workerIdxs.map(i => req.workers[i]).filter(Boolean);
        const conHabExcel = selectedWorkers.filter(w => w.assignedRoom).length;

        // Si ningún trabajador tiene hab. del Excel Y no hay rango → pedir rango
        if (!rangeOk && conHabExcel === 0) {
            showToast('Por favor seleccione un Pabellón y un rango válido (Desde ≤ Hasta).', 'warn');
            return;
        }
        // Si algunos tienen hab. pero no todos y no hay rango → advertir pero continuar
        if (!rangeOk && conHabExcel < selectedWorkers.length) {
            showToast(`⚡ ${conHabExcel} trabajadores tienen hab. de Excel → asignando directo. ${selectedWorkers.length - conHabExcel} sin habitación quedarán pendientes.`, 'info');
        }

        const roomsData   = await getAll('rooms');
        const targetFloor = document.getElementById('bulk-range-floor')?.value || '';

        // ── 1. Candidatos según rango / campamento completo ─────────────────
        const candidates = !rangeOk ? [] : roomsData.filter(r =>
            String(r.buildingId) === String(bId) &&
            parseInt(r.number) >= start &&
            parseInt(r.number) <= end &&
            r.status !== 'blocked' &&
            (!targetFloor || String(r.floor) === String(targetFloor))
        ).sort((a, b) => parseInt(a.number) - parseInt(b.number));

        // ── 2. Estado efectivo de cada habitación ─────────────────────────
        // Leer el género real desde las camas, no desde r.gender (puede estar desactualizado)
        const roomState = {}; // roomId → { gender: 'M'|'F'|null, company: string|null, beds: [{slot, val}] }
        for (const r of candidates) {
            const occupiedGenders  = ['day', 'night', 'extra']
                .map(k => r.beds?.[k]?.occupant ? (r.beds[k].gender || r.gender || null) : null)
                .filter(Boolean);
            const occupiedCompanies = ['day', 'night', 'extra']
                .map(k => r.beds?.[k]?.company || null)
                .filter(Boolean);

            const effectiveGender  = occupiedGenders[0]   || null; // null = habitación vacía
            const effectiveCompany = occupiedCompanies[0] || null;

            const freeBeds = [];
            if (!r.beds?.day?.occupant) freeBeds.push({ slot: 'day',   val: `${r.id}_day` });
            if ((r.bedCount||2) >= 2 && !r.beds?.night?.occupant) freeBeds.push({ slot: 'night', val: `${r.id}_night` });
            if ((r.bedCount||2) >= 3 && !r.beds?.extra?.occupant) freeBeds.push({ slot: 'extra', val: `${r.id}_extra` });

            if (freeBeds.length > 0) {
                roomState[r.id] = {
                    roomNum: r.number,
                    gender:  effectiveGender,   // null si vacía
                    company: effectiveCompany,  // null si vacía
                    beds:    freeBeds,
                    reservedCompany: r.reservedCompany || null,
                    reservedShift:   r.reservedShift   || null,
                };
            }
        }

        // ── 3. Obtener trabajadores marcados ──────────────────────────────
        const workers = [];
        checkboxes.forEach(cb => {
            const idx    = parseInt(cb.value);
            const worker = req.workers[idx];
            const row    = document.querySelector(`.directed-worker-row[data-worker-idx="${idx}"]`);
            const picker = row?.querySelector('.room-picker');
            if (worker && picker) workers.push({ idx, worker, row, picker });
        });

        const workerCompany = req.company.toLowerCase();

        // ── 4a. roomState del RANGO (preferencia) ──────────────────────────
        // ── 4b. roomState GLOBAL como fallback (todo el campamento) ────────
        const roomStateAll = {}; // para cuando el rango no tiene camas del género correcto
        const usedRoomIds  = new Set(Object.keys(roomState).map(String));

        for (const r of roomsData) {
            if (r.status === 'blocked') continue;
            if (usedRoomIds.has(String(r.id))) continue; // ya está en roomState

            const occupiedGenders = ['day', 'night', 'extra']
                .map(k => r.beds?.[k]?.occupant ? (r.beds[k].gender || r.gender || null) : null)
                .filter(Boolean);
            const occupiedCompanies = ['day', 'night', 'extra']
                .map(k => r.beds?.[k]?.company || null)
                .filter(Boolean);

            const freeBeds = [];
            if (!r.beds?.day?.occupant) freeBeds.push({ slot: 'day',   val: `${r.id}_day` });
            if ((r.bedCount||2) >= 2 && !r.beds?.night?.occupant) freeBeds.push({ slot: 'night', val: `${r.id}_night` });
            if ((r.bedCount||2) >= 3 && !r.beds?.extra?.occupant) freeBeds.push({ slot: 'extra', val: `${r.id}_extra` });

            if (freeBeds.length > 0) {
                roomStateAll[r.id] = {
                    roomNum: r.number,
                    gender:  occupiedGenders[0] || null,
                    company: occupiedCompanies[0] || null,
                    beds:    freeBeds,
                    reservedCompany: r.reservedCompany || null,
                    reservedShift:   r.reservedShift   || null,
                    outOfRange: true,
                };
            }
        }

        // ── 5. Función de asignación ──────────────────────────────────────
        // Busca cama compatible. En modo fallback (isLastResort) ignora
        // empresa/turno para garantizar que nadie quede sin habitación.
        function findBed(wSex, wShift, stateMap, isLastResort = false) {
            for (const [rId, rs] of Object.entries(stateMap)) {
                if (rs.beds.length === 0) continue;
                // 🔒 GÉNERO: no mezclar nunca
                if (rs.gender && rs.gender !== wSex) continue;
                // En modo normal verificar empresa/turno; en modo emergencia solo género
                if (!isLastResort) {
                    if (rs.reservedCompany && rs.reservedCompany.toLowerCase() !== workerCompany) continue;
                    if (rs.reservedShift && rs.reservedShift.toLowerCase() !== (wShift || '').toLowerCase()) continue;
                    if (rs.company && rs.company.toLowerCase() !== workerCompany) continue;
                }

                const bed = rs.beds.shift();
                rs.gender  = wSex;
                rs.company = workerCompany;
                return { val: bed.val, slot: bed.slot, roomNum: rs.roomNum, outOfRange: !!rs.outOfRange };
            }
            return null;
        }

        // ── 6. Agrupar por género y asignar ──────────────────────────────
        // Ordenar: el grupo más numeroso primero para maximizar uso de hab.
        const byGender = {};
        workers.forEach(w => {
            const sex = w.worker.sex || 'M';
            if (!byGender[sex]) byGender[sex] = [];
            byGender[sex].push(w);
        });

        // Procesar géneros de mayor a menor grupo (más gente primero)
        const genderOrder = Object.keys(byGender).sort((a, b) => byGender[b].length - byGender[a].length);

        let successCount  = 0;
        let failCount     = 0;
        let outOfRangeCount = 0;

        for (const sex of genderOrder) {
            const group = byGender[sex];

            for (const { worker, row, picker } of group) {
                const wSex    = worker.sex || 'M';
                const wShiftK = (worker.shiftSystem || worker.shiftName || '').trim().toLowerCase();

                let bed = null;

                // ── 🎯 PRIORIDAD 0: habitación específica definida en el Excel ──────
                // Si el Excel tenía HABITACION = 4101, ir DIRECTO a esa habitación.
                // Solo cae al auto-assign si la habitación está llena/bloqueada/género.
                if (worker.assignedRoom) {
                    const targetNum = String(worker.assignedRoom).trim();
                    const specificRoom = roomsData.find(r =>
                        String(r.number) === targetNum ||
                        parseInt(r.number, 10) === parseInt(targetNum, 10)
                    );
                    if (specificRoom) {
                        const rId  = String(specificRoom.id);
                        const rs   = roomState[rId] || roomStateAll[rId];
                        if (rs && rs.beds.length > 0 && (!rs.gender || rs.gender === wSex)) {
                            const bedObj = rs.beds.shift();
                            rs.gender  = wSex;
                            rs.company = workerCompany;
                            bed = { val: bedObj.val, slot: bedObj.slot, roomNum: rs.roomNum, outOfRange: false };
                        } else if (!rs) {
                            console.warn(`[Solicitudes] Hab. ${targetNum} no disponible para ${worker.name} (llena o sin camas libres)`);
                        }
                    } else {
                        console.warn(`[Solicitudes] Hab. ${targetNum} no encontrada en DB para ${worker.name}`);
                    }
                }

                // ── 1️⃣ Auto-assign en el rango ────────────────────────────────────
                if (!bed) bed = findBed(wSex, wShiftK, roomState);

                // ── 2️⃣ Fallback campamento completo ──────────────────────────────
                if (!bed) bed = findBed(wSex, wShiftK, roomStateAll);

                // ── 3️⃣ Último recurso (solo género) ──────────────────────────────
                if (!bed) bed = findBed(wSex, wShiftK, roomStateAll, true);
                if (!bed) bed = findBed(wSex, wShiftK, roomState,    true);

                if (bed) {
                    let optionExists = Array.from(picker.options).find(opt => opt.value === bed.val);
                    if (!optionExists) {
                        const newOpt   = document.createElement('option');
                        newOpt.value   = bed.val;
                        const bedLabel = bed.slot === 'day' ? 'Cama 1' : bed.slot === 'night' ? 'Cama 2' : 'Cama 3';
                        const prefix   = bed.outOfRange ? '[Fuera de Rango] ' : '';
                        newOpt.textContent = `${prefix}# ${bed.roomNum} (${bedLabel})`;
                        picker.appendChild(newOpt);
                    }
                    picker.value = bed.val;
                    row.style.background = bed.outOfRange ? '#fefcbf' : '#e6fffa';
                    setTimeout(() => row.style.background = '', 1500);
                    successCount++;
                    if (bed.outOfRange) outOfRangeCount++;
                } else {
                    row.style.background = '#fff5f5';
                    setTimeout(() => row.style.background = '', 1500);
                    failCount++;
                }
            }
        }

        if (failCount === 0 && outOfRangeCount === 0 && !rangeOk) {
            // MODO EXCEL: Inyectar + Guardar automático en un solo paso
            showToast(`⏳ Guardando ${successCount} habitaciones del Excel...`, 'info');
            setTimeout(() => window.saveDirectedAssignment(), 200);
        } else if (failCount === 0 && outOfRangeCount === 0) {
            showToast(`✅ ¡${successCount} trabajadores pre-seleccionados! Presiona 💾 Guardar para confirmar.`, 'success');
        } else if (failCount === 0 && outOfRangeCount > 0) {
            showToast(`✅ ${successCount} pre-seleccionados — ${outOfRangeCount} fuera del rango. Presiona 💾 Guardar para confirmar.`, 'warn');
        } else if (successCount > 0) {
            showToast(`⚠️ ${successCount} pre-seleccionados. ${failCount} sin cama disponible. Presiona 💾 Guardar.`, 'warn');
        } else {
            showToast('🚨 Sin camas disponibles. Revisa si hay habitaciones bloqueadas o el campamento está lleno.', 'error');
        }

        document.querySelector('#directed-assignment-modal th input[type="checkbox"]').checked = false;
    };

    window.closeDirectedAssignmentModal = () => document.getElementById('directed-assignment-modal').classList.remove('visible');

    window.saveDirectedAssignment = async () => {
        const reqId = document.getElementById('directed-req-id').value;
        const requests = await Promise.all([getAll('b2b_requests')]).then(r=>r[0]);
        const req = requests.find(x => x.id == reqId);
        if(!req) return;

        // 🔥 INYECTADO: ANTI-CLONES AL GUARDAR MANUAL DIRIGIDO 🔥
        const roomsData = await getAll('rooms');
        const existingRuts = new Set();
        roomsData.forEach(r => {
            ['day', 'night', 'extra'].forEach(k => {
                if (r.beds && r.beds[k] && r.beds[k].occupant && r.beds[k].rut) {
                    existingRuts.add(String(r.beds[k].rut || "").replace(/[^0-9Kk]/g, '').toUpperCase());
                }
            });
        });

        const tbody = document.getElementById('directed-workers-tbody');
        const rows = tbody.querySelectorAll('.directed-worker-row');
        
        let assignedCount = 0;
        let clonesEvitados = 0; // 🔥 Contador de clones bloqueados
        const roomsToUpdate = {};

        let genderBlocked = 0;
        let skippedAny = false;

        rows.forEach(row => {
            const idx = row.getAttribute('data-worker-idx');
            const worker = req.workers[idx];
            // ✅ Permitir reasignación (no bloquear workers con assignedRoomStr previo)

            const picker = row.querySelector('.room-picker').value;
            const arrival = row.querySelector('.arrival-input').value;
            const departure = row.querySelector('.departure-input').value;

            // Solo saltar si el picker está vacío o es un marcador especial SIN valor real
            if (!picker || picker === 'clon_rejected') {
                skippedAny = true;
                return;
            }
            // Si sigue diciendo 'already_assigned' sin cambiar → saltar
            if (picker === 'already_assigned') {
                skippedAny = true;
                return;
            }

            // 🔥 VERIFICACIÓN ANTI-CLONES ANTES DE ASIGNAR
            if (worker.rut) {
                const cleanWorkerRut = String(worker.rut).replace(/[^0-9Kk]/g, '').toUpperCase();
                if (existingRuts.has(cleanWorkerRut)) {
                    worker.assignedRoomStr = 'CLON_RECHAZADO';
                    clonesEvitados++;
                    return;
                }
                existingRuts.add(cleanWorkerRut);
            }

            const [roomId, bedKey] = picker.split('_');
            const r = roomsToUpdate[roomId] || roomsData.find(x => String(x.id) === roomId);
            if (r) {
                // 🔒 VALIDACIÓN DE GÉNERO — REGLA DE ORO: una habitación = un solo género
                const bedsWithOccupant = ['day', 'night', 'extra']
                    .map(k => r.beds?.[k]?.occupant ? (r.beds[k].gender || null) : null)
                    .filter(Boolean);
                const effectiveRoomGender = bedsWithOccupant[0] || r.gender || null;

                if (effectiveRoomGender && effectiveRoomGender !== worker.sex) {
                    // ⛔ Conflicto de género — NO asignar
                    console.warn(`[GÉNERO] Bloqueado: ${worker.name} (${worker.sex}) → Hab. ${r.number} ya tiene género ${effectiveRoomGender}`);
                    genderBlocked++;
                    skippedAny = true;
                    return;
                }

                worker.assignedRoomStr = `${roomId}_${bedKey}`; 
                worker.arrivalDate = arrival;
                worker.departureDate = departure;
                
                r.beds[bedKey] = {
                    occupant:       worker.name,
                    company:        req.company,
                    shift:          worker.shiftName || worker.shift || '',
                    arrivalDate:    arrival,
                    departureDate:  departure,
                    gender:         worker.sex,
                    rut:            worker.rut,
                    contact:        worker.contact || '',
                    management:     worker.management || worker.gerencia || req.gerencia || '',
                    contractNumber: req.contractNumber || worker.contract || ''
                };
                r.status = 'occupied';
                r.gender = worker.sex;
                roomsToUpdate[r.id] = r;
                assignedCount++;
            }
        });

        // ── Información sin bloquear ────────────────────────────────────────
        if (assignedCount === 0 && clonesEvitados === 0) {
            showToast('⚠️ Ninguna cama fue seleccionada. Usa ⚡ Inyectar primero y luego Guardar.', 'warn');
            return;
        }

        // ── Guardar en paralelo — todos a la vez ────────────────────────────
        const saveBtns = document.querySelectorAll('#directed-assignment-modal button');
        saveBtns.forEach(b => { if (b.textContent.includes('Guardar')) { b.disabled = true; b.textContent = '⏳ Guardando...'; } });

        try {
            await Promise.all(Object.values(roomsToUpdate).map(r => put('rooms', r)));
            await put('b2b_requests', req);
        } catch(saveErr) {
            console.error('[Save] Error guardando:', saveErr);
            showToast('⚠️ Error al guardar — intenta de nuevo', 'error');
            saveBtns.forEach(b => { if (b.textContent.includes('Guardando')) { b.disabled = false; b.textContent = '💾 Guardar Asignaciones'; } });
            return;
        }

        // 🔄 Actualizar caché de infraestructura
        if (window._allRooms) {
            for (const id in roomsToUpdate) {
                const idx = window._allRooms.findIndex(r => String(r.id) === String(id));
                if (idx !== -1) window._allRooms[idx] = roomsToUpdate[id];
                else window._allRooms.push(roomsToUpdate[id]);
            }
        }
        window.dispatchEvent(new CustomEvent('rooms-updated'));

        const anyUnassigned = req.workers.some(w => !w.assignedRoomStr);
        if (!anyUnassigned) req.status = 'assigned';

        showToast(`✅ ${assignedCount} asignaciones guardadas${clonesEvitados > 0 ? ` · 🛡️ ${clonesEvitados} clones bloqueados` : ''}`, 'success');
        window.closeDirectedAssignmentModal();
        await renderSolicitudes(document.getElementById('page-content'));
    };

    window.runAssignment = async () => {
        if (assignmentRunning) return;
        assignmentRunning = true;
        document.getElementById('run-assignment-btn').disabled = true;
        document.getElementById('run-assignment-btn').textContent = '⏳ Procesando...';
        document.getElementById('assignment-footer').style.display = 'none';
        document.getElementById('assignment-progress').style.display = 'block';

        const steps = [
            { id: 'prog-1', width: '100%', duration: 600 },
            { id: 'prog-2', width: '100%', duration: 900 },
            { id: 'prog-3', width: '100%', duration: 700 },
            { id: 'prog-4', width: '100%', duration: 500 },
        ];

        for (const step of steps) {
            await new Promise(r => setTimeout(r, 200));
            const el = document.getElementById(step.id);
            if (el) { el.style.transitionDuration = step.duration + 'ms'; el.style.width = step.width; }
            await new Promise(r => setTimeout(r, step.duration + 50));
        }

        const [rooms, requests, buildings] = await Promise.all([
            getAll('rooms'),
            getAll('b2b_requests'),
            getAll('buildings')
        ]);

        const pendingRequests = requests.filter(r => r.status === 'pending' || r.status === 'accepted');
        let totalAssigned = 0;
        let successfulAssignments = [];
        let warnings = [];

        const workerGroups = {};
        pendingRequests.forEach(req => {
            (req.workers || []).forEach(w => {
                if (w.assignedRoomStr) return; 
                const shiftKey = (w.shiftSystem || w.shiftName || 'Unknown').trim();
                const key = `${w.sex}_${req.company}_${shiftKey}`;
                if (!workerGroups[key]) workerGroups[key] = [];
                workerGroups[key].push({ ...w, company: req.company, requestId: req.id, shiftKey });
            });
        });

        for (const [groupKey, groupWorkers] of Object.entries(workerGroups)) {
            const [sex, company, shiftK] = groupKey.split('_');
            const isAnglo = company.toLowerCase().includes('anglo');
            
            while (groupWorkers.length > 0) {
                let candidates = rooms.filter(r => {
                    if (r.status === 'blocked') return false;
                    if (r.gender && r.gender !== sex) return false;
                    if (r.reservedCompany && r.reservedCompany.toLowerCase() !== company.toLowerCase()) return false;
                    if (r.reservedShift && r.reservedShift.toLowerCase() !== shiftK.toLowerCase()) return false;
                    return !r.beds.day?.occupant || (r.beds.night && !r.beds.night.occupant);
                });

                candidates.sort((a, b) => {
                    const aFree = !a.beds.day?.occupant && !a.beds.night?.occupant;
                    const bFree = !b.beds.day?.occupant && !b.beds.night?.occupant;
                    const aResComp = a.reservedCompany && a.reservedCompany.toLowerCase() === company.toLowerCase();
                    const bResComp = b.reservedCompany && b.reservedCompany.toLowerCase() === company.toLowerCase();
                    const aResShift = a.reservedShift && a.reservedShift.toLowerCase() === shiftK.toLowerCase();
                    const bResShift = b.reservedShift && b.reservedShift.toLowerCase() === shiftK.toLowerCase();

                    let scoreA = (aResComp ? 10000 : 0) + (aResShift ? 5000 : 0) + (aFree && groupWorkers.length >= 2 ? 1000 : 0) + (a.gender === sex ? 100 : 0);
                    let scoreB = (bResComp ? 10000 : 0) + (bResShift ? 5000 : 0) + (bFree && groupWorkers.length >= 2 ? 1000 : 0) + (b.gender === sex ? 100 : 0);

                    return scoreB - scoreA;
                });

                if (candidates.length === 0) {
                    const fail = groupWorkers.shift();
                    warnings.push(`❌ SIN CUPO: ${fail.name} (${company}, Turno: ${shiftK}). No hay habitaciones disponibles.`);
                    continue;
                }

                const room = candidates[0];
                const bInfo = buildings.find(x => x.id === room.buildingId) || {name: 'N/A'};
                
                const maxSlotsForThisGroup = isAnglo ? 1 : 2; 
                const slots = ['day', 'night'];
                let slotsUsed = 0;

                for (const slotKey of slots) {
                    if (groupWorkers.length === 0) break;
                    if (slotsUsed >= maxSlotsForThisGroup) break;
                    if (!room.beds[slotKey] || room.beds[slotKey].occupant) continue;

                    const worker = groupWorkers.shift();
                    room.beds[slotKey] = {
                        occupant: worker.name,
                        company: company,
                        shift: shiftK,
                        gender: sex,
                        rut: worker.rut,
                        contact: worker.contact || '',
                        arrivalDate: worker.arrivalDate,
                        departureDate: worker.departureDate
                    };
                    room.status = 'occupied';
                    room.gender = sex;
                    slotsUsed++;

                    successfulAssignments.push({
                        name: worker.name, rut: worker.rut, building: bInfo.name,
                        room: room.number, bed: slotKey === 'day' ? 'Cama A' : 'Cama B',
                        start: worker.arrivalDate, end: worker.departureDate,
                        company: worker.company
                    });
                    totalAssigned++;
                    
                    await put('rooms', room);
                        
                    const sourceReq = requests.find(r => r.id === worker.requestId);
                    if (sourceReq) {
                        const actualWorker = sourceReq.workers.find(wx => wx.rut === worker.rut);
                        if (actualWorker) {
                            actualWorker.assignedRoomStr = `${room.id}_${slotKey}`;
                        }
                    }
                }
            }
        }

        for (const req of pendingRequests) {
            req.status = 'assigned';
            await put('b2b_requests', req);
        }

        await addToSyncQueue({ type: 'assignment', timestamp: new Date().toISOString(), count: totalAssigned });

        const result = document.getElementById('assignment-result');
        result.style.display = 'block';
        
        let reportHtml = `
            <div style="text-align:left; margin-bottom:15px; border-bottom: 2px solid var(--red-600); padding-bottom: 10px;">
                <div style="font-size:18px; font-weight:800; color:var(--red-600)">REPORTAJE DE ASIGNACIÓN ARAMARK</div>
                <div style="font-size:12px; color:var(--text-secondary)">Fecha Proceso: ${new Date().toLocaleString()}</div>
            </div>
            
            <div style="max-height:300px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; margin-bottom:15px; background: white;">
                <table class="worker-table" style="font-size:11px; width: 100%;">
                    <thead>
                        <tr style="background:var(--bg-page); position: sticky; top: 0; z-index: 10;">
                            <th style="padding: 10px;">Trabajador</th>
                            <th>Pabellón</th>
                            <th>Hab.</th>
                            <th>Cama</th>
                            <th>Periodo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${successfulAssignments.map(a => `
                            <tr>
                                <td style="padding: 8px;"><strong>${a.name}</strong><br><small style="color:var(--text-secondary)">${a.rut}</small></td>
                                <td>${a.building}</td>
                                <td style="text-align:center; font-weight: 700;">${a.room}</td>
                                <td>${a.bed}</td>
                                <td style="font-size: 10px;">${toChileanDate(a.start)} <br> ${toChileanDate(a.end)}</td>
                            </tr>
                        `).join('')}
                        ${successfulAssignments.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No se realizaron nuevas asignaciones.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;

        if (warnings.length > 0) {
            reportHtml += `
                <div style="background:#fffaf0; border:1px solid #feebc8; padding:10px; border-radius:8px; margin-bottom:15px; text-align:left">
                    <div style="font-weight:700; color:#9c4221; font-size:12px; margin-bottom:4px">⚠️ Observaciones del Proceso (${warnings.length}):</div>
                    <div style="font-size:11px; color:#7b341e; line-height:1.4; max-height: 80px; overflow-y: auto;">
                        ${warnings.slice(0,10).join('<br>')} ${warnings.length > 10 ? `<br>...y ${warnings.length - 10} más.` : ''}
                    </div>
                </div>
            `;
        }

        reportHtml += `
            <div style="display:flex; gap:10px">
                <button class="btn btn-secondary btn-sm btn-full" id="btn-download-excel">
                    📂 Descargar Reporte Excel Pro
                </button>
            </div>
        `;

        result.innerHTML = reportHtml;
        
        document.getElementById('btn-download-excel')?.addEventListener('click', () => {
            window.downloadProAssignmentExcel(successfulAssignments);
        });

        document.getElementById('assignment-footer').style.display = 'flex';
        document.getElementById('run-assignment-btn').textContent = '✅ Procesado';
        assignmentRunning = false;
        showToast(`Proceso finalizado: ${totalAssigned} asignados, ${warnings.length} fallidos`, warnings.length > 0 ? 'info' : 'success');
        
        renderSolicitudes(document.getElementById('page-content'));
    };

    window.forceCleanupMaintenance = async () => {
        const { cleanupExpiredAssignments } = await import('../db.js');
        const cleaned = await cleanupExpiredAssignments();
        if (cleaned > 0) {
            showToast(`Limpieza completada: ${cleaned} camas liberadas`, 'success');
            setTimeout(() => location.reload(), 800);
        } else {
            showToast('No hay asignaciones vencidas para liberar', 'info');
        }
    };

    window.syncAramarkReservations = async () => {
        const { ensureAramarkReservations } = await import('../db.js');
        await ensureAramarkReservations();
        showToast('Pabellones P-1, P-2 y P-3 sincronizados para Aramark', 'success');
        location.reload();
    };
}

window.downloadProAssignmentExcel = (data) => {
    if (!data || data.length === 0) { showToast('No hay datos para exportar', 'warn'); return; }
    
    try {
        const wsData = [
            ["ARAMARK - REPORTE OFICIAL DE ASIGNACIÓN DE ALOJAMIENTO"],
            ["Generado por:", "Sistema PC Hotelería"],
            ["Fecha de Emisión:", new Date().toLocaleString()],
            [],
            ["TRABAJADOR", "RUT", "EMPRESA", "PABELLÓN", "HABITACIÓN", "CAMA", "FECHA INGRESO", "FECHA SALIDA"]
        ];
        
        data.forEach(a => {
            wsData.push([a.name, a.rut, a.company, a.building, a.room, a.bed, toChileanDate(a.start), toChileanDate(a.end)]);
        });
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        
        ws['!cols'] = [
            {wch: 35}, {wch: 15}, {wch: 30}, {wch: 25}, {wch: 15}, {wch: 25}, {wch: 15}, {wch: 15}
        ];
        
        XLSX.utils.book_append_sheet(wb, ws, "Asignaciones Aramark");
        XLSX.writeFile(wb, `Reporte_Aramark_${new Date().toISOString().split('T')[0]}.xlsx`);
        showToast('Reporte Excel generado correctamente', 'success');
    } catch(e) {
        console.error(e);
        showToast('Error al generar Excel', 'error');
    }
};

// 🔥 REPARADO: LIMPIEZA TOTAL BLINDADA 🔥
window.limpiarTodasAsignaciones = async () => {
    if (!confirm('⚠️ ATENCIÓN: Esto borrará a TODOS los trabajadores asignados actualmente en las habitaciones. ¿Desea continuar?')) return;
    
    showToast('Limpiando sistema completamente...', 'info');

    const [rooms, reqs] = await Promise.all([
        getAll('rooms'),
        getAll('b2b_requests')
    ]);

    rooms.forEach(r => {
        if (r.beds) {
            if (r.beds.day)   r.beds.day   = { occupant: null, arrivalDate: null, departureDate: null, company: null, shift: null, rut: null, gender: null };
            if (r.beds.night) r.beds.night = { occupant: null, arrivalDate: null, departureDate: null, company: null, shift: null, rut: null, gender: null };
            if (r.beds.extra) r.beds.extra = { occupant: null, arrivalDate: null, departureDate: null, company: null, shift: null, rut: null, gender: null };
        }
        r.status = r.status === 'blocked' ? 'blocked' : 'free';
        r.gender = null;
    });

    reqs.forEach(rq => {
        if(rq.workers) {
            rq.workers.forEach(w => w.assignedRoomStr = null);
        }
        rq.status = 'pending';
        rq.assignedAt = null;
    });

    try {
        const promises = [];
        rooms.forEach(r => promises.push(put('rooms', r)));
        reqs.forEach(rq => promises.push(put('b2b_requests', rq)));
        await Promise.all(promises);
        
        showToast('Sistema reseteado: todas las camas están libres ahora.', 'success', 2000);
        await renderSolicitudes(document.getElementById('page-content'));
    } catch(e) {
        console.error(e);
        showToast('Error al limpiar base de datos', 'error');
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 📥  DESCARGAR EXCEL DE UNA SOLICITUD ESPECÍFICA
// Genera un Excel corporativo Aramark con los datos completos de la solicitud
// ─────────────────────────────────────────────────────────────────────────────
window.downloadSolicitudExcel = async (reqId) => {
    try {
        // Cargar ExcelJS si no está disponible
        if (typeof ExcelJS === 'undefined') {
            showToast('⏳ Cargando generador Excel...', 'info');
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
                s.onload = resolve; s.onerror = reject;
                document.head.appendChild(s);
            });
        }

        const requests = await getAll('b2b_requests');
        const req = requests.find(r => String(r.id) === String(reqId));
        if (!req) { showToast('Solicitud no encontrada', 'error'); return; }

        const workers = req.workers || [];
        if (workers.length === 0) { showToast('Esta solicitud no tiene trabajadores', 'warn'); return; }

        // ── Colores corporativos ─────────────────────────────────────────────
        const RED    = 'FFCC0000';
        const DARK   = 'FF8B0000';
        const WHITE  = 'FFFFFFFF';
        const GRAY   = 'FFF5F5F5';
        const HDR_BG = 'FF1A202C';
        const GREEN  = 'FF276749';

        const wb = new ExcelJS.Workbook();
        wb.creator = 'PC Hotelería'; wb.created = new Date();

        const ws = wb.addWorksheet('Trabajadores', { views: [{ showGridLines: true }] });

        // ── Columnas ─────────────────────────────────────────────────────────
        const cols = [
            { header: 'RUT',          key: 'rut',        width: 15 },
            { header: 'Nombre',       key: 'name',       width: 30 },
            { header: 'Gerencia',     key: 'mgmt',       width: 25 },
            { header: 'Empresa',      key: 'company',    width: 28 },
            { header: 'Sexo',         key: 'sex',        width: 8  },
            { header: 'Turno',        key: 'shift',      width: 14 },
            { header: 'Hab. Asig.',   key: 'room',       width: 12 },
            { header: 'Fecha Ingreso',key: 'arrival',    width: 15 },
            { header: 'Fecha Salida', key: 'departure',  width: 15 },
            { header: 'Estado',       key: 'status',     width: 14 },
            { header: 'Observación',  key: 'obs',        width: 30 },
        ];
        ws.columns = cols.map(c => ({ key: c.key, width: c.width }));

        // ── Fila 1-3: cabecera roja Aramark ──────────────────────────────────
        [1, 2, 3].forEach(r => {
            for (let c = 1; c <= cols.length; c++) {
                ws.getRow(r).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
            }
            ws.getRow(r).height = 26;
        });
        ws.mergeCells(`D1:K3`);
        const title = ws.getCell('D1');
        title.value     = `PLANILLA DE ALOJAMIENTO — ${(req.company || '').toUpperCase()}\nPC Hotelería · ${new Date().toLocaleDateString('es-CL')}`;
        title.font      = { name: 'Calibri', bold: true, size: 15, color: { argb: WHITE } };
        title.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
        title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

        // Logo / nombre Aramark
        try {
            const resp   = await fetch('./aramark.png');
            const buffer = await resp.arrayBuffer();
            const imgId  = wb.addImage({ buffer, extension: 'png' });
            ws.addImage(imgId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 160, height: 72 } });
        } catch {
            ws.mergeCells('A1:C3');
            const logo = ws.getCell('A1');
            logo.value     = 'ARAMARK';
            logo.font      = { name: 'Calibri', bold: true, size: 18, color: { argb: WHITE } };
            logo.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
            logo.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        // ── Fila 4: Metadatos de la solicitud ────────────────────────────────
        ws.getRow(4).height = 22;
        const meta = [
            ['Empresa:', req.company || '—'],
            ['Contrato N°:', req.contractNumber || '—'],
            ['Gerencia:', req.gerencia || '—'],
            ['Admin Anglo:', req.angloAdmin || '—'],
            ['Contacto:', req.contactName || '—'],
            ['Recibida:', req.receivedDate ? new Date(req.receivedDate).toLocaleDateString('es-CL') : '—'],
        ];

        // Filas 4-9: Metadatos en 2 columnas
        meta.forEach(([label, value], i) => {
            const row = ws.getRow(4 + i);
            row.height = 18;
            const labelCell = row.getCell(1);
            labelCell.value     = label;
            labelCell.font      = { name: 'Calibri', bold: true, size: 10, color: { argb: WHITE } };
            labelCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
            labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

            ws.mergeCells(4 + i, 2, 4 + i, 5);
            const valCell = row.getCell(2);
            valCell.value     = value;
            valCell.font      = { name: 'Calibri', size: 10 };
            valCell.alignment = { horizontal: 'left', vertical: 'middle' };
        });

        // ── Fila 10: Encabezados de tabla ────────────────────────────────────
        const hdrRow = ws.getRow(10);
        hdrRow.height = 20;
        cols.forEach((col, i) => {
            const cell = hdrRow.getCell(i + 1);
            cell.value     = col.header;
            cell.font      = { name: 'Calibri', bold: true, size: 10, color: { argb: WHITE } };
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border    = { bottom: { style: 'medium', color: { argb: RED } } };
        });

        // ── Filas de trabajadores ────────────────────────────────────────────
        workers.forEach((w, idx) => {
            const row = ws.getRow(11 + idx);
            row.height = 18;
            const isAssigned = !!(w.assignedRoomStr && w.assignedRoomStr !== 'CLON_RECHAZADO');
            const bg = idx % 2 === 0 ? 'FFFAFAFA' : 'FFFFFFFF';

            const statusText = w.assignedRoomStr === 'CLON_RECHAZADO' ? 'Clon descartado'
                             : isAssigned ? 'Asignado'
                             : 'Pendiente';

            const statusColor = w.assignedRoomStr === 'CLON_RECHAZADO' ? 'FFc53030'
                              : isAssigned ? GREEN
                              : 'FF B7791F';

            [
                w.rut || '',
                w.name || '',
                w.management || '',
                w.legalName || w.company || '',
                w.sex || '',
                w.shiftName || w.shift || '',
                w.assignedRoomStr && w.assignedRoomStr !== 'CLON_RECHAZADO' ? `Hab. ${w.assignedRoomStr.split('_')[0]}` : '',
                w.arrivalDate ? new Date(w.arrivalDate + 'T12:00:00').toLocaleDateString('es-CL') : '',
                w.departureDate ? new Date(w.departureDate + 'T12:00:00').toLocaleDateString('es-CL') : '',
                statusText,
                w.observation || '',
            ].forEach((val, ci) => {
                const cell = row.getCell(ci + 1);
                cell.value     = val;
                cell.font      = ci === 9
                    ? { name: 'Calibri', size: 9, bold: true, color: { argb: statusColor } }
                    : { name: 'Calibri', size: 9 };
                cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'center' : 'left' };
            });
        });

        // ── Fila de totales ──────────────────────────────────────────────────
        const totalRow = ws.getRow(11 + workers.length);
        totalRow.height = 20;
        const totalCell = totalRow.getCell(1);
        ws.mergeCells(11 + workers.length, 1, 11 + workers.length, 6);
        totalCell.value     = `TOTAL TRABAJADORES: ${workers.length}   ·   ASIGNADOS: ${workers.filter(w => w.assignedRoomStr && w.assignedRoomStr !== 'CLON_RECHAZADO').length}   ·   PENDIENTES: ${workers.filter(w => !w.assignedRoomStr).length}`;
        totalCell.font      = { name: 'Calibri', bold: true, size: 10, color: { argb: WHITE } };
        totalCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
        totalCell.alignment = { horizontal: 'center', vertical: 'middle' };

        // ── Descargar ────────────────────────────────────────────────────────
        const buffer = await wb.xlsx.writeBuffer();
        const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fname  = `Solicitud_${(req.company || 'empresa').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

        if (window.showSaveFilePicker) {
            try {
                const handle   = await window.showSaveFilePicker({ suggestedName: fname, types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
                const writable = await handle.createWritable();
                await writable.write(blob); await writable.close();
                showToast(`✅ Excel descargado: ${fname}`, 'success'); return;
            } catch(e) { if (e.name === 'AbortError') return; }
        }
        const url = URL.createObjectURL(blob);
        const a   = Object.assign(document.createElement('a'), { href: url, download: fname });
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
        showToast(`✅ ${fname} descargado`, 'success');

    } catch(err) {
        console.error('[downloadSolicitudExcel]', err);
        showToast('Error al generar Excel: ' + err.message, 'error');
    }
};