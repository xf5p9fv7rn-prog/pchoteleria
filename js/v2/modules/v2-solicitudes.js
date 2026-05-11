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
    const fechaLlegadaLote = rows[0]?.fecha_llegada || new Date().toISOString().split('T')[0];
    console.log(`[Motor] 📅 Fecha llegada del lote: ${fechaLlegadaLote}`);

    // Cargar camas, asignaciones y habitaciones en paralelo (todo paginado)
    // Incluimos fecha_salida_programada para detectar rotaciones de turno
    const [camasData, asigActivas] = await Promise.all([
        _fetchAllPages('v2_camas', 'id_cama,habitacion_id,estado', 'id_cama'),
        _fetchAllPages('v2_asignaciones', 'id_cama,empresa_id,fecha_salida_programada', 'id_cama',
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

    // Índice directo: id_cama → { habitacion_id, estado }
    const camaIndex={};
    for(const c of camasData||[]) camaIndex[String(c.id_cama)]=c;

    // Mapa por habitacion: { habitacion_id → { libres:[id_cama], ocupantes:[{empresa_id}] } }
    const habMap={};
    for(const c of camasData||[]) {
        if(!habMap[c.habitacion_id]) habMap[c.habitacion_id]={libres:[],ocupantes:[]};
        if(c.estado==='Disponible') habMap[c.habitacion_id].libres.push(c.id_cama);
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
    // Actualizar libres: agregar camas en rotación + quitar las bloqueadas
    for(const hab of Object.values(habMap)) {
        // Agregar camas en rotación que pertenecen a esta habitación
        const camasHab = (camasData||[]).filter(c => c.habitacion_id === hab._habId);
        hab.libres = hab.libres.filter(idC => !asigSet.has(String(idC)));
    }
    // Segunda pasada: añadir las camas en rotación al habMap
    for(const c of camasData||[]) {
        if(camasEnRotacion.has(String(c.id_cama))) {
            const hab = habMap[c.habitacion_id];
            if(hab && !hab.libres.includes(c.id_cama)) {
                hab.libres.push(c.id_cama);
            }
        }
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

    // Verifica si una cama está libre para el período [checkin, salida]
    function camaLibreEnFechas(camaId, checkin, salida) {
        const cid = String(camaId);
        if(asigSet.has(cid)) return false; // ocupada por asignación activa pre-existente
        const slots = camasUsadasLote.get(cid) || [];
        if(!slots.length) return true;
        const b1 = checkin || '0000-01-01';
        const b2 = salida  || '9999-12-31';
        // Verifica que no haya solapamiento con ningún slot existente
        return slots.every(s => {
            const a1 = s.checkin || '0000-01-01';
            const a2 = s.salida  || '9999-12-31';
            return b2 <= a1 || a2 <= b1; // sin solapamiento
        });
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
        const rut=row.rut_trabajador?String(row.rut_trabajador).replace(/\./g,'').trim().toUpperCase():null;
        const nombre=row.nombre_trabajador||'';
        const habPedida=row.hab_solicitada?String(row.hab_solicitada).replace(/[.,\s]/g,'').trim():'';
        const rowCheckin = row.fecha_llegada || hoy;
        const rowSalida  = row.fecha_salida  || null;

        if(!rut||!nombre){ fallidos.push(`RUT/nombre vacío`); continue; }

        let camaAsignada=null;

        if(habPedida && habPedida!=='0' && habPedida!=='null') {

        // ══ PRIORIDAD 1: por NÚMERO DE HABITACIÓN (columna "HAB." del Excel) ══
            const habIdResuelto = habByNumero[habPedida];
            if(habIdResuelto) {
                const habR = habMap[habIdResuelto];
                if(habR) {
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

        // ── Sin cama tras intentar hab_pedida → quedar pendiente con sugerencias ──
        if(!camaAsignada && habPedida) {
            // Generar hasta 5 sugerencias de habitaciones disponibles
            const sugs = [];
            for(const [habId, hab] of Object.entries(habMap)) {
                if(hab.libres.length > 0 && sugs.length < 5) {
                    const numLegible = idCustomToNumero[habId] || habId;
                    sugs.push(numLegible);
                }
            }
            const razon = habByNumero[habPedida]
                ? `Hab. ${habPedida} está llena`
                : `Hab. ${habPedida} no encontrada en BD`;
            sinAsignar.push({ nombre, rut, habPedida, razon, sugerencias: sugs, rowId: row.id });
            console.warn(`[Motor] ⏸ ${nombre}: ${razon} → queda pendiente`);
            continue; // NO auto-asignar → queda como pendiente
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

        asignaciones.push({
            rut_huesped:             rut,
            nombre_huesped:          nombre,
            id_cama:                 camaAsignada,
            empresa_id:              empresaId,
            fecha_checkin:           row.fecha_llegada||hoy,
            fecha_salida_programada: row.fecha_salida||null,
            numero_contrato:         row.n_contrato||null,
            _edificio:               edificioFinal    // solo para el informe local
        });
        rowsActualizadas.push(row.id);
    } // fin for(row of rows)

    if(asignaciones.length>0) {

        // Limpiar campo interno antes de insertar en BD
        const asignacionesDB = asignaciones.map(a => {
            const {_edificio, ...rest} = a;
            return rest;
        });
        const {error:errA}=await supabase.from('v2_asignaciones').insert(asignacionesDB);

        if(errA) return {ok:false,msg:'Error insertando asignaciones: '+errA.message};

        // ── Actualizar estado de camas a 'Ocupada' ──────────────────────────────
        const camasAsignadas = asignaciones.map(a=>a.id_cama);
        const {error:errC}=await supabase.from('v2_camas')
            .update({estado:'Ocupada'})
            .in('id_cama', camasAsignadas);
        if(errC) console.warn('[Motor] Error actualizando estado camas:', errC.message);

        // Marcar solicitudes como aceptadas
        await supabase.from('v2_solicitudes_b2b')
            .update({status:'aceptada'})
            .in('id', rowsActualizadas);

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
            correctos:_correctos, automaticos:_automaticos, edificios:edificioResumen};
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
                await supabase.from('v2_camas').update({estado:'Disponible'}).in('id_cama',camasLiberadas);

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



// ── HTML de tarjeta agrupada por empresa ──────────────────────────────────────
function grupoCardHTML(empresa, rows) {
    const gKey = _grupoIdx++;
    window._gruposData[gKey] = rows;
    const tableId = `pend-table-${gKey}`;

    const isPending = rows.every(r=>r.status==='pendiente');
    const ids = rows.map(r=>r.id);
    const generos = [...new Set(rows.map(r=>r.genero).filter(Boolean))];
    const gLabel = generos.includes('F')&&generos.includes('M') ? '⚧ Mixto'
                 : generos[0]==='F' ? '♀ Femenino' : generos[0]==='M' ? '♂ Masculino' : '';
    const gColor = generos[0]==='F'?'#fce7f3':'#dbeafe';
    const gTextColor = generos[0]==='F'?'#9d174d':'#1e40af';
    const contrato = rows[0]?.n_contrato||'—';
    const fechaLlegada = rows[0]?.fecha_llegada||null;
    const fechaSalida  = rows[0]?.fecha_salida||null;
    const conHab = rows.filter(r=>r.hab_solicitada).length;
    const sinHab = rows.length - conHab;

    const workerRows = rows.map(r=>{
        const rutB64 = btoa(unescape(encodeURIComponent(r.rut_trabajador||'')));
        const nombreB64 = btoa(unescape(encodeURIComponent(r.nombre_trabajador||'')));
        return `
        <tr style="border-bottom:1px solid #f1f5f9;transition:background .15s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <td style="padding:7px 10px;font-weight:700;font-size:13px">${r.nombre_trabajador||'—'}</td>
            <td style="padding:7px 10px;font-family:monospace;font-size:12px;color:#6366f1">${r.rut_trabajador||'—'}</td>
            <td style="padding:7px 10px;text-align:center">
                ${r.hab_solicitada
                    ? `<span style="background:#dcfce7;color:#15803d;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700">🏠 ${r.hab_solicitada}</span>`
                    : `<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:99px;font-size:12px">Sin asignar</span>`}
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
                    title="Descargar Excel de esta empresa"
                    style="padding:5px 12px;border:none;border-radius:8px;background:#1e40af;color:#fff;font-weight:700;font-size:11px;cursor:pointer">
                    📥 Excel
                </button>
                <button data-empresa="${empresa.replace(/"/g,'&quot;')}" onclick="event.stopPropagation();window._solBorrarListaEmpresa(this.dataset.empresa)"
                    title="Borrar toda la lista de solicitudes (para volver a cargar el Excel)"
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
                            <th style="padding:8px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Nombre</th>
                            <th style="padding:8px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">RUT</th>
                            <th style="padding:8px 10px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Habitación</th>
                            <th style="padding:8px 10px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Género</th>
                            <th style="padding:8px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Fechas</th>
                            <th style="padding:8px 10px;text-align:center;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase">Asignación</th>
                        </tr>
                    </thead>
                    <tbody>${workerRows}</tbody>
                </table>
            </div>
            <!-- Panel de sugerencias (se inyecta dinámicamente) -->
            <div id="suger-panel-${gKey}"></div>
            ${isPending?`
            <div style="padding:14px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end">
                <button onclick="event.stopPropagation();window._solRechazarGrupo(${idsJson})"
                    style="padding:10px 22px;border:none;border-radius:10px;background:#fee2e2;color:#b91c1c;font-weight:800;font-size:13px;cursor:pointer">
                    ❌ Rechazar grupo
                </button>
                <button onclick="event.stopPropagation();window._solAceptarGrupo(${gKey})"
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
            id_cama: camaId, rut_huesped: rut,
            nombre_huesped: sol.nombre_trabajador || rut,
            empresa_id: empresaId,
            fecha_checkin:           sol.fecha_llegada||new Date().toISOString().split('T')[0],
            fecha_salida_programada: sol.fecha_salida||null,
            fecha_checkout: null, numero_contrato: sol.n_contrato||null
        });
        if(eA) throw new Error(eA.message);
        await supabase.from('v2_camas').update({estado:'Ocupada'}).eq('id_cama',camaId);
        await supabase.from('v2_solicitudes_b2b').update({status:'aceptada',hab_solicitada:String(camaId)}).eq('id',solicitudId);
        if(sol.n_contrato) await _ajustarCupo(sol.n_contrato, +1);
        toast(`✅ ${rut} asignado a cama ${camaId}`);
        window._renderV2Solicitudes?.();
    } catch(e) { alert('❌ Error: '+e.message); }
};

// ── Borrar SOLO la lista de solicitudes (sin tocar asignaciones/camas) ──────
window._solBorrarListaEmpresa = async function(empresa) {
    if(!empresa) { alert('Error: empresa no definida'); return; }
    const {data:sol} = await supabase.from('v2_solicitudes_b2b')
        .select('id',{count:'exact'}).ilike('empresa',empresa);
    const total = sol?.length || 0;
    if(!total) { toast('No hay registros para borrar'); return; }
    if(!await _solConfirm(`¿Borrar la lista de ${total} solicitudes de ${empresa}?

Solo se elimina la lista — las asignaciones y camas NO se modifican.
Después puedes volver a cargar el Excel.`, {confirmText:'🗑️ Borrar lista', danger:true})) return;

    try {
        const {error} = await supabase.from('v2_solicitudes_b2b')
            .delete().ilike('empresa',empresa);
        if(error) throw new Error(error.message);
        toast(`✅ Lista de ${empresa} borrada (${total} registros) — ya puedes volver a cargar el Excel`);
        window._renderV2Solicitudes?.();
        refreshBadge();
    } catch(e) {
        alert('❌ Error al borrar lista:\n'+e.message);
    }
};

// ── Descargar Excel del grupo ────────────────────────────────────────────────

window._solDescargarExcelGrupo = async function(gKey) {
    const rows = window._gruposData[gKey];
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
                <p style="font-size:13px;color:#64748b;margin:4px 0 0">Agrupadas por empresa · Motor V2</p>
            </div>
            <button onclick="window._renderV2Solicitudes()" style="padding:9px 18px;border:none;border-radius:10px;background:#c0392b;color:#fff;font-weight:700;font-size:13px;cursor:pointer">🔄 Actualizar</button>
        </div>
        <div id="sol-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px"></div>
        <div style="display:flex;gap:8px;margin-bottom:20px">
            <button class="sol-tab active" id="tab-pending" onclick="window._solTab('pending')">⏳ Pendientes <span id="tab-cnt"></span></button>
            <button class="sol-tab" id="tab-history" onclick="window._solTab('history')">📋 Historial</button>
        </div>
        <div id="sol-body"></div>
    </div>`;

    window._renderV2Solicitudes = () => renderV2Solicitudes(container);
    window._solTab = t => renderTab(t);
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
                                    rut_huesped: sol.rut_trabajador,
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
                                    .update({status:'aceptada', hab_solicitada: String(camaId)}).eq('id', rowId);
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

    await renderTab('pending');
}

async function renderTab(tab) {
    document.getElementById('tab-pending')?.classList.toggle('active',tab==='pending');
    document.getElementById('tab-history')?.classList.toggle('active',tab==='history');
    const body=document.getElementById('sol-body');
    if(!body) return;
    body.innerHTML=`<div style="text-align:center;padding:40px;color:#94a3b8"><div style="font-size:36px">⏳</div><div>Cargando…</div></div>`;

    try {
        let q=supabase.from('v2_solicitudes_b2b').select('*').order('empresa').order('created_at',{ascending:false});
        if(tab==='pending') q=q.eq('status','pendiente'); else q=q.neq('status','pendiente').limit(5000);
        const {data:reqs,error}=await q;
        if(error) throw error;

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
            // Agrupar por empresa
            const grupos={};
            for(const r of reqs) {
                const key=r.empresa||'Sin empresa';
                if(!grupos[key]) grupos[key]=[];
                grupos[key].push(r);
            }
            body.innerHTML=Object.entries(grupos)
                .sort(([a],[b])=>a.localeCompare(b))
                .map(([emp,rows])=>grupoCardHTML(emp,rows))
                .join('');
        } else {
            // ── HISTORIAL: agrupado por empresa ───────────────────────────────
            const grupos={};
            for(const r of reqs) {
                const key=(r.empresa||'Sin empresa')+'||'+(r.status||'');
                if(!grupos[key]) grupos[key]={empresa:r.empresa||'Sin empresa',status:r.status,rows:[]};
                grupos[key].rows.push(r);
            }
            const cards=Object.values(grupos).sort((a,b)=>a.empresa.localeCompare(b.empresa)).map(g=>{
                const rechazados=g.rows.filter(r=>r.status==='rechazada');
                const isRechazado=g.status==='rechazada';
                const rKey = _grupoIdx++;
                window._gruposData[rKey] = { rechazados, allRows: g.rows, empresa: g.empresa };
                const stBg=isRechazado?'#fee2e2':'#dcfce7';
                const stColor=isRechazado?'#b91c1c':'#15803d';
                const stLabel=isRechazado?'❌ Rechazada':'✅ Aceptada';
                const tableId=`hist-table-${rKey}`;

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
                                <div style="font-weight:800;font-size:14px">${g.empresa}</div>
                                <div style="font-size:11px;color:#64748b">${g.rows.length} trabajadores</div>
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                            <span style="background:${stBg};color:${stColor};padding:3px 12px;border-radius:99px;font-size:12px;font-weight:800">${stLabel}</span>
                            <button data-gkey="${rKey}" onclick="event.stopPropagation();window._solDescargarExcelGrupo(this.dataset.gkey)"
                                title="Descargar lista en Excel" style="padding:6px 12px;border:none;border-radius:8px;background:#dcfce7;color:#15803d;font-weight:700;font-size:11px;cursor:pointer">
                                📥 Excel
                            </button>
                            <button data-empresa="${g.empresa.replace(/"/g,'&quot;')}" onclick="event.stopPropagation();window._solBorrarEmpresa(this.dataset.empresa)"
                                title="Borrar TODA la asignación de esta empresa" style="padding:6px 12px;border:none;border-radius:8px;background:#fee2e2;color:#b91c1c;font-weight:700;font-size:11px;cursor:pointer">
                                🗑️ Borrar empresa
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
            body.innerHTML=`
                <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
                    <span style="font-size:20px">💡</span>
                    <span style="font-size:13px;color:#92400e;font-weight:600">Haz clic en el nombre de la empresa para ver o colapsar la lista de trabajadores.</span>
                </div>
                ${cards}`;
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
            await supabase.from('v2_camas').update({estado:'Disponible'}).eq('id_cama', id_cama);
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
            await supabase.from('v2_camas').update({estado:'Disponible'}).eq('id_cama', asigs[0].id_cama);
            await supabase.from('v2_asignaciones').delete().eq('id', asigs[0].id);
        }

        // 2. Buscar solicitud para saber empresa_id y fechas
        const {data:sol} = await supabase.from('v2_solicitudes_b2b').select('*').eq('id',solicitudId).single();
        if(!sol) throw new Error('Solicitud no encontrada');

        // 3. Buscar empresa_id
        const {data:empRows} = await supabase.from('v2_empresas').select('id').ilike('nombre',empresa).limit(1);
        const empresaId = empRows?.[0]?.id || null;

        // 4. Buscar cama disponible
        const {data:camas} = await supabase.from('v2_camas').select('id_cama,habitacion_id')
            .eq('estado','Disponible').limit(1);
        if(!camas?.length) throw new Error('No hay camas disponibles en el campamento');
        const cama = camas[0];

        // 5. Crear asignación
        const {error:eAsig} = await supabase.from('v2_asignaciones').insert({
            id_cama:                 cama.id_cama,
            rut_huesped:             rut,
            empresa_id:              empresaId,
            fecha_checkin:           sol.fecha_llegada || new Date().toISOString().split('T')[0],
            fecha_salida_programada: sol.fecha_salida  || null,
            fecha_checkout:          null,
            numero_contrato:         contrato || null
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
                    .update({estado:'Disponible'}).in('id_cama', camaIds);
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


