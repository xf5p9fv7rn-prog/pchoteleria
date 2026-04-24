const CACHE_NAME = 'campmanager-v171';

const ASSETS = [
  '/',
  '/index.html',
  '/consultas.html',
  '/censo-portal.html',
  '/css/main.css',
  '/css/premium.css?v=6',
  '/js/app.js?v=42',
  '/js/consultas.js',
  '/js/db.js',
  '/js/modules/dashboard.js',
  '/js/modules/infraestructura.js',
  '/js/modules/solicitudes.js',
  '/aramark.png',
  '/anglo.png',
  '/Mirian.png',
  '/js/modules/reportes.js',
  '/manifest.json',
  '/solicitud-empresa.html',
  '/mi-habitacion.html'
];

// Install: cache all assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first strategy
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // ⛔ Ignorar: extensiones de Chrome, requests no-HTTP, URLs de terceros (Supabase, CDN)
  if (!url.startsWith('http')) return;
  if (url.includes('supabase.co')) return;
  if (url.includes('cdn.sheetjs.com') || url.includes('cdnjs.cloudflare.com')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Solo cachear respuestas válidas del mismo origen
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});

// Background Sync: El "Vigilante"
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-census') {
    event.waitUntil(notificarAplicacionParaSincronizar());
  }
});

async function notificarAplicacionParaSincronizar() {
  console.log('[SW] ¡Conexión recuperada detectada en segundo plano!');
  
  // Buscamos si la aplicación está abierta en alguna pestaña del teléfono/PC
  const allClients = await clients.matchAll({ includeUncontrolled: true });
  
  for (const client of allClients) {
    // Le enviamos un mensaje a la aplicación para que empiece a subir los datos
    client.postMessage({ action: 'PROCESS_SYNC_QUEUE' });
  }
}