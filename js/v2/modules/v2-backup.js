/**
 * v2-backup.js — Módulo de Respaldo Diario
 * Exporta TODOS los datos críticos en Excel profesional con paginación completa.
 */
import { supabase } from '../../supabaseClient.js';

// ── Paginación completa — sin límite de 1000 filas ───────────────────────────
async function fetchAllRows(table, select, orderCol) {
    const PAGE = 900;
    let offset = 0, all = [];
    while (true) {
        const { data, error } = await supabase
            .from(table).select(select)
            .order(orderCol)
            .range(offset, offset + PAGE - 1);
        if (error) throw new Error(`[Backup] ${table}: ${error.message}`);
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        offset += PAGE;
    }
    return all;
}

// ── Cargar SheetJS si no está disponible ────────────────────────────────────
async function loadXLSX() {
    if (window.XLSX) return window.XLSX;
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
    await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return window.XLSX;
}

// ── Aplicar estilos profesionales a una hoja ────────────────────────────────
function estilizarHoja(ws, headers, colWidths) {
    // Anchos de columna
    ws['!cols'] = colWidths.map(w => ({ wch: w }));

    // Congelar primera fila
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    // Estilo de cabeceras (fila 0)
    const range = window.XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = window.XLSX.utils.encode_cell({ r: 0, c });
        if (!ws[cellRef]) continue;
        ws[cellRef].s = {
            font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
            fill:      { fgColor: { rgb: '1E3A5F' } },
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            border: {
                bottom: { style: 'medium', color: { rgb: 'FFFFFF' } },
                right:  { style: 'thin',   color: { rgb: 'FFFFFF' } }
            }
        };
    }

    // Estilo alternado de filas
    for (let r = 1; r <= range.e.r; r++) {
        const bg = r % 2 === 0 ? 'F0F4FF' : 'FFFFFF';
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cellRef = window.XLSX.utils.encode_cell({ r, c });
            if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' };
            ws[cellRef].s = {
                fill:      { fgColor: { rgb: bg } },
                font:      { sz: 10, name: 'Calibri' },
                alignment: { vertical: 'center' },
                border: {
                    bottom: { style: 'hair', color: { rgb: 'D1D5DB' } },
                    right:  { style: 'hair', color: { rgb: 'D1D5DB' } }
                }
            };
        }
    }

    return ws;
}

