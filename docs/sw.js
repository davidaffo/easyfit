const CACHE = 'easyfit-v5';
const BASE = new URL('./', self.location.href);
const fromBase = (path) => new URL(path, BASE).href;
const CORE = ['', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'].map(fromBase);
const IMAGE_INDEX = fromBase('exercise-images/index.json');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    const response = await fetch(IMAGE_INDEX, { cache: 'no-store' });
    if (response.ok) {
      await cache.put(IMAGE_INDEX, response.clone());
      const images = (await response.json()).map((path) => fromBase(path.replace(/^\//, '')));
      for (let index = 0; index < images.length; index += 25) {
        await cache.addAll(images.slice(index, index + 25));
      }
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed with ${response.status}`);
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return event.request.mode === 'navigate' ? caches.match(fromBase('index.html')) : Response.error();
      }))
  );
});
