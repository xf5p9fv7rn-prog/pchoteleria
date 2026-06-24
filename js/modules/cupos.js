/**
 * PC Hotelería — Gestión de Cupos por Gerencia
 * Solo accesible para rol: 'superadmin'
 * v2 — Barras de progreso animadas + auto-refresh
 * MIGRADO A V2: Lee de v2_asignaciones y v2_gerencias.
 */

import { put, remove, getAll } from '../db.js';
import { showToast } from '../utils.js';
import { supabase } from '../supabaseClient.js';

// ─── Timer de auto-refresh ────────────────────────────────────────────────────
let _refreshTimer = null;
let _container    = null;

function _stopAutoRefresh() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

function _startAutoRefresh() {
    _stopAutoRefresh();
    _refreshTimer = setInterval(() => {
        if (_container && document.contains(_container)) {
            _refreshDataOnly();
        } else {
            _stopAutoRefresh();
        }
    }, 12000); // cada 12 segundos
}

// ─── Helpers de datos ─────────────────────────────────────────────────────────

/**
 * V2: Calcula ocupación de camas agrupada por empresa||gerencia.
 * Lee v2_asignaciones con join a v2_empresas y v2_gerencias.
 */
async function getUsageByGerencia() {
    const usage = {};
    try {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select('v2_empresas(nombre), v2_empresas(v2_gerencias(nombre))');
        if (error) throw error;
        (data || []).forEach(a => {
            const company  = (a.v2_empresas?.nombre || '').trim().toLowerCase();
            const gerencia = (a.v2_empresas?.v2_gerencias?.nombre || '').trim().toLowerCase();
            if (!gerencia) return;
            const key = `${company}||${gerencia}`;
            usage[key] = (usage[key] || 0) + 1;
        });
    } catch(e) {
        console.warn('[Cupos V2] Error calculando ocupación:', e.message);
    }
    return usage;
}

/**
 * V2: Lee los límites de cupos desde v2_gerencias.
 * Devuelve el mismo shape que el antiguo gerencia_quotas para
 * que toda la UI renderice sin cambios.
 */
async function getAllQuotas() {
    try {
        const { data, error } = await supabase
            .from('v2_gerencias')
            .select('id, nombre, cupo_maximo, empresa:v2_empresas(nombre)');
        if (!error && data) {
            // Mapear al shape antiguo: { id, company, gerencia, limit, overrideAllowed }
            return data.map(g => ({
                id:             g.id,
                company:        g.empresa?.nombre || 'Sin empresa',
                gerencia:       g.nombre,
                limit:          g.cupo_maximo ?? null,
                overrideAllowed: false,
                updatedAt:      null,
            }));
        }
    } catch (e) {
        console.warn('[Cupos V2] Supabase no disponible:', e.message);
    }
    return [];
}

// ─── Solo actualizar contadores (sin re-renderizar el HTML completo) ──────────
async function _refreshDataOnly() {
    // V2: usage viene directamente de v2_asignaciones, no necesitamos rooms locales
    const [quotas, usage] = await Promise.all([
        getAllQuotas(),
        getUsageByGerencia()
    ]);

    const quotaMap = {};
    quotas.forEach(q => {
        const key = `${(q.company||'').trim().toLowerCase()}||${(q.gerencia||'').trim().toLowerCase()}`;
        quotaMap[key] = q;
    });

    // Actualizar cada tarjeta de gerencia sin re-renderizar todo el DOM
    const cards = document.querySelectorAll('[data-quota-key]');
    cards.forEach(card => {
        const fullKey  = card.dataset.quotaKey;
        const [company, gerencia] = fullKey.split('||');
        const lookupKey = `${company.toLowerCase()}||${gerencia.toLowerCase()}`;
        const quota = quotaMap[lookupKey];
        const used  = usage[lookupKey] || 0;
        const limit = quota?.limit ?? null;

        // Actualizar número
        const numEl  = card.querySelector('[data-used]');
        const barEl  = card.querySelector('[data-bar]');
        const pctEl  = card.querySelector('[data-pct]');
        const dotEl  = card.querySelector('[data-dot]');
        const txtEl  = card.querySelector('[data-txt]');

        if (!numEl) return;

        // Animar si cambió
        const prevUsed = parseInt(numEl.textContent, 10);
        if (prevUsed !== used) {
            numEl.style.transition = 'transform 0.3s, color 0.3s';
            numEl.style.transform  = 'scale(1.3)';
            numEl.style.color      = '#3182ce';
            setTimeout(() => {
                numEl.style.transform = 'scale(1)';
                numEl.style.color     = '';
            }, 350);
        }

        numEl.textContent = used;

        if (limit !== null && barEl && pctEl && dotEl && txtEl) {
            const pct      = Math.min(100, Math.round((used / limit) * 100));
            const barColor = pct >= 100 ? '#e53e3e' : pct >= 80 ? '#dd6b20' : '#38a169';
            barEl.style.width      = pct + '%';
            barEl.style.background = barColor;
            pctEl.textContent      = pct + '%';

            if (pct >= 100)      { dotEl.textContent = '🔴'; txtEl.style.color = '#c53030'; }
            else if (pct >= 80)  { dotEl.textContent = '🟠'; txtEl.style.color = '#92400e'; }
            else                 { dotEl.textContent = '🟢'; txtEl.style.color = '#276749'; }
        }
    });

    // Actualizar timestamp
    const tsEl = document.getElementById('cupos-last-update');
    if (tsEl) tsEl.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-CL');
}

