/**
 * v2-asistencia.js — Control de Asistencia por Empresa
 * Lista desplegable por empresa con estado de check-in, fecha/hora y confirmación grupal.
 */
import { supabase } from '../../supabaseClient.js';
import { logAudit } from '../v2-audit.js';
import { showToast } from '../../utils.js';

let _datos      = [];   // asignaciones activas agrupadas
let _solicPend  = [];   // solicitudes aceptadas SIN asignación formal
let _expandidos = new Set();
let _filtro     = 'todos'; // 'todos' | 'confirmados' | 'pendientes'
let _busqueda   = '';
let _empresasMap = {};  // nombre_lower → { id, nombre } — relleno en cargarDatos

// ── Auto Check-Out: el día antes de la fecha de salida ────────────────────────
async function autoCheckoutVencidos() {
    try {
        const hoy    = new Date().toISOString().split('T')[0];
        const manana = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        // ── 1. Asignaciones reales vencidas ──────────────────────────────────
        const { data: vencidas, error } = await supabase
            .from('v2_asignaciones')
            .select('id, id_cama, nombre_huesped, rut_huesped, fecha_salida_programada')
            .is('fecha_checkout', null)
            .lte('fecha_salida_programada', manana)   // salida ≤ mañana
            .neq('estado_asignacion', 'pre_asignado');

        const ahora   = new Date().toISOString();
        let total = 0;

        if (!error && vencidas?.length) {
            const ids     = vencidas.map(a => a.id);
            const camaIds = [...new Set(vencidas.map(a => a.id_cama).filter(Boolean))];
            const ruts    = [...new Set(vencidas.map(a => (a.rut_huesped||'').replace(/[\.\-]/g,'').toUpperCase()).filter(Boolean))];

            // Checkout masivo en lotes de 50
            for (let i = 0; i < ids.length; i += 50) {
                await supabase.from('v2_asignaciones')
                    .update({ fecha_checkout: ahora, estado_asignacion: 'checkout_auto' })
                    .in('id', ids.slice(i, i + 50));
            }
            // Liberar camas
            for (let i = 0; i < camaIds.length; i += 50) {
                await supabase.from('v2_camas')
                    .update({ estado: 'Disponible' })
                    .in('id_cama', camaIds.slice(i, i + 50))
                    .neq('estado', 'Deshabilitada');
            }
            // ✅ Marcar las solicitudes como 'finalizado' para que no vuelvan como sintéticos
            if (ruts.length) {
                for (let i = 0; i < ruts.length; i += 50) {
                    await supabase.from('v2_solicitudes_b2b')
                        .update({ status: 'finalizado' })
                        .in('rut_trabajador', ruts.slice(i, i + 50).map(r => {
                            // Tanto con guión como sin él
                            return r;
                        }))
                        .in('status', ['aceptada', 'aceptada_asignada']);
                }
            }
            total += vencidas.length;
        }

        // ── 2. Solicitudes SIN asignación real cuya fecha ya venció ──────────
        const { data: solsVencidas } = await supabase
            .from('v2_solicitudes_b2b')
            .select('id, rut_trabajador, nombre_trabajador, fecha_salida')
            .in('status', ['aceptada', 'aceptada_asignada'])
            .lte('fecha_salida', manana)   // salida ≤ mañana
            .not('fecha_salida', 'is', null);

        if (solsVencidas?.length) {
            const solIds = solsVencidas.map(s => s.id);
            for (let i = 0; i < solIds.length; i += 50) {
                await supabase.from('v2_solicitudes_b2b')
                    .update({ status: 'finalizado' })
                    .in('id', solIds.slice(i, i + 50));
            }
            total += solsVencidas.length;
            console.log(`[AutoCheckout] 📋 ${solsVencidas.length} solicitudes sin asignación → finalizadas`);
        }

        if (total > 0) {
            await logAudit('AUTO_CHECKOUT',
                `Check-out automático: ${total} trabajadores (salida ≤ ${manana})`,
                { cantidad: total, fecha_limite: manana }
            );
        }

        console.log(`[AutoCheckout] ✅ ${total} trabajadores procesados`);
        return total;
    } catch(e) {
        console.warn('[AutoCheckout] Error:', e.message);
        return 0;
    }
}

