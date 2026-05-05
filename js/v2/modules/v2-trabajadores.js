/**
 * v2-trabajadores.js — Gestión del Padrón de Trabajadores V2
 * - Importar Excel (RUT, Nombre, Sexo) → v2_trabajadores
 * - Ver listado y estadísticas del padrón
 */
import { upsertTrabajadores, getTrabajadoresCount } from '../v2-service.js';
import { supabase } from '../../supabaseClient.js';

export async function renderV2Trabajadores(container) {
    container.innerHTML = `
    <div style="padding:20px;max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">👥</div>
        <div>
          <h1 style="font-size:22px;font-weight:800;color:var(--text-primary);margin:0">Padrón de Trabajadores</h1>
          <p style="font-size:13px;color:var(--text-secondary);margin:0">Importa el Excel con RUT, Nombre y Sexo para habilitar el auto-relleno</p>
        </div>
      </div>

      <!-- CONTADOR -->
      <div id="padron-stats" style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:20px;display:flex;align-items:center;gap:16px">
        <div style="font-size:40px">📋</div>
        <div>
          <div id="padron-count" style="font-size:32px;font-weight:800;color:#6366f1">…</div>
          <div style="font-size:13px;color:var(--text-muted)">trabajadores en el padrón</div>
        </div>
        <button onclick="window.navigate('v2trabajadores')" style="margin-left:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary)">🔄 Actualizar</button>
      </div>

      <!-- IMPORTAR EXCEL -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;margin-bottom:20px">
        <h2 style="font-size:15px;font-weight:700;color:var(--text-primary);margin:0 0 6px">📁 Importar Excel</h2>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px">El archivo debe tener columnas: <strong>RUT</strong>, <strong>NOMBRE</strong>, <strong>SEXO</strong> (en cualquier orden, la primera fila es encabezado)</p>

        <!-- Zona de arrastre -->
        <div id="drop-zone" style="border:2px dashed var(--border);border-radius:14px;padding:40px;text-align:center;cursor:pointer;transition:all 0.2s;margin-bottom:16px"
          onclick="document.getElementById('excel-input').click()"
          ondragover="event.preventDefault();this.style.borderColor='#6366f1';this.style.background='rgba(99,102,241,0.05)'"
          ondragleave="this.style.borderColor='var(--border)';this.style.background=''"
          ondrop="event.preventDefault();this.style.borderColor='var(--border)';this.style.background='';window._v2tProcesarArchivo(event.dataTransfer.files[0])">
          <div style="font-size:36px;margin-bottom:10px">📊</div>
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Arrastra tu Excel aquí</div>
          <div style="font-size:13px;color:var(--text-muted)">o haz clic para seleccionar (.xlsx, .xls, .csv)</div>
        </div>
        <input id="excel-input" type="file" accept=".xlsx,.xls,.csv" style="display:none"
          onchange="window._v2tProcesarArchivo(this.files[0])">

        <!-- Mapeo de columnas -->
        <div id="columnas-config" style="display:none;background:var(--bg);border-radius:12px;padding:16px;margin-bottom:16px">
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:12px">📌 Mapea las columnas de tu archivo:</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Columna de RUT</label>
              <select id="col-rut" style="width:100%;padding:9px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:14px;outline:none">
                <option value="">— Seleccionar —</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Columna de Nombre</label>
              <select id="col-nombre" style="width:100%;padding:9px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:14px;outline:none">
                <option value="">— Seleccionar —</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:5px">Columna de Sexo (opcional)</label>
              <select id="col-sexo" style="width:100%;padding:9px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:14px;outline:none">
                <option value="">— No incluir —</option>
              </select>
            </div>
          </div>
          <div id="preview-box" style="margin-top:12px;font-size:12px;color:var(--text-muted)"></div>
        </div>

        <div id="import-msg" style="min-height:18px;font-size:13px;font-weight:600;margin-bottom:12px"></div>
        <button id="btn-importar" style="display:none;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border:none;border-radius:12px;padding:13px 28px;font-size:14px;font-weight:700;cursor:pointer;width:100%"
          onclick="window._v2tImportar()">
          📥 Importar al Padrón
        </button>
      </div>

      <!-- BÚSQUEDA RÁPIDA -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px">
        <h2 style="font-size:15px;font-weight:700;color:var(--text-primary);margin:0 0 12px">🔍 Buscar en el padrón</h2>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <input id="padron-q" type="text" placeholder="RUT o nombre del trabajador…"
            style="flex:1;min-width:200px;padding:11px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-primary);font-size:14px;outline:none"
            onkeydown="if(event.key==='Enter')window._v2tBuscar()">
          <button onclick="window._v2tBuscar()" style="background:#6366f1;color:white;border:none;border-radius:10px;padding:11px 22px;font-size:14px;font-weight:700;cursor:pointer">Buscar</button>
        </div>
        <div id="padron-resultados" style="margin-top:14px"></div>
      </div>
    </div>`;

    // ── Estado interno ──
    let _rawData   = [];
    let _headers   = [];

    // Cargar contador
    getTrabajadoresCount().then(c => {
        const el = document.getElementById('padron-count');
        if (el) el.textContent = c.toLocaleString('es-CL');
    });

    // ── Procesar archivo ──
    window._v2tProcesarArchivo = async (file) => {
        if (!file) return;
        const msg = (t,c) => { const e=document.getElementById('import-msg'); if(e){e.textContent=t;e.style.color=c||'var(--text-muted)';} };
        msg('Leyendo archivo…');
        try {
            const XLSX = await loadXLSX();
            const buf  = await file.arrayBuffer();
            const wb   = XLSX.read(buf, { type: 'array' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            _rawData   = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
            if (!_rawData.length) { msg('⚠️ El archivo está vacío','#f59e0b'); return; }

            _headers = Object.keys(_rawData[0]);
            const cfg = document.getElementById('columnas-config');
            cfg.style.display = 'block';

            // Rellenar selects de columnas
            ['col-rut','col-nombre','col-sexo'].forEach(id => {
                const sel = document.getElementById(id);
                const cur = sel.value;
                sel.innerHTML = `<option value="">— ${id==='col-sexo'?'No incluir':'Seleccionar'} —</option>` +
                    _headers.map(h => `<option value="${h}"${h===cur?'selected':''}>${h}</option>`).join('');
            });

            // Auto-detectar columnas por nombre similar
            const autoMatch = (keywords) => _headers.find(h =>
                keywords.some(k => h.toLowerCase().includes(k)));
            const colRut    = document.getElementById('col-rut');
            const colNombre = document.getElementById('col-nombre');
            const colSexo   = document.getElementById('col-sexo');
            if (!colRut.value)    colRut.value    = autoMatch(['rut','run']) || '';
            if (!colNombre.value) colNombre.value = autoMatch(['nombre','name','trabajador']) || '';
            if (!colSexo.value)   colSexo.value   = autoMatch(['sexo','sex','genero','género']) || '';

            // Preview
            const preview = document.getElementById('preview-box');
            if (preview) preview.innerHTML = `Vista previa (primeras 3 filas): <code>${JSON.stringify(_rawData.slice(0,3), null, 1).replace(/</g,'&lt;')}</code>`;

            document.getElementById('btn-importar').style.display = 'block';
            msg(`✅ ${_rawData.length.toLocaleString('es-CL')} filas leídas. Configura las columnas y presiona Importar.`, '#10b981');
        } catch(e) { msg('❌ Error leyendo archivo: ' + e.message, '#ef4444'); }
    };

    // ── Importar ──
    window._v2tImportar = async () => {
        const msg = (t,c) => { const e=document.getElementById('import-msg'); if(e){e.textContent=t;e.style.color=c||'var(--text-muted)';} };
        const colRut    = document.getElementById('col-rut')?.value;
        const colNombre = document.getElementById('col-nombre')?.value;
        const colSexo   = document.getElementById('col-sexo')?.value;
        if (!colRut || !colNombre) { msg('⚠️ Debes seleccionar al menos las columnas RUT y Nombre','#f59e0b'); return; }

        const btn = document.getElementById('btn-importar');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Importando…'; }
        msg('Importando trabajadores en Supabase…');
        try {
            const rows = _rawData.map(r => ({
                rut:    r[colRut],
                nombre: r[colNombre],
                sexo:   colSexo ? r[colSexo] : ''
            }));
            const total = await upsertTrabajadores(rows);
            msg(`✅ ${total.toLocaleString('es-CL')} trabajadores importados correctamente`, '#10b981');
            // Actualizar contador
            const c = await getTrabajadoresCount();
            const el = document.getElementById('padron-count');
            if (el) el.textContent = c.toLocaleString('es-CL');
        } catch(e) {
            msg('❌ ' + e.message, '#ef4444');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '📥 Importar al Padrón'; }
        }
    };

    // ── Búsqueda ──
    window._v2tBuscar = async () => {
        const q = document.getElementById('padron-q')?.value?.trim();
        const el = document.getElementById('padron-resultados');
        if (!q) { el.innerHTML = ''; return; }
        el.innerHTML = `<p style="color:var(--text-muted)">Buscando…</p>`;
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select('rut_huesped,nombre_huesped')
            .or(`rut_huesped.ilike.%${q}%,nombre_huesped.ilike.%${q}%`)
            .order('nombre_huesped')
            .limit(30);
        if (error || !data?.length) {
            el.innerHTML = `<p style="color:var(--text-muted)">Sin resultados para "${q}"</p>`; return;
        }
        el.innerHTML = `
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden;overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;min-width:400px">
              <thead><tr style="background:var(--bg-card);border-bottom:1px solid var(--border)">
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted)">RUT</th>
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted)">NOMBRE</th>
              </tr></thead>
              <tbody>${data.map((t,i)=>`<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg-card)'}">
                <td style="padding:10px 14px;font-family:monospace;font-size:13px;color:var(--text-primary)">${t.rut_huesped}</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:var(--text-primary)">${t.nombre_huesped}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>`;
    };
}

// Carga lazy de SheetJS (XLSX) desde CDN
async function loadXLSX() {
    if (window.XLSX) return window.XLSX;
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
    });
    return window.XLSX;
}
