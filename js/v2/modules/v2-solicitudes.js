/**
 * v2-solicitudes.js — Motor de Asignación B2B V2
 * Una fila por trabajador en v2_solicitudes_b2b.
 * Vista: agrupada por empresa → una tarjeta por empresa con lista de trabajadores.
 */
import { supabase } from '../../supabaseClient.js';

console.log('%c[v2-solicitudes] ✅ MÓDULO V2.5 CARGADO CORRECTAMENTE', 'color:lime;font-weight:bold;font-size:14px;background:#1a1a2e;padding:4px 8px;border-radius:4px');

const fmt = d => { if(!d) return '—'; const [y,m,dd]=String(d).split('-'); return `${dd}/${m}/${y}`; };
const normG = g => { if(!g) return null; const u=String(g).toUpperCase().trim(); return u==='F'?'F':'M'; };
const toast = (msg,type='success') => {
    const el=document.createElement('div');
    el.style.cssText=`position:fixed;bottom:24px;right:24px;z-index:99999;background:${type==='success'?'#10b981':type==='error'?'#ef4444':'#f59e0b'};color:#fff;padding:12px 20px;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,.18);max-width:400px`;
    el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(),5000);
};

// ── Badge ─────────────────────────────────────────────────────────────────────
async function refreshBadge() {
    try {
        const {count}=await supabase.from('v2_solicitudes_b2b').select('id',{count:'exact',head:true}).eq('status','pendiente');
        const b=document.getElementById('badge-v2solicitudes'); if(!b) return;
        b.textContent=count>99?'99+':String(count||0); b.style.display=count>0?'inline-block':'none';
    } catch(_){}
}

// ── Modal de confirmación (reemplaza confirm() nativo que parpadea) ────────────
function _solConfirm(msg, {confirmText='✅ Confirmar', cancelText='Cancelar', danger=false}={}) {
    return new Promise(resolve => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px';
        ov.innerHTML = `
        <div style="background:#fff;border-radius:18px;padding:28px 32px;max-width:420px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.25);text-align:center">
            <div style="font-size:32px;margin-bottom:10px">${danger?'⚠️':'❓'}</div>
            <div style="font-size:14px;color:#1e293b;font-weight:600;line-height:1.5;margin-bottom:22px;white-space:pre-line">${msg}</div>
            <div style="display:flex;gap:10px;justify-content:center">
                <button id="_sc_cancel" style="padding:9px 22px;border:1.5px solid #e2e8f0;border-radius:10px;background:#fff;color:#64748b;font-weight:700;font-size:13px;cursor:pointer">${cancelText}</button>
                <button id="_sc_ok" style="padding:9px 24px;border:none;border-radius:10px;background:${danger?'linear-gradient(135deg,#b91c1c,#ef4444)':'linear-gradient(135deg,#16a34a,#22c55e)'};color:#fff;font-weight:800;font-size:13px;cursor:pointer">${confirmText}</button>
            </div>
        </div>`;
        document.body.appendChild(ov);
        const cleanup = (val) => { ov.remove(); resolve(val); };
        ov.querySelector('#_sc_ok').onclick     = () => cleanup(true);
        ov.querySelector('#_sc_cancel').onclick = () => cleanup(false);
        ov.onclick = e => { if(e.target===ov) cleanup(false); };
    });
}