// ── Cargar datos (paginado — sin límite de 1000) ──────────────────────────────
async function cargarDatos() {
    const hoy  = new Date().toISOString().split('T')[0];
    const PAGE = 1000;
    let all = [], page = 0;

    // ⭐ Auto-checkout antes de cargar: el día antes de la salida programada
    const autoN = await autoCheckoutVencidos();
    if (autoN > 0) {
        showToast(`🚨 Check-out automático: ${autoN} trabajador${autoN !== 1 ? 'es' : ''} fueron dados de baja (fecha de salida alcanzada)`, 'warn', 7000);
    }

    while (true) {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select(`
                id, rut_huesped, nombre_huesped, fecha_checkin, huesped_confirmo,
                fecha_salida_programada, id_cama, estado_asignacion,
                updated_at, created_at,
                v2_empresas(id, nombre, turno),
                v2_camas(v2_habitaciones(numero_hab))
            `)
            .is('fecha_checkout', null)
            .or(`fecha_salida_programada.is.null,fecha_salida_programada.gte.${hoy}`)
            .order('nombre_huesped')
            .range(page * PAGE, page * PAGE + PAGE - 1);

        if (error) throw error;
        if (data?.length) all = all.concat(data);
        if (!data || data.length < PAGE) break;
        page++;
        if (page > 30) break;
    }

    // ── Cargar empresas reales para match con texto libre ────────────────────
    try {
        const { data: emps } = await supabase.from('v2_empresas').select('id, nombre');
        _empresasMap = {};
        (emps || []).forEach(e => {
            _empresasMap[e.nombre.toLowerCase().trim()] = e;
        });
    } catch(_) {}

    // ── Match difuso: texto libre de solicitud → empresa real en BD ─────────
    function matchEmpresa(textoLibre) {
        return _matchEmpresa(textoLibre);
    }

    // ── Cargar solicitudes aceptadas para el turno activo (sin fecha pasada) ──
    try {
        // rutsConAsig: solo del turno activo. Trabajadores con asignación antigua/expirada
        // aparecerán en _solicPend como sintéticos y serán actualizados por _autoCrearSilencioso
        // ⚠️ Normalizar igual que el motor: quitar puntos, guiones Y espacios
        const _normR = r => String(r||'').replace(/[.\-\s]/g,'').toUpperCase();
        const rutsConAsig = new Set(all.map(a => _normR(a.rut_huesped)));

        // ⭐ Paginación completa — sin límite de 1000 filas
        const SOL_PAGE = 900;
        let solOffset = 0;
        const solsAll = [];
        while (true) {
            const { data: solPage, error: solErr } = await supabase
                .from('v2_solicitudes_b2b')
                .select('id, nombre_trabajador, rut_trabajador, empresa, hab_solicitada, fecha_llegada, fecha_salida, status')
                .in('status', ['aceptada', 'aceptada_asignada', 'pendiente'])
                .order('created_at', { ascending: false })
                .range(solOffset, solOffset + SOL_PAGE - 1);
            if (solErr) { console.warn('[Asistencia] Error solicitudes pag:', solErr.message); break; }
            if (!solPage || !solPage.length) break;
            solsAll.push(...solPage);
            if (solPage.length < SOL_PAGE) break;
            solOffset += SOL_PAGE;
        }
        const sols = solsAll;
        // Incluye 'pendiente': trabajadores cargados que el motor no pudo asignar
        // (hab. solicitada llena) → deben aparecer en Asistencia como SIN CAMA

        // Solo los que NO tienen asignación formal en el turno activo
        _solicPend = (sols || []).filter(s => {
            const rutS = _normR(s.rut_trabajador);
            if (rutsConAsig.has(rutS)) return false; // ya tiene asignación activa
            // Ocultar si la fecha de salida ya pasó
            if (s.fecha_salida && s.fecha_salida < hoy) return false;
            // Para 'pendiente': ocultar si no tiene fecha_llegada o ya venció
            if (s.status === 'pendiente' && s.fecha_llegada && s.fecha_llegada < hoy) return false;
            return true;
        });

        // Inyectar en _datos usando el ID real de empresa (no texto libre) para evitar duplicados
        const sinteticos = _solicPend.map(s => {
            const empReal = matchEmpresa(s.empresa);
            return {
                id:                      'sol_' + s.id,
                _esSolicitud:            true,
                rut_huesped:             _normR(s.rut_trabajador),
                nombre_huesped:          s.nombre_trabajador || '—',
                huesped_confirmo:        false,
                fecha_checkin:           s.fecha_llegada || null,
                fecha_salida_programada: s.fecha_salida || null,
                estado_asignacion:       'sin_asignar',
                v2_empresas:             empReal
                    ? { id: empReal.id, nombre: empReal.nombre }                        // ← usa ID real → no duplica tarjeta
                    : { id: 'sol_emp_' + (s.empresa||'').toLowerCase().replace(/[^a-z0-9]/g,'_'),
                        nombre: s.empresa || '— Sin empresa —' },
                v2_camas:                null,
                _solicitudId:            s.id,
                _empresaTexto:           s.empresa || '',
            };
        });

        // ── PARCHE: asignaciones sin empresa_id → rescatar empresa desde solicitudes ──
        // Construir mapa rut_norm → solicitud para buscar la empresa por texto
        const rutASolicitud = {};
        (sols || []).forEach(s => {
            const k = _normR(s.rut_trabajador);
            if (k) rutASolicitud[k] = s;
        });

        // Para cada asignación sin empresa, intentar rescatarla desde la solicitud
        all.forEach(a => {
            if (a.v2_empresas?.id) return; // ya tiene empresa → nada que hacer
            const k = _normR(a.rut_huesped);
            const sol = rutASolicitud[k];
            if (!sol) return;
            const empReal = matchEmpresa(sol.empresa);
            if (empReal) {
                a.v2_empresas = { id: empReal.id, nombre: empReal.nombre };
                console.log(`[Asistencia] 🔧 Empresa rescatada: ${a.nombre_huesped} → ${empReal.nombre}`);
            } else {
                // Al menos usar el nombre de texto para que no quede "Sin empresa"
                a.v2_empresas = {
                    id: 'sol_emp_' + (sol.empresa||'').toLowerCase().replace(/[^a-z0-9]/g,'_'),
                    nombre: sol.empresa || '— Sin empresa —'
                };
            }
        });

        // Combinar y deduplicar por RUT — siempre priorizar asignación real sobre sintética
        const vistos = new Set(all.map(a => _normR(a.rut_huesped)));
        const sinteticosFiltrados = sinteticos.filter(s => {
            const rut = _normR(s.rut_huesped);
            if (vistos.has(rut)) return false; // ya tiene asignación real → no duplicar
            vistos.add(rut);
            return true;
        });
        _datos = all.concat(sinteticosFiltrados);
        console.log(`[Asistencia] 📋 ${_solicPend.length} solicitudes sin asignación | ${all.length} asignaciones activas`);

        // ── Auto-crear asignaciones en background (sin throttle) ────────────────
        if (_solicPend.length > 0 && !window._asAutoCreandoEnCurso) {
            window._asAutoCreandoEnCurso = true;
            _autoCrearSilencioso(_solicPend).finally(() => {
                window._asAutoCreandoEnCurso = false;
            });
        }

    } catch(e) {
        console.warn('[Asistencia] Error cargando solicitudes:', e.message);
        _solicPend = [];
        _datos = all;
    }

    console.log(`[Asistencia] ✅ ${_datos.length} registros para el turno activo`);
}

// ── Función de match difuso a nivel de módulo (usada por _autoCrearSilencioso) ──
function _matchEmpresa(textoLibre) {
    if (!textoLibre) return null;
    const t = textoLibre.toLowerCase().trim().replace(/[.,]/g, '');
    if (_empresasMap[t]) return _empresasMap[t];
    for (const [k, emp] of Object.entries(_empresasMap)) {
        const kClean = k.replace(/[.,]/g, '');
        if (t.includes(kClean) || kClean.includes(t)) return emp;
    }
    for (const [k, emp] of Object.entries(_empresasMap)) {
        const palabras = k.split(' ').filter(w => w.length > 3);
        if (palabras.some(p => t.includes(p))) return emp;
    }
    const palabrasT = t.split(' ').filter(w => w.length > 3);
    for (const [k, emp] of Object.entries(_empresasMap)) {
        if (palabrasT.some(p => k.includes(p))) return emp;
    }
    return null;
}

// ── Auto-crear asignaciones para solicitudes sin cama (silencioso) ─────────────
async function _autoCrearSilencioso(pendientes) {
    const hoy = new Date().toISOString().split('T')[0];
    let creados = 0;
    for (const sol of pendientes) {
        try {
            // Buscar cama disponible en la hab solicitada
            let camaId = null;
            if (sol.hab_solicitada) {
                const { data: habRow } = await supabase
                    .from('v2_habitaciones').select('id_custom')
                    .eq('numero_hab', sol.hab_solicitada).maybeSingle();
                if (habRow?.id_custom) {
                    const { data: camas } = await supabase
                        .from('v2_camas').select('id_cama')
                        .eq('habitacion_id', habRow.id_custom).eq('estado', 'Disponible').limit(1);
                    if (camas?.length) camaId = camas[0].id_cama;
                }
            }
            // ⛔ SIN FALLBACK: si la habitación solicitada no tiene camas libres,
            //    el trabajador queda como SIN CAMA. NO se asigna a otra habitación.
            if (!camaId) {
                if (!sol.hab_solicitada) {
                    console.warn(`[AutoCrear] ⚠️ ${sol.nombre_trabajador}: sin hab_solicitada en el Excel → omitido`);
                } else {
                    console.warn(`[AutoCrear] ⚠️ ${sol.nombre_trabajador}: hab. ${sol.hab_solicitada} sin camas libres → SIN CAMA`);
                }
                continue;  // NO asignar a otra habitación
            }


            // Buscar empresa_id usando match difuso (mismo que usa cargarDatos)
            const empReal = _matchEmpresa(sol.empresa);
            const empresaId = empReal?.id || null;
            if (!empresaId) console.warn(`[AutoCrear] ⚠️ No se encontró empresa para "${sol.empresa}"`);

            const rutNorm = String(sol.rut_trabajador || '').replace(/[.\-\s]/g,'').toUpperCase().slice(0,12);
            const estadoAsig = sol.fecha_llegada && sol.fecha_llegada > hoy ? 'pre_asignado' : 'activa';

            // Verificar si ya tiene asignación abierta (turno anterior no cerrado)
            const { data: asigExistente } = await supabase
                .from('v2_asignaciones')
                .select('id, id_cama')
                .eq('rut_huesped', rutNorm)
                .is('fecha_checkout', null)
                .maybeSingle();

            if (asigExistente) {
                // ACTUALIZAR la asignación existente con las nuevas fechas
                const { error: errU } = await supabase
                    .from('v2_asignaciones')
                    .update({
                        fecha_salida_programada: sol.fecha_salida || null,
                        fecha_checkin:           sol.fecha_llegada || hoy,
                        empresa_id:              empresaId,
                        estado_asignacion:       estadoAsig,
                        huesped_confirmo:        false,
                    })
                    .eq('id', asigExistente.id);
                if (errU) { console.warn(`[AutoCrear] Error update ${sol.nombre_trabajador}:`, errU.message); continue; }
                console.log(`[AutoCrear] 🔄 ${sol.nombre_trabajador}: asignación actualizada (nuevo turno)`);
            } else {
                // INSERT nueva asignación
                const { error: errI } = await supabase.from('v2_asignaciones').insert({
                    id_cama:                 camaId,
                    rut_huesped:             rutNorm,
                    nombre_huesped:          sol.nombre_trabajador,
                    empresa_id:              empresaId,
                    fecha_checkin:           sol.fecha_llegada || hoy,
                    fecha_salida_programada: sol.fecha_salida || null,
                    estado_asignacion:       estadoAsig,
                    huesped_confirmo:        false,
                    autorizado_checkin:      false,
                });
                if (errI) { console.warn(`[AutoCrear] Error insert ${sol.nombre_trabajador}:`, errI.message); continue; }
                // Solo actualizar estado de cama si era Disponible y nuevo
                if (estadoAsig === 'activa') {
                    await supabase.from('v2_camas').update({ estado: 'Ocupada' }).eq('id_cama', camaId);
                }
                console.log(`[AutoCrear] ✅ ${sol.nombre_trabajador} (${empReal?.nombre||sol.empresa}) → cama ${camaId}`);
            }

            await supabase.from('v2_solicitudes_b2b')
                .update({ status: 'aceptada_asignada' }).eq('id', sol.id);
            creados++;
        } catch(e) {
            console.warn(`[AutoCrear] Error ${sol.nombre_trabajador}:`, e.message);
        }
    }
    if (creados > 0) {
        console.log(`[AutoCrear] ✅ ${creados} asignaciones procesadas`);
        sessionStorage.setItem('_asAutoCrearTs', Date.now().toString());
        await cargarDatos();
        _renderLista();
    }
}


