/**
 * v2-service.js — Capa de datos centralizada V2
 * FUENTE DE VERDAD: solo tablas con prefijo v2_
 * Todos los módulos deben importar desde aquí.
 */
import { supabase } from '../supabaseClient.js';

// ─────────────────────────────────────────────────────────────────
//  UTILIDAD: paginación estable (evita límite de 1000 filas)
// ─────────────────────────────────────────────────────────────────
export async function fetchAll(table, select, orderCol) {
    const PAGE = 900;
    let offset = 0, all = [];
    while (true) {
        const { data, error } = await supabase
            .from(table).select(select)
            .order(orderCol)
            .range(offset, offset + PAGE - 1);
        if (error) throw new Error(`[v2-service] ${table}: ${error.message}`);
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        offset += PAGE;
    }
    return all;
}

// ─────────────────────────────────────────────────────────────────
//  INFRAESTRUCTURA
// ─────────────────────────────────────────────────────────────────
export async function getEdificios() {
    const { data, error } = await supabase
        .from('v2_edificios').select('id,nombre').order('nombre');
    if (error) throw new Error('[v2-service] v2_edificios: ' + error.message);
    return data || [];
}

export async function getPabellones(edificioId) {
    const q = supabase.from('v2_pabellones').select('id,nombre,edificio_id').order('nombre');
    if (edificioId) q.eq('edificio_id', edificioId);
    const { data, error } = await q;
    if (error) throw new Error('[v2-service] v2_pabellones: ' + error.message);
    return data || [];
}

export async function getHabitaciones(pabellonId) {
    const { data, error } = await supabase
        .from('v2_habitaciones')
        .select('id_custom,numero_hab,nivel,cantidad_camas,pabellon_id')
        .eq('pabellon_id', pabellonId)
        .order('numero_hab');
    if (error) throw new Error('[v2-service] v2_habitaciones: ' + error.message);
    return data || [];
}

export async function getCamas(habitacionId) {
    try {
        const { data, error } = await supabase
            .from('v2_camas')
            .select('id_cama,habitacion_id,estado,v2_asignaciones(huesped_confirmo,fecha_checkout,numero_contrato,nombre_huesped,v2_empresas(nombre,v2_gerencias(nombre)))')
            .eq('habitacion_id', habitacionId)
            .order('id_cama');
        if (error) throw error;
        return (data || []).map(c => {
            const asigs = c.v2_asignaciones || [];
            const asigActiva   = asigs.find(a => !a.fecha_checkout && a.estado_asignacion === 'activa');
            const asigEntrante = asigs.find(a => !a.fecha_checkout && a.estado_asignacion === 'pre_asignado')
                              || asigs.find(a => !a.fecha_checkout && !a.estado_asignacion); // compatibilidad
            return {
                id_cama:          c.id_cama,
                habitacion_id:    c.habitacion_id,
                estado:           c.estado,
                huesped_confirmo: asigActiva?.huesped_confirmo ?? false,
                empresa:          asigActiva?.v2_empresas?.nombre || null,
                gerencia:         asigActiva?.v2_empresas?.v2_gerencias?.nombre || null,
                nombre_huesped:   asigActiva?.nombre_huesped || null,
                numero_contrato:  asigActiva?.numero_contrato || null,
                // Rotación: trabajador entrante pre-asignado
                tieneRotacion:    !!asigEntrante,
                entrante:         asigEntrante ? {
                    nombre:   asigEntrante.nombre_huesped,
                    fecha:    asigEntrante.fecha_checkin,
                    empresa:  asigEntrante.v2_empresas?.nombre || null,
                } : null,
            };
        });
    } catch(_) {
        const { data, error } = await supabase
            .from('v2_camas')
            .select('id_cama,habitacion_id,estado')
            .eq('habitacion_id', habitacionId)
            .order('id_cama');
        if (error) throw new Error('[v2-service] v2_camas: ' + error.message);
        return (data || []).map(c => ({ ...c, huesped_confirmo: false, empresa: null, numero_contrato: null }));
    }
}

export async function getCamasDisponibles(habitacionId) {
    const { data, error } = await supabase
        .from('v2_camas')
        .select('id_cama')
        .eq('habitacion_id', habitacionId)
        .eq('estado', 'Disponible')
        .order('id_cama');
    if (error) throw new Error('[v2-service] v2_camas disponibles: ' + error.message);
    return data || [];
}

