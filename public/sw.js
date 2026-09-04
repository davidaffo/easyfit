const CACHE = 'easyfit-v30';
const BASE = new URL('./', self.location.href);
const fromBase = (path) => new URL(path, BASE).href;
const CORE = ['', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'].map(fromBase);
const IMAGE_INDEX = fromBase('exercise-images/index.json');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const desired = new Set([...CORE, fromBase('index.html'), IMAGE_INDEX]);
    await cache.addAll(CORE);
    const indexResponse = await fetch(fromBase('index.html'), { cache: 'no-store' });
    if (!indexResponse.ok) throw new Error('App shell unavailable');
    const indexText = await indexResponse.clone().text();
    await cache.put(fromBase('index.html'), indexResponse);
    const buildAssets = [...indexText.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => new URL(match[1], BASE))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => url.href);
    buildAssets.forEach((url) => desired.add(url));
    await cache.addAll([...new Set(buildAssets)]);
    const response = await fetch(IMAGE_INDEX, { cache: 'no-store' });
    if (response.ok) {
      await cache.put(IMAGE_INDEX, response.clone());
      const images = (await response.json()).map((path) => fromBase(path.replace(/^\//, '')));
      images.forEach((url) => desired.add(url));
      await cache.addAll(images);
    }
    const cachedRequests = await cache.keys();
    await Promise.all(cachedRequests
      .filter((request) => !desired.has(request.url))
      .map((request) => cache.delete(request)));
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
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || event.request.headers.has('Authorization')) return;
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows[0];
    return existing ? existing.focus() : clients.openWindow(BASE.href);
  }));
});