// ── Agrupar por empresa ───────────────────────────────────────────────────────
function agruparPorEmpresa(lista) {
    // Normalizar nombre: sin acentos, sin puntuación, minúsculas
    function normEmp(nombre) {
        return (nombre || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9 ]/g, ' ')
            .split(' ').filter(w => w.length > 4).sort().join(' ');
    }

    // Construir mapa por empresa_id
    const map = {};
    lista.forEach(a => {
        const eId    = a.v2_empresas?.id || 'sin_empresa';
        const nombre = a.v2_empresas?.nombre || '\u2014 Sin empresa \u2014';
        if (!map[eId]) map[eId] = { id: eId, nombre, trabajadores: [] };
        map[eId].trabajadores.push(a);
    });

    // Fusionar empresas con palabras significativas en común
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i++) {
        if (!map[keys[i]]) continue;
        const wordsI = normEmp(map[keys[i]].nombre).split(' ');
        for (let j = i + 1; j < keys.length; j++) {
            if (!map[keys[j]]) continue;
            const wordsJ = normEmp(map[keys[j]].nombre).split(' ');
            const comunes = wordsI.filter(w => w.length > 4 && wordsJ.includes(w));
            if (comunes.length > 0) {
                // Fusionar j en i — usar el nombre más largo (más descriptivo)
                map[keys[i]].trabajadores.push(...map[keys[j]].trabajadores);
                if (map[keys[j]].nombre.length > map[keys[i]].nombre.length) {
                    map[keys[i]].nombre = map[keys[j]].nombre;
                }
                delete map[keys[j]];
            }
        }
    }

    return Object.values(map).sort((a, b) =>
        a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
    );
}

// ── Filtrar datos ─────────────────────────────────────────────────────────────
function filtrarDatos() {
    const hoy = new Date().toISOString().split('T')[0];
    let lista = _datos;
    // Excluir trabajadores cuya fecha de salida ya pasó y no tienen checkout
    lista = lista.filter(a => {
        const sal = a.fecha_salida_programada;
        if (sal && sal < hoy) return false;  // salida vencida → desaparece
        return true;
    });
    if (_filtro === 'confirmados') lista = lista.filter(a => a.huesped_confirmo);
    if (_filtro === 'pendientes')  lista = lista.filter(a => !a.huesped_confirmo);
    if (_busqueda) {
        const q = _busqueda.toLowerCase();
        lista = lista.filter(a =>
            (a.nombre_huesped || '').toLowerCase().includes(q) ||
            (a.rut_huesped    || '').toLowerCase().includes(q) ||
            (a.v2_empresas?.nombre || '').toLowerCase().includes(q)
        );
        // Auto-expandir las empresas que tienen resultados
        lista.forEach(a => {
            const empId = (a.v2_empresas?.id || 'sin_empresa').toString();
            _expandidos.add(empId);
        });
    }
    return lista;
}

// ── Resaltar texto coincidente ────────────────────────────────────────────────
function hl(text, q) {
    if (!q || !text) return text || '—';
    const idx = (text + '').toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    const t = text + '';
    return t.slice(0, idx) +
        `<mark style="background:#fef08a;border-radius:3px;padding:0 2px;color:#1a1a1a">${t.slice(idx, idx + q.length)}</mark>` +
        t.slice(idx + q.length);
}