export async function getAsignacionByCama(idCama) {
    // Retorna { actual, entrante } — puede haber 1 activo + 1 pre_asignado
    const { data, error } = await supabase
        .from('v2_asignaciones')
        .select('id,rut_huesped,nombre_huesped,fecha_checkin,fecha_salida_programada,numero_contrato,telefono,estado_asignacion,v2_empresas(id,nombre,turno,gerencia_id,v2_gerencias(nombre))')
        .eq('id_cama', idCama)
        .is('fecha_checkout', null)
        .in('estado_asignacion', ['activa', 'pre_asignado'])
        .order('estado_asignacion'); // 'activa' antes que 'pre_asignado'
    if (error) throw new Error('[v2-service] asignacion by cama: ' + error.message);
    const rows = data || [];
    return {
        actual:    rows.find(r => r.estado_asignacion === 'activa')    || null,
        entrante:  rows.find(r => r.estado_asignacion === 'pre_asignado') || null,
    };
}

/** Chequea si una cama tiene conflicto de fechas para una nueva llegada */
export async function checkConflictoFechas(idCama, fechaLlegadaNueva) {
    const { data } = await supabase
        .from('v2_asignaciones')
        .select('id,nombre_huesped,fecha_salida_programada,estado_asignacion')
        .eq('id_cama', idCama)
        .is('fecha_checkout', null)
        .in('estado_asignacion', ['activa', 'pre_asignado']);
    const rows = data || [];
    if (rows.length === 0) return { ok: true, libre: true };

    const llegada = new Date(fechaLlegadaNueva);
    for (const r of rows) {
        if (!r.fecha_salida_programada) {
            return { ok: false, razon: `${r.nombre_huesped} ocupa esta cama sin fecha de salida definida.` };
        }
        const salida = new Date(r.fecha_salida_programada);
        // Conflicto: el nuevo llega ANTES de que salga el actual
        if (llegada < salida) {
            return {
                ok: false,
                razon: `${r.nombre_huesped} está hasta el ${r.fecha_salida_programada}. El nuevo llegaría el ${fechaLlegadaNueva} — se toparían.`
            };
        }
    }
    // La nueva llegada es >= a la salida del actual → pre-asignación válida
    return { ok: true, libre: false, esPreAsignacion: true };
}

// ─────────────────────────────────────────────────────────────────
//  OCUPACIÓN GLOBAL (sin RPC — queries directas paginadas)
// ─────────────────────────────────────────────────────────────────
export async function getReporteOcupacion() {
    const [edificios, pabellones, habitaciones, camas] = await Promise.all([
        fetchAll('v2_edificios',    'id,nombre',                            'nombre'),
        fetchAll('v2_pabellones',   'id,nombre,edificio_id',                'nombre'),
        fetchAll('v2_habitaciones', 'id_custom,pabellon_id,cantidad_camas', 'id_custom'),
        fetchAll('v2_camas',        'id_cama,habitacion_id,estado',         'id_cama')
    ]);

    // Índices
    const pabByEdif  = {};
    pabellones.forEach(p => {
        if (!pabByEdif[p.edificio_id]) pabByEdif[p.edificio_id] = [];
        pabByEdif[p.edificio_id].push(p);
    });
    const habByPab = {};
    habitaciones.forEach(h => {
        if (!habByPab[h.pabellon_id]) habByPab[h.pabellon_id] = [];
        habByPab[h.pabellon_id].push(h);
    });
    const camasByHab = {};
    camas.forEach(c => {
        if (!camasByHab[c.habitacion_id]) camasByHab[c.habitacion_id] = [];
        camasByHab[c.habitacion_id].push(c);
    });

    const reporte = edificios.map(edif => {
        const pabs = pabByEdif[edif.id] || [];
        let total = 0, ocup = 0, disp = 0, mant = 0;
        pabs.forEach(p => {
            (habByPab[p.id] || []).forEach(h => {
                (camasByHab[h.id_custom] || []).forEach(c => {
                    total++;
                    if (c.estado === 'Ocupada')       ocup++;
                    else if (c.estado === 'Mantencion') mant++;
                    else                               disp++;
                });
            });
        });
        return { edificio: edif.nombre, total_camas: total, camas_ocupadas: ocup, camas_disponibles: disp, camas_mantencion: mant };
    });

    const totales = {
        total_camas:       reporte.reduce((s, r) => s + r.total_camas, 0),
        camas_ocupadas:    reporte.reduce((s, r) => s + r.camas_ocupadas, 0),
        camas_disponibles: reporte.reduce((s, r) => s + r.camas_disponibles, 0),
        camas_mantencion:  reporte.reduce((s, r) => s + r.camas_mantencion, 0),
    };

    return { reporte, totales };
}

// ─────────────────────────────────────────────────────────────────
//  EMPRESAS Y GERENCIAS
// ─────────────────────────────────────────────────────────────────
export async function getEmpresas() {
    const { data, error } = await supabase
        .from('v2_empresas')
        .select('id,nombre,turno,gerencia_id,v2_gerencias(nombre)')
        .order('nombre');
    if (error) throw new Error('[v2-service] v2_empresas: ' + error.message);
    return data || [];
}

