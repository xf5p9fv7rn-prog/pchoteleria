/**
 * v2-dashboard.js — Dashboard de Ocupación V2
 * Consume getReporteOcupacion() del servicio centralizado.
 */
import { getReporteOcupacion, getAsignacionesActivas, ejecutarAutoRotacion, getSinCheckout } from '../v2-service.js';
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

        const [{ reporte, totales }, activas, distData] = await Promise.all([
            getReporteOcupacion(),
            getAsignacionesActivas({ limit: 10 }),
            supabase.from('v2_distribucion_camas').select('id_cama, tipo, etiqueta'),
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
        let camasPerd = 0, dispNoche = 0, dispAnglo = 0, habMant = 0;
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
            const [camTodos, asigActivas] = await Promise.all([
                _fetchPag('v2_camas','id_cama,habitacion_id,estado,numero_cama'),
                _fetchPag('v2_asignaciones','id_cama',q=>q.is('fecha_checkout',null)),
            ]);
            const asigSet = new Set(asigActivas.map(a=>String(a.id_cama)));

            // Camas perdidas
            const porHab={};
            camTodos.forEach(c=>{const h=String(c.habitacion_id);if(!porHab[h])porHab[h]=[];porHab[h].push(c);});
            Object.values(porHab).forEach(cs=>{
                if(cs.length<2)return;
                const ocup=cs.filter(c=>c.estado==='Ocupada'||asigSet.has(String(c.id_cama))).length;
                const libre=cs.length-ocup;
                if(ocup>0&&libre>0) camasPerd+=libre;
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
            const esDisp = c => c.estado !== 'Ocupada' && c.estado !== 'Mantencion' && c.estado !== 'Mantención' && !asigSet.has(String(c.id_cama));

            // Noche regular (tipo='noche', no Anglo) + Anglo noche (cama 2)
            dispNoche      = camTodos.filter(c => nocheSet.has(String(c.id_cama)) && esDisp(c)).length;
            dispAngloNoche = camTodos.filter(c => angloNocheSet.has(String(c.id_cama)) && esDisp(c)).length;
            dispAngloDia   = camTodos.filter(c => angloDiaSet.has(String(c.id_cama)) && esDisp(c)).length;

            totalAngloNoche = angloNocheSet.size;
            totalAngloDia   = angloDiaSet.size;

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
        <div style="padding:20px;max-width:1400px;margin:0 auto">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap">
            <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">📊</div>
            <div>
              <h1 style="font-size:22px;font-weight:800;color:var(--text-primary);margin:0">Dashboard de Ocupación</h1>
              <p style="font-size:13px;color:var(--text-secondary);margin:0">Tiempo real · ${new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'})}</p>
            </div>
            <button onclick="window.navigate('v2dashboard')" style="margin-left:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary)">🔄 Actualizar</button>
          </div>

          <!-- ═══ SECCIÓN 1: INVENTARIO GENERAL ═══ -->
          <div style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">📊 Inventario General</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">
            ${kpi('🛏️','Total Camas',totalCamas,'#6366f1','Total Camas')}
            ${kpi('✅','Disponibles',totalDisp,'#10b981','Disponibles')}
            ${kpi('🔴','Ocupadas',totalOcup,'#ef4444','Ocupadas')}
            ${kpi('📊','Ocupación',pctGlobal+'%',pctGlobal>80?'#ef4444':pctGlobal>50?'#f59e0b':'#10b981','Ocupación')}
            ${habMant>0?kpi('🟡','En Mantención',habMant,'#f59e0b','En Mantención'):''}
            ${totalBodega>0?kpi('📦','Bodegas',totalBodega,'#64748b'):''}
            ${totalReserva>0?kpi('📌','En Reserva',totalReserva,'#7c3aed'):''}
          </div>

          <!-- ═══ SECCIÓN 2: SECTOR ANGLO ═══ -->
          ${(totalAngloNoche>0||totalAngloDia>0)?`
          <div style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">⛏️ Sector Anglo</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">
            ${kpi('☀️','Anglo Día',totalAngloDia,'#d97706')}
            ${kpi('✅','Disp. Día',dispAngloDia,'#f59e0b')}
            ${kpi('🌙','Anglo Noche',totalAngloNoche,'#4338ca')}
            ${kpi('✅','Disp. Noche',dispAngloNoche,'#6366f1')}
          </div>`:''}

          <!-- ═══ SECCIÓN 3: TIPOS ESPECIALES ═══ -->
          ${(totalNoche>0||camas4x3>0)?`
          <div style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">🌙 Turno Noche / Especial</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">
            ${totalNoche>0?kpi('🌙','Total Noche',totalNoche,'#4338ca'):''}
            ${totalNoche>0?kpi('✅','Disp. Noche',dispNoche,'#6366f1'):''}
            ${camas4x3>0?kpi('🔄','Turno 4×3',camas4x3,'#0891b2'):''}
          </div>`:''}

          <!-- Modal desglose COPC / R-220 -->
          <div id="dash-modal" onclick="this.style.display='none'" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:none;align-items:flex-end;justify-content:center">
            <div onclick="event.stopPropagation()" style="background:var(--bg-card);border-radius:20px 20px 0 0;padding:28px;width:100%;max-width:480px;box-shadow:0 -8px 40px rgba(0,0,0,.25)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <div id="dash-modal-title" style="font-size:17px;font-weight:800;color:var(--text-primary)"></div>
                <button onclick="document.getElementById('dash-modal').style.display='none'" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">×</button>
              </div>
              <div id="dash-modal-body"></div>
            </div>
          </div>

          <!-- Alerta camas perdidas -->
          ${camasPerd>0?`
          <div onclick="window.navigate('v2camasperdidas')" style="cursor:pointer;background:linear-gradient(135deg,rgba(239,68,68,.08),rgba(239,68,68,.04));border:1.5px solid #fca5a5;border-radius:14px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="font-size:28px">🛏️</div>
              <div>
                <div style="font-weight:800;font-size:15px;color:#b91c1c">${camasPerd} cama${camasPerd>1?'s':''} perdida${camasPerd>1?'s':''} detectada${camasPerd>1?'s':''}</div>
                <div style="font-size:12px;color:var(--text-muted)">Habitaciones con capacidad disponible no utilizada · Clic para ver detalle</div>
              </div>
            </div>
            <div style="background:#ef4444;color:white;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;white-space:nowrap">Ver Camas Perdidas →</div>
          </div>`:''}

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

          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
              <span style="font-weight:700;font-size:14px;color:var(--text-primary)">Ocupación Global</span>
              <span style="font-weight:800;font-size:16px;color:${pctGlobal>80?'#ef4444':'#10b981'}">${pctGlobal}%</span>
            </div>
            <div style="height:12px;background:var(--border);border-radius:6px;overflow:hidden;margin-bottom:10px">
              <div style="height:100%;width:${pctGlobal}%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:6px;transition:width 0.8s ease"></div>
            </div>
            <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);flex-wrap:wrap">
              <span>🟢 ${totalDisp} disp.</span><span>🔴 ${totalOcup} ocup.</span><span>🟡 ${totalMant} mant.</span>
              ${totalNoche>0?`<span>🌙 ${totalNoche} noche · ${dispNoche} disp.</span>`:''}
              ${(totalAngloNoche+totalAngloDia)>0?`<span>⛏️ ${totalAngloNoche+totalAngloDia} Anglo · ${dispAngloNoche+dispAngloDia} disp.</span>`:''}
            </div>
          </div>

          <!-- Por Edificio: COPC + R-220 lado a lado -->
          <div style="display:grid;grid-template-columns:${reporteR220.length > 0 ? '1fr 1fr' : '1fr'};gap:12px;margin-bottom:12px;align-items:start">

            <details open>
              <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;
                background:linear-gradient(135deg,#1e293b,#334155);color:#fff;padding:12px 18px;
                border-radius:12px;font-weight:700;font-size:13px;user-select:none">
                <span>🏢 COPC &nbsp;<span style="opacity:.7;font-size:11px;font-weight:500">${stCOPC.cam} camas · ${stCOPC.dis} disp. · ${pctCOPC}%</span></span>
                <span style="font-size:11px;opacity:.6">▼</span>
              </summary>
              <div style="display:grid;grid-template-columns:1fr;gap:10px;padding:12px 0 4px">
                ${reporteCOPC.map(r => edificioCard(r)).join('')}
              </div>
            </details>

            ${reporteR220.length > 0 ? `
            <details open>
              <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;
                background:linear-gradient(135deg,#312e81,#4338ca);color:#fff;padding:12px 18px;
                border-radius:12px;font-weight:700;font-size:13px;user-select:none">
                <span>🏗️ R-220 &nbsp;<span style="opacity:.7;font-size:11px;font-weight:500">${stR220.cam} camas · ${stR220.dis} disp. · ${pctR220}%</span></span>
                <span style="font-size:11px;opacity:.6">▼</span>
              </summary>
              <div style="display:grid;grid-template-columns:1fr;gap:10px;padding:12px 0 4px">
                ${reporteR220.map(r => edificioCard(r)).join('')}
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
    return `<div ${clickable} style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:16px;border-top:3px solid ${color}${hover}">
      <div style="font-size:20px;margin-bottom:6px">${icon}${key?'<span style="float:right;font-size:11px;color:var(--text-muted);margin-top:2px">🔍</span>':''}</div>
      <div style="font-size:26px;font-weight:800;color:${color}">${value}</div>
      <div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${label}</div>
    </div>`;
}

window._dashModal = (key, el) => {
    const d = window._dashBreakdowns?.[key];
    if (!d) return;
    const modal = document.getElementById('dash-modal');
    if (!modal) return;
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
    };
    document.getElementById('dash-modal-title').textContent = '🔍 Desglose: ' + key;
    const copcVal = d.isAvg ? d.copc + d.unit : d.copc.toLocaleString('es-CL') + d.unit;
    const r220Val = d.isAvg ? d.r220 + d.unit : d.r220.toLocaleString('es-CL') + d.unit;
    const total   = d.isAvg
        ? Math.round((d.copc * 0.898 + d.r220 * 0.102)) + d.unit
        : (d.copc + d.r220).toLocaleString('es-CL') + d.unit;
    document.getElementById('dash-modal-body').innerHTML = `
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
      </div>`;
    modal.onclick = (e) => { if(e.target===modal){modal.style.display='none';clearActive();} };
    document.querySelector('#dash-modal button').onclick = () => { modal.style.display='none'; clearActive(); };
    modal.style.display = 'flex';
};

function edificioCard(r) {
    const pct = r.total_camas > 0 ? Math.round((r.camas_ocupadas / r.total_camas) * 100) : 0;
    const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981';
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-weight:800;font-size:15px;color:var(--text-primary)">🏢 ${r.edificio}</span>
        <span style="font-weight:800;font-size:18px;color:${color}">${pct}%</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${r.total_camas} camas</div>
      <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin-bottom:12px">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:4px"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
        <div style="text-align:center;background:rgba(16,185,129,0.08);border-radius:8px;padding:8px">
          <div style="font-weight:800;color:#10b981">${r.camas_disponibles}</div><div style="font-size:10px;color:var(--text-muted)">Disp.</div>
        </div>
        <div style="text-align:center;background:rgba(239,68,68,0.08);border-radius:8px;padding:8px">
          <div style="font-weight:800;color:#ef4444">${r.camas_ocupadas}</div><div style="font-size:10px;color:var(--text-muted)">Ocup.</div>
        </div>
        <div style="text-align:center;background:rgba(245,158,11,0.08);border-radius:8px;padding:8px">
          <div style="font-weight:800;color:#f59e0b">${r.camas_mantencion}</div><div style="font-size:10px;color:var(--text-muted)">Mant.</div>
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
