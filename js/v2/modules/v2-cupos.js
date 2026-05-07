/**
 * v2-cupos.js — Gestión de Cupos por Gerencia (Contratos SAP)
 * Tabla: v2_cupos_gerencias
 * Columnas: numero_contrato, contrato_sap, empresa, gerencia,
 *           nombre_contrato, operacion, fecha_inicio, fecha_termino,
 *           cupos_totales, cupos_ocupados
 */
import { supabase } from '../../supabaseClient.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const toast = (msg, type = 'success') => {
    const el = document.createElement('div');
    const bg = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b';
    el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;background:${bg};color:#fff;
        padding:12px 20px;border-radius:12px;font-weight:700;font-size:14px;
        box-shadow:0 4px 20px rgba(0,0,0,.18);max-width:380px;animation:fadeIn .2s`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3800);
};
const fmt = d => { if (!d) return '—'; const [y, m, dd] = String(d).split('-'); return `${dd}/${m}/${y}`; };
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Estado global del módulo ──────────────────────────────────────────────────
let _contratos = [];
let _filtroGerencia = '';
let _filtroEmpresa = '';

// ── Cargar contratos desde Supabase ──────────────────────────────────────────
async function cargarContratos() {
    const { data, error } = await supabase
        .from('v2_cupos_gerencias')
        .select('*')
        .order('gerencia')
        .order('empresa');
    if (error) throw error;
    _contratos = data || [];
    return _contratos;
}

// ── Guardar cupo individual ───────────────────────────────────────────────────
window._cupoGuardar = async (id) => {
    const input = document.getElementById(`cupo-input-${id}`);
    const btn   = document.getElementById(`cupo-btn-${id}`);
    if (!input) return;
    const val = parseInt(input.value, 10);
    if (isNaN(val) || val < 0) { toast('Ingresa un número válido ≥ 0', 'warn'); return; }
    btn.disabled = true; btn.textContent = '⏳';
    const { error } = await supabase
        .from('v2_cupos_gerencias')
        .update({ cupos_totales: val })
        .eq('id', id);
    btn.disabled = false; btn.textContent = '💾';
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    toast('✅ Cupo actualizado');
    // Actualizar en memoria sin recargar toda la tabla
    const c = _contratos.find(x => x.id === id);
    if (c) { c.cupos_totales = val; renderTabla(); }
};

// ── Importar desde Excel ──────────────────────────────────────────────────────
window._cupoImportarExcel = async (file) => {
    const overlay  = document.getElementById('cupo-import-overlay');
    const statusEl = document.getElementById('cupo-import-status');
    if (overlay) overlay.style.display = 'flex';

    try {
        // Cargar XLSX dinámicamente
        if (!window.XLSX) {
            if (statusEl) statusEl.textContent = 'Cargando librería Excel…';
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
                s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar la librería XLSX'));
                document.head.appendChild(s);
            });
        }

        if (statusEl) statusEl.textContent = 'Leyendo archivo…';
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: 'array', cellDates: true });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        // raw:false para que las fechas vengan como strings formateados
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

        if (!rows.length) throw new Error('El archivo no contiene datos.');

        // ── Mapa EXACTO de headers SAP → columnas BD ───────────────────────
        // Normalizar: quitar tildes, minúsculas, espacios extra
        const norm = s => String(s||'').toLowerCase().trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
            .replace(/\s+/g,' ');

        const HEADER_MAP = {
            // numero_contrato
            'numero de contrato':   'numero_contrato',
            'numero contrato':      'numero_contrato',
            'n° contrato':          'numero_contrato',
            'n contrato':           'numero_contrato',
            'nro contrato':         'numero_contrato',
            'nro. contrato':        'numero_contrato',
            'contrato':             'numero_contrato',
            // contrato_sap
            'n° contrato sap':      'contrato_sap',
            'n contrato sap':       'contrato_sap',
            'contrato sap':         'contrato_sap',
            'numero sap':           'contrato_sap',
            'sap':                  'contrato_sap',
            // empresa
            'nombre empresa':       'empresa',
            'empresa':              'empresa',
            'proveedor':            'empresa',
            'razon social':         'empresa',
            // gerencia
            'gerencia':             'gerencia',
            'area':                 'gerencia',
            // nombre_contrato
            'nombre contrato':      'nombre_contrato',
            'nombre del contrato':  'nombre_contrato',
            'descripcion':          'nombre_contrato',
            'descripcion contrato': 'nombre_contrato',
            'objeto contrato':      'nombre_contrato',
            // operacion
            'operacion':            'operacion',
            'operacion o planta':   'operacion',
            'planta':               'operacion',
            'ubicacion':            'operacion',
            // fechas
            'fecha inicio':         'fecha_inicio',
            'fecha de inicio':      'fecha_inicio',
            'inicio vigencia':      'fecha_inicio',
            'vigencia desde':       'fecha_inicio',
            'fecha termino':        'fecha_termino',
            'fecha de termino':     'fecha_termino',
            'termino vigencia':     'fecha_termino',
            'vigencia hasta':       'fecha_termino',
            'fecha fin':            'fecha_termino',
        };

        // Detectar qué columnas del Excel mapean a BD
        const headers = Object.keys(rows[0]);
        const colMap  = {};   // excelHeader → dbColumn
        headers.forEach(h => {
            const dbCol = HEADER_MAP[norm(h)];
            if (dbCol) colMap[h] = dbCol;
        });

        // Debug: loguear qué columnas se detectaron
        console.log('[Cupos] Headers detectados:', colMap);

        if (!Object.keys(colMap).length) {
            throw new Error(
                'No se reconoció ninguna columna del Excel.\n' +
                'Columnas encontradas: ' + headers.slice(0, 8).join(', ')
            );
        }

        // ── Parser de fechas robusto → YYYY-MM-DD o null ──────────────────
        const parseDate = v => {
            if (!v) return null;
            // Si XLSX ya lo parseó como fecha ISO
            if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
            const s = String(v).trim();
            // DD/MM/YYYY o DD-MM-YYYY
            let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
            // MM/DD/YYYY (americano)
            m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
            if (m && parseInt(m[1]) <= 12) {
                const yr = m[3].length === 2 ? '20' + m[3] : m[3];
                return `${yr}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
            }
            // Número serial de Excel (días desde 1900)
            const n = parseFloat(s);
            if (!isNaN(n) && n > 1000) {
                const d = new Date(Math.round((n - 25569) * 86400 * 1000));
                if (!isNaN(d)) return d.toISOString().split('T')[0];
            }
            return null;
        };

        // ── Construir filas para Supabase ─────────────────────────────────
        if (statusEl) statusEl.textContent = 'Procesando filas…';

        const filas = rows
            .filter(row => Object.values(row).some(v => String(v).trim() !== ''))
            .map(row => {
                const obj = { cupos_totales: 0, cupos_ocupados: 0 };
                Object.entries(colMap).forEach(([h, col]) => {
                    const raw = row[h];
                    if (col === 'fecha_inicio' || col === 'fecha_termino') {
                        obj[col] = parseDate(raw);
                    } else {
                        const v = String(raw || '').trim();
                        obj[col] = v !== '' ? v : null;
                    }
                });
                return obj;
            })
            .filter(r => r.numero_contrato || r.empresa || r.gerencia);

        if (!filas.length) {
            throw new Error(
                'No se encontraron filas con datos válidos.\n' +
                'Verifica que el archivo tenga las columnas correctas.'
            );
        }

        if (statusEl) statusEl.textContent = `Insertando ${filas.length} contratos en Supabase…`;

        // ── Insert directo en lotes de 100 (evita timeout y el error de upsert) ──
        const BATCH = 100;
        let insertados = 0;
        for (let i = 0; i < filas.length; i += BATCH) {
            const lote = filas.slice(i, i + BATCH);
            if (statusEl) statusEl.textContent = `Guardando ${i + lote.length}/${filas.length}…`;
            const { error } = await supabase
                .from('v2_cupos_gerencias')
                .insert(lote);
            if (error) throw new Error(`Error en lote ${i / BATCH + 1}: ${error.message}`);
            insertados += lote.length;
        }

        if (overlay) overlay.style.display = 'none';
        toast(`✅ ${insertados} contratos importados correctamente`);

        // Resetear input file para permitir reimportar el mismo archivo
        const fi = document.getElementById('cupo-file-input');
        if (fi) fi.value = '';

        await cargarContratos();
        renderKpis();
        renderTabla();

    } catch (e) {
        if (overlay) overlay.style.display = 'none';
        console.error('[Cupos Import]', e);
        toast('🚨 ' + e.message, 'error');
    }
};



