/**
 * v2-data-engine.js — Motor Centralizado de Datos (Single Source of Truth)
 * PC Hotelería Los Bronces — Módulo Detalle
 *
 * GARANTÍAS MATEMÁTICAS (para cualquier combinación de filtros F):
 *   sum(porEmpresa(F).map(g => g.length)) === kpiTotal(F)
 *   sum(porGerencia(F).map(g => g.total)) === kpiTotal(F)
 *   sum(porSup(F).map(g => g.total))      === kpiTotal(F)
 *
 * Ecuación de Balance Logístico:
 *   CapacidadTotal = Ocupadas + Reservas + Libres + Bloqueadas
 */

// ── Constantes de etiquetas ────────────────────────────────────────────────────
export const POR_ASIGNAR = 'POR ASIGNAR';
export const SIN_EMPRESA  = 'SIN EMPRESA';

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS DE FECHA — Timezone-Safe (Chile UTC-4 / UTC-3 DST)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Parsea una fecha como medianoche LOCAL.
 * EVITA el clásico bug UTC donde new Date('2024-06-20') = 2024-06-19T20:00 en Chile.
 * @param {string} dateStr — formato 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm...'
 * @returns {Date|null}
 */
export function toLocalMidnight(dateStr) {
  if (!dateStr) return null;
  const part = String(dateStr).trim().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return null;
  const [y, m, d] = part.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0); // ← medianoche local, no UTC
}

/** Retorna la fecha local de hoy a medianoche */
export function todayLocal() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0);
}

