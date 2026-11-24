/* Service Worker: the app works fully offline after the first open.
 * When you change any file, bump VERSION (and VERSION in app.js). */
const VERSION = 'dn-v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './xlsx.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
// Large OCR engine files: they never change for a given VERSION -> cache first.
const VENDOR = ['./vendor/tesseract.min.js', './vendor/worker.min.js',
  './vendor/core/tesseract-core-simd-lstm.wasm.js', './vendor/core/tesseract-core-lstm.wasm.js',
  './vendor/lang/eng.traineddata.gz'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll([...SHELL, ...VENDOR].map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dn-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  // App files: network first (3 s), then cache - avoids mixing old and new versions.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    try {
      const res = await Promise.race([network, new Promise((r) => setTimeout(r, 3000))]);
      if (res) return res;
    } catch (err) { /* offline */ }
    const cached = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    return cached || network;
  })());
});
