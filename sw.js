/* Service Worker: يجعل التطبيق يعمل بدون إنترنت بعد أول فتح.
 * عند تعديل أي ملف في التطبيق: غيّر رقم VERSION ليحصل الأطفال على النسخة الجديدة. */
const VERSION = 'robo-v10';
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
  './audio/welcome.m4a',
];

self.addEventListener('install', (e) => {
  // cache:'reload' يتجاوز كاش المتصفح حتى لا نخزّن خليطاً من ملفات قديمة وجديدة
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  // طلبات الصوت الجزئية (Range) نتركها للمتصفح؛ الكاش لا يقبل ردود 206
  if (req.headers.has('range')) return;
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
  // ماسح السندات تطبيق منفصل في مجلد dn-scanner/ وله Service Worker خاص به
  if (url.pathname.includes('/dn-scanner/')) return;
  // مساعد السائقين تطبيق منفصل في مجلد driver-bot/ (يحتاج إنترنت دائماً)
  if (url.pathname.includes('/driver-bot/')) return;

  // ملفات التطبيق: الشبكة أولاً (ليحصل الأطفال دائماً على آخر نسخة متطابقة)،
  // وإن لم يوجد إنترنت أو تأخر الرد أكثر من 4 ثوانٍ نستخدم الكاش.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch (err) { /* offline */ }
    const cached = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    return network; // لا يوجد في الكاش: ننتظر الشبكة
  })());
});