/** Formatea Date → 'YYYY-MM-DD' en zona local */
export function localDateStr(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// NORMALIZADORES
// ══════════════════════════════════════════════════════════════════════════════

/** Limpia RUT para usarlo como clave de lookup */
export function normRut(r) {
  return String(r || '').replace(/[.\-\s]/g, '').toUpperCase().trim();
}

/** Normaliza turno para comparación case-insensitive */
export function normTurno(t) {
  return String(t || '').replace(/\s/g, '').toUpperCase();
}

/**
 * Retorna el string si es no-vacío y no es '—', sino null.
 * Esto asegura que los campos vacíos caigan al label POR_ASIGNAR.
 */
function normStr(v) {
  const s = String(v || '').trim();
  return (s && s !== '—' && s !== '-' && s !== 'null' && s !== 'undefined') ? s : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNOS DE AGRUPACIÓN
// ══════════════════════════════════════════════════════════════════════════════

/** Agrupa array por clave → { key: [items] } */
function _groupByArr(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

/** Agrupa array por clave → { key: { total, conf } } */
function _groupByCount(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    if (!acc[k]) acc[k] = { total: 0, conf: 0 };
    acc[k].total++;
    if (item.huesped_confirmo) acc[k].conf++;
    return acc;
  }, {});
}

/** Verifica si una cama pertenece al sector REF 220 */
function _isR220(idCama) {
  return /^R[.\-]?220/i.test(String(idCama || ''));
}

/**
 * Valida que sum(grupos) === total.
 * Imprime en consola con badge ✅ o ⚠️.
 */
function _assertBalance(tab, total, porEmpresa, porGerencia, porSup) {
  const sumEmp = Object.values(porEmpresa).reduce((s, arr) => s + arr.length, 0);
  const sumGer = Object.values(porGerencia).reduce((s, g) => s + g.total, 0);
  const sumSup = Object.values(porSup).reduce((s, g) => s + g.total, 0);
  const ok = sumEmp === total && sumGer === total && sumSup === total;
  if (ok) {
    console.log(`%c[DataEngine] ✅ ${tab} — Balance OK: total=${total} emp=${sumEmp} ger=${sumGer} sup=${sumSup}`,
      'color:#10b981;font-weight:700');
  } else {
    console.warn(`[DataEngine] ⚠️ ${tab} — DISCREPANCIA detectada:\n` +
      `  total=${total}  emp=${sumEmp}  ger=${sumGer}  sup=${sumSup}\n` +
      `  Diferencias: emp-Δ=${sumEmp - total}  ger-Δ=${sumGer - total}  sup-Δ=${sumSup - total}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MOTOR DE DATOS — CampDataEngine
// ══════════════════════════════════════════════════════════════════════════════
export class CampDataEngine {
  /**
   * @param {Object} rawData — Datos crudos de Supabase
   * @param {Array}  rawData.camas
   * @param {Array}  rawData.camasCOPC
   * @param {Array}  rawData.camasR220
   * @param {Array}  rawData.habitacionesAll
   * @param {Object} rawData.habMap           — { id_custom: habRecord }
   * @param {Array}  rawData.asigActivas       — ya pre-filtradas (estado activo/pre vencido)
   * @param {Array}  rawData.asigPre           — ya pre-filtradas (pre futuras)
   * @param {Array}  rawData.distribucion
   * @param {Array}  rawData.solsB2B
   * @param {Set}    rawData.camaNocheSet
   */
  constructor(rawData) {
    this._raw   = rawData;
    this._cache = null; // Lazy — se computa al primer acceso
  }

  // ── Computed cache (equivalente a useMemo) ───────────────────────────────
  get _p() {
    if (!this._cache) this._cache = Object.freeze(this._processAll());
    return this._cache;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROCESAMIENTO PRINCIPAL — corre UNA SOLA VEZ por carga de datos
  // ══════════════════════════════════════════════════════════════════════════
  _processAll() {
    const {
      camas           = [],
      camasCOPC       = [],
      camasR220       = [],
      habitacionesAll = [],
      habMap          = {},
      asigActivas     = [],
      asigPre         = [],
      distribucion    = [],
      solsB2B         = [],
      camaNocheSet    = new Set(),
    } = this._raw;

    // ── Mapa B2B: RUT y Contrato → solicitud ────────────────────────────
    const solsMap        = {};
    const solsByContrato = {};
    solsB2B.forEach(s => {
      const k  = normRut(s.rut_trabajador || s.rut || '');
      if (k) solsMap[k] = s;
      const kc = String(s.n_contrato || s.numero_contrato || '').trim();
      if (kc) solsByContrato[kc] = s;
    });

    // ── Función de enriquecimiento (FUENTE ÚNICA de _turno/_gerencia/_sup) ─
    const _enrich = (asig) => {
      const k   = normRut(asig.rut_huesped);
      const kc  = String(asig.numero_contrato || '').trim();
      const sol = solsMap[k] || solsByContrato[kc] || {};
      // v2_empresas puede ser objeto o array (depende del query de Supabase)
      const emp = Array.isArray(asig.v2_empresas) ? asig.v2_empresas[0] : (asig.v2_empresas || {});
      return {
        ...asig,
        _turno:            normStr(sol.shift_name) || normStr(sol.turno) || normStr(emp?.turno) || POR_ASIGNAR,
        _gerencia:         normStr(sol.gerencia)   || normStr(emp?.v2_gerencias?.nombre)         || POR_ASIGNAR,
        _superintendencia: normStr(sol.origen)     || POR_ASIGNAR,
        _empresa:          normStr(emp?.nombre)    || normStr(sol.empresa)                       || SIN_EMPRESA,
      };
    };

    // ── Asignaciones enriquecidas ─────────────────────────────────────────
    const activas  = asigActivas.map(_enrich);
    const reservas = asigPre.map(_enrich);

    // ── Mapa de distribución empresa por cama ────────────────────────────
    const distEmpMap = {};
    distribucion.forEach(d => {
      if (d.tipo === 'empresa') distEmpMap[String(d.id_cama)] = normStr(d.etiqueta) || '—';
    });

    // ── Sets de estado ────────────────────────────────────────────────────
    const camasOcupSet = new Set(activas.map(a => String(a.id_cama)));
    const camasPreSet  = new Set(reservas.map(a => String(a.id_cama)));

    // ── Habitaciones bloqueadas ───────────────────────────────────────────
    const esBloqueo     = h => /manten|reparac|bloquea|bloqu/i.test(h.estado || '') || h.en_mantencion === true;
    const habsBloqueadas = habitacionesAll.filter(esBloqueo);
    const habsBloqIds   = new Set(habsBloqueadas.map(h => String(h.id_custom || h.id || '')));

    // ── Camas deshabilitadas (excluidas de todos los conteos) ─────────────
    const esDeshabilitada = c => /deshabiit|deshabilit/i.test(c.estado || '');

    // ── Camas válidas (no deshabilitadas) ─────────────────────────────────
    const camasValidas = camas.filter(c => !esDeshabilitada(c));

    // ── Camas libres ──────────────────────────────────────────────────────
    // Libre = no ocupada AND no pre-asignada AND no en hab bloqueada
    const camasLibres = camasValidas.filter(c =>
      !camasOcupSet.has(String(c.id_cama)) &&
      !camasPreSet.has(String(c.id_cama))  &&
      !habsBloqIds.has(String(c.habitacion_id || c.v2_habitaciones?.id_custom || ''))
    );

    // ── Camas en habitaciones bloqueadas (para ecuación de balance) ───────
    const camasBloqCount = camasValidas.filter(c =>
      habsBloqIds.has(String(c.habitacion_id || c.v2_habitaciones?.id_custom || ''))
    ).length;

    // ── ECUACIÓN DE BALANCE LOGÍSTICO ──────────────────────────────────────
    // Total = Ocupadas + Reservas + Libres + Bloqueadas
    // delta ≠ 0 puede indicar datos inconsistentes en BD (cama bloqueada con asignación activa)
    const balance = {
      total:      camasValidas.length,
      ocupadas:   camasOcupSet.size,   // camas únicas con asignación activa
      reservas:   camasPreSet.size,    // camas únicas con pre-asignación futura
      libres:     camasLibres.length,
      bloqueadas: camasBloqCount,
      personas:   activas.length,      // personas (puede > camas si hay multi-cama)
      get delta()      { return this.total - (this.ocupadas + this.reservas + this.libres + this.bloqueadas); },
      get isBalanced() { return this.delta === 0; },
    };

    // Log de diagnóstico de balance
    if (balance.isBalanced) {
      console.log(
        `%c[DataEngine] ✅ BALANCE OK — Total:${balance.total} = ` +
        `Ocup:${balance.ocupadas} + Res:${balance.reservas} + ` +
        `Lib:${balance.libres} + Bloq:${balance.bloqueadas}`,
        'color:#10b981;font-weight:700'
      );
    } else {
      console.warn(
        `[DataEngine] ⚠️ BALANCE — Δ=${balance.delta}\n` +
        `  Total:${balance.total}  Ocup:${balance.ocupadas}  Res:${balance.reservas}` +
        `  Lib:${balance.libres}  Bloq:${balance.bloqueadas}\n` +
        `  (Δ≠0 puede indicar camas bloqueadas con asignación activa en BD)`
      );
    }

    return {
      activas, reservas, distEmpMap, balance,
      camasValidas, camasLibres,
      camasOcupSet, camasPreSet,
      habsBloqueadas, habsBloqIds,
      camasBloqCount,
      camasCOPC:    camasCOPC.filter(c => !esDeshabilitada(c)),
      camasR220:    camasR220.filter(c => !esDeshabilitada(c)),
      camaNocheSet,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ══════════════════════════════════════════════════════════════════════════

  /** Ecuación de balance logístico del campamento */
  getBalance() { return this._p.balance; }

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Datos para el tab OCUPADAS.
   * GARANTÍA: kpiTotal === sum(porEmpresa) === sum(porGerencia) === sum(porSup)
   *
   * @param {Object} filters
   * @param {string|null} filters.turno
   * @param {string|null} filters.empresa
   * @param {string|null} filters.superintendencia
   */
  getOcupadas(filters = {}) {
    const { activas, camasCOPC, camasR220, camaNocheSet } = this._p;

    // ── 1. Filtrar desde la fuente base ─────────────────────────────────
    let data = activas;
    if (filters.turno)            data = data.filter(a => normTurno(a._turno) === normTurno(filters.turno));
    if (filters.empresa)          data = data.filter(a => a._empresa === filters.empresa);
    if (filters.superintendencia) data = data.filter(a => a._superintendencia === filters.superintendencia);

    // ── 2. KPIs — TODOS derivados de `data` (FUENTE ÚNICA) ─────────────
    const ocupSet  = new Set(data.map(a => String(a.id_cama)));
    const kpiTotal = data.length;                    // personas asignadas en el filtro
    const kpiCamas = ocupSet.size;                   // camas únicas ocupadas en el filtro
    const kpiCOPC  = camasCOPC.filter(c => ocupSet.has(String(c.id_cama)) && !camaNocheSet.has(String(c.id_cama))).length;
    const kpiR220  = camasR220.filter(c => ocupSet.has(String(c.id_cama))).length;
    const kpiNoche = camasCOPC.filter(c => ocupSet.has(String(c.id_cama)) && camaNocheSet.has(String(c.id_cama))).length;

    // ── 3. Agrupaciones — TODAS derivadas de `data` ─────────────────────
    //    GARANTÍA: sum(cada grupo) === kpiTotal por construcción matemática
    const porEmpresa  = _groupByArr(data,   a => a._empresa);
    const porGerencia = _groupByCount(data, a => a._gerencia);
    const porSup      = _groupByCount(data, a => a._superintendencia);
    const porTurno    = _groupByCount(data, a => a._turno);

    // ── 4. Opciones de dropdown (sin filtro para mostrar todas las opciones) ─
    const todasEmpresas = [...new Set(activas.map(a => a._empresa))].sort();
    const todasSups     = [...new Set(activas.map(a => a._superintendencia))].sort();

    // ── 5. Verificación matemática en consola ────────────────────────────
    _assertBalance('Ocupadas', kpiTotal, porEmpresa, porGerencia, porSup);

    return {
      data, kpiTotal, kpiCamas, kpiCOPC, kpiR220, kpiNoche,
      porEmpresa, porGerencia, porSup, porTurno,
      todasEmpresas, todasSups,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Datos para el tab RESERVAS.
   * GARANTÍA: kpiTotal === sum(porEmpresa) === sum(porGerencia) === sum(porSup)
   *
   * @param {Object} filters
   */
  getReservas(filters = {}) {
    const { reservas, camasCOPC, camasR220 } = this._p;

    let data = reservas;
    if (filters.turno)            data = data.filter(a => normTurno(a._turno) === normTurno(filters.turno));
    if (filters.empresa)          data = data.filter(a => a._empresa === filters.empresa);
    if (filters.superintendencia) data = data.filter(a => a._superintendencia === filters.superintendencia);

    const preSet    = new Set(data.map(a => String(a.id_cama)));
    const kpiTotal  = data.length;
    const kpiCamas  = preSet.size;
    const kpiCOPC   = camasCOPC.filter(c => preSet.has(String(c.id_cama))).length;
    const kpiR220   = camasR220.filter(c => preSet.has(String(c.id_cama))).length;

    const porEmpresa  = _groupByArr(data,   a => a._empresa);
    const porGerencia = _groupByCount(data, a => a._gerencia);
    const porSup      = _groupByCount(data, a => a._superintendencia);
    const porTurno    = _groupByCount(data, a => a._turno);

    const todasEmpresas = [...new Set(reservas.map(a => a._empresa))].sort();
    const todasSups     = [...new Set(reservas.map(a => a._superintendencia))].sort();

    _assertBalance('Reservas', kpiTotal, porEmpresa, porGerencia, porSup);

    return {
      data, kpiTotal, kpiCamas, kpiCOPC, kpiR220,
      porEmpresa, porGerencia, porSup, porTurno,
      todasEmpresas, todasSups,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  /** Datos para el tab LIBRES (No Ocupado) */
  getLibres() {
    const { camasLibres, camasCOPC, camasR220, distEmpMap } = this._p;
    return {
      libresAll:  camasLibres,
      libresCOPC: camasLibres.filter(c => !_isR220(c.id_cama)),
      libresR220: camasLibres.filter(c => _isR220(c.id_cama)),
      distEmpMap,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  /** Datos para el tab BLOQUEADAS */
  getBloqueadas() {
    return { habsBloqueadas: this._p.habsBloqueadas };
  }
}