// ─── Render principal ─────────────────────────────────────────────────────────

export async function renderCupos(container) {
    _container = container;
    _stopAutoRefresh();

    // V2: no usamos rooms locales — la ocupación viene de v2_asignaciones
    const [quotas, usage] = await Promise.all([
        getAllQuotas(),
        getUsageByGerencia()
    ]);

    // V2: recolectar gerencias únicas (de asignaciones activas + de cupos definidos)
    const gerenciasSet = new Set();
    Object.keys(usage).forEach(k => gerenciasSet.add(k));
    quotas.forEach(q => {
        if (q.company && q.gerencia) gerenciasSet.add(`${q.company}||${q.gerencia}`);
    });

    const quotaMap = {};
    quotas.forEach(q => {
        const key = `${(q.company||'').trim().toLowerCase()}||${(q.gerencia||'').trim().toLowerCase()}`;
        quotaMap[key] = q;
    });

    const sortedKeys = [...gerenciasSet].sort();

    // ── Construir tarjetas ────────────────────────────────────────────────────
    const cards = sortedKeys.map(fullKey => {
        const [company, gerencia] = fullKey.split('||');
        const lookupKey = `${company.toLowerCase()}||${gerencia.toLowerCase()}`;
        const quota = quotaMap[lookupKey];
        const used  = usage[lookupKey] || 0;
        const limit = quota?.limit ?? null;
        const overrideAllowed = quota?.overrideAllowed ?? false;

        let pct = limit !== null ? Math.min(100, Math.round((used / limit) * 100)) : 0;
        let barColor, bgCard, borderCard, dotIcon, textColor, statusLabel;

        if (limit === null) {
            barColor = '#a0aec0'; bgCard = '#f7fafc'; borderCard = '#e2e8f0';
            dotIcon = '⚪'; textColor = '#718096'; statusLabel = 'Sin límite';
        } else if (pct >= 100) {
            barColor = '#e53e3e'; bgCard = '#fff5f5'; borderCard = '#feb2b2';
            dotIcon = '🔴'; textColor = '#c53030'; statusLabel = '¡Cupo agotado!';
        } else if (pct >= 80) {
            barColor = '#dd6b20'; bgCard = '#fffbeb'; borderCard = '#fbd38d';
            dotIcon = '🟠'; textColor = '#92400e'; statusLabel = 'Casi lleno';
        } else {
            barColor = '#38a169'; bgCard = '#f0fff4'; borderCard = '#9ae6b4';
            dotIcon = '🟢'; textColor = '#276749'; statusLabel = 'Disponible';
        }

        const limitLabel = limit !== null ? limit : '∞';
        const availLabel = limit !== null ? Math.max(0, limit - used) : '∞';

        return `
        <div data-quota-key="${fullKey}"
             style="background:${bgCard};border:1.5px solid ${borderCard};border-radius:16px;padding:18px 20px;
                    transition:box-shadow 0.2s,transform 0.2s;cursor:default"
             onmouseenter="this.style.boxShadow='0 6px 24px rgba(0,0,0,0.1)';this.style.transform='translateY(-2px)'"
             onmouseleave="this.style.boxShadow='';this.style.transform=''">

          <!-- Header tarjeta -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:12px">
            <div style="flex:1">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#718096;margin-bottom:2px">${company}</div>
              <div style="font-size:14px;font-weight:800;color:#1a202c;line-height:1.3">${gerencia}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span data-dot style="font-size:16px">${dotIcon}</span>
              <span style="font-size:10px;font-weight:700;color:${textColor};background:${bgCard};padding:1px 7px;border-radius:99px;border:1px solid ${borderCard}">${statusLabel}</span>
            </div>
          </div>

          <!-- Contador grande -->
          <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:10px">
            <span data-used style="font-size:36px;font-weight:900;color:${textColor};line-height:1;transition:transform 0.3s,color 0.3s">${used}</span>
            <span style="font-size:16px;color:#a0aec0;font-weight:600">/ ${limitLabel} camas</span>
          </div>

          <!-- Barra de progreso -->
          <div style="background:#e2e8f0;border-radius:99px;height:10px;overflow:hidden;margin-bottom:6px;position:relative">
            <div data-bar
                 style="height:100%;width:${pct}%;background:${barColor};border-radius:99px;
                        transition:width 0.8s cubic-bezier(0.4,0,0.2,1);
                        box-shadow: 0 0 8px ${barColor}66">
            </div>
          </div>

          <!-- Porcentaje + disponible -->
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span data-pct data-txt style="font-size:12px;font-weight:700;color:${textColor}">${pct}% ocupado</span>
            <span style="font-size:12px;color:#718096">${availLabel === '∞' ? '∞ disponibles' : availLabel + ' camas libres'}</span>
          </div>

          ${overrideAllowed
            ? `<div style="margin-top:8px;font-size:10px;color:#2b6cb0;font-weight:600">✅ Exceso permitido por supervisor</div>`
            : ''}

          <!-- Acciones -->
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid ${borderCard};display:flex;gap:6px">
            ${['admin','superadmin','supervisor'].includes(window._currentUser?.role) ? `
            <button class="btn" style="font-size:12px;padding:6px 10px;background:linear-gradient(135deg,#2b6cb0,#3182ce);border:none;color:white;font-weight:700;border-radius:8px;transition:opacity 0.2s"
              onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'"
              onclick="window._openDetailModal('${encodeURIComponent(fullKey)}','${company.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${gerencia.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">
              📊 Detalle
            </button>` : ''}
            <button class="btn" style="flex:1;font-size:12px;padding:6px;background:white;border:1px solid #e2e8f0;color:#4a5568"
              onclick="window._editQuota('${encodeURIComponent(fullKey)}','${company.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${gerencia.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">
              ✏️ ${quota ? 'Editar cupo' : 'Definir cupo'}
            </button>
            ${quota && ['admin','superadmin'].includes(window._currentUser?.role) ? `
            <button class="btn" style="font-size:12px;padding:6px 10px;background:#fff5f5;border:1px solid #fecaca;color:#c0392b;font-weight:700"
              onclick="window._deleteQuota('${encodeURIComponent(fullKey)}','${company.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${gerencia.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">
              🗑️
            </button>` : ''}
          </div>
        </div>`;
    }).join('');

    container.innerHTML = `
    <style>
      #cupos-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap:16px; }
      @media(max-width:600px) { #cupos-grid { grid-template-columns: 1fr; } }

      /* Modal Detalle */
      #detail-modal-overlay {
        position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;
        display:none;align-items:center;justify-content:center;padding:16px;
        backdrop-filter:blur(4px);
      }
      #detail-modal-overlay.visible { display:flex; }
      #detail-modal {
        background:#fff;border-radius:20px;width:100%;max-width:680px;max-height:85vh;
        display:flex;flex-direction:column;box-shadow:0 25px 80px rgba(0,0,0,0.35);
        animation:slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes slideUp { from{transform:translateY(30px);opacity:0} to{transform:translateY(0);opacity:1} }
      #detail-modal-header {
        background:linear-gradient(135deg,#1a365d,#2b6cb0);
        border-radius:20px 20px 0 0;padding:20px 24px;
        display:flex;align-items:center;justify-content:space-between;gap:12px;
      }
      .detail-tab {
        padding:8px 18px;border-radius:8px;border:none;cursor:pointer;
        font-weight:700;font-size:13px;transition:all 0.2s;
        background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.7);
      }
      .detail-tab.active { background:rgba(255,255,255,0.95);color:#1a365d; }
      #detail-modal-body { flex:1;overflow-y:auto;padding:20px 24px; }
      .detail-row {
        display:flex;align-items:center;gap:12px;padding:10px 12px;
        border-radius:10px;transition:background 0.15s;
      }
      .detail-row:hover { background:#f7fafc; }
      .detail-period-card {
        background:#f7fafc;border:1px solid #e2e8f0;border-radius:12px;
        padding:14px 16px;margin-bottom:10px;
      }
    </style>

    <div class="section-header">
      <div>
        <h2 class="section-title">Cupos por <span>Gerencia</span></h2>
        <p class="section-subtitle">Límites de camas · Se actualiza automáticamente</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span id="cupos-last-update" style="font-size:11px;color:var(--text-muted)">Actualizado ahora</span>
        <button class="btn btn-ghost btn-sm" onclick="window._cuposRefresh()" title="Actualizar ahora">🔄</button>
        <button class="btn btn-primary" onclick="window._openAddQuota()">➕ Nueva Gerencia</button>
      </div>
    </div>

    <!-- Alertas -->
    <div id="cupos-alerts" style="margin-bottom:16px"></div>

    <!-- Tarjetas -->
    ${sortedKeys.length === 0
      ? `<div style="text-align:center;padding:60px 20px;color:var(--text-secondary);background:var(--bg-card);border-radius:16px;border:1px solid var(--border)">
           <div style="font-size:3.5rem;margin-bottom:12px">🎯</div>
           <div style="font-weight:800;font-size:16px;margin-bottom:6px">Sin gerencias configuradas</div>
           <div style="font-size:13px">Presiona <strong>"Nueva Gerencia"</strong> para definir el primer cupo.</div>
         </div>`
      : `<div id="cupos-grid">${cards}</div>`}

    <!-- Modal -->
    <div class="modal-overlay" id="quota-modal">
      <div class="modal" style="max-width:460px">
        <div class="modal-header">
          <div class="modal-header-icon" style="background:#ebf8ff;color:#2b6cb0">🎯</div>
          <div>
            <h3 style="font-size:16px;font-weight:700" id="quota-modal-title">Definir Cupo</h3>
            <p style="font-size:12px;color:var(--text-secondary)">Establece el límite de camas asignables</p>
          </div>
          <button class="modal-close btn" onclick="window._closeQuotaModal()">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
          <input type="hidden" id="quota-edit-key">
          <div class="form-group">
            <label class="form-label">Empresa</label>
            <input type="text" class="form-input" id="quota-company" placeholder="Ej: Aramark, Anglo American…">
          </div>
          <div class="form-group">
            <label class="form-label">Gerencia</label>
            <input type="text" class="form-input" id="quota-gerencia" placeholder="Ej: Gerencia Mina, OPEX…">
          </div>
          <div class="form-group">
            <label class="form-label">Límite de Camas <span style="color:var(--text-muted);font-weight:400">(0 = sin límite)</span></label>
            <input type="number" class="form-input" id="quota-limit" min="0" placeholder="Ej: 10">
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f7fafc;border-radius:10px;border:1px solid var(--border)">
            <input type="checkbox" id="quota-override" style="width:18px;height:18px;accent-color:#2b6cb0">
            <div>
              <label for="quota-override" style="font-weight:700;font-size:13px;cursor:pointer">Permitir exceder el cupo manualmente</label>
              <div style="font-size:11px;color:var(--text-muted)">Solo supervisores podrán asignar camas sobre el límite</div>
            </div>
          </div>
          <div id="quota-modal-usage" style="display:none;padding:10px 12px;background:#f0fff4;border:1px solid #c6f6d5;border-radius:8px;font-size:12px;color:#276749;font-weight:600"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="window._closeQuotaModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="window._saveQuota()" id="quota-save-btn">💾 Guardar</button>
        </div>
      </div>
    </div>
    `;

    _renderAlerts(sortedKeys, usage, quotaMap);
    _startAutoRefresh();

    // ── Handlers ──────────────────────────────────────────────────────────────

    window._cuposRefresh = async () => {
        const tsEl = document.getElementById('cupos-last-update');
        if (tsEl) tsEl.textContent = 'Actualizando…';
        await _refreshDataOnly();
    };

    window._closeQuotaModal = () => {
        document.getElementById('quota-modal')?.classList.remove('visible');
    };

    window._openAddQuota = () => {
        document.getElementById('quota-modal-title').textContent = 'Nueva Gerencia';
        document.getElementById('quota-edit-key').value  = '';
        document.getElementById('quota-company').value   = '';
        document.getElementById('quota-gerencia').value  = '';
        document.getElementById('quota-limit').value     = '';
        document.getElementById('quota-override').checked = false;
        document.getElementById('quota-modal-usage').style.display = 'none';
        document.getElementById('quota-company').removeAttribute('readonly');
        document.getElementById('quota-gerencia').removeAttribute('readonly');
        document.getElementById('quota-modal')?.classList.add('visible');
    };

    window._editQuota = (encodedKey, company, gerencia) => {
        const lookupKey = `${company.toLowerCase()}||${gerencia.toLowerCase()}`;
        const quota = quotaMap[lookupKey] || {};
        const used  = usage[lookupKey] || 0;

        document.getElementById('quota-modal-title').textContent = 'Editar Cupo';
        document.getElementById('quota-edit-key').value  = decodeURIComponent(encodedKey);
        document.getElementById('quota-company').value   = company;
        document.getElementById('quota-gerencia').value  = gerencia;
        document.getElementById('quota-limit').value     = quota.limit ?? '';
        document.getElementById('quota-override').checked = quota.overrideAllowed ?? false;
        document.getElementById('quota-company').setAttribute('readonly', true);
        document.getElementById('quota-gerencia').setAttribute('readonly', true);

        const usageEl = document.getElementById('quota-modal-usage');
        usageEl.style.display = 'block';
        usageEl.textContent   = `🛏️ Actualmente hay ${used} cama${used !== 1 ? 's' : ''} ocupadas`;

        document.getElementById('quota-modal')?.classList.add('visible');
    };

    window._saveQuota = async () => {
        const company  = document.getElementById('quota-company').value.trim();
        const gerencia = document.getElementById('quota-gerencia').value.trim();
        const limitRaw = document.getElementById('quota-limit').value.trim();
        const override = document.getElementById('quota-override').checked;

        if (!company || !gerencia) return showToast('Empresa y Gerencia son obligatorios', 'error');

        const limit = limitRaw === '' || limitRaw === '0' ? null : parseInt(limitRaw, 10);
        if (limitRaw !== '' && limitRaw !== '0' && isNaN(limit))
            return showToast('El límite debe ser un número entero', 'error');

        const key      = `${company.toLowerCase()}||${gerencia.toLowerCase()}`;
        const existing = quotas.find(q =>
            `${(q.company||'').toLowerCase()}||${(q.gerencia||'').toLowerCase()}` === key
        );

        const record = {
            id: existing?.id ?? `quota_${Date.now()}`,
            company, gerencia, limit,
            overrideAllowed: override,
            updatedAt: new Date().toISOString(),
            updatedBy: window._currentUser?.username || 'sistema'
        };

        const btn = document.getElementById('quota-save-btn');
        btn.disabled = true; btn.textContent = '⏳ Guardando...';

        try {
            // 1. Guardar en Supabase (fuente principal)
            const { error: sbErr } = await supabase
                .from('gerencia_quotas')
                .upsert(record, { onConflict: 'id' });

            if (sbErr) {
                console.warn('[Cupos] Error Supabase, guardando solo local:', sbErr.message);
                showToast('⚠️ Sin conexión — guardado local (sincronización pendiente)', 'warn');
            } else {
                showToast(`☁️ Cupo de "${gerencia}" sincronizado en todos los PCs`, 'success');
            }

            // 2. También en IndexedDB local (caché offline)
            await put('gerencia_quotas', record);

            window._closeQuotaModal();
            await renderCupos(container);
        } catch (err) {
            console.error(err);
            showToast('Error al guardar el cupo', 'error');
        } finally {
            btn.disabled = false; btn.textContent = '💾 Guardar';
        }
    };

    // 🗑️ BORRAR CUPO — solo superadmin
    window._deleteQuota = async (encodedKey, company, gerencia) => {
        // Modal de confirmación propio (los confirm() nativos se bloquean en móvil)
        const existing = document.getElementById('delete-quota-confirm');
        if (existing) existing.remove();

        const dlg = document.createElement('div');
        dlg.id = 'delete-quota-confirm';
        dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
        dlg.innerHTML = `
          <div style="background:#fff;border-radius:18px;padding:24px;max-width:360px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center">
            <div style="font-size:36px;margin-bottom:12px">🗑️</div>
            <div style="font-size:17px;font-weight:800;color:#1a202c;margin-bottom:8px">¿Eliminar este cupo?</div>
            <div style="font-size:13px;color:#718096;margin-bottom:20px">
              <strong>${gerencia}</strong><br>Empresa: ${company}<br><br>
              <span style="color:#c53030;font-weight:600">Esta acción no se puede deshacer.</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <button id="dq-cancel" style="padding:11px;border-radius:10px;border:1.5px solid #e2e8f0;background:#f7fafc;font-weight:700;font-size:14px;cursor:pointer">Cancelar</button>
              <button id="dq-confirm" style="padding:11px;border-radius:10px;border:none;background:linear-gradient(135deg,#c53030,#fc8181);color:#fff;font-weight:800;font-size:14px;cursor:pointer">🗑️ Eliminar</button>
            </div>
          </div>`;
        document.body.appendChild(dlg);

        document.getElementById('dq-cancel').onclick  = () => dlg.remove();
        dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

        document.getElementById('dq-confirm').onclick = async () => {
            dlg.remove();
            const btn = document.createElement('div');

            try {
                // Decodificar la clave — formato: "company||gerencia" (case original)
                const fullKey = decodeURIComponent(encodedKey);
                const sepIdx  = fullKey.indexOf('||');
                const compVal = fullKey.substring(0, sepIdx).trim();
                const gerVal  = fullKey.substring(sepIdx + 2).trim();

                showToast(`⏳ Eliminando cupo de "${gerVal}"...`, 'info');

                // 1. ☁️ Borrar en Supabase con ilike (case-insensitive, sin depender del ID)
                const { error: sbErr, data: deleted } = await supabase
                    .from('gerencia_quotas')
                    .delete()
                    .ilike('company',  compVal)
                    .ilike('gerencia', gerVal)
                    .select(); // retorna filas borradas para debug

                if (sbErr) {
                    console.error('[Cupos] Error Supabase al borrar:', sbErr);
                    showToast(`⚠️ Error en la nube: ${sbErr.message}`, 'error');
                    return;
                }
                console.log('[Cupos] Filas borradas en Supabase:', deleted);

                // 2. Limpiar IndexedDB — borrar TODOS los registros que coincidan
                const localAll = await getAll('gerencia_quotas').catch(() => []);
                const toDelete = localAll.filter(q =>
                    (q.company  || '').trim().toLowerCase() === compVal.toLowerCase() &&
                    (q.gerencia || '').trim().toLowerCase() === gerVal.toLowerCase()
                );
                for (const q of toDelete) {
                    await remove('gerencia_quotas', q.id).catch(() => {});
                }

                showToast(`✅ Cupo de "${gerVal}" eliminado`, 'success');
                await renderCupos(container);

            } catch(err) {
                console.error('[deleteQuota]', err);
                showToast('Error al eliminar: ' + err.message, 'error');
            }
        };
    };

    // ── Modal Detalle (trabajadores actuales + historial) ─────────────────────
    // Inyectar el overlay en el DOM si no existe
    if (!document.getElementById('detail-modal-overlay')) {
        const dmOverlay = document.createElement('div');
        dmOverlay.id = 'detail-modal-overlay';
        dmOverlay.innerHTML = `
          <div id="detail-modal">
            <div id="detail-modal-header">
              <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.6);margin-bottom:4px" id="dm-company-label">EMPRESA</div>
                <div style="font-size:17px;font-weight:800;color:#fff" id="dm-gerencia-label">Gerencia</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="display:flex;gap:6px;background:rgba(0,0,0,0.2);padding:4px;border-radius:10px">
                  <button class="detail-tab active" id="dm-tab-actual" onclick="window._dmSwitchTab('actual')">👥 Actuales</button>
                  <button class="detail-tab" id="dm-tab-hist" onclick="window._dmSwitchTab('hist')">📅 Historial</button>
                </div>
                <button onclick="document.getElementById('detail-modal-overlay').classList.remove('visible')"
                  style="background:rgba(255,255,255,0.15);border:none;color:#fff;border-radius:8px;width:34px;height:34px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
              </div>
            </div>
            <div id="detail-modal-body">
              <div style="text-align:center;padding:40px;color:#718096">⏳ Cargando...</div>
            </div>
            <div style="padding:12px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
              <span id="dm-footer-count" style="font-size:12px;color:#718096"></span>
              <button onclick="document.getElementById('detail-modal-overlay').classList.remove('visible')"
                style="padding:8px 18px;background:#f7fafc;border:1.5px solid #e2e8f0;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">Cerrar</button>
            </div>
          </div>`;
        dmOverlay.addEventListener('click', e => { if (e.target === dmOverlay) dmOverlay.classList.remove('visible'); });
        document.body.appendChild(dmOverlay);
    }

    // Estado del modal detalle
    let _dmCurrentKey = '', _dmCurrentTab = 'actual', _dmAsignaciones = [];

    window._dmSwitchTab = (tab) => {
        _dmCurrentTab = tab;
        document.getElementById('dm-tab-actual').classList.toggle('active', tab === 'actual');
        document.getElementById('dm-tab-hist').classList.toggle('active', tab === 'hist');
        _dmRender();
    };

    function _dmRender() {
        const body = document.getElementById('detail-modal-body');
        const footerCount = document.getElementById('dm-footer-count');
        if (!body) return;

        if (_dmCurrentTab === 'actual') {
            // ── Trabajadores actuales ──────────────────────────────────────
            if (!_dmAsignaciones.length) {
                body.innerHTML = `<div style="text-align:center;padding:40px 20px;color:#718096">
                  <div style="font-size:3rem;margin-bottom:12px">🛏️</div>
                  <div style="font-weight:700;font-size:15px;margin-bottom:6px">Sin ocupantes actuales</div>
                  <div style="font-size:13px">No hay camas asignadas en este momento para esta gerencia.</div>
                </div>`;
                footerCount.textContent = '0 trabajadores';
                return;
            }

            const rows = _dmAsignaciones.map((a, i) => {
                const turno  = a.turno || a.shift || '—';
                const hab    = a.room_number || a.habitacion || '—';
                const nombre = a.occupant_name || a.nombre || a.guest_name || 'Sin nombre';
                const rut    = a.rut || a.guest_rut || '';
                const cama   = a.bed_type || a.cama || '';
                const turnoIcon = turno === 'Noche' || turno === 'night' ? '🌙' : '☀️';
                const camaLabel = cama === 'extra' ? ' · Cama Extra' : cama === 'night' ? ' · Cama Noche' : cama === 'day' ? ' · Cama Día' : '';
                return `<div class="detail-row">
                  <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#ebf8ff,#bee3f8);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${turnoIcon}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:13px;color:#1a202c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nombre}</div>
                    <div style="font-size:11px;color:#718096">${rut ? rut + ' · ' : ''}Hab. <strong>${hab}</strong>${camaLabel}</div>
                  </div>
                  <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:${turno === 'Noche' || turno === 'night' ? '#2d3748' : '#fffbeb'};color:${turno === 'Noche' || turno === 'night' ? '#e2e8f0' : '#92400e'}">${turno}</span>
                </div>`;
            }).join('');

            body.innerHTML = `<div style="margin-bottom:12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#a0aec0">Trabajadores con cama asignada</div>${rows}`;
            footerCount.textContent = `${_dmAsignaciones.length} trabajador${_dmAsignaciones.length !== 1 ? 'es' : ''} activo${_dmAsignaciones.length !== 1 ? 's' : ''}`;

        } else {
            // ── Historial por período ─────────────────────────────────────
            const periodoSel = document.getElementById('dm-periodo-sel')?.value || 'semana';

            // Agrupar asignaciones por semana o mes según fechas de entrada (fecha_ingreso o created_at)
            const grupos = {};
            _dmAsignaciones.forEach(a => {
                const rawDate = a.fecha_ingreso || a.check_in || a.created_at || null;
                if (!rawDate) return;
                const d = new Date(rawDate);
                let key;
                if (periodoSel === 'semana') {
                    // Semana ISO: lunes al domingo
                    const startOfWeek = new Date(d);
                    const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
                    startOfWeek.setDate(d.getDate() - day);
                    key = startOfWeek.toLocaleDateString('es-CL', {day:'2-digit',month:'short',year:'numeric'});
                } else {
                    key = d.toLocaleDateString('es-CL', {month:'long',year:'numeric'});
                }
                if (!grupos[key]) grupos[key] = [];
                grupos[key].push(a);
            });

            const periodoUI = `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
                <span style="font-size:12px;font-weight:700;color:#718096">Ver por:</span>
                <select id="dm-periodo-sel"
                  onchange="window._dmSwitchTab('hist')"
                  style="padding:5px 10px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:12px;font-weight:700;color:#2d3748;background:#fff;cursor:pointer">
                  <option value="semana" ${periodoSel==='semana'?'selected':''}>Por semana</option>
                  <option value="mes" ${periodoSel==='mes'?'selected':''}>Por mes</option>
                </select>
              </div>`;

            if (!Object.keys(grupos).length) {
                body.innerHTML = periodoUI + `<div style="text-align:center;padding:40px 20px;color:#718096">
                  <div style="font-size:3rem;margin-bottom:12px">📅</div>
                  <div style="font-weight:700">Sin historial disponible</div>
                  <div style="font-size:12px;margin-top:6px">No se encontraron fechas registradas en las asignaciones.</div>
                </div>`;
                footerCount.textContent = '';
                return;
            }

            const cards = Object.entries(grupos).map(([periodo, items]) => {
                const pct  = quota?.limit ? Math.round((items.length / quota.limit) * 100) : null;
                const col  = pct >= 100 ? '#e53e3e' : pct >= 80 ? '#dd6b20' : '#38a169';
                return `<div class="detail-period-card">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div style="font-weight:800;font-size:13px;color:#1a202c;text-transform:capitalize">${periodo}</div>
                    <div style="display:flex;align-items:center;gap:8px">
                      ${pct !== null ? `<span style="font-size:11px;font-weight:700;color:${col}">${pct}% cupo</span>` : ''}
                      <span style="font-size:13px;font-weight:800;color:#2b6cb0">${items.length} cama${items.length!==1?'s':''}</span>
                    </div>
                  </div>
                  ${pct !== null ? `<div style="background:#e2e8f0;border-radius:99px;height:6px;overflow:hidden">
                    <div style="height:100%;width:${Math.min(100,pct)}%;background:${col};border-radius:99px"></div>
                  </div>` : ''}
                  <div style="margin-top:8px;font-size:11px;color:#718096">${items.map(a => a.occupant_name || a.nombre || 'Sin nombre').slice(0,5).join(', ')}${items.length>5?' y '+(items.length-5)+' más…':''}</div>
                </div>`;
            }).join('');

            body.innerHTML = periodoUI + cards;
            const total = Object.values(grupos).reduce((s,v)=>s+v.length,0);
            footerCount.textContent = `${total} registro${total!==1?'s':''} en historial`;
        }
    }

    window._openDetailModal = async (encodedKey, company, gerencia) => {
        _dmCurrentKey = decodeURIComponent(encodedKey);
        _dmCurrentTab = 'actual';
        _dmAsignaciones = [];

        // Resetear tabs
        document.getElementById('dm-tab-actual')?.classList.add('active');
        document.getElementById('dm-tab-hist')?.classList.remove('active');
        document.getElementById('dm-company-label').textContent = company.toUpperCase();
        document.getElementById('dm-gerencia-label').textContent = gerencia;
        document.getElementById('detail-modal-body').innerHTML = '<div style="text-align:center;padding:40px;color:#718096">⏳ Cargando datos...</div>';
        document.getElementById('dm-footer-count').textContent = '';
        document.getElementById('detail-modal-overlay').classList.add('visible');

        try {
            // Consultar v2_asignaciones con joins para obtener datos completos
            const { data, error } = await supabase
                .from('v2_asignaciones')
                .select(`
                    id, turno, fecha_ingreso, fecha_salida, created_at,
                    v2_huespedes(nombre, rut),
                    v2_habitaciones(numero),
                    v2_empresas(nombre, v2_gerencias(nombre))
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Filtrar por empresa y gerencia
            const [filterCompany, filterGerencia] = _dmCurrentKey.split('||');
            _dmAsignaciones = (data || []).filter(a => {
                const empNombre = (a.v2_empresas?.nombre || '').trim().toLowerCase();
                const gerNombre = (a.v2_empresas?.v2_gerencias?.nombre || '').trim().toLowerCase();
                return empNombre === filterCompany.toLowerCase() && gerNombre === filterGerencia.toLowerCase();
            }).map(a => ({
                id:            a.id,
                nombre:        a.v2_huespedes?.nombre || 'Sin nombre',
                rut:           a.v2_huespedes?.rut || '',
                habitacion:    a.v2_habitaciones?.numero || '—',
                turno:         a.turno || '—',
                fecha_ingreso: a.fecha_ingreso || a.created_at,
                fecha_salida:  a.fecha_salida,
            }));

        } catch(e) {
            console.warn('[Detalle Cupo] Error:', e.message);
            // Si falla Supabase, mostrar mensaje
            document.getElementById('detail-modal-body').innerHTML = `
              <div style="text-align:center;padding:40px;color:#e53e3e">
                <div style="font-size:2.5rem;margin-bottom:12px">⚠️</div>
                <div style="font-weight:700">Error al cargar datos</div>
                <div style="font-size:12px;margin-top:6px;color:#718096">${e.message}</div>
              </div>`;
            return;
        }

        _dmRender();
    };
}

// ─── Alertas ──────────────────────────────────────────────────────────────────
function _renderAlerts(keys, usage, quotaMap) {
    const alertsEl = document.getElementById('cupos-alerts');
    if (!alertsEl) return;

    const overLimit = [], nearLimit = [];

    keys.forEach(fullKey => {
        const [company, gerencia] = fullKey.split('||');
        const lookupKey = `${company.toLowerCase()}||${gerencia.toLowerCase()}`;
        const quota = quotaMap[lookupKey];
        if (!quota || quota.limit === null) return;
        const used = usage[lookupKey] || 0;
        const pct  = (used / quota.limit) * 100;
        if (pct >= 100) overLimit.push({ company, gerencia, used, limit: quota.limit, override: quota.overrideAllowed });
        else if (pct >= 80) nearLimit.push({ company, gerencia, used, limit: quota.limit });
    });

    if (!overLimit.length && !nearLimit.length) { alertsEl.innerHTML = ''; return; }

    alertsEl.innerHTML = `
    ${overLimit.map(a => `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#fff5f5;border:1.5px solid #feb2b2;border-radius:12px;margin-bottom:8px">
        <span style="font-size:22px">🚨</span>
        <div style="flex:1">
          <div style="font-weight:800;font-size:13px;color:#c53030">${a.company} — ${a.gerencia}</div>
          <div style="font-size:12px;color:#c53030;margin-top:2px">Cupo AGOTADO: <strong>${a.used}/${a.limit}</strong> camas${a.override ? ' · Exceso permitido' : ' · Sin asignaciones nuevas'}</div>
        </div>
      </div>`).join('')}
    ${nearLimit.map(a => `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#fffbeb;border:1.5px solid #fbd38d;border-radius:12px;margin-bottom:8px">
        <span style="font-size:22px">⚠️</span>
        <div style="flex:1">
          <div style="font-weight:800;font-size:13px;color:#92400e">${a.company} — ${a.gerencia}</div>
          <div style="font-size:12px;color:#92400e;margin-top:2px">Casi lleno: <strong>${a.used}/${a.limit}</strong> camas usadas</div>
        </div>
      </div>`).join('')}
    `;
}

// ─── Verificación antes de asignar ───────────────────────────────────────────
export async function checkQuotaBeforeAssign(company, gerencia) {
    if (!gerencia) return { allowed: true };

    const [rooms, quotas] = await Promise.all([
        getAll('rooms').catch(() => []),
        getAllQuotas()   // ☁️ ahora lee de Supabase
    ]);

    const lookupKey = `${(company||'').trim().toLowerCase()}||${(gerencia||'').trim().toLowerCase()}`;
    const quota = quotas.find(q =>
        `${(q.company||'').toLowerCase()}||${(q.gerencia||'').toLowerCase()}` === lookupKey
    );

    if (!quota || quota.limit === null) return { allowed: true };

    let used = 0;
    rooms.forEach(r => {
        ['day', 'night', 'extra'].forEach(bk => {
            const bed = r.beds?.[bk];
            if (!bed?.occupant) return;
            const c = (bed.company || '').trim().toLowerCase();
            const g = (bed.management || bed.gerencia || '').trim().toLowerCase();
            if (`${c}||${g}` === lookupKey) used++;
        });
    });

    if (used >= quota.limit) {
        if (quota.overrideAllowed) {
            return { allowed: 'override', message: `⚠️ El cupo de "${gerencia}" está agotado (${used}/${quota.limit}).\n¿Confirmar la asignación de todos formas?` };
        }
        return { allowed: false, message: `🚫 Gerencia "${gerencia}" alcanzó su límite (${quota.limit} camas).\nContacta al supervisor para ampliar el cupo.` };
    }

    return { allowed: true };
}