// ── Renderizar tabla filtrada ─────────────────────────────────────────────────
function renderTabla() {
    const tbody = document.getElementById('cupo-tbody');
    const countEl = document.getElementById('cupo-count');
    if (!tbody) return;

    const filtered = _contratos.filter(c => {
        const matchG = !_filtroGerencia || (c.gerencia || '').toLowerCase().includes(_filtroGerencia.toLowerCase());
        const matchE = !_filtroEmpresa  || (c.empresa  || '').toLowerCase().includes(_filtroEmpresa.toLowerCase());
        return matchG && matchE;
    });

    if (countEl) countEl.textContent = `${filtered.length} contrato${filtered.length !== 1 ? 's' : ''}`;

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#94a3b8;font-size:14px">Sin contratos que coincidan con los filtros</td></tr>`;
        return;
    }

    const hoy = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    tbody.innerHTML = filtered.map(c => {
        const pct      = c.cupos_totales > 0 ? Math.min(100, Math.round((c.cupos_ocupados / c.cupos_totales) * 100)) : 0;
        const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
        const libre    = Math.max(0, (c.cupos_totales || 0) - (c.cupos_ocupados || 0));
        const vencido  = c.fecha_termino && c.fecha_termino < hoy;
        const lleno    = c.cupos_totales > 0 && (c.cupos_ocupados || 0) >= c.cupos_totales;
        const rowBg    = vencido ? '#fff1f2' : '';
        const rowBorder= vencido ? '2px solid #fca5a5' : '1px solid #f1f5f9';
        return `
        <tr style="border-bottom:${rowBorder};transition:background .15s;background:${rowBg}"
            onmouseover="this.style.background='${vencido?'#ffe4e6':'#f8fafc'}'" onmouseout="this.style.background='${rowBg}'">
          <td style="padding:10px 12px;font-weight:700;font-family:monospace;font-size:12px;color:#6366f1">${esc(c.numero_contrato||'—')}</td>
          <td style="padding:10px 12px;font-size:12px;color:#64748b">${esc(c.contrato_sap||'—')}</td>
          <td style="padding:10px 12px;font-weight:600">${esc(c.empresa||'—')}</td>
          <td style="padding:10px 12px">
            <span style="background:#e0f2fe;color:#0369a1;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700">${esc(c.gerencia||'—')}</span>
          </td>
          <td style="padding:10px 12px;font-size:12px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.nombre_contrato||'')}">
            ${esc(c.nombre_contrato||'—')}
          </td>
          <td style="padding:10px 12px;text-align:center">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;background:#f1f5f9;border-radius:99px;height:6px;overflow:hidden;min-width:60px">
                <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width .6s"></div>
              </div>
              <span style="font-size:11px;font-weight:700;color:${barColor};min-width:30px">${pct}%</span>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">${c.cupos_ocupados||0} ocup. · ${libre} libre${libre!==1?'s':''}</div>
            ${lleno ? '<div style="font-size:10px;font-weight:800;color:#ef4444;margin-top:2px">🚫 CUPOS LLENOS</div>' : ''}
          </td>
          <td style="padding:10px 12px;text-align:center">
            <div style="display:flex;align-items:center;gap:6px;justify-content:center">
              <input id="cupo-input-${c.id}" type="number" min="0" value="${c.cupos_totales||0}"
                style="width:70px;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;font-weight:700;text-align:center;outline:none"
                onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'"
                onkeydown="if(event.key==='Enter') window._cupoGuardar('${c.id}')">
              <button id="cupo-btn-${c.id}" onclick="window._cupoGuardar('${c.id}')"
                style="padding:6px 12px;border:none;border-radius:8px;background:#6366f1;color:#fff;font-weight:700;font-size:13px;cursor:pointer">
                💾
              </button>
            </div>
          </td>
          <td style="padding:10px 12px;font-size:12px;color:#64748b">${fmt(c.fecha_inicio)}</td>
          <td style="padding:10px 12px;font-size:12px">
            ${vencido
              ? `<div style="display:flex;align-items:center;gap:6px">
                   <span style="font-weight:800;color:#dc2626">${fmt(c.fecha_termino)}</span>
                   <span style="background:#fee2e2;color:#dc2626;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px">VENCIDO</span>
                 </div>`
              : `<span style="color:#64748b">${fmt(c.fecha_termino)}</span>`}
          </td>
        </tr>`;
    }).join('');
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function renderKpis() {
    const el = document.getElementById('cupo-kpis');
    if (!el) return;
    const totalContratos = _contratos.length;
    const totalCupos     = _contratos.reduce((s, c) => s + (c.cupos_totales  || 0), 0);
    const totalOcupados  = _contratos.reduce((s, c) => s + (c.cupos_ocupados || 0), 0);
    const totalLibres    = Math.max(0, totalCupos - totalOcupados);
    const gerencias      = new Set(_contratos.map(c => c.gerencia).filter(Boolean)).size;

    el.innerHTML = [
        { icon: '📋', lbl: 'Contratos',   val: totalContratos, c: '#6366f1' },
        { icon: '🏢', lbl: 'Gerencias',   val: gerencias,      c: '#0ea5e9' },
        { icon: '🛏️', lbl: 'Cupos Total', val: totalCupos,     c: '#8b5cf6' },
        { icon: '✅', lbl: 'Ocupados',    val: totalOcupados,  c: '#c0392b' },
        { icon: '🟢', lbl: 'Libres',      val: totalLibres,    c: '#10b981' },
    ].map(k => `
        <div style="background:var(--bg-card,#fff);border-radius:14px;padding:16px 18px;
            box-shadow:0 2px 10px rgba(0,0,0,.07);border:1px solid var(--border,#e2e8f0)">
          <div style="font-size:22px;margin-bottom:6px">${k.icon}</div>
          <div style="font-size:28px;font-weight:900;color:${k.c}">${k.val}</div>
          <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-top:2px">${k.lbl}</div>
        </div>`).join('');
}

