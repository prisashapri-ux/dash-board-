// Офлайн-режим и обновления. Код сайта и projects.json берутся из сети при каждом запуске, если сеть есть:
// так новая версия и свежие статусы проектов видны сразу. Без сети всё берётся из кэша.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const NET_TIMEOUT = 4000;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const isStatic = (url) => /\.(png|svg|jpg|webp)$/.test(url.pathname);
function networkFirst(req) {
  const fromCache = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'));
  const net = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  });
  const timer = new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT));
  // Сеть медленная: показываем кэш, сеть всё равно обновит его к следующему запуску.
  return Promise.race([net.catch(() => null), timer.then(() => null)]).then((res) => res || fromCache());
}
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (isStatic(url)) { e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))); return; }
  e.respondWith(networkFirst(e.request));
});
