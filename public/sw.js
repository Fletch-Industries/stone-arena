// Cache only the offline explanation. Match data, invitations, API responses,
// and game bundles always use the network so an old client cannot be pinned.
const CACHE = 'stone-arena-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request('/offline.html', { cache: 'reload' }))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('stone-arena-offline-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin || !['/', '/index.html'].includes(url.pathname)) return;
  event.respondWith((async () => {
    try { return await fetch(request); }
    catch {
      return await caches.match('/offline.html', { cacheName: CACHE }) || new Response('Stone Arena needs an internet connection. Reconnect and reload to play.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
