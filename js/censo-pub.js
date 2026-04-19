/**
 * PC Hotelería — Censo Público
 * Entry point for the standalone housekeeping census page (censo.html).
 * Imports only the censo module and db layer — no admin router.
 */

import { openDB, seedDemoData } from './db.js';
import { renderCenso } from './modules/censo.js';

async function boot() {
    await openDB();
    // Run seeding in background so UI isn't blocked
    seedDemoData().catch(console.warn);

    const container = document.getElementById('cpub-content');
    if (container) await renderCenso(container);
}

boot().catch(e => {
    console.error(e);
    const c = document.getElementById('cpub-content');
    if (c) c.innerHTML = `<div style="padding:40px;text-align:center;color:#c0392b">
      <div style="font-size:40px;margin-bottom:12px">⚠️</div>
      <div style="font-weight:700">Error al cargar el censo</div>
      <div style="font-size:13px;margin-top:6px">${e.message}</div>
      <button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;background:#c0392b;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;">Reintentar</button>
    </div>`;
});
