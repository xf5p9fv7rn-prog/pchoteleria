/**
 * PC Hotelería — Motor de Consultas en Lenguaje Natural
 * Interpreta preguntas en español y genera informes con datos reales.
 * Lee desde Supabase (cualquier dispositivo) con respaldo en IndexedDB (offline).
 */

const DB_NAME = 'campmanager_db';
const DB_VERSION = 3;

let _db = null;

// ── Abrir IndexedDB (respaldo offline) ────────────────────────────────
function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const reqProbe = indexedDB.open(DB_NAME);
        reqProbe.onsuccess = (e) => {
            const db = e.target.result;
            const existingVersion = db.version;
            db.close();
            const req = indexedDB.open(DB_NAME, existingVersion);
            req.onupgradeneeded = (ev) => {
                const d = ev.target.result;
                const stores = ['buildings', 'rooms', 'assignments', 'census',
                                /* b2b_requests ELIMINADA — ver v2_solicitudes_b2b */
                                'sync_queue', 'users', 'logs', 'census_records'];
                stores.forEach(s => {
                    if (!d.objectStoreNames.contains(s)) {
                        d.createObjectStore(s, {
                            keyPath: s === 'users' ? 'username' : 'id',
                            autoIncrement: s !== 'users'
                        });
                    }
                });
            };
            req.onsuccess = (ev) => { _db = ev.target.result; resolve(_db); };
            req.onerror = (ev) => reject(ev.target.error);
        };
        reqProbe.onerror = (e) => reject(e.target.error);
    });
}

