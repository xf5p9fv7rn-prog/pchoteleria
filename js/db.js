/**
 * PC Hotelería — IndexedDB Layer Híbrida
 * v51 - VERSIÓN MAESTRA DEFINITIVA + GÉNEROS BLINDADOS + ANTI-CLONES
 */

import { MASTER_ROOMS } from './roomsConfig.js';
import { supabase } from './supabaseClient.js';

const DB_NAME = 'campmanager_db';
const DB_VERSION = 4; 

let _db = null;
const _isSyncing = {}; 
const _brokenTables = {}; 
let _isProcessingQueue = false; 

// 🚀 CACHÉ EN MEMORIA: Evita leer IndexedDB en cada operación — respuesta instantánea
const _memCache = {};
// Expo  ner globalmente para que Constanza y otros módulos lean los mismos datos que el Dashboard
window._memCache = _memCache;

// ⏱️ Escrituras locales recientes — para no aplicar nuestros propios cambios via realtime
const _recentLocalWrites = new Map();
const RT_IGNORE_WINDOW_MS = 6000; // 6s de gracia

// 🔒 Protección de IDs modificados localmente — PERSISTIDA en localStorage con expiración 24h
// • Se marca al hacer put() local
// • Se LIMPIA al confirmar upsert exitoso en Supabase  
// • Expira automáticamente después de 30s — suficiente para evitar eco Realtime propio
// • Permite edición multi-dispositivo: otros dispositivos ven cambios en ∼1s (Realtime)
const _PROTECT_MS  = 30 * 1000; // 30 segundos (antes: 24h) — multi-device friendly
const _LM_LS_KEY   = 'campmanager_lm_v2';  // localStorage key
const _locallyModified = {}; // { storeName: Map<id, timestamp> } (en memoria)

function _loadLocallyModifiedFromLS() {
    try {
        const raw = localStorage.getItem(_LM_LS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw); // { storeName: { id: timestamp } }
        const now = Date.now();
        Object.entries(parsed).forEach(([store, entries]) => {
            const map = new Map();
            Object.entries(entries).forEach(([id, ts]) => {
                if (now - ts < _PROTECT_MS) map.set(id, ts); // solo cargar los no expirados
            });
            if (map.size > 0) _locallyModified[store] = map;
        });
    } catch(e) {}
}

function _saveLocallyModifiedToLS() {
    try {
        const toSave = {};
        Object.entries(_locallyModified).forEach(([store, map]) => {
            if (map.size > 0) {
                toSave[store] = Object.fromEntries(map);
            }
        });
        localStorage.setItem(_LM_LS_KEY, JSON.stringify(toSave));
    } catch(e) {}
}

function _markLocallyModified(storeName, id) {
    if (!_locallyModified[storeName]) _locallyModified[storeName] = new Map();
    _locallyModified[storeName].set(String(id), Date.now());
    _saveLocallyModifiedToLS();
}

function _clearLocallyModified(storeName, id) {
    _locallyModified[storeName]?.delete(String(id));
    _saveLocallyModifiedToLS();
}

function _isLocallyModified(storeName, id) {
    const ts = _locallyModified[storeName]?.get(String(id));
    if (!ts) return false;
    if (Date.now() - ts > _PROTECT_MS) {
        // Expiró (24h) — limpiar y permitir sobreescritura desde Supabase
        _locallyModified[storeName].delete(String(id));
        _saveLocallyModifiedToLS();
        return false;
    }
    return true;
}

// Cargar al inicializar el módulo
_loadLocallyModifiedFromLS();


// 🗑️ IDs eliminados localmente — impiden que el sync de nube los restaure
const _locallyDeleted = {};
const _LS_DEL_KEY = 'campmanager_locally_deleted';

function _loadLocallyDeleted() {
    try {
        const raw = localStorage.getItem(_LS_DEL_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            Object.entries(parsed).forEach(([store, ids]) => {
                _locallyDeleted[store] = new Set(ids);
            });
        }
    } catch(e) {}
}

