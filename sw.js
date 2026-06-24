// 🔄 IMPORTANTE: Incrementar CACHE_NAME en cada deploy para limpiar caches viejos.
// Sincronizado con CM_VER en index.html (actualmente v88).
const CACHE_NAME = 'v2-pab-piso-struct-37';  // bumped: force-refresh all devices - labels

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/css/premium.css?v=5',   // ← debe coincidir con el ?v= del <link> en index.html
  '/aramark.png',
  '/anglo.png',
  '/Mirian.png',
  '/manifest.json',
  '/solicitud-empresa.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: cache solo assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(()=>{}))
  );
  self.skipWaiting();
});

// Activate: limpiar TODOS los caches anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: SOLO interceptar recursos del mismo origen
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Ignorar no-HTTP y no-GET
  if (!url.startsWith('http')) return;
  if (event.request.method !== 'GET') return;

  // ── REGLA CRÍTICA: solo cachear recursos propios del sitio ──────────────────
  // Si el recurso es de CUALQUIER dominio externo (jsdelivr.net, supabase.co,
  // googleapis.com, tailwindcss.com, etc.) lo dejamos pasar SIN interceptar.
  // Esto evita el bug donde el SW redirige imports ESM de Supabase a localhost.
  const selfOrigin = self.location.origin;
  if (!url.startsWith(selfOrigin)) return;  // ← deja pasar todo lo externo

  const isJS  = url.includes('.js');
  const isHTML = url.includes('.html') || url.endsWith('/');
  const isCSS  = url.includes('.css');

  if (isJS || isHTML || isCSS) {
    // ⚡ NETWORK-FIRST para JS, HTML y CSS: siempre intentar red primero
    // Esto garantiza que TODOS los dispositivos reciban la versión más reciente del código.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)).catch(()=>{});
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // 📦 CACHE-FIRST solo para imágenes y otros assets estáticos (no cambian)
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)).catch(()=>{});
          return response;
        });
      }).catch(() => caches.match('/index.html'))
    );
  }
});

// Background Sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-census') {
    event.waitUntil(notificarAplicacionParaSincronizar());
  }
});

async function notificarAplicacionParaSincronizar() {
  const allClients = await clients.matchAll({ includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage({ action: 'PROCESS_SYNC_QUEUE' });
  }
}