function getAll(storeName) {
    return new Promise(async (resolve) => {
        try {
            const db = await openDB();
            if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
            tx.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
    });
}

// ── Supabase lazy loader ───────────────────────────────────────────────
let _supabase = null;
async function getSupabase() {
    if (_supabase) return _supabase;
    try {
        const mod = await import('./supabaseClient.js');
        _supabase = mod.supabase;
    } catch(e) {
        console.warn('[Constanza] No se pudo cargar supabaseClient:', e);
    }
    return _supabase;
}

// ── Cargar datos V2 con paginación completa ─────────────────────────────────
async function cargarDatos() {
    try {
        const sb = await getSupabase();
        if (!sb) throw new Error('No supabase client');
        console.log('[Constanza] ☁️ Cargando datos desde V2 (paginado)…');

        // Labels para motivos de camas perdidas
        const MOTIVOS_LABEL = {
            impar_genero:      'Impar género',
            impar_empresa:     'Impar empresa',
            angloamerica:      'Anglo (solo)',
            motivos_medicos:   'Motivos médicos',
            motivos_personales:'Motivos personales',
            turno_noche:       'Turno noche',
            sin_motivo:        null,
        };

        // ── Helper paginado ────────────────────────────────────────────────
        async function fetchAll(table, cols, filterFn) {
            let all = [], pg = 0;
            while (true) {
                let q = sb.from(table).select(cols).range(pg*900, pg*900+899);
                if (filterFn) q = filterFn(q);
                const { data, error } = await q;
                if (error) throw error;
                if (data?.length) all = all.concat(data);
                if (!data || data.length < 900) break;
                pg++; if (pg > 30) break;
            }
            return all;
        }

        // ── 1. Asignaciones ACTIVAS paginadas ─────────────────────────────
        const asignaciones = await fetchAll(
            'v2_asignaciones',
            `id, rut_huesped, nombre_huesped, fecha_checkin, fecha_checkout, fecha_salida_programada, id_cama,
             v2_camas(id_cama, numero_cama,
               v2_habitaciones(id_custom, numero_hab, nivel, cantidad_camas,
                 v2_pabellones(id, nombre, v2_edificios(nombre)))),
             v2_empresas(nombre, turno, v2_gerencias(nombre))`,
            q => q.is('fecha_checkout', null)
        );
        console.log(`[Constanza] ✅ ${asignaciones.length} asignaciones activas`);

        // ── 2. Construir rooms + buildings desde asignaciones ─────────────
        const SLOTS = ['day', 'night', 'extra', 'extra2', 'extra3'];
        const buildingMap = {};
        const roomMap     = {};

        asignaciones.forEach(a => {
            const hab = a.v2_camas?.v2_habitaciones;
            const pab = hab?.v2_pabellones;
            if (!hab || !pab) return;

            if (!buildingMap[pab.id])
                buildingMap[pab.id] = { id: pab.id, name: pab.nombre };

            const habKey = hab.numero_hab;
            if (!roomMap[habKey]) {
                roomMap[habKey] = {
                    id: habKey, number: habKey,
                    buildingId: pab.id,
                    bedCount:   hab.cantidad_camas || 2,
                    status:     'occupied',
                    beds:       {},
                    nivel:      hab.nivel,
                };
            }

            const numCama = parseInt(a.v2_camas?.numero_cama || 1);
            const slotKey = SLOTS[numCama - 1] || `extra${numCama}`;
            roomMap[habKey].beds[slotKey] = {
                occupant:      a.nombre_huesped        || '—',
                rut:           a.rut_huesped           || '—',
                company:       a.v2_empresas?.nombre               || '—',
                gerencia:      a.v2_empresas?.v2_gerencias?.nombre || '—',
                shift:         a.v2_empresas?.turno                || '—',
                arrivalDate:   a.fecha_checkin                     || '—',
                departureDate: a.fecha_salida_programada           || '—',  // fecha PROGRAMADA de salida
                gender:        '—',
            };
        });

        const rooms     = Object.values(roomMap);
        const buildings = Object.values(buildingMap);

        // ── 3. Universo completo de habitaciones (paginado) ──────────────
        const todasHabs = await fetchAll(
            'v2_habitaciones',
            'id_custom, numero_hab, nivel, cantidad_camas, v2_pabellones(id, nombre)'
        );
        todasHabs.forEach(hab => {
            const pab = hab.v2_pabellones;
            if (!pab) return;
            if (!buildingMap[pab.id]) {
                buildingMap[pab.id] = { id: pab.id, name: pab.nombre };
                buildings.push(buildingMap[pab.id]);
            }
            if (!roomMap[hab.numero_hab]) {
                const room = {
                    id: hab.numero_hab, number: hab.numero_hab,
                    buildingId: pab.id,
                    bedCount:   hab.cantidad_camas || 2,
                    status:     'free', beds: {}, nivel: hab.nivel,
                };
                roomMap[hab.numero_hab] = room;
                rooms.push(room);
            } else {
                // Actualizar bedCount con valor real
                roomMap[hab.numero_hab].bedCount = hab.cantidad_camas || roomMap[hab.numero_hab].bedCount;
            }
        });

        console.log(`[Constanza] ✅ ${rooms.length} hab · ${buildings.length} pabellones`);

        // ── 4. Cupos gerencia ────────────────────────────────────────────
        let quotas = [];
        try {
            const { data: cuposData } = await sb
                .from('v2_cupos_gerencias')
                .select('id, numero_contrato, contrato_sap, empresa, gerencia, nombre_contrato, operacion, cupos_totales, cupos_ocupados')
                .order('gerencia').order('empresa');
            quotas = (cuposData || []).map(c => ({
                company:         c.empresa          || '—',
                gerencia:        c.gerencia         || '—',
                limit:           c.cupos_totales    || 0,
                cupos_ocupados:  c.cupos_ocupados   || 0,
                cupos_totales:   c.cupos_totales    || 0,
                numero_contrato: c.numero_contrato  || null,
                nombre_contrato: c.nombre_contrato  || null,
                operacion:       c.operacion        || null,
                id:              c.id,
            }));
            console.log(`[Constanza] ✅ ${quotas.length} cupos gerencia`);
        } catch(eQ) {
            console.warn('[Constanza] Cupos no disponibles:', eQ.message);
        }

        // ── 5. Motivos de camas perdidas ─────────────────────────────────
        try {
            // id_cama_perdida = ID de la cama LIBRE (sin asignacion activa)
            // Necesitamos mapear id_cama → numero_hab para TODAS las camas (libres Y ocupadas)
            const numPorIdCustom = {};
            todasHabs.forEach(h => { numPorIdCustom[String(h.id_custom)] = h.numero_hab; });

            const todasCamas = await fetchAll('v2_camas', 'id_cama, habitacion_id');
            const habPorCama = {};
            todasCamas.forEach(c => {
                const num = numPorIdCustom[String(c.habitacion_id)];
                if (num) habPorCama[String(c.id_cama)] = num;
            });

            const { data: motivosData } = await sb
                .from('v2_camas_perdidas')
                .select('id_cama_perdida, motivo, motivo_texto');

            (motivosData || []).forEach(m => {
                const labelMotivo = m.motivo && m.motivo !== 'sin_motivo'
                    ? (MOTIVOS_LABEL[m.motivo] || m.motivo_texto || m.motivo)
                    : null;
                if (!labelMotivo) return;
                const numHab = habPorCama[String(m.id_cama_perdida)];
                if (numHab && roomMap[numHab] && !roomMap[numHab].lostBedReason) {
                    roomMap[numHab].lostBedReason = labelMotivo;
                }
            });
            console.log(`[Constanza] ✅ ${(motivosData||[]).length} motivos asignados`);
        } catch(eM) {
            console.warn('[Constanza] Motivos no disponibles:', eM.message);
        }

        // ── 6. Stats Anglo/Noche para Constanza resumen ──────────────────
        let angloStats = null;
        try {
            const [distData, camTodos] = await Promise.all([
                sb.from('v2_distribucion_camas').select('id_cama, tipo'),
                fetchAll('v2_camas', 'id_cama, estado, numero_cama'),
            ]);
            const dist = distData.data || [];

            const nocheSet    = new Set(dist.filter(d => d.tipo === 'noche').map(d => String(d.id_cama)));
            const angloSet    = new Set(dist.filter(d => d.tipo === 'anglo').map(d => String(d.id_cama)));
            const reservaSet  = new Set(dist.filter(d => d.tipo === 'reserva').map(d => String(d.id_cama)));
            const bodegaSet   = new Set(dist.filter(d => d.tipo === 'bodega').map(d => String(d.id_cama)));

            const angloNocheSet = new Set(camTodos.filter(c => angloSet.has(String(c.id_cama)) && Number(c.numero_cama) === 2).map(c => String(c.id_cama)));
            const angloDiaSet   = new Set(camTodos.filter(c => angloSet.has(String(c.id_cama)) && Number(c.numero_cama) === 1).map(c => String(c.id_cama)));

            const asigSet = new Set(asignaciones.map(a => String(a.id_cama)));
            const esDisp  = c => c.estado !== 'Ocupada' && c.estado !== 'Mantencion' && c.estado !== 'Mantención' && !asigSet.has(String(c.id_cama));

            // Habitaciones donde todas las camas están en mantención
            const porHab = {};
            camTodos.forEach(c => { const h = String(c.habitacion_id); if (!porHab[h]) porHab[h] = []; porHab[h].push(c); });
            let habMant = 0;
            Object.values(porHab).forEach(cs => { if (cs.length > 0 && cs.every(c => c.estado === 'Mantencion' || c.estado === 'Mantención')) habMant++; });

            angloStats = {
                totalNoche:      nocheSet.size,
                totalAngloNoche: angloNocheSet.size,
                totalAngloDia:   angloDiaSet.size,
                totalReserva:    reservaSet.size,
                totalBodega:     bodegaSet.size,
                habMant,
                dispNoche:      camTodos.filter(c => nocheSet.has(String(c.id_cama))    && esDisp(c)).length,
                dispAngloNoche: camTodos.filter(c => angloNocheSet.has(String(c.id_cama)) && esDisp(c)).length,
                dispAngloDia:   camTodos.filter(c => angloDiaSet.has(String(c.id_cama))  && esDisp(c)).length,
            };
            console.log('[Constanza] ✅ Anglo/Noche stats calculados');
        } catch(eA) {
            console.warn('[Constanza] Anglo stats no disponibles:', eA.message);
        }

        return { rooms, buildings, requests: [], census: [], quotas, angloStats };

    } catch(e) {
        console.warn('[Constanza] Error:', e.message);
        return { rooms: [], buildings: [], requests: [], census: [], quotas: [] };
    }
}




// ── Helper: Panel Desplegable (accordion nativo) ─────────────────────────────
// Usa <details>/<summary> HTML nativo — sin JS extra, sin dependencias.
let _colId = 0;
function collapsiblePanel(titulo, contenido, badge = '', color = '#2b6cb0', open = false) {
    const id = `col_${++_colId}`;
    const badgeHtml = badge
        ? `<span style="background:${color}22;color:${color};padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;margin-left:8px;">${badge}</span>`
        : '';
    return `
    <details ${open ? 'open' : ''} style="margin-bottom:10px;border-radius:14px;border:1.5px solid #e2e8f0;overflow:hidden;">
        <summary style="padding:13px 18px;list-style:none;cursor:pointer;
                        background:#f8fafc;display:flex;align-items:center;
                        gap:8px;font-weight:800;font-size:14px;color:#1a202c;
                        user-select:none;transition:background 0.15s;"
                 onmouseover="this.style.background='#edf2f7'"
                 onmouseout="this.style.background='#f8fafc'">
            <span style="font-size:17px;transition:transform 0.25s" class="col-arrow-${id}">▶</span>
            ${titulo}
            ${badgeHtml}
        </summary>
        <div style="padding:14px 16px;background:#fff;">
            ${contenido}
        </div>
    </details>
    <script>
    (()=>{
        const det = document.currentScript.previousElementSibling;
        if(!det) return;
        det.addEventListener('toggle', ()=>{
            const arr = det.querySelector('.col-arrow-${id}');
            if(arr) arr.style.transform = det.open ? 'rotate(90deg)' : '';
        });
        if(det.open){ const arr=det.querySelector('.col-arrow-${id}'); if(arr) arr.style.transform='rotate(90deg)'; }
    })();
    </script>`;
}

// ── Normalización de texto ─────────────────────────────────────────────
function normalizar(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // quitar tildes
}

// ── Detección de intención ─────────────────────────────────────────────
function detectarIntencion(pregunta) {
    const q = normalizar(pregunta);

    // ── Detección de habitación específica (número en la pregunta) ──────────
    const matchHab = q.match(/\b(hab(?:itacion)?[\s#\-]*(\d{3,5})|cuarto[\s#\-]*(\d{3,5})|(\d{3,5})[\s]*(hab|cuarto|pieza|room))\b/);
    const habNumero = matchHab
        ? (matchHab[2] || matchHab[3] || matchHab[4])
        : (/\b(\d{3,5})\b/.test(q) && !q.includes('cama') && !q.includes('%') ? q.match(/\b(\d{3,5})\b/)?.[1] : null);

    const intenciones = [
        { id: 'RESUMEN_GENERAL', palabras: ['resumen', 'general', 'overview', 'todo', 'completo', 'informe', 'estado actual', 'situacion', 'como esta el campa', 'reporte'] },
        { id: 'CAMAS_PERDIDAS', palabras: ['camas perdidas', 'cama perdida', 'perdida', 'perdidas', 'desperdicio', 'desperdiciada', 'sola', 'solo en la habitacion', 'habitacion con uno', 'media habitacion', 'medio llena', 'subutilizada', 'subutilizado', 'inefici'] },
        { id: 'HABITACIONES_LIBRES', palabras: ['libre', 'disponible', 'vacia', 'vacias', 'sin ocupar', 'desocupada'] },
        { id: 'HABITACIONES_OCUPADAS', palabras: ['ocupad', 'full', 'completa', 'llena', 'con gente'] },
        { id: 'CUPOS_GERENCIA', palabras: [
            'cupo', 'cupos por gerencia', 'limite gerencia', 'disponibles por gerencia',
            'camas gerencia', 'cuantas camas tiene', 'cupos disponibles', 'cupos libres',
            'cupos ocupados', 'contrato', 'contratos', 'contratos sap', 'sap',
            'maestro contrato', 'v2_cupos', 'cupos empresa', 'cupos de la empresa',
            'cupos de la gerencia', 'cuantos cupos', 'limite de cupos', 'cupos habilitados',
            'cupos restantes', 'cupos asignados', 'empresa tiene cupos', 'gerencia tiene cupos'
        ] },
        { id: 'GERENCIAS_DETALLE', palabras: ['gerencia', 'gerencias', 'por gerencia', 'todas las gerencias', 'desglose gerencia', 'empresas por gerencia', 'que gerencias hay', 'ver gerencias'] },

        { id: 'TURNO_DIA_NOCHE', palabras: ['camas dia', 'camas de dia', 'camas noche', 'camas de noche', 'turno dia', 'turno noche', 'disponibles de dia', 'disponibles de noche', 'pabellon noche', 'pabellon dia', 'camas por turno', 'turno', 'dia disponible', 'noche disponible'] },
        { id: 'CAMAS_CAPACIDAD', palabras: ['capacidad', 'espacio', 'cuantas camas', 'total camas', 'camas disponibles', 'camas libres'] },
        { id: 'TRABAJADORES_EMPRESA', palabras: ['trabajador', 'personal', 'emplead', 'gente', 'quien esta', 'quien hay', 'cuantos son', 'anglo', 'aramark', 'constructora', 'empresa'] },
        { id: 'SOLICITUDES', palabras: ['solicitud', 'reserva', 'pedido', 'solicitudes', 'b2b', 'pendiente', 'aprobad', 'rechazad'] },
        { id: 'EDIFICIO_DETALLE', palabras: ['pabellon', 'edificio', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8', '220', 'pab'] },
        { id: 'GENERO_BREAKDOWN', palabras: ['mujer', 'hombre', 'femenin', 'masculin', 'genero', 'sexo', 'dama'] },
        { id: 'ALERTAS', palabras: ['alerta', 'problema', 'error', 'issue', 'bloqueada', 'mantenimiento', 'sin asignar'] },
    ];

    // Si detectamos un número de habitación concreto, priorizar ese intent
    if (habNumero && (q.includes('hab') || q.includes('cuarto') || q.includes('pieza') || q.includes('room') || /^[\s\d]+$/.test(q.trim()) || q.match(/\b\d{3,5}\b/))) {
        return { id: 'HABITACION_DETALLE', edificioFiltro: null, empresaFiltro: null, habNumero };
    }

    // Detectar también edificio específico
    let edificioFiltro = null;
    const matchPab = q.match(/pabellon\s*(\d+)|p-?(\d+)/);
    const match220 = q.includes('220');
    if (matchPab) edificioFiltro = `P-${matchPab[1] || matchPab[2]}`;
    if (match220) edificioFiltro = '220';

    // Detectar empresa específica mencionada
    let empresaFiltro = null;
    const empresasConocidas = ['anglo', 'aramark', 'codelco', 'antofagasta', 'bechtel', 'fluor'];
    empresasConocidas.forEach(emp => {
        if (q.includes(emp)) empresaFiltro = emp;
    });

    for (const int of intenciones) {
        if (int.palabras.some(p => q.includes(p))) {
            return { id: int.id, edificioFiltro, empresaFiltro, habNumero: null };
        }
    }

    return { id: 'RESUMEN_GENERAL', edificioFiltro, empresaFiltro, habNumero: null };
}

// ── Helpers de cálculo ─────────────────────────────────────────────────────────────────────
function calcularEstadisticasHabitaciones(rooms, buildings) {
    const total     = rooms.length;
    const ocupadas  = rooms.filter(r => r.status === 'occupied').length;
    const libres    = rooms.filter(r => r.status === 'free').length;
    const bloqueadas= rooms.filter(r => r.status === 'blocked').length;

    let totalCamas = 0, camasOcupadas = 0;
    rooms.forEach(r => {
        const cap = r.bedCount || 2;
        totalCamas += cap;
        // Usar Object.values para ser independiente de la key (C1/C2/day/night)
        camasOcupadas += Object.values(r.beds || {}).filter(b => b?.occupant).length;
    });

    // 🌙 Hab / Camas de NOCHE
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = b);
    let habNoche = 0, camasNoche = 0, camasNocheOcupadas = 0;
    rooms.forEach(r => {
        const b = buildingMap[r.buildingId];
        const shift = (r.reservedShift || b?.shifts?.[0] || '').toLowerCase();
        const isNoche = shift.includes('noche') || shift.includes('night');
        if (isNoche) {
            habNoche++;
            camasNoche += r.bedCount || 2;
            camasNocheOcupadas += Object.values(r.beds || {}).filter(b => b?.occupant).length;
        }
    });

    const porEdificio = {};
    rooms.forEach(r => {
        const bName = buildingMap[r.buildingId]?.name || `Pab. ${r.buildingId}`;
        if (!porEdificio[bName]) porEdificio[bName] = { total:0, ocupadas:0, libres:0, camas:0, camasOcupadas:0 };
        porEdificio[bName].total++;
        if (r.status === 'occupied') porEdificio[bName].ocupadas++;
        if (r.status === 'free')     porEdificio[bName].libres++;
        porEdificio[bName].camas += r.bedCount || 2;
        porEdificio[bName].camasOcupadas += Object.values(r.beds || {}).filter(b => b?.occupant).length;
    });

    return { total, ocupadas, libres, bloqueadas, totalCamas, camasOcupadas,
             habNoche, camasNoche, camasNocheOcupadas, porEdificio };
}

function extraerTrabajadores(rooms, buildings) {
    const trabajadores = [];
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = b.name || b.code);

    rooms.forEach(r => {
        const edificio = buildingMap[r.buildingId] || `Ed. ${r.buildingId}`;
        // Clave-agnóstico: soporta tanto C1/C2 como day/night/extra
        Object.entries(r.beds || {}).forEach(([slot, bed]) => {
            if (bed?.occupant) {
                trabajadores.push({
                    nombre: bed.occupant,
                    empresa: bed.company || '—',
                    turno: bed.shift || slot,
                    genero: bed.gender || '—',
                    rut: bed.rut || '—',
                    habitacion: `${edificio} · Hab. ${r.number}`,
                    cama: slot === 'day' ? 'Día' : slot === 'night' ? 'Noche' : 'Extra',
                    llegada: bed.arrivalDate || '—',
                    salida: bed.departureDate || '—',
                });
            }
        });
    });
    return trabajadores;
}

function agruparPorEmpresa(trabajadores) {
    const grupos = {}; // key normalizada → { label original, count }
    trabajadores.forEach(t => {
        const raw = t.empresa || 'Sin empresa';
        const key = normalizar(raw); // clave case-insensitive y sin tildes
        if (!grupos[key]) {
            // Guardar la primera forma encontrada como etiqueta display
            const label = raw.trim().replace(/\b\w/g, c => c.toUpperCase());
            grupos[key] = { label, count: 0 };
        }
        grupos[key].count++;
    });
    return Object.values(grupos)
        .sort((a, b) => b.count - a.count)
        .map(g => [g.label, g.count]);
}

function porcentaje(parte, total) {
    if (total === 0) return '0%';
    return `${Math.round((parte / total) * 100)}%`;
}

function barraProgreso(parte, total, color) {
    const pct = total === 0 ? 0 : Math.round((parte / total) * 100);
    return `
        <div style="display:flex;align-items:center;gap:10px;margin:4px 0;">
            <div style="flex:1;background:#f1f5f9;border-radius:99px;height:8px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:${color};border-radius:99px;transition:width 0.8s ease;"></div>
            </div>
            <span style="font-size:12px;font-weight:700;color:${color};min-width:36px;text-align:right;">${pct}%</span>
        </div>`;
}

// ── Generadores de informe por intención ──────────────────────────────

function generarResumenGeneral(datos) {
    const { rooms, buildings, requests, angloStats } = datos;
    const stats = calcularEstadisticasHabitaciones(rooms, buildings);
    const trabajadores = extraerTrabajadores(rooms, buildings);
    const empresas = agruparPorEmpresa(trabajadores);
    const solicPend = requests.filter(r => r.status === 'pending' || r.status === 'accepted').length;
    const solicTotal = requests.length;
    const pctOcup = stats.totalCamas > 0 ? Math.round((stats.camasOcupadas / stats.totalCamas) * 100) : 0;

    // Helper KPI compacto para la fila dashboard
    const kpiMini = (icon, label, value, color, bg = '#f8fafc') =>
        `<div style="background:${bg};border-radius:12px;padding:12px;border-top:3px solid ${color};text-align:center">
          <div style="font-size:18px">${icon}</div>
          <div style="font-size:22px;font-weight:800;color:${color}">${value}</div>
          <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">${label}</div>
         </div>`;

    let copcHTML = '', r220HTML = '', copcCam=0,copcOcu=0,copcLib=0, r220Cam=0,r220Ocu=0,r220Lib=0;
    const edSorted = Object.entries(stats.porEdificio).sort((a, b) => a[0].localeCompare(b[0]));
    edSorted.forEach(([nombre, ed]) => {
        const pctOc = ed.total === 0 ? 0 : Math.round((ed.ocupadas / ed.total) * 100);
        const row = `
        <tr>
            <td style="font-weight:600;padding:8px 12px;">${nombre}</td>
            <td style="text-align:center;padding:8px 12px;">${ed.total}</td>
            <td style="text-align:center;padding:8px 12px;color:#16a34a;font-weight:700;">${ed.libres}</td>
            <td style="text-align:center;padding:8px 12px;color:#c0392b;font-weight:700;">${ed.ocupadas}</td>
            <td style="text-align:center;padding:8px 12px;">${ed.camas}</td>
            <td style="text-align:center;padding:8px 12px;">
                <span style="background:${pctOc > 80 ? '#fee2e2' : pctOc > 50 ? '#fef3c7' : '#dcfce7'};color:${pctOc > 80 ? '#c0392b' : pctOc > 50 ? '#b45309' : '#16a34a'};padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;">${pctOc}%</span>
            </td>
        </tr>`;
        if (/r.?220/i.test(nombre)) {
            r220HTML += row; r220Cam+=ed.camas; r220Ocu+=ed.ocupadas; r220Lib+=ed.libres;
        } else {
            copcHTML += row; copcCam+=ed.camas; copcOcu+=ed.ocupadas; copcLib+=ed.libres;
        }
    });
    const totCam=copcCam+r220Cam, totOcu=copcOcu+r220Ocu, totLib=copcLib+r220Lib;

    let empresasHTML = '';
    empresas.slice(0, 10).forEach(([emp, count]) => {
        empresasHTML += `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
            <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#c0392b,#e74c3c);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;">${emp.charAt(0).toUpperCase()}</div>
            <div style="flex:1;">
                <div style="font-weight:700;font-size:14px;">${emp}</div>
                ${barraProgreso(count, trabajadores.length, '#c0392b')}
            </div>
            <div style="font-weight:800;font-size:18px;color:#c0392b;">${count}</div>
        </div>`;
    });

    return `
    <div class="informe-section">

        <!-- ── Dashboard de Ocupación (igual que la pantalla principal) ── -->
        <div style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border-radius:16px;padding:16px;margin-bottom:20px;border:1px solid #e2e8f0">
          <div style="font-size:13px;font-weight:700;color:#475569;margin-bottom:12px">📊 Dashboard de Ocupación — Tiempo Real</div>

          <!-- Fila 1: inventario general -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:8px">
            ${kpiMini('🛏️','Total Camas', stats.totalCamas,'#6366f1')}
            ${kpiMini('✅','Disponibles', stats.totalCamas - stats.camasOcupadas,'#10b981')}
            ${kpiMini('🔴','Ocupadas', stats.camasOcupadas,'#ef4444')}
            ${kpiMini('📊','% Ocupación', pctOcup+'%', pctOcup>80?'#ef4444':pctOcup>50?'#f59e0b':'#10b981')}
            ${angloStats ? kpiMini('🟡','Hab. Mantención', angloStats.habMant,'#f59e0b') : ''}
            ${angloStats?.totalBodega > 0 ? kpiMini('📦','Bodegas', angloStats.totalBodega,'#64748b') : ''}
            ${angloStats?.totalReserva > 0 ? kpiMini('📌','En Reserva', angloStats.totalReserva,'#7c3aed') : ''}
          </div>

          <!-- Fila 2: noche y Anglo -->
          ${angloStats ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px">
            ${kpiMini('🌙','Total Noche', angloStats.totalNoche,'#4338ca')}
            ${kpiMini('🌙✅','Disp. Noche', angloStats.dispNoche,'#6366f1')}
            ${angloStats.totalAngloNoche > 0 ? kpiMini('⛏️🌙','Anglo Noche', angloStats.totalAngloNoche,'#b45309') : ''}
            ${angloStats.totalAngloNoche > 0 ? kpiMini('⛏️🌙✅','Disp. Anglo Noche', angloStats.dispAngloNoche,'#92400e') : ''}
            ${angloStats.totalAngloDia > 0 ? kpiMini('⛏️☀️','Anglo Día', angloStats.totalAngloDia,'#d97706') : ''}
            ${angloStats.totalAngloDia > 0 ? kpiMini('⛏️☀️✅','Disp. Anglo Día', angloStats.dispAngloDia,'#f59e0b') : ''}
          </div>` : ''}
        </div>

        <!-- ── KPIs heredados (habitaciones) ── -->
        <div class="kpi-grid">
            <div class="kpi-card kpi-red">
                <div class="kpi-icon">🏠</div>
                <div class="kpi-value">${stats.total}</div>
                <div class="kpi-label">Habitaciones Total</div>
            </div>
            <div class="kpi-card kpi-green">
                <div class="kpi-icon">✅</div>
                <div class="kpi-value">${stats.libres}</div>
                <div class="kpi-label">Disponibles</div>
            </div>
            <div class="kpi-card kpi-orange">
                <div class="kpi-icon">👥</div>
                <div class="kpi-value">${stats.ocupadas}</div>
                <div class="kpi-label">Ocupadas</div>
            </div>
            <div class="kpi-card kpi-blue">
                <div class="kpi-icon">🛏️</div>
                <div class="kpi-value">${stats.camasOcupadas}<span style="font-size:14px;opacity:0.6;">/${stats.totalCamas}</span></div>
                <div class="kpi-label">Camas Ocupadas</div>
            </div>
            <div class="kpi-card kpi-purple">
                <div class="kpi-icon">👷</div>
                <div class="kpi-value">${trabajadores.length}</div>
                <div class="kpi-label">Trabajadores en Camp.</div>
            </div>
            <div class="kpi-card kpi-yellow">
                <div class="kpi-icon">📩</div>
                <div class="kpi-value">${solicPend}<span style="font-size:14px;opacity:0.6;">/${solicTotal}</span></div>
                <div class="kpi-label">Solicitudes Pendientes</div>
            </div>
            ${stats.habNoche > 0 ? `
            <div class="kpi-card" style="background:linear-gradient(135deg,#0f172a,#1e293b);border:none;">
                <div class="kpi-icon">🌙</div>
                <div class="kpi-value" style="color:#818cf8;">${stats.habNoche}</div>
                <div class="kpi-label" style="color:#94a3b8;">Hab. Noche</div>
            </div>
            <div class="kpi-card" style="background:linear-gradient(135deg,#0f172a,#1e293b);border:none;">
                <div class="kpi-icon">🌙🛏️</div>
                <div class="kpi-value" style="color:#818cf8;">${stats.camasNocheOcupadas}<span style="font-size:14px;opacity:0.5;">/${stats.camasNoche}</span></div>
                <div class="kpi-label" style="color:#94a3b8;">Camas Noche Usadas</div>
            </div>` : ''}
        </div>

        <h3 class="section-title">📊 Estado por Edificio</h3>

        <!-- COPC colapsable -->
        <details style="margin-bottom:10px">
          <summary style="cursor:pointer;background:linear-gradient(135deg,#1e293b,#334155);color:#fff;
            padding:10px 16px;border-radius:10px;font-weight:700;font-size:13px;list-style:none;
            display:flex;justify-content:space-between;align-items:center">
            <span>🏢 Campamento COPC &nbsp;<span style="opacity:.7;font-size:11px">${copcCam} camas · ${copcLib} disp. · ${copcCam>0?Math.round(copcOcu/copcCam*100):0}% ocup.</span></span>
            <span style="font-size:11px;opacity:.6">▼ ver</span>
          </summary>
          <div class="table-wrap">
            <table class="informe-table">
              <thead><tr><th>Edificio</th><th>Total Hab.</th><th>Libres</th><th>Ocupadas</th><th>Camas</th><th>Ocupación</th></tr></thead>
              <tbody>${copcHTML}</tbody>
            </table>
          </div>
        </details>

        <!-- R-220 colapsable -->
        ${r220HTML ? `
        <details style="margin-bottom:10px">
          <summary style="cursor:pointer;background:linear-gradient(135deg,#312e81,#4338ca);color:#fff;
            padding:10px 16px;border-radius:10px;font-weight:700;font-size:13px;list-style:none;
            display:flex;justify-content:space-between;align-items:center">
            <span>🏗️ Edificio R-220 &nbsp;<span style="opacity:.7;font-size:11px">${r220Cam} camas · ${r220Lib} disp. · ${r220Cam>0?Math.round(r220Ocu/r220Cam*100):0}% ocup.</span></span>
            <span style="font-size:11px;opacity:.6">▼ ver</span>
          </summary>
          <div class="table-wrap">
            <table class="informe-table">
              <thead><tr><th>Edificio</th><th>Total Hab.</th><th>Libres</th><th>Ocupadas</th><th>Camas</th><th>Ocupación</th></tr></thead>
              <tbody>${r220HTML}</tbody>
            </table>
          </div>
        </details>` : ''}

        <!-- Resumen Combinado -->
        <div style="background:linear-gradient(135deg,#4338ca,#6366f1);border-radius:10px;padding:12px 18px;
          display:flex;justify-content:space-between;align-items:center;color:#fff;margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <span style="font-weight:800;font-size:14px">📊 TOTAL COMBINADO COPC + R-220</span>
          <span style="font-size:13px;opacity:.9">${totCam} camas &middot; ${totLib} disp. &middot; ${totCam>0?Math.round(totOcu/totCam*100):0}% ocupación</span>
        </div>

        ${empresas.length > 0 ? `
        <h3 class="section-title">🏢 Trabajadores por Empresa</h3>
        <div class="empresas-list">${empresasHTML}</div>` : ''}
    </div>`;
}

function generarHabitacionesLibres(datos, edificioFiltro) {
    const { rooms, buildings } = datos;
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = { name: b.name || b.code, code: b.code });

    let habitaciones = rooms.filter(r => r.status === 'free');
    if (edificioFiltro) {
        habitaciones = habitaciones.filter(r => {
            const b = buildingMap[r.buildingId];
            return b && (normalizar(b.code).includes(normalizar(edificioFiltro)) || normalizar(b.name).includes(normalizar(edificioFiltro)));
        });
    }

    const porEdificio = {};
    habitaciones.forEach(r => {
        const b = buildingMap[r.buildingId];
        const bnom = b?.name || `Ed.${r.buildingId}`;
        if (!porEdificio[bnom]) porEdificio[bnom] = [];
        porEdificio[bnom].push(r);
    });

    let html = `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-green">
                <div class="kpi-icon">🟢</div>
                <div class="kpi-value">${habitaciones.length}</div>
                <div class="kpi-label">Habitaciones Libres${edificioFiltro ? ` — ${edificioFiltro}` : ''}</div>
            </div>
            <div class="kpi-card kpi-blue">
                <div class="kpi-icon">🛏️</div>
                <div class="kpi-value">${habitaciones.reduce((s, r) => s + (r.bedCount || 2), 0)}</div>
                <div class="kpi-label">Camas Disponibles</div>
            </div>
        </div>`;

    let firstBuilding = true;
    Object.entries(porEdificio).sort((a, b) => a[0].localeCompare(b[0])).forEach(([nombre, habs]) => {
        const chips = habs
            .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
            .map(r => `<div class="room-chip free">Hab. ${r.number} <span>${r.bedCount || 2} camas</span></div>`)
            .join('');

        html += collapsiblePanel(
            `🏢 ${nombre}`,
            `<div class="chips-grid">${chips}</div>`,
            `${habs.length} libres`,
            '#16a34a',
            firstBuilding // primer edificio abierto, el resto cerrado
        );
        firstBuilding = false;
    });

    html += `</div>`;
    return html;
}

function generarHabitacionesOcupadas(datos, edificioFiltro) {
    const { rooms, buildings } = datos;
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = { name: b.name || b.code, code: b.code });

    let habitaciones = rooms.filter(r => r.status === 'occupied');
    if (edificioFiltro) {
        habitaciones = habitaciones.filter(r => {
            const b = buildingMap[r.buildingId];
            return b && (normalizar(b.code).includes(normalizar(edificioFiltro)) || normalizar(b.name).includes(normalizar(edificioFiltro)));
        });
    }

    // Agrupar por edificio
    const porEdificio = {};
    habitaciones
        .sort((a, b) => {
            const bna = buildingMap[a.buildingId]?.name || '';
            const bnb = buildingMap[b.buildingId]?.name || '';
            return bna.localeCompare(bnb) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
        })
        .forEach(r => {
            const bnom = buildingMap[r.buildingId]?.name || `Ed.${r.buildingId}`;
            if (!porEdificio[bnom]) porEdificio[bnom] = [];
            porEdificio[bnom].push(r);
        });

    let paneles = '';
    let firstBuilding = true;
    Object.entries(porEdificio).forEach(([bnom, habs]) => {
        let rows = '';
        habs.forEach(r => {
            const ocupantes = ['day', 'night', 'extra']
                .filter(k => r.beds?.[k]?.occupant)
                .map(k => `<div style="font-size:12px;"><b>${r.beds[k].occupant}</b> · ${r.beds[k].company || '—'} · <span style="color:#64748b;">${k === 'day' ? 'Día' : k === 'night' ? 'Noche' : 'Extra'}</span></div>`)
                .join('');
            rows += `
            <tr>
                <td style="padding:8px 12px;font-weight:600;">Hab. ${r.number}</td>
                <td style="padding:8px 12px;">${ocupantes}</td>
                <td style="padding:8px 12px;text-align:center;">${r.bedCount || 2}</td>
                <td style="padding:8px 12px;text-align:center;">${['day','night','extra'].filter(k => r.beds?.[k]?.occupant).length}</td>
            </tr>`;
        });

        const tablaHTML = `
            <table class="informe-table">
                <thead><tr><th>Habitación</th><th>Ocupantes</th><th>Cap.</th><th>Ocup.</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

        paneles += collapsiblePanel(
            `🏢 ${bnom}`,
            tablaHTML,
            `${habs.length} hab.`,
            '#c0392b',
            firstBuilding
        );
        firstBuilding = false;
    });

    return `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-orange">
                <div class="kpi-icon">🔴</div>
                <div class="kpi-value">${habitaciones.length}</div>
                <div class="kpi-label">Habitaciones Ocupadas${edificioFiltro ? ` — ${edificioFiltro}` : ''}</div>
            </div>
        </div>
        <h3 class="section-title">🏠 Detalle por Pabellón</h3>
        ${paneles || '<p style="color:#94a3b8;text-align:center;padding:20px">Sin habitaciones ocupadas</p>'}
    </div>`;
}


function generarTrabajadoresPorEmpresa(datos, empresaFiltro) {
    const { rooms, buildings } = datos;
    let trabajadores = extraerTrabajadores(rooms, buildings);

    let titulo = 'Todos los Trabajadores en Campamento';
    if (empresaFiltro) {
        trabajadores = trabajadores.filter(t => normalizar(t.empresa).includes(normalizar(empresaFiltro)));
        titulo = `Trabajadores de "${empresaFiltro.charAt(0).toUpperCase() + empresaFiltro.slice(1)}"`;
    }

    const mujeres  = trabajadores.filter(t => t.genero === 'F').length;
    const hombres  = trabajadores.filter(t => t.genero === 'M').length;
    const empresas = agruparPorEmpresa(trabajadores);

    // Agrupar trabajadores por empresa para hacer cada empresa un desplegable
    const porEmpresa = {};
    trabajadores.forEach(t => {
        const emp = t.empresa || 'Sin empresa';
        if (!porEmpresa[emp]) porEmpresa[emp] = [];
        porEmpresa[emp].push(t);
    });

    // Si hay filtro de empresa, mostrar tabla directamente (sin agrupar)
    let cuerpo = '';
    if (empresaFiltro || Object.keys(porEmpresa).length <= 1) {
        // Una sola empresa o filtro activo → tabla directa
        let rows = '';
        trabajadores.slice(0, 200).forEach((t, i) => {
            rows += `
            <tr style="${i % 2 === 0 ? 'background:#fafafa;' : ''}">
                <td style="padding:8px 12px;font-weight:600;">${t.nombre}</td>
                <td style="padding:8px 12px;">${t.habitacion}</td>
                <td style="padding:8px 12px;text-align:center;">
                    <span style="background:${t.genero === 'F' ? '#fce7f3' : '#dbeafe'};color:${t.genero === 'F' ? '#be185d' : '#1d4ed8'};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">${t.genero === 'F' ? '♀' : '♂'}</span>
                </td>
                <td style="padding:8px 12px;">${t.turno}</td>
                <td style="padding:8px 12px;color:#64748b;font-size:12px;">${t.salida !== '—' ? '📅 ' + t.salida : '—'}</td>
            </tr>`;
        });
        cuerpo = `<div class="table-wrap">
            <table class="informe-table">
                <thead><tr><th>Nombre</th><th>Habitación</th><th>Género</th><th>Turno</th><th>Salida</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">Sin trabajadores</td></tr>'}</tbody>
            </table></div>`;
    } else {
        // Múltiples empresas → un desplegable por empresa
        let firstEmp = true;
        Object.entries(porEmpresa)
            .sort((a, b) => b[1].length - a[1].length) // mayor a menor
            .forEach(([emp, lista]) => {
                let rows = '';
                lista.slice(0, 100).forEach((t, i) => {
                    rows += `
                    <tr style="${i % 2 === 0 ? 'background:#fafafa;' : ''}">
                        <td style="padding:7px 12px;font-weight:600;">${t.nombre}</td>
                        <td style="padding:7px 12px;">${t.habitacion}</td>
                        <td style="padding:7px 12px;text-align:center;">
                            <span style="background:${t.genero === 'F' ? '#fce7f3' : '#dbeafe'};color:${t.genero === 'F' ? '#be185d' : '#1d4ed8'};padding:2px 6px;border-radius:99px;font-size:11px;font-weight:700;">${t.genero === 'F' ? '♀' : '♂'}</span>
                        </td>
                        <td style="padding:7px 12px;">${t.turno}</td>
                        <td style="padding:7px 12px;color:#64748b;font-size:12px;">${t.salida !== '—' ? '📅 ' + t.salida : '—'}</td>
                    </tr>`;
                });
                if (lista.length > 100) rows += `<tr><td colspan="5" style="text-align:center;padding:10px;color:#94a3b8;font-size:12px;">... y ${lista.length - 100} más</td></tr>`;

                const tablaHTML = `<div class="table-wrap"><table class="informe-table">
                    <thead><tr><th>Nombre</th><th>Habitación</th><th>Género</th><th>Turno</th><th>Salida</th></tr></thead>
                    <tbody>${rows}</tbody></table></div>`;

                cuerpo += collapsiblePanel(
                    `🏢 ${emp}`,
                    tablaHTML,
                    `${lista.length} personas`,
                    '#c0392b',
                    firstEmp
                );
                firstEmp = false;
            });
    }

    return `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-red">
                <div class="kpi-icon">👷</div>
                <div class="kpi-value">${trabajadores.length}</div>
                <div class="kpi-label">${titulo}</div>
            </div>
            <div class="kpi-card kpi-blue">
                <div class="kpi-icon">♂</div>
                <div class="kpi-value">${hombres}</div>
                <div class="kpi-label">Hombres ${porcentaje(hombres, trabajadores.length)}</div>
            </div>
            <div class="kpi-card kpi-purple">
                <div class="kpi-icon">♀</div>
                <div class="kpi-value">${mujeres}</div>
                <div class="kpi-label">Mujeres ${porcentaje(mujeres, trabajadores.length)}</div>
            </div>
        </div>
        <h3 class="section-title">📋 ${empresaFiltro ? 'Lista de Trabajadores' : 'Trabajadores por Empresa'}</h3>
        ${cuerpo}
    </div>`;
}


function generarSolicitudes(datos) {
    const { requests } = datos;

    const ESTADO_LABEL = {
        pending: { label: 'Pendiente', color: '#b45309', bg: '#fef3c7' },
        accepted: { label: 'Aceptada', color: '#1d4ed8', bg: '#dbeafe' },
        assigned: { label: 'Asignada', color: '#16a34a', bg: '#dcfce7' },
        rejected: { label: 'Rechazada', color: '#be123c', bg: '#ffe4e6' },
        completed: { label: 'Completada', color: '#7c3aed', bg: '#ede9fe' },
    };

    const countByStatus = {};
    requests.forEach(r => {
        countByStatus[r.status] = (countByStatus[r.status] || 0) + 1;
    });

    let rows = '';
    [...requests].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).forEach(r => {
        const est = ESTADO_LABEL[r.status] || { label: r.status, color: '#64748b', bg: '#f1f5f9' };
        const totalW = r.workers?.length || 0;
        const asignados = r.workers?.filter(w => w.assignedRoomStr)?.length || 0;
        rows += `
        <tr>
            <td style="padding:10px 12px;font-weight:700;">${r.company || '—'}</td>
            <td style="padding:10px 12px;">${r.createdAt ? r.createdAt.slice(0, 10) : '—'}</td>
            <td style="padding:10px 12px;text-align:center;">${totalW}</td>
            <td style="padding:10px 12px;text-align:center;">${asignados}/${totalW}</td>
            <td style="padding:10px 12px;">
                <span style="background:${est.bg};color:${est.color};padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;">${est.label}</span>
            </td>
        </tr>`;
    });

    return `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-blue"><div class="kpi-icon">📩</div><div class="kpi-value">${requests.length}</div><div class="kpi-label">Total Solicitudes</div></div>
            <div class="kpi-card kpi-yellow"><div class="kpi-icon">⏳</div><div class="kpi-value">${countByStatus['pending'] || 0}</div><div class="kpi-label">Pendientes</div></div>
            <div class="kpi-card kpi-green"><div class="kpi-icon">✅</div><div class="kpi-value">${(countByStatus['assigned'] || 0) + (countByStatus['completed'] || 0)}</div><div class="kpi-label">Asignadas/Completadas</div></div>
            <div class="kpi-card kpi-red"><div class="kpi-icon">❌</div><div class="kpi-value">${countByStatus['rejected'] || 0}</div><div class="kpi-label">Rechazadas</div></div>
        </div>
        <h3 class="section-title">📋 Listado de Solicitudes</h3>
        <div class="table-wrap">
            <table class="informe-table">
                <thead><tr><th>Empresa</th><th>Fecha</th><th>Trabajadores</th><th>Asignados</th><th>Estado</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">Sin solicitudes registradas</td></tr>'}</tbody>
            </table>
        </div>
    </div>`;
}