// ── Desglose por Gerencia (colapsable) ──────────────────────────────────────
function renderResumenGerencias() {
    const el = document.getElementById('cupo-desglose');
    if (!el) return;

    // Agrupar por gerencia
    const porGerencia = {};
    _contratos.forEach(c => {
        const g = c.gerencia || 'Sin Gerencia';
        if (!porGerencia[g]) porGerencia[g] = [];
        porGerencia[g].push(c);
    });

    const grandTotal = _contratos.reduce((s, c) => s + (c.cupos_totales || 0), 0);

    const cards = Object.entries(porGerencia)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([ger, rows]) => {
            const subtotal = rows.reduce((s, c) => s + (c.cupos_totales || 0), 0);
            const rowsHTML = rows
                .sort((a,b) => (a.empresa||'').localeCompare(b.empresa||''))
                .map(c => `
                <tr style="border-bottom:1px solid #f1f5f9" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                    <td style="padding:7px 12px;font-size:12px;font-weight:600;color:var(--text-primary,#1a202c)">${esc(c.empresa||'—')}</td>
                    <td style="padding:7px 12px;font-family:monospace;font-size:11px;color:#6366f1">${esc(c.numero_contrato||'—')}</td>
                    <td style="padding:7px 12px;text-align:right;font-weight:800;font-size:13px;color:#0ea5e9">${(c.cupos_totales||0).toLocaleString('es-CL')}</td>
                </tr>`).join('');
            return `
            <div style="background:var(--bg-card,#fff);border-radius:14px;margin-bottom:10px;overflow:hidden;border:1px solid var(--border,#e2e8f0);box-shadow:0 2px 8px rgba(0,0,0,.05)">
                <div onclick="(function(el){var p=el.nextElementSibling;var icon=el.querySelector('.ger-icon');var open=p.style.display==='none';p.style.display=open?'block':'none';icon.textContent=open?'▲':'▼';})(this)"
                    style="background:linear-gradient(135deg,#4338ca,#7c3aed);color:white;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none">
                    <div>
                        <div style="font-weight:800;font-size:14px">${esc(ger)}</div>
                        <div style="font-size:11px;opacity:.8">${rows.length} contrato${rows.length!==1?'s':''}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px">
                        <span style="font-size:18px;font-weight:900;background:rgba(255,255,255,.2);border-radius:10px;padding:4px 14px">${subtotal.toLocaleString('es-CL')}</span>
                        <span class="ger-icon" style="font-size:13px;opacity:.9">▼</span>
                    </div>
                </div>
                <div style="display:none">
                    <table style="width:100%;border-collapse:collapse">
                        <thead><tr style="background:#f8fafc">
                            <th style="padding:7px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Empresa</th>
                            <th style="padding:7px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">N° Contrato</th>
                            <th style="padding:7px 12px;text-align:right;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Cupos</th>
                        </tr></thead>
                        <tbody>${rowsHTML}</tbody>
                        <tfoot><tr style="background:#ede9fe">
                            <td colspan="2" style="padding:8px 12px;font-weight:800;font-size:12px;color:#4338ca">Subtotal — ${esc(ger)}</td>
                            <td style="padding:8px 12px;text-align:right;font-weight:900;font-size:15px;color:#6366f1">${subtotal.toLocaleString('es-CL')}</td>
                        </tr></tfoot>
                    </table>
                </div>
            </div>`;
        }).join('');

    el.innerHTML = cards + `
        <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:14px;padding:18px 22px;
            display:flex;justify-content:space-between;align-items:center;margin-top:6px;box-shadow:0 4px 16px rgba(0,0,0,.2)">
            <div>
                <div style="color:rgba(255,255,255,.7);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">TOTAL GENERAL DE CUPOS</div>
                <div style="color:rgba(255,255,255,.6);font-size:11px;margin-top:2px">${Object.keys(porGerencia).length} gerencias · ${_contratos.length} contratos</div>
            </div>
            <div style="font-size:36px;font-weight:900;color:#a5f3fc">${grandTotal.toLocaleString('es-CL')}</div>
        </div>`;
}

