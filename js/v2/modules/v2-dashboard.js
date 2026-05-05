/**
 * v2-dashboard.js — Dashboard de Ocupación V2
 * Consume getReporteOcupacion() del servicio centralizado.
 */
import { getReporteOcupacion, getAsignacionesActivas } from '../v2-service.js';
import { supabase } from '../../supabaseClient.js';

export async function renderV2Dashboard(container) {
    container.innerHTML = getSkeletonHTML();
    try {
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
        let totalNocheEseS = 0, dispNocheEseS = 0;
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

            // Pabellón 7 = ESE,S — camas noche en P7
            try {
                const { data: p7Pabs } = await supabase
                    .from('v2_pabellones')
                    .select('id')
                    .or('nombre.eq.P-7,nombre.eq.P7,nombre.eq.7,nombre.ilike.%pabellón 7%,nombre.ilike.%pabellon 7%');
                if (p7Pabs?.length) {
                    const { data: p7HabsData } = await supabase
                        .from('v2_habitaciones')
                        .select('id_custom')
                        .in('pabellon_id', p7Pabs.map(p => p.id));
                    const p7HabSet  = new Set((p7HabsData || []).map(h => String(h.id_custom)));
                    const p7CamaSet = new Set(camTodos.filter(c => p7HabSet.has(String(c.habitacion_id))).map(c => String(c.id_cama)));
                    totalNocheEseS = camTodos.filter(c => p7CamaSet.has(String(c.id_cama)) && nocheSet.has(String(c.id_cama))).length;
                    dispNocheEseS  = camTodos.filter(c => p7CamaSet.has(String(c.id_cama)) && nocheSet.has(String(c.id_cama)) && esDisp(c)).length;
                    console.log(`[dashboard] P7 ESE,S noche: total=${totalNocheEseS} disp=${dispNocheEseS}`);
                }
            } catch(eP7){ console.warn('[dashboard] P7 ESE,S:', eP7); }

            // Habitaciones en mantención (TODAS sus camas en mantención)
            Object.values(porHab).forEach(cs => {
                const enMant = cs.every(c => c.estado === 'Mantencion' || c.estado === 'Mantención');
                if (enMant) habMant++;
            });
        } catch(e){ console.warn('[dashboard] cálculos ext:', e); }

        const totalNoche    = nocheSet.size;
        const totalReserva  = reservaSet.size;
        const totalBodega   = bodegaSet.size;

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

          <!-- KPIs fila 1: inventario y ocupación -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:12px">
            ${kpi('🛏️','Total Camas',totalCamas,'#6366f1')}
            ${kpi('✅','Disponibles',totalDisp,'#10b981')}
            ${kpi('🔴','Ocupadas',totalOcup,'#ef4444')}
            ${kpi('📊','% Ocupación',pctGlobal+'%',pctGlobal>80?'#ef4444':pctGlobal>50?'#f59e0b':'#10b981')}
            ${kpi('🟡','Hab. Mantención',habMant,'#f59e0b')}
            ${totalBodega>0?kpi('📦','Bodegas',totalBodega,'#64748b'):''}
            ${totalReserva>0?kpi('📌','En Reserva',totalReserva,'#7c3aed'):''}
            ${camas4x3>0?kpi('🔄','Turno 4×3',camas4x3,'#0891b2'):''}
          </div>

          <!-- KPIs fila 2: noche y Anglo (cama 1=día, cama 2=noche) -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px">
            ${kpi('🌙','Total Noche',totalNoche,'#4338ca')}
            ${kpi('🌙✅','Disp. Noche',dispNoche,'#6366f1')}
            ${totalNocheEseS>0?kpi('🌙7️⃣','Total Noche ESE,S',totalNocheEseS,'#1d4ed8'):''}
            ${totalNocheEseS>0?kpi('🌙7️⃣✅','Disp. Noche ESE,S',dispNocheEseS,'#2563eb'):''}
            ${totalAngloNoche>0?kpi('⛏️🌙','Anglo Noche',totalAngloNoche,'#b45309'):''}
            ${dispAngloNoche>0||totalAngloNoche>0?kpi('⛏️🌙✅','Disp. Anglo Noche',dispAngloNoche,'#92400e'):''}
            ${totalAngloDia>0?kpi('⛏️☀️','Anglo Día',totalAngloDia,'#d97706'):''}
            ${dispAngloDia>0||totalAngloDia>0?kpi('⛏️☀️✅','Disp. Anglo Día',dispAngloDia,'#f59e0b'):''}
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

          <h2 style="font-size:13px;font-weight:700;color:var(--text-muted);margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">Por Edificio</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:24px">
            ${reporte.map(r => edificioCard(r)).join('')}
          </div>

          <h2 style="font-size:13px;font-weight:700;color:var(--text-muted);margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">Últimos Check-ins Activos</h2>
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden;overflow-x:auto">
            ${activas.length === 0
              ? `<div style="padding:40px;text-align:center;color:var(--text-muted)">Sin huéspedes activos · Usa <strong>🛎️ Check-in</strong> para registrar el primer ingreso</div>`
              : `<table style="width:100%;border-collapse:collapse;min-width:550px">
                  <thead><tr style="background:var(--bg);border-bottom:1px solid var(--border)">
                    ${['Huésped','RUT','Cama','Empresa','Check-in'].map(h=>`<th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase">${h}</th>`).join('')}
                  </tr></thead>
                  <tbody>
                    ${activas.map((a,i)=>`<tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg)'}">
                      <td style="padding:11px 14px;font-weight:600;font-size:13px;color:var(--text-primary)">${a.nombre_huesped}</td>
                      <td style="padding:11px 14px;font-size:12px;font-family:monospace;color:var(--text-secondary)">${a.rut_huesped}</td>
                      <td style="padding:11px 14px;font-size:12px;font-family:monospace;color:#6366f1;font-weight:700">${a.id_cama}</td>
                      <td style="padding:11px 14px;font-size:12px;color:var(--text-secondary)">${a.v2_empresas?.nombre||'—'}</td>
                      <td style="padding:11px 14px;font-size:12px;color:var(--text-muted)">${a.fecha_checkin}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>`}
          </div>
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

function kpi(icon, label, value, color) {
    return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:16px;border-top:3px solid ${color}">
      <div style="font-size:20px;margin-bottom:6px">${icon}</div>
      <div style="font-size:26px;font-weight:800;color:${color}">${value}</div>
      <div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${label}</div>
    </div>`;
}

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