// ── KPI rápido ───────────────────────────────────────────────────────────────
function renderKpis(grupos) {
    const total      = _datos.length;
    const confirmados = _datos.filter(a => a.huesped_confirmo).length;
    const pendientes  = total - confirmados;
    const pct         = total > 0 ? Math.round((confirmados / total) * 100) : 0;

    const filtrados   = filtrarDatos();
    const empresas    = grupos.length;

    return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      ${kpiCard('🏢', 'Empresas',        empresas,    '#6366f1')}
      ${kpiCard('👥', 'Total Activos',   total,       '#3b82f6')}
      ${kpiCard('✅', 'Confirmados',     confirmados, '#10b981')}
      ${kpiCard('⏳', 'Sin Confirmar',   pendientes,  '#f59e0b')}
      ${kpiCard('📊', '% Asistencia',   pct + '%',   pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444')}
    </div>`;
}

function kpiCard(icon, label, val, color) {
    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
                padding:16px;border-top:3px solid ${color}">
      <div style="font-size:20px;margin-bottom:4px">${icon}</div>
      <div style="font-size:26px;font-weight:900;color:${color}">${val}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">${label}</div>
    </div>`;
}

// ── Tarjeta empresa ───────────────────────────────────────────────────────────
function renderEmpresaCard(grupo) {
    const { id, nombre, trabajadores } = grupo;
    const total       = trabajadores.length;
    const confirmados = trabajadores.filter(a => a.huesped_confirmo).length;
    const pendientes  = total - confirmados;
    const pct         = total > 0 ? Math.round((confirmados / total) * 100) : 0;
    const expanded    = _expandidos.has(id);
    const safeId      = 'emp-' + id.toString().replace(/[^a-zA-Z0-9]/g, '_');

    // ── Detectar trabajadores en solicitudes sin asignación (para esta empresa) ─
    const nombreNorm = (nombre || '').toLowerCase().trim();
    const sinAsig = _solicPend.filter(s =>
        (s.empresa || '').toLowerCase().includes(nombreNorm.split(' ')[0])
    );

    const barColor = pct === 100 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';

    return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;
                overflow:hidden;margin-bottom:8px" id="card-${safeId}">

      <!-- Cabecera clickeable -->
      <div onclick="window._asToggle('${id}')"
           style="padding:16px 20px;cursor:pointer;display:flex;align-items:center;gap:14px;flex-wrap:wrap;
                  background:${expanded ? 'rgba(99,102,241,.05)' : 'transparent'};
                  border-left:4px solid ${barColor};transition:background .2s"
           onmouseover="this.style.background='rgba(99,102,241,.06)'"
           onmouseout="this.style.background='${expanded ? 'rgba(99,102,241,.05)' : 'transparent'}'">

        <!-- Empresa nombre -->
        <div style="flex:1;min-width:140px">
          <div style="font-weight:800;font-size:15px;color:var(--text-primary)">${nombre}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            ${total} trabajador${total !== 1 ? 'es' : ''} activos
          </div>
        </div>

        <!-- Barra progreso -->
        <div style="flex:2;min-width:160px">
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;
                      color:var(--text-muted);margin-bottom:4px">
            <span>✅ ${confirmados} confirmados</span>
            <span>⏳ ${pendientes} pendientes</span>
          </div>
          <div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColor};
                        border-radius:99px;transition:width .6s ease"></div>
          </div>
          <div style="font-size:10px;color:${barColor};font-weight:800;text-align:right;margin-top:2px">${pct}%</div>
        </div>

        <!-- Botones acción -->
        <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap" onclick="event.stopPropagation()">
          ${pendientes > 0 ? `
          <button onclick="window._asConfirmarEmpresa('${id}','${nombre.replace(/'/g, "\\'")}')"
            style="padding:8px 14px;border:none;border-radius:10px;
                   background:linear-gradient(135deg,#10b981,#059669);color:#fff;
                   font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap">
            ✅ Confirmar todos (${pendientes})
          </button>` : `
          <span style="padding:8px 14px;border-radius:10px;background:#d1fae5;
                       color:#065f46;font-weight:800;font-size:12px;white-space:nowrap">
            ✅ 100% confirmado
          </span>`}
          <button onclick="window._asExportEmpresa('${id}','${nombre.replace(/'/g, "\\'")}')"
            style="padding:8px 12px;border:1px solid var(--border);border-radius:10px;
                   background:var(--bg-card);color:var(--text-primary);
                   font-weight:700;font-size:12px;cursor:pointer">
            📥 Excel
          </button>
        </div>

        <!-- Flecha -->
        <div style="font-size:16px;color:#6366f1;transition:transform .25s;
                    transform:rotate(${expanded ? 90 : 0}deg);flex-shrink:0">&#9654;</div>
      </div>

      <!-- Lista trabajadores (expandible) -->
      <div id="${safeId}" style="display:${expanded ? 'block' : 'none'}">
        <div style="padding:0 16px 16px">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="padding:8px 10px;text-align:left;font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:10px">Nombre</th>
                <th style="padding:8px 10px;text-align:left;font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:10px">RUT</th>
                <th style="padding:8px 10px;text-align:center;font-weight:700;color:#10b981;text-transform:uppercase;font-size:10px">🏠 Hab.</th>
                <th style="padding:8px 10px;text-align:left;font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:10px">Cama</th>
                <th style="padding:8px 10px;text-align:center;font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:10px">Check-in</th>
                <th style="padding:8px 10px;text-align:center;font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:10px">Salida</th>
                <th style="padding:8px 10px;text-align:center;font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:10px">Estado</th>
                <th style="padding:8px 10px;text-align:center;font-weight:700;color:var(--text-muted);text-transform:uppercase;font-size:10px">Confirmar</th>
              </tr>
            </thead>
            <tbody>
              ${[...trabajadores]
                  .sort((a, b) => {
                      // ⏳ Pendientes primero, ✅ Confirmados al final
                      const pa = a.huesped_confirmo ? 1 : 0;
                      const pb = b.huesped_confirmo ? 1 : 0;
                      if (pa !== pb) return pa - pb;
                      // Dentro del mismo grupo: orden alfabético por nombre
                      return (a.nombre_huesped || '').localeCompare(b.nombre_huesped || '', 'es', { sensitivity: 'base' });
                  })
                  .map((a, i) => renderFila(a, i)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function renderFila(a, i) {
    // ── Worker sin asignación formal (solo en solicitudes) ──────────────────
    if (a._esSolicitud) {
        const fechaCi  = a.fecha_checkin  ? new Date(a.fecha_checkin).toLocaleDateString('es-CL')  : '—';
        const fechaSal = a.fecha_salida_programada ? new Date(a.fecha_salida_programada).toLocaleDateString('es-CL') : '—';
        const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(249,115,22,.03)';
        return `
    <tr style="border-bottom:1px solid var(--border);background:${rowBg}" id="fila-${a.id}">
      <td style="padding:9px 10px;font-weight:700;color:var(--text-primary)">${hl(a.nombre_huesped || '—', _busqueda)}</td>
      <td style="padding:9px 10px;font-family:monospace;color:var(--text-muted);font-size:11px">${hl(a.rut_huesped || '—', _busqueda)}</td>
      <td style="padding:9px 10px;text-align:center">
        <span style="background:rgba(249,115,22,0.12);color:#c2410c;font-weight:800;font-size:12px;padding:3px 10px;border-radius:8px;font-family:monospace">—</span>
      </td>
      <td style="padding:9px 10px;font-weight:700;color:#94a3b8">—</td>
      <td style="padding:9px 10px;text-align:center;color:var(--text-muted)">${fechaCi}</td>
      <td style="padding:9px 10px;text-align:center;color:var(--text-muted)">${fechaSal}</td>
      <td style="padding:9px 10px;text-align:center">
        <span style="background:#fff7ed;color:#c2410c;padding:2px 10px;border-radius:99px;font-size:10px;font-weight:800">⚠️ SIN CAMA</span>
      </td>
      <td style="padding:9px 10px;text-align:center">
        <span style="color:#94a3b8;font-size:10px">—</span>
      </td>
    </tr>`;
    }

    const confirmo = a.huesped_confirmo;
    const fechaCi  = a.fecha_checkin
        ? new Date(a.fecha_checkin).toLocaleDateString('es-CL')
        : '—';
    const fechaSal = a.fecha_salida_programada
        ? new Date(a.fecha_salida_programada).toLocaleDateString('es-CL')
        : '—';

    // Timestamp de confirmación (updated_at si confirmado)
    const tsConfirmo = confirmo && a.updated_at
        ? new Date(a.updated_at).toLocaleString('es-CL', {
            day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
          })
        : null;

    const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(99,102,241,.03)';

    return `
    <tr style="border-bottom:1px solid var(--border);background:${rowBg}" id="fila-${a.id}">
      <td style="padding:9px 10px;font-weight:700;color:var(--text-primary)">${hl(a.nombre_huesped || '—', _busqueda)}</td>
      <td style="padding:9px 10px;font-family:monospace;color:var(--text-muted);font-size:11px">${hl(a.rut_huesped || '—', _busqueda)}</td>
      <td style="padding:9px 10px;text-align:center">
        <span style="background:rgba(16,185,129,0.12);color:#059669;font-weight:800;font-size:12px;padding:3px 10px;border-radius:8px;font-family:monospace">${a.v2_camas?.v2_habitaciones?.numero_hab || '—'}</span>
      </td>
      <td style="padding:9px 10px;font-weight:700;color:#6366f1">${a.id_cama || '—'}</td>
      <td style="padding:9px 10px;text-align:center;color:var(--text-muted)">${fechaCi}</td>
      <td style="padding:9px 10px;text-align:center;color:var(--text-muted)">${fechaSal}</td>
      <td style="padding:9px 10px;text-align:center">
        ${confirmo
          ? `<div>
               <span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:99px;font-size:10px;font-weight:800">✅ CONFIRMADO</span>
               ${tsConfirmo ? `<div style="font-size:9px;color:var(--text-muted);margin-top:2px">${tsConfirmo}</div>` : ''}
             </div>`
          : `<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:99px;font-size:10px;font-weight:800">⏳ PENDIENTE</span>`
        }
      </td>
      <td style="padding:9px 10px;text-align:center">
        ${!confirmo
          ? `<button onclick="window._asConfirmarUno('${a.id}')"
               style="padding:5px 12px;border:none;border-radius:8px;background:#10b981;color:#fff;
                      font-weight:700;font-size:11px;cursor:pointer">
               ✅ Confirmar
             </button>`
          : `<span style="color:#94a3b8;font-size:11px">—</span>`
        }
      </td>
    </tr>`;
}

// ── Render principal ──────────────────────────────────────────────────────────
export async function renderV2Asistencia(container) {
    container.innerHTML = `
    <div style="padding:20px;max-width:1300px;margin:0 auto">
      <!-- TABS -->
      <div style="display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid var(--border)">
        <button id="tab-activos" onclick="window._asMainTab('activos')" style="padding:10px 22px;border:none;background:transparent;font-weight:800;font-size:13px;cursor:pointer;color:#6366f1;border-bottom:3px solid #6366f1;margin-bottom:-2px">📋 Activos</button>
        <button id="tab-historial" onclick="window._asMainTab('historial')" style="padding:10px 22px;border:none;background:transparent;font-weight:700;font-size:13px;cursor:pointer;color:var(--text-muted);border-bottom:3px solid transparent;margin-bottom:-2px">📈 Historial Semanal</button>
        <button id="tab-ocupabilidad" onclick="window._asMainTab('ocupabilidad')" style="padding:10px 22px;border:none;background:transparent;font-weight:700;font-size:13px;cursor:pointer;color:var(--text-muted);border-bottom:3px solid transparent;margin-bottom:-2px">📊 Ocupabilidad</button>
      </div>
      <div id="panel-activos">

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);border-radius:14px;
                    width:48px;height:48px;display:flex;align-items:center;justify-content:center;
                    font-size:22px;flex-shrink:0">📋</div>
        <div>
          <h1 style="font-size:20px;font-weight:800;margin:0;color:var(--text-primary)">Control de Asistencia</h1>
          <p style="font-size:12px;color:var(--text-secondary);margin:0">
            Check-ins por empresa · Confirmaciones en tiempo real
          </p>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="window._asRecargar()"
            style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;
                   padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary)">
            🔄 Actualizar
          </button>
          <button onclick="window._asExportTodo()"
            style="background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;border-radius:10px;
                   padding:10px 16px;cursor:pointer;font-size:13px;font-weight:700;color:#fff">
            📥 Excel Completo
          </button>
        </div>
      </div>

      <!-- KPIs -->
      <div id="as-kpis"></div>

      <!-- Filtros -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <div style="display:flex;gap:6px;flex-wrap:wrap" id="as-filtros">
          <button id="asf-todos" onclick="window._asFiltro('todos')"
            style="padding:8px 16px;border-radius:10px;border:2px solid #6366f1;background:#6366f1;color:#fff;font-weight:700;font-size:12px;cursor:pointer">
            📊 Todos
          </button>
          <button id="asf-confirmados" onclick="window._asFiltro('confirmados')"
            style="padding:8px 16px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-weight:700;font-size:12px;cursor:pointer">
            ✅ Confirmados
          </button>
          <button id="asf-pendientes" onclick="window._asFiltro('pendientes')"
            style="padding:8px 16px;border-radius:10px;border:2px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-weight:700;font-size:12px;cursor:pointer">
            ⏳ Pendientes
          </button>
        </div>
        <!-- Buscador mejorado -->
        <div style="position:relative;flex:1;min-width:220px">
          <input id="as-search" placeholder="🔍 Buscar por nombre o RUT…"
            oninput="window._asBuscar(this.value);document.getElementById('as-clear').style.display=this.value?'flex':'none'"
            onkeydown="if(event.key==='Escape'){this.value='';window._asBuscar('');document.getElementById('as-clear').style.display='none'}"
            style="width:100%;box-sizing:border-box;padding:9px 36px 9px 14px;border-radius:10px;border:1.5px solid var(--border);
                   background:var(--bg);color:var(--text-primary);font-size:13px;outline:none">
          <button id="as-clear" onclick="document.getElementById('as-search').value='';window._asBuscar('');this.style.display='none'"
            style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);
                   background:var(--text-muted);color:#fff;border:none;border-radius:50%;
                   width:20px;height:20px;font-size:12px;cursor:pointer;align-items:center;justify-content:center;font-weight:900">
            ×
          </button>
        </div>
        <button onclick="window._asExpandirTodo()"
          style="padding:8px 14px;border-radius:10px;border:1.5px solid var(--border);
                 background:var(--bg-card);color:var(--text-primary);font-weight:600;font-size:12px;cursor:pointer">
          🔽 Expandir todo
        </button>
        <button onclick="window._asColapsarTodo()"
          style="padding:8px 14px;border-radius:10px;border:1.5px solid var(--border);
                 background:var(--bg-card);color:var(--text-primary);font-weight:600;font-size:12px;cursor:pointer">
          🔼 Colapsar todo
        </button>
      </div>
      <!-- Resultado de búsqueda -->
      <div id="as-search-info" style="display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;
           padding:8px 14px;font-size:12px;font-weight:600;color:#1d4ed8;margin-bottom:12px"></div>

      <!-- Lista empresas -->
      <div id="as-lista">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando datos de asistencia…</div>
      </div>
      </div><!-- /panel-activos -->
      <div id="panel-historial" style="display:none">
        <div id="as-hist-content"><div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando historial…</div></div>
      </div>
      <div id="panel-ocupabilidad" style="display:none">
        <div id="as-ocup-content"><div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Cargando informe…</div></div>
      </div>
    </div>`;

    await _render();

    // Globales
    window._asRecargar       = async () => { await cargarDatos(); _renderLista(); };
    window._asToggle         = (id) => {
        if (_expandidos.has(id)) _expandidos.delete(id);
        else _expandidos.add(id);
        _renderLista();
    };
    window._asFiltro         = (f) => { _filtro = f; _actualizarBotonesFiltro(); _renderLista(); };
    window._asBuscar         = (q) => { _busqueda = q; _renderLista(); };
    window._asExpandirTodo   = () => {
        agruparPorEmpresa(filtrarDatos()).forEach(g => _expandidos.add(g.id));
        _renderLista();
    };
    window._asColapsarTodo   = () => { _expandidos.clear(); _renderLista(); };

    // 🔄 Escuchar rotación automática → recargar datos y re-renderizar
    if (!window._asRotListener) {
        window._asRotListener = async (e) => {
            if (!document.getElementById('as-lista')) return; // solo si el módulo está visible
            await cargarDatos();
            _renderLista();
        };
        window.addEventListener('rotacion-completada', window._asRotListener);
    }


    window._asConfirmarUno   = async (asigId) => {
        await supabase.from('v2_asignaciones').update({ huesped_confirmo: true }).eq('id', asigId);
        await logAudit('CONFIRMAR_CHECKIN', `Check-in confirmado manualmente: asig ${asigId}`, { asigId });
        // Actualizar en memoria sin recargar toda la BD
        const a = _datos.find(x => x.id == asigId);
        if (a) { a.huesped_confirmo = true; a.updated_at = new Date().toISOString(); }
        _renderLista();
    };

    window._asConfirmarEmpresa = async (empresaId, nombre) => {
        const pendientes = _datos
            .filter(a => (a.v2_empresas?.id || 'sin_empresa') === empresaId
                      && !a.huesped_confirmo
                      && !a._esSolicitud)   // excluir sintéticos (sin asignación formal)
            .map(a => a.id);
        if (!pendientes.length) { alert('No hay trabajadores con asignación formal pendiente de confirmar.'); return; }
        if (!confirm(`¿Confirmar check-in de ${pendientes.length} trabajadores de "${nombre}"?`)) return;

        // Actualizar en lotes de 50
        for (let i = 0; i < pendientes.length; i += 50) {
            const lote = pendientes.slice(i, i + 50);
            await supabase.from('v2_asignaciones')
                .update({ huesped_confirmo: true })
                .in('id', lote);
        }
        await logAudit('CONFIRMAR_EMPRESA',
            `Check-ins confirmados masivamente: ${pendientes.length} de "${nombre}"`,
            { empresa: nombre, cantidad: pendientes.length }
        );
        // Actualizar en memoria
        const ahora = new Date().toISOString();
        _datos.forEach(a => {
            if (pendientes.includes(a.id)) { a.huesped_confirmo = true; a.updated_at = ahora; }
        });
        _renderLista();
    };

    window._asExportEmpresa = (empresaId, nombre) => _exportarExcel(empresaId, nombre);
    window._asExportTodo    = () => _exportarExcel(null, 'Todas_Empresas');

    // ── Crear asignaciones faltantes para trabajadores en solicitudes ──────────
    window._asCrearPendientes = async (empresaNombre) => {
        const nombreNorm = (empresaNombre || '').toLowerCase().trim();
        const pendientes = _solicPend.filter(s =>
            (s.empresa || '').toLowerCase().includes(nombreNorm.split(' ')[0])
        );
        if (!pendientes.length) return;
        if (!confirm(`¿Crear asignaciones para ${pendientes.length} trabajadores de "${empresaNombre}" que tienen solicitud aceptada?`)) return;

        const hoy = new Date().toISOString().split('T')[0];
        let ok = 0, errores = [];

        for (const sol of pendientes) {
            try {
                // Buscar habitacion_id
                const { data: habRow } = await supabase
                    .from('v2_habitaciones').select('id_custom')
                    .eq('numero_hab', sol.hab_solicitada).maybeSingle();
                if (!habRow?.id_custom) throw new Error(`Hab. ${sol.hab_solicitada} no existe`);

                // Buscar cama libre
                const { data: camas } = await supabase
                    .from('v2_camas').select('id_cama')
                    .eq('habitacion_id', habRow.id_custom).eq('estado', 'Disponible').limit(1);
                if (!camas?.length) throw new Error(`Sin camas libres en hab. ${sol.hab_solicitada}`);
                const camaId = camas[0].id_cama;

                // Buscar empresa_id
                const { data: empRow } = await supabase
                    .from('v2_empresas').select('id')
                    .ilike('nombre', `%${(sol.empresa || '').split(' ')[0]}%`).limit(1).maybeSingle();

                const rutNorm = String(sol.rut_trabajador || '').replace(/\./g,'').toUpperCase().slice(0,12);
                const estadoAsig = sol.fecha_llegada && sol.fecha_llegada > hoy ? 'pre_asignado' : 'activa';

                const { error: errI } = await supabase.from('v2_asignaciones').insert({
                    id_cama: camaId, rut_huesped: rutNorm,
                    nombre_huesped: sol.nombre_trabajador,
                    empresa_id: empRow?.id || null,
                    fecha_checkin: sol.fecha_llegada || hoy,
                    fecha_salida_programada: sol.fecha_salida || null,
                    estado_asignacion: estadoAsig,
                    huesped_confirmo: false, autorizado_checkin: false,
                });
                if (errI) throw new Error(errI.message);
                await supabase.from('v2_camas').update({ estado: estadoAsig === 'activa' ? 'Ocupada' : 'Disponible' }).eq('id_cama', camaId).neq('estado', 'Deshabilitada');
                ok++;
            } catch(e) {
                errores.push(`${sol.nombre_trabajador}: ${e.message}`);
            }
        }

        const resumen = `✅ ${ok} asignaciones creadas${errores.length ? ` · ❌ ${errores.length} errores:\n${errores.join('\n')}` : ''}`;
        alert(resumen);
        // Recargar para reflejar los cambios
        await cargarDatos();
        _renderLista();
    };
}

// ── Render lista ──────────────────────────────────────────────────────────────
async function _render() {
    try {
        await cargarDatos();
        _renderLista();
    } catch (e) {
        const el = document.getElementById('as-lista');
        if (el) el.innerHTML = `<div style="color:#ef4444;text-align:center;padding:24px">❌ ${e.message}</div>`;
    }
}

function _renderLista() {
    const filtrados = filtrarDatos();
    const grupos    = agruparPorEmpresa(filtrados);

    // KPIs
    const kpisEl = document.getElementById('as-kpis');
    if (kpisEl) kpisEl.innerHTML = renderKpis(grupos);

    const lista = document.getElementById('as-lista');
    if (!lista) return;

    // Mostrar contador de resultados si hay búsqueda activa
    const searchInfo = document.getElementById('as-search-info');
    if (searchInfo) {
        if (_busqueda) {
            searchInfo.style.display = 'block';
            searchInfo.innerHTML = `🔍 <strong>${filtrados.length}</strong> resultado${filtrados.length !== 1 ? 's' : ''} para "<em>${_busqueda}</em>"` +
                ` en ${grupos.length} empresa${grupos.length !== 1 ? 's' : ''}`;
        } else {
            searchInfo.style.display = 'none';
        }
    }

    if (!grupos.length) {
        lista.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">
            ${_busqueda
                ? `🔍 Sin resultados para «<strong>${_busqueda}</strong>». Verifica el nombre o RUT.`
                : '✅ Sin resultados para el filtro seleccionado'}
        </div>`;
        return;
    }
    lista.innerHTML = grupos.map(g => renderEmpresaCard(g)).join('');
}

