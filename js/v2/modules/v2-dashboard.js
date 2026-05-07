/**
 * v2-dashboard.js — Dashboard de Ocupación V2
 * Consume getReporteOcupacion() del servicio centralizado.
 */
import { getReporteOcupacion, getAsignacionesActivas, ejecutarAutoRotacion, getSinCheckout, getReportePabellones } from '../v2-service.js';
import { supabase } from '../../supabaseClient.js';

export async function renderV2Dashboard(container) {
    container.innerHTML = getSkeletonHTML();
    try {
        // ─ Auto-rotación: ejecutar al cargar (silencioso, no bloquea el render) ─
        ejecutarAutoRotacion().then(async ({ autoCheckout }) => {
            if (autoCheckout && autoCheckout.length > 0) {
                const banner = document.getElementById('v2-rotacion-banner');
                if (banner) {
                    banner.style.display = 'flex';
                    banner.querySelector('[data-count]').textContent = autoCheckout.length;
                }
            }
        }).catch(e => console.warn('[Rotación] Error auto-rotación:', e));

        const [{ reporte, totales }, activas, distData, reportePabs] = await Promise.all([
            getReporteOcupacion(),
            getAsignacionesActivas({ limit: 10 }),
            supabase.from('v2_distribucion_camas').select('id_cama, tipo, etiqueta'),
            getReportePabellones(),
        ]);

        const { total_camas: totalCamas, camas_ocupadas: totalOcup,
                camas_disponibles: totalDisp, camas_mantencion: totalMant } = totales;
        const pctGlobal  = totalCamas > 0 ? Math.round((totalOcup / totalCamas) * 100) : 0;
        const dist       = distData.data || [];

        // Tipos de camas desde distribución
        const nocheSet   = new Set(dist.filter(d => d.tipo === 'noche').map(d => String(d.id_cama)));
        const angloSet   = new Set(dist.filter(d => d.tipo === 'anglo').map(d => String(d.id_cama)));
        const reservaSet = new Set(dist.filter(d => d.tipo === 'reserva').map(d => String(d.id_cama)));
        const bodegaSet  = new Set(dist.filter(d => d.tipo === 'bodega').map(d => String(d.id_cama)));
        const camas4x3   = dist.filter(d => d.tipo === '4x3').length;
        const empresasTag= [...new Set(dist.filter(d=>d.tipo==='empresa'&&d.etiqueta).map(d=>d.etiqueta))];

        // Detección rápida de camas perdidas + cálculos de disponibilidad por tipo (paginado)
        let camasPerd = 0, camasPerdAnglo = 0, camasPerdEECC = 0, dispNoche = 0, dispAnglo = 0, habMant = 0,
            dispEECC = 0, totalEECC = 0;
        let dispAngloNoche = 0, dispAngloDia = 0, totalAngloNoche = 0, totalAngloDia = 0;
        try {
            const _fetchPag = async (tabla, sel, filtro=null) => {
                let all=[],pg=0;
                while(true){
                    let q=supabase.from(tabla).select(sel).range(pg*1000,pg*1000+999);
                    if(filtro)q=filtro(q);
                    const{data,error}=await q; if(error)break;
                    if(data?.length)all=all.concat(data);
                    if(!data||data.length<1000)break; pg++; if(pg>20)break;
                }
                return all;
            };
            const [camTodos, asigActivasExt, empresasData] = await Promise.all([
                _fetchPag('v2_camas','id_cama,habitacion_id,estado,numero_cama'),
                _fetchPag('v2_asignaciones','id_cama,empresa_id',q=>q.is('fecha_checkout',null)),
                supabase.from('v2_empresas').select('id,nombre').limit(500),
            ]);
            const asigSet    = new Set(asigActivasExt.map(a=>String(a.id_cama)));
            const asigEmpMap = {}; asigActivasExt.forEach(a=>{ asigEmpMap[String(a.id_cama)]=a.empresa_id; });
            const empNomMap  = {}; (empresasData.data||[]).forEach(e=>{ empNomMap[e.id]=e.nombre||''; });
            const isAngloNom = n => /anglo/i.test(n||'');

            // Camas perdidas (excluye Deshabilitadas) + split Anglo vs EECC
            const porHab={};
            camTodos.filter(c=>c.estado!=='Deshabilitada').forEach(c=>{const h=String(c.habitacion_id);if(!porHab[h])porHab[h]=[];porHab[h].push(c);});
            Object.values(porHab).forEach(cs=>{
                if(cs.length<2)return;
                const camasOcup=cs.filter(c=>c.estado==='Ocupada'||asigSet.has(String(c.id_cama)));
                const ocup=camasOcup.length;
                const libre=cs.length-ocup;
                if(ocup>0&&libre>0){
                    camasPerd+=libre;
                    // Empresa del primer ocupante para clasificar Anglo vs EECC
                    const empId  = camasOcup[0] ? asigEmpMap[String(camasOcup[0].id_cama)] : null;
                    const empNom = empId ? empNomMap[empId] : '';
                    if(isAngloNom(empNom)) camasPerdAnglo+=libre;
                    else                  camasPerdEECC  +=libre;
                }
            });

            // Para Anglo: cama 1 = día, cama 2 = noche
            const angloNocheSet = new Set(
                camTodos.filter(c => angloSet.has(String(c.id_cama)) && Number(c.numero_cama) === 2)
                        .map(c => String(c.id_cama))
            );
            const angloDiaSet = new Set(
                camTodos.filter(c => angloSet.has(String(c.id_cama)) && Number(c.numero_cama) === 1)
                        .map(c => String(c.id_cama))
            );

            // Disponibles (disponible = no Ocupada, no Mantención, sin asignacion activa)
            const esDisp = c => c.estado !== 'Ocupada' && c.estado !== 'Mantencion' && c.estado !== 'Mantención' && c.estado !== 'Deshabilitada' && !asigSet.has(String(c.id_cama));

            // Noche regular (tipo='noche', no Anglo) + Anglo noche (cama 2)
            dispNoche      = camTodos.filter(c => nocheSet.has(String(c.id_cama)) && esDisp(c)).length;
            dispAngloNoche = camTodos.filter(c => angloNocheSet.has(String(c.id_cama)) && esDisp(c)).length;
            dispAngloDia   = camTodos.filter(c => angloDiaSet.has(String(c.id_cama)) && esDisp(c)).length;

            totalAngloNoche = angloNocheSet.size;
            totalAngloDia   = angloDiaSet.size;

            // EECC: camas que no son Anglo, ni Noche, ni Reserva, ni Bodega
            const eeccSet = new Set(
                camTodos
                    .filter(c => c.estado !== 'Deshabilitada'
                             && !angloSet.has(String(c.id_cama))
                             && !nocheSet.has(String(c.id_cama))
                             && !reservaSet.has(String(c.id_cama))
                             && !bodegaSet.has(String(c.id_cama)))
                    .map(c => String(c.id_cama))
            );
            dispEECC  = camTodos.filter(c => eeccSet.has(String(c.id_cama)) && esDisp(c)).length;
            totalEECC = eeccSet.size;

            // Habitaciones en mantención (TODAS sus camas en mantención)
            Object.values(porHab).forEach(cs => {
                const enMant = cs.every(c => c.estado === 'Mantencion' || c.estado === 'Mantención');
                if (enMant) habMant++;
            });
        } catch(e){ console.warn('[dashboard] cálculos ext:', e); }

        const totalNoche    = nocheSet.size;
        const totalReserva  = reservaSet.size;
        const totalBodega   = bodegaSet.size;

        // Separar edificios COPC vs R-220
        const reporteCOPC = reporte.filter(r => !String(r.edificio||'').match(/r.?220/i));
        const reporteR220 = reporte.filter(r =>  String(r.edificio||'').match(/r.?220/i));
        const subTot = arr => ({
            cam: arr.reduce((s,r)=>s+(r.total_camas||0),0),
            ocu: arr.reduce((s,r)=>s+(r.camas_ocupadas||0),0),
            dis: arr.reduce((s,r)=>s+(r.camas_disponibles||0),0),
            man: arr.reduce((s,r)=>s+(r.camas_mantencion||0),0),
        });
        const stCOPC = subTot(reporteCOPC);
        const stR220 = subTot(reporteR220);
        const pctCOPC = stCOPC.cam > 0 ? Math.round(stCOPC.ocu/stCOPC.cam*100) : 0;
        const pctR220 = stR220.cam > 0 ? Math.round(stR220.ocu/stR220.cam*100) : 0;

        // Guardar desglose para modal clickable
        window._dashBreakdowns = {
            'Total Camas':    { copc:stCOPC.cam, r220:stR220.cam, unit:'',  label:'camas totales' },
            'Disponibles':    { copc:stCOPC.dis, r220:stR220.dis, unit:'',  label:'camas disponibles' },
            'Ocupadas':       { copc:stCOPC.ocu, r220:stR220.ocu, unit:'',  label:'camas ocupadas' },
            'Ocupación':      { copc:pctCOPC,    r220:pctR220,    unit:'%', label:'% de ocupación', isAvg:true },
            'En Mantención':  { copc:stCOPC.man, r220:stR220.man, unit:'',  label:'en mantención' },
        };

        container.innerHTML = `
        <div style="padding:10px 16px;max-width:1400px;margin:0 auto">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
            <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">📊</div>
            <div>
              <h1 style="font-size:18px;font-weight:800;color:var(--text-primary);margin:0">Dashboard de Ocupación</h1>
              <p style="font-size:12px;color:var(--text-secondary);margin:0">Tiempo real · ${new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'})}</p>
            </div>
            <button onclick="window.navigate('v2dashboard')" style="margin-left:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text-primary)">🔄 Actualizar</button>
          </div>

          <!-- PANEL 1: INVENTARIO GLOBAL -->
          <details open style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(99,102,241,.08);margin-bottom:0">
            <summary style="cursor:pointer;list-style:none;padding:13px 16px;user-select:none">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px">📊</div>
                  <div>
                    <div style="font-weight:800;font-size:13px;color:var(--text-primary)">Inventario General</div>
                    <div style="font-size:11px;color:var(--text-muted)">${totalCamas} camas &nbsp;·&nbsp; 🟢 ${totalDisp} disp. &nbsp;·&nbsp; 🔴 ${totalOcup} ocup.${habMant>0?` · 🟡 ${habMant} mant.`:''}</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:20px;font-weight:900;color:${pctGlobal>80?'#ef4444':pctGlobal>50?'#f59e0b':'#6366f1'}">${pctGlobal}%</span>
                  <span style="color:var(--text-muted)">⌄</span>
                </div>
              </div>
              <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px"><div style="height:100%;width:${pctGlobal}%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:2px"></div></div>
            </summary>
            <div style="border-top:1px solid var(--border);padding:10px 12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px">
              ${kpi('🛏️','Total Camas',totalCamas,'#6366f1','Total Camas')}
              ${kpi('✅','Disponibles',totalDisp,'#10b981','Disponibles')}
              ${kpi('🔴','Ocupadas',totalOcup,'#ef4444','Ocupadas')}
              ${kpi('📊','Ocupación',pctGlobal+'%',pctGlobal>80?'#ef4444':pctGlobal>50?'#f59e0b':'#10b981','Ocupación')}
              ${habMant>0?kpi('🟡','En Mantención',habMant,'#f59e0b','En Mantención'):''}
              ${totalBodega>0?kpi('📦','Bodegas',totalBodega,'#64748b'):''}
              ${totalReserva>0?kpi('📌','En Reserva',totalReserva,'#7c3aed'):''}
            </div>
          </details>

          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px;align-items:start">
          <!-- PANEL 2: ANGLO + NOCHE -->
          ${(totalAngloNoche>0||totalAngloDia>0)?`
          <details style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(217,119,6,.07)">
            <summary style="cursor:pointer;list-style:none;padding:13px 16px;user-select:none">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="background:linear-gradient(135deg,#d97706,#4338ca);border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px">⛏️</div>
                  <div>
                    <div style="font-weight:800;font-size:13px;color:var(--text-primary)">Anglo · Noche Especial</div>
                    <div style="font-size:11px;color:var(--text-muted)">⛏️ ${totalAngloDia+totalAngloNoche} Anglo &nbsp;·&nbsp; ${dispAngloDia+dispAngloNoche} disp.</div>
                  </div>
                </div>
                <span style="color:var(--text-muted)">⌄</span>
              </div>
              <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px"><div style="height:100%;width:${totalNoche>0?Math.round(((totalNoche-dispNoche)/totalNoche)*100):0}%;background:linear-gradient(90deg,#4338ca,#6366f1);border-radius:2px"></div></div>
            </summary>
            <div style="border-top:1px solid var(--border);padding:10px 12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px">
              ${totalAngloDia>0?kpi('☀️','Anglo Día',totalAngloDia,'#d97706'):''}
              ${totalAngloDia>0?kpi('✅','Disp. Día',dispAngloDia,'#f59e0b'):''}
              ${totalAngloNoche>0?kpi('🌙','Anglo Noche',totalAngloNoche,'#4338ca'):''}
              ${totalAngloNoche>0?kpi('✅','Disp. Noche',dispAngloNoche,'#6366f1'):''}
              ${camas4x3>0?kpi('🔄','Turno 4×3',camas4x3,'#0891b2'):''}
            </div>
          </details>`:``}

          <!-- PANEL 3: EECC CONTRATISTAS -->
          ${totalEECC>0?`
          <details style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(8,145,178,.07)">
            <summary style="cursor:pointer;list-style:none;padding:13px 16px;user-select:none">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="background:linear-gradient(135deg,#0891b2,#0d9488);border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px">🏢</div>
                  <div>
                    <div style="font-weight:800;font-size:13px;color:var(--text-primary)">EECC — Contratistas</div>
                    <div style="font-size:11px;color:var(--text-muted)">${totalEECC} EECC &nbsp;·&nbsp; 🌙 ${totalNoche} Noche &nbsp;·&nbsp; 🟢 ${dispEECC+dispNoche} disp.</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:20px;font-weight:900;color:${(totalEECC-dispEECC)/totalEECC>0.8?'#ef4444':'#0891b2'}">${Math.round(((totalEECC-dispEECC)/totalEECC)*100)}%</span>
                  <span style="color:var(--text-muted)">⌄</span>
                </div>
              </div>
              <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px"><div style="height:100%;width:${Math.round(((totalEECC-dispEECC)/totalEECC)*100)}%;background:linear-gradient(90deg,#0891b2,#0d9488);border-radius:2px"></div></div>
            </summary>
            <div style="border-top:1px solid var(--border);padding:10px 12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px">
              ${kpi('🏢','Total EECC',totalEECC,'#0891b2')}
              ${kpi('✅','Disp. EECC',dispEECC,'#0d9488')}
              ${kpi('🔴','Ocup. EECC',totalEECC-dispEECC,'#dc2626')}
              ${kpi('📊','Ocup. %',Math.round(((totalEECC-dispEECC)/totalEECC)*100)+'%','#0891b2')}
              ${totalNoche>0?kpi('🌙','Total Noche',totalNoche,'#4338ca'):''}
              ${totalNoche>0?kpi('✅','Disp. Noche',dispNoche,'#6366f1'):''}
            </div>
          </details>`:``}

          <!-- PANEL CAMAS PERDIDAS — mismo estilo paneles arriba -->
          ${camasPerd>0?`
          <details style="background:var(--bg-card);border:1.5px solid #fca5a5;border-top:3px solid #ef4444;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(239,68,68,.10)">
            <summary style="cursor:pointer;list-style:none;padding:13px 16px;user-select:none">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="background:linear-gradient(135deg,#ef4444,#b91c1c);border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px">🛏️</div>
                  <div>
                    <div style="font-weight:800;font-size:13px;color:#b91c1c">Camas Perdidas Detectadas</div>
                    <div style="display:flex;gap:6px;margin-top:2px;flex-wrap:wrap;align-items:center">
                      <span style="font-size:11px;color:var(--text-muted)">${camasPerd} total</span>
                      ${camasPerdAnglo>0?`<span style="background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:99px;font-size:10px;font-weight:700">⛏️ Anglo: ${camasPerdAnglo}</span>`:''}
                      ${camasPerdEECC>0?`<span style="background:#dbeafe;color:#1e40af;padding:1px 7px;border-radius:99px;font-size:10px;font-weight:700">🏢 EECC: ${camasPerdEECC}</span>`:''}
                    </div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:20px;font-weight:900;color:#ef4444">${camasPerd}</span>
                  <span style="color:var(--text-muted)">⌄</span>
                </div>
              </div>
              <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px">
                <div style="height:100%;width:100%;background:linear-gradient(90deg,#ef4444,#f87171);border-radius:2px"></div>
              </div>
            </summary>
            <div style="border-top:1px solid #fca5a5;padding:10px 12px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
              <div style="background:rgba(239,68,68,.06);border:1.5px solid rgba(239,68,68,.25);border-top:3px solid #ef4444;border-radius:12px;padding:10px 12px;text-align:center">
                <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">🛏️ Total</div>
                <div style="font-size:28px;font-weight:900;color:#ef4444;line-height:1">${camasPerd}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">camas perdidas</div>
              </div>
              ${camasPerdAnglo>0?`
              <div style="background:rgba(217,119,6,.06);border:1.5px solid rgba(217,119,6,.25);border-top:3px solid #d97706;border-radius:12px;padding:10px 12px;text-align:center">
                <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">⛏️ Anglo</div>
                <div style="font-size:28px;font-weight:900;color:#d97706;line-height:1">${camasPerdAnglo}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">camas perdidas</div>
              </div>`:``}
              ${camasPerdEECC>0?`
              <div style="background:rgba(8,145,178,.06);border:1.5px solid rgba(8,145,178,.25);border-top:3px solid #0891b2;border-radius:12px;padding:10px 12px;text-align:center">
                <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">🏢 EECC</div>
                <div style="font-size:28px;font-weight:900;color:#0891b2;line-height:1">${camasPerdEECC}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">camas perdidas</div>
              </div>`:``}
              <div onclick="window.navigate('v2camasperdidas')" style="cursor:pointer;background:linear-gradient(135deg,#ef4444,#b91c1c);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:80px">
                <div style="font-size:18px">🔍</div>
                <div style="font-size:11px;font-weight:800;color:white;text-align:center">Ver Detalle</div>
                <div style="font-size:10px;color:rgba(255,255,255,.7)">Camas Perdidas →</div>
              </div>
            </div>
          </details>`:``}

          <!-- Banner auto-rotación (se activa si hubo checkouts automáticos hoy) -->
          <div id="v2-rotacion-banner" style="display:none;background:linear-gradient(135deg,rgba(249,115,22,.10),rgba(249,115,22,.04));
            border:1.5px solid #fdba74;border-radius:14px;padding:14px 18px;margin-bottom:16px;
            align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="font-size:28px">⚠️</div>
              <div>
                <div style="font-weight:800;font-size:15px;color:#c2410c">
                  <span data-count>0</span> trabajador(es) sin check-out manual hoy
                </div>
                <div style="font-size:12px;color:var(--text-muted)">Rotación automática ejecutada · Sus salidas fueron registradas por el sistema</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button onclick="window.navigate&&window.navigate('sincheckout')"
                style="background:#f97316;color:white;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
                Ver Informe →
              </button>
              <button onclick="document.getElementById('v2-rotacion-banner').style.display='none'"
                style="background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">
                ✕
              </button>
            </div>
          </div>

          <!-- Etiquetas empresa activas -->
          ${empresasTag.length>0?`
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">🏢 Empresas con hab. asignadas:</span>
            ${empresasTag.map(e=>`<span style="background:#ecfdf5;color:#059669;border-radius:6px;padding:2px 10px;font-size:12px;font-weight:700">${e}</span>`).join('')}
          </div>`:''}

          <!-- PANEL OCUPACIÓN GLOBAL -->
          <details style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(99,102,241,.07)">
            <summary style="cursor:pointer;list-style:none;padding:13px 16px;user-select:none">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px">📈</div>
                  <div>
                    <div style="font-weight:800;font-size:13px;color:var(--text-primary)">Ocupación Global</div>
                    <div style="font-size:11px;color:var(--text-muted)">🟢 ${totalDisp} disp. &nbsp;·&nbsp; 🔴 ${totalOcup} ocup. &nbsp;·&nbsp; 🟡 ${totalMant} mant.</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:20px;font-weight:900;color:${pctGlobal>80?'#ef4444':pctGlobal>50?'#f59e0b':'#6366f1'}">${pctGlobal}%</span>
                  <span style="color:var(--text-muted)">⌄</span>
                </div>
              </div>
              <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px">
                <div style="height:100%;width:${pctGlobal}%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:2px;transition:width .8s"></div>
              </div>
            </summary>
            <div style="border-top:1px solid var(--border);padding:10px 12px">
              <div style="display:flex;gap:10px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
                <span>🟢 ${totalDisp} disp.</span><span>🔴 ${totalOcup} ocup.</span><span>🟡 ${totalMant} mant.</span>
                ${totalNoche>0?`<span>🌙 ${totalNoche} noche · ${dispNoche} disp.</span>`:''}
                ${(totalAngloNoche+totalAngloDia)>0?`<span>⛏️ ${totalAngloNoche+totalAngloDia} Anglo · ${dispAngloNoche+dispAngloDia} disp.</span>`:''}
              </div>
            </div>
          </details>
          </div>

          <!-- Por Edificio: COPC + R-220 — Diseño Premium -->
          <div style="display:grid;grid-template-columns:${reporteR220.length > 0 ? '1fr 1fr' : '1fr'};gap:14px;margin-bottom:12px;align-items:start">

            <!-- COPC Accordion -->
            <details open style="border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(30,41,59,.13)">
              <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;
                background:linear-gradient(135deg,#1e293b 0%,#334155 60%,#1e3a5f 100%);
                color:#fff;padding:14px 18px;user-select:none;border:none">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="background:rgba(255,255,255,.12);border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px">🏢</div>
                  <div>
                    <div style="font-weight:800;font-size:14px;letter-spacing:-.01em">COPC</div>
                    <div style="font-size:11px;opacity:.65;margin-top:1px">${stCOPC.cam} camas totales</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:12px">
                  <div style="text-align:right">
                    <div style="font-size:20px;font-weight:900;color:${pctCOPC>80?'#fca5a5':pctCOPC>50?'#fde68a':'#6ee7b7'}">${pctCOPC}%</div>
                    <div style="font-size:10px;opacity:.6">${stCOPC.dis} disp.</div>
                  </div>
                  <div style="font-size:18px;opacity:.5;transition:transform .2s">⌄</div>
                </div>
              </summary>
              <!-- Mini barra de progreso bajo el header -->
              <div style="height:4px;background:#0f172a">
                <div style="height:100%;width:${pctCOPC}%;background:linear-gradient(90deg,#6366f1,#8b5cf6);transition:width .8s ease"></div>
              </div>
              <div style="background:var(--bg-card);padding:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
                ${reportePabs.filter(p=>!String(p.edificio||'').match(/r.?220/i)).map(p=>pabelonCard(p)).join('')}
              </div>
            </details>

            ${reporteR220.length > 0 ? `
            <!-- R-220 Accordion -->
            <details open style="border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(49,46,129,.18)">
              <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;
                background:linear-gradient(135deg,#312e81 0%,#4338ca 60%,#3730a3 100%);
                color:#fff;padding:14px 18px;user-select:none;border:none">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="background:rgba(255,255,255,.12);border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px">🏗️</div>
                  <div>
                    <div style="font-weight:800;font-size:14px;letter-spacing:-.01em">R-220</div>
                    <div style="font-size:11px;opacity:.65;margin-top:1px">${stR220.cam} camas totales</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:12px">
                  <div style="text-align:right">
                    <div style="font-size:20px;font-weight:900;color:${pctR220>80?'#fca5a5':pctR220>50?'#fde68a':'#6ee7b7'}">${pctR220}%</div>
                    <div style="font-size:10px;opacity:.6">${stR220.dis} disp.</div>
                  </div>
                  <div style="font-size:18px;opacity:.5">⌄</div>
                </div>
              </summary>
              <div style="height:4px;background:#1e1b4b">
                <div style="height:100%;width:${pctR220}%;background:linear-gradient(90deg,#818cf8,#a78bfa);transition:width .8s ease"></div>
              </div>
              <div style="background:var(--bg-card);padding:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
                ${reportePabs.filter(p=>String(p.edificio||'').match(/r.?220/i)).map(p=>pabelonCard(p)).join('')}
              </div>
            </details>` : ''}

          </div>

          <!-- Últimos Check-ins colapsable -->
          <details style="margin-bottom:12px">
            <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;
              background:var(--bg-card);border:1px solid var(--border);padding:12px 18px;
              border-radius:12px;font-weight:700;font-size:13px;color:var(--text-primary);user-select:none">
              🛎️ Últimos Check-ins Activos
              <span style="background:#6366f1;color:#fff;border-radius:6px;padding:2px 8px;font-size:11px">${activas.length}</span>
              <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">▼ ver</span>
            </summary>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:0 0 12px 12px;overflow:hidden;overflow-x:auto">
              ${activas.length === 0
                ? `<div style="padding:30px;text-align:center;color:var(--text-muted)">Sin huéspedes activos</div>`
                : `<table style="width:100%;border-collapse:collapse;min-width:500px">
                    <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
                      ${['Huésped','RUT','Cama','Empresa','Check-in'].map(h=>`<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`).join('')}
                    </tr></thead>
                    <tbody>
                      ${activas.map((a,i)=>`<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg)'}">
                        <td style="padding:10px 14px;font-weight:600;font-size:13px">${a.nombre_huesped}</td>
                        <td style="padding:10px 14px;font-size:12px;font-family:monospace;color:var(--text-secondary)">${a.rut_huesped}</td>
                        <td style="padding:10px 14px;font-size:12px;font-family:monospace;color:#6366f1;font-weight:700">${a.id_cama}</td>
                        <td style="padding:10px 14px;font-size:12px;color:var(--text-secondary)">${a.v2_empresas?.nombre||'—'}</td>
                        <td style="padding:10px 14px;font-size:12px;color:var(--text-muted)">${a.fecha_checkin}</td>
                      </tr>`).join('')}
                    </tbody>
                  </table>`}
            </div>
          </details>

        </div>`;
    } catch(e) {
        console.error('[v2-dashboard]', e);
        container.innerHTML = `<div style="padding:40px;text-align:center">
          <div style="font-size:40px;margin-bottom:12px">⚠️</div>
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px">Error al cargar el dashboard</div>
          <div style="font-size:13px;color:#ef4444;font-family:monospace">${e.message}</div>
          <button onclick="window.navigate('v2dashboard')" style="margin-top:20px;background:#6366f1;color:white;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer">🔄 Reintentar</button>
        </div>`;
    }
}

function kpi(icon, label, value, color, key=null) {
    const clickable = key ? `onclick="window._dashModal('${key}',this)" title="Ver desglose por edificio"` : '';
    const hover = key ? ';cursor:pointer;transition:box-shadow .15s,transform .1s' : '';
    return `<div ${clickable} style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px 12px;border-top:3px solid ${color}${hover}">
      <div style="font-size:16px;margin-bottom:4px">${icon}${key?'<span style="float:right;font-size:10px;color:var(--text-muted);margin-top:1px">🔍</span>':''}</div>
      <div style="font-size:22px;font-weight:800;color:${color}">${value}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-top:1px">${label}</div>
    </div>`;
}

window._dashModal = (key, el) => {
    const d = window._dashBreakdowns?.[key];
    if (!d) return;
    // Quitar modal previo
    const prev = document.getElementById('dash-kpi-modal');
    if (prev) prev.remove();
    // Quitar active previo
    document.querySelectorAll('[data-dash-kpi-active]').forEach(e => {
        e.removeAttribute('data-dash-kpi-active');
        e.style.boxShadow = ''; e.style.transform = '';
    });
    // Marcar el card presionado
    if (el) {
        el.setAttribute('data-dash-kpi-active','1');
        el.style.boxShadow = '0 0 0 3px #6366f1, 0 4px 20px rgba(99,102,241,.35)';
        el.style.transform = 'scale(0.97)';
    }
    const clearActive = () => {
        if (el) { el.style.boxShadow=''; el.style.transform=''; el.removeAttribute('data-dash-kpi-active'); }
        const m = document.getElementById('dash-kpi-modal'); if(m) m.remove();
    };
    const copcVal = d.isAvg ? d.copc + d.unit : d.copc.toLocaleString('es-CL') + d.unit;
    const r220Val = d.isAvg ? d.r220 + d.unit : d.r220.toLocaleString('es-CL') + d.unit;
    const total   = d.isAvg
        ? Math.round((d.copc * 0.898 + d.r220 * 0.102)) + d.unit
        : (d.copc + d.r220).toLocaleString('es-CL') + d.unit;
    const overlay = document.createElement('div');
    overlay.id = 'dash-kpi-modal';
    overlay.innerHTML = `<div onclick="this.parentElement.remove();" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center">
      <div onclick="event.stopPropagation()" style="background:var(--bg-card);border-radius:20px 20px 0 0;padding:28px;width:100%;max-width:480px;box-shadow:0 -8px 40px rgba(0,0,0,.25)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div style="font-size:17px;font-weight:800;color:var(--text-primary)">🔍 Desglose: ${key}</div>
          <button onclick="this.closest('#dash-kpi-modal').remove();" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">×</button>
        </div>
        <div style="display:grid;gap:10px">
          <div style="display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;background:var(--bg);border-radius:12px;padding:14px">
            <div style="font-size:22px">🏗️</div>
            <div><div style="font-weight:700;font-size:14px">Campamento COPC</div><div style="font-size:12px;color:var(--text-muted)">Edificio principal</div></div>
            <div style="font-size:22px;font-weight:800;color:#6366f1">${copcVal}</div>
          </div>
          <div style="display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;background:var(--bg);border-radius:12px;padding:14px">
            <div style="font-size:22px">🏗️</div>
            <div><div style="font-weight:700;font-size:14px">Edificio R-220</div><div style="font-size:12px;color:var(--text-muted)">Bloque adicional</div></div>
            <div style="font-size:22px;font-weight:800;color:#8b5cf6">${r220Val}</div>
          </div>
          <div style="display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;background:rgba(99,102,241,.08);border:1.5px solid #6366f1;border-radius:12px;padding:14px">
            <div style="font-size:22px">∑</div>
            <div><div style="font-weight:800;font-size:14px;color:#6366f1">TOTAL COMBINADO</div></div>
            <div style="font-size:24px;font-weight:900;color:#6366f1">${total}</div>
          </div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('div').addEventListener('click', clearActive);
    overlay.querySelector('button').addEventListener('click', clearActive);
};

function edificioCard(r) {
    const pct = r.total_camas > 0 ? Math.round((r.camas_ocupadas / r.total_camas) * 100) : 0;
    const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981';
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:800;font-size:13px;color:var(--text-primary)">🏢 ${r.edificio}</span>
        <span style="font-weight:800;font-size:15px;color:${color}">${pct}%</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:5px">${r.total_camas} camas</div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
        <div style="text-align:center;background:rgba(16,185,129,0.08);border-radius:6px;padding:5px">
          <div style="font-weight:800;font-size:13px;color:#10b981">${r.camas_disponibles}</div><div style="font-size:9px;color:var(--text-muted)">Disp.</div>
        </div>
        <div style="text-align:center;background:rgba(239,68,68,0.08);border-radius:6px;padding:5px">
          <div style="font-weight:800;font-size:13px;color:#ef4444">${r.camas_ocupadas}</div><div style="font-size:9px;color:var(--text-muted)">Ocup.</div>
        </div>
        <div style="text-align:center;background:rgba(245,158,11,0.08);border-radius:6px;padding:5px">
          <div style="font-weight:800;font-size:13px;color:#f59e0b">${r.camas_mantencion}</div><div style="font-size:9px;color:var(--text-muted)">Mant.</div>
        </div>
      </div>
    </div>`;
}

// Tarjeta por pabellón — estilo KPI tile compacto (igual que los cuadros del top)
function pabelonCard(p) {
    const pct   = p.total_camas > 0 ? Math.round((p.camas_ocupadas / p.total_camas) * 100) : 0;
    const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981';
    const bord  = pct > 80 ? 'rgba(239,68,68,.35)' : pct > 50 ? 'rgba(245,158,11,.35)' : 'rgba(16,185,129,.35)';
    return `<div style="background:var(--bg-card);border:1.5px solid ${bord};border-top:3px solid ${color};border-radius:12px;padding:10px 12px;position:relative">
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">🏢 ${p.pabellon}</div>
      <div style="font-size:24px;font-weight:900;color:${color};line-height:1">${pct}%</div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">${p.total_camas} camas</div>
      <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:6px">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:2px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;font-size:10px;text-align:center">
        <div style="background:rgba(16,185,129,.08);border-radius:5px;padding:3px 0">
          <div style="font-weight:800;color:#10b981">${p.camas_disponibles}</div>
          <div style="color:var(--text-muted)">Disp.</div>
        </div>
        <div style="background:rgba(239,68,68,.08);border-radius:5px;padding:3px 0">
          <div style="font-weight:800;color:#ef4444">${p.camas_ocupadas}</div>
          <div style="color:var(--text-muted)">Ocup.</div>
        </div>
        <div style="background:rgba(245,158,11,.08);border-radius:5px;padding:3px 0">
          <div style="font-weight:800;color:#f59e0b">${p.camas_mantencion}</div>
          <div style="color:var(--text-muted)">Mant.</div>
        </div>
      </div>
    </div>`;
}

function getSkeletonHTML() {
    return `<div style="padding:20px;max-width:1200px;margin:0 auto">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px">
        ${Array(5).fill(0).map(()=>`<div style="height:90px;background:var(--border);border-radius:14px;animation:pulse 1.5s infinite"></div>`).join('')}
      </div>
      <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
    </div>`;
}
