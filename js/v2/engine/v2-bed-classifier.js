/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  v2-bed-classifier.js  —  Motor de Clasificación de Camas              ║
 * ║  REGLAS INMUTABLES DE INFRAESTRUCTURA                                   ║
 * ║  Single Source of Truth: toda clasificación del sistema hereda de aquí. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Uso:
 *   import { classifyBed, classifyAll, CAT, RULES } from './v2-bed-classifier.js';
 *
 *   const result = classifyBed(3410, 2, false);
 *   // → { cat: 'ANGLO_NOCHE', ruleId: 'R01', ruleLabel: '...', auditNote: '...' }
 *
 *   const breakdown = classifyAll(camas, habMap, camaById, r220IdSet);
 *   // → { counts, porPab, noClasif, isValid, delta }
 */

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORÍAS (enum inmutable)
// ══════════════════════════════════════════════════════════════════════════════
export const CAT = Object.freeze({
  ANGLO_DIA:    'ANGLO_DIA',    // Cama Día Anglo  (C1 en zona Anglo)
  ANGLO_NOCHE:  'ANGLO_NOCHE',  // Cama Noche Anglo (C2 en zona Anglo)
  DIA:          'DIA',          // Cama Día ESSE (C1/C2/C3 en zonas Día)
  ESSE_NOCHE:   'ESSE_NOCHE',   // Cama Noche ESSE (Pab7 + etiqueta BD)
  NO_CLASIF:    'NO_CLASIF',    // Sin regla → alerta de datos
});