function generarEdificioDetalle(datos, edificioFiltro) {
    const { rooms, buildings } = datos;
    const building = buildings.find(b => {
        const bCode = normalizar(b.code);
        const bName = normalizar(b.name);
        const filtro = normalizar(edificioFiltro);
        return bCode.includes(filtro) || bName.includes(filtro);
    });

    if (!building) {
        return `<div class="informe-section"><p style="color:#64748b;text-align:center;padding:40px;">❌ No se encontró el edificio "<b>${edificioFiltro}</b>". Intenta con "Pabellón 3", "P-3" o "R-220".</p></div>`;
    }

    const habsEdif = rooms.filter(r => r.buildingId === building.id);
    const stats = calcularEstadisticasHabitaciones(habsEdif, buildings);
    const trabajadores = extraerTrabajadores(habsEdif, buildings);

    let pisos = {};
    habsEdif.forEach(r => {
        const f = r.floor || 1;
        if (!pisos[f]) pisos[f] = [];
        pisos[f].push(r);
    });

    let pisosHTML = '';
    Object.keys(pisos).sort((a, b) => a - b).forEach(piso => {
        pisosHTML += `<h4 style="margin:16px 0 8px;font-weight:700;color:#64748b;font-size:13px;">PISO ${piso}</h4><div class="chips-grid">`;
        pisos[piso].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true })).forEach(r => {
            const cls = r.status === 'free' ? 'free' : r.status === 'blocked' ? 'blocked' : 'occupied';
            const occ = ['day','night','extra'].filter(k => r.beds?.[k]?.occupant).length;
            pisosHTML += `<div class="room-chip ${cls}" title="${r.status}">Hab. ${r.number}<span>${occ}/${r.bedCount||2}</span></div>`;
        });
        pisosHTML += `</div>`;
    });

    return `
    <div class="informe-section">
        <h3 style="font-size:20px;font-weight:800;margin-bottom:16px;">🏢 ${building.name}</h3>
        <div class="kpi-grid">
            <div class="kpi-card kpi-red"><div class="kpi-icon">🏠</div><div class="kpi-value">${habsEdif.length}</div><div class="kpi-label">Habitaciones</div></div>
            <div class="kpi-card kpi-green"><div class="kpi-icon">✅</div><div class="kpi-value">${stats.libres}</div><div class="kpi-label">Libres</div></div>
            <div class="kpi-card kpi-orange"><div class="kpi-icon">🔴</div><div class="kpi-value">${stats.ocupadas}</div><div class="kpi-label">Ocupadas</div></div>
            <div class="kpi-card kpi-blue"><div class="kpi-icon">👷</div><div class="kpi-value">${trabajadores.length}</div><div class="kpi-label">Trabajadores</div></div>
        </div>
        <h3 class="section-title">🗺️ Mapa de Habitaciones</h3>
        ${pisosHTML}
        ${trabajadores.length > 0 ? `
        <h3 class="section-title" style="margin-top:20px;">👥 Trabajadores en este edificio</h3>
        <div class="table-wrap">
            <table class="informe-table">
                <thead><tr><th>Nombre</th><th>Empresa</th><th>Habitación</th><th>Género</th><th>Turno</th></tr></thead>
                <tbody>${trabajadores.map(t => `
                <tr>
                    <td style="padding:8px 12px;font-weight:600;">${t.nombre}</td>
                    <td style="padding:8px 12px;">${t.empresa}</td>
                    <td style="padding:8px 12px;">${t.habitacion}</td>
                    <td style="padding:8px 12px;text-align:center;"><span style="background:${t.genero==='F'?'#fce7f3':'#dbeafe'};color:${t.genero==='F'?'#be185d':'#1d4ed8'};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">${t.genero==='F'?'♀':'♂'}</span></td>
                    <td style="padding:8px 12px;">${t.turno}</td>
                </tr>`).join('')}</tbody>
            </table>
        </div>` : ''}
    </div>`;
}

