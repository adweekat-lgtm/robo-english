/* Service Worker: يجعل التطبيق يعمل بدون إنترنت بعد أول فتح.
 * عند تعديل أي ملف في التطبيق: غيّر رقم VERSION ليحصل الأطفال على النسخة الجديدة. */
const VERSION = 'robo-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './levels.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // الخطوط من Google: من الكاش أولاً ثم التحديث في الخلفية
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // ملفات التطبيق: الكاش أولاً، ثم الشبكة
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
