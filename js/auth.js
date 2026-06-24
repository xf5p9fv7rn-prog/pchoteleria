// js/auth.js — Sistema de Autenticación Local v2
// Credenciales estáticas con hashes SHA-256. NO depende de Supabase Auth.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_KEY        = 'cm_session_v2';
const ACTIVITY_KEY       = 'cm_last_activity';
const BLACKLIST_KEY      = 'cm_user_blacklist';
export const INACTIVITY_MS = 10 * 60 * 60 * 1000; // 10 horas en milisegundos

// ── Registro de usuarios del sistema ─────────────────────────────────────────
// Contraseñas hasheadas con SHA-256 — nunca se almacena texto plano.
// Generados con: node -e "require('crypto').createHash('sha256').update('PASS').digest('hex')"
export const SYSTEM_USERS = [
    {
        username:     'Juan Garrido',
        displayName:  'Juan Garrido',
        passwordHash: '81ddb3b894a1e6d5bac5779ff1b0bc56cf0dc7f19f170c8d66dd70eabe8f7bd7',
        role:         'supervisor',
        initials:     'JG',
    },
    {
        username:     'Guissele Barrera',
        displayName:  'Guissele Barrera',
        passwordHash: '9255655d51c01ee88e157f36949fa7354e702163039ed988174a52abf2ccf536',
        role:         'supervisor',
        initials:     'GB',
    },
    {
        username:     '209939479',
        displayName:  'Recepcionista 209939479',
        passwordHash: '5194826b3edb9596474c6888b1b1c7c8cd539833b237ac04f3081c8cbc8b4567',
        role:         'recepcionista',
        initials:     '20',
    },
    {
        username:     '184938669',
        displayName:  'Recepcionista 184938669',
        passwordHash: 'fc811f2d75a57fab59b8a7d361811cf8f1c9fda30e14d54f2b74d2bc16412bf7',
        role:         'recepcionista',
        initials:     '18',
    },
    {
        username:     '163209039',
        displayName:  'Recepcionista 163209039',
        passwordHash: 'f009c89a03723885ba8c0f49b6a80b708b54aa2ba63e5dfd7390fbbf9246a303',
        role:         'recepcionista',
        initials:     '16',
    },
    {
        username:     '172730698',
        displayName:  'Recepcionista 172730698',
        passwordHash: '0384b242a6fb66cd38842630103eb33bdf21885ac82db0186e4501be13228a3c',
        role:         'recepcionista',
        initials:     '17',
    },
    {
        username:     '160176040',
        displayName:  'Recepcionista 160176040',
        passwordHash: 'efcc183328c56604bf8684f4cacff0c57f7c3d2e8d223116043742a3b9e56b46',
        role:         'recepcionista',
        initials:     '16',
    },
    {
        username:     '186039157',
        displayName:  'Recepcionista 186039157',
        passwordHash: '173f80a6076b3d35429a02a5386bfb5804fb98aaae2ff2b7cb117734b810e3c0',
        role:         'recepcionista',
        initials:     '18',
    },
    {
        username:     '16816274k',
        displayName:  'Recepcionista 16816274k',
        passwordHash: '902b6b900ae46bb263bcad788c3f1b533a59e0ed78649fd3650e28ead3186937',
        role:         'recepcionista',
        initials:     '1k',
    },
    // ── Rol Lavandería — Acceso de edición a Camas Perdidas ─────────────────
    {
        username:     'Lavanderia',
        displayName:  'Lavandería PC Hotelería',
        passwordHash: '9b5b6644a63e42b79dcdb874823da93cd241197f1ccd256950d3fee6d7aa8022', // lava2025
        role:         'lavanderia',
        initials:     'LV',
    },
    // ── Rol Invitado — Solo lectura (sin edición) ────────────────────────────
    {
        username:     'Invitado',
        displayName:  'Invitado PC Hotelería',
        passwordHash: '33bcd14446d90a5bb86574af3c3cee68e4f527cb6c32f01d2ee6e2025c37c273', // invitado2025
        role:         'invitado',
        initials:     'IV',
    },
];

