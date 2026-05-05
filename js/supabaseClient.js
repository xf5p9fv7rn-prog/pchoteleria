// js/supabaseClient.js
// Importamos Supabase directamente desde la nube (CDN)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://pnkajjduvadcxealodcp.supabase.co';
// service_role key — bypasea RLS en todas las tablas V2 (sistema interno corporativo)
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0NDUzMiwiZXhwIjoyMDkwODIwNTMyfQ.kGksbnrqwx1ETq2RNcDozEQ1JZLem1H7VrUdkNT5724';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);


// ── Keep-Alive: evita que Supabase pause el proyecto por inactividad ──────────
// Supabase pausa proyectos gratuitos si no hay actividad por 7 días.
// Este ping se ejecuta cada 4 días para mantenerlo siempre despierto.
(function keepSupabaseAlive() {
    const INTERVAL_MS = 4 * 24 * 60 * 60 * 1000; // 4 días en ms
    const LAST_PING_KEY = 'sb_last_ping';

    async function ping() {
        try {
            await supabase.from('v2_edificios').select('id').limit(1);
            localStorage.setItem(LAST_PING_KEY, Date.now().toString());
            console.log('[KeepAlive] Supabase ping OK —', new Date().toLocaleString('es-CL'));
        } catch(e) {
            console.warn('[KeepAlive] Ping falló:', e.message);
        }
    }

    // Ejecutar si han pasado más de 4 días desde el último ping (o nunca se hizo)
    const lastPing = parseInt(localStorage.getItem(LAST_PING_KEY) || '0');
    if (Date.now() - lastPing > INTERVAL_MS) {
        // Esperar 5 segundos para que la app esté lista
        setTimeout(ping, 5000);
    }

    // Repetir cada 4 días mientras la app esté abierta
    setInterval(ping, INTERVAL_MS);
})();