function generarGeneroBreakdown(datos) {
    const { rooms, buildings } = datos;
    const trabajadores = extraerTrabajadores(rooms, buildings);
    const mujeres = trabajadores.filter(t => t.genero === 'F');
    const hombres = trabajadores.filter(t => t.genero === 'M');
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = b.name || b.code);
    const stats = calcularEstadisticasHabitaciones(rooms, buildings);

    let edGenderHTML = '';
    const edSorted = Object.entries(stats.porEdificio).sort((a, b) => a[0].localeCompare(b[0]));
    edSorted.forEach(([nom]) => {
        const edRooms = rooms.filter(r => (buildingMap[r.buildingId] || '') === nom);
        const edTrab = extraerTrabajadores(edRooms, buildings);
        const edF = edTrab.filter(t => t.genero === 'F').length;
        const edM = edTrab.filter(t => t.genero === 'M').length;
        if (edTrab.length > 0) {
            edGenderHTML += `
            <tr>
                <td style="padding:8px 12px;font-weight:700;">${nom}</td>
                <td style="padding:8px 12px;text-align:center;color:#1d4ed8;font-weight:700;">${edM}</td>
                <td style="padding:8px 12px;text-align:center;color:#be185d;font-weight:700;">${edF}</td>
                <td style="padding:8px 12px;text-align:center;font-weight:600;">${edTrab.length}</td>
            </tr>`;
        }
    });

    return `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-red"><div class="kpi-icon">👷</div><div class="kpi-value">${trabajadores.length}</div><div class="kpi-label">Total Trabajadores</div></div>
            <div class="kpi-card kpi-blue"><div class="kpi-icon">♂</div><div class="kpi-value">${hombres.length}</div><div class="kpi-label">Hombres (${porcentaje(hombres.length, trabajadores.length)})</div></div>
            <div class="kpi-card kpi-purple"><div class="kpi-icon">♀</div><div class="kpi-value">${mujeres.length}</div><div class="kpi-label">Mujeres (${porcentaje(mujeres.length, trabajadores.length)})</div></div>
        </div>
        <h3 class="section-title">📊 Desglose por Edificio y Género</h3>
        <div class="table-wrap">
            <table class="informe-table">
                <thead><tr><th>Edificio</th><th>♂ Hombres</th><th>♀ Mujeres</th><th>Total</th></tr></thead>
                <tbody>${edGenderHTML}</tbody>
            </table>
        </div>
    </div>`;
}