// ═══════════════════════════════════════════════════════════════════════════════
//  MOTOR DE ASIGNACIÓN — procesa un grupo de filas (misma empresa)
// ═══════════════════════════════════════════════════════════════════════════════
async function ejecutarGrupo(rows) {
    if(!rows.length) return {ok:false,msg:'Sin filas'};

    const empresa = rows[0].empresa || '—';

    // ── Cargar TODAS las camas con paginación ───────────────────────────────────
    // COPC (~1271 habs × 2 camas) + R-220 (145 habs × 2 camas) = ~2832 camas totales
    // Sin paginación Supabase devuelve solo 1000 (todas COPC) → R-220 queda sin habMap
    const PAGE = 1000;

    async function _fetchAllPages(table, select, orderCol, filter) {
        let all = [], page = 0, done = false;
        while(!done) {
            const from = page * PAGE;
            let q = supabase.from(table).select(select)
                .range(from, from + PAGE - 1).order(orderCol);
            if(filter) q = filter(q);
            const {data, error} = await q;
            if(error) { console.error(`[Motor] Error paginando ${table}:`, error.message); break; }
            if(data && data.length > 0) all = all.concat(data);
            if(!data || data.length < PAGE) done = true;
            page++;
            if(page > 20) break; // safety
        }
        return all;
    }

    // ── Fecha de llegada del lote (para rotación de turno) ────────────────────
    // Si el lote llega el 06-05 y hay camas que se liberan el 06-05,
    // esas camas deben considerarse disponibles para este lote.
    // Usar la fecha más temprana del lote para la rotación de turno
    const fechaLlegadaLote = [...rows].map(r => r.fecha_llegada).filter(Boolean).sort()[0]
        || new Date().toISOString().split('T')[0];
    console.log(`[Motor] 📅 Fecha llegada del lote (min): ${fechaLlegadaLote}`);

    // Cargar camas, asignaciones y habitaciones en paralelo (todo paginado)
    // Incluimos fecha_salida_programada para detectar rotaciones de turno
    const [camasData, asigActivas] = await Promise.all([
        _fetchAllPages('v2_camas', 'id_cama,habitacion_id,estado', 'id_cama'),
        _fetchAllPages('v2_asignaciones', 'id_cama,empresa_id,fecha_checkin,fecha_salida_programada,rut_huesped,nombre_huesped', 'id_cama',
            q => q.is('fecha_checkout', null))
    ]);
    console.log(`[Motor] 🛏️ v2_camas: ${camasData.length} camas | v2_asignaciones activas: ${asigActivas.length}`);


    // ── Cargar TODAS las habitaciones con paginación ────────────────────────────
    // Supabase trunca silenciosamente a 1000 filas por defecto aunque pongas limit(5000).
    // Con COPC (8 pabellones) + R-220 (1 pabellón) = ~1416 habs, necesitamos paginar.
    // (PAGE ya definido arriba como 1000)
    let habsData = [], habPage = 0, habDone = false;
    while(!habDone) {
        const from = habPage * PAGE;
        const {data:pg, error:ePg} = await supabase
            .from('v2_habitaciones')
            .select('numero_hab,id_custom')
            .range(from, from + PAGE - 1)
            .order('id_custom');
        if(ePg) { console.error('[Motor] Error paginando habitaciones:', ePg.message); break; }
        if(pg && pg.length > 0) habsData = habsData.concat(pg);
        if(!pg || pg.length < PAGE) habDone = true;
        habPage++;
        if(habPage > 10) break; // safety: max 10.000 habs
    }
    console.log(`[Motor] 🏢 v2_habitaciones cargadas: ${habsData.length} (${habPage} página/s) — ambos edificios`);

    // Índice número de habitación → id_custom (clave de habMap)
    const habByNumero = {};
    const r220Habs = [];  // para diagnóstico
    for(const h of habsData) {
        if(!h.id_custom) continue;
        const key = h.id_custom;
        if(h.numero_hab) habByNumero[String(h.numero_hab).trim()] = key;
        habByNumero[String(h.id_custom).trim()] = key;
        // Rastrear habitaciones R-220
        if(h.id_custom.startsWith('R-220')) r220Habs.push(String(h.numero_hab||'').trim());
    }
    const totalHabsIdx = Object.keys(habByNumero).length;
    if(totalHabsIdx === 0) {
        console.error('[Motor] ❌ CRITICAL: habByNumero vacío — los trabajadores con hab_solicitada irán a Escenario 2');
    } else {
        const sk = Object.keys(habByNumero).slice(0,6);
        console.log(`[Motor] ✅ habByNumero: ${totalHabsIdx} entradas. Muestra:`, sk.map(k=>`"${k}"→"${habByNumero[k]}"`).join(', '));
    }
    // ── Diagnóstico R-220 ──────────────────────────────────────────────────────
    console.log(`[Motor] 🏠 R-220: ${r220Habs.length} habs indexadas. Primeras 10:`, r220Habs.slice(0,10).join(', '));
    if(r220Habs.length === 0) {
        console.error('[Motor] ❌ R-220 NO está en habByNumero — sus camas irán a Escenario 2');
    }

    // 🔍 DIAGNÓSTICO
    const totalCamas = (camasData||[]).length;
    const camasDisponibles = (camasData||[]).filter(c=>c.estado==='Disponible').length;
    const camasOcupadas   = (camasData||[]).filter(c=>c.estado==='Ocupada').length;
    const asigActCount    = (asigActivas||[]).length;
    console.log(`[Motor V2.5] Camas BD: ${totalCamas} total | ${camasDisponibles} Disponible | ${camasOcupadas} Ocupada`);
    console.log(`[Motor V2.5] Asignaciones activas (fecha_checkout=null): ${asigActCount}`);
    console.log(`[Motor V2.5] Trabajadores a asignar: ${rows.length}`);

    // ── Obtener o crear empresa (v2_empresas requiere gerencia_id FK) ──────────
    const {data:empRows, error:empErr}=await supabase
        .from('v2_empresas').select('id').ilike('nombre',empresa).limit(1);
    if(empErr) console.error('[Motor] ❌ SELECT empresa error:', empErr.message, empErr.details);
    let empresaId=empRows?.[0]?.id||null;
    if(!empresaId){
        console.log(`[Motor] 🏢 Empresa "${empresa}" no encontrada → creando...`);

        // 1. Primero encontrar o crear la gerencia (requerida por v2_empresas.gerencia_id)
        const gerenciaNombre = rows[0]?.gerencia || empresa; // fallback al nombre empresa
        let gerenciaId = null;
        const {data:gRows, error:gErr}=await supabase
            .from('v2_gerencias').select('id').ilike('nombre', gerenciaNombre).limit(1);
        if(gErr) console.warn('[Motor] ⚠️ SELECT gerencia error:', gErr.message);
        gerenciaId = gRows?.[0]?.id || null;
        if(!gerenciaId){
            const {data:ng, error:ngErr}=await supabase
                .from('v2_gerencias').insert({nombre: gerenciaNombre}).select('id').limit(1);
            if(ngErr) console.warn('[Motor] ⚠️ INSERT gerencia error:', ngErr.message, ngErr.details);
            gerenciaId = ng?.[0]?.id || null;
            if(gerenciaId) console.log(`[Motor] ✅ Gerencia "${gerenciaNombre}" creada: ${gerenciaId}`);
        }

        // 2. Crear la empresa con gerencia_id
        const {data:ne, error:neErr}=await supabase
            .from('v2_empresas')
            .insert({ nombre: empresa, turno: null, gerencia_id: gerenciaId })
            .select('id').limit(1);
        if(neErr) console.error('[Motor] ❌ INSERT empresa error:', neErr.message, neErr.details, neErr.hint);
        empresaId=ne?.[0]?.id||null;
        if(empresaId) console.log(`[Motor] ✅ Empresa "${empresa}" creada: ${empresaId}`);
    }
    if(!empresaId) return {ok:false,msg:`No se pudo crear la empresa "${empresa}". Revisa la consola (F12) para ver el error exacto.`};

    // ── Auto-crear cupo en v2_cupos_gerencias si no existe ─────────────────────
    const gerenciaGrupo = rows[0]?.gerencia || null;
    const contratoGrupo = rows[0]?.n_contrato || null;
    try {
        let cupoQ = supabase.from('v2_cupos_gerencias')
            .select('id').ilike('empresa', empresa);
        if(contratoGrupo) cupoQ = cupoQ.eq('numero_contrato', contratoGrupo);
        const {data:cupoExiste} = await cupoQ.limit(1);
        if(!cupoExiste || cupoExiste.length === 0){
            console.log(`[Motor] 📊 Creando cupo para "${empresa}" / contrato ${contratoGrupo}`);
            await supabase.from('v2_cupos_gerencias').insert({
                empresa:         empresa,
                gerencia:        gerenciaGrupo,
                numero_contrato: contratoGrupo,
                cupos_totales:   rows.length,
                cupos_ocupados:  0,
            });
        }
    } catch(eCupo) {
        console.warn('[Motor] ⚠️ Cupo automático no creado:', eCupo.message);
    }

    // ── PRE-CHECKOUT: liberar ocupantes de las habitaciones que trae el Excel ──
    // Al cargar una empresa, se hace checkout automático de los ocupantes
    // actuales de las habitaciones incluidas en el archivo, preparando la rotación.
    let preCheckoutCount = 0;
    try {
        const habsEnCarga = new Set(
            rows.map(r => String(r.hab_solicitada || '').trim()).filter(Boolean)
        );
        if (habsEnCarga.size > 0) {
            // Convertir número de habitación → habitacion_id
            const habIdsEnCarga = new Set(
                [...habsEnCarga].map(num => habByNumero[num]).filter(Boolean)
            );
            if (habIdsEnCarga.size > 0) {
                // Camas que pertenecen a esas habitaciones
                const camasEnHabs = (camasData||[])
                    .filter(c => habIdsEnCarga.has(c.habitacion_id))
                    .map(c => String(c.id_cama));

                if (camasEnHabs.length > 0) {
                    const ahora = new Date().toISOString();
                    console.log(`[Motor] 🔄 Pre-checkout: buscando ocupantes en ${habIdsEnCarga.size} hab(s) del Excel...`);

                    // Checkout de asignaciones activas en esas camas (lotes de 50)
                    let totalCO = 0;
                    for (let i = 0; i < camasEnHabs.length; i += 50) {
                        const lote = camasEnHabs.slice(i, i + 50);
                        const { data: coData } = await supabase.from('v2_asignaciones')
                            .update({ fecha_checkout: ahora, estado_asignacion: 'sin_checkout' })
                            .in('id_cama', lote)
                            .is('fecha_checkout', null)
                            .select('id_cama');
                        if (coData?.length) totalCO += coData.length;
                    }

                    // Liberar camas en BD
                    for (let i = 0; i < camasEnHabs.length; i += 50) {
                        await supabase.from('v2_camas')
                            .update({ estado: 'Disponible' })
                            .in('id_cama', camasEnHabs.slice(i, i + 50))
                            .neq('estado', 'Deshabilitada');
                    }

                    // Marcar solicitudes antiguas de esas camas como 'finalizado'
                    // (para que no reaparezcan como sintéticos en Asistencia)
                    const rutsOcupantes = (asigActivas||[])
                        .filter(a => camasEnHabs.includes(String(a.id_cama)))
                        .map(a => (a.rut_huesped||'').replace(/[\.\-]/g,'').toUpperCase())
                        .filter(Boolean);
                    if (rutsOcupantes.length > 0) {
                        for (let i = 0; i < rutsOcupantes.length; i += 50) {
                            await supabase.from('v2_solicitudes_b2b')
                                .update({ status: 'finalizado' })
                                .in('rut_trabajador', rutsOcupantes.slice(i, i + 50))
                                .in('status', ['aceptada', 'aceptada_asignada']);
                        }
                    }

                    preCheckoutCount = totalCO;
                    if (totalCO > 0) {
                        console.log(`[Motor] ✅ Pre-checkout: ${totalCO} ocupantes liberados de ${habsEnCarga.size} habitaciones`);
                    }

                    // ── Actualizar en memoria para que el motor los vea como libres ──
                    const preCheckoutCamaSet = new Set(camasEnHabs);
                    // Remover de asigActivas
                    const asigActKept = asigActivas.filter(a => !preCheckoutCamaSet.has(String(a.id_cama)));
                    asigActivas.splice(0, asigActivas.length, ...asigActKept);
                    // Marcar como Disponible en camasData
                    for (const c of camasData) {
                        if (preCheckoutCamaSet.has(String(c.id_cama))) c.estado = 'Disponible';
                    }
                }
            }
        }
    } catch(ePreCO) {
        console.warn('[Motor] ⚠️ Pre-checkout error (no crítico):', ePreCO.message);
    }

    // Índice directo: id_cama → { habitacion_id, estado }

    const camaIndex={};
    for(const c of camasData||[]) camaIndex[String(c.id_cama)]=c;

    // Mapa por habitacion: { habitacion_id → { libres:[id_cama], ocupantes:[{empresa_id}] } }
    const habMap={};
    for(const c of camasData||[]) {
        if(!habMap[c.habitacion_id]) habMap[c.habitacion_id]={libres:[],ocupantes:[]};
        // Incluir camas Disponible u Ocupada: camaLibreEnFechas (date-aware) filtra correctamente
        // si el ocupante actual se va el mismo día que llega el nuevo (a2 <= b1 → sin solapamiento).
        // Las camas Deshabilitadas nunca se incluyen.
        if(c.estado==='Disponible' || c.estado==='Ocupada') habMap[c.habitacion_id].libres.push(c.id_cama);
    }
    // ── Rotación de turno: camas que se liberan el mismo día que llega el lote ──
    // Si fecha_salida_programada del ocupante actual <= fechaLlegadaLote,
    // la cama está disponible para este lote (se van el mismo día que llegan los nuevos).
    const camasEnRotacion = new Set(
        (asigActivas||[])
            .filter(a => a.fecha_salida_programada && a.fecha_salida_programada <= fechaLlegadaLote)
            .map(a => String(a.id_cama))
    );
    if(camasEnRotacion.size > 0)
        console.log(`[Motor] 🔄 Rotación: ${camasEnRotacion.size} camas se liberan el ${fechaLlegadaLote} → disponibles para este lote`);

    // Marcar camas bloqueadas: asignadas activamente Y cuyo ocupante NO se va aún
    const asigSet = new Set(
        (asigActivas||[])
            .filter(a => !camasEnRotacion.has(String(a.id_cama))) // excluir rotaciones
            .map(a => String(a.id_cama))
    );
    // ── Índice date-aware: cama_id → [{checkin, salida, empresa_id, nombre}] ────────────
    // Permite asignar la misma cama en turnos sin solapamiento de fechas (pre-asig)
    const asigActivasMap = new Map();
    for (const a of asigActivas || []) {
        if (camasEnRotacion.has(String(a.id_cama))) continue; // en rotación → ya libre
        const cid = String(a.id_cama);
        const slots = asigActivasMap.get(cid) || [];
        slots.push({
            checkin:    a.fecha_checkin || '0000-01-01',
            salida:     a.fecha_salida_programada || '9999-12-31',
            empresa_id: a.empresa_id || null,
            nombre:     a.nombre_huesped || '',
        });
        asigActivasMap.set(cid, slots);
    }
    // ⚠️ NO pre-filtrar habMap.libres por asigSet:
    // Se eliminan camas que aparecen como 'Disponible' en BD pero con pre-asignación
    // futura. Al no filtrar, camaLibreEnFechas (date-aware) decide si hay solapamiento.
    // Solo se filtran por el estado='Disponible' en la construcción del habMap (línea 293).
    // Segunda pasada: añadir las camas en rotación al habMap
    for(const c of camasData||[]) {
        if(camasEnRotacion.has(String(c.id_cama))) {
            const hab = habMap[c.habitacion_id];
            if(hab && !hab.libres.includes(c.id_cama)) {
                hab.libres.push(c.id_cama);
            }
        }
    }

    // ── Índice rut → cama activa (para detectar trabajadores ya asignados) ──────
    // Permite saltar duplicados si la carga tiene el mismo RUT+habitación ya registrado.
    // IMPORTANTE: excluir trabajadores en ROTACIÓN (su asignación termina hoy o antes
    // de que llegue el nuevo lote). Aunque tienen fecha_checkout=null, su período
    // ya terminó y DEBEN poder ser reasignados para el nuevo período.
    const rutACamaActiva = {}; // rut_normalizado → id_cama
    for(const a of asigActivas||[]) {
        // Si este trabajador está en una cama de rotación (se va hoy o antes del lote),
        // NO bloquear su RUT → permite que sea reasignado para el período nuevo.
        if(camasEnRotacion.has(String(a.id_cama))) {
            console.log(`[Motor] 🔄 RUT ${a.rut_huesped} en rotación (cama ${a.id_cama} se libera ${a.fecha_salida_programada}) — habilitado para reasignar`);
            continue;
        }
        // Normalizar igual que el motor: quitar puntos, guiones y espacios
        const rutNorm = String(a.rut_huesped||'').replace(/[.\-\s]/g,'').toUpperCase();
        if(rutNorm) rutACamaActiva[rutNorm] = String(a.id_cama);
    }

    // Upsert huéspedes
    const huespedes=rows.map(r=>({
        rut:  r.rut_trabajador?String(r.rut_trabajador).replace(/\./g,'').trim().toUpperCase():null,
        nombre:r.nombre_trabajador||null
    })).filter(h=>h.rut&&h.nombre);
    if(huespedes.length) try { await supabase.from('v2_huespedes').upsert(huespedes,{onConflict:'rut'}); } catch(e){ console.warn('[Motor] upsert huespedes:',e.message); }

    const hoy=new Date().toISOString().split('T')[0];
    const asignaciones=[];
    const fallidos=[];
    const sinAsignar=[];   // trabajadores con hab_pedida no disponible → quedan pendientes
    const rowsActualizadas=[];

    // ── Ordenar por fecha_llegada ASC (procesar primero a los que llegan antes) ──
    const rowsOrdenados = [...rows].sort((a,b) => {
        const fa = a.fecha_llegada || '9999-12-31';
        const fb = b.fecha_llegada || '9999-12-31';
        return fa < fb ? -1 : fa > fb ? 1 : 0;
    });

    // ── Rastreador de camas por fechas (permite misma cama en turnos distintos) ──
    // Map<camaId → [{checkin, salida}]>
    const camasUsadasLote = new Map();
    // ── Guardia intra-lote: RUTs ya procesados en ESTE grupo (segunda línea de defensa) ──
    const rutsProcesadosLote = new Set();

    // Verifica si una cama está libre para el período [checkin, salida]
    // ── Helper: fecha + 1 día (string YYYY-MM-DD) ────────────────────────────
    // Regla de negocio: el checkout se realiza la NOCHE ANTERIOR a fecha_salida
    // (a las 22:00 del día T-1). Por eso un nuevo huésped que llega el día T-1
    // puede ocupar la cama: el saliente se va esa misma noche y el entrante
    // llega durante el día. Aplicamos +1 día de gracia al b1 del incoming.
    function _nextDay(dateStr) {
        if (!dateStr || dateStr === '9999-12-31') return '9999-12-31';
        const d = new Date(dateStr + 'T12:00:00Z'); // mediodia UTC evita cambio de día
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().split('T')[0];
    }

    function camaLibreEnFechas(camaId, checkin, salida) {
        const cid = String(camaId);
        const b1 = checkin || '0000-01-01';
        const b2 = salida  || '9999-12-31';
        // Con la regla "checkout noche anterior": el entrante puede llegar el mismo
        // día en que el saliente tiene fecha_salida (o incluso 1 día antes).
        // Usamos nextDay(b1) para la comparación: a2 <= nextDay(b1) = sin solapamiento.
        const b1next = _nextDay(b1); // b1 + 1 día de gracia por regla de checkout

        // ── Verificar contra asignaciones pre-existentes (date-aware) ─────────────
        const asigPrev = asigActivasMap.get(cid);
        if (asigPrev) {
            const solapado = asigPrev.some(s => {
                const a1 = s.checkin;
                const a2 = s.salida;
                // Sin solapamiento si: salida_existente <= checkin_nuevo+1día
                //   O checkin_existente >= salida_nuevo
                return !(b2 <= a1 || a2 <= b1next); // hay solapamiento de fechas
            });
            if (solapado) return false;
        }

        // ── Verificar intra-lote (misma carga, distintos trabajadores) ─────────
        const slots = camasUsadasLote.get(cid) || [];
        if (!slots.length) return true;
        return slots.every(s => {
            const a1 = s.checkin || '0000-01-01';
            const a2 = s.salida  || '9999-12-31';
            return b2 <= a1 || a2 <= b1next;
        });
    }

    // Verifica si la habitación ya tiene ocupantes de OTRA empresa en esas fechas
    // Retorna el primer ocupante conflictivo (o null si no hay mezcla)
    // Aplica la misma regla de checkout-noche-anterior: b1next = b1 + 1 día
    function habConOtraEmpresa(habId, empresaIdCheck, checkin, salida) {
        if (!empresaIdCheck || !habId) return null;
        const b1 = checkin || '0000-01-01';
        const b2 = salida  || '9999-12-31';
        const b1next = _nextDay(b1); // mismo ajuste que en camaLibreEnFechas
        for (const a of asigActivas || []) {
            if (!a.empresa_id) continue;                          // sin empresa → ignorar
            if (String(a.empresa_id) === String(empresaIdCheck)) continue; // misma empresa → OK
            const camaDe = camaIndex[String(a.id_cama)];
            if (camaDe?.habitacion_id !== habId) continue;        // distinta habitación
            const a1 = a.fecha_checkin || '0000-01-01';
            const a2 = a.fecha_salida_programada || '9999-12-31';
            if (!(b2 <= a1 || a2 <= b1next)) return a;           // solapamiento → conflicto
        }
        return null;
    }

    function registrarCamaUsada(camaId, checkin, salida) {
        const cid = String(camaId);
        const slots = camasUsadasLote.get(cid) || [];
        slots.push({ checkin: checkin || '0000-01-01', salida: salida || '9999-12-31' });
        camasUsadasLote.set(cid, slots);
    }

    // Mapa inverso: id_custom → numero_hab (para mostrar números legibles en sugerencias)
    const idCustomToNumero = {};
    for(const h of habsData) {
        if(h.id_custom && h.numero_hab) idCustomToNumero[h.id_custom] = String(h.numero_hab);
    }

    let _logCount=0;
    let _correctos=0, _automaticos=0;
    const _habPedidasUnicas = [...new Set(rows.map(r=>String(r.hab_solicitada||'').trim()).filter(Boolean))].slice(0,8);
    console.log('[Motor] 🔍 DIAGNÓSTICO HABs pedidas (Excel):', _habPedidasUnicas);
    console.log('[Motor] 🔍 Primeras 5 camas en camaIndex:', Object.keys(camaIndex).slice(0,5));
    console.log('[Motor] 🔍 Primeras 5 habs en habMap:', Object.keys(habMap).slice(0,5));
    console.log('[Motor] 🔍 Primeras 5 en habByNumero:', Object.keys(habByNumero).slice(0,5));
    _habPedidasUnicas.forEach(hp => {
        const inCamaIndex = !!camaIndex[hp];
        const inHabMap    = !!habMap[hp];
        const inHabNumero = !!habByNumero[hp];
        console.log(`[Motor] 🔎 "${hp}" → camaIndex:${inCamaIndex} habMap:${inHabMap} habByNumero:${inHabNumero} ${!inCamaIndex&&!inHabMap&&!inHabNumero?'❌ SIN MATCH':'✅'}`);
    });

    for(const row of rowsOrdenados) {
        const rut = row.rut_trabajador ? String(row.rut_trabajador).replace(/[.\-\s]/g,'').trim().toUpperCase().slice(0,12) : null;
        const nombre=row.nombre_trabajador||'';
        const habPedida=row.hab_solicitada?String(row.hab_solicitada).replace(/[.,\s]/g,'').trim():'';
        const rowCheckin = row.fecha_llegada || hoy;
        const rowSalida  = row.fecha_salida  || null;

        if(!rut||!nombre){ fallidos.push(`RUT/nombre vacío`); continue; }

        // ── ¿Este RUT ya tiene asignación activa? ────────────────────────────────────────
        const camaActualDelRut = rutACamaActiva[rut];
        if(camaActualDelRut) {
            // ¿El Excel lo mueve a una habitación DIFERENTE? (caso Juanito Pérez)
            if (habPedida) {
                const habActualId = camaIndex[String(camaActualDelRut)]?.habitacion_id;
                const habPedidaId = habByNumero[habPedida] || habPedida;
                if (habActualId && habPedidaId && habActualId !== habPedidaId) {
                    // 🔀 Cambio de habitación: hacer checkout de la cama anterior
                    console.log(`[Motor] 🔀 ${nombre} (${rut}): cambia hab ${habActualId} → ${habPedida}. Checkout cama ${camaActualDelRut}`);
                    const ahora = new Date().toISOString();
                    await supabase.from('v2_asignaciones')
                        .update({ fecha_checkout: ahora, estado_asignacion: 'sin_checkout' })
                        .eq('id_cama', camaActualDelRut).eq('rut_huesped', rut).is('fecha_checkout', null);
                    await supabase.from('v2_camas')
                        .update({ estado: 'Disponible' })
                        .eq('id_cama', camaActualDelRut).neq('estado', 'Deshabilitada');
                    // Liberar en índices en memoria
                    delete rutACamaActiva[rut];
                    asigSet.delete(String(camaActualDelRut));
                    asigActivasMap.delete(String(camaActualDelRut));
                    const habViejaMap = habMap[habActualId];
                    if (habViejaMap && !habViejaMap.libres.includes(camaActualDelRut)) {
                        habViejaMap.libres.push(camaActualDelRut);
                    }
                    // Continuar con la asignación normal en la nueva hab ↓
                } else {
                    // Misma habitación (o no determinada) → no duplicar
                    console.log(`[Motor] ⏭ ${nombre} (${rut}) ya en cama ${camaActualDelRut} — misma hab, omitido`);
                    rowsActualizadas.push(row.id);
                    continue;
                }
            } else {
                // Sin hab_solicitada → conservar asignación actual
                console.log(`[Motor] ⏭ ${nombre} (${rut}) ya tiene cama activa ${camaActualDelRut} — omitido (DB)`);
                rowsActualizadas.push(row.id);
                continue;
            }
        }
        // ── Guardia intra-lote: mismo RUT dos veces en el Excel → skip absoluto ──
        if(rutsProcesadosLote.has(rut)) {
            console.log(`[Motor] ⏭ ${nombre} (${rut}) duplicado en este lote — omitido (intra-lote)`);
            rowsActualizadas.push(row.id);
            continue;
        }


        let camaAsignada=null;

        if(habPedida && habPedida!=='0' && habPedida!=='null') {

        // ══ PRIORIDAD 1: por NÚMERO DE HABITACIÓN (columna "HAB." del Excel) ══
            const habIdResuelto = habByNumero[habPedida];
            if(habIdResuelto) {
                const habR = habMap[habIdResuelto];
                if(habR) {
                    // ── Verificar mezcla de empresas ───────────────────────────────────
                    // Regla: no pueden convivir personas de diferente empresa en la misma hab
                    const ocupanteOtraEmp = habConOtraEmpresa(habIdResuelto, empresaId, rowCheckin, rowSalida);
                    if (ocupanteOtraEmp) {
                        const razon = `Hab. ${habPedida} tiene ocupante de otra empresa en esas fechas: ${ocupanteOtraEmp.nombre_huesped || '(sin nombre)'}`;
                        console.warn(`[Motor] 🚫 MEZCLA EMPRESA: ${nombre}: ${razon}`);
                        sinAsignar.push({ nombre, rut, habPedida, razon, sugerencias: [], rowId: row.id });
                        continue;
                    }
                    // Buscar primera cama libre para las fechas de este trabajador
                    const camaIdx = habR.libres.findIndex(cId => camaLibreEnFechas(cId, rowCheckin, rowSalida));
                    if(camaIdx >= 0) {
                        camaAsignada = habR.libres[camaIdx];
                        registrarCamaUsada(camaAsignada, rowCheckin, rowSalida);
                        if(_logCount<20) console.log(`[Motor] ✅ ${nombre} (${rowCheckin}→${rowSalida}): hab "${habPedida}" → cama ${camaAsignada}`);
                        _correctos++;
                    } else {
                        if(_logCount<20) console.warn(`[Motor] ⚠️ ${nombre}: hab "${habPedida}" llena o solapada en esas fechas`);
                    }
                }
            }

            // ══ PRIORIDAD 2: por habitacion_id directo (ej: COPC000435) ══
            if(!camaAsignada) {
                const hab = habMap[habPedida];
                if(hab) {
                    const camaIdx2 = hab.libres.findIndex(cId => camaLibreEnFechas(cId, rowCheckin, rowSalida));
                    if(camaIdx2 >= 0) {
                        camaAsignada = hab.libres[camaIdx2];
                        registrarCamaUsada(camaAsignada, rowCheckin, rowSalida);
                        if(_logCount<20) console.log(`[Motor] ✅ ${nombre}: "${habPedida}" como habitacion_id → cama ${camaAsignada}`);
                    }
                }
            }

            // ══ PRIORIDAD 3: por id_cama específico (cama directa) ══
            if(!camaAsignada) {
                const camaInfo=camaIndex[habPedida];
                if(camaInfo) {
                    if(camaLibreEnFechas(habPedida, rowCheckin, rowSalida)) {
                        camaAsignada = habPedida;
                        registrarCamaUsada(habPedida, rowCheckin, rowSalida);
                        if(_logCount<20) console.log(`[Motor] ✅ ${nombre}: cama "${habPedida}" directo (id_cama)`);
                    } else {
                        // Cama pedida ocupada → intentar otra en la misma habitación
                        const hab=habMap[camaInfo.habitacion_id];
                        if(hab) {
                            const ci = hab.libres.findIndex(cId => camaLibreEnFechas(cId, rowCheckin, rowSalida));
                            if(ci >= 0) {
                                camaAsignada = hab.libres[ci];
                                registrarCamaUsada(camaAsignada, rowCheckin, rowSalida);
                                if(_logCount<20) console.log(`[Motor] ⚠️ ${nombre}: cama "${habPedida}" ocupada → otra en misma hab: ${camaAsignada}`);
                            }
                        }
                    }
                } else {
                    if(_logCount<20) console.warn(`[Motor] ❌ ${nombre}: "${habPedida}" no encontrado en ningún índice`);
                }
            }
        }
        _logCount++;

        // ── Hab pedida llena → sinAsignar (HAB. LLENA) ──────────────────────────────
        // Si después de intentar todas las camas de la hab_pedida (incluyendo
        // las Ocupadas que se liberan ese día, via _nextDay) aún no hay cama,
        // es que la habitación GENUINAMENTE no tiene espacio → registrar y parar.
        // La asignación automática a OTRA hab queda fuera de la lógica de hab_pedida.
        if (!camaAsignada && habPedida) {
            const habExiste = !!habByNumero[habPedida];
            const razon = habExiste
                ? `Hab. ${habPedida} llena sin rotación disponible en esas fechas`
                : `Hab. ${habPedida} no existe en el sistema`;
            console.warn(`[Motor] ⛔ ${nombre}: ${razon}`);
            sinAsignar.push({ nombre, rut, habPedida, razon, sugerencias: [], rowId: row.id });
            continue;
        }


        // ESCENARIO 2: solo si NO tenía hab_pedida → auto-asignación libre (date-aware)
        if(!camaAsignada) {
            _automaticos++;
            // Nivel A: misma empresa ya en esa hab
            const habsConEstaEmpresa = new Set(
                (asigActivas||[])
                    .filter(a => String(a.empresa_id) === String(empresaId))
                    .map(a => camaIndex[String(a.id_cama)]?.habitacion_id)
                    .filter(Boolean)
            );
            for(const habId of habsConEstaEmpresa) {
                const hab = habMap[habId];
                if(hab) {
                    const ci = hab.libres.findIndex(cId => camaLibreEnFechas(cId, rowCheckin, rowSalida));
                    if(ci >= 0) { camaAsignada = hab.libres[ci]; registrarCamaUsada(camaAsignada, rowCheckin, rowSalida); break; }
                }
            }
            // Nivel B: hab vacía
            if(!camaAsignada) {
                for(const [habId, hab] of Object.entries(habMap)) {
                    const yaOcupada = (asigActivas||[]).some(a =>
                        camaIndex[String(a.id_cama)]?.habitacion_id === habId);
                    if(!yaOcupada) {
                        const ci = hab.libres.findIndex(cId => camaLibreEnFechas(cId, rowCheckin, rowSalida));
                        if(ci >= 0) { camaAsignada = hab.libres[ci]; registrarCamaUsada(camaAsignada, rowCheckin, rowSalida); break; }
                    }
                }
            }
            // Nivel C: cualquier cama libre
            if(!camaAsignada) {
                for(const hab of Object.values(habMap)) {
                    const ci = hab.libres.findIndex(cId => camaLibreEnFechas(cId, rowCheckin, rowSalida));
                    if(ci >= 0) { camaAsignada = hab.libres[ci]; registrarCamaUsada(camaAsignada, rowCheckin, rowSalida); break; }
                }
            }
        }

        if(!camaAsignada){ fallidos.push(`${nombre}: Sin camas disponibles`); continue; }

        // Detectar edificio de la cama asignada
        const camaInfoFinal = camaIndex[String(camaAsignada)];
        const habIdFinal    = camaInfoFinal?.habitacion_id || '';
        const edificioFinal = habIdFinal.startsWith('R-220') ? 'R-220' :
                              habIdFinal.startsWith('COPC')  ? 'COPC'  : habIdFinal.slice(0,8);
        if(_logCount<=20) console.log(`[Motor] 📍 ${nombre}: hab_pedida="${habPedida||'auto'}" → edificio=${edificioFinal} cama=${camaAsignada}`);

        // ── Pre-asignación o activa ───────────────────────────────────────────────
        // pre_asignado si la llegada es HOY o futura (conversion a 'activa' ocurre
        // automáticamente a las 00:00:01 del día de llegada, NO al cargar el Excel).
        const esRotacion = camasEnRotacion.has(String(camaAsignada));
        const esFuturo   = row.fecha_llegada && row.fecha_llegada >= hoy; // >= incluye hoy
        const estadoAsig = esFuturo ? 'pre_asignado' : 'activa';

        asignaciones.push({
            rut_huesped:             rut,
            nombre_huesped:          nombre,
            id_cama:                 camaAsignada,
            empresa_id:              empresaId,
            fecha_checkin:           row.fecha_llegada||hoy,
            fecha_salida_programada: row.fecha_salida||null,
            numero_contrato:         row.n_contrato||null,
            // estado_asignacion se rastrea internamente con _estadoAsig (no va a BD)
            _estadoAsig:             estadoAsig,
            _edificio:               edificioFinal
        });
        // Marcar este RUT como ya asignado en este lote → previene duplicado si el mismo
        // RUT aparece más de una vez en el Excel (intra-lote)
        rutACamaActiva[rut] = camaAsignada;
        rutsProcesadosLote.add(rut);
        rowsActualizadas.push(row.id);
    } // fin for(row of rows)

    if(asignaciones.length>0) {

        // ── Checkout automático de ocupantes en rotación ─────────────────────
        // Si una cama asignada a este lote está en camasEnRotacion, el ocupante
        // actual tiene fecha_salida_programada <= fechaLlegada del nuevo.
        // Debemos hacerle checkout antes de insertar para evitar violar el índice
        // único idx_cama_activa_unica (solo puede haber 1 activo sin checkout por cama).
        const camasRotacionNuevas = asignaciones
            .filter(a => camasEnRotacion.has(String(a.id_cama)))
            .map(a => a.id_cama);
        if(camasRotacionNuevas.length > 0) {
            // Para cada cama en rotación, hacer checkout del ocupante saliente
            // IMPORTANTE: usar timestamp ISO y estado 'sin_checkout' (valor válido en constraint)
            // y excluir 'pre_asignado' del mismo lote (ya fueron asignados en este batch)
            const ahoraRot = new Date().toISOString();
            for(const camaId of camasRotacionNuevas) {
                const {error: errCO} = await supabase.from('v2_asignaciones')
                    .update({ fecha_checkout: ahoraRot, estado_asignacion: 'sin_checkout' })
                    .eq('id_cama', camaId)
                    .is('fecha_checkout', null)
                    .neq('estado_asignacion', 'pre_asignado'); // no tocar pre-asignados del nuevo lote
                if(errCO) console.warn(`[Motor] ⚠️ Checkout rotación cama ${camaId}:`, errCO.message);
                else console.log(`[Motor] 🔄 Checkout rotación cama ${camaId}`);
            }
        }

        // Limpiar campos internos antes de insertar en BD
        const asignacionesDB = asignaciones.map(a => {
            const {_edificio, _estadoAsig, ...rest} = a;
            return { ...rest, estado_asignacion: _estadoAsig || 'activa' };
        });

        // ── INSERT individual por trabajador (reemplaza upsert+ignoreDuplicates) ──
        // ignoreDuplicates silenciosamente omitía asignaciones → estado fantasma
        // Ahora: si hay conflicto de clave única, actualizamos la fila existente.
        const rowsInsertados = []; // ids de solicitudes con asignación OK
        for (let i = 0; i < asignacionesDB.length; i++) {
            const asig   = asignacionesDB[i];
            const rowId  = rowsActualizadas[i]; // id de la solicitud b2b correspondiente

            // ══════════════════════════════════════════════════════════════════════
            // 🛡️ ESCUDO ANTI-DUPLICADO: Verificación en tiempo real contra Supabase
            // Antes de insertar, consultamos si la cama ya tiene una asignación
            // activa con fechas que se solapan con las del trabajador nuevo.
            // Esto protege contra: importaciones concurrentes, datos en caché
            // desactualizados, y el bug de "camas en rotación" mal calculadas.
            // ══════════════════════════════════════════════════════════════════════
            const ciNuevo = asig.fecha_checkin           || '0000-01-01';
            const csNuevo = asig.fecha_salida_programada || '9999-12-31';

            const { data: conflictos } = await supabase
                .from('v2_asignaciones')
                .select('id, nombre_huesped, rut_huesped, fecha_checkin, fecha_salida_programada')
                .eq('id_cama', asig.id_cama)
                .is('fecha_checkout', null)
                .neq('rut_huesped', asig.rut_huesped) // no contar al mismo trabajador
                .or(`fecha_salida_programada.is.null,fecha_salida_programada.gt.${ciNuevo}`)
                .lt('fecha_checkin', csNuevo);

            if (conflictos && conflictos.length > 0) {
                // ❌ La cama ya está ocupada en ese período — registrar como fallido
                const ocupante = conflictos[0];
                const msg = `[Motor] 🚫 BLOQUEADO: cama ${asig.id_cama} ya ocupada por ${ocupante.nombre_huesped} (${ocupante.fecha_checkin}→${ocupante.fecha_salida_programada}) al intentar asignar a ${asig.nombre_huesped}`;
                console.warn(msg);
                fallidos.push(`${asig.nombre_huesped}: cama ${asig.id_cama} ya ocupada por ${ocupante.nombre_huesped}`);
                continue; // saltar INSERT — no duplicar
            }

            const { error: errIns } = await supabase.from('v2_asignaciones').insert(asig);

            if (!errIns) {
                // INSERT exitoso
                rowsInsertados.push(rowId);
            } else if (errIns.code === '23505') {
                // Conflicto de clave única DB — por seguridad intentar actualizar
                const { error: errUpd } = await supabase.from('v2_asignaciones')
                    .update({
                        rut_huesped:             asig.rut_huesped,
                        nombre_huesped:          asig.nombre_huesped,
                        empresa_id:              asig.empresa_id,
                        fecha_checkin:           asig.fecha_checkin,
                        fecha_salida_programada: asig.fecha_salida_programada,
                        numero_contrato:         asig.numero_contrato,
                        estado_asignacion:       asig.estado_asignacion,
                    })
                    .eq('id_cama', asig.id_cama)
                    .eq('rut_huesped', asig.rut_huesped) // solo actualizar la del MISMO trabajador
                    .is('fecha_checkout', null);
                if (!errUpd) rowsInsertados.push(rowId);
                else console.warn(`[Motor] ⚠️ No se pudo actualizar asig existente cama ${asig.id_cama}:`, errUpd.message);
            } else {
                console.warn(`[Motor] ⚠️ Error insertando asignación cama ${asig.id_cama}:`, errIns.message);
            }
        }

        // ── Camas: Ocupada vs PreAsignada ────────────────────────────────────
        const camasActivas      = asignaciones.filter(a=>a._estadoAsig==='activa').map(a=>a.id_cama);
        const camasPreAsignadas = asignaciones.filter(a=>a._estadoAsig==='pre_asignado').map(a=>a.id_cama);
        if(camasActivas.length>0)
            await supabase.from('v2_camas').update({estado:'Ocupada'}).in('id_cama',camasActivas);
        if(camasPreAsignadas.length>0)
            await supabase.from('v2_camas').update({estado:'Disponible'}).in('id_cama',camasPreAsignadas).neq('estado', 'Deshabilitada');

        // Marcar como aceptadas SOLO las que tienen asignación creada/actualizada exitosamente
        if (rowsInsertados.length > 0) {
            await supabase.from('v2_solicitudes_b2b')
                .update({status:'aceptada_asignada'})
                .in('id', rowsInsertados);
        }


    }
    // Marcar fallidos como rechazados (excluye sinAsignar que siguen pendientes)
    const idsSinAsignar = new Set(sinAsignar.map(s => s.rowId));
    const idsFallidos = rows
        .filter(r => !rowsActualizadas.includes(r.id) && !idsSinAsignar.has(r.id))
        .map(r => r.id);
    if(idsFallidos.length>0)
        await supabase.from('v2_solicitudes_b2b').update({status:'rechazada'}).in('id',idsFallidos);
    // sinAsignar permanecen con status='pendiente' para reasignación manual

    // ── Auto-descuento de cupos por n_contrato ──────────────────────────────
    if(asignaciones.length > 0) {
        const conteosPorContrato = {};
        for(const a of asignaciones) {
            if(a.numero_contrato) {
                conteosPorContrato[a.numero_contrato] = (conteosPorContrato[a.numero_contrato]||0) + 1;
            }
        }
        for(const [nContrato, count] of Object.entries(conteosPorContrato)) {
            try {
                const {data:cupoRows} = await supabase.from('v2_cupos_gerencias')
                    .select('id,cupos_ocupados').eq('numero_contrato', nContrato).limit(1);
                if(cupoRows?.length) {
                    const nuevo = (cupoRows[0].cupos_ocupados||0) + count;
                    await supabase.from('v2_cupos_gerencias').update({cupos_ocupados: nuevo}).eq('id', cupoRows[0].id);
                    console.log(`[Motor] Cupos ${nContrato}: +${count} → ${nuevo} ocupados`);
                }
            } catch(e) { console.warn('[Motor] Error actualizando cupo:', e.message); }
        }
    }

    // ── Generar informe por edificio ─────────────────────────────────────────
    const edificioConteo = {};
    for(const a of asignaciones) {
        const e = a._edificio || 'Otro';
        edificioConteo[e] = (edificioConteo[e]||0) + 1;
        delete a._edificio; // limpiar antes de guardar en BD
    }
    const edificioResumen = Object.entries(edificioConteo)
        .map(([e,n]) => `${e}: ${n}`).join(' | ');
    console.log('[Motor] 🏢 Distribución por edificio:', edificioConteo);

    return {ok:true, asignados:asignaciones.length, fallidos, sinAsignar, empresa,
            correctos:_correctos, automaticos:_automaticos, edificios:edificioResumen,
            preCheckout: preCheckoutCount};
}

