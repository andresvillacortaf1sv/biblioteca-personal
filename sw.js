/* Espacio Cinéfilo — service worker (offline + instalable) */
const CACHE = 'ec-pwa-v2';
const SHELL = ['/', '/index.html', '/films_data.json', '/manifest.json', '/icon-192.png', '/icon-512.png'];

// Hosts de API dinámica que NUNCA deben cachearse (si no, se sirve estado viejo):
// Supabase (sincronización) y la API de datos de TMDB. Las IMÁGENES de TMDB
// (image.tmdb.org) y Pinterest sí se cachean más abajo.
function isDynamicApi(url) {
  return url.hostname.endsWith('.supabase.co') ||
         url.hostname === 'api.themoviedb.org';
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase / API de TMDB: siempre a la red, sin tocar la caché. Así la
  // sincronización y los datos siempre son frescos en todos los dispositivos.
  if (isDynamicApi(url)) return;

  // Navegación: network-first (ve actualizaciones online), cae a caché offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('/index.html', cp)); return r; })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Mismo origen: stale-while-revalidate.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((r) => {
          if (r && r.status === 200) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
          return r;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Otros orígenes (pósters TMDB/Pinterest, fuentes): cache-first en runtime.
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((r) => {
      if (r && (r.status === 200 || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return r;
    }).catch(() => cached))
  );
});
