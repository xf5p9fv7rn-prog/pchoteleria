/**
 * v2-informe-ejecutivo.js — Informe Ejecutivo en Vivo
 * Dashboard premium con datos reales de Supabase.
 * Logo Aramark · Charts por empresa · Descarga PDF sin riesgos/recomendaciones.
 */
import { supabase } from '../../supabaseClient.js';

// ── Colores por empresa (lookup por nombre parcial) ──────────────────────────
const EMP_COLORS = [
    '#6366f1','#8b5cf6','#f59e0b','#10b981','#ef4444',
    '#0ea5e9','#f97316','#84cc16','#ec4899','#14b8a6',
    '#64748b','#a855f7','#06b6d4','#d97706','#4ade80',
];

function empColor(idx) { return EMP_COLORS[idx % EMP_COLORS.length]; }

// ── Chart.js loader (singleton) ───────────────────────────────────────────────
let _chartJsLoaded = false;
async function loadChartJs() {
    if (_chartJsLoaded || window.Chart) { _chartJsLoaded = true; return; }
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
        s.onload = () => { _chartJsLoaded = true; res(); };
        s.onerror = rej;
        document.head.appendChild(s);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchAll(table, select, filter) {
    let all = [], pg = 0;
    while (true) {
        let q = supabase.from(table).select(select).range(pg * 1000, pg * 1000 + 999);
        if (filter) q = filter(q);
        const { data, error } = await q;
        if (error || !data?.length) break;
        all = all.concat(data);
        if (data.length < 1000) break;
        pg++; if (pg > 20) break;
    }
    return all;
}

// ── Render principal ─────────────────────────────────────────────────────────
export async function renderV2InformeEjecutivo(container) {
    container.innerHTML = skeletonHTML();
    await loadChartJs();

    try {
        // ── Datos en vivo ────────────────────────────────────────────────────
        const [camasTodas, asigActivas, empresasDB, distDataRaw, habitacionesDB] = await Promise.all([
            fetchAll('v2_camas', 'id_cama, estado, numero_cama, habitacion_id'),
            fetchAll('v2_asignaciones', 'id_cama, empresa_id, fecha_checkin, fecha_salida_programada, huesped_confirmo',
                     q => q.is('fecha_checkout', null)),
            supabase.from('v2_empresas').select('id, nombre, turno').limit(200),
            supabase.from('v2_distribucion_camas').select('id_cama, tipo, etiqueta').limit(5000),
            supabase.from('v2_habitaciones').select('id, numero, estado, pabellon, sector').limit(2000),
        ]);

        // Excluir camas deshabilitadas del conteo real (igual que el Dashboard)
        const camas = camasTodas.filter(c =>
            c.estado !== 'Deshabilitada' && c.estado !== 'deshabilitada');

        const empMap = {};
        (empresasDB.data || []).forEach(e => { empMap[e.id] = e; });

        // ── KPIs globales ────────────────────────────────────────────────────
        // Capacidad física desde v2_camas
        const totalCamas  = camas.length;
        const mantencion  = camas.filter(c => c.estado === 'Mantencion' || c.estado === 'Mantención').length;

        // Ocupados = asignaciones activas (igual que Control de Asistencia → fuente real)
        const ocupadas    = asigActivas.length;
        const disponibles = Math.max(0, totalCamas - ocupadas - mantencion);
        const pctOcup     = totalCamas > 0 ? Math.round(ocupadas / totalCamas * 100) : 0;

        // ── Habitaciones en Mantención / Reparación ─────────────────────────────
        const habsDB = habitacionesDB.data || [];
        const isMantEstado = e => /manten|reparac/i.test(e || '');
        const habsTotal   = habsDB.length;
        const habsMant    = habsDB.filter(h => isMantEstado(h.estado));
        const habsMantN   = habsMant.length;
        const pctHabsMant = habsTotal > 0 ? Math.round(habsMantN / habsTotal * 100) : 0;

        // Por tipo
        const habsMantSolo  = habsMant.filter(h => /manten/i.test(h.estado)).length;
        const habsReparacion = habsMant.filter(h => /reparac/i.test(h.estado)).length;

        // Por sector (COPC vs REF-220 via numero o sector field)
        const isR220hab = h => /^R[.-]?220/i.test(String(h.numero || h.sector || ''));
        const habsMantCOPC = habsMant.filter(h => !isR220hab(h)).length;
        const habsMantR220 = habsMant.filter(h =>  isR220hab(h)).length;

        // Lista para mostrar en card (max 20, ordenadas por pabón)
        const habsMantList = habsMant
            .sort((a, b) => String(a.pabellon || a.numero || '').localeCompare(String(b.pabellon || b.numero || '')))
            .slice(0, 20);

        const isR220id    = id => /^R[.-]?220/i.test(String(id || ''));
        const asigCamaSet = new Set(asigActivas.map(a => String(a.id_cama)));

        // ── Desglose COPC vs REF-220 ─────────────────────────────────────────
        const camasCOPCarr = camas.filter(c => !isR220id(c.id_cama));
        const camasR220arr = camas.filter(c =>  isR220id(c.id_cama));
        const camasCopc    = camasCOPCarr.length;
        const camasR220    = camasR220arr.length;

        const esDispFn = c => c.estado !== 'Ocupada'
            && c.estado !== 'Mantencion' && c.estado !== 'Mantención'
            && !asigCamaSet.has(String(c.id_cama));

        const ocupCOPC  = camasCOPCarr.filter(c => asigCamaSet.has(String(c.id_cama))).length;
        const ocupR220  = camasR220arr.filter(c => asigCamaSet.has(String(c.id_cama))).length;
        const dispCOPC  = camasCOPCarr.filter(esDispFn).length;
        const dispR220  = camasR220arr.filter(esDispFn).length;
        const pctCOPC   = camasCopc > 0 ? Math.round(ocupCOPC / camasCopc * 100) : 0;
        const pctR220   = camasR220 > 0 ? Math.round(ocupR220 / camasR220 * 100) : 0;

        // ── Anglo / Noche / Colaboradores splits ───────────
        const distCamas      = distDataRaw.data || [];
        const angloSetIE     = new Set(distCamas.filter(d => d.tipo === 'anglo').map(d => String(d.id_cama)));
        const nocheSetIE     = new Set(distCamas.filter(d => d.tipo === 'noche').map(d => String(d.id_cama)));
        const colaborSetIE   = new Set(distCamas.filter(d => d.tipo === 'colaborador').map(d => String(d.id_cama)));

        const angloDiaSetIE   = new Set(
            camasTodas.filter(c => angloSetIE.has(String(c.id_cama)) && Number(c.numero_cama) === 1)
                       .map(c => String(c.id_cama))
        );
        const angloNocheSetIE = new Set(
            camasTodas.filter(c => angloSetIE.has(String(c.id_cama)) && Number(c.numero_cama) === 2)
                       .map(c => String(c.id_cama))
        );

        const angloTotalDia   = angloDiaSetIE.size;
        const angloTotalNoche = angloNocheSetIE.size;
        const angloOcupDia    = [...angloDiaSetIE].filter(id => asigCamaSet.has(id)).length;
        const angloOcupNoche  = [...angloNocheSetIE].filter(id => asigCamaSet.has(id)).length;
        const angloDispDia    = angloTotalDia  - angloOcupDia;
        const angloDispNoche  = angloTotalNoche - angloOcupNoche;

        // Noche regular EECC (tipo='noche', excluyendo Anglo)
        const nocheRegSetIE  = new Set([...nocheSetIE].filter(id => !angloSetIE.has(id)));
        const nocheTotalReg  = nocheRegSetIE.size;
        const nocheOcupReg   = [...nocheRegSetIE].filter(id => asigCamaSet.has(id)).length;
        const nocheDispReg   = nocheTotalReg - nocheOcupReg;

        // Colaboradores (tipo='colaborador', ej: Pabellón 7) — ambas camas cuentan como noche
        const colabTotal = colaborSetIE.size;
        const colabOcup  = [...colaborSetIE].filter(id => asigCamaSet.has(id)).length;
        const colabDisp  = colabTotal - colabOcup;

        // ── Camas Perdidas — Lógica por habitación ─────────────────────────────────
        // Regla: si una habitación tiene al menos 1 asignado,
        //   perdidas = total_camas_hab - confirmados_en_hab
        //   (camas libres + asignados sin confirmar = "camas perdidas")
        // Anglo rooms → cuentan como Anglo perdidas
        // Otras rooms → cuentan por empresa
        const camasByHab = {};
        camasTodas.forEach(c => {
            if (c.estado === 'Deshabilitada' || c.estado === 'deshabilitada') return;
            if (!c.habitacion_id) return;
            if (!camasByHab[c.habitacion_id]) camasByHab[c.habitacion_id] = [];
            camasByHab[c.habitacion_id].push(c);
        });
        const camaIdToHab = {};
        camasTodas.forEach(c => { if (c.habitacion_id) camaIdToHab[String(c.id_cama)] = c.habitacion_id; });

        // Asignaciones agrupadas por habitación
        const asigsByHab = {};
        asigActivas.forEach(a => {
            const hab = camaIdToHab[String(a.id_cama)];
            if (!hab) return;
            if (!asigsByHab[hab]) asigsByHab[hab] = [];
            asigsByHab[hab].push(a);
        });

        // Calcular perdidas por habitación
        let camasAngloPerd    = 0;
        let angloTotalHabCap  = 0; // capacidad de hab Anglo con al menos 1 asig
        let angloNoConfirm    = 0; // asig Anglo sin confirmar llegada
        let angloLibres       = 0; // camas Anglo sin asignar en hab con asig
        const empPerdObj      = {}; // empresa nombre → { perdidas, total }

        Object.entries(asigsByHab).forEach(([habId, asigs]) => {
            const camasRoom   = camasByHab[habId] || [];
            const totalBeds   = camasRoom.length;
            if (!totalBeds) return;

            const confirmed   = asigs.filter(a => a.huesped_confirmo).length;
            const perdidas    = totalBeds - confirmed;   // libre + sin confirmar
            const noConfirm   = asigs.filter(a => !a.huesped_confirmo).length;
            const libres      = totalBeds - asigs.length; // no asignadas del todo

            // ¿Habitación Anglo?
            const camaIds  = camasRoom.map(c => String(c.id_cama));
            const isAnglo  = camaIds.some(cid => angloSetIE.has(cid));

            if (isAnglo) {
                camasAngloPerd   += Math.max(0, perdidas);
                angloTotalHabCap += totalBeds;
                angloNoConfirm   += noConfirm;
                angloLibres      += Math.max(0, libres);
            } else {
                if (perdidas <= 0) return;
                const empIds  = [...new Set(asigs.map(a => a.empresa_id).filter(Boolean))];
                const empName = empIds.length === 1
                    ? (empMap[empIds[0]]?.nombre || 'Sin empresa')
                    : empIds.length > 1 ? 'Varias empresas' : 'Sin empresa';
                if (!empPerdObj[empName]) empPerdObj[empName] = { perdidas: 0, total: 0 };
                empPerdObj[empName].perdidas += perdidas;
                empPerdObj[empName].total    += totalBeds;
            }
        });

        const pctAngloPerd  = angloTotalHabCap > 0
            ? Math.round(camasAngloPerd / angloTotalHabCap * 100) : 0;
        const perdEmpRows   = Object.entries(empPerdObj)
            .map(([emp, v]) => ({ emp, perdidas: v.perdidas, total: v.total,
                                  pct: v.total > 0 ? Math.round(v.perdidas / v.total * 100) : 0 }))
            .filter(r => r.perdidas > 0)
            .sort((a, b) => b.perdidas - a.perdidas);
        const totalEmpPerdidas = perdEmpRows.reduce((s, r) => s + r.perdidas, 0);


        const camaToSector = {};
        camas.forEach(c => { camaToSector[String(c.id_cama)] = isR220id(c.id_cama) ? 'r220' : 'copc'; });

        // ── Llegadas/Salidas ─────────────────────────────────────────
        const hoy          = new Date().toLocaleDateString('en-CA');
        const llegadasHoy  = asigActivas.filter(a => (a.fecha_checkin || '').slice(0, 10) === hoy).length;
        const llegadasCOPC = asigActivas.filter(a => (a.fecha_checkin || '').slice(0, 10) === hoy && camaToSector[String(a.id_cama)] !== 'r220').length;
        const llegadasR220 = asigActivas.filter(a => (a.fecha_checkin || '').slice(0, 10) === hoy && camaToSector[String(a.id_cama)] === 'r220').length;

        const en7d     = new Date(); en7d.setDate(en7d.getDate() + 7);
        const en7dStr  = en7d.toLocaleDateString('en-CA');
        const enRng    = a => a.fecha_salida_programada && a.fecha_salida_programada.slice(0,10) >= hoy && a.fecha_salida_programada.slice(0,10) <= en7dStr;
        const salidasProximas = asigActivas.filter(enRng).length;
        const salidasCOPC     = asigActivas.filter(a => enRng(a) && camaToSector[String(a.id_cama)] !== 'r220').length;
        const salidasR220     = asigActivas.filter(a => enRng(a) && camaToSector[String(a.id_cama)] === 'r220').length;

        // ── Por empresa ──────────────────────────────────────────────
        const porEmpresa = {};
        for (const a of asigActivas) {
            const eid = String(a.empresa_id || 'sin-empresa');
            if (!porEmpresa[eid]) porEmpresa[eid] = { count: 0, emp: empMap[a.empresa_id] };
            porEmpresa[eid].count++;
        }
        const empRows = Object.entries(porEmpresa)
            .map(([eid, v]) => ({
                id: eid,
                nombre: v.emp?.nombre || 'Sin empresa',
                turno:  v.emp?.turno  || '—',
                count:  v.count,
            }))
            .filter(e => e.nombre !== 'Sin empresa' && e.nombre !== 'sin empresa')
            .sort((a, b) => b.count - a.count);

        const totalEmpresas = new Set(asigActivas.map(a => a.empresa_id).filter(Boolean)).size;

        // ── Contratistas (camas que NO son Anglo, noche ni colaborador) ───────
        const angloOcupTotal  = angloOcupDia + angloOcupNoche;
        const angloDispTotal  = angloDispDia + angloDispNoche;
        const angloTotal      = angloTotalDia + angloTotalNoche;

        // Camas contratistas = total - anglo - noche_eecc - colaboradores
        const contratTotalCamas = totalCamas - angloTotal - nocheTotalReg - colabTotal;
        const contratOcup       = ocupadas   - angloOcupTotal - nocheOcupReg - colabOcup;
        const contratDisp       = Math.max(0, contratTotalCamas - contratOcup);

        // Ocupadas por sector y tipo (para Llegadas/Salidas son aproximaciones)
        const angloLlegHoy  = asigActivas.filter(a => (a.fecha_checkin||'').slice(0,10)===hoy && angloSetIE.has(String(a.id_cama))).length;
        const contratLlegHoy = llegadasHoy - angloLlegHoy;  // resto

        const angloSal7d    = asigActivas.filter(a => enRng(a) && angloSetIE.has(String(a.id_cama))).length;
        const contratSal7d  = salidasProximas - angloSal7d;

        // ── Helper: fila de desglose estándar ──────────────────────────────────
        const desgRow = (icon, label, val, color, borderBottom = true) =>
            `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;${
                borderBottom?'border-bottom:1px solid #f1f5f9':''}">` +
            `<span style="font-size:12px;font-weight:700;color:#334155">${icon} ${label}</span>` +
            `<span style="font-size:16px;font-weight:900;color:${color}">${typeof val==='number'?val.toLocaleString('es-CL'):val}</span>` +
            `</div>`;

        const desgSep = (label) =>
            `<div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px">${label}</div>`;

        const desgTotal = (label, val, color) =>
            `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#f8fafc;border-radius:8px;margin-top:8px">` +
            `<span style="font-size:12px;font-weight:800;color:#1e293b">= ${label}</span>` +
            `<span style="font-size:17px;font-weight:900;color:${color}">${typeof val==='number'?val.toLocaleString('es-CL'):val}</span>` +
            `</div>`;

        // ── Render ───────────────────────────────────────────────────────────
        container.innerHTML = `
        <div id="informe-root" style="padding:0;min-height:100vh;background:var(--bg)">

          <div style="background:linear-gradient(135deg,#1e1b4b,#312e81,#4f46e5);
               padding:20px 28px;display:flex;align-items:center;justify-content:space-between;
               flex-wrap:wrap;gap:16px;position:sticky;top:0;z-index:100;
               box-shadow:0 4px 24px rgba(30,27,75,.4)">
            <div style="display:flex;align-items:center;gap:16px">
              <img src="aramark.png" alt="Aramark" style="height:48px;object-fit:contain;filter:brightness(0) invert(1);opacity:.9" onerror="this.style.display='none'">
              <div>
                <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-.02em">Informe Ejecutivo</div>
                <div style="font-size:12px;color:#a5b4fc;margin-top:2px" id="inf-subtitle">PC HOTELERÍA · Cargando...</div>
              </div>
            </div>
            <div style="display:flex;gap:10px;align-items:center">
              <button onclick="window.navigate('v2informeejecutivo')" style="${btnStyle('#4f46e5','#818cf8')}">🔄 Actualizar</button>
              <button id="btn-pdf-normal"    style="${btnStyle('#059669','#34d399')}">📄 Normal</button>
              <button id="btn-pdf-detallado" style="${btnStyle('#0891b2','#38bdf8')}">📋 Detallado</button>
            </div>
          </div>

          <div id="informe-body" style="padding:24px 28px;max-width:1400px;margin:0 auto">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:24px">

              ${kpiCard('🛏️','Total Camas',totalCamas.toLocaleString('es-CL'),'#6366f1',
                desgSep('Por tipo de cama') +
                desgRow('🤝','Anglo (día + noche)', angloTotal,'#d97706') +
                desgRow('🏢','Contratistas', contratTotalCamas,'#6366f1') +
                desgRow('🌙','Noche EECC', nocheTotalReg,'#4338ca') +
                (colabTotal>0 ? desgRow('👥','Colaboradores (Pab.7)', colabTotal,'#0891b2') : '') +
                desgSep('Por sector') +
                desgRow('🏢','COPC', camasCopc,'#6366f1') +
                desgRow('🏗️','REF 220', camasR220,'#0ea5e9',false) +
                desgTotal('TOTAL',totalCamas,'#6366f1')
              )}

              ${kpiCard('🔴','Ocupadas',ocupadas.toLocaleString('es-CL'),'#ef4444',
                desgSep('Por tipo de cama') +
                desgRow('🤝','Anglo ocup.', angloOcupTotal,'#d97706') +
                desgRow('  ↳☀️','Día ocup.', angloOcupDia,'#d97706') +
                desgRow('  ↳🌙','Noche ocup.', angloOcupNoche,'#4338ca') +
                desgRow('🏢','Contratistas ocup.', contratOcup,'#6366f1') +
                (nocheOcupReg>0 ? desgRow('🌙','Noche EECC ocup.', nocheOcupReg,'#4338ca') : '') +
                (colabOcup>0 ? desgRow('👥','Colaboradores ocup.', colabOcup,'#0891b2') : '') +
                desgSep('Por sector') +
                desgRow('🏢','COPC', ocupCOPC,'#ef4444') +
                desgRow('🏗️','REF 220', ocupR220,'#f97316',false) +
                desgTotal('TOTAL OCUPADAS',ocupadas,'#ef4444')
              )}

              ${kpiCard('✅','Disponibles',disponibles.toLocaleString('es-CL'),'#10b981',
                desgSep('Por tipo de cama') +
                desgRow('🤝','Anglo disp.', angloDispTotal,'#d97706') +
                desgRow('  ↳☀️','Día libres', angloDispDia,'#d97706') +
                desgRow('  ↳🌙','Noche libres', angloDispNoche,'#4338ca') +
                desgRow('🏢','Contratistas disp.', contratDisp,'#6366f1') +
                (nocheDispReg>0 ? desgRow('🌙','Noche EECC libres', nocheDispReg,'#4338ca') : '') +
                (colabDisp>0 ? desgRow('👥','Colaboradores libres', colabDisp,'#0891b2') : '') +
                desgSep('Por sector') +
                desgRow('🏢','COPC', dispCOPC,'#10b981') +
                desgRow('🏗️','REF 220', dispR220,'#0ea5e9',false) +
                desgTotal('TOTAL DISPONIBLES',disponibles,'#10b981')
              )}

              ${kpiCard('📊','Ocupación',pctOcup+'%', pctOcup>80?'#ef4444':pctOcup>50?'#f59e0b':'#10b981',
                desgSep('Por tipo') +
                desgRow('🤝','Anglo', `${angloTotal>0?Math.round(angloOcupTotal/angloTotal*100):0}%`,'#d97706') +
                desgRow('🏢','Contratistas', `${contratTotalCamas>0?Math.round(contratOcup/contratTotalCamas*100):0}%`,'#6366f1') +
                desgSep('Por sector') +
                desgRow('🏢','COPC', `${pctCOPC}%`, pctCOPC>80?'#ef4444':pctCOPC>50?'#f59e0b':'#10b981') +
                desgRow('🏗️','REF 220', `${pctR220}%`, pctR220>80?'#ef4444':pctR220>50?'#f59e0b':'#10b981',false) +
                desgTotal('GLOBAL',`${pctOcup}%`, pctOcup>80?'#ef4444':pctOcup>50?'#f59e0b':'#10b981')
              )}

              ${kpiCard('🏢','Empresas Activas',totalEmpresas,'#8b5cf6',
                desgSep('Trabajadores por tipo') +
                desgRow('🤝','Anglo (ocup.)', angloOcupTotal,'#d97706') +
                desgRow('🏢','Contratistas (ocup.)', contratOcup,'#6366f1') +
                (nocheOcupReg>0 ? desgRow('🌙','Noche EECC', nocheOcupReg,'#4338ca') : '') +
                (colabOcup>0 ? desgRow('👥','Colaboradores', colabOcup,'#0891b2') : '') +
                desgSep('Por sector') +
                desgRow('🏢','COPC', ocupCOPC,'#6366f1') +
                desgRow('🏗️','REF 220', ocupR220,'#0ea5e9',false) +
                desgTotal('TOTAL ACTIVOS',ocupadas,'#8b5cf6')
              )}

              ${kpiCard('🚀','Llegadas Hoy',llegadasHoy,'#0ea5e9',
                desgSep('Por tipo') +
                desgRow('🤝','Anglo', angloLlegHoy,'#d97706') +
                desgRow('🏢','Contratistas', contratLlegHoy,'#6366f1',false) +
                desgSep('Por sector') +
                desgRow('🏢','COPC', llegadasCOPC,'#0ea5e9') +
                desgRow('🏗️','REF 220', llegadasR220,'#6366f1',false) +
                desgTotal('LLEGADAS HOY',llegadasHoy,'#0ea5e9')
              )}

              ${kpiCard('🚪','Salidas 7 días',salidasProximas,'#f97316',
                desgSep('Por tipo') +
                desgRow('🤝','Anglo', angloSal7d,'#d97706') +
                desgRow('🏢','Contratistas', contratSal7d,'#6366f1',false) +
                desgSep('Por sector') +
                desgRow('🏢','COPC', salidasCOPC,'#f97316') +
                desgRow('🏗️','REF 220', salidasR220,'#ef4444',false) +
                desgTotal('SALIDAS PRÓX. 7d',salidasProximas,'#f97316')
              )}

              ${mantencion>0?kpiCard('🟡','En Mantención',mantencion,'#f59e0b',
                desgSep('Camas en mantención') +
                desgRow('🏢','COPC', camas.filter(c=>c.estado==='Mantencion'&&!isR220id(c.id_cama)).length,'#6366f1') +
                desgRow('🏗️','REF 220', camas.filter(c=>c.estado==='Mantencion'&&isR220id(c.id_cama)).length,'#0ea5e9',false) +
                desgTotal('TOTAL MANT.',mantencion,'#f59e0b')
              ):''}
            </div>

            <!-- Barra ocupación global -->
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:20px;
                 padding:20px 24px;margin-bottom:24px;box-shadow:0 2px 12px rgba(99,102,241,.08)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <span style="font-size:15px;font-weight:800;color:var(--text-primary)">📈 Ocupación Global del Campamento</span>
                <span style="font-size:28px;font-weight:900;color:${pctOcup>80?'#ef4444':pctOcup>50?'#f59e0b':'#10b981'}">${pctOcup}%</span>
              </div>
              <div style="height:14px;background:var(--border);border-radius:7px;overflow:hidden">
                <div style="height:100%;width:${pctOcup}%;border-radius:7px;transition:width 1s;
                     background:linear-gradient(90deg,${pctOcup>80?'#ef4444,#f87171':pctOcup>50?'#f59e0b,#fbbf24':'#4f46e5,#8b5cf6'})"></div>
              </div>
              <div style="display:flex;gap:20px;margin-top:10px;font-size:12px;color:var(--text-muted)">
                <span>🔴 ${ocupadas.toLocaleString('es-CL')} ocupadas</span>
                <span>🟢 ${disponibles.toLocaleString('es-CL')} disponibles</span>
                <span>🛏️ ${totalCamas.toLocaleString('es-CL')} total</span>
                ${mantencion>0?`<span>🟡 ${mantencion} mantención</span>`:''}
              </div>
            </div>

            <!-- Charts: carrusel deslizable -->
            <div id="chart-scroll-row" style="display:flex;gap:16px;overflow-x:auto;padding-bottom:12px;
                 margin-bottom:24px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;
                 scrollbar-width:thin;scrollbar-color:#6366f1 transparent">

              <!-- 1. Estado de Camas -->
              <div style="${chartCard()} min-width:280px;flex-shrink:0;scroll-snap-align:start">
                <div style="${chartTitle()}">🥧 Estado de Camas</div>
                <div style="position:relative;height:200px">
                  <canvas id="inf-chart-donut"></canvas>
                </div>
              </div>

              <!-- 2. Camas por Empresa -->
              <div style="${chartCard()} min-width:320px;flex-shrink:0;scroll-snap-align:start">
                <div style="${chartTitle()}">🏢 Por Empresa</div>
                <div style="position:relative;height:200px">
                  <canvas id="inf-chart-empresas"></canvas>
                </div>
              </div>

              <!-- 3. Solicitudes vs Confirmados -->
              <div style="${chartCard()} min-width:280px;flex-shrink:0;scroll-snap-align:start">
                <div style="${chartTitle()}">✅🔴 Solicitudes vs Confirmados</div>
                <div style="position:relative;height:200px">
                  <canvas id="inf-chart-confirmados"></canvas>
                </div>
              </div>

              <!-- 4. Participación % -->
              <div style="${chartCard()} min-width:280px;flex-shrink:0;scroll-snap-align:start">
                <div style="${chartTitle()}">📊 Participación %</div>
                <div style="position:relative;height:200px">
                  <canvas id="inf-chart-participacion"></canvas>
                </div>
              </div>

              <!-- 5. Camas Perdidas Anglo -->
              <div style="${chartCard()} min-width:290px;flex-shrink:0;scroll-snap-align:start">
                <div style="${chartTitle()}">🤝 Camas Perdidas — Anglo</div>
                <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
                  <!-- Cabecera grande -->
                  <div style="display:flex;align-items:center;justify-content:space-between;background:#fffbeb;
                       border-radius:12px;padding:14px 16px;border:1.5px solid #d97706">
                    <div>
                      <div style="font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:.05em">Total perdidas</div>
                      <div style="font-size:34px;font-weight:900;color:#d97706;line-height:1">${camasAngloPerd}</div>
                      <div style="font-size:10px;color:#94a3b8;margin-top:2px">en ${angloTotalHabCap} camas de hab. Anglo</div>
                    </div>
                    <div style="text-align:right">
                      <div style="font-size:28px;font-weight:900;color:${pctAngloPerd>50?'#ef4444':'#f59e0b'}">${pctAngloPerd}%</div>
                      <div style="font-size:10px;color:#94a3b8">cap. hab. Anglo</div>
                    </div>
                  </div>
                  <!-- Desglose: sin confirmar vs libres -->
                  <div style="display:flex;gap:8px">
                    <div style="flex:1;background:#fff0f0;border-radius:10px;padding:10px;text-align:center;border:1px solid #fca5a5">
                      <div style="font-size:10px;color:#ef4444;font-weight:700;text-transform:uppercase">🔴 Sin confirmar</div>
                      <div style="font-size:22px;font-weight:900;color:#ef4444">${angloNoConfirm}</div>
                      <div style="font-size:10px;color:#94a3b8">asig. no confirmadas</div>
                    </div>
                    <div style="flex:1;background:#f0fdf4;border-radius:10px;padding:10px;text-align:center;border:1px solid #86efac">
                      <div style="font-size:10px;color:#10b981;font-weight:700;text-transform:uppercase">⬜ Libres</div>
                      <div style="font-size:22px;font-weight:900;color:#059669">${angloLibres}</div>
                      <div style="font-size:10px;color:#94a3b8">camas sin asignar</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 6. Camas Perdidas por Empresa -->
              <div style="${chartCard()} min-width:320px;flex-shrink:0;scroll-snap-align:start">
                <div style="${chartTitle()}">🏢 Camas Perdidas — Empresas</div>
                ${perdEmpRows.length === 0 ? `
                  <div style="text-align:center;padding:40px;color:#10b981;font-weight:700">
                    ✅ Sin camas perdidas por empresa
                  </div>` : `
                  <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">
                    Total: <strong style="color:#ef4444">${totalEmpPerdidas}</strong> camas sin usar en pabellones asignados
                  </div>
                  <div style="overflow-y:auto;max-height:200px;display:flex;flex-direction:column;gap:5px">
                    ${perdEmpRows.map((r,i) => `
                    <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;
                         background:${i%2===0?'var(--bg)':'transparent'};border-radius:8px">
                      <div style="flex:1;font-size:12px;font-weight:700">${r.emp}</div>
                      <div style="font-size:14px;font-weight:900;color:#ef4444;min-width:28px;text-align:right">${r.perdidas}</div>
                      <div style="font-size:11px;color:#94a3b8;min-width:38px;text-align:right">${r.pct}%</div>
                      <div style="width:60px">
                        <div style="height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden">
                          <div style="height:100%;width:${Math.min(r.pct,100)}%;background:#ef4444;border-radius:3px"></div>
                        </div>
                      </div>
                    </div>`).join('')}
                  </div>`}
              </div>

              <!-- 7. Habitaciones en Mantención / Reparación -->
              <div style="${chartCard()} min-width:300px;flex-shrink:0;scroll-snap-align:start">
                <div style="${chartTitle()}">🛠️ Mantención y Reparación</div>
                <div style="display:flex;flex-direction:column;gap:10px">

                  <!-- Cabecera con ánillo visual -->
                  <div style="display:flex;align-items:center;gap:16px;background:#fef3c7;
                       border-radius:12px;padding:14px 16px;border:1.5px solid #f59e0b">
                    <!-- Ring SVG -->
                    <div style="position:relative;width:68px;height:68px;flex-shrink:0">
                      <svg viewBox="0 0 36 36" style="width:68px;height:68px;transform:rotate(-90deg)">
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" stroke-width="3"/>
                        <circle cx="18" cy="18" r="15.9" fill="none"
                          stroke="${pctHabsMant>20?'#ef4444':pctHabsMant>10?'#f59e0b':'#f59e0b'}"
                          stroke-width="3"
                          stroke-dasharray="${(pctHabsMant/100*100).toFixed(1)} 100"
                          stroke-linecap="round"/>
                      </svg>
                      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                           font-size:13px;font-weight:900;color:#d97706">${pctHabsMant}%</div>
                    </div>
                    <div>
                      <div style="font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:.05em">Habitaciones</div>
                      <div style="font-size:36px;font-weight:900;color:#d97706;line-height:1">${habsMantN}</div>
                      <div style="font-size:10px;color:#94a3b8">de ${habsTotal} totales</div>
                    </div>
                  </div>

                  <!-- Por tipo y sector -->
                  <div style="display:flex;gap:6px">
                    ${habsMantSolo>0?`
                    <div style="flex:1;background:#fffbeb;border-radius:8px;padding:8px;text-align:center;border:1px solid #fde68a">
                      <div style="font-size:9px;color:#d97706;font-weight:700;text-transform:uppercase">🛠️ Mant.</div>
                      <div style="font-size:20px;font-weight:900;color:#d97706">${habsMantSolo}</div>
                    </div>`:''}
                    ${habsReparacion>0?`
                    <div style="flex:1;background:#fff0f0;border-radius:8px;padding:8px;text-align:center;border:1px solid #fca5a5">
                      <div style="font-size:9px;color:#ef4444;font-weight:700;text-transform:uppercase">🔧 Reparac.</div>
                      <div style="font-size:20px;font-weight:900;color:#ef4444">${habsReparacion}</div>
                    </div>`:''}
                    ${habsMantCOPC>0?`
                    <div style="flex:1;background:#eef2ff;border-radius:8px;padding:8px;text-align:center;border:1px solid #a5b4fc">
                      <div style="font-size:9px;color:#6366f1;font-weight:700;text-transform:uppercase">🏢 COPC</div>
                      <div style="font-size:20px;font-weight:900;color:#6366f1">${habsMantCOPC}</div>
                    </div>`:''}
                    ${habsMantR220>0?`
                    <div style="flex:1;background:#e0f2fe;border-radius:8px;padding:8px;text-align:center;border:1px solid #7dd3fc">
                      <div style="font-size:9px;color:#0ea5e9;font-weight:700;text-transform:uppercase">🏗️ R220</div>
                      <div style="font-size:20px;font-weight:900;color:#0ea5e9">${habsMantR220}</div>
                    </div>`:''}
                  </div>

                  <!-- Lista de habitaciones -->
                  ${habsMantList.length>0?`
                  <div style="overflow-y:auto;max-height:130px;display:flex;flex-direction:column;gap:3px">
                    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:2px">Detalle habitaciones</div>
                    ${habsMantList.map((h,i)=>{
                      const color = /reparac/i.test(h.estado)?'#ef4444':'#f59e0b';
                      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;
                               background:${i%2===0?'var(--bg)':'transparent'};border-radius:6px">
                        <div style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></div>
                        <div style="flex:1;font-size:11px;font-weight:700">Hab. ${h.numero || h.id}</div>
                        ${h.pabellon?`<div style="font-size:10px;color:#94a3b8">${h.pabellon}</div>`:''}
                        <div style="font-size:10px;font-weight:700;color:${color}">${h.estado || ''}</div>
                      </div>`;
                    }).join('')}
                  </div>`:''}

                </div>
              </div>

            </div>

            <!-- Tabla por empresa: DESPLEGABLE -->
            <div style="${chartCard()} overflow:hidden;margin-bottom:0">
              <div onclick="(function(btn,body){
                    const open = body.style.display !== 'none';
                    body.style.display = open ? 'none' : 'block';
                    btn.querySelector('.tbl-arrow').textContent = open ? '▶' : '▼';
                  })(this, this.nextElementSibling)"
                   style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;
                          padding-bottom:${false?'16px':'0'}">
                <span style="font-size:14px;font-weight:800;color:var(--text-primary)">🏢 Detalle por Empresa Contratista — Datos en Vivo</span>
                <span style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);font-weight:600">
                  ${empRows.length} empresas
                  <span class="tbl-arrow" style="font-size:14px;color:#6366f1;transition:transform .2s">▶</span>
                </span>
              </div>
              <div style="display:none;margin-top:16px">
                <div style="overflow-x:auto">
                  <table style="width:100%;border-collapse:collapse;min-width:500px">
                    <thead>
                      <tr style="background:linear-gradient(135deg,#1e1b4b,#312e81)">
                        ${['#','Empresa','Camas Activas','% del Total','Participación'].map(h=>
                          `<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;
                            color:#a5b4fc;text-transform:uppercase;letter-spacing:.05em">${h}</th>`
                        ).join('')}
                      </tr>
                    </thead>
                    <tbody>
                      ${empRows.map((e, i) => {
                          const pct = totalCamas > 0 ? (e.count / totalCamas * 100).toFixed(1) : '0.0';
                          const color = empColor(i);
                          return `<tr style="border-bottom:1px solid var(--border);${i%2===1?'background:var(--bg)':''}">
                            <td style="padding:10px 14px;font-weight:800;color:${color}">${i+1}</td>
                            <td style="padding:10px 14px;font-weight:700;font-size:13px">${e.nombre}</td>
                            <td style="padding:10px 14px;font-size:17px;font-weight:900;color:${color}">${e.count.toLocaleString('es-CL')}</td>
                            <td style="padding:10px 14px;font-weight:700;color:var(--text-secondary)">${pct}%</td>
                            <td style="padding:10px 14px;min-width:120px">
                              <div style="background:var(--border);border-radius:99px;height:7px;overflow:hidden">
                                <div style="height:100%;width:${Math.min(parseFloat(pct)*3,100)}%;background:${color};border-radius:99px"></div>
                              </div>
                            </td>
                          </tr>`;
                      }).join('')}
                    </tbody>
                    <tfoot>
                      <tr style="background:rgba(99,102,241,.06);border-top:2px solid #6366f1">
                        <td colspan="2" style="padding:12px 14px;font-weight:900;color:#6366f1">TOTAL</td>
                        <td style="padding:12px 14px;font-size:17px;font-weight:900;color:#6366f1">${ocupadas.toLocaleString('es-CL')}</td>
                        <td style="padding:12px 14px;font-weight:900;color:#6366f1">${pctOcup}%</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px;margin-top:24px">
              PC HOTELERÍA — Sistema de Gestión de Campamento · Datos en vivo al
              <strong id="inf-ts">${new Date().toLocaleString('es-CL')}</strong>
            </div>
          </div>
        </div>`;

        // Actualizar subtítulo
        document.getElementById('inf-subtitle').textContent =
            `PC HOTELERÍA · ${new Date().toLocaleString('es-CL')} · ${totalEmpresas} empresas activas`;

        // ── Renderizar charts ────────────────────────────────────────────────
        renderCharts({ ocupadas, disponibles, mantencion, totalCamas, empRows, asigActivas });

        // ── Botones PDF ───────────────────────────────────────────────────────
        document.getElementById('btn-pdf-normal')   ?.addEventListener('click', () => imprimirInforme('normal'));
        document.getElementById('btn-pdf-detallado')?.addEventListener('click', () => imprimirInforme('detallado', empRows, perdEmpRows, { totalCamas, ocupadas, disponibles, pctOcup, camasAngloPerd, pctAngloPerd, angloDispDia, angloDispNoche, angloTotalDia, angloTotalNoche, totalEmpPerdidas }));

    } catch(e) {
        console.error('[v2-informe-ejecutivo]', e);
        container.innerHTML = `
          <div style="padding:60px;text-align:center">
            <div style="font-size:48px;margin-bottom:16px">⚠️</div>
            <div style="font-weight:800;font-size:18px;color:var(--text-primary);margin-bottom:8px">Error al cargar el informe</div>
            <div style="font-size:13px;color:#ef4444;font-family:monospace;margin-bottom:24px">${e.message}</div>
            <button onclick="window.navigate('v2informeejecutivo')"
              style="background:#6366f1;color:white;border:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:700;cursor:pointer">
              🔄 Reintentar
            </button>
          </div>`;
    }
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts({ ocupadas, disponibles, mantencion, totalCamas, empRows, asigActivas = [] }) {
    const font = { family: 'Inter', size: 12 };

    // ── Plugin: texto en el centro del donut ─────────────────────────────────
    const centerTextPlugin = (line1Fn, line2Fn) => ({
        id: 'centerText',
        afterDraw(chart) {
            const { ctx, chartArea: { top, bottom, left, right } } = chart;
            const total = chart.data.datasets[0].data.reduce((a, b) => (a || 0) + (b || 0), 0);
            if (!total) return;
            const cx = (left + right) / 2;
            const cy = (top + bottom) / 2;
            ctx.save();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = 'bold 22px Inter';
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1e293b';
            ctx.fillText(line1Fn(total), cx, cy - 10);
            ctx.font = '12px Inter';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(line2Fn(total), cx, cy + 12);
            ctx.restore();
        }
    });

    // ── Plugin: números encima de las barras ──────────────────────────────────
    const barLabelsPlugin = {
        id: 'barLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            chart.data.datasets.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i);
                meta.data.forEach((bar, index) => {
                    const value = dataset.data[index];
                    if (!value) return;
                    ctx.save();
                    ctx.font = 'bold 11px Inter';
                    ctx.fillStyle = '#475569';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(value.toLocaleString('es-CL'), bar.x, bar.y - 3);
                    ctx.restore();
                });
            });
        }
    };

    // ── Leyenda con % y cantidad ─────────────────────────────────────────────
    const legendWithPct = (labels, colors) => ({
        display: true,
        position: 'bottom',
        labels: {
            font, padding: 14,
            generateLabels(chart) {
                const data   = chart.data.datasets[0].data;
                const total  = data.reduce((a, b) => (a || 0) + (b || 0), 0);
                return labels.map((lbl, i) => {
                    const val = data[i] || 0;
                    const pct = total > 0 ? Math.round(val / total * 100) : 0;
                    return {
                        text: `${lbl}: ${val.toLocaleString('es-CL')} (${pct}%)`,
                        fillStyle: colors[i],
                        strokeStyle: colors[i],
                        lineWidth: 0,
                        hidden: false,
                        index: i,
                    };
                });
            }
        }
    });

    // ── 1. Donut: Estado de Camas ─────────────────────────────────────────────
    const donutCtx = document.getElementById('inf-chart-donut');
    if (donutCtx) {
        const total = ocupadas + disponibles + mantencion;
        const pctOcup = total > 0 ? Math.round(ocupadas / total * 100) : 0;
        new Chart(donutCtx, {
            type: 'doughnut',
            data: {
                labels: ['Ocupadas','Disponibles','Mantención'],
                datasets: [{ data: [ocupadas, disponibles, mantencion], backgroundColor: ['#ef4444','#10b981','#f59e0b'], borderWidth: 0, hoverOffset: 8 }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: legendWithPct(['🔴 Ocupadas','🟢 Disponibles','🟡 Mantención'], ['#ef4444','#10b981','#f59e0b']),
                    tooltip: { callbacks: { label: c => { const pct = total > 0 ? Math.round(c.raw / total * 100) : 0; return ` ${c.label}: ${c.raw.toLocaleString('es-CL')} camas (${pct}%)`; } } },
                },
                cutout: '65%',
            },
            plugins: [centerTextPlugin(
                t => `${pctOcup}%`,
                () => `${ocupadas.toLocaleString('es-CL')} ocup.`
            )],
        });
    }

    // ── 2. Barras: Por Empresa ────────────────────────────────────────────────
    const empCtx = document.getElementById('inf-chart-empresas');
    if (empCtx && empRows.length > 0) {
        const top10 = empRows.slice(0, 10);
        const totalEmp = top10.reduce((s, e) => s + e.count, 0);
        new Chart(empCtx, {
            type: 'bar',
            data: {
                labels: top10.map(e => e.nombre.split(' ')[0]),
                datasets: [{
                    label: 'Camas activas',
                    data: top10.map(e => e.count),
                    backgroundColor: top10.map((_, i) => empColor(i) + 'cc'),
                    borderColor: top10.map((_, i) => empColor(i)),
                    borderWidth: 2,
                    borderRadius: 8,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { top: 22 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const pct = totalEmp > 0 ? Math.round(ctx.raw / totalEmp * 100) : 0;
                                return ` ${ctx.raw.toLocaleString('es-CL')} camas (${pct}% del total)`;
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,.15)' } },
                    x: { grid: { display: false } },
                },
            },
            plugins: [barLabelsPlugin],
        });
    }

    // ── 3. Donut: Solicitudes vs Confirmados ──────────────────────────────────
    const confCtx = document.getElementById('inf-chart-confirmados');
    if (confCtx) {
        const totalAsig   = asigActivas.length;
        const confirmados = asigActivas.filter(a => a.huesped_confirmo).length;
        const pendientes  = totalAsig - confirmados;
        const pctConf = totalAsig > 0 ? Math.round(confirmados / totalAsig * 100) : 0;
        new Chart(confCtx, {
            type: 'doughnut',
            data: {
                labels: ['Confirmados', 'Sin confirmar'],
                datasets: [{ data: [confirmados, pendientes], backgroundColor: ['#10b981','#ef4444'], borderWidth: 0, hoverOffset: 6 }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: legendWithPct(['✅ Confirmados','🔴 Sin confirmar'], ['#10b981','#ef4444']),
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const pct = totalAsig > 0 ? Math.round(ctx.parsed / totalAsig * 100) : 0;
                                return ` ${ctx.label}: ${ctx.parsed.toLocaleString('es-CL')} (${pct}%)`;
                            }
                        }
                    }
                },
            },
            plugins: [centerTextPlugin(
                () => `${pctConf}%`,
                () => `${confirmados.toLocaleString('es-CL')} conf.`
            )],
        });
    }

    // ── 4. Donut: Participación % por empresa ─────────────────────────────────
    const partCtx = document.getElementById('inf-chart-participacion');
    if (partCtx && empRows.length > 0) {
        const top5  = empRows.slice(0, 5);
        const otros = empRows.slice(5).reduce((s, e) => s + e.count, 0);
        const data  = [...top5.map(e => e.count), otros > 0 ? otros : null].filter(Boolean);
        const labs  = [...top5.map(e => e.nombre.split(' ')[0]), otros > 0 ? 'Otros' : null].filter(Boolean);
        const cols  = [...top5.map((_, i) => empColor(i)), '#94a3b8'];
        const totalPart = data.reduce((a, b) => a + b, 0);
        new Chart(partCtx, {
            type: 'doughnut',
            data: {
                labels: labs,
                datasets: [{ data, backgroundColor: cols.slice(0, data.length), borderWidth: 0 }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font, padding: 10, boxWidth: 12,
                            generateLabels(chart) {
                                return chart.data.labels.map((lbl, i) => {
                                    const val = chart.data.datasets[0].data[i] || 0;
                                    const pct = totalPart > 0 ? Math.round(val / totalPart * 100) : 0;
                                    return {
                                        text: `${lbl} (${pct}%)`,
                                        fillStyle: cols[i],
                                        strokeStyle: cols[i],
                                        lineWidth: 0,
                                        hidden: false,
                                        index: i,
                                    };
                                });
                            }
                        }
                    },
                    tooltip: { callbacks: { label: c => { const pct = totalPart > 0 ? Math.round(c.raw / totalPart * 100) : 0; return ` ${c.label}: ${c.raw.toLocaleString('es-CL')} camas (${pct}%)`; } } },
                },
                cutout: '60%',
            },
            plugins: [centerTextPlugin(
                t => t.toLocaleString('es-CL'),
                () => 'camas'
            )],
        });
    }
}

// ── Imprimir PDF — ventana nueva con contenido limpio ────────────────────────
function imprimirInforme(modo = 'normal', empRows = [], perdEmpRows = [], kpis = {}) {
    // 1. Capturar gráficos como PNG base64
    const getImg = id => {
        const c = document.getElementById(id);
        try { return c ? c.toDataURL('image/png') : ''; } catch(e) { return ''; }
    };
    const imgs = {
        donut : getImg('inf-chart-donut'),
        emp   : getImg('inf-chart-empresas'),
        conf  : getImg('inf-chart-confirmados'),
        part  : getImg('inf-chart-participacion'),
    };

    // 2. Clonar el body del informe y reemplazar canvas → img
    const bodyEl = document.getElementById('informe-body');
    if (!bodyEl) { alert('El informe aún se está cargando.'); return; }
    let printHTML = bodyEl.innerHTML;
    [
        ['inf-chart-donut',          imgs.donut],
        ['inf-chart-empresas',       imgs.emp],
        ['inf-chart-confirmados',    imgs.conf],
        ['inf-chart-participacion',  imgs.part],
    ].forEach(([id, src]) => {
        const re = new RegExp('<canvas id="' + id + '"[^>]*><\\/canvas>');
        printHTML = printHTML.replace(re,
            src ? '<img src="' + src + '" style="width:100%;height:auto;display:block">' : '');
    });

    // 3. Resolver variables CSS → valores reales
    printHTML = printHTML
        .replace(/var\(--bg-card\)/g,        '#ffffff')
        .replace(/var\(--bg\)/g,             '#f8faff')
        .replace(/var\(--border\)/g,         '#e2e8f0')
        .replace(/var\(--text-primary\)/g,   '#1e293b')
        .replace(/var\(--text-secondary\)/g, '#475569')
        .replace(/var\(--text-muted\)/g,     '#94a3b8');

    // 4. Datos del header
    const subtitle = document.getElementById('inf-subtitle')?.textContent || 'PC HOTELERIA';
    const ts       = document.getElementById('inf-ts')?.textContent || new Date().toLocaleString('es-CL');
    const logoEl   = document.querySelector('#informe-root img[alt="Aramark"]');
    const logoSrc  = logoEl?.src || '';

    // 5. Abrir ventana nueva
    const win = window.open('', '_blank', 'width=1200,height=900,scrollbars=yes');
    if (!win) { alert('Habilita las ventanas emergentes (popup) para este sitio.'); return; }

    const logoTag = logoSrc ? '<img src="' + logoSrc + '" alt="Aramark" style="height:48px;filter:brightness(0) invert(1);opacity:.9;object-fit:contain">' : '';
    const modoLabel = modo === 'detallado' ? 'Detallado' : 'Normal';

    // 6. Tabla detallada de empresas (solo modo detallado)
    let tablaEmpresas = '';
    if (modo === 'detallado' && empRows.length > 0) {
        tablaEmpresas = `
        <div style="margin-top:28px;padding:0 0 20px">
          <h2 style="font-size:16px;font-weight:900;color:#1e293b;margin-bottom:12px;padding:12px 16px;
               background:linear-gradient(135deg,#1e1b4b,#312e81);color:#a5b4fc;border-radius:10px">
            🏢 Detalle por Empresa Contratista
          </h2>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#1e1b4b">
                <th style="padding:10px 14px;color:#a5b4fc;text-align:left">#</th>
                <th style="padding:10px 14px;color:#a5b4fc;text-align:left">Empresa</th>
                <th style="padding:10px 14px;color:#a5b4fc;text-align:right">Camas Activas</th>
                <th style="padding:10px 14px;color:#a5b4fc;text-align:right">% Total</th>
              </tr>
            </thead>
            <tbody>
              ${empRows.map((e, i) => {
                const pct = kpis.totalCamas > 0 ? (e.count / kpis.totalCamas * 100).toFixed(1) : '0.0';
                return `<tr style="border-bottom:1px solid #e2e8f0;${i%2===1?'background:#f8faff':''}">
                  <td style="padding:8px 14px;font-weight:800;color:${empColor(i)}">${i+1}</td>
                  <td style="padding:8px 14px;font-weight:700">${e.nombre}</td>
                  <td style="padding:8px 14px;text-align:right;font-weight:900;color:${empColor(i)}">${e.count.toLocaleString('es-CL')}</td>
                  <td style="padding:8px 14px;text-align:right">${pct}%</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background:#eef2ff;border-top:2px solid #6366f1;font-weight:900">
                <td colspan="2" style="padding:10px 14px;color:#6366f1">TOTAL OCUPADAS</td>
                <td style="padding:10px 14px;text-align:right;color:#6366f1">${kpis.ocupadas?.toLocaleString('es-CL')}</td>
                <td style="padding:10px 14px;text-align:right;color:#6366f1">${kpis.pctOcup}%</td>
              </tr>
            </tfoot>
          </table>
        </div>`;

        // Camas perdidas por empresa (detallado)
        if (perdEmpRows.length > 0) {
            tablaEmpresas += `
        <div style="margin-top:20px">
          <h2 style="font-size:16px;font-weight:900;margin-bottom:12px;padding:12px 16px;
               background:linear-gradient(135deg,#7f1d1d,#ef4444);color:#fff;border-radius:10px">
            ⚠️ Camas Perdidas — Pabellones Asignados por Empresa
          </h2>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#7f1d1d">
                <th style="padding:10px 14px;color:#fca5a5;text-align:left">Empresa</th>
                <th style="padding:10px 14px;color:#fca5a5;text-align:right">Camas Perdidas</th>
                <th style="padding:10px 14px;color:#fca5a5;text-align:right">Total Asignadas</th>
                <th style="padding:10px 14px;color:#fca5a5;text-align:right">% Perdidas</th>
              </tr>
            </thead>
            <tbody>
              ${perdEmpRows.map((r, i) => `
              <tr style="border-bottom:1px solid #e2e8f0;${i%2===1?'background:#fff5f5':''}">
                <td style="padding:8px 14px;font-weight:700">${r.emp}</td>
                <td style="padding:8px 14px;text-align:right;font-weight:900;color:#ef4444">${r.perdidas}</td>
                <td style="padding:8px 14px;text-align:right">${r.total}</td>
                <td style="padding:8px 14px;text-align:right;color:${r.pct>50?'#ef4444':'#f59e0b'}">${r.pct}%</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
        }

        // Anglo perdidas (detallado)
        tablaEmpresas += `
        <div style="margin-top:20px">
          <h2 style="font-size:16px;font-weight:900;margin-bottom:12px;padding:12px 16px;
               background:linear-gradient(135deg,#78350f,#d97706);color:#fff;border-radius:10px">
            🤝 Camas Perdidas — Anglo
          </h2>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#78350f">
                <th style="padding:10px 14px;color:#fde68a;text-align:left">Tipo</th>
                <th style="padding:10px 14px;color:#fde68a;text-align:right">Total</th>
                <th style="padding:10px 14px;color:#fde68a;text-align:right">Ocupadas</th>
                <th style="padding:10px 14px;color:#fde68a;text-align:right">Vacías</th>
                <th style="padding:10px 14px;color:#fde68a;text-align:right">% Vacías</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom:1px solid #e2e8f0">
                <td style="padding:8px 14px;font-weight:700">☀️ Día (cama 1)</td>
                <td style="padding:8px 14px;text-align:right">${kpis.angloTotalDia}</td>
                <td style="padding:8px 14px;text-align:right;color:#10b981;font-weight:700">${kpis.angloTotalDia - kpis.angloDispDia}</td>
                <td style="padding:8px 14px;text-align:right;color:#ef4444;font-weight:700">${kpis.angloDispDia}</td>
                <td style="padding:8px 14px;text-align:right">${kpis.angloTotalDia > 0 ? Math.round(kpis.angloDispDia/kpis.angloTotalDia*100) : 0}%</td>
              </tr>
              <tr style="background:#fffbeb">
                <td style="padding:8px 14px;font-weight:700">🌙 Noche (cama 2)</td>
                <td style="padding:8px 14px;text-align:right">${kpis.angloTotalNoche}</td>
                <td style="padding:8px 14px;text-align:right;color:#10b981;font-weight:700">${kpis.angloTotalNoche - kpis.angloDispNoche}</td>
                <td style="padding:8px 14px;text-align:right;color:#ef4444;font-weight:700">${kpis.angloDispNoche}</td>
                <td style="padding:8px 14px;text-align:right">${kpis.angloTotalNoche > 0 ? Math.round(kpis.angloDispNoche/kpis.angloTotalNoche*100) : 0}%</td>
              </tr>
              <tr style="background:#eef2ff;border-top:2px solid #d97706;font-weight:900">
                <td style="padding:10px 14px;color:#d97706">TOTAL ANGLO</td>
                <td style="padding:10px 14px;text-align:right;color:#d97706">${kpis.angloTotalDia+kpis.angloTotalNoche}</td>
                <td style="padding:10px 14px;text-align:right;color:#10b981">${(kpis.angloTotalDia-kpis.angloDispDia)+(kpis.angloTotalNoche-kpis.angloDispNoche)}</td>
                <td style="padding:10px 14px;text-align:right;color:#ef4444">${kpis.camasAngloPerd}</td>
                <td style="padding:10px 14px;text-align:right;color:${kpis.pctAngloPerd>50?'#ef4444':'#f59e0b'}">${kpis.pctAngloPerd}%</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    }

    win.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">');
    win.document.write('<title>Informe ' + modoLabel + ' - PC HOTELERIA</title>');
    win.document.write('<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">');
    win.document.write('<style>');
    win.document.write('*{margin:0;padding:0;box-sizing:border-box}');
    win.document.write('body{font-family:Inter,sans-serif;background:#fff;color:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact}');
    win.document.write('.hdr{background:linear-gradient(135deg,#1e1b4b,#312e81,#4f46e5);padding:20px 32px;display:flex;align-items:center;gap:20px;color:#fff}');
    win.document.write('.hdr-info h1{font-size:20px;font-weight:900;color:#fff}');
    win.document.write('.hdr-info p{font-size:12px;color:#a5b4fc;margin-top:4px}');
    win.document.write('.hdr-ts{margin-left:auto;font-size:11px;color:#c7d2fe;text-align:right}');
    win.document.write('.toolbar{display:flex;justify-content:center;gap:12px;padding:14px;background:#f8faff;border-bottom:1px solid #e2e8f0}');
    win.document.write('@media print{.toolbar{display:none!important}}');
    win.document.write('@page{margin:12mm;size:A4 landscape}');
    win.document.write('table{border-collapse:collapse;width:100%}');
    win.document.write('th{background:#1e1b4b;color:#a5b4fc;padding:10px 14px;font-size:11px;text-align:left;text-transform:uppercase}');
    win.document.write('td{padding:10px 14px;font-size:12px;border-bottom:1px solid #e2e8f0}');
    win.document.write('.body{padding:20px 32px}');
    win.document.write('#chart-scroll-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;overflow:visible}');
    win.document.write('</style></head><body>');
    win.document.write('<div class="hdr">' + logoTag);
    win.document.write('<div class="hdr-info"><h1>Informe ' + modoLabel + ' — PC HOTELERIA</h1><p>' + subtitle + '</p></div>');
    win.document.write('<div class="hdr-ts">Generado: ' + ts + '</div></div>');
    win.document.write('<div class="toolbar">');
    win.document.write('<button onclick="window.print()" style="background:#059669;color:#fff;border:none;border-radius:10px;padding:11px 28px;font-size:14px;font-weight:700;cursor:pointer">&#x1F5A8; Guardar como PDF / Imprimir</button>');
    win.document.write('<button onclick="window.close()" style="background:#475569;color:#fff;border:none;border-radius:10px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer">&#x2715; Cerrar</button>');
    win.document.write('</div>');
    win.document.write('<div class="body">' + printHTML + tablaEmpresas + '</div>');
    win.document.write('</body></html>');
    win.document.close();
}



// ── HTML helpers ──────────────────────────────────────────────────────────────
function skeletonHTML() {
    return `
    <div style="padding:28px;display:flex;flex-direction:column;gap:16px;animation:pulse 1.5s infinite">
      <div style="height:80px;background:linear-gradient(135deg,#1e1b4b,#4f46e5);border-radius:16px"></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
        ${Array(8).fill('<div style="height:90px;background:var(--bg-card);border-radius:16px;border:1px solid var(--border)"></div>').join('')}
      </div>
      <div style="height:280px;background:var(--bg-card);border-radius:20px;border:1px solid var(--border)"></div>
    </div>`;
}

function kpiCard(icon, label, value, color, popupHTML = '') {
    const hasPopup = !!popupHTML;
    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:18px;
         padding:18px 20px;border-top:4px solid ${color};
         box-shadow:0 2px 12px rgba(0,0,0,.05);transition:transform .15s;
         cursor:${hasPopup?'pointer':'default'};position:relative"
         onmouseenter="this.style.transform='translateY(-2px)'"
         onmouseleave="this.style.transform=''"
         ${hasPopup ? `onclick="(function(el){const p=el.querySelector('.kpi-popup');if(!p)return;const open=p.style.display==='block';document.querySelectorAll('.kpi-popup').forEach(x=>x.style.display='none');p.style.display=open?'none':'block';})(this)"` : ''}>
      <div style="font-size:26px;margin-bottom:6px">${icon}</div>
      <div style="font-size:26px;font-weight:900;color:${color};line-height:1">${value}</div>
      <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-top:5px;letter-spacing:.05em">${label}${hasPopup?' \u25be':''}</div>
      ${hasPopup ? `
      <div class="kpi-popup" style="display:none;position:absolute;top:calc(100% + 8px);left:0;
           background:var(--bg-card);border:1.5px solid var(--border);border-radius:14px;
           padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,.22);z-index:999;
           min-width:210px;text-align:left;" onclick="event.stopPropagation()">
        ${popupHTML}
      </div>` : ''}
    </div>`;
}

function chartCard() {
    return `background:var(--bg-card);border:1px solid var(--border);border-radius:20px;
            padding:22px 24px;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:0;`;
}

function chartTitle() {
    return `font-size:14px;font-weight:800;color:var(--text-primary);margin-bottom:16px;`;
}

function btnStyle(bg, hover) {
    return `background:${bg};color:white;border:none;border-radius:10px;
            padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;
            transition:background .2s;white-space:nowrap`;
}