// ── Almacén en memoria para grupos (evita JSON inline en onclick) ────────────
window._gruposData = {};
let _grupoIdx = 0;

// ── Rechazar grupo ────────────────────────────────────────────────────────────
async function rechazarGrupo(ids) {
    if(!await _solConfirm(`¿Rechazar ${ids.length} solicitudes de este grupo?`, {confirmText:'❌ Rechazar', danger:true})) return;
    const {error}=await supabase.from('v2_solicitudes_b2b').update({status:'rechazada'}).in('id',ids);
    if(error){ toast('Error: '+error.message,'error'); return; }
    toast(`❌ ${ids.length} solicitudes rechazadas`);
    window._renderV2Solicitudes?.(); refreshBadge();
}

// ── Limpiar y Reasignar todo el grupo desde cero (fetch directo de BD) ────────
window._solLimpiarYReasignar = async function(empresa) {
    if(typeof empresa !== 'string' || !empresa.trim()){
        alert('❌ Error: nombre de empresa no recibido.');
        return;
    }
    empresa = decodeURIComponent(escape(empresa));

    if(!await _solConfirm(`⚠️ Esto borrará TODAS las asignaciones de ${empresa} y las reasignará desde cero.

¿Continuar?`, {confirmText:'🔄 Sí, limpiar y reasignar', danger:true})) return;

    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML=`<div style="background:#fff;border-radius:20px;padding:36px 44px;text-align:center;min-width:320px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
        <div style="font-size:40px;margin-bottom:16px">🔄</div>
        <div style="font-weight:900;font-size:18px;margin-bottom:8px">Limpiando y Reasignando</div>
        <div id="_limpiar_step" style="font-size:13px;color:#64748b;margin-bottom:8px">Iniciando...</div>
        <div style="font-size:12px;color:#94a3b8">${empresa}</div>
    </div>`;
    document.body.appendChild(overlay);
    const step=(txt)=>{ const el=document.getElementById('_limpiar_step'); if(el) el.textContent=txt; };

    try {
        // 1. Obtener empresa_id
        step('Buscando empresa en BD...');
        const {data:empRows,error:eEmp}=await supabase.from('v2_empresas').select('id').ilike('nombre',empresa).limit(1);
        if(eEmp) throw new Error('empresa: '+eEmp.message);
        const empresaId=empRows?.[0]?.id;

        if(empresaId) {
            // 2. Obtener asignaciones activas de esta empresa
            step('Obteniendo asignaciones previas...');
            const {data:asigPrevias,error:eAsig}=await supabase.from('v2_asignaciones')
                .select('id,id_cama').eq('empresa_id',empresaId).is('fecha_checkout',null);
            if(eAsig) throw new Error('asignaciones: '+eAsig.message);

            if(asigPrevias?.length) {
                step(`Liberando ${asigPrevias.length} camas...`);
                const camasLiberadas=asigPrevias.map(a=>a.id_cama);
                await supabase.from('v2_camas').update({estado:'Disponible'}).in('id_cama',camasLiberadas).neq('estado', 'Deshabilitada');

                step('Eliminando asignaciones previas...');
                await supabase.from('v2_asignaciones').delete().in('id',asigPrevias.map(a=>a.id));
            } else {
                step('Sin asignaciones previas para liberar.');
            }
        }

        // 3. Obtener TODAS las solicitudes de esta empresa
        step('Cargando solicitudes de '+empresa+'...');
        const {data:solicitudes,error:eSol}=await supabase.from('v2_solicitudes_b2b')
            .select('*').ilike('empresa',empresa).order('created_at');
        if(eSol) throw new Error('solicitudes: '+eSol.message);
        if(!solicitudes?.length) throw new Error('No se encontraron solicitudes para '+empresa);

        // 4. Resetear todas a pendiente
        step('Reseteando '+solicitudes.length+' solicitudes a pendiente...');
        await supabase.from('v2_solicitudes_b2b').update({status:'pendiente'}).ilike('empresa',empresa);

        // 5. Ejecutar motor
        step('Asignando '+solicitudes.length+' trabajadores...');
        const res = await ejecutarGrupo(solicitudes);
        overlay.remove();

        if(!res.ok){
            alert('❌ Error del motor:\n'+res.msg);
            return;
        }
        alert(
            `✅ Resultado Limpiar y Reasignar:\n`+
            `✅ Asignados: ${res.asignados} trabajadores\n`+
            (res.fallidos.length>0
                ? `⚠️ Sin cama: ${res.fallidos.length}\n`+res.fallidos.slice(0,10).join('\n')
                : `🎉 ¡Sin rechazados!`)
        );
        window._renderV2Solicitudes?.();
        refreshBadge();

    } catch(e) {
        overlay.remove();
        alert('❌ Error en Limpiar y Reasignar:\n'+e.message);
    }
};

// Reintentar grupo rechazado → resetea a pendiente Y lanza el motor directamente
window._solReintentarGrupoIds = async function(rKey) {
    const data = window._gruposData[rKey];
    const rows = data?.rechazados || (Array.isArray(data) ? data : null);
    if(!rows||!rows.length){
        alert('⚠️ Recarga la página (Cmd+Shift+R) y ve al Historial nuevamente antes de hacer clic.');
        return;
    }
    if(!await _solConfirm(`¿Reintentar asignación para ${rows.length} trabajadores rechazados?`, {confirmText:'🔄 Reintentar'})) return;

    // 1. Resetear a pendiente en BD
    const ids=rows.map(r=>r.id);
    await supabase.from('v2_solicitudes_b2b').update({status:'pendiente'}).in('id',ids);

    // 2. Ejecutar motor directamente
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML=`<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;min-width:280px">
        <div style="font-size:36px;margin-bottom:12px">⚙️</div>
        <div style="font-weight:800;font-size:16px;margin-bottom:6px">Reintentando asignación…</div>
        <div style="font-size:13px;color:#64748b">Procesando ${rows.length} trabajadores rechazados</div>
    </div>`;
    document.body.appendChild(overlay);


    ejecutarGrupo(rows).then(res=>{
        overlay.remove();
        if(!res.ok){ toast('🚨 '+res.msg,'error'); return; }
        const fallMsg = res.fallidos.length>0
            ? `\n⚠️ Aun sin cama (${res.fallidos.length}):\n`+res.fallidos.slice(0,5).join('\n')
            : '';
        const edif = res.edificios ? `\n🏢 Edificios: ${res.edificios}` : '';
        toast(`✅ ${res.asignados} asignados · ${res.correctos||0} al cuarto solicitado`,'success');
        if(fallMsg||edif) alert(`Resultado reintentar:\n✅ ${res.asignados} asignados${edif}${fallMsg}`);
        window._renderV2Solicitudes?.();
        refreshBadge();
    }).catch(e=>{ overlay.remove(); toast('🚨 '+e.message,'error'); });
};

window._solReintentarUno = async function(id) {
    const {error}=await supabase.from('v2_solicitudes_b2b').update({status:'pendiente'}).eq('id',id);
    if(error){ toast('❌ Error: '+error.message,'error'); return; }
    toast('🔄 Movido a pendientes');
    window._renderV2Solicitudes?.(); refreshBadge();
};

// ── Reasignar TODOS los que están sin cama (⚠️ HAB. LLENA) ──────────────────
// Busca todas las solicitudes con status='aceptada' (sinAsignar), las resetea
// a 'pendiente' y ejecuta el motor por empresa para intentar asignarlas.
window._reasignarTodosHabLlena = async function() {
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML=`<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;min-width:320px;max-width:480px">
        <div style="font-size:40px;margin-bottom:12px">🔄</div>
        <div style="font-weight:800;font-size:18px;margin-bottom:8px">Reasignando pendientes…</div>
        <div id="_reasig_status" style="font-size:13px;color:#64748b;margin-bottom:4px">Cargando solicitudes sin cama…</div>
        <div id="_reasig_progress" style="margin-top:16px;height:6px;background:#e2e8f0;border-radius:99px"><div id="_reasig_bar" style="height:6px;background:#6366f1;border-radius:99px;width:0%;transition:width .4s"></div></div>
    </div>`;
    document.body.appendChild(overlay);
    const setStatus = (txt) => { const el=overlay.querySelector('#_reasig_status'); if(el) el.textContent=txt; };
    const setBar = (pct) => { const el=overlay.querySelector('#_reasig_bar'); if(el) el.style.width=pct+'%'; };

    try {
        // 1. Obtener todas las solicitudes sin cama (aceptada = sin_asignar)
        let sinCama = [], page = 0;
        while(true) {
            const {data, error} = await supabase.from('v2_solicitudes_b2b')
                .select('*')
                .eq('status','aceptada')
                .range(page*1000, page*1000+999);
            if(error) throw new Error(error.message);
            if(!data?.length) break;
            sinCama = sinCama.concat(data);
            if(data.length < 1000) break;
            page++;
        }

        if(!sinCama.length) {
            overlay.remove();
            toast('✅ No hay trabajadores sin cama pendientes','success');
            return;
        }

        setStatus(`Encontrados ${sinCama.length} sin cama. Reseteando…`);

        // 2. Resetear todos a pendiente
        const ids = sinCama.map(r=>r.id);
        for(let i=0; i<ids.length; i+=500) {
            await supabase.from('v2_solicitudes_b2b').update({status:'pendiente'}).in('id', ids.slice(i,i+500));
        }

        // 3. Agrupar por empresa
        const porEmpresa = {};
        for(const r of sinCama) {
            const e = r.empresa || 'SIN_EMPRESA';
            if(!porEmpresa[e]) porEmpresa[e] = [];
            porEmpresa[e].push(r);
        }
        const empresas = Object.keys(porEmpresa);
        let totalAsignados = 0, totalFallidos = [];

        // 4. Ejecutar motor por empresa
        for(let i=0; i<empresas.length; i++) {
            const emp = empresas[i];
            const rows = porEmpresa[emp];
            setStatus(`[${i+1}/${empresas.length}] ${emp}: ${rows.length} trabajadores…`);
            setBar(Math.round((i/empresas.length)*100));
            try {
                const res = await ejecutarGrupo(rows);
                if(res.ok) {
                    totalAsignados += res.asignados || 0;
                    totalFallidos = totalFallidos.concat(res.fallidos || []);
                    totalFallidos = totalFallidos.concat((res.sinAsignar||[]).map(s=>s.nombre||s.rut||'?'));
                }
            } catch(e) {
                console.warn('[Reasignar] Error en empresa '+emp+':', e.message);
            }
        }

        setBar(100);
        overlay.remove();

        const fallMsg = totalFallidos.length > 0
            ? `\n⚠️ Aún sin cama (${totalFallidos.length}):\n${totalFallidos.slice(0,10).join('\n')}${totalFallidos.length>10?'\n…':''}` : '';

        toast(`✅ Reasignación completa: ${totalAsignados} asignados de ${sinCama.length}`,'success');
        if(fallMsg) alert(`Resultado reasignación masiva:\n✅ ${totalAsignados} asignados${fallMsg}`);
        window._renderV2Solicitudes?.();
        refreshBadge();

    } catch(e) {
        overlay.remove();
        toast('🚨 Error: '+e.message,'error');
    }
};



// ── HTML de tarjeta agrupada por empresa ──────────────────────────────────────
function grupoCardHTML(empresa, rows) {
    const gKey = _grupoIdx++;
    window._gruposData[gKey] = rows;
    // ── Metadatos por lista (para borrar/checkout solo esta carga) ────────────
    window._gruposMetadata = window._gruposMetadata || {};
    window._gruposMetadata[gKey] = {
        empresa,
        contrato: rows[0]?.n_contrato  || null,
        fechaIn:  rows[0]?.fecha_llegada || null,
        fechaOut: rows[0]?.fecha_salida  || null,
        ids:      rows.map(r => r.id).filter(Boolean),
    };
    const tableId = `pend-table-${gKey}`;

    const isPending = rows.every(r=>r.status==='pendiente');
    const ids = rows.map(r=>r.id);
    const generos = [...new Set(rows.map(r=>r.genero).filter(Boolean))];
    const gLabel = generos.includes('F')&&generos.includes('M') ? '⚧ Mixto'
                 : generos[0]==='F' ? '♀ Femenino' : generos[0]==='M' ? '♂ Masculino' : '';
    const gColor = generos[0]==='F'?'#fce7f3':'#dbeafe';
    const gTextColor = generos[0]==='F'?'#9d174d':'#1e40af';
    const contrato  = rows[0]?.n_contrato  || '—';
    const gerencia  = rows[0]?.gerencia    || null;
    const fechaLlegada = rows[0]?.fecha_llegada || null;
    const fechaSalida  = rows[0]?.fecha_salida  || null;
    const conHab = rows.filter(r=>r.hab_solicitada).length;
    const sinHab = rows.length - conHab;

    const workerRows = rows.map((r, idx) => {
        const rutB64 = btoa(unescape(encodeURIComponent(r.rut_trabajador||'')));
        const nombreB64 = btoa(unescape(encodeURIComponent(r.nombre_trabajador||'')));
        return `
        <tr style="border-bottom:1px solid #f1f5f9;transition:background .15s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <td style="padding:7px 10px;text-align:center">
                <input type="checkbox" id="chk-${gKey}-${idx}" data-gkey="${gKey}"
                    checked
                    style="width:16px;height:16px;cursor:pointer;accent-color:#16a34a"
                    onchange="window._solUpdateSelCount(${gKey})"
                    onclick="event.stopPropagation()">
            </td>
            <td style="padding:7px 10px;font-weight:700;font-size:13px">${r.nombre_trabajador||'—'}</td>
            <td style="padding:7px 10px;font-family:monospace;font-size:12px;color:#6366f1">${r.rut_trabajador||'—'}</td>
            <td style="padding:7px 10px;text-align:center">
                ${r.hab_solicitada
                    ? `<span style="background:#dcfce7;color:#15803d;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700">🏠 ${r.hab_solicitada}</span>`
                    : `<div style="display:inline-flex;align-items:center;gap:4px">
                        <input type="text"
                            id="inp-hab-${r.id}"
                            placeholder="N° hab"
                            maxlength="8"
                            onkeydown="if(event.key==='Enter'){event.stopPropagation();window._solSetHabManual('${r.id}','${gKey}',this.value)}"
                            onclick="event.stopPropagation()"
                            style="width:68px;border:1.5px solid #c4b5fd;border-radius:7px;padding:3px 6px;font-size:12px;text-align:center;outline:none;font-family:monospace;background:#faf5ff;color:#5b21b6;font-weight:700">
                        <button
                            onclick="event.stopPropagation();window._solSetHabManual('${r.id}','${gKey}',document.getElementById('inp-hab-${r.id}').value)"
                            title="Guardar habitación"
                            style="padding:3px 8px;border:none;border-radius:6px;background:#7c3aed;color:#fff;font-size:12px;font-weight:700;cursor:pointer;line-height:1.4">✓</button>
                       </div>`}
            </td>
            <td style="padding:7px 10px;text-align:center;font-size:12px">${r.genero||'—'}</td>
            <td style="padding:7px 10px;font-size:12px;color:#64748b">${fmt(r.fecha_llegada)} → ${fmt(r.fecha_salida)}</td>
            <td style="padding:7px 10px;text-align:center">
                ${!r.hab_solicitada ? `
                <button onclick="event.stopPropagation();window._solSugerirCama('${r.id}','${rutB64}','${r.genero||''}','${nombreB64}','${gKey}')"
                    title="Ver sugerencias de cama disponible"
                    style="padding:4px 10px;border:none;border-radius:7px;background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;font-weight:700;font-size:11px;cursor:pointer">
                    🔍 Sugerir
                </button>` : `<span style="color:#94a3b8;font-size:11px">—</span>`}
            </td>
            <td style="padding:7px 10px;text-align:center">
                <button
                    onclick="event.stopPropagation();window._solBorrarUno('${r.id}','${rutB64}','${nombreB64}','${gKey}')"
                    title="Eliminar este trabajador de la lista"
                    style="padding:3px 9px;border:none;border-radius:7px;background:#fee2e2;color:#b91c1c;font-size:14px;cursor:pointer;line-height:1.4;transition:background .2s"
                    onmouseover="this.style.background='#fecaca'"
                    onmouseout="this.style.background='#fee2e2'">
                    🗑️
                </button>
            </td>
        </tr>`;
    }).join('');


    const idsJson = JSON.stringify(ids);

    return `
    <div style="background:#fff;border-radius:16px;border:2px solid ${isPending?'#fde68a':'#e2e8f0'};margin-bottom:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07)">

        <!-- Cabecera colapsable -->
        <div onclick="window._solToggleGrupo('${tableId}')" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:14px 20px;background:${isPending?'linear-gradient(135deg,#fffbeb,#fef9c3)':'linear-gradient(135deg,#f8fafc,#f1f5f9)'};border-bottom:1px solid #e2e8f0;cursor:pointer;user-select:none">
            <div style="display:flex;align-items:center;gap:14px">
                <div style="width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,#c0392b,#e74c3c);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:20px;flex-shrink:0">
                    ${empresa.charAt(0).toUpperCase()}
                </div>
                <div>
                    <div style="font-weight:900;font-size:16px">${empresa}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:2px">
                        Contrato: <b>${contrato}</b> &nbsp;·&nbsp;
                        ${gerencia ? `Gerencia: <b>${gerencia}</b> &nbsp;·&nbsp;` : ''}
                        Período: <b>${fmt(fechaLlegada)} → ${fmt(fechaSalida)}</b>
                    </div>
                </div>
            </div>
            <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
                <span style="background:#f1f5f9;color:#475569;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700">👥 ${rows.length}</span>
                ${conHab>0?`<span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700">🏠 ${conHab} con hab.</span>`:''}
                ${sinHab>0?`<span style="background:#fef3c7;color:#92400e;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700">⚠️ ${sinHab} sin hab.</span>`:''}
                ${gLabel?`<span style="background:${gColor};color:${gTextColor};padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700">${gLabel}</span>`:''}
                ${isPending?`<span style="background:#fef9c3;color:#92400e;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:800">⏳ Pendiente</span>`:`<span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:800">✅ Procesada</span>`}
                <button onclick="event.stopPropagation();window._solDescargarExcelGrupo(${gKey})"
                    title="Descargar Excel de esta lista"
                    style="padding:5px 12px;border:none;border-radius:8px;background:#1e40af;color:#fff;font-weight:700;font-size:11px;cursor:pointer">
                    📥 Excel
                </button>
                <button data-gkey="${gKey}" onclick="event.stopPropagation();window._solCheckoutLista(parseInt(this.dataset.gkey))"
                    title="Realizar Check-Out de los trabajadores de SOLO esta lista"
                    style="padding:5px 12px;border:none;border-radius:8px;background:linear-gradient(135deg,#0369a1,#0ea5e9);color:#fff;font-weight:700;font-size:11px;cursor:pointer">
                    🚪 Check Out
                </button>
                <button data-gkey="${gKey}" onclick="event.stopPropagation();window._solBorrarLista(parseInt(this.dataset.gkey))"
                    title="Borrar SOLO esta lista de solicitudes (no afecta otras listas de la misma empresa)"
                    style="padding:5px 12px;border:none;border-radius:8px;background:#fee2e2;color:#b91c1c;font-weight:700;font-size:11px;cursor:pointer">
                    🗑️ Borrar lista
                </button>
                <span id="chevron-${tableId}" style="font-size:18px;transition:transform .25s;display:inline-block;color:#94a3b8">▼</span>

            </div>
        </div>

        <!-- Tabla + botones (colapsable) -->
        <div id="${tableId}" style="display:none">
            <div style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    <thead>
                        <tr style="background:#f8fafc">
                            <th style="padding:8px 10px;text-align:center;width:36px">
                                <input type="checkbox" id="chk-all-${gKey}" checked
                                    title="Seleccionar / deseleccionar todos"
                                    style="width:16px;height:16px;cursor:pointer;accent-color:#16a34a"
                                    onclick="event.stopPropagation()"
                                    onchange="window._solToggleAll(${gKey},this.checked)">
                            </th>
                            <th style="padding:8px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Nombre</th>
                            <th style="padding:8px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">RUT</th>
                            <th style="padding:8px 10px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Habitación</th>
                            <th style="padding:8px 10px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Género</th>
                            <th style="padding:8px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Fechas</th>
                            <th style="padding:8px 10px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Asignación</th>
                            <th style="padding:8px 10px;text-align:center;font-size:10px;color:#b91c1c;font-weight:700;text-transform:uppercase">Borrar</th>
                        </tr>
                    </thead>
                    <tbody>${workerRows}</tbody>
                </table>
            </div>
            <!-- Panel de sugerencias (se inyecta dinámicamente) -->
            <div id="suger-panel-${gKey}"></div>
            ${isPending?`
            <div style="padding:14px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;align-items:center">
                <span id="sel-count-${gKey}" style="font-size:12px;color:#64748b;margin-right:auto">✅ ${rows.length} de ${rows.length} seleccionados</span>
                <button onclick="event.stopPropagation();window._solRechazarGrupo(${idsJson})"
                    style="padding:10px 22px;border:none;border-radius:10px;background:#fee2e2;color:#b91c1c;font-weight:800;font-size:13px;cursor:pointer">
                    ❌ Rechazar grupo
                </button>
                <button id="btn-aceptar-${gKey}" onclick="event.stopPropagation();window._solAceptarSeleccionados(${gKey})"
                    style="padding:10px 28px;border:none;border-radius:10px;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(34,197,94,.35)">
                    ✅ Aceptar y Asignar (${rows.length})
                </button>
            </div>`:''}
        </div>
    </div>`;
}


// ── Sugerir cama disponible (abre panel bajo la tabla) ───────────────────────

window._solSugerirCama = async function(solicitudId, rutB64, genero, nombreB64, gKey) {
    const nombre = decodeURIComponent(escape(atob(nombreB64)));
    const rut    = decodeURIComponent(escape(atob(rutB64)));

    // Encontrar el panel directamente por ID (más robusto que DOM traversal)
    const panelId = 'suger-panel-' + gKey;
    const panel = document.getElementById(panelId);
    if(!panel) { console.error('[Sugerir] panel no encontrado:', panelId); return; }

    // Asegurar que la sección padre esté visible
    const seccion = document.getElementById('pend-table-' + gKey);
    if(seccion && seccion.style.display === 'none') seccion.style.display = 'block';

    panel.innerHTML = `<div style="padding:20px;background:#f5f3ff;border-top:2px solid #c4b5fd;text-align:center">
        <div style="font-size:24px">⏳</div>
        <div style="font-weight:700;font-size:13px;color:#5b21b6;margin-top:8px">Cargando habitaciones disponibles…</div>
    </div>`;

    try {
        // ── Cargar camas disponibles + habitaciones (paginado) ────────────────
        let todasLasCamas = [], page = 0;
        while(true) {
            const {data:pg} = await supabase.from('v2_camas')
                .select('id_cama,habitacion_id,estado')
                .eq('estado','Disponible')
                .range(page*1000, page*1000+999)
                .order('habitacion_id');
            if(!pg?.length) break;
            todasLasCamas = todasLasCamas.concat(pg);
            if(pg.length < 1000) break;
            page++;
        }

        // También filtrar las asignadas activamente (con soporte de rotación de turno)
        const {data:solData} = await supabase.from('v2_solicitudes_b2b')
            .select('fecha_llegada').eq('id', solicitudId).single();
        const fechaLlegadaSol = solData?.fecha_llegada || new Date().toISOString().split('T')[0];

        const {data:asigActivas} = await supabase.from('v2_asignaciones')
            .select('id_cama,fecha_salida_programada').is('fecha_checkout',null);

        // Camas en rotación: el ocupante actual sale el mismo día o antes que llega el nuevo
        const camasRotacion = new Set(
            (asigActivas||[])
                .filter(a => a.fecha_salida_programada && a.fecha_salida_programada <= fechaLlegadaSol)
                .map(a => String(a.id_cama))
        );
        const asigSet = new Set(
            (asigActivas||[])
                .filter(a => !camasRotacion.has(String(a.id_cama)))
                .map(a => String(a.id_cama))
        );

        // Incluir también las camas en rotación (aunque estado='Ocupada' hoy)
        const {data:camasOcupRotacion} = camasRotacion.size > 0
            ? await supabase.from('v2_camas')
                .select('id_cama,habitacion_id,estado')
                .in('id_cama', [...camasRotacion])
            : {data: []};

        const camasLibres = [
            ...todasLasCamas.filter(c => !asigSet.has(String(c.id_cama))),
            ...(camasOcupRotacion || []).map(c => ({...c, _rotacion: true}))
        ];

        // Cargar habitaciones para obtener numero_hab
        let todasHabs = [], hPage = 0;
        while(true) {
            const {data:hpg} = await supabase.from('v2_habitaciones')
                .select('id_custom,numero_hab')
                .range(hPage*1000, hPage*1000+999)
                .order('id_custom');
            if(!hpg?.length) break;
            todasHabs = todasHabs.concat(hpg);
            if(hpg.length < 1000) break;
            hPage++;
        }
        const habInfo = {};
        for(const h of todasHabs) if(h.id_custom) habInfo[h.id_custom] = h;

        if(!camasLibres.length) {
            panel.innerHTML = `<div style="padding:16px 20px;background:#fff7ed;border-top:1px solid #fed7aa;color:#c2410c;font-weight:700">⚠️ No hay camas disponibles en el campamento</div>`;
            return;
        }

        // ── Agrupar camas por habitación ──────────────────────────────────────
        const habMap = {};
        for(const c of camasLibres) {
            const hid = c.habitacion_id;
            if(!habMap[hid]) {
                const info = habInfo[hid] || {};
                const numHab = String(info.numero_hab || hid).trim();
                // Edificio: R-220 vs COPC
                const edificio = hid.startsWith('R-220') ? 'R-220' : 'COPC';
                // Pabellón: primeros 2 dígitos del numero_hab (ej: 4303 → "43")
                const pabellon = numHab.match(/^(\d{2})/)?.[1] || '?';
                // Piso: para R-220 extraer del id_custom (ej: R-220-P2-... → "Piso 2")
                //       para COPC usar el 3er dígito del número (ej: 4303 → piso del pab. 43)
                let piso = '';
                if(hid.startsWith('R-220')) {
                    const m = hid.match(/[Pp](?:iso)?[\s\-]?(\d)/i) || numHab.match(/[Pp](\d)/);
                    piso = m ? 'Piso ' + m[1] : '';
                }
                // Texto de búsqueda completo (edificio + pabellon + numHab + piso)
                const searchText = [edificio, pabellon, numHab, piso].join(' ').toLowerCase();
                habMap[hid] = { camas:[], numHab, edificio, pabellon, piso, searchText, tieneRotacion: false };
            }
            habMap[hid].camas.push(c.id_cama);
            if(c._rotacion) habMap[hid].tieneRotacion = true;
        }

        const pid = `sp-${solicitudId.replace(/-/g,'_')}`;

        // ── Renderizar tarjetas de habitación ─────────────────────────────────
        function renderHabs(query) {
            const q = (query || '').toLowerCase().trim();
            const items = Object.entries(habMap)
                .filter(([hid, h]) => !q || h.searchText.includes(q))
                .sort(([,a],[,b]) => {
                    // R-220 primero si el filtro lo pide, luego por número
                    if(a.edificio !== b.edificio) return a.edificio.localeCompare(b.edificio);
                    return Number(a.numHab) - Number(b.numHab);
                });

            const gridEl = document.getElementById(`${pid}-grid`);
            if(!gridEl) return;

            if(!items.length) {
                gridEl.innerHTML = `<div style="padding:32px;text-align:center;color:#94a3b8;font-size:13px">
                    Sin habitaciones que coincidan con "<b>${query}</b>"<br>
                    <span style="font-size:11px">Prueba: "R-220", "Piso 2", "43", "COPC"…</span>
                </div>`;
                return;
            }

            gridEl.innerHTML = items.map(([hid, h]) => {
                const camasBtns = h.camas.map(cId=>`
                    <button onclick="window._solAsignarSugerida('${solicitudId}','${rutB64}','${cId}')"
                        style="padding:5px 10px;border:none;border-radius:7px;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;font-weight:800;font-size:11px;cursor:pointer;margin:2px;transition:transform .1s"
                        onmouseover="this.style.transform='scale(1.07)'" onmouseout="this.style.transform=''">
                        🛏 ${cId}
                    </button>`).join('');
                const dispColor = h.camas.length >= 2 ? '#dcfce7' : '#fef9c3';
                const dispText  = h.camas.length >= 2 ? '#15803d' : '#92400e';
                const rotBadge  = h.tieneRotacion
                    ? `<span style="background:#fff7ed;color:#c2410c;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;margin-left:6px">🔄 Rotación</span>`
                    : '';
                const pisoBadge = h.piso
                    ? `<span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;margin-left:4px">${h.piso}</span>`
                    : '';
                return `
                <div style="background:#fff;border:1.5px solid ${h.tieneRotacion?'#fed7aa':'#e2e8f0'};border-radius:12px;padding:12px 14px;transition:border-color .15s"
                     onmouseover="this.style.borderColor='#a78bfa'" onmouseout="this.style.borderColor='${h.tieneRotacion?'#fed7aa':'#e2e8f0'}'">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
                        <div>
                            <div style="font-weight:900;font-size:16px;color:#0f172a">Hab. ${h.numHab}${rotBadge}</div>
                            <div style="font-size:11px;color:#64748b">${h.edificio} · Pab. ${h.pabellon}${pisoBadge}</div>
                        </div>
                        <span style="background:${dispColor};color:${dispText};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700">
                            ${h.camas.length} libre${h.camas.length!==1?'s':''}
                        </span>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px">${camasBtns}</div>
                </div>`;
            }).join('');
        }

        panel.innerHTML = `
        <div style="padding:18px 20px;background:#f5f3ff;border-top:2px solid #c4b5fd" id="${pid}">
            <!-- Header -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
                <div>
                    <div style="font-weight:900;font-size:14px;color:#4c1d95">🔍 Asignación — <span style="color:#7c3aed">${nombre}</span>${genero?` <span style="font-size:12px;color:#6b7280">(${genero})</span>`:''}</div>
                    <div style="font-size:11px;color:#7c3aed;margin-top:2px">📅 Llegada: <b>${fechaLlegadaSol}</b> · ${camasLibres.length} camas disponibles (incluye rotaciones de turno)</div>
                </div>
                <button onclick="document.getElementById('${panelId}').innerHTML=''"
                    style="border:none;background:#fee2e2;color:#b91c1c;border-radius:8px;padding:5px 14px;cursor:pointer;font-weight:700;font-size:12px">✕ Cerrar</button>
            </div>

            <!-- Buscador de texto libre -->
            <div style="margin-bottom:14px">
                <input id="${pid}-buscar" type="text" placeholder="🔎 Buscar por edificio, pabellón, piso o habitación… ej: R-220, Piso 2, 43, COPC"
                    oninput="window['${pid}Render'](this.value)"
                    style="width:100%;box-sizing:border-box;padding:10px 14px;border:2px solid #c4b5fd;border-radius:12px;font-size:13px;font-weight:600;color:#4c1d95;background:#fff;outline:none;transition:border-color .2s"
                    onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#c4b5fd'">
                <div style="font-size:10px;color:#94a3b8;margin-top:5px">
                    💡 Escribe "R-220" para Residencial 220 · "43" para Pabellón 43 · "Piso 2" para segundo piso · Enter a buscar
                </div>
            </div>

            <!-- Grilla de habitaciones -->
            <div id="${pid}-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;max-height:400px;overflow-y:auto;padding-right:4px"></div>
        </div>`;

        // Función de render disponible globalmente para el input
        window[`${pid}Render`] = (q) => renderHabs(q);

        renderHabs(''); // render inicial sin filtro (muestra todo)
        // Enfocar el buscador
        setTimeout(() => document.getElementById(`${pid}-buscar`)?.focus(), 100);

    } catch(e) {
        panel.innerHTML = `<div style="padding:16px;color:#ef4444;font-weight:700">Error: ${e.message}</div>`;
    }
};