/**
 * getEmpresasConOcupacion — Portal Empresas
 * Cruza v2_empresas con conteo de asignaciones activas en v2_asignaciones.
 * supabase.from('v2_empresas').select('*, v2_gerencias(nombre)')
 *   + count activos de v2_asignaciones por empresa_id
 */
export async function getEmpresasConOcupacion() {
    const [{ data: empresas, error: errEmp }, { data: activas, error: errAsig }] = await Promise.all([
        supabase.from('v2_empresas').select('id,nombre,turno,gerencia_id,v2_gerencias(nombre)').order('nombre'),
        supabase.from('v2_asignaciones').select('empresa_id').is('fecha_checkout', null),
    ]);
    if (errEmp)  throw new Error('[v2-service] v2_empresas: '     + errEmp.message);
    if (errAsig) throw new Error('[v2-service] v2_asignaciones: ' + errAsig.message);

    // Contar asignaciones activas por empresa_id
    const conteo = {};
    (activas || []).forEach(a => {
        if (a.empresa_id) conteo[a.empresa_id] = (conteo[a.empresa_id] || 0) + 1;
    });

    return (empresas || []).map(e => ({
        ...e,
        camas_activas: conteo[e.id] || 0,
    }));
}

export async function getGerencias() {
    const { data, error } = await supabase
        .from('v2_gerencias').select('id,nombre').order('nombre');
    if (error) throw new Error('[v2-service] v2_gerencias: ' + error.message);
    return data || [];
}

export async function crearEmpresa({ nombre, turno, gerenciaId }) {
    const { data, error } = await supabase
        .from('v2_empresas')
        .insert({ nombre, turno: turno || null, gerencia_id: gerenciaId })
        .select().single();
    if (error) throw new Error('[v2-service] crear empresa: ' + error.message);
    return data;
}

export async function crearGerencia(nombre) {
    const { data, error } = await supabase
        .from('v2_gerencias').insert({ nombre }).select().single();
    if (error) throw new Error('[v2-service] crear gerencia: ' + error.message);
    return data;
}

// ─────────────────────────────────────────────────────────────────
//  ASIGNACIONES (CHECK-IN / CHECK-OUT)
// ─────────────────────────────────────────────────────────────────
export async function doCheckin({ idCama, rutHuesped, nombreHuesped, empresaId, fechaCheckin, fechaSalidaProgramada, numeroContrato, telefono, esPreAsignacion }) {
    // Estado según si el check-in es para hoy o para fecha futura
    const hoy = new Date().toISOString().split('T')[0];
    const estadoAsig = esPreAsignacion ? 'pre_asignado' : 'activa';
    const { error } = await supabase.from('v2_asignaciones').insert({
        id_cama:                 idCama,
        rut_huesped:             rutHuesped,
        nombre_huesped:          nombreHuesped,
        empresa_id:              empresaId,
        fecha_checkin:           fechaCheckin || hoy,
        fecha_salida_programada: fechaSalidaProgramada || null,
        numero_contrato:         numeroContrato || null,
        telefono:                telefono || null,
        estado_asignacion:       estadoAsig
    });
    if (error) throw new Error('[v2-service] checkin: ' + error.message);
}

export async function doCheckout(asigId) {
    const { error } = await supabase
        .from('v2_asignaciones')
        .update({ fecha_checkout: new Date().toISOString().split('T')[0] })
        .eq('id', asigId);
    if (error) throw new Error('[v2-service] checkout: ' + error.message);
}

export async function getAsignacionesActivas({ busqueda = null, limit = 50 } = {}) {
    let q = supabase.from('v2_asignaciones')
        .select('id,rut_huesped,nombre_huesped,id_cama,fecha_checkin,fecha_salida_programada,estado_asignacion,v2_empresas(nombre,turno)')
        .is('fecha_checkout', null)
        .in('estado_asignacion', ['activa', 'pre_asignado'])
        .order('fecha_checkin', { ascending: false })
        .limit(limit);
    if (busqueda) {
        q = q.or(`rut_huesped.ilike.%${busqueda}%,nombre_huesped.ilike.%${busqueda}%`);
    }
    const { data, error } = await q;
    if (error) throw new Error('[v2-service] asignaciones: ' + error.message);
    return data || [];
}

// ─────────────────────────────────────────────────────────────────
//  ROTACIÓN AUTOMÁTICA DE TURNO
// ─────────────────────────────────────────────────────────────────

/**
 * Ejecuta la rotación diaria:
 * 1. Auto-checkout de trabajadores cuya fecha_salida_programada ya pasó
 * 2. Activa pre-asignados cuya fecha_checkin llegó
 * Retorna: { autoCheckout: [], activados: [] }
 */