// ── Exportar Desglose por Gerencia a Excel ───────────────────────────────────
window._cupoExportarDesglose = async () => {
    if (!window.XLSX) {
        toast('Cargando librería Excel…', 'warn');
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
            s.onload = res;
            s.onerror = () => rej(new Error('No se pudo cargar XLSX'));
            document.head.appendChild(s);
        });
    }
    const { utils, writeFile } = XLSX;
    const wb = utils.book_new();
    const filas = [];

    const fechaHoy = new Date().toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric' });
    filas.push(['DESGLOSE DE CUPOS POR GERENCIA', '', '', '']);
    filas.push([`Generado: ${fechaHoy}`, '', '', '']);
    filas.push(['', '', '', '']);
    filas.push(['GERENCIA / EMPRESA', 'N° CONTRATO', 'CUPOS TOTALES', 'CUPOS OCUPADOS']);

    const porGerencia = {};
    _contratos.forEach(c => {
        const g = c.gerencia || 'Sin Gerencia';
        if (!porGerencia[g]) porGerencia[g] = [];
        porGerencia[g].push(c);
    });

    let grandTotal = 0;
    Object.entries(porGerencia)
        .sort(([a],[b]) => a.localeCompare(b))
        .forEach(([ger, rows]) => {
            const subtotal = rows.reduce((s, c) => s + (c.cupos_totales || 0), 0);
            const ocupSub  = rows.reduce((s, c) => s + (c.cupos_ocupados || 0), 0);
            filas.push([`▶ ${ger}`, `${rows.length} contrato${rows.length!==1?'s':''}`, subtotal, ocupSub]);
            rows.sort((a,b) => (a.empresa||'').localeCompare(b.empresa||'')).forEach(c => {
                filas.push([`  ${c.empresa || '—'}`, c.numero_contrato || '—', c.cupos_totales || 0, c.cupos_ocupados || 0]);
            });
            filas.push([`Subtotal — ${ger}`, '', subtotal, ocupSub]);
            filas.push(['', '', '', '']);
            grandTotal += subtotal;
        });

    filas.push(['TOTAL GENERAL DE CUPOS', `${Object.keys(porGerencia).length} gerencias · ${_contratos.length} contratos`, grandTotal, '']);

    const ws = utils.aoa_to_sheet(filas);
    ws['!cols'] = [{ wch: 45 }, { wch: 22 }, { wch: 18 }, { wch: 18 }];
    utils.book_append_sheet(wb, ws, 'Desglose Gerencias');
    const nombre = `Cupos_Gerencias_${fechaHoy.replace(/\//g,'-')}.xlsx`;
    writeFile(wb, nombre);
    toast('✅ Excel descargado: ' + nombre);
};

