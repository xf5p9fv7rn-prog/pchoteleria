/**
 * PC Hotelería — Shared Utilities
 */

// ── Toast notifications ─────────────────────────────
/**
 * Saves an audit log to IndexedDB
 */
export async function recordLog(action, details = '') {
  const user = JSON.parse(localStorage.getItem('cm_user') || '{}');
  const { put } = await import('./db.js');
  try {
    await put('logs', {
      timestamp: new Date().toISOString(),
      username: user.username || 'Sistema',
      action,
      details
    });
  } catch (e) {
    console.warn('[Audit] Failed to log action:', e);
  }
}

export function showToast(message, type = 'default', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icons = { success: '✅', warn: '⚠️', error: '❌', default: 'ℹ️' };
    el.innerHTML = `<span>${icons[type] || '📢'}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(8px)';
        el.style.transition = '0.3s ease';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

// ── Date formatting ─────────────────────────────────
export function formatDate(date) {
    return date.toLocaleDateString('es-CL', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
}

export function formatDateTime(date) {
    return date.toLocaleString('es-CL', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

/**
 * Convierte YYYY-MM-DD a DD/MM/YYYY
 */
export function toChileanDate(isoDate) {
    if (!isoDate || typeof isoDate !== 'string' || !isoDate.includes('-')) return isoDate;
    const parts = isoDate.split('T')[0].split('-');
    if (parts.length !== 3) return isoDate;
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// ── ID generator ────────────────────────────────────
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Network detection ───────────────────────────────
export function checkOnline() {
    return navigator.onLine;
}

export function watchOnlineStatus(onOnline, onOffline) {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
    };
}

// ── Debounce ────────────────────────────────────────
export function debounce(fn, ms = 200) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// ── Local storage helpers ───────────────────────────
export function saveLocal(key, data) {
    try { localStorage.setItem('cm_' + key, JSON.stringify(data)); } catch { }
}

export function loadLocal(key, fallback = null) {
    try { const v = localStorage.getItem('cm_' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

// ── RUT validator (Chile) ───────────────────────────
export function validateRUT(rut) {
    const cleaned = rut.replace(/[^0-9kK]/g, '');
    if (cleaned.length < 2) return false;
    const body = cleaned.slice(0, -1);
    const dv = cleaned.slice(-1).toUpperCase();
    let sum = 0, mul = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += parseInt(body[i]) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const expected = 11 - (sum % 11);
    const dvExpected = expected === 11 ? '0' : expected === 10 ? 'K' : String(expected);
    return dv === dvExpected;
}

// ── Format RUT ──────────────────────────────────────
export function formatRUT(rut) {
    const cleaned = rut.replace(/[^0-9kK]/g, '');
    if (cleaned.length < 2) return cleaned;
    const body = cleaned.slice(0, -1);
    const dv = cleaned.slice(-1);
    return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}
