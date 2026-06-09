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
            // ✅ FIX: estado_asignacion y fecha_checkin son obligatorios para
            //    identificar asigActiva, asigEntrante y asigSaliente correctamente
            .select('id_cama,habitacion_id,estado,v2_asignaciones(huesped_confirmo,fecha_checkout,fecha_checkin,fecha_salida_programada,numero_contrato,nombre_huesped,estado_asignacion,v2_empresas(nombre,v2_gerencias(nombre)))')
            .eq('habitacion_id', habitacionId)
            .order('id_cama');
        if (error) throw error;
        return (data || []).map(c => {
            const asigs = c.v2_asignaciones || [];
            const asigActiva   = asigs.find(a => !a.fecha_checkout && a.estado_asignacion === 'activa')
                               // ✅ Compatibilidad: asignaciones sin estado_asignacion (importaciones antiguas)
                               || asigs.find(a => !a.fecha_checkout && !a.estado_asignacion && a.fecha_checkin);
            const asigEntrante = asigs.find(a => !a.fecha_checkout && a.estado_asignacion === 'pre_asignado')
                               || asigs.find(a => !a.fecha_checkout && !a.estado_asignacion && !a.fecha_checkin); // compatibilidad
            // 🆕 SALIENTE: persona cuya fecha de salida es HOY — visible durante el día, archivada mañana
            const asigSaliente = asigs.find(a => !a.fecha_checkout && a.estado_asignacion === 'saliente');
            const hoy = new Date().toISOString().split('T')[0];
            return {
                id_cama:                c.id_cama,
                habitacion_id:          c.habitacion_id,
                estado:                 c.estado,
                // 🚫 NO auto-confirmar por fecha — huesped_confirmo solo cambia a true
                //    cuando el trabajador confirma manualmente desde el portal "Mi Habitación"
                huesped_confirmo:       asigActiva?.huesped_confirmo || false,
                fecha_checkin:          asigActiva?.fecha_checkin || null,
                fecha_salida_programada: asigActiva?.fecha_salida_programada || null,
                empresa:                asigActiva?.v2_empresas?.nombre || null,
                gerencia:               asigActiva?.v2_empresas?.v2_gerencias?.nombre || null,
                nombre_huesped:         asigActiva?.nombre_huesped || null,
                numero_contrato:        asigActiva?.numero_contrato || null,
                // Rotación: trabajador entrante pre-asignado (cama Ocupada con relevo)
                tieneRotacion: !!asigActiva && !!asigEntrante,
                entrante: (!!asigActiva && asigEntrante) ? {
                    nombre:  asigEntrante.nombre_huesped,
                    fecha:   asigEntrante.fecha_checkin,
                    empresa: asigEntrante.v2_empresas?.nombre || null,
                } : null,
                // Pre-asignación sobre cama Disponible (sin ocupante actual)
                preAsignado: (!asigActiva && asigEntrante) ? {
                    nombre:   asigEntrante.nombre_huesped,
                    fecha:    asigEntrante.fecha_checkin,
                    empresa:  asigEntrante.v2_empresas?.nombre || null,
                    contrato: asigEntrante.numero_contrato || null,
                } : null,
                nombre_huesped_pre: (!asigActiva && asigEntrante) ? asigEntrante.nombre_huesped : null,
                empresa_pre:        (!asigActiva && asigEntrante) ? (asigEntrante.v2_empresas?.nombre || null) : null,
                // 🆕 SALIENTE: datos de quien sale HOY (para sección SALIDA en la tarjeta)
                saliente: asigSaliente ? {
                    nombre:      asigSaliente.nombre_huesped,
                    empresa:     asigSaliente.v2_empresas?.nombre || null,
                    fechaSalida: asigSaliente.fecha_salida_programada,
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
        .in('estado_asignacion', ['activa', 'pre_asignado', 'saliente'])
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
        .in('estado_asignacion', ['activa', 'pre_asignado', 'saliente']);
    const rows = data || [];
    if (rows.length === 0) return { ok: true, libre: true };

    // Normalizar a YYYY-MM-DD para comparar solo fechas (sin hora)
    const llegadaStr = String(fechaLlegadaNueva).substring(0, 10);

    for (const r of rows) {
        if (!r.fecha_salida_programada) {
            return { ok: false, razon: `${r.nombre_huesped} ocupa esta cama sin fecha de salida definida.` };
        }
        const salidaStr = String(r.fecha_salida_programada).substring(0, 10);

        // ✅ ROTACIÓN PERMITIDA: llegada el mismo día que salida → pre-asignación válida
        // ❌ CONFLICTO: solo si el nuevo llega ANTES de que salga el actual
        if (llegadaStr < salidaStr) {
            return {
                ok: false,
                razon: `${r.nombre_huesped} está hasta el ${salidaStr}. El nuevo llegaría el ${llegadaStr} — se toparían.`
            };
        }
    }
    // La nueva llegada es >= salida del actual → rotación válida
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
                    if (c.estado === 'Deshabilitada') return; // cama sin instalar
                    total++;
                    if (c.estado === 'Ocupada')         ocup++;
                    else if (c.estado === 'Mantencion') mant++;
                    else                                disp++;
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
//  REPORTE POR PABELLÓN (para desglose en acordeones del dashboard)
// ─────────────────────────────────────────────────────────────────
export async function getReportePabellones() {
    const [edificios, pabellones, habitaciones, camas] = await Promise.all([
        fetchAll('v2_edificios',    'id,nombre',                            'nombre'),
        fetchAll('v2_pabellones',   'id,nombre,edificio_id',                'nombre'),
        fetchAll('v2_habitaciones', 'id_custom,pabellon_id,cantidad_camas', 'id_custom'),
        fetchAll('v2_camas',        'id_cama,habitacion_id,estado',         'id_cama')
    ]);

    const edifMap = {};  edificios.forEach(e => { edifMap[e.id] = e.nombre; });
    const habByPab = {}; habitaciones.forEach(h => {
        if (!habByPab[h.pabellon_id]) habByPab[h.pabellon_id] = [];
        habByPab[h.pabellon_id].push(h);
    });
    const camasByHab = {}; camas.forEach(c => {
        if (!camasByHab[c.habitacion_id]) camasByHab[c.habitacion_id] = [];
        camasByHab[c.habitacion_id].push(c);
    });

    return pabellones.map(pab => {
        let total = 0, ocup = 0, disp = 0, mant = 0;
        (habByPab[pab.id] || []).forEach(h => {
            (camasByHab[h.id_custom] || []).forEach(c => {
                if (c.estado === 'Deshabilitada') return;
                total++;
                if (c.estado === 'Ocupada')         ocup++;
                else if (c.estado === 'Mantencion' || c.estado === 'Mantención') mant++;
                else                                disp++;
            });
        });
        return {
            edificio:          edifMap[pab.edificio_id] || '?',
            edificio_id:       pab.edificio_id,
            pabellon:          pab.nombre,
            total_camas:       total,
            camas_ocupadas:    ocup,
            camas_disponibles: disp,
            camas_mantencion:  mant,
        };
    }).filter(r => r.total_camas > 0); // omitir pabellones sin camas activas
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
//  VALIDACIONES DE INTEGRIDAD ANTES DEL CHECK-IN
// ─────────────────────────────────────────────────────────────────

/**
 * Normaliza un RUT eliminando puntos, guiones y espacios.
 * Función canónica compartida — importar desde aquí en todos los módulos.
 * Ejemplo: "12.345.678-9" → "123456789"  |  "12.345.678-k" → "12345678K"
 */
export function normRut(rut = '') {
    return String(rut).replace(/[.\-\s]/g, '').toUpperCase();
}
// Alias privado para retrocompatibilidad interna
const normRutSvc = normRut;

/**
 * Busca el sexo de una persona en v2_solicitudes_b2b por RUT.
 * Devuelve 'M', 'F' o null si no se encuentra.
 */
export async function getSexoPorRut(rut) {
    const rutNorm = normRutSvc(rut);
    if (!rutNorm) return null;
    const { data } = await supabase
        .from('v2_solicitudes_b2b')
        .select('sexo')
        .ilike('rut_trabajador', `%${rutNorm}%`)
        .limit(1)
        .maybeSingle();
    return data?.sexo || null;
}

/**
 * REGLA 1 — Sin RUT duplicado en fechas solapadas.
 * Verifica si el RUT ya tiene una asignación activa que se superponga
 * con el rango [fechaCheckin, fechaSalida].
 *
 * @returns {{ ok: boolean, razon?: string }}
 */
export async function checkRutDuplicado(rutHuesped, fechaCheckin, fechaSalida) {
    const rutNorm = normRutSvc(rutHuesped);
    const { data, error } = await supabase
        .from('v2_asignaciones')
        .select('id, nombre_huesped, fecha_checkin, fecha_salida_programada, v2_camas(habitacion_id)')
        .ilike('rut_huesped', `%${rutNorm}%`)
        .is('fecha_checkout', null)
        .in('estado_asignacion', ['activa', 'pre_asignado', 'saliente']);

    if (error) return { ok: true }; // Si falla la query, no bloqueamos
    const rows = data || [];
    if (rows.length === 0) return { ok: true };

    const entrada = new Date(fechaCheckin);
    const salida  = fechaSalida ? new Date(fechaSalida) : null;

    for (const r of rows) {
        const existeEntrada = new Date(r.fecha_checkin);
        const existeSalida  = r.fecha_salida_programada ? new Date(r.fecha_salida_programada) : null;

        // Solapamiento: los rangos [A,B] y [C,D] se superponen si A < D y C < B
        const nuevoTermina  = salida || new Date('2099-12-31');
        const existeTermina = existeSalida || new Date('2099-12-31');

        if (entrada < existeTermina && existeEntrada < nuevoTermina) {
            return {
                ok: false,
                razon: `🚫 RUT DUPLICADO: ${r.nombre_huesped} (mismo RUT) ya está asignado en el campamento con fechas solapadas (${r.fecha_checkin} → ${r.fecha_salida_programada || 'sin fecha salida'}). No se puede asignar el mismo RUT dos veces en el mismo período.`
            };
        }
    }
    return { ok: true };
}

/**
 * REGLA 2 — Sin mezcla de géneros en la misma habitación.
 * Verifica que los ocupantes actuales de la habitación sean del mismo
 * género que la persona que se intenta asignar.
 *
 * @param {string} habitacionId  - ID o número de habitación
 * @param {string} rutNuevo      - RUT del nuevo huésped
 * @returns {{ ok: boolean, razon?: string }}
 */
export async function checkGeneroHabitacion(habitacionId, rutNuevo) {
    if (!habitacionId || !rutNuevo) return { ok: true };

    // Obtener el sexo de la persona nueva
    const sexoNuevo = await getSexoPorRut(rutNuevo);
    if (!sexoNuevo) return { ok: true }; // Sin datos de género, no bloqueamos

    // Obtener RUTs de los ocupantes actuales de la habitación
    const { data: camasHab } = await supabase
        .from('v2_camas')
        .select('id_cama')
        .eq('habitacion_id', habitacionId);

    if (!camasHab?.length) return { ok: true };

    const idsCamas = camasHab.map(c => c.id_cama);

    const { data: ocupantes } = await supabase
        .from('v2_asignaciones')
        .select('rut_huesped, nombre_huesped')
        .in('id_cama', idsCamas)
        .is('fecha_checkout', null)
        .in('estado_asignacion', ['activa', 'pre_asignado', 'saliente']);

    if (!ocupantes?.length) return { ok: true };

    // ✅ FIX N+1: Obtener el género de TODOS los ocupantes en UNA sola query
    const rutsOcupantes = [...new Set(ocupantes.map(o => normRutSvc(o.rut_huesped)))];
    const { data: sexosData } = await supabase
        .from('v2_solicitudes_b2b')
        .select('rut_trabajador, sexo')
        .in('rut_trabajador', rutsOcupantes);

    // Mapa rut → sexo para búsqueda O(1)
    const sexoMap = {};
    for (const s of sexosData || []) {
        sexoMap[normRutSvc(s.rut_trabajador)] = s.sexo;
    }

    // Verificar mezcla de géneros con el mapa en memoria
    for (const ocup of ocupantes) {
        const sexoOcup = sexoMap[normRutSvc(ocup.rut_huesped)];
        if (sexoOcup && sexoNuevo && sexoOcup !== sexoNuevo) {
            const genNuevo = sexoNuevo === 'F' ? 'Mujer ♀' : 'Hombre ♂';
            const genOcup  = sexoOcup  === 'F' ? 'Mujer ♀' : 'Hombre ♂';
            return {
                ok: false,
                razon: `🚫 MEZCLA DE GÉNEROS: La habitación ya tiene a ${ocup.nombre_huesped} (${genOcup}) y estás intentando asignar a un/a ${genNuevo}. No se permite mezclar hombres y mujeres en la misma habitación.`
            };
        }
    }

    return { ok: true };
}


// ─────────────────────────────────────────────────────────────────
//  ASIGNACIONES (CHECK-IN / CHECK-OUT)
// ─────────────────────────────────────────────────────────────────
export async function doCheckin({ idCama, rutHuesped, nombreHuesped, empresaId, fechaCheckin, fechaSalidaProgramada, numeroContrato, telefono, esPreAsignacion }) {
    // Estado según si el check-in es para hoy o para fecha futura
    const hoy = new Date().toISOString().split('T')[0];
    const estadoAsig  = esPreAsignacion ? 'pre_asignado' : 'activa';
    // ✅ FIX: La cama debe reflejar el estado real visualmente
    const estadoCama  = esPreAsignacion ? 'Disponible' : 'Ocupada';

    // 1. Insertar la asignación
    const { error } = await supabase.from('v2_asignaciones').insert({
        id_cama:                 idCama,
        rut_huesped:             (rutHuesped || '').slice(0, 12),
        nombre_huesped:          nombreHuesped,
        empresa_id:              empresaId,
        fecha_checkin:           fechaCheckin || hoy,
        fecha_salida_programada: fechaSalidaProgramada || null,
        numero_contrato:         numeroContrato || null,
        telefono:                telefono || null,
        estado_asignacion:       estadoAsig,
        huesped_confirmo:        true,        // ✅ Confirmado automáticamente al ingresar desde la plataforma
    });
    if (error) throw new Error('[v2-service] checkin: ' + error.message);

    // 2. ✅ Marcar la cama como Ocupada (check-in real) o PreAsignada (turno futuro)
    //    Esto hace que el botón de la cama aparezca verde en el mapa de habitaciones
    const { error: errCama } = await supabase
        .from('v2_camas')
        .update({ estado: estadoCama })
        .eq('id_cama', idCama);
    if (errCama) {
        // No lanzar excepción — el check-in ya se guardó, solo loguear
        console.warn('[doCheckin] No se pudo actualizar estado de cama:', errCama.message);
    }
}



export async function doCheckout(asigId) {
    const hoy = new Date().toISOString().split('T')[0];

    // Obtener la asignación para verificar si el checkin es futuro
    const { data: asig } = await supabase
        .from('v2_asignaciones')
        .select('id, fecha_checkin')
        .eq('id', asigId)
        .single();

    // Si fecha_checkin > hoy (nunca llegó), usar fecha_checkin como checkout
    // para satisfacer la restricción chk_fechas (checkout >= checkin)
    const fechaCheckin  = asig?.fecha_checkin?.slice(0, 10) || hoy;
    const fechaCheckout = fechaCheckin > hoy ? fechaCheckin : hoy;

    const { error } = await supabase
        .from('v2_asignaciones')
        .update({
            fecha_checkout:    fechaCheckout,
            estado_asignacion: 'cancelado',   // marca que nunca llegó
        })
        .eq('id', asigId);
    if (error) throw new Error('[v2-service] checkout: ' + error.message);
}

export async function getAsignacionesActivas({ busqueda = null, limit = 50 } = {}) {
    let q = supabase.from('v2_asignaciones')
        .select('id,rut_huesped,nombre_huesped,id_cama,fecha_checkin,fecha_salida_programada,estado_asignacion,v2_empresas(nombre,turno)')
        .is('fecha_checkout', null)
        .in('estado_asignacion', ['activa', 'pre_asignado', 'saliente'])
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
 * 1. Auto-checkout de trabajadores cuya fecha_salida_programada <= HOY
 * 2. Activa pre-asignados cuya fecha_checkin <= HOY (solo si su cama quedó libre)
 * Retorna: { autoCheckout: [], activados: [] }
 *
 * ⚠️ ORDEN CRÍTICO: primero salidas, luego entradas.
 *    Si se activan entradas antes de las salidas, quedan 2 activos en la misma cama.
 */
export async function ejecutarAutoRotacion() {
    const hoy = new Date().toISOString().split('T')[0];

    // ═════════════════════════════════════════════════════════════════════════
    // FASE 0: Archivar 'salientes' del día anterior (fecha_salida < hoy)
    //   Fueron visibles ayer como SALIENTE → hoy se archivan definitivamente
    // ═════════════════════════════════════════════════════════════════════════
    const { data: salientesViejos } = await supabase
        .from('v2_asignaciones')
        .select('id,nombre_huesped,id_cama')
        .is('fecha_checkout', null)
        .eq('estado_asignacion', 'saliente')
        .lt('fecha_salida_programada', hoy); // < hoy: ya pasó su día de visibilidad

    if (salientesViejos?.length > 0) {
        await supabase.from('v2_asignaciones')
            .update({ fecha_checkout: hoy, estado_asignacion: 'sin_checkout', auto_checkout: true })
            .in('id', salientesViejos.map(v => v.id));

        // Liberar camas que no tienen un activo nuevo
        const { data: activasActuales } = await supabase
            .from('v2_asignaciones').select('id_cama')
            .is('fecha_checkout', null).eq('estado_asignacion', 'activa');
        const camasConActiva = new Set((activasActuales || []).map(a => a.id_cama));
        const camasSinActiva = salientesViejos.filter(v => !camasConActiva.has(v.id_cama));
        if (camasSinActiva.length > 0) {
            await supabase.from('v2_camas')
                .update({ estado: 'Disponible' })
                .in('id_cama', camasSinActiva.map(v => v.id_cama))
                .neq('estado', 'Deshabilitada');
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FASE 1A: Mover activos de HOY a estado 'saliente'
    //   fecha_salida = HOY → pasan a SALIENTE (visibles durante el día)
    //   NO se hace fecha_checkout todavía — eso ocurre en FASE 0 del día siguiente
    // ═════════════════════════════════════════════════════════════════════════
    const { data: salientesHoy } = await supabase
        .from('v2_asignaciones')
        .select('id,nombre_huesped,id_cama')
        .is('fecha_checkout', null)
        .eq('estado_asignacion', 'activa')
        .eq('fecha_salida_programada', hoy);

    let autoCheckout = [];
    if (salientesHoy?.length > 0) {
        await supabase.from('v2_asignaciones')
            .update({ estado_asignacion: 'saliente' })
            .in('id', salientesHoy.map(s => s.id));
        autoCheckout = salientesHoy;
        // La cama permanece 'Ocupada' — el saliente sigue visible en la tarjeta
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FASE 1B: Archivar activos vencidos que no pasaron por FASE 1A
    //   fecha_salida < hoy Y estado='activa' → sin_checkout directo (sin pasar por saliente)
    //   Captura casos donde la app no corrió ayer
    // ═════════════════════════════════════════════════════════════════════════
    const { data: vencidos } = await supabase
        .from('v2_asignaciones')
        .select('id,nombre_huesped,id_cama,fecha_salida_programada')
        .is('fecha_checkout', null)
        .eq('estado_asignacion', 'activa')
        .lt('fecha_salida_programada', hoy); // < hoy (estrictamente antes)

    if (vencidos?.length > 0) {
        await supabase.from('v2_asignaciones')
            .update({ fecha_checkout: hoy, estado_asignacion: 'sin_checkout', auto_checkout: true })
            .in('id', vencidos.map(v => v.id));

        const { data: preAsig } = await supabase
            .from('v2_asignaciones').select('id_cama')
            .is('fecha_checkout', null).eq('estado_asignacion', 'pre_asignado');
        const camasConEntrante = new Set((preAsig || []).map(a => a.id_cama));
        const camasSinEntrante = vencidos.filter(v => !camasConEntrante.has(v.id_cama));
        if (camasSinEntrante.length > 0) {
            await supabase.from('v2_camas')
                .update({ estado: 'Disponible' })
                .in('id_cama', camasSinEntrante.map(v => v.id_cama))
                .neq('estado', 'Deshabilitada');
        }
        autoCheckout = [...autoCheckout, ...vencidos];
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FASE 2: Activar pre-asignados cuya fecha_checkin ya llegó
    //   Se ejecuta DESPUÉS de las salidas → el incoming pasa de PRE a ACTUAL
    //   Si la cama tiene un saliente, ambos coexisten 1 día (saliente + activo nuevo)
    // ═════════════════════════════════════════════════════════════════════════
    const { data: activables } = await supabase
        .from('v2_asignaciones')
        .select('id,nombre_huesped,id_cama,fecha_checkin')
        .is('fecha_checkout', null)
        .eq('estado_asignacion', 'pre_asignado')
        .lte('fecha_checkin', hoy);

    let activados = [];
    if (activables?.length > 0) {
        await supabase.from('v2_asignaciones')
            .update({ estado_asignacion: 'activa' })
            .in('id', activables.map(a => a.id));
        await supabase.from('v2_camas')
            .update({ estado: 'Ocupada' })
            .in('id_cama', activables.map(a => a.id_cama));
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

    // Buscar primero en el padrón (v2_huespedes)
    const { data: hData } = await supabase
        .from('v2_huespedes')
        .select('rut,nombre,sexo')
        .eq('rut', rutLimpio)
        .limit(1);

    if (hData && hData.length > 0) {
        return { rut: hData[0].rut, nombre: hData[0].nombre, sexo: hData[0].sexo };
    }

    // Fallback: historial de asignaciones
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
        .from('v2_huespedes')
        .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
}
