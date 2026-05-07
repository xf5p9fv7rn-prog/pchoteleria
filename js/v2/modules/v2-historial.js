/**
 * v2-historial.js — Historial de Ocupación y Facturación
 * Días-cama calculados por estadía real, no por período total.
 * Solo supervisores.
 */
let _sb = null;
async function getSb() {
    if (!_sb) { const m = await import('../../supabaseClient.js'); _sb = m.supabase; }
    return _sb;
}

function colorStr(s) {
    const p = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#f97316','#14b8a6','#84cc16'];
    let h = 0; for (const c of s) h = (h*31+c.charCodeAt(0)) % p.length;
    return p[Math.abs(h)];
}

// Días reales de una estadía
function diasEstadia(fechaIn, fechaOut) {
    const ini = new Date((fechaIn||'').split('T')[0]+'T00:00:00');
    const fin = fechaOut ? new Date((fechaOut).split('T')[0]+'T00:00:00') : new Date();
    const d   = Math.round((fin - ini) / 86400000);
    return Math.max(0, d);
}

let _lastData = [];
let _activeTab = 'ocupacion';

// ── Períodos de facturación 21→20 ────────────────────────────────────
function periodoFacturacion(offset = 0) {
    // offset 0 = período actual, -1 = anterior, etc.
    const hoy = new Date();
    let anio = hoy.getFullYear();
    let mes  = hoy.getMonth(); // 0-based

    // El período actual: si hoy >= 21 → inicia este mes día 21
    //                    si hoy < 21  → inicia el mes anterior día 21
    let inicioMes = hoy.getDate() >= 21 ? mes : mes - 1;
    let inicioAnio = anio;
    if (inicioMes < 0) { inicioMes = 11; inicioAnio--; }

    inicioMes += offset;
    if (inicioMes < 0)  { inicioMes += 12; inicioAnio--; }
    if (inicioMes > 11) { inicioMes -= 12; inicioAnio++; }

    const finMes  = inicioMes + 1 > 11 ? 0  : inicioMes + 1;
    const finAnio = inicioMes + 1 > 11 ? inicioAnio + 1 : inicioAnio;

    const desde = `${inicioAnio}-${String(inicioMes+1).padStart(2,'0')}-21`;
    const hasta  = `${finAnio}-${String(finMes+1).padStart(2,'0')}-20`;
    const label  = `${new Date(desde+'T12:00').toLocaleDateString('es-CL',{month:'short',day:'numeric'})} → ${new Date(hasta+'T12:00').toLocaleDateString('es-CL',{month:'short',day:'numeric',year:'numeric'})}`;
    return { desde, hasta, label };
}

// Días de la estadía que caen DENTRO del período de facturación
function diasEnPeriodo(fechaIn, fechaOut, periodoDesde, periodoHasta) {
    const ini    = new Date((fechaIn||'').split('T')[0]+'T00:00:00');
    const fin    = fechaOut ? new Date(fechaOut.split('T')[0]+'T00:00:00') : new Date();
    const pIni   = new Date(periodoDesde+'T00:00:00');
    const pFin   = new Date(periodoHasta+'T00:00:00');
    const efIni  = ini > pIni ? ini : pIni;
    const efFin  = fin < pFin ? fin : pFin;
    return Math.max(0, Math.round((efFin - efIni) / 86400000));
}