// ── Render principal ──────────────────────────────────────────────────────────
export async function renderV2Cupos(container) {
    container.innerHTML = `
    <div style="padding:24px 20px;max-width:1300px;margin:0 auto">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px">
        <div>
          <h2 style="font-size:22px;font-weight:800;margin:0;color:var(--text-primary,#1a202c)">📊 Cupos por Gerencia</h2>
          <p style="font-size:13px;color:#64748b;margin:4px 0 0">Maestro de contratos SAP · Define cupos habilitados por gerencia</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button onclick="document.getElementById('cupo-file-input').click()"
            style="padding:10px 20px;border:none;border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(99,102,241,.35)">
            📥 Importar Excel
          </button>
          <input id="cupo-file-input" type="file" accept=".xlsx,.xls,.csv" style="display:none"
            onchange="if(this.files[0]) window._cupoImportarExcel(this.files[0])">
          <button onclick="window._cupoRecargar()"
            style="padding:10px 18px;border:1.5px solid var(--border,#e2e8f0);border-radius:10px;background:var(--bg-card,#fff);font-weight:700;font-size:13px;cursor:pointer">
            🔄 Actualizar
          </button>
        </div>
      </div>

      <!-- KPIs -->
      <div id="cupo-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:16px"></div>

      <!-- Botón desglose + exportar -->
      <div style="margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button id="btn-desglose" onclick="window._cupoToggleDesglose()"
          style="padding:10px 20px;border:1.5px solid #6366f1;border-radius:10px;background:transparent;color:#6366f1;
                 font-weight:700;font-size:13px;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:8px">
          <span id="btn-desglose-icon">▼</span> Ver desglose por gerencia
        </button>
        <button onclick="window._cupoExportarDesglose()"
          style="padding:10px 18px;border:none;border-radius:10px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;
                 font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(16,185,129,.35);display:inline-flex;align-items:center;gap:8px">
          📥 Descargar Excel
        </button>
      </div>

      <!-- Panel desglose (oculto por defecto) -->
      <div id="cupo-desglose" style="display:none;margin-bottom:24px"></div>

      <!-- Filtros -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <input id="cupo-filter-gerencia" type="text" placeholder="🔍 Filtrar por Gerencia…"
          oninput="_filtroGerencia=this.value; window._cupoRenderTabla()"
          style="padding:9px 14px;border:1.5px solid var(--border,#e2e8f0);border-radius:10px;font-size:13px;min-width:200px;outline:none;background:var(--bg-card,#fff)">
        <input id="cupo-filter-empresa" type="text" placeholder="🔍 Filtrar por Empresa…"
          oninput="_filtroEmpresa=this.value; window._cupoRenderTabla()"
          style="padding:9px 14px;border:1.5px solid var(--border,#e2e8f0);border-radius:10px;font-size:13px;min-width:200px;outline:none;background:var(--bg-card,#fff)">
        <span id="cupo-count" style="display:flex;align-items:center;font-size:13px;color:#94a3b8;font-weight:600"></span>
      </div>

      <!-- Tabla -->
      <div style="background:var(--bg-card,#fff);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07);border:1px solid var(--border,#e2e8f0)">
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border-bottom:2px solid var(--border,#e2e8f0)">
                ${['N° Contrato','SAP','Empresa','Gerencia','Nombre Contrato','Ocupación','Cupos Totales','Inicio','Término']
                    .map(h => `<th style="padding:11px 12px;text-align:left;font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;white-space:nowrap">${h}</th>`)
                    .join('')}
              </tr>
            </thead>
            <tbody id="cupo-tbody">
              <tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8">
                <div style="font-size:32px;margin-bottom:8px">⏳</div>Cargando contratos…
              </td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Overlay de importación -->
      <div id="cupo-import-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:20px;padding:40px;text-align:center;min-width:300px">
          <div style="font-size:40px;margin-bottom:12px">📥</div>
          <div style="font-weight:800;font-size:17px;margin-bottom:8px">Importando contratos…</div>
          <div id="cupo-import-status" style="font-size:13px;color:#64748b">Leyendo archivo…</div>
        </div>
      </div>

    </div>`;

    // Exponer filtros al scope global (las variables del módulo)
    window._filtroGerencia = '';
    window._filtroEmpresa  = '';
    window._cupoRenderTabla = () => {
        _filtroGerencia = document.getElementById('cupo-filter-gerencia')?.value || '';
        _filtroEmpresa  = document.getElementById('cupo-filter-empresa')?.value  || '';
        renderTabla();
    };
    window._cupoToggleDesglose = () => {
        const panel = document.getElementById('cupo-desglose');
        const icon  = document.getElementById('btn-desglose-icon');
        const btn   = document.getElementById('btn-desglose');
        if (!panel) return;
        const open = panel.style.display === 'none';
        if (open) {
            renderResumenGerencias();
            panel.style.display = 'block';
            if (icon) icon.textContent = '▲';
            if (btn) { btn.style.background = '#6366f1'; btn.style.color = '#fff'; }
        } else {
            panel.style.display = 'none';
            if (icon) icon.textContent = '▼';
            if (btn) { btn.style.background = 'transparent'; btn.style.color = '#6366f1'; }
        }
    };
    window._cupoRecargar = async () => {
        const tbody = document.getElementById('cupo-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#94a3b8">⏳ Actualizando…</td></tr>`;
        try {
            await cargarContratos();
            renderKpis();
            renderTabla();
        } catch (e) {
            toast('Error: ' + e.message, 'error');
        }
    };

    // Carga inicial
    try {
        await cargarContratos();
        renderKpis();
        renderTabla();
    } catch (e) {
        const tbody = document.getElementById('cupo-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#ef4444">
            ⚠️ Error cargando datos: ${e.message}
        </td></tr>`;
    }
}
