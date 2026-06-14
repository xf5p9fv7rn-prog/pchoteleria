// js/supabaseClient.js
// Importamos Supabase directamente desde la nube (CDN)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';

const supabaseUrl = 'https://pnkajjduvadcxealodcp.supabase.co';
// anon/public key — segura para el frontend, RLS controla el acceso por rol
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * fetchAllRows — Lee TODAS las filas de una query paginando automáticamente.
 *
 * Supabase devuelve máximo 1.000 filas por defecto. Esta función hace un loop
 * de páginas hasta obtener todos los registros, sin límite artificial.
 *
 * @param {Function} queryFactory  Función sin argumentos que devuelve una query
 *                                 de Supabase SIN .range(). Se llama una vez por página.
 * @param {number}   [pageSize=900] Filas por página (< 1000 para margen de seguridad).
 * @returns {Promise<Array>}        Todos los registros concatenados.
 *
 * Ejemplo:
 *   const rows = await fetchAllRows(() =>
 *     supabase.from('v2_asignaciones').select('*').is('fecha_checkout', null)
 *   );
 */
export async function fetchAllRows(queryFactory, pageSize = 900) {
    let offset = 0;
    const all = [];
    while (true) {
        const { data, error } = await queryFactory().range(offset, offset + pageSize - 1);
        if (error) throw error;
        if (!data || !data.length) break;
        all.push(...data);
        if (data.length < pageSize) break;
        offset += pageSize;
    }
    return all;
}


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