export async function renderV2Historial(container) {
    const hoy   = new Date().toISOString().split('T')[0];
    const hace30 = new Date(); hace30.setDate(hace30.getDate()-30);
    const desde30 = hace30.toISOString().split('T')[0];

    // Períodos disponibles
    const periodos = [0,-1,-2,-3].map(o => periodoFacturacion(o));
    const p0 = periodos[0];

    container.innerHTML = `
    <div style="padding:20px;max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px">📋</div>
          <div>
            <h1 style="font-size:22px;font-weight:800;color:var(--text-primary);margin:0">Historial</h1>
            <p style="font-size:13px;color:var(--text-secondary);margin:0">Períodos de facturación 21→20 · días-cama reales por estadía</p>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <select id="hist-modo" style="padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;font-weight:600;outline:none">
            <option value="activos">🟢 Solo activos (sin checkout)</option>
            <option value="periodo" selected>📆 Período de facturación</option>
            <option value="rango">📅 Rango personalizado</option>
          </select>
          <!-- Selector período 21→20 -->
          <div id="hist-periodo-wrap" style="display:flex;gap:6px;align-items:center">
            <select id="hist-periodo-sel" style="padding:9px 14px;border-radius:10px;border:2px solid #6366f1;background:var(--bg-card);color:#6366f1;font-size:13px;font-weight:700;outline:none">
              ${periodos.map((p,i)=>`<option value="${p.desde}|${p.hasta}"${i===0?' selected':''}>${i===0?'🟡 Actual: ':i===1?'⬅️ Anterior: ':'📦 '}${p.label}</option>`).join('')}
            </select>
          </div>
          <!-- Rango personalizado -->
          <div id="hist-rango-wrap" style="display:none;gap:8px;align-items:center">
            <input type="date" id="hist-desde" value="${p0.desde}" style="padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;outline:none">
            <span style="color:var(--text-muted)">→</span>
            <input type="date" id="hist-hasta" value="${p0.hasta}" style="padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:13px;outline:none">
          </div>
          <button id="btn-hist-buscar" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer">🔍 Cargar</button>
          <button id="btn-hist-csv" style="background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer">📥 CSV</button>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:20px">
        ${tab('ocupacion','🛏️ Por Empresa','#6366f1',true)}
        ${tab('detalle','📅 Detalle por Persona','#f59e0b',false)}
        ${tab('facturacion','💰 Facturación','#10b981',false)}
      </div>

      <div id="hist-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px"></div>
      <div id="panel-ocupacion"></div>
      <div id="panel-detalle"     style="display:none"></div>
      <div id="panel-facturacion" style="display:none"></div>
    </div>`;

    document.getElementById('hist-modo').addEventListener('change', e => {
        const m = e.target.value;
        document.getElementById('hist-periodo-wrap').style.display = m==='periodo' ? 'flex' : 'none';
        document.getElementById('hist-rango-wrap').style.display   = m==='rango'   ? 'flex' : 'none';
    });
    ['ocupacion','detalle','facturacion'].forEach(t =>
        document.getElementById(`tab-hist-${t}`)?.addEventListener('click',()=>switchTab(t))
    );
    document.getElementById('btn-hist-buscar').addEventListener('click', cargar);
    document.getElementById('btn-hist-csv').addEventListener('click', exportCSV);

    await cargar();
}

function tab(id, label, color, active) {
    return `<button id="tab-hist-${id}" style="padding:10px 18px;border-radius:10px;border:1.5px solid ${active?color:'var(--border)'};background:${active?color:'var(--bg-card)'};color:${active?'#fff':'var(--text-primary)'};font-size:13px;font-weight:700;cursor:pointer">${label}</button>`;
}

function switchTab(name) {
    _activeTab = name;
    const cols = {ocupacion:'#6366f1',detalle:'#f59e0b',facturacion:'#10b981'};
    ['ocupacion','detalle','facturacion'].forEach(t=>{
        const b=document.getElementById(`tab-hist-${t}`), p=document.getElementById(`panel-${t}`), on=t===name;
        if(b){b.style.background=on?cols[t]:'var(--bg-card)';b.style.color=on?'#fff':'var(--text-primary)';b.style.borderColor=on?cols[t]:'var(--border)';}
        if(p)p.style.display=on?'block':'none';
    });
}

