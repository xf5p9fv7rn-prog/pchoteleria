import { getAll, put, remove, seedDemoData, getById } from '../db.js';
import { showToast, generateId, toChileanDate, formatDate } from '../utils.js';

// ── State ──────────────────────────────────────────
let selectedBuildingId = 'all';
let selectedFloor = 'all';
let activeTab = 'map'; // 'map' | 'buildings' | 'rooms'
let mapFilter = 'all';
let searchQuery = '';

export async function renderInfraestructura(container) {
  // 🧹 ANTI-DUPLICADOS: Limpiar modales flotantes de renders anteriores.
  // Si el usuario navega a otro módulo y vuelve, renderInfraestructura crea modales
  // nuevos con los mismos IDs. Los anteriores quedan "flotando" en document.body
  // → getElementById devuelve el muerto → los botones "cerrar" dejan de funcionar.
  ['room-detail-modal', 'manual-assign-modal', 'asig-camas-modal'].forEach(id => {
    const old = document.getElementById(id);
    if (old && old.parentNode === document.body) old.remove();
  });

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Infraestructura</h2>
        <p class="section-subtitle">Gestión de edificios, pabellones y habitaciones</p>
      </div>
    </div>

    <div class="tab-bar" id="infra-tabs">
      <div class="tab-item ${activeTab === 'map' ? 'active' : ''}" onclick="window.switchInfraTab('map')">🗺️ Mapa</div>
      <div class="tab-item ${activeTab === 'buildings' ? 'active' : ''}" onclick="window.switchInfraTab('buildings')">🏢 Edificios</div>
      <div class="tab-item ${activeTab === 'rooms' ? 'active' : ''}" onclick="window.switchInfraTab('rooms')">🚪 Habitaciones</div>
    </div>

    <div id="infra-content"></div>

    <div class="modal-overlay" id="building-modal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-header-icon">🏢</div>
          <div>
            <h3 style="font-size:16px;font-weight:700" id="building-modal-title">Agregar Edificio / Pabellón</h3>
            <p style="font-size:12px;color:var(--text-secondary)">Complete los datos del edificio</p>
          </div>
          <button class="modal-close btn" onclick="window.closeBuildingModal()">✕</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="building-edit-id">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Nombre del Edificio / Pabellón *</label>
              <input class="form-input" id="building-name" placeholder="Ej: Pabellón A, Edificio Norte">
            </div>
            <div class="form-group">
              <label class="form-label">Tipo</label>
              <select class="form-select" id="building-type">
                <option value="pavilion">Pabellón</option>
                <option value="building">Edificio</option>
                <option value="module">Módulo</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">☀️🌙 Turno del Pabellón</label>
              <select class="form-select" id="building-main-shift">
                <option value="mixed">Mixto (Día + Noche)</option>
                <option value="day">☀️ Solo Día</option>
                <option value="night">🌙 Solo Noche</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">N° de Pisos</label>
              <input class="form-input" id="building-floors" type="number" min="1" max="20" value="2">
            </div>
            <div class="form-group">
              <label class="form-label">Capacidad (personas)</label>
              <input class="form-input" id="building-capacity" type="number" min="1" value="40">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Turnos Rotativos Alojados</label>
            <p class="text-xs text-muted mb-3">Escribe el turno y presiona Enter o coma para agregar</p>
            <div class="tag-input-wrap" id="shifts-wrap">
              <input class="tag-input" id="shift-input" placeholder="Ej: 4x3, 7x7..." 
                onkeydown="window.handleShiftInput(event)">
            </div>
            <div class="mt-2" style="display:flex;flex-wrap:wrap;gap:6px">
              ${['4x3', '5x2', '7x7', '8x7', '14x14', '4x4'].map(s =>
    `<button class="btn btn-secondary btn-sm" onclick="window.addShiftPreset('${s}')">${s}</button>`
  ).join('')}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Configuración y Reservas por Piso</label>
            <div id="floor-configs-container" style="background:var(--bg-page);border-radius:var(--radius-md);padding:12px;display:flex;flex-direction:column;gap:10px">
                </div>
          </div>
          <div class="form-group">
            <label class="form-label">Observaciones</label>
            <textarea class="form-textarea" id="building-notes" rows="2" placeholder="Notas adicionales..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="window.closeBuildingModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="window.saveBuilding()">💾 Guardar Edificio</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="room-modal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-header-icon">🚪</div>
          <div>
            <h3 style="font-size:16px;font-weight:700" id="room-modal-title">Agregar Habitación</h3>
            <p style="font-size:12px;color:var(--text-secondary)">Configure los datos de la habitación</p>
          </div>
          <button class="modal-close btn" onclick="window.closeRoomModal()">✕</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="room-edit-id">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Número / Código *</label>
              <input class="form-input" id="room-number" placeholder="Ej: A01, 201">
            </div>
            <div class="form-group">
              <label class="form-label">Edificio / Pabellón *</label>
              <select class="form-select" id="room-building"></select>
            </div>
            <div class="form-group">
              <label class="form-label">Piso</label>
              <input class="form-input" id="room-floor" type="number" min="1" value="1">
            </div>
            <div class="form-group">
              <label class="form-label">Estado Inicial</label>
              <select class="form-select" id="room-status">
                <option value="free">🟢 Libre</option>
                <option value="occupied">🔴 Ocupada</option>
                <option value="reserved">🟡 Reservada</option>
                <option value="blocked">⚫ Bloqueada (Total)</option>
                <option value="bed-blocked">🔶 Bloqueada (Cama)</option>
              </select>
            </div>
          </div>

          <div style="background:var(--bg-page);border-radius:var(--radius-md);padding:14px;margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;margin-bottom:10px">🛏️ Gestión de Reservas</div>
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label">Empresa Reservada</label>
                    <input class="form-input" id="room-reserved-company" placeholder="Ej: Aramark, Anglo...">
                </div>
                <div class="form-group">
                    <label class="form-label">Turno Reservado</label>
                    <input class="form-input" id="room-reserved-shift" placeholder="Ej: 7x7, 4x3...">
                </div>
            </div>
            <p style="font-size:10px;color:var(--text-secondary);margin-top:4px">Si se dejan vacíos, se usará la configuración por defecto del piso/edificio.</p>
          </div>

          <div style="background:var(--bg-page);border-radius:var(--radius-md);padding:14px;margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;margin-bottom:10px">🛏️ Camas (por defecto: 2)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div style="padding:12px;background:var(--bg-card);border-radius:var(--radius-md);border:1px solid var(--border);text-align:center">
                <div style="font-size:20px">🌅</div>
                <div style="font-weight:700;font-size:14px;margin-top:4px">Bloquear Cama 1</div>
                <div style="font-size:11px;color:var(--text-secondary)">Libre por defecto</div>
              </div>
              <div style="padding:12px;background:var(--bg-card);border-radius:var(--radius-md);border:1px solid var(--border);text-align:center">
                <div style="font-size:20px">🌙</div>
                <div style="font-weight:700;font-size:14px;margin-top:4px">Bloquear Cama 2</div>
                <div style="font-size:11px;color:var(--text-secondary)">Libre por defecto</div>
              </div>
            </div>
          </div>

          <div class="form-group" id="block-reason-group" style="display:none">
            <label class="form-label">Motivo del Bloqueo</label>
            <select class="form-select" id="room-block-reason">
              <option value="Mantenimiento">🔧 Mantenimiento</option>
              <option value="Filtración">💧 Filtración</option>
              <option value="Sanitización">🧪 Sanitización</option>
              <option value="Reparación">🔨 Reparación</option>
              <option value="Bodega">🗄️ Bodega / Almacenamiento</option>
              <option value="Otro">📋 Otro</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="window.closeRoomModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="window.saveRoom()">💾 Guardar Habitación</button>
        </div>
      </div>
    </div>

    <style>
      #room-detail-modal {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 999999 !important;
        display: flex !important;
        align-items: center !important; 
        justify-content: center !important; 
        background: rgba(0, 0, 0, 0.6) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.2s ease !important;
      }
      #room-detail-modal.visible {
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      #room-detail-modal .modal {
        margin: 0 !important;
        position: relative !important;
        max-height: 90vh !important;
        overflow-y: auto !important;
        transform: translateY(20px) !important; 
        transition: transform 0.2s ease !important;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3) !important;
      }
      #room-detail-modal.visible .modal {
        transform: translateY(0) !important;
      }
    </style>
    <div class="modal-overlay" id="room-detail-modal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-header-icon">🚪</div>
          <div>
            <h3 style="font-size:16px;font-weight:700" id="room-detail-title">Habitación</h3>
            <p style="font-size:12px;color:var(--text-secondary)" id="room-detail-sub">Detalle de ocupación</p>
          </div>
          <button class="modal-close btn" onclick="window.closeRoomDetail()">✕</button>
        </div>
        <div class="modal-body" id="room-detail-body"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="window.closeRoomDetail()">Cerrar</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="bulk-reservation-modal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-header-icon">🏷️</div>
          <div>
            <h3 style="font-size:16px;font-weight:700">Reserva de Infraestructura</h3>
            <p style="font-size:12px;color:var(--text-secondary)">Las reglas de este módulo serán "Ley" para la asignación</p>
          </div>
          <button class="modal-close btn" onclick="window.closeBulkReservationModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group" style="grid-column: span 2;">
              <label class="form-label">Edificio / Pabellón Objetivo *</label>
              <select class="form-select" id="bulk-building" onchange="window.updateBulkFloorSelect()"></select>
            </div>
            <div class="form-group">
              <label class="form-label">Piso (Opcional)</label>
              <select class="form-select" id="bulk-floor" onchange="window.updateBulkRoomSelect()">
                <option value="all">Todos los pisos</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Habitación (Opcional)</label>
              <select class="form-select" id="bulk-room">
                <option value="all">Todas las habitaciones</option>
              </select>
            </div>
            <div class="form-group" style="grid-column: span 2;">
              <label class="form-label">Empresa (Opcional, ej: Anglo, Aramark)</label>
              <input class="form-input" id="bulk-company" placeholder="Dejar en blanco para liberar/limpiar">
            </div>
            <div class="form-group" style="grid-column: span 2;">
              <label class="form-label">Turno (Opcional, ej: 5x2, 4x3)</label>
              <input class="form-input" id="bulk-shift" placeholder="Dejar en blanco para liberar/limpiar">
            </div>
          </div>
          <div style="margin-top:16px; padding:12px; background:var(--red-50); color:var(--red-700); border-radius:var(--radius-md); font-size:12px; font-weight:600;">
            ⚠️ ATENCIÓN: Esta acción establecerá una regla estricta. Todo trabajador que intente ingresar a esta(s) pieza(s) deberá cumplir con la Empresa y Turno exactos.
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="window.closeBulkReservationModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="window.applyBulkReservation()">⚡ Imponer Ley</button>
        </div>
      </div>
    </div>

    <style>
      #manual-assign-modal {
        position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important;
        z-index: 999999 !important; display: flex !important; align-items: center !important; justify-content: center !important;
        background: rgba(0, 0, 0, 0.6) !important; opacity: 0 !important; pointer-events: none !important; transition: opacity 0.2s ease !important;
      }
      #manual-assign-modal.visible { opacity: 1 !important; pointer-events: auto !important; }
      #manual-assign-modal .modal {
        margin: 0 !important; position: relative !important; max-height: 90vh !important; overflow-y: auto !important;
        transform: translateY(20px) !important; transition: transform 0.2s ease !important; box-shadow: 0 10px 40px rgba(0,0,0,0.3) !important;
      }
      #manual-assign-modal.visible .modal { transform: translateY(0) !important; }
    </style>
    <div class="modal-overlay" id="manual-assign-modal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-header-icon">🧑‍🔧</div>
          <div>
            <h3 style="font-size:16px;font-weight:700">Asignación Manual</h3>
            <p style="font-size:12px;color:var(--text-secondary)">Carga directa a la cama seleccionada</p>
          </div>
          <button class="modal-close btn" onclick="window.closeManualAssignModal()">✕</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="manual-room-id">
          <input type="hidden" id="manual-bed-key">
          
          <div class="form-grid">
            <div class="form-group" style="grid-column: span 2; display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:var(--text-primary); margin-bottom:4px; font-size:12px;">Nombre Completo del Trabajador *</label>
              <input class="form-input" id="manual-occupant" placeholder="Ej: Juan Pérez">
            </div>
            <div class="form-group" style="display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:var(--text-primary); margin-bottom:4px; font-size:12px;">Empresa Contratista *</label>
              <input class="form-input" id="manual-company" placeholder="Ej: Aramark">
            </div>
            <div class="form-group" style="display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:var(--text-primary); margin-bottom:4px; font-size:12px;">Turno *</label>
              <input class="form-input" id="manual-shift" placeholder="Ej: 5x2, 4x3..." value="5x2">
            </div>
            <div class="form-group" style="grid-column: span 2; display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:var(--text-primary); margin-bottom:4px; font-size:12px;">Género *</label>
              <select class="form-select" id="manual-gender">
                <option value="M">Hombre (M)</option>
                <option value="F">Mujer (F)</option>
              </select>
            </div>
            <div class="form-group" style="display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:var(--text-primary); margin-bottom:4px; font-size:12px;">RUT Trabajador</label>
              <input class="form-input" id="manual-rut" placeholder="Ej: 12345678-9">
            </div>
            <div class="form-group" style="display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:var(--text-primary); margin-bottom:4px; font-size:12px;">Contacto / Teléfono</label>
              <input class="form-input" id="manual-contact" placeholder="Ej: +569...">
            </div>
            <div class="form-group" style="display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:var(--text-primary); margin-bottom:4px; font-size:12px;">Fecha Ingreso *</label>
              <input type="date" class="form-input" id="manual-arrival">
            </div>
            <div class="form-group" style="display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:var(--text-primary); margin-bottom:4px; font-size:12px;">Fecha Salida *</label>
              <input type="date" class="form-input" id="manual-departure">
            </div>
            <div class="form-group" style="display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:#6b21a8; margin-bottom:4px; font-size:12px;">🏗️ Gerencia</label>
              <input class="form-input" id="manual-management" placeholder="Ej: Operaciones, RRHH..." style="border-color:#ddd6fe">
            </div>
            <div class="form-group" style="display:flex; flex-direction:column; text-align:left;">
              <label style="font-weight:700; color:#2b6cb0; margin-bottom:4px; font-size:12px;">📄 N° Contrato</label>
              <input class="form-input" id="manual-contract" placeholder="Ej: 2024-001" style="border-color:#bee3f8">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="window.closeManualAssignModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="window.saveManualAssignment()">💾 Guardar Asignación</button>
        </div>
      </div>
    </div>
  `;

  setupInfraHandlers();
  await window.switchInfraTab(activeTab);
}

function setupInfraHandlers() {
  let currentShifts = [];

  window.switchInfraTab = async (tab) => {
    activeTab = tab;
    document.querySelectorAll('#infra-tabs .tab-item').forEach((el, i) => {
      el.className = 'tab-item' + (['map', 'buildings', 'rooms'][i] === tab ? ' active' : '');
    });
    await switchTab(tab, document.getElementById('infra-content'));
  };

  window.openBuildingForm = async (editId = null) => {
    currentShifts = [];
    document.getElementById('building-edit-id').value = editId || '';
    document.getElementById('building-modal-title').textContent = editId ? 'Editar Edificio / Pabellón' : 'Agregar Edificio / Pabellón';
    if (editId) {
      const buildings = await getAll('buildings');
      const b = buildings.find(x => x.id === editId);
      if (b) {
        document.getElementById('building-name').value = b.name;
        document.getElementById('building-type').value = b.type;
        document.getElementById('building-main-shift').value = b.mainShift || 'mixed';
        document.getElementById('building-floors').value = b.floor;
        document.getElementById('building-capacity').value = b.capacity;
        document.getElementById('building-notes').value = b.notes || '';
        currentShifts = [...(b.shifts || [])];
        renderShiftTags();
        renderFloorConfigs(b.floor, b.floorConfigs || {});
      }
    } else {
      document.getElementById('building-name').value = '';
      document.getElementById('building-capacity').value = '40';
      renderShiftTags();
      renderFloorConfigs(2, {});
    }
    document.getElementById('building-modal').classList.add('visible');
  };

  document.getElementById('building-floors').addEventListener('input', (e) => {
    const floorCount = parseInt(e.target.value) || 1;
    const currentConfigs = {};
    document.querySelectorAll('#floor-configs-container [data-floor]').forEach(el => {
        const f = el.dataset.floor;
        if (!currentConfigs[f]) currentConfigs[f] = {};
        currentConfigs[f][el.dataset.field] = el.value.trim();
    });
    renderFloorConfigs(floorCount, currentConfigs);
  });

  function renderFloorConfigs(count, existingConfigs) {
    const container = document.getElementById('floor-configs-container');
    if (!container) return;
    let html = '';
    for (let i = 1; i <= count; i++) {
        const conf = existingConfigs[i] || { shift: '', company: '', specialty: 'mixed' };
        html += `
          <div style="display:grid;grid-template-columns: 80px 1fr 1fr 120px; gap:8px; align-items:center; border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom:10px">
            <div style="font-size:12px;font-weight:700;color:var(--red-600)">Piso ${i}</div>
            <input class="form-input" style="padding:6px;font-size:12px" placeholder="Turno" data-floor="${i}" data-field="shift" value="${conf.shift || ''}">
            <input class="form-input" style="padding:6px;font-size:12px" placeholder="Empresa" data-floor="${i}" data-field="company" value="${conf.company || ''}">
            <select class="form-select" style="padding:4px;font-size:11px" data-floor="${i}" data-field="specialty">
              <option value="mixed" ${conf.specialty === 'mixed' ? 'selected' : ''}>🌆 Mixto</option>
              <option value="day" ${conf.specialty === 'day' ? 'selected' : ''}>☀️ Solo Día</option>
              <option value="night" ${conf.specialty === 'night' ? 'selected' : ''}>🌙 Solo Noche</option>
            </select>
          </div>
        `;
    }
    container.innerHTML = html;
  }

  window.closeBuildingModal = () => {
    document.getElementById('building-modal').classList.remove('visible');
  };

  window.addShiftPreset = (shift) => {
    if (!currentShifts.includes(shift)) {
      currentShifts.push(shift);
      renderShiftTags();
    }
  };

  window.handleShiftInput = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = e.target.value.trim().replace(',', '');
      if (val && !currentShifts.includes(val)) {
        currentShifts.push(val);
        renderShiftTags();
      }
      e.target.value = '';
    }
  };

  function renderShiftTags() {
    const wrap = document.getElementById('shifts-wrap');
    const input = document.getElementById('shift-input');
    wrap.querySelectorAll('.tag').forEach(t => t.remove());
    currentShifts.forEach(s => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `${s}<span class="tag-remove" onclick="window.removeShift('${s}')">×</span>`;
      wrap.insertBefore(tag, input);
    });
  }

  window.removeShift = (shift) => {
    currentShifts = currentShifts.filter(s => s !== shift);
    renderShiftTags();
  };

  window.saveBuilding = async () => {
    const editId = document.getElementById('building-edit-id').value;
    const name = document.getElementById('building-name').value.trim();
    if (!name) { showToast('Ingrese el nombre del edificio', 'warn'); return; }
    const floorConfigs = {};
    document.querySelectorAll('#floor-configs-container [data-floor]').forEach(el => {
        const f = el.dataset.floor;
        if (!floorConfigs[f]) floorConfigs[f] = {};
        floorConfigs[f][el.dataset.field] = el.value.trim();
    });

    const data = {
      name,
      type: document.getElementById('building-type').value,
      mainShift: document.getElementById('building-main-shift').value || 'mixed',
      floor: parseInt(document.getElementById('building-floors').value) || 1,
      capacity: parseInt(document.getElementById('building-capacity').value) || 40,
      shifts: [...currentShifts],
      floorConfigs,
      notes: document.getElementById('building-notes').value,
    };
    if (editId) data.id = parseInt(editId);
    await put('buildings', data);
    window.closeBuildingModal();
    showToast(editId ? 'Edificio actualizado' : 'Edificio guardado', 'success');
    await window.switchInfraTab(activeTab);
  };

  window.openRoomForm = async (editId = null) => {
    const buildings = await getAll('buildings');
    const sel = document.getElementById('room-building');
    sel.innerHTML = buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    document.getElementById('room-edit-id').value = editId || '';
    document.getElementById('room-modal-title').textContent = editId ? 'Editar Habitación' : 'Agregar Habitación';
    if (editId) {
      const rooms = await getAll('rooms');
      const r = rooms.find(x => x.id === editId);
      if (r) {
        document.getElementById('room-number').value = r.number;
        document.getElementById('room-building').value = r.buildingId;
        document.getElementById('room-floor').value = r.floor;
        document.getElementById('room-status').value = r.status;
        document.getElementById('room-reserved-company').value = r.reservedCompany || '';
        document.getElementById('room-reserved-shift').value = r.reservedShift || '';
        if (r.blockReason) document.getElementById('room-block-reason').value = r.blockReason;
      }
    } else {
      document.getElementById('room-number').value = '';
      document.getElementById('room-status').value = 'free';
      document.getElementById('room-reserved-company').value = '';
      document.getElementById('room-reserved-shift').value = '';
    }
    document.getElementById('room-status').dispatchEvent(new Event('change'));
    document.getElementById('room-modal').classList.add('visible');
  };

  document.getElementById('room-status').addEventListener('change', (e) => {
    const bg = document.getElementById('block-reason-group');
    bg.style.display = (e.target.value === 'blocked' || e.target.value === 'bed-blocked') ? 'block' : 'none';
  });

  window.closeRoomModal = () => document.getElementById('room-modal').classList.remove('visible');

  window.saveRoom = async () => {
    const number = document.getElementById('room-number').value.trim();
    if (!number) { showToast('Ingrese número de habitación', 'warn'); return; }
    const bId = parseInt(document.getElementById('room-building').value);
    const status = document.getElementById('room-status').value;
    const editId = document.getElementById('room-edit-id').value;
    const data = {
      buildingId: bId,
      number,
      floor: parseInt(document.getElementById('room-floor').value) || 1,
      status,
      reservedCompany: document.getElementById('room-reserved-company').value.trim(),
      reservedShift: document.getElementById('room-reserved-shift').value.trim(),
      blockReason: (status === 'blocked' || status === 'bed-blocked')
        ? document.getElementById('room-block-reason').value : null,
      // Guardar fecha de bloqueo solo cuando se hace el bloqueo (no sobreescribir si ya existía)
      blockedAt: (status === 'blocked' || status === 'bed-blocked')
        ? (editId && window._allRooms?.find(x => String(x.id) === String(editId))?.blockedAt) || new Date().toISOString()
        : null,
      blockedBed: status === 'bed-blocked' ? 'day' : null,
      beds: { day: { occupant: null }, night: { occupant: null } },
      gender: null,
      bedCount: 2
    };
    if (editId) data.id = parseInt(editId);
    await put('rooms', data);
    window.closeRoomModal();
    showToast(editId ? 'Habitación actualizada' : 'Habitación guardada', 'success');
    await window.switchInfraTab(activeTab);
  };

  window.openBulkReservationModal = async () => {
    const buildings = await getAll('buildings');
    const sel = document.getElementById('bulk-building');
    sel.innerHTML = '<option value="">-- Seleccionar --</option>' + 
                    buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    
    document.getElementById('bulk-floor').innerHTML = '<option value="all">Primero seleccione edificio</option>';
    document.getElementById('bulk-room').innerHTML = '<option value="all">Todos</option>';
    document.getElementById('bulk-company').value = '';
    document.getElementById('bulk-shift').value = '';
    document.getElementById('bulk-reservation-modal').classList.add('visible');
  };

  window.updateBulkFloorSelect = async () => {
    const bId = parseInt(document.getElementById('bulk-building').value);
    const fSel = document.getElementById('bulk-floor');
    const rSel = document.getElementById('bulk-room');
    if (!bId) {
        fSel.innerHTML = '<option value="all">Primero seleccione edificio</option>';
        rSel.innerHTML = '<option value="all">Todos</option>';
        return;
    }
    const buildings = await getAll('buildings');
    const bInfo = buildings.find(b => b.id === bId);
    let floorOptions = '<option value="all">Todos los pisos</option>';
    if (bInfo && bInfo.floor) {
        for(let i=1; i<=bInfo.floor; i++) {
            floorOptions += `<option value="${i}">Piso ${i}</option>`;
        }
    }
    fSel.innerHTML = floorOptions;
    rSel.innerHTML = '<option value="all">Todas las habitaciones</option>';
  };

  window.updateBulkRoomSelect = async () => {
    const bId = parseInt(document.getElementById('bulk-building').value);
    const floor = document.getElementById('bulk-floor').value;
    const rSel = document.getElementById('bulk-room');
    
    if (!bId || floor === 'all') {
        rSel.innerHTML = '<option value="all">Todas las habitaciones</option>';
        return;
    }
    
    const rooms = await getAll('rooms');
    const filtered = rooms.filter(r => r.buildingId === bId && r.floor == floor).sort((a,b) => parseInt(a.number) - parseInt(b.number));
    
    let roomOptions = '<option value="all">Todas las habitaciones de este piso</option>';
    filtered.forEach(r => {
        roomOptions += `<option value="${r.id}">Habitación ${r.number}</option>`;
    });
    rSel.innerHTML = roomOptions;
  };

  window.closeBulkReservationModal = () => document.getElementById('bulk-reservation-modal').classList.remove('visible');

  window.applyBulkReservation = async () => {
    const bId = parseInt(document.getElementById('bulk-building').value);
    const floorVal = document.getElementById('bulk-floor').value;
    const roomVal = document.getElementById('bulk-room').value;
    const company = document.getElementById('bulk-company').value.trim();
    const shift = document.getElementById('bulk-shift').value.trim();
    
    if (!bId) {
        showToast('Debe seleccionar al menos un edificio.', 'warn');
        return;
    }
    
    const rooms = await getAll('rooms');
    let targetRooms = rooms.filter(r => r.buildingId === bId);
    
    if (floorVal !== 'all') {
        targetRooms = targetRooms.filter(r => r.floor == floorVal);
    }
    if (roomVal !== 'all') {
        targetRooms = targetRooms.filter(r => r.id == parseInt(roomVal));
    }
    
    // 🚀 PARALELO: Aplicar la reserva a todas las habitaciones simultaneamente
    targetRooms.forEach(r => { r.reservedCompany = company; r.reservedShift = shift; });
    await Promise.all(targetRooms.map(r => put('rooms', r)));
    const updated = targetRooms.length;
    
    window.closeBulkReservationModal();
    const scopeMsg = roomVal !== 'all' ? 'la habitación' : (floorVal !== 'all' ? `el piso ${floorVal}` : 'el pabellón completo');
    showToast(`Nuevas LEYES aplicadas a ${updated} piezas en ${scopeMsg}.`, 'success');
    await window.switchInfraTab(activeTab);
  };

  // 🔒 Helper: leer habitación siempre desde la caché en memoria primero
  // Esto evita que el sync de Supabase en fondo pise los datos que está usando la UI
  async function _getRoomFromCache(roomId) {
    // 1. Primero buscar en la caché en memoria (siempre la más fresca para esta sesión)
    if (window._allRooms) {
        const cached = window._allRooms.find(x => String(x.id) === String(roomId));
        if (cached) return JSON.parse(JSON.stringify(cached)); // copia profunda para no mutar el original
    }
    // 2. Fallback a IndexedDB si no está en caché
    return await getById('rooms', roomId);
  }

  // 🔒 Helper: sincronizar habitación modificada de vuelta a la caché
  function _updateRoomInCache(updatedRoom) {
    if (window._allRooms && updatedRoom?.id !== undefined) {
        const idx = window._allRooms.findIndex(x => String(x.id) === String(updatedRoom.id));
        if (idx !== -1) window._allRooms[idx] = updatedRoom;
        else window._allRooms.push(updatedRoom);
    }
  }

  // 🔥 FUNCIONES DE 3RA CAMA 🔥
  window.agregarTerceraCama = async (roomId) => {
    if(!confirm('¿Deseas habilitar una tercera cama temporal en esta habitación?')) return;
    const r = await _getRoomFromCache(roomId);
    if (!r) return;
    r.bedCount = 3;
    if (!r.beds.extra) {
        r.beds.extra = { occupant: null, arrivalDate: null, departureDate: null, company: null, shift: null, rut: null, gender: null };
    }
    await put('rooms', r);
    _updateRoomInCache(r);
    showToast('Tercera Cama (C) Habilitada', 'success');
    window.showRoomDetail(roomId);
    updateGridFilters();
  };

  window.quitarTerceraCama = async (roomId) => {
    const r = await _getRoomFromCache(roomId);
    if (!r) return;
    if (r.beds.extra?.occupant) {
        alert('No puedes quitar la tercera cama porque actualmente está ocupada. Debes vaciarla primero.');
        return;
    }
    if(!confirm('¿Deseas quitar la tercera cama de esta habitación?')) return;
    r.bedCount = 2;
    delete r.beds.extra;
    await put('rooms', r);
    _updateRoomInCache(r);
    showToast('Tercera Cama (C) Eliminada', 'success');
    window.showRoomDetail(roomId);
    updateGridFilters();
  };

  // 🔥 MODAL DETALLE DE HABITACIÓN 🔥
  window.showRoomDetail = async (roomId) => {
    // 🔒 SIEMPRE leer desde caché en memoria — nunca directamente de IDB
    // Esto garantiza que los datos que ve el usuario son los que se cargaron al inicio
    // (y los que se actualizaron al hacer asignaciones manuales en esta sesión)
    const r = await _getRoomFromCache(roomId);
    if (!r) return;
    const buildings = window._allBuildings || await getAll('buildings');
    const b = buildings.find(x => String(x.id) === String(r.buildingId)) || {};

    window._detailRoomId = roomId;
    
    document.getElementById('room-detail-title').textContent = `Habitación ${r.number}`;
    document.getElementById('room-detail-sub').textContent = `${b.name || ''} · Piso ${r.floor}`;

    const statusLabel = { free: '🟢 Libre', occupied: '🔴 Ocupada', reserved: '🟡 Reservada', blocked: '⚫ Bloqueada', 'bed-blocked': '🔶 Cama Bloqueada' };
    const isBlocked = r.status === 'blocked' || r.status === 'bed-blocked';

    document.getElementById('room-detail-body').innerHTML = `
      ${ (() => {
          const isNoche = r.reservedShift && /noche|night/i.test(r.reservedShift);
          return isNoche ? `
          <div style="background:linear-gradient(135deg,#1e3a5f,#2c5282);border-radius:12px;padding:10px 16px;
                        margin-bottom:14px;display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">🌙</span>
            <div>
              <div style="color:#90cdf4;font-size:13px;font-weight:800">TURNO NOCHE</div>
              <div style="color:#bee3f8;font-size:11px">Este pabellón opera en turno de noche · Puedes cargar trabajadores normalmente</div>
            </div>
          </div>` : '';
      })()} 
      <div style="background:var(--bg-page); border-radius:16px; padding:12px; display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; border:1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="badge ${r.status === 'free' ? 'badge-free' : r.status === 'occupied' ? 'badge-occ' : r.status === 'reserved' ? 'badge-res' : 'badge-block'}" style="font-size:13px; padding:6px 16px; border-radius:99px">
            ${statusLabel[r.status] || r.status}
          </span>
          ${isBlocked && r.blockReason ? `<span style="font-size:12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px;color:#4a5568;font-weight:700">${r.blockReason}</span>` : ''}
          ${isBlocked && r.blockedAt ? (() => {
            const days = Math.floor((Date.now() - new Date(r.blockedAt).getTime()) / 86400000);
            const col = days > 30 ? '#e53e3e' : days > 7 ? '#dd6b20' : '#718096';
            return `<span style="font-size:11px;color:${col};font-weight:800">${days} día${days!==1?'s':''} bloqueada</span>`;
          })() : ''}
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap">
          ${isBlocked
            ? `<button class="btn btn-primary btn-sm" style="background:#38a169" onclick="window.desbloquearRapido(${r.id})">🔓 Desbloquear</button>`
            : `<button class="btn btn-secondary btn-sm" style="color:#c53030;border-color:#feb2b2" onclick="window.abrirQuickBlock(${r.id})">🔒 Bloquear / Bodega</button>`
          }
          <button class="btn btn-secondary btn-sm" style="color:var(--text-primary); font-weight:700; border: 1px solid var(--border)" onclick="window.vaciarHabitacion(${r.id})">🗑️ Vaciar</button>
        </div>
      </div>

      <!-- Mini-modal de bloqueo rápido (oculto por defecto) -->
      <div id="quick-block-panel" style="display:none; background:#fff5f5; border:1px solid #feb2b2; border-radius:14px; padding:16px; margin-bottom:16px;">
        <div style="font-weight:800; color:#c53030; font-size:13px; margin-bottom:12px">🔒 Motivo del Bloqueo</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px">
          ${[
            ['Mantenimiento','🔧'],['Filtración','💧'],['Sanitización','🧪'],
            ['Reparación','🔨'],['Bodega','🗄️'],['Otro','📋']
          ].map(([val, ico]) => `
            <button class="btn btn-secondary btn-sm" style="justify-content:flex-start;gap:6px;font-size:12px;padding:10px 12px" 
              onclick="window.reportarBloqueo(${r.id}, '${val}')">
              ${ico} ${val}
            </button>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('quick-block-panel').style.display='none'">Cancelar</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:20px;">
        ${renderBedDetail(r.beds?.day, 'Cama 1', '🛏️', r.status, r.blockedBed === 'day', r.id, 'day')}
        ${renderBedDetail(r.beds?.night, 'Cama 2', '🛏️', r.status, r.blockedBed === 'night', r.id, 'night')}
        ${(r.bedCount >= 3) ? renderBedDetail(r.beds?.extra, 'Cama 3 (Extra)', '🛏️', r.status, r.blockedBed === 'extra', r.id, 'extra') : ''}
      </div>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed var(--border);">
          ${(r.bedCount >= 3) 
              ? `<button class="btn btn-secondary btn-full" style="color: var(--red-600); border: 1px dashed var(--red-300);" onclick="window.quitarTerceraCama(${r.id})">➖ Quitar 3ra Cama</button>`
              : `<button class="btn btn-secondary btn-full" style="border: 1px dashed var(--border); color: #2b6cb0;" onclick="window.agregarTerceraCama(${r.id})">➕ Habilitar 3ra Cama</button>`
          }
      </div>

      ${(() => {
          // Mostrar sección de motivo solo si hay exactamente 1 ocupante en una hab de 2+ camas
          const bedKeys = ['day','night','extra'].slice(0, r.bedCount || 2);
          const ocupantes = bedKeys.filter(k => r.beds?.[k]?.occupant).length;
          if (ocupantes !== 1 || (r.bedCount || 2) < 2) return '';
          const motivoActual = r.lostBedReason || '';
          const motivos = [
              ['Género incompatible', '🚻'],
              ['Empresa exclusiva', '🏢'],
              ['Cama reservada', '📌'],
              ['Cuarentena / Médico', '🏥'],
              ['Coordinación pendiente', '⏳'],
              ['Sin motivo registrado', '📋'],
          ];
          return `
          <div style="margin-top:16px; background:#fffbeb; border:1px solid #fcd34d; border-radius:14px; padding:16px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                  <span style="font-size:18px">⚠️</span>
                  <div>
                      <div style="font-weight:800;font-size:13px;color:#92400e">Cama Vacía — 1 ocupante solo</div>
                      <div style="font-size:11px;color:#b45309">Registra el motivo para el informe</div>
                  </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
                  ${motivos.map(([val, ico]) => `
                  <button class="btn btn-sm" 
                      style="justify-content:flex-start;gap:6px;font-size:11px;padding:8px 10px;
                             border:2px solid ${motivoActual===val ? '#f59e0b' : 'var(--border)'};
                             background:${motivoActual===val ? '#fef3c7' : 'white'};
                             color:${motivoActual===val ? '#92400e' : 'var(--text-primary)'};
                             font-weight:${motivoActual===val ? '800' : '600'}"
                      onclick="window.guardarMotivoCamaVacia(${r.id}, '${val}')">
                      ${ico} ${val}
                  </button>`).join('')}
              </div>
              ${motivoActual ? `<div style="text-align:center;font-size:11px;color:#92400e;font-weight:700">✅ Motivo actual: ${motivoActual}</div>` : ''}
          </div>`;
      })()}
    `;
    
    const modalEl = document.getElementById('room-detail-modal');
    if (modalEl && modalEl.parentNode !== document.body) {
        document.body.appendChild(modalEl);
    }
    
    modalEl.classList.add('visible');
  };

  window.closeRoomDetail = () => {
      const modalEl = document.getElementById('room-detail-modal');
      if (modalEl) modalEl.classList.remove('visible');
      // 🔒 Prevenir que cerrar el modal cambie el hash y dispare navegación al Dashboard
      const currentHash = location.hash;
      requestAnimationFrame(() => {
          if (location.hash !== currentHash) {
              history.replaceState(null, '', currentHash || '#infraestructura');
          }
      });
  };

  // 🗑️ VACIAR HABITACIÓN COMPLETA
  window.vaciarHabitacion = async (roomId) => {
    if (!confirm('¿Desea retirar a TODOS los trabajadores de esta habitación y marcarla como LIBRE?')) return;
    try {
      const rooms = await getAll('rooms');
      const r = rooms.find(x => String(x.id) === String(roomId));
      if (!r) { showToast('Habitación no encontrada', 'error'); return; }
      r.status = 'free';
      r.gender = null;
      r.blockReason = null;
      r.blockedAt = null;
      if (r.beds) {
        ['day', 'night', 'extra'].forEach(k => {
          if (r.beds[k] !== undefined)
            r.beds[k] = { occupant: null, arrivalDate: null, departureDate: null, company: null, shift: null, rut: null, contact: null, gender: null };
        });
      }
      await put('rooms', r);
      _updateRoomInCache(r);
      showToast('✅ Habitación ' + r.number + ' liberada', 'success');
      window.closeRoomDetail();
      document.getElementById('infra-search')?.dispatchEvent(new Event('input'));
    } catch(err) {
      console.error('[vaciarHabitacion]', err);
      showToast('Error al vaciar: ' + err.message, 'error');
    }
  };

  // 🔒 Abrir panel de bloqueo rápido (sin formulario completo)
  window.abrirQuickBlock = (roomId) => {
    window._quickBlockRoomId = roomId;
    const panel = document.getElementById('quick-block-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  // ⚠️ Guardar motivo de cama vacía (cuando hay 1 solo ocupante)
  window.guardarMotivoCamaVacia = async (roomId, motivo) => {
    try {
      const r = await _getRoomFromCache(roomId);
      if (!r) { showToast('Habitación no encontrada', 'error'); return; }
      r.lostBedReason = motivo;
      await put('rooms', r);
      _updateRoomInCache(r);
      showToast(`✅ Motivo guardado: ${motivo}`, 'success');
      // Refrescar el modal para mostrar el motivo seleccionado
      await window.showRoomDetail(roomId); // ← era openRoomDetail (no existe)
    } catch(err) {
      console.error('[guardarMotivoCamaVacia]', err);
      showToast('Error al guardar motivo: ' + err.message, 'error');
    }
  };


  // 🔒 Reportar bloqueo directamente desde el selector rápido
  window.reportarBloqueo = async (roomId, reason) => {
    const r = await _getRoomFromCache(roomId);
    if (!r) return;
    if (!confirm(`🔒 ¿Bloquear habitación ${r.number} como "${reason}"?`)) return;

    r.status = 'blocked';
    r.blockReason = reason;
    r.blockedAt = new Date().toISOString();
    // Vaciar camas al bloquear
    if (r.beds) {
      ['day', 'night', 'extra'].forEach(k => {
        if (r.beds[k]) r.beds[k] = { occupant: null, arrivalDate: null, departureDate: null, company: null, shift: null, rut: null, gender: null };
      });
    }
    r.gender = null;
    await put('rooms', r);
    _updateRoomInCache(r);
    showToast(`🔒 Habitación ${r.number} bloqueada: ${reason}`, 'success');
    // Refrescar el drawer con los nuevos datos
    window.closeRoomDetail();
    await window.showRoomDetail(roomId);
  };

  // 🔓 Desbloquear rápido
  window.desbloquearRapido = async (roomId) => {
    const r = await _getRoomFromCache(roomId);
    if (!r) return;
    if (!confirm(`🔓 ¿Desbloquear habitación ${r.number} y marcarla como Libre?`)) return;
    r.status = 'free';
    r.blockReason = null;
    r.blockedAt = null;
    await put('rooms', r);
    _updateRoomInCache(r);
    showToast(`🔓 Habitación ${r.number} desbloqueada`, 'success');
    window.closeRoomDetail();
    await window.showRoomDetail(roomId);
  };

  // 🗑️ VACIAR CAMA INDIVIDUAL

  // ✅ AUTORIZAR CHECK-IN: El admin verifica el carnet y da acceso al portal
  window.autorizarCheckin = async (roomId, bedKey) => {
    try {
      const r = await _getRoomFromCache(roomId);
      if (!r || !r.beds?.[bedKey]?.occupant) {
        showToast('No hay trabajador en esta cama', 'error');
        return;
      }
      r.beds[bedKey].checkinAuthorized = true;
      r.beds[bedKey].authorizedAt = new Date().toISOString();
      await put('rooms', r);
      _updateRoomInCache(r);
      showToast(`✅ Check-in autorizado para ${r.beds[bedKey].occupant.split('(')[0].trim()}`, 'success');
      window.showRoomDetail(roomId);
    } catch(err) {
      console.error('[autorizarCheckin]', err);
      showToast('Error al autorizar: ' + err.message, 'error');
    }
  };

  // ✅ REVOCAR AUTORIZACIÓN: Quita el permiso de check-in
  window.revocarAutorizacion = async (roomId, bedKey) => {
    if (!confirm('¿Revocar la autorización de check-in para este trabajador?')) return;
    try {
      const r = await _getRoomFromCache(roomId);
      if (!r) return;
      r.beds[bedKey].checkinAuthorized = false;
      r.beds[bedKey].authorizedAt = null;
      await put('rooms', r);
      _updateRoomInCache(r);
      showToast('Autorización revocada', 'info');
      window.showRoomDetail(roomId);
    } catch(err) {
      showToast('Error: ' + err.message, 'error');
    }
  };

  window.vaciarCama = async (roomId, bedKey) => {
    if (!confirm('¿Vaciar esta cama?')) return;
    try {
      const rooms = await getAll('rooms');
      const r = rooms.find(x => String(x.id) === String(roomId));
      if (!r) { showToast('Habitación no encontrada', 'error'); return; }
      r.beds[bedKey] = { occupant: null, arrivalDate: null, departureDate: null, company: null, shift: null, rut: null, contact: null, gender: null };
      const anyOccupied = ['day', 'night', 'extra'].some(k => r.beds[k]?.occupant);
      r.status = anyOccupied ? 'occupied' : 'free';
      if (!anyOccupied) r.gender = null;
      await put('rooms', r);
      _updateRoomInCache(r);
      showToast('✅ Cama liberada', 'success');
      window.showRoomDetail(roomId);
      document.getElementById('infra-search')?.dispatchEvent(new Event('input'));
    } catch(err) {
      console.error('[vaciarCama]', err);
      showToast('Error al vaciar la cama: ' + err.message, 'error');
    }
  };

  // ✅ CONFIRMAR SALIDA: Limpieza completa al confirmar checkout
  window.confirmarSalidaCama = async (roomId, bedKey) => {
    const r = await _getRoomFromCache(roomId);
    if (!r) return;
    const who = r.beds[bedKey]?.occupant || 'este ocupante';
    if (!confirm('✅ ¿Confirmar la SALIDA de ' + who + '?\n\nLa cama quedará libre para cargar un nuevo trabajador.')) return;

    // Limpiar la cama completamente (null, no cadena vacía)
    r.beds[bedKey] = {
        occupant: null, company: null, shift: null,
        rut: null, contact: null, gender: null,
        arrivalDate: null, departureDate: null
    };

    // Verificar si quedan otros ocupantes
    const stillOccupied = ['day', 'night', 'extra'].some(k => r.beds?.[k]?.occupant);
    r.status = stillOccupied ? 'occupied' : 'free';
    if (!stillOccupied) r.gender = null;

    try {
        await put('rooms', r);
        _updateRoomInCache(r);
        showToast('✅ Salida de ' + who + ' confirmada — cama disponible', 'success');
        window.showRoomDetail(roomId);
        document.getElementById('infra-search')?.dispatchEvent(new Event('input'));
    } catch(err) {
        console.error('Error al confirmar salida:', err);
        showToast('Error al confirmar salida', 'error');
    }
  };





  // 🔥 MODAL ASIGNAR MANUAL 🔥
  window.asignarManual = async (roomId, bedKey) => {
    document.getElementById('manual-room-id').value = roomId;
    document.getElementById('manual-bed-key').value = bedKey;
    document.getElementById('manual-occupant').value = '';
    document.getElementById('manual-company').value = '';
    document.getElementById('manual-shift').value = '5x2';
    document.getElementById('manual-rut').value = '';
    document.getElementById('manual-contact').value = '';
    document.getElementById('manual-management').value = '';
    document.getElementById('manual-contract').value = '';
    
    // Fechas por defecto
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    document.getElementById('manual-arrival').value = today;
    document.getElementById('manual-departure').value = nextWeek;
    
    // 🔒 REGLA DE ORO: Detectar el género de la habitación según sus camas actuales
    const r = await _getRoomFromCache(roomId);
    const genderSel = document.getElementById('manual-gender');
    
    // Buscar qué género tienen los OCUPANTES ACTUALES (no el campo r.gender que puede ser stale)
    let roomGender = null;
    if (r?.beds) {
        ['day', 'night', 'extra'].forEach(k => {
            if (r.beds[k]?.occupant && r.beds[k]?.gender) {
                roomGender = r.beds[k].gender;
            }
        });
        // Fallback al campo r.gender si las camas no tienen gender guardado
        if (!roomGender && r.gender) roomGender = r.gender;
    }
    
    if (roomGender) {
        // La habitación ya tiene género — bloqueamos el select y mostramos advertencia
        genderSel.value = roomGender;
        genderSel.disabled = true;
        genderSel.style.background = roomGender === 'M' 
            ? 'linear-gradient(135deg,#ebf8ff,#bee3f8)' 
            : 'linear-gradient(135deg,#fff5f7,#fed7e2)';
        genderSel.style.fontWeight = '700';
        genderSel.title = `🔒 Habitación ${roomGender === 'M' ? 'de HOMBRES' : 'de MUJERES'} — No se puede cambiar`;
    } else {
        // Habitación libre — cualquier género
        genderSel.disabled = false;
        genderSel.style.background = '';
        genderSel.style.fontWeight = '';
        genderSel.title = '';
        genderSel.value = 'M';
    }
    
    const modalEl = document.getElementById('manual-assign-modal');
    if (modalEl && modalEl.parentNode !== document.body) {
        document.body.appendChild(modalEl);
    }
    
    // 🏢 Aviso si la hab. está reservada para una empresa
    const existingBanner = document.getElementById('manual-company-banner');
    if (existingBanner) existingBanner.remove();
    if (r?.reservedCompany) {
        const banner = document.createElement('div');
        banner.id = 'manual-company-banner';
        banner.style.cssText = `
            background:linear-gradient(135deg,#fffbeb,#fef3c7);
            border:2px solid #f59e0b;border-radius:10px;
            padding:10px 14px;margin-bottom:12px;
            display:flex;align-items:center;gap:10px`;
        banner.innerHTML = `
            <span style="font-size:20px">🏢</span>
            <div>
              <div style="font-size:13px;font-weight:800;color:#92400e">Hab. reservada para: ${r.reservedCompany.toUpperCase()}</div>
              <div style="font-size:11px;color:#78350f">Puedes cargar igualmente — solo se registra esta reserva</div>
            </div>`;
        const modalBody = modalEl.querySelector('.modal-body');
        if (modalBody) modalBody.insertBefore(banner, modalBody.firstChild);
    }

    modalEl.classList.add('visible');
  };

  window.closeManualAssignModal = () => {
      const modalEl = document.getElementById('manual-assign-modal');
      if (modalEl) modalEl.classList.remove('visible');
      const genderSel = document.getElementById('manual-gender');
      if (genderSel) {
          genderSel.disabled = false;
          genderSel.style.background = '';
          genderSel.style.fontWeight = '';
          genderSel.title = '';
      }
  };

  // ✏️ Mostrar/ocultar panel de edición inline de cama
  window.editBedInfo = (roomId, bedKey) => {
      const panel = document.getElementById(`edit-panel-${roomId}-${bedKey}`);
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  // 💾 Guardar cambios de edición inline (gerencia, contrato, fecha salida)
  window.saveBedEdit = async (roomId, bedKey) => {
      try {
          const management    = document.getElementById(`ep-management-${roomId}-${bedKey}`)?.value?.trim() || '';
          const contractNumber = document.getElementById(`ep-contract-${roomId}-${bedKey}`)?.value?.trim() || '';
          const departureDate  = document.getElementById(`ep-departure-${roomId}-${bedKey}`)?.value || '';

          const r = await _getRoomFromCache(roomId);
          if (!r || !r.beds?.[bedKey]) { showToast('Habitación no encontrada', 'error'); return; }

          r.beds[bedKey].management     = management;
          r.beds[bedKey].contractNumber  = contractNumber;
          if (departureDate) r.beds[bedKey].departureDate = departureDate;

          await put('rooms', r);
          _updateRoomInCache(r);
          showToast('✅ Información actualizada correctamente', 'success');
          window.showRoomDetail(roomId);
      } catch(err) {
          console.error('[saveBedEdit]', err);
          showToast('Error al guardar cambios', 'error');
      }
  };


  window.saveManualAssignment = async () => {
    try {
        const roomId = parseInt(document.getElementById('manual-room-id').value);
        const bedKey = document.getElementById('manual-bed-key').value;
        const occupant = document.getElementById('manual-occupant').value.trim();
        const company = document.getElementById('manual-company').value.trim();
        const rs = document.getElementById('manual-shift').value.trim();
        const gender = document.getElementById('manual-gender').value;
        const rut = document.getElementById('manual-rut').value.trim();
        const contact = document.getElementById('manual-contact').value.trim();
        const management = document.getElementById('manual-management').value.trim();
        const contractNumber = document.getElementById('manual-contract').value.trim();
        
        const arrival = document.getElementById('manual-arrival').value;
        const departure = document.getElementById('manual-departure').value;
        
        if (!occupant || !company || !rs || !arrival || !departure) {
            showToast('Por favor complete Nombre, Empresa, Turno y Fechas', 'warn');
            return;
        }
        
        // 🔒 Anti-clones: usar caché en memoria para verificar (más rápido que IDB)
        const allRooms = window._allRooms || await getAll('rooms');
        
        if (rut) {
            const cleanRut = rut.replace(/[^0-9Kk]/g, '').toUpperCase();
            let cloneRoom = null;
            allRooms.forEach(ro => {
                ['day', 'night', 'extra'].forEach(k => {
                    // Ignorar la cama que estamos modificando ahora mismo
                    if (String(ro.id) === String(roomId) && k === bedKey) return;
                    if (ro.beds && ro.beds[k] && ro.beds[k].occupant && ro.beds[k].rut) {
                        const existingRut = String(ro.beds[k].rut).replace(/[^0-9Kk]/g, '').toUpperCase();
                        if (existingRut === cleanRut) cloneRoom = ro;
                    }
                });
            });
            
            if (cloneRoom) {
                showToast(`⚠️ RUT ${rut} ya está en Hab. ${cloneRoom.number}. Vacíala primero.`, 'error');
                alert(`🛡️ ANTI-CLONES\n\nEl trabajador con RUT ${rut}\nya está asignado en la Habitación ${cloneRoom.number}.\n\nVe a esa habitación y confirma su salida antes de cargarlo aquí.`);
                return;
            }
        }

        
        // 🔒 Leer habitación desde caché (tiene los datos más frescos)
        const r = await _getRoomFromCache(roomId);
        if (!r) {
            showToast('❌ Error: habitación no encontrada en sistema', 'error');
            alert('Error interno: no se pudo localizar la habitación (ID: ' + roomId + ').\n\nCierra el modal y vuelve a abrir la habitación.');
            return;
        }
        
        // 🔒🔒 REGLA DE ORO BLINDADA: verificar el género leyendo DIRECTAMENTE de las camas
        // No confiar en r.gender (puede estar stale/null) — leer de los ocupantes actuales
        let existingRoomGender = null;
        ['day', 'night', 'extra'].forEach(k => {
            if (r.beds?.[k]?.occupant && r.beds[k].gender) {
                existingRoomGender = r.beds[k].gender;
            }
        });
        // Fallback al campo r.gender si las camas no tienen gender registrado
        if (!existingRoomGender && r.gender) existingRoomGender = r.gender;
        
        if (existingRoomGender && existingRoomGender !== gender) {
            const tieneLabel = existingRoomGender === 'M' ? 'HOMBRES' : 'MUJERES';
            const intentaLabel = gender === 'M' ? 'un HOMBRE' : 'una MUJER';
            showToast(`🚫 REGLA DE ORO: habitación de ${tieneLabel}. No se permiten mezclas.`, 'error');
            alert(`🚫 REGLA DE ORO

Esta habitación ya tiene ${tieneLabel}.
No se puede asignar ${intentaLabel} aquí.

Cierra el formulario y elige otra habitación.`);
            // Re-habilitar el select por si acaso
            document.getElementById('manual-gender').disabled = false;
            return;
        }
        
        if (!r.beds) r.beds = {};
        
        r.beds[bedKey] = {
          occupant,
          company,
          shift: rs,
          gender: gender,
          rut: rut,
          contact: contact,
          management: management,
          contractNumber: contractNumber,
          arrivalDate: arrival,
          departureDate: departure
        };
        
        r.status = 'occupied';
        r.gender = gender;
        
        await put('rooms', r);
        
        // 🔒 Actualizar la caché inmediatamente para que showRoomDetail lo vea
        _updateRoomInCache(r);
        
        window.closeManualAssignModal();
        showToast(`✅ ${occupant} asignado a Habitación ${r.number}`, 'success');
        
        window.showRoomDetail(roomId); 
        document.getElementById('infra-search')?.dispatchEvent(new Event('input')); 
    } catch(err) {
        console.error("[saveManualAssignment] Error:", err);
        const msg = err?.message || String(err);
        showToast('❌ Error al guardar: ' + msg.slice(0, 60), 'error');
        alert('❌ Error al guardar la asignación:\n\n' + msg + '\n\nRevisa la consola para más detalles.');
    }
  };


  window.editRoomFromSide = () => {
    window.closeRoomDetail();
    window.openRoomForm(window._detailRoomId);
  };
}

function renderBedDetail(bed, label, icon, roomStatus, bedBlocked, roomId, bedKey) {
  if (bed === null || bed === undefined) return '';

  let content = '';
  const cardClass = 'bed-card-pro';

  if (roomStatus === 'blocked') {
    content = `
      <div style="display:flex; align-items:center; gap:16px; width:100%">
        <div style="width:40px; height:40px; border-radius:10px; background:#f7fafc; display:flex; align-items:center; justify-content:center; font-size:20px">🔒</div>
        <div style="flex:1">
          <div style="font-size:14px; font-weight:700; color:var(--text-primary)">${label} ${icon}</div>
          <div style="font-size:12px; color:var(--text-muted)">Inhabilitada por bloqueo total</div>
        </div>
      </div>`;

  } else if (bedBlocked) {
    content = `
      <div style="display:flex; align-items:center; gap:16px; width:100%">
        <div style="width:40px; height:40px; border-radius:10px; background:#fffaf0; display:flex; align-items:center; justify-content:center; font-size:20px">🔶</div>
        <div style="flex:1">
          <div style="font-size:14px; font-weight:700; color:var(--text-primary)">${label} ${icon}</div>
          <div style="font-size:12px; color:#c05621">Cama bloqueada individualmente</div>
        </div>
      </div>`;

  } else if (!bed.occupant) {
    content = `
      <div style="display:flex; align-items:center; justify-content:space-between; width:100%">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="width:40px; height:40px; border-radius:10px; background:#f0fff4; display:flex; align-items:center; justify-content:center; font-size:20px">🟢</div>
          <div>
            <div style="font-size:14px; font-weight:700; color:var(--text-primary)">${label} ${icon}</div>
            <div style="font-size:12px; color:#276749; font-weight:600">DISPONIBLE</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="window.asignarManual(${roomId}, '${bedKey}')">➕ Cargar</button>
      </div>`;

  } else {
    // Cama ocupada
    const salida = bed.departureDate ? toChileanDate(bed.departureDate) : '-';
    content = `
      <div style="display:flex; align-items:flex-start; gap:16px; width:100%">
        <div style="width:48px; height:48px; border-radius:12px; background:var(--grad-red); display:flex; align-items:center; justify-content:center; font-size:20px; color:#fff; flex-shrink:0">👤</div>
        <div style="flex:1">
          <div style="display:flex; align-items:center; justify-content:space-between">
             <div style="font-size:14px; font-weight:800; color:var(--text-primary)">
                 ${bed.checkoutPending ? '🟡' : bed.present ? '🟢' : bed.checkinAuthorized ? '🔵' : '🔴'} ${bed.occupant}
                 ${bed.checkoutPending ? '<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-weight:700;margin-left:4px">SALIDA SOLICITADA</span>' : ''}
                 ${(!bed.present && !bed.checkoutPending && bed.checkinAuthorized) ? '<span style="font-size:10px;background:#ebf8ff;color:#2b6cb0;padding:2px 8px;border-radius:99px;font-weight:700;margin-left:4px">✅ AUTORIZADO</span>' : ''}
             </div>
             <div style="display:flex;gap:4px">
               <button class="btn btn-ghost btn-sm" style="color:#2b6cb0;font-size:12px" onclick="window.editBedInfo(${roomId}, '${bedKey}')">✏️</button>
               <button class="btn btn-ghost btn-sm" style="color:var(--text-muted)" onclick="window.vaciarCama(${roomId}, '${bedKey}')">🗑️</button>
             </div>
          </div>
          <!-- Panel de edición inline (oculto por defecto) -->
          <div id="edit-panel-${roomId}-${bedKey}" style="display:none;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px;margin-top:8px">
            <div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;margin-bottom:8px">✏️ Editar información</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
              <div>
                <label style="font-size:11px;font-weight:700;color:#6b21a8">🏗️ Gerencia</label>
                <input id="ep-management-${roomId}-${bedKey}" class="form-input" style="margin-top:3px;border-color:#ddd6fe" 
                  placeholder="Ej: Operaciones" value="${bed.management || bed.gerencia || ''}">
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#2b6cb0">📄 N° Contrato</label>
                <input id="ep-contract-${roomId}-${bedKey}" class="form-input" style="margin-top:3px;border-color:#bee3f8" 
                  placeholder="Ej: 2024-001" value="${bed.contractNumber || bed.contract || ''}">
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#276749">📅 Fecha Salida</label>
                <input id="ep-departure-${roomId}-${bedKey}" type="date" class="form-input" style="margin-top:3px" 
                  value="${bed.departureDate || ''}">
              </div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" style="flex:1" onclick="window.saveBedEdit(${roomId}, '${bedKey}')">💾 Guardar</button>
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('edit-panel-${roomId}-${bedKey}').style.display='none'">✕</button>
            </div>
          </div>
          <!-- ✅ Autorización Check-in Panel -->
          <div style="margin-top:12px;">
            ${bed.present ? `
              <div style="display:flex;align-items:center;gap:10px;background:#f0fff4;border:1.5px solid #9ae6b4;border-radius:10px;padding:10px 14px">
                <span style="font-size:20px">🟢</span>
                <div>
                  <div style="font-size:12px;font-weight:800;color:#276749">CHECK-IN CONFIRMADO</div>
                  <div style="font-size:11px;color:#48bb78">${bed.lastCheckIn ? 'Registrado: ' + new Date(bed.lastCheckIn).toLocaleString('es-CL',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}) : 'Presente en campamento'}</div>
                </div>
              </div>` : (bed.checkinAuthorized ? `
              <div style="display:flex;align-items:center;justify-content:space-between;background:#ebf8ff;border:1.5px solid #90cdf4;border-radius:10px;padding:10px 14px;gap:8px">
                <div style="display:flex;align-items:center;gap:10px">
                  <span style="font-size:20px">🔵</span>
                  <div>
                    <div style="font-size:12px;font-weight:800;color:#2b6cb0">CHECK-IN AUTORIZADO</div>
                    <div style="font-size:11px;color:#63b3ed">Esperando confirmación del trabajador</div>
                  </div>
                </div>
                <button class="btn btn-ghost btn-sm" style="color:#e53e3e;font-size:11px;white-space:nowrap" onclick="window.revocarAutorizacion(${roomId}, '${bedKey}')">✕ Revocar</button>
              </div>` : `
              <button class="btn btn-primary btn-sm"
                style="width:100%;background:linear-gradient(135deg,#3182ce,#2b6cb0);font-size:13px;padding:11px;border-radius:10px;letter-spacing:0.3px;font-weight:700"
                onclick="window.autorizarCheckin(${roomId}, '${bedKey}')">
                ✅ Autorizar Check-in (verificó carnet)
              </button>`)}
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:8px">
            <div class="meta-item">
               <span class="meta-label">🏢 EMPRESA</span>
               <span class="meta-val">${bed.company || '-'}</span>
            </div>
            <div class="meta-item">
               <span class="meta-label">🔄 TURNO</span>
               <span class="meta-val">${bed.shift || '-'}</span>
            </div>
            <div class="meta-item">
               <span class="meta-label">⚧ GÉNERO</span>
               <span class="meta-val">${bed.gender === 'M' ? 'Hombre' : (bed.gender === 'F' ? 'Mujer' : '-')}</span>
            </div>
            <div class="meta-item">
               <span class="meta-label">🆔 RUT</span>
               <span class="meta-val">${bed.rut || '-'}</span>
            </div>
            <div class="meta-item">
               <span class="meta-label">📱 CONTACTO</span>
               <span class="meta-val">${bed.contact || '-'}</span>
            </div>
            <div class="meta-item">
               <span class="meta-label">📅 SALIDA</span>
               <span class="meta-val">${salida}</span>
            </div>
             <div class="meta-item" style="grid-column:1/-1;background:linear-gradient(135deg,#f3e8ff,#ede9fe);border:1px solid #ddd6fe;border-radius:8px;padding:6px 10px">
                <span class="meta-label" style="color:#6b21a8">🏗️ GERENCIA</span>
                <span class="meta-val" style="color:#3b0764;font-weight:800">${bed.management || bed.gerencia || '-'}</span>
             </div>
             <div class="meta-item" style="background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;padding:6px 10px">
                <span class="meta-label" style="color:#2b6cb0">📄 N° CONTRATO</span>
                <span class="meta-val" style="color:#1a365d;font-weight:800">${bed.contractNumber || bed.contract || '-'}</span>
             </div>
          </div>
        </div>
      </div>`;
  }

  return `<div class="${cardClass}" style="background: white; border: 1px solid var(--border); border-radius: 12px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.02)">
    ${content}
  </div>`;
}

function updateGridFilters() {
    window.selectFloor(selectedFloor);
}

async function switchTab(tab, container) {
  if (!container) return;
  if (tab === 'map') await renderRoomMap(container);
  else if (tab === 'buildings') await renderBuildingsList(container);
  else await renderRoomsList(container);
}

async function renderRoomMap(container) {
  const [buildings, rooms, censuses] = await Promise.all([
    getAll('buildings').catch(() => []),
    getAll('rooms').catch(() => []),
    getAll('census').catch(() => [])
  ]);

  const todayStr = formatDate(new Date());
  const todayCensuses = censuses.filter(c => c.date === todayStr);
  const censusMap = {};
  todayCensuses.forEach(c => {
      if (!censusMap[c.roomId]) censusMap[c.roomId] = { dayCnt: 0, nightCnt: 0 };
      censusMap[c.roomId].dayCnt += parseInt(c.dayOccupied || 0);
      censusMap[c.roomId].nightCnt += parseInt(c.nightOccupied || 0);
  });
  window._censusMap = censusMap;

  container.innerHTML = `
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#68d391"></div>Libre</div>
      <div class="legend-item"><div class="legend-dot" style="background:#fc8181"></div>Ocupada</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f6e05e"></div>Reservada</div>
      <div class="legend-item"><div class="legend-dot" style="background:#4a5568"></div>Bloqueada Total</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ed8936"></div>Cama bloqueada</div>
    </div>

    <div class="infra-selectors">
      <div class="selector-group" style="margin-bottom:15px; grid-column: 1 / -1">
        <div style="display:flex;gap:10px;align-items:center">
          <div style="position:relative;flex:1">
              <input type="text" id="infra-search" class="form-input" placeholder="🔍 Buscar por Nº Habitación, Nombre, RUT o Empresa..." style="padding-left:40px; height:45px; border-radius:12px; font-size:14px">
              <span style="position:absolute; left:14px; top:50%; transform:translateY(-50%); font-size:18px">🔍</span>
          </div>
          <!-- Botón Asignación Camas (solo admin) -->
          ${(window._currentUser?.role === 'admin' || window._currentUser?.role === 'superadmin') ? `
          <button onclick="window.openAsignacionModal()"
              id="btn-asignacion-camas"
              style="height:45px;padding:0 18px;border-radius:12px;border:none;cursor:pointer;
                     background:linear-gradient(135deg,#1e3a5f,#2c5282);color:#fff;
                     font-weight:700;font-size:13px;white-space:nowrap;
                     box-shadow:0 4px 12px rgba(30,58,95,0.4);
                     display:flex;align-items:center;gap:7px;flex-shrink:0;
                     transition:transform 0.15s,box-shadow 0.15s"
              onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 18px rgba(30,58,95,0.55)'"
              onmouseout="this.style.transform='';this.style.boxShadow='0 4px 12px rgba(30,58,95,0.4)'">
            🗂️ Asignación Camas
          </button>
          <button onclick="window.openCargaMasivaModal()"
              id="btn-carga-masiva"
              style="height:45px;padding:0 18px;border-radius:12px;border:none;cursor:pointer;
                     background:linear-gradient(135deg,#276749,#38a169);color:#fff;
                     font-weight:700;font-size:13px;white-space:nowrap;
                     box-shadow:0 4px 12px rgba(39,103,73,0.4);
                     display:flex;align-items:center;gap:7px;flex-shrink:0;
                     transition:transform 0.15s,box-shadow 0.15s"
              onmouseover="this.style.transform='translateY(-1px)'"
              onmouseout="this.style.transform=''">
            📥 Carga Masiva
          </button>
          <button onclick="window.openAngloModal()"
              id="btn-anglo"
              style="height:45px;padding:0 18px;border-radius:12px;border:none;cursor:pointer;
                     background:linear-gradient(135deg,#7b1d1d,#c0392b);color:#fff;
                     font-weight:700;font-size:13px;white-space:nowrap;
                     box-shadow:0 4px 12px rgba(192,57,43,0.4);
                     display:flex;align-items:center;gap:7px;flex-shrink:0;
                     transition:transform 0.15s,box-shadow 0.15s"
              onmouseover="this.style.transform='translateY(-1px)'"
              onmouseout="this.style.transform=''">
            🏔️ Anglo
          </button>
          <button onclick="window.forceSyncToCloud()"
              id="btn-force-sync"
              style="height:45px;padding:0 18px;border-radius:12px;border:none;cursor:pointer;
                     background:linear-gradient(135deg,#6b46c1,#9f7aea);color:#fff;
                     font-weight:700;font-size:13px;white-space:nowrap;
                     box-shadow:0 4px 12px rgba(107,70,193,0.4);
                     display:flex;align-items:center;gap:7px;flex-shrink:0;
                     transition:transform 0.15s,box-shadow 0.15s"
              onmouseover="this.style.transform='translateY(-1px)'"
              onmouseout="this.style.transform=''">
            ☁️ Sincronizar Nube
          </button>` : ''}
        </div>
      </div>

      <div class="selector-group">
        <label class="form-label">🏢 Seleccionar Pabellón / Edificio:</label>
        <div class="button-selector" id="building-selector-bar">
          <button class="sel-btn ${selectedBuildingId === 'all' ? 'active' : ''}" onclick="window.selectBuilding('all')">Todos</button>
          ${buildings.map(b => `<button class="sel-btn ${selectedBuildingId == b.id ? 'active' : ''}" onclick="window.selectBuilding(${b.id})">${b.name}</button>`).join('')}
        </div>
      </div>
      <div class="selector-group" id="floor-selector-group" style="display:${selectedBuildingId === 'all' ? 'none' : 'block'}">
        <label class="form-label">🪜 Seleccionar Piso:</label>
        <div class="button-selector" id="floor-selector-bar"></div>
      </div>
    </div>
    <div id="room-map-grid"></div>
  `;

  window._allRooms = rooms;
  window._allBuildings = buildings;

  window.selectBuilding = (bid) => {
    selectedBuildingId = bid;
    selectedFloor = 'all';
    renderInfraSelectors();
    updateGridFilters();
  };

  window.selectFloor = (floor) => {
    selectedFloor = floor;
    renderInfraSelectors();
    updateGridFilters();
  };

  document.getElementById('infra-search').addEventListener('input', () => {
    updateGridFilters();
  });

  function renderInfraSelectors() {
    const fGroup = document.getElementById('floor-selector-group');
    const fBar = document.getElementById('floor-selector-bar');
    const bBar = document.getElementById('building-selector-bar');

    if (bBar && buildings) {
        bBar.innerHTML = `<button class="sel-btn ${selectedBuildingId === 'all' ? 'active' : ''}" onclick="window.selectBuilding('all')">Todos</button>` + 
          buildings.map(b => `<button class="sel-btn ${selectedBuildingId == b.id ? 'active' : ''}" onclick="window.selectBuilding(${b.id})">${b.name}</button>`).join('');
    }

    if (selectedBuildingId === 'all') {
        if (fGroup) fGroup.style.display = 'none';
    } else {
        if (fGroup) fGroup.style.display = 'block';
        const b = buildings.find(x => x.id == selectedBuildingId);
        const floorCount = b ? b.floor : 1;
        let floorBtns = `<button class="sel-btn ${selectedFloor === 'all' ? 'active' : ''}" onclick="window.selectFloor('all')">Todos</button>`;
        for (let i = 1; i <= floorCount; i++) {
            floorBtns += `<button class="sel-btn ${selectedFloor == i ? 'active' : ''}" onclick="window.selectFloor(${i})">Piso ${i}</button>`;
        }
        if (fBar) fBar.innerHTML = floorBtns;
    }
  }

  function updateGridFilters() {
    // Guardia: si no hay rooms cargados aún, no hacer nada
    if (!window._allRooms || window._allRooms.length === 0) return;

    const search = (document.getElementById('infra-search')?.value || '').toLowerCase().trim();

    let filtered = window._allRooms;

    if (selectedBuildingId !== 'all') {
      filtered = filtered.filter(r => String(r.buildingId) === String(selectedBuildingId));
    }
    if (selectedFloor !== 'all') {
      filtered = filtered.filter(r => String(r.floor) === String(selectedFloor));
    }

    if (search) {
        filtered = filtered.filter(r => {
            const num  = String(r.number || '').toLowerCase();
            const dName = (r.beds?.day?.occupant   || '').toLowerCase();
            const nName = (r.beds?.night?.occupant || '').toLowerCase();
            const eName = (r.beds?.extra?.occupant || '').toLowerCase();
            const dComp = (r.beds?.day?.company    || '').toLowerCase();
            const nComp = (r.beds?.night?.company  || '').toLowerCase();
            const eComp = (r.beds?.extra?.company  || '').toLowerCase();
            const dRut  = (r.beds?.day?.rut        || '').toLowerCase().replace(/[^0-9k]/g, '');
            const nRut  = (r.beds?.night?.rut      || '').toLowerCase().replace(/[^0-9k]/g, '');
            const eRut  = (r.beds?.extra?.rut      || '').toLowerCase().replace(/[^0-9k]/g, '');
            const sClean = search.replace(/[^0-9k]/g, '') || search;

            return num.includes(search) ||
                   dName.includes(search) || nName.includes(search) || eName.includes(search) ||
                   dComp.includes(search) || nComp.includes(search) || eComp.includes(search) ||
                   (sClean && (dRut.includes(sClean) || nRut.includes(sClean) || eRut.includes(sClean)));
        });
    }

    renderGrid(filtered);
  }

  renderInfraSelectors();
  updateGridFilters();

  // ─────────────────────────────────────────────────────────────────────────
  // ☁️  FORZAR SINCRONIZACIÓN A LA NUBE — sube todo lo local a Supabase
  // ─────────────────────────────────────────────────────────────────────────
  window.forceSyncToCloud = async () => {
    const btn = document.getElementById('btn-force-sync');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizando...'; }

    showToast('☁️ Iniciando sincronización con la nube...', 'info');

    // Importar supabase
    let supabase;
    try {
      const mod = await import('../supabaseClient.js');
      supabase = mod.supabase;
    } catch(e) {
      showToast('❌ No se pudo conectar a Supabase: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '☁️ Sincronizar Nube'; }
      return;
    }

    // Cargar datos locales
    const [rooms, buildings, requests, quotas] = await Promise.all([
      getAll('rooms').catch(() => []),
      getAll('buildings').catch(() => []),
      getAll('b2b_requests').catch(() => []),
      getAll('gerencia_quotas').catch(() => []),
    ]);

    const resultados = [];

    // ── Función de upsert con reintento individual ──────────────────────────
    const upsertTable = async (tableName, items, conflictCol = 'id', batchSize = 25) => {
      if (!items?.length) {
        resultados.push({ table: tableName, ok: 0, fail: 0, skipped: true });
        return;
      }

      // Filtrar registros sin ID válido (evitan errores de upsert)
      const validItems = items.filter(it => it[conflictCol] !== undefined && it[conflictCol] !== null);
      let ok = 0, fail = 0, lastErr = '';

      for (let i = 0; i < validItems.length; i += batchSize) {
        const batch = validItems.slice(i, i + batchSize);
        const { error } = await supabase.from(tableName).upsert(batch, { onConflict: conflictCol });
        if (!error) {
          ok += batch.length;
        } else {
          console.warn(`[Sync] ${tableName} lote ${i}-${i+batchSize} falló, reintentando 1x1...`, error.message);
          lastErr = error.message;
          // Reintento uno a uno
          for (const rec of batch) {
            const { error: e2 } = await supabase.from(tableName).upsert(rec, { onConflict: conflictCol });
            if (!e2) ok++;
            else { fail++; lastErr = e2.message; }
          }
        }
      }

      resultados.push({ table: tableName, ok, fail, lastErr, total: validItems.length });
    };

    // ── Subir en orden (buildings primero porque rooms los referencia) ───────
    await upsertTable('buildings',       buildings, 'id', 20);
    await upsertTable('rooms',           rooms,     'id', 25);
    await upsertTable('b2b_requests',    requests,  'id',  5);
    await upsertTable('gerencia_quotas', quotas,    'id', 20);

    // ── Resultado final ──────────────────────────────────────────────────────
    const totalOk   = resultados.reduce((s, r) => s + (r.ok   || 0), 0);
    const totalFail = resultados.reduce((s, r) => s + (r.fail || 0), 0);
    const firstErr  = resultados.find(r => r.fail > 0)?.lastErr || '';

    const lines = resultados
      .filter(r => !r.skipped)
      .map(r => `${r.fail === 0 ? '✅' : '⚠️'} ${r.table}: ${r.ok}/${r.total}`);

    console.log('[Sync] Resultados:', resultados);

    if (totalFail === 0) {
      showToast(
        `✅ Sync completo — ${buildings.length} edif · ${rooms.length} hab · ${requests.length} sol. · ${quotas.length} cupos`,
        'success'
      );
    } else {
      showToast(
        `⚠️ ${totalOk} registros subidos · ${totalFail} fallaron\n${firstErr.slice(0, 100)}`,
        'warn'
      );
    }

    if (btn) { btn.disabled = false; btn.textContent = '☁️ Sincronizar Nube'; }
  };


  // ─────────────────────────────────────────────────────────────────────────
  // 📥  CARGA MASIVA DIRECTA — Asignación por Excel
  // ─────────────────────────────────────────────────────────────────────────
  window.openCargaMasivaModal = () => {
    const existing = document.getElementById('carga-masiva-modal');
    if (existing) existing.remove();

    const m = document.createElement('div');
    m.id = 'carga-masiva-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9600;'
      + 'display:flex;align-items:center;justify-content:center;padding:16px;';

    m.innerHTML = `
      <div style="background:#fff;border-radius:20px;width:100%;max-width:700px;
                  max-height:92dvh;display:flex;flex-direction:column;overflow:hidden;
                  box-shadow:0 24px 80px rgba(0,0,0,0.35)">
        <!-- Header -->
        <div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div>
            <div style="font-size:18px;font-weight:800;color:#1a202c">📥 Carga Masiva Directa</div>
            <div style="font-size:12px;color:#718096;margin-top:2px">Asigna trabajadores a habitaciones desde un Excel</div>
          </div>
          <button onclick="document.getElementById('carga-masiva-modal').remove()"
            style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:16px">✕</button>
        </div>

        <!-- Instrucciones + descarga plantilla -->
        <div style="padding:16px 22px;background:#f0fff4;border-bottom:1px solid #c6f6d5;flex-shrink:0">
          <div style="font-size:13px;font-weight:700;color:#276749;margin-bottom:8px">📋 Columnas de la plantilla (formato único compartido):</div>
          <div style="font-size:11px;color:#2d3748;font-family:monospace;background:#fff;padding:8px 12px;border-radius:8px;border:1px solid #c6f6d5;line-height:1.8">
            FECHA · Empresa · Ncontrato · Gerencia · RazonSocial · <strong style="color:#276749">NombreHuesped</strong> · <strong style="color:#276749">RUTHuesped</strong> · CONTACTO · <strong style="color:#c53030">HABITACION</strong> · NombreTurno · SistemaTurno · TipoTurno · Estado · FechaInicio · FechaTermino · <strong style="color:#276749">Sexo</strong> · OBSERVACION
          </div>
          <div style="font-size:11px;color:#276749;margin-top:6px">
            💡 <strong>HABITACION</strong> es opcional — si la dejas vacía el sistema asigna automáticamente.
          </div>
          <button onclick="window._downloadCargaMasivaTemplate()"
            style="margin-top:10px;padding:8px 16px;background:linear-gradient(135deg,#276749,#38a169);color:#fff;
                   border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer">
            📥 Descargar Plantilla Excel
          </button>
        </div>

        <!-- Upload area -->
        <div style="padding:16px 22px;flex-shrink:0">
          <input type="file" id="cm-file-input" accept=".xlsx,.xls,.csv" style="display:none"
            onchange="window._parseCargaMasiva(event)">
          <div onclick="document.getElementById('cm-file-input').click()"
            style="border:2px dashed #a0aec0;border-radius:12px;padding:20px;text-align:center;cursor:pointer;
                   transition:border-color 0.2s,background 0.2s"
            onmouseover="this.style.borderColor='#38a169';this.style.background='#f0fff4'"
            onmouseout="this.style.borderColor='#a0aec0';this.style.background='#fff'">
            <div style="font-size:28px;margin-bottom:6px">📂</div>
            <div style="font-weight:700;font-size:14px">Arrastra o haz clic para cargar Excel / CSV</div>
            <div style="font-size:12px;color:#718096;margin-top:4px">Formatos: .xlsx · .xls · .csv</div>
          </div>
        </div>

        <!-- Preview zona scrollable -->
        <div style="flex:1;overflow-y:auto;padding:0 22px 4px">
          <div id="cm-preview" style="display:none">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="font-weight:700;font-size:13px;color:#1a202c">
                Vista previa: <span id="cm-count" style="color:#276749">0</span> trabajadores
              </div>
              <div style="font-size:11px;color:#718096" id="cm-mode-badge"></div>
            </div>
            <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;max-height:280px;overflow-y:auto">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead style="position:sticky;top:0;background:#1a202c;color:#fff">
                  <tr>
                    <th style="padding:8px 10px;text-align:left">Nombre</th>
                    <th style="padding:8px 10px;text-align:left">Empresa</th>
                    <th style="padding:8px 10px;text-align:left">Turno / Sexo</th>
                    <th style="padding:8px 10px;text-align:left">Hab. / Cama</th>
                    <th style="padding:8px 10px;text-align:left">Fechas</th>
                  </tr>
                </thead>
                <tbody id="cm-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;
                    justify-content:space-between;align-items:center;flex-shrink:0;background:#f7fafc">
          <button onclick="document.getElementById('carga-masiva-modal').remove()"
            style="padding:10px 18px;border:1.5px solid #e2e8f0;border-radius:10px;background:#fff;font-weight:600;cursor:pointer">
            Cancelar
          </button>
          <button id="cm-save-btn" onclick="window._processCargaMasiva()" disabled
            style="padding:10px 22px;border:none;border-radius:10px;background:linear-gradient(135deg,#276749,#38a169);
                   color:#fff;font-weight:800;cursor:pointer;opacity:0.5">
            🚀 Asignar Trabajadores
          </button>
        </div>
      </div>`;

    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });

    // ── Datos en memoria para este modal ──────────────────────────────────
    window._cmWorkers = [];

    // ── Descargar plantilla ───────────────────────────────────────────────
    window._downloadCargaMasivaTemplate = async () => {
      try {
        // Cargar ExcelJS si no está disponible
        if (typeof ExcelJS === 'undefined') {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
          });
        }

        const ARAMARK_RED  = 'FFCC0000';
        const ARAMARK_DARK = 'FF8B0000';
        const WHITE        = 'FFFFFFFF';
        const GRAY_BG      = 'FFF5F5F5';
        const HEADER_BG    = 'FF1A202C';

        const wb = new ExcelJS.Workbook();
        wb.creator = 'PC Hotelería'; wb.created = new Date();

        const ws = wb.addWorksheet('Carga Masiva', { views:[{ showGridLines:true }] });

        const colNames  = ['FECHA','Empresa','Ncontrato','Gerencia','RazonSocial','NombreHuesped','RUTHuesped','CONTACTO','HABITACION','NombreTurno','SistemaTurno','TipoTurno','Estado','FechaInicio','FechaTermino','Sexo','OBSERVACION'];
        const colWidths = [14, 20, 13, 20, 34, 28, 14, 14, 12, 12, 14, 12, 12, 14, 14, 8, 28];
        ws.columns = colNames.map((n,i) => ({ header:'', width: colWidths[i] }));

        // Filas 1-3: cabecera roja con logo
        [1,2,3].forEach(r => {
          ws.getRow(r).height = 28;
          for (let c = 1; c <= colNames.length; c++) {
            ws.getRow(r).getCell(c).fill = { type:'pattern', pattern:'solid', fgColor:{ argb: ARAMARK_RED } };
          }
        });

        ws.mergeCells('E1:Q3');
        const titleCell = ws.getCell('E1');
        titleCell.value     = 'SOLICITUD DE ALOJAMIENTO\nPC HOTELERÍA — Carga Masiva';
        titleCell.font      = { name:'Calibri', bold:true, size:16, color:{ argb: WHITE } };
        titleCell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb: ARAMARK_RED } };
        titleCell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };

        // Logo Aramark
        try {
          const resp   = await fetch('./aramark.png');
          const buffer = await resp.arrayBuffer();
          const imgId  = wb.addImage({ buffer, extension:'png' });
          ws.addImage(imgId, { tl:{ col:0.2, row:0.2 }, ext:{ width:170, height:75 } });
        } catch(e) {
          ws.mergeCells('A1:D3');
          const logoCell = ws.getCell('A1');
          logoCell.value     = 'ARAMARK';
          logoCell.font      = { name:'Calibri', bold:true, size:20, color:{ argb: WHITE } };
          logoCell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb: ARAMARK_RED } };
          logoCell.alignment = { horizontal:'center', vertical:'middle' };
        }

        // Fila 4: Administrador de Contrato Anglo
        ws.getRow(4).height = 30;
        ws.mergeCells('A4:C4');
        const angloLabel = ws.getCell('A4');
        angloLabel.value     = 'Administrador de Contrato Anglo:';
        angloLabel.font      = { name:'Calibri', bold:true, size:12, color:{ argb: WHITE } };
        angloLabel.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb: ARAMARK_DARK } };
        angloLabel.alignment = { horizontal:'left', vertical:'middle' };

        ws.mergeCells('D4:Q4');
        const angloVal = ws.getCell('D4');
        angloVal.value     = '';
        angloVal.font      = { name:'Calibri', size:12, italic:true, color:{ argb:'FF999999' } };
        angloVal.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFAF0' } };
        angloVal.alignment = { horizontal:'left', vertical:'middle' };
        angloVal.note      = { texts:[{ font:{ size:10 }, text:'Ingrese aquí el nombre del Administrador de Contrato Anglo' }] };

        // Fila 5: cabecera de columnas
        ws.getRow(5).height = 22;
        colNames.forEach((col, i) => {
          const cell = ws.getRow(5).getCell(i + 1);
          cell.value     = col;
          cell.font      = { name:'Calibri', bold:true, size:11, color:{ argb: WHITE } };
          cell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb: HEADER_BG } };
          cell.alignment = { horizontal:'center', vertical:'middle' };
          cell.border    = { bottom:{ style:'medium', color:{ argb: ARAMARK_RED } } };
        });

        // Fila 6: ejemplo
        ws.getRow(6).height = 20;
        const today = new Date().toISOString().split('T')[0];
        const sample = [today,'Aramark','42300031','INFRAESTRUCTURA Y SERVICIO','Aramark Servicios Mineros S.A.','Juan Perez','12345678-9','987654321','','8x6','Sistema A','Dia','Pendiente','2026-04-16','2026-04-23','M',''];
        sample.forEach((val, i) => {
          const cell = ws.getRow(6).getCell(i + 1);
          cell.value     = val;
          cell.font      = { name:'Calibri', size:11 };
          cell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb: GRAY_BG } };
          cell.alignment = { vertical:'middle' };
        });

        // Nota en HABITACION
        ws.getRow(5).getCell(9).note = { texts:[{ text:'Opcional — dejar vacío para auto-asignación por género/empresa' }] };

        const xlsBuffer = await wb.xlsx.writeBuffer();
        const blob      = new Blob([xlsBuffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fname     = `formato_carga_masiva_${new Date().toISOString().split('T')[0]}.xlsx`;

        if (window.showSaveFilePicker) {
          try {
            const handle   = await window.showSaveFilePicker({ suggestedName: fname, types:[{ description:'Excel', accept:{ 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx'] } }] });
            const writable = await handle.createWritable();
            await writable.write(blob); await writable.close(); return;
          } catch(e) { if (e.name === 'AbortError') return; }
        }
        const url = URL.createObjectURL(blob);
        const a   = Object.assign(document.createElement('a'), { href:url, download:fname });
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);

      } catch(err) {
        console.error('[CargaMasiva template]', err);
        showToast('Error generando plantilla: ' + err.message, 'error');
      }
    };

    // ── Parsear archivo ───────────────────────────────────────────────────
    window._parseCargaMasiva = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type:'array', cellDates:true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
          if (rows.length < 2) { showToast('Archivo vacío o sin datos', 'error'); return; }

          const fmt = v => {
            if (!v && v !== 0) return '';
            if (v instanceof Date) return v.toISOString().split('T')[0];
            return String(v).trim();
          };
          const cleanDate = v => {
            const s = fmt(v);
            if (!s) return '';
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
            if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) {
              const [d,m,y] = s.split(/[\/\-]/);
              return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
            }
            return s.split('T')[0] || s;
          };

          // ── 1. Detectar fila de encabezados ─────────────────────────────
          // Busca la primera fila que contiene al menos 2 nombres clave conocidos
          const KNOWN_HEADERS = [
            'nombrehuesped','nombre','ruthu','rut','empresa','company',
            'habitacion','hab','room','gerencia','turno','sexo','gender',
            'fechainicio','fechatermino','ncontrato','contrato'
          ];
          let headerRowIdx = -1;
          let colMap = {}; // { fieldName: columnIndex }

          for (let ri = 0; ri < Math.min(rows.length, 10); ri++) {
            const row = rows[ri];
            if (!row || !row.length) continue;
            const normalized = row.map(c => fmt(c).toLowerCase().replace(/[^a-z0-9]/g,''));
            const hits = normalized.filter(h => KNOWN_HEADERS.some(k => h.includes(k)));
            if (hits.length >= 2) {
              headerRowIdx = ri;
              // Mapear cada columna conocida a su índice
              normalized.forEach((h, idx) => {
                if (h.includes('nombrehuesped') || (h === 'nombre' && !colMap.name)) colMap.name = idx;
                if (h.includes('ruthue') || (h === 'rut' && !colMap.rut))            colMap.rut = idx;
                if (h.includes('empresa') || h.includes('razon') || h.includes('company')) colMap.company = idx;
                if (h.includes('gerencia'))          colMap.gerencia = idx;
                if (h.includes('ncontrato') || h.includes('contrato')) colMap.contract = idx;
                if (h.includes('habitacion') || (h === 'hab') || (h === 'room')) colMap.room = idx;
                if (h.includes('nombreturn') || (h.includes('turno') && !colMap.shift) || h.includes('turno')) colMap.shift = idx;
                if (h.includes('fechainicio') || h.includes('ingreso'))  colMap.arrival = idx;
                if (h.includes('fechatermino') || h.includes('salida'))  colMap.departure = idx;
                if (h.includes('sexo') || h.includes('genero') || h.includes('gender')) colMap.sex = idx;
                if (h.includes('contacto') || h.includes('telefono'))    colMap.contact = idx;
              });
              break;
            }
          }

          // ── 2. Fallback posicional si no se encontró header ──────────────
          const hasHeader = headerRowIdx !== -1;
          const dataStart = hasHeader ? headerRowIdx + 1 : 0;

          if (!hasHeader) {
            // Formato clásico posicional
            colMap = { name:5, rut:6, company:1, gerencia:3, contract:2,
                       shift:9, sex:15, room:8, arrival:13, departure:14, contact:7 };
          }

          // ── 3. Extraer trabajadores ──────────────────────────────────────
          window._cmWorkers = rows.slice(dataStart).map(row => {
            if (!Array.isArray(row) || row.length < 3) return null;
            const name = fmt(row[colMap.name ?? 5]);
            if (!name || name.toLowerCase().includes('nombrehuesped')) return null;
            return {
              name,
              rut:            fmt(row[colMap.rut     ?? 6]),
              company:        fmt(row[colMap.company  ?? 1]),
              gerencia:       fmt(row[colMap.gerencia ?? 3]),
              contractNumber: fmt(row[colMap.contract ?? 2]),
              shift:          fmt(row[colMap.shift    ?? 9]),
              sex:            (fmt(row[colMap.sex     ?? 15]) || 'M').toUpperCase().charAt(0),
              roomNumber:     fmt(row[colMap.room     ?? 8]),
              contact:        fmt(row[colMap.contact  ?? 7]),
              arrivalDate:    cleanDate(row[colMap.arrival   ?? 13]),
              departureDate:  cleanDate(row[colMap.departure ?? 14]),
              bedSlot:        '',
            };
          }).filter(Boolean);

          if (window._cmWorkers.length === 0) { showToast('No se encontraron trabajadores', 'error'); return; }

          // Preview — separar conteo entre hab. definida y auto
          const conHab   = window._cmWorkers.filter(w => w.roomNumber).length;
          const sinHab   = window._cmWorkers.length - conHab;
          document.getElementById('cm-count').textContent = window._cmWorkers.length;

          // Badge con ambos modos si aplica
          let badgeHtml = '';
          if (conHab > 0 && sinHab > 0) {
            badgeHtml = `<span style="background:#dcfce7;color:#166534;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700">🏠 ${conHab} con hab.</span>
                         <span style="background:#dbeafe;color:#1e40af;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;margin-left:4px">🤖 ${sinHab} auto</span>`;
          } else if (conHab > 0) {
            badgeHtml = `<span style="background:#dcfce7;color:#166534;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700">🏠 Todos con habitación especificada</span>`;
          } else {
            badgeHtml = `<span style="background:#dbeafe;color:#1e40af;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700">🤖 Todos por auto-asignación</span>`;
          }
          document.getElementById('cm-mode-badge').innerHTML = badgeHtml;

          document.getElementById('cm-tbody').innerHTML = window._cmWorkers.map(w => {
            const tieneHab = !!w.roomNumber;
            const rowBg = tieneHab ? '#f0fff4' : '#f0f9ff';
            const habCell = tieneHab
              ? `<span style="background:#dcfce7;color:#166534;padding:3px 9px;border-radius:8px;font-weight:800;font-size:12px">🏠 Hab.${w.roomNumber}</span>`
              : `<span style="background:#dbeafe;color:#1e40af;padding:3px 9px;border-radius:8px;font-weight:700;font-size:12px">🤖 Auto</span>`;
            return `
            <tr style="border-bottom:1px solid #f0f4f8;background:${rowBg}">
              <td style="padding:7px 10px;font-weight:600">${w.name}</td>
              <td style="padding:7px 10px;color:#718096;font-size:12px">${w.company || '—'}${w.gerencia ? '<br><span style="font-size:10px;color:#9ca3af">'+w.gerencia+'</span>' : ''}</td>
              <td style="padding:7px 10px;font-size:12px">${w.shift || '—'} / ${w.sex}</td>
              <td style="padding:7px 10px">${habCell}</td>
              <td style="padding:7px 10px;font-size:11px">${w.arrivalDate || '—'}<br><span style="color:#c53030">${w.departureDate || '—'}</span></td>
            </tr>`;
          }).join('');

          document.getElementById('cm-preview').style.display = 'block';
          const btn = document.getElementById('cm-save-btn');
          btn.disabled = false;
          btn.style.opacity = '1';
        } catch(err) {
          console.error('[CargaMasiva]', err);
          showToast('Error al leer el archivo: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    };

    // ── Procesar y asignar ────────────────────────────────────────────────
    window._processCargaMasiva = async () => {
      if (!window._cmWorkers?.length) return;
      const btn = document.getElementById('cm-save-btn');
      btn.disabled = true;
      btn.textContent = '⏳ Procesando...';

      try {
        const rooms = await getAll('rooms');

        // Índice multi-clave: cada hab. se indexa por número exacto, trimmed, y como entero
        // Esto tolera diferencias de formato entre el Excel (4101) y la BD ("4101" o 4101)
        const roomsByNumber = {};
        rooms.forEach(r => {
          const n = r.number;
          if (n === undefined || n === null) return;
          roomsByNumber[String(n)]         = r;  // "4101"
          roomsByNumber[String(n).trim()]  = r;  // "4101" sin espacios
          roomsByNumber[parseInt(n, 10)]   = r;  // 4101 como entero (clave numérica)
          // También con cero padding por si acaso: "04101"
          const padded = String(n).trim().replace(/^0+/, '');
          roomsByNumber[padded] = r;
        });
        const roomNums = [...new Set((window._cmWorkers||[]).map(w=>w.roomNumber).filter(Boolean))];
        console.log(`[CargaMasiva] ${rooms.length} hab. en DB. Nums en Excel:`, roomNums.join(', '));
        console.log(`[CargaMasiva] Muestra claves DB:`, Object.keys(roomsByNumber).filter(k=>k&&k!=='NaN').slice(0,8).join(' | '));
        // Detectar mismatches
        const numsSinMatch = roomNums.filter(n => !roomsByNumber[n] && !roomsByNumber[String(n).trim()] && !roomsByNumber[parseInt(n,10)]);
        if (numsSinMatch.length > 0) {
          console.warn(`[CargaMasiva] HAB. NO ENCONTRADAS EN DB:`, numsSinMatch.join(', '));
        }

        const slotMap = { '1':'day','2':'night','3':'extra','a':'day','b':'night','c':'extra',
                          'cama 1':'day','cama 2':'night','cama 3':'extra','day':'day','night':'night','extra':'extra' };

        let asignados = 0, fallidos = 0, yaOcupados = 0, generoConflicto = 0, habLlenas = 0, preAsignados = 0;
        const roomsToUpdate = {};

        // Recolectar RUTs ya ocupados (anti-clones)
        const rutsOcupados = new Set();
        rooms.forEach(r => {
          ['day','night','extra'].forEach(k => {
            if (r.beds?.[k]?.rut) rutsOcupados.add(String(r.beds[k].rut).replace(/[^0-9Kk]/g,'').toUpperCase());
          });
        });

        const normalizeGender = g => (g||'M').toUpperCase().charAt(0);

        for (const w of window._cmWorkers) {
          // Anti-clon
          const cleanRut = (w.rut||'').replace(/[^0-9Kk]/g,'').toUpperCase();
          if (cleanRut && rutsOcupados.has(cleanRut)) { yaOcupados++; continue; }

          const bedData = {
            occupant:      w.name,
            company:       w.company,
            shift:         w.shift,
            gender:        normalizeGender(w.sex),
            rut:           w.rut,
            management:    w.gerencia,
            contractNumber: w.contractNumber,
            arrivalDate:   w.arrivalDate,
            departureDate: w.departureDate,
          };

          let assigned = false;

          // ─── MODO A: habitación especificada en el Excel ────────────────────
          // Si el usuario especificó una habitación, SE RESPETA siempre:
          // no se auto-asigna a otra aunque haya conflicto de género o esté llena.
          if (w.roomNumber) {
            const r = roomsToUpdate[w.roomNumber] || roomsByNumber[String(w.roomNumber)];
            if (!r) {
              // Habitación no encontrada en la DB
              console.warn(`[CargaMasiva] Hab. "${w.roomNumber}" no encontrada para ${w.name}`);
              fallidos++;
              continue; // No auto-asignar, solo reportar
            }
            if (!r.beds) r.beds = {};
            const preferredSlot = slotMap[(w.bedSlot||'').toLowerCase()] || null;
            const slots = preferredSlot ? [preferredSlot,'day','night','extra'] : ['day','night','extra'];
            let habitacionLlena = true;
            for (const slot of slots) {
              const maxBeds = r.bedCount || 2;
              if (slot === 'extra' && maxBeds < 3) continue;
              if (!r.beds[slot]?.occupant) {
                habitacionLlena = false;
                // Verificar género — si hay conflicto, registrar pero continuar sin asignar
                const existGender = ['day','night','extra']
                  .map(k => r.beds?.[k]?.occupant ? (r.beds[k].gender||null) : null)
                  .find(Boolean);
                if (existGender && existGender !== normalizeGender(w.sex)) {
                  generoConflicto++;
                  break; // Conflicto en esta hab. → NO reasignar en otra
                }
                r.beds[slot] = bedData;
                r.status = 'occupied';
                r.gender = normalizeGender(w.sex);
                roomsToUpdate[w.roomNumber] = r;
                if (cleanRut) rutsOcupados.add(cleanRut);
                asignados++; assigned = true; break;
              }
            }
            if (!assigned && !habitacionLlena) { /* conflicto género, ya contado */ }
            if (!assigned && habitacionLlena) {
              // 🔄 MODO TURNO ROTATIVO: ¿alguna cama libera antes de que llegue el nuevo?
              let preAsignado = false;
              if (w.arrivalDate) {
                for (const slot of ['day', 'night', 'extra']) {
                  const maxBeds = r.bedCount || 2;
                  if (slot === 'extra' && maxBeds < 3) continue;
                  const bedActual = r.beds?.[slot];
                  if (bedActual?.occupant && bedActual.departureDate && bedActual.departureDate <= w.arrivalDate) {
                    // El ocupante sale ANTES O EL MISMO DÍA que llega el nuevo → pre-asignar
                    const existGender = ['day','night','extra']
                      .map(k => r.beds?.[k]?.occupant ? (r.beds[k].gender||null) : null)
                      .find(Boolean);
                    if (existGender && existGender !== normalizeGender(w.sex)) {
                      generoConflicto++; break;
                    }
                    r.beds[slot] = {
                      ...bedActual,
                      nextOccupant: { ...bedData }  // ← pre-asignado al turno entrante
                    };
                    roomsToUpdate[w.roomNumber] = r;
                    if (cleanRut) rutsOcupados.add(cleanRut);
                    preAsignados++; preAsignado = true;
                    assigned = true; break;
                  }
                }
              }
              if (!preAsignado) habLlenas++;
            }
            continue; // No caer a MODO B si se especificó habitación
          }

          // ─── MODO B: auto-asignación (solo cuando NO hay habitación definida) ─
          {
            const wSex = normalizeGender(w.sex);
            const candidates = rooms.filter(r => {
              if (r.status === 'blocked') return false;
              const existGender = ['day','night','extra'].map(k => r.beds?.[k]?.occupant ? (r.beds[k].gender||null) : null).find(Boolean);
              if (r.gender && r.gender !== wSex) return false;
              if (existGender && existGender !== wSex) return false;
              return !r.beds?.day?.occupant || !r.beds?.night?.occupant || ((r.bedCount||2) >= 3 && !r.beds?.extra?.occupant);
            }).sort((a,b) => {
              const aOcc = ['day','night','extra'].filter(k => a.beds?.[k]?.occupant).length;
              const bOcc = ['day','night','extra'].filter(k => b.beds?.[k]?.occupant).length;
              return bOcc - aOcc;
            });

            for (const r of candidates) {
              if (!r.beds) r.beds = {};
              for (const slot of ['day','night','extra']) {
                if (slot === 'extra' && (r.bedCount||2) < 3) continue;
                if (!r.beds[slot]?.occupant) {
                  r.beds[slot] = bedData;
                  r.status = 'occupied';
                  r.gender = wSex;
                  roomsToUpdate[r.number] = r;
                  if (cleanRut) rutsOcupados.add(cleanRut);
                  asignados++; assigned = true; break;
                }
              }
              if (assigned) break;
            }
            if (!assigned) fallidos++;
          }
        }

        // Guardar todo en paralelo
        await Promise.all(Object.values(roomsToUpdate).map(r => put('rooms', r)));

        // Actualizar caché de infra
        if (window._allRooms) {
          Object.values(roomsToUpdate).forEach(updated => {
            const idx = window._allRooms.findIndex(r => String(r.id) === String(updated.id));
            if (idx !== -1) window._allRooms[idx] = updated;
          });
        }
        window.dispatchEvent(new CustomEvent('rooms-updated'));

        document.getElementById('carga-masiva-modal')?.remove();

        let msg = asignados > 0 || preAsignados > 0 ? `✅ ${asignados} asignados` : `⚠️ 0 asignados`;
        if (preAsignados   > 0) msg += ` · 🔄 ${preAsignados} pre-asignados (turno rotativo)`;
        if (yaOcupados     > 0) msg += ` · 🛡️ ${yaOcupados} ya tenían cama`;
        if (habLlenas      > 0) msg += ` · 🔴 ${habLlenas} hab. llenas`;
        if (generoConflicto> 0) msg += ` · ⚡ ${generoConflicto} conflicto género`;
        if (fallidos       > 0) msg += ` · ❓ ${fallidos} hab. no encontradas`;
        showToast(msg, asignados > 0 || preAsignados > 0 ? 'success' : 'warn');

        // Refrescar vista
        document.getElementById('infra-search')?.dispatchEvent(new Event('input'));

      } catch(err) {
        console.error('[CargaMasiva procesado]', err);
        showToast('Error al procesar: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '🚀 Asignar Trabajadores';
      }
    };
  };


  // ─────────────────────────────────────────────────────────────────────────
  // 🏔️  CARGA MASIVA ANGLO — 1 por cama, HABITACION obligatoria
  // ─────────────────────────────────────────────────────────────────────────
  window.openAngloModal = () => {
    const existing = document.getElementById('anglo-modal');
    if (existing) existing.remove();

    const m = document.createElement('div');
    m.id = 'anglo-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9650;display:flex;align-items:center;justify-content:center;padding:16px;';

    m.innerHTML = `
      <div style="background:#fff;border-radius:20px;width:100%;max-width:680px;max-height:92dvh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.4)">
        <div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#7b1d1d,#c0392b);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div>
            <div style="font-size:18px;font-weight:800;color:#fff">🏔️ Carga Masiva Anglo</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px">1 trabajador por cama · Habitación obligatoria en Excel</div>
          </div>
          <button onclick="document.getElementById('anglo-modal').remove()" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:16px;color:#fff">✕</button>
        </div>
        <div style="padding:14px 22px;background:#fff5f5;border-bottom:1px solid #feb2b2;flex-shrink:0">
          <div style="font-size:13px;font-weight:700;color:#c0392b;margin-bottom:8px">📋 Reglas Anglo:</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#2d3748">
            <div style="background:#fff;padding:8px 12px;border-radius:8px;border:1px solid #feb2b2">✅ <b>HABITACION obligatoria</b> — sin hab. = se omite</div>
            <div style="background:#fff;padding:8px 12px;border-radius:8px;border:1px solid #feb2b2">🛏 <b>1 persona por cama</b> — día o noche disponible</div>
            <div style="background:#fff;padding:8px 12px;border-radius:8px;border:1px solid #feb2b2">🔄 <b>2 cargas</b> — 1ª llena camas vacías, 2ª completa</div>
            <div style="background:#fff;padding:8px 12px;border-radius:8px;border:1px solid #feb2b2">🏔 <b>Hab. marcada Anglo</b> — reserva exclusiva</div>
          </div>
          <div style="font-size:11px;color:#718096;margin-top:8px;font-family:monospace;background:#fff;padding:6px 10px;border-radius:6px">
            Columnas: FECHA · Empresa · Ncontrato · Gerencia · RazonSocial · NombreHuesped · RUTHuesped · CONTACTO · HABITACION · NombreTurno · ... · FechaInicio · FechaTermino · Sexo · OBSERVACION
          </div>
        </div>
        <div style="padding:16px 22px;flex-shrink:0">
          <input type="file" id="anglo-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="window._parseAngloExcel(event)">
          <div onclick="document.getElementById('anglo-file-input').click()"
            style="border:2.5px dashed #feb2b2;border-radius:12px;padding:24px;text-align:center;cursor:pointer;background:#fff5f5;transition:background 0.2s;user-select:none"
            onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='#fff5f5'">
            <div style="font-size:32px;margin-bottom:8px">📂</div>
            <div style="font-weight:700;color:#c0392b;font-size:14px">Seleccionar Excel Anglo</div>
            <div style="color:#718096;font-size:12px;margin-top:4px">.xlsx · .xls · .csv</div>
          </div>
        </div>
        <div id="anglo-preview" style="flex:1;overflow-y:auto;padding:0 22px 16px;display:none">
          <div id="anglo-preview-content"></div>
        </div>
        <div style="padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;background:#fafafa">
          <span id="anglo-count-label" style="font-size:13px;color:#718096;font-weight:600"></span>
          <button id="anglo-save-btn" onclick="window._processAngloExcel()" disabled
            style="padding:10px 24px;border-radius:10px;border:none;cursor:pointer;background:linear-gradient(135deg,#7b1d1d,#c0392b);color:#fff;font-weight:800;font-size:14px;opacity:0.4;transition:opacity 0.2s;box-shadow:0 4px 12px rgba(192,57,43,0.3)">
            🏔️ Asignar Trabajadores Anglo
          </button>
        </div>
      </div>`;

    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });

    window._parseAngloExcel = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs');
          const wb   = XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: true });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (raw.length < 2) { showToast('Excel vacío o sin datos', 'warn'); return; }
          const fmt = v => (v ?? '').toString().trim();
          const parseDate = v => {
            if (!v) return '';
            if (v instanceof Date) return v.toISOString().split('T')[0];
            return String(v).split('T')[0];
          };
          window._angloWorkers = [];
          const header = raw[0].map(h => fmt(h).toLowerCase());
          const hasHeader = header.some(h => ['nombrehuesped','nombre','nombredelhuesped'].includes(h));
          for (let i = (hasHeader ? 1 : 0); i < raw.length; i++) {
            const row = raw[i];
            if (!row.some(c => fmt(c))) continue;
            let name, rut, company, gerencia, contractNumber, roomNumber, shift, arrivalDate, departureDate, sex, contact;
            if (hasHeader) {
              const get = (...keys) => {
                for (const k of keys) {
                  const idx = header.findIndex(h => h.includes(k));
                  if (idx !== -1) return fmt(row[idx]);
                }
                return '';
              };
              name           = get('nombrehuesped','nombre');
              rut            = get('ruthuesped','rut');
              company        = get('empresa','razon');
              gerencia       = get('gerencia');
              contractNumber = get('ncontrato','contrato');
              roomNumber     = get('habitacion','hab');
              shift          = get('nombreturn','turno');
              const idxI = header.findIndex(h => h.includes('fechainicio') || h.includes('ingreso'));
              const idxT = header.findIndex(h => h.includes('fechatermino') || h.includes('salida'));
              arrivalDate   = idxI !== -1 ? parseDate(row[idxI]) : '';
              departureDate = idxT !== -1 ? parseDate(row[idxT]) : '';
              sex            = get('sexo','genero');
              contact        = get('contacto');
            } else {
              name = fmt(row[5]); rut = fmt(row[6]); company = fmt(row[1]);
              gerencia = fmt(row[3]); contractNumber = fmt(row[2]);
              roomNumber = fmt(row[8]); shift = fmt(row[9]);
              arrivalDate = parseDate(row[13]); departureDate = parseDate(row[14]);
              sex = fmt(row[15]); contact = fmt(row[7]);
            }
            if (!name) continue;
            window._angloWorkers.push({ name, rut, company: company || 'Anglo American', gerencia, contractNumber, roomNumber, shift, arrivalDate, departureDate, sex, contact });
          }
          const sinHab = window._angloWorkers.filter(w => !w.roomNumber).length;
          const conHab = window._angloWorkers.filter(w =>  w.roomNumber).length;
          document.getElementById('anglo-count-label').textContent =
            `📋 ${window._angloWorkers.length} trabajadores · 🏠 ${conHab} con hab. ${sinHab ? '· ⚠️ ' + sinHab + ' sin hab.' : ''}`;
          let rows = '';
          window._angloWorkers.slice(0, 80).forEach((w, i) => {
            rows += `<tr style="${i%2===0?'background:#fafafa;':''}">
              <td style="padding:7px 10px;font-weight:700">${w.name}</td>
              <td style="padding:7px 10px;font-size:11px;color:#64748b">${w.rut||'—'}</td>
              <td style="padding:7px 10px">
                ${w.roomNumber
                  ? `<span style="background:#fee2e2;color:#c0392b;padding:2px 8px;border-radius:8px;font-weight:800;font-size:12px">🏠 ${w.roomNumber}</span>`
                  : `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">⚠️ Sin hab.</span>`}
              </td>
              <td style="padding:7px 10px;font-size:11px">${w.shift||'—'}</td>
              <td style="padding:7px 10px;font-size:11px;color:#64748b">${w.departureDate||'—'}</td>
            </tr>`;
          });
          if (window._angloWorkers.length > 80) rows += `<tr><td colspan="5" style="text-align:center;padding:10px;color:#94a3b8;font-size:12px">... y ${window._angloWorkers.length-80} más</td></tr>`;
          const preview = document.getElementById('anglo-preview');
          document.getElementById('anglo-preview-content').innerHTML = `
            <h4 style="font-weight:800;font-size:14px;color:#1a202c;margin:12px 0 8px">Vista previa</h4>
            <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead style="background:#fee2e2"><tr>
                <th style="padding:8px 10px;text-align:left">Nombre</th>
                <th style="padding:8px 10px;text-align:left">RUT</th>
                <th style="padding:8px 10px;text-align:left">Habitación</th>
                <th style="padding:8px 10px;text-align:left">Turno</th>
                <th style="padding:8px 10px;text-align:left">Salida</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`;
          preview.style.display = 'block';
          const saveBtn = document.getElementById('anglo-save-btn');
          saveBtn.disabled = conHab === 0;
          saveBtn.style.opacity = conHab > 0 ? '1' : '0.4';
        } catch(err) {
          console.error('[Anglo Parser]', err);
          showToast('Error al leer archivo: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    };

    window._processAngloExcel = async () => {
      if (!window._angloWorkers?.length) return;
      const btn = document.getElementById('anglo-save-btn');
      btn.disabled = true; btn.textContent = '⏳ Asignando...';
      try {
        const rooms = await getAll('rooms');
        const roomsByNumber = {};
        rooms.forEach(r => { roomsByNumber[String(r.number)] = r; });
        const rutsOcupados = new Set();
        rooms.forEach(r => {
          ['day','night','extra'].forEach(k => {
            if (r.beds?.[k]?.rut) rutsOcupados.add(String(r.beds[k].rut).replace(/[^0-9Kk]/g,'').toUpperCase());
          });
        });
        let asignados = 0, sinHab = 0, yaOcupados = 0, habLlenas = 0, noEncontradas = 0;
        const roomsToUpdate = {};
        for (const w of window._angloWorkers) {
          if (!w.roomNumber) { sinHab++; continue; }
          const cleanRut = (w.rut||'').replace(/[^0-9Kk]/g,'').toUpperCase();
          if (cleanRut && rutsOcupados.has(cleanRut)) { yaOcupados++; continue; }
          const r = roomsToUpdate[w.roomNumber] || roomsByNumber[String(w.roomNumber)];
          if (!r) { noEncontradas++; continue; }
          if (!r.beds) r.beds = {};
          const bedData = {
            occupant: w.name, company: w.company || 'Anglo American',
            shift: w.shift, gender: (w.sex||'M').toUpperCase().charAt(0),
            rut: w.rut, management: w.gerencia, contractNumber: w.contractNumber,
            arrivalDate: w.arrivalDate, departureDate: w.departureDate, contact: w.contact,
          };
          let assigned = false;
          for (const slot of ['day','night','extra']) {
            if (slot === 'extra' && (r.bedCount||2) < 3) continue;
            if (!r.beds[slot]?.occupant) {
              r.beds[slot] = bedData;
              r.status = 'occupied';
              r.reservedCompany = 'Anglo American';
              roomsToUpdate[w.roomNumber] = r;
              if (cleanRut) rutsOcupados.add(cleanRut);
              asignados++; assigned = true; break;
            }
          }
          if (!assigned) habLlenas++;
        }
        await Promise.all(Object.values(roomsToUpdate).map(r => put('rooms', r)));
        if (window._allRooms) {
          Object.values(roomsToUpdate).forEach(updated => {
            const idx = window._allRooms.findIndex(r => String(r.id) === String(updated.id));
            if (idx !== -1) window._allRooms[idx] = updated;
          });
        }
        window.dispatchEvent(new CustomEvent('rooms-updated'));
        document.getElementById('anglo-modal')?.remove();
        let msg = `✅ Anglo: ${asignados} asignados en ${Object.keys(roomsToUpdate).length} hab.`;
        if (sinHab      > 0) msg += ` · ⚠️ ${sinHab} sin HABITACION`;
        if (yaOcupados  > 0) msg += ` · 🛡️ ${yaOcupados} ya tenían cama`;
        if (habLlenas   > 0) msg += ` · 🔴 ${habLlenas} hab. llenas`;
        if (noEncontradas > 0) msg += ` · ❓ ${noEncontradas} hab. no encontradas`;
        showToast(msg, asignados > 0 ? 'success' : 'warn');
        document.getElementById('infra-search')?.dispatchEvent(new Event('input'));
      } catch(err) {
        console.error('[Anglo Procesado]', err);
        showToast('Error al asignar: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = '🏔️ Asignar Trabajadores Anglo';
      }
    };
  };


  // ─────────────────────────────────────────────────────────────────────────
  // 🗂️  ASIGNACIÓN DE CAMAS (reemplaza al antiguo "Reservar")
  // ─────────────────────────────────────────────────────────────────────────
  window.openAsignacionModal = () => {
    let asigModal = document.getElementById('asig-camas-modal');
    if (asigModal) asigModal.remove();

    asigModal = document.createElement('div');
    asigModal.id = 'asig-camas-modal';
    asigModal.style.cssText =
        'display:block;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9500;'
      + 'backdrop-filter:blur(5px);padding:16px;overflow-y:auto;';

    asigModal.innerHTML = `
    <div style="background:#fff;border-radius:22px;max-width:520px;margin:0 auto;
                box-shadow:0 28px 70px rgba(0,0,0,0.35);overflow:hidden;font-family:inherit">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1e3a5f,#2c5282);padding:20px 22px;color:#fff">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:19px;font-weight:800">\ud83d\uddc2\ufe0f Asignaci\u00f3n de Camas</div>
            <div style="font-size:12px;opacity:0.75;margin-top:2px">Clasificaci\u00f3n por turno y empresa</div>
          </div>
          <button id="asig-close-btn"
              style="background:rgba(255,255,255,0.15);border:none;color:#fff;
                     width:34px;height:34px;border-radius:50%;font-size:18px;
                     cursor:pointer;display:flex;align-items:center;justify-content:center">\u2715</button>
        </div>
        <!-- 3 Modos -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px" id="asig-mode-btns">
          <button data-mode="noche"
              style="padding:10px 4px;border-radius:11px;border:2px solid rgba(255,255,255,0.9);
                     background:rgba(255,255,255,0.2);color:#fff;font-weight:800;font-size:12px;cursor:pointer">
            \ud83c\udf19 Nocheros</button>
          <button data-mode="empresa"
              style="padding:10px 4px;border-radius:11px;border:2px solid rgba(255,255,255,0.25);
                     background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);font-weight:700;font-size:12px;cursor:pointer">
            \ud83c\udfe2 Empresa</button>
          <button data-mode="4x3"
              style="padding:10px 4px;border-radius:11px;border:2px solid rgba(255,255,255,0.25);
                     background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);font-weight:700;font-size:12px;cursor:pointer">
            4\ufe0f\u20e3 Turno 4x3</button>
        </div>
      </div>

      <!-- Cuerpo -->
      <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
        <div id="asig-desc" style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;
             padding:10px 14px;font-size:13px;color:#1e40af;font-weight:600">
          \ud83c\udf19 Las hab. seleccionadas se clasificar\u00e1n como <strong>Turno Noche</strong>. El dashboard las contar\u00e1 como Camas Noche.
        </div>

        <!-- Acci\u00f3n -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button id="asig-action-add"
              style="padding:9px;border-radius:10px;border:2px solid #2c5282;
                     background:#ebf8ff;color:#2c5282;font-weight:800;font-size:13px;cursor:pointer">
            \u2705 Aplicar</button>
          <button id="asig-action-remove"
              style="padding:9px;border-radius:10px;border:2px solid #e2e8f0;
                     background:#f7fafc;color:#718096;font-weight:700;font-size:13px;cursor:pointer">
            \ud83d\udeab Quitar</button>
        </div>

        <!-- Empresa (solo modo empresa) -->
        <div id="asig-empresa-wrap" style="display:none">
          <label style="font-size:11px;font-weight:800;color:#718096;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">EMPRESA</label>
          <input id="asig-empresa-input" list="asig-empresa-list" class="form-input"
                 placeholder="Ej: Aramark, Anglo American..." style="border-color:#93c5fd">
          <datalist id="asig-empresa-list">
            <option value="Aramark"><option value="Anglo American"><option value="Pucara">
          </datalist>
        </div>

        <!-- Alcance -->
        <div>
          <label style="font-size:11px;font-weight:800;color:#718096;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">ALCANCE</label>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="asig-scope-btns">
            <button data-scope="room"  style="padding:10px 6px;border-radius:10px;border:2px solid #2c5282;background:#ebf8ff;color:#1e3a5f;font-weight:700;font-size:12px;cursor:pointer">\ud83d\udecf\ufe0f Hab.</button>
            <button data-scope="floor" style="padding:10px 6px;border-radius:10px;border:2px solid #e2e8f0;background:#f7fafc;color:#4a5568;font-weight:700;font-size:12px;cursor:pointer">\ud83e\ude9c Piso</button>
            <button data-scope="building" style="padding:10px 6px;border-radius:10px;border:2px solid #e2e8f0;background:#f7fafc;color:#4a5568;font-weight:700;font-size:12px;cursor:pointer">\ud83c\udfe2 Pabell\u00f3n</button>
          </div>
        </div>

        <!-- Pabell\u00f3n -->
        <div>
          <label style="font-size:11px;font-weight:800;color:#718096;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">PABELL\u00d3N</label>
          <select id="asig-building" style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:14px;font-weight:600;outline:none">
            <option value="">\u2014 Seleccionar \u2014</option>
            ${buildings.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
          </select>
        </div>

        <!-- Piso -->
        <div id="asig-floor-wrap">
          <label style="font-size:11px;font-weight:800;color:#718096;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">PISO</label>
          <select id="asig-floor" style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:14px;font-weight:600;outline:none">
            <option value="">\u2014 Seleccionar pabell\u00f3n primero \u2014</option>
          </select>
        </div>

        <!-- Rango hab. -->
        <div id="asig-room-wrap" style="display:none">
          <label style="font-size:11px;font-weight:800;color:#718096;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:8px">RANGO DE HABITACIONES</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;font-weight:700;color:#a0aec0;display:block;margin-bottom:4px">DESDE hab.</label>
              <select id="asig-room-from" style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:13px;font-weight:600;outline:none">
                <option value="">\u2014 Piso primero \u2014</option></select>
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#a0aec0;display:block;margin-bottom:4px">HASTA hab.</label>
              <select id="asig-room-to" style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:13px;font-weight:600;outline:none">
                <option value="">\u2014 Piso primero \u2014</option></select>
            </div>
          </div>
          <div id="asig-room-count" style="font-size:11px;color:#718096;text-align:right;margin-top:5px"></div>
        </div>

        <button id="asig-confirm-btn"
            style="width:100%;padding:13px;border-radius:12px;border:none;
                   background:linear-gradient(135deg,#1e3a5f,#2c5282);color:#fff;
                   font-weight:800;font-size:15px;cursor:pointer;
                   box-shadow:0 4px 14px rgba(30,58,95,0.4)">
          \ud83d\uddc2\ufe0f Confirmar Asignaci\u00f3n
        </button>
      </div>
    </div>`;

    document.body.appendChild(asigModal);

    let asigMode = 'noche', asigAction = 'add', asigScope = 'room';

    const close = () => asigModal.remove();
    document.getElementById('asig-close-btn').addEventListener('click', close);
    asigModal.addEventListener('click', e => { if (e.target === asigModal) close(); });

    const modeDescs = {
      noche:   '\ud83c\udf19 Las hab. se clasificar\u00e1n como <strong>Turno Noche</strong>. El dashboard las contar\u00e1 como Camas Noche.',
      empresa: '\ud83c\udfe2 Las hab. quedar\u00e1n <strong>reservadas para una empresa</strong>. Se pueden seguir cargando trabajadores \u2014 se muestra el aviso de reserva.',
      '4x3':   '4\ufe0f\u20e3 Las hab. se marcar\u00e1n para <strong>Turno 4x3</strong>. Badge "4x3" visible en la tarjeta.',
    };

    document.querySelectorAll('#asig-mode-btns button').forEach(btn => {
      btn.addEventListener('click', () => {
        asigMode = btn.dataset.mode;
        document.querySelectorAll('#asig-mode-btns button').forEach(b => {
          b.style.border = '2px solid rgba(255,255,255,0.25)';
          b.style.background = 'rgba(255,255,255,0.06)';
          b.style.color = 'rgba(255,255,255,0.7)';
        });
        btn.style.border = '2px solid rgba(255,255,255,0.9)';
        btn.style.background = 'rgba(255,255,255,0.2)';
        btn.style.color = '#fff';
        document.getElementById('asig-desc').innerHTML = modeDescs[asigMode];
        document.getElementById('asig-empresa-wrap').style.display = asigMode === 'empresa' ? 'block' : 'none';
      });
    });

    document.getElementById('asig-action-add').addEventListener('click', () => {
      asigAction = 'add';
      document.getElementById('asig-action-add').style.cssText    = 'padding:9px;border-radius:10px;border:2px solid #2c5282;background:#ebf8ff;color:#2c5282;font-weight:800;font-size:13px;cursor:pointer';
      document.getElementById('asig-action-remove').style.cssText = 'padding:9px;border-radius:10px;border:2px solid #e2e8f0;background:#f7fafc;color:#718096;font-weight:700;font-size:13px;cursor:pointer';
      document.getElementById('asig-confirm-btn').style.background = 'linear-gradient(135deg,#1e3a5f,#2c5282)';
      document.getElementById('asig-confirm-btn').textContent = '\ud83d\uddc2\ufe0f Confirmar Asignaci\u00f3n';
    });
    document.getElementById('asig-action-remove').addEventListener('click', () => {
      asigAction = 'remove';
      document.getElementById('asig-action-add').style.cssText    = 'padding:9px;border-radius:10px;border:2px solid #e2e8f0;background:#f7fafc;color:#718096;font-weight:700;font-size:13px;cursor:pointer';
      document.getElementById('asig-action-remove').style.cssText = 'padding:9px;border-radius:10px;border:2px solid #c53030;background:#fff5f5;color:#c53030;font-weight:800;font-size:13px;cursor:pointer';
      document.getElementById('asig-confirm-btn').style.background = 'linear-gradient(135deg,#742a2a,#c53030)';
      document.getElementById('asig-confirm-btn').textContent = '\ud83d\udeab Quitar Asignaci\u00f3n';
    });

    document.querySelectorAll('#asig-scope-btns button').forEach(btn => {
      btn.addEventListener('click', () => {
        asigScope = btn.dataset.scope;
        document.querySelectorAll('#asig-scope-btns button').forEach(b => {
          b.style.border = '2px solid #e2e8f0'; b.style.background = '#f7fafc'; b.style.color = '#4a5568';
        });
        btn.style.border = '2px solid #2c5282'; btn.style.background = '#ebf8ff'; btn.style.color = '#1e3a5f';
        document.getElementById('asig-floor-wrap').style.display = asigScope === 'building' ? 'none' : 'block';
        document.getElementById('asig-room-wrap').style.display  = asigScope === 'room'     ? 'block' : 'none';
      });
    });

    function asigPopulateFloors(bId) {
      const b = buildings.find(x => String(x.id) === String(bId));
      const sel = document.getElementById('asig-floor');
      if (!b) { sel.innerHTML = '<option value="">\u2014 Seleccionar pabell\u00f3n primero \u2014</option>'; return; }
      let opts = '<option value="">\u2014 Seleccionar \u2014</option>';
      for (let i = 1; i <= b.floor; i++) opts += `<option value="${i}">Piso ${i}</option>`;
      sel.innerHTML = opts;
      asigClearRooms();
    }
    function asigClearRooms() {
      const e = '<option value="">\u2014 Piso primero \u2014</option>';
      document.getElementById('asig-room-from').innerHTML = e;
      document.getElementById('asig-room-to').innerHTML   = e;
      document.getElementById('asig-room-count').textContent = '';
    }
    function asigPopulateRooms(bId, floor) {
      if (!bId || !floor) { asigClearRooms(); return; }
      const floorRooms = rooms
        .filter(r => String(r.buildingId) === String(bId) && String(r.floor) === String(floor))
        .sort((a, b) => parseInt(a.number) - parseInt(b.number));
      const opts = floorRooms.map(r => `<option value="${r.id}">Hab. ${r.number}</option>`).join('');
      document.getElementById('asig-room-from').innerHTML = '<option value="">\u2014 Desde \u2014</option>' + opts;
      document.getElementById('asig-room-to').innerHTML   = '<option value="">\u2014 Hasta \u2014</option>' + opts;
      if (floorRooms.length > 0) document.getElementById('asig-room-to').selectedIndex = floorRooms.length;
      asigUpdateCount();
    }
    function asigUpdateCount() {
      const from = document.getElementById('asig-room-from');
      const to   = document.getElementById('asig-room-to');
      if (from.value && to.value && to.selectedIndex >= from.selectedIndex) {
        const n = to.selectedIndex - from.selectedIndex + 1;
        document.getElementById('asig-room-count').textContent =
          `${n} habitaci\u00f3n${n !== 1 ? 'es' : ''} seleccionada${n !== 1 ? 's' : ''}`;
      } else {
        document.getElementById('asig-room-count').textContent = '';
      }
    }

    document.getElementById('asig-building').addEventListener('change', function() { asigPopulateFloors(this.value); });
    document.getElementById('asig-floor').addEventListener('change', function() {
      asigPopulateRooms(document.getElementById('asig-building').value, this.value);
    });
    document.getElementById('asig-room-from').addEventListener('change', asigUpdateCount);
    document.getElementById('asig-room-to').addEventListener('change', asigUpdateCount);

    // Pre-rellenar contexto activo
    if (selectedBuildingId !== 'all') {
      document.getElementById('asig-building').value = selectedBuildingId;
      asigPopulateFloors(selectedBuildingId);
      if (selectedFloor !== 'all') {
        document.getElementById('asig-floor').value = selectedFloor;
        asigPopulateRooms(selectedBuildingId, selectedFloor);
      }
    }

    // ── Confirmar ─────────────────────────────────────────────────────────
    document.getElementById('asig-confirm-btn').addEventListener('click', async () => {
      const bId    = document.getElementById('asig-building').value;
      const floor  = document.getElementById('asig-floor').value;
      const fromId = document.getElementById('asig-room-from').value;
      const toId   = document.getElementById('asig-room-to').value;
      const empresa = (document.getElementById('asig-empresa-input')?.value || '').trim();

      if (!bId) { showToast('Selecciona un pabell\u00f3n', 'error'); return; }
      if (asigScope !== 'building' && !floor) { showToast('Selecciona un piso', 'error'); return; }
      if (asigScope === 'room' && (!fromId || !toId)) { showToast('Selecciona el rango de habitaciones', 'error'); return; }
      if (asigMode === 'empresa' && asigAction === 'add' && !empresa) { showToast('Escribe el nombre de la empresa', 'error'); return; }

      let targets;
      if (asigScope === 'building') {
        targets = rooms.filter(r => String(r.buildingId) === String(bId));
      } else if (asigScope === 'floor') {
        targets = rooms.filter(r => String(r.buildingId) === String(bId) && String(r.floor) === String(floor));
      } else {
        const floorRooms = rooms
          .filter(r => String(r.buildingId) === String(bId) && String(r.floor) === String(floor))
          .sort((a, b) => parseInt(a.number) - parseInt(b.number));
        const fromIdx = floorRooms.findIndex(r => String(r.id) === String(fromId));
        const toIdx   = floorRooms.findIndex(r => String(r.id) === String(toId));
        if (fromIdx === -1 || toIdx < fromIdx) { showToast('Rango inv\u00e1lido', 'error'); return; }
        targets = floorRooms.slice(fromIdx, toIdx + 1);
      }

      const btn = document.getElementById('asig-confirm-btn');
      btn.disabled = true; btn.textContent = '\u23f3 Guardando...';

      for (const room of targets) {
        const updated = { ...room };
        if (asigAction === 'add') {
          if (asigMode === 'noche')   updated.reservedShift   = 'Noche';
          if (asigMode === 'empresa') updated.reservedCompany = empresa;
          if (asigMode === '4x3')     updated.reservedShift   = '4x3';
        } else {
          if (asigMode === 'noche'   && updated.reservedShift   === 'Noche') updated.reservedShift   = '';
          if (asigMode === 'empresa') updated.reservedCompany = '';
          if (asigMode === '4x3'     && updated.reservedShift   === '4x3')   updated.reservedShift   = '';
        }
        await put('rooms', updated);
      }

      window._allRooms = await getAll('rooms').catch(() => rooms);
      invalidateCache('rooms');
      updateGridFilters();

      const modeLabel = { noche: 'Noche', empresa: `Empresa (${empresa})`, '4x3': '4x3' }[asigMode];
      showToast(`\u2705 Asignaci\u00f3n ${modeLabel} ${asigAction === 'add' ? 'aplicada' : 'quitada'} \u2014 ${targets.length} habitaciones`, 'success');
      close();
    });
  };

} // ← cierre de renderInfrastructure

function renderGrid(rooms) {
  const grid = document.getElementById('room-map-grid');
  if (!grid) return;
  const byBuilding = {};
  rooms.forEach(r => {
    if (!byBuilding[r.buildingId]) byBuilding[r.buildingId] = [];
    byBuilding[r.buildingId].push(r);
  });

  // 🔥 FIX: Ordenar edificios por nombre, habitaciones por número dentro de cada edificio
  const buildMapLocal = Object.fromEntries((window._allBuildings || []).map(b => [String(b.id), b.name]));
  const sortedEntries = Object.entries(byBuilding).sort(([bidA], [bidB]) => {
    const nameA = buildMapLocal[bidA] || bidA;
    const nameB = buildMapLocal[bidB] || bidB;
    return nameA.localeCompare(nameB, 'es', { numeric: true });
  });

  grid.innerHTML = sortedEntries.map(([bid, bRooms]) => {
    // Ordenar habitaciones dentro del edificio
    bRooms.sort((a, b) => parseInt(a.number) - parseInt(b.number));
    
    const b = (window._allBuildings || []).find(x => x.id == bid) || { name: `Edificio ${bid}` };
    return `
      <div style="margin-bottom:24px">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:12px">${b.name}</h3>
        <div class="room-grid">
          ${bRooms.map(r => renderRoomCard(r)).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderRoomCard(r) {
  const dayBedObj = r.beds?.day;
  const nightBedObj = r.beds?.night;
  const extraBedObj = r.beds?.extra;

  const dayBedStat = dayBedObj?.occupant ? 'occ' : (r.blockedBed === 'day' ? 'blocked-bed' : 'free');
  const nightBedStat = nightBedObj?.occupant ? 'occ' : (r.blockedBed === 'night' ? 'blocked-bed' : 'free');
  const extraBedStat = extraBedObj?.occupant ? 'occ' : 'free';
  
  const compColor = (comp) => {
      if(!comp) return '';
      const c = comp.toLowerCase();
      if(c.includes('aramark')) return 'bg-aramark';
      if(c.includes('anglo')) return 'bg-anglo';
      return 'bg-generic';
  };

  const dayNameHtml = dayBedObj?.occupant 
    ? `<span style="font-size:10px">${dayBedObj.present ? '🟢' : '🔴'}</span> ${dayBedObj.occupant.split(' ')[0].split('(')[0]}` 
    : 'Vacio';
  const nightNameHtml = nightBedObj?.occupant 
    ? `<span style="font-size:10px">${nightBedObj.present ? '🟢' : '🔴'}</span> ${nightBedObj.occupant.split(' ')[0].split('(')[0]}` 
    : 'Vacio';
  const extraNameHtml = extraBedObj?.occupant 
    ? `<span style="font-size:10px">${extraBedObj.present ? '🟢' : '🔴'}</span> ${extraBedObj.occupant.split(' ')[0].split('(')[0]}` 
    : 'Vacio';
  
  const dayComp = dayBedObj?.company || '';
  const nightComp = nightBedObj?.company || '';
  const extraComp = extraBedObj?.company || '';

  const isBlocked = r.status === 'blocked';
  
  const censusRec = window._censusMap ? window._censusMap[r.id] : null;
  let hasMismatch = false;
  if (censusRec) {
      const assigned = (dayBedObj?.occupant ? 1 : 0) + (nightBedObj?.occupant ? 1 : 0) + (extraBedObj?.occupant ? 1 : 0);
      const censused = censusRec.dayCnt + censusRec.nightCnt;
      if (assigned !== censused) hasMismatch = true;
  }
  
  const alertStyle = hasMismatch ? 'border: 2px dashed #d69e2e; box-shadow: 0 0 10px rgba(214,158,46,0.3);' : '';

  // ── Badge de días restantes ─────────────────────────────────────────────
  const today = new Date(); today.setHours(0,0,0,0);
  const departureDates = [dayBedObj, nightBedObj, extraBedObj]
      .filter(b => b?.occupant && b?.departureDate)
      .map(b => {
          const [y,m,d] = b.departureDate.split('-').map(Number);
          const dep = new Date(y, m-1, d);
          return Math.round((dep - today) / 86400000); // días
      });

  let daysBadgeHtml = '';
  if (departureDates.length > 0) {
      const minDays = Math.min(...departureDates);
      const isOverdue = minDays < 0;
      const bg    = isOverdue      ? '#e53e3e'
                  : minDays === 0  ? '#d69e2e'
                  : minDays <= 3   ? '#dd6b20'
                  : minDays <= 7   ? '#3182ce'
                  : '#38a169';
      const label = isOverdue ? `${Math.abs(minDays)}d ❗` : `${minDays}d`;
      daysBadgeHtml = `<span title="${isOverdue ? 'Vencido hace '+Math.abs(minDays)+' días' : 'Quedan '+minDays+' días'}"
          style="background:${bg};color:#fff;font-size:9px;font-weight:800;padding:1px 5px;
                 border-radius:5px;letter-spacing:0.2px;white-space:nowrap;line-height:1.4">${label}</span>`;
  }

  return `
    <div class="room-card v33-card ${r.status}" 
         onclick="window.showRoomDetail(${r.id})"
         style="${isBlocked ? 'filter: brightness(0.8);' : ''} ${alertStyle}">
      
      <div class="room-v33-header">
        <span class="room-number-v33">${r.number}</span>
        <div style="display:flex;gap:2px;align-items:center;flex-wrap:wrap">
            ${r.reservedCompany ? `<span class="room-badge-pill ${compColor(r.reservedCompany)}" title="Reservado para: ${r.reservedCompany}">${r.reservedCompany.substring(0,3).toUpperCase()}</span>` : ''}
            ${r.reservedShift && /noche|night/i.test(r.reservedShift)
                ? `<span class="room-badge-pill" style="background:#1e3a5f;color:#90cdf4;font-weight:800;letter-spacing:0.3px" title="Pabellón Turno Noche">\ud83c\udf19 NOCHE</span>`
                : r.reservedShift === '4x3'
                  ? `<span class="room-badge-pill" style="background:#3b0764;color:#d8b4fe;font-weight:800;letter-spacing:0.3px" title="Habitación Turno 4x3">4x3</span>`
                  : (r.reservedShift ? `<span class="room-badge-pill" style="background:#475569" title="Turno: ${r.reservedShift}">${r.reservedShift}</span>` : '')}
            ${hasMismatch ? `<span class="room-badge-pill" style="background:#d69e2e" title="Alerta Censo">\u26a0\ufe0f</span>` : ''}
            ${daysBadgeHtml}
        </div>
        ${isBlocked ? '<span class="lock-icon">🔒</span>' : ''}
      </div>

      <div class="room-beds-v33" style="display:flex; flex-direction:column; gap:4px;">
        <div class="bed-v33 ${dayBedStat}">
            <div class="bed-icon-container">
                <span class="bed-icon-v33">🛏️</span>
                <span class="bed-label-v33">A</span>
            </div>
            <div class="bed-info-v33">
                <span class="occ-name-v33">${dayNameHtml}</span>
                <span class="occ-comp-v33" style="color:${dayBedStat === 'occ' ? 'var(--text-secondary)' : 'transparent'}">${dayComp || '-'}</span>
            </div>
        </div>
        <div class="bed-v33 ${nightBedStat}">
            <div class="bed-icon-container">
                <span class="bed-icon-v33">🛏️</span>
                <span class="bed-label-v33">B</span>
            </div>
            <div class="bed-info-v33">
                <span class="occ-name-v33">${nightNameHtml}</span>
                <span class="occ-comp-v33" style="color:${nightBedStat === 'occ' ? 'var(--text-secondary)' : 'transparent'}">${nightComp || '-'}</span>
            </div>
        </div>
        ${(r.bedCount >= 3) ? `
        <div class="bed-v33 ${extraBedStat}" style="border-top: 1px dashed var(--border); padding-top: 4px;">
            <div class="bed-icon-container">
                <span class="bed-icon-v33">🛏️</span>
                <span class="bed-label-v33">C</span>
            </div>
            <div class="bed-info-v33">
                <span class="occ-name-v33">${extraNameHtml}</span>
                <span class="occ-comp-v33" style="color:${extraBedStat === 'occ' ? 'var(--text-secondary)' : 'transparent'}">${extraComp || '-'}</span>
            </div>
        </div>
        ` : ''}
      </div>
    </div>`;
}


async function renderBuildingsList(container) {
  const [buildings, rooms] = await Promise.all([
    getAll('buildings').catch(() => []),
    getAll('rooms').catch(() => [])
  ]);

  const normalizeCompany = (name) => {
    if (!name) return 'Sin Empresa';
    return name.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  function pctColor(p) {
    if (p >= 90) return '#e53e3e';
    if (p >= 60) return '#dd6b20';
    return '#38a169';
  }

  function getBedStats(roomList) {
    let totalBeds = 0, occupiedBeds = 0, maleCount = 0, femaleCount = 0;
    const companyMap = {};
    roomList.forEach(r => {
      ['day','night','extra'].forEach(k => {
        const hasSlot = k === 'extra' ? (r.bedCount >= 3) : k === 'night' ? (r.bedCount >= 2) : true;
        if (!hasSlot) return;
        totalBeds++;
        const bed = r.beds?.[k];
        if (bed?.occupant) {
          occupiedBeds++;
          const g = bed.gender || r.gender || 'M';
          if (g === 'F') femaleCount++; else maleCount++;
          const comp = normalizeCompany(bed.company);
          companyMap[comp] = (companyMap[comp] || 0) + 1;
        }
      });
    });
    const pct = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
    return { totalBeds, occupiedBeds, freeBeds: totalBeds - occupiedBeds, maleCount, femaleCount, pct, companyMap, totalRooms: roomList.length };
  }

  function chipSet(s) {
    return `
      <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
        <div style="background:#f0fff4;border:1.5px solid #9ae6b4;border-radius:8px;padding:4px 9px;text-align:center">
          <div style="font-size:15px;font-weight:900;color:#276749;line-height:1">${s.freeBeds}</div>
          <div style="font-size:8px;font-weight:700;color:#38a169;text-transform:uppercase">libres</div>
        </div>
        <div style="background:#fff5f5;border:1.5px solid #fc8181;border-radius:8px;padding:4px 9px;text-align:center">
          <div style="font-size:15px;font-weight:900;color:#c53030;line-height:1">${s.occupiedBeds}</div>
          <div style="font-size:8px;font-weight:700;color:#e53e3e;text-transform:uppercase">ocup.</div>
        </div>
        ${s.maleCount > 0 ? `<div style="background:#ebf8ff;border:1.5px solid #90cdf4;border-radius:8px;padding:4px 9px;text-align:center"><div style="font-size:14px;font-weight:900;color:#2b6cb0;line-height:1">${s.maleCount}</div><div style="font-size:8px;font-weight:700;color:#3182ce;text-transform:uppercase">H</div></div>` : ''}
        ${s.femaleCount > 0 ? `<div style="background:#fff5f7;border:1.5px solid #f9a8d4;border-radius:8px;padding:4px 9px;text-align:center"><div style="font-size:14px;font-weight:900;color:#97266d;line-height:1">${s.femaleCount}</div><div style="font-size:8px;font-weight:700;color:#97266d;text-transform:uppercase">M</div></div>` : ''}
      </div>`;
  }

  function progressBar(pct, color, height = 4) {
    return `<div style="height:${height}px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-top:4px">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width 0.5s ease"></div>
    </div>`;
  }

  // ── Separar edificio único (R-220) de pabellones (Pérez Caladera) ─
  const standalone = buildings.filter(b => b.type === 'building');
  const pavilions  = buildings.filter(b => b.type === 'pavilion' || b.type !== 'building');

  // ── TOTALES GLOBALES ───────────────────────────────────────────────
  const globalStats = getBedStats(rooms);
  const globalColor = pctColor(globalStats.pct);
  const topCompanies = Object.entries(globalStats.companyMap).sort((a,b) => b[1]-a[1]).slice(0, 6);

  // ═══════════════════════════════════════════════════════════════════
  // SECCIÓN 1: R-220 y otros edificios standalone
  // Accordion: Edificio → Pisos → (click piso: habitaciones detalladas)
  // ═══════════════════════════════════════════════════════════════════
  function renderStandaloneCards() {
    return standalone.map(b => {
      const bRooms = rooms.filter(r => String(r.buildingId) === String(b.id));
      const bs = getBedStats(bRooms);
      const color = pctColor(bs.pct);

      const floors = [...new Set(bRooms.map(r => r.floor))].sort((a,b2) => a - b2);
      const companies = Object.entries(bs.companyMap).sort((a,b2) => b2[1]-a[1]);

      const floorRows = floors.map(f => {
        const fRooms = bRooms.filter(r => String(r.floor) === String(f));
        const fs = getBedStats(fRooms);
        const fpct = fs.pct;
        const fc = pctColor(fpct);

        // Habitaciones del piso — detalle expandible
        const roomItems = fRooms.sort((a,b2) => String(a.number).localeCompare(String(b2.number), undefined, {numeric:true})).map(r => {
          const occupants = ['day','night','extra']
            .filter(k => r.beds?.[k]?.occupant)
            .map(k => {
              const bed = r.beds[k];
              const stateIcon = bed.checkoutPending ? '🟡' : bed.present ? '🟢' : bed.checkinAuthorized ? '🔵' : '🔴';
              return `<div style="font-size:11px;color:#4a5568;display:flex;align-items:center;gap:4px;padding:2px 0">
                ${stateIcon} <span style="font-weight:700">${bed.occupant.split('(')[0].trim()}</span>
                <span style="color:#a0aec0;font-size:10px">${bed.company ? '· ' + bed.company : ''}</span>
              </div>`;
            }).join('');

          const bg = r.status === 'free' ? '#f0fff4' : r.status === 'blocked' ? '#f7fafc' : '#fffaf0';
          const dot = r.status === 'free' ? '#38a169' : r.status === 'blocked' ? '#718096' : '#e53e3e';

          return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;background:${bg};cursor:pointer"
                       onclick="window.showRoomDetail(${r.id})">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:${occupants ? 4 : 0}px">
              <div style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0"></div>
              <span style="font-size:12px;font-weight:800;color:#1a202c">Hab. ${r.number}</span>
            </div>
            ${occupants || '<div style="font-size:10px;color:#a0aec0">Disponible</div>'}
          </div>`;
        }).join('');

        return `
        <div style="border-bottom:1px solid #f1f5f9">
          <!-- Fila de piso (siempre visible) -->
          <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;transition:background 0.15s"
               onmouseover="this.style.background='#fafafa'" onmouseout="this.style.background='transparent'"
               onclick="window.toggleFloorDetail('floor-${b.id}-${f}', this)">
            <div style="min-width:56px;background:linear-gradient(135deg,#4a5568,#2d3748);border-radius:8px;padding:4px 8px;text-align:center;flex-shrink:0">
              <div style="font-size:9px;color:rgba(255,255,255,0.6);font-weight:700;text-transform:uppercase">Piso</div>
              <div style="font-size:16px;font-weight:900;color:#fff;line-height:1">${f}</div>
            </div>
            ${chipSet(fs)}
            <div style="flex:1">
              ${progressBar(fpct, fc)}
              <div style="font-size:10px;color:${fc};font-weight:700;margin-top:2px">${fpct}% ocup. · ${fs.totalRooms} hab.</div>
            </div>
            <span style="font-size:14px;color:#a0aec0;transition:transform 0.25s" class="floor-arrow">▾</span>
          </div>
          <!-- Habitaciones del piso (expandible) -->
          <div id="floor-${b.id}-${f}" style="display:none;padding:8px 16px 12px;background:#f8fafc">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px">
              ${roomItems}
            </div>
          </div>
        </div>`;
      }).join('');

      const companyPills = companies.map(([name, count]) => {
        const cpct = bs.occupiedBeds > 0 ? Math.round(count / bs.occupiedBeds * 100) : 0;
        return `<span style="display:inline-flex;align-items:center;gap:4px;background:#f7fafc;border:1px solid var(--border);border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700;color:var(--text-primary)">
          🏢 ${name} <span style="color:${color};font-weight:900">${cpct}%</span> (${count})
        </span>`;
      }).join('');

      return `
      <div class="card" id="bcard-${b.id}" style="overflow:hidden;border:1px solid var(--border)">
        <!-- Header -->
        <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;user-select:none"
             onclick="window.toggleBuildingStats('${b.id}')">
          <div style="width:44px;height:44px;border-radius:12px;background:${color};display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;flex-shrink:0;box-shadow:0 4px 10px ${color}55">🏢</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:800;color:var(--text-primary)">${b.name}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:1px">${b.floor} pisos · ${bs.totalRooms} habitaciones</div>
          </div>
          ${chipSet(bs)}
          <div style="text-align:center;flex-shrink:0;margin-left:4px">
            <div style="font-size:20px;font-weight:900;color:${color};line-height:1">${bs.pct}%</div>
            <div style="font-size:9px;color:var(--text-muted);font-weight:600">OCUP.</div>
          </div>
          <span id="barrow-${b.id}" style="font-size:16px;color:var(--text-muted);transition:transform 0.25s;margin-left:4px">▾</span>
        </div>
        <div style="height:3px;background:#e2e8f0"><div style="width:${bs.pct}%;height:100%;background:${color};transition:width 0.6s ease"></div></div>
        <!-- Panel expandible -->
        <div id="bstats-${b.id}" style="display:none">
          <div style="padding:10px 16px 0;display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:11px;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.8px">📊 Pisos</div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm" style="font-size:11px" onclick="event.stopPropagation();window.switchInfraTab('map');window.selectBuilding(${b.id})">🗺️ Mapa</button>
              <button class="btn btn-secondary btn-sm" style="font-size:11px" onclick="event.stopPropagation();window.openBuildingForm(${b.id})">✏️</button>
            </div>
          </div>
          <div style="margin:8px 0 0">${floorRows || '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">Sin pisos</div>'}</div>
          ${companies.length > 0 ? `
          <div style="padding:10px 16px 14px;border-top:1px dashed #e2e8f0;margin-top:4px">
            <div style="font-size:10px;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:7px">Empresas presentes</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px">${companyPills}</div>
          </div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECCIÓN 2: Pérez Caladera — accordion Pabellón → Piso → Habitaciones
  // ═══════════════════════════════════════════════════════════════════
  function renderCaleraSection() {
    if (pavilions.length === 0) return '';

    const caleraRooms = rooms.filter(r => pavilions.some(p => String(p.id) === String(r.buildingId)));
    const caleraStats = getBedStats(caleraRooms);
    const cc = pctColor(caleraStats.pct);

    const pavilionCards = pavilions.map(p => {
      const pRooms = rooms.filter(r => String(r.buildingId) === String(p.id));
      const ps = getBedStats(pRooms);
      const pc = pctColor(ps.pct);

      const floors = [...new Set(pRooms.map(r => r.floor))].sort((a,b) => a - b);

      const floorRows = floors.map(f => {
        const fRooms = pRooms.filter(r => String(r.floor) === String(f));
        const fs = getBedStats(fRooms);
        const fc = pctColor(fs.pct);

        const roomItems = fRooms.sort((a,b) => String(a.number).localeCompare(String(b.number), undefined, {numeric:true})).map(r => {
          const occupants = ['day','night','extra']
            .filter(k => r.beds?.[k]?.occupant)
            .map(k => {
              const bed = r.beds[k];
              const si = bed.checkoutPending ? '🟡' : bed.present ? '🟢' : bed.checkinAuthorized ? '🔵' : '🔴';
              return `<div style="font-size:11px;color:#4a5568;display:flex;align-items:center;gap:4px;padding:2px 0">
                ${si} <span style="font-weight:700">${bed.occupant.split('(')[0].trim()}</span>
                <span style="color:#a0aec0;font-size:10px">${bed.company ? '· ' + bed.company : ''}</span>
              </div>`;
            }).join('');

          const bg = r.status === 'free' ? '#f0fff4' : r.status === 'blocked' ? '#f7fafc' : '#fffaf0';
          const dot = r.status === 'free' ? '#38a169' : r.status === 'blocked' ? '#718096' : '#e53e3e';

          return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;background:${bg};cursor:pointer"
                       onclick="window.showRoomDetail(${r.id})">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:${occupants ? 4 : 0}px">
              <div style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0"></div>
              <span style="font-size:12px;font-weight:800;color:#1a202c">Hab. ${r.number}</span>
            </div>
            ${occupants || '<div style="font-size:10px;color:#a0aec0">Disponible</div>'}
          </div>`;
        }).join('');

        return `
        <div style="border-bottom:1px solid #f1f5f9">
          <div style="display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;transition:background 0.15s"
               onmouseover="this.style.background='#fafafa'" onmouseout="this.style.background='transparent'"
               onclick="window.toggleFloorDetail('floor-pav-${p.id}-${f}', this)">
            <div style="min-width:52px;background:linear-gradient(135deg,#667eea,#5a67d8);border-radius:8px;padding:4px 8px;text-align:center;flex-shrink:0">
              <div style="font-size:9px;color:rgba(255,255,255,0.7);font-weight:700;text-transform:uppercase">Piso</div>
              <div style="font-size:15px;font-weight:900;color:#fff;line-height:1">${f}</div>
            </div>
            ${chipSet(fs)}
            <div style="flex:1">
              ${progressBar(fs.pct, fc)}
              <div style="font-size:10px;color:${fc};font-weight:700;margin-top:2px">${fs.pct}% · ${fs.totalRooms} hab.</div>
            </div>
            <span style="font-size:13px;color:#a0aec0;transition:transform 0.25s" class="floor-arrow">▾</span>
          </div>
          <div id="floor-pav-${p.id}-${f}" style="display:none;padding:8px 16px 12px;background:#f8fafc">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px">
              ${roomItems}
            </div>
          </div>
        </div>`;
      }).join('');

      const companies = Object.entries(ps.companyMap).sort((a,b) => b[1]-a[1]);

      return `
      <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff;margin-bottom:6px">
        <!-- Header del pabellón -->
        <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;user-select:none"
             onclick="window.toggleBuildingStats('pav-${p.id}')">
          <div style="width:38px;height:38px;border-radius:10px;background:${pc};display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;flex-shrink:0">🏠</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:800;color:var(--text-primary)">${p.name}</div>
            <div style="font-size:10px;color:var(--text-secondary)">${p.floor || floors.length} pisos · ${ps.totalRooms} hab.</div>
          </div>
          ${chipSet(ps)}
          <div style="text-align:center;margin-left:4px;flex-shrink:0">
            <div style="font-size:17px;font-weight:900;color:${pc}">${ps.pct}%</div>
          </div>
          <span id="barrow-pav-${p.id}" style="font-size:14px;color:#a0aec0;transition:transform 0.25s">▾</span>
        </div>
        <div style="height:3px;background:#e2e8f0"><div style="width:${ps.pct}%;height:100%;background:${pc}"></div></div>
        <!-- Pisos expandibles -->
        <div id="bstats-pav-${p.id}" style="display:none">
          ${floorRows}
          ${companies.length > 0 ? `
          <div style="padding:8px 14px 12px;border-top:1px dashed #e2e8f0">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Empresas</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              ${companies.map(([n,c]) => `<span style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:99px;padding:2px 8px;font-size:10px;font-weight:700">🏢 ${n} (${c})</span>`).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>`;
    }).join('');

    return `
    <div class="card" style="overflow:hidden;border:1px solid var(--border);margin-bottom:0">
      <!-- Header de Pérez Caladera -->
      <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;user-select:none;background:linear-gradient(135deg,#f7f8ff,#eef0ff)"
           onclick="window.toggleBuildingStats('calera-campus')">
        <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#667eea,#5a67d8);display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;flex-shrink:0;box-shadow:0 4px 10px rgba(102,126,234,0.4)">🏘️</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:800;color:#1a202c">Pérez Caladera</div>
          <div style="font-size:11px;color:#64748b;margin-top:1px">${pavilions.length} pabellones · ${caleraStats.totalRooms} habitaciones</div>
        </div>
        ${chipSet(caleraStats)}
        <div style="text-align:center;flex-shrink:0;margin-left:4px">
          <div style="font-size:20px;font-weight:900;color:${cc};line-height:1">${caleraStats.pct}%</div>
          <div style="font-size:9px;color:var(--text-muted);font-weight:600">OCUP.</div>
        </div>
        <span id="barrow-calera-campus" style="font-size:16px;color:var(--text-muted);transition:transform 0.25s">▾</span>
      </div>
      <div style="height:3px;background:#e2e8f0"><div style="width:${caleraStats.pct}%;height:100%;background:${cc}"></div></div>
      <!-- Pabellones expandibles -->
      <div id="bstats-calera-campus" style="display:none;padding:12px 12px 8px">
        ${pavilionCards}
      </div>
    </div>`;
  }

  // ── HTML FINAL ──────────────────────────────────────────────────────
  container.innerHTML = `
    <!-- RESUMEN GLOBAL -->
    <div style="background:linear-gradient(135deg,#1a202c 0%,#2d3748 100%);border-radius:18px;padding:20px;margin-bottom:20px;color:white">
      <div style="font-size:13px;font-weight:700;opacity:0.7;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📊 Resumen Global del Campamento</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div style="text-align:center">
          <div style="font-size:32px;font-weight:900;color:#68d391">${globalStats.freeBeds}</div>
          <div style="font-size:11px;opacity:0.7;font-weight:600">CAMAS LIBRES</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:32px;font-weight:900;color:#fc8181">${globalStats.occupiedBeds}</div>
          <div style="font-size:11px;opacity:0.7;font-weight:600">OCUPADAS</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:32px;font-weight:900;color:#63b3ed">${globalStats.maleCount}</div>
          <div style="font-size:11px;opacity:0.7;font-weight:600">🔵 HOMBRES</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:32px;font-weight:900;color:#f687b3">${globalStats.femaleCount}</div>
          <div style="font-size:11px;opacity:0.7;font-weight:600">🔴 MUJERES</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;height:12px;background:rgba(255,255,255,0.15);border-radius:6px;overflow:hidden">
          <div style="width:${globalStats.pct}%;height:100%;background:linear-gradient(90deg,#68d391,#48bb78);border-radius:6px;transition:width 0.8s ease"></div>
        </div>
        <div style="font-size:20px;font-weight:900;color:#68d391;min-width:50px;text-align:right">${globalStats.pct}%</div>
      </div>
      ${topCompanies.length > 0 ? `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1)">
        <div style="font-size:11px;opacity:0.6;font-weight:600;margin-bottom:8px">TOP EMPRESAS</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${topCompanies.map(([name, count]) => `<span style="background:rgba(255,255,255,0.1);border-radius:99px;padding:4px 12px;font-size:12px;font-weight:700">${name}: ${count} <span style="opacity:0.6">(${globalStats.occupiedBeds > 0 ? Math.round(count/globalStats.occupiedBeds*100) : 0}%)</span></span>`).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- EDIFICIOS STANDALONE (R-220) -->
    ${standalone.length > 0 ? `
    <div style="font-size:11px;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;padding-left:2px">🏢 Edificio Solo</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
      ${renderStandaloneCards()}
    </div>` : ''}

    <!-- PÉREZ CALADERA (pabellones) -->
    ${pavilions.length > 0 ? `
    <div style="font-size:11px;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;padding-left:2px">🏘️ Campamento Pérez Caladera</div>
    ${renderCaleraSection()}` : ''}
  `;

  // ── Toggle genérico ────────────────────────────────────────────────
  window.toggleBuildingStats = (id) => {
    const panel = document.getElementById(`bstats-${id}`);
    const arrow = document.getElementById(`barrow-${id}`);
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    if (isOpen) {
      panel.style.maxHeight = panel.scrollHeight + 'px';
      requestAnimationFrame(() => {
        panel.style.transition = 'max-height 0.3s ease, opacity 0.2s';
        panel.style.opacity = '0';
        panel.style.maxHeight = '0';
        setTimeout(() => { panel.style.display = 'none'; panel.style.maxHeight = ''; panel.style.opacity = ''; panel.style.transition = ''; }, 310);
      });
    } else {
      panel.style.display = 'block';
      panel.style.maxHeight = '0';
      panel.style.opacity = '0';
      panel.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        panel.style.transition = 'max-height 0.4s ease, opacity 0.3s';
        panel.style.maxHeight = panel.scrollHeight + 'px';
        panel.style.opacity = '1';
        setTimeout(() => { panel.style.maxHeight = 'none'; panel.style.transition = ''; panel.style.overflow = 'visible'; }, 420);
      });
    }
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
  };

  // ── Toggle de piso (dentro del pabellón/edificio) ─────────────────
  window.toggleFloorDetail = (id, rowEl) => {
    const panel = document.getElementById(id);
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    const arrow = rowEl?.querySelector('.floor-arrow');
    if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
  };

  window.deleteBuilding = async (id) => {
    if (!confirm('¿Eliminar este edificio?')) return;
    await remove('buildings', id);
    showToast('Edificio eliminado', 'success');
    await renderBuildingsList(container);
  };
}


async function renderRoomsList(container) {

  const [rooms, buildings] = await Promise.all([
    getAll('rooms').catch(() => []),
    getAll('buildings').catch(() => []),
  ]);
  const buildMap = Object.fromEntries(buildings.map(b => [b.id, b]));

  // ── Estado global del filtro
  let _searchQ = '';
  let _statusFilter = 'all';

  function _applyFilters() {
    const q = _searchQ.toLowerCase().trim();
    return rooms.filter(r => {
      if (_statusFilter === 'free'     && r.status !== 'free')     return false;
      if (_statusFilter === 'occupied' && r.status !== 'occupied') return false;
      if (_statusFilter === 'blocked'  && r.status !== 'blocked' && r.status !== 'bed-blocked') return false;
      if (_statusFilter === 'bodega'   && r.blockReason !== 'Bodega') return false;
      if (!q) return true;
      const bName = (buildMap[r.buildingId]?.name || '').toLowerCase();
      if (String(r.number).includes(q)) return true;
      if (bName.includes(q)) return true;
      if ((r.blockReason || '').toLowerCase().includes(q)) return true;
      for (const k of ['day', 'night', 'extra']) {
        const bed = r.beds?.[k];
        if (!bed) continue;
        if ((bed.occupant     || '').toLowerCase().includes(q)) return true;
        if ((bed.rut          || '').toLowerCase().replace(/\./g,'').replace(/-/g,'').includes(q.replace(/\./g,'').replace(/-/g,''))) return true;
        if ((bed.company      || '').toLowerCase().includes(q)) return true;
        if ((bed.management   || '').toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }

  // ── Celdas de cama con Gerencia incluida ─────────────────────────────
  function bedCell(r, key) {
    const bed = r.beds?.[key];
    const bedCount = r.bedCount || 2;
    if (key === 'extra' && bedCount < 3) return `<td style="color:var(--text-muted);font-size:11px;padding:10px 8px">—</td>`;
    if (!bed?.occupant) {
      const blocked = r.blockedBed === key;
      return `<td style="padding:10px 8px;vertical-align:top">
        <span style="font-size:11px;color:${blocked ? '#ed8936' : '#38a169'};font-weight:600">${blocked ? '🔶 Bloq.' : '🟢 Libre'}</span>
      </td>`;
    }
    const g = bed.gender || r.gender || 'M';
    const gBadge = g === 'F'
      ? `<span style="font-size:10px;background:#fff5f7;color:#97266d;border-radius:99px;padding:1px 6px;font-weight:700">🔴 F</span>`
      : `<span style="font-size:10px;background:#ebf8ff;color:#2b6cb0;border-radius:99px;padding:1px 6px;font-weight:700">🔵 M</span>`;
    const arrival   = bed.arrivalDate   ? bed.arrivalDate.split('T')[0]   : '';
    const departure = bed.departureDate ? bed.departureDate.split('T')[0] : '';
    const mgmt = bed.management || '';
    // Días restantes
    let daysBadge = '';
    if (bed.departureDate) {
      const today = new Date(); today.setHours(0,0,0,0);
      const [y,m,d] = bed.departureDate.split('-').map(Number);
      const dep = new Date(y, m-1, d);
      const days = Math.round((dep - today) / 86400000);
      const isOverdue = days < 0;
      const bg = isOverdue ? '#e53e3e' : days === 0 ? '#d69e2e' : days <= 3 ? '#dd6b20' : days <= 7 ? '#3182ce' : '#38a169';
      daysBadge = `<span style="background:${bg};color:#fff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:5px;margin-left:4px">${isOverdue ? Math.abs(days)+'d❗' : days+'d'}</span>`;
    }
    return `<td style="padding:10px 8px;vertical-align:top;min-width:160px">
      <div style="font-weight:700;font-size:12px;color:var(--text-primary);line-height:1.3">${bed.occupant}${daysBadge}</div>
      ${bed.rut ? `<div style="font-size:10px;color:var(--text-muted);font-family:monospace">${bed.rut}</div>` : ''}
      <div style="margin-top:3px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">
        ${gBadge}
        <span style="font-size:10px;background:#f7fafc;border:1px solid var(--border);border-radius:4px;padding:1px 5px;color:var(--text-secondary)">${bed.company || '—'}</span>
      </div>
      ${mgmt ? `<div style="margin-top:2px;font-size:10px;font-weight:700;color:#553c9a;background:#f3e8ff;border-radius:4px;padding:1px 6px;display:inline-block">👔 ${mgmt}</div>` : ''}
      ${arrival ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">✈️ ${arrival} → ${departure}</div>` : ''}
    </td>`;
  }

  // ── Render agrupado por edificio y piso ───────────────────────────────
  function _renderGrouped() {
    const filtered = _applyFilters();
    const wrapper = document.getElementById('rooms-grouped');
    const counter = document.getElementById('rooms-counter');
    if (counter) counter.textContent = `${filtered.length} habitación(es)`;
    if (!wrapper) return;

    if (filtered.length === 0) {
      wrapper.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:14px">
        🔍 Sin resultados para "${_searchQ}"
      </div>`;
      return;
    }

    const statusLabel = { free:'🟢 Libre', occupied:'🔴 Ocupada', reserved:'🟡 Reservada', blocked:'⚫ Bloqueada', 'bed-blocked':'🔶 Cama Bloq.' };

    // Agrupar por edificio → piso
    const byBuilding = {};
    filtered.forEach(r => {
      const bid = String(r.buildingId);
      if (!byBuilding[bid]) byBuilding[bid] = {};
      const f = String(r.floor || '1');
      if (!byBuilding[bid][f]) byBuilding[bid][f] = [];
      byBuilding[bid][f].push(r);
    });

    // Ordenar edificios por nombre
    const sortedBuildings = Object.entries(byBuilding).sort(([a],[b]) => {
      const na = buildMap[a]?.name || a;
      const nb = buildMap[b]?.name || b;
      return na.localeCompare(nb, 'es', { numeric: true });
    });

    wrapper.innerHTML = sortedBuildings.map(([bid, byFloor]) => {
      const b = buildMap[bid] || { name: `Edificio ${bid}` };
      const bRooms = Object.values(byFloor).flat();
      const occupied = bRooms.filter(r => r.status === 'occupied').length;
      const total = bRooms.length;
      const pct = total > 0 ? Math.round(occupied / total * 100) : 0;
      const pctColor = pct >= 90 ? '#e53e3e' : pct >= 60 ? '#dd6b20' : '#38a169';

      // Ordenar pisos numéricamente
      const sortedFloors = Object.entries(byFloor).sort(([fa],[fb]) => parseInt(fa) - parseInt(fb));

      const floorsHtml = sortedFloors.map(([floorNum, fRooms]) => {
        fRooms.sort((a,b) => parseInt(a.number) - parseInt(b.number));
        const fOcc = fRooms.filter(r => r.status === 'occupied').length;
        const fId = `floor-${bid}-${floorNum}`;

        const rows = fRooms.map(r => {
          const statusBadgeClass = r.status === 'free' ? 'badge-free'
              : r.status === 'occupied' ? 'badge-occ'
              : r.status === 'reserved' ? 'badge-res' : 'badge-block';

          let blockInfoHtml = '';
          if (r.status === 'blocked' || r.status === 'bed-blocked') {
            const reason = r.blockReason || 'Sin motivo';
            let daysHtml = '';
            if (r.blockedAt) {
              const days = Math.floor((Date.now() - new Date(r.blockedAt).getTime()) / 86400000);
              const c = days > 30 ? '#e53e3e' : days > 7 ? '#dd6b20' : '#718096';
              daysHtml = `<span style="font-size:10px;color:${c};font-weight:700">${days}d bloqueada</span>`;
            }
            blockInfoHtml = `<div style="margin-top:3px;font-size:11px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:2px 6px;color:#4a5568;font-weight:600">${reason} ${daysHtml}</div>`;
          }
          if (r.status === 'reserved') {
            const reason = r.blockReason || '';
            const from = r.reservedFrom ? ` · desde ${r.reservedFrom}` : '';
            const until = r.reservedUntil ? ` → ${r.reservedUntil}` : '';
            blockInfoHtml = `<div style="margin-top:3px;font-size:10px;background:#fffff0;border:1px solid #f6e05e;border-radius:4px;padding:2px 6px;color:#744210;font-weight:600">${reason}${from}${until}</div>`;
          }

          return `<tr style="border-bottom:1px solid var(--border);vertical-align:middle">
            <td style="font-size:14px;font-weight:900;color:var(--text-primary);white-space:nowrap;padding:10px 8px">${r.number}</td>
            <td style="padding:10px 8px">
              <span class="badge ${statusBadgeClass}" style="font-size:11px">${statusLabel[r.status] || r.status}</span>
              ${blockInfoHtml}
            </td>
            ${bedCell(r, 'day')}
            ${bedCell(r, 'night')}
            ${bedCell(r, 'extra')}
            <td style="white-space:nowrap;padding:10px 8px">
              <button class="btn btn-ghost btn-sm" onclick="window.showRoomDetail(${r.id})" title="Ver detalle">🔍</button>
              <button class="btn btn-ghost btn-sm" onclick="window.openRoomForm(${r.id})" title="Editar">✏️</button>
              ${(r.status === 'free' || r.status === 'occupied')
                ? `<button class="btn btn-ghost btn-sm" style="color:#c53030" title="Bloquear" onclick="window.showRoomDetail(${r.id}).then(()=>window.abrirQuickBlock(${r.id}))">🔒</button>`
                : `<button class="btn btn-ghost btn-sm" style="color:#38a169" title="Desbloquear" onclick="window.desbloquearRapido(${r.id})">🔓</button>`
              }
            </td>
          </tr>`;
        }).join('');

        return `
        <!-- Piso ${floorNum} -->
        <div style="border-top:1px solid #e2e8f0">
          <!-- Header piso (clickeable) -->
          <div onclick="window._toggleFloor('${fId}')"
               style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;
                      background:#f8fafc;user-select:none;transition:background 0.15s"
               onmouseover="this.style.background='#edf2f7'" onmouseout="this.style.background='#f8fafc'">
            <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#4a5568,#2d3748);
                        display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <span style="color:#fff;font-size:13px;font-weight:900">${floorNum}</span>
            </div>
            <span style="font-size:13px;font-weight:700;color:var(--text-primary);flex:1">Piso ${floorNum}</span>
            <span style="font-size:11px;color:var(--text-muted)">${fRooms.length} hab. · ${fOcc} occ.</span>
            <span id="farrow-${fId}" style="font-size:13px;color:var(--text-muted);transition:transform 0.2s">▾</span>
          </div>
          <!-- Tabla del piso -->
          <div id="${fId}" style="display:none;overflow:hidden">
            <div style="overflow-x:auto">
              <table class="worker-table" style="min-width:700px">
                <thead>
                  <tr style="background:var(--bg-page)">
                    <th style="font-size:10px;padding:7px 8px">HAB.</th>
                    <th style="font-size:10px;padding:7px 8px">ESTADO</th>
                    <th style="font-size:10px;padding:7px 8px">CAMA 1</th>
                    <th style="font-size:10px;padding:7px 8px">CAMA 2</th>
                    <th style="font-size:10px;padding:7px 8px">CAMA 3</th>
                    <th style="font-size:10px;padding:7px 8px">ACCIONES</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      }).join('');

      return `
      <!-- ══ EDIFICIO ${b.name} ══ -->
      <div style="border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:12px;background:var(--bg-card)">
        <!-- Header edificio (clickeable para expand/collapse) -->
        <div onclick="window._toggleBuilding('bgroup-${bid}')"
             style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;
                    background:linear-gradient(135deg,#f7fafc,#edf2f7);user-select:none;
                    transition:background 0.15s"
             onmouseover="this.style.background='linear-gradient(135deg,#edf2f7,#e2e8f0)'"
             onmouseout="this.style.background='linear-gradient(135deg,#f7fafc,#edf2f7)'">
          <!-- Ícono -->
          <div style="width:42px;height:42px;border-radius:12px;background:${pctColor};display:flex;align-items:center;
                      justify-content:center;font-size:20px;color:#fff;flex-shrink:0;box-shadow:0 4px 10px ${pctColor}55">🏢</div>
          <!-- Nombre -->
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:800;color:var(--text-primary)">${b.name}</div>
            <div style="font-size:11px;color:var(--text-secondary)">${sortedFloors.length} piso${sortedFloors.length !== 1 ? 's' : ''} · ${total} hab.</div>
          </div>
          <!-- Chips -->
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
            <div style="background:#f0fff4;border:1.5px solid #9ae6b4;border-radius:8px;padding:4px 10px;text-align:center">
              <div style="font-size:16px;font-weight:900;color:#276749;line-height:1">${total - occupied}</div>
              <div style="font-size:8px;color:#38a169;font-weight:700;text-transform:uppercase">libres</div>
            </div>
            <div style="background:#fff5f5;border:1.5px solid #fc8181;border-radius:8px;padding:4px 10px;text-align:center">
              <div style="font-size:16px;font-weight:900;color:#c53030;line-height:1">${occupied}</div>
              <div style="font-size:8px;color:#e53e3e;font-weight:700;text-transform:uppercase">ocup.</div>
            </div>
            <div style="text-align:center;margin-left:4px">
              <div style="font-size:18px;font-weight:900;color:${pctColor};line-height:1">${pct}%</div>
              <div style="font-size:8px;color:var(--text-muted);font-weight:600">OCUP.</div>
            </div>
          </div>
          <span id="barrow-bgroup-${bid}" style="font-size:15px;color:var(--text-muted);transition:transform 0.25s;margin-left:6px">▾</span>
        </div>
        <!-- Contenido por pisos -->
        <div id="bgroup-${bid}" style="display:none">
          ${floorsHtml}
        </div>
      </div>`;
    }).join('');

    // Expandir automáticamente cuando hay búsqueda o filtro activo
    if (_searchQ || _statusFilter !== 'all') {
      sortedBuildings.forEach(([bid]) => {
        const bg = document.getElementById(`bgroup-${bid}`);
        const arrow = document.getElementById(`barrow-bgroup-${bid}`);
        if (bg) { bg.style.display = 'block'; if (arrow) arrow.style.transform = 'rotate(180deg)'; }
        const byFloor = byBuilding[bid];
        Object.keys(byFloor).forEach(floorNum => {
          const fId = `floor-${bid}-${floorNum}`;
          const fp = document.getElementById(fId);
          const fa = document.getElementById(`farrow-${fId}`);
          if (fp) { fp.style.display = 'block'; if (fa) fa.style.transform = 'rotate(180deg)'; }
        });
      });
    }
  }

  // ── HTML base
  container.innerHTML = `
    <!-- BUSCADOR Y FILTROS -->
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;margin-bottom:16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:10px;align-items:center">
        <div style="flex:1;position:relative">
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:16px">🔍</span>
          <input id="rooms-search" type="text" class="form-input"
            placeholder="Buscar por RUT, nombre, empresa, gerencia o número de habitación..."
            style="padding-left:38px;font-size:13px"
            oninput="window._roomsSearch(this.value)">
        </div>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('rooms-search').value=''; window._roomsSearch('')">✕</button>
      </div>
      <!-- Filtros rápidos -->
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="rf-all"      class="btn btn-sm" style="background:var(--text-primary);color:white;border-radius:99px"           onclick="window._roomsFilter('all')">Todas</button>
        <button id="rf-free"     class="btn btn-sm" style="background:#f0fff4;color:#276749;border:1px solid #c6f6d5;border-radius:99px" onclick="window._roomsFilter('free')">🟢 Libres</button>
        <button id="rf-occupied" class="btn btn-sm" style="background:#fff5f5;color:#c53030;border:1px solid #feb2b2;border-radius:99px" onclick="window._roomsFilter('occupied')">🔴 Ocupadas</button>
        <button id="rf-blocked"  class="btn btn-sm" style="background:#f7fafc;color:#4a5568;border:1px solid var(--border);border-radius:99px"  onclick="window._roomsFilter('blocked')">⚫ Bloqueadas</button>
        <button id="rf-bodega"   class="btn btn-sm" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:99px"  onclick="window._roomsFilter('bodega')">🗄️ Bodegas</button>
        <span id="rooms-counter" style="margin-left:auto;font-size:12px;color:var(--text-muted);align-self:center"></span>
      </div>
    </div>
    <!-- GRUPOS POR EDIFICIO -->
    <div id="rooms-grouped"></div>
  `;

  // ── Toggle edificio
  window._toggleBuilding = (id) => {
    const panel = document.getElementById(id);
    const arrow = document.getElementById(`barrow-${id}`);
    if (!panel) return;
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    if (arrow) arrow.style.transform = open ? '' : 'rotate(180deg)';
  };

  // ── Toggle piso
  window._toggleFloor = (id) => {
    const panel = document.getElementById(id);
    const arrow = document.getElementById(`farrow-${id}`);
    if (!panel) return;
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    if (arrow) arrow.style.transform = open ? '' : 'rotate(180deg)';
  };

  // ── Handlers búsqueda / filtro
  window._roomsSearch = (val) => { _searchQ = val; _renderGrouped(); };
  window._roomsFilter = (status) => {
    _statusFilter = status;
    ['all','free','occupied','blocked','bodega'].forEach(k => {
      const btn = document.getElementById(`rf-${k}`);
      if (!btn) return;
      btn.style.fontWeight = k === status ? '800' : '600';
      btn.style.boxShadow  = k === status ? 'inset 0 0 0 2px currentColor' : 'none';
    });
    _renderGrouped();
  };

  // Render inicial
  _renderGrouped();

  // 🔄 Escuchar evento de actualización de rooms
  window.addEventListener('rooms-updated', async () => {
    const freshRooms = await getAll('rooms').catch(() => []);
    window._allRooms = freshRooms;
    _renderGrouped();
    if (typeof updateGridFilters === 'function' && document.getElementById('room-map-grid')) {
      updateGridFilters();
    }
  });
}
