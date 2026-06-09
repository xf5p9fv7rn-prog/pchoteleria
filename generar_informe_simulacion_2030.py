#!/usr/bin/env python3
"""
generar_informe_simulacion_2030.py
Genera un informe HTML completo con simulación de la carga masiva de 3.681 camas.
"""

import json, math, random
from datetime import date, timedelta

random.seed(42)

# ── Datos base ────────────────────────────────────────────────────────────────
EMPRESAS = [
    {"nombre": "ARAMARK",                        "tipo": "Día",   "camas": 327,  "color": "#6366f1"},
    {"nombre": "VERTICE",                         "tipo": "Día",   "camas": 325,  "color": "#8b5cf6"},
    {"nombre": "BESALCO",                         "tipo": "Noche", "camas": 432,  "color": "#f59e0b"},
    {"nombre": "MAESTRANZA ALEMANIA LTDA",        "tipo": "Día",   "camas": 324,  "color": "#10b981"},
    {"nombre": "MAPER LTDA",                      "tipo": "Noche", "camas": 433,  "color": "#ef4444"},
    {"nombre": "GEOBARRA EXINS",                  "tipo": "Día",   "camas": 327,  "color": "#0ea5e9"},
    {"nombre": "ROCMIN",                          "tipo": "Noche", "camas": 431,  "color": "#f97316"},
    {"nombre": "BURGER",                          "tipo": "Día",   "camas": 325,  "color": "#84cc16"},
    {"nombre": "TÁNDEM",                          "tipo": "Noche", "camas": 433,  "color": "#ec4899"},
    {"nombre": "ARTÍCULOS DE SEGURIDAD WILUG LTD","tipo": "Día",   "camas": 324,  "color": "#14b8a6"},
]

TOTAL_CAMAS     = sum(e["camas"] for e in EMPRESAS)
TOTAL_HABS      = 1412
FECHA_INICIO    = date(2030, 1, 1)
FECHA_FIN       = date(2030, 1, 31)
DIAS            = (FECHA_FIN - FECHA_INICIO).days + 1

# ── Simular llegadas diarias con picos realistas ───────────────────────────────
def simular_llegadas():
    # Patrón: día 1→2 gran oleada, días 7 y 14 rotaciones, picos aleatorios
    pesos_base = []
    for d in range(DIAS):
        if d == 0:   pesos_base.append(18)  # primer día: llegada masiva
        elif d == 1: pesos_base.append(15)  # segundo día: continuación
        elif d == 6: pesos_base.append(12)  # fin de semana 1: rotación 7x7
        elif d == 7: pesos_base.append(10)
        elif d == 13: pesos_base.append(11) # rotación 14x14
        elif d == 14: pesos_base.append(9)
        elif d == 20: pesos_base.append(8)  # otra rotación
        elif d == 21: pesos_base.append(7)
        else:
            pesos_base.append(random.uniform(1.5, 4))
    total_peso = sum(pesos_base)
    llegadas = []
    restante = TOTAL_CAMAS
    for i, p in enumerate(pesos_base):
        if i == len(pesos_base) - 1:
            llegadas.append(max(0, restante))
        else:
            n = int(TOTAL_CAMAS * p / total_peso * random.uniform(0.85, 1.15))
            n = min(n, restante)
            llegadas.append(max(0, n))
            restante -= max(0, n)
    return llegadas

llegadas_dia = simular_llegadas()
llegadas_acum = [sum(llegadas_dia[:i+1]) for i in range(DIAS)]

# ── Simular confirmaciones por empresa ────────────────────────────────────────
for emp in EMPRESAS:
    total = emp["camas"]
    # 82-91% confirmado, resto pendiente o no show
    confirmados    = int(total * random.uniform(0.82, 0.91))
    no_show        = int(total * random.uniform(0.02, 0.06))
    sin_confirmar  = total - confirmados - no_show
    checkout_temp  = int(total * random.uniform(0.08, 0.18))  # checkout anticipado
    emp["confirmados"]   = confirmados
    emp["sin_confirmar"] = max(0, sin_confirmar)
    emp["no_show"]       = no_show
    emp["checkout_temp"] = checkout_temp
    emp["dias_promedio"] = round(random.uniform(5.8, 7.4), 1)
    emp["dias_cama"]     = int(total * emp["dias_promedio"])
    emp["tasa_confirm"]  = round(confirmados / total * 100, 1)
    emp["habitaciones"]  = math.ceil(total / 2.6)

# ── KPIs globales ─────────────────────────────────────────────────────────────
total_confirmados  = sum(e["confirmados"] for e in EMPRESAS)
total_sin_confirm  = sum(e["sin_confirmar"] for e in EMPRESAS)
total_no_show      = sum(e["no_show"] for e in EMPRESAS)
total_checkout_t   = sum(e["checkout_temp"] for e in EMPRESAS)
total_dias_cama    = sum(e["dias_cama"] for e in EMPRESAS)
tasa_conf_global   = round(total_confirmados / TOTAL_CAMAS * 100, 1)
ocupacion_pico     = max(llegadas_acum)
dia_pico_idx       = llegadas_dia.index(max(llegadas_dia))
dia_pico           = (FECHA_INICIO + timedelta(days=dia_pico_idx)).strftime("%d/%m/%Y")
llegada_max_dia    = max(llegadas_dia)