// ── Asignar desde sugerencia (asigna cama directamente a la solicitud) ─────────
window._solAsignarSugerida = async function(solicitudId, rutB64, camaId) {
    const rut = decodeURIComponent(escape(atob(rutB64)));
    if(!await _solConfirm(`¿Asignar cama ${camaId} a ${rut}?`, {confirmText:'✅ Asignar'})) return;
    try {
        const {data:sol} = await supabase.from('v2_solicitudes_b2b').select('*').eq('id',solicitudId).single();
        if(!sol) throw new Error('Solicitud no encontrada');
        const {data:empRows} = await supabase.from('v2_empresas').select('id').ilike('nombre',sol.empresa||'').limit(1);
        const empresaId = empRows?.[0]?.id || null;
        // Insertar asignación
        const {error:eA} = await supabase.from('v2_asignaciones').insert({
            id_cama: camaId, rut_huesped: (rut || '').slice(0, 12),
            nombre_huesped: sol.nombre_trabajador || rut,
            empresa_id: empresaId,
            fecha_checkin:           sol.fecha_llegada||new Date().toISOString().split('T')[0],
            fecha_salida_programada: sol.fecha_salida||null,
            fecha_checkout: null, numero_contrato: sol.n_contrato||null
        });
        if(eA) throw new Error(eA.message);
        await supabase.from('v2_camas').update({estado:'Ocupada'}).eq('id_cama',camaId);
        await supabase.from('v2_solicitudes_b2b').update({status:'aceptada'}).eq('id',solicitudId);
        if(sol.n_contrato) await _ajustarCupo(sol.n_contrato, +1);
        toast(`✅ ${rut} asignado a cama ${camaId}`);
        window._renderV2Solicitudes?.();
    } catch(e) { alert('❌ Error: '+e.message); }
};

// ── Asignar habitación manual desde el input inline de la tabla ─────────────
window._solSetHabManual = async function(solicitudId, gKey, numHab) {
    numHab = (numHab || '').toString().trim();
    if (!numHab) {
        const inp = document.getElementById('inp-hab-' + solicitudId);
        if (inp) {
            inp.style.borderColor = '#ef4444';
            inp.focus();
            setTimeout(() => { inp.style.borderColor = '#c4b5fd'; }, 1500);
        }
        return;
    }
    const inp = document.getElementById('inp-hab-' + solicitudId);
    if (inp) { inp.disabled = true; inp.style.opacity = '0.5'; }
    try {
        const { error } = await supabase
            .from('v2_solicitudes_b2b')
            .update({ hab_solicitada: numHab })
            .eq('id', solicitudId);
        if (error) throw new Error(error.message);
        window._renderV2Solicitudes?.();
    } catch(e) {
        if (inp) { inp.disabled = false; inp.style.opacity = '1'; }
        alert('\u274c Error al guardar habitaci\u00f3n: ' + e.message);
    }
};

/**
 * _limpiarCamasPerdidas(camaIds)
 * Dado un array de IDs de cama liberadas, elimina sus registros en v2_camas_perdidas.
 * Se llama siempre que se borra una lista, un trabajador o una asignaci\u00f3n.
 */
async function _limpiarCamasPerdidas(camaIds) {
    if (!camaIds?.length) return;
    try {
        const { data: camasData } = await supabase
            .from('v2_camas')
            .select('id_cama,habitacion_id')
            .in('id_cama', camaIds);
        const habIds = [...new Set((camasData || []).map(c => c.habitacion_id).filter(Boolean))];
        if (!habIds.length) return;
        const { error } = await supabase
            .from('v2_camas_perdidas')
            .delete()
            .in('habitacion_id', habIds);
        if (error) console.warn('[CP] Error limpiando v2_camas_perdidas:', error.message);
        else console.log(`[CP] \u2705 v2_camas_perdidas limpiado: ${habIds.length} habitaciones`);
    } catch(e) {
        console.warn('[CP] Excepci\u00f3n en _limpiarCamasPerdidas:', e.message);
    }
}

// \u2500\u2500 Borrar lista de solicitudes (\u00e1lias de compatibilidad) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
window._solBorrarListaEmpresa = function(empresa) {
    const meta = window._gruposMetadata || {};
    const key = Object.keys(meta).find(k => meta[k].empresa === empresa);
    if(key != null) { window._solBorrarLista(parseInt(key)); }
    else { toast('\u26a0\ufe0f Recarga la p\u00e1gina antes de borrar', 'warn'); }
};

/**
 * _solBorrarLista(gKey)
 * Borra \u00danICAMENTE los registros de la lista seleccionada.
 * Libera camas, hace checkout, limpia v2_camas_perdidas y borra solicitudes.
 */