function generarCapacidadCamas(datos) {
    const { rooms, buildings } = datos;
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = b.name || b.code);

    const stats = calcularEstadisticasHabitaciones(rooms, buildings);

    let edHTML = '';
    Object.entries(stats.porEdificio).sort((a, b) => a[0].localeCompare(b[0])).forEach(([nom, ed]) => {
        edHTML += `
        <tr>
            <td style="padding:8px 12px;font-weight:700;">${nom}</td>
            <td style="padding:8px 12px;text-align:center;">${ed.camas}</td>
            <td style="padding:8px 12px;text-align:center;color:#c0392b;font-weight:700;">${ed.camasOcupadas}</td>
            <td style="padding:8px 12px;text-align:center;color:#16a34a;font-weight:700;">${ed.camas - ed.camasOcupadas}</td>
            <td style="padding:8px 12px;">
                ${barraProgreso(ed.camasOcupadas, ed.camas, '#c0392b')}
            </td>
        </tr>`;
    });

    return `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-red"><div class="kpi-icon">🛏️</div><div class="kpi-value">${stats.totalCamas}</div><div class="kpi-label">Total Camas</div></div>
            <div class="kpi-card kpi-orange"><div class="kpi-icon">🔴</div><div class="kpi-value">${stats.camasOcupadas}</div><div class="kpi-label">Camas Ocupadas</div></div>
            <div class="kpi-card kpi-green"><div class="kpi-icon">✅</div><div class="kpi-value">${stats.totalCamas - stats.camasOcupadas}</div><div class="kpi-label">Camas Disponibles</div></div>
        </div>
        <h3 class="section-title">🛏️ Capacidad por Edificio</h3>
        <div class="table-wrap">
            <table class="informe-table">
                <thead><tr><th>Edificio</th><th>Total Camas</th><th>Ocupadas</th><th>Libres</th><th>Ocupación</th></tr></thead>
                <tbody>${edHTML}</tbody>
            </table>
        </div>
    </div>`;
}