// ══════════════════════════════════════════════════════════════════════════════
// REGLAS INMUTABLES (primer match gana — orden es prioridad)
// ══════════════════════════════════════════════════════════════════════════════
export const RULES = Object.freeze([
  // ── R01 ─ Anglo — Pab3 piso 3 (hab 3301-3637): C1=Día, C2=Noche Anglo ──
  {
    id:    'R01',
    label: 'Anglo — Pab.3 piso 3 (hab 3301–3637)',
    desc:  'C1 → Cama Día Anglo · C2 → Cama Noche Anglo',
    color: '#d97706',
    test:  (n, _nc, _r220) => n >= 3301 && n <= 3637,
    classify: (_n, numCama) => numCama === 1 ? CAT.ANGLO_DIA : CAT.ANGLO_NOCHE,
    auditNote: (n, nc) =>
      `Hab.${n} (Pab.3 piso 3) → C${nc} contada como [${nc === 1 ? 'Cama Día Anglo' : 'Cama Noche Anglo'}] por Regla R01: rango 3301–3637`,
  },

  // ── R02 ─ Anglo — Pabellón 1 completo (1000-1999): C1=Día, C2=Noche Anglo
  {
    id:    'R02',
    label: 'Anglo — Pabellón 1 completo (hab 1000–1999)',
    desc:  'C1 → Cama Día Anglo · C2 → Cama Noche Anglo',
    color: '#b45309',
    test:  (n, _nc, _r220) => n >= 1000 && n <= 1999,
    classify: (_n, numCama) => numCama === 1 ? CAT.ANGLO_DIA : CAT.ANGLO_NOCHE,
    auditNote: (n, nc) =>
      `Hab.${n} (Pabellón 1) → C${nc} contada como [${nc === 1 ? 'Cama Día Anglo' : 'Cama Noche Anglo'}] por Regla R02: Pabellón 1 completo`,
  },

  // ── R03 ─ Anglo — Pabellón 2 completo (2000-2999): C1=Día, C2=Noche Anglo
  {
    id:    'R03',
    label: 'Anglo — Pabellón 2 completo (hab 2000–2999)',
    desc:  'C1 → Cama Día Anglo · C2 → Cama Noche Anglo',
    color: '#92400e',
    test:  (n, _nc, _r220) => n >= 2000 && n <= 2999,
    classify: (_n, numCama) => numCama === 1 ? CAT.ANGLO_DIA : CAT.ANGLO_NOCHE,
    auditNote: (n, nc) =>
      `Hab.${n} (Pabellón 2) → C${nc} contada como [${nc === 1 ? 'Cama Día Anglo' : 'Cama Noche Anglo'}] por Regla R03: Pabellón 2 completo`,
  },

  // ── R04 ─ Día — Pab3 piso 1 (hab 3101-3235): TODAS las camas = Día ──────
  {
    id:    'R04',
    label: 'Día — Pab.3 piso 1 (hab 3101–3235)',
    desc:  'C1, C2, C3 → Cama Día',
    color: '#059669',
    test:  (n, _nc, _r220) => n >= 3101 && n <= 3235,
    classify: () => CAT.DIA,
    auditNote: (n, nc) =>
      `Hab.${n} (Pab.3 piso 1) → C${nc} contada como [Cama Día] por Regla R04: rango 3101–3235, todas las camas son Día`,
  },

  // ── R05 ─ Día — Pabellón 4 completo (4000-4999) ──────────────────────────
  {
    id:    'R05',
    label: 'Día — Pabellón 4 completo (hab 4000–4999)',
    desc:  'C1, C2, C3 → Cama Día',
    color: '#0891b2',
    test:  (n, _nc, _r220) => n >= 4000 && n <= 4999,
    classify: () => CAT.DIA,
    auditNote: (n, nc) =>
      `Hab.${n} (Pabellón 4) → C${nc} contada como [Cama Día] por Regla R05: Pabellón 4 completo`,
  },

  // ── R06 ─ Día — Pabellón 5 completo (5000-5999) ──────────────────────────
  {
    id:    'R06',
    label: 'Día — Pabellón 5 completo (hab 5000–5999)',
    desc:  'C1, C2, C3 → Cama Día',
    color: '#0284c7',
    test:  (n, _nc, _r220) => n >= 5000 && n <= 5999,
    classify: () => CAT.DIA,
    auditNote: (n, nc) =>
      `Hab.${n} (Pabellón 5) → C${nc} contada como [Cama Día] por Regla R06: Pabellón 5 completo`,
  },

  // ── R07 ─ Día — Pabellón 6 completo (6000-6999) ──────────────────────────
  {
    id:    'R07',
    label: 'Día — Pabellón 6 completo (hab 6000–6999)',
    desc:  'C1, C2, C3 → Cama Día',
    color: '#7c3aed',
    test:  (n, _nc, _r220) => n >= 6000 && n <= 6999,
    classify: () => CAT.DIA,
    auditNote: (n, nc) =>
      `Hab.${n} (Pabellón 6) → C${nc} contada como [Cama Día] por Regla R07: Pabellón 6 completo`,
  },

  // ── R08 ─ Noche ESSE — Pabellón 7 (hab 7101-7635): TODAS = Noche ────────
  {
    id:    'R08',
    label: 'Noche ESSE — Pabellón 7 (hab 7101–7635)',
    desc:  'C1, C2, C3 → Cama Noche ESSE',
    color: '#9333ea',
    test:  (n, _nc, _r220) => n >= 7101 && n <= 7635,
    classify: () => CAT.ESSE_NOCHE,
    auditNote: (n, nc) =>
      `Hab.${n} (Pabellón 7) → C${nc} contada como [Cama Noche ESSE] por Regla R08: rango 7101–7635, todas las camas son Noche`,
  },

  // ── R09 ─ Día — Pabellón 8 completo (8000-8999) ──────────────────────────
  {
    id:    'R09',
    label: 'Día — Pabellón 8 completo (hab 8000–8999)',
    desc:  'C1, C2, C3 → Cama Día',
    color: '#0f766e',
    test:  (n, _nc, _r220) => n >= 8000 && n <= 8999,
    classify: () => CAT.DIA,
    auditNote: (n, nc) =>
      `Hab.${n} (Pabellón 8) → C${nc} contada como [Cama Día] por Regla R09: Pabellón 8 completo`,
  },

  // ── R10 ─ Día — Sector REF 220 (todas las camas) ─────────────────────────
  {
    id:    'R10',
    label: 'Día — Sector REF 220 (todas las habitaciones del sector)',
    desc:  'C1, C2, C3 → Cama Día',
    color: '#0ea5e9',
    test:  (_n, _nc, isR220) => isR220 === true,
    classify: () => CAT.DIA,
    auditNote: (n, nc) =>
      `Hab.${n} (REF 220) → C${nc} contada como [Cama Día] por Regla R10: Sector REF 220, todas las camas son Día`,
  },
]);