function _saveLocallyDeleted() {
    try {
        const toSave = {};
        Object.entries(_locallyDeleted).forEach(([store, set]) => {
            if (set.size > 0) toSave[store] = [...set];
        });
        localStorage.setItem(_LS_DEL_KEY, JSON.stringify(toSave));
    } catch(e) {}
}

_loadLocallyDeleted(); // cargar al arrancar el módulo


export function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            // b2b_requests ELIMINADA — migrada a v2_solicitudes_b2b en Supabase
            const stores = ['buildings', 'rooms', 'assignments', 'census', 'sync_queue', 'users', 'logs', 'census_records', 'gerencia_quotas'];
            stores.forEach(s => {
                if (!db.objectStoreNames.contains(s)) {
                    db.createObjectStore(s, { keyPath: s === 'users' ? 'username' : 'id', autoIncrement: s !== 'users' });
                }
            });
        };
        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function getAll(storeName) {
    // 🚀 CACHÉ EN MEMORIA: Devolver al instante si ya cargamos este store
    if (_memCache[storeName]) return _memCache[storeName];

    const db = await openDB();
    const localData = await new Promise((res) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => res(req.result);
    });
    _memCache[storeName] = localData; // Guardar en caché para próximas llamadas
    // ✅ 'rooms' SÍ se descarga desde Supabase para recuperar datos si IDB está vacío.
    // La protección contra datos fantasma la da _locallyModified:
    // cuando asignamos/vaciamos una room con put(), su ID se marca localmente
    // y descargarDesdeNubeSilencioso NO la sobreescribe (ver lógica en la función).
    // ── V2 MIGRATION: Solo sincronizar silenciosamente gerencia_quotas (legacy aún activa)
    // Las tablas V2 (v2_asignaciones, v2_camas, etc.) son gestionadas directamente
    // por v2-service.js — db.js no las toca para evitar duplicación.
    // rooms, buildings, census, gerencia_quotas ya no existen → NO descargar.
    if (navigator.onLine && false) { // DESACTIVADO: tablas legacy eliminadas
        descargarDesdeNubeSilencioso(storeName, db); 
    }
    return localData;
}

export async function getById(storeName, id) {
    const db = await openDB();
    return new Promise((res) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => res(req.result);
    });
}

async function descargarDesdeNubeSilencioso(storeName, db) {
    if (_isSyncing[storeName] || _brokenTables[storeName]) return;
    _isSyncing[storeName] = true; 
    try {
        let allData = [];
        let isFetching = true;
        let offset = 0;
        while (isFetching) {
            const { data, error } = await supabase.from(storeName).select('*').range(offset, offset + 499);
            if (error) throw error;
            if (data && data.length > 0) {
                allData = allData.concat(data);
                offset += 500;
                if (data.length < 500) isFetching = false;
            } else isFetching = false;
        }
        // b2b_requests ELIMINADA — todo flujo B2B usa v2_solicitudes_b2b directamente en Supabase

        // 🔒 MERGE SEGURO: NO hacemos clear(). Solo insertamos/actualizamos item a item.
        // Registros modificados localmente están protegidos 5 min post-cambio o hasta upsert exitoso.
        if (allData.length > 0) {
            const localDelSet = _locallyDeleted[storeName] || new Set();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                allData.forEach(item => {
                // 🔒 Merge seguro: NO sobreescribir registros modificados localmente
                // que aún no confirmaron su push a Supabase (protección temporal de 5 min)
                if (_isLocallyModified(storeName, item.id)) return;
                if (localDelSet.has(String(item.id))) return;
                store.put(item);
                });
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
            // 🚀 Sincronizar caché en memoria con datos recién bajados de la nube
            if (_memCache[storeName]) {
                const keyPath = storeName === 'users' ? 'username' : 'id';
                allData.forEach(item => {
                    if (localDelSet.has(String(item.id))) return;
                    if (_isLocallyModified(storeName, item.id)) return;
                    const cIdx = _memCache[storeName].findIndex(x => String(x[keyPath]) === String(item[keyPath] ?? item.id));
                    if (cIdx !== -1) _memCache[storeName][cIdx] = item;
                    else _memCache[storeName].push(item);
                });
                window.dispatchEvent(new CustomEvent('db:changed', { detail: { storeName, source: 'cloud' } }));
            }
        }
    } catch (err) {
        console.warn(`[Sync] Fallo sincronización '${storeName}':`, err);
        _brokenTables[storeName] = true;
        setTimeout(() => { _brokenTables[storeName] = false; }, 5 * 60 * 1000);
    }
    _isSyncing[storeName] = false;
}