// ── Camas Perdidas ─────────────────────────────────────────────────────
// Definición: habitación con capacidad ≥ 2 camas que tiene exactamente
// 1 ocupante. La cama vacante es un "espacio perdido" porque podría
// alojar a otra persona pero no puede recibir un nuevo residente de
// género/empresa diferente sin romper las reglas.
function generarCamasPerdidas(datos, edificioFiltro) {
    const { rooms, buildings } = datos;
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = { name: b.name || b.code, code: b.code });

    // Filtrar: habitaciones con 2+ camas y exactamente 1 ocupante ACTIVO
    // NOTA: cargarDatos() guarda las camas como C1, C2… (no 'day'/'night'/'extra')
    // Se usa Object.values() para aceptar cualquier nombre de clave
    let candidatas = rooms.filter(r => {
        const cap = r.bedCount || 2;
        if (cap < 2) return false;
        // Todas las camas en beds[] son ACTIVAS (filtradas por fecha_checkout IS NULL en cargarDatos)
        const bedsActivos = Object.values(r.beds || {}).filter(b => b?.occupant && b.occupant !== '—');
        return bedsActivos.length >= 1 && bedsActivos.length < cap;
    });

    // Filtrar por edificio si se especificó
    if (edificioFiltro) {
        candidatas = candidatas.filter(r => {
            const b = buildingMap[r.buildingId];
            return b && (normalizar(b.code).includes(normalizar(edificioFiltro)) ||
                         normalizar(b.name).includes(normalizar(edificioFiltro)));
        });
    }

    // Calcular camas perdidas totales
    const camasPerdidas = candidatas.reduce((sum, r) => {
        const cap = r.bedCount || 2;
        const ocupadas = Object.values(r.beds || {}).filter(b => b?.occupant && b.occupant !== '—').length;
        return sum + (cap - ocupadas);
    }, 0);

    // Agrupar por edificio para el resumen
    const porEdificio = {};
    candidatas.forEach(r => {
        const b = buildingMap[r.buildingId];
        const bnom = b?.name || `Ed.${r.buildingId}`;
        if (!porEdificio[bnom]) porEdificio[bnom] = { count: 0, perdidas: 0 };
        porEdificio[bnom].count++;
        const cap = r.bedCount || 2;
        const ocup = Object.values(r.beds || {}).filter(b => b?.occupant && b.occupant !== '—').length;
        porEdificio[bnom].perdidas += (cap - ocup);
    });

    // Construir tabla detallada
    let rows = '';
    candidatas
        .sort((a, b) => {
            const bna = buildingMap[a.buildingId]?.name || '';
            const bnb = buildingMap[b.buildingId]?.name || '';
            return bna.localeCompare(bnb) ||
                   String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
        })
        .forEach(r => {
            const bnom = buildingMap[r.buildingId]?.name || `Ed.${r.buildingId}`;
            // Encontrar al ocupante solitario
            const camaOcupada = ['day', 'night', 'extra'].find(k => r.beds?.[k]?.occupant);
            const bed = r.beds?.[camaOcupada];
            const camasLibres = (r.bedCount || 2) - 1;
            const motivo = r.lostBedReason || '';
            const motivoBadge = motivo
                ? `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">${motivo}</span>`
                : `<span style="background:#f1f5f9;color:#94a3b8;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">Sin motivo</span>`;
            rows += `
            <tr>
                <td style="padding:10px 12px;font-weight:700;">${bnom}</td>
                <td style="padding:10px 12px;font-weight:600;">Hab. ${r.number}</td>
                <td style="padding:10px 12px;">
                    <div style="font-weight:600;font-size:13px;">${bed?.occupant || '—'}</div>
                    <div style="font-size:11px;color:#64748b;">${bed?.company || '—'} · ${bed?.shift || '—'}</div>
                </td>
                <td style="padding:10px 12px;text-align:center;">
                    <span style="background:${bed?.gender === 'F' ? '#fce7f3' : '#dbeafe'};color:${bed?.gender === 'F' ? '#be185d' : '#1d4ed8'};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">${bed?.gender === 'F' ? '♀' : '♂'}</span>
                </td>
                <td style="padding:10px 12px;text-align:center;">
                    <span style="background:#fef3c7;color:#b45309;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;">⚠️ ${camasLibres} cama${camasLibres > 1 ? 's' : ''} libre${camasLibres > 1 ? 's' : ''}</span>
                </td>
                <td style="padding:10px 12px;">${motivoBadge}</td>
                <td style="padding:10px 12px;font-size:12px;color:#64748b;">${bed?.departureDate ? '📅 ' + bed.departureDate : '—'}</td>
            </tr>`;
        });

    // Resumen por edificio
    let edHTML = '';
    Object.entries(porEdificio).sort((a, b) => a[0].localeCompare(b[0])).forEach(([nom, ed]) => {
        edHTML += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9;">
            <span style="font-weight:700;">${nom}</span>
            <div style="display:flex;gap:8px;">
                <span style="background:#fee2e2;color:#c0392b;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;">${ed.count} hab.</span>
                <span style="background:#fef3c7;color:#b45309;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;">⚠️ ${ed.perdidas} cama${ed.perdidas > 1 ? 's' : ''} perdida${ed.perdidas > 1 ? 's' : ''}</span>
            </div>
        </div>`;
    });

    const pctPerdida = rooms.length > 0
        ? Math.round((camasPerdidas / rooms.reduce((s, r) => s + (r.bedCount || 2), 0)) * 100)
        : 0;

    // ━━ Desglose Anglo vs Otras Empresas ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const isAnglo = nombre => /anglo/i.test(nombre || '');
    let cpAnglo = 0, cpOtras = 0;
    candidatas.forEach(r => {
        const cap = r.bedCount || 2;
        const bedsAct = Object.values(r.beds || {}).filter(b => b?.occupant && b.occupant !== '—');
        const libres  = cap - bedsAct.length;
        if (libres <= 0) return;
        // Clasificar según empresa del ocupante
        const empresaOcup = bedsAct[0]?.company || '';
        if (isAnglo(empresaOcup)) cpAnglo += libres;
        else                      cpOtras += libres;
    });

    return `
    <div class="informe-section">
        <div style="background:linear-gradient(135deg,#fffbeb,#fef3c7);border:1px solid #fde68a;border-radius:16px;padding:16px;margin-bottom:20px;">
            <div style="font-size:13px;font-weight:700;color:#b45309;margin-bottom:6px;">💡 ¿Qué es una cama perdida?</div>
            <div style="font-size:13px;color:#78350f;line-height:1.6;">Una <strong>cama perdida</strong> es una habitación con capacidad para <strong>2 o más personas</strong> que actualmente tiene <strong>solo 1 ocupante</strong>. La cama vacante no puede recibir a alguien de distinto género o empresa, por lo que ese espacio queda inutilizable.</div>
        </div>

        <div class="kpi-grid">
            <div class="kpi-card kpi-yellow">
                <div class="kpi-icon">⚠️</div>
                <div class="kpi-value">${candidatas.length}</div>
                <div class="kpi-label">Habitaciones con cama perdida${edificioFiltro ? ` — ${edificioFiltro}` : ''}</div>
            </div>
            <div class="kpi-card kpi-orange">
                <div class="kpi-icon">🛏️</div>
                <div class="kpi-value">${camasPerdidas}</div>
                <div class="kpi-label">Camas perdidas totales</div>
            </div>
            <div class="kpi-card kpi-red">
                <div class="kpi-icon">📉</div>
                <div class="kpi-value">${pctPerdida}%</div>
                <div class="kpi-label">Del total de camas sin uso relativo</div>
            </div>
            <div class="kpi-card kpi-green">
                <div class="kpi-icon">💰</div>
                <div class="kpi-value">${camasPerdidas}</div>
                <div class="kpi-label">Cupos adicionales posibles</div>
            </div>
            <div class="kpi-card" style="background:#fffbeb;border:1.5px solid #fde68a;">
                <div class="kpi-icon">⛏️</div>
                <div class="kpi-value" style="color:#92400e;">${cpAnglo}</div>
                <div class="kpi-label">Camas perdidas Anglo American</div>
            </div>
            <div class="kpi-card" style="background:#eff6ff;border:1.5px solid #bfdbfe;">
                <div class="kpi-icon">🏢</div>
                <div class="kpi-value" style="color:#1d4ed8;">${cpOtras}</div>
                <div class="kpi-label">Camas perdidas otras empresas</div>
            </div>
        </div>

        ${Object.keys(porEdificio).length > 0 ? `
        <h3 class="section-title">🏢 Resumen por Edificio</h3>
        <div style="background:#fff;border-radius:16px;padding:16px;border:1px solid #f1f5f9;margin-bottom:20px;">${edHTML}</div>` : ''}

        <h3 class="section-title">📋 Detalle de Habitaciones con Cama Perdida</h3>
        <div class="table-wrap">
            <table class="informe-table">
                <thead>
                    <tr>
                        <th>Edificio</th>
                        <th>Habitación</th>
                        <th>Ocupante solitario</th>
                        <th>Género</th>
                        <th>Camas perdidas</th>
                        <th>Motivo</th>
                        <th>Salida</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8;">✅ No hay camas perdidas — todas las habitaciones están correctamente aprovechadas</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>`;
}
// ── Habitación específica ────────────────────────────────────────────────────
function generarHabitacionDetalle(datos, habNumero) {
    const { rooms, buildings } = datos;
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = b.name || b.code);

    const room = rooms.find(r => String(r.number) === String(habNumero));
    if (!room) {
        return `<div class="informe-section"><p style="text-align:center;padding:40px;color:#94a3b8;">❌ No se encontró la habitación <strong>${habNumero}</strong> en el sistema.</p></div>`;
    }

    const edificio = buildingMap[room.buildingId] || `Edificio ${room.buildingId}`;
    const cap = room.bedCount || 2;
    const keys = ['day', 'night', 'extra'].slice(0, cap);
    const turnoLabel = { day: 'Día ☀️', night: 'Noche 🌙', extra: 'Extra ⭐' };
    const estadoColor = { free: '#16a34a', occupied: '#c0392b', blocked: '#64748b' };
    const estadoLabel = { free: 'Disponible', occupied: 'Ocupada', blocked: 'Bloqueada' };

    let bedsHTML = '';
    keys.forEach(k => {
        const bed = room.beds?.[k];
        const ocupado = !!bed?.occupant;
        bedsHTML += `
        <div style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;
                    background:${ocupado ? '#fff5f5' : '#f0fff4'};
                    border:1.5px solid ${ocupado ? '#fecaca' : '#bbf7d0'};margin-bottom:8px">
            <div style="font-size:24px">${k === 'day' ? '☀️' : k === 'night' ? '🌙' : '⭐'}</div>
            <div style="flex:1">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
                            color:${ocupado ? '#c0392b' : '#16a34a'}">
                    Cama ${turnoLabel[k]} — ${ocupado ? 'Ocupada' : 'Libre'}
                </div>
                ${ocupado ? `
                <div style="font-size:14px;font-weight:800;color:#1a202c;margin-top:2px">${bed.occupant}</div>
                <div style="font-size:12px;color:#64748b;margin-top:2px">
                    🏢 ${bed.company || '—'} &nbsp;·&nbsp;
                    🎯 ${bed.management || bed.gerencia || '—'} &nbsp;·&nbsp;
                    ${bed.gender === 'F' ? '♀️ Mujer' : '♂️ Hombre'}
                </div>
                <div style="font-size:11px;color:#94a3b8;margin-top:2px">
                    RUT: ${bed.rut || '—'} &nbsp;·&nbsp; 📅 Salida: ${bed.departureDate || '—'}
                </div>` : `<div style="font-size:13px;color:#16a34a;font-weight:600;margin-top:2px">✅ Cama libre — disponible para asignar</div>`}
            </div>
        </div>`;
    });

    const ocupantes = keys.filter(k => room.beds?.[k]?.occupant).length;

    return `
    <div class="informe-section">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;padding:16px;
                    background:linear-gradient(135deg,#fff5f5,#ffe4e6);border-radius:16px;
                    border:1.5px solid #fecaca">
            <div style="font-size:36px">🏠</div>
            <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8">${edificio}</div>
                <div style="font-size:24px;font-weight:900;color:#c0392b">Habitación ${room.number}</div>
                <div style="font-size:13px;margin-top:2px">
                    <span style="background:${estadoColor[room.status]};color:#fff;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700">${estadoLabel[room.status] || room.status}</span>
                    &nbsp; Piso ${room.floor || 1} · ${cap} camas · ${ocupantes} ocupadas
                </div>
            </div>
        </div>
        <h3 class="section-title">🛏️ Estado de las Camas</h3>
        ${bedsHTML}
    </div>`;
}

