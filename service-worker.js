// ============================================================================
//  service-worker.js — Agenda Phygital 2027
//  App shell en caché (funciona sin conexión: cámara, detección y lectura del
//  código son 100 % locales). El envío a Google se hace siempre por red.
// ============================================================================
const VERSION = 'phygital-v1.0.1';
const SHELL = [
  './', './index.html', './manifest.json',
  './js/app.js', './js/api.js', './js/auth.js', './js/config.js', './js/catalog.js',
  './js/pipeline.js', './js/scanner.js', './js/idreader.js',
  './fonts/Poppins-Regular.ttf', './fonts/JosefinSans-Regular.ttf',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const CDN = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_ONLY = ['script.google.com', 'script.googleusercontent.com', 'accounts.google.com', 'oauth2.googleapis.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                                  // POST al webhook: siempre red
  const url = new URL(req.url);
  if (NETWORK_ONLY.some(h => url.hostname.endsWith(h))) return;

  if (CDN.some(h => url.hostname.endsWith(h))) {                     // CDN: caché primero
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin === location.origin) {                              // propio: red primero, caché si no hay
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  }
});