export async function put(storeName, data) {
    const db = await openDB();
    await new Promise((res) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(data);
        tx.oncomplete = () => res();
    });
    // 🚀 ACTUALIZAR CACHÉ EN MEMORIA INMEDIATAMENTE (respuesta instantánea en todas las vistas)
    if (_memCache[storeName]) {
        const keyPath = storeName === 'users' ? 'username' : 'id';
        const key = data[keyPath] ?? data.id;
        const idx = _memCache[storeName].findIndex(x => String(x[keyPath]) === String(key));
        if (idx !== -1) _memCache[storeName][idx] = data;
        else _memCache[storeName].push(data);
        window.dispatchEvent(new CustomEvent('db:changed', { detail: { storeName } }));
    }
    // ── V2 MIGRATION: el motor de sync legacy (IndexedDB ↔ Supabase) está desactivado
    // para tablas antiguas. Solo usuarios se gestionan localmente.
    // Las tablas V2 se gestionan directamente en v2-service.js con llamadas directas.
    const LEGACY_SYNC_TABLES = ['users']; // solo 'users' queda en IndexedDB local
    if (LEGACY_SYNC_TABLES.includes(storeName)) {
        const cols = { users: ['username','role','name','password','empresa','createdAt'] }[storeName];
        if (data.id !== undefined) _markLocallyModified(storeName, data.id);
        // users solo se manejan localmente — no push a Supabase
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// ☁️  SINCRONIZACIÓN EN TIEMPO REAL — Supabase Realtime
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// ☁️  SINCRONIZACIÓN EN TIEMPO REAL V2 — Supabase Realtime
// Suscripciones EXCLUSIVAMENTE a tablas v2_ (las legacy ya no existen).
// ─────────────────────────────────────────────────────────────────────────────
let _realtimeInitialized = false;

export function initRealtimeSync() {
    if (_realtimeInitialized) return;
    _realtimeInitialized = true;

    // ── V2 TABLES: las que emiten eventos relevantes para la UI ──────────────
    const V2_EVENTS = [
        { table: 'v2_asignaciones', event: 'checkin-updated' },
        { table: 'v2_camas',        event: 'camas-updated'   },
    ];

    V2_EVENTS.forEach(({ table, event }) => {
        supabase
            .channel(`rt_v2_${table}_${Math.random().toString(36).slice(2,7)}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table },
                (payload) => {
                    console.log(`[Realtime V2] ${table} ${payload.eventType}`);
                    // Disparar evento genérico para que los módulos V2 recarguen
                    window.dispatchEvent(new CustomEvent('db:changed', {
                        detail: { storeName: table, source: 'realtime', payload }
                    }));
                    // Evento específico por tabla
                    window.dispatchEvent(new CustomEvent(event));
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log(`[Realtime V2] ✅ Suscrito a '${table}'`);
                } else if (status === 'CHANNEL_ERROR') {
                    console.warn(`[Realtime V2] ⚠️ Error en canal '${table}' — sin Realtime en esta tabla`);
                }
            });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔄 AUTO-REFRESH PERIÓDICO — garantiza convergencia en todos los dispositivos
// Cada 45 segundos descarga silenciosamente Supabase y actualiza lo que haya
// cambiado en otros dispositivos (complementa a Realtime que puede fallar).
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// 🔄 AUTO-REFRESH PERIÓDICO V2
// Ya no refresca tablas legacy (rooms, buildings, etc.).
// Solo emite el evento para que los módulos V2 relean desde Supabase directamente.
// ─────────────────────────────────────────────────────────────────────────────
let _periodicRefreshStarted = false;

export function startPeriodicCloudRefresh() {
    if (_periodicRefreshStarted) return;
    _periodicRefreshStarted = true;

    const doRefresh = async () => {
        if (!navigator.onLine) return;
        // Los módulos V2 consultan Supabase directamente — solo necesitamos disparar el evento
        window.dispatchEvent(new CustomEvent('v2:refresh'));
        console.log('[AutoRefresh V2] ✅ Evento v2:refresh emitido');
    };

    // Primera actualización a los 15 segundos
    setTimeout(doRefresh, 15_000);
    // Luego cada 90 segundos
    setInterval(doRefresh, 90_000);

    console.log('[AutoRefresh V2] 🔄 Auto-refresh V2 iniciado (cada 90s)');
}

/**
 * 🧹 Purga la cola de sincronización offline (sync_queue en IndexedDB).
 * Llama esta función al arrancar la app para limpiar peticiones atascadas
 * que apuntan a tablas legacy ya eliminadas de Supabase.
 */
export async function purgeSyncQueue() {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('sync_queue', 'readwrite');
            tx.objectStore('sync_queue').clear();
            tx.oncomplete = () => {
                console.log('[SyncQueue] 🧹 Cola de sincronización purgada (peticiones legacy eliminadas)');
                resolve();
            };
            tx.onerror = (e) => reject(e.target.error);
        });
    } catch(e) {
        console.warn('[SyncQueue] No se pudo purgar la cola:', e.message);
    }
}


export async function remove(storeName, id) {
    const db = await openDB();
    await new Promise((res) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => res();
    });
    // 🚀 ACTUALIZAR CACHÉ EN MEMORIA INMEDIATAMENTE
    if (_memCache[storeName]) {
        const keyPath = storeName === 'users' ? 'username' : 'id';
        const idx = _memCache[storeName].findIndex(x => String(x[keyPath]) === String(id));
        if (idx !== -1) _memCache[storeName].splice(idx, 1);
        window.dispatchEvent(new CustomEvent('db:changed', { detail: { storeName } }));
    }
    if (['rooms', 'census'].includes(storeName)) {  // b2b_requests ELIMINADA
        // 🗑️ Marcar como eliminado localmente para que el sync no lo restaure
        if (!_locallyDeleted[storeName]) _locallyDeleted[storeName] = new Set();
        _locallyDeleted[storeName].add(String(id));
        _saveLocallyDeleted();
        // También quitar de _locallyModified si estaba ahí
        _locallyModified[storeName]?.delete(String(id));
        _saveLocallyModifiedToLS();
        // Push directo a Supabase
        if (navigator.onLine) {
            supabase.from(storeName).delete().eq('id', id).then(({ error }) => {
                if (!error) {
                    // Eliminado con éxito en nube — ya podemos quitar la protección
                    _locallyDeleted[storeName]?.delete(String(id));
                    _saveLocallyDeleted();
                }
            }).catch(() => {});
        }
        await addToSyncQueue({ id: Date.now() + Math.random(), storeName, action: 'DELETE', payload: { id } });
        procesarColaDeSincronizacion();
    }
}

export async function addToSyncQueue(data) {
    const db = await openDB();
    const tx = db.transaction('sync_queue', 'readwrite');
    tx.objectStore('sync_queue').put(data);
}

export async function procesarColaDeSincronizacion() {
    if (!navigator.onLine || _isProcessingQueue) return; 
    _isProcessingQueue = true; 
    const db = await openDB();
    while (true) {
        const tx = db.transaction('sync_queue', 'readonly');
        const next = await new Promise(res => {
            const req = tx.objectStore('sync_queue').openCursor();
            req.onsuccess = (e) => res(e.target.result ? e.target.result.value : null);
        });
        if (!next) break;
        try {
            const { error } = next.action === 'UPSERT' 
                ? await supabase.from(next.storeName).upsert(next.payload)
                : await supabase.from(next.storeName).delete().eq('id', next.payload.id);
            if (!error) {
                const txDel = db.transaction('sync_queue', 'readwrite');
                txDel.objectStore('sync_queue').delete(next.id);
            } else break;
        } catch (err) { break; }
    }
    _isProcessingQueue = false; 
}

/**
 * ⚠️ MODO SOLO-LECTURA: Esta función YA NO borra camas automáticamente.
 * Solo retorna el conteo de camas vencidas para mostrarlo como toast de alerta.
 * El borrado real ocurre únicamente cuando el admin presiona "✅ Confirmar Salida".
 */
export async function cleanupExpiredAssignments() {
    const expired = await getExpiredBeds();
    return expired.length; // Mantener compatibilidad: retornar conteo
}

/**
 * Retorna lista completa de camas vencidas (para el Dashboard de Alertas).
 */
export async function getExpiredBeds() {
    const rooms = await getAll('rooms');
    const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
    const expired = [];

    for (const r of rooms) {
        ['day', 'night', 'extra'].forEach(k => {
            const dep = r.beds?.[k]?.departureDate;
            const occ = r.beds?.[k]?.occupant;
            // Vencida: tiene ocupante y fecha de salida <= hoy
            if (dep && dep <= todayStr && occ) {
                expired.push({
                    roomId: r.id,
                    roomNumber: r.number,
                    buildingId: r.buildingId,
                    bedKey: k,
                    occupant: occ,
                    company: r.beds[k].company || '-',
                    rut: r.beds[k].rut || '-',
                    departureDate: dep,
                    isOverdue: dep < todayStr // true = ya pasó, false = es hoy
                });
            }
        });
    }
    return expired;
}

/**
 * Confirmar salida de una cama específica — limpia al ocupante y libera la habitación.
 * Solo se llama por acción EXPLÍCITA del admin desde el Dashboard o Infraestructura.
 */
export async function confirmCheckout(roomId, bedKey) {
    const rooms = await getAll('rooms');
    const r = rooms.find(x => String(x.id) === String(roomId));
    if (!r) return false;

    // 🔄 MODO TURNO ROTATIVO: si hay next occupant y su fecha de llegada ya es hoy o antes → promover
    const next = r.beds?.[bedKey]?.nextOccupant;
    const todayStr = new Date().toLocaleDateString('en-CA');

    if (next && next.arrivalDate && next.arrivalDate <= todayStr) {
        // Promover next → current
        r.beds[bedKey] = {
            occupant:       next.occupant,
            company:        next.company    || '',
            shift:          next.shift      || '',
            rut:            next.rut        || '',
            contact:        next.contact    || '',
            gender:         next.gender     || r.gender || null,
            arrivalDate:    next.arrivalDate,
            departureDate:  next.departureDate || '',
            management:     next.management || '',
            contractNumber: next.contractNumber || ''
        };
        r.status = 'occupied';
        r.gender = next.gender || r.gender || null;
        console.log(`[Rotativo] 🔄 Promovido ${next.occupant} → Hab. ${r.number} Cama ${bedKey}`);
    } else {
        // Limpiar la cama normalmente
        r.beds[bedKey] = {
            occupant: null, company: null, shift: null,
            rut: null, contact: null, gender: null,
            arrivalDate: null, departureDate: null
        };
        const stillOccupied = ['day', 'night', 'extra'].some(k => r.beds?.[k]?.occupant);
        r.status = stillOccupied ? 'occupied' : 'free';
        if (!stillOccupied) r.gender = null;
    }

    await put('rooms', r);
    return true;
}

/**
 * Promueve automáticamente nextOccupant → occupant en todas las habitaciones
 * donde el ocupante actual ya salió (departureDate <= hoy) y el pre-asignado ya llegó.
 * Llamar al abrir la app y cada día.
 */
export async function autoPromoteNextOccupants() {
    const rooms = await getAll('rooms');
    const todayStr = new Date().toLocaleDateString('en-CA');
    let promovidos = 0;

    for (const r of rooms) {
        let changed = false;
        for (const slot of ['day', 'night', 'extra']) {
            const bed  = r.beds?.[slot];
            if (!bed) continue;
            const next = bed.nextOccupant;
            if (!next) continue;

            // Condición 1: el ocupante actual ya debió salir
            const currentLeft = !bed.occupant || (bed.departureDate && bed.departureDate <= todayStr);
            // Condición 2: el próximo ya llegó
            const nextArrived = next.arrivalDate && next.arrivalDate <= todayStr;

            if (currentLeft && nextArrived) {
                r.beds[slot] = {
                    occupant:       next.occupant,
                    company:        next.company    || '',
                    shift:          next.shift      || '',
                    rut:            next.rut        || '',
                    contact:        next.contact    || '',
                    gender:         next.gender     || r.gender || null,
                    arrivalDate:    next.arrivalDate,
                    departureDate:  next.departureDate || '',
                    management:     next.management || '',
                    contractNumber: next.contractNumber || ''
                };
                r.status = 'occupied';
                r.gender  = next.gender || r.gender || null;
                changed = true;
                promovidos++;
                console.log(`[Rotativo] ✅ Auto-promovido ${next.occupant} → Hab. ${r.number} Cama ${slot}`);
            }
        }
        if (changed) await put('rooms', r);
    }
    if (promovidos > 0) {
        console.log(`[Rotativo] 🔄 ${promovidos} trabajadores promovidos al turno actual`);
        window.dispatchEvent(new CustomEvent('rooms-updated'));
    }
    return promovidos;
}


// 🚀 PRE-CARGA: Carga todas las stores clave en memoria de una sola vez al arrancar
export async function preloadAllData() {
    await Promise.all([
        getAll('rooms'),
        getAll('buildings'),
        // b2b_requests ELIMINADA — solicitudes B2B ahora van directo a v2_solicitudes_b2b
    ]);
    console.log('[Cache] ✅ Datos precargados — app ultra-veloz');
}

// 🚀 Invalida caché para forzar recarga desde IndexedDB (usar con cuidado)
export function invalidateCache(storeName) {
    if (storeName) {
        delete _memCache[storeName];
    } else {
        Object.keys(_memCache).forEach(k => delete _memCache[k]);
    }
}

export async function seedDemoData() {
    console.log("[Magia Real] Construyendo infraestructura base CON IDs FIJOS...");
    const buildingDefs = [
        { id: 1, name: 'R-220', code: '220', type: 'building', floor: 4, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
        { id: 2, name: 'Pabellón 1', code: 'P-1', type: 'pavilion', floor: 6, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
        { id: 3, name: 'Pabellón 2', code: 'P-2', type: 'pavilion', floor: 6, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
        { id: 4, name: 'Pabellón 3', code: 'P-3', type: 'pavilion', floor: 6, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
        { id: 5, name: 'Pabellón 4', code: 'P-4', type: 'pavilion', floor: 6, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
        { id: 6, name: 'Pabellón 5', code: 'P-5', type: 'pavilion', floor: 6, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
        { id: 7, name: 'Pabellón 6', code: 'P-6', type: 'pavilion', floor: 6, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
        { id: 8, name: 'Pabellón 7', code: 'P-7', type: 'pavilion', floor: 6, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
        { id: 9, name: 'Pabellón 8', code: 'P-8', type: 'pavilion', floor: 6, capacity: 0, shifts: [], notes: '', floorConfigs: {} },
    ];
    
    await supabase.from('buildings').upsert(buildingDefs); 
    const db = await openDB();
    const tx = db.transaction('buildings', 'readwrite');
    buildingDefs.forEach(b => tx.objectStore('buildings').put(b)); 

    await put('users', { username: 'juan-1154@hotmail.es', password: '2417', name: 'Juan G.', role: 'superadmin' });
    await put('users', { username: 'Administracion', password: 'viosimcam', name: 'Administración', role: 'admin' });
    await put('users', { username: 'Anglo', password: 'anglo2024', name: 'Administrador Anglo', role: 'admin', empresa: 'Anglo American', createdAt: new Date().toISOString() });
}

/**
 * Garantiza que los usuarios base del sistema siempre existan.
 * Úsala al arrancar la app — no sobreescribe contraseñas ya modificadas.
 */
export async function ensureDefaultUsers() {
    const existing = await getAll('users');
    const usernames = existing.map(u => u.username);

    const defaults = [
        { username: 'juan-1154@hotmail.es', password: '2417', name: 'Juan G.', role: 'superadmin' },
        { username: 'Administracion', password: 'viosimcam', name: 'Administración', role: 'admin', empresa: 'Aramark' },
        { username: 'Anglo', password: 'anglo2024', name: 'Administrador Anglo', role: 'admin', empresa: 'Anglo American' },
    ];

    for (const u of defaults) {
        if (!usernames.includes(u.username)) {
            await put('users', { ...u, createdAt: new Date().toISOString() });
            console.log('[Users] ✅ Usuario base creado:', u.username);
        }
    }
}


export async function ensureAllRooms() {
    const [existingRooms, buildings] = await Promise.all([getAll('rooms'), getAll('buildings')]);
    // R-220 (145 hab) vienen de Supabase con IDs fijos 22001-22145.
    // Los otros 8 pabellones suman 1271 hab → total esperado = 1416.
    // Si ya tenemos ese total (o más), no hacer nada.
    if (existingRooms.length >= 1416) return;

    console.log("[Magia Real] CARGA VELOZ Y SEGURA: Generando habitaciones de pabellones P-1 a P-8...");
    const bIdByCode = {};
    buildings.forEach(b => bIdByCode[b.code] = b.id);

    // ⚠️ El R-220 queda EXCLUIDO: sus habitaciones se gestionan via Supabase SQL
    // con IDs fijos 22001-22145. No tocar desde aquí.
    const allNewRooms = MASTER_ROOMS
        .filter(spec => spec.p !== '220') // ← excluir R-220
        .map(spec => ({
            buildingId: bIdByCode[spec.p],
            number: String(spec.r),
            floor: parseInt(String(spec.f).replace(/[^0-9]/g, '')) || 1,
            bedCount: spec.b || 2,
            status: 'free',
            reservedCompany: (spec.p === 'P-1' || spec.p === 'P-2' || spec.p === 'P-3') ? 'Aramark' : '',
            beds: { day: { occupant: null, company: null, shift: null }, night: (spec.b || 2) === 2 ? { occupant: null, company: null, shift: null } : null }
        }));

    const db = await openDB();
    for (let i = 0; i < allNewRooms.length; i += 200) {
        const batch = allNewRooms.slice(i, i + 200);
        const { error } = await supabase.from('rooms').upsert(batch);
        if (!error) {
            const tx = db.transaction('rooms', 'readwrite');
            batch.forEach(r => tx.objectStore('rooms').put(r));
            console.log(`[Magia Real] Lote guardado: ${Math.min(i + 200, allNewRooms.length)} / ${allNewRooms.length}`);
            await new Promise(resolve => setTimeout(resolve, 500));
        } else {
            console.error("Fallo en lote de carga", error);
        }
    }
    console.log("[Magia Real] ¡Carga masiva finalizada y sellada!");
}

export async function resetInfrastructure() {
    const rooms = await getAll('rooms');
    console.log("[Mantenimiento] Reseteando ocupación...");
    for (const r of rooms) {
        r.beds = { 
            day: { occupant: null, company: null }, 
            night: r.bedCount === 2 ? { occupant: null, company: null } : null 
        };
        r.status = 'free'; r.gender = null; r.reservedCompany = ''; r.reservedShift = '';
        await put('rooms', r);
    }
}

export async function ensureAramarkReservations() {
    const [rooms, buildings] = await Promise.all([getAll('rooms'), getAll('buildings')]);
    const aramarkIds = buildings.filter(b => ['P-1', 'P-2', 'P-3'].includes(b.code)).map(b => b.id);
    let count = 0;
    for (const r of rooms) {
        if (aramarkIds.includes(r.buildingId) && r.reservedCompany !== 'Aramark') {
            r.reservedCompany = 'Aramark';
            await put('rooms', r); count++;
        }
    }
    console.log(`[Reserva] ${count} habitaciones marcadas para Aramark.`);
}

export async function freeAllRoomRestrictions() {
    const rooms = await getAll('rooms');
    let count = 0;
    for (const r of rooms) {
        if (r.reservedCompany || r.reservedShift) {
            r.reservedCompany = ''; r.reservedShift = '';
            await put('rooms', r); count++;
        }
    }
    console.log(`[Restricción] ${count} habitaciones liberadas (letras rojas borradas).`);
}

// ============================================================================
// ☁️ FORZAR SINCRONIZACIÓN COMPLETA: IndexedDB → Supabase
// Sube TODOS los rooms y buildings actuales a la nube en lotes de 50.
// Usar cuando el Dashboard no muestra datos reales (beds vacíos en Supabase).
// ============================================================================
export async function forzarSyncNube(onProgress) {
    const ROOMS_COLS = ['id','buildingId','number','floor','bedCount','status','gender',
                        'reservedCompany','reservedShift','beds','lostBedReason',
                        'blockReason','blockedAt','blockedBed'];
    const BUILDINGS_COLS = ['id','name','code','type','floor','capacity','shifts','notes','floorConfigs','mainShift'];

    const filterCols = (obj, cols) =>
        Object.fromEntries(Object.entries(obj).filter(([k]) => cols.includes(k)));

    const [rooms, buildings] = await Promise.all([
        getAll('rooms'),
        getAll('buildings')
    ]);

    const BATCH = 50;
    let done = 0;
    const total = rooms.length + buildings.length;
    const report = (msg) => {
        onProgress?.(done, total, msg);
        console.log(`[ForzarSync] ${msg} (${done}/${total})`);
    };

    report('Iniciando sync de edificios…');

    // 1. Subir buildings
    for (let i = 0; i < buildings.length; i += BATCH) {
        const batch = buildings.slice(i, i + BATCH).map(b => filterCols(b, BUILDINGS_COLS));
        const { error } = await supabase.from('buildings').upsert(batch, { onConflict: 'id' });
        if (error) console.warn('[ForzarSync] buildings error:', error.message);
        done += batch.length;
        report(`Edificios ${Math.min(i + BATCH, buildings.length)}/${buildings.length}`);
    }

    report('Iniciando sync de habitaciones…');

    // 2. Subir rooms en lotes (el campo beds es JSONB — puede ser grande)
    for (let i = 0; i < rooms.length; i += BATCH) {
        const batch = rooms.slice(i, i + BATCH).map(r => filterCols(r, ROOMS_COLS));
        const { error } = await supabase.from('rooms').upsert(batch, { onConflict: 'id' });
        if (error) console.warn('[ForzarSync] rooms error:', error.message);
        done += batch.length;
        report(`Habitaciones ${Math.min(i + BATCH, rooms.length)}/${rooms.length} subidas`);
    }

    report('✅ Sync completo');
    return { rooms: rooms.length, buildings: buildings.length };
}


// ============================================================================
// 🔥 MOTOR DE ASIGNACIÓN INTELIGENTE PRO (Con Regla de Oro y Anti-Clones)
// ============================================================================

function normalizeGender(g) {
    if (!g) return 'M'; 
    const str = String(g).trim().toUpperCase();
    if (str.startsWith('F') || str === 'MUJER' || str === 'FEMENINO') return 'F';
    return 'M';
}

// Limpia el RUT para poder compararlo exactamente
function cleanRut(r) {
    if (!r) return '';
    return String(r).replace(/[^0-9Kk]/g, '').toUpperCase();
}

/**
 * @deprecated FUNCIÓN LEGACY V1 — DESACTIVADA.
 * Las asignaciones B2B ahora se gestionan en js/v2/modules/v2-solicitudes.js
 * usando la tabla v2_solicitudes_b2b de Supabase directamente.
 */
export async function autoAsignarTrabajadores(_requestId) {
    console.warn('[DEPRECATED] autoAsignarTrabajadores() es V1 eliminada. Usa el motor V2 en v2-solicitudes.js.');
    return { success: false, message: 'Función V1 eliminada. Usa el motor V2.' };
}