// ── Cupos por Gerencia disponibles (V2 — lee de v2_cupos_gerencias) ───────────
function generarCuposGerencia(datos) {
    const { quotas } = datos;

    if (!quotas || quotas.length === 0) {
        return `<div class="informe-section"><p style="text-align:center;padding:40px;color:#94a3b8;">
            ℹ️ No hay contratos cargados en <b>v2_cupos_gerencias</b>.<br>
            Usa el módulo <b>📊 Cupos por Gerencia</b> para importar el maestro SAP.
        </p></div>`;
    }

    // Agrupar por gerencia para los KPIs
    const gerSet = new Set(quotas.map(q => q.gerencia));
    const totalCupos    = quotas.reduce((s, q) => s + (q.cupos_totales  || 0), 0);
    const totalOcupados = quotas.reduce((s, q) => s + (q.cupos_ocupados || 0), 0);
    const totalLibres   = Math.max(0, totalCupos - totalOcupados);

    // Tabla de contratos
    let rows = '';
    quotas.forEach(q => {
        const ocupados   = q.cupos_ocupados  || 0;
        const totales    = q.cupos_totales   || 0;
        const libres     = Math.max(0, totales - ocupados);
        const pct        = totales > 0 ? Math.min(100, Math.round((ocupados / totales) * 100)) : 0;
        const barColor   = pct >= 100 ? '#e53e3e' : pct >= 80 ? '#dd6b20' : '#38a169';
        const badgeBg    = pct >= 100 ? '#fff5f5' : pct >= 80 ? '#fffbeb' : '#f0fff4';
        const badgeCol   = pct >= 100 ? '#c0392b' : pct >= 80 ? '#92400e' : '#16a34a';
        const statusTxt  = totales === 0 ? '⚪ Sin definir'
                         : pct >= 100    ? '🔴 Agotado'
                         : pct >= 80     ? '🟠 Casi lleno'
                         :                 '🟢 Disponible';
        rows += `
        <tr>
            <td style="padding:10px 12px;font-weight:700;font-family:monospace;font-size:12px;color:#6366f1">${q.numero_contrato||'—'}</td>
            <td style="padding:10px 12px;font-weight:700">${q.company}</td>
            <td style="padding:10px 12px">
                <span style="background:#e0f2fe;color:#0369a1;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">${q.gerencia}</span>
            </td>
            <td style="padding:10px 12px;font-size:12px;color:#64748b;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${q.nombre_contrato||''}">${q.nombre_contrato||'—'}</td>
            <td style="padding:10px 12px;text-align:center;font-weight:800;color:#c0392b">${ocupados}</td>
            <td style="padding:10px 12px;text-align:center;font-weight:700;color:#64748b">${totales || '∞'}</td>
            <td style="padding:10px 12px;text-align:center;font-weight:800;color:${badgeCol}">${totales > 0 ? libres : '∞'}</td>
            <td style="padding:10px 12px">
                <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;background:#e2e8f0;border-radius:99px;height:8px;overflow:hidden;min-width:60px">
                        <div style="height:100%;width:${pct}%;background:${barColor};border-radius:99px;transition:width 0.8s ease"></div>
                    </div>
                    <span style="font-size:11px;font-weight:700;background:${badgeBg};color:${badgeCol};padding:2px 8px;border-radius:99px;white-space:nowrap">${statusTxt}</span>
                </div>
            </td>
        </tr>`;
    });

    return `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-red"><div class="kpi-icon">📋</div><div class="kpi-value">${quotas.length}</div><div class="kpi-label">Contratos</div></div>
            <div class="kpi-card kpi-blue"><div class="kpi-icon">🏢</div><div class="kpi-value">${gerSet.size}</div><div class="kpi-label">Gerencias</div></div>
            <div class="kpi-card kpi-purple"><div class="kpi-icon">🛏️</div><div class="kpi-value">${totalCupos}</div><div class="kpi-label">Cupos Totales</div></div>
            <div class="kpi-card kpi-orange"><div class="kpi-icon">👷</div><div class="kpi-value">${totalOcupados}</div><div class="kpi-label">Cupos Ocupados</div></div>
            <div class="kpi-card kpi-green"><div class="kpi-icon">✅</div><div class="kpi-value">${totalLibres}</div><div class="kpi-label">Cupos Libres</div></div>
        </div>
        <h3 class="section-title">🎯 Cupos por Contrato / Gerencia</h3>
        <div class="table-wrap">
            <table class="informe-table">
                <thead><tr>
                    <th>N° Contrato</th><th>Empresa</th><th>Gerencia</th>
                    <th>Nombre Contrato</th><th>Ocupados</th><th>Cupos</th><th>Libres</th><th>Estado</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

// ── Camas por turno Día / Noche ───────────────────────────────────────────────
// Lógica: si un edificio tiene mainShift='night', TODAS sus camas son de noche.
// Si mainShift='day', TODAS son de día. Si 'mixed', se respeta el slot (day/night/extra).
function generarCamasPorTurno(datos, edificioFiltro) {
    const { rooms, buildings } = datos;
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = {
        name: b.name || b.code,
        code: b.code,
        mainShift: b.mainShift || 'mixed'
    });

    let roomsFiltrados = rooms;
    if (edificioFiltro) {
        roomsFiltrados = rooms.filter(r => {
            const b = buildingMap[r.buildingId];
            return b && (normalizar(b.code).includes(normalizar(edificioFiltro)) ||
                         normalizar(b.name).includes(normalizar(edificioFiltro)));
        });
    }

    let totalDia = 0, usadaDia = 0, totalNoche = 0, usadaNoche = 0, totalExtra = 0, usadaExtra = 0;

    const porEdificio = {};
    roomsFiltrados.forEach(r => {
        const cap = r.bedCount || 2;
        const bInfo = buildingMap[r.buildingId] || { name: `Ed.${r.buildingId}`, mainShift: 'mixed' };
        const bnom = bInfo.name;
        const ms = bInfo.mainShift; // 'day' | 'night' | 'mixed'

        if (!porEdificio[bnom]) porEdificio[bnom] = {
            dia: 0, dia_u: 0, noche: 0, noche_u: 0, extra: 0, extra_u: 0, mainShift: ms
        };

        // Contar ocupantes de todas las camas de esta habitación
        const ocupDia   = r.beds?.day?.occupant   ? 1 : 0;
        const ocupNoche = r.beds?.night?.occupant ? 1 : 0;
        const ocupExtra = r.beds?.extra?.occupant ? 1 : 0;
        const totalOcup = ocupDia + ocupNoche + (cap >= 3 ? ocupExtra : 0);

        if (ms === 'night') {
            // Pabellón de noche → todas las camas son noche
            totalNoche += cap;
            usadaNoche += totalOcup;
            porEdificio[bnom].noche += cap;
            porEdificio[bnom].noche_u += totalOcup;
        } else if (ms === 'day') {
            // Pabellón de día → todas las camas son día
            totalDia += cap;
            usadaDia += totalOcup;
            porEdificio[bnom].dia += cap;
            porEdificio[bnom].dia_u += totalOcup;
        } else {
            // Mixto → cama día, cama noche, cama extra según slot
            if (cap >= 1) { totalDia++;   usadaDia   += ocupDia;   porEdificio[bnom].dia++;   porEdificio[bnom].dia_u   += ocupDia; }
            if (cap >= 2) { totalNoche++; usadaNoche += ocupNoche; porEdificio[bnom].noche++; porEdificio[bnom].noche_u += ocupNoche; }
            if (cap >= 3) { totalExtra++; usadaExtra += ocupExtra; porEdificio[bnom].extra++; porEdificio[bnom].extra_u += ocupExtra; }
        }
    });

    const libreDia   = totalDia   - usadaDia;
    const libreNoche = totalNoche - usadaNoche;
    const libreExtra = totalExtra - usadaExtra;
    const pctDia   = totalDia   > 0 ? Math.round((usadaDia   / totalDia)   * 100) : 0;
    const pctNoche = totalNoche > 0 ? Math.round((usadaNoche / totalNoche) * 100) : 0;
    const pctExtra = totalExtra > 0 ? Math.round((usadaExtra / totalExtra) * 100) : 0;

    const SHIFT_BADGE = {
        day:   '<span style="background:#fef3c7;color:#b45309;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:700;margin-left:4px">☀️ DÍA</span>',
        night: '<span style="background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:700;margin-left:4px">🌙 NOCHE</span>',
        mixed: ''
    };

    let edHTML = '';
    Object.entries(porEdificio).sort((a, b) => a[0].localeCompare(b[0])).forEach(([nom, ed]) => {
        const badge = SHIFT_BADGE[ed.mainShift] || '';
        edHTML += `
        <tr>
            <td style="padding:10px 12px;font-weight:700">${nom}${badge}</td>
            <td style="padding:10px 12px;text-align:center">
                ${ed.dia > 0
                    ? `<span style="color:#b45309;font-weight:700">${ed.dia_u}</span>
                       <span style="color:#94a3b8">/${ed.dia}</span>
                       <span style="font-size:11px;color:#16a34a;margin-left:4px">(${ed.dia - ed.dia_u} libres)</span>`
                    : '<span style="color:#94a3b8;font-size:12px">—</span>'}
            </td>
            <td style="padding:10px 12px;text-align:center">
                ${ed.noche > 0
                    ? `<span style="color:#1d4ed8;font-weight:700">${ed.noche_u}</span>
                       <span style="color:#94a3b8">/${ed.noche}</span>
                       <span style="font-size:11px;color:#16a34a;margin-left:4px">(${ed.noche - ed.noche_u} libres)</span>`
                    : '<span style="color:#94a3b8;font-size:12px">—</span>'}
            </td>
            ${ed.extra > 0 ? `<td style="padding:10px 12px;text-align:center">
                <span style="color:#7c3aed;font-weight:700">${ed.extra_u}</span>
                <span style="color:#94a3b8">/${ed.extra}</span>
                <span style="font-size:11px;color:#16a34a;margin-left:4px">(${ed.extra - ed.extra_u} libres)</span>
            </td>` : '<td style="padding:10px 12px;text-align:center;color:#94a3b8">—</td>'}
        </tr>`;
    });

    return `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-yellow">
                <div class="kpi-icon">☀️</div>
                <div class="kpi-value">${libreDia}<span style="font-size:14px;opacity:.6">/${totalDia}</span></div>
                <div class="kpi-label">Camas Día libres · ${pctDia}% ocupado</div>
            </div>
            <div class="kpi-card kpi-blue">
                <div class="kpi-icon">🌙</div>
                <div class="kpi-value">${libreNoche}<span style="font-size:14px;opacity:.6">/${totalNoche}</span></div>
                <div class="kpi-label">Camas Noche libres · ${pctNoche}% ocupado</div>
            </div>
            ${totalExtra > 0 ? `<div class="kpi-card kpi-purple">
                <div class="kpi-icon">⭐</div>
                <div class="kpi-value">${libreExtra}<span style="font-size:14px;opacity:.6">/${totalExtra}</span></div>
                <div class="kpi-label">Camas Extra libres · ${pctExtra}% ocupado</div>
            </div>` : ''}
        </div>
        <h3 class="section-title">📊 Desglose por Edificio${edificioFiltro ? ` — ${edificioFiltro}` : ''}</h3>
        <div class="table-wrap">
            <table class="informe-table">
                <thead><tr><th>Edificio</th><th>☀️ Camas Día</th><th>🌙 Camas Noche</th><th>⭐ Camas Extra</th></tr></thead>
                <tbody>${edHTML}</tbody>
            </table>
        </div>
    </div>`;
}


export async function procesarConsulta(pregunta) {
    if (!pregunta || !pregunta.trim()) {
        return `<p style="text-align:center;color:#94a3b8;padding:40px;">✏️ Escribe una pregunta para comenzar...</p>`;
    }

    const { id: intencion, edificioFiltro, empresaFiltro, habNumero } = detectarIntencion(pregunta);
    const datos = await cargarDatos();

    const fecha = new Date().toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' });
    const headerHTML = `
    <div class="informe-header">
        <div class="informe-meta">
            <span>📅 ${fecha}</span>
            <span>🔍 "${pregunta}"</span>
        </div>
    </div>`;

    let cuerpo = '';
    switch (intencion) {
        case 'RESUMEN_GENERAL':
            cuerpo = generarResumenGeneral(datos);
            break;
        case 'HABITACIONES_LIBRES':
            cuerpo = generarHabitacionesLibres(datos, edificioFiltro);
            break;
        case 'HABITACIONES_OCUPADAS':
            cuerpo = generarHabitacionesOcupadas(datos, edificioFiltro);
            break;
        case 'TRABAJADORES_EMPRESA':
            cuerpo = generarTrabajadoresPorEmpresa(datos, empresaFiltro);
            break;
        case 'SOLICITUDES':
            cuerpo = generarSolicitudes(datos);
            break;
        case 'EDIFICIO_DETALLE':
            cuerpo = generarEdificioDetalle(datos, edificioFiltro || pregunta);
            break;
        case 'GENERO_BREAKDOWN':
            cuerpo = generarGeneroBreakdown(datos);
            break;
        case 'CAMAS_PERDIDAS':
            cuerpo = generarCamasPerdidas(datos, edificioFiltro);
            break;
        case 'CAMAS_CAPACIDAD':
            cuerpo = generarCapacidadCamas(datos);
            break;
        case 'CUPOS_GERENCIA':
            cuerpo = generarCuposGerencia(datos);
            break;
        case 'GERENCIAS_DETALLE':
            cuerpo = generarGerenciasDetalle(datos);
            break;
        case 'HABITACION_DETALLE':
            cuerpo = generarHabitacionDetalle(datos, habNumero);
            break;
        case 'TURNO_DIA_NOCHE':
            cuerpo = generarCamasPorTurno(datos, edificioFiltro);
            break;
        case 'ALERTAS':
            cuerpo = generarResumenGeneral(datos);
            break;
        default:
            cuerpo = generarResumenGeneral(datos);
    }

    return headerHTML + cuerpo;
}

// ── Gerencias con desglose por empresa (accordion) ──────────────────────────
function generarGerenciasDetalle(datos) {
    const { rooms } = datos;

    // Agrupar: gerencia → empresa → [trabajadores]
    const gerMap = {}; // { gerencia: { empresa: [{name, rut, room, bed, present, authorized}] } }
    rooms.forEach(r => {
        ['day','night','extra'].forEach(bk => {
            const bed = r.beds?.[bk];
            if (!bed?.occupant) return;
            const gerencia = (bed.management || bed.gerencia || 'Sin Gerencia').trim();
            const empresa  = (bed.company || 'Sin Empresa').trim();
            if (!gerMap[gerencia]) gerMap[gerencia] = {};
            if (!gerMap[gerencia][empresa]) gerMap[gerencia][empresa] = [];
            gerMap[gerencia][empresa].push({
                name:       bed.occupant.split('(')[0].trim(),
                rut:        bed.rut || '—',
                room:       r.number,
                bed:        bk === 'day' ? 'Día' : bk === 'night' ? 'Noche' : 'Extra',
                present:    bed.present || false,
                authorized: bed.checkinAuthorized || false,
                checkout:   bed.checkoutPending   || false
            });
        });
    });

    if (Object.keys(gerMap).length === 0) {
        return `<div class="informe-section"><p style="text-align:center;padding:40px;color:#94a3b8">ℹ️ No hay trabajadores con gerencia asignada en este momento.</p></div>`;
    }

    const totalTrabaj = Object.values(gerMap).reduce((sum, emps) =>
        sum + Object.values(emps).reduce((s2, ws) => s2 + ws.length, 0), 0);
    const totalGerencias = Object.keys(gerMap).length;
    const totalEmpresas  = new Set(Object.values(gerMap).flatMap(e => Object.keys(e))).size;

    // Generar HTML accordion por gerencia
    let gId = 0;
    const sections = Object.entries(gerMap)
        .sort((a,b) => a[0].localeCompare(b[0]))
        .map(([gerencia, empresas]) => {
            gId++;
            const totalG = Object.values(empresas).reduce((s, ws) => s + ws.length, 0);
            const presentG = Object.values(empresas).flat().filter(w => w.present).length;
            const empCards = Object.entries(empresas)
                .sort((a,b) => b[1].length - a[1].length)
                .map(([empresa, workers]) => {
                    const workerRows = workers.map(w => {
                        const si = w.checkout ? '🟡' : w.present ? '🟢' : w.authorized ? '🔵' : '🔴';
                        return `<tr style="border-bottom:1px solid #f1f5f9">
                            <td style="padding:7px 10px;font-weight:700;font-size:12px">${si} ${w.name}</td>
                            <td style="padding:7px 10px;font-size:11px;color:#64748b">${w.rut}</td>
                            <td style="padding:7px 10px;font-size:11px;font-weight:600">Hab. ${w.room}</td>
                            <td style="padding:7px 10px;font-size:11px;color:#94a3b8">${w.bed}</td>
                        </tr>`;
                    }).join('');
                    return `
                    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:8px">
                        <div style="background:#f8fafc;padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
                            <div style="font-size:13px;font-weight:800;color:#1e293b">🏢 ${empresa}</div>
                            <span style="background:#dbeafe;color:#1d4ed8;border-radius:99px;padding:2px 10px;font-size:11px;font-weight:700">${workers.length} personas</span>
                        </div>
                        <div style="overflow-x:auto">
                            <table style="width:100%;border-collapse:collapse">
                                <thead><tr style="background:#f1f5f9">
                                    <th style="padding:6px 10px;font-size:10px;font-weight:700;color:#64748b;text-align:left;text-transform:uppercase">Trabajador</th>
                                    <th style="padding:6px 10px;font-size:10px;font-weight:700;color:#64748b;text-align:left;text-transform:uppercase">RUT</th>
                                    <th style="padding:6px 10px;font-size:10px;font-weight:700;color:#64748b;text-align:left;text-transform:uppercase">Hab.</th>
                                    <th style="padding:6px 10px;font-size:10px;font-weight:700;color:#64748b;text-align:left;text-transform:uppercase">Turno</th>
                                </tr></thead>
                                <tbody>${workerRows}</tbody>
                            </table>
                        </div>
                    </div>`;
                }).join('');

            return `
            <div style="border:1.5px solid #e2e8f0;border-radius:14px;overflow:hidden;margin-bottom:12px;background:#fff">
                <!-- Header gerencia -->
                <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;background:linear-gradient(135deg,#f8fafc,#f1f5f9)"
                     onclick="document.getElementById('ger-${gId}').style.display = document.getElementById('ger-${gId}').style.display === 'none' ? 'block' : 'none'; this.querySelector('.ger-arrow').style.transform = this.querySelector('.ger-arrow').style.transform === 'rotate(180deg)' ? '' : 'rotate(180deg)'">
                    <div style="width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#4f46e5);display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;flex-shrink:0">🎯</div>
                    <div style="flex:1">
                        <div style="font-size:15px;font-weight:800;color:#1e293b">${gerencia}</div>
                        <div style="font-size:11px;color:#64748b;margin-top:2px">${Object.keys(empresas).length} empresa${Object.keys(empresas).length !== 1 ? 's' : ''} · ${totalG} trabajadores</div>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center">
                        <div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:4px 10px;text-align:center">
                            <div style="font-size:14px;font-weight:900;color:#166534">${presentG}</div>
                            <div style="font-size:8px;font-weight:700;color:#16a34a;text-transform:uppercase">presente</div>
                        </div>
                        <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:4px 10px;text-align:center">
                            <div style="font-size:14px;font-weight:900;color:#991b1b">${totalG - presentG}</div>
                            <div style="font-size:8px;font-weight:700;color:#dc2626;text-transform:uppercase">en tránsito</div>
                        </div>
                    </div>
                    <span class="ger-arrow" style="font-size:16px;color:#94a3b8;transition:transform 0.25s">▾</span>
                </div>
                <!-- Empresas (expandible) -->
                <div id="ger-${gId}" style="display:none;padding:12px 14px">
                    ${empCards}
                </div>
            </div>`;
        }).join('');

    return `
    <div class="informe-section">
        <div class="kpi-grid">
            <div class="kpi-card kpi-red">
                <div class="kpi-icon">🎯</div>
                <div class="kpi-value">${totalGerencias}</div>
                <div class="kpi-label">Gerencias</div>
            </div>
            <div class="kpi-card kpi-blue">
                <div class="kpi-icon">🏢</div>
                <div class="kpi-value">${totalEmpresas}</div>
                <div class="kpi-label">Empresas</div>
            </div>
            <div class="kpi-card kpi-green">
                <div class="kpi-icon">👷</div>
                <div class="kpi-value">${totalTrabaj}</div>
                <div class="kpi-label">Trabajadores</div>
            </div>
        </div>
        <h3 class="section-title">🎯 Gerencias — Desglose por Empresa</h3>
        <p style="font-size:12px;color:#94a3b8;margin-bottom:16px">Toca cada gerencia para ver las empresas y trabajadores asignados.</p>
        ${sections}
    </div>`;
}

export { cargarDatos, extraerTrabajadores, calcularEstadisticasHabitaciones };