window._solBorrarLista = async function(gKey) {
    const data = window._gruposData[gKey];
    const rows = Array.isArray(data) ? data : (data?.allRows || data?.rows || []);
    const meta = (window._gruposMetadata || {})[gKey] || {};
    const empresa = meta.empresa || rows[0]?.empresa || 'esta empresa';
    const ids = (meta.ids?.length ? meta.ids : rows.map(r => r.id)).filter(Boolean);

    if(!ids.length) { toast('No hay registros en esta lista', 'warn'); return; }
    if(!await _solConfirm(
        `\u00bfBorrar esta lista de ${ids.length} solicitudes de "${empresa}"?\n\n` +
        `Per\u00edodo: ${meta.fechaIn||'\u2014'} \u2192 ${meta.fechaOut||'\u2014'}\n` +
        `N\u00b0 Contrato: ${meta.contrato||'\u2014'}\n\n` +
        `\u2022 Se har\u00e1 Check-Out de los trabajadores asignados\n` +
        `\u2022 Las camas quedar\u00e1n libres\n` +
        `\u2022 Desaparecer\u00e1n de Control de Asistencia e Infraestructura\n` +
        `Solo se elimina ESTA lista \u2014 otras listas no se ven afectadas.`,
        {confirmText:'\ud83d\uddd1\ufe0f Borrar y liberar', danger:true}
    )) return;

    // \u2500\u2500 Overlay de progreso \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `<div style="background:#fff;border-radius:20px;padding:32px 40px;text-align:center;min-width:340px">
        <div style="font-size:36px;margin-bottom:10px">\ud83d\uddd1\ufe0f</div>
        <div style="font-weight:900;font-size:15px;margin-bottom:6px">Borrando lista: ${empresa}</div>
        <div id="_bl_txt" style="font-size:13px;color:#64748b;min-height:20px;margin-bottom:12px">Preparando\u2026</div>
        <div style="height:7px;background:#f1f5f9;border-radius:99px;overflow:hidden">
            <div id="_bl_prog" style="height:100%;width:0%;background:linear-gradient(90deg,#b91c1c,#ef4444);transition:width .4s;border-radius:99px"></div>
        </div></div>`;
    document.body.appendChild(overlay);
    const setStep = (txt, pct) => {
        const el = document.getElementById('_bl_txt');
        const pr = document.getElementById('_bl_prog');
        if(el) el.textContent = txt;
        if(pr && pct !== undefined) pr.style.width = pct + '%';
    };

    try {
        // PASO 1: Obtener detalles de solicitudes, empresa y contrato
        const {data:sols} = await supabase
            .from('v2_solicitudes_b2b')
            .select('rut_trabajador,nombre_trabajador,n_contrato')
            .in('id', ids);
        const rutsNorm    = [...new Set((sols||[]).map(s => String(s.rut_trabajador||'').replace(/[\.\-\s]/g,'').toUpperCase().slice(0,12)).filter(Boolean))];
        const nombresNorm = [...new Set((sols||[]).map(s => s.nombre_trabajador).filter(Boolean))];
        const contratos   = [...new Set((sols||[]).map(s => String(s.n_contrato||meta.contrato||'')).filter(Boolean))];

        const {data:empRows} = await supabase.from('v2_empresas').select('id').ilike('nombre', empresa).limit(1);
        const empId = empRows?.[0]?.id;

        setStep('Buscando asignaciones activas\u2026', 20);
        let asigIds = [], camaIds = [];

        // PASO 2: 3 estrategias en paralelo \u2014 RUT + Nombre + N\u00b0 Contrato
        if (empId) {
            const queries = [];
            if (rutsNorm.length > 0 || nombresNorm.length > 0) {
                let q = supabase.from('v2_asignaciones').select('id,id_cama').is('fecha_checkout', null).eq('empresa_id', empId);
                let orFiltros = [];
                if (rutsNorm.length > 0)    orFiltros.push(`rut_huesped.in.(${rutsNorm.join(',')})`);
                if (nombresNorm.length > 0) orFiltros.push(`nombre_huesped.in.(${nombresNorm.map(n=>`"${n}"`).join(',')})`);
                queries.push(q.or(orFiltros.join(',')));
            }
            if (contratos.length > 0) {
                queries.push(
                    supabase.from('v2_asignaciones')
                        .select('id,id_cama')
                        .is('fecha_checkout', null)
                        .in('numero_contrato', contratos)
                );
            }
            const results = await Promise.all(queries);
            const asigMap = {};
            results.flatMap(r => r.data || []).forEach(a => { asigMap[a.id] = a; });
            const dedupAsigs = Object.values(asigMap);
            asigIds = dedupAsigs.map(a => a.id);
            camaIds = [...new Set(dedupAsigs.map(a => a.id_cama).filter(Boolean))];
            console.log(`[BorrarLista] ${asigIds.length} asignaciones / ${camaIds.length} camas`);
        }

        // PASO 3: Liberar camas
        setStep(`Liberando ${camaIds.length} camas\u2026`, 45);
        if(camaIds.length) {
            for(let i = 0; i < camaIds.length; i += 50) {
                await supabase.from('v2_camas')
                    .update({ estado: 'Disponible' })
                    .in('id_cama', camaIds.slice(i, i + 50))
                    .neq('estado', 'Deshabilitada');
            }
        }

        // PASO 3.5: Limpiar v2_camas_perdidas de las habitaciones liberadas
        setStep('Limpiando camas perdidas\u2026', 55);
        await _limpiarCamasPerdidas(camaIds);

        // PASO 4: Eliminar asignaciones
        setStep(`Borrando ${asigIds.length} asignaciones\u2026`, 65);
        if(asigIds.length) {
            for(let i = 0; i < asigIds.length; i += 50) {
                await supabase.from('v2_asignaciones')
                    .delete()
                    .in('id', asigIds.slice(i, i + 50));
            }
        }

        // PASO 5: Eliminar solicitudes de B2B
        setStep('Eliminando solicitudes\u2026', 85);
        const {error} = await supabase.from('v2_solicitudes_b2b').delete().in('id', ids);
        if(error) throw new Error(error.message);

        setStep('\u2705 Lista borrada', 100);
        await new Promise(r => setTimeout(r, 700));
        overlay.remove();
        toast(
            `\u2705 Lista de "${empresa}" borrada \u00b7 ${asigIds.length} checkout \u00b7 ${camaIds.length} camas liberadas`,
            'success'
        );
        window._renderV2Solicitudes?.();
        refreshBadge();
    } catch(e) {
        overlay.remove();
        alert('\u274c Error al borrar lista:\n'+e.message);
    }
};

window._solBorrarUno = async function(solicitudId, rutB64, nombreB64, gKey) {
    const rut    = decodeURIComponent(escape(atob(rutB64)));
    const nombre = decodeURIComponent(escape(atob(nombreB64)));

    if (!await _solConfirm(
        `¿Eliminar a "${nombre}" (${rut}) de esta lista?\n\n` +
        `• Si tiene cama asignada, se registrará Check-Out\n` +
        `• La cama quedará disponible\n` +
        `• Solo se borra este trabajador`,
        { confirmText: '🗑️ Eliminar', danger: true }
    )) return;

    try {
        // 1. Obtener detalles de la solicitud a borrar (RUT, Nombre, Empresa)
        const { data: sol } = await supabase.from('v2_solicitudes_b2b').select('rut_trabajador,nombre_trabajador,empresa').eq('id', solicitudId).single();
        const rutSol = sol?.rut_trabajador || rut || '';
        const nomSol = sol?.nombre_trabajador || nombre || '';
        const empSol = sol?.empresa || '';
        
        const rutNorm = String(rutSol).replace(/[.\-\s]/g,'').toUpperCase().slice(0,12);
        
        // Obtener empresa_id
        let empId = null;
        if(empSol) {
            const {data:empRows} = await supabase.from('v2_empresas').select('id').ilike('nombre', empSol).limit(1);
            empId = empRows?.[0]?.id;
        }

        // Buscar asignación activa por RUT o Nombre
        let asigIds = [], camaIds = [];
        if(empId && (rutNorm || nomSol)) {
            let query = supabase.from('v2_asignaciones').select('id,id_cama').is('fecha_checkout', null).eq('empresa_id', empId);
            
            let orFiltros = [];
            if (rutNorm) orFiltros.push(`rut_huesped.eq.${rutNorm}`);
            if (nomSol)  orFiltros.push(`nombre_huesped.eq."${nomSol}"`);
            
            if (orFiltros.length > 0) {
                query = query.or(orFiltros.join(','));
                const { data: asigs } = await query;
                asigIds = (asigs || []).map(a => a.id);
                camaIds = [...new Set((asigs || []).map(a => a.id_cama).filter(Boolean))];
            }
        }

        // 2. Liberar camas INMEDIATAMENTE
        if (camaIds.length) {
            await supabase.from('v2_camas')
                .update({ estado: 'Disponible' })
                .in('id_cama', camaIds)
                .neq('estado', 'Deshabilitada');
            // Limpiar v2_camas_perdidas para esas habitaciones
            await _limpiarCamasPerdidas(camaIds);
        }

        // 3. Eliminar asignaciones por completo (DELETE)
        if (asigIds.length) {
            await supabase.from('v2_asignaciones')
                .delete()
                .in('id', asigIds);
        }

        // 3. Liberar camas
        if (camaIds.length) {
            await supabase.from('v2_camas')
                .update({ estado: 'Disponible' })
                .in('id_cama', camaIds)
                .neq('estado', 'Deshabilitada');
        }

        // 4. Eliminar la solicitud
        const { error } = await supabase
            .from('v2_solicitudes_b2b')
            .delete()
            .eq('id', solicitudId);
        if (error) throw new Error(error.message);

        const camasTxt = camaIds.length
            ? ` · ${camaIds.length} cama${camaIds.length !== 1 ? 's' : ''} liberada${camaIds.length !== 1 ? 's' : ''}`
            : '';
        toast(`✅ ${nombre} eliminado${camasTxt}`, 'success');
        window._renderV2Solicitudes?.();
    } catch(e) {
        alert('❌ Error al eliminar trabajador:\n' + e.message);
    }
};



window._solDescargarExcelGrupo = async function(gKey) {
    const _raw = window._gruposData[gKey];
    // Soporta formato array (Pendientes) y objeto {allRows} (Historial)
    const rows = Array.isArray(_raw) ? _raw : (_raw?.allRows || _raw?.rows || []);
    if(!rows?.length) { alert('No hay datos disponibles'); return; }

    if(!window.XLSX) {
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
        await new Promise((res,rej)=>{ s.onload=res; s.onerror=rej; document.head.appendChild(s); });
    }

    const empresa = rows[0]?.empresa || 'empresa';
    const header = [['NOMBRE','RUT','EMPRESA','GÉNERO','HAB. SOLICITADA','N° CONTRATO','FECHA LLEGADA','FECHA SALIDA','ESTADO']];
    const data = rows.map(r=>[
        r.nombre_trabajador||'',
        r.rut_trabajador||'',
        r.empresa||'',
        r.genero||'',
        r.hab_solicitada||'',
        r.n_contrato||'',
        r.fecha_llegada||'',
        r.fecha_salida||'',
        r.status||''
    ]);

    const ws = XLSX.utils.aoa_to_sheet([...header, ...data]);
    ws['!cols'] = [40,15,30,8,15,12,14,14,12].map(w=>({wch:w}));

    // Estilo de cabecera
    const range = XLSX.utils.decode_range(ws['!ref']);
    for(let c=range.s.c; c<=range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({r:0,c})];
        if(cell) { cell.s = { fill:{fgColor:{rgb:'C0392B'}}, font:{bold:true,color:{rgb:'FFFFFF'}} }; }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, empresa.slice(0,30));
    XLSX.writeFile(wb, `Solicitud_${empresa.replace(/\s+/g,'_')}.xlsx`);
    toast('📥 Excel descargado');
};

// ── Historial row ─────────────────────────────────────────────────────────────

function rowHTML(req) {
    const stMap={aceptada:{bg:'#dcfce7',c:'#15803d',t:'✅ Aceptada'},rechazada:{bg:'#fee2e2',c:'#b91c1c',t:'❌ Rechazada'},parcial:{bg:'#e0f2fe',c:'#0369a1',t:'🔵 Parcial'}};
    const st=stMap[req.status]||{bg:'#f1f5f9',c:'#64748b',t:req.status};
    return `<tr onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
        <td style="padding:10px 14px;font-weight:700">${req.empresa||'—'}</td>
        <td style="padding:10px 14px;font-family:monospace;font-size:12px;color:#6366f1">${req.rut_trabajador||'—'}</td>
        <td style="padding:10px 14px">${req.nombre_trabajador||'—'}</td>
        <td style="padding:10px 14px;text-align:center">${req.hab_solicitada||'Auto'}</td>
        <td style="padding:10px 14px">${fmt(req.fecha_llegada)} → ${fmt(req.fecha_salida)}</td>
        <td style="padding:10px 14px;text-align:center"><span style="background:${st.bg};color:${st.c};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800">${st.t}</span></td>
    </tr>`;
}

// ── Render principal ──────────────────────────────────────────────────────────
export async function renderV2Solicitudes(container) {
    container.innerHTML = `
    <style>
      .sol-tab{padding:10px 22px;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;transition:all .2s}
      .sol-tab.active{background:linear-gradient(135deg,#c0392b,#e74c3c);color:#fff;box-shadow:0 2px 8px rgba(192,57,43,.35)}
      .sol-tab:not(.active){background:#fff;color:#64748b;border:1px solid #e2e8f0}
    </style>
    <div style="padding:24px 20px;max-width:1100px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px">
            <div>
                <h2 style="font-size:22px;font-weight:800;margin:0">🔔 Solicitudes B2B</h2>
                <p style="font-size:13px;color:#64748b;margin:4px 0 0">Agrupadas por empresa &middot; Motor V2</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button onclick="window._reasignarTodosHabLlena()" style="padding:9px 18px;border:none;border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(99,102,241,.35)">🔄 Reasignar Todos los Pendientes</button>
                <button onclick="window._solEliminarPorRutModal()" style="padding:9px 18px;border:none;border-radius:10px;background:#7c3aed;color:#fff;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px">🗑️ Eliminar por RUT</button>
                <button onclick="window._renderV2Solicitudes()" style="padding:9px 18px;border:none;border-radius:10px;background:#c0392b;color:#fff;font-weight:700;font-size:13px;cursor:pointer">🔄 Actualizar</button>
            </div>
        </div>
        <div id="sol-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px"></div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
            <button class="sol-tab active" id="tab-pending" onclick="window._solTab('pending')">⏳ Pendientes <span id="tab-cnt"></span></button>
            <button class="sol-tab" id="tab-conhab"
                style="padding:10px 22px;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;background:linear-gradient(135deg,#15803d,#22c55e);color:#fff;box-shadow:0 2px 10px rgba(21,128,61,.35);display:flex;align-items:center;gap:6px"
                onclick="window._solTab('conhab')">📋 Cargas con Habitación
            </button>
            <button class="sol-tab" id="tab-history" onclick="window._solTab('history')">📋 Historial</button>
        </div>
        <!-- Input oculto para Excel de habitaciones (legado) -->
        <input type="file" id="_sol-excel-conhab" accept=".xlsx,.xls,.csv" style="display:none"
               onchange="window._solProcesarExcelConHab(this)">
        <div id="sol-body"></div>
    </div>`;


    window._renderV2Solicitudes = () => renderV2Solicitudes(container);
    window._solTab = t => renderTab(t);

    // ── Eliminar persona por RUT (libera cama + checkout) ─────────────────────
    window._solEliminarPorRutModal = function() {
        // Eliminar modal anterior si existe
        document.getElementById('_elim-rut-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = '_elim-rut-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
        overlay.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:32px 36px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.35);position:relative">
            <button onclick="document.getElementById('_elim-rut-overlay').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:#64748b">✕</button>
            <div style="font-size:28px;margin-bottom:8px">🗑️</div>
            <h3 style="margin:0 0 6px;font-size:18px;font-weight:800;color:#1e293b">Eliminar persona por RUT</h3>
            <p style="margin:0 0 20px;font-size:13px;color:#64748b">Busca por RUT a una persona activa o pre-asignada para liberarla y liberar su cama.</p>

            <div style="display:flex;gap:8px;margin-bottom:16px">
                <input id="_elim-rut-input" type="text" placeholder="Ej: 12.345.678-9"
                    onkeydown="if(event.key==='Enter') window._solEliminarBuscar()"
                    style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;outline:none;font-family:monospace"
                    oninput="document.getElementById('_elim-result').innerHTML=''"
                >
                <button onclick="window._solEliminarBuscar()" style="padding:10px 18px;border:none;border-radius:10px;background:#3b82f6;color:#fff;font-weight:700;font-size:13px;cursor:pointer">🔍 Buscar</button>
            </div>

            <div id="_elim-result"></div>
        </div>`;
        document.body.appendChild(overlay);
        setTimeout(() => document.getElementById('_elim-rut-input')?.focus(), 100);
    };

    window._solEliminarBuscar = async function() {
        const inp = document.getElementById('_elim-rut-input');
        if (!inp) return;
        const rawRut = inp.value.trim();
        const rutNorm = rawRut.replace(/[.\-\s]/g,'').toUpperCase();
        if (!rutNorm || rutNorm.length < 4) {
            document.getElementById('_elim-result').innerHTML = `<div style="color:#ef4444;font-size:13px;font-weight:600">⚠️ Ingresa un RUT válido</div>`;
            return;
        }

        const resDiv = document.getElementById('_elim-result');
        resDiv.innerHTML = `<div style="color:#64748b;font-size:13px;padding:12px 0">⏳ Buscando…</div>`;

        try {
            // Buscar asignación activa o pre-asignada
            const { data: asigs, error } = await supabase
                .from('v2_asignaciones')
                .select('id, nombre_huesped, rut_huesped, id_cama, empresa_id, fecha_checkin, fecha_salida_programada, estado_asignacion, v2_camas(v2_habitaciones(numero_hab)), v2_empresas(nombre)')
                .eq('rut_huesped', rutNorm)
                .is('fecha_checkout', null)
                .in('estado_asignacion', ['activa', 'pre_asignado']);

            if (error) throw error;

            if (!asigs || asigs.length === 0) {
                resDiv.innerHTML = `
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 16px;font-size:13px;color:#c2410c">
                    <b>⚠️ No encontrado</b><br>No hay asignación activa o pre-asignada para el RUT <code>${rawRut}</code>.
                </div>`;
                return;
            }

            const a = asigs[0];
            const hab     = a.v2_camas?.v2_habitaciones?.numero_hab || '—';
            const empresa = a.v2_empresas?.nombre || '—';
            const ci  = a.fecha_checkin ? new Date(a.fecha_checkin).toLocaleDateString('es-CL') : '—';
            const sal = a.fecha_salida_programada ? new Date(a.fecha_salida_programada).toLocaleDateString('es-CL') : '—';
            const estadoBadge = a.estado_asignacion === 'pre_asignado'
                ? `<span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">PRE-ASIGNADO</span>`
                : `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">ACTIVO</span>`;

            const nombreSeguro = (a.nombre_huesped||'').replace(/['"`<>]/g,' ').trim();

            resDiv.innerHTML = `
            <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:14px;padding:16px 18px;margin-bottom:14px">
                <div style="font-size:16px;font-weight:800;color:#1e293b;margin-bottom:4px">${a.nombre_huesped}</div>
                <div style="font-size:12px;color:#64748b;font-family:monospace;margin-bottom:10px">${a.rut_huesped}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
                    <div><span style="color:#94a3b8">Empresa:</span> <b>${empresa}</b></div>
                    <div><span style="color:#94a3b8">Estado:</span> ${estadoBadge}</div>
                    <div><span style="color:#94a3b8">Habitación:</span> <b style="color:#059669">${hab}</b></div>
                    <div><span style="color:#94a3b8">Cama ID:</span> <code style="font-size:11px">${a.id_cama}</code></div>
                    <div><span style="color:#94a3b8">Check-in:</span> <b>${ci}</b></div>
                    <div><span style="color:#94a3b8">Salida:</span> <b>${sal}</b></div>
                </div>
            </div>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 14px;font-size:12px;color:#b91c1c;margin-bottom:14px">
                ⚠️ Al confirmar: se hará checkout de esta persona, se liberará la cama <b>${hab}</b> y la solicitud quedará marcada como finalizada.
            </div>
            <button onclick="window._solEliminarConfirmar('${a.id}','${a.id_cama}','${a.rut_huesped}','${nombreSeguro}')"
                style="width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;font-weight:800;font-size:14px;cursor:pointer">
                🗑️ Confirmar eliminación
            </button>`;

        } catch(e) {
            resDiv.innerHTML = `<div style="color:#ef4444;font-size:13px">❌ Error: ${e.message}</div>`;
        }
    };

    window._solEliminarConfirmar = async function(asigId, camaId, rut, nombre) {
        const btn = document.querySelector('#_elim-result button');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Procesando…'; }

        try {
            const ahora = new Date().toISOString();

            // 1. Checkout de la asignación
            const { error: e1 } = await supabase.from('v2_asignaciones')
                .update({ fecha_checkout: ahora, estado_asignacion: 'sin_checkout' })
                .eq('id', asigId).is('fecha_checkout', null);
            if (e1) throw new Error('Checkout: ' + e1.message);

            // 2. Liberar la cama
            const { error: e2 } = await supabase.from('v2_camas')
                .update({ estado: 'Disponible' })
                .eq('id_cama', camaId).neq('estado', 'Deshabilitada');
            if (e2) throw new Error('Cama: ' + e2.message);

            // 3. Marcar solicitud como finalizada
            const rutNorm = rut.replace(/[.\-\s]/g,'').toUpperCase();
            await supabase.from('v2_solicitudes_b2b')
                .update({ status: 'finalizado' })
                .eq('rut_trabajador', rutNorm)
                .in('status', ['aceptada', 'aceptada_asignada', 'pendiente']);

            // Éxito
            document.getElementById('_elim-result').innerHTML = `
            <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:16px;text-align:center">
                <div style="font-size:28px;margin-bottom:8px">✅</div>
                <div style="font-weight:800;font-size:15px;color:#15803d;margin-bottom:4px">${nombre} eliminado</div>
                <div style="font-size:12px;color:#16a34a">Cama liberada · Solicitud finalizada</div>
            </div>
            <button onclick="document.getElementById('_elim-rut-overlay').remove();window._renderV2Solicitudes();" style="width:100%;margin-top:12px;padding:10px;border:none;border-radius:10px;background:#e2e8f0;color:#1e293b;font-weight:700;font-size:13px;cursor:pointer">Cerrar y actualizar</button>`;

            await Promise.resolve().then(() => {
                try {
                    // logAudit opcional — puede no estar disponible en este módulo
                    if (typeof logAudit === 'function') logAudit('ELIMINAR_POR_RUT', `Checkout manual: ${nombre} (${rut}) liberado`, { asigId, camaId, rut });
                } catch(_) {}
            });

        } catch(e) {
            const resDiv = document.getElementById('_elim-result');
            if (resDiv) resDiv.innerHTML += `<div style="color:#ef4444;font-size:13px;margin-top:8px">❌ Error: ${e.message}</div>`;
            if (btn) { btn.disabled = false; btn.textContent = '🗑️ Confirmar eliminación'; }
        }
    };

    // ── Helpers de selección por checkboxes ───────────────────────────────────
    window._solToggleAll = (gKey, checked) => {
        document.querySelectorAll(`input[data-gkey="${gKey}"]`).forEach(cb => cb.checked = checked);
        window._solUpdateSelCount(gKey);
    };

    window._solUpdateSelCount = (gKey) => {
        const all  = [...document.querySelectorAll(`input[data-gkey="${gKey}"]`)];
        const sel  = all.filter(cb => cb.checked).length;
        const total = all.length;
        const countEl = document.getElementById(`sel-count-${gKey}`);
        const btnEl   = document.getElementById(`btn-aceptar-${gKey}`);
        const allChk  = document.getElementById(`chk-all-${gKey}`);
        if (countEl) countEl.textContent = `✅ ${sel} de ${total} seleccionados`;
        if (btnEl) {
            btnEl.textContent = sel > 0 ? `✅ Aceptar y Asignar (${sel})` : '— Ninguno seleccionado';
            btnEl.disabled = sel === 0;
            btnEl.style.opacity = sel === 0 ? '0.45' : '1';
        }
        if (allChk) allChk.indeterminate = sel > 0 && sel < total;
    };

    // ── Aceptar solo los trabajadores marcados con checkbox ───────────────────
    window._solAceptarSeleccionados = (gKey) => {
        const allRows  = window._gruposData[gKey];
        if (!allRows?.length) { toast('Error: grupo no encontrado', 'error'); return; }

        // Obtener índices de los checkboxes marcados
        const checkedIdxs = [...document.querySelectorAll(`input[data-gkey="${gKey}"]`)]
            .map((cb, i) => cb.checked ? i : -1)
            .filter(i => i >= 0);

        const selected = checkedIdxs.map(i => allRows[i]);
        if (!selected.length) { toast('Selecciona al menos un trabajador', 'error'); return; }

        const skipped = allRows.length - selected.length;
        if (skipped > 0) {
            const ok = confirm(`⚠️ Cargarás ${selected.length} de ${allRows.length} trabajadores.\n${skipped} trabajador(es) NO serán cargados.\n\n¿Confirmar?`);
            if (!ok) return;
        }

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
        overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;min-width:280px">
            <div style="font-size:36px;margin-bottom:12px">⚙️</div>
            <div style="font-weight:800;font-size:16px;margin-bottom:6px">Asignando camas…</div>
            <div style="font-size:13px;color:#64748b">Procesando ${selected.length} trabajadores seleccionados</div>
        </div>`;
        document.body.appendChild(overlay);

        ejecutarGrupo(selected).then(res => {
            overlay.remove();
            if (!res.ok) { toast('🚨 ' + res.msg, 'error'); return; }
            const sinA = res.sinAsignar || [];
            if (sinA.length > 0) {
                // Reusar el flujo existente del modal de sin asignar
                window._gruposData[gKey] = selected; // temporalmente apuntar al subgrupo
            }
            toast(`✅ ${res.asignados} asignado(s) correctamente`, 'success');
            window._renderV2Solicitudes?.();
            refreshBadge();
        }).catch(e => { overlay.remove(); toast('🚨 ' + e.message, 'error'); });
    };

    window._solAceptarGrupo = gKey => {
        const rows = window._gruposData[gKey];
        if(!rows||!rows.length){ toast('Error: grupo no encontrado','error'); return; }
        const overlay=document.createElement('div');
        overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
        overlay.innerHTML=`<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;min-width:280px">
            <div style="font-size:36px;margin-bottom:12px">⚙️</div>
            <div style="font-weight:800;font-size:16px;margin-bottom:6px">Asignando camas…</div>
            <div style="font-size:13px;color:#64748b">Procesando ${rows.length} trabajadores</div>
        </div>`;
        document.body.appendChild(overlay);
        ejecutarGrupo(rows).then(res=>{
            overlay.remove();
            if(!res.ok){ toast('🚨 '+res.msg,'error'); return; }

            // ── Mostrar modal de resultado ───────────────────────────────────
            const sinA = res.sinAsignar || [];
            const fall = res.fallidos  || [];

            // Si hay trabajadores sin asignar → mostrar modal interactivo con buscador
            if(sinA.length > 0) {
                const modal = document.createElement('div');
                modal.id = 'modal-sinasignar';
                modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';

                // Carga inicial del modal mientras cargamos camas
                modal.innerHTML = `
                    <div style="background:#f8fafc;border-radius:16px;padding:32px;text-align:center;min-width:280px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
                        <div style="font-size:36px">⏳</div>
                        <div style="font-weight:800;margin-top:12px">Cargando camas disponibles…</div>
                    </div>`;
                document.body.appendChild(modal);

                // Cargar camas disponibles + rotaciones de turno
                (async () => {
                    try {
                        // ── Fecha de llegada del grupo ────────────────────────
                        const fechaLlegada = rows[0]?.fecha_llegada || new Date().toISOString().split('T')[0];

                        // ── Camas con estado Disponible ───────────────────────
                        let todasCamas = [], pg2 = 0;
                        while(true) {
                            const {data:cp} = await supabase.from('v2_camas')
                                .select('id_cama,habitacion_id,estado')
                                .eq('estado','Disponible')
                                .range(pg2*1000, pg2*1000+999);
                            if(!cp?.length) break;
                            todasCamas = todasCamas.concat(cp);
                            if(cp.length < 1000) break;
                            pg2++;
                        }

                        // ── Asignaciones activas + rotaciones ────────────────
                        const {data:asigActivas2} = await supabase.from('v2_asignaciones')
                            .select('id_cama,fecha_salida_programada').is('fecha_checkout',null);
                        const camasRot = new Set((asigActivas2||[])
                            .filter(a => a.fecha_salida_programada && a.fecha_salida_programada <= fechaLlegada)
                            .map(a => String(a.id_cama)));
                        const asigOcup = new Set((asigActivas2||[])
                            .filter(a => !camasRot.has(String(a.id_cama)))
                            .map(a => String(a.id_cama)));

                        let camasRotRows = [];
                        if(camasRot.size > 0) {
                            const {data:cr} = await supabase.from('v2_camas')
                                .select('id_cama,habitacion_id,estado').in('id_cama',[...camasRot]);
                            camasRotRows = (cr||[]).map(c => ({...c, _rot:true}));
                        }

                        const camasLibres = [
                            ...todasCamas.filter(c => !asigOcup.has(String(c.id_cama))),
                            ...camasRotRows
                        ];

                        // ── Habitaciones (números legibles) ───────────────────
                        let todasHabs2 = [], hp2 = 0;
                        while(true) {
                            const {data:hh} = await supabase.from('v2_habitaciones')
                                .select('id_custom,numero_hab').range(hp2*1000, hp2*1000+999);
                            if(!hh?.length) break;
                            todasHabs2 = todasHabs2.concat(hh);
                            if(hh.length < 1000) break;
                            hp2++;
                        }
                        const habIdx2 = {};
                        for(const h of todasHabs2) if(h.id_custom) habIdx2[h.id_custom] = h.numero_hab;

                        // ── Mapa de camas libres: { id_cama → {habitacion_id, numHab, edificio, pabellon, searchText, rot} }
                        const camasMapa = {};
                        for(const c of camasLibres) {
                            const hid = c.habitacion_id;
                            const numHab = String(habIdx2[hid] || hid).trim();
                            const edificio = hid.startsWith('R-220') ? 'R-220' : 'COPC';
                            const pabellon = numHab.match(/^(\d{2})/)?.[1] || '?';
                            let piso = '';
                            if(hid.startsWith('R-220')) {
                                const m = hid.match(/[Pp](?:iso)?[\s\-]?(\d)/i) || numHab.match(/[Pp](\d)/);
                                piso = m ? 'P' + m[1] : '';
                            }
                            const searchText = [edificio, pabellon, numHab, piso, hid].join(' ').toLowerCase();
                            camasMapa[String(c.id_cama)] = { hid, numHab, edificio, pabellon, piso, searchText, rot: !!c._rot };
                        }

                        // ── Función para obtener camas filtradas por query ────
                        function camasFiltradas(query) {
                            const q = (query||'').toLowerCase().trim();
                            return Object.entries(camasMapa)
                                .filter(([,info]) => !q || info.searchText.includes(q))
                                .sort(([,a],[,b]) => {
                                    if(a.edificio !== b.edificio) return a.edificio.localeCompare(b.edificio);
                                    return Number(a.numHab) - Number(b.numHab);
                                });
                        }

                        // ── Asignar cama desde modal ──────────────────────────
                        window._modalAsignar = async (rowId, camaId, nombre, btnEl) => {
                            if(!confirm(`¿Asignar cama ${camaId} a ${nombre}?`)) return;
                            btnEl.disabled = true;
                            btnEl.textContent = '⏳';
                            try {
                                const {data:sol} = await supabase.from('v2_solicitudes_b2b')
                                    .select('*').eq('id', rowId).single();
                                if(!sol) throw new Error('Solicitud no encontrada');
                                const {data:empRows} = await supabase.from('v2_empresas')
                                    .select('id').ilike('nombre', sol.empresa||'').limit(1);
                                const empresaId2 = empRows?.[0]?.id || null;
                                const {error:eA} = await supabase.from('v2_asignaciones').insert({
                                    id_cama: camaId,
                                    rut_huesped: (sol.rut_trabajador || '').slice(0, 12),
                                    nombre_huesped: sol.nombre_trabajador || sol.rut_trabajador,
                                    empresa_id: empresaId2,
                                    fecha_checkin: sol.fecha_llegada || new Date().toISOString().split('T')[0],
                                    fecha_salida_programada: sol.fecha_salida || null,
                                    fecha_checkout: null,
                                    numero_contrato: sol.n_contrato || null
                                });
                                if(eA) throw new Error(eA.message);
                                await supabase.from('v2_camas').update({estado:'Ocupada'}).eq('id_cama', camaId);
                                await supabase.from('v2_solicitudes_b2b')
                                    .update({status:'aceptada'}).eq('id', rowId);
                                if(sol.n_contrato) await _ajustarCupo(sol.n_contrato, +1);

                                // Quitar al trabajador del modal
                                const card = document.getElementById('sinA-card-' + rowId);
                                if(card) {
                                    card.style.transition = 'opacity .3s';
                                    card.style.opacity = '0';
                                    setTimeout(() => card.remove(), 300);
                                }
                                // Si no quedan trabajadores, cerrar modal
                                setTimeout(() => {
                                    const remaining = document.querySelectorAll('[id^="sinA-card-"]');
                                    if(!remaining.length) {
                                        document.getElementById('modal-sinasignar')?.remove();
                                        toast('✅ Todos asignados', 'success');
                                    }
                                }, 400);
                                // Quitar la cama del mapa para que no se ofrezca de nuevo
                                delete camasMapa[String(camaId)];
                                window._renderV2Solicitudes?.();
                                refreshBadge();
                            } catch(e) {
                                btnEl.disabled = false;
                                btnEl.textContent = '🛏 ' + camaId;
                                alert('❌ Error: ' + e.message);
                            }
                        };

                        // ── Renderizar grillas por trabajador ─────────────────
                        function renderGrillas(query) {
                            const filtradas = camasFiltradas(query);
                            sinA.forEach(s => {
                                const grid = document.getElementById('sinA-grid-' + s.rowId);
                                if(!grid) return;
                                if(!filtradas.length) {
                                    grid.innerHTML = `<div style="color:#94a3b8;font-size:11px;padding:4px 0">Sin camas con ese filtro</div>`;
                                    return;
                                }
                                // Mostrar máx. 20 camas para no sobrecargar
                                grid.innerHTML = filtradas.slice(0, 20).map(([cId, info]) => {
                                    const rotBadge = info.rot ? ' 🔄' : '';
                                    const pisoLabel = info.piso ? ` ${info.piso}` : '';
                                    return `<button
                                        onclick="window._modalAsignar('${s.rowId}','${cId}','${s.nombre.replace(/'/g,"\\'")}',this)"
                                        title="${info.edificio} · Pab.${info.pabellon}${pisoLabel} · Hab.${info.numHab}${rotBadge}"
                                        style="padding:4px 8px;border:none;border-radius:6px;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;font-weight:700;font-size:11px;cursor:pointer;margin:2px;transition:transform .1s"
                                        onmouseover="this.style.transform='scale(1.06)'" onmouseout="this.style.transform=''">
                                        🛏 ${cId}<span style="font-size:9px;opacity:.8"> Hab.${info.numHab}${pisoLabel}</span>
                                    </button>`;
                                }).join('') + (filtradas.length > 20 ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px">+${filtradas.length-20} más — refina la búsqueda</div>` : '');
                            });
                        }

                        // ── HTML final del modal ──────────────────────────────
                        const listHTML = sinA.map(s => `
                            <div id="sinA-card-${s.rowId}" style="background:#fff;border:1.5px solid #fed7aa;border-radius:12px;padding:14px 16px;margin-bottom:10px">
                                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;margin-bottom:8px">
                                    <div>
                                        <div style="font-weight:800;font-size:14px;color:#1e293b">👤 ${s.nombre}</div>
                                        <div style="font-size:11px;color:#64748b">${s.rut||'—'}</div>
                                        <div style="font-size:12px;color:#b45309;margin-top:3px">❌ ${s.razon}</div>
                                    </div>
                                </div>
                                <div id="sinA-grid-${s.rowId}" style="display:flex;flex-wrap:wrap;gap:3px;min-height:28px">
                                    <div style="color:#94a3b8;font-size:11px">Cargando…</div>
                                </div>
                            </div>`).join('');

                        modal.innerHTML = `
                            <div style="background:#f8fafc;border-radius:16px;padding:22px;max-width:680px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.28)">
                                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                                    <div style="font-size:26px">⚠️</div>
                                    <div style="flex:1">
                                        <div style="font-weight:900;font-size:15px;color:#0f172a">Trabajadores sin asignar — ${res.empresa}</div>
                                        <div style="font-size:12px;color:#64748b">✅ ${res.asignados} asignados · ⏸ ${sinA.length} pendientes · Fecha llegada: <b>${fechaLlegada}</b></div>
                                    </div>
                                    <button onclick="document.getElementById('modal-sinasignar').remove();window._renderV2Solicitudes?.();refreshBadge();"
                                        style="border:none;background:#fee2e2;color:#b91c1c;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:700">✕</button>
                                </div>

                                <!-- Buscador global de camas -->
                                <div style="margin-bottom:12px">
                                    <input id="sinA-buscar" type="text"
                                        placeholder="🔎 Filtrar camas por edificio, pabellón, piso… ej: R-220, Piso 2, 43"
                                        oninput="window._sinABuscar(this.value)"
                                        style="width:100%;box-sizing:border-box;padding:9px 14px;border:2px solid #c4b5fd;border-radius:10px;font-size:13px;font-weight:600;color:#4c1d95;outline:none;transition:border-color .2s"
                                        onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor='#c4b5fd'">
                                    <div style="font-size:10px;color:#94a3b8;margin-top:4px">
                                        💡 Las mismas camas se ofrecen para cada trabajador · Camas con 🔄 = disponibles por rotación de turno
                                    </div>
                                </div>

                                <!-- Lista de trabajadores con sus camas -->
                                <div style="overflow-y:auto;flex:1;padding-right:4px">${listHTML}</div>

                                <div style="font-size:11px;color:#94a3b8;margin-top:12px;text-align:center">
                                    Los trabajadores sin asignar quedan como <b>Pendientes</b> para reasignación posterior
                                </div>
                            </div>`;

                        window._sinABuscar = (q) => renderGrillas(q);
                        renderGrillas(''); // render inicial
                        setTimeout(() => document.getElementById('sinA-buscar')?.focus(), 100);

                    } catch(err) {
                        modal.innerHTML = `<div style="background:#fff;border-radius:16px;padding:32px;color:#ef4444;font-weight:700;max-width:400px">
                            ❌ Error al cargar camas: ${err.message}
                            <br><br><button onclick="document.getElementById('modal-sinasignar').remove()" style="padding:8px 16px;border:none;border-radius:8px;background:#fee2e2;color:#b91c1c;cursor:pointer;font-weight:700">Cerrar</button>
                        </div>`;
                    }
                })();

            } else {
                // Sin problemas → toast simple
                const edifInfo = res.edificios ? ` · ${res.edificios}` : '';
                toast(`✅ ${res.asignados} asignados${edifInfo}`,'success');
                window._renderV2Solicitudes?.();
                refreshBadge();
            }

            // Aunque haya sinAsignar, recargar para que aparezcan en Pendientes
            if(sinA.length === 0) return;
            window._renderV2Solicitudes?.();
            refreshBadge();
        }).catch(e=>{ overlay.remove(); toast('🚨 '+e.message,'error'); });
    };
    window._solRechazarGrupo = ids => rechazarGrupo(ids);

    // ── Botón "Cargas con Habitación" → abre Panel de Dotación embebido ────
    window._solCargarExcelConHab = function() {
        window._solTab('conhab');
    };

    window._solProcesarExcelConHab = async function(inputEl) {
        const file = inputEl?.files?.[0];
        if(!file) return;

        if(!window.XLSX) {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = '/js/xlsx.full.min.js';  // copia local — sin dependencia de red
                s.onload = res;
                s.onerror = () => rej(new Error('No se pudo cargar la librería Excel. Verifica que el archivo /js/xlsx.full.min.js exista en el proyecto.'));
                document.head.appendChild(s);
            });
        }

        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
        ov.innerHTML = `<div style="background:#fff;border-radius:20px;padding:36px 44px;text-align:center;min-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
            <div style="font-size:44px;margin-bottom:14px">📂</div>
            <div style="font-weight:900;font-size:17px;margin-bottom:10px;color:#0f172a">Cargas con Habitación</div>
            <div id="_chab_step" style="font-size:13px;color:#64748b;min-height:20px;margin-bottom:6px">Leyendo archivo...</div>
            <div id="_chab_detail" style="font-size:11px;color:#94a3b8;min-height:16px"></div>
        </div>`;
        document.body.appendChild(ov);
        const step   = t => { const el=document.getElementById('_chab_step');   if(el) el.textContent=t; };
        const detail = t => { const el=document.getElementById('_chab_detail'); if(el) el.textContent=t; };

        try {
            const buf = await file.arrayBuffer();
            const wb  = XLSX.read(buf, { type:'array', cellDates:true });
            const ws  = wb.Sheets[wb.SheetNames[0]];

            // ── Auto-detectar la fila de cabeceras real ───────────────────────────
            // El Excel de Aramark/Hualpén tiene 1-3 filas de título antes de los headers reales.
            // Leemos como array de arrays y buscamos la primera fila con palabras clave conocidas.
            const allRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
            if(!allRows.length) throw new Error('El archivo está vacío.');

            const norm0 = s => String(s).toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                .replace(/[^a-z0-9]/g,'');

            // Palabras clave — se busca la fila con MÁS coincidencias (no solo la primera con ≥2)
            // Las keywords de alta especificidad (que no suelen aparecer en instrucciones) tienen más peso
            const HEADER_KEYWORDS = ['hab','habitacion','nombre','empresa','rut','run','pt','fecha','gerencia','contrato','tipo','llegada','salida','checkin','checkout'];
            let headerRowIdx = -1;
            let bestHits = 1; // requiere al menos 2
            for(let i=0; i < Math.min(20, allRows.length); i++) {
                const rowNorm = allRows[i].map(c => norm0(String(c)));
                const hits = HEADER_KEYWORDS.filter(kw => rowNorm.some(c => c.includes(kw))).length;
                if(hits > bestHits) { bestHits = hits; headerRowIdx = i; }
            }
            if(headerRowIdx === -1) throw new Error(
                'No se encontró la fila de cabeceras en las primeras 20 filas del Excel.\n' +
                'Asegúrate de que el archivo tenga una fila con: NOMBRE, HAB, EMPRESA, FECHA, etc.'
            );

            const headers = allRows[headerRowIdx].map(h => String(h).trim());
            // Construir raw como array de objetos usando los headers encontrados
            const raw = [];
            for(let i = headerRowIdx + 1; i < allRows.length; i++) {
                const rowArr = allRows[i];
                // Ignorar filas completamente vacías
                if(rowArr.every(c => !String(c).trim())) continue;
                const obj = {};
                headers.forEach((h, ci) => { obj[h] = rowArr[ci] ?? ''; });
                raw.push(obj);
            }
            if(!raw.length) throw new Error('No hay filas de datos después de los encabezados.');

            step(`${raw.length} filas de datos (cabeceras en fila ${headerRowIdx+1})...`);


            // Detector flexible: normaliza espacios, tildes y mayúsculas (reutiliza norm0)
            const norm = norm0;

            const fc = (...cands) => headers.find(h =>
                cands.some(c => norm(h).includes(norm(c))));

            // ── Nombre: puede venir en columna única o dividida ──────────────────
            const cNomCompleto = fc('nombrecomp','nombretrab','nombre_comp','nombre_trab','nombre trabajador','nombres y apellidos','huesped','completo');
            const cNomSolo     = fc('nombre','name','nombres');
            const cApePat      = fc('apellidopat','apellidop','apepat','paterno','apellido1','primerape');
            const cApeMat      = fc('apellidomat','apellidom','apemat','materno','apellido2','segundoape');
            const cApeSolo     = fc('apellido'); // si hay solo una col de apellido
            // RUT — puede venir como PT, RUT, RUN, DNI, CEDULA, ID, EMPLOYEE...
            const cRut = fc('rut','run','dni','cedula','identificacion','id trabajador','pt','employee','empid','cod trab','num trab','id trab','nro trab','numero trab','ut','folio','nro trabajador','num trabajador');
            // Empresa
            const cEmp = fc('empresa','company','contratista','razon social','razon_social','cliente');
            // Superintendencia — alias múltiple para compatibilidad con plantillas antiguas y nuevas
            const cSuperint = fc('superintendencia','super intendencia','suptcia','supintend','superint');
            // Gerencia
            const cGer = fc('gerencia','area','unidad','departamento','gcia');
            // Contrato
            const cCon = fc('contrato','ncontrato','nro contrato','num contrato','numcontrato','n contrato','nrocontrato','contract','cod contrato');
            // Habitación (la más importante)
            const cHab = fc('hab','habitacion','room','pieza','numero hab','nro hab','num hab','cama','bed','cod hab','codhabitacion','n hab','nro habitacion','num habitacion','pza','depto','dormitorio','n pza','pza n','hab n','n de hab','nhabitacion','nhab','nrode habitacion','numerode habitacion','n de habitacion','pabellon','pabel','sector','nro.','numero de habitacion','hab num','hab_num','habitacion num','n habitacion','nrohabitacion','numerohab','nrodehab','numerodehab');
            // Fechas — FECHA INI / FECHA TERM son los nombres exactos del Excel Aramark/Hualpen
            const cLle = fc('llegada','checkin','ingreso','inicio','fecha llegada','fechallegada','entrada','desde','fecha inicio','ini','fechaini','fecha ini');
            const cSal = fc('salida','checkout','termino','fin','fecha salida','fechasalida','hasta','fecha fin','fecha termino','term','fechaterm','fecha term');
            // Género: por nombre de columna O por posición P (columna 16, índice 15)
            const cGen = fc('genero','sexo','gender','sex','sexo trab') ||
                         (headers.length > 15 ? headers[15] : null); // columna P
            // Turno Día/Noche: por nombre de columna O por posición L (columna 12, índice 11)
            const cTipo = fc('tipo','tipoturno','tipo turno','jornada','shift','turno dia','turno noche','dia noche','d n') ||
                          (headers.length > 11 ? headers[11] : null); // columna L

            // ── Validaciones con mensaje informativo ────────────────────────────
            const tieneNombre = !!(cNomCompleto || cNomSolo || cApePat || cApeSolo);
            const tieneRut    = !!cRut;

            if(!tieneNombre && !tieneRut) {
                const colsList = headers.slice(0,10).join(', ');
                throw new Error(
                    `No se encontró columna de Nombre ni RUT.\n\n` +
                    `Columnas encontradas en tu Excel:\n${colsList}${headers.length>10?` … (+${headers.length-10} más)`:''}\n\n` +
                    `Se busca: NOMBRE, NOMBRES, APELLIDO PATERNO, RUT, RUN…`
                );
            }
            if(!cHab) {
                const colsList = headers.join(', ');
                // No lanzar error — advertir y continuar sin asignación de hab (motor auto-asigna)
                detail(`⚠️ No se encontró columna de Habitación. Se cargará sin hab. asignada para que el motor la busque automáticamente.\nColumnas encontradas: ${colsList}`);
            }

            detail(`Columnas detectadas: ${[cRut&&`RUT(${cRut})`,tieneNombre&&'Nombre',cHab&&`Hab(${cHab})`,cGen&&`Género(${cGen})`,cTipo&&`Turno(${cTipo})`,cLle&&`Llegada(${cLle})`,cSal&&`Salida(${cSal})`].filter(Boolean).join(', ')}`);

            const hoy = new Date().toISOString().split('T')[0];
            function parseFecha(v) {
                if(!v) return null;
                if(v instanceof Date) return v.toISOString().split('T')[0];
                const s = String(v).trim();
                // Formato YYYY-MM-DD (ISO) — usar directamente
                if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return s.substring(0,10);
                // Número serial de Excel
                const n = parseFloat(s);
                if(!isNaN(n) && n > 40000 && !/[\/\-]/.test(s))
                    return new Date(Date.UTC(1899,11,30)+n*864e5).toISOString().split('T')[0];
                // Formato con separadores: puede ser DD/MM/YYYY o MM/DD/YYYY
                const dm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
                if(dm) {
                    let day = parseInt(dm[1], 10);
                    let mon = parseInt(dm[2], 10);
                    const yr  = dm[3].length===2 ? 2000+parseInt(dm[3],10) : parseInt(dm[3],10);
                    // Si dm[1] > 12 → definitivamente es el día (formato europeo DD/MM)
                    // Si dm[2] > 12 → definitivamente es el mes al revés → dm[1] es el mes (formato americano MM/DD)
                    if(day > 12 && mon <= 12) {
                        // europeo DD/MM — ya tenemos day y mon correctos
                    } else if(mon > 12 && day <= 12) {
                        // americano MM/DD → dm[1] es mes, dm[2] es día
                        [day, mon] = [mon, day];
                    }
                    // Validar rango final
                    if(mon < 1 || mon > 12 || day < 1 || day > 31) return null;
                    return `${yr}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                }
                return null;
            }

            function parseTurno(v) {
                if(!v) return null;
                const s = norm(String(v));
                if(s.includes('noche') || s.includes('night') || s==='n') return 'Turno Noche';
                if(s.includes('dia') || s.includes('day') || s==='d') return 'Turno Día';
                return String(v).trim() || null; // devolver el valor tal cual si no reconoce
            }

            const registros = []; let sinHab=0;
            for(const row of raw) {
                // Construir nombre: prioridad a columna única, luego concatenar partes
                let nom = '';
                if(cNomCompleto) {
                    nom = String(row[cNomCompleto]||'').trim();
                } else {
                    const ap  = cApePat ? String(row[cApePat]||'').trim() : '';
                    const am  = cApeMat ? String(row[cApeMat]||'').trim() : '';
                    const ap2 = cApeSolo && !cApePat ? String(row[cApeSolo]||'').trim() : '';
                    const nm  = cNomSolo ? String(row[cNomSolo]||'').trim() : '';
                    // Formato chileno: APELLIDO PATERNO APELLIDO MATERNO NOMBRES
                    nom = [ap, am||ap2, nm].filter(Boolean).join(' ').trim();
                }

                const rut  = String(row[cRut]||'').replace(/[.\-\s]/g,'').trim().toUpperCase();
                const emp  = String(row[cEmp]||'').trim();
                const ger  = cGer ? String(row[cGer]||'').trim() : '';
                const con  = cCon ? String(row[cCon]||'').trim() : '';
                const hab  = cHab ? (String(row[cHab]||'').replace(/[\s.,]/g,'').trim() || null) : null;
                const lle  = parseFecha(cLle ? row[cLle] : null) || hoy;
                const sal  = parseFecha(cSal ? row[cSal] : null) || null;
                const gR   = cGen  ? String(row[cGen]||'').trim().toUpperCase() : '';
                const gen  = gR.startsWith('F')?'F':gR.startsWith('M')?'M':
                             gR==='1'?'F':gR==='2'?'M':null;  // algunos Excel usan 1=F, 2=M
                const tipoRaw = cTipo ? String(row[cTipo]||'').trim() : '';
                const tipo = parseTurno(tipoRaw);

                if(!nom && !rut) continue;
                if(!hab) sinHab++; // no hab → sigue (hab_solicitada quedará null → motor auto-asigna)

                // Extraer el nombre de la empresa DESDE EL NOMBRE DEL ARCHIVO (quitando la extensión)
                // como regla de negocio obligatoria.
                const empresaDesdeArchivo = file.name.replace(/\.[^/.]+$/, "").trim();

                // ── Turno de sistema (columna J: 7x7, 4x3, 14x14…) ──────────────
                // Diferente a cTipo (columna L: Día/Noche). Columna J = índice 9.
                const cSistTurno = fc('sistema','sistema turno','sistematurno','turno sistema','s turno','shift system','turno') ||
                                   (headers.length > 9 ? headers[9] : null); // columna J
                const sistTurnoRaw = cSistTurno ? String(row[cSistTurno]||'').trim() : '';
                // Normalizar: "7 x 7" → "7x7", mantener mayúsculas
                const sistTurno = sistTurnoRaw.replace(/\s*x\s*/gi, 'x').trim() || null;

                // Superintendencia del Excel
                const superint = cSuperint ? String(row[cSuperint]||'').trim() : '';

                registros.push({
                    empresa:           empresaDesdeArchivo || emp || 'Sin empresa',
                    nombre_trabajador: nom||rut,
                    rut_trabajador:    rut||null,
                    genero:            gen,
                    turno:             sistTurno || tipo,  // Prioriza sistema (7x7) sobre día/noche
                    n_contrato:        con||null,
                    gerencia:          ger||null,
                    origen:            superint||null,  // superintendencia → columna libre 'origen' en Supabase
                    hab_solicitada:    hab,
                    fecha_llegada:     lle,
                    fecha_salida:      sal,
                    status:            'pendiente',
                });
            }
            if(!registros.length) throw new Error('No se extrajeron filas válidas. Revisa que el archivo tenga datos y habitaciones asignadas.');



            step(`Subiendo ${registros.length} trabajadores...`);

            let insertedIds=[];
            for(let i=0; i<registros.length; i+=200) {
                const lote=registros.slice(i,i+200);
                const {data:ins,error:eI}=await supabase.from('v2_solicitudes_b2b').insert(lote).select('id,empresa,n_contrato');
                if(eI) throw new Error('Error BD: '+eI.message);
                if(ins) insertedIds=insertedIds.concat(ins);
                detail(`${Math.min(i+200,registros.length)} / ${registros.length} guardados`);
            }

            step('Ejecutando motor de asignación...');
            detail('');
            let fullRows=[];
            const allIds=insertedIds.map(r=>r.id);
            for(let i=0; i<allIds.length; i+=500) {
                const {data:fr}=await supabase.from('v2_solicitudes_b2b').select('*').in('id',allIds.slice(i,i+500));
                if(fr) fullRows=fullRows.concat(fr);
            }

            const gruposM={};
            for(const r of fullRows) {
                const k=(r.empresa||'')+'|'+(r.n_contrato||'sin-c');
                if(!gruposM[k]) gruposM[k]=[];
                gruposM[k].push(r);
            }

            const resultados=[]; let empN=0;
            for(const [k,rows] of Object.entries(gruposM)) {
                const empNombre=rows[0]?.empresa||k;
                empN++;
                step(`Asignando (${empN}/${Object.keys(gruposM).length}): ${empNombre}`);
                detail(`${rows.length} trabajadores`);
                try { const res=await ejecutarGrupo(rows); resultados.push({empresa:empNombre,...res,total:rows.length}); }
                catch(eM) { resultados.push({empresa:empNombre,ok:false,msg:eM.message,total:rows.length}); }
            }

            ov.remove();

            const totalAsig=resultados.reduce((s,r)=>s+(r.asignados||0),0);
            const totalFall=resultados.reduce((s,r)=>s+(r.fallidos?.length||0),0);
            const totalPreCO=resultados.reduce((s,r)=>s+(r.preCheckout||0),0);
            const resHTML=resultados.map(r=>{
                const col=r.ok?'#15803d':'#b91c1c', bg=r.ok?'#dcfce7':'#fee2e2', ico=r.ok?'✅':'❌';
                return `<div style="display:flex;justify-content:space-between;padding:8px 12px;background:${bg};border-radius:8px;margin-bottom:6px">
                    <span style="font-weight:700;font-size:13px;color:${col}">${ico} ${r.empresa}</span>
                    <span style="font-size:12px;font-weight:700;color:${col}">${r.ok?`${r.asignados}/${r.total} asignados`:r.msg}</span></div>`;
            }).join('');

            const modal=document.createElement('div');
            modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
            modal.innerHTML=`<div style="background:#fff;border-radius:20px;padding:28px 32px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.28)">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
                    <div style="font-size:36px">📂</div>
                    <div><div style="font-weight:900;font-size:17px;color:#0f172a">Carga completada</div>
                    <div style="font-size:12px;color:#64748b;margin-top:3px">✅ ${totalAsig} asignados${totalPreCO>0?` · 🔄 ${totalPreCO} check-out automático`:''}${totalFall>0?` · ⚠️ ${totalFall} sin cama`:''}${sinHab>0?` · ℹ️ ${sinHab} omitidas`:''}</div></div>
                </div>
                <div style="max-height:260px;overflow-y:auto;margin-bottom:16px">${resHTML}</div>
                <button onclick="this.closest('[style*=fixed]').remove();window._solTab('history')"
                    style="width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#15803d,#22c55e);color:#fff;font-weight:900;font-size:14px;cursor:pointer">
                    📋 Ver en Historial
                </button></div>`;
            document.body.appendChild(modal);
            refreshBadge();
            setTimeout(()=>window._solTab?.('history'),200);

        } catch(e) {
            ov.remove();
            alert('❌ Error al procesar la carga:\n'+e.message);
        }
    };

    await renderTab('pending');
}

async function renderTab(tab) {
    document.getElementById('tab-pending')?.classList.toggle('active', tab === 'pending');
    document.getElementById('tab-history')?.classList.toggle('active', tab === 'history');
    document.getElementById('tab-conhab')?.classList.toggle('active', tab === 'conhab');
    const body = document.getElementById('sol-body');
    if (!body) return;

    // ── TAB: Panel de Dotación embebido ─────────────────────────────────────────
    if (tab === 'conhab') {
        body.innerHTML = `
            <div style="border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);border:1px solid #e2e8f0">
                <iframe
                    id="dotacion-iframe"
                    src="panel-dotacion.html"
                    style="width:100%;height:calc(100vh - 240px);min-height:600px;border:none;display:block;border-radius:16px"
                    allow="clipboard-read; clipboard-write"
                    title="Panel de Dotación">
                </iframe>
            </div>`;
        return;
    }

    body.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8"><div style="font-size:36px">⏳</div><div>Cargando…</div></div>`;

    try {
        let reqs;
        if (tab === 'pending') {
            const { data, error } = await supabase
                .from('v2_solicitudes_b2b')
                .select('*')
                .eq('status', 'pendiente')
                .order('empresa')
                .order('created_at', { ascending: false });
            if (error) throw error;
            reqs = data || [];

            // ── Filtrar trabajadores que YA tienen asignación activa ───────────
            // Si un rut tiene cama en v2_asignaciones (fecha_checkout null),
            // ya no debe aparecer en Pendientes → actualizar status y excluirlo.
            if (reqs.length > 0) {
                const normRut = r => String(r || '').replace(/[.\-\s]/g, '').toUpperCase();
                const rutsPend = [...new Set(reqs.map(r => normRut(r.rut_trabajador)).filter(Boolean))];

                // Consultar en lotes de 200 para no exceder URL length
                const LOTE = 200;
                const rutsAsignados = new Set();
                for (let i = 0; i < rutsPend.length; i += LOTE) {
                    const lote = rutsPend.slice(i, i + LOTE);
                    const { data: asigs } = await supabase
                        .from('v2_asignaciones')
                        .select('rut_huesped')
                        .in('rut_huesped', lote)
                        .is('fecha_checkout', null)
                        .in('estado_asignacion', ['activa', 'pre_asignado']);
                    (asigs || []).forEach(a => rutsAsignados.add(normRut(a.rut_huesped)));
                }

                if (rutsAsignados.size > 0) {
                    // IDs a actualizar en DB (silencioso, en background)
                    const idsActualizar = reqs
                        .filter(r => rutsAsignados.has(normRut(r.rut_trabajador)))
                        .map(r => r.id);

                    if (idsActualizar.length > 0) {
                        // Actualizar en lotes de 200
                        for (let i = 0; i < idsActualizar.length; i += 200) {
                            supabase.from('v2_solicitudes_b2b')
                                .update({ status: 'aceptada_asignada' })
                                .in('id', idsActualizar.slice(i, i + 200))
                                .then(() => {});  // sin await — no bloquear UI
                        }
                        console.log(`[Pendientes] ✅ ${idsActualizar.length} solicitudes ya asignadas → actualizadas a 'aceptada_asignada'`);
                    }

                    // Excluir del display inmediatamente
                    reqs = reqs.filter(r => !rutsAsignados.has(normRut(r.rut_trabajador)));
                }
            }

        } else {
            // Historial: paginación completa sin límite
            const PAGE = 900;
            let offset = 0;
            reqs = [];
            while (true) {
                const { data, error } = await supabase
                    .from('v2_solicitudes_b2b')
                    .select('*')
                    .neq('status', 'pendiente')
                    .order('created_at', { ascending: false })
                    .range(offset, offset + PAGE - 1);
                if (error) throw error;
                if (!data || !data.length) break;
                reqs = reqs.concat(data);
                if (data.length < PAGE) break;
                offset += PAGE;
            }
        }
        const error = null; // compat


        // KPIs solo en pestaña pendientes
        if(tab==='pending') {
            const hoy=new Date().toISOString().split('T')[0];
            const empresas=[...new Set((reqs||[]).map(r=>r.empresa).filter(Boolean))];
            const kpis=document.getElementById('sol-kpis');
            if(kpis) kpis.innerHTML=[
                {icon:'⏳',lbl:'Pendientes',val:(reqs||[]).length,c:'#f59e0b'},
                {icon:'🏢',lbl:'Empresas',val:empresas.length,c:'#6366f1'},
                {icon:'📅',lbl:'Hoy',val:(reqs||[]).filter(r=>r.created_at?.startsWith(hoy)).length,c:'#0ea5e9'},
                {icon:'🏠',lbl:'Con Hab.',val:(reqs||[]).filter(r=>r.hab_solicitada).length,c:'#16a34a'},
            ].map(k=>`<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 6px rgba(0,0,0,.07);border:1px solid #e2e8f0">
                <div style="font-size:20px;margin-bottom:4px">${k.icon}</div>
                <div style="font-size:26px;font-weight:900;color:${k.c}">${k.val}</div>
                <div style="font-size:11px;color:#64748b;font-weight:600">${k.lbl}</div>
            </div>`).join('');
            const cnt=document.getElementById('tab-cnt');
            if(cnt) cnt.textContent=(reqs||[]).length>0?`(${reqs.length})`:'';
        }

        if(!reqs||reqs.length===0) {
            body.innerHTML=`<div style="text-align:center;color:#94a3b8;padding:60px;background:#fff;border-radius:16px;border:2px dashed #e2e8f0">
                <div style="font-size:52px;margin-bottom:12px">${tab==='pending'?'🎉':'📭'}</div>
                <div style="font-size:17px;font-weight:800;color:#475569">${tab==='pending'?'¡Sin solicitudes pendientes!':'Sin historial registrado'}</div>
            </div>`; return;
        }

        if(tab==='pending') {
            // ── Agrupar por CARGA: empresa + contrato + gerencia + fecha_llegada + fecha_salida
            // Regla: misma empresa con mismo contrato Y gerencia Y mismas fechas = misma lista.
            // Distinto contrato, gerencia o fechas = listas separadas.
            const grupos={};
            for(const r of reqs) {
                const key=(r.empresa||'Sin empresa')+'||'+(r.n_contrato||'')+'||'+(r.gerencia||'')+'||'+(r.fecha_llegada||'')+'||'+(r.fecha_salida||'');
                if(!grupos[key]) grupos[key]=[];
                grupos[key].push(r);
            }
            body.innerHTML=Object.values(grupos)
                .sort((a,b)=>{
                    const ec=(a[0]?.empresa||'').localeCompare(b[0]?.empresa||'');
                    if(ec!==0) return ec;
                    return (a[0]?.fecha_llegada||'').localeCompare(b[0]?.fecha_llegada||'');
                })
                .map(rows=>grupoCardHTML(rows[0]?.empresa||'Sin empresa', rows))
                .join('');
        } else {
            // HISTORIAL: agrupado por empresa + contrato + fecha_llegada + fecha_salida
            // Dos cargas de la misma empresa con fechas distintas = tarjetas separadas
            const hoy2 = new Date().toISOString().split('T')[0];
            const grupos={};
            for(const r of reqs) {
                const key=(r.empresa||'Sin empresa')+'||'+(r.n_contrato||'')+'||'+(r.gerencia||'')+'||'+(r.fecha_llegada||'sin-llegada')+'||'+(r.fecha_salida||'sin-salida');
                if(!grupos[key]) grupos[key]={
                    empresa:  r.empresa||'Sin empresa',
                    contrato: r.n_contrato||null,
                    gerencia: r.gerencia||null,
                    fechaIn:  r.fecha_llegada||null,
                    fechaOut: r.fecha_salida||null,
                    status:   r.status,
                    rows:[]
                };
                grupos[key].rows.push(r);
                if(r.fecha_llegada&&(!grupos[key].fechaIn||r.fecha_llegada<grupos[key].fechaIn)) grupos[key].fechaIn=r.fecha_llegada;
                if(r.fecha_salida&&(!grupos[key].fechaOut||r.fecha_salida>grupos[key].fechaOut)) grupos[key].fechaOut=r.fecha_salida;
            }

            // Determinar status del grupo y de-duplicar trabajadores
            for (const key in grupos) {
                const g = grupos[key];
                
                // Priorizar status 'aceptada' > 'finalizado' > otros
                if (g.rows.some(r => r.status === 'aceptada')) {
                    g.status = 'aceptada';
                } else if (g.rows.some(r => r.status === 'finalizado')) {
                    g.status = 'finalizado';
                } else {
                    g.status = g.rows[0]?.status || 'aceptada';
                }

                // De-duplicar por trabajador
                const uniqueRows = {};
                for (const r of g.rows) {
                    const workerKey = r.rut_trabajador || r.nombre_trabajador;
                    const existing = uniqueRows[workerKey];
                    if (!existing) {
                        uniqueRows[workerKey] = r;
                    } else {
                        const priority = { 'aceptada': 3, 'finalizado': 2, 'pendiente': 1 };
                        const getPrio = status => priority[status] || 0;
                        if (getPrio(r.status) > getPrio(existing.status)) {
                            uniqueRows[workerKey] = r;
                        }
                    }
                }
                g.rows = Object.values(uniqueRows);
            }

            // Guardar todos los grupos, orden por defecto: más reciente
            window._histGrupos = Object.values(grupos);
            window._histSortAsc = false; // más reciente primero por defecto

            const empresasUnicas = [...new Set(window._histGrupos.map(g=>g.empresa))].sort();
            body.innerHTML = `
            <div id="hist-filters" style="background:#fff;border:1.5px solid #e2e8f0;border-radius:16px;padding:16px 20px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
              <div style="flex:1;min-width:180px">
                <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:5px;text-transform:uppercase">🏢 Empresa</div>
                <input id="hf-empresa" list="hf-emp-list" placeholder="Filtrar empresa…" oninput="window._aplicarFiltroHist()"
                  style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;font-weight:600;color:#0f172a;outline:none;box-sizing:border-box"
                  onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'">
                <datalist id="hf-emp-list">${empresasUnicas.map(e=>`<option value="${e}">`).join('')}</datalist>
              </div>
              <div style="min-width:140px">
                <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:5px;text-transform:uppercase">📅 Desde</div>
                <input id="hf-desde" type="date" onchange="window._aplicarFiltroHist()"
                  style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;color:#0f172a;outline:none;box-sizing:border-box"
                  onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'">
              </div>
              <div style="min-width:140px">
                <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:5px;text-transform:uppercase">📅 Hasta</div>
                <input id="hf-hasta" type="date" onchange="window._aplicarFiltroHist()"
                  style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;color:#0f172a;outline:none;box-sizing:border-box"
                  onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'">
              </div>
              <div style="min-width:140px">
                <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:5px;text-transform:uppercase">✅ Estado</div>
                <select id="hf-status" onchange="window._aplicarFiltroHist()"
                  style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;font-weight:600;color:#0f172a;background:#fff;outline:none;cursor:pointer;box-sizing:border-box">
                  <option value="">Todos</option>
                  <option value="aceptada">✅ Aceptadas</option>
                  <option value="rechazada">❌ Rechazadas</option>
                  <option value="finalizado">📦 Finalizadas</option>
                </select>
              </div>
              <div style="min-width:130px">
                <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:5px;text-transform:uppercase">🔃 Orden</div>
                <button id="hf-sort-btn" onclick="window._toggleSortHist()"
                  style="width:100%;padding:9px 12px;border:1.5px solid #6366f1;border-radius:10px;font-size:12px;font-weight:700;color:#6366f1;background:#eff6ff;cursor:pointer;box-sizing:border-box">
                  ⬇️ Más reciente
                </button>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
                <button onclick="window._limpiarFiltroHist()"
                  style="padding:9px 16px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;cursor:pointer;white-space:nowrap">
                  🗑️ Limpiar
                </button>
                <div id="hf-count" style="font-size:11px;font-weight:700;color:#94a3b8;white-space:nowrap"></div>
              </div>
            </div>
            <div id="hist-cards-body"></div>`;

            window._aplicarFiltroHist = function() {
                const emp    = (document.getElementById('hf-empresa')?.value||'').toLowerCase().trim();
                const desde  = document.getElementById('hf-desde')?.value||'';
                const hasta  = document.getElementById('hf-hasta')?.value||'';
                const status = document.getElementById('hf-status')?.value||'';
                const asc    = window._histSortAsc;
                let filtered = (window._histGrupos||[]).filter(g => {
                    if (emp    && !g.empresa.toLowerCase().includes(emp)) return false;
                    if (desde  && g.fechaIn  && g.fechaIn < desde)        return false;
                    if (hasta  && g.fechaIn  && g.fechaIn > hasta)        return false;
                    if (status && g.status !== status)                    return false;
                    // ── Filtro por defecto: solo mostrar activos y pre-asignados ────────
                    // Si no hay filtro de fecha manual, ocultar cargas cuya fecha ya pasó.
                    // El usuario puede buscar históricas usando los filtros Desde/Hasta.
                    const hoyDefault = new Date().toISOString().split('T')[0];
                    if (!desde && !hasta && g.fechaOut && g.fechaOut < hoyDefault) return false;
                    return true;
                });

                filtered.sort((a, b) => {
                    // Orden por fecha (asc o desc), luego empresa, luego contrato
                    const cmpFecha = (a.fechaIn || '').localeCompare(b.fechaIn || '');
                    const fecha    = asc ? cmpFecha : -cmpFecha;
                    if (fecha !== 0) return fecha;
                    // Segunda clave: fecha_salida
                    const cmpFin = (a.fechaOut || '').localeCompare(b.fechaOut || '');
                    const fin    = asc ? cmpFin : -cmpFin;
                    if (fin !== 0) return fin;
                    // Tercera clave: empresa
                    return a.empresa.localeCompare(b.empresa);
                });
                const cnt = document.getElementById('hf-count');
                if (cnt) cnt.textContent = `${filtered.length} carga${filtered.length!==1?'s':''}`;
                const cardsBody = document.getElementById('hist-cards-body');
                if (!cardsBody) return;
                if (!filtered.length) {
                    cardsBody.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:40px;background:#fff;border-radius:16px;border:2px dashed #e2e8f0"><div style="font-size:40px;margin-bottom:10px">🔍</div><div style="font-weight:700;color:#475569">Sin resultados con los filtros actuales</div></div>`;
                    return;
                }
                cardsBody.innerHTML = filtered.map(g=>{
                const rechazados=g.rows.filter(r=>r.status==='rechazada');
                const isRechazado=g.status==='rechazada';
                const rKey = _grupoIdx++;
                window._gruposData[rKey] = { rechazados, allRows: g.rows, rows: g.rows, empresa: g.empresa };
                // Metadata para checkout/borrar por lista (no por empresa)
                window._gruposMetadata = window._gruposMetadata || {};
                window._gruposMetadata[rKey] = { empresa: g.empresa, contrato: g.contrato, fechaIn: g.fechaIn, fechaOut: g.fechaOut, ids: g.rows.map(r=>r.id).filter(Boolean) };
                const stBg=isRechazado?'#fee2e2':'#dcfce7';
                const stColor=isRechazado?'#b91c1c':'#15803d';
                const stLabel=isRechazado?'❌ Rechazada':'✅ Aceptada';
                const tableId=`hist-table-${rKey}`;
                const periodo=(g.fechaIn||g.fechaOut)?`${fmt(g.fechaIn)} → ${fmt(g.fechaOut)}`:'Sin fecha';
                const contratoTag=g.contrato?`<span style="font-size:10px;background:#e0f2fe;color:#0369a1;padding:1px 7px;border-radius:99px;font-weight:700;margin-left:4px">${g.contrato}</span>`:'';

                const workerRows=g.rows.map(r=>{
                    const sid=r.id;
                    const rut=(r.rut_trabajador||'').replace(/"/g,'&quot;');
                    const contrato=(r.n_contrato||'').replace(/"/g,'&quot;');
                    const empresa2=(r.empresa||'').replace(/"/g,'&quot;');
                    const esAceptada=r.status==='aceptada';
                    return `
                    <tr style="border-bottom:1px solid #f1f5f9;transition:background .15s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                        <td style="padding:6px 10px;font-weight:600;font-size:13px">${r.nombre_trabajador||'—'}</td>
                        <td style="padding:6px 10px;font-family:monospace;font-size:12px;color:#6366f1">${r.rut_trabajador||'—'}</td>
                        <td style="padding:6px 10px;text-align:center">${r.hab_solicitada
                            ?`<span style="background:#dcfce7;color:#15803d;padding:1px 8px;border-radius:99px;font-size:11px">🏠 ${r.hab_solicitada}</span>`
                            :'<span style="color:#94a3b8;font-size:11px">Auto</span>'}</td>
                        <td style="padding:6px 10px;font-size:12px;color:#64748b">${fmt(r.fecha_llegada)} → ${fmt(r.fecha_salida)}</td>
                        <td style="padding:6px 10px;white-space:nowrap">
                            ${esAceptada?`
                            <button data-sid="${sid}" data-rut="${rut}" data-contrato="${contrato}"
                                onclick="window._solBorrarAsig(this.dataset.sid,this.dataset.rut,this.dataset.contrato)"
                                title="Borrar asignación" style="padding:4px 10px;border:none;border-radius:7px;background:#fee2e2;color:#b91c1c;font-weight:700;font-size:11px;cursor:pointer;margin-right:4px">
                                🗑️ Borrar
                            </button>
                            <button data-sid="${sid}" data-rut="${rut}" data-empresa="${empresa2}" data-contrato="${contrato}"
                                onclick="window._solReasignarUno(this.dataset.sid,this.dataset.rut,this.dataset.empresa,this.dataset.contrato)"
                                title="Reasignar a cama disponible" style="padding:4px 10px;border:none;border-radius:7px;background:#dbeafe;color:#1e40af;font-weight:700;font-size:11px;cursor:pointer">
                                🔄 Reasignar
                            </button>`
                            :`<button data-sid="${sid}" data-rut="${rut}" data-empresa="${empresa2}" data-contrato="${contrato}"
                                onclick="window._solReasignarUno(this.dataset.sid,this.dataset.rut,this.dataset.empresa,this.dataset.contrato)"
                                style="padding:4px 10px;border:none;border-radius:7px;background:#dbeafe;color:#1e40af;font-weight:700;font-size:11px;cursor:pointer">
                                🔄 Asignar
                            </button>`}
                        </td>
                    </tr>`;
                }).join('');


                return `
                <div style="background:#fff;border-radius:14px;border:2px solid ${stBg};margin-bottom:14px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.06)">
                    <div onclick="window._solToggleGrupo('${tableId}')" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px 16px;background:${isRechazado?'#fff5f5':'#f0fdf4'};cursor:pointer;user-select:none">
                        <div style="display:flex;align-items:center;gap:10px">
                            <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#c0392b,#e74c3c);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px">${g.empresa.charAt(0).toUpperCase()}</div>
                            <div>
                                <div style="font-weight:800;font-size:14px">${g.empresa}${contratoTag}</div>
                                <div style="font-size:11px;color:#64748b;margin-top:2px">📅 ${periodo} · ${g.rows.length} trabajadores</div>
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                            <span style="background:${stBg};color:${stColor};padding:3px 12px;border-radius:99px;font-size:12px;font-weight:800">${stLabel}</span>
                            <button data-gkey="${rKey}" onclick="event.stopPropagation();window._solDescargarExcelGrupo(this.dataset.gkey)"
                                title="Descargar lista en Excel" style="padding:6px 12px;border:none;border-radius:8px;background:#dcfce7;color:#15803d;font-weight:700;font-size:11px;cursor:pointer">
                                📥 Excel
                            </button>
                            <button data-gkey="${rKey}" onclick="event.stopPropagation();window._solCheckoutLista(parseInt(this.dataset.gkey))"
                                title="Check-Out de SOLO esta lista — libera camas y guarda cobro"
                                style="padding:6px 12px;border:none;border-radius:8px;background:linear-gradient(135deg,#0369a1,#0ea5e9);color:#fff;font-weight:700;font-size:11px;cursor:pointer">
                                🚪 Check Out
                            </button>
                            <button data-gkey="${rKey}" onclick="event.stopPropagation();window._solBorrarLista(parseInt(this.dataset.gkey))"
                                title="Borrar SOLO esta lista — no afecta otras listas de la misma empresa"
                                style="padding:6px 12px;border:none;border-radius:8px;background:#fee2e2;color:#b91c1c;font-weight:700;font-size:11px;cursor:pointer">
                                🗑️ Borrar lista
                            </button>
                            ${isRechazado&&rechazados.length>0?`
                            <button onclick="event.stopPropagation();window._solReintentarGrupoIds(${rKey})"
                                style="padding:7px 14px;border:none;border-radius:9px;background:linear-gradient(135deg,#0369a1,#38bdf8);color:#fff;font-weight:800;font-size:12px;cursor:pointer">
                                🔄 Reintentar ${rechazados.length}
                            </button>
                            <button data-empresa="${g.empresa.replace(/"/g,'&quot;')}" onclick="event.stopPropagation();window._solLimpiarYReasignar(this.dataset.empresa)"
                                style="padding:7px 14px;border:none;border-radius:9px;background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;font-weight:800;font-size:12px;cursor:pointer">
                                🧹 Limpiar Todo
                            </button>`:''}
                            <span id="chevron-${tableId}" style="font-size:18px;transition:transform .25s;display:inline-block">▼</span>
                        </div>
                    </div>
                    <div id="${tableId}" style="display:none;max-height:320px;overflow-y:auto;overflow-x:auto">
                        <table style="width:100%;border-collapse:collapse;font-size:13px">
                            <thead><tr style="background:#f8fafc;position:sticky;top:0;z-index:1">
                                <th style="padding:7px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Nombre</th>
                                <th style="padding:7px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">RUT</th>
                                <th style="padding:7px 10px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Hab.</th>
                                <th style="padding:7px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Fechas</th>
                                <th style="padding:7px 10px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Acciones</th>
                            </tr></thead>
                            <tbody>${workerRows}</tbody>
                        </table>
                    </div>
                </div>`;
                }).join('');
            };

            window._toggleSortHist = function() {
                window._histSortAsc = !window._histSortAsc;
                const btn = document.getElementById('hf-sort-btn');
                if (btn) btn.textContent = window._histSortAsc ? '⬆️ Más antigua' : '⬇️ Más reciente';
                window._aplicarFiltroHist();
            };

            window._limpiarFiltroHist = function() {
                const e = document.getElementById('hf-empresa');
                const d = document.getElementById('hf-desde');
                const h = document.getElementById('hf-hasta');
                const s = document.getElementById('hf-status');
                if (e) e.value = '';
                if (d) d.value = '';
                if (h) h.value = '';
                if (s) s.value = '';
                window._aplicarFiltroHist();
            };

            // Insertar aviso amarillo antes del filtro
            const filtersDiv = document.getElementById('hist-filters');
            if (filtersDiv) {
                const tip = document.createElement('div');
                tip.style.cssText = 'background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px';
                tip.innerHTML = '<span style="font-size:20px">💡</span><span style="font-size:13px;color:#92400e;font-weight:600">Cada tarjeta es una carga. La misma empresa con distintas fechas de turno aparece como tarjetas separadas.</span>';
                filtersDiv.parentElement.insertBefore(tip, filtersDiv);
            }

            window._aplicarFiltroHist();
        }


    } catch(e) {
        body.innerHTML=`<div style="text-align:center;color:#ef4444;padding:40px;background:#fff;border-radius:16px">
            <div style="font-size:36px;margin-bottom:8px">⚠️</div>
            <div style="font-weight:700">Error: ${e.message}</div>
        </div>`;
    }
}

// ── Toggle colapsar/expandir grupo ──────────────────────────────────────────
window._solToggleGrupo = function(tableId) {
    const el = document.getElementById(tableId);
    const ch = document.getElementById('chevron-'+tableId);
    if(!el) return;
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    if(ch) ch.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
};

// ── Helper: decrementar/incrementar cupo en v2_cupos_gerencias ──────────────
async function _ajustarCupo(nContrato, delta) {
    if(!nContrato) return;
    const {data:rows} = await supabase.from('v2_cupos_gerencias')
        .select('id,cupos_ocupados').eq('numero_contrato', nContrato).limit(1);
    if(!rows?.length) return;
    const row = rows[0];
    const nuevo = Math.max(0, (row.cupos_ocupados||0) + delta);
    await supabase.from('v2_cupos_gerencias').update({cupos_ocupados: nuevo}).eq('id', row.id);
}

// ── Borrar asignación individual ─────────────────────────────────────────────
window._solBorrarAsig = async function(solicitudId, rut, contrato) {
    // rut y contrato vienen directo desde data attributes
    if(!rut) { alert('Error: RUT no definido'); return; }
    if(!await _solConfirm(`¿Borrar asignación de ${rut}?
La cama quedará libre.`, {confirmText:'🗑️ Borrar', danger:true})) return;

    try {
        // 1. Buscar asignación activa por rut
        const {data:asigs} = await supabase.from('v2_asignaciones')
            .select('id,id_cama').eq('rut_huesped', rut).is('fecha_checkout',null).limit(1);

        if(asigs?.length) {
            const {id:asigId, id_cama} = asigs[0];
            // 2. Liberar cama
            await supabase.from('v2_camas').update({estado:'Disponible'}).eq('id_cama', id_cama).neq('estado', 'Deshabilitada');
            // 2.5 Limpiar v2_camas_perdidas de esa habitación
            await _limpiarCamasPerdidas([id_cama]);
            // 3. Borrar asignación
            await supabase.from('v2_asignaciones').delete().eq('id', asigId);
        }
        // 4. Resetear solicitud a pendiente
        await supabase.from('v2_solicitudes_b2b').update({status:'pendiente'}).eq('id', solicitudId);
        // 5. Decrementar cupo si hay contrato
        if(contrato) await _ajustarCupo(contrato, -1);

        toast('✅ Asignación eliminada — cama liberada');
        window._renderV2Solicitudes?.();
        refreshBadge();
    } catch(e) {
        alert('❌ Error al borrar: '+e.message);
    }
};

// ── Reasignar individualmente a cama disponible ──────────────────────────────
window._solReasignarUno = async function(solicitudId, rut, empresa, contrato) {
    // Params vienen directo desde data attributes
    if(!rut) { alert('Error: RUT no definido'); return; }

    try {
        // 1. Borrar asignación previa si existe (sin decrementar cupo — saldo neutro)
        const {data:asigs} = await supabase.from('v2_asignaciones')
            .select('id,id_cama').eq('rut_huesped', rut).is('fecha_checkout',null).limit(1);
        if(asigs?.length) {
            await supabase.from('v2_camas').update({estado:'Disponible'}).eq('id_cama', asigs[0].id_cama).neq('estado', 'Deshabilitada');
            await supabase.from('v2_asignaciones').delete().eq('id', asigs[0].id);
        }

        // 2. Buscar solicitud para saber empresa_id y fechas
        const {data:sol} = await supabase.from('v2_solicitudes_b2b').select('*').eq('id',solicitudId).single();
        if(!sol) throw new Error('Solicitud no encontrada');

        // 3. Buscar empresa_id
        const {data:empRows} = await supabase.from('v2_empresas').select('id').ilike('nombre',empresa).limit(1);
        const empresaId = empRows?.[0]?.id || null;

        // 4. Buscar cama REALMENTE disponible (sin ninguna asignación activa, incluida pre_asignado)
        // Una cama con estado='Disponible' puede tener un pre_asignado → no tocarla hasta su checkout
        const {data:todasDisp} = await supabase.from('v2_camas')
            .select('id_cama,habitacion_id')
            .eq('estado','Disponible')
            .limit(50);
        if(!todasDisp?.length) throw new Error('No hay camas disponibles en el campamento');

        // Filtrar las que tengan asignaciones activas (incluyendo pre_asignado)
        const camaIdsDisp = todasDisp.map(c => c.id_cama);
        const {data:conReserva} = await supabase.from('v2_asignaciones')
            .select('id_cama')
            .in('id_cama', camaIdsDisp)
            .is('fecha_checkout', null);
        const reservadas = new Set((conReserva||[]).map(a => a.id_cama));
        const cama = todasDisp.find(c => !reservadas.has(c.id_cama));
        if(!cama) throw new Error('No hay camas realmente libres — todas tienen reservas vigentes o pre-asignaciones');

        // 5. Crear asignación
        const {error:eAsig} = await supabase.from('v2_asignaciones').insert({
            id_cama:                 cama.id_cama,
            rut_huesped:             (rut || '').slice(0, 12),
            nombre_huesped:          sol.nombre_trabajador || rut,   // ← campo obligatorio
            empresa_id:              empresaId,
            fecha_checkin:           sol.fecha_llegada || new Date().toISOString().split('T')[0],
            fecha_salida_programada: sol.fecha_salida  || null,
            fecha_checkout:          null,
            numero_contrato:         contrato || null,
            huesped_confirmo:        true,
        });
        if(eAsig) throw new Error(eAsig.message);

        // 6. Marcar cama como ocupada
        await supabase.from('v2_camas').update({estado:'Ocupada'}).eq('id_cama', cama.id_cama);

        // 7. Actualizar solicitud a aceptada
        await supabase.from('v2_solicitudes_b2b').update({status:'aceptada'}).eq('id', solicitudId);

        // 8. Incrementar cupo si tiene contrato y era una solicitud nueva (sin asig previa)
        if(contrato && !asigs?.length) await _ajustarCupo(contrato, +1);

        toast(`✅ Reasignado a cama ${cama.id_cama}`);
        window._renderV2Solicitudes?.();
        refreshBadge();
    } catch(e) {
        alert('❌ Error al reasignar: '+e.message);
    }
};

// ── Borrar TODA la asignación de una empresa ─────────────────────────────────
/**
 * _solCheckoutLista(gKey)
 * Realiza el check-out de TODOS los trabajadores de UNA lista específica.
 * - Registra fecha_checkout en v2_asignaciones
 * - Libera las camas (estado → 'Disponible')
 * - Guarda registro de cobro en v2_checkout_registros
 * - Elimina las solicitudes de v2_solicitudes_b2b
 * - NO afecta ninguna otra lista, aunque sea de la misma empresa
 */
window._solCheckoutLista = async function(gKey) {
    const data = window._gruposData[gKey];
    const rows = Array.isArray(data) ? data : (data?.allRows || data?.rows || []);
    const meta = (window._gruposMetadata || {})[gKey] || {};
    const empresa  = meta.empresa  || rows[0]?.empresa    || 'Sin empresa';
    const contrato = meta.contrato || rows[0]?.n_contrato || null;
    const fechaIn  = meta.fechaIn  || rows[0]?.fecha_llegada || null;
    const fechaOut = meta.fechaOut || rows[0]?.fecha_salida  || null;
    const solicitudIds = (meta.ids?.length ? meta.ids : rows.map(r=>r.id)).filter(Boolean);
    const ruts = [...new Set(rows.map(r=>r.rut_trabajador).filter(Boolean))];

    if(!ruts.length) { toast('No hay trabajadores en esta lista', 'error'); return; }
    const fmt2 = d => d ? new Date(d).toLocaleDateString('es-CL') : '—';
    if(!await _solConfirm(
        `¿Realizar Check-Out de ${ruts.length} trabajadores de "${empresa}"?\n\n` +
        `Período: ${fmt2(fechaIn)} → ${fmt2(fechaOut)}\n` +
        `N° Contrato: ${contrato||'—'}\n\n` +
        `• Se registrará el checkout en las asignaciones activas\n` +
        `• Las camas quedarán libres\n` +
        `• Se guardará el registro de cobro\n` +
        `• La lista desaparecerá de esta vista\n\n` +
        `Esta acción no se puede deshacer.`,
        {confirmText:'🚪 Confirmar Check-Out', danger:false}
    )) return;

    // ── Overlay de progreso ───────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:20px;padding:32px 40px;text-align:center;min-width:360px;max-width:500px';
    box.innerHTML = `
        <div style="font-size:36px;margin-bottom:10px">🚪</div>
        <div style="font-weight:900;font-size:16px;margin-bottom:6px">Check-Out: ${empresa}</div>
        <div id="_co_txt" style="font-size:13px;color:#64748b;min-height:20px;margin-bottom:16px">Preparando…</div>
        <div style="height:8px;background:#f1f5f9;border-radius:99px;overflow:hidden;margin-bottom:20px">
            <div id="_co_prog" style="height:100%;width:0%;background:linear-gradient(90deg,#0369a1,#0ea5e9);transition:width .4s;border-radius:99px"></div>
        </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const setStep = (txt, pct) => {
        const el = document.getElementById('_co_txt');
        const pr = document.getElementById('_co_prog');
        if(el) el.textContent = txt;
        if(pr && pct !== undefined) pr.style.width = pct + '%';
    };

    try {
        // ── PASO 1: Buscar asignaciones activas por RUTs de ESTA lista ────────
        setStep(`Buscando asignaciones de ${ruts.length} trabajadores…`, 15);
        const {data:asigs, error:eAsig} = await supabase
            .from('v2_asignaciones')
            .select('id,id_cama,nombre_huesped,rut_huesped,fecha_checkin,fecha_salida_programada,numero_contrato')
            .in('rut_huesped', ruts)
            .is('fecha_checkout', null);
        if(eAsig) throw new Error('Leer asignaciones: ' + eAsig.message);

        const fechaCheckout = new Date().toISOString();
        const asigIds  = (asigs||[]).map(a => a.id);
        const camaIds  = [...new Set((asigs||[]).map(a => a.id_cama).filter(Boolean))];

        // ── PASO 2: Registrar fecha_checkout en asignaciones ─────────────────
        setStep(`Registrando checkout de ${asigIds.length} asignaciones…`, 35);
        if(asigIds.length) {
            const {error:eUpd} = await supabase
                .from('v2_asignaciones')
                .update({ fecha_checkout: fechaCheckout })
                .in('id', asigIds);
            if(eUpd) throw new Error('Actualizar asignaciones: ' + eUpd.message);
        }

        // ── PASO 3: Liberar camas ─────────────────────────────────────────────
        setStep(`Liberando ${camaIds.length} camas…`, 55);
        if(camaIds.length) {
            const {error:eCama} = await supabase
                .from('v2_camas')
                .update({ estado: 'Disponible' })
                .in('id_cama', camaIds)
                .neq('estado', 'Deshabilitada'); // ← NO reactivar camas C3 deshabilitadas
            if(eCama) console.warn('[Checkout] Error liberando camas:', eCama.message);
        }


        // ── PASO 4: Calcular y guardar registro de cobro ──────────────────────
        setStep('Guardando registro de cobro…', 70);
        const calcNoches = (a) => {
            if(!a.fecha_checkin) return 0;
            const ins  = new Date(a.fecha_checkin);
            const outs = new Date(fechaCheckout);
            return Math.max(0, Math.round((outs - ins) / 86_400_000));
        };
        const detalle = (asigs||[]).map(a => ({
            rut:    a.rut_huesped,
            nombre: a.nombre_huesped,
            noches: calcNoches(a),
            id_cama: a.id_cama,
        }));
        const totalNoches = detalle.reduce((s,d) => s + d.noches, 0);

        await supabase.from('v2_checkout_registros').insert({
            empresa,
            numero_contrato:         contrato,
            fecha_llegada:           fechaIn,
            fecha_salida:            fechaOut,
            total_trabajadores:      ruts.length,
            total_camas_liberadas:   camaIds.length,
            total_noches_cobradas:   totalNoches,
            ruts_trabajadores:       ruts,
            detalle_facturacion:     detalle,
            fecha_checkout_realizado: fechaCheckout,
        });

        // ── PASO 5: Eliminar solicitudes de esta lista (solo sus IDs) ─────────
        setStep('Cerrando lista de solicitudes…', 85);
        if(solicitudIds.length) {
            const {error:eDel} = await supabase
                .from('v2_solicitudes_b2b')
                .delete()
                .in('id', solicitudIds);
            if(eDel) throw new Error('Eliminar solicitudes: ' + eDel.message);
        }

        // ── Éxito ─────────────────────────────────────────────────────────────
        setStep(`✅ Check-Out completado`, 100);
        await new Promise(r => setTimeout(r, 900));
        overlay.remove();
        toast(
            `✅ Check-Out "${empresa}": ${asigIds.length} trabajadores · ` +
            `${camaIds.length} camas libres · ${totalNoches} noches registradas`,
            'success'
        );
        window._renderV2Solicitudes?.();
        refreshBadge();

    } catch(e) {
        overlay.remove();
        console.error('[CheckoutLista] ERROR:', e.message);
        alert('❌ Error en Check-Out:\n' + e.message);
    }
};

/** _solBorrarEmpresa — mantenido para compatibilidad. Ahora usa _solBorrarLista. */
window._solBorrarEmpresa = async function(empresa) {
    if(!empresa) { alert('Error: empresa no definida'); return; }
    if(!await _solConfirm(`¿Borrar TODAS las asignaciones de "${empresa}"?

Se liberarán todas las camas.
Esta acción no se puede deshacer.`, {confirmText:'🗑️ Sí, borrar todo', danger:true})) return;

    // ── Overlay ────────────────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = '_be_overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:20px;padding:32px 40px;text-align:center;min-width:360px;max-width:500px';
    box.innerHTML = `
        <div style="font-size:36px;margin-bottom:10px">🗑️</div>
        <div style="font-weight:900;font-size:16px;margin-bottom:6px">Borrando: ${empresa}</div>
        <div id="_be_txt" style="font-size:13px;color:#64748b;min-height:20px;margin-bottom:16px">Preparando…</div>
        <div style="height:8px;background:#f1f5f9;border-radius:99px;overflow:hidden;margin-bottom:20px">
            <div id="_be_prog" style="height:100%;width:0%;background:linear-gradient(90deg,#c0392b,#e74c3c);transition:width .4s;border-radius:99px"></div>
        </div>
        <button id="_be_close" onclick="document.getElementById('_be_overlay')?.remove()"
            style="padding:8px 20px;border:1.5px solid #e2e8f0;border-radius:9px;background:#fff;color:#64748b;font-weight:700;font-size:12px;cursor:pointer">
            Cancelar
        </button>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const setStep = (txt, pct) => {
        const el = document.getElementById('_be_txt');
        const pr = document.getElementById('_be_prog');
        if(el) el.textContent = txt;
        if(pr && pct !== undefined) pr.style.width = pct + '%';
        console.log(`[BorrarEmpresa] ${txt}`);
    };

    const showError = (msg) => {
        box.innerHTML = `
            <div style="font-size:36px;margin-bottom:10px">❌</div>
            <div style="font-weight:900;font-size:15px;color:#b91c1c;margin-bottom:10px">Error al borrar</div>
            <div style="font-size:12px;color:#475569;margin-bottom:20px;text-align:left;
                background:#fef2f2;padding:12px;border-radius:10px;white-space:pre-wrap;max-height:200px;overflow-y:auto">${msg}</div>
            <button onclick="document.getElementById('_be_overlay')?.remove()"
                style="padding:10px 24px;border:none;border-radius:10px;background:#fee2e2;color:#b91c1c;font-weight:800;cursor:pointer;font-size:13px">
                Cerrar
            </button>`;
    };

    try {
        // ── PASO 1: Obtener todos los RUTs de esta empresa desde v2_solicitudes_b2b
        setStep('Obteniendo trabajadores…', 15);
        const {data:solRows, error:eSol} = await supabase
            .from('v2_solicitudes_b2b')
            .select('id,rut_trabajador,n_contrato,hab_solicitada')
            .ilike('empresa', empresa);
        if(eSol) throw new Error('Leer solicitudes: ' + eSol.message);
        if(!solRows?.length) throw new Error(`No se encontraron solicitudes para "${empresa}". Verifica el nombre exacto.`);

        const ruts = [...new Set(solRows.map(r => r.rut_trabajador).filter(Boolean).map(r=>String(r).replace(/\./g,'').trim().toUpperCase()))];
        console.log('[BorrarEmpresa] RUTs encontrados:', ruts.length);

        // ── PASO 2: Buscar asignaciones por rut_huesped
        setStep(`Buscando asignaciones de ${ruts.length} trabajadores…`, 30);
        let asigIds = [], camaIds = [], totalAsigs = 0;

        if(ruts.length > 0) {
            const {data:asigs, error:eAsig} = await supabase
                .from('v2_asignaciones')
                .select('id,id_cama,numero_contrato')
                .in('rut_huesped', ruts);
            if(eAsig) throw new Error('Leer asignaciones: ' + eAsig.message);
            totalAsigs = asigs?.length || 0;
            asigIds = (asigs||[]).map(a => a.id);
            camaIds = (asigs||[]).map(a => a.id_cama);

            // ── PASO 3: Liberar camas
            if(camaIds.length > 0) {
                setStep(`Liberando ${camaIds.length} camas…`, 50);
                const {error:eCama} = await supabase.from('v2_camas')
                    .update({estado:'Disponible'}).in('id_cama', camaIds).neq('estado', 'Deshabilitada');
                if(eCama) console.warn('[BorrarEmpresa] liberando camas:', eCama.message);
            }

            // ── PASO 4: Eliminar asignaciones
            if(asigIds.length > 0) {
                setStep(`Eliminando ${asigIds.length} asignaciones…`, 65);
                const {error:eDel} = await supabase.from('v2_asignaciones')
                    .delete().in('id', asigIds);
                if(eDel) throw new Error('Borrar asignaciones: ' + eDel.message);
            }

            // ── PASO 5: Decrementar cupos
            setStep('Actualizando cupos…', 78);
            const conteos = {};
            for(const a of (asigs||[])) if(a.numero_contrato) conteos[a.numero_contrato] = (conteos[a.numero_contrato]||0)+1;
            for(const [nc,cnt] of Object.entries(conteos)) {
                const {data:cr} = await supabase.from('v2_cupos_gerencias')
                    .select('id,cupos_ocupados').eq('numero_contrato',nc).limit(1);
                if(cr?.length) await supabase.from('v2_cupos_gerencias')
                    .update({cupos_ocupados: Math.max(0,(cr[0].cupos_ocupados||0)-cnt)}).eq('id',cr[0].id);
            }
        }

        // ── PASO 6: Resetear solicitudes a pendiente
        setStep('Reseteando solicitudes a Pendiente…', 90);
        const {error:eReset} = await supabase.from('v2_solicitudes_b2b')
            .update({status:'pendiente'}).ilike('empresa', empresa);
        if(eReset) throw new Error('Reset solicitudes: ' + eReset.message);

        // ── Éxito
        setStep(`✅ Completado — ${totalAsigs} asignaciones borradas`, 100);
        document.getElementById('_be_close').textContent = 'Cerrar';
        await new Promise(r => setTimeout(r, 1200));
        overlay.remove();
        toast(`✅ "${empresa}": ${totalAsigs} asignaciones eliminadas. Lista en Pendientes.`);
        window._renderV2Solicitudes?.();
        refreshBadge();

    } catch(e) {
        console.error('[BorrarEmpresa] ERROR:', e.message);
        showError(e.message + '\n\nEmpresa: ' + empresa);
    }
};