export async function renderV2Backup(container) {
    const hoy = new Date().toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric' });

    container.innerHTML = `
    <div style="max-width:800px;margin:0 auto;padding:24px 16px;font-family:'Inter',sans-serif">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1e3a5f 0%,#1a56db 100%);border-radius:20px;padding:28px 32px;color:#fff;margin-bottom:24px;position:relative;overflow:hidden">
        <div style="position:absolute;right:-20px;top:-20px;width:160px;height:160px;background:rgba(255,255,255,.05);border-radius:50%"></div>
        <div style="position:absolute;right:40px;bottom:-40px;width:100px;height:100px;background:rgba(255,255,255,.04);border-radius:50%"></div>
        <div style="display:flex;align-items:center;gap:20px;position:relative">
          <img src="aramark.png" alt="Aramark" style="height:50px;object-fit:contain;filter:brightness(0) invert(1);flex-shrink:0">
          <div>
            <div style="font-size:22px;font-weight:900;margin-bottom:4px">🛡️ Respaldo de Emergencia</div>
            <div style="font-size:13px;opacity:.85">PC Hotelería · Campamento Los Bronces</div>
            <div style="font-size:12px;opacity:.7;margin-top:4px">📅 ${hoy} — Descarga completa sin límite de registros</div>
          </div>
        </div>
      </div>

      <!-- Aviso -->
      <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;gap:10px">
        <span style="font-size:20px">⚠️</span>
        <span style="font-size:13px;color:#92400e;font-weight:600">Este archivo contiene información sensible del campamento. Guardar en lugar seguro y de acceso restringido.</span>
      </div>

      <!-- Contenido del backup -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;margin-bottom:20px">
        <div style="font-weight:800;font-size:14px;margin-bottom:14px;color:#1e293b">📋 Hojas incluidas en el Excel:</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${[
            ['👥','Asignaciones Activas','Todos los trabajadores en camas actualmente'],
            ['📋','Historial Asignaciones','Últimas 3000 asignaciones incluyendo checkout'],
            ['🏢','Empresas y Gerencias','Registro completo de contratistas'],
            ['🛏️','Estado de Camas','Estado actual de cada cama del campamento'],
            ['📝','Solicitudes B2B','Todas las solicitudes cargadas al sistema'],
            ['📊','Cupos por Gerencia','Límites y ocupación por gerencia'],
            ['🏨','Habitaciones','Configuración completa de habitaciones'],
          ].map(([ico,titulo,desc])=>`
            <div style="display:flex;gap:10px;padding:10px 12px;background:#f8fafc;border-radius:10px;border-left:3px solid #1a56db">
              <span style="font-size:18px">${ico}</span>
              <div>
                <div style="font-size:12px;font-weight:800;color:#1e293b">${titulo}</div>
                <div style="font-size:11px;color:#64748b">${desc}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <!-- Botón -->
      <button id="btn-backup-generar"
        style="width:100%;padding:20px;border:none;border-radius:14px;background:linear-gradient(135deg,#1e3a5f,#1a56db);color:#fff;font-size:16px;font-weight:900;cursor:pointer;box-shadow:0 6px 24px rgba(26,86,219,.4);letter-spacing:.4px;transition:all .2s">
        📥 GENERAR BACKUP COMPLETO — ${hoy}
      </button>

      <!-- Progreso -->
      <div id="backup-progress" style="display:none;margin-top:20px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:800;font-size:14px" id="backup-step-title">⏳ Preparando…</div>
          <div style="font-size:12px;font-weight:700;color:#1a56db" id="backup-pct">0%</div>
        </div>
        <div style="height:10px;background:#f1f5f9;border-radius:99px;overflow:hidden;margin-bottom:8px">
          <div id="backup-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#1e3a5f,#1a56db);transition:width .4s;border-radius:99px"></div>
        </div>
        <div id="backup-step" style="font-size:11px;color:#94a3b8;font-weight:600"></div>
      </div>

      <!-- Plan recuperación -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-top:20px">
        <div style="font-weight:800;font-size:13px;margin-bottom:10px;color:#475569">🆘 Plan de recuperación si el sistema cae:</div>
        <div style="display:grid;gap:6px">
          ${[
            ['1','Verificar estado','supabase.com/dashboard o status.supabase.com'],
            ['2','Verificar Netlify','app.netlify.com o netlifystatus.com'],
            ['3','Datos de respaldo','Abrir el Excel descargado para consultas manuales'],
            ['4','Restaurar BD','Panel Supabase → Database → Backups (automático diario)'],
            ['5','Recuperar app','git pull + npm run dev en el Mac de terreno'],
          ].map(([n,titulo,desc])=>`
            <div style="display:flex;gap:10px;align-items:flex-start">
              <div style="min-width:22px;height:22px;background:#1a56db;border-radius:50%;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center">${n}</div>
              <div style="font-size:12px"><span style="font-weight:700;color:#1e293b">${titulo}:</span> <span style="color:#64748b">${desc}</span></div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

    const btn = document.getElementById('btn-backup-generar');
    if (btn) {
        btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-2px)'; btn.style.boxShadow = '0 10px 32px rgba(26,86,219,.55)'; });
        btn.addEventListener('mouseleave', () => { btn.style.transform = ''; btn.style.boxShadow = '0 6px 24px rgba(26,86,219,.4)'; });
        btn.addEventListener('click', _generarBackupCompleto);
    }
}

async function _generarBackupCompleto() {
    const btn  = document.getElementById('btn-backup-generar');
    const prog = document.getElementById('backup-progress');
    const bar  = document.getElementById('backup-bar');
    const step = document.getElementById('backup-step');
    const stTitle = document.getElementById('backup-step-title');
    const pct  = document.getElementById('backup-pct');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = '⏳ Generando backup completo…';
    prog.style.display = 'block';

    const setStep = (titulo, detalle, p) => {
        if (stTitle) stTitle.textContent = titulo;
        if (step)    step.textContent    = detalle;
        if (bar)     bar.style.width     = p + '%';
        if (pct)     pct.textContent     = p + '%';
    };

    try {
        const XLSX = await loadXLSX();
        const wb   = XLSX.utils.book_new();
        const ts   = new Date().toISOString().slice(0, 10);
        const hora = new Date().toLocaleTimeString('es-CL');

        // ── PORTADA ──────────────────────────────────────────────────────────
        const portadaData = [
            ['PC HOTELERÍA — CAMPAMENTO LOS BRONCES', '', ''],
            ['Aramark Chile · Respaldo de Emergencia', '', ''],
            ['', '', ''],
            ['Fecha de generación:', ts, ''],
            ['Hora:', hora, ''],
            ['Sistema:', 'PC Hotelería V2', ''],
            ['Entorno:', 'Supabase Cloud (Producción)', ''],
            ['', '', ''],
            ['INSTRUCCIONES DE USO', '', ''],
            ['1. Este archivo es un snapshot del estado actual de la BD.', '', ''],
            ['2. En caso de caída, úselo como referencia para operación manual.', '', ''],
            ['3. Para restaurar: contactar al administrador de sistema.', '', ''],
            ['4. Supabase: status.supabase.com', '', ''],
            ['5. Netlify: netlifystatus.com', '', ''],
        ];
        const wsPortada = XLSX.utils.aoa_to_sheet(portadaData);
        wsPortada['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 20 }];
        // Estilo título
        if (wsPortada['A1']) wsPortada['A1'].s = { font: { bold: true, sz: 16, color: { rgb: '1E3A5F' } } };
        if (wsPortada['A2']) wsPortada['A2'].s = { font: { bold: true, sz: 12, color: { rgb: '1A56DB' } } };
        if (wsPortada['A9']) wsPortada['A9'].s = { font: { bold: true, sz: 13, color: { rgb: '1E3A5F' } } };
        XLSX.utils.book_append_sheet(wb, wsPortada, '📋 Portada');

        // ── ASIGNACIONES ACTIVAS ─────────────────────────────────────────────
        setStep('⏳ Descargando asignaciones activas…', 'Consultando base de datos…', 10);
        const asigActivas = await fetchAllRows(
            'v2_asignaciones',
            'id,rut_huesped,nombre_huesped,id_cama,empresa_id,fecha_checkin,fecha_salida_programada,estado_asignacion,huesped_confirmo,numero_contrato,v2_empresas(nombre,v2_gerencias(nombre))',
            'nombre_huesped'
        );
        // Filtrar solo activas (sin fecha_checkout)
        const activas = asigActivas.filter(a => !a.fecha_checkout);

        const wsActivas = XLSX.utils.json_to_sheet(activas.map(a => ({
            'RUT':               a.rut_huesped || '',
            'Nombre Trabajador': a.nombre_huesped || '',
            'Empresa':           a.v2_empresas?.nombre || '',
            'Gerencia':          a.v2_empresas?.v2_gerencias?.nombre || '',
            'N° Contrato':       a.numero_contrato || '',
            'ID Cama':           a.id_cama || '',
            'Habitación':        (a.id_cama || '').split('-').slice(0, -1).join('-'),
            'Fecha Llegada':     a.fecha_checkin || '',
            'Fecha Salida':      a.fecha_salida_programada || '',
            'Estado':            a.estado_asignacion || 'activa',
            'Confirmó Llegada':  a.huesped_confirmo ? '✅ Sí' : '❌ No',
        })));
        estilizarHoja(wsActivas, [], [12, 28, 22, 20, 14, 16, 14, 14, 14, 13, 15]);
        XLSX.utils.book_append_sheet(wb, wsActivas, '👥 Asignaciones Activas');
        setStep('✅ Asignaciones activas', `${activas.length} registros descargados`, 25);

        // ── HISTORIAL ASIGNACIONES ───────────────────────────────────────────
        setStep('⏳ Descargando historial…', 'Puede tomar unos segundos…', 28);
        const historial = await fetchAllRows(
            'v2_asignaciones',
            'id,rut_huesped,nombre_huesped,id_cama,fecha_checkin,fecha_salida_programada,fecha_checkout,estado_asignacion,numero_contrato,v2_empresas(nombre)',
            'fecha_checkin'
        );
        const wsHist = XLSX.utils.json_to_sheet(historial.map(a => ({
            'ID':             a.id || '',
            'RUT':            a.rut_huesped || '',
            'Nombre':         a.nombre_huesped || '',
            'Empresa':        a.v2_empresas?.nombre || '',
            'N° Contrato':    a.numero_contrato || '',
            'ID Cama':        a.id_cama || '',
            'Fecha Llegada':  a.fecha_checkin || '',
            'Fecha Salida':   a.fecha_salida_programada || '',
            'Fecha Checkout': a.fecha_checkout || 'ACTIVO',
            'Estado':         a.estado_asignacion || '',
        })));
        estilizarHoja(wsHist, [], [8, 12, 28, 22, 14, 16, 13, 13, 13, 13]);
        XLSX.utils.book_append_sheet(wb, wsHist, '📋 Historial Asignaciones');
        setStep('✅ Historial', `${historial.length} registros`, 42);

        // ── EMPRESAS ─────────────────────────────────────────────────────────
        setStep('⏳ Descargando empresas…', '', 44);
        const empresas = await fetchAllRows('v2_empresas', 'id,nombre,turno,gerencia_id,v2_gerencias(nombre)', 'nombre');
        const wsEmp = XLSX.utils.json_to_sheet(empresas.map(e => ({
            'ID':       e.id || '',
            'Nombre':   e.nombre || '',
            'Turno':    e.turno || '',
            'Gerencia': e.v2_gerencias?.nombre || '',
        })));
        estilizarHoja(wsEmp, [], [8, 35, 12, 25]);
        XLSX.utils.book_append_sheet(wb, wsEmp, '🏢 Empresas');
        setStep('✅ Empresas', `${empresas.length} empresas`, 52);

        // ── ESTADO DE CAMAS ──────────────────────────────────────────────────
        setStep('⏳ Descargando estado de camas…', 'Puede demorar (>1400 camas)…', 54);
        const camas = await fetchAllRows('v2_camas', 'id_cama,habitacion_id,estado', 'id_cama');
        const wsCamas = XLSX.utils.json_to_sheet(camas.map(c => ({
            'ID Cama':    c.id_cama || '',
            'Habitación': c.habitacion_id || '',
            'Estado':     c.estado || '',
        })));
        estilizarHoja(wsCamas, [], [18, 16, 14]);
        XLSX.utils.book_append_sheet(wb, wsCamas, '🛏️ Estado Camas');
        setStep('✅ Estado de camas', `${camas.length} camas`, 65);

        // ── SOLICITUDES B2B ──────────────────────────────────────────────────
        setStep('⏳ Descargando solicitudes B2B…', '', 67);
        const solicitudes = await fetchAllRows(
            'v2_solicitudes_b2b',
            'id,nombre_trabajador,rut_trabajador,empresa,gerencia,n_contrato,fecha_llegada,fecha_salida,hab_solicitada,status',
            'empresa'
        );
        const wsSol = XLSX.utils.json_to_sheet(solicitudes.map(s => ({
            'Nombre':      s.nombre_trabajador || '',
            'RUT':         s.rut_trabajador || '',
            'Empresa':     s.empresa || '',
            'Gerencia':    s.gerencia || '',
            'N° Contrato': s.n_contrato || '',
            'Llegada':     s.fecha_llegada || '',
            'Salida':      s.fecha_salida || '',
            'Hab. Pedida': s.hab_solicitada || 'Auto',
            'Estado':      s.status || '',
        })));
        estilizarHoja(wsSol, [], [28, 12, 22, 20, 13, 12, 12, 12, 11]);
        XLSX.utils.book_append_sheet(wb, wsSol, '📝 Solicitudes B2B');
        setStep('✅ Solicitudes B2B', `${solicitudes.length} solicitudes`, 78);

        // ── CUPOS POR GERENCIA ───────────────────────────────────────────────
        setStep('⏳ Descargando cupos…', '', 80);
        const cupos = await fetchAllRows('v2_cupos_gerencias', '*', 'empresa');
        if (cupos.length) {
            const wsCupos = XLSX.utils.json_to_sheet(cupos.map(c => ({
                'Empresa':        c.empresa || '',
                'Gerencia':       c.gerencia || '',
                'N° Contrato':    c.numero_contrato || '',
                'Cupos Totales':  c.cupos_totales || 0,
                'Cupos Ocupados': c.cupos_ocupados || 0,
                'Cupos Libres':   (c.cupos_totales || 0) - (c.cupos_ocupados || 0),
            })));
            estilizarHoja(wsCupos, [], [25, 22, 15, 14, 14, 12]);
            XLSX.utils.book_append_sheet(wb, wsCupos, '📊 Cupos Gerencia');
        }
        setStep('✅ Cupos', `${cupos.length} registros`, 88);

        // ── HABITACIONES ─────────────────────────────────────────────────────
        setStep('⏳ Descargando habitaciones…', '', 90);
        const habs = await fetchAllRows('v2_habitaciones', 'id_custom,numero_hab,nivel,cantidad_camas,pabellon_id', 'id_custom');
        const wsHabs = XLSX.utils.json_to_sheet(habs.map(h => ({
            'ID Habitación': h.id_custom || '',
            'N° Hab':        h.numero_hab || '',
            'Nivel/Piso':    h.nivel || '',
            'Camas Totales': h.cantidad_camas || '',
            'Pabellón ID':   h.pabellon_id || '',
        })));
        estilizarHoja(wsHabs, [], [18, 10, 10, 13, 14]);
        XLSX.utils.book_append_sheet(wb, wsHabs, '🏨 Habitaciones');
        setStep('✅ Habitaciones', `${habs.length} habitaciones`, 96);

        // ── Descargar ────────────────────────────────────────────────────────
        setStep('⏳ Generando archivo…', 'Preparando descarga…', 98);
        XLSX.writeFile(wb, `Backup_Emergencia_PCHoteleria_${ts}.xlsx`);

        // Éxito
        bar.style.background = 'linear-gradient(90deg,#166534,#4ade80)';
        setStep(`✅ Backup completado — ${hora}`,
            `${activas.length} asignaciones · ${camas.length} camas · ${solicitudes.length} solicitudes · ${empresas.length} empresas`,
            100);
        btn.disabled = false;
        btn.textContent = `✅ Backup descargado correctamente (${ts})`;
        btn.style.background = 'linear-gradient(135deg,#166534,#16a34a)';
        btn.style.boxShadow  = '0 6px 24px rgba(22,163,74,.4)';

    } catch (err) {
        bar.style.background = '#ef4444';
        setStep('❌ Error al generar backup', err.message, 100);
        btn.disabled = false;
        btn.textContent = '🔄 Reintentar Backup';
        console.error('[Backup]', err);
    }
}

window._generarBackup = _generarBackupCompleto;