function _actualizarBotonesFiltro() {
    ['todos','confirmados','pendientes'].forEach(f => {
        const btn = document.getElementById(`asf-${f}`);
        if (!btn) return;
        const activo = f === _filtro;
        btn.style.background   = activo ? '#6366f1' : 'var(--bg-card)';
        btn.style.color        = activo ? '#fff'    : 'var(--text-primary)';
        btn.style.borderColor  = activo ? '#6366f1' : 'var(--border)';
    });
}

// ── Exportar Excel ─────────────────────────────────────────────────────────────
async function _exportarExcel(empresaId, nombre) {
    if (!window.XLSX) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }
    const XLSX = window.XLSX;
    const hoy  = new Date().toISOString().split('T')[0];

    let rows = _datos;
    if (empresaId) rows = rows.filter(a => (a.v2_empresas?.id || 'sin_empresa') === empresaId);

    const headers = ['Empresa','Nombre','RUT','Habitación','Cama','Check-in','Salida Prog.','Confirmado','Hora Confirmación'];
    const data = rows.map(a => [
        a.v2_empresas?.nombre || '—',
        a.nombre_huesped || '—',
        a.rut_huesped || '—',
        a.v2_camas?.v2_habitaciones?.numero_hab || '—',
        a.id_cama || '—',
        a.fecha_checkin || '—',
        a.fecha_salida_programada || '—',
        a.huesped_confirmo ? 'SÍ' : 'NO',
        a.huesped_confirmo && a.updated_at
            ? new Date(a.updated_at).toLocaleString('es-CL') : '—',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

    // Estilo cabecera
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
        if (cell) cell.s = {
            font:      { bold: true, color: { rgb: 'FFFFFF' } },
            fill:      { fgColor: { rgb: '4F46E5' } },
            alignment: { horizontal: 'center' },
        };
    }
    // Filas alternas
    for (let R = 1; R <= data.length; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
            if (cell && R % 2 === 0) cell.s = { fill: { fgColor: { rgb: 'F0F4FF' } } };
            // Celda confirmado coloreada
            if (cell && C === 7) {
                const conf = data[R-1][7] === 'SÍ';
                cell.s = { font: { bold: true, color: { rgb: conf ? '065F46' : '92400E' } } };
            }
        }
    }
    ws['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 13 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');
    XLSX.writeFile(wb, `Asistencia_${nombre.replace(/\s+/g,'_')}_${hoy}.xlsx`);
}

