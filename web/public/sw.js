const CACHE_NAME = 'command-central-v4';
const STATIC_ASSETS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache icon assets — everything else goes to network
  const url = new URL(event.request.url);
  const isIcon = url.pathname.startsWith('/icons/');
  if (!isIcon) return; // Let browser handle normally

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