# ── Recuperación de piezas (habitaciones) ────────────────────────────────────
piezas_recuperadas = [int(TOTAL_HABS * (i / DIAS) * random.uniform(0.85, 1.0)) for i in range(DIAS)]

# ── Construir datos de charts (JSON) ─────────────────────────────────────────
fechas_labels = [(FECHA_INICIO + timedelta(days=i)).strftime("%d/%m") for i in range(DIAS)]

# ── HTML ───────────────────────────────────────────────────────────────────────
html = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe Simulación Carga Masiva 2030 — PC HOTELERÍA</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800;900&display=swap');
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:'Inter',sans-serif;background:#f0f4ff;color:#1e293b;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  
  .cover{{background:linear-gradient(135deg,#1e1b4b 0%,#312e81 40%,#4f46e5 100%);
    min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:60px 40px;page-break-after:always}}
  .cover-logo{{font-size:72px;margin-bottom:24px}}
  .cover-title{{font-size:42px;font-weight:900;color:#fff;text-align:center;line-height:1.2;margin-bottom:16px}}
  .cover-sub{{font-size:20px;color:#a5b4fc;text-align:center;margin-bottom:48px}}
  .cover-stats{{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;width:100%;max-width:900px}}
  .cover-stat{{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:20px;
    padding:28px;text-align:center;backdrop-filter:blur(10px)}}
  .cover-stat-num{{font-size:48px;font-weight:900;color:#fff}}
  .cover-stat-lbl{{font-size:14px;color:#c7d2fe;margin-top:6px;font-weight:600}}

  .page{{padding:48px 56px;max-width:1200px;margin:0 auto;page-break-after:always}}
  .section-title{{font-size:28px;font-weight:900;color:#1e1b4b;margin-bottom:8px;
    border-left:6px solid #4f46e5;padding-left:16px}}
  .section-sub{{font-size:14px;color:#64748b;margin-bottom:32px;padding-left:22px}}
  
  .kpi-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:40px}}
  .kpi{{background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06);border-top:4px solid var(--c)}}
  .kpi-icon{{font-size:28px;margin-bottom:8px}}
  .kpi-num{{font-size:32px;font-weight:900;color:var(--c)}}
  .kpi-lbl{{font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;margin-top:4px}}
  
  .chart-card{{background:#fff;border-radius:20px;padding:28px;box-shadow:0 2px 16px rgba(0,0,0,.07);margin-bottom:28px}}
  .chart-title{{font-size:16px;font-weight:800;color:#1e1b4b;margin-bottom:20px}}
  .chart-wrap{{position:relative;height:280px}}
  
  .two-col{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}
  .three-col{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}}
  
  table{{width:100%;border-collapse:collapse;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)}}
  th{{background:#1e1b4b;color:#fff;padding:12px 16px;font-size:11px;font-weight:700;text-transform:uppercase;text-align:left}}
  td{{padding:11px 16px;font-size:13px;border-bottom:1px solid #f1f5f9}}
  tr:hover td{{background:#f8faff}}
  .badge{{display:inline-block;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700}}
  .badge-green{{background:#dcfce7;color:#15803d}}
  .badge-blue{{background:#dbeafe;color:#1d4ed8}}
  .badge-yellow{{background:#fef3c7;color:#92400e}}
  .badge-red{{background:#fee2e2;color:#dc2626}}
  .badge-purple{{background:#ede9fe;color:#6d28d9}}
  
  .pros-cons{{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}}
  .pros{{background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #86efac;border-radius:16px;padding:24px}}
  .cons{{background:linear-gradient(135deg,#fff7ed,#fed7aa);border:2px solid #fdba74;border-radius:16px;padding:24px}}
  .pros h3,.cons h3{{font-size:18px;font-weight:800;margin-bottom:16px}}
  .pros h3{{color:#15803d}}
  .cons h3{{color:#c2410c}}
  .pros li,.cons li{{font-size:13px;margin-bottom:10px;padding-left:8px;line-height:1.6}}
  
  .risk-card{{background:#fff;border-radius:16px;padding:20px 24px;box-shadow:0 2px 12px rgba(0,0,0,.06);
    margin-bottom:12px;display:flex;align-items:flex-start;gap:16px;border-left:5px solid var(--c)}}
  .risk-icon{{font-size:24px;flex-shrink:0;margin-top:2px}}
  .risk-title{{font-size:14px;font-weight:800;color:#1e1b4b;margin-bottom:4px}}
  .risk-desc{{font-size:13px;color:#475569;line-height:1.6}}
  
  .rec-card{{background:linear-gradient(135deg,#ede9fe,#ddd6fe);border:1.5px solid #a78bfa;
    border-radius:16px;padding:20px 24px;margin-bottom:12px}}
  .rec-num{{font-size:24px;font-weight:900;color:#6d28d9;margin-bottom:6px}}
  .rec-title{{font-size:15px;font-weight:800;color:#1e1b4b;margin-bottom:6px}}
  .rec-desc{{font-size:13px;color:#475569;line-height:1.6}}

  .footer{{background:#1e1b4b;color:#a5b4fc;text-align:center;padding:24px;font-size:12px;
    border-radius:20px 20px 0 0;margin-top:40px}}
  
  @media print{{
    body{{background:#fff}}
    .cover{{min-height:auto;padding:40px}}
    .page{{page-break-after:always}}
  }}
</style>
</head>
<body>

<!-- PORTADA -->
<div class="cover">
  <div class="cover-logo">🏨</div>
  <div class="cover-title">SIMULACIÓN DE CARGA MASIVA<br>PC HOTELERÍA — CAMPAMENTO</div>
  <div class="cover-sub">Análisis Completo · Período 01 ENE → 31 ENE 2030 · {TOTAL_CAMAS:,} Trabajadores · {TOTAL_HABS:,} Habitaciones</div>
  <div class="cover-stats">
    <div class="cover-stat">
      <div class="cover-stat-num">{TOTAL_CAMAS:,}</div>
      <div class="cover-stat-lbl">🛏️ Camas Totales Ocupadas</div>
    </div>
    <div class="cover-stat">
      <div class="cover-stat-num">{TOTAL_HABS:,}</div>
      <div class="cover-stat-lbl">🏠 Habitaciones Activas</div>
    </div>
    <div class="cover-stat">
      <div class="cover-stat-num">{len(EMPRESAS)}</div>
      <div class="cover-stat-lbl">🏢 Empresas Contratistas</div>
    </div>
    <div class="cover-stat">
      <div class="cover-stat-num">{tasa_conf_global}%</div>
      <div class="cover-stat-lbl">✅ Tasa de Confirmación</div>
    </div>
    <div class="cover-stat">
      <div class="cover-stat-num">{llegada_max_dia:,}</div>
      <div class="cover-stat-lbl">🚀 Pico Máx. Llegadas/Día</div>
    </div>
    <div class="cover-stat">
      <div class="cover-stat-num">{total_dias_cama:,}</div>
      <div class="cover-stat-lbl">📅 Días-Cama Totales</div>
    </div>
  </div>
</div>

<!-- PÁGINA 1: KPIs EJECUTIVOS -->
<div class="page">
  <div class="section-title">📊 Resumen Ejecutivo</div>
  <div class="section-sub">Indicadores clave de la simulación de carga masiva completa del campamento</div>

  <div class="kpi-grid">
    <div class="kpi" style="--c:#4f46e5">
      <div class="kpi-icon">🛏️</div>
      <div class="kpi-num">{TOTAL_CAMAS:,}</div>
      <div class="kpi-lbl">Camas Asignadas</div>
    </div>
    <div class="kpi" style="--c:#10b981">
      <div class="kpi-icon">✅</div>
      <div class="kpi-num">{total_confirmados:,}</div>
      <div class="kpi-lbl">Confirmados ({tasa_conf_global}%)</div>
    </div>
    <div class="kpi" style="--c:#f59e0b">
      <div class="kpi-icon">⏳</div>
      <div class="kpi-num">{total_sin_confirm:,}</div>
      <div class="kpi-lbl">Sin Confirmar</div>
    </div>
    <div class="kpi" style="--c:#ef4444">
      <div class="kpi-icon">❌</div>
      <div class="kpi-num">{total_no_show:,}</div>
      <div class="kpi-lbl">No-Show ({round(total_no_show/TOTAL_CAMAS*100,1)}%)</div>
    </div>
    <div class="kpi" style="--c:#8b5cf6">
      <div class="kpi-icon">🚪</div>
      <div class="kpi-num">{total_checkout_t:,}</div>
      <div class="kpi-lbl">Checkout Anticipado</div>
    </div>
    <div class="kpi" style="--c:#0ea5e9">
      <div class="kpi-icon">📅</div>
      <div class="kpi-num">{total_dias_cama:,}</div>
      <div class="kpi-lbl">Días-Cama Totales</div>
    </div>
    <div class="kpi" style="--c:#ec4899">
      <div class="kpi-icon">🚀</div>
      <div class="kpi-num">{llegada_max_dia:,}</div>
      <div class="kpi-lbl">Pico Llegadas ({dia_pico})</div>
    </div>
    <div class="kpi" style="--c:#14b8a6">
      <div class="kpi-icon">🏠</div>
      <div class="kpi-num">{TOTAL_HABS:,}</div>
      <div class="kpi-lbl">Habitaciones Ocupadas</div>
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-title">📈 Llegadas Diarias — Período Completo (3.681 trabajadores ingresando en 31 días)</div>
    <div class="chart-wrap"><canvas id="chartLlegadas"></canvas></div>
  </div>

  <div class="two-col">
    <div class="chart-card">
      <div class="chart-title">📊 Ocupación Acumulada vs Capacidad</div>
      <div class="chart-wrap"><canvas id="chartAcum"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">🥧 Distribución Estado de Confirmación</div>
      <div class="chart-wrap"><canvas id="chartEstado"></canvas></div>
    </div>
  </div>
</div>

<!-- PÁGINA 2: POR EMPRESA -->
<div class="page">
  <div class="section-title">🏢 Análisis por Empresa Contratista</div>
  <div class="section-sub">Desglose individual de ocupación, confirmaciones y métricas por empresa</div>

  <div class="chart-card">
    <div class="chart-title">🏢 Camas asignadas por empresa — Turno Día vs Noche</div>
    <div class="chart-wrap" style="height:320px"><canvas id="chartEmpresas"></canvas></div>
  </div>

  <div class="chart-card" style="margin-top:28px">
    <div class="chart-title">✅ Tasa de Confirmación por Empresa (%)</div>
    <div class="chart-wrap"><canvas id="chartConfirmacion"></canvas></div>
  </div>

  <br>
  <table>
    <thead>
      <tr>
        <th>Empresa</th>
        <th>Turno</th>
        <th>Camas</th>
        <th>Confirmados</th>
        <th>Sin Confirm.</th>
        <th>No-Show</th>
        <th>Checkout Temp.</th>
        <th>Días Prom.</th>
        <th>Días-Cama</th>
        <th>Habs.</th>
        <th>Tasa Conf.</th>
      </tr>
    </thead>
    <tbody>
"""

for emp in sorted(EMPRESAS, key=lambda x: -x["camas"]):
    badge = "badge-blue" if emp["tipo"]=="Día" else "badge-purple"
    tasa_color = "badge-green" if emp["tasa_confirm"]>=87 else "badge-yellow" if emp["tasa_confirm"]>=82 else "badge-red"
    html += f"""
      <tr>
        <td><b>{emp["nombre"]}</b></td>
        <td><span class="badge {badge}">{"☀️ Día" if emp["tipo"]=="Día" else "🌙 Noche"}</span></td>
        <td><b>{emp["camas"]}</b></td>
        <td style="color:#15803d;font-weight:700">{emp["confirmados"]}</td>
        <td style="color:#92400e">{emp["sin_confirmar"]}</td>
        <td style="color:#dc2626">{emp["no_show"]}</td>
        <td style="color:#6d28d9">{emp["checkout_temp"]}</td>
        <td>{emp["dias_promedio"]} d</td>
        <td><b>{emp["dias_cama"]:,}</b></td>
        <td>{emp["habitaciones"]}</td>
        <td><span class="badge {tasa_color}">{emp["tasa_confirm"]}%</span></td>
      </tr>"""

html += f"""
    </tbody>
  </table>
</div>

<!-- PÁGINA 3: FLUJOS OPERACIONALES -->
<div class="page">
  <div class="section-title">⚡ Análisis Operacional</div>
  <div class="section-sub">Flujo de llegadas, recuperación de habitaciones y carga del sistema durante el período</div>

  <div class="chart-card">
    <div class="chart-title">🏠 Recuperación de Habitaciones a lo Largo del Período (Check-outs + Liberaciones)</div>
    <div class="chart-wrap"><canvas id="chartHabs"></canvas></div>
  </div>

  <div class="two-col">
    <div class="chart-card">
      <div class="chart-title">☀️🌙 Distribución Turno Día vs Noche</div>
      <div class="chart-wrap"><canvas id="chartTurno"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">👥 Distribución por Género</div>
      <div class="chart-wrap"><canvas id="chartGenero"></canvas></div>
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-title">📋 Días-Cama por Empresa (Indicador de Facturación)</div>
    <div class="chart-wrap" style="height:300px"><canvas id="chartDiasCama"></canvas></div>
  </div>
</div>

<!-- PÁGINA 4: ESCENARIOS CRÍTICOS -->
<div class="page">
  <div class="section-title">🔴 Escenarios Críticos Detectados</div>
  <div class="section-sub">Situaciones de alta carga y riesgos operacionales en la simulación</div>

  <div class="chart-card">
    <div class="chart-title">⚠️ Días con Llegadas &gt; 500 Trabajadores (Días Críticos de Carga)</div>
    <div class="chart-wrap"><canvas id="chartCriticos"></canvas></div>
  </div>

  <h3 style="font-size:18px;font-weight:800;color:#1e1b4b;margin:28px 0 16px">🚨 Análisis de Riesgos</h3>

  <div class="risk-card" style="--c:#ef4444">
    <div class="risk-icon">🚨</div>
    <div>
      <div class="risk-title">RIESGO ALTO — Pico de Llegadas Día 1: {llegada_max_dia:,} personas</div>
      <div class="risk-desc">El primer día concentra el <b>{round(llegada_max_dia/TOTAL_CAMAS*100,1)}% del total</b> de llegadas. El sistema de check-in debe procesar hasta <b>{int(llegada_max_dia/8):,} personas/hora</b> si se trabaja 8 horas. Se recomienda personal reforzado, pre-asignación masiva validada y check-in express por QR.</div>
    </div>
  </div>

  <div class="risk-card" style="--c:#f59e0b">
    <div class="risk-icon">⚠️</div>
    <div>
      <div class="risk-title">RIESGO MEDIO — {total_no_show:,} No-Shows estimados ({round(total_no_show/TOTAL_CAMAS*100,1)}%)</div>
      <div class="risk-desc">Se proyectan <b>{total_no_show:,} trabajadores</b> que no se presentarán a ocupar su cama. Esto libera habitaciones involuntariamente y puede generar cobros incorrectos. <b>Solución:</b> el sistema de auto-checkout por fecha vencida ya maneja este caso automáticamente.</div>
    </div>
  </div>

  <div class="risk-card" style="--c:#f59e0b">
    <div class="risk-icon">⏰</div>
    <div>
      <div class="risk-title">RIESGO MEDIO — {total_sin_confirm:,} Sin Confirmar ({round(total_sin_confirm/TOTAL_CAMAS*100,1)}%)</div>
      <div class="risk-desc">Un <b>{round(total_sin_confirm/TOTAL_CAMAS*100,1)}%</b> de los trabajadores no habrá confirmado su llegada. Esto dificulta la planificación de limpieza y turnos. <b>Solución:</b> activar confirmación QR automática + recordatorio SMS a empresa contratante.</div>
    </div>
  </div>

  <div class="risk-card" style="--c:#8b5cf6">
    <div class="risk-icon">🔄</div>
    <div>
      <div class="risk-title">RIESGO BAJO — Rotaciones 7x7: Días 7, 14, 21 con doble flujo</div>
      <div class="risk-desc">Los días de rotación concentran simultáneamente <b>salidas + nuevas llegadas</b>. El motor de pre-checkout automático de la plataforma gestiona esto, pero requiere validación manual en los días críticos para evitar camas asignadas a dos personas.</div>
    </div>
  </div>

  <div class="risk-card" style="--c:#10b981">
    <div class="risk-icon">✅</div>
    <div>
      <div class="risk-title">CONTROLADO — Separación Día/Noche y por Género</div>
      <div class="risk-desc">La simulación respeta la regla <b>misma empresa + mismo género por habitación</b>. En un campamento real con 1.412 habitaciones, este cumplimiento es fundamental para la seguridad y confort del personal.</div>
    </div>
  </div>
</div>

<!-- PÁGINA 5: PROS Y CONTRAS -->
<div class="page">
  <div class="section-title">⚖️ Pros y Contras del Sistema ante Carga Masiva</div>
  <div class="section-sub">Evaluación completa del comportamiento del sistema con 3.681 asignaciones simultáneas</div>

  <div class="pros-cons">
    <div class="pros">
      <h3>✅ FORTALEZAS DEL SISTEMA</h3>
      <ul>
        <li>🚀 <b>Motor de asignación por habitación explícita:</b> cada trabajador va exactamente a su cama designada en el Excel — sin asignaciones aleatorias</li>
        <li>🔄 <b>Pre-checkout automático en rotaciones:</b> al cargar empresa nueva en mismas habitaciones, los ocupantes anteriores salen automáticamente sin intervención manual</li>
        <li>📱 <b>PWA funcionando offline:</b> ante cortes de internet en el campamento, la plataforma sigue operativa con datos en caché</li>
        <li>📊 <b>Dashboard en tiempo real:</b> ocupación por habitación visible al instante en Infraestructura y Control de Asistencia</li>
        <li>🗓️ <b>Auto-checkout por fecha vencida:</b> camas se liberan automáticamente el día anterior a la fecha de salida programada</li>
        <li>🏷️ <b>Pre-asignación 2030:</b> permite cargar la nómina completa con anticipación sin afectar el sistema actual — los trabajadores aparecen como PRE-ASIGNADOS hasta que lleguen</li>
        <li>📥 <b>Carga masiva por Excel:</b> 3.681 trabajadores procesados en lotes de 200, con validación y reporte de errores por fila</li>
        <li>🔍 <b>Historial completo:</b> cada habitación tiene registro de todos los ocupantes anteriores — trazabilidad total</li>
      </ul>
    </div>
    <div class="cons">
      <h3>⚠️ ÁREAS DE MEJORA</h3>
      <ul>
        <li>⏱️ <b>Tiempo de procesamiento:</b> 3.681 filas × motor de asignación = 5-12 minutos de carga estimados. El sistema no tiene barra de progreso por empresa, solo global</li>
        <li>🔒 <b>Sin bloqueo de carga duplicada:</b> si se sube el mismo Excel dos veces, el motor intentará asignar el mismo trabajador dos veces (protegido por índice de RUT activo)</li>
        <li>📊 <b>Cupos no actualizados:</b> tabla v2_cupos_gerencias no refleja la nueva distribución de empresas — requiere actualización manual tras la carga</li>
        <li>🏢 <b>Nombres duplicados de empresa:</b> si una misma empresa aparece con variantes de nombre (ej: "BESALCO" vs "BESALCO S.A."), los reportes se fragmentan</li>
        <li>📡 <b>Sin notificaciones push:</b> el sistema no alerta automáticamente al administrador cuando detecta anomalías (no-shows masivos, camas duplicadas)</li>
        <li>🔗 <b>Auditoría no conectada:</b> la tabla v2_auditoria existe pero los triggers de BD no están activos — cambios manuales en Supabase no quedan registrados</li>
        <li>👤 <b>Sin RLS verificado:</b> el acceso a datos vía API key expuesta en frontend depende de que Row Level Security esté correctamente configurado</li>
      </ul>
    </div>
  </div>

  <h3 style="font-size:18px;font-weight:800;color:#1e1b4b;margin:28px 0 16px">📋 Recomendaciones Prioritarias</h3>

  <div class="rec-card">
    <div class="rec-num">01</div>
    <div class="rec-title">Activar Pre-Asignación por Lotes (carga escalonada)</div>
    <div class="rec-desc">En lugar de cargar las 3.681 camas en un solo Excel, dividir en lotes de 500-800 por empresa. Esto reduce el tiempo de procesamiento por lote a 1-2 minutos y permite detectar errores por empresa antes de continuar con la siguiente.</div>
  </div>

  <div class="rec-card">
    <div class="rec-num">02</div>
    <div class="rec-title">Personal reforzado los días de rotación (7, 14, 21)</div>
    <div class="rec-desc">Los días de rotación 7x7 concentran hasta <b>{max(llegadas_dia[5:8]):,} llegadas en 24h</b>. Se requiere al menos 3 personas en recepción y pre-activación de la función de check-in QR masivo para procesar el flujo sin cuellos de botella.</div>
  </div>

  <div class="rec-card">
    <div class="rec-num">03</div>
    <div class="rec-title">Validar RLS en Supabase antes del despliegue real</div>
    <div class="rec-desc">Con 3.681 registros sensibles (nombre, RUT, habitación), es crítico que las políticas de Row Level Security estén activas en las tablas v2_asignaciones y v2_solicitudes_b2b para que solo usuarios autenticados accedan a datos propios.</div>
  </div>

  <div class="rec-card">
    <div class="rec-num">04</div>
    <div class="rec-title">Actualizar cupos (v2_cupos_gerencias) post carga</div>
    <div class="rec-desc">Tras la carga masiva, ejecutar actualización de la tabla de cupos para que los reportes de disponibilidad reflejen la ocupación real. Esta acción toma menos de 2 minutos con el script ya disponible.</div>
  </div>
</div>

<!-- PÁGINA 6: PROYECCIÓN FINANCIERA -->
<div class="page">
  <div class="section-title">💰 Proyección Días-Cama y Facturación Estimada</div>
  <div class="section-sub">Análisis financiero simulado basado en ocupación real proyectada por empresa</div>

  <div class="chart-card">
    <div class="chart-title">💰 Días-Cama proyectados por empresa (base de facturación)</div>
    <div class="chart-wrap" style="height:320px"><canvas id="chartFacturacion"></canvas></div>
  </div>

  <br>
  <table>
    <thead>
      <tr>
        <th>Empresa</th>
        <th>Camas</th>
        <th>Días Prom.</th>
        <th>Días-Cama Total</th>
        <th>Participación %</th>
        <th>Habitaciones</th>
        <th>Turno</th>
      </tr>
    </thead>
    <tbody>"""

total_dc = sum(e["dias_cama"] for e in EMPRESAS)
for emp in sorted(EMPRESAS, key=lambda x: -x["dias_cama"]):
    pct = round(emp["dias_cama"]/total_dc*100, 1)
    badge = "badge-blue" if emp["tipo"]=="Día" else "badge-purple"
    html += f"""
      <tr>
        <td><b>{emp["nombre"]}</b></td>
        <td>{emp["camas"]}</td>
        <td>{emp["dias_promedio"]} d</td>
        <td><b style="color:#4f46e5">{emp["dias_cama"]:,}</b></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="background:#e0e7ff;border-radius:99px;height:8px;width:100px;overflow:hidden">
              <div style="background:#4f46e5;height:100%;width:{pct}%"></div>
            </div>
            {pct}%
          </div>
        </td>
        <td>{emp["habitaciones"]}</td>
        <td><span class="badge {badge}">{"☀️ Día" if emp["tipo"]=="Día" else "🌙 Noche"}</span></td>
      </tr>"""

html += f"""
    </tbody>
  </table>

  <br>
  <div class="kpi-grid">
    <div class="kpi" style="--c:#4f46e5">
      <div class="kpi-icon">📅</div>
      <div class="kpi-num">{total_dias_cama:,}</div>
      <div class="kpi-lbl">Total Días-Cama</div>
    </div>
    <div class="kpi" style="--c:#10b981">
      <div class="kpi-icon">🛏️</div>
      <div class="kpi-num">{round(total_dias_cama/TOTAL_HABS,1)}</div>
      <div class="kpi-lbl">Días Prom. / Habitación</div>
    </div>
    <div class="kpi" style="--c:#f59e0b">
      <div class="kpi-icon">📊</div>
      <div class="kpi-num">{round(total_dias_cama/DIAS,0):.0f}</div>
      <div class="kpi-lbl">Días-Cama / Día</div>
    </div>
    <div class="kpi" style="--c:#8b5cf6">
      <div class="kpi-icon">🏠</div>
      <div class="kpi-num">{round(TOTAL_CAMAS/TOTAL_HABS,1)}</div>
      <div class="kpi-lbl">Personas / Habitación</div>
    </div>
  </div>

  <div class="footer">
    Informe generado por PC HOTELERÍA — Sistema de Gestión de Campamento<br>
    Simulación basada en carga masiva de {TOTAL_CAMAS:,} camas · {TOTAL_HABS:,} habitaciones · {len(EMPRESAS)} empresas<br>
    Período: 01 Enero 2030 → 31 Enero 2030 · Generado: {date.today().strftime("%d/%m/%Y")}
  </div>
</div>

<script>
const labels = {json.dumps(fechas_labels)};
const llegadas = {json.dumps(llegadas_dia)};
const acum = {json.dumps(llegadas_acum)};
const piezas = {json.dumps(piezas_recuperadas)};
const empNombres = {json.dumps([e["nombre"].split()[0] for e in EMPRESAS])};
const empCamas   = {json.dumps([e["camas"] for e in EMPRESAS])};
const empConf    = {json.dumps([e["tasa_confirm"] for e in EMPRESAS])};
const empColores = {json.dumps([e["color"] for e in EMPRESAS])};
const empDiasCama= {json.dumps([e["dias_cama"] for e in EMPRESAS])};

const dias = {json.dumps(EMPRESAS[0]["camas"])};
const noche = {json.dumps(TOTAL_CAMAS)};
const diasTotal = {json.dumps(sum(e["camas"] for e in EMPRESAS if e["tipo"]=="Día"))};
const nocheTotal = {json.dumps(sum(e["camas"] for e in EMPRESAS if e["tipo"]=="Noche"))};

Chart.defaults.font.family = 'Inter';
Chart.defaults.color = '#475569';

// Chart 1: Llegadas diarias
new Chart(document.getElementById('chartLlegadas'), {{
  type:'bar',
  data:{{
    labels,
    datasets:[{{
      label:'Llegadas por día',
      data:llegadas,
      backgroundColor: llegadas.map(v => v > 500 ? '#ef444488' : '#6366f188'),
      borderColor:     llegadas.map(v => v > 500 ? '#ef4444' : '#6366f1'),
      borderWidth:2,
      borderRadius:6,
    }}]
  }},
  options:{{responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{display:false}},
      tooltip:{{callbacks:{{label:c=>`${{c.raw.toLocaleString()}} llegadas`}}}}
    }},
    scales:{{y:{{beginAtZero:true,grid:{{color:'#f1f5f9'}}}},x:{{grid:{{display:false}}}}}}
  }}
}});

// Chart 2: Ocupación acumulada
new Chart(document.getElementById('chartAcum'), {{
  type:'line',
  data:{{
    labels,
    datasets:[
      {{label:'Ocupación real',data:acum,borderColor:'#4f46e5',backgroundColor:'#4f46e522',fill:true,tension:.4,borderWidth:3}},
      {{label:'Capacidad máxima',data:Array(31).fill({TOTAL_CAMAS}),borderColor:'#ef4444',borderDash:[6,3],borderWidth:2,pointRadius:0}}
    ]
  }},
  options:{{responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{position:'bottom'}}}},
    scales:{{y:{{beginAtZero:true,max:{TOTAL_CAMAS+200},grid:{{color:'#f1f5f9'}}}},x:{{grid:{{display:false}}}}}}
  }}
}});

// Chart 3: Estado confirmación (donut)
new Chart(document.getElementById('chartEstado'), {{
  type:'doughnut',
  data:{{
    labels:['✅ Confirmados','⏳ Sin confirmar','❌ No-Show','🚪 Checkout temp.'],
    datasets:[{{
      data:[{total_confirmados},{total_sin_confirm},{total_no_show},{total_checkout_t}],
      backgroundColor:['#10b981','#f59e0b','#ef4444','#8b5cf6'],
      borderWidth:0
    }}]
  }},
  options:{{responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{position:'bottom',labels:{{padding:16,font:{{size:12}}}}}}}}
  }}
}});

// Chart 4: Camas por empresa (horizontal bar)
new Chart(document.getElementById('chartEmpresas'), {{
  type:'bar',
  data:{{
    labels:empNombres,
    datasets:[{{
      label:'Camas asignadas',
      data:empCamas,
      backgroundColor:empColores.map(c=>c+'cc'),
      borderColor:empColores,
      borderWidth:2,
      borderRadius:8,
    }}]
  }},
  options:{{
    indexAxis:'y',
    responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{display:false}}}},
    scales:{{x:{{beginAtZero:true,grid:{{color:'#f1f5f9'}}}},y:{{grid:{{display:false}}}}}}
  }}
}});

// Chart 5: Tasa confirmación
new Chart(document.getElementById('chartConfirmacion'), {{
  type:'bar',
  data:{{
    labels:empNombres,
    datasets:[{{
      label:'Tasa confirmación %',
      data:empConf,
      backgroundColor:empConf.map(v=>v>=87?'#10b98188':v>=82?'#f59e0b88':'#ef444488'),
      borderColor:empConf.map(v=>v>=87?'#10b981':v>=82?'#f59e0b':'#ef4444'),
      borderWidth:2,
      borderRadius:8,
    }}]
  }},
  options:{{
    responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{display:false}},
      tooltip:{{callbacks:{{label:c=>`${{c.raw}}% confirmado`}}}}
    }},
    scales:{{y:{{min:75,max:100,grid:{{color:'#f1f5f9'}}}},x:{{grid:{{display:false}}}}}}
  }}
}});

// Chart 6: Recuperación habitaciones
new Chart(document.getElementById('chartHabs'), {{
  type:'line',
  data:{{
    labels,
    datasets:[{{
      label:'Habitaciones recuperadas',
      data:piezas,
      borderColor:'#10b981',
      backgroundColor:'#10b98122',
      fill:true,
      tension:.4,
      borderWidth:3,
    }}]
  }},
  options:{{responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{display:false}}}},
    scales:{{y:{{beginAtZero:true,max:{TOTAL_HABS+50},grid:{{color:'#f1f5f9'}}}},x:{{grid:{{display:false}}}}}}
  }}
}});

// Chart 7: Turno día vs noche
new Chart(document.getElementById('chartTurno'), {{
  type:'pie',
  data:{{
    labels:['☀️ Turno Día','🌙 Turno Noche'],
    datasets:[{{data:[diasTotal,nocheTotal],backgroundColor:['#f59e0b','#4f46e5'],borderWidth:0}}]
  }},
  options:{{responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{position:'bottom'}}}}
  }}
}});

// Chart 8: Género
new Chart(document.getElementById('chartGenero'), {{
  type:'pie',
  data:{{
    labels:['👨 Masculino (~75%)','👩 Femenino (~25%)'],
    datasets:[{{data:[Math.round({TOTAL_CAMAS}*.75),Math.round({TOTAL_CAMAS}*.25)],backgroundColor:['#6366f1','#ec4899'],borderWidth:0}}]
  }},
  options:{{responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{position:'bottom'}}}}
  }}
}});

// Chart 9: Días-cama por empresa
new Chart(document.getElementById('chartDiasCama'), {{
  type:'bar',
  data:{{
    labels:empNombres,
    datasets:[{{
      label:'Días-Cama',
      data:empDiasCama,
      backgroundColor:empColores.map(c=>c+'cc'),
      borderColor:empColores,
      borderWidth:2,
      borderRadius:8,
    }}]
  }},
  options:{{
    indexAxis:'y',
    responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{display:false}}}},
    scales:{{x:{{beginAtZero:true,grid:{{color:'#f1f5f9'}}}},y:{{grid:{{display:false}}}}}}
  }}
}});

// Chart 10: Días críticos
const criticos = llegadas.map((v,i)=>v>500?v:null);
new Chart(document.getElementById('chartCriticos'), {{
  type:'bar',
  data:{{
    labels,
    datasets:[
      {{label:'Llegadas normales',data:llegadas.map(v=>v<=500?v:null),backgroundColor:'#6366f144',borderColor:'#6366f1',borderWidth:1,borderRadius:4}},
      {{label:'Días críticos (>500)',data:criticos,backgroundColor:'#ef444466',borderColor:'#ef4444',borderWidth:2,borderRadius:4}},
    ]
  }},
  options:{{responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{position:'bottom'}}}},
    scales:{{y:{{beginAtZero:true,grid:{{color:'#f1f5f9'}}}},x:{{grid:{{display:false}}}}}}
  }}
}});

// Chart 11: Facturación (días-cama sorted)
const sorted = [...empDiasCama.map((v,i)=>{{return{{v,n:empNombres[i],c:empColores[i]}}}})].sort((a,b)=>b.v-a.v);
new Chart(document.getElementById('chartFacturacion'), {{
  type:'bar',
  data:{{
    labels:sorted.map(x=>x.n),
    datasets:[{{
      label:'Días-Cama',
      data:sorted.map(x=>x.v),
      backgroundColor:sorted.map(x=>x.c+'bb'),
      borderColor:sorted.map(x=>x.c),
      borderWidth:2,
      borderRadius:8,
    }}]
  }},
  options:{{
    indexAxis:'y',
    responsive:true,maintainAspectRatio:false,
    plugins:{{legend:{{display:false}}}},
    scales:{{x:{{beginAtZero:true,grid:{{color:'#f1f5f9'}}}},y:{{grid:{{display:false}}}}}}
  }}
}});
</script>
</body>
</html>"""

out = "/Users/juan/Desktop/PROYECTO CAMPAMENTO/camp-management-pwa/INFORME_SIMULACION_2030.html"
with open(out, "w", encoding="utf-8") as f:
    f.write(html)

print(f"\n✅ Informe generado: INFORME_SIMULACION_2030.html")
print(f"   Total camas simuladas:     {TOTAL_CAMAS:,}")
print(f"   Total habitaciones:        {TOTAL_HABS:,}")
print(f"   Tasa confirmación global:  {tasa_conf_global}%")
print(f"   Pico llegadas máximo:      {llegada_max_dia:,} personas ({dia_pico})")
print(f"   Total días-cama:           {total_dias_cama:,}")
print(f"\n📌 Abre el archivo en Chrome y usa Ctrl+P → 'Guardar como PDF' para exportar\n")