// ── Historial Semanal ─────────────────────────────────────────────────────────
let _tabActual = 'activos';

function semanaISO(fechaStr) {
    const d = new Date(fechaStr); d.setHours(0,0,0,0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const w = new Date(d.getFullYear(), 0, 4);
    const num = 1 + Math.round(((d - w) / 86400000 - 3 + (w.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-S${String(num).padStart(2,'0')}`;
}

function rangoSemana(semana) {
    const [yr, sw] = semana.split('-S');
    const base = new Date(Number(yr), 0, 1 + (Number(sw) - 1) * 7);
    const lunes = new Date(base); lunes.setDate(base.getDate() - base.getDay() + 1);
    const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
    const fmt = d => d.toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit' });
    return `${fmt(lunes)} al ${fmt(domingo)}`;
}

async function cargarHistorial() {
    const PAGE = 1000; let all = [], page = 0;
    while (true) {
        const { data, error } = await supabase
            .from('v2_asignaciones')
            .select('id,huesped_confirmo,fecha_checkin,v2_empresas(nombre)')
            .order('fecha_checkin', { ascending: false })
            .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        if (data?.length) all = all.concat(data);
        if (!data || data.length < PAGE) break;
        page++; if (page > 30) break;
    }
    return all;
}

async function renderHistorial() {
    const el = document.getElementById('as-hist-content');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)">⏳ Calculando historial…</div>';
    try {
        const todos = await cargarHistorial();
        const mapa = {};
        todos.forEach(a => {
            if (!a.fecha_checkin) return;
            const sem = semanaISO(a.fecha_checkin);
            const emp = a.v2_empresas?.nombre || '— Sin empresa —';
            if (!mapa[sem]) mapa[sem] = {};
            if (!mapa[sem][emp]) mapa[sem][emp] = { total:0, conf:0 };
            mapa[sem][emp].total++;
            if (a.huesped_confirmo) mapa[sem][emp].conf++;
        });
        const semanas = Object.keys(mapa).sort().reverse();
        if (!semanas.length) { el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">Sin historial disponible</div>'; return; }

        el.innerHTML = semanas.map(sem => {
            const empresas = Object.entries(mapa[sem]).sort((a,b) => b[1].total - a[1].total);
            const totSem  = empresas.reduce((s,[,v]) => s + v.total, 0);
            const confSem = empresas.reduce((s,[,v]) => s + v.conf, 0);
            const pctSem  = totSem > 0 ? Math.round(confSem/totSem*100) : 0;
            const color   = pctSem>=80?'#10b981':pctSem>=50?'#f59e0b':'#ef4444';
            const detId   = 'hist-' + sem.replace(/\W/g,'_');
            return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;margin-bottom:10px;overflow:hidden">
              <div onclick="var d=document.getElementById('${detId}');d.style.display=d.style.display==='none'?'block':'none'"
                   style="padding:14px 20px;cursor:pointer;display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-left:4px solid ${color}">
                <div style="flex:1;min-width:140px">
                  <div style="font-weight:800;font-size:14px">📅 ${sem} <span style="font-size:11px;color:var(--text-muted);font-weight:600">(${rangoSemana(sem)})</span></div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${empresas.length} empresas · ${totSem} trabajadores totales</div>
                </div>
                <div style="flex:2;min-width:180px">
                  <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px">
                    <span>✅ ${confSem}</span><span>⏳ ${totSem-confSem}</span>
                  </div>
                  <div style="height:10px;background:var(--border);border-radius:99px;overflow:hidden">
                    <div style="height:100%;width:${pctSem}%;background:${color};border-radius:99px"></div>
                  </div>
                  <div style="font-size:11px;color:${color};font-weight:800;text-align:right;margin-top:2px">${pctSem}% confirmación</div>
                </div>
                <div style="font-size:14px;color:#6366f1">&#9654;</div>
              </div>
              <div id="${detId}" style="display:none;padding:0 16px 14px">
                ${empresas.map(([emp,v]) => {
                    const p = v.total>0?Math.round(v.conf/v.total*100):0;
                    const c2 = p===100?'#10b981':p>=50?'#f59e0b':'#ef4444';
                    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
                      <div style="min-width:180px;font-weight:700;font-size:12px">${emp}</div>
                      <div style="font-size:11px;color:var(--text-muted);min-width:90px">${v.conf}/${v.total}</div>
                      <div style="flex:1;min-width:100px;height:7px;background:var(--border);border-radius:99px;overflow:hidden">
                        <div style="height:100%;width:${p}%;background:${c2};border-radius:99px"></div>
                      </div>
                      <div style="font-weight:800;font-size:12px;color:${c2};min-width:38px;text-align:right">${p}%</div>
                    </div>`;
                }).join('')}
              </div>
            </div>`;
        }).join('');
    } catch(e) {
        if (el) el.innerHTML = `<div style="color:#ef4444;text-align:center;padding:24px">❌ ${e.message}</div>`;
    }
}

window._asMainTab = (tab) => {
    _tabActual = tab;
    const pa = document.getElementById('panel-activos');
    const ph = document.getElementById('panel-historial');
    const po = document.getElementById('panel-ocupabilidad');
    if (pa) pa.style.display = tab==='activos'      ? 'block' : 'none';
    if (ph) ph.style.display = tab==='historial'    ? 'block' : 'none';
    if (po) po.style.display = tab==='ocupabilidad' ? 'block' : 'none';
    const tabs = ['activos','historial','ocupabilidad'];
    tabs.forEach(t => {
        const btn = document.getElementById('tab-' + t);
        if (!btn) return;
        const on = t === tab;
        btn.style.color             = on ? '#6366f1' : 'var(--text-muted)';
        btn.style.borderBottomColor = on ? '#6366f1' : 'transparent';
        btn.style.fontWeight        = on ? '800' : '700';
    });
    if (tab==='historial')    renderHistorial();
    if (tab==='ocupabilidad') renderOcupabilidad();
};

// ── Informe de Ocupabilidad por Empresa ───────────────────────────────────────
async function renderOcupabilidad() {
    const el = document.getElementById('as-ocup-content');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">⏳ Calculando ocupabilidad…</div>';

    try {
        // 1. Cupos solicitados por empresa (v2_solicitudes_b2b agrupados)
        const PAGE = 1000; let solAll = [], sp = 0;
        while (true) {
            const { data, error } = await supabase
                .from('v2_solicitudes_b2b')
                .select('empresa, fecha_llegada, fecha_salida, status')
                .range(sp * PAGE, sp * PAGE + PAGE - 1);
            if (error) throw error;
            if (data?.length) solAll = solAll.concat(data);
            if (!data || data.length < PAGE) break;
            sp++; if (sp > 20) break;
        }

        // 2. Asignaciones activas + históricas por empresa
        let asigAll = [], ap = 0;
        while (true) {
            const { data, error } = await supabase
                .from('v2_asignaciones')
                .select('empresa_id, fecha_checkin, fecha_salida_programada, v2_empresas(nombre)')
                .range(ap * PAGE, ap * PAGE + PAGE - 1);
            if (error) throw error;
            if (data?.length) asigAll = asigAll.concat(data);
            if (!data || data.length < PAGE) break;
            ap++; if (ap > 20) break;
        }

        // 3. Agrupar solicitudes por empresa + mes
        const solPorEmpMes = {};  // { empresa: { '2026-05': { solicitados, status } } }
        solAll.forEach(s => {
            const emp = (s.empresa || '— Sin empresa —').trim();
            const mes = (s.fecha_llegada || '').substring(0, 7); // YYYY-MM
            if (!mes) return;
            if (!solPorEmpMes[emp]) solPorEmpMes[emp] = {};
            if (!solPorEmpMes[emp][mes]) solPorEmpMes[emp][mes] = { solicitados: 0, aceptadas: 0 };
            solPorEmpMes[emp][mes].solicitados++;
            if (s.status === 'aceptada' || s.status === 'aceptada_asignada') solPorEmpMes[emp][mes].aceptadas++;
        });

        // 4. Agrupar asignaciones por empresa + mes (llegadas reales)
        const asigPorEmpMes = {};  // { empresaNombre: { '2026-05': llegados } }
        asigAll.forEach(a => {
            const emp = (a.v2_empresas?.nombre || '— Sin empresa —').trim();
            const mes = (a.fecha_checkin || '').substring(0, 7);
            if (!mes) return;
            if (!asigPorEmpMes[emp]) asigPorEmpMes[emp] = {};
            asigPorEmpMes[emp][mes] = (asigPorEmpMes[emp][mes] || 0) + 1;
        });

        // 5. Unir para comparar solicitados vs. llegados
        const empresasSet = new Set([...Object.keys(solPorEmpMes), ...Object.keys(asigPorEmpMes)]);
        const empArray = [...empresasSet].sort();

        if (!empArray.length) {
            el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">Sin datos disponibles</div>';
            return;
        }

        // Totales globales para KPIs
        const totalSol   = solAll.length;
        const totalLleg  = asigAll.length;
        const globalPct  = totalSol > 0 ? Math.round(totalLleg / totalSol * 100) : 0;
        const globalColor = globalPct >= 90 ? '#10b981' : globalPct >= 70 ? '#f59e0b' : '#ef4444';

        el.innerHTML = `
        <!-- KPI globales -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px">
          ${kpiCard('📋','Cupos Solicitados', totalSol, '#6366f1')}
          ${kpiCard('👥','Trabajadores Llegados', totalLleg, '#3b82f6')}
          ${kpiCard('📊','Tasa Ocupación', globalPct+'%', globalColor)}
          ${kpiCard('🏢','Empresas', empArray.length, '#f59e0b')}
        </div>

        <!-- Informe por empresa -->
        <div style="display:flex;flex-direction:column;gap:10px">
          ${empArray.map(emp => {
            const mesSol  = solPorEmpMes[emp]  || {};
            const mesAsig = asigPorEmpMes[emp] || {};
            const mesesSet = new Set([...Object.keys(mesSol), ...Object.keys(mesAsig)]);
            const meses = [...mesesSet].sort();

            const totSol  = meses.reduce((s,m) => s + (mesSol[m]?.solicitados || 0), 0);
            const totLleg = meses.reduce((s,m) => s + (mesAsig[m] || 0), 0);
            const pct     = totSol > 0 ? Math.round(totLleg / totSol * 100) : 0;
            const diff    = totLleg - totSol;
            const color   = pct >= 90 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444';
            const safeId  = 'ocup-' + emp.replace(/[^a-zA-Z0-9]/g,'_');

            const mesRows = meses.map(m => {
                const sol  = mesSol[m]?.solicitados || 0;
                const lleg = mesAsig[m] || 0;
                const mp   = sol > 0 ? Math.round(lleg / sol * 100) : (lleg > 0 ? 100 : 0);
                const mc   = mp >= 90 ? '#10b981' : mp >= 70 ? '#f59e0b' : '#ef4444';
                const [yr, mn] = m.split('-');
                const mesNombre = new Date(Number(yr), Number(mn)-1, 1)
                    .toLocaleDateString('es-CL', { month:'long', year:'numeric' });
                const difMes = lleg - sol;
                return `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:7px 12px;font-size:11px;color:var(--text-muted);text-transform:capitalize;min-width:120px">${mesNombre}</td>
                  <td style="padding:7px 12px;text-align:center;font-weight:700;font-size:12px;color:#6366f1">${sol}</td>
                  <td style="padding:7px 12px;text-align:center;font-weight:700;font-size:12px;color:#3b82f6">${lleg}</td>
                  <td style="padding:7px 12px;min-width:140px">
                    <div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">
                      <div style="height:100%;width:${Math.min(mp,100)}%;background:${mc};border-radius:99px"></div>
                    </div>
                  </td>
                  <td style="padding:7px 12px;text-align:center;font-weight:800;font-size:12px;color:${mc}">${mp}%</td>
                  <td style="padding:7px 12px;text-align:center;font-size:12px;font-weight:700;color:${difMes>=0?'#10b981':'#ef4444'}">
                    ${difMes >= 0 ? '+' : ''}${difMes}
                  </td>
                </tr>`;
            }).join('');

            return `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden">
              <!-- Cabecera empresa -->
              <div onclick="var d=document.getElementById('${safeId}');d.style.display=d.style.display==='none'?'block':'none'"
                   style="padding:16px 20px;cursor:pointer;display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-left:4px solid ${color}">
                <div style="flex:1;min-width:140px">
                  <div style="font-weight:800;font-size:15px;color:var(--text-primary)">${emp}</div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                    <span style="color:#6366f1;font-weight:700">${totSol}</span> solicitados &nbsp;·&nbsp;
                    <span style="color:#3b82f6;font-weight:700">${totLleg}</span> llegaron
                    ${diff !== 0 ? `&nbsp;·&nbsp;<span style="color:${diff>=0?'#10b981':'#ef4444'};font-weight:800">${diff>=0?'+':''}${diff}</span>` : ''}
                  </div>
                </div>
                <!-- Barra general -->
                <div style="flex:2;min-width:200px">
                  <div style="height:12px;background:var(--border);border-radius:99px;overflow:hidden;position:relative">
                    <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};border-radius:99px;transition:width .6s"></div>
                  </div>
                  <div style="display:flex;justify-content:space-between;margin-top:4px">
                    <span style="font-size:10px;color:var(--text-muted)">0%</span>
                    <span style="font-size:11px;font-weight:800;color:${color}">${pct}% ocupación</span>
                    <span style="font-size:10px;color:var(--text-muted)">100%</span>
                  </div>
                </div>
                <div style="font-size:14px;color:#6366f1">&#9654;</div>
              </div>
              <!-- Detalle por mes -->
              <div id="${safeId}" style="display:none;padding:0 16px 14px">
                <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
                  <thead>
                    <tr style="border-bottom:2px solid var(--border)">
                      <th style="padding:6px 12px;text-align:left;font-weight:700;color:var(--text-muted);font-size:10px;text-transform:uppercase">Mes</th>
                      <th style="padding:6px 12px;text-align:center;font-weight:700;color:#6366f1;font-size:10px;text-transform:uppercase">Solicitados</th>
                      <th style="padding:6px 12px;text-align:center;font-weight:700;color:#3b82f6;font-size:10px;text-transform:uppercase">Llegaron</th>
                      <th style="padding:6px 12px;font-size:10px;text-transform:uppercase;color:var(--text-muted)">Ocupación</th>
                      <th style="padding:6px 12px;text-align:center;font-size:10px;text-transform:uppercase;color:var(--text-muted)">%</th>
                      <th style="padding:6px 12px;text-align:center;font-size:10px;text-transform:uppercase;color:var(--text-muted)">Diff.</th>
                    </tr>
                  </thead>
                  <tbody>${mesRows}</tbody>
                </table>
              </div>
            </div>`;
          }).join('')}
        </div>`;

    } catch(e) {
        if (el) el.innerHTML = `<div style="color:#ef4444;text-align:center;padding:24px">❌ ${e.message}</div>`;
    }
}