// ── Utilidad: SHA-256 via Web Crypto API (nativa en todos los navegadores modernos) ──
async function sha256(message) {
    const buffer = new TextEncoder().encode(message);
    const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
/**
 * Autentica un usuario contra las credenciales estáticas del sistema.
 * @param {string} username
 * @param {string} password  (texto plano — se hashea aquí antes de comparar)
 * @returns {Promise<{success: boolean, user?: object, message?: string}>}
 */
export async function loginApp(username, password) {
    const trimmedUser = (username || '').trim();
    const blacklist   = getBlacklist();

    if (blacklist.includes(trimmedUser)) {
        return { success: false, message: 'Esta cuenta ha sido desactivada por un supervisor.' };
    }

    const inputHash = await sha256(password || '');
    const found = SYSTEM_USERS.find(u =>
        u.username.trim().toLowerCase() === trimmedUser.toLowerCase() &&
        u.passwordHash === inputHash
    );

    if (!found) {
        return { success: false, message: 'Usuario o contraseña incorrectos.' };
    }

    const session = {
        username:    found.username,
        displayName: found.displayName,
        role:        found.role,
        initials:    found.initials,
        loginAt:     Date.now(),
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    localStorage.removeItem('cm_logout_reason'); // limpiar aviso previo

    return { success: true, user: session };
}

// ── CHECK SESSION ─────────────────────────────────────────────────────────────
/**
 * Devuelve el objeto de sesión activo, o null si no hay sesión válida.
 * También valida la ventana de inactividad de 10 horas.
 */
export function checkSession() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const lastActivity = parseInt(localStorage.getItem(ACTIVITY_KEY) || '0', 10);
    if (Date.now() - lastActivity > INACTIVITY_MS) {
        // Sesión expirada por inactividad
        sessionStorage.removeItem(SESSION_KEY);
        return null;
    }

    try {
        return JSON.parse(raw);
    } catch {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
    }
}

// ── REFRESH ACTIVITY ──────────────────────────────────────────────────────────
/** Actualiza el timestamp de última actividad para resetear el contador de 10h. */
export function refreshActivity() {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
/**
 * Cierra la sesión y recarga la página.
 * @param {'manual'|'inactivity'} reason  Causa del cierre
 */
export function logoutApp(reason = 'manual') {
    sessionStorage.removeItem(SESSION_KEY);
    if (reason === 'inactivity') {
        localStorage.setItem('cm_logout_reason', 'inactivity');
    } else {
        localStorage.removeItem('cm_logout_reason');
    }
    location.reload();
}

// ── USER MANAGEMENT (para el panel de supervisores) ───────────────────────────

/** Devuelve la lista de usuarios del sistema SIN los hashes de contraseña. */
export function getAllSystemUsers() {
    const blacklist = getBlacklist();
    return SYSTEM_USERS.map(({ username, displayName, role, initials }) => ({
        username,
        displayName,
        role,
        initials,
        active: !blacklist.includes(username),
    }));
}

/** Agrega un usuario a la lista negra (no puede iniciar sesión). */
export function blacklistUser(username) {
    const bl = getBlacklist();
    if (!bl.includes(username)) {
        bl.push(username);
        localStorage.setItem(BLACKLIST_KEY, JSON.stringify(bl));
    }
}

/** Quita un usuario de la lista negra (restaura acceso). */
export function restoreUser(username) {
    const bl = getBlacklist().filter(u => u !== username);
    localStorage.setItem(BLACKLIST_KEY, JSON.stringify(bl));
}

/** Devuelve la lista negra actual. */
export function getBlacklist() {
    try {
        return JSON.parse(localStorage.getItem(BLACKLIST_KEY) || '[]');
    } catch {
        return [];
    }
}