// Trae TODOS los registros paginando de 1000 en 1000
async function fetchAll(sb, filtros = {}) {
    const PAGE = 1000;
    let from = 0;
    let all  = [];

    while (true) {
        let q = sb.from('v2_asignaciones').select(`
            id, id_cama, rut_huesped, nombre_huesped,
            fecha_checkin, fecha_checkout, fecha_salida_programada,
            huesped_confirmo, empresa_id,
            v2_empresas(id, nombre, turno, v2_gerencias(nombre))
        `, { count: 'exact' })
        .order('fecha_checkin', { ascending: false })
        .range(from, from + PAGE - 1);

        if (filtros.sinCheckout) q = q.is('fecha_checkout', null);
        if (filtros.desde)       q = q.gte('fecha_checkin', filtros.desde);
        if (filtros.hasta)       q = q.lte('fecha_checkin', filtros.hasta + 'T23:59:59');

        const { data, error, count } = await q;
        if (error) throw error;
        all = all.concat(data || []);

        // Si trajimos menos de PAGE, ya llegamos al final
        if (!data || data.length < PAGE) break;
        from += PAGE;
    }
    return all;
}

async function cargar() {
    const sb   = await getSb();
    const modo = document.getElementById('hist-modo')?.value || 'periodo';
    const kEl  = document.getElementById('hist-kpis');
    kEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">⏳ Cargando todos los registros (puede tardar unos segundos)…</div>`;

    // Determinar rango del período activo
    let periodoDesde, periodoHasta, periodoLabel;
    if (modo === 'periodo') {
        const sel = document.getElementById('hist-periodo-sel')?.value || '';
        [periodoDesde, periodoHasta] = sel.split('|');
        const p = periodoFacturacion(0);
        periodoLabel = sel ? `${periodoDesde} → ${periodoHasta}` : p.label;
    } else if (modo === 'rango') {
        periodoDesde = document.getElementById('hist-desde')?.value;
        periodoHasta = document.getElementById('hist-hasta')?.value;
        periodoLabel = `${periodoDesde} → ${periodoHasta}`;
    } else {
        // activos: usar hoy como fin
        periodoDesde = null;
        periodoHasta = new Date().toISOString().split('T')[0];
        periodoLabel = 'Carga activa';
    }

    let data;
    try {
        const filtros = {};
        if (modo === 'activos') {
            filtros.sinCheckout = true;
        } else if (periodoDesde) {
            // Para período: traer quienes estuvieron activos EN ese período
            // (checkin <= periodoHasta Y (checkout >= periodoDesde OR sin checkout))
            filtros.desde = periodoDesde;
            filtros.hasta = periodoHasta;
        }
        data = await fetchAll(sb, filtros);
    } catch(e) {
        kEl.innerHTML = `<div style="color:#ef4444;padding:16px">❌ ${e.message}</div>`; return;
    }

    _lastData = data.filter(a => a.v2_empresas);

    // Calcular días totales y días dentro del período por estadía
    _lastData.forEach(a => {
        a._dias       = diasEstadia(a.fecha_checkin, a.fecha_checkout);
        a._diasPeriodo = (periodoDesde && periodoHasta)
            ? diasEnPeriodo(a.fecha_checkin, a.fecha_checkout, periodoDesde, periodoHasta)
            : a._dias;
    });

    // Excluir registros con 0 días en el período (estuvieron pero no solapan)
    const dataFiltrada = modo === 'activos'
        ? _lastData
        : _lastData.filter(a => a._diasPeriodo > 0);

    const totalEstadias     = dataFiltrada.length;
    const totalDiasPeriodo  = dataFiltrada.reduce((s,a)=>s+a._diasPeriodo,0);
    const confirmados       = dataFiltrada.filter(a=>a.huesped_confirmo).length;
    const sinCheckout       = dataFiltrada.filter(a=>!a.fecha_checkout).length;

    kEl.innerHTML = [
        kpiCard('🛏️', modo==='activos'?'Estadías activas':'Estadías en período', totalEstadias,    '#6366f1'),
        kpiCard('📅', 'Días-Cama período',   totalDiasPeriodo, '#4f46e5'),
        kpiCard('✅', 'Confirmados',          confirmados,      '#10b981'),
        kpiCard('🟢', 'Sin checkout',         sinCheckout,      '#f59e0b'),
    ].join('');

    // Agrupar por empresa
    const byEmp = {};
    for (const a of dataFiltrada) {
        const k = a.empresa_id || 'sin-empresa';
        if (!byEmp[k]) byEmp[k] = { emp: a.v2_empresas, items: [] };
        byEmp[k].items.push(a);
    }
    const empresas = Object.values(byEmp).sort((a,b) =>
        b.items.reduce((s,x)=>s+x._diasPeriodo,0) - a.items.reduce((s,x)=>s+x._diasPeriodo,0)
    );

    renderOcupacion(empresas, modo, periodoLabel);
    renderDetalle(dataFiltrada);
    renderFacturacion(empresas, periodoDesde, periodoHasta, periodoLabel);
}