// ══════════════════════════════════════════════════════════════════════════════
// HELPER: extraer número de habitación como entero desde habMap o id_cama
// ══════════════════════════════════════════════════════════════════════════════
export function numHabInt(habId, idCama, habMap) {
  if (habMap) {
    const fromMap = habMap[String(habId || '')]?.numero_hab;
    if (fromMap) return parseInt(String(fromMap).replace(/\D/g, '') || '0', 10);
  }
  const stripped = String(idCama || '')
    .replace(/-C\d+$/i, '')
    .replace(/^COPC0*/i, '')
    .replace(/^R[.\-]?220[-\w]*/i, '')
    .replace(/^0+/, '');
  return parseInt(stripped || '0', 10);
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PURA: classifyBed
// Inputs:  numHab (int), numCama (int 1|2|3), isR220 (bool)
// Output:  { cat, ruleId, ruleLabel, auditNote }
// ══════════════════════════════════════════════════════════════════════════════
export function classifyBed(numHab, numCama, isR220 = false) {
  for (const rule of RULES) {
    if (rule.test(numHab, numCama, isR220)) {
      return {
        cat:       rule.classify(numHab, numCama),
        ruleId:    rule.id,
        ruleLabel: rule.label,
        ruleColor: rule.color,
        auditNote: rule.auditNote(numHab, numCama),
      };
    }
  }
  // Sin match → No Clasificado (alerta de datos)
  return {
    cat:       CAT.NO_CLASIF,
    ruleId:    'R??',
    ruleLabel: 'Sin regla — No Clasificado',
    ruleColor: '#ef4444',
    auditNote: `Hab.${numHab} → C${numCama} NO entra en ninguna regla de infraestructura. Revisar data fuente.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: classifyAll
// Itera todas las camas, aplica RULES, acumula contadores y desglose por pabellón.
// Exportable y "memoizable" (inputs puros → output determinista).
// ══════════════════════════════════════════════════════════════════════════════
export function classifyAll(camas, habMap, camaById, r220IdSet) {
  const counts = {
    [CAT.ANGLO_DIA]:   0,
    [CAT.ANGLO_NOCHE]: 0,
    [CAT.DIA]:         0,
    [CAT.ESSE_NOCHE]:  0,
    [CAT.NO_CLASIF]:   0,
  };

  // porPab: { 'P1': { pabKey, pabNum, ruleId, ruleLabel, ruleColor, angloDia, angloNoche, dia, esseNoche, noClasif, total } }
  const porPab   = {};
  // noClasif: lista detallada de camas sin regla (para alerta)
  const noClasif = [];

  let totalValidas = 0;

  for (const c of camas) {
    if (/deshabiit|deshabilit/i.test(c.estado || '')) continue;
    totalValidas++;

    const rec      = camaById?.[String(c.id_cama)] || c;
    const habId    = rec.habitacion_id   || c.habitacion_id   || '';
    const numCama  = Number(rec.numero_cama || c.numero_cama  || 0);
    const isR220   = r220IdSet ? r220IdSet.has(String(c.id_cama)) : false;
    const numHab   = numHabInt(habId, c.id_cama, habMap);

    const { cat, ruleId, ruleLabel, ruleColor, auditNote } =
      classifyBed(numHab, numCama, isR220);

    // Acumular globales
    counts[cat]++;

    // Acumular por pabellón
    const pabNum = numHab > 0 ? Math.floor(numHab / 1000) : 0;
    const pabKey = pabNum > 0 ? `P${pabNum}` : (isR220 ? 'REF220' : '?');

    if (!porPab[pabKey]) {
      porPab[pabKey] = {
        pabKey, pabNum: isR220 ? 999 : pabNum,
        ruleId, ruleLabel, ruleColor,
        angloDia: 0, angloNoche: 0, dia: 0, esseNoche: 0, noClasif: 0,
        total: 0,
      };
    }
    const p = porPab[pabKey];
    p.total++;
    if      (cat === CAT.ANGLO_DIA)   p.angloDia++;
    else if (cat === CAT.ANGLO_NOCHE) p.angloNoche++;
    else if (cat === CAT.DIA)         p.dia++;
    else if (cat === CAT.ESSE_NOCHE)  p.esseNoche++;
    else                               p.noClasif++;

    // Guardar no clasificadas
    if (cat === CAT.NO_CLASIF) {
      noClasif.push({ id_cama: c.id_cama, habId, numHab, numCama, isR220, auditNote });
    }
  }

  const totalClasif = counts[CAT.ANGLO_DIA] + counts[CAT.ANGLO_NOCHE]
                    + counts[CAT.DIA] + counts[CAT.ESSE_NOCHE];
  const delta = totalValidas - totalClasif - counts[CAT.NO_CLASIF];

  return {
    counts,
    totalValidas,
    totalClasif,
    noClasif,
    porPab,
    isValid: counts[CAT.NO_CLASIF] === 0 && delta === 0,
    delta,
    // Shortcuts para UI
    angloDia:   counts[CAT.ANGLO_DIA],
    angloNoche: counts[CAT.ANGLO_NOCHE],
    totalAnglo: counts[CAT.ANGLO_DIA] + counts[CAT.ANGLO_NOCHE],
    dia:        counts[CAT.DIA],
    esseNoche:  counts[CAT.ESSE_NOCHE],
    totalESSE:  counts[CAT.DIA] + counts[CAT.ESSE_NOCHE],
    totalNoche: counts[CAT.ANGLO_NOCHE] + counts[CAT.ESSE_NOCHE],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN DE AUDITORÍA: lookupRoom
// Dado un número de habitación, devuelve el veredicto para C1, C2 y C3.
// ══════════════════════════════════════════════════════════════════════════════
export function lookupRoom(numHab, isR220 = false) {
  return [1, 2, 3].map(nc => ({
    numCama: nc,
    ...classifyBed(numHab, nc, isR220),
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
// MATRIZ RESUMEN DE REGLAS (para mostrar en UI como referencia)
// ══════════════════════════════════════════════════════════════════════════════
export const RULES_SUMMARY = RULES.map(r => ({
  id: r.id, label: r.label, desc: r.desc, color: r.color,
}));