export async function ejecutarAutoRotacion() {
    const hoy = new Date().toISOString().split('T')[0];

    // PASO 1: Marcar sin_checkout los que debían salir y no lo hicieron
    const { data: vencidos } = await supabase
        .from('v2_asignaciones')
        .select('id,nombre_huesped,id_cama,fecha_salida_programada')
        .is('fecha_checkout', null)
        .eq('estado_asignacion', 'activa')
        .lt('fecha_salida_programada', hoy); // salida programada < hoy

    let autoCheckout = [];
    if (vencidos && vencidos.length > 0) {
        const ids = vencidos.map(v => v.id);
        await supabase.from('v2_asignaciones')
            .update({
                fecha_checkout:    hoy,
                estado_asignacion: 'sin_checkout',
                auto_checkout:     true
            })
            .in('id', ids);

        // Liberar camas de los que tenían fecha_salida_programada sin entrante
        // (si hay pre_asignado en esa cama, la cama sigue ocupada)
        const camasConEntrante = new Set();
        const { data: preAsig } = await supabase
            .from('v2_asignaciones')
            .select('id_cama')
            .is('fecha_checkout', null)
            .eq('estado_asignacion', 'pre_asignado');
        (preAsig || []).forEach(a => camasConEntrante.add(a.id_cama));

        for (const v of vencidos) {
            if (!camasConEntrante.has(v.id_cama)) {
                await supabase.from('v2_camas')
                    .update({ estado: 'Disponible' })
                    .eq('id_cama', v.id_cama);
            }
        }
        autoCheckout = vencidos;
    }

    // PASO 2: Activar pre-asignados cuya fecha_checkin ya llegó
    const { data: activables } = await supabase
        .from('v2_asignaciones')
        .select('id,nombre_huesped,id_cama,fecha_checkin')
        .is('fecha_checkout', null)
        .eq('estado_asignacion', 'pre_asignado')
        .lte('fecha_checkin', hoy);

    let activados = [];
    if (activables && activables.length > 0) {
        const ids = activables.map(a => a.id);
        await supabase.from('v2_asignaciones')
            .update({ estado_asignacion: 'activa' })
            .in('id', ids);
        // Marcar sus camas como Ocupadas
        for (const a of activables) {
            await supabase.from('v2_camas')
                .update({ estado: 'Ocupada' })
                .eq('id_cama', a.id_cama);
        }
        activados = activables;
    }

    return { autoCheckout, activados };
}

/** Trabajadores con auto_checkout = true (no hicieron checkout manual) */
export async function getSinCheckout({ fechaDesde = null } = {}) {
    let q = supabase.from('v2_asignaciones')
        .select('id,nombre_huesped,rut_huesped,id_cama,fecha_salida_programada,fecha_checkout,v2_empresas(nombre)')
        .eq('auto_checkout', true)
        .eq('estado_asignacion', 'sin_checkout')
        .order('fecha_salida_programada', { ascending: false })
        .limit(200);
    if (fechaDesde) q = q.gte('fecha_salida_programada', fechaDesde);
    const { data, error } = await q;
    if (error) throw new Error('[v2-service] sin_checkout: ' + error.message);
    return data || [];
}

export function today() {
    return new Date().toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────
//  TRABAJADORES — Padrón (importado desde Excel)
// ─────────────────────────────────────────────────────────────────

/** Busca trabajador por RUT exacto → auto-rellena nombre */
export async function buscarTrabajadorPorRut(rut) {
    const rutLimpio = rut.trim().replace(/\./g, '').toUpperCase();
    if (!rutLimpio) return null;
    const { data, error } = await supabase
        .from('v2_asignaciones')
        .select('rut_huesped,nombre_huesped')
        .eq('rut_huesped', rutLimpio)
        .order('fecha_checkin', { ascending: false })
        .limit(1);
    
    // Fallback if data is null or empty array
    const result = (data && data.length > 0) ? data[0] : null;

    if (error || !result) return null;
    return { rut: result.rut_huesped, nombre: result.nombre_huesped };
}

export async function upsertTrabajadores(rows) {
    const clean = rows.map(r => ({
        rut:    (r.rut    || '').toString().trim().replace(/\./g, '').toUpperCase(),
        nombre: (r.nombre || '').toString().trim()
    })).filter(r => r.rut && r.nombre);

    let total = 0;
    const CHUNK = 500;
    for (let i = 0; i < clean.length; i += CHUNK) {
        const { error } = await supabase
            .from('v2_huespedes')
            .insert(clean.slice(i, i + CHUNK));
        if (error) throw new Error('[v2-service] insert huespedes: ' + error.message);
        total += clean.slice(i, i + CHUNK).length;
    }
    return total;
}

/** Total de trabajadores en el padrón */
export async function getTrabajadoresCount() {
    const { count, error } = await supabase
        .from('v2_asignaciones')
        .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
}