function kpiCard(icon, label, value, color) {
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:16px;display:flex;align-items:center;gap:12px">
      <div style="width:40px;height:40px;border-radius:10px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px">${icon}</div>
      <div><div style="font-size:22px;font-weight:900;color:${color};line-height:1">${value.toLocaleString('es-CL')}</div>
      <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-top:2px">${label}</div></div>
    </div>`;
}

function renderOcupacion(empresas, modo, periodoLabel) {
    const el = document.getElementById('panel-ocupacion');
    const maxDias = Math.max(1, ...empresas.map(e=>e.items.reduce((s,a)=>s+a._diasPeriodo,0)));

    if (!empresas.length) { el.innerHTML=`<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin datos</div>`; return; }

    el.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:14px;font-weight:800;color:var(--text-primary)">🛏️ Ocupación real por empresa</span>
        <span style="background:#6366f122;color:#6366f1;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px">${periodoLabel}</span>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:650px">
          <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
            ${['Empresa','Gerencia','Turno','Camas','Días en Período','Promedio','% del total'].map(h=>
              `<th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`
            ).join('')}
          </tr></thead>
          <tbody>
          ${empresas.map((e,i)=>{
            const camas = e.items.length;
            const dias  = e.items.reduce((s,a)=>s+a._diasPeriodo,0);
            const prom  = camas ? (dias/camas).toFixed(1) : 0;
            const pct   = Math.round(dias/maxDias*100);
            const color = colorStr(e.emp.nombre);
            return `<tr style="border-bottom:1px solid var(--border);background:${i%2?'var(--bg)':'transparent'}">
              <td style="padding:12px 14px">
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="width:32px;height:32px;border-radius:8px;background:${color};color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${e.emp.nombre[0]}</div>
                  <div>
                    <div style="font-weight:700;font-size:13px;color:var(--text-primary)">${e.emp.nombre}</div>
                    <div style="height:5px;background:${color}33;border-radius:99px;margin-top:5px;width:120px">
                      <div style="height:100%;background:${color};border-radius:99px;width:${pct}%"></div>
                    </div>
                  </div>
                </div>
              </td>
              <td style="padding:12px 14px;font-size:12px;color:var(--text-secondary)">${e.emp.v2_gerencias?.nombre||'—'}</td>
              <td style="padding:12px 14px;font-size:12px;color:var(--text-secondary)">${e.emp.turno||'—'}</td>
              <td style="padding:12px 14px;font-size:15px;font-weight:800;color:${color}">${camas}</td>
              <td style="padding:12px 14px"><span style="background:${color}22;color:${color};font-size:13px;font-weight:800;padding:4px 12px;border-radius:8px">${dias.toLocaleString('es-CL')}</span></td>
              <td style="padding:12px 14px;font-size:13px;font-weight:600;color:var(--text-primary)">${prom} días</td>
              <td style="padding:12px 14px"><span style="background:${pct>=60?'#dcfce7':pct>=30?'#fef9c3':'#f1f5f9'};color:${pct>=60?'#15803d':pct>=30?'#854d0e':'#475569'};font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px">${pct}%</span></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderDetalle(data) {
    const el = document.getElementById('panel-detalle');
    // Agrupar por fecha de checkin (día)
    const byFecha = {};
    for (const a of data) {
        const f = (a.fecha_checkin||'').split('T')[0];
        if (!byFecha[f]) byFecha[f] = [];
        byFecha[f].push(a);
    }
    const fechas = Object.keys(byFecha).sort().reverse();
    if (!fechas.length) { el.innerHTML=`<div style="text-align:center;padding:40px;color:var(--text-muted)">Sin datos</div>`; return; }

    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
    ${fechas.map(f=>{
        const items = byFecha[f];
        const label = new Date(f+'T12:00:00').toLocaleDateString('es-CL',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
        const diasTotal = items.reduce((s,a)=>s+a._dias,0);
        return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden">
          <div style="padding:12px 16px;background:var(--bg);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:13px;font-weight:800;color:var(--text-primary);text-transform:capitalize">📅 ${label}</span>
            <div style="display:flex;gap:8px">
              <span style="background:#6366f122;color:#6366f1;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px">${items.length} personas</span>
              <span style="background:#10b98122;color:#10b981;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px">${diasTotal} días-cama</span>
            </div>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;min-width:550px">
              <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
                ${['Nombre','RUT','Empresa','Cama','Check-in','Salida prog.','Días ocup.','Estado'].map(h=>
                  `<th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`
                ).join('')}
              </tr></thead>
              <tbody>
              ${items.map((a,i)=>{
                const color  = colorStr(a.v2_empresas?.nombre||'');
                const estado = a.fecha_checkout ? '🚪 Checkout' : a.huesped_confirmo ? '✅ Activo' : '⏳ Sin confirmar';
                const eColor = a.fecha_checkout ? '#f59e0b' : a.huesped_confirmo ? '#10b981' : '#94a3b8';
                return `<tr style="border-bottom:${i<items.length-1?'1px solid var(--border)':'none'};background:${i%2?'var(--bg)':'transparent'}">
                  <td style="padding:9px 12px;font-weight:600;font-size:13px;color:var(--text-primary)">${a.nombre_huesped}</td>
                  <td style="padding:9px 12px;font-size:11px;font-family:monospace;color:var(--text-secondary)">${a.rut_huesped}</td>
                  <td style="padding:9px 12px"><span style="background:${color}22;color:${color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">${a.v2_empresas?.nombre||'—'}</span></td>
                  <td style="padding:9px 12px;font-size:11px;font-family:monospace;color:#6366f1;font-weight:700">${a.id_cama}</td>
                  <td style="padding:9px 12px;font-size:12px;color:var(--text-muted)">${(a.fecha_checkin||'').split('T')[0]}</td>
                  <td style="padding:9px 12px;font-size:12px;color:var(--text-muted)">${a.fecha_salida_programada||'—'}</td>
                  <td style="padding:9px 12px"><span style="background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:12px;font-weight:800;padding:3px 10px;border-radius:8px">${a._dias} días</span></td>
                  <td style="padding:9px 12px;font-size:12px;font-weight:700;color:${eColor}">${estado}</td>
                </tr>`;
              }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }).join('')}
    </div>`;
}

function renderFacturacion(empresas, periodoDesde, periodoHasta, periodoLabel) {
    const el = document.getElementById('panel-facturacion');
    const grandTotal = empresas.reduce((s,e)=>s+e.items.reduce((ss,a)=>ss+a._diasPeriodo,0),0);
    const diasPeriodo = (periodoDesde && periodoHasta)
        ? Math.round((new Date(periodoHasta+'T00:00:00') - new Date(periodoDesde+'T00:00:00'))/86400000)
        : 30;

    el.innerHTML = `
    <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:13px 18px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <span style="font-size:20px">📅</span>
      <div>
        <div style="font-weight:800;color:#1d4ed8;font-size:14px">Período de facturación: ${periodoLabel||'Actual'}</div>
        <div style="font-size:12px;color:#1e40af">${diasPeriodo} días · Días-Cama = días que cada persona estuvo dentro de este período</div>
      </div>
    </div>
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:14px">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border)">
        <span style="font-size:14px;font-weight:800;color:var(--text-primary)">💰 Días-Cama reales por empresa en el período</span>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:500px">
          <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
            ${['Empresa','Gerencia','Turno','Personas','Días-Cama en período','% del total'].map(h=>
              `<th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`
            ).join('')}
          </tr></thead>
          <tbody>
          ${empresas.map((e,i)=>{
            const personas = e.items.length;
            const dias     = e.items.reduce((s,a)=>s+a._diasPeriodo,0);
            const pct      = grandTotal ? Math.round(dias/grandTotal*100) : 0;
            const color    = colorStr(e.emp.nombre);
            return `<tr style="border-bottom:1px solid var(--border);background:${i%2?'var(--bg)':'transparent'}">
              <td style="padding:12px 14px">
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="width:28px;height:28px;border-radius:6px;background:${color};color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center">${e.emp.nombre[0]}</div>
                  <span style="font-weight:700;font-size:13px;color:var(--text-primary)">${e.emp.nombre}</span>
                </div>
              </td>
              <td style="padding:12px 14px;font-size:12px;color:var(--text-secondary)">${e.emp.v2_gerencias?.nombre||'—'}</td>
              <td style="padding:12px 14px;font-size:12px;color:var(--text-secondary)">${e.emp.turno||'—'}</td>
              <td style="padding:12px 14px;font-size:14px;font-weight:800;color:${color}">${personas}</td>
              <td style="padding:12px 14px"><span style="background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:14px;font-weight:900;padding:5px 14px;border-radius:8px">${dias.toLocaleString('es-CL')}</span></td>
              <td style="padding:12px 14px"><span style="background:${pct>=20?'#dcfce7':'#f8fafc'};color:${pct>=20?'#15803d':'#64748b'};font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px">${pct}%</span></td>
            </tr>`;
          }).join('')}
          <tr style="border-top:2px solid var(--border);background:var(--bg)">
            <td colspan="4" style="padding:12px 14px;font-weight:800;color:var(--text-primary)">TOTAL</td>
            <td style="padding:12px 14px"><span style="background:#6366f1;color:#fff;font-size:14px;font-weight:900;padding:5px 14px;border-radius:8px">${grandTotal.toLocaleString('es-CL')}</span></td>
            <td style="padding:12px 14px;font-weight:700;color:var(--text-primary)">100%</td>
          </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div style="background:#fffbeb;border:1.5px solid #fde047;border-radius:12px;padding:13px 18px;font-size:13px;color:#854d0e">
      💡 <strong>Días-Cama del período</strong>: si una persona entró antes del 21 y salíl despues del 20, solo se cuentan los días dentro del período.
      Ejemplo: ingreso 15 abr → salida 10 mayo, período 21 abr→20 may = <strong>20 días</strong> (solo del 21 abr al 10 mayo).
    </div>`;
}

async function exportCSV() {
    if (!_lastData.length) { alert('Carga datos primero.'); return; }
    const headers = ['Nombre','RUT','Empresa','Gerencia','Turno','Cama','Check-in','Salida Prog.','Checkout','Días Reales','Confirmado'];
    const rows = _lastData.map(a=>[
        a.nombre_huesped, a.rut_huesped,
        a.v2_empresas?.nombre||'', a.v2_empresas?.v2_gerencias?.nombre||'', a.v2_empresas?.turno||'',
        a.id_cama,
        (a.fecha_checkin||'').split('T')[0],
        a.fecha_salida_programada||'', a.fecha_checkout||'',
        a._dias, a.huesped_confirmo?'Sí':'No'
    ]);
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`historial_${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
}
