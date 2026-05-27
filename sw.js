const CACHE_NAME = 'v2-purge-fix-16'; // 🔄 Incrementar en cada deploy para limpiar cache viejo



const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/css/premium.css',
  '/aramark.png',
  '/anglo.png',
  '/Mirian.png',
  '/manifest.json',
  '/solicitud-empresa.html',
];

// Install: cache solo assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(()=>{}))
  );
  self.skipWaiting();
});

// Activate: limpiar caches antiguos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Ignorar no-HTTP, Supabase, CDNs externos, no-GET
  if (!url.startsWith('http')) return;
  if (url.includes('supabase.co')) return;
  if (url.includes('cdn.') || url.includes('cdnjs.') || url.includes('tailwindcss.com')) return;
  if (event.request.method !== 'GET') return;

  const isJS = url.includes('.js');

  if (isJS) {
    // ⚡ NETWORK-FIRST para JS: siempre intentar red primero
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
    // 📦 CACHE-FIRST para assets estáticos
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

