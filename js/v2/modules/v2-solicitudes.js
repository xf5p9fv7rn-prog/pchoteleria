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
        _fetchAllPages('v2_asignaciones', 'id_cama,empresa_id,fecha_salida_programada,rut_huesped', 'id_cama',
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
                            .update({ fecha_checkout: ahora, estado_asignacion: 'checkout_rotacion' })
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
        const rut = row.rut_trabajador ? String(row.rut_trabajador).replace(/[.\-\s]/g,'').trim().toUpperCase().slice(0,12) : null;
        const nombre=row.nombre_trabajador||'';
        const habPedida=row.hab_solicitada?String(row.hab_solicitada).replace(/[.,\s]/g,'').trim():'';
        const rowCheckin = row.fecha_llegada || hoy;
        const rowSalida  = row.fecha_salida  || null;

        if(!rut||!nombre){ fallidos.push(`RUT/nombre vacío`); continue; }

        // ── ¿Este RUT ya tiene asignación activa? → NUNCA duplicar ─────────────────────
        const camaActualDelRut = rutACamaActiva[rut];
        if(camaActualDelRut) {
            console.log(`[Motor] ⏭ ${nombre} (${rut}) ya tiene cama activa ${camaActualDelRut} — omitido (DB)`);
            rowsActualizadas.push(row.id);
            continue;
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

        // ── Sin cama en hab_pedida → DETENER, no reubicar automaticamente ─────────
        // REGLA CRITICA: si el trabajador venia con hab_solicitada y la hab
        //    esta llena o no existe, registrar el problema y parar aqui.
        //    NO asignar a otra habitacion para evitar reacciones en cadena.
        if (!camaAsignada && habPedida) {
            const habExiste = !!habByNumero[habPedida];
            const razon = habExiste
                ? `Hab. ${habPedida} llena o sin camas libres en las fechas solicitadas`
                : `Hab. ${habPedida} no existe en el sistema`;
            console.warn(`[Motor] DETENIDO ${nombre}: ${razon} - intervencion manual requerida`);
            sinAsignar.push({ nombre, rut, habPedida, razon, sugerencias: [], rowId: row.id });
            continue; // no asignar a ninguna otra hab
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
            // Para cada cama en rotación, registrar la fecha_checkout del ocupante saliente
            for(const camaId of camasRotacionNuevas) {
                const nuevaLlegada = asignaciones.find(a => a.id_cama === camaId)?.fecha_checkin || hoy;
                const {error: errCO} = await supabase.from('v2_asignaciones')
                    .update({ fecha_checkout: nuevaLlegada })
                    .eq('id_cama', camaId)
                    .is('fecha_checkout', null);
                if(errCO) console.warn(`[Motor] ⚠️ Checkout rotación cama ${camaId}:`, errCO.message);
                else console.log(`[Motor] 🔄 Checkout automático cama ${camaId} → fecha ${nuevaLlegada}`);
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

            const { error: errIns } = await supabase.from('v2_asignaciones').insert(asig);

            if (!errIns) {
                // INSERT exitoso
                rowsInsertados.push(rowId);
            } else if (errIns.code === '23505') {
                // Conflicto de clave única — actualizar asignación existente
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
    const contrato = rows[0]?.n_contrato||'—';
    const fechaLlegada = rows[0]?.fecha_llegada||null;
    const fechaSalida  = rows[0]?.fecha_salida||null;
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
        // Refrescar la vista de solicitudes pendientes
        window._renderV2Solicitudes?.();
    } catch(e) {
        if (inp) { inp.disabled = false; inp.style.opacity = '1'; }
        alert('❌ Error al guardar habitación: ' + e.message);
    }
};

// ── Borrar SOLO la lista de solicitudes (sin tocar asignaciones/camas) ──────
// ── _solBorrarListaEmpresa: alias de compatibilidad → usa _solBorrarLista ─────
window._solBorrarListaEmpresa = function(empresa) {
    // Busca el gKey cuya metadata tenga esa empresa
    const meta = window._gruposMetadata || {};
    const key = Object.keys(meta).find(k => meta[k].empresa === empresa);
    if(key != null) { window._solBorrarLista(parseInt(key)); }
    else { toast('⚠️ Recarga la página antes de borrar', 'warn'); }
};

/**
 * _solBorrarLista(gKey)
 * Borra ÚNICAMENTE los registros de la lista seleccionada por sus IDs.
 * NO filtra por empresa — garantiza que otras listas de la misma empresa
 * no sean afectadas aunque tengan el mismo contrato.
 */
window._solBorrarLista = async function(gKey) {
    const data = window._gruposData[gKey];
    const rows = Array.isArray(data) ? data : (data?.allRows || data?.rows || []);
    const meta = (window._gruposMetadata || {})[gKey] || {};
    const empresa = meta.empresa || rows[0]?.empresa || 'esta empresa';
    const ids = (meta.ids?.length ? meta.ids : rows.map(r => r.id)).filter(Boolean);
    const ruts = [...new Set(rows.map(r => r.rut_trabajador).filter(Boolean))];

    if(!ids.length) { toast('No hay registros en esta lista', 'warn'); return; }
    if(!await _solConfirm(
        `¿Borrar esta lista de ${ids.length} solicitudes de "${empresa}"?\n\n` +
        `Período: ${meta.fechaIn||'—'} → ${meta.fechaOut||'—'}\n` +
        `N° Contrato: ${meta.contrato||'—'}\n\n` +
        `• Se hará Check-Out de los trabajadores asignados\n` +
        `• Las camas quedarán libres\n` +
        `• Desaparecerán de Control de Asistencia e Infraestructura\n` +
        `Solo se elimina ESTA lista — otras listas no se ven afectadas.`,
        {confirmText:'🗑️ Borrar y liberar', danger:true}
    )) return;

    // ── Overlay de progreso ────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `<div style="background:#fff;border-radius:20px;padding:32px 40px;text-align:center;min-width:340px">
        <div style="font-size:36px;margin-bottom:10px">🗑️</div>
        <div style="font-weight:900;font-size:15px;margin-bottom:6px">Borrando lista: ${empresa}</div>
        <div id="_bl_txt" style="font-size:13px;color:#64748b;min-height:20px;margin-bottom:12px">Preparando…</div>
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
        // PASO 1: Obtener detalles de las solicitudes y empresa
        const {data:sols} = await supabase.from('v2_solicitudes_b2b').select('rut_trabajador,nombre_trabajador').in('id', ids);
        const rutsNorm = [...new Set((sols||[]).map(s=>String(s.rut_trabajador||'').replace(/[.\-\s]/g,'').toUpperCase().slice(0,12)).filter(Boolean))];
        const nombresNorm = [...new Set((sols||[]).map(s=>s.nombre_trabajador).filter(Boolean))];
        
        const {data:empRows} = await supabase.from('v2_empresas').select('id').ilike('nombre', empresa).limit(1);
        const empId = empRows?.[0]?.id;

        setStep(`Buscando asignaciones activas de la lista…`, 20);
        let asigIds = [], camaIds = [];
        
        // PASO 2: Buscar asignaciones activas (fecha_checkout=null) por RUT o Nombre + Empresa
        if(empId && (rutsNorm.length > 0 || nombresNorm.length > 0)) {
            let query = supabase.from('v2_asignaciones').select('id,id_cama').is('fecha_checkout', null).eq('empresa_id', empId);
            
            // Construir filtro OR para RUT o Nombres
            let orFiltros = [];
            if (rutsNorm.length > 0) orFiltros.push(`rut_huesped.in.(${rutsNorm.join(',')})`);
            if (nombresNorm.length > 0) orFiltros.push(`nombre_huesped.in.(${nombresNorm.map(n=>`"${n}"`).join(',')})`);
            
            query = query.or(orFiltros.join(','));
            
            const {data:asigs} = await query;
            asigIds  = (asigs||[]).map(a => a.id);
            camaIds  = [...new Set((asigs||[]).map(a => a.id_cama).filter(Boolean))];
        }

        // PASO 3: Liberar camas INMEDIATAMENTE
        setStep(`Liberando ${camaIds.length} camas…`, 45);
        if(camaIds.length) {
            for(let i = 0; i < camaIds.length; i += 50) {
                await supabase.from('v2_camas')
                    .update({ estado: 'Disponible' })
                    .in('id_cama', camaIds.slice(i, i + 50))
                    .neq('estado', 'Deshabilitada');
            }
        }

        // PASO 4: Eliminar asignaciones por completo (DELETE)
        setStep(`Borrando ${asigIds.length} asignaciones…`, 65);
        if(asigIds.length) {
            for(let i = 0; i < asigIds.length; i += 50) {
                await supabase.from('v2_asignaciones')
                    .delete()
                    .in('id', asigIds.slice(i, i + 50));
            }
        }

        // PASO 5: Eliminar solicitudes de B2B
        setStep('Eliminando solicitudes…', 85);
        const {error} = await supabase.from('v2_solicitudes_b2b').delete().in('id', ids);
        if(error) throw new Error(error.message);

        setStep('✅ Lista borrada', 100);
        await new Promise(r => setTimeout(r, 700));
        overlay.remove();
        toast(
            `✅ Lista de "${empresa}" borrada · ${asigIds.length} checkout · ${camaIds.length} camas liberadas`,
            'success'
        );
        window._renderV2Solicitudes?.();
        refreshBadge();
    } catch(e) {
        overlay.remove();
        alert('❌ Error al borrar lista:\n'+e.message);
    }
};

// ── Borrar UN SOLO trabajador de la lista (checkout + liberar cama + eliminar solicitud) ──
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
                <p style="font-size:13px;color:#64748b;margin:4px 0 0">Agrupadas por empresa · Motor V2</p>
            </div>
            <button onclick="window._renderV2Solicitudes()" style="padding:9px 18px;border:none;border-radius:10px;background:#c0392b;color:#fff;font-weight:700;font-size:13px;cursor:pointer">🔄 Actualizar</button>
        </div>
        <div id="sol-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px"></div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
            <button class="sol-tab active" id="tab-pending" onclick="window._solTab('pending')">⏳ Pendientes <span id="tab-cnt"></span></button>
            <button id="tab-conhab"
                style="padding:10px 22px;border:none;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;background:linear-gradient(135deg,#15803d,#22c55e);color:#fff;box-shadow:0 2px 10px rgba(21,128,61,.35);display:flex;align-items:center;gap:6px"
                onclick="window._solCargarExcelConHab()">📂 Cargas con Habitación
            </button>
            <button class="sol-tab" id="tab-history" onclick="window._solTab('history')">📋 Historial</button>
        </div>
        <!-- Input oculto para Excel de habitaciones -->
        <input type="file" id="_sol-excel-conhab" accept=".xlsx,.xls,.csv" style="display:none"
               onchange="window._solProcesarExcelConHab(this)">
        <div id="sol-body"></div>
    </div>`;

    window._renderV2Solicitudes = () => renderV2Solicitudes(container);
    window._solTab = t => renderTab(t);

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

    // ── Botón "Cargas con Habitación" ───────────────────────────────────
    window._solCargarExcelConHab = function() {
        const inp = document.getElementById('_sol-excel-conhab');
        if(inp) { inp.value = ''; inp.click(); }
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
            const cRut = fc('rut','run','dni','cedula','identificacion','id trabajador','pt','employee','empid','cod trab','num trab','id trab','nro trab','numero trab');
            // Empresa
            const cEmp = fc('empresa','company','contratista','razon social','razon_social','cliente');
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

                registros.push({
                    empresa:           empresaDesdeArchivo || emp || 'Sin empresa',
                    nombre_trabajador: nom||rut,
                    rut_trabajador:    rut||null,
                    genero:            gen,
                    turno:             tipo,          // ← GUARDADO (columna L del Excel)
                    n_contrato:        con||null,
                    gerencia:          ger||null,
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
            // ── Agrupar por CARGA: empresa + contrato + fecha_llegada + fecha_salida
            // Regla: misma empresa con mismo contrato Y mismas fechas = misma lista.
            // Misma empresa con distinto contrato O distintas fechas = listas separadas.
            const grupos={};
            for(const r of reqs) {
                const key=(r.empresa||'Sin empresa')+'||'+(r.n_contrato||'')+'||'+(r.fecha_llegada||'')+'||'+(r.fecha_salida||'');
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
                const key=(r.empresa||'Sin empresa')+'||'+(r.n_contrato||'')+'||'+(r.fecha_llegada||'sin-llegada')+'||'+(r.fecha_salida||'sin-salida');
                if(!grupos[key]) grupos[key]={
                    empresa:  r.empresa||'Sin empresa',
                    contrato: r.n_contrato||null,
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

            // ── Guardar todos los grupos para filtrado ──
            window._histGrupos = Object.values(grupos);
            window._histSortAsc = true;

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
                  ⬆️ Más antigua
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
                    return true;
                });
                filtered.sort((a,b)=>{
                    const ec = a.empresa.localeCompare(b.empresa);
                    if (ec !== 0) return ec;
                    const cmp = (a.fechaIn||'').localeCompare(b.fechaIn||'');
                    return asc ? cmp : -cmp;
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
                .in('id_cama', camaIds);
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


